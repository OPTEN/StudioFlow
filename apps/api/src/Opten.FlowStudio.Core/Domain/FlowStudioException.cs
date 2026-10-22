using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>Category of an expected error; the web layer maps it to an HTTP status code.</summary>
public enum ErrorKind
{
    /// <summary>Input failed validation (400).</summary>
    Validation,

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
/// failed request never publishes a partial change. Messages are German because they reach the user.
/// </summary>
public sealed class FlowStudioException : Exception
{
    /// <summary>Creates an error.</summary>
    public FlowStudioException(ErrorKind kind, string code, string message, IReadOnlyDictionary<string, string[]>? errors = null, TimeSpan? retryAfter = null)
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
    public static FlowStudioException NotFound(string what) =>
        new(ErrorKind.NotFound, ErrorCodes.NotFound, $"{what} wurde nicht gefunden.");

    /// <summary>State conflict with a specific code.</summary>
    public static FlowStudioException Conflict(string code, string message) => new(ErrorKind.Conflict, code, message);

    /// <summary>Validation failure of a single field.</summary>
    public static FlowStudioException Invalid(string field, string message) =>
        new(ErrorKind.Validation, ErrorCodes.ValidationFailed, "Die Eingabe ist ungültig.", new Dictionary<string, string[]>(StringComparer.Ordinal) { [field] = [message] });

    /// <summary>Invite or pairing request is no longer usable.</summary>
    public static FlowStudioException PairingExpired() =>
        new(ErrorKind.Gone, ErrorCodes.PairingExpired, "Die Einladung ist abgelaufen oder wurde bereits verwendet.");

    /// <summary>Too many attempts.</summary>
    public static FlowStudioException RateLimited(TimeSpan retryAfter) =>
        new(ErrorKind.RateLimited, ErrorCodes.RateLimited, "Zu viele Versuche. Bitte später erneut versuchen.", retryAfter: retryAfter);

    /// <summary>A limit (scenes, items, slots, pending requests) was reached.</summary>
    public static FlowStudioException LimitReached(string message) => Conflict(ErrorCodes.LimitReached, message);
}
