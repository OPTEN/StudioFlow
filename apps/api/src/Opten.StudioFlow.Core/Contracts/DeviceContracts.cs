namespace Opten.StudioFlow.Core.Contracts;

/// <summary>A paired device (station) as shown in the Regie.</summary>
/// <param name="Id">Device id, e.g. <c>dev_…</c>; equals the LiveKit participant identity.</param>
/// <param name="Name">Display name, editable in the Regie.</param>
/// <param name="Kind">Phone or laptop.</param>
/// <param name="Platform">Short platform text reported by the sender, e.g. «iPhone · Safari».</param>
/// <param name="State">Active or blocked.</param>
/// <param name="PairedAt">Pairing time.</param>
/// <param name="LastSeenAt">Last control connection or report.</param>
/// <param name="PairingMethod">QR, code or link.</param>
/// <param name="Connection">Live connection state.</param>
/// <param name="ConnectionSince">Time of the last connection change.</param>
/// <param name="TechCheck">Last technical check result.</param>
/// <param name="Telemetry">Last telemetry (also streamed separately).</param>
public sealed record DeviceDto(
    string Id,
    string Name,
    DeviceKind Kind,
    string Platform,
    DeviceState State,
    DateTimeOffset PairedAt,
    DateTimeOffset? LastSeenAt,
    PairingMethod PairingMethod,
    DeviceConnection Connection,
    DateTimeOffset? ConnectionSince,
    TechCheckDto? TechCheck,
    DeviceTelemetryDto? Telemetry);

/// <summary>Telemetry of a device, reported about every two seconds.</summary>
/// <param name="At">Server receive time.</param>
/// <param name="Rtc">Media connection state.</param>
/// <param name="BatteryPct">Battery level 0–100 where the browser exposes it.</param>
/// <param name="Charging">Charging state where available.</param>
/// <param name="Network">Network type, e.g. «wifi» or «4g», where available.</param>
/// <param name="RttMs">Round trip time to the server.</param>
/// <param name="Slots">Per slot telemetry.</param>
public sealed record DeviceTelemetryDto(
    DateTimeOffset At,
    RtcState Rtc,
    int? BatteryPct,
    bool? Charging,
    string? Network,
    int? RttMs,
    IReadOnlyList<SlotTelemetryDto> Slots);

/// <summary>Telemetry of one slot (camera or screen) of a device.</summary>
public sealed record SlotTelemetryDto(
    string Slot,
    SlotState State,
    int? Width,
    int? Height,
    double? Fps,
    int? BitrateKbps,
    double? PacketLossPct,
    string? Codec);

/// <summary>Result of the technical check on the sender (camera, network, bandwidth).</summary>
public sealed record TechCheckDto(
    TechCheckLevel Overall,
    TechCheckLevel Camera,
    TechCheckLevel Network,
    TechCheckLevel Bandwidth,
    int? UploadKbps,
    int? RttMs,
    DateTimeOffset At,
    string? Note);

/// <summary>Telemetry push to the Regie; not revisioned.</summary>
public sealed record DeviceTelemetryMessage(string DeviceId, DeviceTelemetryDto Telemetry);

/// <summary>Renames a device.</summary>
public sealed record RenameDeviceRequest(string Name);

/// <summary>Sends a remote command to a device.</summary>
/// <param name="Kind">Command kind.</param>
/// <param name="Slot">Target slot for <see cref="DeviceCommandKind.Reshare"/>.</param>
/// <param name="Text">Text for <see cref="DeviceCommandKind.Message"/>, 1–140 characters.</param>
public sealed record DeviceCommandRequest(DeviceCommandKind Kind, string? Slot, string? Text);

/// <summary>What a device learns about itself (sender app).</summary>
public sealed record DeviceSelfDto(
    string Id,
    string Name,
    DeviceKind Kind,
    DeviceState State,
    string ProductionId,
    string ProductionName,
    IReadOnlyList<DeviceSlotDto> Slots);

/// <summary>A slot that belongs to a device, with its slot code.</summary>
/// <param name="Slot">Slot name (= LiveKit track name).</param>
/// <param name="Code">Slot code, e.g. S3.</param>
/// <param name="Kind">Camera or screen.</param>
public sealed record DeviceSlotDto(string Slot, string Code, SourceKind Kind);

/// <summary>Allocates a new slot on the device (another screen, or the optional laptop camera).</summary>
/// <remarks>
/// Contract of <c>POST /api/device/slots</c> (spec 4.4): <see cref="SourceKind.Screen"/> returns the lowest free screen
/// slot of the device – <c>screen-1</c> … <c>screen-9</c>, a released number is handed out again – so the sender can
/// open the share dialog for that slot in the click, before the response arrives; parallel requests are serialized and
/// get distinct slots. <see cref="SourceKind.Camera"/> returns <c>camera</c> (laptops, once). The slot code is the
/// lowest free S or K number in the production. No slot of the kind left → 409 <c>limit_reached</c>; a kind the device
/// cannot have (a screen on a phone, media) → 400 <c>validation_failed</c>.
/// </remarks>
public sealed record AllocateSlotRequest(SourceKind Kind);
