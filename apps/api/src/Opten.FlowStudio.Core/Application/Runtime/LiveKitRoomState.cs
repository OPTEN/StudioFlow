using Opten.FlowStudio.Core.Application.Ports;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>
/// Published tracks of one LiveKit room as learned from webhooks and <c>ListParticipants</c> (spec 7). Webhooks are
/// lossy, may be duplicated and may arrive out of order (GAP-22), so state is keyed by participant and track sid,
/// unknown sids are tolerated, and departures are remembered: a late <c>participant_joined</c> or
/// <c>track_published</c> of a participant that already left, or of a track that was already unpublished, changes
/// nothing. The periodic reconcile replaces everything with what LiveKit lists.
/// </summary>
public sealed class LiveKitRoomState
{
    private const int TombstoneCapacity = 1024;

    private readonly Dictionary<string, Participant> participants = new(StringComparer.Ordinal);
    private readonly Tombstones leftParticipants = new(TombstoneCapacity);
    private readonly Tombstones unpublishedTracks = new(TombstoneCapacity);

    /// <summary>True when any session of <paramref name="identity"/> publishes a track named <paramref name="trackName"/>.</summary>
    public bool IsPublished(string identity, string trackName) =>
        participants.Values.Any(p => string.Equals(p.Identity, identity, StringComparison.Ordinal) && p.Tracks.ContainsValue(trackName));

    /// <summary>Applies a webhook; returns the identities whose published tracks may have changed.</summary>
    public IReadOnlyList<string> Apply(LiveKitEvent webhook)
    {
        ArgumentNullException.ThrowIfNull(webhook);
        switch (webhook.Kind)
        {
            case LiveKitEventKind.ParticipantJoined when webhook.ParticipantSid is not null && webhook.Identity is not null:
                if (leftParticipants.Contains(webhook.ParticipantSid))
                {
                    return [];
                }

                participants.TryAdd(webhook.ParticipantSid, new Participant(webhook.Identity, webhook.RoomSid));
                return [webhook.Identity];
            case LiveKitEventKind.ParticipantLeft when webhook.ParticipantSid is not null:
                leftParticipants.Add(webhook.ParticipantSid);
                return participants.Remove(webhook.ParticipantSid, out var left) ? [left.Identity] : [];
            case LiveKitEventKind.TrackPublished when webhook.ParticipantSid is not null && webhook.Identity is not null && webhook.TrackName is not null:
                if (leftParticipants.Contains(webhook.ParticipantSid) || (webhook.TrackSid is { } publishedSid && unpublishedTracks.Contains(publishedSid)))
                {
                    return [];
                }

                if (!participants.TryGetValue(webhook.ParticipantSid, out var publisher))
                {
                    publisher = new Participant(webhook.Identity, webhook.RoomSid);
                    participants[webhook.ParticipantSid] = publisher;
                }

                publisher.Tracks[webhook.TrackSid ?? webhook.TrackName] = webhook.TrackName;
                return [publisher.Identity];
            case LiveKitEventKind.TrackUnpublished when webhook.ParticipantSid is not null && webhook.TrackName is not null:
                if (webhook.TrackSid is { } unpublishedSid)
                {
                    unpublishedTracks.Add(unpublishedSid);
                }

                return participants.TryGetValue(webhook.ParticipantSid, out var unpublisher) && unpublisher.RemoveTrack(webhook.TrackSid, webhook.TrackName) ? [unpublisher.Identity] : [];
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
            // What LiveKit lists right now wins over everything learned from webhooks before.
            leftParticipants.Remove(participant.Sid);
            var state = new Participant(participant.Identity, null);
            foreach (var track in participant.TrackNames)
            {
                state.Tracks[track] = track;
            }

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
            leftParticipants.Add(entry.Key);
        }

        return [.. gone.Select(g => g.Value.Identity).Distinct(StringComparer.Ordinal)];
    }

    private sealed class Participant(string identity, string? roomSid)
    {
        public string Identity { get; } = identity;

        public string? RoomSid { get; } = roomSid;

        /// <summary>Published tracks: track sid (or the name when no sid is known) → track name.</summary>
        public Dictionary<string, string> Tracks { get; } = new(StringComparer.Ordinal);

        public bool RemoveTrack(string? trackSid, string trackName)
        {
            if (trackSid is not null && Tracks.Remove(trackSid))
            {
                return true;
            }

            var byName = Tracks.Where(t => string.Equals(t.Value, trackName, StringComparison.Ordinal)).Select(t => t.Key).ToList();
            foreach (var key in byName)
            {
                Tracks.Remove(key);
            }

            return byName.Count > 0;
        }
    }

    /// <summary>A bounded set of ids that ended (oldest forgotten first).</summary>
    private sealed class Tombstones(int capacity)
    {
        private readonly HashSet<string> ids = new(StringComparer.Ordinal);
        private readonly Queue<string> order = new();

        public bool Contains(string id) => ids.Contains(id);

        public void Add(string id)
        {
            if (!ids.Add(id))
            {
                return;
            }

            order.Enqueue(id);
            if (order.Count > capacity)
            {
                ids.Remove(order.Dequeue());
            }
        }

        public void Remove(string id) => ids.Remove(id);
    }
}
