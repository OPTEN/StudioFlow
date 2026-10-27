using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class OutputLinkApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Create_NamedLink_HasItsOwnKeyAndShowsInTheLog()
    {
        var (admin, slug) = await ProductionAsync();

        var link = await CreateAsync(admin, "Teams camera");
        var links = await admin.GetOutputLinksAsync();
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(["Proxy", "Teams camera"], links.Select(l => l.Name));
        Assert.NotEqual(links[0].Key(), link.Key());
        Assert.Equal($"https://sf.test/o/{slug}?k={link.Key()}", link.Url);
        Assert.Empty(link.AllowedIps);
        Assert.Null(link.LastSeenAt);
        await OutputClient(link.Key()).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        Assert.Contains(snapshot.RecentLog, l => l.Code == LogCode.OutputLinkCreated && l.Params["name"] == "Teams camera");
        Assert.Equal(["Proxy", "Teams camera"], snapshot.OutputStatus.Links.Select(l => l.Name));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("0123456789012345678901234567890123456789X")]
    public async Task Create_InvalidName_IsBadRequest(string name)
    {
        var (admin, _) = await ProductionAsync();

        var code = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/output/links", new CreateOutputLinkRequest(name)).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal(ErrorCodes.ValidationFailed, code);
    }

    [Fact]
    public async Task Create_NameUsedIgnoringCase_IsBadRequestOnTheNameField()
    {
        var (admin, _) = await ProductionAsync();

        using var response = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/output/links", new CreateOutputLinkRequest("PROXY"));

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("name", out _));
    }

    [Fact]
    public async Task Create_MoreThanTheLimit_IsConflictLimitReachedAndRevokingMakesRoom()
    {
        var (admin, _) = await ProductionAsync();
        for (var i = 2; i <= 10; i++)
        {
            await CreateAsync(admin, $"Link {i}");
        }

        var code = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/output/links", new CreateOutputLinkRequest("One too many")).ExpectProblemAsync(HttpStatusCode.Conflict);
        var links = await admin.GetOutputLinksAsync();
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/output/links/{links[3].Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await CreateAsync(admin, "One too many");

        Assert.Equal(ErrorCodes.LimitReached, code);
        Assert.Equal(10, links.Count);
        Assert.Equal(10, (await admin.GetOutputLinksAsync()).Count);
    }

    [Fact]
    public async Task Settings_Always_ReportTheLimit()
    {
        var (admin, _) = await ProductionAsync();

        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();

        Assert.Equal(10, settings.MaxLinks);
    }

    [Fact]
    public async Task Rename_KeepsTheKeyAndRejectsTakenNames()
    {
        var (admin, slug) = await ProductionAsync();
        var link = await CreateAsync(admin, "Teams");

        var renamed = await admin.Client.PatchJsonAsync(LinkUrl(admin, link.Id), new RenameOutputLinkRequest("Teams camera")).ExpectAsync<OutputLinkDto>();
        var taken = await admin.Client.PatchJsonAsync(LinkUrl(admin, link.Id), new RenameOutputLinkRequest("proxy")).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal("Teams camera", renamed.Name);
        Assert.Equal(link.Url, renamed.Url);
        Assert.Equal(ErrorCodes.ValidationFailed, taken);
        await OutputClient(link.Key()).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UnknownLink_OnEveryRoute_IsNotFound()
    {
        var (admin, _) = await ProductionAsync();
        var url = LinkUrl(admin, "olk_doesnotexist");

        await admin.Client.PatchJsonAsync(url, new RenameOutputLinkRequest("X")).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.PutJsonAsync(url + "/access", new UpdateOutputAccessRequest([])).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.PostAsync(url + "/regenerate-key", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.DeleteAsync(url, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task LinkOfAnotherProduction_CannotBeChangedThroughThisOne()
    {
        var (admin, _) = await ProductionAsync();
        var (other, otherSlug) = await ProductionAsync();
        var foreign = (await other.GetOutputLinksAsync())[0];
        var url = LinkUrl(admin, foreign.Id);

        await admin.Client.PatchJsonAsync(url, new RenameOutputLinkRequest("Hijacked")).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.PostAsync(url + "/regenerate-key", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);
        await admin.Client.DeleteAsync(url, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound);

        Assert.Equal("Proxy", (await other.GetOutputLinksAsync())[0].Name);
        await OutputClient(foreign.Key()).GetAsync($"/api/output/{otherSlug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task KeyOfOneProduction_DoesNotOpenAnother()
    {
        var (_, slug) = await ProductionAsync();
        var (other, _) = await ProductionAsync();
        var foreignKey = (await other.GetOutputLinksAsync())[0].Key();

        var code = await OutputClient(foreignKey).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);

        Assert.Equal(ErrorCodes.Forbidden, code);
    }

    [Fact]
    public async Task Revoke_KeyIsRejectedAtOnceEverywhereAndTheOtherLinkKeepsWorking()
    {
        var (admin, slug) = await ProductionAsync();
        var proxy = (await admin.GetOutputLinksAsync())[0];
        var teams = await CreateAsync(admin, "Teams camera");
        var asset = await UploadImageAsync(admin);
        await OutputClient(teams.Key()).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await app.Anonymous().GetAsync($"{asset.ContentUrl}?k={teams.Key()}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        await admin.Client.DeleteAsync(LinkUrl(admin, teams.Id), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        foreach (var path in new[] { "snapshot", "changes?since=0" })
        {
            await OutputClient(teams.Key()).GetAsync($"/api/output/{slug}/{path}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        }

        await OutputClient(teams.Key()).PostAsync($"/api/output/{slug}/livekit-token", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await OutputClient(teams.Key()).PostJsonAsync($"/api/output/{slug}/report", new OutputReport(true, 1, 1, null)).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await app.Anonymous().GetAsync($"{asset.ContentUrl}?k={teams.Key()}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await OutputClient(proxy.Key()).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await app.Anonymous().GetAsync($"{asset.ContentUrl}?k={proxy.Key()}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        Assert.Equal(["Proxy"], (await admin.GetOutputLinksAsync()).Select(l => l.Name));
    }

    [Fact]
    public async Task Revoke_IsInTheLogAndTheStatus()
    {
        var (admin, _) = await ProductionAsync();
        var teams = await CreateAsync(admin, "Teams camera");

        await admin.Client.DeleteAsync(LinkUrl(admin, teams.Id), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Contains(snapshot.RecentLog, l => l.Code == LogCode.OutputLinkRevoked && l.Text == "Output link “Teams camera” revoked");
        Assert.Equal(["Proxy"], snapshot.OutputStatus.Links.Select(l => l.Name));
    }

    [Fact]
    public async Task Regenerate_OnlyThisLinkGetsANewKey_AndOnlyItsPagesAreKicked()
    {
        var (admin, slug) = await ProductionAsync();
        var proxy = (await admin.GetOutputLinksAsync())[0];
        var teams = await CreateAsync(admin, "Teams camera");
        app.Rooms.Available = true;
        app.Rooms.Participants[admin.ProductionId] = [new("PA_1", $"output_{slug}_{proxy.Id}_abc", []), new("PA_2", $"output_{slug}_{teams.Id}_abc", [])];
        try
        {
            var renewed = await admin.Client.PostAsync(LinkUrl(admin, teams.Id) + "/regenerate-key", null, TestContext.Current.CancellationToken).ExpectAsync<OutputLinkDto>();

            Assert.NotEqual(teams.Key(), renewed.Key());
            await OutputClient(teams.Key()).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
            await OutputClient(renewed.Key()).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
            await OutputClient(proxy.Key()).GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
            Assert.Contains(app.Rooms.Removed, r => r.Identity == $"output_{slug}_{teams.Id}_abc");
            Assert.DoesNotContain(app.Rooms.Removed, r => r.Identity == $"output_{slug}_{proxy.Id}_abc");
        }
        finally
        {
            app.Rooms.Available = false;
        }
    }

    [Fact]
    public async Task Access_IsPerLink_AndTheOtherLinkStaysOpen()
    {
        var (admin, slug) = await ProductionAsync();
        var proxy = (await admin.GetOutputLinksAsync())[0];
        var teams = await CreateAsync(admin, "Teams camera");

        var restricted = await admin.Client.PutJsonAsync(LinkUrl(admin, teams.Id) + "/access", new UpdateOutputAccessRequest(["192.168.50.0/24"])).ExpectAsync<OutputLinkDto>();

        Assert.Equal(["192.168.50.0/24"], restricted.AllowedIps);
        Assert.Empty((await admin.GetOutputLinksAsync())[0].AllowedIps);
        await OutputClient(teams.Key(), "192.168.50.9").GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await OutputClient(teams.Key(), "192.168.51.9").GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await OutputClient(proxy.Key(), "192.168.51.9").GetAsync($"/api/output/{slug}/snapshot", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Access_AssetsOfARestrictedLink_FollowTheSameRule()
    {
        var (admin, _) = await ProductionAsync();
        var teams = await CreateAsync(admin, "Teams camera");
        var asset = await UploadImageAsync(admin);
        await admin.Client.PutJsonAsync(LinkUrl(admin, teams.Id) + "/access", new UpdateOutputAccessRequest(["192.168.50.0/24"])).ExpectAsync<OutputLinkDto>();

        await app.Anonymous("192.168.50.9").GetAsync($"{asset.ContentUrl}?k={teams.Key()}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await app.Anonymous("192.168.51.9").GetAsync($"{asset.ContentUrl}?k={teams.Key()}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Token_OfALink_NamesTheLinkInTheIdentity()
    {
        var (admin, slug) = await ProductionAsync();
        var teams = await CreateAsync(admin, "Teams camera");

        var token = await OutputClient(teams.Key()).PostAsync($"/api/output/{slug}/livekit-token", null, TestContext.Current.CancellationToken).ExpectAsync<LiveKitTokenDto>();

        Assert.StartsWith($"output_{slug}_{teams.Id}_", token.Identity, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Mutations_WithoutCsrfHeader_AreForbidden()
    {
        var (admin, _) = await ProductionAsync();
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        await client.PostJsonAsync($"/api/productions/{admin.ProductionId}/output/links", new CreateOutputLinkRequest("No CSRF")).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await client.DeleteAsync(LinkUrl(admin, (await admin.GetOutputLinksAsync())[0].Id), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);

        Assert.Single(await admin.GetOutputLinksAsync());
    }

    [Fact]
    public async Task Links_WithoutSession_CannotBeListedOrRead()
    {
        var (admin, _) = await ProductionAsync();

        await app.Anonymous().GetAsync($"/api/productions/{admin.ProductionId}/output", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Report_Rest_IsTrackedPerLink()
    {
        var (admin, slug) = await ProductionAsync();
        var teams = await CreateAsync(admin, "Teams camera");

        await OutputClient(teams.Key()).PostJsonAsync($"/api/output/{slug}/report", new OutputReport(true, 140, 50, null)).ExpectAsync(HttpStatusCode.NoContent);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Null(snapshot.OutputStatus.Links.Single(l => l.Name == "Proxy").LatencyMs);
        Assert.Equal(140, snapshot.OutputStatus.Links.Single(l => l.Name == "Teams camera").LatencyMs);
    }

    [Fact]
    public async Task Report_Rest_CarriesDroppedFramesAndSoftwareDecoding()
    {
        var (admin, slug) = await ProductionAsync();
        var teams = await CreateAsync(admin, "Teams camera");

        await OutputClient(teams.Key()).PostJsonAsync($"/api/output/{slug}/report", new OutputReport(true, 140, 50, null, 12.5, 3, 2)).ExpectAsync(HttpStatusCode.NoContent);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        var link = snapshot.OutputStatus.Links.Single(l => l.Name == "Teams camera");
        Assert.Equal(12.5, link.DroppedFramesPct);
        Assert.Equal(3, link.DecodedStreams);
        Assert.Equal(2, link.SoftwareDecodedStreams);
        Assert.Equal(12.5, snapshot.OutputStatus.DroppedFramesPct);
        Assert.Null(snapshot.OutputStatus.Links.Single(l => l.Name == "Proxy").DroppedFramesPct);
    }

    [Fact]
    public async Task Report_Rest_IgnoresImplausibleStreamNumbers()
    {
        var (admin, slug) = await ProductionAsync();
        var teams = await CreateAsync(admin, "Teams camera");

        await OutputClient(teams.Key()).PostJsonAsync($"/api/output/{slug}/report", new OutputReport(true, 140, 50, null, 250, 5, 9)).ExpectAsync(HttpStatusCode.NoContent);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        var link = snapshot.OutputStatus.Links.Single(l => l.Name == "Teams camera");
        Assert.Null(link.DroppedFramesPct);
        Assert.Equal(5, link.DecodedStreams);
        Assert.Null(link.SoftwareDecodedStreams);
    }

    private HttpClient OutputClient(string key, string? address = null)
    {
        var client = app.Anonymous(address);
        client.DefaultRequestHeaders.Add("X-Output-Key", key);
        return client;
    }

    private static string LinkUrl(AdminSession admin, string linkId) => $"/api/productions/{admin.ProductionId}/output/links/{linkId}";

    private static Task<OutputLinkDto> CreateAsync(AdminSession admin, string name) =>
        admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/output/links", new CreateOutputLinkRequest(name)).ExpectAsync<OutputLinkDto>(HttpStatusCode.Created);

    private async Task<(AdminSession Admin, string Slug)> ProductionAsync()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Links " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        return (admin with { ProductionId = production.Id }, production.Slug);
    }

    private static async Task<AssetDto> UploadImageAsync(AdminSession admin)
    {
        using var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(MediaSamples.Png(64, 32, 2000));
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        content.Add(file, "file", "link.png");
        return await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", content).ExpectAsync<AssetDto>(HttpStatusCode.Created);
    }
}

public sealed class OutputLinkHubTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Revoke_DisconnectsOnlyThePagesOfThatLinkAndItCannotReconnect()
    {
        var (admin, proxy, teams) = await TwoLinksAsync();
        await using var proxyPage = Output(proxy.Key());
        await using var teamsPage = Output(teams.Key());
        var proxyClosed = HubClosed.Watch(proxyPage);
        var teamsClosed = HubClosed.Watch(teamsPage);
        await proxyPage.StartAsync(TestContext.Current.CancellationToken);
        await teamsPage.StartAsync(TestContext.Current.CancellationToken);
        await proxyPage.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);
        await teamsPage.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);

        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/output/links/{teams.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await teamsClosed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);
        await using var retry = Output(teams.Key());

        Assert.False(proxyClosed.IsCompleted);
        Assert.Equal(HubConnectionState.Connected, proxyPage.State);
        await proxyPage.InvokeAsync(HubMethods.Report, new OutputReport(true, 50, 30, null), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await Assert.ThrowsAsync<HttpRequestException>(() => retry.StartAsync(TestContext.Current.CancellationToken))).StatusCode);
    }

    [Fact]
    public async Task Regenerate_DisconnectsOnlyThePagesOfThatLink()
    {
        var (admin, proxy, teams) = await TwoLinksAsync();
        await using var proxyPage = Output(proxy.Key());
        await using var teamsPage = Output(teams.Key());
        var proxyClosed = HubClosed.Watch(proxyPage);
        var teamsClosed = HubClosed.Watch(teamsPage);
        await proxyPage.StartAsync(TestContext.Current.CancellationToken);
        await teamsPage.StartAsync(TestContext.Current.CancellationToken);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/output/links/{proxy.Id}/regenerate-key", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await proxyClosed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);

        Assert.False(teamsClosed.IsCompleted);
        Assert.Equal(HubConnectionState.Connected, teamsPage.State);
    }

    [Fact]
    public async Task Status_ShowsEachLinkOnItsOwnWithItsName()
    {
        var (admin, proxy, teams) = await TwoLinksAsync();
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var events = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        await using var teamsPage = Output(teams.Key(), "10.99.0.7", "192.168.77.5");
        await teamsPage.StartAsync(TestContext.Current.CancellationToken);
        await teamsPage.InvokeAsync(HubMethods.Report, new OutputReport(true, 120, 50, null), TestContext.Current.CancellationToken);
        var status = ((OutputStatusChangedEvent)await events.NextAsync(e => e is OutputStatusChangedEvent s && s.Status.Links.Any(l => l.Name == "Teams camera" && l.State == OutputState.Connected))).Status;
        await teamsPage.StopAsync(TestContext.Current.CancellationToken);
        var gone = ((OutputStatusChangedEvent)await events.NextAsync(e => e is OutputStatusChangedEvent s && s.Status.Consumers == 0)).Status;
        var links = await admin.GetOutputLinksAsync();

        Assert.Equal(OutputState.None, status.Links.Single(l => l.LinkId == proxy.Id).State);
        Assert.Equal(["192.168.77.5"], status.Links.Single(l => l.LinkId == teams.Id).Addresses);
        Assert.Equal(120, status.Links.Single(l => l.LinkId == teams.Id).LatencyMs);
        Assert.Equal(OutputState.None, gone.Links.Single(l => l.LinkId == teams.Id).State);
        Assert.NotNull(links.Single(l => l.Id == teams.Id).LastSeenAt);
        Assert.Null(links.Single(l => l.Id == proxy.Id).LastSeenAt);
    }

    [Fact]
    public async Task Create_AndRevoke_AreSeenByTheRegieAsStatusEvents()
    {
        var admin = await app.AdminAsync();
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var events = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        var name = "Camera " + Guid.NewGuid().ToString("N")[..6];

        var link = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/output/links", new CreateOutputLinkRequest(name)).ExpectAsync<OutputLinkDto>(HttpStatusCode.Created);
        await events.NextAsync(e => e is OutputStatusChangedEvent s && s.Status.Links.Any(l => l.Name == name));
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/output/links/{link.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        await events.NextAsync(e => e is OutputStatusChangedEvent s && s.Status.Links.All(l => l.Name != name));
    }

    [Fact]
    public async Task Hub_IpRestrictionIsPerLink()
    {
        var (admin, proxy, teams) = await TwoLinksAsync();
        await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/output/links/{teams.Id}/access", new UpdateOutputAccessRequest(["192.168.50.0/24"])).ExpectAsync<OutputLinkDto>();

        await using var allowed = Output(teams.Key(), "10.99.0.2", "192.168.50.7");
        await using var denied = Output(teams.Key(), "10.99.0.2", "192.168.51.7");
        await using var other = Output(proxy.Key(), "10.99.0.2", "192.168.51.7");

        await allowed.StartAsync(TestContext.Current.CancellationToken);
        await other.StartAsync(TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await Assert.ThrowsAsync<HttpRequestException>(() => denied.StartAsync(TestContext.Current.CancellationToken))).StatusCode);
    }

    [Fact]
    public async Task UpdateAccess_DisconnectsOnlyPagesOfThatLinkFromDisallowedAddresses()
    {
        var (admin, proxy, teams) = await TwoLinksAsync();
        await using var inside = Output(teams.Key(), "10.99.0.2", "192.168.50.7");
        await using var outside = Output(teams.Key(), "10.99.0.2", "192.168.51.7");
        await using var otherLink = Output(proxy.Key(), "10.99.0.2", "192.168.51.7");
        var outsideClosed = HubClosed.Watch(outside);
        await inside.StartAsync(TestContext.Current.CancellationToken);
        await outside.StartAsync(TestContext.Current.CancellationToken);
        await otherLink.StartAsync(TestContext.Current.CancellationToken);

        await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/output/links/{teams.Id}/access", new UpdateOutputAccessRequest(["192.168.50.0/24"])).ExpectAsync<OutputLinkDto>();
        await outsideClosed.WaitAsync(TimeSpan.FromSeconds(15), TestContext.Current.CancellationToken);

        Assert.Equal(HubConnectionState.Connected, inside.State);
        Assert.Equal(HubConnectionState.Connected, otherLink.State);
    }

    private async Task<(AdminSession Admin, OutputLinkDto Proxy, OutputLinkDto Teams)> TwoLinksAsync()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Hub " + Guid.NewGuid().ToString("N")[..6])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        admin = admin with { ProductionId = production.Id };
        var teams = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/output/links", new CreateOutputLinkRequest("Teams camera")).ExpectAsync<OutputLinkDto>(HttpStatusCode.Created);
        return (admin, (await admin.GetOutputLinksAsync())[0], teams);
    }

    private HubConnection Output(string key, string? proxy = null, string? forwardedFor = null) => app.Hub(HubMethods.OutputHubPath, o =>
    {
        o.AccessTokenProvider = () => Task.FromResult<string?>(key);
        if (proxy is not null)
        {
            o.Headers[TestClientAddress.Header] = proxy;
        }

        if (forwardedFor is not null)
        {
            o.Headers["X-Forwarded-For"] = forwardedFor;
        }
    });
}
