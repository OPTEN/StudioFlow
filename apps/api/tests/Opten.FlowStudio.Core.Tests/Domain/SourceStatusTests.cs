using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Tests.Domain;

public sealed class SourceStatusRulesTests
{
    public static TheoryData<SlotSignals, bool, SourceStatus> Cases => new()
    {
        { new SlotSignals(Blocked: true, Connected: true, Published: true, SlotState.Live, RtcState.Connected), true, SourceStatus.Blocked },
        { new SlotSignals(false, true, true, SlotState.Ended, RtcState.Connected), true, SourceStatus.Ended },
        { new SlotSignals(false, false, false, SlotState.Ended, null), false, SourceStatus.Ended },
        { new SlotSignals(false, true, false, SlotState.Paused, RtcState.Connected), true, SourceStatus.Reconnecting },
        { new SlotSignals(false, true, true, SlotState.Paused, RtcState.Connected), true, SourceStatus.Reconnecting },
        { new SlotSignals(false, true, true, SlotState.Paused, RtcState.Connected), false, SourceStatus.Connecting },
        { new SlotSignals(false, false, false, SlotState.Paused, null), true, SourceStatus.Reconnecting },
        { new SlotSignals(false, false, false, SlotState.Paused, null), false, SourceStatus.Offline },
        { new SlotSignals(false, true, false, null, RtcState.Connected), true, SourceStatus.Reconnecting },
        { new SlotSignals(false, true, false, null, RtcState.Connected), false, SourceStatus.Connecting },
        { new SlotSignals(false, true, true, null, RtcState.Connected), true, SourceStatus.Ok },
        { new SlotSignals(false, true, true, SlotState.Starting, null), false, SourceStatus.Ok },
        { new SlotSignals(false, true, true, SlotState.Failed, RtcState.Connected), true, SourceStatus.Lost },
        { new SlotSignals(false, true, true, null, null), false, SourceStatus.Ok },
        { new SlotSignals(false, true, false, SlotState.Live, RtcState.Connected), false, SourceStatus.Ok },
        { new SlotSignals(false, true, false, SlotState.Live, RtcState.Reconnecting), true, SourceStatus.Reconnecting },
        { new SlotSignals(false, true, false, SlotState.Live, RtcState.Reconnecting), false, SourceStatus.Connecting },
        { new SlotSignals(false, false, true, SlotState.Live, RtcState.Connected), true, SourceStatus.Reconnecting },
        { new SlotSignals(false, false, true, null, null), false, SourceStatus.Offline },
        { new SlotSignals(false, true, false, SlotState.Starting, RtcState.Connected), false, SourceStatus.Connecting },
        { new SlotSignals(false, true, false, SlotState.Starting, RtcState.Connected), true, SourceStatus.Reconnecting },
        { new SlotSignals(false, false, false, null, null), false, SourceStatus.Offline },
        { new SlotSignals(false, false, false, null, null), true, SourceStatus.Reconnecting },
    };

    [Theory]
    [MemberData(nameof(Cases))]
    public void Evaluate_Signals_FollowsSpecification(SlotSignals signals, bool wasLive, SourceStatus expected) =>
        Assert.Equal(expected, SourceStatusRules.Evaluate(signals, wasLive));

    [Theory]
    [InlineData(true, null, null)]
    [InlineData(true, SlotState.Starting, RtcState.Connected)]
    [InlineData(false, SlotState.Live, RtcState.Connected)]
    [InlineData(true, SlotState.Live, null)]
    public void IsLive_PublishedTrackOrReportedLiveOverConnectedMedia_IsTrue(bool published, SlotState? reported, RtcState? rtc) =>
        Assert.True(new SlotSignals(false, true, published, reported, rtc).IsLive);

