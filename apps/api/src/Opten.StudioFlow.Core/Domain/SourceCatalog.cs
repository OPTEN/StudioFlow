using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>A source of a production: a device slot or an asset, with its code, kind and label.</summary>
/// <param name="Id">Source reference.</param>
/// <param name="Code">Slot code.</param>
/// <param name="Kind">Source kind.</param>
/// <param name="Label">Display label.</param>
/// <param name="Device">Owning device for device slots.</param>
/// <param name="Slot">Slot for device slots.</param>
/// <param name="Asset">Asset for media sources.</param>
/// <param name="Text">Content of a text source.</param>
public sealed record SourceEntry(string Id, string Code, SourceKind Kind, string Label, Device? Device, DeviceSlot? Slot, Asset? Asset, TextSourceDto? Text = null);

/// <summary>All sources of a production, built from its devices, assets and texts (spec 4.4).</summary>
public sealed class SourceCatalog
{
    private readonly Dictionary<string, SourceEntry> entries = new(StringComparer.Ordinal);

    /// <summary>Builds the catalog.</summary>
    public SourceCatalog(IEnumerable<Device> devices, IEnumerable<Asset> assets, IEnumerable<TextSourceDto>? texts = null)
    {
        ArgumentNullException.ThrowIfNull(devices);
        ArgumentNullException.ThrowIfNull(assets);
        foreach (var device in devices)
        {
            foreach (var slot in device.Slots)
            {
                var id = device.SourceIdOf(slot);
                entries[id] = new SourceEntry(id, slot.Code, slot.Kind, device.LabelOf(slot), device, slot, null);
            }
        }

        foreach (var asset in assets)
        {
            entries[asset.Id] = new SourceEntry(asset.Id, asset.Code, asset.SourceKind, asset.Name, null, null, asset);
        }

        foreach (var text in texts ?? [])
        {
            entries[text.Id] = TextEntry(text);
        }
    }

    /// <summary>The catalog entry of a text source; its label is the first line.</summary>
    public static SourceEntry TextEntry(TextSourceDto text)
    {
        ArgumentNullException.ThrowIfNull(text);
        return new SourceEntry(text.Id, text.Code, SourceKind.Text, text.Line1, null, null, null, text);
    }

    /// <summary>Every source in a stable order: device slots by code, then media and texts by code.</summary>
    public IReadOnlyList<SourceEntry> All => [.. entries.Values.OrderBy(e => e.Device is null).ThenBy(e => e.Code[0]).ThenBy(e => e.Code.Length).ThenBy(e => e.Code, StringComparer.Ordinal)];

    /// <summary>Every slot code in use (for the allocation of new codes).</summary>
    public IEnumerable<string> CodesInUse => entries.Values.Select(e => e.Code);

    /// <summary>True when the source exists.</summary>
    public bool Contains(string sourceId) => entries.ContainsKey(sourceId);

    /// <summary>The source with the given reference, if any.</summary>
    public SourceEntry? Find(string sourceId) => entries.GetValueOrDefault(sourceId);

    /// <summary>True when <paramref name="sourceId"/> is a text source of the production.</summary>
    public bool IsText(string? sourceId) => sourceId is not null && entries.TryGetValue(sourceId, out var entry) && entry.Kind == SourceKind.Text;

    /// <summary>True when <paramref name="assetId"/> is an image asset of the production.</summary>
    public bool IsImageAsset(string? assetId) => assetId is not null && entries.TryGetValue(assetId, out var entry) && entry.Kind == SourceKind.Image;
}
