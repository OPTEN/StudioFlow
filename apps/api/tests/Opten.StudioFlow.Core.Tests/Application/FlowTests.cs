using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class ProductionCoordinatorTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    [Fact]
    public async Task ExecuteAsync_Events_GetConsecutiveRevisionsFromTheProcessBase()
    {
        await harness.Coordinator.ExecuteAsync(harness.Production.Id, context =>
        {
            context.Emit(r => new RevisionOnlyEvent(r));
            context.Emit(r => new RevisionOnlyEvent(r));
            return Task.CompletedTask;
        }, CancellationToken.None);

        Assert.Equal([harness.Runtimes.RevisionBase + 1, harness.Runtimes.RevisionBase + 2], harness.Events.Select(e => e.Revision));
        Assert.Equal(harness.Runtimes.RevisionBase + 2, harness.Runtime.Revision);
        Assert.Equal(harness.Clock.Now.ToUnixTimeMilliseconds() * 1000, harness.Runtimes.RevisionBase);
    }

    [Fact]
    public async Task ExecuteAsync_MutationThrows_PublishesNothingAndKeepsRevision()
    {
        var before = harness.Runtime.Revision;

        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Coordinator.ExecuteAsync(harness.Production.Id, context =>
        {
            context.Emit(r => new RevisionOnlyEvent(r));
            throw StudioFlowException.NotFound("X");
        }, CancellationToken.None));

        Assert.Empty(harness.Events);
        Assert.Equal(before, harness.Runtime.Revision);
    }

    [Fact]
    public async Task ExecuteAsync_CommitFails_PublishesNothingAndSkipsCommittedActions()
    {
        harness.Data.FailNextCommit = true;
        var applied = false;

        await Assert.ThrowsAsync<InvalidOperationException>(() => harness.Coordinator.ExecuteAsync(harness.Production.Id, context =>
        {
            context.Emit(r => new RevisionOnlyEvent(r));
            context.OnCommitted(() => applied = true);
            return Task.CompletedTask;
        }, CancellationToken.None));

        Assert.Empty(harness.Events);
        Assert.False(applied);
    }

    [Fact]
    public async Task ExecuteAsync_UnknownProduction_IsNotFound() =>
        Assert.Equal(ErrorKind.NotFound, (await Assert.ThrowsAsync<StudioFlowException>(() => harness.Coordinator.ExecuteAsync("prd_unknown", _ => Task.CompletedTask, CancellationToken.None))).Kind);

    [Fact]
    public async Task ExecuteAsync_ParallelMutations_AreSerializedAndOrdered()
    {
        harness.Publisher.DelayMs = 1;
        var inside = 0;
        var maxInside = 0;

        await Task.WhenAll(Enumerable.Range(0, 50).Select(_ => Task.Run(() => harness.Coordinator.ExecuteAsync(harness.Production.Id, async context =>
        {
            var now = Interlocked.Increment(ref inside);
            maxInside = Math.Max(maxInside, now);
            await Task.Yield();
            context.Emit(r => new RevisionOnlyEvent(r));
            Interlocked.Decrement(ref inside);
        }, CancellationToken.None))));

        Assert.Equal(1, maxInside);
        var revisions = harness.Events.Select(e => e.Revision).ToList();
        Assert.Equal(50, revisions.Count);
        Assert.Equal(revisions.Order(), revisions);
        Assert.Equal(revisions.Count, revisions.Distinct().Count());
    }

    [Fact]
    public async Task ExecuteAsync_CancelledWhileWaiting_DoesNotRun()
    {
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => harness.Coordinator.ExecuteAsync(harness.Production.Id, _ => Task.CompletedTask, cancelled.Token));
    }

    public void Dispose() => harness.Dispose();
}

public sealed class SwitchingFlowTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    private IReadOnlyList<Scene> Scenes => harness.Production.OrderedScenes;

    [Fact]
    public async Task SwitchProgram_Emits_ProgramSwitchedAndLiveLog()
    {
        await harness.Productions.SwitchProgramAsync(harness.Production.Id, new SwitchProgramRequest(Scenes[2].Id, Build.Fade(500)), CancellationToken.None);

        var switched = Assert.Single(harness.Events.OfType<ProgramSwitchedEvent>());
        Assert.Equal(Scenes[2].Id, switched.ProgramSceneId);
        Assert.Equal(Scenes[0].Id, switched.PreviousProgramSceneId);
        Assert.Equal("Scene “Pause” is live", Assert.Single(harness.Events.OfType<LogAppendedEvent>()).Entry.Text);
    }

    [Fact]
    public async Task SwitchProgram_SameScene_EmitsNothing()
    {
        await harness.Productions.SwitchProgramAsync(harness.Production.Id, new SwitchProgramRequest(Scenes[0].Id, Transitions.Cut), CancellationToken.None);

        Assert.Empty(harness.Events);
    }

    [Fact]
    public async Task SetPreview_Emits_CutWithoutLog()
    {
        await harness.Productions.SetPreviewAsync(harness.Production.Id, new SetPreviewRequest(Scenes[1].Id), CancellationToken.None);

        var switched = Assert.Single(harness.Events.OfType<ProgramSwitchedEvent>());
        Assert.Equal(Transitions.Cut, switched.Transition);
        Assert.Empty(harness.Events.OfType<LogAppendedEvent>());
    }

    [Fact]
    public async Task Broadcast_StartEndReset_EmitsProductionChangedAndLogs()
    {
        await harness.Productions.StartBroadcastAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.StartBroadcastAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.EndBroadcastAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.ResetBroadcastAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal([BroadcastState.Live, BroadcastState.Ended, BroadcastState.Standby], harness.Events.OfType<ProductionChangedEvent>().Select(e => e.Production.Broadcast));
        Assert.Equal(["Broadcast started", "Broadcast ended"], harness.Events.OfType<LogAppendedEvent>().Select(e => e.Entry.Text));
    }

    [Fact]
    public async Task Changes_SinceBufferedRevision_ReturnsDeltaElseSnapshot()
    {
        var snapshot = await harness.Productions.GetSnapshotAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.SetPreviewAsync(harness.Production.Id, new SetPreviewRequest(Scenes[1].Id), CancellationToken.None);

        var delta = await harness.Productions.GetChangesAsync(harness.Production.Id, snapshot.Revision, CancellationToken.None);
        var full = await harness.Productions.GetChangesAsync(harness.Production.Id, snapshot.Revision - 5, CancellationToken.None);

        Assert.Null(delta.Snapshot);
        Assert.Equal(snapshot.Revision + 1, Assert.Single(delta.Events!).Revision);
        Assert.Null(full.Events);
        Assert.Equal(delta.Revision, full.Snapshot!.Revision);
        Assert.Equal(Scenes[1].Id, full.Snapshot.Production.PreviewSceneId);
    }

    [Fact]
    public async Task AcknowledgeIncident_Unknown_IsNotFound() =>
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Productions.AcknowledgeIncidentAsync(harness.Production.Id, "inc_none", CancellationToken.None));

    public void Dispose() => harness.Dispose();
}

