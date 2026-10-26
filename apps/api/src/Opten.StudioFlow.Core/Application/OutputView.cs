using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// What the output page may see (spec 6): production, scenes, sources and assets. Device, pairing, invite, incident,
/// log and output status events become <see cref="RevisionOnlyEvent"/> with the same revision; sources carry no health.
/// </summary>
public static class OutputView
{
    /// <summary>The output variant of an event.</summary>
    public static ProductionEvent ForOutput(ProductionEvent productionEvent)
    {
        ArgumentNullException.ThrowIfNull(productionEvent);
        return productionEvent switch
        {
            ProductionChangedEvent or ProductionCanvasChangedEvent or ProgramSwitchedEvent or SceneUpsertedEvent or SceneRemovedEvent or ScenesReorderedEvent
                or SourceRemovedEvent or AssetUpsertedEvent or AssetRemovedEvent => productionEvent,
            SourceUpsertedEvent upserted => upserted with { Source = WithoutHealth(upserted.Source) },
            _ => new RevisionOnlyEvent(productionEvent.Revision),
        };
    }

    /// <summary>A source without health information (always <c>ok</c>, no timestamp).</summary>
    public static SourceDto WithoutHealth(SourceDto source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return source with { Status = SourceStatus.Ok, StatusSince = null };
    }
}
