using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// The one source of the texts of audit entries (spec 4.9), for "Recent events" and the audit log: a stable
/// <see cref="LogCode"/>, the values the client puts into its own text, and an English fallback text such as
/// "K2 reconnecting", "K2 is back, was gone for 9 s" or "Scene “Break” is live". "Recent events" shows only the
/// <see cref="RecentActions"/>; the audit log shows every entry that has a text. Source outages follow spec 4.5: a slot
/// stopped on purpose is "S1 sharing stopped" for a screen and "K1 camera stopped" for a camera (the kind is stored
/// with the entry); a camera paused by the operating system is an outage that is expected back, "K1 reconnecting".
/// </summary>
public static class LogTexts
{
    /// <summary>Actions that "Recent events" shows (pre-filter for database queries).</summary>
    public static IReadOnlyCollection<string> RecentActions { get; } =
    [
        AuditActions.SceneLive, AuditActions.SceneCreated, AuditActions.SceneDeleted, AuditActions.BroadcastStarted,
        AuditActions.BroadcastEnded, AuditActions.DevicePaired, AuditActions.DeviceBlocked, AuditActions.DeviceUnblocked,
        AuditActions.DeviceRemoved, AuditActions.PairingDenied, AuditActions.InviteCreated, AuditActions.InviteRevoked,
        AuditActions.OutputLinkCreated, AuditActions.OutputLinkRenamed, AuditActions.OutputLinkRevoked, AuditActions.OutputKeyRegenerated,
        AuditActions.OutputAccessChanged, AuditActions.AssetUploaded, AuditActions.AssetDeleted,
        AuditActions.SourceReconnecting, AuditActions.SourceEnded, AuditActions.SourceLost, AuditActions.SourceRecovered,
        AuditActions.AccountSetUp, AuditActions.PasswordChanged, AuditActions.AccountReset,
        AuditActions.TextCreated, AuditActions.TextDeleted, AuditActions.TextShown, AuditActions.TextHidden,
    ];

    /// <summary>Parameter names of <see cref="LogEntryDto.Params"/>.</summary>
    private static class Param
    {
        public const string Scene = "scene";
        public const string Subject = "subject";
        public const string Name = "name";
        public const string Code = "code";
        public const string DownSeconds = "downSeconds";
        public const string Username = "username";
        public const string Lens = "lens";
        public const string From = "from";
        public const string To = "to";
        public const string Target = "target";
        public const string Format = "format";
        public const string Rows = "rows";
        public const string Days = "days";
        public const string Deleted = "deleted";
        public const string Anonymised = "anonymised";
        public const string Address = "address";
        public const string Mode = "mode";
        public const string Count = "count";
    }

