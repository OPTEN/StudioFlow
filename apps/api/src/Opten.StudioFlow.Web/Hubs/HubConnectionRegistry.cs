using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR;
using Opten.StudioFlow.Core.Application;

namespace Opten.StudioFlow.Web.Hubs;

/// <summary>
/// The live hub connections of all three hubs. Every connection has its own ordered outbox with a bounded length
/// (<c>Realtime:ConnectionQueueLimit</c>): messages leave in the order they were queued, one at a time, so a slow or
/// stuck client only delays itself – never the other clients and never the dispatcher that feeds the outboxes. A client
/// that falls behind by more than the limit is disconnected and resubscribes (delta or snapshot). Groups (Regie and
/// output of a production) are kept here as well, so a group message is one outbox entry per member.
/// </summary>
public sealed class HubConnectionRegistry(RealtimeOptions options, TimeProvider clock, ILogger<HubConnectionRegistry> logger)
{
    /// <summary>Group of every Regie connection (for <c>resync</c>).</summary>
    public const string AllStudios = "studio:*";

    private readonly ConcurrentDictionary<string, Connection> connections = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> groups = new(StringComparer.Ordinal);

    /// <summary>Number of open connections (diagnostics, tests).</summary>
    public int Count => connections.Count;

    /// <summary>True while <paramref name="connectionId"/> is registered, i.e. not closed or aborted yet (diagnostics, tests).</summary>
    public bool IsOpen(string connectionId) => connections.ContainsKey(connectionId);

    /// <summary>Tracks a connection; <paramref name="sessionId"/> is the admin session of a Regie connection (logout closes it).</summary>
    public void Register(HubCallerContext context, string? sessionId = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        var connection = new Connection(context, sessionId, options.ConnectionQueueLimit);
        connections[context.ConnectionId] = connection;
        connection.Start(PumpAsync);
    }

    /// <summary>Forgets a closed connection and drops what was still queued for it.</summary>
    public void Unregister(string connectionId)
    {
        if (connections.TryRemove(connectionId, out var connection))
        {
            Close(connection);
        }
    }

    /// <summary>Adds an open connection to a group; closed or unknown connections are ignored.</summary>
    public void Join(string group, string connectionId)
    {
        if (!connections.TryGetValue(connectionId, out var connection))
        {
            return;
        }

        connection.AddGroup(group);
        groups.GetOrAdd(group, static _ => new ConcurrentDictionary<string, byte>(StringComparer.Ordinal))[connectionId] = 0;
    }

    /// <summary>Removes a connection from a group.</summary>
    public void Leave(string group, string connectionId)
    {
        if (groups.TryGetValue(group, out var members))
        {
            members.TryRemove(connectionId, out _);
        }

        if (connections.TryGetValue(connectionId, out var connection))
        {
            connection.RemoveGroup(group);
        }
    }

    /// <summary>Queues a message for every member of a group (one outbox entry each, never waiting for a client).</summary>
    public void SendToGroup(string group, Func<string, Task> send)
    {
        ArgumentNullException.ThrowIfNull(send);
        if (!groups.TryGetValue(group, out var members))
        {
            return;
        }

        foreach (var connectionId in members.Keys)
        {
            if (connections.TryGetValue(connectionId, out var connection))
            {
                Enqueue(connection, () => send(connectionId));
            }
            else
            {
                // A join that raced with the disconnect: forget the stale member.
                members.TryRemove(connectionId, out _);
            }
        }
    }

    /// <summary>Queues a message for one connection; closed or unknown connections are ignored.</summary>
    public void Send(string connectionId, Func<Task> send)
    {
        ArgumentNullException.ThrowIfNull(send);
        if (connections.TryGetValue(connectionId, out var connection))
        {
            Enqueue(connection, send);
        }
    }

    /// <summary>Aborts a connection at once (stale session, rotated output key, forbidden address, logout).</summary>
    public void Abort(string connectionId)
    {
        if (connections.TryRemove(connectionId, out var connection))
        {
            Close(connection);
            connection.Context.Abort();
        }
    }

