using System.Text.Json.Serialization;

namespace Opten.StudioFlow.Core.Contracts;

/// <summary>
/// A revisioned change of the production state, pushed over SignalR (method <see cref="HubMethods.Event"/>).
/// Clients apply an event only when its revision is exactly one above their own; a larger gap triggers a resync
/// (new snapshot), a smaller revision is ignored.
/// </summary>
/// <param name="Revision">Revision after this change.</param>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(ProductionChangedEvent), "productionChanged")]
[JsonDerivedType(typeof(ProductionCanvasChangedEvent), "productionCanvasChanged")]
[JsonDerivedType(typeof(ProgramSwitchedEvent), "programSwitched")]
[JsonDerivedType(typeof(SceneUpsertedEvent), "sceneUpserted")]
[JsonDerivedType(typeof(SceneRemovedEvent), "sceneRemoved")]
[JsonDerivedType(typeof(ScenesReorderedEvent), "scenesReordered")]
[JsonDerivedType(typeof(SourceUpsertedEvent), "sourceUpserted")]
[JsonDerivedType(typeof(SourceRemovedEvent), "sourceRemoved")]
[JsonDerivedType(typeof(PlaceholderRemovedEvent), "placeholderRemoved")]
[JsonDerivedType(typeof(DeviceUpsertedEvent), "deviceUpserted")]
[JsonDerivedType(typeof(DeviceRemovedEvent), "deviceRemoved")]
[JsonDerivedType(typeof(AssetUpsertedEvent), "assetUpserted")]
[JsonDerivedType(typeof(AssetRemovedEvent), "assetRemoved")]
[JsonDerivedType(typeof(PairingRequestUpsertedEvent), "pairingRequestUpserted")]
[JsonDerivedType(typeof(PairingRequestRemovedEvent), "pairingRequestRemoved")]
[JsonDerivedType(typeof(InviteUpsertedEvent), "inviteUpserted")]
[JsonDerivedType(typeof(InviteRemovedEvent), "inviteRemoved")]
[JsonDerivedType(typeof(IncidentUpsertedEvent), "incidentUpserted")]
[JsonDerivedType(typeof(IncidentRemovedEvent), "incidentRemoved")]
[JsonDerivedType(typeof(OutputStatusChangedEvent), "outputStatusChanged")]
[JsonDerivedType(typeof(LogAppendedEvent), "logAppended")]
[JsonDerivedType(typeof(RevisionOnlyEvent), "revisionOnly")]
public abstract record ProductionEvent(long Revision);

/// <summary>Production settings or broadcast state changed (not a program switch).</summary>
public sealed record ProductionChangedEvent(long Revision, ProductionDto Production) : ProductionEvent(Revision);

/// <summary>
/// The output canvas changed. Production and the rescaled scenes arrive in one revision, so no client ever shows the new
/// canvas with the geometry of the old one.
/// </summary>
/// <param name="Revision">Revision after this change.</param>
/// <param name="Production">The production with its new canvas.</param>
/// <param name="Scenes">The scenes whose items were rescaled (scenes without items are unchanged and not listed).</param>
public sealed record ProductionCanvasChangedEvent(long Revision, ProductionDto Production, IReadOnlyList<SceneDto> Scenes) : ProductionEvent(Revision);

/// <summary>Program and/or preview changed. Renderers play <see cref="Transition"/> when the program changed.</summary>
/// <param name="Revision">Revision after this change.</param>
/// <param name="ProgramSceneId">New program scene.</param>
/// <param name="PreviewSceneId">New preview scene.</param>
/// <param name="PreviousProgramSceneId">Program scene before the switch (fade source).</param>
/// <param name="Transition">Transition to play; a cut when only the preview changed.</param>
/// <param name="At">Server time of the switch.</param>
public sealed record ProgramSwitchedEvent(
    long Revision,
    string? ProgramSceneId,
    string? PreviewSceneId,
    string? PreviousProgramSceneId,
    TransitionDto Transition,
    DateTimeOffset At) : ProductionEvent(Revision);

/// <summary>A scene was created or changed.</summary>
public sealed record SceneUpsertedEvent(long Revision, SceneDto Scene) : ProductionEvent(Revision);

/// <summary>A scene was deleted.</summary>
public sealed record SceneRemovedEvent(long Revision, string SceneId) : ProductionEvent(Revision);

/// <summary>The scene order changed; <see cref="SceneIds"/> lists every scene in the new order.</summary>
public sealed record ScenesReorderedEvent(long Revision, IReadOnlyList<string> SceneIds) : ProductionEvent(Revision);

/// <summary>A source was created or its health or label changed.</summary>
public sealed record SourceUpsertedEvent(long Revision, SourceDto Source) : ProductionEvent(Revision);

/// <summary>A source was removed (slot released, device or asset deleted).</summary>
public sealed record SourceRemovedEvent(long Revision, string SourceId) : ProductionEvent(Revision);

/// <summary>A placeholder was assigned to a source or removed. The scenes that changed arrive as <c>sceneUpserted</c> before it.</summary>
public sealed record PlaceholderRemovedEvent(long Revision, string PlaceholderId) : ProductionEvent(Revision);

/// <summary>A device was paired or changed (name, state, connection, tech check).</summary>
public sealed record DeviceUpsertedEvent(long Revision, DeviceDto Device) : ProductionEvent(Revision);

/// <summary>A device was deleted.</summary>
public sealed record DeviceRemovedEvent(long Revision, string DeviceId) : ProductionEvent(Revision);

/// <summary>An asset was uploaded or renamed.</summary>
public sealed record AssetUpsertedEvent(long Revision, AssetDto Asset) : ProductionEvent(Revision);

/// <summary>An asset was deleted.</summary>
public sealed record AssetRemovedEvent(long Revision, string AssetId) : ProductionEvent(Revision);

/// <summary>A device knocked on /join.</summary>
public sealed record PairingRequestUpsertedEvent(long Revision, PairingRequestDto Request) : ProductionEvent(Revision);

/// <summary>A knock was approved, denied or expired.</summary>
public sealed record PairingRequestRemovedEvent(long Revision, string RequestId, PairingRequestStatus Outcome) : ProductionEvent(Revision);

/// <summary>An invite was created.</summary>
public sealed record InviteUpsertedEvent(long Revision, InviteDto Invite) : ProductionEvent(Revision);

/// <summary>An invite was used, revoked or expired.</summary>
public sealed record InviteRemovedEvent(long Revision, string InviteId) : ProductionEvent(Revision);

/// <summary>An incident started, changed or recovered.</summary>
public sealed record IncidentUpsertedEvent(long Revision, IncidentDto Incident) : ProductionEvent(Revision);

/// <summary>An incident was acknowledged or superseded.</summary>
public sealed record IncidentRemovedEvent(long Revision, string IncidentId) : ProductionEvent(Revision);

/// <summary>The output consumer state changed.</summary>
public sealed record OutputStatusChangedEvent(long Revision, OutputStatusDto Status) : ProductionEvent(Revision);

/// <summary>A new entry for “Recent events”.</summary>
public sealed record LogAppendedEvent(long Revision, LogEntryDto Entry) : ProductionEvent(Revision);

/// <summary>Placeholder that only advances the revision; sent to clients that must not see the actual change (output page).</summary>
public sealed record RevisionOnlyEvent(long Revision) : ProductionEvent(Revision);
