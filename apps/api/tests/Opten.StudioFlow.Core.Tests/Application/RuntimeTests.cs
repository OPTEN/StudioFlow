using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class EventRingTests
{
    private static RevisionOnlyEvent At(long revision) => new(revision);

    [Fact]
    public void TryGetSince_CurrentRevision_ReturnsEmptyDelta()
    {
        var ring = new EventRing(10);

        Assert.True(ring.TryGetSince(100, 100, out var missed));
        Assert.Empty(missed);
    }

    [Fact]
    public void TryGetSince_BufferedRevisions_ReturnsEventsAfterSince()
    {
        var ring = new EventRing(10);
        for (var r = 101; r <= 105; r++)
        {
            ring.Add(At(r));
        }

        Assert.True(ring.TryGetSince(102, 105, out var missed));
        Assert.Equal([103L, 104, 105], missed.Select(e => e.Revision));
        Assert.True(ring.TryGetSince(100, 105, out var all));
        Assert.Equal(5, all.Count);
    }

    [Fact]
    public void TryGetSince_EvictedOrUnknownRevision_NeedsSnapshot()
    {
        var ring = new EventRing(3);
        for (var r = 101; r <= 105; r++)
        {
            ring.Add(At(r));
        }

        Assert.Equal(3, ring.Count);
        Assert.False(ring.TryGetSince(101, 105, out _));
        Assert.True(ring.TryGetSince(102, 105, out var kept));
        Assert.Equal(3, kept.Count);
        Assert.False(ring.TryGetSince(106, 105, out _));
        Assert.False(new EventRing(3).TryGetSince(1, 105, out _));
    }

    [Fact]
    public void Add_DefaultCapacity_KeepsLast500()
    {
        var ring = new EventRing(EventRing.DefaultCapacity);
        for (var r = 1; r <= 1200; r++)
        {
            ring.Add(At(r));
        }

        Assert.Equal(500, ring.Count);
        Assert.True(ring.TryGetSince(700, 1200, out var missed));
        Assert.Equal(500, missed.Count);
        Assert.False(ring.TryGetSince(699, 1200, out _));
    }
}

public sealed class OutputTrackerTests
{
    private readonly OutputTracker tracker = new(new OutputMonitorOptions());

    public OutputTrackerTests() => tracker.SetLinks([("olk_a", "Proxy"), ("olk_b", "Teams camera")]);

    [Fact]
    public void Current_NoPage_IsNone() => Assert.Equal(OutputState.None, tracker.Current(Build.T0).State);

    [Fact]
    public void Current_Links_AreListedByNameEvenWithoutPages()
    {
        var status = tracker.Current(Build.T0);

        Assert.Equal(["Proxy", "Teams camera"], status.Links.Select(l => l.Name));
        Assert.All(status.Links, l => Assert.Equal(OutputState.None, l.State));
    }

    [Fact]
    public void Current_TwoLinks_AreTrackedSeparatelyAndSummarised()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Connect("c2", "olk_b", "10.0.0.6");
        tracker.Report("olk_a", new OutputReport(true, 100, 50, null), Build.T0);
        tracker.Report("olk_b", new OutputReport(false, 300, 20, null), Build.T0.AddSeconds(1));

        var status = tracker.Current(Build.T0.AddSeconds(2));

