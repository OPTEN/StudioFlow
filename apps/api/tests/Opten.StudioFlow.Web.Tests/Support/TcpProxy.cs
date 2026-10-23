using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;

namespace Opten.FlowStudio.Web.Tests.Support;

/// <summary>
/// A TCP forwarder in front of PostgreSQL that a test can switch off and on again – a database outage for one app
/// without stopping the shared container. <see cref="Down"/> refuses at once (a stopped server on a reachable host);
/// <see cref="Blackhole"/> accepts connections and never answers (a hanging server, a silent network or a name that
/// takes long to resolve), which is the case that made requests wait for 45 s (BUG-21).
/// </summary>
public sealed class TcpProxy : IAsyncDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly ConcurrentDictionary<TcpClient, byte> open = new();
    private readonly ConcurrentDictionary<TcpClient, byte> held = new();
    private readonly CancellationTokenSource stopping = new();
    private readonly string targetHost;
    private readonly int targetPort;
    private volatile Mode mode = Mode.Forward;

    public TcpProxy(string targetHost, int targetPort)
    {
        this.targetHost = targetHost;
        this.targetPort = targetPort;
        listener.Start();
        _ = AcceptAsync();
    }

    private enum Mode
    {
        Forward,
        Refuse,
        Blackhole,
    }

    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

    /// <summary>Cuts every connection and refuses new ones.</summary>
    public void Down()
    {
        mode = Mode.Refuse;
        CutAll();
    }

    /// <summary>Cuts every connection; new ones are accepted but never get an answer.</summary>
    public void Blackhole()
    {
        mode = Mode.Blackhole;
        CutAll();
    }

    /// <summary>Forwards again (connections held by the blackhole are closed).</summary>
    public void Up()
    {
        mode = Mode.Forward;
        foreach (var client in held.Keys)
        {
            client.Dispose();
        }

        held.Clear();
    }

    public async ValueTask DisposeAsync()
    {
        await stopping.CancelAsync();
        listener.Stop();
        Down();
        Up();
        stopping.Dispose();
    }

    private void CutAll()
    {
        foreach (var client in open.Keys)
        {
            client.Dispose();
        }

        open.Clear();
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

            switch (mode)
            {
                case Mode.Refuse:
                    incoming.Dispose();
                    break;
                case Mode.Blackhole:
                    held[incoming] = 0;
                    break;
                default:
                    _ = ForwardAsync(incoming);
                    break;
            }
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
