using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.Backup;

/// <summary>
/// Readiness: warns when automatic backups are missing (<c>/health/ready</c>, runbook section 7). It reads the status
/// file that the backup service writes and answers <c>Degraded</c> (never <c>Unhealthy</c>: a missing backup must not
/// make the API unavailable) with the reasons when
/// <list type="bullet">
/// <item>the last backup run failed,</item>
/// <item>the last successful backup is older than <see cref="BackupOptions.WarnAfterHours"/>, or there is none yet after
/// that time,</item>
/// <item>no off-site copy is configured (the backups would stay on the server), the last off-site copy failed or is too
/// old.</item>
/// </list>
/// Automatic backups that are switched off (<see cref="BackupOptions.IsEnabled"/>) are healthy.
/// </summary>
internal sealed class BackupStatusHealthCheck(BackupOptions options, TimeProvider clock, ServerSettingsState? settings = null) : IHealthCheck
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (!IsEnabled)
        {
            return HealthCheckResult.Healthy("Automatic backups are off.");
        }

        BackupServiceStatus? status;
        try
        {
            await using var stream = File.OpenRead(options.StatusFile);
            status = await JsonSerializer.DeserializeAsync<BackupServiceStatus>(stream, JsonOptions, cancellationToken);
        }
        catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
        {
            return HealthCheckResult.Degraded("Automatic backups are on, but the backup service has not reported yet. Check: docker compose ps backup");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            return HealthCheckResult.Degraded("The backup status file cannot be read.");
        }

        if (status is null)
        {
            return HealthCheckResult.Degraded("The backup status file is empty.");
        }

        var now = clock.GetUtcNow();
        var limit = TimeSpan.FromHours(options.WarnAfterHours);
        var since = status.CreatedAt ?? now;
        var problems = new List<string>();

        if (status.LastAttempt is { Ok: false } failed)
        {
            problems.Add(Describe("The last backup run failed", failed));
        }

        if (status.LastSuccess is { } success)
        {
            AddAge(problems, "The last successful backup", now - success.At, limit);
        }
        else if (now - since > limit)
        {
            problems.Add(string.Create(CultureInfo.InvariantCulture, $"There has been no successful backup for {Hours(now - since)} hours (limit {options.WarnAfterHours} hours)."));
        }

        if (status.Offsite is not { Configured: true } offsite)
        {
            problems.Add("No off-site copy is configured: the backups stay on this server (Server settings, Backups).");
        }
        else
        {
            if (offsite.LastAttempt is { Ok: false } offsiteFailed)
            {
                problems.Add(Describe("The last off-site copy failed", offsiteFailed));
            }

            if (offsite.LastSuccess is { } offsiteSuccess)
            {
                AddAge(problems, "The last off-site copy", now - offsiteSuccess.At, limit);
            }
            else if (now - since > limit)
            {
                problems.Add(string.Create(CultureInfo.InvariantCulture, $"There has been no successful off-site copy for {Hours(now - since)} hours (limit {options.WarnAfterHours} hours)."));
            }
        }

        var data = new Dictionary<string, object>();
        if (status.LastSuccess is { } last)
        {
            data["lastSuccessAt"] = last.At;
            data["lastSuccessBytes"] = last.Bytes;
        }

        return problems.Count == 0
            ? HealthCheckResult.Healthy(Summary(status, now), data)
            : HealthCheckResult.Degraded(string.Join(' ', problems), data: data);
    }

    private static string Summary(BackupServiceStatus status, DateTimeOffset now) =>
        status.LastSuccess is { } last
            ? string.Create(CultureInfo.InvariantCulture, $"Last backup {last.Name} ({last.Bytes / (1024 * 1024)} MB), {Hours(now - last.At)} hours ago; off-site copy ok.")
            : "No backup is due yet.";

    private void AddAge(List<string> problems, string what, TimeSpan age, TimeSpan limit)
    {
        if (age > limit)
        {
            problems.Add(string.Create(CultureInfo.InvariantCulture, $"{what} is {Hours(age)} hours old (limit {options.WarnAfterHours} hours)."));
        }
    }

    private static string Describe(string what, BackupAttemptStatus attempt) =>
        string.IsNullOrWhiteSpace(attempt.Message) ? $"{what}." : $"{what}: {attempt.Message.Trim()}";

    private static long Hours(TimeSpan span) => (long)Math.Floor(span.TotalHours);

    /// <summary>Automatic backups are on: the status file is known and a schedule is set (in the server settings once they were saved, else in the configuration).</summary>
    private bool IsEnabled => !string.IsNullOrWhiteSpace(options.StatusFile) && !string.IsNullOrWhiteSpace(settings?.Row is not null ? settings.BackupSchedule : options.Schedule);
}
