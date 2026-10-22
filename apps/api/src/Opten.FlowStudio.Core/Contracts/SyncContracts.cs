namespace Opten.FlowStudio.Core.Contracts;

/// <summary>
/// Answer to a (re)subscribe or <c>GET …/changes?since=</c>: either the missed events (delta) or a full snapshot when the
/// server no longer holds all events since the requested revision.
/// </summary>
/// <param name="Revision">Current revision.</param>
/// <param name="Events">Events after the requested revision, oldest first; null when a snapshot is returned.</param>
/// <param name="Snapshot">Full state; null when <see cref="Events"/> is returned.</param>
public sealed record ProductionChangesDto(long Revision, IReadOnlyList<ProductionEvent>? Events, ProductionSnapshot? Snapshot);

/// <summary>
/// Output variant of <see cref="ProductionChangesDto"/> (hub <c>SubscribeOutput</c> and <c>GET /api/output/{slug}/changes</c>):
/// changes the output must not see – devices, pairing, invites, incidents, log, output status and health-only source
/// changes – appear as <see cref="RevisionOnlyEvent"/> with the same revision.
/// </summary>
/// <param name="Revision">Current revision.</param>
/// <param name="Events">Events after the requested revision, oldest first; null when a snapshot is returned.</param>
/// <param name="Snapshot">Full output state; null when <see cref="Events"/> is returned.</param>
public sealed record OutputChangesDto(long Revision, IReadOnlyList<ProductionEvent>? Events, OutputSnapshot? Snapshot);

/// <summary>Result of the upload part of the technical check.</summary>
/// <param name="Bytes">Received bytes.</param>
/// <param name="ServerMs">Time the server needed to receive the body.</param>
public sealed record BandwidthTestResultDto(long Bytes, double ServerMs);
