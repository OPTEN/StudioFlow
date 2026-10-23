using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Npgsql;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Hosting;
using Opten.StudioFlow.Web.Hubs;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// Graceful shutdown with connected hubs (OBS-01: fast, BUG-20: no invented outage) and the telemetry throttle of the
/// Regie hub (BUG-19, spec 6).
/// </summary>
public sealed class ShutdownAndTelemetryTests(PostgresFixture postgres)
{
    private static readonly DeviceReportDto LiveCamera =
        new(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2500, 0, "h264")], 80, false, "wifi", 20, null);

    [Fact]
    public async Task StopApplication_WithConnectedHubs_ClosesThemAtOnceAndWritesNoOutage()
    {
        var cancellation = TestContext.Current.CancellationToken;
        string database;
        string productionId;
        string sourceId;
        await using (var app = new StudioFlowApp(postgres))
        {
            await app.InitializeAsync();
            database = app.ConnectionString;
            var admin = await app.AdminAsync();
            productionId = admin.ProductionId;
            var credentials = await app.PairPhoneAsync(admin);
            sourceId = $"{credentials.DeviceId}/camera";
            var snapshot = await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot", cancellation).ExpectAsync<ProductionSnapshot>();
            await admin.Client.PostJsonAsync($"/api/productions/{productionId}/scenes/{snapshot.Production.ProgramSceneId}/items", new AddSceneItemRequest(sourceId, null, null, null, null, null, null)).ExpectAsync(HttpStatusCode.OK);
            var settings = await admin.Client.GetAsync($"/api/productions/{productionId}/output", cancellation).ExpectAsync<OutputSettingsDto>();
            var key = settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];

            await using var device = WebSocketHub(app, HubMethods.DeviceHubPath, $"{credentials.DeviceId}.{credentials.DeviceSecret}");
            await using var studio = KeepAlive(app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie));
            await using var output = WebSocketHub(app, HubMethods.OutputHubPath, key);
            var closed = new[] { device, studio, output }.Select(ClosedAsync).ToArray();
            await device.StartAsync(cancellation);
            await device.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-1", "x", "1"), cancellation);
            await device.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
            await studio.StartAsync(cancellation);
            await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, productionId, null, cancellation);
            await output.StartAsync(cancellation);
            await output.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, cancellation);
            var live = await admin.Client.GetAsync($"/api/productions/{productionId}/snapshot", cancellation).ExpectAsync<ProductionSnapshot>();
            Assert.Equal(SourceStatus.Ok, live.Sources.Single(s => s.Id == sourceId).Status);
            var worker = app.Services.GetServices<IHostedService>().OfType<MaintenanceWorker>().Single();
            var registry = app.Service<HubConnectionRegistry>();
            var shutdownTimeout = app.Service<IOptions<HostOptions>>().Value.ShutdownTimeout;
            var lifetime = app.Service<IHostApplicationLifetime>();
            var stopped = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            lifetime.ApplicationStopped.Register(() => stopped.TrySetResult());

            var watch = Stopwatch.StartNew();
            lifetime.StopApplication();
            await Task.WhenAll(closed).WaitAsync(TimeSpan.FromSeconds(5), cancellation);
            var hubsClosedAfter = watch.Elapsed;
            await stopped.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellation);
            var stoppedAfter = watch.Elapsed;

            Assert.True(hubsClosedAfter < TimeSpan.FromSeconds(2), $"hubs closed after {hubsClosedAfter.TotalMilliseconds:F0} ms");
            Assert.True(stoppedAfter < TimeSpan.FromSeconds(4), $"host stopped after {stoppedAfter.TotalMilliseconds:F0} ms");
            Assert.True(worker.ExecuteTask!.IsCompleted, "the maintenance loops still run after the stop");
            Assert.Equal(0, registry.Count);
            Assert.Equal(StudioFlowHost.ShutdownTimeout, shutdownTimeout);
            Assert.Equal(TimeSpan.FromSeconds(5), shutdownTimeout);
            await using var connection = new NpgsqlConnection(database);
            await connection.OpenAsync(cancellation);
            await using var command = new NpgsqlCommand("SELECT count(*) FROM audit_entries WHERE action LIKE 'source.%'", connection);
            Assert.Equal(0L, await command.ExecuteScalarAsync(cancellation));
        }

        await using var second = new SameDatabaseApp(postgres, database);
        await second.InitializeAsync();
        var again = await second.AdminAsync();
        var restarted = await again.Client.GetAsync($"/api/productions/{productionId}/snapshot", cancellation).ExpectAsync<ProductionSnapshot>();

        Assert.DoesNotContain(restarted.RecentLog, l => l.Text.Contains("reconnecting", StringComparison.Ordinal));
        Assert.Empty(restarted.Incidents);
        Assert.Equal(SourceStatus.Offline, restarted.Sources.Single(s => s.Id == sourceId).Status);
    }

    [Fact]
    public async Task Report_TenPerSecond_ReachesTheRegieAtMostOncePerTwoSecondsWithTheLatestValues()
    {
        var cancellation = TestContext.Current.CancellationToken;
        await using var app = new StudioFlowApp(postgres);
        await app.InitializeAsync();
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await using var studio = WebSocketHub(app, HubMethods.StudioHubPath, null, admin.Cookie);
        var arrivals = new List<(TimeSpan At, DeviceTelemetryMessage Message)>();
        var clock = Stopwatch.StartNew();
        studio.On<DeviceTelemetryMessage>(HubMethods.Telemetry, message =>
        {
            lock (arrivals)
            {
                arrivals.Add((clock.Elapsed, message));
            }
        });
        await studio.StartAsync(cancellation);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, cancellation);
        await using var device = WebSocketHub(app, HubMethods.DeviceHubPath, $"{credentials.DeviceId}.{credentials.DeviceSecret}");
        await device.StartAsync(cancellation);
        await device.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("tab-1", "x", "1"), cancellation);

        var sent = Stopwatch.StartNew();
        var battery = 100;
        while (sent.Elapsed < TimeSpan.FromSeconds(5))
        {
            battery--;
            await device.InvokeAsync(HubMethods.Report, LiveCamera with { BatteryPct = battery }, cancellation);
            await Task.Delay(100, cancellation);
        }

        await Task.Delay(TimeSpan.FromSeconds(3), cancellation);
        List<(TimeSpan At, DeviceTelemetryMessage Message)> received;
        lock (arrivals)
        {
            received = [.. arrivals.Where(a => a.Message.DeviceId == credentials.DeviceId)];
        }

        Assert.InRange(received.Count, 2, 4);
        Assert.All(received.Zip(received.Skip(1)), pair => Assert.True(pair.Second.At - pair.First.At >= TimeSpan.FromSeconds(1.7), $"{(pair.Second.At - pair.First.At).TotalMilliseconds:F0} ms apart"));
        Assert.Equal(battery, received[^1].Message.Telemetry.BatteryPct);
        Assert.Equal(HubConnectionState.Connected, studio.State);
    }

    private static Task ClosedAsync(HubConnection connection)
    {
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.Closed += _ =>
        {
            closed.TrySetResult();
            return Task.CompletedTask;
        };
        return closed.Task;
    }

    /// <summary>
    /// A hub over WebSockets like the browsers use (the token goes in the query, the cookie in the upgrade request), with
    /// the client keep-alive of the apps: the server closes a connection that stays silent for 5 s.
    /// </summary>
    private static HubConnection WebSocketHub(StudioFlowApp app, string path, string? token, string? cookie = null) => KeepAlive(app.Hub(path, o =>
    {
        o.Transports = HttpTransportType.WebSockets;
        o.SkipNegotiation = true;
        o.WebSocketFactory = async (context, cancellationToken) =>
        {
            var query = context.Uri.Query.TrimStart('?');
            var uri = token is null ? context.Uri : new UriBuilder(context.Uri) { Query = $"{query}&access_token={Uri.EscapeDataString(token)}" }.Uri;
            var client = app.Server.CreateWebSocketClient();
            if (cookie is not null)
            {
                client.ConfigureRequest = request => request.Headers.Cookie = cookie;
            }

            return await client.ConnectAsync(uri, cancellationToken);
        };
    }));

    private static HubConnection KeepAlive(HubConnection connection)
    {
        connection.KeepAliveInterval = TimeSpan.FromSeconds(2);
        return connection;
    }

    /// <summary>The app on the database of an earlier app (a restart).</summary>
    private sealed class SameDatabaseApp(PostgresFixture postgres, string database) : StudioFlowApp(postgres)
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("ConnectionStrings:StudioFlow", database);
        }
    }
}
