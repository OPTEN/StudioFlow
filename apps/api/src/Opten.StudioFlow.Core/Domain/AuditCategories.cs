using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>The category of every action of the audit log (the filter of the log view). Every action has exactly one.</summary>
public static class AuditCategories
{
    private static readonly IReadOnlyDictionary<string, AuditCategory> Map = new Dictionary<string, AuditCategory>(StringComparer.Ordinal)
    {
        [AuditActions.ProductionCreated] = AuditCategory.Production,
        [AuditActions.ProductionRenamed] = AuditCategory.Production,
        [AuditActions.ProductionActivated] = AuditCategory.Production,
        [AuditActions.BroadcastStarted] = AuditCategory.Production,
        [AuditActions.BroadcastEnded] = AuditCategory.Production,
        [AuditActions.BroadcastReset] = AuditCategory.Production,
        [AuditActions.SlateChanged] = AuditCategory.Production,
        [AuditActions.SceneLive] = AuditCategory.Production,
        [AuditActions.SceneCreated] = AuditCategory.Production,
        [AuditActions.SceneDeleted] = AuditCategory.Production,
        [AuditActions.DevicePaired] = AuditCategory.Devices,
        [AuditActions.DeviceRenamed] = AuditCategory.Devices,
        [AuditActions.CameraLensSwitched] = AuditCategory.Devices,
        [AuditActions.DeviceBlocked] = AuditCategory.Devices,
        [AuditActions.DeviceUnblocked] = AuditCategory.Devices,
        [AuditActions.DeviceRemoved] = AuditCategory.Devices,
        [AuditActions.PairingDenied] = AuditCategory.Devices,
        [AuditActions.InviteCreated] = AuditCategory.Devices,
        [AuditActions.InviteRevoked] = AuditCategory.Devices,
        [AuditActions.IncidentAcknowledged] = AuditCategory.Devices,
        [AuditActions.SourceReconnecting] = AuditCategory.Devices,
        [AuditActions.SourceEnded] = AuditCategory.Devices,
        [AuditActions.SourceLost] = AuditCategory.Devices,
        [AuditActions.SourceRecovered] = AuditCategory.Devices,
        [AuditActions.LoginSucceeded] = AuditCategory.Security,
        [AuditActions.LoginFailed] = AuditCategory.Security,
        [AuditActions.LoginLocked] = AuditCategory.Security,
        [AuditActions.Logout] = AuditCategory.Security,
        [AuditActions.AccountSetUp] = AuditCategory.Security,
        [AuditActions.PasswordChanged] = AuditCategory.Security,
        [AuditActions.AccountReset] = AuditCategory.Security,
        [AuditActions.AuditExported] = AuditCategory.Security,
        [AuditActions.AssetUploaded] = AuditCategory.Media,
        [AuditActions.AssetDeleted] = AuditCategory.Media,
        [AuditActions.OutputKeyRegenerated] = AuditCategory.Output,
        [AuditActions.OutputAccessChanged] = AuditCategory.Output,
        [AuditActions.AuditRetention] = AuditCategory.System,
    };

    /// <summary>Every action the audit log knows.</summary>
    public static IReadOnlyCollection<string> Actions => Map.Keys.ToArray();

    /// <summary>True when <paramref name="action"/> is an action of this version.</summary>
    public static bool IsKnown(string action) => Map.ContainsKey(action);

    /// <summary>The category of an action; entries of an unknown action (written by a newer version) count as system.</summary>
    public static AuditCategory Of(string action) => Map.GetValueOrDefault(action, AuditCategory.System);

    /// <summary>The actions of the given categories.</summary>
    public static IReadOnlyList<string> ActionsOf(IReadOnlyCollection<AuditCategory> categories) =>
        [.. Map.Where(entry => categories.Contains(entry.Value)).Select(entry => entry.Key)];
}
