using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// The entries of "Recent events" derived from audit entries (spec 4.9): a stable <see cref="LogCode"/>, the values
/// the client puts into its own text, and an English fallback text such as "K2 reconnecting", "K2 is back, was gone
/// for 9 s" or "Scene “Break” is live". Entries without a log entry (logins, phone QR renewals) are not shown in the
/// Regie. Source outages follow spec 4.5: a slot stopped on purpose is "S1 sharing stopped" for a screen and
/// "K1 camera stopped" for a camera (the kind is stored with the entry); a camera paused by the operating system is
/// an outage that is expected back, "K1 reconnecting".
/// </summary>
public static class LogTexts
{
    /// <summary>Actions that can have a log entry (pre-filter for database queries).</summary>
    public static IReadOnlyCollection<string> Actions { get; } =
    [
        AuditActions.SceneLive, AuditActions.SceneCreated, AuditActions.SceneDeleted, AuditActions.BroadcastStarted,
        AuditActions.BroadcastEnded, AuditActions.DevicePaired, AuditActions.DeviceBlocked, AuditActions.DeviceUnblocked,
        AuditActions.DeviceRemoved, AuditActions.PairingDenied, AuditActions.InviteCreated, AuditActions.InviteRevoked,
        AuditActions.OutputKeyRegenerated, AuditActions.OutputAccessChanged, AuditActions.AssetUploaded, AuditActions.AssetDeleted,
        AuditActions.SourceReconnecting, AuditActions.SourceEnded, AuditActions.SourceLost, AuditActions.SourceRecovered,
    ];

    /// <summary>Parameter names of <see cref="LogEntryDto.Params"/>.</summary>
    private static class Param
    {
        public const string Scene = "scene";
        public const string Subject = "subject";
        public const string Name = "name";
        public const string Code = "code";
        public const string DownSeconds = "downSeconds";
    }

    /// <summary>The log entry of an audit entry (code, parameters, English text), or null when the entry is not shown.</summary>
    public static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text)? Describe(AuditEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        var invitesAreLinks = string.Equals(entry.Detail(AuditDetails.Kind), nameof(InviteKind.LaptopLink), StringComparison.Ordinal);
        var scene = entry.Detail(AuditDetails.Scene);
        var code = entry.Detail(AuditDetails.Code);
        var name = entry.Detail(AuditDetails.Name);
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
            AuditActions.OutputKeyRegenerated => With(LogCode.OutputLinkRegenerated, "Output link regenerated"),
            AuditActions.OutputAccessChanged => With(LogCode.OutputAccessChanged, "Output access changed"),
            AuditActions.AssetUploaded => With(LogCode.AssetUploaded, $"{code} “{name}” uploaded", (Param.Code, code), (Param.Name, name)),
            AuditActions.AssetDeleted => With(LogCode.AssetDeleted, $"{code} “{name}” deleted", (Param.Code, code), (Param.Name, name)),
            AuditActions.SourceReconnecting => With(LogCode.SourceReconnecting, $"{code} reconnecting", (Param.Code, code)),
            AuditActions.SourceEnded when string.Equals(entry.Detail(AuditDetails.Kind), nameof(SourceKind.Camera), StringComparison.Ordinal) => With(LogCode.CameraEnded, $"{code} camera stopped", (Param.Code, code)),
            AuditActions.SourceEnded => With(LogCode.ScreenEnded, $"{code} sharing stopped", (Param.Code, code)),
            AuditActions.SourceLost => With(LogCode.SourceLost, $"{code} no picture", (Param.Code, code)),
            AuditActions.SourceRecovered => Recovered(entry, code),
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