public sealed class DeviceFlowTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    [Fact]
    public async Task Redeem_PhoneInvite_CreatesDeviceAndNextInvite()
    {
        var (device, _) = await harness.PairPhoneAsync();

        Assert.Equal("K1", device.Slots[0].Code);
        Assert.Contains(harness.Events, e => e is DeviceUpsertedEvent d && d.Device.Id == device.Id);
        Assert.Equal(SourceStatus.Offline, harness.Source($"{device.Id}/camera").Status);
        Assert.Equal(2, harness.Events.OfType<InviteUpsertedEvent>().Count());
        Assert.Single(harness.Events.OfType<InviteRemovedEvent>());
        Assert.Contains(harness.Events.OfType<LogAppendedEvent>(), l => l.Entry.Text == "K1 Handy 1 paired");
    }

    [Fact]
    public async Task Hello_ThenLiveReport_TurnsSourceOkWithoutIncident()
    {
        var (device, identity) = await harness.PairPhoneAsync();

        var session = await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "iPhone 15", "1.0"), CancellationToken.None);
        Assert.Equal(SourceStatus.Connecting, harness.Source($"{device.Id}/camera").Status);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);

        Assert.Equal(TallyState.Off, session.Tally.Overall);
        Assert.Equal(SourceStatus.Ok, harness.Source($"{device.Id}/camera").Status);
        Assert.Empty(harness.Events.OfType<IncidentUpsertedEvent>());
        Assert.Single(harness.Publisher.Telemetry);
        Assert.Equal(DeviceConnection.Online, harness.Events.OfType<DeviceUpsertedEvent>().Last().Device.Connection);
        Assert.Equal("iPhone 15", device.Platform);
    }

    [Fact]
    public async Task Disconnect_LiveSource_OpensIncidentAndRecoveryClosesIt()
    {
        var (device, identity) = await LiveDeviceAsync("c1");

        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromSeconds(9));
        await harness.Devices.HelloAsync(identity, "c2", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);
        Assert.Equal(SourceStatus.Reconnecting, harness.Source($"{device.Id}/camera").Status);
        await harness.Devices.ReportAsync(identity, "c2", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);

        var incidents = harness.Events.OfType<IncidentUpsertedEvent>().Select(e => e.Incident).ToList();
        Assert.Equal(2, incidents.Count);
        Assert.Equal(IncidentKind.Reconnecting, incidents[0].Kind);
        Assert.Null(incidents[0].EndedAt);
        Assert.Equal(incidents[0].Id, incidents[1].Id);
        Assert.NotNull(incidents[1].EndedAt);
        var logs = harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text).ToList();
        Assert.Contains("K1 reconnecting", logs);
        Assert.Contains("K1 is back, was gone for 9 s", logs);
        Assert.Contains(harness.Events.OfType<DeviceUpsertedEvent>(), e => e.Device.Connection == DeviceConnection.Reconnecting);

        await harness.Productions.AcknowledgeIncidentAsync(harness.Production.Id, incidents[0].Id, CancellationToken.None);
        Assert.Equal(incidents[0].Id, harness.Events.OfType<IncidentRemovedEvent>().Last().IncidentId);
    }

    [Fact]
    public async Task Hello_FromOtherTab_ReplacesOldSessionWithoutPingPong()
    {
        var (device, identity) = await LiveDeviceAsync("c1");
        await harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.TrackPublished, harness.Production.Id, "RM_1", "PA_1", device.Id, "camera"), CancellationToken.None);

        await harness.Devices.HelloAsync(identity, "c2", new DeviceHelloDto("tab-2", "iPhone", "1.0"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Failed), CancellationToken.None);
        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);

        Assert.Equal(["c1"], harness.Publisher.Replaced);
        Assert.Equal(["c1"], harness.Publisher.AbortedAfterDelivery);
        Assert.Equal("c2", harness.Runtime.FindDevice(identity.DeviceId)!.ConnectionId);
        Assert.Equal(SourceStatus.Ok, harness.Source($"{device.Id}/camera").Status);
        Assert.Empty(harness.Events.OfType<IncidentUpsertedEvent>());
    }

    [Fact]
    public async Task Hello_AfterReload_OldDeadConnectionIsReplacedWithoutEffectOnTheNewSession()
    {
        var (device, identity) = await LiveDeviceAsync("c1");
        var camera = $"{device.Id}/camera";

        // The page reloads: the server has not noticed yet that c1 is gone, and the new page has a new session id.
        await harness.Devices.HelloAsync(identity, "c2", new DeviceHelloDto("tab-2", "iPhone", "1.0"), CancellationToken.None);
        var afterHello = harness.Source(camera).Status;
        await harness.Devices.ReportAsync(identity, "c2", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        var events = harness.Events.Count;
        var tallies = harness.Publisher.Tallies.Count;
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Failed), CancellationToken.None);
        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);

        Assert.Equal(SourceStatus.Reconnecting, afterHello);
        Assert.Equal(["c1"], harness.Publisher.Replaced);
        Assert.Equal(["c1"], harness.Publisher.AbortedAfterDelivery);
        Assert.Empty(harness.Publisher.Aborted);
        Assert.Equal((events, tallies), (harness.Events.Count, harness.Publisher.Tallies.Count));
        Assert.Equal(SourceStatus.Ok, harness.Source(camera).Status);
        var live = harness.Runtime.FindDevice(device.Id)!;
        Assert.Equal(("c2", "tab-2", DeviceConnection.Online), (live.ConnectionId, live.SessionId, live.PublishedConnection));
    }

    [Fact]
    public async Task Report_SlotMissingFromReport_IsNoLongerOk()
    {
        var (device, identity) = await harness.PairLaptopAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Windows", "1.0"), CancellationToken.None);
        await harness.Devices.AllocateSlotAsync(identity, new AllocateSlotRequest(SourceKind.Camera), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", Report(("screen-1", SlotState.Live), ("camera", SlotState.Live)), CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source($"{device.Id}/camera").Status);

        await harness.Devices.ReportAsync(identity, "c1", Report(("screen-1", SlotState.Live)), CancellationToken.None);

        Assert.Equal(SourceStatus.Reconnecting, harness.Source($"{device.Id}/camera").Status);
        Assert.Equal(SourceStatus.Ok, harness.Source($"{device.Id}/screen-1").Status);
        Assert.Equal($"{device.Id}/camera", harness.Events.OfType<IncidentUpsertedEvent>().Single().Incident.SourceId);
        Assert.Contains("K1 reconnecting", harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text));
    }

    [Fact]
    public async Task Report_CameraPausedByTheSystem_IsReconnectingAndAStopIsKameraBeendet()
    {
        var (device, identity) = await LiveDeviceAsync("c1");
        var camera = $"{device.Id}/camera";

        harness.Clock.Advance(TimeSpan.FromSeconds(1));
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Paused), CancellationToken.None);
        var paused = harness.Source(camera).Status;
        var connection = harness.Runtime.FindDevice(device.Id)!.PublishedConnection;
        harness.Clock.Advance(TimeSpan.FromSeconds(5));
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        var back = harness.Source(camera).Status;
        harness.Clock.Advance(TimeSpan.FromSeconds(1));
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Paused), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Ended), CancellationToken.None);

        Assert.Equal((SourceStatus.Reconnecting, SourceStatus.Ok, SourceStatus.Ended), (paused, back, harness.Source(camera).Status));
        Assert.Equal(DeviceConnection.Online, connection);
        var incidents = harness.Events.OfType<IncidentUpsertedEvent>().Select(e => e.Incident).ToList();
        Assert.Equal([IncidentKind.Reconnecting, IncidentKind.Reconnecting, IncidentKind.Reconnecting, IncidentKind.Ended], incidents.Select(i => i.Kind));
        Assert.NotNull(incidents[1].EndedAt);
        Assert.Equal(incidents[2].Id, incidents[3].Id);
        var logs = harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text).Where(t => !t.EndsWith(" paired", StringComparison.Ordinal));
        Assert.Equal(["K1 reconnecting", "K1 is back, was gone for 5 s", "K1 reconnecting", "K1 camera stopped"], logs);
    }

    [Fact]
    public async Task Report_StoppedOnPurpose_LogsTeilenBeendetForScreensAndKameraBeendetForCameras()
    {
        var (device, identity) = await harness.PairLaptopAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Windows", "1.0"), CancellationToken.None);
        await harness.Devices.AllocateSlotAsync(identity, new AllocateSlotRequest(SourceKind.Camera), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", Report(("screen-1", SlotState.Live), ("camera", SlotState.Live)), CancellationToken.None);

        await harness.Devices.ReportAsync(identity, "c1", Report(("screen-1", SlotState.Ended), ("camera", SlotState.Ended)), CancellationToken.None);

        Assert.Equal(SourceStatus.Ended, harness.Source($"{device.Id}/screen-1").Status);
        Assert.Equal(SourceStatus.Ended, harness.Source($"{device.Id}/camera").Status);
        Assert.All(harness.Events.OfType<IncidentUpsertedEvent>(), e => Assert.Equal(IncidentKind.Ended, e.Incident.Kind));
        var logs = harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text).ToList();
        Assert.Contains("S1 sharing stopped", logs);
        Assert.Contains("K1 camera stopped", logs);
    }

    [Fact]
    public async Task Report_FailedCamera_OpensLostIncident()
    {
        var (device, identity) = await LiveDeviceAsync("c1");

        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Failed), CancellationToken.None);

        Assert.Equal(SourceStatus.Lost, harness.Source($"{device.Id}/camera").Status);
        Assert.Equal(IncidentKind.Lost, harness.Events.OfType<IncidentUpsertedEvent>().Single().Incident.Kind);
        Assert.Contains("K1 no picture", harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text));
    }

    [Fact]
    public async Task Block_LiveDevice_SendsSelfAbortsKicksAndClearsIncidents()
    {
        var (device, identity) = await LiveDeviceAsync("c1");
        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);
        await harness.Devices.HelloAsync(identity, "c2", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);

        var dto = await harness.DeviceAdmin.BlockAsync(harness.Production.Id, device.Id, CancellationToken.None);

        Assert.Equal(DeviceState.Blocked, dto.State);
        Assert.Equal(DeviceState.Blocked, harness.Publisher.Selves.Last().Self.State);
        Assert.Contains("c2", harness.Publisher.AbortedAfterDelivery);
        Assert.Contains(device.Id, harness.Rooms.Removed);
        Assert.Equal(SourceStatus.Blocked, harness.Source($"{device.Id}/camera").Status);
        Assert.Single(harness.Events.OfType<IncidentRemovedEvent>());
        Assert.Contains("K1 Handy 1 blocked", harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Devices.IssueTokenAsync(identity, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Devices.HelloAsync(identity, "c3", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None));
    }

    [Fact]
    public async Task Block_LiveKitDown_StillBlocks()
    {
        var (device, _) = await harness.PairPhoneAsync();
        harness.Rooms.Unavailable = true;

        Assert.Equal(DeviceState.Blocked, (await harness.DeviceAdmin.BlockAsync(harness.Production.Id, device.Id, CancellationToken.None)).State);
    }

    [Fact]
    public async Task Tally_ProgramChange_IsPushedToConnectedDeviceOnlyWhenChanged()
    {
        var (device, identity) = await LiveDeviceAsync("c1");
        var scenes = harness.Production.OrderedScenes;
        await harness.Scenes.AddItemAsync(harness.Production.Id, scenes[1].Id, Build.Add($"{device.Id}/camera"), CancellationToken.None);
        await harness.Productions.StartBroadcastAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.SetPreviewAsync(harness.Production.Id, new SetPreviewRequest(scenes[1].Id), CancellationToken.None);
        Assert.Equal(TallyState.Preview, harness.Publisher.Tallies.Last().Tally.Overall);

        await harness.Productions.TakeAsync(harness.Production.Id, new TakeRequest(Transitions.Cut), CancellationToken.None);
        Assert.Equal(TallyState.Program, harness.Publisher.Tallies.Last().Tally.Overall);
        var pushed = harness.Publisher.Tallies.Count;
        await harness.Productions.UpdateAsync(harness.Production.Id, new UpdateProductionRequest("Anders", null, null), CancellationToken.None);
        await harness.Productions.EndBroadcastAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal(pushed + 1, harness.Publisher.Tallies.Count);
        Assert.Equal(TallyState.Off, harness.Publisher.Tallies.Last().Tally.Overall);
        Assert.All(harness.Publisher.Tallies, t => Assert.Equal("c1", t.ConnectionId));
        Assert.Equal(TallyState.Off, (await harness.Devices.GetSessionAsync(identity, CancellationToken.None)).Tally.Overall);
    }

    [Fact]
    public async Task AllocateSlot_NewScreen_EmitsSourceAndSelfAndAppearsInTally()
    {
        var (_, identity) = await harness.PairLaptopAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Windows", "1.0"), CancellationToken.None);

        var slot = await harness.Devices.AllocateSlotAsync(identity, new AllocateSlotRequest(SourceKind.Screen), CancellationToken.None);
        await harness.Devices.ReleaseSlotAsync(identity, slot.Slot, CancellationToken.None);
        var unknown = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Devices.ReleaseSlotAsync(identity, "screen-7", CancellationToken.None));

        Assert.Equal(new DeviceSlotDto("screen-2", "S2", SourceKind.Screen), slot);
        Assert.Equal(SourceStatus.Connecting, harness.Source($"{identity.DeviceId}/screen-2").Status);
        Assert.Contains(harness.Events, e => e is SourceRemovedEvent r && r.SourceId == $"{identity.DeviceId}/screen-2");
        Assert.Equal(2, harness.Publisher.Selves.Count);
        Assert.Equal(ErrorKind.NotFound, unknown.Kind);
    }

    [Fact]
    public async Task Slots_PhoneScreenOrPhoneCameraRelease_AreRejected()
    {
        var (_, identity) = await harness.PairPhoneAsync();

        var screen = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Devices.AllocateSlotAsync(identity, new AllocateSlotRequest(SourceKind.Screen), CancellationToken.None));
        var camera = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Devices.AllocateSlotAsync(identity, new AllocateSlotRequest(SourceKind.Camera), CancellationToken.None));
        var release = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Devices.ReleaseSlotAsync(identity, "camera", CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationFailed, screen.Code);
        Assert.Equal(ErrorCodes.LimitReached, camera.Code);
        Assert.Equal((ErrorKind.Conflict, ErrorCodes.Conflict), (release.Kind, release.Code));
    }

    [Fact]
    public async Task Webhook_TrackPublishedForConnectedDevice_TurnsSourceOk()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);

        await harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.TrackPublished, harness.Production.Id, "RM_1", "PA_1", device.Id, "camera"), CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source($"{device.Id}/camera").Status);

        await harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.ParticipantLeft, harness.Production.Id, "RM_1", "PA_1", device.Id, null), CancellationToken.None);
        Assert.Equal(SourceStatus.Reconnecting, harness.Source($"{device.Id}/camera").Status);
    }

    [Fact]
    public async Task Webhook_BlockedOrUnknownDeviceJoins_IsKickedAgain()
    {
        var (device, _) = await harness.PairPhoneAsync();
        await harness.DeviceAdmin.BlockAsync(harness.Production.Id, device.Id, CancellationToken.None);
        while (harness.Rooms.Removed.TryDequeue(out _))
        {
        }

        await harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.ParticipantJoined, harness.Production.Id, "RM_1", "PA_2", device.Id, null), CancellationToken.None);
        await harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.ParticipantJoined, harness.Production.Id, "RM_1", "PA_3", "dev_deleted0000", null), CancellationToken.None);
        await harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.ParticipantJoined, harness.Production.Id, "RM_1", "PA_4", "studio_abc", null), CancellationToken.None);
        await harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.TrackPublished, "prd_unknown000", "RM_1", "PA_5", device.Id, "camera"), CancellationToken.None);

        Assert.Equal([device.Id, "dev_deleted0000"], harness.Rooms.Removed);
    }

    [Fact]
    public async Task Reconcile_ListedTracks_ReplaceStateAndLiveKitDownIsTolerated()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_1", device.Id, ["camera"]));

        await harness.LiveKit.ReconcileAsync(CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source($"{device.Id}/camera").Status);

        harness.Rooms.Unavailable = true;
        await harness.LiveKit.ReconcileAsync(CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source($"{device.Id}/camera").Status);
    }

    [Fact]
    public async Task Unpair_Device_RemovesDeviceSourcesAndKicks()
    {
        var (device, identity) = await LiveDeviceAsync("c1");

        await harness.Devices.UnpairAsync(identity, CancellationToken.None);

        Assert.Empty(harness.Data.Devices);
        Assert.Contains(harness.Events, e => e is DeviceRemovedEvent r && r.DeviceId == device.Id);
        Assert.Contains(harness.Events, e => e is SourceRemovedEvent r && r.SourceId == $"{device.Id}/camera");
        Assert.Contains(device.Id, harness.Rooms.Removed);
        Assert.Null(harness.Runtime.FindDevice(device.Id));
        Assert.Contains("c1", harness.Publisher.AbortedAfterDelivery);
    }

    [Fact]
    public async Task Command_Reshare_ValidatesSlotAndDeliversToConnection()
    {
        var (device, _) = await LiveDeviceAsync("c1");

        await Assert.ThrowsAsync<StudioFlowException>(() => harness.DeviceAdmin.SendCommandAsync(harness.Production.Id, device.Id, new DeviceCommandRequest(DeviceCommandKind.Reshare, "camera", null), CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.DeviceAdmin.SendCommandAsync(harness.Production.Id, device.Id, new DeviceCommandRequest(DeviceCommandKind.Message, null, new string('x', 141)), CancellationToken.None));
        var command = await harness.DeviceAdmin.SendCommandAsync(harness.Production.Id, device.Id, new DeviceCommandRequest(DeviceCommandKind.Message, null, " In 10 s live "), CancellationToken.None);

        Assert.Equal("In 10 s live", command.Text);
        Assert.True(EntityIds.IsValid(command.Id, EntityIds.Command));
    }

    private static DeviceReportDto Report(params (string Slot, SlotState State)[] slots) =>
        new(RtcState.Connected, [.. slots.Select(s => new SlotTelemetryDto(s.Slot, s.State, 1280, 720, 30, 2500, 0, "h264"))], 80, false, "wifi", 20, null);

    private async Task<(Device Device, Core.Application.Services.DeviceIdentity Identity)> LiveDeviceAsync(string connectionId)
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, connectionId, new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, connectionId, ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        return (device, identity);
    }

    public void Dispose() => harness.Dispose();
}

