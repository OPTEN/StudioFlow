using Microsoft.EntityFrameworkCore.Storage;
using Npgsql.EntityFrameworkCore.PostgreSQL;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// Npgsql's retrying strategy (3 retries, at most 2 s apart) that stops as soon as <see cref="DatabaseCircuit"/> knows
/// that PostgreSQL is unreachable: a retry then could only wait for another timeout (BUG-21). Broken pooled connections
/// after a PostgreSQL restart and other transient errors are still retried.
/// </summary>
internal sealed class CircuitAwareRetryStrategy(ExecutionStrategyDependencies dependencies, DatabaseCircuit circuit)
    : NpgsqlRetryingExecutionStrategy(dependencies, MaxRetries, MaxDelay, null)
{
    private const int MaxRetries = 3;
    private static readonly TimeSpan MaxDelay = TimeSpan.FromSeconds(2);

    protected override bool ShouldRetryOn(Exception? exception) =>
        exception is not null and not DatabaseUnavailableException && !circuit.IsOpen && base.ShouldRetryOn(exception);
}
