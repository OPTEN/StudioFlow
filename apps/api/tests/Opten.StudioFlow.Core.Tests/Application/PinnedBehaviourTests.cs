using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>Behaviour pinned in docs/testing.md section 7 and spec 12 (source status, sessions, output view, revisions).</summary>
public sealed class PinnedBehaviourTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    [Fact]
    public async Task Report_RtcReconnectingWhileHubUpAndTrackPublished_SourceReconnectsAtOnce()
    {
        var (device, identity) = await LiveAsync();
        await PublishAsync(device.Id, "TR_1");
        Assert.Equal(SourceStatus.Ok, harness.Source(Camera(device)).Status);

        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live, RtcState.Reconnecting), CancellationToken.None);
        var reconnecting = harness.Source(Camera(device));
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live, RtcState.Disconnected), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);

        Assert.Equal(SourceStatus.Reconnecting, reconnecting.Status);
        Assert.Equal(SourceStatus.Ok, harness.Source(Camera(device)).Status);
        var incidents = harness.Events.OfType<IncidentUpsertedEvent>().Select(e => e.Incident).ToList();
        Assert.Equal([IncidentKind.Reconnecting, IncidentKind.Reconnecting], incidents.Select(i => i.Kind));
        Assert.NotNull(incidents[^1].EndedAt);
        Assert.Contains(harness.Events.OfType<LogAppendedEvent>(), l => l.Entry.Text == "K1 reconnecting");
    }

    [Fact]
    public async Task ExpireStaleReports_DeviceSilentForSixSeconds_IsDisconnectedWithoutTelemetryPush()
    {
        var (device, identity) = await LiveAsync();
        var pushed = harness.Publisher.Telemetry.Count;

        harness.Clock.Advance(TimeSpan.FromSeconds(6));
        await harness.Devices.TickAsync(CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source(Camera(device)).Status);
        harness.Clock.Advance(TimeSpan.FromSeconds(1));
        await harness.Devices.TickAsync(CancellationToken.None);
        var telemetry = await harness.Productions.GetTelemetryAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal(SourceStatus.Reconnecting, harness.Source(Camera(device)).Status);
        Assert.Equal(RtcState.Disconnected, Assert.Single(telemetry).Telemetry.Rtc);
        Assert.Equal(pushed, harness.Publisher.Telemetry.Count);
        Assert.Equal(DeviceConnection.Reconnecting, harness.Events.OfType<DeviceUpsertedEvent>().Last().Device.Connection);

        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source(Camera(device)).Status);
    }

    [Fact]
    public async Task Hello_ReplacedTabComesBack_IsRefusedAndCurrentSessionStays()
    {
        var (_, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "p", "1"), CancellationToken.None);
        await harness.Devices.HelloAsync(identity, "c2", new DeviceHelloDto("tab-2", "p", "1"), CancellationToken.None);

        var refused = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Devices.HelloAsync(identity, "c3", new DeviceHelloDto("tab-1", "p", "1"), CancellationToken.None));
        await harness.Devices.HelloAsync(identity, "c4", new DeviceHelloDto("tab-2", "p", "1"), CancellationToken.None);
        await harness.Devices.HelloAsync(identity, "c5", new DeviceHelloDto("tab-3", "p", "1"), CancellationToken.None);

        Assert.Equal(ErrorCodes.Conflict, refused.Code);
        Assert.Equal(["c1", "c3", "c4"], harness.Publisher.Replaced);
        Assert.Contains("c3", harness.Publisher.AbortedAfterDelivery);
        Assert.Contains("c2", harness.Publisher.Aborted);
        Assert.Equal("c5", harness.Runtime.FindDevice(identity.DeviceId)!.ConnectionId);
    }

    [Fact]
    public async Task OutputView_HealthOnlyChange_IsRevisionOnlyButLabelChangeIsDelivered()
    {
        var (device, identity) = await LiveAsync();
        var studio = harness.Publisher.StudioEvents.ToArray();
        var output = harness.Publisher.OutputEvents.ToArray();
        var healthChange = Array.FindLastIndex(studio, e => e is SourceUpsertedEvent { Source.Status: SourceStatus.Ok });

        await harness.DeviceAdmin.RenameAsync(harness.Production.Id, device.Id, new RenameDeviceRequest("Bühne"), CancellationToken.None);
        var renamed = harness.Publisher.OutputEvents.OfType<SourceUpsertedEvent>().Last();
        var delta = await harness.Outputs.SubscribeAsync(harness.Production.Id, "o1", studio[0].Revision - 1, CancellationToken.None);

        Assert.IsType<RevisionOnlyEvent>(output[healthChange]);
        Assert.Equal(studio[healthChange].Revision, output[healthChange].Revision);
        Assert.Equal(("Bühne", SourceStatus.Ok, (DateTimeOffset?)null), (renamed.Source.Label, renamed.Source.Status, renamed.Source.StatusSince));
        Assert.DoesNotContain(delta.Events!, e => e is SourceUpsertedEvent { Source.Status: not SourceStatus.Ok });
        Assert.IsType<RevisionOnlyEvent>(delta.Events!.Single(e => e.Revision == studio[healthChange].Revision));
        _ = identity;
    }

    [Fact]
    public async Task AcknowledgeIncident_OpenThenRecoveredThenAgain_IsConflictThenOkThenNotFound()
    {
        var (device, identity) = await LiveAsync();
        await harness.Devices.DisconnectedAsync(identity, "c1", CancellationToken.None);
        var incident = harness.Events.OfType<IncidentUpsertedEvent>().Last().Incident;

        var open = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Productions.AcknowledgeIncidentAsync(harness.Production.Id, incident.Id, CancellationToken.None));
        await harness.Devices.HelloAsync(identity, "c2", new DeviceHelloDto("tab-1", "p", "1"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c2", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        await harness.Productions.AcknowledgeIncidentAsync(harness.Production.Id, incident.Id, CancellationToken.None);
        var again = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Productions.AcknowledgeIncidentAsync(harness.Production.Id, incident.Id, CancellationToken.None));

        Assert.Equal((ErrorKind.Conflict, ErrorCodes.Conflict), (open.Kind, open.Code));
        Assert.Equal(ErrorKind.NotFound, again.Kind);
        Assert.Contains(harness.Events, e => e is IncidentRemovedEvent r && r.IncidentId == incident.Id);
        var audit = Assert.Single(harness.Data.Audit, a => a.Action == AuditActions.IncidentAcknowledged);
        Assert.Equal((AuditActors.Admin, device.Slots[0].Code), (audit.Actor, audit.Detail(AuditDetails.Code)));
    }

    [Theory]
    [InlineData(-1L)]
    [InlineData(long.MinValue)]
    public async Task Changes_NegativeRevision_IsValidationFailed(long since)
    {
        var studio = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Productions.GetChangesAsync(harness.Production.Id, since, CancellationToken.None));
        var access = new OutputLinkAccess(harness.Production.Id, harness.Production.Slug, harness.Link.Id, harness.Link.Name, harness.Link.Key, []);
        var output = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.GetChangesAsync(access, since, CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationFailed, studio.Code);
        Assert.Equal(ErrorCodes.ValidationFailed, output.Code);
    }

    [Fact]
    public async Task OutputChanges_CurrentOrBufferedOrUnknownRevision_AreEmptyDeltaOrSnapshot()
    {
        await harness.Productions.UpdateAsync(harness.Production.Id, new UpdateProductionRequest("New", null, null), CancellationToken.None);
        var access = new OutputLinkAccess(harness.Production.Id, harness.Production.Slug, harness.Link.Id, harness.Link.Name, harness.Link.Key, []);
        var current = harness.Runtime.Revision;

        var same = await harness.Outputs.GetChangesAsync(access, current, CancellationToken.None);
        var delta = await harness.Outputs.GetChangesAsync(access, current - 1, CancellationToken.None);
        var snapshot = await harness.Outputs.GetChangesAsync(access, 0, CancellationToken.None);

        Assert.Empty(same.Events!);
        Assert.Null(same.Snapshot);
        Assert.IsType<ProductionChangedEvent>(Assert.Single(delta.Events!));
        Assert.Null(snapshot.Events);
        Assert.All(snapshot.Snapshot!.Sources, s => Assert.Equal((SourceStatus.Ok, (DateTimeOffset?)null), (s.Status, s.StatusSince)));
    }

    [Fact]
    public async Task LiveMarks_SourceGoesLiveAndPeriodically_ArePersisted()
    {
        var (device, _) = await LiveAsync();
        var first = harness.Data.LiveMarks[Camera(device)].LastLiveAt;

        harness.Clock.Advance(TimeSpan.FromMinutes(1));
        await harness.RestartWatch.MarkLiveSourcesAsync(CancellationToken.None);

        Assert.Equal(harness.Clock.Now - TimeSpan.FromMinutes(1), first);
        Assert.Equal(harness.Clock.Now, harness.Data.LiveMarks[Camera(device)].LastLiveAt);
        Assert.Equal(harness.Production.Id, harness.Data.LiveMarks[Camera(device)].ProductionId);
    }

    [Fact]
    public async Task RestartWatch_LiveSourceOnAirWhoseDeviceDoesNotReturn_GetsReconnectingIncident()
    {
        var (gone, _) = await harness.PairPhoneAsync("Phone 1");
        var (back, backIdentity) = await harness.PairPhoneAsync("Phone 2");
        var (idle, _) = await harness.PairPhoneAsync("Phone 3");
        var (old, _) = await harness.PairPhoneAsync("Phone 4");
        var program = harness.Production.OrderedScenes[0].Id;
        var preview = harness.Production.OrderedScenes[1].Id;
        await harness.Scenes.AddItemAsync(harness.Production.Id, program, Build.Add(Camera(gone)), CancellationToken.None);
        await harness.Scenes.AddItemAsync(harness.Production.Id, preview, Build.Add(Camera(back)), CancellationToken.None);
        await harness.Scenes.AddItemAsync(harness.Production.Id, program, Build.Add(Camera(old)), CancellationToken.None);
        await harness.Productions.SetPreviewAsync(harness.Production.Id, new SetPreviewRequest(preview), CancellationToken.None);
        foreach (var (device, ago) in new[] { (gone, TimeSpan.FromMinutes(1)), (back, TimeSpan.FromMinutes(1)), (idle, TimeSpan.FromMinutes(1)), (old, TimeSpan.FromHours(13)) })
        {
            harness.Data.LiveMarks[Camera(device)] = new SourceLastLive(Camera(device), harness.Production.Id, device.Id, harness.Clock.Now - ago);
        }

        harness.Clock.Advance(TimeSpan.FromSeconds(10));
        await harness.Devices.HelloAsync(backIdentity, "c-back", new DeviceHelloDto("tab", "p", "1"), CancellationToken.None);
        await harness.RestartWatch.CheckAfterStartAsync(CancellationToken.None);
        Assert.False(harness.RestartWatch.HasChecked);
        harness.Clock.Advance(TimeSpan.FromSeconds(5));
        await harness.RestartWatch.CheckAfterStartAsync(CancellationToken.None);

        Assert.True(harness.RestartWatch.HasChecked);
        Assert.Equal(SourceStatus.Reconnecting, harness.Source(Camera(gone)).Status);
        Assert.Equal(SourceStatus.Connecting, harness.Source(Camera(back)).Status);
        Assert.Equal(SourceStatus.Offline, harness.Source(Camera(idle)).Status);
        Assert.Equal(SourceStatus.Offline, harness.Source(Camera(old)).Status);
        var incident = Assert.Single(harness.Events.OfType<IncidentUpsertedEvent>()).Incident;
        Assert.Equal((Camera(gone), IncidentKind.Reconnecting, harness.Runtimes.StartedAt), (incident.SourceId, incident.Kind, incident.StartedAt));
        Assert.Contains(harness.Events.OfType<LogAppendedEvent>(), l => l.Entry.Text == "K1 reconnecting");
        Assert.Equal(DeviceConnection.Reconnecting, harness.Events.OfType<DeviceUpsertedEvent>().Last(d => d.Device.Id == gone.Id).Device.Connection);
    }

    [Fact]
    public async Task RestartWatch_FlaggedSourceReturns_RecoversTheIncident()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Scenes.AddItemAsync(harness.Production.Id, harness.Production.OrderedScenes[0].Id, Build.Add(Camera(device)), CancellationToken.None);
        harness.Data.LiveMarks[Camera(device)] = new SourceLastLive(Camera(device), harness.Production.Id, device.Id, harness.Clock.Now);
        harness.Clock.Advance(TimeSpan.FromSeconds(15));
        await harness.RestartWatch.CheckAfterStartAsync(CancellationToken.None);

        harness.Clock.Advance(TimeSpan.FromSeconds(10));
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab", "p", "1"), CancellationToken.None);
        Assert.Equal(SourceStatus.Reconnecting, harness.Source(Camera(device)).Status);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);

        Assert.Equal(SourceStatus.Ok, harness.Source(Camera(device)).Status);
        Assert.NotNull(harness.Events.OfType<IncidentUpsertedEvent>().Last().Incident.EndedAt);
        Assert.Contains(harness.Events.OfType<LogAppendedEvent>(), l => l.Entry.Text == "K1 is back, was gone for 25 s");
    }

    [Fact]
    public async Task ShortTtlOptions_Pairing_UseTheConfiguredDurations()
    {
        using var shortHarness = new ServiceHarness(pairing: new PairingOptions { InviteTtl = TimeSpan.FromMinutes(1), RequestTtl = TimeSpan.FromSeconds(20), CredentialsWindow = TimeSpan.FromSeconds(10) });

        var invite = await shortHarness.Pairing.GetPhoneInviteAsync(shortHarness.Production.Id, CancellationToken.None);
        var knock = await shortHarness.Pairing.CreateRequestAsync(new CreatePairingRequest("Laptop", DeviceKind.Laptop, "p"), CancellationToken.None);
        var same = await shortHarness.Pairing.GetPhoneInviteAsync(shortHarness.Production.Id, CancellationToken.None);
        shortHarness.Clock.Advance(TimeSpan.FromSeconds(31));
        var renewed = await shortHarness.Pairing.GetPhoneInviteAsync(shortHarness.Production.Id, CancellationToken.None);
        shortHarness.Clock.Advance(TimeSpan.FromSeconds(-31));

        Assert.Equal(invite.Id, same.Id);
        Assert.NotEqual(invite.Id, renewed.Id);
        Assert.Equal(shortHarness.Clock.Now + TimeSpan.FromMinutes(1), invite.ExpiresAt);
        Assert.Equal(shortHarness.Clock.Now + TimeSpan.FromSeconds(20), knock.ExpiresAt);
        shortHarness.Clock.Advance(TimeSpan.FromSeconds(20));
        Assert.Equal(PairingRequestStatus.Expired, shortHarness.Pairing.Poll(knock.RequestId, knock.PollToken).Status);
    }

    public void Dispose() => harness.Dispose();

    private static string Camera(Device device) => device.SourceIdOf(device.Slots[0]);

    private async Task<(Device Device, DeviceIdentity Identity)> LiveAsync()
    {
        var (device, identity) = await harness.PairPhoneAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "p", "1"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("camera", SlotState.Live), CancellationToken.None);
        return (device, identity);
    }

    private Task PublishAsync(string deviceId, string trackSid) =>
        harness.LiveKit.HandleAsync(new LiveKitEvent(LiveKitEventKind.TrackPublished, harness.Production.Id, "RM_1", "PA_1", deviceId, "camera", trackSid), CancellationToken.None);
}