public sealed class PairingFlowTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    private static string Token(InviteDto invite) => invite.Url[(invite.Url.LastIndexOf('/') + 1)..];

    [Fact]
    public async Task GetPhoneInvite_Twice_ReturnsSameUntilRenewed()
    {
        var first = await harness.Pairing.GetPhoneInviteAsync(harness.Production.Id, CancellationToken.None);
        var again = await harness.Pairing.GetPhoneInviteAsync(harness.Production.Id, CancellationToken.None);
        var renewed = await harness.Pairing.RenewPhoneInviteAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal(first.Id, again.Id);
        Assert.NotEqual(first.Id, renewed.Id);
        Assert.StartsWith("https://sf.example/join/i/", first.Url, StringComparison.Ordinal);
        Assert.Contains(harness.Events, e => e is InviteRemovedEvent r && r.InviteId == first.Id);
    }

    [Fact]
    public async Task Redeem_SameClientWithinFiveMinutes_ReturnsSameDeviceWithRotatedSecret()
    {
        var invite = await harness.Pairing.CreateInviteAsync(harness.Production.Id, new CreateInviteRequest(InviteKind.LaptopLink), CancellationToken.None);
        var request = new RedeemInviteRequest("client-1", null, DeviceKind.Laptop, "Mac");

        var first = await harness.Pairing.RedeemAsync(Token(invite), request, CancellationToken.None);
        var second = await harness.Pairing.RedeemAsync(Token(invite), request, CancellationToken.None);

        Assert.Equal(first.DeviceId, second.DeviceId);
        Assert.NotEqual(first.DeviceSecret, second.DeviceSecret);
        Assert.Null(await harness.Devices.AuthenticateAsync($"{first.DeviceId}.{first.DeviceSecret}", CancellationToken.None));
        Assert.NotNull(await harness.Devices.AuthenticateAsync($"{second.DeviceId}.{second.DeviceSecret}", CancellationToken.None));
        Assert.Equal("Laptop 1", harness.Data.Devices.Single().Name);
        Assert.Equal(PairingMethod.Link, harness.Data.Devices.Single().PairingMethod);
    }

    [Fact]
    public async Task Redeem_OtherClientOrLater_IsPairingExpired()
    {
        var invite = await harness.Pairing.CreateInviteAsync(harness.Production.Id, new CreateInviteRequest(InviteKind.LaptopLink), CancellationToken.None);
        await harness.Pairing.RedeemAsync(Token(invite), new RedeemInviteRequest("client-1", "Lea", DeviceKind.Laptop, "Mac"), CancellationToken.None);

        var other = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.RedeemAsync(Token(invite), new RedeemInviteRequest("client-2", "Lea", DeviceKind.Laptop, "Mac"), CancellationToken.None));
        harness.Clock.Advance(TimeSpan.FromMinutes(6));
        var late = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.RedeemAsync(Token(invite), new RedeemInviteRequest("client-1", "Lea", DeviceKind.Laptop, "Mac"), CancellationToken.None));

        Assert.Equal(ErrorCodes.PairingExpired, other.Code);
        Assert.Equal(ErrorCodes.PairingExpired, late.Code);
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.RedeemAsync("unknown-token", new RedeemInviteRequest("c", null, DeviceKind.Phone, "x"), CancellationToken.None));
    }

    [Theory]
    [InlineData("", DeviceKind.Phone)]
    [InlineData("has space", DeviceKind.Phone)]
    [InlineData("ok", (DeviceKind)7)]
    public async Task Redeem_InvalidRequest_IsValidationError(string clientId, DeviceKind kind) =>
        Assert.Equal(ErrorKind.Validation, (await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.RedeemAsync("x", new RedeemInviteRequest(clientId, null, kind, "p"), CancellationToken.None))).Kind);

    [Fact]
    public async Task Knock_ApprovedThenPolled_ReturnsSameCredentialsRepeatedly()
    {
        var knock = await harness.Pairing.CreateRequestAsync(new CreatePairingRequest("Laptop Lea", DeviceKind.Laptop, "Windows"), CancellationToken.None);
        Assert.Equal(PairingRequestStatus.Pending, harness.Pairing.Poll(knock.RequestId, knock.PollToken).Status);

        var device = await harness.Pairing.ApproveAsync(harness.Production.Id, knock.RequestId, CancellationToken.None);
        var first = harness.Pairing.Poll(knock.RequestId, knock.PollToken);
        var second = harness.Pairing.Poll(knock.RequestId, knock.PollToken);

        Assert.Equal(PairingRequestStatus.Approved, first.Status);
        Assert.Equal(first.Credentials, second.Credentials);
        Assert.Equal(device.Id, first.Credentials!.DeviceId);
        Assert.Equal(PairingMethod.Code, device.PairingMethod);
        Assert.Equal(PairingRequestStatus.Expired, harness.Pairing.Poll(knock.RequestId, "wrong").Status);
        Assert.Equal(ErrorCodes.NotFound, (await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.ApproveAsync(harness.Production.Id, knock.RequestId, CancellationToken.None))).Code);
        Assert.Single(harness.Data.Devices);
        Assert.Contains(harness.Events, e => e is PairingRequestRemovedEvent { Outcome: PairingRequestStatus.Approved });
    }

    [Fact]
    public async Task Knock_ApprovedAfterExpiry_IsPairingExpired()
    {
        var knock = await harness.Pairing.CreateRequestAsync(new CreatePairingRequest("Laptop Lea", DeviceKind.Laptop, "Windows"), CancellationToken.None);
        harness.Clock.Advance(harness.PairingOptions.RequestTtl);

        var error = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.ApproveAsync(harness.Production.Id, knock.RequestId, CancellationToken.None));

        Assert.Equal(ErrorCodes.PairingExpired, error.Code);
    }

    [Fact]
    public async Task Redeem_KindInRequestContradictsInvite_InviteDecides()
    {
        var phoneInvite = await harness.Pairing.GetPhoneInviteAsync(harness.Production.Id, CancellationToken.None);
        var linkInvite = await harness.Pairing.CreateInviteAsync(harness.Production.Id, new CreateInviteRequest(InviteKind.LaptopLink), CancellationToken.None);

        var phone = await harness.Pairing.RedeemAsync(Token(phoneInvite), new RedeemInviteRequest("c1", null, DeviceKind.Laptop, "p"), CancellationToken.None);
        var laptop = await harness.Pairing.RedeemAsync(Token(linkInvite), new RedeemInviteRequest("c2", "\u0001\u0002", DeviceKind.Phone, "p"), CancellationToken.None);

        var phoneDevice = harness.Data.Devices.Single(d => d.Id == phone.DeviceId);
        var laptopDevice = harness.Data.Devices.Single(d => d.Id == laptop.DeviceId);
        Assert.Equal((DeviceKind.Phone, "camera", "Handy 1"), (phoneDevice.Kind, phoneDevice.Slots[0].Slot, phoneDevice.Name));
        Assert.Equal((DeviceKind.Laptop, "screen-1", "Laptop 1"), (laptopDevice.Kind, laptopDevice.Slots[0].Slot, laptopDevice.Name));
    }

    [Fact]
    public async Task Activate_OtherProductionWithPendingKnock_DropsItAsExpired()
    {
        var knock = await harness.Pairing.CreateRequestAsync(new CreatePairingRequest("Laptop Lea", DeviceKind.Laptop, "Windows"), CancellationToken.None);
        var other = await harness.Productions.CreateAsync(new CreateProductionRequest("Zweite"), CancellationToken.None);

        await harness.Productions.ActivateAsync(other.Id, CancellationToken.None);

        Assert.Equal(PairingRequestStatus.Expired, harness.Pairing.Poll(knock.RequestId, knock.PollToken).Status);
        Assert.Contains(harness.Events, e => e is PairingRequestRemovedEvent { Outcome: PairingRequestStatus.Expired } r && r.RequestId == knock.RequestId);
        Assert.Empty(harness.Requests.Pending(harness.Production.Id, harness.Clock.Now));
    }

    [Fact]
    public async Task Knock_Denied_IsLoggedAndPollSaysDenied()
    {
        var knock = await harness.Pairing.CreateRequestAsync(new CreatePairingRequest("Mia", DeviceKind.Laptop, "Windows"), CancellationToken.None);

        await harness.Pairing.DenyAsync(harness.Production.Id, knock.RequestId, CancellationToken.None);
        await harness.Pairing.DenyAsync(harness.Production.Id, knock.RequestId, CancellationToken.None);

        Assert.Equal(PairingRequestStatus.Denied, harness.Pairing.Poll(knock.RequestId, knock.PollToken).Status);
        Assert.Single(harness.Events.OfType<PairingRequestRemovedEvent>());
        Assert.Contains("Request from Mia denied", harness.Events.OfType<LogAppendedEvent>().Select(l => l.Entry.Text));
    }

    [Fact]
    public async Task Knock_ApproveInOtherProduction_IsNotFound()
    {
        var knock = await harness.Pairing.CreateRequestAsync(new CreatePairingRequest("Mia", DeviceKind.Laptop, "Windows"), CancellationToken.None);
        var other = Production.Create("Andere", "andere", isActive: false, Build.T0);
        harness.Data.Productions.Add(other);

        Assert.Equal(ErrorKind.NotFound, (await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.ApproveAsync(other.Id, knock.RequestId, CancellationToken.None))).Kind);
    }

    [Fact]
    public async Task Knock_Expired_IsRemovedByMaintenance()
    {
        var knock = await harness.Pairing.CreateRequestAsync(new CreatePairingRequest("Mia", DeviceKind.Laptop, "Windows"), CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromMinutes(10));

        await harness.Pairing.ExpireRequestsAsync(CancellationToken.None);

        Assert.Contains(harness.Events, e => e is PairingRequestRemovedEvent { Outcome: PairingRequestStatus.Expired } r && r.RequestId == knock.RequestId);
        Assert.Equal(PairingRequestStatus.Expired, harness.Pairing.Poll(knock.RequestId, knock.PollToken).Status);
    }

    [Fact]
    public async Task Knock_Cancelled_IsRemoved()
    {
        var knock = await harness.Pairing.CreateRequestAsync(new CreatePairingRequest("Mia", DeviceKind.Laptop, "Windows"), CancellationToken.None);

        await harness.Pairing.CancelRequestAsync(knock.RequestId, "wrong", CancellationToken.None);
        Assert.Equal(PairingRequestStatus.Pending, harness.Pairing.Poll(knock.RequestId, knock.PollToken).Status);
        await harness.Pairing.CancelRequestAsync(knock.RequestId, knock.PollToken, CancellationToken.None);

        Assert.Equal(PairingRequestStatus.Expired, harness.Pairing.Poll(knock.RequestId, knock.PollToken).Status);
    }

    [Fact]
    public async Task MaintainInvites_PhoneInviteNearExpiry_IsRenewedAndExpiredLinkRemoved()
    {
        var phone = await harness.Pairing.GetPhoneInviteAsync(harness.Production.Id, CancellationToken.None);
        var link = await harness.Pairing.CreateInviteAsync(harness.Production.Id, new CreateInviteRequest(InviteKind.LaptopLink), CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromMinutes(30));

        await harness.Pairing.MaintainInvitesAsync(CancellationToken.None);
        var current = await harness.Pairing.GetPhoneInviteAsync(harness.Production.Id, CancellationToken.None);

        Assert.NotEqual(phone.Id, current.Id);
        Assert.Contains(harness.Events, e => e is InviteRemovedEvent r && r.InviteId == link.Id);
        Assert.DoesNotContain(harness.Data.Invites, i => i.Id == link.Id);
        Assert.True(current.ExpiresAt > harness.Clock.Now.AddMinutes(29));
    }

    [Fact]
    public async Task RevokeInvite_Phone_CreatesNextAndUnknownIsNotFound()
    {
        var phone = await harness.Pairing.GetPhoneInviteAsync(harness.Production.Id, CancellationToken.None);

        await harness.Pairing.RevokeInviteAsync(harness.Production.Id, phone.Id, CancellationToken.None);
        await harness.Pairing.RevokeInviteAsync(harness.Production.Id, phone.Id, CancellationToken.None);

        Assert.Equal(2, harness.Events.OfType<InviteUpsertedEvent>().Count());
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.RevokeInviteAsync(harness.Production.Id, "inv_none", CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Pairing.RedeemAsync(Token(phone), new RedeemInviteRequest("c", null, DeviceKind.Phone, "x"), CancellationToken.None));
    }

    public void Dispose() => harness.Dispose();
}

