using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>
/// German texts of «Letzte Ereignisse» derived from audit entries (spec 4.9), e.g. «K2 verbindet neu»,
/// «K2 wieder da, war 9 s weg», «Szene «Pause» ist live». Entries without a text (logins, phone QR renewals) are not
/// shown in the Regie.
/// </summary>
public static class LogTexts
{
    /// <summary>Actions that can have a log text (pre-filter for database queries).</summary>
    public static IReadOnlyCollection<string> Actions { get; } =
    [
        AuditActions.SceneLive, AuditActions.SceneCreated, AuditActions.SceneDeleted, AuditActions.BroadcastStarted,
        AuditActions.BroadcastEnded, AuditActions.DevicePaired, AuditActions.DeviceBlocked, AuditActions.DeviceUnblocked,
        AuditActions.DeviceRemoved, AuditActions.PairingDenied, AuditActions.InviteCreated, AuditActions.InviteRevoked,
        AuditActions.OutputKeyRegenerated, AuditActions.OutputAccessChanged, AuditActions.AssetUploaded, AuditActions.AssetDeleted,
        AuditActions.SourceReconnecting, AuditActions.SourceEnded, AuditActions.SourceLost, AuditActions.SourceRecovered,
    ];

    /// <summary>The log text of an entry, or null when the entry is not shown.</summary>
    public static string? For(AuditEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        var invitesAreLinks = string.Equals(entry.Detail(AuditDetails.Kind), nameof(InviteKind.LaptopLink), StringComparison.Ordinal);
        return entry.Action switch
        {
            AuditActions.SceneLive => $"Szene «{entry.Detail(AuditDetails.Scene)}» ist live",
            AuditActions.SceneCreated => $"Szene «{entry.Detail(AuditDetails.Scene)}» erstellt",
            AuditActions.SceneDeleted => $"Szene «{entry.Detail(AuditDetails.Scene)}» gelöscht",
            AuditActions.BroadcastStarted => "Sendung gestartet",
            AuditActions.BroadcastEnded => "Sendung beendet",
            AuditActions.DevicePaired => $"{DeviceText(entry)} gekoppelt",
            AuditActions.DeviceBlocked => $"{DeviceText(entry)} gesperrt",
            AuditActions.DeviceUnblocked => $"{DeviceText(entry)} entsperrt",
            AuditActions.DeviceRemoved => $"{DeviceText(entry)} entfernt",
            AuditActions.PairingDenied => $"Anfrage von {entry.Detail(AuditDetails.Name)} abgelehnt",
            AuditActions.InviteCreated when invitesAreLinks => "Einladungslink erstellt",
            AuditActions.InviteRevoked when invitesAreLinks => "Einladungslink widerrufen",
            AuditActions.OutputKeyRegenerated => "Output-Link neu erzeugt",
            AuditActions.OutputAccessChanged => "Output-Zugriff geändert",
            AuditActions.AssetUploaded => $"{entry.Detail(AuditDetails.Code)} «{entry.Detail(AuditDetails.Name)}» hochgeladen",
            AuditActions.AssetDeleted => $"{entry.Detail(AuditDetails.Code)} «{entry.Detail(AuditDetails.Name)}» gelöscht",
            AuditActions.SourceReconnecting => $"{entry.Detail(AuditDetails.Code)} verbindet neu",
            AuditActions.SourceEnded when string.Equals(entry.Detail(AuditDetails.Kind), nameof(SourceKind.Camera), StringComparison.Ordinal) => $"{entry.Detail(AuditDetails.Code)} Kamera beendet",
            AuditActions.SourceEnded => $"{entry.Detail(AuditDetails.Code)} Teilen beendet",
            AuditActions.SourceLost => $"{entry.Detail(AuditDetails.Code)} kein Bild",
            AuditActions.SourceRecovered => $"{entry.Detail(AuditDetails.Code)} wieder da, war {AuditEntry.FormatDowntime(entry.Detail(AuditDetails.DownSeconds))} weg",
            _ => null,
        };
    }

    /// <summary>«S1, S2 Laptop Mia», or the name alone when the device has no slots.</summary>
    private static string DeviceText(AuditEntry entry)
    {
        var codes = entry.Detail(AuditDetails.Codes);
        var name = entry.Detail(AuditDetails.Device);
        return codes.Length == 0 ? name : $"{codes} {name}";
    }
}
