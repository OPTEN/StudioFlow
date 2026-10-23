using System.Threading.Channels;
using Microsoft.AspNetCore.SignalR.Client;

namespace Opten.StudioFlow.Web.Tests.Support;

/// <summary>Creates probes.</summary>
public static class HubProbe
{
    /// <summary>Starts collecting <paramref name="method"/> messages of <paramref name="connection"/>.</summary>
    public static HubProbe<T> On<T>(HubConnection connection, string method)
    {
        ArgumentNullException.ThrowIfNull(connection);
        var probe = new HubProbe<T>();
        connection.On<T>(method, probe.Add);
        return probe;
    }
}

/// <summary>Collects messages of one hub method and waits for matching ones.</summary>
public sealed class HubProbe<T>
{
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(15);
    private readonly Channel<T> messages = Channel.CreateUnbounded<T>();

    internal void Add(T message) => messages.Writer.TryWrite(message);

    /// <summary>The next message that matches, skipping others; fails after the timeout.</summary>
    public async Task<T> NextAsync(Func<T, bool>? match = null, TimeSpan? timeout = null)
    {
        using var cancellation = new CancellationTokenSource(timeout ?? DefaultTimeout);
        try
        {
            while (true)
            {
                var message = await messages.Reader.ReadAsync(cancellation.Token);
                if (match is null || match(message))
                {
                    return message;
                }
            }
        }
        catch (OperationCanceledException)
        {
            Assert.Fail($"No matching {typeof(T).Name} message within {(timeout ?? DefaultTimeout).TotalSeconds} s.");
            throw;
        }
    }

    /// <summary>True when no message arrives within <paramref name="wait"/>.</summary>
    public async Task<bool> StaysQuietAsync(TimeSpan wait)
    {
        using var cancellation = new CancellationTokenSource(wait);
        try
        {
            await messages.Reader.ReadAsync(cancellation.Token);
            return false;
        }
        catch (OperationCanceledException)
        {
            return true;
        }
    }

    /// <summary>Removes buffered messages.</summary>
    public void Clear()
    {
        while (messages.Reader.TryRead(out _))
        {
        }
    }
}

/// <summary>Completes when a hub connection closes.</summary>
public static class HubClosed
{
    public static Task<Exception?> Watch(HubConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);
        var closed = new TaskCompletionSource<Exception?>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.Closed += error =>
        {
            closed.TrySetResult(error);
            return Task.CompletedTask;
        };
        return closed.Task;
    }
}