public sealed class OutputFlowTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    [Fact]
    public async Task Authorize_WrongKeyUnknownSlugOrAddress_IsForbidden()
    {
        var key = harness.Production.OutputKey;

        Assert.Equal(harness.Production.Id, (await harness.Outputs.AuthorizeAsync("webinar", key, null, CancellationToken.None)).ProductionId);
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", key + "x", null, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("other", key, null, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("../x", key, null, CancellationToken.None));
        await harness.Outputs.UpdateAccessAsync(harness.Production.Id, new UpdateOutputAccessRequest(["10.0.0.0/8"]), CancellationToken.None);
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", key, System.Net.IPAddress.Parse("192.168.1.1"), CancellationToken.None));
        Assert.NotNull(await harness.Outputs.AuthorizeAsync("webinar", key, System.Net.IPAddress.Parse("10.1.1.1"), CancellationToken.None));
    }

    [Fact]
    public async Task FindByKey_Hub_MatchesOnlyCurrentKey()
    {
        var old = harness.Production.OutputKey;
        Assert.NotNull(await harness.Outputs.FindByKeyAsync(old, null, CancellationToken.None));

        await harness.Outputs.RegenerateKeyAsync(harness.Production.Id, CancellationToken.None);

        Assert.Null(await harness.Outputs.FindByKeyAsync(old, null, CancellationToken.None));
        Assert.Null(await harness.Outputs.FindByKeyAsync(null, null, CancellationToken.None));
        Assert.NotNull(await harness.Outputs.FindByKeyAsync(harness.Production.OutputKey, null, CancellationToken.None));
    }

    [Fact]
    public async Task RegenerateKey_ConnectedPages_AreAbortedAndKicked()
    {
        await harness.Outputs.ConnectedAsync(harness.Production.Id, "o1", "10.0.0.5", CancellationToken.None);
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_1", "output_webinar_abc", []));
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_2", "studio_abc", []));

        var settings = await harness.Outputs.RegenerateKeyAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal(["o1"], harness.Publisher.Aborted);
        Assert.Equal(["output_webinar_abc"], harness.Rooms.Removed);
        Assert.Equal($"https://sf.example/o/webinar?k={harness.Production.OutputKey}", settings.Url);
        Assert.Equal(OutputState.None, harness.Events.OfType<OutputStatusChangedEvent>().Last().Status.State);
    }

    [Fact]
    public async Task Subscribe_Delta_HidesPrivateEventsAsRevisionOnly()
    {
        var snapshot = await harness.Outputs.SubscribeAsync(harness.Production.Id, "o1", null, CancellationToken.None);
        await harness.PairPhoneAsync();
        await harness.Productions.SetPreviewAsync(harness.Production.Id, new SetPreviewRequest(harness.Production.OrderedScenes[1].Id), CancellationToken.None);

        var delta = await harness.Outputs.SubscribeAsync(harness.Production.Id, "o1", snapshot.Revision, CancellationToken.None);

        Assert.NotNull(snapshot.Snapshot);
        Assert.Null(delta.Snapshot);
        Assert.Equal(delta.Revision - snapshot.Revision, delta.Events!.Count);
        Assert.Contains(delta.Events, e => e is RevisionOnlyEvent);
        Assert.Contains(delta.Events, e => e is ProgramSwitchedEvent);
        Assert.Contains(delta.Events, e => e is SourceUpsertedEvent s && s.Source.Status == SourceStatus.Ok);
        Assert.DoesNotContain(delta.Events, e => e is DeviceUpsertedEvent or InviteUpsertedEvent or LogAppendedEvent);
        Assert.Contains("output:o1:" + harness.Production.Id, harness.Publisher.Joined);
    }

    [Fact]
    public async Task Tick_StaleOutput_IsPublished()
    {
        await harness.Outputs.ConnectedAsync(harness.Production.Id, "o1", "10.0.0.5", CancellationToken.None);
        await harness.Outputs.ReportAsync(harness.Production.Id, new OutputReport(true, 100, 50, null), CancellationToken.None);
        Assert.Equal(OutputState.Connected, harness.Events.OfType<OutputStatusChangedEvent>().Last().Status.State);

        harness.Clock.Advance(TimeSpan.FromSeconds(7));
        await harness.Outputs.TickAsync(CancellationToken.None);

        Assert.Equal(OutputState.Stale, harness.Events.OfType<OutputStatusChangedEvent>().Last().Status.State);
    }

    [Fact]
    public async Task UpdateAccess_ConnectedPageNoLongerAllowed_IsAborted()
    {
        await harness.Outputs.ConnectedAsync(harness.Production.Id, "o1", "10.0.0.5", CancellationToken.None);
        await harness.Outputs.ConnectedAsync(harness.Production.Id, "o2", "192.168.1.9", CancellationToken.None);

        await harness.Outputs.UpdateAccessAsync(harness.Production.Id, new UpdateOutputAccessRequest(["10.0.0.0/8"]), CancellationToken.None);

        Assert.Equal(["o2"], harness.Publisher.Aborted);
    }

    public void Dispose() => harness.Dispose();
}

