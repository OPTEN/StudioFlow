using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Application.Ports;

/// <summary>Issues LiveKit access tokens (spec 7). The grants follow the role exactly.</summary>
public interface ILiveKitTokenIssuer
{
    /// <summary>Token for a sender: publish camera and screen share, no subscribe, no data.</summary>
    LiveKitTokenDto IssueSenderToken(string room, string identity, string name);

    /// <summary>Token for the Regie or the output: hidden subscriber without publish rights.</summary>
    LiveKitTokenDto IssueViewerToken(string room, string identity, string name);
}

/// <summary>A participant in a LiveKit room as listed by the room service.</summary>
/// <param name="Sid">Participant session id (<c>PA_…</c>), unique per join.</param>
/// <param name="Identity">Identity (device id, <c>studio_…</c> or <c>output_…</c>).</param>
/// <param name="TrackNames">Names of the published tracks (slot names for senders).</param>
public sealed record LiveKitParticipant(string Sid, string Identity, IReadOnlyList<string> TrackNames);

/// <summary>LiveKit room service (Twirp). Calls are best effort: callers handle <see cref="LiveKitUnavailableException"/>.</summary>
public interface ILiveKitRoomClient
{
    /// <summary>Lists the participants of a room; an unknown room has none.</summary>
    Task<IReadOnlyList<LiveKitParticipant>> ListParticipantsAsync(string room, CancellationToken cancellationToken);

    /// <summary>Removes a participant (a kick, not a ban). An absent participant is not an error.</summary>
    Task RemoveParticipantAsync(string room, string identity, CancellationToken cancellationToken);
}

/// <summary>LiveKit could not be reached or refused the request.</summary>
public sealed class LiveKitUnavailableException : Exception
{
    /// <summary>Creates the exception.</summary>
    public LiveKitUnavailableException(string message, Exception? innerException = null)
        : base(message, innerException)
    {
    }
}

/// <summary>Kind of a LiveKit webhook event that FlowStudio reacts to.</summary>
public enum LiveKitEventKind
{
    /// <summary>Any other event (ignored).</summary>
    Other,

    /// <summary>A participant became active.</summary>
    ParticipantJoined,

    /// <summary>A participant left or its connection was aborted.</summary>
    ParticipantLeft,

    /// <summary>A track was published.</summary>
    TrackPublished,

    /// <summary>A track was unpublished.</summary>
    TrackUnpublished,

    /// <summary>The room closed.</summary>
    RoomFinished,
}

/// <summary>A verified LiveKit webhook, reduced to what the source status needs.</summary>
/// <param name="Kind">Event kind.</param>
/// <param name="Room">Room name (= production id).</param>
/// <param name="RoomSid">Room session id.</param>
/// <param name="ParticipantSid">Participant session id.</param>
/// <param name="Identity">Participant identity.</param>
/// <param name="TrackName">Track name (= slot) for track events.</param>
/// <param name="TrackSid">Track session id (<c>TR_…</c>), unique per publication; lets late or duplicate events be ignored.</param>
public sealed record LiveKitEvent(LiveKitEventKind Kind, string Room, string? RoomSid, string? ParticipantSid, string? Identity, string? TrackName, string? TrackSid = null);

/// <summary>Result of storing an uploaded file.</summary>
/// <param name="Kind">Image or video, from the magic bytes.</param>
/// <param name="ContentType">Verified MIME type.</param>
/// <param name="FileName">File name inside the production's media folder.</param>
/// <param name="SizeBytes">Stored size.</param>
/// <param name="Width">Image width where readable.</param>
/// <param name="Height">Image height where readable.</param>
public sealed record StoredMedia(AssetKind Kind, string ContentType, string FileName, long SizeBytes, int? Width, int? Height);

/// <summary>Media storage (spec 4.7): verifies the type by magic bytes and enforces the size limits.</summary>
public interface IMediaStore
{
    /// <summary>
    /// Stores an upload as <c>{productionId}/{assetId}{ext}</c>. Throws <c>unsupported_media</c> (415) for other types
    /// and 413 when the file exceeds the limit of its type.
    /// </summary>
    Task<StoredMedia> StoreAsync(string productionId, string assetId, Stream content, long? declaredLength, CancellationToken cancellationToken);

    /// <summary>Absolute path of a stored file, or null when it is missing.</summary>
    string? GetPath(string productionId, string fileName);

    /// <summary>Deletes a stored file (missing files are ignored).</summary>
    void Delete(string productionId, string fileName);
}

/// <summary>Checks the admin credentials from the configuration.</summary>
public interface IAdminCredentials
{
    /// <summary>The configured admin user name.</summary>
    string Username { get; }

    /// <summary>True when user name and password match (constant time for the user name).</summary>
    bool Verify(string? username, string? password);
}
