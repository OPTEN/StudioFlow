using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>Rules for program transitions (spec 4.2): a cut has no duration, a fade uses one of the fixed durations.</summary>
public static class Transitions
{
    /// <summary>Allowed fade durations in milliseconds.</summary>
    public static IReadOnlyList<int> FadeDurationsMs { get; } = [200, 300, 500, 800, 1000, 1500, 2000];

    /// <summary>A hard cut.</summary>
    public static TransitionDto Cut { get; } = new(TransitionKind.Cut, 0);

    /// <summary>Validates a requested transition and normalises a cut to a duration of 0.</summary>
    public static TransitionDto Normalize(TransitionDto? transition, string field = "transition")
    {
        if (transition is null)
        {
            throw FlowStudioException.Invalid(field, "Übergang fehlt.");
        }

        return transition.Kind switch
        {
            TransitionKind.Cut => Cut,
            TransitionKind.Fade when FadeDurationsMs.Contains(transition.DurationMs) => new TransitionDto(TransitionKind.Fade, transition.DurationMs),
            TransitionKind.Fade => throw FlowStudioException.Invalid($"{field}.durationMs", "Erlaubt sind 200, 300, 500, 800, 1000, 1500 oder 2000 ms."),
            _ => throw FlowStudioException.Invalid($"{field}.kind", "Unbekannter Übergang."),
        };
    }
}
