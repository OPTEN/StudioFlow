using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Opten.FlowStudio.Infrastructure.Persistence;

/// <summary>
/// Fails fast while PostgreSQL is unreachable (BUG-21, GAP-32). Without it every operation that needs the database
/// waits for its own connect timeout and retries, and because the mutations of a production are serialized, device
/// reports and maintenance ticks queue up in front of the operator's request until it answers after a minute or never.
/// <para>
/// A failed connection attempt or a statement without answer opens the circuit: from then on every operation fails at
/// once with <see cref="DatabaseUnavailableException"/> (503 <c>service_unavailable</c>) and a background probe tries
/// an unpooled connection every <see cref="DatabaseOptions.ProbeInterval"/>. The first successful probe closes the
/// circuit, so the API recovers by itself without a restart. Broken pooled connections are cleared on the first
/// connection loss, so nothing stale is reused afterwards.
/// </para>
/// </summary>
public sealed class DatabaseCircuit : IDisposable
{
    private readonly Func<CancellationToken, Task> probe;
    private readonly TimeSpan probeInterval;
    private readonly TimeProvider clock;
    private readonly ILogger<DatabaseCircuit> logger;
    private readonly CancellationTokenSource stopping = new();
    private readonly Lock gate = new();
    private volatile bool open;
    private int disposed;

    /// <summary>Creates a circuit; <paramref name="probe"/> must open a real (unpooled) connection and throw when it fails.</summary>
    public DatabaseCircuit(Func<CancellationToken, Task> probe, TimeSpan probeInterval, TimeProvider clock, ILogger<DatabaseCircuit> logger)
    {
        ArgumentNullException.ThrowIfNull(probe);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);
        this.probe = probe;
        this.probeInterval = probeInterval;
        this.clock = clock;
        this.logger = logger;
    }

    /// <summary>True while PostgreSQL is known to be unreachable.</summary>
    public bool IsOpen => open;

    /// <summary>The running probe loop (tests, diagnostics); null while the circuit is closed.</summary>
    internal Task? Probing { get; private set; }

    /// <summary>Throws <see cref="DatabaseUnavailableException"/> while the circuit is open.</summary>
    public void ThrowIfOpen()
    {
        if (open)
        {
            throw new DatabaseUnavailableException();
        }
    }

    /// <summary>Opens the circuit after a connection loss and starts probing; no-op when it is open already.</summary>
    public void Trip()
    {
        lock (gate)
        {
            if (open || Volatile.Read(ref disposed) == 1)
            {
                return;
            }

            open = true;
            var token = stopping.Token;
            Probing = Task.Run(() => ProbeUntilReachableAsync(token));
        }

        logger.LogWarning("PostgreSQL is not reachable; requests that need the database fail at once until it answers again");
    }

    /// <summary>Stops probing (host shutdown).</summary>
    public void Dispose()
    {
        lock (gate)
        {
            if (Interlocked.Exchange(ref disposed, 1) == 1)
            {
                return;
            }
        }

        stopping.Cancel();
        stopping.Dispose();
    }

    private async Task ProbeUntilReachableAsync(CancellationToken token)
    {
        var attempts = 0;
        while (!token.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(probeInterval, clock, token);
                attempts++;
                await probe(token);
                lock (gate)
                {
                    open = false;
                    Probing = null;
                }

                logger.LogInformation("PostgreSQL is reachable again after {Attempts} probe(s)", attempts);
                return;
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception) when (exception is not OutOfMemoryException)
            {
                // Only the type: connection errors can contain the server name.
                logger.LogDebug("Database probe {Attempt} failed: {Reason}", attempts, exception.GetType().Name);
            }
        }
    }
}

/// <summary>
/// Connects EF Core to <see cref="DatabaseCircuit"/>: refuses to open connections while the circuit is open, opens it
/// when a connection cannot be established or a statement times out, and clears the pool on every connection loss
/// (pooled connections of a stopped server are all broken).
/// </summary>
internal sealed class DatabaseCircuitInterceptor(DatabaseCircuit circuit) : IDbConnectionInterceptor, IDbCommandInterceptor
{
    public InterceptionResult ConnectionOpening(DbConnection connection, ConnectionEventData eventData, InterceptionResult result)
    {
        circuit.ThrowIfOpen();
        return result;
    }

    public ValueTask<InterceptionResult> ConnectionOpeningAsync(DbConnection connection, ConnectionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
    {
        circuit.ThrowIfOpen();
        return ValueTask.FromResult(result);
    }

    public void ConnectionFailed(DbConnection connection, ConnectionErrorEventData eventData) => OnConnectionFailed(connection, eventData.Exception);

    public Task ConnectionFailedAsync(DbConnection connection, ConnectionErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        OnConnectionFailed(connection, eventData.Exception);
        return Task.CompletedTask;
    }

    public void CommandFailed(DbCommand command, CommandErrorEventData eventData) => OnCommandFailed(command.Connection, eventData.Exception);

    public Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        OnCommandFailed(command.Connection, eventData.Exception);
        return Task.CompletedTask;
    }

    private void OnConnectionFailed(DbConnection? connection, Exception exception)
    {
        if (DatabaseFailures.IsConnectionLoss(exception))
        {
            ClearPool(connection);
            circuit.Trip();
        }
    }

    private void OnCommandFailed(DbConnection? connection, Exception exception)
    {
        if (!DatabaseFailures.IsConnectionLoss(exception))
        {
            return;
        }

        // A broken pooled connection (server restarted) is retried on a fresh one, which decides; a statement without
        // any answer means the server hangs, so later statements must not wait for it as well.
        ClearPool(connection);
        if (DatabaseFailures.IsTimeout(exception))
        {
            circuit.Trip();
        }
    }

    private static void ClearPool(DbConnection? connection)
    {
        if (connection is NpgsqlConnection npgsql)
        {
            NpgsqlConnection.ClearPool(npgsql);
        }
    }
}
