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
    SlateDto EndSlate);

/// <summary>Short production entry for lists.</summary>
public sealed record ProductionSummaryDto(string Id, string Name, string Slug, bool IsActive, DateTimeOffset CreatedAt);

/// <summary>A full-screen slate on the output.</summary>
/// <param name="Title">Main line, e.g. «Gleich geht's los».</param>
/// <param name="Subtitle">Optional second line.</param>
/// <param name="BackgroundAssetId">Optional image asset behind the text.</param>
public sealed record SlateDto(string Title, string? Subtitle, string? BackgroundAssetId);

/// <summary>Transition used for a program switch.</summary>
/// <param name="Kind">Cut or fade.</param>
/// <param name="DurationMs">Fade duration; one of 200, 300, 500, 800, 1000, 1500, 2000. Ignored (0) for a cut.</param>
public sealed record TransitionDto(TransitionKind Kind, int DurationMs);

/// <summary>A human-readable entry for «Letzte Ereignisse» (backed by the audit log).</summary>
public sealed record LogEntryDto(DateTimeOffset At, string Text);

/// <summary>Complete production state for the Regie. Sent on subscribe and after a resync.</summary>
/// <param name="Revision">Monotonic revision; every <see cref="ProductionEvent"/> carries the next one.</param>
/// <param name="ServerTime">Server clock, used to correct client timers.</param>
/// <param name="Production">Production settings and switching state.</param>
/// <param name="Scenes">Scenes ordered by <see cref="SceneDto.SortOrder"/>.</param>
/// <param name="Sources">All sources with health.</param>
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
    IReadOnlyList<DeviceDto> Devices,
    IReadOnlyList<AssetDto> Assets,
    IReadOnlyList<PairingRequestDto> PairingRequests,
    IReadOnlyList<InviteDto> Invites,
    IReadOnlyList<IncidentDto> Incidents,
    OutputStatusDto OutputStatus,
    IReadOnlyList<LogEntryDto> RecentLog,
    int OperatorsOnline);

/// <summary>Request to create a production.</summary>
public sealed record CreateProductionRequest(string Name);

/// <summary>Partial update of a production. Null fields stay unchanged.</summary>
public sealed record UpdateProductionRequest(string? Name, SlateDto? StandbySlate, SlateDto? EndSlate);

/// <summary>Request for a direct program switch (Studio-Modus off).</summary>
/// <param name="SceneId">Scene to put on air.</param>
/// <param name="Transition">Cut or fade.</param>
public sealed record SwitchProgramRequest(string SceneId, TransitionDto Transition);

/// <summary>Request for a take (Studio-Modus): the preview goes on air and the old program moves to the preview.</summary>
public sealed record TakeRequest(TransitionDto Transition);

/// <summary>Sets or clears the preview scene.</summary>
public sealed record SetPreviewRequest(string? SceneId);
