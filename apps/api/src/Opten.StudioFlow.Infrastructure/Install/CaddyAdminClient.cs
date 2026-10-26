using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.Install;

/// <summary>
/// The admin API of Caddy (<c>Install:CaddyAdminUrl</c>, port 2019 of the Caddy container). It is reachable on the compose
/// network only: no port of Caddy's admin API is published. The API pushes the Caddyfile it rendered (<c>POST /load</c>,
/// Content-Type <c>text/caddyfile</c>; Caddy adapts and applies it without dropping connections) and asks whether Caddy
/// still runs it, which is how a restarted Caddy is noticed.
/// </summary>
internal sealed partial class CaddyAdminClient(HttpClient http, InstallOptions install) : ICaddyGateway
{
    private const int MaxErrorLength = 400;

    public bool IsConfigured => !string.IsNullOrEmpty(install.CaddyAdminUrl);

    public async Task<bool> IsLoadedAsync(string serverName, CancellationToken cancellationToken)
    {
        try
        {
            // The server exists when its listen addresses are an array; an unknown name answers with null.
            using var response = await http.GetAsync(new Uri($"/config/apps/http/servers/{Uri.EscapeDataString(serverName)}/listen", UriKind.Relative), cancellationToken);
            if (response.StatusCode != HttpStatusCode.OK)
            {
                return false;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            return body.TrimStart().StartsWith('[');
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new ServerConfigException("Caddy is not reachable on the compose network. Check: docker compose ps caddy", exception);
        }
    }

    public async Task LoadAsync(string caddyfile, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caddyfile);
        using var content = new StringContent(caddyfile, Encoding.UTF8, new MediaTypeHeaderValue("text/caddyfile"));
        try
        {
            using var response = await http.PostAsync(new Uri("/load", UriKind.Relative), content, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                throw new ServerConfigException($"Caddy refused the configuration ({(int)response.StatusCode}): {Redact(body, caddyfile)}");
            }
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new ServerConfigException("Caddy is not reachable on the compose network. Check: docker compose ps caddy", exception);
        }
    }

    /// <summary>The error text of Caddy without any quoted value of the Caddyfile (the credentials are quoted) and cut to a short length.</summary>
    internal static string Redact(string body, string caddyfile)
    {
        var text = body.Trim();
        foreach (Match match in QuotedValue().Matches(caddyfile))
        {
            text = text.Replace(match.Groups[1].Value, "***", StringComparison.Ordinal);
        }

        text = text.ReplaceLineEndings(" ");
        return text.Length > MaxErrorLength ? text[..MaxErrorLength] + "..." : text;
    }

    [GeneratedRegex("\"([^\"\\\\]{6,})\"", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex QuotedValue();
}