    [Theory]
    [InlineData(false, null, RtcState.Connected)]
    [InlineData(false, SlotState.Live, null)]
    [InlineData(false, SlotState.Starting, RtcState.Connected)]
    [InlineData(true, SlotState.Paused, RtcState.Connected)]
    [InlineData(false, SlotState.Paused, RtcState.Connected)]
    [InlineData(true, SlotState.Live, RtcState.Reconnecting)]
    public void IsLive_NothingPublishedAndNoLiveReportOrPaused_IsFalse(bool published, SlotState? reported, RtcState? rtc) =>
        Assert.False(new SlotSignals(false, true, published, reported, rtc).IsLive);

    [Theory]
    [InlineData(SourceStatus.Reconnecting, true)]
    [InlineData(SourceStatus.Ended, true)]
    [InlineData(SourceStatus.Lost, true)]
    [InlineData(SourceStatus.Ok, false)]
    [InlineData(SourceStatus.Blocked, false)]
    [InlineData(SourceStatus.Offline, false)]
    [InlineData(SourceStatus.Connecting, false)]
    public void IsDown_Status_OnlyOutages(SourceStatus status, bool expected) => Assert.Equal(expected, SourceStatusRules.IsDown(status));
}

public sealed class SourceHealthTests
{
    private readonly SourceHealth health = new("dev_a/camera", "K2", SourceStatus.Offline);

    [Fact]
    public void Apply_SameStatus_ChangesNothing() => Assert.Same(SourceHealthChange.None, health.Apply(SourceStatus.Offline, Build.T0));

    [Fact]
    public void Apply_FirstConnectionAndLive_OpensNoIncident()
    {
        Assert.True(health.Apply(SourceStatus.Connecting, Build.T0).StatusChanged);
        var live = health.Apply(SourceStatus.Ok, Build.T0.AddSeconds(1));

        Assert.True(live.StatusChanged);
        Assert.Null(live.UpsertedIncident);
        Assert.Null(live.LogAction);
        Assert.True(health.WasLive);
        Assert.Equal(Build.T0.AddSeconds(1), health.Since);
    }

    [Theory]
    [InlineData(SourceStatus.Reconnecting, IncidentKind.Reconnecting, AuditActions.SourceReconnecting)]
    [InlineData(SourceStatus.Ended, IncidentKind.Ended, AuditActions.SourceEnded)]
    [InlineData(SourceStatus.Lost, IncidentKind.Lost, AuditActions.SourceLost)]
    public void Apply_OkToOutage_OpensIncidentAndLogs(SourceStatus outage, IncidentKind kind, string action)
    {
        health.Apply(SourceStatus.Ok, Build.T0);

        var change = health.Apply(outage, Build.T0.AddSeconds(10));

        Assert.NotNull(change.UpsertedIncident);
        Assert.Equal(kind, change.UpsertedIncident.Kind);
        Assert.Equal("K2", change.UpsertedIncident.Code);
        Assert.Equal("dev_a/camera", change.UpsertedIncident.SourceId);
        Assert.Equal(Build.T0.AddSeconds(10), change.UpsertedIncident.StartedAt);
        Assert.Null(change.UpsertedIncident.EndedAt);
        Assert.Equal(action, change.LogAction);
        Assert.Null(change.RemovedIncident);
    }

    [Fact]
    public void Apply_BackToOk_RecoversIncidentUntilAcknowledged()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        var incident = health.Apply(SourceStatus.Reconnecting, Build.T0.AddSeconds(1)).UpsertedIncident!;

        var recovery = health.Apply(SourceStatus.Ok, Build.T0.AddSeconds(10));

