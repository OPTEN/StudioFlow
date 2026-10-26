using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// One mutation of a production in progress: its unit of work, the time, and everything that is published once the
/// changes are committed. Nothing staged here reaches a client when the mutation throws.
/// </summary>
public sealed class MutationContext
{
    private readonly List<StagedEvent> events = [];
    private readonly List<Action> committed = [];
    private readonly List<Func<IRealtimePublisher, Task>> realtime = [];
    private readonly Dictionary<string, SourceLiveMark> liveMarks = new(StringComparer.Ordinal);

    private readonly HostShutdown shutdown;

    internal MutationContext(ProductionRuntime runtime, IUnitOfWork data, DateTimeOffset now, HostShutdown? shutdown = null)
    {
        Runtime = runtime;
        Data = data;
        Now = now;
        this.shutdown = shutdown ?? HostShutdown.None;
    }

    /// <summary>In-memory state of the production.</summary>
    public ProductionRuntime Runtime { get; }

    /// <summary>Repositories of this mutation.</summary>
    public IUnitOfWork Data { get; }

    /// <summary>The time of the mutation (one value for all events).</summary>
    public DateTimeOffset Now { get; }

    /// <summary>The production.</summary>
    public string ProductionId => Runtime.ProductionId;

    /// <summary>
    /// True while the host shuts down (BUG-20): connections that end now are no outage, so source statuses are not
    /// re-evaluated (see <see cref="SourceMonitor.Reevaluate"/>).
    /// </summary>
    public bool IsHostStopping => shutdown.IsStopping;

    internal bool TalliesMayChange { get; private set; }

    internal IReadOnlyList<StagedEvent> Events => events;

    internal IReadOnlyList<Action> Committed => committed;

    internal IReadOnlyList<Func<IRealtimePublisher, Task>> Realtime => realtime;

    internal IReadOnlyCollection<SourceLiveMark> LiveMarks => liveMarks.Values;

    /// <summary>Stages an event; the factory receives the revision assigned after the commit.</summary>
    public void Emit(Func<long, ProductionEvent> factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        events.Add(new StagedEvent(factory, HiddenFromOutput: false));
    }

    /// <summary>
    /// Stages an event that the output page only sees as <c>revisionOnly</c> although its type is public, e.g. a source
    /// whose health changed (GAP-07: the output derives hold and loss from LiveKit alone).
    /// </summary>
    public void EmitHiddenFromOutput(Func<long, ProductionEvent> factory)
    {
        ArgumentNullException.ThrowIfNull(factory);
        events.Add(new StagedEvent(factory, HiddenFromOutput: true));
    }

