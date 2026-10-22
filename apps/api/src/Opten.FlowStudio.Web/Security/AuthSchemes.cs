namespace Opten.FlowStudio.Web.Security;

/// <summary>Authentication schemes.</summary>
internal static class AuthSchemes
{
    /// <summary>Admin cookie <c>fs_session</c>.</summary>
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

/// <summary>Claims issued by the FlowStudio handlers.</summary>
internal static class FlowStudioClaims
{
    /// <summary>Production of a device or output connection.</summary>
    public const string ProductionId = "flowstudio:production";

    /// <summary>The device is blocked.</summary>
    public const string Blocked = "flowstudio:blocked";
}

/// <summary>Names of the cookie, headers and query parameters of the security layer.</summary>
internal static class SecurityNames
{
    /// <summary>Session cookie of the admin.</summary>
    public const string SessionCookie = "fs_session";

    /// <summary>CSRF header the Regie sends with every unsafe request.</summary>
    public const string CsrfHeader = "X-FlowStudio";

    /// <summary>Query parameter browsers use for hub tokens.</summary>
    public const string AccessTokenQuery = "access_token";

    /// <summary>Path prefix of the hubs (the only place where <see cref="AccessTokenQuery"/> is read).</summary>
    public const string HubsPrefix = "/hubs";
}
