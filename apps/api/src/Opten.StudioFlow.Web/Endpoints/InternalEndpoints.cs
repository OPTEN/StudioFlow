using System.Net;
using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Web.Endpoints;

/// <summary>
/// Routes for the other services of the stack. Caddy proxies only <c>/api/*</c>, <c>/hubs/*</c> and <c>/rtc</c>, so these
/// routes are not reachable from outside; only a container of the compose network can call them.
/// </summary>
internal static partial class InternalEndpoints
{
    /// <summary>Path of the "ask" endpoint of Caddy's on-demand TLS.</summary>
    public const string TlsAskPath = "/internal/tls/ask";

    /// <summary>How many different names Caddy may ask a certificate for per minute (every one costs a signature and a file).</summary>
    private const int NewNamesPerMinute = 60;

    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Caddy asks before it makes a certificate of the local CA for a name or an address nobody configured (a browser that
    /// opens the first-run wizard by IP address): any host name or IP address of a sensible form is allowed, everything
    /// else is refused, and no more than <see cref="NewNamesPerMinute"/> names per minute.
    /// </summary>
    public static IResult AskTls(string? domain, TlsAskGate gate)
    {
        if (!IsHostOrAddress(domain) || !gate.TryAdmit(domain!))
        {
            return TypedResults.StatusCode(StatusCodes.Status403Forbidden);
        }

        return TypedResults.Ok();
    }

    internal static bool IsHostOrAddress(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 253)
        {
            return false;
        }

        return IPAddress.TryParse(value, out _) || HostPattern().IsMatch(value);
    }

    [GeneratedRegex(@"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$", RegexOptions.CultureInvariant, 1000)]
    private static partial Regex HostPattern();

    /// <summary>Counts the names admitted in the last minute.</summary>
    internal sealed class TlsAskGate(TimeProvider clock)
    {
        private readonly Lock gate = new();
        private readonly Queue<DateTimeOffset> admitted = new();

        public bool TryAdmit(string name)
        {
            ArgumentNullException.ThrowIfNull(name);
            lock (gate)
            {
                var now = clock.GetUtcNow();
                while (admitted.Count > 0 && now - admitted.Peek() > Window)
                {
                    admitted.Dequeue();
                }

                if (admitted.Count >= NewNamesPerMinute)
                {
                    return false;
                }

                admitted.Enqueue(now);
                return true;
            }
        }
    }
}
