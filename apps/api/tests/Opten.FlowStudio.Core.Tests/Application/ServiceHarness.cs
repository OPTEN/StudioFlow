using Microsoft.Extensions.Logging.Abstractions;
using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Tests.Application;

/// <summary>The application services wired with in-memory fakes and a manual clock.</summary>
internal sealed class ServiceHarness : IDisposable
{
    public ServiceHarness()
    {
        Production = Core.Domain.Production.Create("Webinar", "webinar", isActive: true, Clock.Now);
        Data.Productions.Add(Production);
        Runtimes = new ProductionRuntimeRegistry(Clock);
        Coordinator = new ProductionCoordinator(Runtimes, Data, Publisher, Clock, NullLogger<ProductionCoordinator>.Instance);
        Snapshots = new SnapshotBuilder(Requests, Options);
        var kicker = new LiveKitKicker(Rooms, NullLogger<LiveKitKicker>.Instance);
        Productions = new ProductionService(Coordinator, Data, Snapshots, new FakeTokens(), Publisher, Clock);
        Scenes = new SceneService(Coordinator);
        DeviceAdmin = new DeviceAdminService(Coordinator, kicker);
        Devices = new DeviceSessionService(Coordinator, Data, new FakeTokens(), kicker);
        Pairing = new PairingService(Coordinator, Data, Requests, Options, Clock);
        Outputs = new OutputService(Coordinator, Data, Runtimes, new FakeTokens(), kicker, Options);
        LiveKit = new LiveKitSyncService(Coordinator, Data, Runtimes, Rooms, kicker, NullLogger<LiveKitSyncService>.Instance);
        Studio = new StudioSessionService(Coordinator, Snapshots);
    }

    public ManualClock Clock { get; } = new();

    public InMemoryData Data { get; } = new();

    public RecordingPublisher Publisher { get; } = new();

    public FakeRoomClient Rooms { get; } = new();

    public PairingRequestStore Requests { get; } = new();

    public FlowStudioOptions Options { get; } = new() { PublicBaseUrl = "https://fs.example" };

    public Production Production { get; }

    public ProductionRuntimeRegistry Runtimes { get; }

    public ProductionCoordinator Coordinator { get; }

    public SnapshotBuilder Snapshots { get; }

    public ProductionService Productions { get; }

    public SceneService Scenes { get; }

    public DeviceAdminService DeviceAdmin { get; }

    public DeviceSessionService Devices { get; }

    public PairingService Pairing { get; }

    public OutputService Outputs { get; }

    public LiveKitSyncService LiveKit { get; }

    public StudioSessionService Studio { get; }

    public ProductionRuntime Runtime => Runtimes.GetOrAdd(Production.Id);

    public IReadOnlyList<ProductionEvent> Events => [.. Publisher.StudioEvents];

    public async Task<(Device Device, DeviceIdentity Identity)> PairPhoneAsync(string name = "Handy 1")
    {
        var invite = await Pairing.GetPhoneInviteAsync(Production.Id, CancellationToken.None);
        var token = invite.Url[(invite.Url.LastIndexOf('/') + 1)..];
        var credentials = await Pairing.RedeemAsync(token, new RedeemInviteRequest(Guid.NewGuid().ToString(), name, DeviceKind.Phone, "iPhone"), CancellationToken.None);
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
