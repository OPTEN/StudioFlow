using System.Text.Json;
using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>The key pair LiveKit and the API share (generated once by the init service).</summary>
/// <param name="ApiKey">The API key (<c>iss</c> of every token, also the webhook key).</param>
/// <param name="ApiSecret">The API secret.</param>
public sealed record LiveKitKeys(string ApiKey, string ApiSecret);

/// <summary>
/// Makes the other services run the server settings (issue #27, decision 1): pushes a Caddyfile to the admin API of Caddy,
/// writes <c>livekit.yaml</c> for the supervisor in the LiveKit image and the settings file for the backup service. Nothing
/// needs the Docker socket. <see cref="ApplyAsync"/> is idempotent and cheap when nothing changed, so the maintenance loop
/// calls it every few seconds: a restarted Caddy or LiveKit is brought back to the saved state by the same call. A failure
/// is recorded in <see cref="Status"/> and retried; it never fails the save of the settings.
/// </summary>
public sealed class ServerConfigApplier(
    ServerSettingsState state,
    ISecretProtector protector,
    ICaddyGateway caddy,
    ILiveKitConfigGateway liveKitConfig,
    ICertificateGateway certificates,
    IBackupGateway backup,
    LiveKitKeys keys,
    InstallOptions install,
    TimeProvider clock,
    ILogger<ServerConfigApplier> logger) : IDisposable
{
    /// <summary>How long a trial of a media address lasts when nobody saves it.</summary>
    public static readonly TimeSpan TrialDuration = TimeSpan.FromMinutes(2);

    private static readonly TimeSpan CaddyRetry = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan LiveKitWait = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan LiveKitPoll = TimeSpan.FromMilliseconds(500);

    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly Dictionary<string, string?> lastLogged = new(StringComparer.Ordinal);
    private (string Address, DateTimeOffset Until)? trial;
    private DateTimeOffset nextCaddyAttempt;
    private string liveKitHash = string.Empty;
    private ApplyStatusDto status = new(new ApplyTargetDto(false, null), new ApplyTargetDto(false, null), new ApplyTargetDto(false, null));

    /// <inheritdoc />
    public void Dispose() => gate.Dispose();

    /// <summary>Whether the services run the saved settings (as of the last <see cref="ApplyAsync"/>).</summary>
    public ApplyStatusDto Status => status;

    /// <summary>The media address of a running trial, or null.</summary>
    public string? TrialAddress => trial is { } running && running.Until > clock.GetUtcNow() ? running.Address : null;

    /// <summary>When the running trial ends.</summary>
    public DateTimeOffset? TrialUntil => TrialAddress is null ? null : trial?.Until;

    /// <summary>
    /// Lets LiveKit announce <paramref name="address"/> for a few minutes, to test it. The saved address is restored when
    /// the trial ends (<see cref="EndTrial"/>, the expiry, or because the address was saved after all).
    /// </summary>
    public DateTimeOffset BeginTrial(string address)
    {
        var until = clock.GetUtcNow() + TrialDuration;
        trial = (address, until);
        return until;
    }

    /// <summary>Ends a trial; the next <see cref="ApplyAsync"/> restores the saved address.</summary>
    public void EndTrial() => trial = null;

    /// <summary>Brings Caddy, LiveKit and the backup service to the saved settings.</summary>
    public async Task ApplyAsync(CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var settings = state.Row;
            var caddyStatus = await ApplyCaddyAsync(settings, cancellationToken);
            var liveKitStatus = await ApplyLiveKitAsync(settings, cancellationToken);
            var backupStatus = await ApplyBackupAsync(settings, cancellationToken);
            status = new ApplyStatusDto(caddyStatus, liveKitStatus, backupStatus);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Waits until LiveKit reports that it runs the configuration written last. Returns false after 30 seconds.</summary>
    public async Task<bool> WaitForLiveKitAsync(CancellationToken cancellationToken)
    {
        if (!liveKitConfig.IsConfigured)
        {
            return true;
        }

        var deadline = clock.GetUtcNow() + LiveKitWait;
        while (true)
        {
            if (string.Equals(await liveKitConfig.ReadAppliedHashAsync(cancellationToken), liveKitHash, StringComparison.Ordinal))
            {
                return true;
            }

            if (clock.GetUtcNow() >= deadline)
            {
                return false;
            }

            await Task.Delay(LiveKitPoll, cancellationToken);
        }
    }

    private async Task<ApplyTargetDto> ApplyCaddyAsync(ServerSettings? settings, CancellationToken cancellationToken)
    {
        if (!caddy.IsConfigured)
        {
            return new ApplyTargetDto(true, null);
        }

        try
        {
            var model = await BuildCaddyModelAsync(settings, cancellationToken);
            var config = CaddyfileRenderer.Render(model);
            if (!await caddy.IsLoadedAsync(config.ServerName, cancellationToken))
            {
                if (clock.GetUtcNow() < nextCaddyAttempt)
                {
                    return status.Caddy with { Applied = false };
                }

                await caddy.LoadAsync(config.Text, cancellationToken);
                logger.LogInformation("Caddy now runs the server settings ({ServerName})", config.ServerName);
            }

            Log("caddy", config.Warning);
            return new ApplyTargetDto(true, config.Warning);
        }
        catch (ServerConfigException exception)
        {
            nextCaddyAttempt = clock.GetUtcNow() + CaddyRetry;
            Log("caddy", exception.Message);
            return new ApplyTargetDto(false, exception.Message);
        }
    }

    private async Task<CaddyModel> BuildCaddyModelAsync(ServerSettings? settings, CancellationToken cancellationToken)
    {
        var tlsMode = settings?.TlsMode ?? TlsModes.Internal;
        IReadOnlyList<string>? dnsArguments = null;
        CertificateFiles? certificate = null;
        if (TlsModes.IsDns(tlsMode))
        {
            dnsArguments = DnsArguments(settings);
        }

        string? key = null;
        if (certificates.IsConfigured)
        {
            key = string.Equals(tlsMode, TlsModes.Custom, StringComparison.Ordinal) ? protector.Unprotect(settings?.PrivateKeyProtected) : null;
            var pem = key is null ? null : settings?.CertificatePem;
            var fingerprint = pem is null ? null : CertificateRules.Describe(pem)?.Fingerprint;
            certificate = await certificates.SyncAsync(fingerprint, fingerprint is null ? null : pem, fingerprint is null ? null : key, cancellationToken);
        }

        return new CaddyModel(
            install.HttpsPort,
            tlsMode,
            settings?.Domain,
            settings?.AcmeEmail,
            settings?.DnsChallengeDomain,
            dnsArguments,
            certificate,
            settings?.FrameAncestorList ?? [],
            install.HstsMaxAge);
    }

    /// <summary>The credentials in the order of the provider snippet; null when they are missing or cannot be decrypted.</summary>
    private IReadOnlyList<string>? DnsArguments(ServerSettings? settings)
    {
        var provider = TlsModes.ProviderOf(settings?.TlsMode);
        if (provider is null || protector.Unprotect(settings?.DnsCredentialsProtected) is not { } json)
        {
            return null;
        }

        try
        {
            var values = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
            var ordered = provider.Fields.Select(field => values is not null && values.TryGetValue(field.Name, out var value) ? value : null).ToList();
            return ordered.Any(value => string.IsNullOrEmpty(value)) ? null : [.. ordered.Select(value => value!)];
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<ApplyTargetDto> ApplyLiveKitAsync(ServerSettings? settings, CancellationToken cancellationToken)
    {
        if (!liveKitConfig.IsConfigured)
        {
            return new ApplyTargetDto(true, null);
        }

        var nodeIp = TrialAddress ?? settings?.MediaAddress;
        var yaml = LiveKitConfigRenderer.Render(keys.ApiKey, keys.ApiSecret, nodeIp, install);
        try
        {
            if (await liveKitConfig.WriteAsync(yaml, cancellationToken))
            {
                logger.LogInformation("LiveKit configuration written; the supervisor restarts the server (media address {MediaAddress})", nodeIp ?? "not set");
            }

            liveKitHash = LiveKitConfigRenderer.Hash(yaml);
            var applied = await liveKitConfig.ReadAppliedHashAsync(cancellationToken);
            Log("livekit", null);
            return new ApplyTargetDto(string.Equals(applied, liveKitHash, StringComparison.Ordinal), null);
        }
        catch (ServerConfigException exception)
        {
            Log("livekit", exception.Message);
            return new ApplyTargetDto(false, exception.Message);
        }
    }

    private async Task<ApplyTargetDto> ApplyBackupAsync(ServerSettings? settings, CancellationToken cancellationToken)
    {
        if (!backup.IsConfigured)
        {
            return new ApplyTargetDto(true, null);
        }

        try
        {
            var settingsRow = settings ?? ServerSettings.CreateDefault(clock.GetUtcNow());
            var rclone = protector.Unprotect(settingsRow.RcloneConfigProtected);
            var json = BackupSettingsRenderer.Render(settingsRow, rclone);
            var sha = await backup.WriteSettingsAsync(json, rclone, cancellationToken);
            var reported = await backup.ReadStatusAsync(cancellationToken);
            Log("backup", null);
            return new ApplyTargetDto(string.Equals(reported?.SettingsSha256, sha, StringComparison.Ordinal), null);
        }
        catch (ServerConfigException exception)
        {
            Log("backup", exception.Message);
            return new ApplyTargetDto(false, exception.Message);
        }
    }

    /// <summary>Logs a problem once per change, not every few seconds.</summary>
    private void Log(string target, string? message)
    {
        if (lastLogged.TryGetValue(target, out var before) && string.Equals(before, message, StringComparison.Ordinal))
        {
            return;
        }

        lastLogged[target] = message;
        if (message is not null)
        {
            logger.LogWarning("The server settings could not be applied to {Target}: {Message}", target, message);
        }
        else if (before is not null)
        {
            logger.LogInformation("The server settings are applied to {Target} again", target);
        }
    }
}
