using System.Diagnostics;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Hubs;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>Device hub sessions across a reload: the dead connection of the old page and the states it reported.</summary>
public sealed class DeviceSessionTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static readonly DeviceReportDto LiveCamera =
        new(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2500, 0, "h264")], 80, false, "wifi", 20, null);

    [Fact]
    public async Task Hello_AfterReloadWhileTheOldPageStillLooksConnected_IsHarmlessForTheNewSession()
    {
        var cancellation = TestContext.Current.CancellationToken;
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var registry = app.Service<HubConnectionRegistry>();
        var sourceId = $"{credentials.DeviceId}/camera";
        var network = new CuttableHandler(app.Server.CreateHandler());
        await using var oldPage = Device(credentials, network);
        await oldPage.StartAsync(cancellation);
        await oldPage.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("page-1", "Android · Chrome", "1"), cancellation);
        await oldPage.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
        Assert.Equal(SourceStatus.Ok, (await SnapshotAsync(admin)).Sources.Single(s => s.Id == sourceId).Status);
        var oldConnection = oldPage.ConnectionId!;
        var logsBefore = app.Logs.Entries.Count;

        // Reload: the old page is gone without a goodbye; the server only notices after its client timeout.
        network.Cut();
        await using var newPage = Device(credentials);
        var replacedOnNewPage = 0;
        newPage.On(HubMethods.SessionReplaced, () => Interlocked.Increment(ref replacedOnNewPage));
        await newPage.StartAsync(cancellation);
        var oldStillOpen = registry.IsOpen(oldConnection);
        var session = await newPage.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto("page-2", "Android · Chrome", "1"), cancellation);
        var beforeFirstReport = (await SnapshotAsync(admin)).Sources.Single(s => s.Id == sourceId).Status;
        await WaitUntilAsync(() => !registry.IsOpen(oldConnection), TimeSpan.FromSeconds(10));
        await Task.Delay(TimeSpan.FromMilliseconds(300), cancellation);
        await newPage.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
        var snapshot = await SnapshotAsync(admin);

        Assert.True(oldStillOpen, "The server must still consider the old page connected when the new page says Hello.");
        Assert.Equal(credentials.DeviceId, session.Device.Id);
        Assert.Equal(SourceStatus.Reconnecting, beforeFirstReport);
        Assert.Equal(HubConnectionState.Connected, newPage.State);
        Assert.Equal(0, Volatile.Read(ref replacedOnNewPage));
        Assert.Equal(SourceStatus.Ok, snapshot.Sources.Single(s => s.Id == sourceId).Status);
        Assert.Equal(DeviceConnection.Online, snapshot.Devices.Single(d => d.Id == credentials.DeviceId).Connection);
        Assert.DoesNotContain(app.Logs.Entries.Skip(logsBefore), IsFromTheSessionPath);
    }

    /// <summary>Warnings and errors of the hubs, SignalR and the device use cases; unrelated background noise is ignored.</summary>
    private static bool IsFromTheSessionPath(CapturedLog entry) =>
        entry.Exception is not null
        || entry.Level >= LogLevel.Error
        || entry.Category.StartsWith("Microsoft.AspNetCore.SignalR", StringComparison.Ordinal)
        || entry.Category.StartsWith("Microsoft.AspNetCore.Http.Connections", StringComparison.Ordinal)
        || entry.Category.StartsWith("Opten.StudioFlow.Web.Hubs", StringComparison.Ordinal)
        || entry.Category.Contains("DeviceSession", StringComparison.Ordinal);

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = Stopwatch.GetTimestamp() + (long)(timeout.TotalSeconds * Stopwatch.Frequency);
        while (!condition())
        {
            Assert.True(Stopwatch.GetTimestamp() < deadline, $"Condition not met within {timeout.TotalSeconds} s.");
            await Task.Delay(50, TestContext.Current.CancellationToken);
        }
    }

    private static Task<ProductionSnapshot> SnapshotAsync(AdminSession admin) =>
        admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

    private HubConnection Device(DeviceCredentialsDto credentials, HttpMessageHandler? handler = null) =>
        app.Hub(HubMethods.DeviceHubPath, o =>
        {
            o.AccessTokenProvider = () => Task.FromResult<string?>($"{credentials.DeviceId}.{credentials.DeviceSecret}");
            if (handler is not null)
            {
                o.HttpMessageHandlerFactory = _ => handler;
            }
        });
}

