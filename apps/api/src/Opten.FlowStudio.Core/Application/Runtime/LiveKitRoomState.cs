using Opten.FlowStudio.Core.Application.Ports;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>
/// Published tracks of one LiveKit room as learned from webhooks and <c>ListParticipants</c> (spec 7). Webhooks are
/// lossy and may interleave across rooms, so state is keyed by participant sid, unknown sids are tolerated and the
/// periodic reconcile replaces everything.
/// </summary>
public sealed class LiveKitRoomState
{
    private readonly Dictionary<string, Participant> participants = new(StringComparer.Ordinal);

    /// <summary>True when any session of <paramref name="identity"/> publishes a track named <paramref name="trackName"/>.</summary>
    public bool IsPublished(string identity, string trackName) =>
        participants.Values.Any(p => string.Equals(p.Identity, identity, StringComparison.Ordinal) && p.Tracks.Contains(trackName));

    /// <summary>Applies a webhook; returns the identities whose published tracks may have changed.</summary>
    public IReadOnlyList<string> Apply(LiveKitEvent webhook)
    {
        ArgumentNullException.ThrowIfNull(webhook);
        switch (webhook.Kind)
        {
            case LiveKitEventKind.ParticipantJoined when webhook.ParticipantSid is not null && webhook.Identity is not null:
                participants.TryAdd(webhook.ParticipantSid, new Participant(webhook.Identity, webhook.RoomSid));
                return [webhook.Identity];
            case LiveKitEventKind.ParticipantLeft when webhook.ParticipantSid is not null:
                return participants.Remove(webhook.ParticipantSid, out var left) ? [left.Identity] : [];
            case LiveKitEventKind.TrackPublished when webhook.ParticipantSid is not null && webhook.Identity is not null && webhook.TrackName is not null:
                if (!participants.TryGetValue(webhook.ParticipantSid, out var publisher))
                {
                    publisher = new Participant(webhook.Identity, webhook.RoomSid);
                    participants[webhook.ParticipantSid] = publisher;
                }

                publisher.Tracks.Add(webhook.TrackName);
                return [publisher.Identity];
            case LiveKitEventKind.TrackUnpublished when webhook.ParticipantSid is not null && webhook.TrackName is not null:
                return participants.TryGetValue(webhook.ParticipantSid, out var unpublisher) && unpublisher.Tracks.Remove(webhook.TrackName) ? [unpublisher.Identity] : [];
            case LiveKitEventKind.RoomFinished:
                return RemoveRoomSession(webhook.RoomSid);
            default:
                return [];
        }
    }

    /// <summary>Replaces the whole state with a fresh participant list; returns every identity whose tracks may have changed.</summary>
    public IReadOnlySet<string> Replace(IReadOnlyList<LiveKitParticipant> listed)
    {
        ArgumentNullException.ThrowIfNull(listed);
        var affected = new HashSet<string>(participants.Values.Select(p => p.Identity), StringComparer.Ordinal);
        participants.Clear();
        foreach (var participant in listed)
        {
            var state = new Participant(participant.Identity, null);
            state.Tracks.UnionWith(participant.TrackNames);
            participants[participant.Sid] = state;
            affected.Add(participant.Identity);
        }

        return affected;
    }

    /// <summary>
    /// Forgets the participants of a finished room session. A late <c>room_finished</c> of an old session must not touch
    /// a newer one, so only participants with that room sid are dropped; participants learned from
    /// <c>ListParticipants</c> (no room sid) are left to the next reconcile.
    /// </summary>
    private string[] RemoveRoomSession(string? roomSid)
    {
        if (roomSid is null)
        {
            return [];
        }

        var gone = participants.Where(p => string.Equals(p.Value.RoomSid, roomSid, StringComparison.Ordinal)).ToList();
        foreach (var entry in gone)
        {
            participants.Remove(entry.Key);
        }

        return [.. gone.Select(g => g.Value.Identity).Distinct(StringComparer.Ordinal)];
    }

    private sealed class Participant(string identity, string? roomSid)
    {
        public string Identity { get; } = identity;

        public string? RoomSid { get; } = roomSid;

        public HashSet<string> Tracks { get; } = new(StringComparer.Ordinal);
    }
}
