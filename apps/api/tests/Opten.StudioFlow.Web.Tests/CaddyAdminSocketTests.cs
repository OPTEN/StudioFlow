using System.Net.Sockets;
using System.Text;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Infrastructure.Install;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// The admin API of Caddy is a unix socket that only Caddy and the API share (issue #70): the API's client connects to it
/// instead of a TCP address, and the options refuse an ambiguous or relative setting.
/// </summary>
public sealed class CaddyAdminSocketTests : IDisposable
{
    private readonly string folder = Directory.CreateTempSubdirectory("sf-caddy-admin-").FullName;

    public void Dispose()
    {
        try
        {
            Directory.Delete(folder, recursive: true);
        }
        catch (IOException)
        {
            // Windows cannot delete the file of a unix socket through .NET; it is a temporary folder.
        }
    }

    [Fact]
    public async Task Client_TalksToTheUnixSocket_AndPostsTheCaddyfile()
    {
        // The stack runs on Linux containers; on some Windows setups connecting to a socket file in the user profile fails (WSAEINVAL).
        Assert.SkipWhen(OperatingSystem.IsWindows(), "unix sockets in the temp folder are not dependable on Windows");
        var socketPath = Path.Combine(folder, "admin.sock");
        using var server = new FakeAdminServer(socketPath);
        var install = new InstallOptions { CaddyAdminSocket = socketPath };
        using var http = new HttpClient(CaddyAdminClient.CreateHandler(install));
        CaddyAdminClient.Configure(http, install);
        var client = new CaddyAdminClient(http, install);

        Assert.True(client.IsConfigured);
        Assert.True(await client.IsLoadedAsync("sf-abc", CancellationToken.None));
        await client.LoadAsync("{\n}\n", CancellationToken.None);

        Assert.Contains("GET /config/apps/http/servers/sf-abc/listen HTTP/1.1", server.Requests[0], StringComparison.Ordinal);
        Assert.Contains("POST /load HTTP/1.1", server.Requests[1], StringComparison.Ordinal);
        Assert.Contains("Content-Type: text/caddyfile", server.Requests[1], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Client_WithAMissingSocket_ReportsCaddyAsNotReachable()
    {
        var install = new InstallOptions { CaddyAdminSocket = Path.Combine(folder, "missing.sock") };
        using var http = new HttpClient(CaddyAdminClient.CreateHandler(install));
        CaddyAdminClient.Configure(http, install);

        var exception = await Assert.ThrowsAsync<ServerConfigException>(() => new CaddyAdminClient(http, install).LoadAsync("{\n}\n", CancellationToken.None));

        Assert.Contains("not reachable", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Options_SocketMustBeAnAbsolutePath_AndExcludesTheTcpUrl()
    {
        Assert.Empty(new InstallOptions { CaddyAdminSocket = "/run/caddy-admin/admin.sock" }.Validate());
        Assert.Empty(new InstallOptions { CaddyAdminUrl = "http://caddy:2019" }.Validate());
        Assert.Contains("absolute path", Assert.Single(new InstallOptions { CaddyAdminSocket = "admin.sock" }.Validate()), StringComparison.Ordinal);
        Assert.Contains("alternatives", Assert.Single(new InstallOptions { CaddyAdminSocket = "/run/x.sock", CaddyAdminUrl = "http://caddy:2019" }.Validate()), StringComparison.Ordinal);
    }

    [Fact]
    public void Client_IsNotConfiguredWithoutSocketOrUrl()
    {
        using var http = new HttpClient();

        Assert.False(new CaddyAdminClient(http, new InstallOptions()).IsConfigured);
    }

    /// <summary>A minimal HTTP/1.1 server on a unix socket that answers every request with 200 and remembers the request heads.</summary>
    private sealed class FakeAdminServer : IDisposable
    {
        private readonly Socket listener = new(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        private readonly CancellationTokenSource stop = new();
        private readonly Task accepting;

        public FakeAdminServer(string path)
        {
            listener.Bind(new UnixDomainSocketEndPoint(path));
            listener.Listen(10);
            accepting = Task.Run(AcceptAsync);
        }

        public List<string> Requests { get; } = [];

        public void Dispose()
        {
            stop.Cancel();
            listener.Dispose();
            try
            {
                accepting.Wait(TimeSpan.FromSeconds(2));
            }
            catch (AggregateException)
            {
                // The accept loop ends with the socket.
            }

            stop.Dispose();
        }

        private async Task AcceptAsync()
        {
            while (!stop.IsCancellationRequested)
            {
                Socket connection;
                try
                {
                    connection = await listener.AcceptAsync(stop.Token);
                }
                catch (Exception exception) when (exception is OperationCanceledException or ObjectDisposedException or SocketException)
                {
                    return;
                }

                _ = Task.Run(() => ServeAsync(connection));
            }
        }

        private async Task ServeAsync(Socket connection)
        {
            using (connection)
            using (var stream = new NetworkStream(connection))
            {
                var buffer = new byte[8192];
                while (!stop.IsCancellationRequested)
                {
                    var read = await stream.ReadAsync(buffer, stop.Token);
                    if (read == 0)
                    {
                        return;
                    }

                    var text = Encoding.ASCII.GetString(buffer, 0, read);
                    if (!text.Contains(" HTTP/1.1", StringComparison.Ordinal))
                    {
                        continue; // the body of the previous request
                    }

                    lock (Requests)
                    {
                        Requests.Add(text);
                    }

                    var body = text.StartsWith("GET", StringComparison.Ordinal) ? "[\":8443\"]" : string.Empty;
                    var response = $"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {body.Length}\r\n\r\n{body}";
                    await stream.WriteAsync(Encoding.ASCII.GetBytes(response), stop.Token);
                }
            }
        }
    }
}
