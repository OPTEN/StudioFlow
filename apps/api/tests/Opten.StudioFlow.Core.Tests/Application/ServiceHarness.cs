using Microsoft.Extensions.Logging.Abstractions;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>The application services wired with in-memory fakes and a manual clock.</summary>
internal sealed class ServiceHarness : IDisposable
{
    public ServiceHarness(PairingOptions? pairing = null, HostShutdown? shutdown = null)
    {
        PairingOptions = pairing ?? new PairingOptions();
        Production = Core.Domain.Production.Create("Webinar", "webinar", isActive: true, Clock.Now);
        Data.Productions.Add(Production);
        Link = OutputLink.Create(Production.Id, OutputLink.DefaultName, [], Clock.Now);
        Data.OutputLinks.Add(Link);
        Requests = new PairingRequestStore(PairingOptions);
        Runtimes = new ProductionRuntimeRegistry(Clock);
        Coordinator = new ProductionCoordinator(Runtimes, Data, new InlineDispatcher(Publisher), Clock, shutdown);
        Snapshots = new SnapshotBuilder(Requests, Options);
        var kicker = new LiveKitKicker(Rooms, NullLogger<LiveKitKicker>.Instance);
        Productions = new ProductionService(Coordinator, Data, Snapshots, new FakeTokens(), Requests, Clock);
        Scenes = new SceneService(Coordinator);
        DeviceAdmin = new DeviceAdminService(Coordinator, kicker, SourceOptions);
        Texts = new TextService(Coordinator);
        Devices = new DeviceSessionService(Coordinator, Data, Runtimes, new FakeTokens(), kicker, SourceOptions);
        Pairing = new PairingService(Coordinator, Data, Requests, Options, PairingOptions, Clock);
        Outputs = new OutputService(Coordinator, Data, Runtimes, new FakeTokens(), kicker, Options);
        LiveKit = new LiveKitSyncService(Coordinator, Data, Runtimes, Rooms, kicker, NullLogger<LiveKitSyncService>.Instance);
        Studio = new StudioSessionService(Coordinator, Snapshots);
        RestartWatch = new SourceRestartWatch(Coordinator, Data, Runtimes, SourceOptions, Clock);
    }

    public ManualClock Clock { get; } = new();

    public PairingOptions PairingOptions { get; }

    public SourceMonitorOptions SourceOptions { get; } = new();

    public SourceRestartWatch RestartWatch { get; }

    public InMemoryData Data { get; } = new();

    public RecordingPublisher Publisher { get; } = new();

    public FakeRoomClient Rooms { get; } = new();

    public PairingRequestStore Requests { get; }

    public StudioFlowOptions Options { get; } = new() { PublicBaseUrl = "https://sf.example" };

    public Production Production { get; }

    /// <summary>The link every production starts with.</summary>
    public OutputLink Link { get; }

    public ProductionRuntimeRegistry Runtimes { get; }

    public ProductionCoordinator Coordinator { get; }

    public SnapshotBuilder Snapshots { get; }

    public ProductionService Productions { get; }

    public SceneService Scenes { get; }

    public TextService Texts { get; }

    public DeviceAdminService DeviceAdmin { get; }

    public DeviceSessionService Devices { get; }

    public PairingService Pairing { get; }

    public OutputService Outputs { get; }

    public LiveKitSyncService LiveKit { get; }

    public StudioSessionService Studio { get; }

    public ProductionRuntime Runtime => Runtimes.GetOrAdd(Production.Id);

    public IReadOnlyList<ProductionEvent> Events => [.. Publisher.StudioEvents];

    public async Task<(Device Device, DeviceIdentity Identity)> PairPhoneAsync(string name = "Phone 1")
    {
        var invite = await Pairing.GetPhoneInviteAsync(Production.Id, CancellationToken.None);
        var token = invite.Url[(invite.Url.LastIndexOf('/') + 1)..];
        var credentials = await Pairing.RedeemAsync(token, new RedeemInviteRequest(Guid.NewGuid().ToString(), name, DeviceKind.Phone, "iPhone"), CancellationToken.None);
        var device = Data.Devices.Single(d => d.Id == credentials.DeviceId);
        return (device, new DeviceIdentity(device.Id, Production.Id, false));
    }

    public async Task<(Device Device, DeviceIdentity Identity)> PairLaptopAsync(string name = "Laptop Lea")
    {
        var invite = await Pairing.CreateInviteAsync(Production.Id, new CreateInviteRequest(InviteKind.LaptopLink), CancellationToken.None);
        var token = invite.Url[(invite.Url.LastIndexOf('/') + 1)..];
        var credentials = await Pairing.RedeemAsync(token, new RedeemInviteRequest(Guid.NewGuid().ToString(), name, DeviceKind.Laptop, "Windows"), CancellationToken.None);
        var device = Data.Devices.Single(d => d.Id == credentials.DeviceId);
        return (device, new DeviceIdentity(device.Id, Production.Id, false));
    }

    public static DeviceReportDto Report(string slot, SlotState state, RtcState rtc = RtcState.Connected) =>
        new(rtc, [new SlotTelemetryDto(slot, state, 1280, 720, 30, 2500, 0, "h264")], 80, false, "wifi", 20, null);

    public SourceDto Source(string sourceId) => Events.OfType<SourceUpsertedEvent>().Last(e => e.Source.Id == sourceId).Source;

    public void Dispose()
    {
        Runtimes.Dispose();
        Productions.Dispose();
    }
}