/// <summary>
/// The sender measures its RTT with the <c>Report</c> invocation round trip, so <c>Report</c> must answer at once: one
/// device read, no database write while nothing changes, delivery to the Regie outside the call.
/// </summary>
public sealed class DeviceReportLatencyTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private const int Warmup = 50;
    private const int Samples = 500;
    private const int ParallelDevices = 10;
    private const int ParallelSamples = 50;

    /// <summary>The p95 budget of <c>Report</c> on a quiet machine (T-REPORT); reported, not enforced.</summary>
    private const double ReportBudgetMs = 100;

    /// <summary>
    /// Fifty times the budget. A machine with every core taken by other work (p50 above 300 ms, p95 above 1 s in the
    /// stress runs of issue 21) stays below it; a stalled hub (a lock, an exhausted pool) does not answer at all.
    /// </summary>
    private const double StallCeilingMs = 5000;

    /// <summary>Longer than EF Core's logging cache (1 s), so the recorder sees every command afterwards.</summary>
    private static readonly TimeSpan WarmupTime = TimeSpan.FromSeconds(1.5);

    private static readonly DeviceReportDto LiveCamera =
        new(RtcState.Connected, [new SlotTelemetryDto("camera", SlotState.Live, 1280, 720, 30, 2500, 0, "h264")], 80, false, "wifi", 20, null);

    [Fact]
    public async Task Report_SteadyState_AnswersPromptlyAndOnlyReadsTheDevice()
    {
        var cancellation = TestContext.Current.CancellationToken;
        using var sql = SqlCommandRecorder.For(app.DatabaseName);
        var admin = await app.AdminAsync();
        await using var hub = await HelloAsync(await app.PairPhoneAsync(admin), "bench");
        var warmup = Stopwatch.StartNew();
        for (var i = 0; i < Warmup || warmup.Elapsed < WarmupTime; i++)
        {
            await hub.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
        }

        var before = sql.Commands.Count;
        var samples = new double[Samples];
        for (var i = 0; i < Samples; i++)
        {
            var started = Stopwatch.GetTimestamp();
            await hub.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
            samples[i] = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        }

        var commands = sql.Commands.Skip(before).Where(c => c.HubMethod == HubMethods.Report).ToList();
        var stats = Stats.Of(samples);
        TestContext.Current.TestOutputHelper?.WriteLine($"Report round trip, 1 device, {Samples} calls: {stats}; SQL commands in Report {commands.Count}, writes {commands.Count(c => c.IsWrite)}");
        Assert.True(stats.P95 < StallCeilingMs, $"Report p95 is {stats.P95:F1} ms: the hub stalls.");
        Assert.DoesNotContain(commands, c => c.IsWrite);
        Assert.Equal(Samples, commands.Count);
        Assert.All(commands, c => Assert.Contains("FROM devices", c.Sql, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Report_StatusChange_WritesOnlyTheAuditEntryAndTheLastLiveTime()
    {
        var cancellation = TestContext.Current.CancellationToken;
        using var sql = SqlCommandRecorder.For(app.DatabaseName);
        var admin = await app.AdminAsync();
        await using var hub = await HelloAsync(await app.PairPhoneAsync(admin), "change");
        var warmup = Stopwatch.StartNew();
        while (warmup.Elapsed < WarmupTime)
        {
            await hub.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
        }

        var before = sql.Commands.Count;
        await hub.InvokeAsync(HubMethods.Report, LiveCamera with { Slots = [LiveCamera.Slots[0] with { State = SlotState.Paused }] }, cancellation);
        var commands = sql.Commands.Skip(before).Where(c => c.HubMethod == HubMethods.Report).ToList();

        TestContext.Current.TestOutputHelper?.WriteLine(string.Join(Environment.NewLine, commands.Select(c => c.Sql.ReplaceLineEndings(" "))));
        Assert.Contains(commands, c => c.IsWrite && c.Sql.Contains("audit_entries", StringComparison.Ordinal));
        Assert.Contains(commands, c => c.IsWrite && c.Sql.Contains("source_activity", StringComparison.Ordinal));
        Assert.All(commands.Where(c => c.IsWrite), c => Assert.Matches("audit_entries|source_activity", c.Sql));
    }

    /// <summary>
    /// Ten devices report back to back. The test asserts what does not depend on the speed of the machine: every call is
    /// answered, each one costs a single device read and no write, and every source ends up live. The latency is only
    /// held against a ceiling that catches a stall (a lock, an exhausted pool). The 100 ms budget (T-REPORT in
    /// docs/testing.md, section 5) is printed to the test output and judged on a quiet machine: the p95 of ten clients,
    /// the server and PostgreSQL that share the CPU of a busy build machine doubles (105 ms and 120 ms were seen), so as
    /// a pass/fail line it made a required CI job a coin flip (issue 21).
    /// </summary>
    [Fact]
    public async Task Report_TenDevicesAtOnce_AreAllAnsweredWithoutStalling()
    {
        var cancellation = TestContext.Current.CancellationToken;
        using var sql = SqlCommandRecorder.For(app.DatabaseName);
        var admin = await app.AdminAsync();
        var devices = new List<DeviceCredentialsDto>();
        var hubs = new List<HubConnection>();
        try
        {
            for (var i = 0; i < ParallelDevices; i++)
            {
                var credentials = await app.PairPhoneAsync(admin, $"Bank {i + 1}");
                devices.Add(credentials);
                hubs.Add(await HelloAsync(credentials, $"bench-{i}"));
            }

            var warmup = Stopwatch.StartNew();
            await Task.WhenAll(hubs.Select(async hub =>
            {
                while (warmup.Elapsed < WarmupTime)
                {
                    await hub.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
                }
            }));

            var before = sql.Commands.Count;
            var samples = await Task.WhenAll(hubs.Select(async hub =>
            {
                var own = new double[ParallelSamples];
                for (var i = 0; i < ParallelSamples; i++)
                {
                    var started = Stopwatch.GetTimestamp();
                    await hub.InvokeAsync(HubMethods.Report, LiveCamera, cancellation);
                    own[i] = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
                }

                return own;
            }));

            var commands = sql.Commands.Skip(before).Where(c => c.HubMethod == HubMethods.Report).ToList();
            var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", cancellation).ExpectAsync<ProductionSnapshot>();
            var stats = Stats.Of([.. samples.SelectMany(s => s)]);
            TestContext.Current.TestOutputHelper?.WriteLine(
                $"Report round trip, {ParallelDevices} devices back to back, {ParallelDevices * ParallelSamples} calls: {stats}; budget p95 < {ReportBudgetMs} ms {(stats.P95 < ReportBudgetMs ? "met" : "missed")}");

            Assert.Equal(ParallelDevices * ParallelSamples, commands.Count);
            Assert.DoesNotContain(commands, c => c.IsWrite);
            Assert.All(commands, c => Assert.Contains("FROM devices", c.Sql, StringComparison.Ordinal));
            Assert.All(devices, d => Assert.Equal(SourceStatus.Ok, snapshot.Sources.Single(s => s.Id == $"{d.DeviceId}/camera").Status));
            Assert.True(stats.P95 < StallCeilingMs, $"Report p95 with {ParallelDevices} devices is {stats.P95:F1} ms: the hub stalls.");
        }
        finally
        {
            foreach (var hub in hubs)
            {
                await hub.DisposeAsync();
            }
        }
    }

    /// <summary>A device hub over WebSockets (like the sender), after its Hello.</summary>
    private async Task<HubConnection> HelloAsync(DeviceCredentialsDto credentials, string sessionId)
    {
        var token = $"{credentials.DeviceId}.{credentials.DeviceSecret}";
        var hub = app.Hub(HubMethods.DeviceHubPath, o =>
        {
            o.Transports = HttpTransportType.WebSockets;
            o.SkipNegotiation = true;
            o.WebSocketFactory = async (context, cancellationToken) =>
            {
                var uri = new UriBuilder(context.Uri) { Query = $"{context.Uri.Query.TrimStart('?')}&access_token={Uri.EscapeDataString(token)}" }.Uri;
                return await app.Server.CreateWebSocketClient().ConnectAsync(uri, cancellationToken);
            };
        });
        await hub.StartAsync(TestContext.Current.CancellationToken);
        await hub.InvokeAsync<DeviceSessionDto>(HubMethods.Hello, new DeviceHelloDto(sessionId, "Bench", "1"), TestContext.Current.CancellationToken);
        return hub;
    }

    private sealed record Stats(double P50, double P95, double P99, double Max)
    {
        public static Stats Of(double[] samples)
        {
            var sorted = samples.Order().ToArray();
            return new Stats(At(sorted, 0.50), At(sorted, 0.95), At(sorted, 0.99), sorted[^1]);
        }

        public override string ToString() =>
            string.Create(System.Globalization.CultureInfo.InvariantCulture, $"p50 {P50:F2} ms, p95 {P95:F2} ms, p99 {P99:F2} ms, max {Max:F2} ms");

        private static double At(double[] sorted, double quantile) => sorted[Math.Min(sorted.Length - 1, (int)Math.Ceiling(quantile * sorted.Length) - 1)];
    }
}
