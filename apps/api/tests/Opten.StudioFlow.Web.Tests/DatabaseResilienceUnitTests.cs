using System.Net.Sockets;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Errors;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The building blocks of BUG-21 and BUG-08 without a database: circuit, classification, timeouts, field paths.</summary>
public sealed class DatabaseResilienceUnitTests
{
    private static readonly TimeSpan ProbeInterval = TimeSpan.FromMilliseconds(20);

    [Fact]
    public void ThrowIfOpen_Closed_DoesNothing()
    {
        using var circuit = Circuit(_ => Task.CompletedTask);

        circuit.ThrowIfOpen();

        Assert.False(circuit.IsOpen);
    }

    [Fact]
    public async Task Trip_ProbeFailsThenSucceeds_FailsFastUntilTheProbeReachesTheServer()
    {
        var attempts = 0;
        var reachable = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var circuit = Circuit(async _ =>
        {
            if (Interlocked.Increment(ref attempts) < 3)
            {
                throw new NpgsqlException("down", new SocketException((int)SocketError.ConnectionRefused));
            }

            await reachable.Task;
        });

        circuit.Trip();
        var failure = Assert.Throws<DatabaseUnavailableException>(circuit.ThrowIfOpen);
        var probing = circuit.Probing!;
        reachable.SetResult();
        await probing.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);

        Assert.True(failure.IsTransient);
        Assert.True(DatabaseFailures.IsOutage(failure));
        Assert.False(circuit.IsOpen);
        Assert.Equal(3, attempts);
        circuit.ThrowIfOpen();
    }

    [Fact]
    public async Task Trip_Twice_StartsOneProbeLoop()
    {
        var attempts = 0;
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var circuit = Circuit(async _ =>
        {
            Interlocked.Increment(ref attempts);
            await gate.Task;
        });

        circuit.Trip();
        var first = circuit.Probing;
        circuit.Trip();
        var second = circuit.Probing;
        gate.SetResult();
        await first!.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);

        Assert.Same(first, second);
        Assert.Equal(1, attempts);
    }

    [Fact]
    public async Task Dispose_WhileOpen_StopsProbing()
    {
        var circuit = Circuit(_ => throw new TimeoutException());
        circuit.Trip();
        var probing = circuit.Probing!;

        circuit.Dispose();
        await probing.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
        circuit.Trip();

        Assert.True(probing.IsCompletedSuccessfully);
    }

    public static TheoryData<Exception, bool> ConnectionLosses => new()
    {
        { new NpgsqlException("dns", new SocketException((int)SocketError.HostNotFound)), true },
        { new NpgsqlException("reset", new IOException("reset")), true },
        { new NpgsqlException("eof", new EndOfStreamException()), true },
        { new NpgsqlException("timeout", new TimeoutException()), true },
        { new PostgresException("terminating connection due to administrator command", "FATAL", "FATAL", PostgresErrorCodes.AdminShutdown), true },
        { new PostgresException("the database system is starting up", "FATAL", "FATAL", PostgresErrorCodes.CannotConnectNow), true },
        { new PostgresException("connection failure", "FATAL", "FATAL", PostgresErrorCodes.ConnectionFailure), true },
        { new PostgresException("duplicate key", "ERROR", "ERROR", PostgresErrorCodes.UniqueViolation), false },
        { new PostgresException("serialization", "ERROR", "ERROR", PostgresErrorCodes.SerializationFailure), false },
        { new DatabaseUnavailableException(), false },
        { new InvalidOperationException("bug"), false },
    };

    [Theory]
    [MemberData(nameof(ConnectionLosses))]
    public void IsConnectionLoss_Exception_OnlyForLostOrUnreachableServers(Exception exception, bool expected)
    {
        Assert.Equal(expected, DatabaseFailures.IsConnectionLoss(exception));
    }

    [Fact]
    public void IsTimeout_StatementWithoutAnswer_IsTrueOnlyForTimeouts()
    {
        Assert.True(DatabaseFailures.IsTimeout(new NpgsqlException("timeout", new TimeoutException())));
        Assert.False(DatabaseFailures.IsTimeout(new NpgsqlException("reset", new IOException())));
    }

    [Fact]
    public void Apply_ConnectionString_SetsTheTimeoutsAndKeepsTheRest()
    {
        var options = new DatabaseOptions { ConnectTimeout = TimeSpan.FromSeconds(2.5), CommandTimeout = TimeSpan.FromSeconds(5) };

        var pooled = new NpgsqlConnectionStringBuilder(options.Apply("Host=db;Database=sf;Username=u;Password=p;Timeout=30;Command Timeout=60"));
        var probe = new NpgsqlConnectionStringBuilder(options.Apply("Host=db;Database=sf;Username=u;Password=p", pooled: false));

        Assert.Equal((3, 5, 1000, true), (pooled.Timeout, pooled.CommandTimeout, pooled.CancellationTimeout, pooled.Pooling));
        Assert.Equal(("db", "sf", "p"), (pooled.Host, pooled.Database, pooled.Password));
        Assert.False(probe.Pooling);
        Assert.Equal(3, probe.Timeout);
    }

    [Fact]
    public void Validate_OutOfRange_NamesTheKeys()
    {
        var errors = new DatabaseOptions { ConnectTimeout = TimeSpan.Zero, CommandTimeout = TimeSpan.FromHours(1), ProbeInterval = TimeSpan.FromMilliseconds(1), StartupWait = TimeSpan.FromHours(1) }.Validate().ToList();

        Assert.Empty(new DatabaseOptions().Validate());
        Assert.Equal(4, errors.Count);
        Assert.Contains(errors, e => e.StartsWith("Database:ConnectTimeout", StringComparison.Ordinal));
        Assert.Contains(errors, e => e.StartsWith("Database:StartupWait", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("$.kind", "kind")]
    [InlineData("$.Kind", "kind")]
    [InlineData("$.items[2].Fit", "items[2].fit")]
    [InlineData("$.transition.durationMs", "transition.durationMs")]
    [InlineData("$['odd name'].x", "odd name.x")]
    [InlineData("$", "body")]
    [InlineData("", "body")]
    [InlineData(null, "body")]
    public void FieldOf_JsonPath_IsTheCamelCaseFieldPath(string? path, string expected)
    {
        Assert.Equal(expected, JsonBindingErrors.FieldOf(path));
    }

    private static DatabaseCircuit Circuit(Func<CancellationToken, Task> probe) =>
        new(probe, ProbeInterval, TimeProvider.System, NullLogger<DatabaseCircuit>.Instance);
}
