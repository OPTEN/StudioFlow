using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;

namespace Opten.FlowStudio.Web.Tests.Support;

/// <summary>
/// A TCP forwarder in front of PostgreSQL that a test can switch off (every open connection is cut and new ones are
/// closed at once) and on again – a database outage for one app without stopping the shared container.
/// </summary>
public sealed class TcpProxy : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly ConcurrentDictionary<TcpClient, byte> open = new();
    private readonly CancellationTokenSource stopping = new();
    private readonly string targetHost;
    private readonly int targetPort;
    private volatile bool up = true;

    public TcpProxy(string targetHost, int targetPort)
    {
        this.targetHost = targetHost;
        this.targetPort = targetPort;
        listener.Start();
        _ = AcceptAsync();
    }

    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

    /// <summary>Cuts every connection and refuses new ones.</summary>
    public void Down()
    {
        up = false;
        foreach (var client in open.Keys)
        {
            client.Dispose();
        }

        open.Clear();
    }

    /// <summary>Forwards again.</summary>
    public void Up() => up = true;

    public async ValueTask DisposeAsync()
    {
        await stopping.CancelAsync();
        listener.Stop();
        Down();
        stopping.Dispose();
    }

    private async Task AcceptAsync()
    {
        while (!stopping.IsCancellationRequested)
        {
            TcpClient incoming;
            try
            {
                incoming = await listener.AcceptTcpClientAsync(stopping.Token);
            }
            catch (Exception exception) when (exception is OperationCanceledException or SocketException or ObjectDisposedException)
            {
                return;
            }

            if (!up)
            {
                incoming.Dispose();
                continue;
            }

            _ = ForwardAsync(incoming);
        }
    }

    private async Task ForwardAsync(TcpClient incoming)
    {
        var outgoing = new TcpClient();
        open[incoming] = 0;
        open[outgoing] = 0;
        try
        {
            await outgoing.ConnectAsync(targetHost, targetPort, stopping.Token);
            var a = incoming.GetStream().CopyToAsync(outgoing.GetStream(), stopping.Token);
            var b = outgoing.GetStream().CopyToAsync(incoming.GetStream(), stopping.Token);
            await Task.WhenAny(a, b);
        }
        catch (Exception exception) when (exception is IOException or SocketException or OperationCanceledException or ObjectDisposedException or InvalidOperationException)
        {
            // Cut by Down() or by one side.
        }
        finally
        {
            open.TryRemove(incoming, out _);
            open.TryRemove(outgoing, out _);
            incoming.Dispose();
            outgoing.Dispose();
        }
    }
}