public sealed class StudioSessionTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    [Fact]
    public async Task Subscribe_TwoSessions_CountsPresenceAndSwitchingProductionLeaves()
    {
        var first = await harness.Studio.SubscribeAsync("s1", harness.Production.Id, null, CancellationToken.None);
        var second = await harness.Studio.SubscribeAsync("s2", harness.Production.Id, null, CancellationToken.None);
        var other = Production.Create("Andere", "andere", isActive: false, Build.T0);
        harness.Data.Productions.Add(other);

        await harness.Studio.SubscribeAsync("s2", other.Id, null, CancellationToken.None);
        await harness.Studio.DisconnectedAsync("s1");
        await harness.Studio.DisconnectedAsync("unknown");

        Assert.Equal(1, first.Snapshot!.OperatorsOnline);
        Assert.Equal(2, second.Snapshot!.OperatorsOnline);
        Assert.Equal([1, 2, 1, 1, 0], harness.Publisher.Presence.Select(p => p.Count));
        Assert.Empty(harness.Runtime.StudioConnections);
    }

    [Fact]
    public async Task Subscribe_DisconnectRacesSubscribe_DoesNotLeakPresence()
    {
        await Task.WhenAll(Enumerable.Range(0, 50).Select(async i =>
        {
            var connection = $"c{i}";
            var subscribe = harness.Studio.SubscribeAsync(connection, harness.Production.Id, null, CancellationToken.None);
            var disconnect = harness.Studio.DisconnectedAsync(connection);
            await Task.WhenAll(subscribe, disconnect);
            await harness.Studio.DisconnectedAsync(connection);
        }));

        Assert.Empty(harness.Runtime.StudioConnections);
    }

    public void Dispose() => harness.Dispose();
}