        Assert.Equal(OutputState.Connected, status.State);
        Assert.Equal([OutputState.Connected, OutputState.Stale], status.Links.Select(l => l.State));
        Assert.Equal(["10.0.0.5", "10.0.0.6"], status.Addresses);
        Assert.Equal(2, status.Consumers);
        Assert.Equal((300, 20d), (status.LatencyMs, status.Fps));
        Assert.Equal(Build.T0.AddSeconds(1), status.LastReportAt);
    }

    [Fact]
    public void Current_OnlyStaleLinks_SummariseAsStale()
    {
        tracker.Connect("c1", "olk_b", "10.0.0.6");

        Assert.Equal(OutputState.Stale, tracker.Current(Build.T0).State);
    }

    [Fact]
    public void Disconnect_OnePage_LeavesTheOtherLinkConnected()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Connect("c2", "olk_b", "10.0.0.6");

        Assert.True(tracker.Disconnect("c1"));
        Assert.False(tracker.Disconnect("c1"));

        Assert.Equal(["c2"], tracker.ConnectionIds);
        Assert.Equal(["c2"], tracker.ConnectionIdsOf("olk_b"));
        Assert.Empty(tracker.ConnectionIdsOf("olk_a"));
        Assert.Equal("olk_b", tracker.LinkOf("c2"));
        Assert.Equal("10.0.0.6", tracker.AddressOf("c2"));
        Assert.Null(tracker.AddressOf("c1"));
    }

    [Fact]
    public void SetLinks_RevokedLink_ForgetsItsPagesAndRenamesTheOthers()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Connect("c2", "olk_b", "10.0.0.6");

        tracker.SetLinks([("olk_b", "Camera")]);

        Assert.Equal(["c2"], tracker.ConnectionIds);
        Assert.Equal(["Camera"], tracker.Current(Build.T0).Links.Select(l => l.Name));
        Assert.Null(tracker.LinkOf("c1"));
    }

    [Fact]
    public void TakeChange_RenamedOrAddedLink_Publishes()
    {
        Assert.NotNull(tracker.TakeChange(Build.T0));
        Assert.Null(tracker.TakeChange(Build.T0));

        tracker.SetLinks([("olk_a", "Proxy"), ("olk_b", "Camera")]);

        Assert.Equal(["Camera", "Proxy"], tracker.TakeChange(Build.T0)!.Links.Select(l => l.Name));
    }

    [Fact]
    public void TakeChange_OneLinkChangesItsState_PublishesWithBothLinks()
    {
        tracker.TakeChange(Build.T0);

        tracker.Connect("c1", "olk_b", "10.0.0.6");

        var change = tracker.TakeChange(Build.T0)!;
        Assert.Equal([OutputState.None, OutputState.Stale], change.Links.Select(l => l.State));
    }

    [Fact]
    public void Current_ConnectedWithoutRenderingReport_IsStale()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(false, null, null, null), Build.T0);

        Assert.Equal(OutputState.Stale, tracker.Current(Build.T0).State);
    }

    [Fact]
    public void Current_FreshRenderingReport_IsConnectedForSixSeconds()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Connect("c2", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(true, 120, 50, "scn_a"), Build.T0);

        var status = tracker.Current(Build.T0.AddSeconds(6));

        Assert.Equal(OutputState.Connected, status.State);
        Assert.Equal(2, status.Consumers);
        Assert.Equal(["10.0.0.5"], status.Addresses);
        Assert.Equal(120, status.LatencyMs);
        Assert.Equal(OutputState.Stale, tracker.Current(Build.T0.AddSeconds(6.1)).State);
    }

    [Fact]
    public void Report_ImplausibleMetrics_AreDropped()
    {
        tracker.Report("olk_a", new OutputReport(true, -5, 5000, null), Build.T0);

        Assert.Null(tracker.Current(Build.T0).LatencyMs);
        Assert.Null(tracker.Current(Build.T0).Fps);
    }

    [Fact]
    public void Report_DroppedFramesAndDecoders_AreKeptPerLinkAndInTheSummary()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Connect("c2", "olk_b", "10.0.0.6");
        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 2.5, 3, 1), Build.T0);
        tracker.Report("olk_b", new OutputReport(true, 200, 25, null, 0, 6, 0), Build.T0.AddSeconds(1));

        var status = tracker.Current(Build.T0.AddSeconds(1));

        Assert.Equal(2.5, status.Links.Single(l => l.LinkId == "olk_a").DroppedFramesPct);
        Assert.Equal(3, status.Links.Single(l => l.LinkId == "olk_a").DecodedStreams);
        Assert.Equal(1, status.Links.Single(l => l.LinkId == "olk_a").SoftwareDecodedStreams);
        Assert.Equal(6, status.Links.Single(l => l.LinkId == "olk_b").DecodedStreams);
        // The summary is the page that reported last, like latency and fps.
        Assert.Equal(0, status.DroppedFramesPct);
        Assert.Equal(6, status.DecodedStreams);
        Assert.Equal(0, status.SoftwareDecodedStreams);
    }

    [Fact]
    public void Report_OldPageWithoutTheNewFields_LeavesThemEmpty()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(true, 100, 30, null), Build.T0);

        var status = tracker.Current(Build.T0);

        Assert.Null(status.DroppedFramesPct);
        Assert.Null(status.DecodedStreams);
        Assert.Null(status.SoftwareDecodedStreams);
    }

    [Theory]
    [InlineData(-1, 3, 1)]
    [InlineData(100.5, 3, 1)]
    [InlineData(double.NaN, 3, 1)]
    public void Report_ImplausibleDroppedFrames_AreDropped(double dropped, int decoded, int software)
    {
        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, dropped, decoded, software), Build.T0);

        Assert.Null(tracker.Current(Build.T0).DroppedFramesPct);
        Assert.Equal(decoded, tracker.Current(Build.T0).DecodedStreams);
    }

    [Theory]
    [InlineData(-1, 0)]
    [InlineData(5000, 0)]
    [InlineData(3, 4)]
    [InlineData(3, -1)]
    public void Report_ImplausibleStreamCounts_AreDropped(int decoded, int software)
    {
        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 0, decoded, software), Build.T0);

        var status = tracker.Current(Build.T0);
        Assert.Null(status.SoftwareDecodedStreams);
        if (decoded is < 0 or > 1000)
        {
            Assert.Null(status.DecodedStreams);
        }
    }

    [Fact]
    public void TakeChange_DroppedFramesStartingToRise_PublishesImmediately()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 0, 3, 0), Build.T0);
        tracker.TakeChange(Build.T0);

        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 8, 3, 0), Build.T0.AddSeconds(1));

        Assert.Equal(8, tracker.TakeChange(Build.T0.AddSeconds(1))!.DroppedFramesPct);
    }

    [Fact]
    public void TakeChange_ChangedDecoderCount_PublishesImmediately()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 0, 3, 0), Build.T0);
        tracker.TakeChange(Build.T0);

        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 0, 3, 3), Build.T0.AddSeconds(1));

        Assert.Equal(3, tracker.TakeChange(Build.T0.AddSeconds(1))!.SoftwareDecodedStreams);
    }

    [Fact]
    public void TakeChange_SmallDroppedFramesJitter_IsThrottled()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 10, 3, 0), Build.T0);
        tracker.TakeChange(Build.T0);

        tracker.Report("olk_a", new OutputReport(true, 100, 30, null, 11, 3, 0), Build.T0.AddSeconds(2));

        Assert.Null(tracker.TakeChange(Build.T0.AddSeconds(2)));
    }

    [Fact]
    public void TakeChange_StateChange_PublishesImmediately()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");

        Assert.Equal(OutputState.Stale, tracker.TakeChange(Build.T0)!.State);
        Assert.Null(tracker.TakeChange(Build.T0));
        tracker.Disconnect("c1");
        Assert.Equal(OutputState.None, tracker.TakeChange(Build.T0)!.State);
    }

    [Fact]
    public void TakeChange_SmallMetricChange_IsThrottledToFiveSeconds()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(true, 100, 50, null), Build.T0);
        Assert.NotNull(tracker.TakeChange(Build.T0));

        tracker.Report("olk_a", new OutputReport(true, 110, 50, null), Build.T0.AddSeconds(2));
        Assert.Null(tracker.TakeChange(Build.T0.AddSeconds(2)));
        tracker.Report("olk_a", new OutputReport(true, 112, 50, null), Build.T0.AddSeconds(5));
        Assert.Equal(112, tracker.TakeChange(Build.T0.AddSeconds(5))!.LatencyMs);
    }

    [Fact]
    public void TakeChange_LargeMetricChange_PublishesImmediately()
    {
        tracker.Connect("c1", "olk_a", "10.0.0.5");
        tracker.Report("olk_a", new OutputReport(true, 100, 50, null), Build.T0);
        tracker.TakeChange(Build.T0);

        tracker.Report("olk_a", new OutputReport(true, 100, 30, null), Build.T0.AddSeconds(1));

        Assert.Equal(30, tracker.TakeChange(Build.T0.AddSeconds(1))!.Fps);
    }
}

