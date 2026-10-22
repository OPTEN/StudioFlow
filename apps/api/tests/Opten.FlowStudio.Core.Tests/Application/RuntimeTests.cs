using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Tests.Application;

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
    private readonly OutputTracker tracker = new();

    [Fact]
    public void Current_NoPage_IsNone() => Assert.Equal(OutputState.None, tracker.Current(Build.T0).State);

    [Fact]
    public void Current_ConnectedWithoutRenderingReport_IsStale()
    {
        tracker.Connect("c1", "10.0.0.5");
        tracker.Report(new OutputReport(false, null, null, null), Build.T0);

        Assert.Equal(OutputState.Stale, tracker.Current(Build.T0).State);
    }

    [Fact]
    public void Current_FreshRenderingReport_IsConnectedForSixSeconds()
    {
        tracker.Connect("c1", "10.0.0.5");
        tracker.Connect("c2", "10.0.0.5");
        tracker.Report(new OutputReport(true, 120, 50, "scn_a"), Build.T0);

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
        tracker.Report(new OutputReport(true, -5, 5000, null), Build.T0);

        Assert.Null(tracker.Current(Build.T0).LatencyMs);
        Assert.Null(tracker.Current(Build.T0).Fps);
    }

    [Fact]
    public void TakeChange_StateChange_PublishesImmediately()
    {
        tracker.Connect("c1", "10.0.0.5");

        Assert.Equal(OutputState.Stale, tracker.TakeChange(Build.T0)!.State);
        Assert.Null(tracker.TakeChange(Build.T0));
        tracker.Disconnect("c1");
        Assert.Equal(OutputState.None, tracker.TakeChange(Build.T0)!.State);
    }

    [Fact]
    public void TakeChange_SmallMetricChange_IsThrottledToFiveSeconds()
    {
        tracker.Connect("c1", "10.0.0.5");
        tracker.Report(new OutputReport(true, 100, 50, null), Build.T0);
        Assert.NotNull(tracker.TakeChange(Build.T0));

        tracker.Report(new OutputReport(true, 110, 50, null), Build.T0.AddSeconds(2));
        Assert.Null(tracker.TakeChange(Build.T0.AddSeconds(2)));
        tracker.Report(new OutputReport(true, 112, 50, null), Build.T0.AddSeconds(5));
        Assert.Equal(112, tracker.TakeChange(Build.T0.AddSeconds(5))!.LatencyMs);
    }

    [Fact]
    public void TakeChange_LargeMetricChange_PublishesImmediately()
    {
        tracker.Connect("c1", "10.0.0.5");
        tracker.Report(new OutputReport(true, 100, 50, null), Build.T0);
        tracker.TakeChange(Build.T0);

        tracker.Report(new OutputReport(true, 100, 30, null), Build.T0.AddSeconds(1));

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

        var (telemetry, techCheckChanged) = device.ApplyReport(report, Build.T0);

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
    public void ApplyReport_SameTechCheckTwice_ChangesOnlyOnce()
    {
        var check = new TechCheckDto(TechCheckLevel.Ok, TechCheckLevel.Ok, TechCheckLevel.Ok, TechCheckLevel.Warn, 4000, 30, Build.T0, null);
        var report = new DeviceReportDto(RtcState.Connected, [], null, null, null, null, check);

        Assert.True(device.ApplyReport(report, Build.T0).TechCheckChanged);
        Assert.False(device.ApplyReport(report, Build.T0.AddSeconds(2)).TechCheckChanged);
    }

    [Fact]
    public void ApplyReport_NullSlots_AreTolerated() =>
        Assert.Empty(device.ApplyReport(new DeviceReportDto((RtcState)99, null!, null, null, null, null, null), Build.T0).Telemetry.Slots);
}

public sealed class OutputViewTests
{
    public static TheoryData<ProductionEvent> PrivateEvents => new()
    {
        new DeviceRemovedEvent(1, "dev_a"),
        new PairingRequestRemovedEvent(1, "prq_a", PairingRequestStatus.Denied),
        new InviteRemovedEvent(1, "inv_a"),
        new IncidentRemovedEvent(1, "inc_a"),
        new LogAppendedEvent(1, new LogEntryDto(Build.T0, "x")),
        new OutputStatusChangedEvent(1, new OutputStatusDto(OutputState.None, 0, [], null, null, null)),
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
        var source = new SourceDto("dev_a/camera", "K1", SourceKind.Camera, "Handy", "dev_a", "camera", null, SourceStatus.Reconnecting, Build.T0);

        var output = Assert.IsType<SourceUpsertedEvent>(OutputView.ForOutput(new SourceUpsertedEvent(3, source)));

        Assert.Equal(SourceStatus.Ok, output.Source.Status);
        Assert.Null(output.Source.StatusSince);
        Assert.Equal("Handy", output.Source.Label);
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
        for (var i = 0; i < LoginThrottle.MaxFailuresPerUser; i++)
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
