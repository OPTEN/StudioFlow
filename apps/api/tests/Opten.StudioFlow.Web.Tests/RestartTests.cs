using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.SignalR.Client;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>An API restart on the same database (GAP-08 / spec 12, GAP-20, GAP-33).</summary>
public sealed class RestartTests(PostgresFixture postgres)
{
    [Fact]
    public async Task Restart_LiveSourceOnAirWhoseDeviceIsGone_IsFlaggedAndLiveSinceAndRevisionsContinue()
    {
        string connectionString;
        string productionId;
        string sourceId;
        ProductionDto live;
        long revisionBefore;
        await using (var first = new RestartedApp(postgres))
        {
            await first.InitializeAsync();
            connectionString = first.ConnectionString;
            var admin = await first.AdminAsync();
            productionId = admin.ProductionId;
            var credentials = await first.PairPhoneAsync(admin);
            sourceId = $"{credentials.DeviceId}/camera";
            var snapshot = await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
            await admin.Client.PostJsonAsync($"/api/productions/{productionId}/scenes/{snapshot.Production.ProgramSceneId}/items", new AddSceneItemRequest(sourceId, null, null, null, null, null, null)).ExpectAsync(HttpStatusCode.OK);
            live = await admin.Client.PostAsync($"/api/productions/{productionId}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync<ProductionDto>();

            await using var device = first.Hub(HubMethods.DeviceHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>($"{credentials.DeviceId}.{credentials.DeviceSecret}"));
            await device.StartAsync(TestContext.Current.CancellationToken);
            await device.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab", "x", "1"), TestContext.Current.CancellationToken);
            await device.InvokeAsync(HubMethods.Report, new DeviceReportDto(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2000, 0, "h264")], null, null, null, null, null), TestContext.Current.CancellationToken);
            var ok = await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
            Assert.Equal(SourceStatus.Ok, ok.Sources.Single(s => s.Id == sourceId).Status);
            revisionBefore = ok.Revision;
        }

        await using var second = new RestartedApp(postgres, connectionString);
        await second.InitializeAsync();
        var again = await second.AdminAsync();
        await using var studio = second.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = again.Cookie);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        var resubscribed = await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, productionId, revisionBefore, TestContext.Current.CancellationToken);
        var flagged = await WaitForAsync(again, productionId, s => s.Sources.Single(x => x.Id == sourceId).Status == SourceStatus.Reconnecting);

        Assert.NotNull(resubscribed.Snapshot);
        Assert.True(resubscribed.Revision > revisionBefore);
        Assert.Equal(live.LiveSince, flagged.Production.LiveSince);
        Assert.Equal(BroadcastState.Live, flagged.Production.Broadcast);
        var incident = Assert.Single(flagged.Incidents);
        Assert.Equal((sourceId, IncidentKind.Reconnecting, (DateTimeOffset?)null), (incident.SourceId, incident.Kind, incident.EndedAt));
        Assert.Contains(flagged.RecentLog, l => l.Text == "K1 reconnecting");
    }

    private static async Task<ProductionSnapshot> WaitForAsync(AdminSession admin, string productionId, Func<ProductionSnapshot, bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        while (true)
        {
            var snapshot = await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
            if (condition(snapshot))
            {
                return snapshot;
            }

            Assert.True(DateTime.UtcNow < deadline, "the restart watch did not flag the source within 15 s");
            await Task.Delay(200, TestContext.Current.CancellationToken);
        }
    }

    /// <summary>The app with a 1 s restart grace, optionally on the database of an earlier app.</summary>
    private sealed class RestartedApp(PostgresFixture postgres, string? database = null) : StudioFlowApp(postgres)
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Sources:RestartGrace", "00:00:01");
            if (database is not null)
            {
                builder.UseSetting("ConnectionStrings:StudioFlow", database);
            }
        }
    }
}