public sealed class LiveKitRoomStateTests
{
    private readonly LiveKitRoomState room = new();

    private static LiveKitEvent Event(LiveKitEventKind kind, string sid, string? identity = "dev_a", string? track = null, string roomSid = "RM_1") =>
        new(kind, "prd_x", roomSid, sid, identity, track);

    [Fact]
    public void Apply_PublishAndUnpublish_TracksSlot()
    {
        room.Apply(Event(LiveKitEventKind.ParticipantJoined, "PA_1"));
        Assert.Equal(["dev_a"], room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_1", track: "camera")));
        Assert.True(room.IsPublished("dev_a", "camera"));

        room.Apply(Event(LiveKitEventKind.TrackUnpublished, "PA_1", track: "camera"));
        Assert.False(room.IsPublished("dev_a", "camera"));
    }

    [Fact]
    public void Apply_PublishWithoutJoin_IsTolerated()
    {
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_9", track: "screen-1"));

        Assert.True(room.IsPublished("dev_a", "screen-1"));
    }

    [Fact]
    public void Apply_LeftForUnknownSid_ChangesNothing() => Assert.Empty(room.Apply(Event(LiveKitEventKind.ParticipantLeft, "PA_unknown")));

    [Fact]
    public void Apply_DuplicateIdentity_OldLeaveKeepsNewSession()
    {
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_old", track: "camera"));
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_new", track: "camera"));

        room.Apply(Event(LiveKitEventKind.ParticipantLeft, "PA_old"));

        Assert.True(room.IsPublished("dev_a", "camera"));
    }

    [Fact]
    public void Apply_LateRoomFinishedOfOldSession_KeepsNewSession()
    {
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_old", track: "camera", roomSid: "RM_old"));
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_new", identity: "dev_b", track: "camera", roomSid: "RM_new"));

        var affected = room.Apply(Event(LiveKitEventKind.RoomFinished, null!, identity: null, roomSid: "RM_old"));

        Assert.Equal(["dev_a"], affected);
        Assert.False(room.IsPublished("dev_a", "camera"));
        Assert.True(room.IsPublished("dev_b", "camera"));
    }

    [Fact]
    public void Replace_ListedParticipants_ReplaceEverything()
    {
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_1", track: "camera"));

        var affected = room.Replace([new LiveKitParticipant("PA_2", "dev_b", ["screen-1"])]);

        Assert.Equal(["dev_a", "dev_b"], affected.Order(StringComparer.Ordinal));
        Assert.False(room.IsPublished("dev_a", "camera"));
        Assert.True(room.IsPublished("dev_b", "screen-1"));
    }

    [Fact]
    public void Apply_OtherEvent_IsIgnored() => Assert.Empty(room.Apply(Event(LiveKitEventKind.Other, "PA_1")));
}

public sealed class DeviceRuntimeTests
{
    private static readonly string[] OwnSlots = ["camera", "screen-1"];

