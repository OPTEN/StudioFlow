using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Tests.Application;

/// <summary>The ordered dispatcher between the production lock and the clients (mutations never wait for SignalR).</summary>
public sealed class RealtimeDispatcherTests : IAsyncDisposable
{
    private static readonly TimeSpan Generous = TimeSpan.FromSeconds(10);

    private readonly GatedPublisher publisher = new();
    private readonly InMemoryData data = new();
    private readonly Production production = Production.Create("Webinar", "webinar", isActive: true, Build.T0);
    private readonly ProductionRuntimeRegistry runtimes = new(TimeProvider.System);
    private readonly PairingRequestStore requests = new();
    private OrderedRealtimeDispatcher dispatcher;
    private ProductionCoordinator coordinator;
    private ProductionService productions;

    public RealtimeDispatcherTests()
    {
        data.Productions.Add(production);
        (dispatcher, coordinator, productions) = Create(TimeSpan.FromSeconds(30));
    }

    [Fact]
    public async Task Mutations_PublisherBlocked_CompleteAtOnceAndEventsKeepRevisionOrder()
    {
        publisher.BlockFirstEvent();
        var watch = Stopwatch.StartNew();

        for (var i = 0; i < 20; i++)
        {
            await productions.UpdateAsync(production.Id, new UpdateProductionRequest($"Name {i}", null, null), CancellationToken.None);
        }

        var mutationTime = watch.Elapsed;
        Assert.True(mutationTime < TimeSpan.FromSeconds(2), $"20 mutations took {mutationTime} while the publisher was blocked");
        await publisher.FirstEventStarted.WaitAsync(Generous, TestContext.Current.CancellationToken);
        Assert.Single(publisher.Started);

        publisher.Release();
        await dispatcher.WhenIdleAsync(production.Id, CancellationToken.None).WaitAsync(Generous, TestContext.Current.CancellationToken);

        var revisions = publisher.Completed.ToArray();
        Assert.Equal(20, revisions.Length);
        Assert.Equal(revisions.Order(), revisions);
        Assert.Equal(Enumerable.Range(0, 20).Select(i => revisions[0] + i), revisions);
        Assert.Equal(runtimes.Find(production.Id)!.Revision, revisions[^1]);
    }

    [Fact]
    public async Task Deliveries_OneNeverCompletes_TheFollowingGoOutInOrderAfterTheWaitBound()
    {
        await dispatcher.DisposeAsync();
        (dispatcher, coordinator, productions) = Create(TimeSpan.FromMilliseconds(100));
        publisher.BlockFirstEvent();

        for (var i = 0; i < 5; i++)
        {
            await productions.UpdateAsync(production.Id, new UpdateProductionRequest($"Name {i}", null, null), CancellationToken.None);
        }

        await dispatcher.WhenIdleAsync(production.Id, CancellationToken.None).WaitAsync(Generous, TestContext.Current.CancellationToken);

        var started = publisher.Started.ToArray();
        Assert.Equal(5, started.Length);
        Assert.Equal(started.Order(), started);
        Assert.Equal(4, publisher.Completed.Count);
        publisher.Release();
    }