    /// <summary>
    /// Aborts a connection after the messages queued before have been written and the client had
    /// <c>Realtime:DeliveryGrace</c> to receive them (final <c>self</c>, <c>sessionReplaced</c>): a client that never
    /// sees <c>sessionReplaced</c> would reconnect and take the session back.
    /// </summary>
    public void AbortAfterDelivery(string connectionId)
    {
        if (!connections.TryGetValue(connectionId, out var connection))
        {
            return;
        }

        Enqueue(connection, () =>
        {
            _ = AbortLaterAsync(connectionId);
            return Task.CompletedTask;
        });
    }

    /// <summary>
    /// Aborts every connection (host shutdown, OBS-01): the clients reconnect to the restarted API at once, and Kestrel
    /// does not wait for long-lived WebSocket and long-polling requests until the shutdown timeout. Returns how many
    /// connections were closed.
    /// </summary>
    public int AbortAll()
    {
        var closed = 0;
        foreach (var connectionId in connections.Keys.ToList())
        {
            if (connections.ContainsKey(connectionId))
            {
                Abort(connectionId);
                closed++;
            }
        }

        return closed;
    }

    /// <summary>Aborts every Regie connection of an admin session (logout, GAP-04); returns how many were closed.</summary>
    public int AbortSession(string sessionId)
    {
        var closed = 0;
        foreach (var connection in connections.Values.Where(c => string.Equals(c.SessionId, sessionId, StringComparison.Ordinal)).ToList())
        {
            Abort(connection.Context.ConnectionId);
            closed++;
        }

        return closed;
    }

    private void Enqueue(Connection connection, Func<Task> send)
    {
        if (connection.TryEnqueue(send))
        {
            return;
        }

        if (connections.ContainsKey(connection.Context.ConnectionId))
        {
            logger.LogWarning("Hub connection {ConnectionId} fell more than {Limit} messages behind and is closed; the client resubscribes", connection.Context.ConnectionId, options.ConnectionQueueLimit);
            Abort(connection.Context.ConnectionId);
        }
    }

    private void Close(Connection connection)
    {
        connection.Complete();
        foreach (var group in connection.TakeGroups())
        {
            if (groups.TryGetValue(group, out var members))
            {
                members.TryRemove(connection.Context.ConnectionId, out _);
            }
        }
    }

    private async Task AbortLaterAsync(string connectionId)
    {
        try
        {
            await Task.Delay(options.DeliveryGrace, clock);
        }
        finally
        {
            Abort(connectionId);
        }
    }

    private async Task PumpAsync(Connection connection)
    {
        await foreach (var send in connection.Reader.ReadAllAsync())
        {
            try
            {
                await send();
            }
            catch (Exception exception) when (exception is not OutOfMemoryException)
            {
                // A closed or broken connection: the client resubscribes after its reconnect.
                logger.LogDebug(exception, "Hub message to {ConnectionId} failed", connection.Context.ConnectionId);
            }
        }
    }

    /// <summary>One open hub connection with its outbox and groups.</summary>
    private sealed class Connection(HubCallerContext context, string? sessionId, int queueLimit)
    {
        private readonly Channel<Func<Task>> outbox = Channel.CreateBounded<Func<Task>>(new BoundedChannelOptions(queueLimit)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.Wait,
            AllowSynchronousContinuations = false,
        });

        private readonly HashSet<string> memberships = new(StringComparer.Ordinal);
        private readonly Lock gate = new();

        public HubCallerContext Context { get; } = context;

        public string? SessionId { get; } = sessionId;

        public ChannelReader<Func<Task>> Reader => outbox.Reader;

        /// <summary>False when the outbox is full or closed (TryWrite never waits).</summary>
        public bool TryEnqueue(Func<Task> send) => outbox.Writer.TryWrite(send);

        public void Start(Func<Connection, Task> pump) => _ = Task.Run(() => pump(this));

        public void Complete() => outbox.Writer.TryComplete();

        public void AddGroup(string group)
        {
            lock (gate)
            {
                memberships.Add(group);
            }
        }

        public void RemoveGroup(string group)
        {
            lock (gate)
            {
                memberships.Remove(group);
            }
        }

        public string[] TakeGroups()
        {
            lock (gate)
            {
                var all = memberships.ToArray();
                memberships.Clear();
                return all;
            }
        }
    }
}
