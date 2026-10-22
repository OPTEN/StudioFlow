namespace Opten.FlowStudio.Core.Application;

/// <summary>Time values that are stored and sent to clients.</summary>
public static class ClockExtensions
{
    private const long TicksPerMicrosecond = 10;

    /// <summary>
    /// The current UTC time cut to microseconds, the precision of PostgreSQL <c>timestamptz</c>: a value in an event
    /// equals the same value read back from the database later (snapshot after event).
    /// </summary>
    public static DateTimeOffset StorageNow(this TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(clock);
        var now = clock.GetUtcNow();
        return now.AddTicks(-(now.Ticks % TicksPerMicrosecond));
    }
}
