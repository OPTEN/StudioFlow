namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// Retention and export of the audit log (configuration section <c>Audit</c>, spec 4.9, runbook "What happened?").
/// docker-compose.yml sets the two periods from <c>AUDIT_RETENTION_DAYS</c> and <c>AUDIT_IP_RETENTION_DAYS</c>.
/// </summary>
public sealed class AuditOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Audit";

    /// <summary>Longest accepted <see cref="RetentionDays"/> (ten years).</summary>
    private const int MaxRetentionDays = 3650;

    /// <summary><c>Audit:RetentionDays</c>: entries older than this are deleted (default 365).</summary>
    public int RetentionDays { get; set; } = 365;

    /// <summary>
    /// <c>Audit:IpRetentionDays</c>: the IP addresses of sign-ins and account changes are removed from entries older than
    /// this, the rest of the entry stays (default 90; IP addresses are personal data under the Swiss FADP).
    /// </summary>
    public int IpRetentionDays { get; set; } = 90;

    /// <summary><c>Audit:MaintenanceInterval</c>: how often the retention runs; it skips a run while a broadcast is live (default 1 hour).</summary>
    public TimeSpan MaintenanceInterval { get; set; } = TimeSpan.FromHours(1);

    /// <summary><c>Audit:BatchSize</c>: rows deleted or changed per statement, so a large backlog never locks the table for long (default 5000).</summary>
    public int BatchSize { get; set; } = 5_000;

    /// <summary><c>Audit:ExportMaxRows</c>: an export of more rows is refused (409), narrow the filters (default 50000).</summary>
    public int ExportMaxRows { get; set; } = 50_000;

    /// <summary><c>Audit:ExportsPerMinute</c>: exports per client address and minute (default 6; 429).</summary>
    public int ExportsPerMinute { get; set; } = 6;

    /// <inheritdoc />
    public IEnumerable<string> Validate() =>
    [
        .. OptionRules.Count("Audit:RetentionDays", RetentionDays, 1, MaxRetentionDays),
        .. OptionRules.Count("Audit:IpRetentionDays", IpRetentionDays, 1, RetentionDays),
        .. OptionRules.Duration("Audit:MaintenanceInterval", MaintenanceInterval, TimeSpan.FromMinutes(1), TimeSpan.FromDays(1)),
        .. OptionRules.Count("Audit:BatchSize", BatchSize, 100, 100_000),
        .. OptionRules.Count("Audit:ExportMaxRows", ExportMaxRows, 1, 1_000_000),
        .. OptionRules.Count("Audit:ExportsPerMinute", ExportsPerMinute, 1, 600),
    ];
}
