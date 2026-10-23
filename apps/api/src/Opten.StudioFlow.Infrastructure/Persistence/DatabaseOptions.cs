using System.Globalization;
using Npgsql;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// How long the API waits for PostgreSQL (configuration section <c>Database</c>, GAP-32). The values bound every request
/// that needs the database while PostgreSQL is stopped, hangs or is unreachable, so the Regie gets a 503 within a few
/// seconds instead of a gateway timeout. They replace any timeout given in the connection string.
/// </summary>
public sealed class DatabaseOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Database";

    /// <summary>
    /// <c>Database:ConnectTimeout</c>: opening a connection (name resolution, TCP, startup and authentication) gives up
    /// after this time (default 3 s; Npgsql counts whole seconds).
    /// </summary>
    public TimeSpan ConnectTimeout { get; set; } = TimeSpan.FromSeconds(3);

    /// <summary>
    /// <c>Database:CommandTimeout</c>: a statement that gets no answer within this time fails (default 5 s; the API only
    /// runs small statements; migrations get <see cref="MigrationCommandTimeout"/>).
    /// </summary>
    public TimeSpan CommandTimeout { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// <c>Database:ProbeInterval</c>: while PostgreSQL is unreachable, requests fail at once and a probe connection is
    /// tried this often; the first successful probe ends the outage (default 1 s).
    /// </summary>
    public TimeSpan ProbeInterval { get; set; } = TimeSpan.FromSeconds(1);

    /// <summary>
    /// <c>Database:StartupWait</c>: how long the API waits for PostgreSQL at startup before it gives up (default 60 s; a
    /// host reboot may start the API before the database).
    /// </summary>
    public TimeSpan StartupWait { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>Command timeout of the migrations at startup (schema changes may take longer than a request).</summary>
    public static TimeSpan MigrationCommandTimeout { get; } = TimeSpan.FromMinutes(10);

    /// <summary>How long Npgsql waits for the answer to the cancel request of a timed-out statement.</summary>
    internal static TimeSpan CancellationTimeout { get; } = TimeSpan.FromSeconds(1);

    /// <summary>Messages for invalid values, naming the keys.</summary>
    public IEnumerable<string> Validate()
    {
        foreach (var (key, value, min, max) in new[]
        {
            ("Database:ConnectTimeout", ConnectTimeout, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(1)),
            ("Database:CommandTimeout", CommandTimeout, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(10)),
            ("Database:ProbeInterval", ProbeInterval, TimeSpan.FromMilliseconds(100), TimeSpan.FromMinutes(1)),
            ("Database:StartupWait", StartupWait, TimeSpan.Zero, TimeSpan.FromMinutes(30)),
        })
        {
            if (value < min || value > max)
            {
                yield return string.Create(CultureInfo.InvariantCulture, $"{key} must be between {min:c} and {max:c} (is {value:c}).");
            }
        }
    }

    /// <summary>
    /// The connection string with the timeouts of these options. <paramref name="pooled"/> false is for the probe of
    /// <see cref="DatabaseCircuit"/>, which must reach the server instead of reusing an idle pooled connection.
    /// </summary>
    public string Apply(string connectionString, bool pooled = true)
    {
        ArgumentException.ThrowIfNullOrEmpty(connectionString);
        var builder = new NpgsqlConnectionStringBuilder(connectionString)
        {
            Timeout = WholeSeconds(ConnectTimeout),
            CommandTimeout = WholeSeconds(CommandTimeout),
            CancellationTimeout = (int)CancellationTimeout.TotalMilliseconds,
        };
        if (!pooled)
        {
            builder.Pooling = false;
        }

        return builder.ConnectionString;
    }

    private static int WholeSeconds(TimeSpan value) => Math.Max(1, (int)Math.Ceiling(value.TotalSeconds));
}
