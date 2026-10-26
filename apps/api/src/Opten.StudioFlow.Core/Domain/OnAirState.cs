using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// What is on air, reduced to what the tally needs (spec 4.6): the broadcast state, the sources of non-hidden items
/// in the program and preview scenes, and the audio channels that are audible in the program (issue #7).
/// </summary>
public sealed class OnAirState
{
    private OnAirState(BroadcastState broadcast, HashSet<string> programSources, HashSet<string> previewSources, HashSet<string> audibleSources)
    {
        Broadcast = broadcast;
        ProgramSources = programSources;
        PreviewSources = previewSources;
        AudibleSources = audibleSources;
    }

    /// <summary>Broadcast state.</summary>
    public BroadcastState Broadcast { get; }

    /// <summary>Sources visible in the program scene.</summary>
    public IReadOnlySet<string> ProgramSources { get; }

    /// <summary>Sources visible in the preview scene.</summary>
    public IReadOnlySet<string> PreviewSources { get; }

    /// <summary>
    /// Sources of the audio channels that are audible in the program: the broadcast is live, the channel is not muted, its
    /// fader is up and its mode lets it through (the Studio Mode preview is never audible).
    /// </summary>
    public IReadOnlySet<string> AudibleSources { get; }

    /// <summary>Derives the state from a production with its scenes.</summary>
    public static OnAirState From(Production production)
    {
        ArgumentNullException.ThrowIfNull(production);
        HashSet<string> program = [.. production.FindScene(production.ProgramSceneId)?.VisibleSources ?? []];
        return new OnAirState(
            production.Broadcast,
            program,
            [.. production.FindScene(production.PreviewSceneId)?.VisibleSources ?? []],
            [.. production.AudioChannels.Where(c => AudioMixerRules.IsAudible(c, production.Broadcast, program)).Select(c => c.SourceId)]);
    }

    /// <summary>
    /// Tally of a device: per slot <c>program</c> when a visible item shows it in the program scene, else
    /// <c>preview</c> when in the preview scene, else <c>off</c>; overall the maximum. Everything is off unless the
    /// broadcast is live. A microphone slot is <c>program</c> while its channel is audible (it is never in the preview);
    /// it does not count for the overall state, which is about the picture: a phone whose microphone is on air but whose
    /// camera is not must not tell its owner that they are on camera.
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
            if (!string.Equals(slot, DeviceSlots.Mic, StringComparison.Ordinal))
            {
                overall = state > overall ? state : overall;
            }
        }

        return new TallyDto(overall, perSlot);
    }

    private TallyState StateOf(string sourceId)
    {
        if (Broadcast != BroadcastState.Live)
        {
            return TallyState.Off;
        }

        if (ProgramSources.Contains(sourceId) || AudibleSources.Contains(sourceId))
        {
            return TallyState.Program;
        }

        return PreviewSources.Contains(sourceId) ? TallyState.Preview : TallyState.Off;
    }
}