    private readonly DeviceRuntime device = new("dev_a");

    [Fact]
    public void Attach_FirstSession_ReplacesNothing()
    {
        var takeover = device.Attach("c1", "tab-1", Build.T0);

        Assert.Null(takeover.ReplacedConnectionId);
        Assert.Equal("c1", device.ConnectionId);
    }

    [Fact]
    public void Attach_OtherTab_ReplacesAndNotifies()
    {
        device.Attach("c1", "tab-1", Build.T0);

        var takeover = device.Attach("c2", "tab-2", Build.T0);

        Assert.Equal(new SessionTakeover("c1", NotifyReplaced: true), takeover);
        Assert.Equal("tab-2", device.SessionId);
    }

    [Fact]
    public void Attach_SameTabReconnect_DropsStaleConnectionSilently()
    {
        device.Attach("c1", "tab-1", Build.T0);

        Assert.Equal(new SessionTakeover("c1", NotifyReplaced: false), device.Attach("c2", "tab-1", Build.T0));
    }

    [Fact]
    public void Attach_RepeatedHelloOnSameConnection_ReplacesNothing()
    {
        device.Attach("c1", "tab-1", Build.T0);

        Assert.Null(device.Attach("c1", "tab-1", Build.T0).ReplacedConnectionId);
    }

