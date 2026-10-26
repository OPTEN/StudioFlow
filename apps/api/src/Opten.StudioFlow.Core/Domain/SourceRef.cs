using System.Diagnostics.CodeAnalysis;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// A parsed source reference as stored in scene items: <c>{deviceId}/{slot}</c> for a device slot, <c>{assetId}</c> for
/// an uploaded image or video or <c>{textId}</c> for a text (spec 4.4). Mirrors <c>parseSourceRef</c> in
/// <c>packages/scene-model</c>.
/// </summary>
public readonly record struct SourceRef
{
    private SourceRef(string? deviceId, string? slot, string? assetId, string? textId)
    {
        DeviceId = deviceId;
        Slot = slot;
        AssetId = assetId;
        TextId = textId;
    }

    /// <summary>Device id for device slots.</summary>
    public string? DeviceId { get; }

    /// <summary>Slot name for device slots.</summary>
    public string? Slot { get; }

    /// <summary>Asset id for media sources.</summary>
    public string? AssetId { get; }

    /// <summary>Text id for text sources.</summary>
    public string? TextId { get; }

    /// <summary>True for a device slot, false for an asset or a text.</summary>
    [MemberNotNullWhen(true, nameof(DeviceId), nameof(Slot))]
    public bool IsDevice => DeviceId is not null;

    /// <summary>The reference of a device slot.</summary>
    public static string ForDevice(string deviceId, string slot) => $"{deviceId}/{slot}";

    /// <summary>Parses a reference; returns false for malformed input.</summary>
    public static bool TryParse([NotNullWhen(true)] string? value, out SourceRef sourceRef)
    {
        sourceRef = default;
        if (string.IsNullOrEmpty(value))
        {
            return false;
        }

        var slash = value.IndexOf('/', StringComparison.Ordinal);
        if (slash < 0)
        {
            if (EntityIds.IsValid(value, EntityIds.Asset))
            {
                sourceRef = new SourceRef(null, null, value, null);
                return true;
            }

            if (EntityIds.IsValid(value, EntityIds.Text))
            {
                sourceRef = new SourceRef(null, null, null, value);
                return true;
            }

            return false;
        }

        var deviceId = value[..slash];
        var slot = value[(slash + 1)..];
        if (!EntityIds.IsValid(deviceId, EntityIds.Device) || !DeviceSlots.IsValid(slot))
        {
            return false;
        }

        sourceRef = new SourceRef(deviceId, slot, null, null);
        return true;
    }

    /// <inheritdoc />
    public override string ToString() => IsDevice ? ForDevice(DeviceId, Slot) : AssetId ?? TextId ?? string.Empty;
}
