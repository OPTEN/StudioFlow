using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Rules of the placeholders of a copied production (spec 4.4, issue #14): the device sources of the original, kept as
/// a place for the scene items until the operator assigns a source to them. A placeholder has a made-up device id, so
/// its source reference is valid but belongs to no device and the item shows “Source missing”.
/// </summary>
public static partial class SourcePlaceholders
{
    /// <summary>Maximum number of placeholders per production.</summary>
    public const int MaxPerProduction = 100;

    /// <summary>Creates a placeholder with a new id and a new, unused device id for its source reference.</summary>
    public static SourcePlaceholderDto Create(string code, SourceKind kind, string slot, string? label)
    {
        if (!IsValidCode(code, kind) || !DeviceSlots.IsValid(slot))
        {
            throw new ArgumentException("Invalid placeholder.");
        }

        return New(code, kind, slot, label);
    }

    /// <summary>A placeholder without the checks of <see cref="Create"/>; the caller validated the values (or reports the error).</summary>
    internal static SourcePlaceholderDto New(string code, SourceKind kind, string slot, string? label) =>
        new(EntityIds.New(EntityIds.Placeholder), SourceRef.ForDevice(EntityIds.New(EntityIds.Device), slot), code, kind, TextRules.Truncate(label, TextRules.NameMax));

    /// <summary>True for a slot code of a device source: K1… for a camera, S1… for a screen.</summary>
    public static bool IsValidCode(string? code, SourceKind kind) =>
        code is not null && (kind is SourceKind.Camera or SourceKind.Screen) && CodePattern().IsMatch(code) && code[0] == SlotCodes.LetterOf(kind);

    /// <summary>The slot name a placeholder of the kind gets when the original slot is not known.</summary>
    public static string DefaultSlot(SourceKind kind) => kind == SourceKind.Screen ? DeviceSlots.Screen(1) : DeviceSlots.Camera;

    /// <summary>The kind of a device slot, or null for a name that is no slot.</summary>
    public static SourceKind? KindOfSlot(string slot) =>
        slot == DeviceSlots.Camera ? SourceKind.Camera : DeviceSlots.ScreenNumber(slot) is not null ? SourceKind.Screen : null;

    [GeneratedRegex("^[KS][1-9][0-9]{0,3}$", RegexOptions.CultureInvariant)]
    private static partial Regex CodePattern();
}
