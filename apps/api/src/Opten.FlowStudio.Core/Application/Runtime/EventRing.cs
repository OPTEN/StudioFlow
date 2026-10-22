using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>
/// The last events of a production (spec 6), for delta resubscribes. Revisions in the ring are contiguous, so a client
/// at revision <c>r</c> can be served from the ring when <c>r + 1</c> is still buffered (or <c>r</c> is current).
/// </summary>
public sealed class EventRing(int capacity)
{
    /// <summary>Default capacity per production.</summary>
    public const int DefaultCapacity = 500;

    private readonly Queue<ProductionEvent> events = new(capacity);

    /// <summary>Number of buffered events.</summary>
    public int Count => events.Count;

    /// <summary>Appends an event and drops the oldest one when full.</summary>
    public void Add(ProductionEvent productionEvent)
    {
        ArgumentNullException.ThrowIfNull(productionEvent);
        if (events.Count == capacity)
        {
            events.Dequeue();
        }

        events.Enqueue(productionEvent);
    }

    /// <summary>
    /// Returns every event after <paramref name="since"/> when the ring still holds all of them; false when a snapshot is
    /// needed (unknown, too old or future revision).
    /// </summary>
    public bool TryGetSince(long since, long current, out IReadOnlyList<ProductionEvent> missed)
    {
        missed = [];
        if (since == current)
        {
            return true;
        }

        if (since > current || events.Count == 0 || since < events.Peek().Revision - 1)
        {
            return false;
        }

        missed = [.. events.Where(e => e.Revision > since)];
        return true;
    }
}
