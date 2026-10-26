namespace Opten.StudioFlow.Core.Contracts;

/// <summary>Production (OBS: scene collection): one event with its own devices, scenes and output.</summary>
/// <param name="Id">Production id, e.g. <c>prd_9x2k…</c>.</param>
/// <param name="TenantId">Tenant id; only <c>opten</c> for now (multi-tenancy is prepared, not active).</param>
/// <param name="Name">Display name shown in the header.</param>
/// <param name="Slug">URL slug of the output page (<c>/o/{slug}</c>).</param>
/// <param name="IsActive">The active production is the one /join pairs into.</param>
/// <param name="Broadcast">Broadcast state.</param>
/// <param name="LiveSince">Start of the current broadcast (LIVE runtime in the header).</param>
/// <param name="EndedAt">End of the last broadcast.</param>
/// <param name="ProgramSceneId">Scene on air. Null only when the production has no scenes.</param>
/// <param name="PreviewSceneId">Scene in the preview (Studio-Modus). Null when no operator uses Studio-Modus.</param>
/// <param name="LastTransition">Transition of the last program switch.</param>
/// <param name="LastSwitchAt">Server time of the last program switch.</param>
/// <param name="StandbySlate">Slate before the start.</param>
/// <param name="EndSlate">Slate after the end.</param>
/// <param name="TextTheme">Colours of all texts and lower thirds.</param>
/// <param name="Canvas">Format and resolution of the output canvas; every scene item is placed in its pixels.</param>
public sealed record ProductionDto(
    string Id,
    string TenantId,
    string Name,
    string Slug,
    bool IsActive,
    BroadcastState Broadcast,
    DateTimeOffset? LiveSince,
    DateTimeOffset? EndedAt,
    string? ProgramSceneId,
    string? PreviewSceneId,
    TransitionDto? LastTransition,
    DateTimeOffset? LastSwitchAt,
    SlateDto StandbySlate,
    SlateDto EndSlate,
    TextThemeDto TextTheme,
    CanvasDto Canvas);

/// <summary>
/// The output canvas of a production: the coordinate system of all scene items and the shape of the output page, the
/// monitors and the thumbnails. One canvas per production.
/// </summary>
/// <param name="Format">Aspect ratio.</param>
/// <param name="Resolution">Target resolution (short side).</param>
/// <param name="Width">Width in canvas pixels, derived from format and resolution.</param>
/// <param name="Height">Height in canvas pixels, derived from format and resolution.</param>
public sealed record CanvasDto(CanvasFormat Format, CanvasResolution Resolution, int Width, int Height);

/// <summary>Short production entry for lists.</summary>
public sealed record ProductionSummaryDto(string Id, string Name, string Slug, bool IsActive, DateTimeOffset CreatedAt);

/// <summary>A full-screen slate on the output.</summary>
/// <param name="Title">Main line, e.g. "Starting soon".</param>
/// <param name="Subtitle">Optional second line.</param>
/// <param name="BackgroundAssetId">Optional image asset behind the text.</param>
public sealed record SlateDto(string Title, string? Subtitle, string? BackgroundAssetId);

/// <summary>Transition used for a program switch.</summary>
/// <param name="Kind">Cut or fade.</param>
/// <param name="DurationMs">Fade duration; one of 200, 300, 500, 800, 1000, 1500, 2000. Ignored (0) for a cut.</param>
public sealed record TransitionDto(TransitionKind Kind, int DurationMs);

/// <summary>An entry of "Recent events", derived from the audit log.</summary>
/// <param name="At">Time of the event.</param>
/// <param name="Code">What happened. Clients show their own text for the code, in the language of the user.</param>
/// <param name="Params">Values for the text of the code (scene, device or slot names), keyed in camelCase; the keys per code are listed at the codes.</param>
/// <param name="Text">English text for clients that do not know the code; the same words as the English client text.</param>
public sealed record LogEntryDto(DateTimeOffset At, LogCode Code, IReadOnlyDictionary<string, string> Params, string Text);

/// <summary>Complete production state for the Regie. Sent on subscribe and after a resync.</summary>
/// <param name="Revision">Monotonic revision; every <see cref="ProductionEvent"/> carries the next one.</param>
/// <param name="ServerTime">Server clock, used to correct client timers.</param>
/// <param name="Production">Production settings and switching state.</param>
/// <param name="Scenes">Scenes ordered by <see cref="SceneDto.SortOrder"/>.</param>
/// <param name="Sources">All sources with health.</param>
/// <param name="Placeholders">Device sources of the production this one was copied from, not assigned yet.</param>
/// <param name="Devices">All paired devices.</param>
/// <param name="Assets">Uploaded media.</param>
/// <param name="PairingRequests">Pending /join requests.</param>
/// <param name="Invites">Valid one-time invites (QR and links).</param>
/// <param name="Incidents">Open and recovered, not yet acknowledged incidents.</param>
/// <param name="OutputStatus">State of the output consumer.</param>
/// <param name="RecentLog">Recent events, newest first.</param>
/// <param name="OperatorsOnline">Number of connected Regie sessions.</param>
public sealed record ProductionSnapshot(
    long Revision,
    DateTimeOffset ServerTime,
    ProductionDto Production,
    IReadOnlyList<SceneDto> Scenes,
    IReadOnlyList<SourceDto> Sources,
    IReadOnlyList<SourcePlaceholderDto> Placeholders,
    IReadOnlyList<DeviceDto> Devices,
    IReadOnlyList<AssetDto> Assets,
    IReadOnlyList<PairingRequestDto> PairingRequests,
    IReadOnlyList<InviteDto> Invites,
    IReadOnlyList<IncidentDto> Incidents,
    OutputStatusDto OutputStatus,
    IReadOnlyList<LogEntryDto> RecentLog,
    int OperatorsOnline);

/// <summary>Request to create a production.</summary>
/// <param name="Name">Display name.</param>
/// <param name="Format">Output format; null means 16:9.</param>
/// <param name="Resolution">Target resolution; null means 1080p.</param>
public sealed record CreateProductionRequest(string Name, CanvasFormat? Format = null, CanvasResolution? Resolution = null);

/// <summary>
/// Sets format and resolution of the output canvas. The same format with another resolution scales every scene item
/// proportionally; another format fits the items into the new canvas (scaled uniformly, centred) and lets the Auto-Grid
/// arrange itself for the new shape. Not possible while the broadcast is live (409 <c>broadcast_live</c>).
/// </summary>
/// <param name="Format">New aspect ratio; required.</param>
/// <param name="Resolution">New target resolution; required.</param>
public sealed record ChangeCanvasRequest(CanvasFormat? Format, CanvasResolution? Resolution);

/// <summary>Partial update of a production. Null fields stay unchanged.</summary>
public sealed record UpdateProductionRequest(string? Name, SlateDto? StandbySlate, SlateDto? EndSlate, TextThemeDto? TextTheme = null);

/// <summary>Request for a direct program switch (Studio-Modus off).</summary>
/// <param name="SceneId">Scene to put on air.</param>
/// <param name="Transition">Cut or fade.</param>
public sealed record SwitchProgramRequest(string SceneId, TransitionDto Transition);

/// <summary>Request for a take (Studio-Modus): the preview goes on air and the old program moves to the preview.</summary>
public sealed record TakeRequest(TransitionDto Transition);

/// <summary>Sets or clears the preview scene.</summary>
public sealed record SetPreviewRequest(string? SceneId);
