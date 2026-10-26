using System.Globalization;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>Actions of the audit log (spec 4.9) plus the source status changes that feed "Recent events" (spec 4.5).</summary>
public static class AuditActions
{
    /// <summary>Admin signed in.</summary>
    public const string LoginSucceeded = "login.succeeded";

    /// <summary>Wrong credentials.</summary>
    public const string LoginFailed = "login.failed";

    /// <summary>Lockout started.</summary>
    public const string LoginLocked = "login.locked";

    /// <summary>The Regie account was set up in the first-run setup.</summary>
    public const string AccountSetUp = "account.setup";

    /// <summary>The password of the Regie account was changed.</summary>
    public const string PasswordChanged = "account.password.changed";

    /// <summary>The Regie account was reset with <c>reset-admin</c>.</summary>
    public const string AccountReset = "account.reset";

    /// <summary>A scene went on air.</summary>
    public const string SceneLive = "scene.live";

    /// <summary>Broadcast started.</summary>
    public const string BroadcastStarted = "broadcast.started";

    /// <summary>Broadcast ended.</summary>
    public const string BroadcastEnded = "broadcast.ended";

    /// <summary>A device was paired.</summary>
    public const string DevicePaired = "device.paired";

    /// <summary>A device was blocked.</summary>
    public const string DeviceBlocked = "device.blocked";

    /// <summary>A device was unblocked.</summary>
    public const string DeviceUnblocked = "device.unblocked";

    /// <summary>A device was removed.</summary>
    public const string DeviceRemoved = "device.removed";

    /// <summary>A knock was denied.</summary>
    public const string PairingDenied = "pairing.denied";

    /// <summary>An invite was created.</summary>
    public const string InviteCreated = "invite.created";

    /// <summary>An invite was revoked.</summary>
    public const string InviteRevoked = "invite.revoked";

    /// <summary>The output key was regenerated.</summary>
    public const string OutputKeyRegenerated = "output.key.regenerated";

    /// <summary>The output IP restriction changed.</summary>
    public const string OutputAccessChanged = "output.access.changed";

    /// <summary>An asset was uploaded.</summary>
    public const string AssetUploaded = "asset.uploaded";

    /// <summary>An asset was deleted.</summary>
    public const string AssetDeleted = "asset.deleted";

    /// <summary>A text was created.</summary>
    public const string TextCreated = "text.created";

    /// <summary>A text was deleted.</summary>
    public const string TextDeleted = "text.deleted";

    /// <summary>A text was shown on the program scene.</summary>
    public const string TextShown = "text.shown";

    /// <summary>A text was hidden on the program scene.</summary>
    public const string TextHidden = "text.hidden";

    /// <summary>A scene was created.</summary>
    public const string SceneCreated = "scene.created";

    /// <summary>A scene was deleted.</summary>
    public const string SceneDeleted = "scene.deleted";

    /// <summary>A live source is reconnecting.</summary>
    public const string SourceReconnecting = "source.reconnecting";

    /// <summary>The sender ended a live source.</summary>
    public const string SourceEnded = "source.ended";

    /// <summary>A live camera failed.</summary>
    public const string SourceLost = "source.lost";

    /// <summary>A source is back after an outage.</summary>
    public const string SourceRecovered = "source.recovered";
}

/// <summary>Actors of audit entries.</summary>
public static class AuditActors
{
    /// <summary>The admin (Regie).</summary>
    public const string Admin = "admin";

    /// <summary>The server itself.</summary>
    public const string System = "system";

    /// <summary>A device acting on itself.</summary>
    public static string Device(string deviceId) => $"device:{deviceId}";
}

/// <summary>Keys of <see cref="AuditEntry.Details"/>.</summary>
public static class AuditDetails
{
    /// <summary>Scene name.</summary>
    public const string Scene = "scene";

    /// <summary>Device name.</summary>
    public const string Device = "device";

    /// <summary>Slot codes (comma separated).</summary>
    public const string Codes = "codes";

    /// <summary>A single slot code.</summary>
    public const string Code = "code";

    /// <summary>A name (asset, knock).</summary>
    public const string Name = "name";

    /// <summary>Kind (invite kind, source kind).</summary>
    public const string Kind = "kind";

    /// <summary>Outage duration in seconds.</summary>
    public const string DownSeconds = "downSeconds";

    /// <summary>User name of a login attempt.</summary>
    public const string Username = "username";

    /// <summary>Client IP address.</summary>
    public const string Ip = "ip";

    /// <summary>Number of entries (IP rules).</summary>
    public const string Count = "count";
}

/// <summary>An entry of the audit log (table <c>audit_entries</c>).</summary>
public sealed class AuditEntry
{
    private AuditEntry()
    {
    }

    /// <summary>Database id (ascending).</summary>
    public long Id { get; private set; }

    /// <summary>Production, null for global actions such as logins.</summary>
    public string? ProductionId { get; private set; }

    /// <summary>Time of the action.</summary>
    public DateTimeOffset At { get; private set; }

    /// <summary><c>admin</c>, <c>device:{id}</c> or <c>system</c>.</summary>
    public string Actor { get; private set; } = string.Empty;

    /// <summary>Action, see <see cref="AuditActions"/>.</summary>
    public string Action { get; private set; } = string.Empty;

    /// <summary>Parameters of the action (never secrets).</summary>
    public IReadOnlyDictionary<string, string> Details { get; private set; } = new Dictionary<string, string>(StringComparer.Ordinal);

    /// <summary>Creates an entry.</summary>
    public static AuditEntry Create(string? productionId, DateTimeOffset at, string actor, string action, IReadOnlyDictionary<string, string>? details = null) => new()
    {
        ProductionId = productionId,
        At = at,
        Actor = actor,
        Action = action,
        Details = details ?? new Dictionary<string, string>(StringComparer.Ordinal),
    };

    /// <summary>Detail value or an empty string.</summary>
    public string Detail(string key) => Details.TryGetValue(key, out var value) ? value : string.Empty;

    /// <summary>Outage duration in whole seconds for recovery entries, at least 1; 1 when the value is missing.</summary>
    internal static int DowntimeSeconds(string secondsText) =>
        int.TryParse(secondsText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) ? Math.Max(1, s) : 1;

    /// <summary>Outage duration text for recovery entries: "9 s" below a minute, "3 min" above.</summary>
    internal static string FormatDowntime(string secondsText)
    {
        var seconds = DowntimeSeconds(secondsText);
        return seconds < 60
            ? $"{seconds.ToString(CultureInfo.InvariantCulture)} s"
            : $"{Math.Round(seconds / 60d).ToString(CultureInfo.InvariantCulture)} min";
    }
}
