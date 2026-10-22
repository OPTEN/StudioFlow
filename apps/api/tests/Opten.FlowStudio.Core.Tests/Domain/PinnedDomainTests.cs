using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Tests.Domain;

/// <summary>GAP-01: every duration and limit is a validated setting with the spec default.</summary>
public sealed class OptionsTests
{
    [Fact]
    public void Defaults_AreTheSpecValuesAndValid()
    {
        var pairing = new PairingOptions();
        var lockout = new LoginLockoutOptions();
        var sources = new SourceMonitorOptions();
        var output = new OutputMonitorOptions();
        var realtime = new RealtimeOptions();

        Assert.Equal((TimeSpan.FromMinutes(30), TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5)), (pairing.InviteTtl, pairing.RequestTtl, pairing.CredentialsWindow, pairing.RedeemIdempotencyWindow));
        Assert.Equal((10, 20, 20), (pairing.Limits.RequestsPerIpPer10Min, pairing.Limits.PendingTotal, pairing.Limits.RedeemPerIpPer10Min));
        Assert.Equal((5, 20, TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(15)), (lockout.MaxFailuresPerIp, lockout.MaxFailuresPerUser, lockout.Window, lockout.Duration));
        Assert.Equal((TimeSpan.FromSeconds(6), TimeSpan.FromSeconds(15), TimeSpan.FromHours(12)), (sources.ReportStaleAfter, sources.RestartGrace, sources.RestartLiveWindow));
        Assert.Equal((TimeSpan.FromSeconds(6), TimeSpan.FromSeconds(5)), (output.StaleAfter, output.MetricsInterval));
        Assert.Equal((TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5)), (realtime.KeepAliveInterval, realtime.ClientTimeout));
        Assert.Empty(new IValidatedOptions[] { pairing, lockout, sources, output, realtime }.SelectMany(o => o.Validate()));
    }

    [Fact]
    public void Validate_OutOfRange_NamesTheKeys()
    {
        var pairing = new PairingOptions { InviteTtl = TimeSpan.Zero, Limits = new PairingLimits { PendingTotal = 0 } };
        var realtime = new RealtimeOptions { KeepAliveInterval = TimeSpan.FromSeconds(3), ClientTimeout = TimeSpan.FromSeconds(5) };
        var lockout = new LoginLockoutOptions { MaxFailuresPerIp = 0 };

        var errors = pairing.Validate().Concat(realtime.Validate()).Concat(lockout.Validate()).ToList();

        Assert.Contains(errors, e => e.StartsWith("Pairing:InviteTtl", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.StartsWith("Pairing:Limits:PendingTotal", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.StartsWith("Realtime:ClientTimeout must be at least twice", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.StartsWith("Admin:Lockout:MaxFailuresPerIp", StringComparison.Ordinal));
    }

    [Fact]
    public void LoginThrottle_ConfiguredLimits_AreApplied()
    {
        var clock = new ManualClock();
        var throttle = new LoginThrottle(clock, new LoginLockoutOptions { MaxFailuresPerIp = 2, Duration = TimeSpan.FromSeconds(30) });

        Assert.Null(throttle.RegisterFailure("10.0.0.1", "admin"));
        Assert.Equal(TimeSpan.FromSeconds(30), throttle.RegisterFailure("10.0.0.1", "admin"));
        clock.Advance(TimeSpan.FromSeconds(30));
        Assert.Null(throttle.LockedFor("10.0.0.1", "admin"));
    }

    [Fact]
    public void OutputTracker_ConfiguredStaleAfter_IsApplied()
    {
        var tracker = new OutputTracker(new OutputMonitorOptions { StaleAfter = TimeSpan.FromSeconds(2) });
        tracker.Connect("c1", "10.0.0.5");
        tracker.Report(new OutputReport(true, 50, 30, null), Build.T0);

        Assert.Equal(OutputState.Connected, tracker.Current(Build.T0.AddSeconds(2)).State);
        Assert.Equal(OutputState.Stale, tracker.Current(Build.T0.AddSeconds(3)).State);
    }

    [Fact]
    public void PairingRequestStore_ConfiguredPendingLimit_IsApplied()
    {
        var store = new PairingRequestStore(new PairingOptions { Limits = new PairingLimits { PendingTotal = 2 } });
        store.Create("prd_x", new CreatePairingRequest("A", DeviceKind.Laptop, "p"), Build.T0);
        store.Create("prd_x", new CreatePairingRequest("B", DeviceKind.Laptop, "p"), Build.T0);

        Assert.Equal(ErrorCodes.RateLimited, Assert.Throws<FlowStudioException>(() => store.Create("prd_x", new CreatePairingRequest("C", DeviceKind.Laptop, "p"), Build.T0)).Code);
    }
}

/// <summary>GAP-13: display names of assets.</summary>
public sealed class AssetNameTests
{
    [Theory]
    [InlineData("../../etc/passwd.png", "passwd")]
    [InlineData("..\\..\\x.png", "x")]
    [InlineData("C:\\x.png", "x")]
    [InlineData("/abs/x.png", "x")]
    [InlineData("x.png\0.exe", "x.png")]
    [InlineData("\u202egnp.exe", "gnp")]
    [InlineData(".hidden.png", ".hidden")]
    [InlineData("CON.png", "CON")]
    [InlineData("Logo 🎉.webp", "Logo 🎉")]
    [InlineData("...", "Medium")]
    [InlineData("   ", "Medium")]
    [InlineData("", "Medium")]
    [InlineData(null, "Medium")]
    public void NameFromFileName_AnyInput_IsSinglePathFreeSegment(string? fileName, string expected) =>
        Assert.Equal(expected, Asset.NameFromFileName(fileName));

    [Fact]
    public void NameFromFileName_LongName_IsCutTo80TextElements() =>
        Assert.Equal(80, new System.Globalization.StringInfo(Asset.NameFromFileName(new string('a', 300) + ".png")).LengthInTextElements);

    [Fact]
    public void Rename_SameRulesAsUpload_TraversalIsSanitisedAndEmptyIsInvalid()
    {
        var asset = Build.Image(Build.Production());

        asset.Rename("../../etc/Pause\u202e");

        Assert.Equal("Pause", asset.Name);
        Assert.Equal(ErrorCodes.ValidationFailed, Assert.Throws<FlowStudioException>(() => asset.Rename("..")).Code);
        Assert.Equal(ErrorCodes.ValidationFailed, Assert.Throws<FlowStudioException>(() => asset.Rename(new string('b', 81))).Code);
    }

    [Fact]
    public void TextRules_BidiControls_AreRemovedFromNames() =>
        Assert.Equal("Laptop Lea", TextRules.RequireName("\u2066Laptop\u200e Lea\u202c", TextRules.DeviceNameMax, "name"));
}

/// <summary>GAP-22: webhooks are processed state-based; duplicates and late events converge.</summary>
public sealed class LiveKitRoomStateTests
{
    private readonly LiveKitRoomState room = new();

    [Fact]
    public void Apply_UnpublishedBeforeLatePublished_StaysUnpublished()
    {
        room.Apply(Event(LiveKitEventKind.TrackUnpublished, "PA_1", "TR_1"));
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_1", "TR_1"));

        Assert.False(room.IsPublished("dev_a", "camera"));
    }

    [Fact]
    public void Apply_DuplicatesAndRepublishWithNewSid_Converge()
    {
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_1", "TR_1"));
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_1", "TR_1"));
        room.Apply(Event(LiveKitEventKind.TrackUnpublished, "PA_1", "TR_1"));
        room.Apply(Event(LiveKitEventKind.TrackUnpublished, "PA_1", "TR_1"));
        Assert.False(room.IsPublished("dev_a", "camera"));

        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_1", "TR_2"));
        Assert.True(room.IsPublished("dev_a", "camera"));
    }

    [Fact]
    public void Apply_LateJoinOrPublishAfterLeft_IsIgnored()
    {
        room.Apply(Event(LiveKitEventKind.ParticipantLeft, "PA_1", null));
        room.Apply(Event(LiveKitEventKind.ParticipantJoined, "PA_1", null));
        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_1", "TR_1"));
        Assert.False(room.IsPublished("dev_a", "camera"));

        room.Apply(Event(LiveKitEventKind.TrackPublished, "PA_2", "TR_2"));
        Assert.True(room.IsPublished("dev_a", "camera"));
    }

    [Fact]
    public void Replace_ListedParticipant_WinsOverAnEarlierLeft()
    {
        room.Apply(Event(LiveKitEventKind.ParticipantLeft, "PA_1", null));
        room.Replace([new LiveKitParticipant("PA_1", "dev_a", ["camera"])]);

        Assert.True(room.IsPublished("dev_a", "camera"));
    }

    private static LiveKitEvent Event(LiveKitEventKind kind, string participantSid, string? trackSid) =>
        new(kind, "prd_x", "RM_1", participantSid, "dev_a", trackSid is null ? null : "camera", trackSid);
}

/// <summary>GAP-08 / spec 12: a reported media loss counts at once, even while LiveKit still lists the track.</summary>
public sealed class MediaLossRuleTests
{
    [Theory]
    [InlineData(RtcState.Reconnecting, true, SourceStatus.Reconnecting)]
    [InlineData(RtcState.Disconnected, true, SourceStatus.Reconnecting)]
    [InlineData(RtcState.Reconnecting, false, SourceStatus.Connecting)]
    [InlineData(RtcState.Connected, true, SourceStatus.Ok)]
    public void Evaluate_PublishedTrackWithReportedRtc_FollowsTheReport(RtcState rtc, bool wasLive, SourceStatus expected) =>
        Assert.Equal(expected, SourceStatusRules.Evaluate(new SlotSignals(false, true, true, SlotState.Live, rtc), wasLive));

    [Fact]
    public void MarkMissingAfterRestart_OfflineSource_OpensReconnectingIncidentSinceTheRestart()
    {
        var health = new SourceHealth("dev_a/camera", "K1", SourceStatus.Offline);

        var change = health.MarkMissingAfterRestart(Build.T0.AddSeconds(15), Build.T0);

        Assert.Equal((SourceStatus.Reconnecting, true), (health.Status, health.WasLive));
        Assert.Equal((IncidentKind.Reconnecting, Build.T0, AuditActions.SourceReconnecting), (change.UpsertedIncident!.Kind, change.UpsertedIncident.StartedAt, change.LogAction));
        Assert.Same(SourceHealthChange.None, health.MarkMissingAfterRestart(Build.T0.AddSeconds(16), Build.T0));
    }

    [Fact]
    public void Acknowledge_OpenIncident_IsConflict()
    {
        var health = new SourceHealth("dev_a/camera", "K1", SourceStatus.Ok);
        var incident = health.Apply(SourceStatus.Reconnecting, Build.T0).UpsertedIncident!;

        Assert.Equal(ErrorCodes.Conflict, Assert.Throws<FlowStudioException>(() => health.Acknowledge(incident.Id)).Code);
        health.Apply(SourceStatus.Ok, Build.T0.AddSeconds(5));
        Assert.True(health.Acknowledge(incident.Id));
        Assert.False(health.Acknowledge(incident.Id));
    }
}
