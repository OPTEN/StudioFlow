using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>
/// Pending and recently decided /join requests (spec 4.6), in memory only. At most 20 requests may be pending in total;
/// check codes are unique among pending requests.
/// </summary>
public sealed class PairingRequestStore
{
    /// <summary>Maximum number of pending requests over all productions.</summary>
    public const int MaxPending = 20;

    /// <summary>Retry hint when the pending limit is reached.</summary>
    public static readonly TimeSpan FullRetryAfter = TimeSpan.FromMinutes(1);

    private readonly Lock gate = new();
    private readonly Dictionary<string, PairingRequest> requests = new(StringComparer.Ordinal);

    /// <summary>Creates a request with a unique check code; throws <c>rate_limited</c> when 20 requests are pending.</summary>
    public (PairingRequest Request, string PollToken) Create(string productionId, CreatePairingRequest input, DateTimeOffset now)
    {
        lock (gate)
        {
            var pending = requests.Values.Where(r => r.IsPending(now)).ToList();
            if (pending.Count >= MaxPending)
            {
                throw FlowStudioException.RateLimited(FullRetryAfter);
            }

            var code = PairingRequest.NewCheckCode(pending.Select(r => r.CheckCode).ToHashSet(StringComparer.Ordinal));
            var created = PairingRequest.Create(productionId, input, code, now);
            requests[created.Request.Id] = created.Request;
            return created;
        }
    }

    /// <summary>The request with the given id, if it is still known.</summary>
    public PairingRequest? Find(string requestId)
    {
        lock (gate)
        {
            return requests.GetValueOrDefault(requestId);
        }
    }

    /// <summary>Pending requests of a production, oldest first.</summary>
    public IReadOnlyList<PairingRequest> Pending(string productionId, DateTimeOffset now)
    {
        lock (gate)
        {
            return [.. requests.Values.Where(r => r.IsPending(now) && string.Equals(r.ProductionId, productionId, StringComparison.Ordinal)).OrderBy(r => r.CreatedAt)];
        }
    }

    /// <summary>Forgets a request.</summary>
    public void Remove(string requestId)
    {
        lock (gate)
        {
            requests.Remove(requestId);
        }
    }

    /// <summary>
    /// Forgets every request that is expired or was decided more than five minutes ago. Returns the requests that expired
    /// while pending (the Regie still shows their knock card).
    /// </summary>
    public IReadOnlyList<PairingRequest> RemoveExpired(DateTimeOffset now)
    {
        lock (gate)
        {
            var expired = requests.Values.Where(r => r.IsExpired(now)).ToList();
            foreach (var request in expired)
            {
                requests.Remove(request.Id);
            }

            return [.. expired.Where(r => r.Status == PairingRequestStatus.Pending)];
        }
    }
}