    /// <summary>Writes an audit entry in the same transaction and emits its log entry, if it has one.</summary>
    public void Audit(string actor, string action, IReadOnlyDictionary<string, string>? details = null)
    {
        var entry = AuditEntry.Create(ProductionId, Now, actor, action, details);
        Data.Audit.Add(entry);
        if (LogTexts.DescribeRecent(entry) is var (code, parameters, text))
        {
            var log = new LogEntryDto(Now, code, parameters, text);
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

    /// <summary>Records that a device source is (or just was) live, so the API can watch it after a restart (GAP-08).</summary>
    public void MarkLive(string sourceId, string deviceId)
    {
        ArgumentException.ThrowIfNullOrEmpty(sourceId);
        ArgumentException.ThrowIfNullOrEmpty(deviceId);
        liveMarks[sourceId] = new SourceLiveMark(sourceId, deviceId);
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

    /// <summary>An event waiting for its revision.</summary>
    /// <param name="Factory">Creates the event for the assigned revision.</param>
    /// <param name="HiddenFromOutput">The output page gets <c>revisionOnly</c> regardless of the event type.</param>
    internal sealed record StagedEvent(Func<long, ProductionEvent> Factory, bool HiddenFromOutput);
}

/// <summary>
/// Serializes all mutations of a production (spec 5): it waits for the production's lock, runs the mutation with a fresh
/// unit of work and commits. Still inside the lock it assigns the revisions, fills the event ring and queues every
/// delivery (events, device messages, tallies) on the production's ordered dispatcher, so clients see them in revision
/// order – but the lock is released without waiting for any client: a slow or dead connection never delays a mutation.
/// </summary>
public sealed class ProductionCoordinator(
    ProductionRuntimeRegistry runtimes,
    IUnitOfWorkFactory data,
    IRealtimeDispatcher dispatcher,
    TimeProvider clock,
    HostShutdown? shutdown = null)
{
    private readonly HostShutdown hostShutdown = shutdown ?? HostShutdown.None;

    /// <summary>True once the host began to stop (BUG-20, OBS-01): disconnects are no outage then.</summary>
    public bool IsHostStopping => hostShutdown.IsStopping;

    /// <summary>Runs a mutation (or a consistent read) of a production; unknown productions are <c>not_found</c>.</summary>
    public async Task<T> ExecuteAsync<T>(string productionId, Func<MutationContext, Task<T>> mutation, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(mutation);
        var runtime = await GetRuntimeAsync(productionId, cancellationToken);
        await runtime.Gate.WaitAsync(cancellationToken);
        try
        {
            await using var unit = data.Create();
            var context = new MutationContext(runtime, unit, clock.StorageNow(), hostShutdown);
            var result = await mutation(context);

            // Once the mutation decided, finish it even if the caller goes away: a half-applied change is worse.
            if (context.LiveMarks.Count > 0)
            {
                await unit.SourceActivity.MarkLiveAsync(productionId, context.LiveMarks, context.Now, CancellationToken.None);
            }

            await unit.SaveChangesAsync(CancellationToken.None);
            Flush(context);
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

    /// <summary>Queues a delivery behind everything already queued for the production (outside a mutation).</summary>
    public void Send(string productionId, Func<IRealtimePublisher, Task> delivery) => dispatcher.Enqueue(productionId, delivery);

    /// <summary>The runtime of an existing production; checks the database for productions not seen yet.</summary>
    private async Task<ProductionRuntime> GetRuntimeAsync(string productionId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(productionId))
        {
            throw StudioFlowException.NotFound("Production");
        }

        if (runtimes.Find(productionId) is { } known)
        {
            return known;
        }

        await using var unit = data.Create();
        if (!await unit.Productions.ExistsAsync(productionId, cancellationToken))
        {
            throw StudioFlowException.NotFound("Production");
        }

        return runtimes.GetOrAdd(productionId);
    }

    /// <summary>Applies the committed in-memory changes and queues the deliveries; runs inside the lock and never waits.</summary>
    private void Flush(MutationContext context)
    {
        foreach (var action in context.Committed)
        {
            action();
        }

        var runtime = context.Runtime;
        var productionId = runtime.ProductionId;
        foreach (var staged in context.Events)
        {
            var studioEvent = staged.Factory(runtime.NextRevision());
            var outputEvent = staged.HiddenFromOutput ? new RevisionOnlyEvent(studioEvent.Revision) : OutputView.ForOutput(studioEvent);
            runtime.Events.Add(new RecordedEvent(studioEvent, outputEvent));
            dispatcher.Enqueue(productionId, p => p.PublishEventAsync(productionId, studioEvent, outputEvent));
        }

        foreach (var action in context.Realtime)
        {
            dispatcher.Enqueue(productionId, action);
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
                    dispatcher.Enqueue(productionId, p => p.SendTallyAsync(connectionId, tally));
                }
            }
        }
    }

    private static bool SameTally(TallyDto tally, TallyDto? previous) =>
        previous is not null && previous.Overall == tally.Overall && previous.Slots.Count == tally.Slots.Count
        && tally.Slots.All(s => previous.Slots.TryGetValue(s.Key, out var state) && state == s.Value);
}
