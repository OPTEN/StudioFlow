namespace Opten.FlowStudio.Core.Contracts;

/// <summary>
/// SignalR endpoints and method names. Hub paths: <see cref="StudioHubPath"/> (admin cookie),
/// <see cref="DeviceHubPath"/> (device bearer in <c>access_token</c>), <see cref="OutputHubPath"/> (output key in <c>access_token</c>).
/// Server-to-client method names are camelCase strings; the TypeScript clients use the same constants.
/// </summary>
public static class HubMethods
{
    /// <summary>Hub for the Regie.</summary>
    public const string StudioHubPath = "/hubs/studio";

    /// <summary>Hub for sender devices.</summary>
    public const string DeviceHubPath = "/hubs/device";

    /// <summary>Hub for the output page.</summary>
    public const string OutputHubPath = "/hubs/output";

    /// <summary>Server → studio/output: the client must resubscribe (e.g. the active production changed). Payload: production id.</summary>
    public const string Resync = "resync";

    /// <summary>Server → studio/output: one <see cref="ProductionEvent"/>.</summary>
    public const string Event = "event";

    /// <summary>Server → studio: <see cref="DeviceTelemetryMessage"/>.</summary>
    public const string Telemetry = "telemetry";

    /// <summary>Server → studio: number of connected Regie sessions (int).</summary>
    public const string Presence = "presence";

    /// <summary>Server → device: <see cref="TallyDto"/>.</summary>
    public const string Tally = "tally";

    /// <summary>Server → device: <see cref="DeviceCommandDto"/>.</summary>
    public const string Command = "command";

    /// <summary>Server → device: <see cref="DeviceSelfDto"/> after a change (rename, slots, block).</summary>
    public const string Self = "self";

    /// <summary>Server → device: the same device connected in another tab; this session stays off.</summary>
    public const string SessionReplaced = "sessionReplaced";

    /// <summary>Client → studio hub: <c>Task&lt;ProductionChangesDto&gt; Subscribe(string productionId, long? sinceRevision)</c>.</summary>
    public const string Subscribe = "Subscribe";

    /// <summary>Client → output hub: <c>Task&lt;OutputChangesDto&gt; SubscribeOutput(long? sinceRevision)</c>.</summary>
    public const string SubscribeOutput = "SubscribeOutput";

    /// <summary>Client → device hub: <c>Task&lt;DeviceSessionDto&gt; Hello(DeviceHelloDto)</c>.</summary>
    public const string Hello = "Hello";

    /// <summary>Client → device/output hub: periodic report.</summary>
    public const string Report = "Report";
}

/// <summary>Tally of a device: overall and per slot.</summary>
/// <param name="Overall">Highest tally over all slots.</param>
/// <param name="Slots">Tally per slot name.</param>
public sealed record TallyDto(TallyState Overall, IReadOnlyDictionary<string, TallyState> Slots);

/// <summary>Remote command for a device.</summary>
public sealed record DeviceCommandDto(string Id, DeviceCommandKind Kind, string? Slot, string? Text, DateTimeOffset At);

/// <summary>First message of a device after connecting to the device hub.</summary>
/// <param name="SessionId">Random id of this browser tab; a newer session replaces an older one.</param>
/// <param name="Platform">Platform text.</param>
/// <param name="AppVersion">Sender build version.</param>
public sealed record DeviceHelloDto(string SessionId, string Platform, string AppVersion);

/// <summary>Answer to <see cref="DeviceHelloDto"/>.</summary>
public sealed record DeviceSessionDto(DeviceSelfDto Device, TallyDto Tally);

/// <summary>Periodic report of a device (about every two seconds).</summary>
/// <param name="Rtc">Media connection state.</param>
/// <param name="Slots">State of each local slot.</param>
/// <param name="BatteryPct">Battery level where available.</param>
/// <param name="Charging">Charging state where available.</param>
/// <param name="Network">Network type where available.</param>
/// <param name="RttMs">Round trip time measured by the sender.</param>
/// <param name="TechCheck">Result of the last technical check, if any.</param>
public sealed record DeviceReportDto(
    RtcState Rtc,
    IReadOnlyList<SlotTelemetryDto> Slots,
    int? BatteryPct,
    bool? Charging,
    string? Network,
    int? RttMs,
    TechCheckDto? TechCheck);
