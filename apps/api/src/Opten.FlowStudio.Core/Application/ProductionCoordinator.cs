using Microsoft.Extensions.Logging;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application;

/// <summary>
/// One mutation of a production in progress: its unit of work, the time, and everything that is published once the
/// changes are committed. Nothing staged here reaches a client when the mutation throws.
/// </summary>
public sealed class MutationContext
{
    private readonly List<Func<long, ProductionEvent>> events = [];
    private readonly List<Action> committed = [];
    private readonly List<Func<IRealtimePublisher, Task>> realtime = [];

    internal MutationContext(ProductionRuntime runtime, IUnitOfWork data, DateTimeOffset now)
    {
        Runtime = runtime;
        Data = data;
        Now = now;
    }

    /// <summary>In-memory state of the production.</summary>
    public ProductionRuntime Runtime { get; }

    /// <summary>Repositories of this mutation.</summary>
    public IUnitOfWork Data { get; }

    /// <summary>The time of the mutation (one value for all events).</summary>
    public DateTimeOffset Now { get; }

    /// <summary>The production.</summary>
    public string ProductionId => Runtime.ProductionId;

    internal bool TalliesMayChange { get; private set; }

    internal IReadOnlyList<Func<long, ProductionEvent>> Events => events;

    internal IReadOnlyList<Action> Committed => committed;

    internal IReadOnlyList<Func<IRealtimePublisher, Task>> Realtime => realtime;

    /// <summary>Stages an event; the factory receives the revision assigned after the commit.</summary>
    public void Emit(Func<long, ProductionEvent> factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        events.Add(factory);
    }

    /// <summary>Writes an audit entry in the same transaction and emits its log text, if it has one.</summary>
    public void Audit(string actor, string action, IReadOnlyDictionary<string, string>? details = null)
    {
        var entry = AuditEntry.Create(ProductionId, Now, actor, action, details);
        Data.Audit.Add(entry);
        if (LogTexts.For(entry) is { } text)
        {
            var log = new LogEntryDto(Now, text);
            Emit(revision => new LogAppendedEvent(revision, log));
        }
    }

    /// <summary>Runs an in-memory change only after the database commit succeeded.</summary>
    public void OnCommitted(Action action)
    {
        ArgumentNullException.ThrowIfNull(action);
        committed.Add(action);
    }

    /// <summary>Sends something to clients after the events (device messages, aborts).</summary>
    public void Send(Func<IRealtimePublisher, Task> action)
    {
        ArgumentNullException.ThrowIfNull(action);
        realtime.Add(action);
    }

    /// <summary>Updates what is on air after the commit and pushes changed tallies to connected devices.</summary>
    public void UpdateOnAir(Production production)
    {
        var state = OnAirState.From(production);
        OnCommitted(() => Runtime.OnAir = state);
        TalliesMayChange = true;
    }

    /// <summary>Pushes changed tallies to connected devices (slots of a device changed).</summary>
    public void RefreshTallies() => TalliesMayChange = true;
}

/// <summary>
/// Serializes all mutations of a production (spec 5): it waits for the production's lock, runs the mutation with a fresh
/// unit of work, commits, assigns revisions and publishes the events inside the lock, so clients see them in order.
/// </summary>
public sealed class ProductionCoordinator(
    ProductionRuntimeRegistry runtimes,
    IUnitOfWorkFactory data,
    IRealtimePublisher realtime,
    TimeProvider clock,
    ILogger<ProductionCoordinator> logger)
{
    /// <summary>Runs a mutation (or a consistent read) of a production; unknown productions are <c>not_found</c>.</summary>
    public async Task<T> ExecuteAsync<T>(string productionId, Func<MutationContext, Task<T>> mutation, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(mutation);
        var runtime = await GetRuntimeAsync(productionId, cancellationToken);
        await runtime.Gate.WaitAsync(cancellationToken);
        try
        {
            await using var unit = data.Create();
            var context = new MutationContext(runtime, unit, clock.StorageNow());
            var result = await mutation(context);

            // Once the mutation decided, finish it even if the caller goes away: a half-applied change is worse.
            await unit.SaveChangesAsync(CancellationToken.None);
            await FlushAsync(context);
            return result;
        }
        finally
        {
            runtime.Gate.Release();
        }
    }

    /// <summary>Runs a mutation without a result.</summary>
    public Task ExecuteAsync(string productionId, Func<MutationContext, Task> mutation, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(mutation);
        return ExecuteAsync<bool>(
            productionId,
            async context =>
            {
                await mutation(context);
                return true;
            },
            cancellationToken);
    }

    /// <summary>The runtime of an existing production; checks the database for productions not seen yet.</summary>
    private async Task<ProductionRuntime> GetRuntimeAsync(string productionId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(productionId))
        {
            throw FlowStudioException.NotFound("Die Produktion");
        }

        if (runtimes.Find(productionId) is { } known)
        {
            return known;
        }

        await using var unit = data.Create();
        if (!await unit.Productions.ExistsAsync(productionId, cancellationToken))
        {
            throw FlowStudioException.NotFound("Die Produktion");
        }

        return runtimes.GetOrAdd(productionId);
    }

    private async Task FlushAsync(MutationContext context)
    {
        foreach (var action in context.Committed)
        {
            action();
        }

        var runtime = context.Runtime;
        foreach (var factory in context.Events)
        {
            var productionEvent = factory(runtime.NextRevision());
            runtime.Events.Add(productionEvent);
            await SendSafelyAsync(p => p.PublishEventAsync(runtime.ProductionId, productionEvent, OutputView.ForOutput(productionEvent)));
        }

        foreach (var action in context.Realtime)
        {
            await SendSafelyAsync(action);
        }

        if (context.TalliesMayChange && runtime.OnAir is { } onAir)
        {
            foreach (var device in runtime.Devices.Where(d => d.ConnectionId is not null))
            {
                var tally = onAir.TallyFor(device.DeviceId, device.Slots);
                if (!SameTally(tally, device.LastTally))
                {
                    device.LastTally = tally;
                    var connectionId = device.ConnectionId!;
                    await SendSafelyAsync(p => p.SendTallyAsync(connectionId, tally));
                }
            }
        }
    }

    private async Task SendSafelyAsync(Func<IRealtimePublisher, Task> action)
    {
        try
        {
            await action(realtime);
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // A failing client send must never undo or block a committed change.
            logger.LogWarning(exception, "Realtime delivery failed");
        }
    }

    private static bool SameTally(TallyDto tally, TallyDto? previous) =>
        previous is not null && previous.Overall == tally.Overall && previous.Slots.Count == tally.Slots.Count
        && tally.Slots.All(s => previous.Slots.TryGetValue(s.Key, out var state) && state == s.Value);
}
