using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>Everything the Caddyfile depends on (decrypted; it exists only while the file is rendered).</summary>
/// <param name="HttpsPort">The published HTTPS port; Caddy listens on the same number (so HTTP/3 advertises the right one).</param>
/// <param name="TlsMode">Certificate mode of <see cref="Domain"/>.</param>
/// <param name="Domain">Host name with its own certificate, or null for the local CA on whatever name or address is used.</param>
/// <param name="AcmeEmail">E-mail of the Let's Encrypt account (dns-* modes).</param>
/// <param name="DnsChallengeDomain">Delegation target of <c>_acme-challenge</c>, if any.</param>
/// <param name="DnsArguments">The credentials in the order of the arguments of the provider snippet; null when they are not available.</param>
/// <param name="Certificate">The uploaded certificate files; null when they are not available.</param>
/// <param name="FrameAncestors">Origins that may frame the output (without <c>'self'</c>).</param>
/// <param name="HstsMaxAge">HSTS seconds of sites with a certificate that is not from the local CA.</param>
/// <param name="LocalHstsMaxAge">HSTS seconds of sites with the local CA: a browser must not remember "https only" for a year for a certificate it can only trust by hand, so this is one hour unless the operator set a duration.</param>
public sealed record CaddyModel(
    int HttpsPort,
    string TlsMode,
    string? Domain,
    string? AcmeEmail,
    string? DnsChallengeDomain,
    IReadOnlyList<string>? DnsArguments,
    CertificateFiles? Certificate,
    IReadOnlyList<string> FrameAncestors,
    int HstsMaxAge,
    int LocalHstsMaxAge);

/// <summary>A rendered Caddyfile and the name of its server (<c>sf-</c> and 12 hex characters of the content), by which the API recognises it in Caddy.</summary>
/// <param name="ServerName">Name of the HTTP server in the loaded configuration.</param>
/// <param name="Text">The Caddyfile.</param>
/// <param name="Warning">Why the domain site is missing, if it is (English, no secrets).</param>
public sealed record CaddyConfig(string ServerName, string Text, string? Warning);

/// <summary>
/// Writes the Caddyfile that the API pushes to Caddy (issue #27). The long, static parts live in the Caddy image
/// (<c>infra/caddy</c>: global options, the site snippet <c>studioflow_site</c>, one snippet per DNS provider); this class
/// only decides which sites exist, how each one gets its certificate and which values the snippets receive. Values are
/// validated by <see cref="ServerSettingsRules"/> (no character that ends a Caddyfile token), and are quoted anyway.
/// </summary>
public static class CaddyfileRenderer
{
    private const string NamePlaceholder = "@@NAME@@";

