namespace Opten.StudioFlow.Core.Contracts;

/// <summary>Admin login.</summary>
public sealed record LoginRequest(string Username, string Password);

/// <summary>The signed-in admin.</summary>
public sealed record SessionDto(string Username);

/// <summary>Whether the Regie has no account yet. Public, because the Regie asks before anyone is signed in.</summary>
/// <param name="SetupRequired">True while the first-run setup is open.</param>
public sealed record SetupStatusDto(bool SetupRequired);

/// <summary>First-run setup: creates the Regie account and signs it in.</summary>
/// <param name="SetupCode">The one-time code from the server log (<c>XXXX-XXXX</c>).</param>
/// <param name="Username">User name of the new account.</param>
/// <param name="Password">Password of the new account.</param>
public sealed record SetupRequest(string SetupCode, string Username, string Password);

/// <summary>Changes the password of the signed-in admin; every other session ends.</summary>
/// <param name="CurrentPassword">The password in use now.</param>
/// <param name="NewPassword">The new password.</param>
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

/// <summary>LiveKit connection data for a client. The token carries exactly the rights of the role.</summary>
/// <param name="Url">WebSocket URL of LiveKit (same origin, proxied by Caddy).</param>
/// <param name="Token">Signed access token.</param>
/// <param name="Identity">Participant identity.</param>
/// <param name="Room">Room name.</param>
/// <param name="ExpiresAt">Token expiry; LiveKit refreshes it for running connections.</param>
public sealed record LiveKitTokenDto(string Url, string Token, string Identity, string Room, DateTimeOffset ExpiresAt);

/// <summary>Static information about the installation.</summary>
/// <param name="Version">Build version.</param>
/// <param name="PublicBaseUrl">Public base URL, e.g. https://studioflow.example.com.</param>
public sealed record SystemInfoDto(string Version, string PublicBaseUrl);

/// <summary>Machine readable error codes in <c>ProblemDetails.extensions.code</c>.</summary>
public static class ErrorCodes
{
    /// <summary>Request body failed validation.</summary>
    public const string ValidationFailed = "validation_failed";

    /// <summary>Entity not found.</summary>
    public const string NotFound = "not_found";

    /// <summary>A program switch is rejected while a fade runs.</summary>
    public const string TransitionRunning = "transition_running";

    /// <summary>The output canvas cannot be changed while the broadcast is live (409).</summary>
    public const string BroadcastLive = "broadcast_live";

    /// <summary>The live scene cannot be deleted.</summary>
    public const string SceneIsLive = "scene_is_live";

    /// <summary>The asset is used by a scene.</summary>
    public const string AssetInUse = "asset_in_use";

    /// <summary>Upload type or size not allowed.</summary>
    public const string UnsupportedMedia = "unsupported_media";

    /// <summary>Invite or request is expired, used or revoked.</summary>
    public const string PairingExpired = "pairing_expired";

    /// <summary>
    /// Too many attempts; retry after <c>Retry-After</c> (429): login lockout, more than 10 knocks per address in 10
    /// minutes, more than 20 knocks pending at once, more than 20 redeem attempts per address in 10 minutes.
    /// </summary>
    public const string RateLimited = "rate_limited";

    /// <summary>The device is blocked.</summary>
    public const string DeviceBlocked = "device_blocked";

    /// <summary>The request conflicts with the current state (e.g. no preview for a take).</summary>
    public const string Conflict = "conflict";

    /// <summary>
    /// A size limit was reached (409): 99 scenes per production, 32 items per scene (add or replace), 9 screens or one
    /// camera per device. Invalid values are <see cref="ValidationFailed"/> (400), floods <see cref="RateLimited"/> (429).
    /// </summary>
    public const string LimitReached = "limit_reached";

    /// <summary>Not signed in, or the credentials are wrong or unknown (401).</summary>
    public const string Unauthorized = "unauthorized";

    /// <summary>Access denied: missing CSRF header, wrong output key, address not allowed, foreign origin (403).</summary>
    public const string Forbidden = "forbidden";

    /// <summary>The request body arrived too slowly (408).</summary>
    public const string RequestTimeout = "request_timeout";

    /// <summary>Unexpected server error (500); details are logged on the server only.</summary>
    public const string InternalError = "internal_error";

    /// <summary>
    /// The database is not reachable (503, GAP-32); retry later. Hub connections stay open meanwhile, and the API recovers
    /// by itself once the database is back.
    /// </summary>
    public const string ServiceUnavailable = "service_unavailable";

    /// <summary>The setup code of the first-run setup is wrong or missing (403).</summary>
    public const string SetupCodeInvalid = "setup_code_invalid";

    /// <summary>The first-run setup is closed because the Regie account exists (409).</summary>
    public const string SetupClosed = "setup_closed";

    /// <summary>The current password of a password change is wrong (400).</summary>
    public const string PasswordIncorrect = "password_incorrect";
}

/// <summary>
/// Reasons in the field errors (<c>errors</c>) of a <see cref="ErrorCodes.ValidationFailed"/> answer to the first-run
/// setup and the password change. They are codes, not texts: the client shows its own text for each.
/// </summary>
public static class FieldErrorCodes
{
    /// <summary>The user name is empty, longer than 64 characters or has characters other than letters, digits and <c>. _ @ -</c>.</summary>
    public const string UsernameInvalid = "username_invalid";

    /// <summary>The password has fewer than 12 characters.</summary>
    public const string PasswordTooShort = "password_too_short";

    /// <summary>The password has more than 256 characters.</summary>
    public const string PasswordTooLong = "password_too_long";

    /// <summary>The password equals the user name (ignoring case).</summary>
    public const string PasswordEqualsUsername = "password_equals_username";

    /// <summary>The password is on the list of common passwords.</summary>
    public const string PasswordTooCommon = "password_too_common";
}