    /// <summary>The log entry of an audit entry in "Recent events", or null when the entry is not shown there.</summary>
    public static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text)? DescribeRecent(AuditEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return RecentActions.Contains(entry.Action) ? Describe(entry) : null;
    }

    /// <summary>
    /// The log entry of an audit entry (code, parameters, English text), or null for an action without a text: an unknown
    /// action, or an invite of a phone QR code (not audited any more; entries of older versions remain).
    /// </summary>
    public static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text)? Describe(AuditEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        var invitesAreLinks = string.Equals(entry.Detail(AuditDetails.Kind), nameof(InviteKind.LaptopLink), StringComparison.Ordinal);
        var scene = entry.Detail(AuditDetails.Scene);
        var code = entry.Detail(AuditDetails.Code);
        var name = entry.Detail(AuditDetails.Name);
        var username = entry.Detail(AuditDetails.Username);
        var subject = Subject(entry);
        return entry.Action switch
        {
            AuditActions.SceneLive => With(LogCode.SceneLive, $"Scene “{scene}” is live", (Param.Scene, scene)),
            AuditActions.SceneCreated => With(LogCode.SceneCreated, $"Scene “{scene}” created", (Param.Scene, scene)),
            AuditActions.SceneDeleted => With(LogCode.SceneDeleted, $"Scene “{scene}” deleted", (Param.Scene, scene)),
            AuditActions.BroadcastStarted => With(LogCode.BroadcastStarted, "Broadcast started"),
            AuditActions.BroadcastEnded => With(LogCode.BroadcastEnded, "Broadcast ended"),
            AuditActions.DevicePaired => With(LogCode.DevicePaired, $"{subject} paired", (Param.Subject, subject)),
            AuditActions.DeviceBlocked => With(LogCode.DeviceBlocked, $"{subject} blocked", (Param.Subject, subject)),
            AuditActions.DeviceUnblocked => With(LogCode.DeviceUnblocked, $"{subject} unblocked", (Param.Subject, subject)),
            AuditActions.DeviceRemoved => With(LogCode.DeviceRemoved, $"{subject} removed", (Param.Subject, subject)),
            AuditActions.PairingDenied => With(LogCode.PairingDenied, $"Request from {name} denied", (Param.Name, name)),
            AuditActions.InviteCreated when invitesAreLinks => With(LogCode.InviteLinkCreated, "Invite link created"),
            AuditActions.InviteRevoked when invitesAreLinks => With(LogCode.InviteLinkRevoked, "Invite link revoked"),
            AuditActions.OutputLinkCreated => With(LogCode.OutputLinkCreated, $"Output link “{name}” created", (Param.Name, name)),
            AuditActions.OutputLinkRenamed => With(LogCode.OutputLinkRenamed, $"Output link renamed to “{name}”", (Param.Name, name)),
            AuditActions.OutputLinkRevoked => With(LogCode.OutputLinkRevoked, $"Output link “{name}” revoked", (Param.Name, name)),
            AuditActions.OutputKeyRegenerated => With(LogCode.OutputLinkRegenerated, $"Output link “{name}” regenerated", (Param.Name, name)),
            AuditActions.OutputAccessChanged => With(LogCode.OutputAccessChanged, $"Access of output link “{name}” changed", (Param.Name, name)),
            AuditActions.AssetUploaded => With(LogCode.AssetUploaded, $"{code} “{name}” uploaded", (Param.Code, code), (Param.Name, name)),
            AuditActions.AssetDeleted => With(LogCode.AssetDeleted, $"{code} “{name}” deleted", (Param.Code, code), (Param.Name, name)),
            AuditActions.TextCreated => With(LogCode.TextCreated, $"{code} “{name}” created", (Param.Code, code), (Param.Name, name)),
            AuditActions.TextDeleted => With(LogCode.TextDeleted, $"{code} “{name}” deleted", (Param.Code, code), (Param.Name, name)),
            AuditActions.TextShown => With(LogCode.TextShown, $"{code} shown", (Param.Code, code)),
            AuditActions.TextHidden => With(LogCode.TextHidden, $"{code} hidden", (Param.Code, code)),
            AuditActions.SourceReconnecting => With(LogCode.SourceReconnecting, $"{code} reconnecting", (Param.Code, code)),
            AuditActions.SourceEnded when string.Equals(entry.Detail(AuditDetails.Kind), nameof(SourceKind.Camera), StringComparison.Ordinal) => With(LogCode.CameraEnded, $"{code} camera stopped", (Param.Code, code)),
            AuditActions.SourceEnded => With(LogCode.ScreenEnded, $"{code} sharing stopped", (Param.Code, code)),
            AuditActions.SourceLost => With(LogCode.SourceLost, $"{code} no picture", (Param.Code, code)),
            AuditActions.SourceRecovered => Recovered(entry, code),
            AuditActions.AccountSetUp => With(LogCode.AccountSetUp, "Account set up"),
            AuditActions.PasswordChanged => With(LogCode.PasswordChanged, "Password changed"),
            AuditActions.AccountReset => With(LogCode.AccountReset, "Account reset"),
            AuditActions.LoginSucceeded => With(LogCode.LoginSucceeded, $"“{username}” signed in", (Param.Username, username)),
            AuditActions.LoginFailed => With(LogCode.LoginFailed, $"Sign-in failed for “{username}”", (Param.Username, username)),
            AuditActions.LoginLocked => With(LogCode.LoginLocked, "Sign-in locked after too many failed attempts"),
            AuditActions.Logout => With(LogCode.LoggedOut, $"“{username}” signed out", (Param.Username, username)),
            AuditActions.ProductionCreated => With(LogCode.ProductionCreated, $"Production “{name}” created", (Param.Name, name)),
            AuditActions.ProductionRenamed => With(LogCode.ProductionRenamed, $"Production “{entry.Detail(AuditDetails.From)}” renamed to “{name}”", (Param.From, entry.Detail(AuditDetails.From)), (Param.Name, name)),
            AuditActions.CanvasChanged => With(LogCode.CanvasChanged, $"Output changed from {entry.Detail(AuditDetails.From)} to {entry.Detail(AuditDetails.To)}", (Param.From, entry.Detail(AuditDetails.From)), (Param.To, entry.Detail(AuditDetails.To))),
            AuditActions.ProductionActivated => With(LogCode.ProductionActivated, $"Production “{name}” activated", (Param.Name, name)),
            AuditActions.ProductionDuplicated => With(LogCode.ProductionDuplicated, $"Production “{entry.Detail(AuditDetails.From)}” duplicated as “{name}”", (Param.From, entry.Detail(AuditDetails.From)), (Param.Name, name)),
            AuditActions.ProductionExported => With(LogCode.ProductionExported, $"Production “{name}” exported", (Param.Name, name)),
            AuditActions.ProductionImported => With(LogCode.ProductionImported, $"Production “{name}” imported", (Param.Name, name)),
            AuditActions.PlaceholderAssigned => With(LogCode.PlaceholderAssigned, $"{code} assigned to {entry.Detail(AuditDetails.Target)}", (Param.Code, code), (Param.Target, entry.Detail(AuditDetails.Target))),
            AuditActions.PlaceholderRemoved => With(LogCode.PlaceholderRemoved, $"{code} removed from the scenes", (Param.Code, code)),
            AuditActions.BroadcastReset => With(LogCode.BroadcastReset, "Broadcast reset"),
            AuditActions.SlateChanged when string.Equals(entry.Detail(AuditDetails.Slate), AuditSlates.End, StringComparison.Ordinal) => With(LogCode.EndSlateChanged, "Slate after the broadcast changed"),
            AuditActions.SlateChanged => With(LogCode.StandbySlateChanged, "Slate before the broadcast changed"),
            AuditActions.IncidentAcknowledged => With(LogCode.IncidentAcknowledged, $"{code} message marked as seen", (Param.Code, code)),
            AuditActions.DeviceRenamed => With(LogCode.DeviceRenamed, $"{subject} renamed to “{name}”", (Param.Subject, subject), (Param.Name, name)),
            AuditActions.CameraLensSwitched => Lens(entry, subject),
            AuditActions.AuditExported => With(LogCode.AuditExported, $"Audit log exported as {entry.Detail(AuditDetails.Format)}, {entry.Detail(AuditDetails.Rows)} rows", (Param.Format, entry.Detail(AuditDetails.Format)), (Param.Rows, entry.Detail(AuditDetails.Rows))),
            AuditActions.AuditRetention => Retention(entry),
            AuditActions.SettingsMediaChanged => With(LogCode.SettingsMediaChanged, $"Media address set to {entry.Detail(AuditDetails.Address)}", (Param.Address, entry.Detail(AuditDetails.Address))),
            AuditActions.SettingsAddressChanged => With(LogCode.SettingsAddressChanged, $"Address and certificate changed ({entry.Detail(AuditDetails.Mode)})", (Param.Mode, entry.Detail(AuditDetails.Mode))),
            AuditActions.SettingsEmbeddingChanged => With(LogCode.SettingsEmbeddingChanged, $"Embedding changed ({entry.Detail(AuditDetails.Count)} origins)", (Param.Count, entry.Detail(AuditDetails.Count))),
            AuditActions.SettingsBackupChanged => With(LogCode.SettingsBackupChanged, "Backup settings changed"),
            AuditActions.BackupRequested => With(LogCode.BackupRequested, "Backup requested"),
            _ => null,
        };
    }

    /// <summary>The English text of an audit entry, or null when the entry is not shown.</summary>
    public static string? For(AuditEntry entry) => Describe(entry)?.Text;

    private static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text) Recovered(AuditEntry entry, string code)
    {
        var downSeconds = AuditEntry.DowntimeSeconds(entry.Detail(AuditDetails.DownSeconds));
        var text = $"{code} is back, was gone for {AuditEntry.FormatDowntime(entry.Detail(AuditDetails.DownSeconds))}";
        return With(LogCode.SourceRecovered, text, (Param.Code, code), (Param.DownSeconds, downSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    }

    private static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text) Lens(AuditEntry entry, string subject)
    {
        var kind = Enum.TryParse<CameraLensKind>(entry.Detail(AuditDetails.Lens), out var parsed) ? parsed : CameraLensKind.Other;
        var (param, name) = kind switch
        {
            CameraLensKind.Front => ("front", "Front"),
            CameraLensKind.UltraWide => ("ultraWide", "Wide-angle"),
            CameraLensKind.Standard => ("standard", "Standard"),
            CameraLensKind.Tele => ("tele", "Tele"),
            _ => ("other", "Other"),
        };
        return With(LogCode.CameraLensSwitched, $"{subject}: lens switched to {name}", (Param.Subject, subject), (Param.Lens, param));
    }

    private static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text) Retention(AuditEntry entry)
    {
        var (days, deleted, anonymised) = (entry.Detail(AuditDetails.Days), entry.Detail(AuditDetails.Deleted), entry.Detail(AuditDetails.Anonymised));
        return With(
            LogCode.AuditRetention,
            $"Audit retention ({days} days): entries deleted {deleted}, IP addresses removed {anonymised}",
            (Param.Days, days),
            (Param.Deleted, deleted),
            (Param.Anonymised, anonymised));
    }

    private static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text) With(LogCode code, string text, params (string Key, string Value)[] parameters) =>
        (code, parameters.ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal), text);

    /// <summary>"S1, S2 Laptop Mia", or the name alone when the device has no slots.</summary>
    private static string Subject(AuditEntry entry)
    {
        var codes = entry.Detail(AuditDetails.Codes);
        var name = entry.Detail(AuditDetails.Device);
        return codes.Length == 0 ? name : $"{codes} {name}";
    }
}
