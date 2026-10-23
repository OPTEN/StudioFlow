using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// Readiness: the database is reachable (<c>/health/ready</c>). While <see cref="DatabaseCircuit"/> knows of an outage
/// the answer is immediate; a failed check opens the circuit, so requests fail fast from then on as well.
/// </summary>
internal sealed class DatabaseHealthCheck(IDbContextFactory<StudioFlowDbContext> contexts, DatabaseCircuit circuit) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (circuit.IsOpen)
        {
            return HealthCheckResult.Unhealthy("The database is not reachable.");
        }

        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        if (await db.Database.CanConnectAsync(cancellationToken))
        {
            return HealthCheckResult.Healthy();
        }

        circuit.Trip();
        return HealthCheckResult.Unhealthy("The database is not reachable.");
    }
}
