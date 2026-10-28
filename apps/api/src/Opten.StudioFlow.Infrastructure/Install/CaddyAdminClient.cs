using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.Install;

/// <summary>
/// The admin API of Caddy (<c>Install:CaddyAdminSocket</c>: a unix socket in a volume that only Caddy and the API mount; or,
/// for a Caddy outside the compose files, <c>Install:CaddyAdminUrl</c>). The API is its only client, because the admin API has no
/// authentication and can read the DNS credentials and replace the configuration. The API pushes the Caddyfile it rendered (<c>POST /load</c>,
/// Content-Type <c>text/caddyfile</c>; Caddy adapts and applies it without dropping connections) and asks whether Caddy
/// still runs it, which is how a restarted Caddy is noticed.
/// </summary>
internal sealed partial class CaddyAdminClient(HttpClient http, InstallOptions install) : ICaddyGateway
{
    private const int MaxErrorLength = 400;

    public bool IsConfigured => !string.IsNullOrEmpty(install.CaddyAdminUrl) || !string.IsNullOrEmpty(install.CaddyAdminSocket);

    /// <summary>The base address and, for the unix socket, the connection of the HTTP client of the admin API.</summary>
    internal static void Configure(HttpClient http, InstallOptions install)
    {
        http.BaseAddress = new Uri(
            !string.IsNullOrEmpty(install.CaddyAdminSocket) ? SocketBaseAddress
            : string.IsNullOrEmpty(install.CaddyAdminUrl) ? "http://caddy.invalid"
            : install.CaddyAdminUrl);
        http.Timeout = TimeSpan.FromSeconds(10);
    }

    /// <summary>The primary handler of the HTTP client: a connection to the unix socket when one is configured, else the default.</summary>
    internal static HttpMessageHandler CreateHandler(InstallOptions install)
    {
        var handler = new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(2) };
        if (!string.IsNullOrEmpty(install.CaddyAdminSocket))
        {
            var endpoint = new UnixDomainSocketEndPoint(install.CaddyAdminSocket);
            handler.ConnectCallback = async (_, cancellationToken) =>
            {
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                try
                {
                    await socket.ConnectAsync(endpoint, cancellationToken);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch
                {
                    socket.Dispose();
                    throw;
                }
            };
        }

        return handler;
    }

    // The host name only fills the Host header; the connection goes to the socket.
    private const string SocketBaseAddress = "http://caddy-admin";

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
            throw new ServerConfigException("Caddy is not reachable. Check: docker compose ps caddy", exception);
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
            throw new ServerConfigException("Caddy is not reachable. Check: docker compose ps caddy", exception);
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