    [Fact]
    public void Detach_ReplacedConnection_IsIgnored()
    {
        device.Attach("c1", "tab-1", Build.T0);
        device.Attach("c2", "tab-2", Build.T0);

        Assert.False(device.Detach("c1", Build.T0));
        Assert.Equal("c2", device.ConnectionId);
        Assert.True(device.Detach("c2", Build.T0));
        Assert.False(device.IsConnected);
    }

    [Fact]
    public void ApplyReport_Values_AreSanitized()
    {
        var report = new DeviceReportDto(
            RtcState.Connected,
            [
                new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2500, 0.5, "h264"),
                new SlotTelemetryDto("../etc", SlotState.Live, 1, 1, 1, 1, 1, null),
                new SlotTelemetryDto("screen-1", SlotState.Live, -1, 99_999, -3, -1, 250, new string('c', 100)),
            ],
            150,
            true,
            new string('n', 100),
            -10,
            null);

        var (telemetry, techCheckChanged, _) = device.ApplyReport(report, OwnSlots, Build.T0);

        Assert.False(techCheckChanged);
        Assert.Equal(2, telemetry.Slots.Count);
        Assert.Null(telemetry.BatteryPct);
        Assert.Null(telemetry.RttMs);
        Assert.Equal(32, telemetry.Network!.Length);
        var screen = telemetry.Slots[1];
        Assert.Null(screen.Width);
        Assert.Null(screen.Height);
        Assert.Null(screen.Fps);
        Assert.Null(screen.PacketLossPct);
        Assert.Equal(32, screen.Codec!.Length);
        Assert.Equal(SlotState.Live, device.SlotStateOf("camera"));
        Assert.Equal(Build.T0, telemetry.At);
    }

    [Fact]
    public void ApplyReport_EncoderAndQualityLimitation_AreKeptAndSanitized()
    {
        var report = new DeviceReportDto(
            RtcState.Connected,
            [
                new SlotTelemetryDto("camera", SlotState.Live, 1920, 1080, 30, 2500, 0, "h264", "VideoToolbox", true, null),
                new SlotTelemetryDto("screen-1", SlotState.Live, 2560, 1440, 15, 3000, 0, "vp9", new string('e', 100), false, "cpu"),
                new SlotTelemetryDto("screen-2", SlotState.Live, 2560, 1440, 15, 3000, 0, "h264", null, null, "<script>"),
                new SlotTelemetryDto("screen-3", SlotState.Live, 2560, 1440, 15, 3000, 0, "h264", null, null, "bandwidth"),
            ],
            null,
            null,
            null,
            null,
            null);

        var (telemetry, _, _) = device.ApplyReport(report, [.. OwnSlots, "screen-2", "screen-3"], Build.T0);

        var camera = telemetry.Slots.Single(s => s.Slot == "camera");
        Assert.Equal("VideoToolbox", camera.Encoder);
        Assert.True(camera.HardwareEncoder);
        Assert.Null(camera.QualityLimitation);
        var screen = telemetry.Slots.Single(s => s.Slot == "screen-1");
        Assert.Equal(64, screen.Encoder!.Length);
        Assert.False(screen.HardwareEncoder);
        Assert.Equal("cpu", screen.QualityLimitation);
        Assert.Null(telemetry.Slots.Single(s => s.Slot == "screen-2").QualityLimitation);
        Assert.Equal("bandwidth", telemetry.Slots.Single(s => s.Slot == "screen-3").QualityLimitation);
    }

