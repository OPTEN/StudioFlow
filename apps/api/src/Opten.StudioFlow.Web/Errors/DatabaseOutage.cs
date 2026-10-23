using Opten.StudioFlow.Infrastructure.Persistence;

namespace Opten.StudioFlow.Web.Errors;

/// <summary>
/// Recognises a database that is down or unreachable (GAP-32): requests that need it answer 503
/// <c>service_unavailable</c>, hub methods a <c>service_unavailable</c> error, while the hub connections stay open. The
/// short database timeouts and the <see cref="DatabaseCircuit"/> make that answer arrive within a few seconds (BUG-21),
/// and the circuit's probe ends the outage by itself once PostgreSQL is back, without a restart.
/// </summary>
internal static class DatabaseOutage
{
    /// <summary>German message for the Regie.</summary>
    public const string Message = "Die Datenbank ist im Moment nicht erreichbar. Bitte gleich nochmals versuchen.";

    /// <summary>Retry hint of a 503.</summary>
    public static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(5);

    /// <summary>True when the exception (or one of its inner exceptions) is a transient database failure.</summary>
    public static bool IsOutage(Exception exception) => DatabaseFailures.IsOutage(exception);
}