    /// <summary>Renders the Caddyfile of <paramref name="model"/>.</summary>
    public static CaddyConfig Render(CaddyModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        var port = model.HttpsPort.ToString(CultureInfo.InvariantCulture);
        var ancestors = Quote("'self'" + string.Concat(model.FrameAncestors.Select(origin => " " + origin)));
        var text = new StringBuilder();
        text.AppendLine("# Written by the StudioFlow API from the server settings. Do not edit: the API replaces it whenever the settings change.");
        text.AppendLine("{");
        text.AppendLine("\timport /etc/caddy/global.caddy");
        text.AppendLine(CultureInfo.InvariantCulture, $"\thttps_port {port}");
        text.AppendLine(CultureInfo.InvariantCulture, $"\tservers :{port} {{");
        text.AppendLine(CultureInfo.InvariantCulture, $"\t\tname {NamePlaceholder}");
        text.AppendLine("\t\timport /etc/caddy/servers.caddy");
        text.AppendLine("\t}");
        text.AppendLine("}");
        text.AppendLine();
        text.AppendLine("import /etc/caddy/studioflow.caddy");
        text.AppendLine("import /etc/caddy/health.caddy");

        var (site, warning) = DomainSite(model, port, ancestors);
        if (site is not null)
        {
            text.AppendLine();
            text.Append(site);
        }

        // Whatever name or address a browser uses besides the domain gets a certificate of the local CA, so the Regie stays
        // reachable (and a wrong certificate setting can be corrected) in every state.
        text.AppendLine();
        text.AppendLine(CultureInfo.InvariantCulture, $":{port} {{");
        text.AppendLine("\ttls internal {");
        text.AppendLine("\t\ton_demand");
        text.AppendLine("\t}");
        text.AppendLine("\timport sf_ca_download");
        text.AppendLine(CultureInfo.InvariantCulture, $"\timport studioflow_site {model.LocalHstsMaxAge} {ancestors}");
        text.AppendLine("}");

        var body = text.ToString().ReplaceLineEndings("\n");
        var name = "sf-" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(body)))[..12];
        return new CaddyConfig(name, body.Replace(NamePlaceholder, name, StringComparison.Ordinal), warning);
    }

    /// <summary>The site block of the domain, or why there is none (no domain, or its certificate cannot be configured).</summary>
    private static (string? Site, string? Warning) DomainSite(CaddyModel model, string port, string ancestors)
    {
        if (string.IsNullOrEmpty(model.Domain))
        {
            return (null, null);
        }

        var site = new StringBuilder();
        var address = $"https://{model.Domain}:{port}";
        var hsts = model.HstsMaxAge.ToString(CultureInfo.InvariantCulture);
        if (string.Equals(model.TlsMode, TlsModes.Internal, StringComparison.Ordinal))
        {
            site.AppendLine(CultureInfo.InvariantCulture, $"{address} {{");
            site.AppendLine("\ttls internal");
            site.AppendLine("\timport sf_ca_download");
            site.AppendLine(CultureInfo.InvariantCulture, $"\timport studioflow_site {model.LocalHstsMaxAge} {ancestors}");
            site.AppendLine("}");
            return (site.ToString(), null);
        }

        if (string.Equals(model.TlsMode, TlsModes.Custom, StringComparison.Ordinal))
        {
            if (model.Certificate is not { } files)
            {
                return (null, "The uploaded certificate cannot be read. Upload it again in the server settings.");
            }

            site.AppendLine(CultureInfo.InvariantCulture, $"{address} {{");
            site.AppendLine(CultureInfo.InvariantCulture, $"\ttls {files.Certificate} {files.Key}");
            site.AppendLine(CultureInfo.InvariantCulture, $"\timport studioflow_site {hsts} {ancestors}");
            site.AppendLine("}");
            return (site.ToString(), null);
        }

        if (TlsModes.IsDns(model.TlsMode) && model.DnsArguments is { } arguments)
        {
            site.AppendLine(CultureInfo.InvariantCulture, $"{address} {{");
            site.AppendLine(CultureInfo.InvariantCulture, $"\ttls {model.AcmeEmail} {{");
            site.AppendLine(CultureInfo.InvariantCulture, $"\t\timport /etc/caddy/tls/{model.TlsMode}.caddy {string.Join(' ', arguments.Select(Quote))}");
            site.AppendLine("\t\tresolvers {$STUDIOFLOW_DNS_RESOLVERS}");
            if (!string.IsNullOrEmpty(model.DnsChallengeDomain))
            {
                site.AppendLine(CultureInfo.InvariantCulture, $"\t\tdns_challenge_override_domain {model.DnsChallengeDomain}");
            }

            site.AppendLine("\t}");
            site.AppendLine(CultureInfo.InvariantCulture, $"\timport studioflow_site {hsts} {ancestors}");
            site.AppendLine("}");
            return (site.ToString(), null);
        }

        return (null, "The credentials of the DNS provider cannot be read. Enter them again in the server settings.");
    }

    private static string Quote(string value) => "\"" + value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";
}

