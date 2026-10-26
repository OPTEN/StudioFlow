using System.Net;
using Microsoft.EntityFrameworkCore;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Hosting;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class HostingTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task BroadcastStatus_IdleThenLive_PrintsStateAndExitCode()
    {
        var admin = await app.AdminAsync();
        string[] args = [$"--ConnectionStrings:StudioFlow={app.ConnectionString}"];

        var (idleCode, idle) = await RunAsync(args);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var (liveCode, live) = await RunAsync(args);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/end", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        var (endedCode, _) = await RunAsync(args);

        Assert.Equal((0, "idle"), (idleCode, idle));
        Assert.Equal((CliCommands.LiveExitCode, "live"), (liveCode, live));
        Assert.Equal(0, endedCode);
    }

    [Fact]
    public async Task BroadcastStatus_DatabaseDown_ExitsWithOneWithoutLeakingTheConnectionString()
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var exitCode = await CliCommands.BroadcastStatusAsync(["--ConnectionStrings:StudioFlow=Host=127.0.0.1;Port=1;Password=leak-me;Timeout=1"], output, error);

        Assert.Equal(1, exitCode);
        Assert.DoesNotContain("leak-me", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Model_MatchesTheMigrations()
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);

        Assert.False(db.Database.HasPendingModelChanges());
        Assert.Empty(await db.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Jsonb_SceneItemsAndSlates_RoundTripUnchanged()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var sceneId = (await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes[1].Id;
        var item = new SceneItemDto("itm_roundtrip01", $"{credentials.DeviceId}/camera", -10, 20, 300, 200, ItemFit.Contain, new CropDto(0.1, 0.2, 0.3, 0.05), 40, true, 270, false, true, new BorderDto(3, "#00ff00"), new LostBehaviorDto(null, null));

        await admin.Client.PutJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{sceneId}/items", new ReplaceSceneItemsRequest([item], SceneLayoutMode.Free)).ExpectAsync(HttpStatusCode.OK);
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        var stored = await db.Scenes.AsNoTracking().SingleAsync(s => s.Id == sceneId, TestContext.Current.CancellationToken);
        var json = await db.Database.SqlQueryRaw<string>("SELECT items::text AS \"Value\" FROM scenes WHERE id = {0}", sceneId).SingleAsync(TestContext.Current.CancellationToken);

        Assert.Equal(item, Assert.Single(stored.Items));
        Assert.Contains("\"fit\": \"contain\"", json, StringComparison.Ordinal);
    }

    private static async Task<(int Code, string Output)> RunAsync(string[] args)
    {
        using var output = new StringWriter();
        using var error = new StringWriter();
        var code = await CliCommands.BroadcastStatusAsync(args, output, error);
        return (code, output.ToString().Trim());
    }
}
