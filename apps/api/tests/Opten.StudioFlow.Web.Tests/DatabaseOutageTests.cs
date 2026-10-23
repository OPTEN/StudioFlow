using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Npgsql;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// GAP-32 / BUG-21: PostgreSQL down or silent → 503 <c>service_unavailable</c> within seconds (also for queued requests),
/// hubs stay up, readiness recovers without a restart.
/// </summary>
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
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}", new UpdateProductionRequest("Afterwards", null, null)).ExpectAsync(HttpStatusCode.OK);
        var changes = await hub.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        Assert.Equal("Afterwards", changes.Snapshot!.Production.Name);
    }

    [Fact]
    public async Task Requests_DatabaseSilent_Are503WithinSecondsWhileReportsKeepComingAndRecoverWithoutRestart()
    {
        var cancellation = TestContext.Current.CancellationToken;
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", cancellation).ExpectAsync<ProductionSnapshot>();
        var sourceId = $"{credentials.DeviceId}/camera";
        // WebSockets like the sender: authenticated once at connect (a long-polling device authenticates every poll).
        var token = $"{credentials.DeviceId}.{credentials.DeviceSecret}";
        await using var device = app.Hub(HubMethods.DeviceHubPath, o =>
        {
            o.Transports = HttpTransportType.WebSockets;
            o.SkipNegotiation = true;
            o.WebSocketFactory = async (context, cancellationToken) =>
            {
                var uri = new UriBuilder(context.Uri) { Query = $"{context.Uri.Query.TrimStart('?')}&access_token={Uri.EscapeDataString(token)}" }.Uri;
                return await app.Server.CreateWebSocketClient().ConnectAsync(uri, cancellationToken);
            };
        });
        await device.StartAsync(cancellation);
        await device.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("outage-tab", "x", "1"), cancellation);
        await device.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
        var client = app.Anonymous();

        app.Proxy.Blackhole();
        var outage = Stopwatch.StartNew();
        using var reports = new CancellationTokenSource();
        var reporter = ReportEvery100MsAsync(device, reports.Token);
        try
        {
            // Sent at once and together with ten reports per second that need the same production lock.
            var first = await Task.WhenAll(
                TimedAsync(() => admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", cancellation)),
                TimedAsync(() => admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{snapshot.Scenes[0].Id}", new UpdateSceneRequest("Während", null, null))),
                TimedAsync(() => app.Anonymous().PostAsJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword), ContractJson.Options, cancellation)));
            var again = await TimedAsync(() => admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", cancellation));
            var ready = await TimedAsync(() => client.GetAsync("/health/ready", cancellation));
            using var live = await client.GetAsync("/health/live", cancellation);

            foreach (var (status, elapsed, body) in first)
            {
                Assert.Equal(HttpStatusCode.ServiceUnavailable, status);
                Assert.True(elapsed <= TimeSpan.FromSeconds(6), $"503 after {elapsed.TotalMilliseconds:F0} ms");
                Assert.Contains("\"code\":\"service_unavailable\"", body, StringComparison.Ordinal);
                Assert.DoesNotContain("Host=", body, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("Npgsql", body, StringComparison.OrdinalIgnoreCase);
            }

            Assert.Equal(HttpStatusCode.ServiceUnavailable, again.Status);
            Assert.True(again.Elapsed < TimeSpan.FromSeconds(1), $"known outage answered after {again.Elapsed.TotalMilliseconds:F0} ms");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.Status);
            Assert.True(ready.Elapsed < TimeSpan.FromSeconds(1), $"readiness answered after {ready.Elapsed.TotalMilliseconds:F0} ms");
            Assert.Equal(HttpStatusCode.OK, live.StatusCode);
            Assert.True(app.Service<DatabaseCircuit>().IsOpen);

            // Longer than Sources:ReportStaleAfter: the failing reports still prove that the device is alive.
            var remaining = TimeSpan.FromSeconds(8) - outage.Elapsed;
            if (remaining > TimeSpan.Zero)
            {
                await Task.Delay(remaining, cancellation);
            }

            Assert.Equal(HubConnectionState.Connected, device.State);
        }
        finally
        {
            app.Proxy.Up();
        }

        var back = Stopwatch.StartNew();
        await WaitUntilReadyAsync(client);
        Assert.True(back.Elapsed < TimeSpan.FromSeconds(10), $"ready again after {back.Elapsed.TotalMilliseconds:F0} ms");
        await admin.Client.PatchJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{snapshot.Scenes[0].Id}", new UpdateSceneRequest("Afterwards", null, null)).ExpectAsync(HttpStatusCode.OK);
        await Task.Delay(TimeSpan.FromSeconds(1.5), cancellation);
        await reports.CancelAsync();
        await reporter;
        var after = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", cancellation).ExpectAsync<ProductionSnapshot>();

        Assert.Equal(SourceStatus.Ok, after.Sources.Single(s => s.Id == sourceId).Status);
        Assert.DoesNotContain(after.Incidents, i => i.SourceId == sourceId);
        Assert.Equal(HubConnectionState.Connected, device.State);
    }

    private static readonly DeviceReportDto LiveCamera =
        new(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2500, 0, "h264")], 80, false, "wifi", 20, null);

    private static async Task<(HttpStatusCode Status, TimeSpan Elapsed, string Body)> TimedAsync(Func<Task<HttpResponseMessage>> request)
    {
        var watch = Stopwatch.StartNew();
        using var response = await request();
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        return (response.StatusCode, watch.Elapsed, body);
    }

    private static async Task ReportEvery100MsAsync(HubConnection device, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await device.InvokeAsync(HubMethods.Report, LiveCamera, cancellationToken);
            }
            catch (HubException)
            {
                // service_unavailable while the database is away; the connection stays open.
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            try
            {
                await Task.Delay(100, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
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
public sealed class OutageApp(PostgresFixture postgres) : StudioFlowApp(postgres)
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
        builder.UseSetting("ConnectionStrings:StudioFlow", new NpgsqlConnectionStringBuilder(ConnectionString) { Host = "127.0.0.1", Port = proxy.Port }.ConnectionString);
    }
}