/// <summary>Writes the configuration of the LiveKit server (the supervisor in the LiveKit image restarts the server when the file changes).</summary>
public static class LiveKitConfigRenderer
{
    /// <summary>
    /// Renders <c>livekit.yaml</c>. <paramref name="nodeIp"/> is the address announced to the devices; without it LiveKit
    /// announces the addresses of its own interfaces, which only works inside the compose network (before the wizard).
    /// </summary>
    public static string Render(string apiKey, string apiSecret, string? nodeIp, InstallOptions install)
    {
        ArgumentException.ThrowIfNullOrEmpty(apiKey);
        ArgumentException.ThrowIfNullOrEmpty(apiSecret);
        ArgumentNullException.ThrowIfNull(install);
        var text = new StringBuilder();
        text.AppendLine("# Written by the StudioFlow API from the server settings. Do not edit: the API replaces it whenever the settings change.");
        text.AppendLine("port: 7880");
        text.AppendLine("rtc:");
        text.AppendLine(CultureInfo.InvariantCulture, $"  tcp_port: {install.LiveKitRtcTcpPort}");
        text.AppendLine(CultureInfo.InvariantCulture, $"  udp_port: {install.LiveKitRtcUdpPort}");
        text.AppendLine("  use_external_ip: false");
        if (!string.IsNullOrEmpty(nodeIp))
        {
            text.AppendLine(CultureInfo.InvariantCulture, $"  node_ip: {nodeIp}");
        }

        // Quoted: a secret of digits only would be read as a number.
        text.AppendLine("keys:");
        text.AppendLine(CultureInfo.InvariantCulture, $"  {Yaml(apiKey)}: {Yaml(apiSecret)}");
        text.AppendLine("room:");
        text.AppendLine("  auto_create: true");
        text.AppendLine(CultureInfo.InvariantCulture, $"  empty_timeout: {install.LiveKitEmptyTimeout}");
        text.AppendLine("  departure_timeout: 20");
        text.AppendLine("logging:");
        text.AppendLine("  level: info");
        text.AppendLine("webhook:");
        text.AppendLine(CultureInfo.InvariantCulture, $"  api_key: {Yaml(apiKey)}");
        text.AppendLine("  urls:");
        text.AppendLine(CultureInfo.InvariantCulture, $"    - {Yaml(install.LiveKitWebhookUrl)}");
        return text.ToString().ReplaceLineEndings("\n");
    }

    /// <summary>SHA-256 of the text as the supervisor computes it (lower case hex).</summary>
    public static string Hash(string yaml) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(yaml)));

    private static string Yaml(string value) => "\"" + value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";
}

/// <summary>Writes the settings file that the backup service reads (<c>infra/backup</c>).</summary>
public static class BackupSettingsRenderer
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>
    /// Renders <c>backup-settings.json</c> from the settings. The rclone.conf itself is a file of its own; its hash is part
    /// of this file, so the service notices a new configuration of the same remote.
    /// </summary>
    public static string Render(ServerSettings settings, string? rcloneConfig)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var offsite = settings.RcloneRemote is null
            ? null
            : new
            {
                remote = settings.RcloneRemote,
                ageRecipients = settings.AgeRecipientList,
                unencrypted = settings.OffsiteUnencrypted,
                rcloneConfigSha256 = rcloneConfig is null ? string.Empty : Hash(rcloneConfig),
            };
        return JsonSerializer.Serialize(
            new
            {
                version = 1,
                schedule = settings.BackupSchedule ?? string.Empty,
                timezone = settings.BackupTimezone ?? string.Empty,
                keepDaily = settings.BackupKeepDaily,
                keepWeekly = settings.BackupKeepWeekly,
                offsite,
            },
            Options).ReplaceLineEndings("\n") + "\n";
    }

    /// <summary>SHA-256 of the file (lower case hex), which the backup service reports back when it runs these settings.</summary>
    public static string Hash(string json) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
}