        Assert.Equal(incident.Id, recovery.UpsertedIncident!.Id);
        Assert.Equal(Build.T0.AddSeconds(10), recovery.UpsertedIncident.EndedAt);
        Assert.Equal(AuditActions.SourceRecovered, recovery.LogAction);
        Assert.False(health.Acknowledge("inc_other"));
        Assert.True(health.Acknowledge(incident.Id));
        Assert.Null(health.Incident);
    }

    [Fact]
    public void Apply_Flapping_ReplacesTheRecoveredIncident()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        var first = health.Apply(SourceStatus.Reconnecting, Build.T0.AddSeconds(1)).UpsertedIncident!;
        health.Apply(SourceStatus.Ok, Build.T0.AddSeconds(2));

        var second = health.Apply(SourceStatus.Reconnecting, Build.T0.AddSeconds(3));

        Assert.Equal(first.Id, second.RemovedIncident!.Id);
        Assert.NotEqual(first.Id, second.UpsertedIncident!.Id);
        Assert.Equal(AuditActions.SourceReconnecting, second.LogAction);
    }

    [Fact]
    public void Apply_ReconnectingThenFailed_EscalatesIncidentKind()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        var opened = health.Apply(SourceStatus.Reconnecting, Build.T0.AddSeconds(1)).UpsertedIncident!;

        var escalated = health.Apply(SourceStatus.Lost, Build.T0.AddSeconds(5));

        Assert.Equal(opened.Id, escalated.UpsertedIncident!.Id);
        Assert.Equal(IncidentKind.Lost, escalated.UpsertedIncident.Kind);
        Assert.Equal(Build.T0.AddSeconds(1), escalated.UpsertedIncident.StartedAt);
        Assert.Equal(AuditActions.SourceLost, escalated.LogAction);
    }

    [Fact]
    public void Apply_PausedThenStoppedOnPurpose_EscalatesReconnectingToEnded()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        var paused = health.Apply(SourceStatusRules.Evaluate(new SlotSignals(false, true, true, SlotState.Paused, RtcState.Connected), health.WasLive), Build.T0.AddSeconds(1));

        var stopped = health.Apply(SourceStatusRules.Evaluate(new SlotSignals(false, true, false, SlotState.Ended, RtcState.Connected), health.WasLive), Build.T0.AddSeconds(4));

        Assert.Equal((IncidentKind.Reconnecting, AuditActions.SourceReconnecting), (paused.UpsertedIncident!.Kind, paused.LogAction));
        Assert.Equal(paused.UpsertedIncident.Id, stopped.UpsertedIncident!.Id);
        Assert.Equal((IncidentKind.Ended, AuditActions.SourceEnded), (stopped.UpsertedIncident.Kind, stopped.LogAction));
        Assert.Equal(Build.T0.AddSeconds(1), stopped.UpsertedIncident.StartedAt);
    }

    [Fact]
    public void Apply_PausedThenBack_RecoversTheReconnectingIncident()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        var paused = health.Apply(SourceStatusRules.Evaluate(new SlotSignals(false, true, true, SlotState.Paused, RtcState.Connected), health.WasLive), Build.T0.AddSeconds(1));

        var back = health.Apply(SourceStatusRules.Evaluate(new SlotSignals(false, true, true, SlotState.Live, RtcState.Connected), health.WasLive), Build.T0.AddSeconds(8));

        Assert.Equal(SourceStatus.Ok, health.Status);
        Assert.Equal(paused.UpsertedIncident!.Id, back.UpsertedIncident!.Id);
        Assert.Equal((Build.T0.AddSeconds(8), AuditActions.SourceRecovered), (back.UpsertedIncident.EndedAt, back.LogAction));
    }

    [Fact]
    public void Apply_EndedThenRestarting_KeepsEndedIncident()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        health.Apply(SourceStatus.Ended, Build.T0.AddSeconds(1));

        var restarting = health.Apply(SourceStatus.Reconnecting, Build.T0.AddSeconds(5));

        Assert.True(restarting.StatusChanged);
        Assert.Null(restarting.UpsertedIncident);
        Assert.Equal(IncidentKind.Ended, health.Incident!.Kind);
    }

    [Fact]
    public void Apply_FailedBeforeEverLive_OpensNoIncident()
    {
        health.Apply(SourceStatus.Connecting, Build.T0);

        var change = health.Apply(SourceStatus.Lost, Build.T0.AddSeconds(1));

        Assert.True(change.StatusChanged);
        Assert.Null(change.UpsertedIncident);
        Assert.Null(health.Incident);
    }

    [Fact]
    public void Apply_Blocked_RemovesIncidentAndForgetsLive()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        var incident = health.Apply(SourceStatus.Reconnecting, Build.T0.AddSeconds(1)).UpsertedIncident!;

        var blocked = health.Apply(SourceStatus.Blocked, Build.T0.AddSeconds(2));

        Assert.Equal(incident.Id, blocked.RemovedIncident!.Id);
        Assert.Null(health.Incident);
        Assert.False(health.WasLive);
        Assert.Null(blocked.LogAction);
    }

    [Fact]
    public void Apply_OkToBlocked_HasNoIncident() =>
        Assert.Null(new SourceHealth("s", "K1", SourceStatus.Ok).Apply(SourceStatus.Blocked, Build.T0).UpsertedIncident);

    [Fact]
    public void ClearIncident_Open_ReturnsIt()
    {
        health.Apply(SourceStatus.Ok, Build.T0);
        var incident = health.Apply(SourceStatus.Ended, Build.T0).UpsertedIncident;

        Assert.Equal(incident, health.ClearIncident());
        Assert.Null(health.ClearIncident());
    }
}

