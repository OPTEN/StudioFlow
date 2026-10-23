using System.Globalization;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Slot codes (spec 4.4): K = camera, S = screen, M = media, followed by the lowest number of that letter that is free in
/// the production when the source is created. Codes never change while the source exists.
/// </summary>
public static class SlotCodes
{
    /// <summary>Letter of a source kind.</summary>
    public static char LetterOf(SourceKind kind) => kind switch
    {
        SourceKind.Camera => 'K',
        SourceKind.Screen => 'S',
        _ => 'M',
    };

    /// <summary>Allocates the lowest free code for <paramref name="kind"/> given every code in use in the production.</summary>
    public static string Allocate(SourceKind kind, IEnumerable<string> codesInUse)
    {
        ArgumentNullException.ThrowIfNull(codesInUse);
        var letter = LetterOf(kind);
        var used = new HashSet<int>();
        foreach (var code in codesInUse)
        {
            if (code.Length > 1 && code[0] == letter && int.TryParse(code.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var number))
            {
                used.Add(number);
            }
        }

        var next = 1;
        while (used.Contains(next))
        {
            next++;
        }

        return letter + next.ToString(CultureInfo.InvariantCulture);
    }
}
