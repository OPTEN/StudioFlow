using System.Globalization;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Infrastructure.Backup;
using Opten.StudioFlow.Web.Hosting;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// The backup warning of <c>/health/ready</c> (issue 16): it reads the status file of the backup service and warns, as
/// Degraded, when backups are missing, too old, failed or only kept on the server. No database is involved.
/// </summary>
public sealed class BackupHealthTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 12, 0, 0, TimeSpan.Zero);

    private readonly string folder = Directory.CreateTempSubdirectory("sf-backup-health-").FullName;
    private readonly ManualClock clock = new(Now);

    public void Dispose() => Directory.Delete(folder, recursive: true);

    [Fact]
    public async Task Check_AutomaticBackupsOff_IsHealthy()
    {
        var result = await CheckAsync(new BackupOptions { Schedule = "", StatusFile = StatusFile });

        Assert.Equal(HealthStatus.Healthy, result.Status);
        Assert.Contains("off", result.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_NoStatusFileYet_Warns()
    {
        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("has not reported yet", result.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_RecentBackupWithOffsiteCopy_IsHealthy()
    {
        Write(Status(success: Hours(-5), offsite: OffsiteOk(Hours(-5))));

        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Healthy, result.Status);
        Assert.Contains("2026-10-23_0300_auto", result.Description, StringComparison.Ordinal);
        Assert.Equal(412L * 1024 * 1024, result.Data["lastSuccessBytes"]);
    }

    [Fact]
    public async Task Check_LastBackupOlderThanTheLimit_Warns()
    {
        Write(Status(success: Hours(-49), offsite: OffsiteOk(Hours(-49))));

        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("The last successful backup is 49 hours old (limit 48 hours).", result.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_LastBackupJustInsideTheLimit_IsHealthy()
    {
        Write(Status(success: Hours(-47), offsite: OffsiteOk(Hours(-47))));

        Assert.Equal(HealthStatus.Healthy, (await CheckAsync()).Status);
    }

    [Fact]
    public async Task Check_LimitFromTheOptions_IsUsed()
    {
        Write(Status(success: Hours(-13), offsite: OffsiteOk(Hours(-13))));

        var result = await CheckAsync(Options(warnAfterHours: 12));

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("(limit 12 hours)", result.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_NoBackupYetAfterTheLimit_Warns()
    {
        Write(Status(success: null, created: Hours(-50), offsite: OffsiteOk(null)));

        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("no successful backup for 50 hours", result.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_NoBackupYetWithinTheLimit_IsHealthy()
    {
        // A fresh installation: the first backup is not due until the schedule fires.
        Write(Status(success: null, created: Hours(-3), offsite: OffsiteOk(null)));

        Assert.Equal(HealthStatus.Healthy, (await CheckAsync()).Status);
    }

    [Fact]
    public async Task Check_LastRunFailedButAnEarlierBackupIsRecent_WarnsWithTheReason()
    {
        Write(Status(success: Hours(-20), offsite: OffsiteOk(Hours(-20)), attemptOk: false, attemptMessage: "pg_dump failed."));

        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("The last backup run failed: pg_dump failed.", result.Description, StringComparison.Ordinal);
        Assert.DoesNotContain("old", result.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_NoOffsiteTarget_Warns()
    {
        Write(Status(success: Hours(-2), offsite: """{ "configured": false, "encrypted": false }"""));

        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("No off-site copy is configured", result.Description, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_OffsiteCopyFailedAndIsOld_WarnsTwice()
    {
        Write(Status(success: Hours(-2), offsite: """
            { "configured": true, "encrypted": true,
              "lastAttempt": { "at": "2026-10-23T03:00:00Z", "ok": false, "message": "Upload failed." },
              "lastSuccess": { "at": "2026-10-20T03:00:00Z", "name": "x" } }
            """));

        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Contains("The last off-site copy failed: Upload failed.", result.Description, StringComparison.Ordinal);
        Assert.Contains("The last off-site copy is 81 hours old", result.Description, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("""{ "lastSuccess": { "at": "yesterday" } }""")]
    public async Task Check_UnreadableStatusFile_WarnsInsteadOfThrowing(string content)
    {
        Write(content);

        var result = await CheckAsync();

        Assert.Equal(HealthStatus.Degraded, result.Status);
    }

    [Fact]
    public void Validate_WarnAfterHoursOutOfRange_NamesTheKey()
    {
        var errors = new BackupOptions { WarnAfterHours = 0 }.Validate().ToList();

        Assert.Contains("Backup:WarnAfterHours", Assert.Single(errors), StringComparison.Ordinal);
        Assert.Empty(new BackupOptions().Validate());
    }

    [Fact]
    public void Format_Healthy_IsExactlyTheStatus()
    {
        Assert.Equal("Healthy", HealthResponse.Format(Report(("database", HealthStatus.Healthy, null))));
    }

    [Fact]
    public void Format_Degraded_ListsTheReasonsAfterTheStatus()
    {
        var text = HealthResponse.Format(Report(("database", HealthStatus.Healthy, null), ("backup", HealthStatus.Degraded, "No off-site copy.")));

        Assert.Equal("Degraded\nbackup: Degraded - No off-site copy.", text);
    }

    private string StatusFile => Path.Combine(folder, "backup-status.json");

    private BackupOptions Options(int warnAfterHours = 48) => new() { Schedule = "0 3 * * *", StatusFile = StatusFile, WarnAfterHours = warnAfterHours };

    private async Task<HealthCheckResult> CheckAsync(BackupOptions? options = null) =>
        await new BackupStatusHealthCheck(options ?? Options(), clock).CheckHealthAsync(new HealthCheckContext(), TestContext.Current.CancellationToken);

    private void Write(string content) => File.WriteAllText(StatusFile, content);

    private static string Hours(int offset) => Now.AddHours(offset).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    private static string OffsiteOk(string? at) => at is null
        ? """{ "configured": true, "encrypted": true }"""
        : $$"""{ "configured": true, "encrypted": true, "lastAttempt": { "at": "{{at}}", "ok": true }, "lastSuccess": { "at": "{{at}}", "name": "x" } }""";

    private static string Status(string? success, string offsite, string? created = null, bool attemptOk = true, string? attemptMessage = null)
    {
        var lastSuccess = success is null
            ? "null"
            : $$"""{ "at": "{{success}}", "name": "2026-10-23_0300_auto", "bytes": 432013312 }""";
        var message = attemptMessage is null ? "null" : $"\"{attemptMessage}\"";
        var attempt = $$"""{ "at": "{{success ?? created ?? Hours(-1)}}", "ok": {{(attemptOk ? "true" : "false")}}, "message": {{message}} }""";
        return $$"""
            { "version": 1, "createdAt": "{{created ?? Hours(-500)}}", "state": "idle",
              "lastAttempt": {{(success is null && attemptOk ? "null" : attempt)}}, "lastSuccess": {{lastSuccess}}, "offsite": {{offsite}} }
            """;
    }

    private static HealthReport Report(params (string Name, HealthStatus Status, string? Description)[] entries) =>
        new(
            entries.ToDictionary(e => e.Name, e => new HealthReportEntry(e.Status, e.Description, TimeSpan.Zero, null, null)),
            TimeSpan.Zero);

    /// <summary>A clock that stands still.</summary>
    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
