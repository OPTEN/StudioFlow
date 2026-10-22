using System.Data.Common;
using Microsoft.EntityFrameworkCore.Storage;

namespace Opten.FlowStudio.Web.Errors;

/// <summary>
/// Recognises a database that is down or unreachable (GAP-32): requests that need it answer 503
/// <c>service_unavailable</c>, hub methods a <c>service_unavailable</c> error, while the hub connections stay open. Npgsql
/// reconnects by itself, so the API recovers without a restart once PostgreSQL is back.
/// </summary>
internal static class DatabaseOutage
{
    /// <summary>German message for the Regie.</summary>
    public const string Message = "Die Datenbank ist im Moment nicht erreichbar. Bitte gleich nochmals versuchen.";

    /// <summary>Retry hint of a 503.</summary>
    public static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(5);

    /// <summary>True when the exception (or one of its inner exceptions) is a transient database failure.</summary>
    public static bool IsOutage(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is RetryLimitExceededException or DbException { IsTransient: true })
            {
                return true;
            }
        }

        return false;
    }
}
