using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>Database schema management for the web host.</summary>
public static class DatabaseMaintenance
{
    /// <summary>Health check tag of checks that gate readiness.</summary>
    public const string ReadyTag = "ready";

    /// <summary>How long the readiness check may take before it reports the database as unreachable.</summary>
    public static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(3);

    /// <summary>Pause between two startup attempts while PostgreSQL is not reachable yet.</summary>
    private static readonly TimeSpan StartupRetryDelay = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Applies pending migrations. The database and the migrations history table are created explicitly first: on a
    /// first start EF Core would otherwise probe them by failing queries and log those probes as errors. While
    /// PostgreSQL is not reachable yet (a host reboot may start the API first) it retries for
    /// <see cref="DatabaseOptions.StartupWait"/>; the short request timeouts would otherwise end the startup at once.
    /// </summary>
    public static async Task MigrateAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(services);
        var wait = services.GetRequiredService<IOptions<DatabaseOptions>>().Value.StartupWait;
        var clock = services.GetService<TimeProvider>() ?? TimeProvider.System;
        var logger = (services.GetService<ILoggerFactory>() ?? NullLoggerFactory.Instance).CreateLogger(typeof(DatabaseMaintenance).FullName!);
        var started = clock.GetTimestamp();
        while (true)
        {
            try
            {
                await MigrateOnceAsync(services, cancellationToken);
                return;
            }
            catch (Exception exception) when (DatabaseFailures.IsOutage(exception) && clock.GetElapsedTime(started) < wait)
            {
                logger.LogWarning("PostgreSQL is not reachable yet ({Reason}); the startup waits for it", exception.GetBaseException().GetType().Name);
                await Task.Delay(StartupRetryDelay, clock, cancellationToken);
            }
        }
    }

    private static async Task MigrateOnceAsync(IServiceProvider services, CancellationToken cancellationToken)
    {
        var contexts = services.GetRequiredService<IDbContextFactory<StudioFlowDbContext>>();
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        db.Database.SetCommandTimeout(DatabaseOptions.MigrationCommandTimeout);
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