public sealed class OnAirStateTests
{
    private readonly Production production = Build.Production();
    private readonly Device laptop;
    private readonly SourceCatalog catalog;

    public OnAirStateTests()
    {
        laptop = Build.Laptop(production);
        laptop.AllocateSlot(SourceKind.Screen, ["S1"]);
        laptop.AllocateSlot(SourceKind.Camera, ["S1", "S2"]);
        catalog = new SourceCatalog([laptop], []);
    }

    private string Source(string slot) => SourceRef.ForDevice(laptop.Id, slot);

    [Fact]
    public void TallyFor_ProgramAndPreview_PerSlotAndOverallMaximum()
    {
        var scenes = production.OrderedScenes;
        scenes[0].AddItem(Build.Add(Source("screen-1")), catalog);
        scenes[1].AddItem(Build.Add(Source("screen-2")), catalog);
        scenes[1].AddItem(Build.Add(Source("screen-1")), catalog);
        production.SetPreview(scenes[1].Id, Build.T0);
        production.StartBroadcast(Build.T0);

        var tally = OnAirState.From(production).TallyFor(laptop.Id, laptop.Slots.Select(s => s.Slot));

        Assert.Equal(TallyState.Program, tally.Overall);
        Assert.Equal(TallyState.Program, tally.Slots["screen-1"]);
        Assert.Equal(TallyState.Preview, tally.Slots["screen-2"]);
        Assert.Equal(TallyState.Off, tally.Slots["camera"]);
    }

    [Fact]
    public void TallyFor_HiddenItem_IsOff()
    {
        var item = production.OrderedScenes[0].AddItem(Build.Add(Source("screen-1")), catalog);
        production.OrderedScenes[0].UpdateItem(item.Id, item with { Hidden = true }, catalog);
        production.StartBroadcast(Build.T0);

        Assert.Equal(TallyState.Off, OnAirState.From(production).TallyFor(laptop.Id, ["screen-1"]).Overall);
    }

    [Theory]
    [InlineData(BroadcastState.Standby)]
    [InlineData(BroadcastState.Ended)]
    public void TallyFor_NotLive_IsAlwaysOff(BroadcastState state)
    {
        production.OrderedScenes[0].AddItem(Build.Add(Source("screen-1")), catalog);
        if (state == BroadcastState.Ended)
        {
            production.StartBroadcast(Build.T0);
            production.EndBroadcast(Build.T0);
        }

        var tally = OnAirState.From(production).TallyFor(laptop.Id, ["screen-1"]);

        Assert.Equal(TallyState.Off, tally.Overall);
        Assert.Equal(TallyState.Off, tally.Slots["screen-1"]);
    }

