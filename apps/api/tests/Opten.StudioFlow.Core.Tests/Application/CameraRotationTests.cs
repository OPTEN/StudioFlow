using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>
/// Rotation of a phone camera picture: what the phone reports (automatic), what the Regie sets (manual) and the
/// rotation every client gets on the camera source (manual wins, else automatic, else 0), emitted only on a change.
/// </summary>
public sealed class CameraRotationTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    private static DeviceReportDto Report(int? rotation, bool withCamera = true) => ServiceHarness.Report("camera", SlotState.Live) with
    {
        Camera = withCamera
            ? new CameraStateDto(
                1,
                new CameraCapabilitiesDto([new CameraLensDto("back", "Back Camera", CameraLensKind.Standard)], null, [], null, null, Torch: false),
                new CameraSettingsDto("back", null, null, null, null, null, 1080, rotation),
                null)
            : null,
    };

    private async Task<(Device Device, DeviceIdentity Identity, string SourceId)> LivePhoneAsync()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", Report(null), CancellationToken.None);
        return (device, identity, SourceRef.ForDevice(device.Id, DeviceSlots.Camera));
    }

    private Task ReportAsync(DeviceIdentity identity, int? rotation, bool withCamera = true) =>
        harness.Devices.ReportAsync(identity, "c1", Report(rotation, withCamera), CancellationToken.None);

    private Task<DeviceDto> SetAsync(Device device, int? rotation) =>
        harness.DeviceAdmin.SetCameraRotationAsync(harness.Production.Id, device.Id, new SetCameraRotationRequest(rotation), CancellationToken.None);

    private List<SourceUpsertedEvent> OutputSourceEvents(string sourceId) =>
        [.. harness.Publisher.OutputEvents.OfType<SourceUpsertedEvent>().Where(e => e.Source.Id == sourceId)];

    [Theory]
    [InlineData(null, null, 0)]
    [InlineData(null, 90, 90)]
    [InlineData(270, 90, 270)]
    [InlineData(0, 90, 0)]
    [InlineData(180, null, 180)]
    [InlineData(45, 90, 90)]
    [InlineData(null, 360, 0)]
    public void Effective_ManualWins_ThenTheReportedOne_ElseNone(int? manual, int? reported, int expected) =>
        Assert.Equal(expected, CameraRotations.Effective(manual, reported));

    [Fact]
    public async Task ReportedRotation_ReachesTheRegieAndTheOutput_OnlyWhenItChanges()
    {
        var (_, identity, sourceId) = await LivePhoneAsync();
        harness.Publisher.OutputEvents.Clear();

        await ReportAsync(identity, 90);
        await ReportAsync(identity, 90);
        await ReportAsync(identity, 90);

        var turned = Assert.Single(OutputSourceEvents(sourceId));
        Assert.Equal(90, turned.Source.Rotation);
        Assert.Equal(90, harness.Source(sourceId).Rotation);

        await ReportAsync(identity, 270);
        Assert.Equal([90, 270], OutputSourceEvents(sourceId).Select(e => e.Source.Rotation));
    }

    [Fact]
    public async Task AReportWithoutCamera_KeepsTheLastRotation()
    {
        var (_, identity, sourceId) = await LivePhoneAsync();
        await ReportAsync(identity, 90);
        harness.Publisher.OutputEvents.Clear();

        await ReportAsync(identity, null, withCamera: false);

        Assert.Empty(OutputSourceEvents(sourceId));
        var snapshot = await harness.Productions.GetSnapshotAsync(harness.Production.Id, CancellationToken.None);
        Assert.Equal(90, snapshot.Sources.Single(s => s.Id == sourceId).Rotation);
    }

    [Fact]
    public async Task ManualRotation_WinsOverTheReportedOne_AndAutoGivesItBack()
    {
        var (device, identity, sourceId) = await LivePhoneAsync();
        await ReportAsync(identity, 90);
        harness.Publisher.OutputEvents.Clear();

        var dto = await SetAsync(device, 180);

        Assert.Equal(180, dto.CameraRotation);
        Assert.Equal(180, Assert.Single(OutputSourceEvents(sourceId)).Source.Rotation);
        Assert.Equal(180, harness.Events.OfType<DeviceUpsertedEvent>().Last().Device.CameraRotation);

        // The phone turns, but the Regie fixed the picture: nothing changes for the clients.
        await ReportAsync(identity, 270);
        Assert.Single(OutputSourceEvents(sourceId));

        var auto = await SetAsync(device, null);

        Assert.Null(auto.CameraRotation);
        Assert.Equal([180, 270], OutputSourceEvents(sourceId).Select(e => e.Source.Rotation));
    }

    [Fact]
    public async Task ManualRotation_ThatEqualsTheApplied_ChangesNoSource_ButIsStoredAndAudited()
    {
        var (device, identity, sourceId) = await LivePhoneAsync();
        await ReportAsync(identity, 90);
        harness.Publisher.OutputEvents.Clear();

        await SetAsync(device, 90);
        await SetAsync(device, 90);

        Assert.Empty(OutputSourceEvents(sourceId));
        Assert.Equal(90, harness.Data.Devices.Single(d => d.Id == device.Id).FindSlot(DeviceSlots.Camera)!.Rotation);
        var entry = Assert.Single(harness.Data.Audit, a => a.Action == AuditActions.CameraRotationChanged);
        Assert.Equal((AuditActors.Admin, "Phone 1", "90"), (entry.Actor, entry.Detail(AuditDetails.Device), entry.Detail(AuditDetails.Rotation)));
    }

    [Fact]
    public async Task Auto_IsAuditedAsAuto()
    {
        var (device, _, _) = await LivePhoneAsync();

        await SetAsync(device, 270);
        await SetAsync(device, null);

        var entries = harness.Data.Audit.Where(a => a.Action == AuditActions.CameraRotationChanged).Select(a => a.Detail(AuditDetails.Rotation));
        Assert.Equal(["270", AuditRotations.Auto], entries);
    }

    [Fact]
    public async Task ManualRotation_IsInTheSnapshotsOfTheRegieAndTheOutput()
    {
        var (device, _, sourceId) = await LivePhoneAsync();

        await SetAsync(device, 270);

        var studio = await harness.Productions.GetSnapshotAsync(harness.Production.Id, CancellationToken.None);
        Assert.Equal(270, studio.Sources.Single(s => s.Id == sourceId).Rotation);
        Assert.Equal(270, studio.Devices.Single(d => d.Id == device.Id).CameraRotation);
        await harness.Coordinator.ExecuteAsync(
            harness.Production.Id,
            async context =>
            {
                var output = await SnapshotBuilder.BuildOutputAsync(context, CancellationToken.None);
                Assert.Equal(270, output.Sources.Single(s => s.Id == sourceId).Rotation);
            },
            CancellationToken.None);
    }

    [Theory]
    [InlineData(45)]
    [InlineData(-90)]
    [InlineData(360)]
    public async Task AnotherAngle_IsRefused(int rotation)
    {
        var (device, _, _) = await LivePhoneAsync();

        var error = await Assert.ThrowsAsync<StudioFlowException>(() => SetAsync(device, rotation));

        Assert.Equal(ErrorKind.Validation, error.Kind);
        Assert.Contains("rotation", error.Errors!.Keys);
    }

    [Fact]
    public async Task ADeviceWithoutCamera_IsRefused()
    {
        var (laptop, _) = await harness.PairLaptopAsync();

        var error = await Assert.ThrowsAsync<StudioFlowException>(() => SetAsync(laptop, 90));

        Assert.Equal(ErrorKind.Validation, error.Kind);
    }

    [Fact]
    public async Task ScreensAndMedia_HaveNoRotation()
    {
        var (laptop, identity) = await harness.PairLaptopAsync();
        await harness.Devices.HelloAsync(identity, "c2", new DeviceHelloDto("tab-2", "Windows", "1.0"), CancellationToken.None);

        var snapshot = await harness.Productions.GetSnapshotAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal(0, snapshot.Sources.Single(s => s.DeviceId == laptop.Id).Rotation);
    }

    public void Dispose() => harness.Dispose();
}
