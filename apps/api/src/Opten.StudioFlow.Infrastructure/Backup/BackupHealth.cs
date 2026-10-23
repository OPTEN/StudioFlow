using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Opten.StudioFlow.Infrastructure.Persistence;

namespace Opten.StudioFlow.Infrastructure.Backup;

/// <summary>Registers the backup warning of the readiness check.</summary>
public static class BackupHealth
{
    /// <summary>How long reading the status file may take.</summary>
    private static readonly TimeSpan CheckTimeout = TimeSpan.FromSeconds(3);

    /// <summary>
    /// Adds the backup check to <c>/health/ready</c>. Its failure status is <c>Degraded</c>: a missing backup is a warning
    /// (HTTP 200 with the reasons in the body), never a reason to take the API out of service.
    /// </summary>
    public static IHealthChecksBuilder AddBackupCheck(this IHealthChecksBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AddCheck<BackupStatusHealthCheck>("backup", failureStatus: HealthStatus.Degraded, tags: [DatabaseMaintenance.ReadyTag], timeout: CheckTimeout);
    }
}
