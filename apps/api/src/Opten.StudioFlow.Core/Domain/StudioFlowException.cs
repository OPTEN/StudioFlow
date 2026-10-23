using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>Category of an expected error; the web layer maps it to an HTTP status code.</summary>
public enum ErrorKind
{
    /// <summary>Input failed validation (400).</summary>
    Validation,

    /// <summary>No credential at all where one is required (401).</summary>
    Unauthorized,

    /// <summary>Signed in but not allowed (403).</summary>
    Forbidden,

    /// <summary>Entity not found (404).</summary>
    NotFound,

    /// <summary>The request conflicts with the current state (409).</summary>
    Conflict,

    /// <summary>The resource existed but is used, expired or revoked (410).</summary>
    Gone,

    /// <summary>Body too large (413).</summary>
    PayloadTooLarge,

    /// <summary>Media type not allowed (415).</summary>
    UnsupportedMedia,

    /// <summary>Too many attempts (429).</summary>
    RateLimited,
}

/// <summary>
/// An expected error of a use case. Thrown inside a mutation it also discards every event the mutation staged, so a
/// failed request never publishes a partial change. Messages are English; clients localise by <c>code</c>.
/// </summary>
public sealed class StudioFlowException : Exception
{
    /// <summary>Creates an error.</summary>
    public StudioFlowException(ErrorKind kind, string code, string message, IReadOnlyDictionary<string, string[]>? errors = null, TimeSpan? retryAfter = null)
        : base(message)
    {
        Kind = kind;
        Code = code;
        Errors = errors;
        RetryAfter = retryAfter;
    }

    /// <summary>Category of the error.</summary>
    public ErrorKind Kind { get; }

    /// <summary>Machine readable code (<see cref="ErrorCodes"/>).</summary>
    public string Code { get; }

    /// <summary>Field errors for validation failures (field path → messages).</summary>
    public IReadOnlyDictionary<string, string[]>? Errors { get; }

    /// <summary>Retry hint for rate limits.</summary>
    public TimeSpan? RetryAfter { get; }

    /// <summary>Entity not found.</summary>
    public static StudioFlowException NotFound(string what) =>
        new(ErrorKind.NotFound, ErrorCodes.NotFound, $"{what} was not found.");

    /// <summary>State conflict with a specific code.</summary>
    public static StudioFlowException Conflict(string code, string message) => new(ErrorKind.Conflict, code, message);

    /// <summary>Validation failure of a single field.</summary>
    public static StudioFlowException Invalid(string field, string message) =>
        new(ErrorKind.Validation, ErrorCodes.ValidationFailed, "The input is invalid.", new Dictionary<string, string[]>(StringComparer.Ordinal) { [field] = [message] });

    /// <summary>Invite or pairing request is no longer usable.</summary>
    public static StudioFlowException PairingExpired() =>
        new(ErrorKind.Gone, ErrorCodes.PairingExpired, "The invite has expired or has already been used.");

    /// <summary>Too many attempts.</summary>
    public static StudioFlowException RateLimited(TimeSpan retryAfter) =>
        new(ErrorKind.RateLimited, ErrorCodes.RateLimited, "Too many attempts. Please try again later.", retryAfter: retryAfter);

    /// <summary>A size limit (scenes per production, items per scene, slots per device) was reached (409, GAP-05).</summary>
    public static StudioFlowException LimitReached(string message) => Conflict(ErrorCodes.LimitReached, message);
}
