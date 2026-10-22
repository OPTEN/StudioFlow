namespace Opten.FlowStudio.Core.Contracts;

/// <summary>A source that scene items can show.</summary>
/// <param name="Id">Source reference: <c>{deviceId}/{slot}</c> or <c>{assetId}</c>.</param>
/// <param name="Code">Slot code shown everywhere: K1… cameras, S1… screens, M1… media.</param>
/// <param name="Kind">Camera, screen, image or video.</param>
/// <param name="Label">Display name, e.g. «Laptop Lea · Screen 1».</param>
/// <param name="DeviceId">Device for device slots.</param>
/// <param name="Slot">Slot name for device slots: <c>camera</c> or <c>screen-1</c>…<c>screen-9</c>. Equals the LiveKit track name.</param>
/// <param name="AssetId">Asset for media sources.</param>
/// <param name="Status">Health.</param>
/// <param name="StatusSince">Time of the last status change (timers in the Regie).</param>
public sealed record SourceDto(
    string Id,
    string Code,
    SourceKind Kind,
    string Label,
    string? DeviceId,
    string? Slot,
    string? AssetId,
    SourceStatus Status,
    DateTimeOffset? StatusSince);

/// <summary>An incident in the message strip. Recovered incidents stay until someone acknowledges them («Gesehen»).</summary>
/// <param name="Id">Incident id.</param>
/// <param name="SourceId">Affected source.</param>
/// <param name="Code">Slot code of the source.</param>
/// <param name="Kind">Reconnecting, ended or lost.</param>
/// <param name="StartedAt">Start of the outage.</param>
/// <param name="EndedAt">Recovery time; null while the outage lasts.</param>
public sealed record IncidentDto(
    string Id,
    string SourceId,
    string Code,
    IncidentKind Kind,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt);
