using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>The server settings row in memory.</summary>
internal sealed class InMemorySettingsStore : IServerSettingsStore
{
    private ServerSettings? row;

    public List<AuditEntry> Audit { get; } = [];

    public int Saves { get; private set; }

    public Task<ServerSettings?> GetAsync(CancellationToken cancellationToken) => Task.FromResult(row);

    public Task<ServerSettings> UpdateAsync(DateTimeOffset now, Action<ServerSettings> change, AuditEntry audit, CancellationToken cancellationToken)
    {
        row ??= ServerSettings.CreateDefault(now);
        change(row);
        Audit.Add(audit);
        Saves++;
        return Task.FromResult(row);
    }
}

/// <summary>A protector whose output is visibly not the plain text.</summary>
internal sealed class FakeProtector : ISecretProtector
{
    public string Protect(string plain) => "protected:" + Convert.ToBase64String(Encoding.UTF8.GetBytes(plain));

    /// <summary>The Data Protection keys are gone: nothing can be read any more.</summary>
    public bool Broken { get; set; }

    public string? Unprotect(string? protectedValue) =>
        !Broken && protectedValue is not null && protectedValue.StartsWith("protected:", StringComparison.Ordinal)
            ? Encoding.UTF8.GetString(Convert.FromBase64String(protectedValue["protected:".Length..]))
            : null;
}

/// <summary>Caddy as a list of loaded Caddyfiles; it forgets them when it "restarts".</summary>
internal sealed class FakeCaddy : ICaddyGateway
{
    public string? Loaded { get; private set; }

    public string? LoadedName { get; private set; }

    public int Loads { get; private set; }

    public string? Refuse { get; set; }

    public bool Down { get; set; }

    public bool IsConfigured { get; set; } = true;

    public void Restart()
    {
        Loaded = null;
        LoadedName = null;
    }

    public Task<bool> IsLoadedAsync(string serverName, CancellationToken cancellationToken) =>
        Down ? throw new ServerConfigException("Caddy is not reachable") : Task.FromResult(string.Equals(LoadedName, serverName, StringComparison.Ordinal));

    public Task LoadAsync(string caddyfile, CancellationToken cancellationToken)
    {
        if (Down)
        {
            throw new ServerConfigException("Caddy is not reachable");
        }

        if (Refuse is not null)
        {
            throw new ServerConfigException(Refuse);
        }

        Loaded = caddyfile;
        LoadedName = System.Text.RegularExpressions.Regex.Match(caddyfile, @"name (sf-[0-9a-f]{12})").Groups[1].Value;
        Loads++;
        return Task.CompletedTask;
    }
}

/// <summary>The LiveKit supervisor: it applies a written configuration when <see cref="Supervise"/> runs.</summary>
internal sealed class FakeLiveKitConfig : ILiveKitConfigGateway
{
    public string? Written { get; private set; }

    public string? Applied { get; private set; }

    public int Writes { get; private set; }

    public bool AutoApply { get; set; } = true;

    public bool IsConfigured { get; set; } = true;

    public Task<bool> WriteAsync(string yaml, CancellationToken cancellationToken)
    {
        if (string.Equals(Written, yaml, StringComparison.Ordinal))
        {
            return Task.FromResult(false);
        }

        Written = yaml;
        Writes++;
        if (AutoApply)
        {
            Supervise();
        }

        return Task.FromResult(true);
    }

    public Task<string?> ReadAppliedHashAsync(CancellationToken cancellationToken) => Task.FromResult(Applied);

    public void Supervise() => Applied = Written is null ? null : LiveKitConfigRenderer.Hash(Written);
}

/// <summary>The certificate volume.</summary>
internal sealed class FakeCertificates : ICertificateGateway
{
    public bool IsConfigured { get; set; } = true;

    public string? Certificate { get; private set; }

    public string? Key { get; private set; }

    public Task<CertificateFiles?> SyncAsync(string? fingerprint, string? certificatePem, string? privateKeyPem, CancellationToken cancellationToken)
    {
        Certificate = certificatePem;
        Key = privateKeyPem;
        return Task.FromResult(fingerprint is null ? null : new CertificateFiles($"/certs/cert-{fingerprint[..16]}.pem", $"/certs/key-{fingerprint[..16]}.pem"));
    }
}

/// <summary>The backup service.</summary>
internal sealed class FakeBackupService : IBackupGateway
{
    public bool IsConfigured { get; set; } = true;

    public string? SettingsJson { get; private set; }

    public string? RcloneConfig { get; private set; }

    public int Requests { get; private set; }

    public BackupServiceStatus? Status { get; set; }

    public Task<string> WriteSettingsAsync(string settingsJson, string? rcloneConfig, CancellationToken cancellationToken)
    {
        SettingsJson = settingsJson;
        RcloneConfig = rcloneConfig;
        return Task.FromResult(BackupSettingsRenderer.Hash(settingsJson));
    }

    public Task RequestBackupAsync(CancellationToken cancellationToken)
    {
        Requests++;
        return Task.CompletedTask;
    }

    public Task<BackupServiceStatus?> ReadStatusAsync(CancellationToken cancellationToken) => Task.FromResult(Status);
}

/// <summary>The settings use cases with in-memory fakes.</summary>
internal sealed class SettingsHarness
{
    public const string ApiKey = "APIkeyOfTheTest";
    public const string ApiSecret = "SecretOfTheTestWithMoreThanThirtyTwoCharacters";

    public SettingsHarness(InstallOptions? install = null)
    {
        Install = install ?? new InstallOptions();
        State = new ServerSettingsState(Store, Install, NullLogger<ServerSettingsState>.Instance);
        Applier = new ServerConfigApplier(State, Protector, Caddy, LiveKit, Certificates, Backup, new LiveKitKeys(ApiKey, ApiSecret), Install, Clock, NullLogger<ServerConfigApplier>.Instance);
        Service = new ServerSettingsService(State, Store, Protector, Applier, Backup, Data, new FakeTokens(), Clock);
    }

    public InstallOptions Install { get; }

    public ManualClock Clock { get; } = new();

    public InMemoryData Data { get; } = new();

    public InMemorySettingsStore Store { get; } = new();

    public FakeProtector Protector { get; } = new();

    public FakeCaddy Caddy { get; } = new();

    public FakeLiveKitConfig LiveKit { get; } = new();

    public FakeCertificates Certificates { get; } = new();

    public FakeBackupService Backup { get; } = new();

    public ServerSettingsState State { get; }

    public ServerConfigApplier Applier { get; }

    public ServerSettingsService Service { get; }
}
