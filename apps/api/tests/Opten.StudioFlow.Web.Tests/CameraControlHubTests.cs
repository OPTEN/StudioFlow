using System.Net;
using Microsoft.AspNetCore.SignalR.Client;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// Remote camera control over the real endpoint and hubs (issue #11): the phone reports what its camera can do, the
/// Regie commands it, authorisation, validation and clamping, offline phones and the last-command-wins throttle.
/// </summary>
public sealed class CameraControlHubTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static readonly CameraCapabilitiesDto Android = new(
        [new CameraLensDto("back-main", "camera2 0, facing back", CameraLensKind.Standard), new CameraLensDto("back-wide", "camera2 2, facing back", CameraLensKind.UltraWide)],
        new CameraRangeDto(1, 8, 0.1),
        [CameraFocusMode.Auto, CameraFocusMode.Manual],
        new CameraRangeDto(0.1, 2, 0.05),
        new CameraRangeDto(-2, 2, 0.5),
        Torch: true);

    private static DeviceReportDto Report(CameraCapabilitiesDto capabilities, double zoom = 1) =>
        new(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2000, 0, "h264")], null, null, null, null, null,
            new CameraStateDto(1, capabilities, new CameraSettingsDto("back-main", zoom, CameraFocusMode.Auto, null, 0, false), null));

    private static CameraControlDto Zoom(double zoom) => new(1, null, zoom, null, null, null, null, null);

    private static string CommandsUrl(AdminSession admin, string deviceId) => $"/api/productions/{admin.ProductionId}/devices/{deviceId}/commands";

    private static DeviceCommandRequest Request(CameraControlDto? camera) => new(DeviceCommandKind.CameraControl, "camera", null, camera);

    /// <summary>A paired phone with a hub session that reported its camera; <paramref name="typedCommands"/> collects the commands as DTOs (a hub connection takes one handler type per method).</summary>
    private async Task<(AdminSession Admin, DeviceCredentialsDto Credentials, HubConnection Phone, HubProbe<DeviceCommandDto> Commands)> ConnectedPhoneAsync(CameraCapabilitiesDto? capabilities = null, bool typedCommands = true)
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var phone = Device(credentials);
        var commands = typedCommands ? HubProbe.On<DeviceCommandDto>(phone, HubMethods.Command) : new HubProbe<DeviceCommandDto>();
        await phone.StartAsync(TestContext.Current.CancellationToken);
        await phone.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "Android · Chrome", "1"), TestContext.Current.CancellationToken);
        await phone.InvokeAsync(HubMethods.Report, Report(capabilities ?? Android), TestContext.Current.CancellationToken);
        return (admin, credentials, phone, commands);
    }

    [Fact]
    public async Task Command_RegieToPhone_ArrivesClampedAndPhoneReportReachesTheRegieAtOnce()
    {
        var (admin, credentials, phone, commands) = await ConnectedPhoneAsync();
        await using var _ = phone;
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var telemetry = HubProbe.On<DeviceTelemetryMessage>(studio, HubMethods.Telemetry);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        var accepted = await admin.Client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(Zoom(50))).ExpectAsync<DeviceCommandDto>(HttpStatusCode.Accepted);
        var received = await commands.NextAsync();
        await phone.InvokeAsync(HubMethods.Report, Report(Android, zoom: 8), TestContext.Current.CancellationToken);
        var reported = await telemetry.NextAsync(m => m.DeviceId == credentials.DeviceId && m.Telemetry.Camera?.Settings.Zoom == 8);

        Assert.Equal(accepted, received);
        Assert.Equal(DeviceCommandKind.CameraControl, received.Kind);
        Assert.Equal(8, received.Camera!.Zoom);
        Assert.Equal(1, received.Camera.V);
        Assert.Equal(2, reported.Telemetry.Camera!.Capabilities.Lenses.Count);
    }

    [Fact]
    public async Task Command_OnTheWire_UsesCamelCaseNamesAndEnums()
    {
        var (admin, credentials, phone, _) = await ConnectedPhoneAsync(typedCommands: false);
        await using var disposePhone = phone;
        var raw = HubProbe.On<System.Text.Json.JsonElement>(phone, HubMethods.Command);

        await admin.Client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(new CameraControlDto(1, "back-wide", null, CameraFocusMode.Manual, 0.5, null, null, null))).ExpectAsync(HttpStatusCode.Accepted);
        var message = await raw.NextAsync(m => m.GetProperty("kind").GetString() == "cameraControl");

        var camera = message.GetProperty("camera");
        Assert.Equal("back-wide", camera.GetProperty("lensId").GetString());
        Assert.Equal("manual", camera.GetProperty("focusMode").GetString());
        Assert.Equal(0.5, camera.GetProperty("focusDistance").GetDouble());
    }

    [Fact]
    public async Task Command_FromADeviceOrAnonymous_IsRefused()
    {
        var (admin, credentials, phone, commands) = await ConnectedPhoneAsync();
        await using var _ = phone;

        await app.DeviceClient(credentials).PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(Zoom(2))).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.Anonymous().PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(Zoom(2))).ExpectProblemAsync(HttpStatusCode.Unauthorized);

        Assert.True(await commands.StaysQuietAsync(TimeSpan.FromMilliseconds(500)));
    }

    [Fact]
    public async Task Command_WithoutTheCsrfHeader_IsRefused()
    {
        var (admin, credentials, phone, commands) = await ConnectedPhoneAsync();
        await using var _ = phone;
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        await client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(Zoom(2))).ExpectProblemAsync(HttpStatusCode.Forbidden);

        Assert.True(await commands.StaysQuietAsync(TimeSpan.FromMilliseconds(500)));
    }

    [Fact]
    public async Task Command_ToADeviceOfAnotherProduction_IsNotFound()
    {
        var (admin, credentials, phone, commands) = await ConnectedPhoneAsync();
        await using var _ = phone;
        var other = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Other " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var code = await admin.Client.PostJsonAsync($"/api/productions/{other.Id}/devices/{credentials.DeviceId}/commands", Request(Zoom(2))).ExpectProblemAsync(HttpStatusCode.NotFound);

        Assert.Equal(ErrorCodes.NotFound, code);
        Assert.True(await commands.StaysQuietAsync(TimeSpan.FromMilliseconds(500)));
    }

    [Fact]
    public async Task Command_ToAnUnknownDevice_IsNotFound()
    {
        var admin = await app.AdminAsync();

        var code = await admin.Client.PostJsonAsync(CommandsUrl(admin, "dev_000000000000"), Request(Zoom(2))).ExpectProblemAsync(HttpStatusCode.NotFound);

        Assert.Equal(ErrorCodes.NotFound, code);
    }

    [Fact]
    public async Task Command_ToALaptop_IsRefused()
    {
        var admin = await app.AdminAsync();
        var laptop = await app.PairLaptopAsync(admin);

        var code = await admin.Client.PostJsonAsync(CommandsUrl(admin, laptop.DeviceId), Request(Zoom(2))).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal(ErrorCodes.ValidationFailed, code);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("version")]
    [InlineData("empty")]
    [InlineData("range")]
    [InlineData("lens")]
    public async Task Command_Invalid_IsRefusedAndNeverReachesThePhone(string kind)
    {
        var (admin, credentials, phone, commands) = await ConnectedPhoneAsync();
        await using var _ = phone;
        CameraControlDto? camera = kind switch
        {
            "missing" => null,
            "version" => Zoom(2) with { V = 9 },
            "empty" => new CameraControlDto(1, null, null, null, null, null, null, null),
            "range" => Zoom(1000),
            _ => new CameraControlDto(1, "another-phones-camera", null, null, null, null, null, null),
        };

        var code = await admin.Client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(camera)).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal(ErrorCodes.ValidationFailed, code);
        Assert.True(await commands.StaysQuietAsync(TimeSpan.FromMilliseconds(500)));
    }

    [Fact]
    public async Task Command_ForAControlThePhoneDoesNotReport_IsRefused()
    {
        var iphone = new CameraCapabilitiesDto([new CameraLensDto("front", "Front Camera", CameraLensKind.Front)], null, [], null, null, Torch: false);
        var (admin, credentials, phone, commands) = await ConnectedPhoneAsync(iphone);
        await using var _ = phone;

        await admin.Client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(Zoom(2))).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await admin.Client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(new CameraControlDto(1, "front", null, null, null, null, null, null))).ExpectAsync(HttpStatusCode.Accepted);

        var lens = await commands.NextAsync();
        Assert.Equal("front", lens.Camera!.LensId);
    }

    [Fact]
    public async Task Command_ToAnOfflinePhone_IsAcceptedAndDropped()
    {
        var (admin, credentials, phone, _) = await ConnectedPhoneAsync();
        await phone.DisposeAsync();

        var accepted = await admin.Client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(Zoom(2))).ExpectAsync<DeviceCommandDto>(HttpStatusCode.Accepted);

        Assert.Equal(2, accepted.Camera!.Zoom);
        await using var again = Device(credentials);
        var commands = HubProbe.On<DeviceCommandDto>(again, HubMethods.Command);
        await again.StartAsync(TestContext.Current.CancellationToken);
        await again.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-2", "x", "1"), TestContext.Current.CancellationToken);
        Assert.True(await commands.StaysQuietAsync(TimeSpan.FromMilliseconds(500)));
    }

    [Fact]
    public async Task Commands_ASliderDrag_ReachThePhoneInOrderThinnedOutAndTheLastValueWins()
    {
        var (admin, credentials, phone, commands) = await ConnectedPhoneAsync();
        await using var _ = phone;
        var zooms = new List<double>();
        phone.On<DeviceCommandDto>(HubMethods.Command, command =>
        {
            lock (zooms)
            {
                zooms.Add(command.Camera!.Zoom!.Value);
            }
        });

        for (var step = 1; step <= 40; step++)
        {
            await admin.Client.PostJsonAsync(CommandsUrl(admin, credentials.DeviceId), Request(Zoom(1 + (step * 0.1)))).ExpectAsync(HttpStatusCode.Accepted);
        }

        await commands.NextAsync(c => c.Camera!.Zoom == 5, TimeSpan.FromSeconds(10));
        await Task.Delay(300, TestContext.Current.CancellationToken);
        lock (zooms)
        {
            Assert.Equal(5, zooms[^1]);
            Assert.Equal(zooms.Order(), zooms);
            Assert.True(zooms.Count < 40, $"all {zooms.Count} commands were sent through");
        }
    }

    private HubConnection Device(DeviceCredentialsDto credentials) =>
        app.Hub(HubMethods.DeviceHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>($"{credentials.DeviceId}.{credentials.DeviceSecret}"));
}