    [Fact]
    public async Task Tallies_AfterEachSwitch_FollowTheirEventInOrder()
    {
        var log = new CallLog();
        await dispatcher.DisposeAsync();
        dispatcher = new OrderedRealtimeDispatcher(log, new RealtimeOptions(), TimeProvider.System, NullLogger<OrderedRealtimeDispatcher>.Instance);
        coordinator = new ProductionCoordinator(runtimes, data, dispatcher, TimeProvider.System);
        var snapshots = new SnapshotBuilder(requests, new FlowStudioOptions());
        productions = new ProductionService(coordinator, data, snapshots, new FakeTokens(), requests, TimeProvider.System);
        var pairing = new PairingService(coordinator, data, requests, new FlowStudioOptions(), new PairingOptions(), TimeProvider.System);
        var kicker = new LiveKitKicker(new FakeRoomClient(), NullLogger<LiveKitKicker>.Instance);
        var devices = new DeviceSessionService(coordinator, data, runtimes, new FakeTokens(), kicker, new SourceMonitorOptions());
        var scenes = new SceneService(coordinator);

        var invite = await pairing.GetPhoneInviteAsync(production.Id, CancellationToken.None);
        var credentials = await pairing.RedeemAsync(invite.Url[(invite.Url.LastIndexOf('/') + 1)..], new RedeemInviteRequest("client", null, DeviceKind.Phone, "p"), CancellationToken.None);
        var identity = new DeviceIdentity(credentials.DeviceId, production.Id, false);
        await devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "p", "1"), CancellationToken.None);
        var program = production.OrderedScenes[0].Id;
        var other = production.OrderedScenes[1].Id;
        await scenes.AddItemAsync(production.Id, program, Build.Add($"{credentials.DeviceId}/camera"), CancellationToken.None);
        await productions.StartBroadcastAsync(production.Id, CancellationToken.None);
        for (var i = 0; i < 6; i++)
        {
            await productions.SwitchProgramAsync(production.Id, new SwitchProgramRequest(i % 2 == 0 ? other : program, Transitions.Cut), CancellationToken.None);
        }

        await dispatcher.WhenIdleAsync(production.Id, CancellationToken.None).WaitAsync(Generous, TestContext.Current.CancellationToken);

        var calls = log.Calls.ToList();
        var tallies = calls.Select((call, index) => (call, index)).Where(c => c.call.StartsWith("tally:", StringComparison.Ordinal)).ToList();
        Assert.Equal(["tally:program", "tally:off", "tally:program", "tally:off", "tally:program", "tally:off", "tally:program"], tallies.Select(t => t.call));
        foreach (var (_, index) in tallies)
        {
            // Every tally follows the event of the mutation that changed it.
            Assert.StartsWith("event:", calls[index - 1], StringComparison.Ordinal);
        }

        var revisions = calls.Where(c => c.StartsWith("event:", StringComparison.Ordinal)).Select(c => long.Parse(c.Split(':')[1], System.Globalization.CultureInfo.InvariantCulture)).ToList();
        Assert.Equal(revisions.Order(), revisions);
    }

    public async ValueTask DisposeAsync()
    {
        publisher.Release();
        await dispatcher.DisposeAsync();
        runtimes.Dispose();
        productions.Dispose();
    }

    private (OrderedRealtimeDispatcher, ProductionCoordinator, ProductionService) Create(TimeSpan deliveryWait)
    {
        var created = new OrderedRealtimeDispatcher(publisher, new RealtimeOptions { DeliveryWait = deliveryWait }, TimeProvider.System, NullLogger<OrderedRealtimeDispatcher>.Instance);
        var newCoordinator = new ProductionCoordinator(runtimes, data, created, TimeProvider.System);
        var service = new ProductionService(newCoordinator, data, new SnapshotBuilder(requests, new FlowStudioOptions()), new FakeTokens(), requests, TimeProvider.System);
        return (created, newCoordinator, service);
    }

    /// <summary>A publisher whose first event delivery hangs until released (a client that does not read).</summary>
    private sealed class GatedPublisher : IRealtimePublisher
    {
        private readonly TaskCompletionSource gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource firstStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int blockFirst;

        public ConcurrentQueue<long> Started { get; } = new();

        public ConcurrentQueue<long> Completed { get; } = new();

        public Task FirstEventStarted => firstStarted.Task;

        public void BlockFirstEvent() => blockFirst = 1;

        public void Release() => gate.TrySetResult();

        public async Task PublishEventAsync(string productionId, ProductionEvent studioEvent, ProductionEvent outputEvent)
        {
            Started.Enqueue(studioEvent.Revision);
            if (Interlocked.Exchange(ref blockFirst, 0) == 1)
            {
                firstStarted.TrySetResult();
                await gate.Task;
            }

            Completed.Enqueue(studioEvent.Revision);
        }

        public Task JoinStudioAsync(string connectionId, string productionId) => Task.CompletedTask;

        public Task LeaveStudioAsync(string connectionId, string productionId) => Task.CompletedTask;

        public Task JoinOutputAsync(string connectionId, string productionId) => Task.CompletedTask;

        public Task PublishTelemetryAsync(string productionId, DeviceTelemetryMessage message) => Task.CompletedTask;

        public Task PublishPresenceAsync(string productionId, int operatorsOnline) => Task.CompletedTask;

        public Task RequestStudioResyncAsync(string activeProductionId) => Task.CompletedTask;

        public Task SendTallyAsync(string connectionId, TallyDto tally) => Task.CompletedTask;

        public Task SendSelfAsync(string connectionId, DeviceSelfDto self) => Task.CompletedTask;

        public Task SendCommandAsync(string connectionId, DeviceCommandDto command) => Task.CompletedTask;

        public Task SendSessionReplacedAsync(string connectionId) => Task.CompletedTask;

        public void Abort(string connectionId)
        {
        }

        public void AbortAfterDelivery(string connectionId)
        {
        }
    }

    /// <summary>One ordered log of every event and tally delivery.</summary>
    private sealed class CallLog : IRealtimePublisher
    {
        public ConcurrentQueue<string> Calls { get; } = new();

        public Task PublishEventAsync(string productionId, ProductionEvent studioEvent, ProductionEvent outputEvent)
        {
            Calls.Enqueue($"event:{studioEvent.Revision}");
            return Task.CompletedTask;
        }

        public Task SendTallyAsync(string connectionId, TallyDto tally)
        {
            Calls.Enqueue("tally:" + tally.Overall switch { TallyState.Program => "program", TallyState.Preview => "preview", _ => "off" });
            return Task.CompletedTask;
        }

        public Task JoinStudioAsync(string connectionId, string productionId) => Task.CompletedTask;

        public Task LeaveStudioAsync(string connectionId, string productionId) => Task.CompletedTask;

        public Task JoinOutputAsync(string connectionId, string productionId) => Task.CompletedTask;

        public Task PublishTelemetryAsync(string productionId, DeviceTelemetryMessage message) => Task.CompletedTask;

        public Task PublishPresenceAsync(string productionId, int operatorsOnline) => Task.CompletedTask;

        public Task RequestStudioResyncAsync(string activeProductionId) => Task.CompletedTask;

        public Task SendSelfAsync(string connectionId, DeviceSelfDto self) => Task.CompletedTask;

        public Task SendCommandAsync(string connectionId, DeviceCommandDto command) => Task.CompletedTask;

        public Task SendSessionReplacedAsync(string connectionId) => Task.CompletedTask;

        public void Abort(string connectionId)
        {
        }

        public void AbortAfterDelivery(string connectionId)
        {
        }
    }
}
