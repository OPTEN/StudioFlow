using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>Remote camera control through the use cases (issue #11): delivery, clamping, throttling, offline and laptops.</summary>
public sealed class CameraControlServiceTests : IDisposable
{
    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(100);

    private readonly ServiceHarness harness = new();

    private static CameraCapabilitiesDto Capabilities() => new(
        [new CameraLensDto("back-main", "camera2 0, facing back", CameraLensKind.Standard), new CameraLensDto("back-wide", "camera2 2, facing back", CameraLensKind.UltraWide)],
        new CameraRangeDto(1, 8, 0.1),
        [CameraFocusMode.Auto, CameraFocusMode.Manual],
        new CameraRangeDto(0.1, 2, 0.05),
        new CameraRangeDto(-2, 2, 0.5),
        Torch: true);

    private static CameraControlDto Zoom(double zoom) => new(1, null, zoom, null, null, null, null, null);

    private static DeviceReportDto Report(double zoom = 1, CameraCapabilitiesDto? capabilities = null) => ServiceHarness.Report("camera", SlotState.Live) with
    {
        Camera = new CameraStateDto(1, capabilities ?? Capabilities(), new CameraSettingsDto("back-main", zoom, CameraFocusMode.Auto, null, 0, false), null),
    };

    private async Task<(Device Device, DeviceIdentity Identity)> LivePhoneAsync(double zoom = 1)
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Android", "1.0"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", Report(zoom), CancellationToken.None);
        return (device, identity);
    }

    private Task<DeviceCommandDto> SendAsync(Device device, CameraControlDto camera) =>
        harness.DeviceAdmin.SendCommandAsync(harness.Production.Id, device.Id, new DeviceCommandRequest(DeviceCommandKind.CameraControl, "camera", null, camera), CancellationToken.None);

    [Fact]
    public async Task Command_ToAConnectedPhone_IsClampedAndDelivered()
    {
        var (device, _) = await LivePhoneAsync();

        var accepted = await SendAsync(device, Zoom(40));

        var (connectionId, sent) = Assert.Single(harness.Publisher.Commands);
        Assert.Equal("c1", connectionId);
        Assert.Equal(DeviceCommandKind.CameraControl, sent.Kind);
        Assert.Equal("camera", sent.Slot);
        Assert.Equal(8, sent.Camera!.Zoom);
        Assert.Equal(accepted.Id, sent.Id);
        Assert.Equal(8, accepted.Camera!.Zoom);
        Assert.True(EntityIds.IsValid(accepted.Id, EntityIds.Command));
    }

    [Fact]
    public async Task Command_UnknownDevice_IsNotFound()
    {
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.DeviceAdmin.SendCommandAsync(
            harness.Production.Id, "dev_000000000000", new DeviceCommandRequest(DeviceCommandKind.CameraControl, "camera", null, Zoom(2)), CancellationToken.None));
        Assert.Empty(harness.Publisher.Commands);
    }

    [Fact]
    public async Task Command_ToALaptop_IsRefused()
    {
        var (laptop, identity) = await harness.PairLaptopAsync();
        await harness.Devices.HelloAsync(identity, "c9", new DeviceHelloDto("tab-9", "Windows", "1.0"), CancellationToken.None);

        var error = await Assert.ThrowsAsync<StudioFlowException>(() => SendAsync(laptop, Zoom(2)));

        Assert.Equal(ErrorKind.Validation, error.Kind);
        Assert.Empty(harness.Publisher.Commands);
    }

    [Fact]
    public async Task Command_ForAControlThePhoneDoesNotHave_IsRefused()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);
        var iphone = new CameraCapabilitiesDto([new CameraLensDto("front", "Front Camera", CameraLensKind.Front)], null, [], null, null, Torch: false);
        await harness.Devices.ReportAsync(identity, "c1", Report(capabilities: iphone), CancellationToken.None);

        var error = await Assert.ThrowsAsync<StudioFlowException>(() => SendAsync(device, Zoom(2)));

        Assert.Contains("camera.zoom", error.Errors!.Keys);
        Assert.Empty(harness.Publisher.Commands);
    }

    [Fact]
    public async Task Command_ToAnOfflinePhone_IsAcceptedAndDropped()
    {
        var (device, identity) = await LivePhoneAsync();
        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);

        var accepted = await SendAsync(device, Zoom(2));

        Assert.Equal(2, accepted.Camera!.Zoom);
        Assert.Empty(harness.Publisher.Commands);
    }

    [Fact]
    public async Task Command_BeforeTheFirstCameraReport_IsValidatedWithTheHardLimitsOnly()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Android", "1.0"), CancellationToken.None);

        await SendAsync(device, Zoom(40));
        await Assert.ThrowsAsync<StudioFlowException>(() => SendAsync(device, Zoom(400)));

        Assert.Equal(40, Assert.Single(harness.Publisher.Commands).Command.Camera!.Zoom);
    }

    [Fact]
    public async Task Command_WithoutPayloadOrOfAnotherVersion_IsRefused()
    {
        var (device, _) = await LivePhoneAsync();

        await Assert.ThrowsAsync<StudioFlowException>(() => harness.DeviceAdmin.SendCommandAsync(
            harness.Production.Id, device.Id, new DeviceCommandRequest(DeviceCommandKind.CameraControl, "camera", null), CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => SendAsync(device, Zoom(2) with { V = 2 }));
        Assert.Empty(harness.Publisher.Commands);
    }

    [Fact]
    public async Task Commands_InQuickSuccession_AreHeldBackAndTheNewestReachesThePhoneOnTheTick()
    {
        var (device, _) = await LivePhoneAsync();

        await SendAsync(device, Zoom(2));
        await SendAsync(device, Zoom(3));
        await SendAsync(device, Zoom(4));
        var beforeTheInterval = harness.Publisher.Commands.Count;
        harness.Clock.Advance(Interval);
        await harness.Devices.TickAsync(CancellationToken.None);

        Assert.Equal(1, beforeTheInterval);
        var zooms = harness.Publisher.Commands.Select(c => c.Command.Camera!.Zoom).ToList();
        Assert.Equal([2, 4], zooms);
    }

    [Fact]
    public async Task Commands_HeldBackFields_MergeSoNoSettingIsLost()
    {
        var (device, _) = await LivePhoneAsync();

        await SendAsync(device, Zoom(2));
        await SendAsync(device, new CameraControlDto(1, null, null, null, null, 1.0, null, null));
        await SendAsync(device, new CameraControlDto(1, null, 5, null, null, null, true, null));
        harness.Clock.Advance(Interval);
        await harness.Devices.TickAsync(CancellationToken.None);

        var merged = harness.Publisher.Commands.Last().Command.Camera!;
        Assert.Equal(5, merged.Zoom);
        Assert.Equal(1.0, merged.ExposureCompensation);
        Assert.True(merged.Torch);
    }

    [Fact]
    public async Task Command_AfterTheInterval_IsSentAtOnce()
    {
        var (device, _) = await LivePhoneAsync();

        await SendAsync(device, Zoom(2));
        harness.Clock.Advance(Interval);
        await SendAsync(device, Zoom(3));

        Assert.Equal([2, 3], harness.Publisher.Commands.Select(c => c.Command.Camera!.Zoom));
    }

    [Fact]
    public async Task HeldBackCommand_WhenThePhoneDisconnects_IsDropped()
    {
        var (device, identity) = await LivePhoneAsync();
        await SendAsync(device, Zoom(2));
        await SendAsync(device, Zoom(3));

        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);
        harness.Clock.Advance(Interval);
        await harness.Devices.TickAsync(CancellationToken.None);

        Assert.Single(harness.Publisher.Commands);
    }

    [Fact]
    public async Task Report_WithACameraChange_ReachesTheRegieAtOnceWithTheActualSettings()
    {
        var (device, identity) = await LivePhoneAsync();
        harness.Clock.Advance(TimeSpan.FromMilliseconds(200));

        await harness.Devices.ReportAsync(identity, "c1", Report(zoom: 2.5), CancellationToken.None);

        var last = harness.Publisher.Telemetry.Last();
        Assert.Equal(device.Id, last.DeviceId);
        Assert.Equal(2.5, last.Telemetry.Camera!.Settings.Zoom);
        Assert.Equal(2, harness.Publisher.Telemetry.Count);
    }

    [Fact]
    public async Task Report_WithoutACameraChange_StaysThrottled()
    {
        var (_, identity) = await LivePhoneAsync();
        harness.Clock.Advance(TimeSpan.FromMilliseconds(200));

        await harness.Devices.ReportAsync(identity, "c1", Report(), CancellationToken.None);

        Assert.Single(harness.Publisher.Telemetry);
    }

    [Fact]
    public async Task Report_WithAnotherCameraVersion_IsStoredWithoutCamera()
    {
        var (_, identity) = await LivePhoneAsync();
        var future = ServiceHarness.Report("camera", SlotState.Live) with { Camera = new CameraStateDto(2, Capabilities(), new CameraSettingsDto(null, null, null, null, null, null), null) };

        await harness.Devices.ReportAsync(identity, "c1", future, CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromSeconds(3));
        await harness.Devices.TickAsync(CancellationToken.None);

        Assert.Null(harness.Runtime.FindDevice(identity.DeviceId)!.Camera);
    }

    public void Dispose() => harness.Dispose();
}
