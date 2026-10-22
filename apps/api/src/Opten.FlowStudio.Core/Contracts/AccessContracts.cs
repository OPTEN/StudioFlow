namespace Opten.FlowStudio.Core.Contracts;

/// <summary>Admin login.</summary>
public sealed record LoginRequest(string Username, string Password);

/// <summary>The signed-in admin.</summary>
public sealed record SessionDto(string Username);

/// <summary>LiveKit connection data for a client. The token carries exactly the rights of the role.</summary>
/// <param name="Url">WebSocket URL of LiveKit (same origin, proxied by Caddy).</param>
/// <param name="Token">Signed access token.</param>
/// <param name="Identity">Participant identity.</param>
/// <param name="Room">Room name.</param>
/// <param name="ExpiresAt">Token expiry; LiveKit refreshes it for running connections.</param>
public sealed record LiveKitTokenDto(string Url, string Token, string Identity, string Room, DateTimeOffset ExpiresAt);

/// <summary>Static information about the installation.</summary>
/// <param name="Version">Build version.</param>
/// <param name="PublicBaseUrl">Public base URL, e.g. https://flowstudio.opten.ch.</param>
/// <param name="CanvasWidth">Canvas width (1920).</param>
/// <param name="CanvasHeight">Canvas height (1080).</param>
public sealed record SystemInfoDto(string Version, string PublicBaseUrl, int CanvasWidth, int CanvasHeight);

/// <summary>Machine readable error codes in <c>ProblemDetails.extensions.code</c>.</summary>
public static class ErrorCodes
{
    /// <summary>Request body failed validation.</summary>
    public const string ValidationFailed = "validation_failed";

    /// <summary>Entity not found.</summary>
    public const string NotFound = "not_found";

    /// <summary>A program switch is rejected while a fade runs.</summary>
    public const string TransitionRunning = "transition_running";

    /// <summary>The live scene cannot be deleted.</summary>
    public const string SceneIsLive = "scene_is_live";

    /// <summary>The asset is used by a scene.</summary>
    public const string AssetInUse = "asset_in_use";

    /// <summary>Upload type or size not allowed.</summary>
    public const string UnsupportedMedia = "unsupported_media";

    /// <summary>Invite or request is expired, used or revoked.</summary>
    public const string PairingExpired = "pairing_expired";

    /// <summary>Too many attempts; retry later (login lockout, knock flood).</summary>
    public const string RateLimited = "rate_limited";

    /// <summary>The device is blocked.</summary>
    public const string DeviceBlocked = "device_blocked";

    /// <summary>The request conflicts with the current state (e.g. no preview for a take).</summary>
    public const string Conflict = "conflict";

    /// <summary>A limit was reached (scenes, items, slots, pending requests).</summary>
    public const string LimitReached = "limit_reached";

    /// <summary>Not signed in, or the credentials are wrong or unknown (401).</summary>
    public const string Unauthorized = "unauthorized";

    /// <summary>Access denied: missing CSRF header, wrong output key, address not allowed, foreign origin (403).</summary>
    public const string Forbidden = "forbidden";

    /// <summary>The request body arrived too slowly (408).</summary>
    public const string RequestTimeout = "request_timeout";

    /// <summary>Unexpected server error (500); details are logged on the server only.</summary>
    public const string InternalError = "internal_error";
}