    [Fact]
    public void ApplyReport_SameTechCheckTwice_ChangesOnlyOnce()
    {
        var check = new TechCheckDto(TechCheckLevel.Ok, TechCheckLevel.Ok, TechCheckLevel.Ok, TechCheckLevel.Warn, 4000, 30, Build.T0, null);
        var report = new DeviceReportDto(RtcState.Connected, [], null, null, null, null, check);

        Assert.True(device.ApplyReport(report, OwnSlots, Build.T0).TechCheckChanged);
        Assert.False(device.ApplyReport(report, OwnSlots, Build.T0.AddSeconds(2)).TechCheckChanged);
    }

    [Fact]
    public void ApplyReport_SlotMissingFromNextReport_HasNoState()
    {
        device.Attach("c1", "tab-1", Build.T0);
        device.ApplyReport(Report(("camera", SlotState.Live), ("screen-1", SlotState.Live)), OwnSlots, Build.T0);

        device.ApplyReport(Report(("screen-1", SlotState.Ended)), OwnSlots, Build.T0.AddSeconds(2));

        Assert.Null(device.SlotStateOf("camera"));
        Assert.Equal(SlotState.Ended, device.SlotStateOf("screen-1"));
    }

    [Fact]
    public void Attach_NewSession_StartsWithoutReportedStates()
    {
        device.Attach("c1", "tab-1", Build.T0);
        device.ApplyReport(Report(("camera", SlotState.Live), ("screen-1", SlotState.Ended)), OwnSlots, Build.T0);

        device.Attach("c2", "tab-2", Build.T0.AddSeconds(1));

        Assert.Null(device.SlotStateOf("camera"));
        Assert.Null(device.SlotStateOf("screen-1"));
        Assert.Null(device.Rtc);
    }

    [Fact]
    public void Attach_ReloadAfterDisconnect_StartsWithoutReportedStates()
    {
        device.Attach("c1", "page-1", Build.T0);
        device.ApplyReport(Report(("screen-1", SlotState.Ended)), OwnSlots, Build.T0);
        device.Detach("c1", Build.T0.AddSeconds(1));

        device.Attach("c2", "page-2", Build.T0.AddSeconds(2));

        Assert.Null(device.SlotStateOf("screen-1"));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Attach_SameSessionReconnect_KeepsReportedStates(bool disconnectedBefore)
    {
        device.Attach("c1", "tab-1", Build.T0);
        device.ApplyReport(Report(("camera", SlotState.Failed), ("screen-1", SlotState.Ended)), OwnSlots, Build.T0);
        if (disconnectedBefore)
        {
            device.Detach("c1", Build.T0.AddSeconds(1));
        }

        device.Attach("c2", "tab-1", Build.T0.AddSeconds(2));

        Assert.Equal(SlotState.Failed, device.SlotStateOf("camera"));
        Assert.Equal(SlotState.Ended, device.SlotStateOf("screen-1"));
    }

    [Fact]
    public void ApplyReport_NullSlots_AreTolerated() =>
        Assert.Empty(device.ApplyReport(new DeviceReportDto((RtcState)99, null!, null, null, null, null, null), OwnSlots, Build.T0).Telemetry.Slots);

    private static DeviceReportDto Report(params (string Slot, SlotState State)[] slots) =>
        new(RtcState.Connected, [.. slots.Select(s => new SlotTelemetryDto(s.Slot, s.State, 1280, 720, 30, 2500, 0, "h264"))], null, null, null, null, null);
}

public sealed class OutputViewTests
{
    public static TheoryData<ProductionEvent> PrivateEvents => new()
    {
        new DeviceRemovedEvent(1, "dev_a"),
        new PairingRequestRemovedEvent(1, "prq_a", PairingRequestStatus.Denied),
        new InviteRemovedEvent(1, "inv_a"),
        new IncidentRemovedEvent(1, "inc_a"),
        new LogAppendedEvent(1, new LogEntryDto(Build.T0, LogCode.BroadcastStarted, new Dictionary<string, string>(), "x")),
        new OutputStatusChangedEvent(1, new OutputStatusDto(OutputState.None, 0, [], null, null, null, [])),
    };

