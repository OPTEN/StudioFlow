using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

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
    private static AuditEntry Entry(string action, params (string Key, string Value)[] details) =>
        AuditEntry.Create("prd_x", Build.T0, AuditActors.System, action, details.ToDictionary(d => d.Key, d => d.Value, StringComparer.Ordinal));

    private static string? Text(string action, params (string Key, string Value)[] details) => LogTexts.For(Entry(action, details));

    private static (LogCode Code, IReadOnlyDictionary<string, string> Params, string Text) Describe(string action, params (string Key, string Value)[] details) =>
        LogTexts.Describe(Entry(action, details)) ?? throw new InvalidOperationException($"{action} has no log entry");

    [Fact]
    public void For_SourceEvents_UseTheRegieWording()
    {
        Assert.Equal("K2 reconnecting", Text(AuditActions.SourceReconnecting, (AuditDetails.Code, "K2")));
        Assert.Equal("K2 is back, was gone for 9 s", Text(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "9")));
        Assert.Equal("K2 is back, was gone for 1 s", Text(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "0")));
        Assert.Equal("K2 is back, was gone for 3 min", Text(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "170")));
        Assert.Equal("S1 sharing stopped", Text(AuditActions.SourceEnded, (AuditDetails.Code, "S1"), (AuditDetails.Kind, "Screen")));
        Assert.Equal("K1 camera stopped", Text(AuditActions.SourceEnded, (AuditDetails.Code, "K1"), (AuditDetails.Kind, "Camera")));
        Assert.Equal("K1 no picture", Text(AuditActions.SourceLost, (AuditDetails.Code, "K1")));
    }

    [Fact]
    public void For_ProductionEvents_HaveEnglishTexts()
    {
        Assert.Equal("Scene “Pause” is live", Text(AuditActions.SceneLive, (AuditDetails.Scene, "Pause")));
        Assert.Equal("Scene “Pause” created", Text(AuditActions.SceneCreated, (AuditDetails.Scene, "Pause")));
        Assert.Equal("Scene “Pause” deleted", Text(AuditActions.SceneDeleted, (AuditDetails.Scene, "Pause")));
        Assert.Equal("Broadcast started", Text(AuditActions.BroadcastStarted));
        Assert.Equal("Broadcast ended", Text(AuditActions.BroadcastEnded));
        Assert.Equal("S3 Laptop Mia paired", Text(AuditActions.DevicePaired, (AuditDetails.Codes, "S3"), (AuditDetails.Device, "Laptop Mia")));
        Assert.Equal("Laptop Mia removed", Text(AuditActions.DeviceRemoved, (AuditDetails.Codes, ""), (AuditDetails.Device, "Laptop Mia")));
        Assert.Equal("K2 Phone 2 blocked", Text(AuditActions.DeviceBlocked, (AuditDetails.Codes, "K2"), (AuditDetails.Device, "Phone 2")));
        Assert.Equal("K2 Phone 2 unblocked", Text(AuditActions.DeviceUnblocked, (AuditDetails.Codes, "K2"), (AuditDetails.Device, "Phone 2")));
        Assert.Equal("Request from Lea denied", Text(AuditActions.PairingDenied, (AuditDetails.Name, "Lea")));
        Assert.Equal("Invite link created", Text(AuditActions.InviteCreated, (AuditDetails.Kind, "LaptopLink")));
        Assert.Equal("Invite link revoked", Text(AuditActions.InviteRevoked, (AuditDetails.Kind, "LaptopLink")));
        Assert.Equal("Output link regenerated", Text(AuditActions.OutputKeyRegenerated));
        Assert.Equal("Output access changed", Text(AuditActions.OutputAccessChanged));
        Assert.Equal("M1 “Pause” uploaded", Text(AuditActions.AssetUploaded, (AuditDetails.Code, "M1"), (AuditDetails.Name, "Pause")));
        Assert.Equal("M1 “Pause” deleted", Text(AuditActions.AssetDeleted, (AuditDetails.Code, "M1"), (AuditDetails.Name, "Pause")));
    }

    [Fact]
    public void Describe_GivesTheCodeAndTheParametersForTheClientText()
    {
        var live = Describe(AuditActions.SceneLive, (AuditDetails.Scene, "Pause"));
        Assert.Equal(LogCode.SceneLive, live.Code);
        Assert.Equal(new Dictionary<string, string> { ["scene"] = "Pause" }, live.Params);

        var paired = Describe(AuditActions.DevicePaired, (AuditDetails.Codes, "S1, S2"), (AuditDetails.Device, "Laptop Mia"));
        Assert.Equal(LogCode.DevicePaired, paired.Code);
        Assert.Equal(new Dictionary<string, string> { ["subject"] = "S1, S2 Laptop Mia" }, paired.Params);

        var nameOnly = Describe(AuditActions.DeviceRemoved, (AuditDetails.Codes, ""), (AuditDetails.Device, "Laptop Mia"));
        Assert.Equal(new Dictionary<string, string> { ["subject"] = "Laptop Mia" }, nameOnly.Params);

        Assert.Equal(new Dictionary<string, string> { ["name"] = "Lea" }, Describe(AuditActions.PairingDenied, (AuditDetails.Name, "Lea")).Params);
        Assert.Equal(
            new Dictionary<string, string> { ["code"] = "M1", ["name"] = "Pause" },
            Describe(AuditActions.AssetUploaded, (AuditDetails.Code, "M1"), (AuditDetails.Name, "Pause")).Params);
        Assert.Empty(Describe(AuditActions.BroadcastStarted).Params);
    }

    [Fact]
    public void Describe_SplitsEndedSourcesByKindAndReportsTheDowntimeInSeconds()
    {
        Assert.Equal(LogCode.CameraEnded, Describe(AuditActions.SourceEnded, (AuditDetails.Code, "K1"), (AuditDetails.Kind, "Camera")).Code);
        Assert.Equal(LogCode.ScreenEnded, Describe(AuditActions.SourceEnded, (AuditDetails.Code, "S1"), (AuditDetails.Kind, "Screen")).Code);
        Assert.Equal(LogCode.ScreenEnded, Describe(AuditActions.SourceEnded, (AuditDetails.Code, "S1")).Code);

        var recovered = Describe(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "170"));
        Assert.Equal(LogCode.SourceRecovered, recovered.Code);
        Assert.Equal(new Dictionary<string, string> { ["code"] = "K2", ["downSeconds"] = "170" }, recovered.Params);
        Assert.Equal("1", Describe(AuditActions.SourceRecovered, (AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "0")).Params["downSeconds"]);
        Assert.Equal("1", Describe(AuditActions.SourceRecovered, (AuditDetails.Code, "K2")).Params["downSeconds"]);
    }

    [Fact]
    public void Describe_EveryActionOfActions_HasACodeAnEnglishTextAndItsParameters()
    {
        // One row per entry the Regie shows. A new action in LogTexts.Actions fails the last assertion until it is listed.
        var scene = (AuditDetails.Scene, "Break");
        var device = new[] { (AuditDetails.Codes, "S1, S2"), (AuditDetails.Device, "Laptop Mia") };
        var asset = new[] { (AuditDetails.Code, "M1"), (AuditDetails.Name, "Intro") };
        var linkInvite = (AuditDetails.Kind, "LaptopLink");
        var subject = new Dictionary<string, string> { ["subject"] = "S1, S2 Laptop Mia" };
        var rows = new (string Action, (string Key, string Value)[] Details, LogCode Code, string Text, Dictionary<string, string> Params)[]
        {
            (AuditActions.SceneLive, [scene], LogCode.SceneLive, "Scene “Break” is live", new() { ["scene"] = "Break" }),
            (AuditActions.SceneCreated, [scene], LogCode.SceneCreated, "Scene “Break” created", new() { ["scene"] = "Break" }),
            (AuditActions.SceneDeleted, [scene], LogCode.SceneDeleted, "Scene “Break” deleted", new() { ["scene"] = "Break" }),
            (AuditActions.BroadcastStarted, [], LogCode.BroadcastStarted, "Broadcast started", new()),
            (AuditActions.BroadcastEnded, [], LogCode.BroadcastEnded, "Broadcast ended", new()),
            (AuditActions.DevicePaired, device, LogCode.DevicePaired, "S1, S2 Laptop Mia paired", subject),
            (AuditActions.DeviceBlocked, device, LogCode.DeviceBlocked, "S1, S2 Laptop Mia blocked", subject),
            (AuditActions.DeviceUnblocked, device, LogCode.DeviceUnblocked, "S1, S2 Laptop Mia unblocked", subject),
            (AuditActions.DeviceRemoved, device, LogCode.DeviceRemoved, "S1, S2 Laptop Mia removed", subject),
            (AuditActions.PairingDenied, [(AuditDetails.Name, "Lea")], LogCode.PairingDenied, "Request from Lea denied", new() { ["name"] = "Lea" }),
            (AuditActions.InviteCreated, [linkInvite], LogCode.InviteLinkCreated, "Invite link created", new()),
            (AuditActions.InviteRevoked, [linkInvite], LogCode.InviteLinkRevoked, "Invite link revoked", new()),
            (AuditActions.OutputKeyRegenerated, [], LogCode.OutputLinkRegenerated, "Output link regenerated", new()),
            (AuditActions.OutputAccessChanged, [], LogCode.OutputAccessChanged, "Output access changed", new()),
            (AuditActions.AssetUploaded, asset, LogCode.AssetUploaded, "M1 “Intro” uploaded", new() { ["code"] = "M1", ["name"] = "Intro" }),
            (AuditActions.AssetDeleted, asset, LogCode.AssetDeleted, "M1 “Intro” deleted", new() { ["code"] = "M1", ["name"] = "Intro" }),
            (AuditActions.SourceReconnecting, [(AuditDetails.Code, "K2")], LogCode.SourceReconnecting, "K2 reconnecting", new() { ["code"] = "K2" }),
            (AuditActions.SourceEnded, [(AuditDetails.Code, "K1"), (AuditDetails.Kind, "Camera")], LogCode.CameraEnded, "K1 camera stopped", new() { ["code"] = "K1" }),
            (AuditActions.SourceEnded, [(AuditDetails.Code, "S1"), (AuditDetails.Kind, "Screen")], LogCode.ScreenEnded, "S1 sharing stopped", new() { ["code"] = "S1" }),
            (AuditActions.SourceLost, [(AuditDetails.Code, "K1")], LogCode.SourceLost, "K1 no picture", new() { ["code"] = "K1" }),
            (AuditActions.SourceRecovered, [(AuditDetails.Code, "K2"), (AuditDetails.DownSeconds, "9")], LogCode.SourceRecovered, "K2 is back, was gone for 9 s", new() { ["code"] = "K2", ["downSeconds"] = "9" }),
            (AuditActions.AccountSetUp, [(AuditDetails.Username, "regie")], LogCode.AccountSetUp, "Account set up", new()),
            (AuditActions.PasswordChanged, [(AuditDetails.Username, "regie")], LogCode.PasswordChanged, "Password changed", new()),
            (AuditActions.AccountReset, [], LogCode.AccountReset, "Account reset", new()),
        };

        foreach (var (action, details, code, text, parameters) in rows)
        {
            var described = Describe(action, details);
            Assert.Equal(code, described.Code);
            Assert.Equal(text, described.Text);
            Assert.Equal(parameters, described.Params);
            Assert.Equal(text, Text(action, details));
        }

        Assert.Equal(LogTexts.Actions.Order(StringComparer.Ordinal), rows.Select(r => r.Action).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void For_LoginsAndPhoneInvites_AreNotShown()
    {
        Assert.Null(Text(AuditActions.LoginFailed, (AuditDetails.Username, "admin")));
        Assert.Null(Text(AuditActions.InviteCreated, (AuditDetails.Kind, "PhoneQr")));
        Assert.Null(Text(AuditActions.InviteRevoked, (AuditDetails.Kind, "PhoneQr")));
        Assert.Null(Text("unknown.action"));
        Assert.Null(LogTexts.Describe(Entry(AuditActions.LoginSucceeded)));
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

    [Fact]
    public void EveryLogCode_IsProducedByAnAction()
    {
        var produced = new HashSet<LogCode>();
        foreach (var action in LogTexts.Actions)
        {
            foreach (var kind in new[] { "LaptopLink", "Camera", "Screen" })
            {
                if (LogTexts.Describe(Entry(action, (AuditDetails.Kind, kind))) is { } described)
                {
                    produced.Add(described.Code);
                }
            }
        }

        Assert.Equal(Enum.GetValues<LogCode>().OrderBy(c => c), produced.OrderBy(c => c));
    }
}
