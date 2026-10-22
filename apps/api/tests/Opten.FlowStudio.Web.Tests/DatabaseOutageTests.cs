using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Npgsql;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Tests.Support;

namespace Opten.FlowStudio.Web.Tests;

/// <summary>GAP-32: PostgreSQL down → 503 <c>service_unavailable</c>, hubs stay up, readiness recovers without a restart.</summary>
public sealed class DatabaseOutageTests(OutageApp app) : IClassFixture<OutageApp>
{
    [Fact]
    public async Task Requests_DatabaseDown_Are503AndEverythingRecoversWhenItIsBack()
    {
        var admin = await app.AdminAsync();
        await using var hub = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        var client = app.Anonymous();

        app.Proxy.Down();
        try
        {
            await client.GetAsync("/health/live", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
            await client.GetAsync("/health/ready", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.ServiceUnavailable);
            using var read = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken);
            var write = await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}", new UpdateProductionRequest("Während", null, null)).ExpectProblemAsync(HttpStatusCode.ServiceUnavailable);
            var hubError = await Assert.ThrowsAsync<HubException>(() => hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken));
            var body = await read.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);

            await read.ExpectAsync(HttpStatusCode.ServiceUnavailable);
            Assert.Equal(ErrorCodes.ServiceUnavailable, write);
            Assert.NotNull(read.Headers.RetryAfter);
            Assert.Contains("\"code\":\"service_unavailable\"", body, StringComparison.Ordinal);
            Assert.DoesNotContain("Host=", body, StringComparison.OrdinalIgnoreCase);
            Assert.Contains($"{ErrorCodes.ServiceUnavailable}:", hubError.Message, StringComparison.Ordinal);
            Assert.Equal(HubConnectionState.Connected, hub.State);
        }
        finally
        {
            app.Proxy.Up();
        }

        await WaitUntilReadyAsync(client);
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}", new UpdateProductionRequest("Danach", null, null)).ExpectAsync(HttpStatusCode.OK);
        var changes = await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        Assert.Equal("Danach", changes.Snapshot!.Production.Name);
    }

    private static async Task WaitUntilReadyAsync(HttpClient client)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(30);
        while (true)
        {
            using var response = await client.GetAsync("/health/ready", TestContext.Current.CancellationToken);
            if (response.StatusCode == HttpStatusCode.OK)
            {
                return;
            }

            Assert.True(DateTime.UtcNow < deadline, "readiness did not recover within 30 s");
            await Task.Delay(250, TestContext.Current.CancellationToken);
        }
    }
}

/// <summary>The app with its database behind a switchable TCP proxy.</summary>
public sealed class OutageApp(PostgresFixture postgres) : FlowStudioApp(postgres)
{
    private TcpProxy? proxy;

    public TcpProxy Proxy => proxy ?? throw new InvalidOperationException("The app is not started.");

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (proxy is not null)
        {
            await proxy.DisposeAsync();
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        var direct = new NpgsqlConnectionStringBuilder(ConnectionString);
        proxy ??= new TcpProxy(direct.Host!, direct.Port);
        builder.UseSetting("ConnectionStrings:FlowStudio", new NpgsqlConnectionStringBuilder(ConnectionString) { Host = "127.0.0.1", Port = proxy.Port, Timeout = 3 }.ConnectionString);
    }
}
