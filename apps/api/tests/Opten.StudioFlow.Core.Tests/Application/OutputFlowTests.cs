using System.Net;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class OutputFlowTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    private string ProductionId => harness.Production.Id;

    private OutputStatusDto Status => harness.Events.OfType<OutputStatusChangedEvent>().Last().Status;

    [Fact]
    public async Task Authorize_WrongKeyUnknownSlugOrAddress_IsForbidden()
    {
        var key = harness.Link.Key;

        Assert.Equal(ProductionId, (await harness.Outputs.AuthorizeAsync("webinar", key, null, CancellationToken.None)).ProductionId);
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", key + "x", null, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", null, null, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("other", key, null, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("../x", key, null, CancellationToken.None));
        await harness.Outputs.UpdateAccessAsync(ProductionId, harness.Link.Id, new UpdateOutputAccessRequest(["10.0.0.0/8"]), CancellationToken.None);
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", key, IPAddress.Parse("192.168.1.1"), CancellationToken.None));
        Assert.NotNull(await harness.Outputs.AuthorizeAsync("webinar", key, IPAddress.Parse("10.1.1.1"), CancellationToken.None));
    }

    [Fact]
    public async Task Authorize_AnyLinkOfTheProduction_Works()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);

        var proxy = await harness.Outputs.AuthorizeAsync("webinar", harness.Link.Key, null, CancellationToken.None);
        var camera = await harness.Outputs.AuthorizeAsync("webinar", KeyOf(teams), null, CancellationToken.None);

        Assert.Equal(harness.Link.Id, proxy.LinkId);
        Assert.Equal(teams.Id, camera.LinkId);
        Assert.Equal("Teams camera", camera.LinkName);
    }

    [Fact]
    public async Task Authorize_IpRestrictionOfOneLink_DoesNotRestrictTheOther()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Outputs.UpdateAccessAsync(ProductionId, teams.Id, new UpdateOutputAccessRequest(["10.0.0.0/8"]), CancellationToken.None);
        var outside = IPAddress.Parse("192.168.1.1");

        Assert.NotNull(await harness.Outputs.AuthorizeAsync("webinar", harness.Link.Key, outside, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", KeyOf(teams), outside, CancellationToken.None));
        Assert.Null(await harness.Outputs.FindByKeyAsync(KeyOf(teams), outside, CancellationToken.None));
        Assert.NotNull(await harness.Outputs.FindByKeyAsync(KeyOf(teams), IPAddress.Parse("10.2.3.4"), CancellationToken.None));
    }

    [Fact]
    public async Task FindByKey_Hub_MatchesOnlyCurrentKeysOfExistingLinks()
    {
        var old = harness.Link.Key;
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        Assert.NotNull(await harness.Outputs.FindByKeyAsync(old, null, CancellationToken.None));

        await harness.Outputs.RegenerateKeyAsync(ProductionId, harness.Link.Id, CancellationToken.None);
        await harness.Outputs.RevokeLinkAsync(ProductionId, teams.Id, CancellationToken.None);

        Assert.Null(await harness.Outputs.FindByKeyAsync(old, null, CancellationToken.None));
        Assert.Null(await harness.Outputs.FindByKeyAsync(KeyOf(teams), null, CancellationToken.None));
        Assert.Null(await harness.Outputs.FindByKeyAsync(null, null, CancellationToken.None));
        Assert.Null(await harness.Outputs.FindByKeyAsync("", null, CancellationToken.None));
        Assert.NotNull(await harness.Outputs.FindByKeyAsync(harness.Link.Key, null, CancellationToken.None));
    }

    [Fact]
    public async Task Settings_Links_CarryNameUrlKeyAndLimit()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("  Teams camera "), CancellationToken.None);

        var settings = await harness.Outputs.GetSettingsAsync(ProductionId, CancellationToken.None);

        Assert.Equal(["Proxy", "Teams camera"], settings.Links.Select(l => l.Name));
        Assert.Equal($"https://sf.example/o/webinar?k={harness.Link.Key}", settings.Links[0].Url);
        Assert.Equal(teams.Url, settings.Links[1].Url);
        Assert.Equal(OutputLink.MaxPerProduction, settings.MaxLinks);
        Assert.Null(settings.Links[1].LastSeenAt);
    }

    [Fact]
    public async Task CreateLink_NewKeyAuditAndStatus()
    {
        var link = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);

        Assert.NotEqual(harness.Link.Key, KeyOf(link));
        Assert.Equal(43, KeyOf(link).Length);
        Assert.Contains(harness.Data.Audit, a => a.Action == AuditActions.OutputLinkCreated && a.Detail(AuditDetails.Name) == "Teams camera");
        Assert.Equal(["Proxy", "Teams camera"], Status.Links.Select(l => l.Name));
        Assert.All(Status.Links, l => Assert.Equal(OutputState.None, l.State));
        Assert.Contains(harness.Events.OfType<LogAppendedEvent>(), l => l.Entry.Text == "Output link “Teams camera” created");
    }

    [Fact]
    public async Task CreateLink_InvalidDuplicateOrOverTheLimit_IsRejected()
    {
        await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);

        var empty = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("  "), CancellationToken.None));
        var tooLong = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest(new string('x', OutputLink.NameMax + 1)), CancellationToken.None));
        var duplicate = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("TEAMS camera"), CancellationToken.None));

        Assert.All([empty, tooLong, duplicate], e => Assert.Equal(ErrorCodes.ValidationFailed, e.Code));
        Assert.True(duplicate.Errors!.ContainsKey("name"));
    }

    [Fact]
    public async Task CreateLink_TenthIsAllowedEleventhIsLimitReached()
    {
        for (var i = 2; i <= OutputLink.MaxPerProduction; i++)
        {
            await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest($"Link {i}"), CancellationToken.None);
        }

        var overLimit = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("One too many"), CancellationToken.None));
        await harness.Outputs.RevokeLinkAsync(ProductionId, harness.Link.Id, CancellationToken.None);
        await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("One too many"), CancellationToken.None);

        Assert.Equal(ErrorCodes.LimitReached, overLimit.Code);
        Assert.Equal(OutputLink.MaxPerProduction, (await harness.Outputs.GetSettingsAsync(ProductionId, CancellationToken.None)).Links.Count);
    }

    [Fact]
    public async Task CreateLink_NameOfAnotherProduction_IsAllowed()
    {
        var other = Production.Create("Another", "another", isActive: false, Build.T0);
        harness.Data.Productions.Add(other);
        harness.Data.OutputLinks.Add(OutputLink.Create(other.Id, "Proxy", [], Build.T0));

        await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);

        Assert.Equal(["Proxy"], (await harness.Outputs.GetSettingsAsync(other.Id, CancellationToken.None)).Links.Select(l => l.Name));
    }

    [Fact]
    public async Task RenameLink_KeepsKeyAndShowsNewNameInStatus()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams"), CancellationToken.None);

        var renamed = await harness.Outputs.RenameLinkAsync(ProductionId, teams.Id, new RenameOutputLinkRequest("Teams camera"), CancellationToken.None);
        var sameNameDifferentCase = await harness.Outputs.RenameLinkAsync(ProductionId, teams.Id, new RenameOutputLinkRequest("TEAMS CAMERA"), CancellationToken.None);

        Assert.Equal(teams.Url, renamed.Url);
        Assert.Equal("TEAMS CAMERA", sameNameDifferentCase.Name);
        Assert.Equal(["Proxy", "TEAMS CAMERA"], Status.Links.Select(l => l.Name));
        Assert.Contains(harness.Data.Audit, a => a.Action == AuditActions.OutputLinkRenamed && a.Detail(AuditDetails.Name) == "Teams camera");
    }

    [Fact]
    public async Task RenameLink_TakenInvalidOrUnknown_IsRejected()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams"), CancellationToken.None);

        var taken = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RenameLinkAsync(ProductionId, teams.Id, new RenameOutputLinkRequest("proxy"), CancellationToken.None));
        var empty = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RenameLinkAsync(ProductionId, teams.Id, new RenameOutputLinkRequest(""), CancellationToken.None));
        var unknown = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RenameLinkAsync(ProductionId, "olk_none", new RenameOutputLinkRequest("X"), CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationFailed, taken.Code);
        Assert.Equal(ErrorCodes.ValidationFailed, empty.Code);
        Assert.Equal(ErrorCodes.NotFound, unknown.Code);
    }

    [Fact]
    public async Task RegenerateKey_OnlyTheLinksPagesAreAbortedAndKicked()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "proxy-1", "10.0.0.5", CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, teams.Id, "teams-1", "10.0.0.6", CancellationToken.None);
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_1", $"output_webinar_{harness.Link.Id}_abc", []));
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_2", $"output_webinar_{teams.Id}_abc", []));
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_3", "studio_abc", []));
        var oldKey = harness.Link.Key;

        var regenerated = await harness.Outputs.RegenerateKeyAsync(ProductionId, harness.Link.Id, CancellationToken.None);

        Assert.Equal(["proxy-1"], harness.Publisher.Aborted);
        Assert.Equal([$"output_webinar_{harness.Link.Id}_abc"], harness.Rooms.Removed);
        Assert.NotEqual(oldKey, harness.Link.Key);
        Assert.Equal($"https://sf.example/o/webinar?k={harness.Link.Key}", regenerated.Url);
        Assert.Equal(OutputState.None, Status.Links.Single(l => l.LinkId == harness.Link.Id).State);
        Assert.Equal(1, Status.Links.Single(l => l.LinkId == teams.Id).Consumers);
        Assert.Contains(harness.Data.Audit, a => a.Action == AuditActions.OutputKeyRegenerated && a.Detail(AuditDetails.Name) == "Proxy");
    }

    [Fact]
    public async Task RegenerateKey_UnknownLink_IsNotFound()
    {
        var error = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RegenerateKeyAsync(ProductionId, "olk_none", CancellationToken.None));

        Assert.Equal(ErrorCodes.NotFound, error.Code);
    }

    [Fact]
    public async Task RevokeLink_KeyIsInvalidAtOnceAndOnlyItsPagesAreKicked()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "proxy-1", "10.0.0.5", CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, teams.Id, "teams-1", "10.0.0.6", CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, teams.Id, "teams-2", "10.0.0.6", CancellationToken.None);
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_1", $"output_webinar_{harness.Link.Id}_abc", []));
        harness.Rooms.Participants.Add(new LiveKitParticipant("PA_2", $"output_webinar_{teams.Id}_abc", []));

        await harness.Outputs.RevokeLinkAsync(ProductionId, teams.Id, CancellationToken.None);

        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", KeyOf(teams), null, CancellationToken.None));
        Assert.NotNull(await harness.Outputs.AuthorizeAsync("webinar", harness.Link.Key, null, CancellationToken.None));
        Assert.Equal(["teams-1", "teams-2"], harness.Publisher.Aborted.Order());
        Assert.Equal([$"output_webinar_{teams.Id}_abc"], harness.Rooms.Removed);
        Assert.Equal(["Proxy"], Status.Links.Select(l => l.Name));
        Assert.Equal(1, Status.Consumers);
        Assert.Contains(harness.Data.Audit, a => a.Action == AuditActions.OutputLinkRevoked && a.Detail(AuditDetails.Name) == "Teams camera");
    }

    [Fact]
    public async Task RevokeLink_UnknownOrAlreadyRevoked_IsNotFound()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Outputs.RevokeLinkAsync(ProductionId, teams.Id, CancellationToken.None);

        var again = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RevokeLinkAsync(ProductionId, teams.Id, CancellationToken.None));
        var unknown = await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RevokeLinkAsync(ProductionId, "olk_none", CancellationToken.None));

        Assert.Equal(ErrorCodes.NotFound, again.Code);
        Assert.Equal(ErrorCodes.NotFound, unknown.Code);
    }

    [Fact]
    public async Task RevokeLink_LinkOfAnotherProduction_IsNotFound()
    {
        var other = Production.Create("Another", "another", isActive: false, Build.T0);
        var foreign = OutputLink.Create(other.Id, "Proxy", [], Build.T0);
        harness.Data.Productions.Add(other);
        harness.Data.OutputLinks.Add(foreign);

        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RevokeLinkAsync(ProductionId, foreign.Id, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.RegenerateKeyAsync(ProductionId, foreign.Id, CancellationToken.None));
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.UpdateAccessAsync(ProductionId, foreign.Id, new UpdateOutputAccessRequest([]), CancellationToken.None));

        Assert.NotNull(await harness.Outputs.AuthorizeAsync("another", foreign.Key, null, CancellationToken.None));
    }

    [Fact]
    public async Task RevokeLink_LastLink_LeavesNoWayInUntilANewLinkExists()
    {
        await harness.Outputs.RevokeLinkAsync(ProductionId, harness.Link.Id, CancellationToken.None);

        Assert.Empty((await harness.Outputs.GetSettingsAsync(ProductionId, CancellationToken.None)).Links);
        Assert.Empty(Status.Links);
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.AuthorizeAsync("webinar", harness.Link.Key, null, CancellationToken.None));
    }

    [Fact]
    public async Task Connected_LinkRevokedMeanwhile_IsAbortedAndNotCounted()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Outputs.RevokeLinkAsync(ProductionId, teams.Id, CancellationToken.None);

        await harness.Outputs.ConnectedAsync(ProductionId, teams.Id, "late", "10.0.0.6", CancellationToken.None);

        Assert.Equal(["late"], harness.Publisher.Aborted);
        Assert.Empty(harness.Runtime.Output.ConnectionIds);
    }

    [Fact]
    public async Task Status_PerLink_ConnectedAndStaleAreIndependent()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "proxy-1", "10.0.0.5", CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, teams.Id, "teams-1", "10.0.0.6", CancellationToken.None);
        await harness.Outputs.ReportAsync(ProductionId, harness.Link.Id, new OutputReport(true, 100, 50, null), CancellationToken.None);
        await harness.Outputs.ReportAsync(ProductionId, teams.Id, new OutputReport(false, 200, 30, null), CancellationToken.None);

        var status = Status;

        Assert.Equal(OutputState.Connected, status.State);
        Assert.Equal(2, status.Consumers);
        Assert.Equal(["10.0.0.5", "10.0.0.6"], status.Addresses);
        var proxy = status.Links.Single(l => l.LinkId == harness.Link.Id);
        var camera = status.Links.Single(l => l.LinkId == teams.Id);
        Assert.Equal((OutputState.Connected, 100, 50d), (proxy.State, proxy.LatencyMs, proxy.Fps));
        Assert.Equal((OutputState.Stale, 200, 30d), (camera.State, camera.LatencyMs, camera.Fps));
        Assert.Equal(["10.0.0.5"], proxy.Addresses);
    }

    [Fact]
    public async Task Status_AfterRestart_NamesLinksWithoutConnections()
    {
        harness.Data.OutputLinks.Add(OutputLink.Create(ProductionId, "Teams camera", harness.Data.OutputLinks, harness.Clock.Now));

        var snapshot = await harness.Productions.GetSnapshotAsync(ProductionId, CancellationToken.None);

        Assert.Equal(["Proxy", "Teams camera"], snapshot.OutputStatus.Links.Select(l => l.Name));
    }

    [Fact]
    public async Task LastSeen_ConnectAndDisconnect_AreRecordedPerLink()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        harness.Clock.Advance(TimeSpan.FromMinutes(1));
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "proxy-1", "10.0.0.5", CancellationToken.None);
        var connectedAt = harness.Clock.Now;
        harness.Clock.Advance(TimeSpan.FromMinutes(5));

        await harness.Outputs.DisconnectedAsync(ProductionId, "proxy-1", CancellationToken.None);
        var settings = await harness.Outputs.GetSettingsAsync(ProductionId, CancellationToken.None);

        Assert.Equal(connectedAt.AddMinutes(5), settings.Links.Single(l => l.Id == harness.Link.Id).LastSeenAt);
        Assert.Null(settings.Links.Single(l => l.Id == teams.Id).LastSeenAt);
    }

    [Fact]
    public async Task Disconnected_UnknownConnection_ChangesNothing()
    {
        var events = harness.Events.Count;

        await harness.Outputs.DisconnectedAsync(ProductionId, "never-connected", CancellationToken.None);

        Assert.Equal(events, harness.Events.Count);
    }

    [Fact]
    public async Task Report_BadValues_AreDropped()
    {
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "proxy-1", "10.0.0.5", CancellationToken.None);

        await harness.Outputs.ReportAsync(ProductionId, harness.Link.Id, new OutputReport(true, -5, 5000, null), CancellationToken.None);
        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.ReportAsync(ProductionId, harness.Link.Id, null!, CancellationToken.None));

        Assert.Null(Status.LatencyMs);
        Assert.Null(Status.Fps);
    }

    [Fact]
    public async Task IssueToken_IdentityNamesSlugAndLink()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        var access = await harness.Outputs.AuthorizeAsync("webinar", KeyOf(teams), null, CancellationToken.None);

        var token = harness.Outputs.IssueToken(access);

        Assert.StartsWith($"output_webinar_{teams.Id}_", token.Identity, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Subscribe_Delta_HidesPrivateEventsAsRevisionOnly()
    {
        var snapshot = await harness.Outputs.SubscribeAsync(ProductionId, "o1", null, CancellationToken.None);
        await harness.PairPhoneAsync();
        await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Productions.SetPreviewAsync(ProductionId, new SetPreviewRequest(harness.Production.OrderedScenes[1].Id), CancellationToken.None);

        var delta = await harness.Outputs.SubscribeAsync(ProductionId, "o1", snapshot.Revision, CancellationToken.None);

        Assert.NotNull(snapshot.Snapshot);
        Assert.Null(delta.Snapshot);
        Assert.Equal(delta.Revision - snapshot.Revision, delta.Events!.Count);
        Assert.Contains(delta.Events, e => e is RevisionOnlyEvent);
        Assert.Contains(delta.Events, e => e is ProgramSwitchedEvent);
        Assert.Contains(delta.Events, e => e is SourceUpsertedEvent s && s.Source.Status == SourceStatus.Ok);
        Assert.DoesNotContain(delta.Events, e => e is DeviceUpsertedEvent or InviteUpsertedEvent or LogAppendedEvent or OutputStatusChangedEvent);
        Assert.Contains("output:o1:" + ProductionId, harness.Publisher.Joined);
    }

    [Fact]
    public async Task Tick_StaleOutput_IsPublished()
    {
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "o1", "10.0.0.5", CancellationToken.None);
        await harness.Outputs.ReportAsync(ProductionId, harness.Link.Id, new OutputReport(true, 100, 50, null), CancellationToken.None);
        Assert.Equal(OutputState.Connected, Status.State);

        harness.Clock.Advance(TimeSpan.FromSeconds(7));
        await harness.Outputs.TickAsync(CancellationToken.None);

        Assert.Equal(OutputState.Stale, Status.State);
        Assert.Equal(OutputState.Stale, Status.Links.Single().State);
    }

    [Fact]
    public async Task UpdateAccess_ConnectedPageNoLongerAllowed_IsAbortedButOtherLinksStay()
    {
        var teams = await harness.Outputs.CreateLinkAsync(ProductionId, new CreateOutputLinkRequest("Teams camera"), CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "o1", "10.0.0.5", CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, harness.Link.Id, "o2", "192.168.1.9", CancellationToken.None);
        await harness.Outputs.ConnectedAsync(ProductionId, teams.Id, "o3", "192.168.1.9", CancellationToken.None);

        var updated = await harness.Outputs.UpdateAccessAsync(ProductionId, harness.Link.Id, new UpdateOutputAccessRequest(["10.0.0.0/8"]), CancellationToken.None);

        Assert.Equal(["o2"], harness.Publisher.Aborted);
        Assert.Equal(["10.0.0.0/8"], updated.AllowedIps);
        Assert.Empty(harness.Data.OutputLinks.Single(l => l.Id == teams.Id).AllowedIps);
        Assert.Contains(harness.Data.Audit, a => a.Action == AuditActions.OutputAccessChanged && a.Detail(AuditDetails.Name) == "Proxy" && a.Detail(AuditDetails.Count) == "1");
    }

    [Fact]
    public async Task UpdateAccess_InvalidRule_IsRejectedAndKeepsTheOldRules()
    {
        await harness.Outputs.UpdateAccessAsync(ProductionId, harness.Link.Id, new UpdateOutputAccessRequest(["10.0.0.0/8"]), CancellationToken.None);

        await Assert.ThrowsAsync<StudioFlowException>(() => harness.Outputs.UpdateAccessAsync(ProductionId, harness.Link.Id, new UpdateOutputAccessRequest(["nope"]), CancellationToken.None));

        Assert.Equal(["10.0.0.0/8"], harness.Link.AllowedIps);
    }

    [Fact]
    public async Task ProductionService_CreatedProduction_StartsWithOneProxyLink()
    {
        var created = await harness.Productions.CreateAsync(new CreateProductionRequest("Second show"), CancellationToken.None);

        var links = (await harness.Outputs.GetSettingsAsync(created.Id, CancellationToken.None)).Links;

        Assert.Equal(OutputLink.DefaultName, Assert.Single(links).Name);
        Assert.NotEqual(harness.Link.Key, KeyOf(links[0]));
    }

    private static string KeyOf(OutputLinkDto link) => link.Url[(link.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];

    public void Dispose() => harness.Dispose();
}
