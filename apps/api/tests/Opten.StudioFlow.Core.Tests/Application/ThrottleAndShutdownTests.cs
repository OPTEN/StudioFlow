using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>
/// Telemetry throttle (BUG-19, spec 6), host shutdown without invented outages (BUG-20, OBS-01) and reports during a
/// database outage (GAP-29, GAP-32).
/// </summary>
public sealed class ThrottleAndShutdownTests : IDisposable
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);

    private readonly CancellationTokenSource stopping = new();
    private readonly ServiceHarness harness;

    public ThrottleAndShutdownTests()
    {
        harness = new ServiceHarness(shutdown: new HostShutdown(stopping.Token));
    }

    [Fact]
    public void OfferTelemetry_FirstReport_IsRelayedAtOnceAndLaterOnesAreHeldBack()
    {
        var device = Connected();

        device.ApplyReport(Report(battery: 90), ["camera"], Build.T0);
        var first = device.OfferTelemetry(Build.T0, Interval);
        device.ApplyReport(Report(battery: 89), ["camera"], Build.T0.AddMilliseconds(100));
        var second = device.OfferTelemetry(Build.T0.AddMilliseconds(100), Interval);

        Assert.Equal(90, first?.BatteryPct);
        Assert.Null(second);
        Assert.True(device.TelemetryPending);
    }

    [Fact]
    public void TakeDueTelemetry_AfterTheInterval_RelaysTheNewestHeldBackReportOnce()
    {
        var device = Connected();
        device.ApplyReport(Report(battery: 90), ["camera"], Build.T0);
        device.OfferTelemetry(Build.T0, Interval);
        for (var i = 1; i <= 5; i++)
        {
            var at = Build.T0.AddMilliseconds(100 * i);
            device.ApplyReport(Report(battery: 90 - i), ["camera"], at);
            device.OfferTelemetry(at, Interval);
        }

        var early = device.TakeDueTelemetry(Build.T0.AddMilliseconds(1999), Interval);
        var due = device.TakeDueTelemetry(Build.T0.AddSeconds(2), Interval);
        var again = device.TakeDueTelemetry(Build.T0.AddSeconds(5), Interval);

        Assert.Null(early);
        Assert.Equal(85, due?.BatteryPct);
        Assert.Null(again);
        Assert.False(device.TelemetryPending);
    }

    [Fact]
    public void TakeDueTelemetry_DeviceWentSilentOrDisconnected_RelaysNothing()
    {
        var stale = Connected();
        stale.ApplyReport(Report(battery: 90), ["camera"], Build.T0);
        stale.OfferTelemetry(Build.T0, Interval);
        stale.ApplyReport(Report(battery: 80), ["camera"], Build.T0.AddSeconds(1));
        stale.OfferTelemetry(Build.T0.AddSeconds(1), Interval);
        var gone = Connected();
        gone.ApplyReport(Report(battery: 90), ["camera"], Build.T0);
        gone.OfferTelemetry(Build.T0, Interval);
        gone.ApplyReport(Report(battery: 80), ["camera"], Build.T0.AddSeconds(1));
        gone.OfferTelemetry(Build.T0.AddSeconds(1), Interval);

        stale.MarkReportStale();
        gone.Detach("c1", Build.T0.AddSeconds(1));

        Assert.Null(stale.TakeDueTelemetry(Build.T0.AddSeconds(10), Interval));
        Assert.Null(gone.TakeDueTelemetry(Build.T0.AddSeconds(10), Interval));
    }

    [Fact]
    public async Task ReportAsync_TenReportsPerSecond_RelaysAtMostOneTelemetryMessagePerTwoSeconds()
    {
        var (_, identity) = await HelloAsync();
        var sent = new List<DateTimeOffset>();
        for (var i = 0; i < 80; i++)
        {
            var before = harness.Publisher.Telemetry.Count;
            await harness.Devices.ReportAsync(identity, "c1", Report(battery: 100 - (i % 50)), CancellationToken.None);
            if (i % 10 == 0)
            {
                await harness.Devices.TickAsync(CancellationToken.None);
            }

            if (harness.Publisher.Telemetry.Count > before)
            {
                sent.Add(harness.Clock.Now);
            }

            harness.Clock.Advance(TimeSpan.FromMilliseconds(100));
        }

        Assert.InRange(sent.Count, 3, 5);
        Assert.All(sent.Zip(sent.Skip(1)), pair => Assert.True(pair.Second - pair.First >= Interval, $"{pair.First:O} -> {pair.Second:O}"));
    }

    [Fact]
    public async Task TickAsync_ReportHeldBack_RelaysTheLatestValuesOnceTheIntervalPassed()
    {
        var (device, identity) = await HelloAsync();
        await harness.Devices.ReportAsync(identity, "c1", Report(battery: 70), CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromMilliseconds(500));
        await harness.Devices.ReportAsync(identity, "c1", Report(battery: 69), CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromMilliseconds(500));
        await harness.Devices.ReportAsync(identity, "c1", Report(battery: 68), CancellationToken.None);

        harness.Clock.Advance(TimeSpan.FromMilliseconds(500));
        await harness.Devices.TickAsync(CancellationToken.None);
        var beforeDue = harness.Publisher.Telemetry.Count;
        harness.Clock.Advance(TimeSpan.FromMilliseconds(500));
        await harness.Devices.TickAsync(CancellationToken.None);

        Assert.Equal(1, beforeDue);
        var messages = harness.Publisher.Telemetry.ToList();
        Assert.Equal([70, 68], messages.Select(m => m.Telemetry.BatteryPct));
        Assert.All(messages, m => Assert.Equal(device.Id, m.DeviceId));
    }

    [Fact]
    public async Task ReportAsync_RtcChangeWhileTelemetryIsThrottled_ArrivesAtOnceAsRevisionedEvent()
    {
        var (device, identity) = await HelloAsync();
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromMilliseconds(300));

        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live, RtcState.Reconnecting), CancellationToken.None);

        Assert.Single(harness.Publisher.Telemetry);
        Assert.Equal(SourceStatus.Reconnecting, harness.Source(device.SourceIdOf(device.Slots[0])).Status);
        Assert.Equal(DeviceConnection.Reconnecting, harness.Events.OfType<DeviceUpsertedEvent>().Last().Device.Connection);
    }

    [Fact]
    public async Task DisconnectedAsync_HostStopping_IsNoOutageAndWritesNothing()
    {
        var (device, identity) = await LiveAsync();
        var auditBefore = harness.Data.Audit.Count;
        var eventsBefore = harness.Events.Count;

        await stopping.CancelAsync();
        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);
        await harness.Devices.TickAsync(CancellationToken.None);

        Assert.Equal(auditBefore, harness.Data.Audit.Count);
        Assert.Equal(eventsBefore, harness.Events.Count);
        Assert.Empty(harness.Events.OfType<IncidentUpsertedEvent>());
        Assert.DoesNotContain(harness.Events.OfType<LogAppendedEvent>(), l => l.Entry.Text.Contains("verbindet neu", StringComparison.Ordinal));
        Assert.Equal(SourceStatus.Ok, harness.Source(device.SourceIdOf(device.Slots[0])).Status);
    }

    [Fact]
    public async Task DisconnectedAsync_HostRunning_StillFlagsTheOutage()
    {
        var (device, identity) = await LiveAsync();

        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);

        Assert.Equal(SourceStatus.Reconnecting, harness.Source(device.SourceIdOf(device.Slots[0])).Status);
        Assert.Contains(harness.Events.OfType<LogAppendedEvent>(), l => l.Entry.Text == "K1 verbindet neu");
    }

    [Fact]
    public async Task DisconnectedAsync_StudioAndOutputWhileHostStopping_PublishNothing()
    {
        await harness.Studio.SubscribeAsync("studio-1", harness.Production.Id, null, CancellationToken.None);
        await harness.Outputs.ConnectedAsync(harness.Production.Id, "output-1", "10.0.0.5", CancellationToken.None);
        var presence = harness.Publisher.Presence.Count;
        var events = harness.Events.Count;

        await stopping.CancelAsync();
        await harness.Studio.DisconnectedAsync("studio-1");
        await harness.Outputs.DisconnectedAsync(harness.Production.Id, "output-1", CancellationToken.None);

        Assert.Equal(presence, harness.Publisher.Presence.Count);
        Assert.Equal(events, harness.Events.Count);
    }

    [Fact]
    public async Task ReportAsync_DatabaseDown_StillCountsAsSignOfLifeSoNoOutageFollowsTheRecovery()
    {
        var (device, identity) = await LiveAsync();
        harness.Data.FailDeviceReads = true;
        for (var second = 0; second < 10; second++)
        {
            harness.Clock.Advance(TimeSpan.FromSeconds(1));
            await Assert.ThrowsAsync<TimeoutException>(() => harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None));
        }

        harness.Data.FailDeviceReads = false;
        await harness.Devices.TickAsync(CancellationToken.None);

        Assert.Equal(SourceStatus.Ok, harness.Source(device.SourceIdOf(device.Slots[0])).Status);
        Assert.Empty(harness.Events.OfType<IncidentUpsertedEvent>());
    }

    public void Dispose()
    {
        harness.Dispose();
        stopping.Dispose();
    }

    private static DeviceRuntime Connected()
    {
        var device = new DeviceRuntime("dev_aaaaaaaaaaaaaaaa");
        device.Attach("c1", "tab-1", Build.T0);
        return device;
    }

    private static DeviceReportDto Report(int battery) =>
        new(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2500, 0, "h264")], battery, false, "wifi", 20, null);

    private async Task<(Device Device, DeviceIdentity Identity)> HelloAsync()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "p", "1"), CancellationToken.None);
        return (device, identity);
    }

    private async Task<(Device Device, DeviceIdentity Identity)> LiveAsync()
    {
        var (device, identity) = await HelloAsync();
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source(device.SourceIdOf(device.Slots[0])).Status);
        return (device, identity);
    }
}
