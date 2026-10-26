namespace Opten.StudioFlow.Core.Contracts;

/// <summary>A source that scene items can show.</summary>
/// <param name="Id">Source reference: <c>{deviceId}/{slot}</c> or <c>{assetId}</c>.</param>
/// <param name="Code">Slot code shown everywhere: K1… cameras, S1… screens, M1… media.</param>
/// <param name="Kind">Camera, screen, image, video or text.</param>
/// <param name="Label">Display name, e.g. “Laptop Lea · Screen 1”; the first line of a text.</param>
/// <param name="DeviceId">Device for device slots.</param>
/// <param name="Slot">Slot name for device slots: <c>camera</c> or <c>screen-1</c>…<c>screen-9</c>. Equals the LiveKit track name.</param>
/// <param name="AssetId">Asset for media sources.</param>
/// <param name="Status">Health.</param>
/// <param name="StatusSince">Time of the last status change (timers in the Regie).</param>
/// <param name="Text">Content of a text source; null for every other kind.</param>
public sealed record SourceDto(
    string Id,
    string Code,
    SourceKind Kind,
    string Label,
    string? DeviceId,
    string? Slot,
    string? AssetId,
    SourceStatus Status,
    DateTimeOffset? StatusSince,
    TextSourceDto? Text);

/// <summary>
/// A device source of the production this one was copied from (duplicate or import). Devices belong to one production
/// and are paired anew, so the copy keeps the place of the source as a placeholder: scene items point to
/// <paramref name="SourceId"/>, which no device has, so they show “Source missing” until the placeholder is assigned to a
/// source (<c>PUT …/placeholders/{id}/assignment</c>), typically the new device that takes over the role, “Use as K1 ·
/// Stage phone”. A placeholder keeps its code, so no new source takes it.
/// </summary>
/// <param name="Id">Placeholder id, e.g. <c>plh_9x2k…</c>.</param>
/// <param name="SourceId">The source reference scene items use: <c>{deviceId}/{slot}</c> of a device that does not exist.</param>
/// <param name="Code">Slot code of the original source: K1… for cameras, S1… for screens.</param>
/// <param name="Kind">Camera or screen.</param>
/// <param name="Label">Name of the original source (“Stage phone”), or null when the copy did not know it.</param>
public sealed record SourcePlaceholderDto(string Id, string SourceId, string Code, SourceKind Kind, string? Label);

/// <summary>An incident in the message strip. Recovered incidents stay until someone acknowledges them (“Seen”).</summary>
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
