using System.Net;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Errors;
using Opten.FlowStudio.Web.Tests.Support;

namespace Opten.FlowStudio.Web.Tests;

public sealed class ConcurrencyTests(FlowStudioApp app) : IClassFixture<FlowStudioApp>
{
    [Fact]
    public async Task Approve_SameKnockInParallel_ExactlyOneDeviceIsCreated()
    {
        var admin = await app.AdminAsync();
        var knock = await app.Anonymous().PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("Parallel", DeviceKind.Laptop, "x")).ExpectAsync<PairingRequestCreatedDto>(HttpStatusCode.Created);

        var statuses = await Task.WhenAll(Enumerable.Range(0, 10).Select(async _ =>
        {
            using var response = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/requests/{knock.RequestId}/approve", null, TestContext.Current.CancellationToken);
            return response.StatusCode;
        }));
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Single(statuses, s => s == HttpStatusCode.OK);
        Assert.All(statuses.Where(s => s != HttpStatusCode.OK), s => Assert.Equal(HttpStatusCode.Gone, s));
        Assert.Single(snapshot.Devices, d => d.Name == "Parallel");
    }

    [Fact]
    public async Task Redeem_SameInviteByManyClientsInParallel_OnlyOneWins()
    {
        var admin = await app.AdminAsync();
        var invite = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/pairing/invites", new CreateInviteRequest(InviteKind.LaptopLink)).ExpectAsync<InviteDto>(HttpStatusCode.Created);

        var statuses = await Task.WhenAll(Enumerable.Range(0, 10).Select(async i =>
        {
            using var response = await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(invite)}/redeem", new RedeemInviteRequest($"client-{i}", $"Laptop {i}", DeviceKind.Laptop, "x"));
            return response.StatusCode;
        }));

        Assert.Single(statuses, s => s == HttpStatusCode.OK);
        Assert.Equal(9, statuses.Count(s => s == HttpStatusCode.Gone));
    }

    [Fact]
    public async Task Redeem_SameClientRetriesInParallel_AllGetTheSameDevice()
    {
        var admin = await app.AdminAsync();
        var invite = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite", TestContext.Current.CancellationToken).ExpectAsync<InviteDto>();
        var request = new RedeemInviteRequest("same-client", null, DeviceKind.Phone, "x");

        var credentials = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ =>
            app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(invite)}/redeem", request).ExpectAsync<DeviceCredentialsDto>()));

        Assert.Single(credentials.Select(c => c.DeviceId).Distinct());
        Assert.Equal(5, credentials.Select(c => c.DeviceSecret).Distinct().Count());
    }

    [Fact]
    public async Task ProgramSwitches_InParallel_KeepAConsistentState()
    {
        var admin = await app.AdminAsync();
        var scenes = (await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes;

        var statuses = await Task.WhenAll(Enumerable.Range(0, 30).Select(async i =>
        {
            using var response = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/program", new SwitchProgramRequest(scenes[i % 3].Id, new TransitionDto(TransitionKind.Fade, 2000)));
            return response.StatusCode;
        }));
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.All(statuses, s => Assert.Contains(s, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        Assert.Contains(HttpStatusCode.OK, statuses);
        Assert.Contains(snapshot.Scenes, s => s.Id == snapshot.Production.ProgramSceneId);
    }

    [Fact]
    public async Task ManyScenesCreatedInParallel_GetDistinctSortOrders()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Parallel Szenen")).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var created = await Task.WhenAll(Enumerable.Range(0, 20).Select(i =>
            admin.Client.PostJsonAsync($"/api/productions/{production.Id}/scenes", new CreateSceneRequest($"P{i}", null)).ExpectAsync<SceneDto>(HttpStatusCode.Created)));

        Assert.Equal(20, created.Select(s => s.SortOrder).Distinct().Count());
        Assert.Equal(Enumerable.Range(3, 20), created.Select(s => s.SortOrder).Order());
    }

    [Theory]
    [InlineData(408, "request_timeout")]
    [InlineData(413, "unsupported_media")]
    [InlineData(500, "internal_error")]
    [InlineData(418, "internal_error")]
    public void CodeFor_Status_HasStableCode(int status, string code) => Assert.Equal(code, Problems.CodeFor(status));
}
