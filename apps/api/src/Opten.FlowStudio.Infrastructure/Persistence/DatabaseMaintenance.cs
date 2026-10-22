using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Opten.FlowStudio.Infrastructure.Persistence;

/// <summary>Database schema management for the web host.</summary>
public static class DatabaseMaintenance
{
    /// <summary>Health check tag of checks that gate readiness.</summary>
    public const string ReadyTag = "ready";

    /// <summary>How long the readiness check may take before it reports the database as unreachable.</summary>
    public static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(3);

    /// <summary>
    /// Applies pending migrations. The database and the migrations history table are created explicitly first: on a
    /// first start EF Core would otherwise probe them by failing queries and log those probes as errors.
    /// </summary>
    public static async Task MigrateAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(services);
        var contexts = services.GetRequiredService<IDbContextFactory<FlowStudioDbContext>>();
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        var creator = db.GetService<IRelationalDatabaseCreator>();
        if (!await creator.ExistsAsync(cancellationToken))
        {
            await creator.CreateAsync(cancellationToken);
        }

        await db.GetService<IHistoryRepository>().CreateIfNotExistsAsync(cancellationToken);
        await db.Database.MigrateAsync(cancellationToken);
    }

    /// <summary>Adds the database readiness check (unhealthy when the database does not answer within <see cref="ReadyTimeout"/>).</summary>
    public static IHealthChecksBuilder AddDatabaseCheck(this IHealthChecksBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AddCheck<DatabaseHealthCheck>("database", tags: [ReadyTag], timeout: ReadyTimeout);
    }
}
