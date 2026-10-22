using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Opten.FlowStudio.Core.Application.Ports;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>
/// Hands realtime deliveries (events, tallies, device messages, aborts) to the clients in the order they were queued per
/// production, without making the caller wait for any client. The coordinator queues inside the production lock, so the
/// queue order is the revision order.
/// </summary>
public interface IRealtimeDispatcher
{
    /// <summary>Queues a delivery behind every earlier delivery of the production; never blocks and never throws for client errors.</summary>
    void Enqueue(string productionId, Func<IRealtimePublisher, Task> delivery);

    /// <summary>Completes once every delivery queued so far for the production was handed over (tests, diagnostics).</summary>
    Task WhenIdleAsync(string productionId, CancellationToken cancellationToken);
}

/// <summary>
/// One unbounded queue per production, drained by a single task: deliveries leave strictly in queue order, and a
/// mutation only appends to the queue. A delivery that takes longer than <c>Realtime:DeliveryWait</c> (a publisher that
/// waits for a slow client) no longer holds up the following ones: the dispatcher moves on and the slow delivery
/// finishes in the background. The SignalR publisher buffers per connection, so a single stuck client cannot delay the
/// others in the first place; the wait bound is the second line of defence.
/// </summary>
public sealed class OrderedRealtimeDispatcher(
    IRealtimePublisher publisher,
    RealtimeOptions options,
    TimeProvider clock,
    ILogger<OrderedRealtimeDispatcher> logger) : IRealtimeDispatcher, IAsyncDisposable
{
    private static readonly TimeSpan ShutdownWait = TimeSpan.FromSeconds(5);

    private readonly ConcurrentDictionary<string, Lane> lanes = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource stopping = new();
    private int disposed;

    /// <inheritdoc />
    public void Enqueue(string productionId, Func<IRealtimePublisher, Task> delivery)
    {
        ArgumentException.ThrowIfNullOrEmpty(productionId);
        ArgumentNullException.ThrowIfNull(delivery);
        var lane = lanes.GetOrAdd(productionId, static id => new Lane(id));
        if (!lane.Queue.Writer.TryWrite(delivery))
        {
            // Only after shutdown: nobody is listening any more.
            logger.LogDebug("Realtime delivery for {ProductionId} dropped during shutdown", productionId);
            return;
        }

        if (lane.TryStart())
        {
            lane.Drain = Task.Run(() => DrainAsync(lane));
        }
    }

    /// <inheritdoc />
    public async Task WhenIdleAsync(string productionId, CancellationToken cancellationToken)
    {
        var idle = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Enqueue(productionId, _ =>
        {
            idle.TrySetResult();
            return Task.CompletedTask;
        });
        await idle.Task.WaitAsync(cancellationToken);
    }

    /// <summary>Stops accepting deliveries and lets the queues drain for a few seconds (host shutdown); safe to call twice.</summary>
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 1)
        {
            return;
        }

        foreach (var lane in lanes.Values)
        {
            lane.Queue.Writer.TryComplete();
        }

        var drains = lanes.Values.Select(l => l.Drain).OfType<Task>().ToArray();
        try
        {
            await Task.WhenAll(drains).WaitAsync(ShutdownWait, clock);
        }
        catch (TimeoutException)
        {
            logger.LogDebug("Realtime queues did not drain within {Wait}", ShutdownWait);
        }
        finally
        {
            await stopping.CancelAsync();
            stopping.Dispose();
        }
    }

    private async Task DrainAsync(Lane lane)
    {
        // Taken once while the source is alive: the token stays usable after the source is disposed at shutdown.
        var stoppingToken = stopping.Token;
        await foreach (var delivery in lane.Queue.Reader.ReadAllAsync())
        {
            Task pending;
            try
            {
                pending = delivery(publisher);
            }
            catch (Exception exception) when (exception is not OutOfMemoryException)
            {
                // A failing client send must never undo a committed change or stop the queue.
                logger.LogWarning(exception, "Realtime delivery for {ProductionId} failed", lane.ProductionId);
                continue;
            }

            if (pending.IsCompleted)
            {
                LogFailure(pending, lane.ProductionId);
                continue;
            }

            try
            {
                await pending.WaitAsync(options.DeliveryWait, clock, stoppingToken);
            }
            catch (TimeoutException)
            {
                logger.LogWarning("Realtime delivery for {ProductionId} took longer than {Wait}; the next ones go out meanwhile", lane.ProductionId, options.DeliveryWait);
                _ = pending.ContinueWith(t => LogFailure(t, lane.ProductionId), CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception) when (exception is not OutOfMemoryException)
            {
                logger.LogWarning(exception, "Realtime delivery for {ProductionId} failed", lane.ProductionId);
            }
        }
    }

    private void LogFailure(Task delivery, string productionId)
    {
        if (delivery.IsFaulted)
        {
            logger.LogWarning(delivery.Exception?.GetBaseException(), "Realtime delivery for {ProductionId} failed", productionId);
        }
    }

    /// <summary>The queue of one production.</summary>
    private sealed class Lane(string productionId)
    {
        public string ProductionId { get; } = productionId;

        public Channel<Func<IRealtimePublisher, Task>> Queue { get; } = Channel.CreateUnbounded<Func<IRealtimePublisher, Task>>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
            AllowSynchronousContinuations = false,
        });

        private int started;

        public Task? Drain { get; set; }

        /// <summary>True exactly once: for the caller that has to start the drain task.</summary>
        public bool TryStart() => Interlocked.CompareExchange(ref started, 1, 0) == 0;
    }
}
