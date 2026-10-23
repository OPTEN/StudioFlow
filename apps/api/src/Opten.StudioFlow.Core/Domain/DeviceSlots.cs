using System.Globalization;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>Slot names of a device: <c>camera</c> and <c>screen-1</c> … <c>screen-9</c>; the slot is the LiveKit track name.</summary>
public static class DeviceSlots
{
    /// <summary>The camera slot.</summary>
    public const string Camera = "camera";

    /// <summary>Maximum number of screen slots per device.</summary>
    public const int MaxScreens = 9;

    private const string ScreenPrefix = "screen-";

    /// <summary>Name of screen slot <paramref name="number"/> (1–9).</summary>
    public static string Screen(int number)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(number, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(number, MaxScreens);
        return ScreenPrefix + number.ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>True for <c>camera</c> and <c>screen-1</c> … <c>screen-9</c>.</summary>
    public static bool IsValid(string? slot) => slot == Camera || ScreenNumber(slot) is not null;

    /// <summary>Number of a screen slot, or null when <paramref name="slot"/> is not a screen slot.</summary>
    public static int? ScreenNumber(string? slot)
    {
        if (slot is null || slot.Length != ScreenPrefix.Length + 1 || !slot.StartsWith(ScreenPrefix, StringComparison.Ordinal))
        {
            return null;
        }

        var digit = slot[^1];
        return digit is >= '1' and <= '9' ? digit - '0' : null;
    }
}
