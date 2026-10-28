namespace Opten.StudioFlow.Web.Security;

/// <summary>Authentication schemes.</summary>
internal static class AuthSchemes
{
    /// <summary>Admin cookie <c>sf_session</c>.</summary>
    public const string Admin = "Admin";

    /// <summary>Device bearer <c>{deviceId}.{secret}</c>.</summary>
    public const string Device = "Device";

    /// <summary>Output key on the output hub.</summary>
    public const string Output = "Output";
}

/// <summary>Authorization policies (spec 5).</summary>
internal static class Policies
{
    /// <summary>Signed-in admin (cookie).</summary>
    public const string Admin = "Admin";

    /// <summary>Paired, not blocked device.</summary>
    public const string Device = "Device";

    /// <summary>Valid output key from an allowed address.</summary>
    public const string Output = "Output";
}

/// <summary>Claims issued by the StudioFlow handlers.</summary>
internal static class StudioFlowClaims
{
    /// <summary>Production of a device or output connection.</summary>
    public const string ProductionId = "studioflow:production";

    /// <summary>Output link of an output connection.</summary>
    public const string OutputLinkId = "studioflow:output-link";

    /// <summary>The device is blocked.</summary>
    public const string Blocked = "studioflow:blocked";

    /// <summary>Random id of an admin session (logout revokes it, GAP-04).</summary>
    public const string SessionId = "studioflow:sid";

    /// <summary>When an admin session was issued (Unix seconds); the session ends an absolute lifetime after that, however active it was.</summary>
    public const string IssuedAt = "studioflow:iat";

    /// <summary>Security stamp of the account when the session was issued; a password change makes older stamps invalid.</summary>
    public const string SecurityStamp = "studioflow:stamp";
}

/// <summary>Names of the cookie, headers and query parameters of the security layer.</summary>
internal static class SecurityNames
{
    /// <summary>Session cookie of the admin.</summary>
    public const string SessionCookie = "sf_session";

    /// <summary>CSRF header the Regie sends with every unsafe request.</summary>
    public const string CsrfHeader = "X-StudioFlow";

    /// <summary>Query parameter browsers use for hub tokens.</summary>
    public const string AccessTokenQuery = "access_token";

    /// <summary>Path prefix of the hubs (the only place where <see cref="AccessTokenQuery"/> is read).</summary>
    public const string HubsPrefix = "/hubs";
}
