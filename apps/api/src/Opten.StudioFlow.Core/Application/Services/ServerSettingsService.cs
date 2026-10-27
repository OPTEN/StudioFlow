using System.Globalization;
using System.Text.Json;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// The use cases of the first-run wizard (after the account) and of the "Server settings" page (issue #27): the media
/// address with its test, the address and certificate, the embedding origins, the backup schedule and the off-site target.
/// Every input is validated before it is saved; secrets are protected before they are stored and never returned. Saving
/// applies the settings to Caddy, LiveKit and the backup service (<see cref="ServerConfigApplier"/>); a change of the media
/// address restarts LiveKit, so it is refused while a broadcast is live.
/// </summary>
public sealed class ServerSettingsService(
    ServerSettingsState state,
    IServerSettingsStore store,
    ISecretProtector protector,
    ServerConfigApplier applier,
    IBackupGateway backup,
    IUnitOfWorkFactory data,
    ILiveKitTokenIssuer tokens,
    TimeProvider clock)
{
    /// <summary>The settings as the Regie shows them (no secret).</summary>
    public ServerSettingsDto Get() => ToDto(state.Row);

    /// <summary>Whether the services run the saved settings.</summary>
    public ApplyStatusDto GetApplyStatus() => applier.Status;

    /// <summary>
    /// Saves the media address. Refused (409 <c>broadcast_live</c>) while a broadcast is live and the address changes,
    /// because LiveKit restarts to announce it.
    /// </summary>
    public async Task<ServerSettingsDto> UpdateMediaAsync(UpdateMediaRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new ValidationErrors();
        var address = ServerSettingsRules.ValidateMediaAddress(request.Address, "address", errors);
        errors.ThrowIfAny();
        if (!string.Equals(address, state.Row?.MediaAddress, StringComparison.Ordinal) && !string.Equals(address, applier.TrialAddress, StringComparison.Ordinal))
        {
            await EnsureNoBroadcastAsync(cancellationToken);
        }

        var row = await SaveAsync(AuditActions.SettingsMediaChanged, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Address] = address! }, settings => settings.ChangeMediaAddress(address!, clock.StorageNow()), cancellationToken);
        applier.EndTrial();
        await applier.ApplyAsync(cancellationToken);
        return ToDto(row);
    }

    /// <summary>
    /// Saves the address and the certificate mode. Credentials that are left out stay as they are. The mode <c>custom</c>
    /// needs an uploaded certificate (<see cref="UploadCertificateAsync"/>) that covers the domain.
    /// </summary>
    public async Task<ServerSettingsDto> UpdateAddressAsync(UpdateAddressRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new ValidationErrors();
        var mode = request.TlsMode?.Trim();
        if (!TlsModes.IsKnown(mode))
        {
            errors.Add("tlsMode", SettingsFieldErrors.TlsModeUnknown);
            errors.ThrowIfAny();
        }

        var isInternal = string.Equals(mode, TlsModes.Internal, StringComparison.Ordinal);
        var isDns = TlsModes.IsDns(mode);
        var domain = ServerSettingsRules.ValidateDomain(request.Domain, required: !isInternal, needsDot: !isInternal, "domain", errors);
        var email = isDns ? ServerSettingsRules.ValidateEmail(request.AcmeEmail, "acmeEmail", errors) : null;
        var challenge = isDns ? ServerSettingsRules.ValidateChallengeDomain(request.DnsChallengeDomain, "dnsChallengeDomain", errors) : null;
        string? credentialsProtected = null;
        if (isDns)
        {
            var keepStored = string.Equals(state.Row?.TlsMode, mode, StringComparison.Ordinal) && state.Row?.DnsCredentialsProtected is not null;
            var values = ServerSettingsRules.ValidateDnsCredentials(mode!, request.DnsCredentials, keepStored, "dnsCredentials", errors);
            if (values is not null)
            {
                var provider = TlsModes.ProviderOf(mode)!;
                var map = provider.Fields.Zip(values, (field, value) => (field.Name, value)).ToDictionary(pair => pair.Name, pair => pair.value, StringComparer.Ordinal);
                credentialsProtected = protector.Protect(JsonSerializer.Serialize(map));
            }
        }

        var custom = string.Equals(mode, TlsModes.Custom, StringComparison.Ordinal);
        if (custom)
        {
            CheckStoredCertificate(domain, errors);
        }

        errors.ThrowIfAny();

        var details = new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Mode] = mode! };
        if (domain is not null)
        {
            details[AuditDetails.Domain] = domain;
        }

        var row = await SaveAsync(AuditActions.SettingsAddressChanged, details, settings => settings.ChangeAddress(mode!, domain, email, challenge, credentialsProtected, clock.StorageNow()), cancellationToken);
        await applier.ApplyAsync(cancellationToken);
        return ToDto(row);
    }

    /// <summary>
    /// Checks and stores an uploaded certificate with its key (the key encrypted). The pair must match, be valid now and
    /// cover the domain; it takes effect when the mode is <c>custom</c>.
    /// </summary>
    public async Task<ServerSettingsDto> UploadCertificateAsync(UploadCertificateRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new ValidationErrors();
        var domain = string.IsNullOrWhiteSpace(request.Domain)
            ? state.Row?.Domain
            : ServerSettingsRules.ValidateDomain(request.Domain, required: true, needsDot: true, "domain", errors);
        var pair = CertificateRules.Validate(request.CertificatePem, request.PrivateKeyPem, domain, clock.GetUtcNow(), errors);
        errors.ThrowIfAny();

        var protectedKey = protector.Protect(pair!.PrivateKeyPem);
        var details = new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Mode] = TlsModes.Custom };
        var row = await SaveAsync(AuditActions.SettingsAddressChanged, details, settings => settings.ChangeCertificate(pair.CertificatePem, protectedKey, clock.StorageNow()), cancellationToken);
        await applier.ApplyAsync(cancellationToken);
        return ToDto(row);
    }

    /// <summary>Saves the origins that may embed the output.</summary>
    public async Task<ServerSettingsDto> UpdateEmbeddingAsync(UpdateEmbeddingRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new ValidationErrors();
        var origins = ServerSettingsRules.ValidateOrigins(request.Origins, "origins", errors);
        errors.ThrowIfAny();

        var details = new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Count] = origins.Count.ToString(CultureInfo.InvariantCulture) };
        var row = await SaveAsync(AuditActions.SettingsEmbeddingChanged, details, settings => settings.ChangeEmbedding(origins, clock.StorageNow()), cancellationToken);
        await applier.ApplyAsync(cancellationToken);
        return ToDto(row);
    }

    /// <summary>Saves the backup schedule and the off-site target. An off-site copy needs a public age key or the statement that the remote encrypts.</summary>
    public async Task<ServerSettingsDto> UpdateBackupAsync(UpdateBackupRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new ValidationErrors();
        var schedule = ServerSettingsRules.ValidateSchedule(request.Schedule, "schedule", errors);
        var timezone = ServerSettingsRules.ValidateTimezone(request.Timezone, "timezone", errors);
        ServerSettingsRules.ValidateRetention(request.KeepDaily, request.KeepWeekly, errors);
        var remote = ServerSettingsRules.ValidateRemote(request.RcloneRemote, "rcloneRemote", errors);
        var rcloneConfig = ServerSettingsRules.ValidateRcloneConfig(request.RcloneConfig, "rcloneConfig", errors);
        var recipients = ServerSettingsRules.ValidateAgeRecipients(request.AgeRecipients, "ageRecipients", errors);
        string? configProtected = rcloneConfig is null ? null : protector.Protect(rcloneConfig);
        if (remote is not null)
        {
            var effectiveConfig = rcloneConfig ?? protector.Unprotect(state.Row?.RcloneConfigProtected);
            if (effectiveConfig is not null && !errors.HasErrors && !ServerSettingsRules.RemoteIsDefined(remote, effectiveConfig))
            {
                errors.Add("rcloneRemote", SettingsFieldErrors.RemoteNotInConfig);
            }

            if (recipients.Count == 0 && !request.OffsiteUnencrypted)
            {
                errors.Add("ageRecipients", SettingsFieldErrors.AgeRecipientRequired);
            }
        }

        errors.ThrowIfAny();

        var details = new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Mode] = schedule is null ? "off" : "scheduled" };
        var row = await SaveAsync(
            AuditActions.SettingsBackupChanged,
            details,
            settings => settings.ChangeBackup(schedule, timezone, request.KeepDaily, request.KeepWeekly, remote, configProtected, recipients, request.OffsiteUnencrypted, clock.StorageNow()),
            cancellationToken);
        await applier.ApplyAsync(cancellationToken);
        return ToDto(row);
    }

    /// <summary>The address the admin opened the page with and the addresses of the server's interfaces.</summary>
    public static MediaSuggestionsDto Suggest(string? hostHeader, IReadOnlyList<string> interfaces)
    {
        ArgumentNullException.ThrowIfNull(interfaces);
        var host = hostHeader?.Split(':')[0];
        var fromHost = host is not null && ServerSettingsRules.IsUsableIpv4(host) ? host : null;
        return new MediaSuggestionsDto(fromHost, [.. interfaces.Where(ServerSettingsRules.IsUsableIpv4).Distinct(StringComparer.Ordinal)]);
    }

    /// <summary>
    /// Starts the test of a media address: LiveKit restarts announcing it (for two minutes, unless it is saved) and the
    /// answer holds the tokens of two participants of a throw-away room. The browser joins both through the same origin as
    /// the page and sends a message from one to the other and back: the round trip works only when the address reaches
    /// the server. Refused (409 <c>broadcast_live</c>) while a broadcast is live; 503 when LiveKit does not come back.
    /// </summary>
    public async Task<MediaTestDto> StartMediaTestAsync(MediaTestRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var errors = new ValidationErrors();
        var address = ServerSettingsRules.ValidateMediaAddress(request.Address, "address", errors);
        errors.ThrowIfAny();
        if (!string.Equals(address, state.Row?.MediaAddress, StringComparison.Ordinal))
        {
            await EnsureNoBroadcastAsync(cancellationToken);
        }

        var until = applier.BeginTrial(address!);
        await applier.ApplyAsync(cancellationToken);
        if (!await applier.WaitForLiveKitAsync(cancellationToken))
        {
            applier.EndTrial();
            throw new StudioFlowException(ErrorKind.Conflict, ErrorCodes.ServiceUnavailable, "LiveKit did not restart with the new address. Check: docker compose logs livekit");
        }

        var room = "mediatest-" + Secrets.New()[..12].ToLowerInvariant().Replace('_', 'x').Replace('-', 'y');
        return new MediaTestDto(room, tokens.IssueMediaTestToken(room, "mediatest-first"), tokens.IssueMediaTestToken(room, "mediatest-second"), until);
    }

    /// <summary>Ends a test without saving: LiveKit goes back to the saved address.</summary>
    public async Task EndMediaTestAsync(CancellationToken cancellationToken)
    {
        applier.EndTrial();
        await applier.ApplyAsync(cancellationToken);
    }

    /// <summary>The latest backups and the state of the backup service.</summary>
    public async Task<BackupsDto> GetBackupsAsync(CancellationToken cancellationToken)
    {
        var status = backup.IsConfigured ? await backup.ReadStatusAsync(cancellationToken) : null;
        if (status is null)
        {
            return new BackupsDto(false, false, false, null, []);
        }

        var backups = (status.Backups ?? []).OrderByDescending(b => b.At).Take(20).Select(b => new BackupEntryDto(b.Name, b.At, b.Bytes, b.Kind)).ToList();
        var failed = status.LastAttempt is { Ok: false } attempt ? attempt.Message : null;
        return new BackupsDto(true, status.State is "running" or "postponed", status.State is "postponed", failed, backups);
    }

    /// <summary>Asks the backup service for a backup now.</summary>
    public async Task RequestBackupAsync(CancellationToken cancellationToken)
    {
        if (!backup.IsConfigured)
        {
            throw new StudioFlowException(ErrorKind.Conflict, ErrorCodes.ServiceUnavailable, "The backup service is not part of this installation.");
        }

        _ = await backup.ReadStatusAsync(cancellationToken) ?? throw new StudioFlowException(ErrorKind.Conflict, ErrorCodes.ServiceUnavailable, "The backup service has not reported yet. Check: docker compose ps backup");

        await using (var unit = data.Create())
        {
            unit.Audit.Add(AuditEntry.Create(null, clock.StorageNow(), AuditActors.Admin, AuditActions.BackupRequested));
            await unit.SaveChangesAsync(cancellationToken);
        }

        await backup.RequestBackupAsync(cancellationToken);
    }

    private async Task<ServerSettings> SaveAsync(string action, Dictionary<string, string> details, Action<ServerSettings> change, CancellationToken cancellationToken)
    {
        var now = clock.StorageNow();
        var row = await store.UpdateAsync(now, change, AuditEntry.Create(null, now, AuditActors.Admin, action, details), cancellationToken);
        state.Replace(row);
        return row;
    }

    private async Task EnsureNoBroadcastAsync(CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        if (await unit.Productions.AnyLiveAsync(cancellationToken))
        {
            throw StudioFlowException.Conflict(ErrorCodes.BroadcastLive, "A broadcast is live. The media address cannot change now: LiveKit restarts and every connected device would lose its picture.");
        }
    }

    /// <summary>The mode <c>custom</c> needs a stored certificate that is still valid and covers the domain.</summary>
    private void CheckStoredCertificate(string? domain, ValidationErrors errors)
    {
        var info = CertificateRules.Describe(state.Row?.CertificatePem);
        if (info is null)
        {
            errors.Add("tlsMode", SettingsFieldErrors.CertificateRequired);
            return;
        }

        if (domain is not null && !info.Names.Any(name => CertificateRules.Covers(name, domain)))
        {
            errors.Add("domain", SettingsFieldErrors.CertificateNameMismatch);
        }

        if (info.NotAfter <= clock.GetUtcNow())
        {
            errors.Add("tlsMode", SettingsFieldErrors.CertificateExpired);
        }
    }

    private ServerSettingsDto ToDto(ServerSettings? row)
    {
        var provider = TlsModes.ProviderOf(row?.TlsMode);
        var fields = row?.DnsCredentialsProtected is not null && provider is not null ? provider.Fields.Select(f => f.Name).ToList() : [];
        return new ServerSettingsDto(
            row?.IsConfigured == true,
            state.BaseUrl,
            state.HttpsPort,
            new MediaSettingsDto(row?.MediaAddress),
            new AddressSettingsDto(row?.TlsMode ?? TlsModes.Internal, row?.Domain, row?.AcmeEmail, row?.DnsChallengeDomain, fields, CertificateRules.Describe(row?.CertificatePem)),
            new EmbeddingSettingsDto(row?.FrameAncestorList ?? []),
            new BackupSettingsDto(
                row?.BackupSchedule,
                row?.BackupTimezone,
                row?.BackupKeepDaily ?? ServerSettings.DefaultKeepDaily,
                row?.BackupKeepWeekly ?? ServerSettings.DefaultKeepWeekly,
                row?.RcloneRemote,
                row?.RcloneConfigProtected is not null,
                row?.AgeRecipientList ?? [],
                row?.OffsiteUnencrypted ?? false),
            [.. TlsModes.DnsProviders.Select(p => new DnsProviderDto(p.Id, [.. p.Fields.Select(f => f.Name)]))]);
    }
}
