using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Opten.FlowStudio.Infrastructure.Persistence;

/// <summary>Readiness: the database is reachable (<c>/health/ready</c>).</summary>
internal sealed class DatabaseHealthCheck(IDbContextFactory<FlowStudioDbContext> contexts) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        return await db.Database.CanConnectAsync(cancellationToken)
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("The database is not reachable.");
    }
}