    [Fact]
    public void TallyFor_PreviewOnly_IsPreview()
    {
        production.OrderedScenes[2].AddItem(Build.Add(Source("camera")), catalog);
        production.SetPreview(production.OrderedScenes[2].Id, Build.T0);
        production.StartBroadcast(Build.T0);

        Assert.Equal(TallyState.Preview, OnAirState.From(production).TallyFor(laptop.Id, ["camera"]).Overall);
    }
}

public sealed class LogTextsTests
{
    private static string? Text(string action, params (string Key, string Value)[] details) =>
        LogTexts.For(AuditEntry.Create("prd_x", Build.T0, AuditActors.System, action, details.ToDictionary(d => d.Key, d => d.Value, StringComparer.Ordinal)));

    [Fact]
    public void For_SourceEvents_UseTheRegieWording()
    {
        Assert.Equal("K2 verbindet neu", Text(AuditActions.SourceReconnecting, (AuditDetails.Code, "K2")));
        Assert.Equal("K2 wieder da, war 9 s weg", Text(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "9")));
        Assert.Equal("K2 wieder da, war 1 s weg", Text(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "0")));
        Assert.Equal("K2 wieder da, war 3 min weg", Text(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "170")));
        Assert.Equal("S1 Teilen beendet", Text(AuditActions.SourceEnded, (AuditDetails.Code, "S1"), (AuditDetails.Kind, "Screen")));
        Assert.Equal("K1 Kamera beendet", Text(AuditActions.SourceEnded, (AuditDetails.Code, "K1"), (AuditDetails.Kind, "Camera")));
        Assert.Equal("K1 kein Bild", Text(AuditActions.SourceLost, (AuditDetails.Code, "K1")));
    }

    [Fact]
    public void For_ProductionEvents_HaveGermanTexts()
    {
        Assert.Equal("Szene «Pause» ist live", Text(AuditActions.SceneLive, (AuditDetails.Scene, "Pause")));
        Assert.Equal("Sendung gestartet", Text(AuditActions.BroadcastStarted));
        Assert.Equal("Sendung beendet", Text(AuditActions.BroadcastEnded));
        Assert.Equal("S3 Laptop Mia gekoppelt", Text(AuditActions.DevicePaired, (AuditDetails.Codes, "S3"), (AuditDetails.Device, "Laptop Mia")));
        Assert.Equal("Laptop Mia entfernt", Text(AuditActions.DeviceRemoved, (AuditDetails.Codes, ""), (AuditDetails.Device, "Laptop Mia")));
        Assert.Equal("K2 Handy 2 gesperrt", Text(AuditActions.DeviceBlocked, (AuditDetails.Codes, "K2"), (AuditDetails.Device, "Handy 2")));
        Assert.Equal("Anfrage von Lea abgelehnt", Text(AuditActions.PairingDenied, (AuditDetails.Name, "Lea")));
        Assert.Equal("Einladungslink erstellt", Text(AuditActions.InviteCreated, (AuditDetails.Kind, "LaptopLink")));
        Assert.Equal("Output-Link neu erzeugt", Text(AuditActions.OutputKeyRegenerated));
        Assert.Equal("M1 «Pause» hochgeladen", Text(AuditActions.AssetUploaded, (AuditDetails.Code, "M1"), (AuditDetails.Name, "Pause")));
    }

    [Fact]
    public void For_LoginsAndPhoneInvites_AreNotShown()
    {
        Assert.Null(Text(AuditActions.LoginFailed, (AuditDetails.Username, "admin")));
        Assert.Null(Text(AuditActions.InviteCreated, (AuditDetails.Kind, "PhoneQr")));
        Assert.Null(Text(AuditActions.InviteRevoked, (AuditDetails.Kind, "PhoneQr")));
        Assert.Null(Text("unknown.action"));
    }

    [Fact]
    public void Actions_ContainEveryActionWithText()
    {
        foreach (var action in typeof(AuditActions).GetFields().Select(f => (string)f.GetValue(null)!))
        {
            var hasText = Text(action, (AuditDetails.Kind, "LaptopLink")) is not null;
            Assert.Equal(hasText, LogTexts.Actions.Contains(action));
        }
    }
}
