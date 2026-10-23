using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Application.Runtime;

/// <summary>One revision as the Regie and as the output page see it (same revision, possibly <c>revisionOnly</c> for the output).</summary>
/// <param name="Studio">The full event.</param>
/// <param name="Output">The output variant (spec 6, GAP-07).</param>
public sealed record RecordedEvent(ProductionEvent Studio, ProductionEvent Output);

/// <summary>
/// The last events of a production (spec 6), for delta resubscribes. Revisions in the ring are contiguous, so a client
/// at revision <c>r</c> can be served from the ring when <c>r + 1</c> is still buffered (or <c>r</c> is current).
/// </summary>
public sealed class EventRing(int capacity)
{
    /// <summary>Default capacity per production.</summary>
    public const int DefaultCapacity = 500;

    private readonly Queue<RecordedEvent> events = new(capacity);

    /// <summary>Number of buffered events.</summary>
    public int Count => events.Count;

    /// <summary>Appends an event with its default output variant and drops the oldest one when full.</summary>
    public void Add(ProductionEvent productionEvent)
    {
        ArgumentNullException.ThrowIfNull(productionEvent);
        Add(new RecordedEvent(productionEvent, OutputView.ForOutput(productionEvent)));
    }

    /// <summary>Appends an event and drops the oldest one when full.</summary>
    public void Add(RecordedEvent recorded)
    {
        ArgumentNullException.ThrowIfNull(recorded);
        if (events.Count == capacity)
        {
            events.Dequeue();
        }

        events.Enqueue(recorded);
    }

    /// <summary>
    /// Returns every event after <paramref name="since"/> when the ring still holds all of them; false when a snapshot is
    /// needed (unknown, too old or future revision).
    /// </summary>
    public bool TryGetSince(long since, long current, out IReadOnlyList<ProductionEvent> missed)
    {
        var found = TryGetRange(since, current, out var range);
        missed = [.. range.Select(e => e.Studio)];
        return found;
    }

    /// <summary>The output variant of <see cref="TryGetSince"/>: hidden changes are <c>revisionOnly</c>.</summary>
    public bool TryGetOutputSince(long since, long current, out IReadOnlyList<ProductionEvent> missed)
    {
        var found = TryGetRange(since, current, out var range);
        missed = [.. range.Select(e => e.Output)];
        return found;
    }

    private bool TryGetRange(long since, long current, out IReadOnlyList<RecordedEvent> range)
    {
        range = [];
        if (since == current)
        {
            return true;
        }

        if (since > current || events.Count == 0 || since < events.Peek().Studio.Revision - 1)
        {
            return false;
        }

        range = [.. events.Where(e => e.Studio.Revision > since)];
        return true;
    }
}