    [Theory]
    [MemberData(nameof(PrivateEvents))]
    public void ForOutput_PrivateEvent_BecomesRevisionOnly(ProductionEvent productionEvent)
    {
        var output = OutputView.ForOutput(productionEvent);

        Assert.IsType<RevisionOnlyEvent>(output);
        Assert.Equal(productionEvent.Revision, output.Revision);
    }

    [Fact]
    public void ForOutput_SceneEvent_PassesThrough()
    {
        var scene = new SceneRemovedEvent(7, "scn_a");

        Assert.Same(scene, OutputView.ForOutput(scene));
    }

    [Fact]
    public void ForOutput_SourceUpserted_HasNoHealth()
    {
        var source = new SourceDto("dev_a/camera", "K1", SourceKind.Camera, "Phone", "dev_a", "camera", null, SourceStatus.Reconnecting, Build.T0, null);

        var output = Assert.IsType<SourceUpsertedEvent>(OutputView.ForOutput(new SourceUpsertedEvent(3, source)));

        Assert.Equal(SourceStatus.Ok, output.Source.Status);
        Assert.Null(output.Source.StatusSince);
        Assert.Equal("Phone", output.Source.Label);
    }
}

public sealed class LoginThrottleTests
{
    private readonly ManualClock clock = new();
    private readonly LoginThrottle throttle;

    public LoginThrottleTests() => throttle = new LoginThrottle(clock);

    [Fact]
    public void RegisterFailure_FifthFailurePerIp_LocksFifteenMinutes()
    {
        for (var i = 0; i < 4; i++)
        {
            Assert.Null(throttle.RegisterFailure("1.1.1.1", "admin"));
        }

        Assert.Equal(TimeSpan.FromMinutes(15), throttle.RegisterFailure("1.1.1.1", "admin"));
        Assert.NotNull(throttle.LockedFor("1.1.1.1", "someone"));
        Assert.Null(throttle.LockedFor("2.2.2.2", "admin"));
        clock.Advance(TimeSpan.FromMinutes(15));
        Assert.Null(throttle.LockedFor("1.1.1.1", "admin"));
    }

    [Fact]
    public void RegisterFailure_OldFailures_LeaveTheWindow()
    {
        for (var i = 0; i < 4; i++)
        {
            throttle.RegisterFailure("1.1.1.1", "admin");
        }

        clock.Advance(TimeSpan.FromMinutes(16));

        Assert.Null(throttle.RegisterFailure("1.1.1.1", "admin"));
    }

    [Fact]
    public void RegisterSuccess_ClearsIpFailures()
    {
        for (var i = 0; i < 4; i++)
        {
            throttle.RegisterFailure("1.1.1.1", "admin");
        }

        throttle.RegisterSuccess("1.1.1.1");

        Assert.Null(throttle.RegisterFailure("1.1.1.1", "admin"));
    }

    [Fact]
    public void RegisterFailure_TwentyFailuresForUserFromManyIps_LocksUser()
    {
        TimeSpan? lockout = null;
        for (var i = 0; i < throttle.MaxFailuresPerUser; i++)
        {
            lockout = throttle.RegisterFailure($"10.0.0.{i}", " Admin ");
        }

        Assert.NotNull(lockout);
        Assert.NotNull(throttle.LockedFor("10.9.9.9", "admin"));
        Assert.Null(throttle.LockedFor("10.9.9.9", "other"));
    }

    [Fact]
    public void Prune_ExpiredCounters_AreForgotten()
    {
        throttle.RegisterFailure("1.1.1.1", "admin");
        clock.Advance(TimeSpan.FromMinutes(20));

        throttle.Prune();

        for (var i = 0; i < 4; i++)
        {
            Assert.Null(throttle.RegisterFailure("1.1.1.1", "admin"));
        }
    }
}
