namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// How this installation is wired (configuration section <c>Install</c>, issue #27): the published ports and the places on
/// the compose network and the shared volumes through which the API configures Caddy, LiveKit and the backup service. The
/// compose files set every value; without them (development, tests) the API runs on its own and applies nothing.
/// </summary>
public sealed class InstallOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Install";

    /// <summary><c>Install:HttpsPort</c>: the HTTPS port devices use (<c>STUDIOFLOW_HTTPS_PORT</c>, default 8443). Part of every URL the API builds.</summary>
    public int HttpsPort { get; set; } = 8443;

    /// <summary>
    /// <c>Install:SecretsPath</c>: the folder with the secrets the init service generated (<c>postgres-password</c>,
    /// <c>livekit-api-key</c>, <c>livekit-api-secret</c>). Empty: the secrets come from the configuration.
    /// </summary>
    public string SecretsPath { get; set; } = "";

    /// <summary><c>Install:CaddyAdminUrl</c>: the admin API of Caddy on the compose network (<c>http://caddy:2019</c>). Empty: Caddy is not configured.</summary>
    public string CaddyAdminUrl { get; set; } = "";

    /// <summary><c>Install:CaddyCertsPath</c>: the volume Caddy reads the uploaded certificate from. Empty: no custom certificate.</summary>
    public string CaddyCertsPath { get; set; } = "";

    /// <summary><c>Install:CaddyCertsMount</c>: where Caddy sees that volume.</summary>
    public string CaddyCertsMount { get; set; } = "/certs";

    /// <summary><c>Install:LiveKitConfigPath</c>: the volume with <c>livekit.yaml</c> that the LiveKit supervisor watches. Empty: LiveKit is not configured.</summary>
    public string LiveKitConfigPath { get; set; } = "";

    /// <summary><c>Install:LiveKitRtcTcpPort</c>: LiveKit's media port over TCP (<c>STUDIOFLOW_RTC_TCP_PORT</c>, default 7881).</summary>
    public int LiveKitRtcTcpPort { get; set; } = 7881;

    /// <summary><c>Install:LiveKitRtcUdpPort</c>: LiveKit's media port over UDP (<c>STUDIOFLOW_RTC_UDP_PORT</c>, default 7882).</summary>
    public int LiveKitRtcUdpPort { get; set; } = 7882;

    /// <summary><c>Install:LiveKitEmptyTimeout</c>: seconds an empty room stays open (default 300; the short-TTL tests lower it).</summary>
    public int LiveKitEmptyTimeout { get; set; } = 300;

    /// <summary><c>Install:LiveKitWebhookUrl</c>: where LiveKit posts its webhooks, inside the compose network.</summary>
    public string LiveKitWebhookUrl { get; set; } = "http://api:8080/api/livekit/webhook";

    /// <summary><c>Install:BackupConfigPath</c>: the volume with the backup settings and the "back up now" request. Empty: the backup service is not configured.</summary>
    public string BackupConfigPath { get; set; } = "";

    /// <summary><c>Install:HstsMaxAge</c>: seconds of the HSTS header of sites with a public or uploaded certificate (default one year; sites with the local CA always use one hour).</summary>
    public int HstsMaxAge { get; set; } = 31_536_000;

    /// <inheritdoc />
    public IEnumerable<string> Validate() =>
    [
        .. OptionRules.Count("Install:HttpsPort", HttpsPort, 1, 65_535),
        .. OptionRules.Count("Install:LiveKitRtcTcpPort", LiveKitRtcTcpPort, 1, 65_535),
        .. OptionRules.Count("Install:LiveKitRtcUdpPort", LiveKitRtcUdpPort, 1, 65_535),
        .. OptionRules.Count("Install:LiveKitEmptyTimeout", LiveKitEmptyTimeout, 1, 86_400),
        .. OptionRules.Count("Install:HstsMaxAge", HstsMaxAge, 0, 63_072_000),
        .. ValidUrl("Install:CaddyAdminUrl", CaddyAdminUrl),
    ];

    private static IEnumerable<string> ValidUrl(string key, string value)
    {
        if (!string.IsNullOrEmpty(value) && !(Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttp))
        {
            yield return $"{key} must be an absolute http URL or empty.";
        }
    }
}
