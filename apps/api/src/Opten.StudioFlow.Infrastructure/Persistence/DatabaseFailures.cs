using System.Data.Common;
using System.Net.Sockets;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// Thrown at once, without touching the network, while <see cref="DatabaseCircuit"/> knows that PostgreSQL is not
/// reachable. A transient <see cref="DbException"/>, so every caller treats it like the outage it stands for (503
/// <c>service_unavailable</c>, GAP-32); the retry strategy never retries it.
/// </summary>
public sealed class DatabaseUnavailableException : DbException
{
    /// <summary>Creates the exception with a fixed message (no server name, no connection string).</summary>
    public DatabaseUnavailableException()
        : base("The database is not reachable.")
    {
    }

    /// <inheritdoc />
    public override bool IsTransient => true;
}

/// <summary>Classifies database exceptions (GAP-32, BUG-21).</summary>
public static class DatabaseFailures
{
    /// <summary>
    /// True when the exception (or one of its inner exceptions) is a transient database failure: PostgreSQL is down,
    /// unreachable, restarting or overloaded. Requests answer 503 then; hub calls a <c>service_unavailable</c> error.
    /// </summary>
    public static bool IsOutage(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is RetryLimitExceededException or DbException { IsTransient: true })
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// True when the connection to the server is gone or cannot be established: name resolution, refused or reset TCP,
    /// a timeout, or the server terminating the session (admin or crash shutdown, starting up, connection exceptions).
    /// Query errors such as constraint violations or serialization failures are not connection losses.
    /// </summary>
    public static bool IsConnectionLoss(Exception exception) => exception switch
    {
        DatabaseUnavailableException => false,
        PostgresException postgres => postgres.SqlState.StartsWith("08", StringComparison.Ordinal)
            || postgres.SqlState is PostgresErrorCodes.AdminShutdown or PostgresErrorCodes.CrashShutdown or PostgresErrorCodes.CannotConnectNow,
        NpgsqlException { InnerException: IOException or SocketException or TimeoutException } => true,
        NpgsqlException { InnerException: { } inner } => IsConnectionLoss(inner),
        TimeoutException or SocketException => true,
        _ => false,
    };

    /// <summary>True when a statement got no answer in time (the server hangs or the network is silent).</summary>
    public static bool IsTimeout(Exception exception) =>
        exception is TimeoutException or NpgsqlException { InnerException: TimeoutException };
}
