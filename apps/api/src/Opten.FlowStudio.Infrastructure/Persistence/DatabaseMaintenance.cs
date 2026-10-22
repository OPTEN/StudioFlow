using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Opten.FlowStudio.Infrastructure.Persistence;

/// <summary>Database schema management for the web host.</summary>
public static class DatabaseMaintenance
{
    /// <summary>Health check tag of checks that gate readiness.</summary>
    public const string ReadyTag = "ready";

    /// <summary>Applies pending migrations.</summary>
    public static async Task MigrateAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(services);
        var contexts = services.GetRequiredService<IDbContextFactory<FlowStudioDbContext>>();
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        await db.Database.MigrateAsync(cancellationToken);
    }

    /// <summary>Adds the database readiness check.</summary>
    public static IHealthChecksBuilder AddDatabaseCheck(this IHealthChecksBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AddCheck<DatabaseHealthCheck>("database", tags: [ReadyTag]);
    }
}
