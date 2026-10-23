namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// Automatic backups as the API sees them (configuration section <c>Backup</c>, runbook section 7). The backup service
/// writes a status file; the readiness check reads it and warns when backups are missing. docker-compose.yml sets the
/// values from <c>BACKUP_SCHEDULE</c> and <c>BACKUP_WARN_AFTER_HOURS</c>.
/// </summary>
public sealed class BackupOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Backup";

    /// <summary>Longest accepted <see cref="WarnAfterHours"/> (one year).</summary>
    private const int MaxWarnAfterHours = 24 * 365;

    /// <summary><c>Backup:StatusFile</c>: the status file of the backup service. Empty: the check is off.</summary>
    public string StatusFile { get; set; } = "";

    /// <summary>
    /// <c>Backup:Schedule</c>: the cron expression of the backup service (<c>BACKUP_SCHEDULE</c>). Empty: automatic backups
    /// are off, so there is nothing to warn about.
    /// </summary>
    public string Schedule { get; set; } = "";

    /// <summary><c>Backup:WarnAfterHours</c>: the readiness check warns when the last successful backup is older (default 48 h).</summary>
    public int WarnAfterHours { get; set; } = 48;

    /// <summary>True when automatic backups are switched on and the status file is known.</summary>
    public bool IsEnabled => !string.IsNullOrWhiteSpace(Schedule) && !string.IsNullOrWhiteSpace(StatusFile);

    /// <inheritdoc />
    public IEnumerable<string> Validate() => OptionRules.Count("Backup:WarnAfterHours", WarnAfterHours, 1, MaxWarnAfterHours);
}
