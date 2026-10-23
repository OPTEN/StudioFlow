using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>
/// What is on air, reduced to what the tally needs (spec 4.6): the broadcast state and the sources of non-hidden items
/// in the program and preview scenes.
/// </summary>
public sealed class OnAirState
{
    private OnAirState(BroadcastState broadcast, HashSet<string> programSources, HashSet<string> previewSources)
    {
        Broadcast = broadcast;
        ProgramSources = programSources;
        PreviewSources = previewSources;
    }

    /// <summary>Broadcast state.</summary>
    public BroadcastState Broadcast { get; }

    /// <summary>Sources visible in the program scene.</summary>
    public IReadOnlySet<string> ProgramSources { get; }

    /// <summary>Sources visible in the preview scene.</summary>
    public IReadOnlySet<string> PreviewSources { get; }

    /// <summary>Derives the state from a production with its scenes.</summary>
    public static OnAirState From(Production production)
    {
        ArgumentNullException.ThrowIfNull(production);
        return new OnAirState(
            production.Broadcast,
            [.. production.FindScene(production.ProgramSceneId)?.VisibleSources ?? []],
            [.. production.FindScene(production.PreviewSceneId)?.VisibleSources ?? []]);
    }

    /// <summary>
    /// Tally of a device: per slot <c>program</c> when a visible item shows it in the program scene, else
    /// <c>preview</c> when in the preview scene, else <c>off</c>; overall the maximum. Everything is off unless the
    /// broadcast is live.
    /// </summary>
    public TallyDto TallyFor(string deviceId, IEnumerable<string> slots)
    {
        ArgumentNullException.ThrowIfNull(slots);
        var perSlot = new Dictionary<string, TallyState>(StringComparer.Ordinal);
        var overall = TallyState.Off;
        foreach (var slot in slots)
        {
            var state = StateOf(SourceRef.ForDevice(deviceId, slot));
            perSlot[slot] = state;
            overall = state > overall ? state : overall;
        }

        return new TallyDto(overall, perSlot);
    }

    private TallyState StateOf(string sourceId)
    {
        if (Broadcast != BroadcastState.Live)
        {
            return TallyState.Off;
        }

        if (ProgramSources.Contains(sourceId))
        {
            return TallyState.Program;
        }

        return PreviewSources.Contains(sourceId) ? TallyState.Preview : TallyState.Off;
    }
}
