using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>
/// A scene of a production (spec 4.3): ordered items on the 1920 × 1080 canvas, back to front. Every change increments
/// <see cref="Version"/>. Items are immutable records, the list is replaced on every change.
/// </summary>
public sealed class Scene
{
    private Scene()
    {
    }

    /// <summary>Scene id.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>Owning production.</summary>
    public string ProductionId { get; private set; } = string.Empty;

    /// <summary>Display name.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>0-based position in the scene list.</summary>
    public int SortOrder { get; private set; }

    /// <summary>Change counter of this scene.</summary>
    public int Version { get; private set; }

    /// <summary>Free geometry or Auto-Grid.</summary>
    public SceneLayoutMode LayoutMode { get; private set; }

    /// <summary>Canvas background.</summary>
    public SceneBackgroundDto Background { get; private set; } = new(SceneItemRules.DefaultBackgroundColor, null);

    /// <summary>Items, back to front.</summary>
    public IReadOnlyList<SceneItemDto> Items { get; private set; } = [];

    /// <summary>Sources of all items that are not hidden.</summary>
    public IEnumerable<string> VisibleSources => Items.Where(i => !i.Hidden).Select(i => i.Source);

    /// <summary>Creates an empty scene.</summary>
    internal static Scene Create(string productionId, string name, int sortOrder) => new()
    {
        Id = EntityIds.New(EntityIds.Scene),
        ProductionId = productionId,
        Name = name,
        SortOrder = sortOrder,
        Version = 1,
        LayoutMode = SceneLayoutMode.Free,
    };

    /// <summary>Copies items (with new item ids), layout mode and background into a new scene.</summary>
    internal Scene CloneAs(string name, int sortOrder) => new()
    {
        Id = EntityIds.New(EntityIds.Scene),
        ProductionId = ProductionId,
        Name = name,
        SortOrder = sortOrder,
        Version = 1,
        LayoutMode = LayoutMode,
        Background = Background,
        Items = [.. Items.Select(i => i with { Id = EntityIds.New(EntityIds.Item) })],
    };

    /// <summary>Moves the scene to a new list position (not a content change, the version stays).</summary>
    internal void MoveTo(int sortOrder) => SortOrder = sortOrder;

    /// <summary>Applies a partial settings update; returns false when the request changes nothing.</summary>
    public bool Update(UpdateSceneRequest request, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        var name = request.Name is null ? null : TextRules.RequiredName(request.Name, TextRules.NameMax, "name", errors);
        if (request.LayoutMode is { } mode && !Enum.IsDefined(mode))
        {
            errors.Add("layoutMode", "Unbekannter Layout-Modus.");
        }

        if (request.Background is not null)
        {
            SceneItemRules.ValidateBackground(request.Background, "background", errors, catalog.IsImageAsset);
        }

        errors.ThrowIfAny();
        var changed = false;
        if (name is not null && !string.Equals(name, Name, StringComparison.Ordinal))
        {
            Name = name;
            changed = true;
        }

        if (request.LayoutMode is { } layout && layout != LayoutMode)
        {
            LayoutMode = layout;
            changed = true;
        }

        if (request.Background is { } background && background != Background)
        {
            Background = background;
            changed = true;
        }

        if (changed)
        {
            Version++;
        }

        return changed;
    }

    /// <summary>Adds a source as new front-most item with server defaults for missing geometry.</summary>
    public SceneItemDto AddItem(AddSceneItemRequest request, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        SceneItemRules.ValidateAddRequest(request, errors);
        var source = request.Source is null ? null : catalog.Find(request.Source);
        if (source is null)
        {
            errors.Add("source", "Diese Quelle gibt es nicht.");
        }

        errors.ThrowIfAny();
        if (Items.Count >= SceneItemRules.MaxItems)
        {
            throw FlowStudioException.LimitReached("Eine Szene kann höchstens 32 Elemente haben.");
        }

        var item = SceneItemRules.CreateItem(request, source!.Kind);
        Items = [.. Items, item];
        Version++;
        return item;
    }

    /// <summary>Replaces one item (last writer wins). The route id is authoritative.</summary>
    public void UpdateItem(string itemId, SceneItemDto item, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        var index = IndexOf(itemId);
        if (index < 0)
        {
            throw FlowStudioException.NotFound("Das Element");
        }

        var existing = Items[index];
        var updated = item is null ? null : item with { Id = existing.Id };
        var errors = new ValidationErrors();
        SceneItemRules.Validate(updated, "item", errors, s => IsKept(s, existing, catalog), f => IsKeptFallback(f, existing, catalog));
        errors.ThrowIfAny();
        var items = Items.ToArray();
        items[index] = updated!;
        Items = items;
        Version++;
    }

    /// <summary>Removes one item.</summary>
    public void RemoveItem(string itemId)
    {
        if (IndexOf(itemId) < 0)
        {
            throw FlowStudioException.NotFound("Das Element");
        }

        Items = [.. Items.Where(i => !string.Equals(i.Id, itemId, StringComparison.Ordinal))];
        Version++;
    }

    /// <summary>
    /// Replaces all items (templates, undo/redo, z-order). An item may keep a source that was deleted after it was added;
    /// new items need existing sources.
    /// </summary>
    public void ReplaceItems(IReadOnlyList<SceneItemDto>? items, SceneLayoutMode? layoutMode, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        if (items is null)
        {
            errors.Add("items", "Elemente fehlen.");
            errors.ThrowIfAny();
            return;
        }

        if (items.Count > SceneItemRules.MaxItems)
        {
            throw FlowStudioException.LimitReached("Eine Szene kann höchstens 32 Elemente haben.");
        }

        if (layoutMode is { } mode && !Enum.IsDefined(mode))
        {
            errors.Add("layoutMode", "Unbekannter Layout-Modus.");
        }

        var current = Items.ToDictionary(i => i.Id, StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            var existing = item?.Id is { } id ? current.GetValueOrDefault(id) : null;
            SceneItemRules.Validate(item, $"items[{i}]", errors, s => IsKept(s, existing, catalog), f => IsKeptFallback(f, existing, catalog));
            if (item?.Id is { } itemId && !seen.Add(itemId))
            {
                errors.Add($"items[{i}].id", "Element-IDs müssen eindeutig sein.");
            }
        }

        errors.ThrowIfAny();
        Items = [.. items];
        if (layoutMode is { } layout)
        {
            LayoutMode = layout;
        }

        Version++;
    }

    /// <summary>True when an item, the fallback of an item or the background uses the asset.</summary>
    public bool UsesAsset(string assetId) =>
        string.Equals(Background.AssetId, assetId, StringComparison.Ordinal)
        || Items.Any(i => string.Equals(i.Source, assetId, StringComparison.Ordinal) || string.Equals(i.OnLost?.FallbackSource, assetId, StringComparison.Ordinal));

    private static bool IsKept(string source, SceneItemDto? existing, SourceCatalog catalog) =>
        catalog.Contains(source) || string.Equals(existing?.Source, source, StringComparison.Ordinal);

    private static bool IsKeptFallback(string fallback, SceneItemDto? existing, SourceCatalog catalog) =>
        catalog.Contains(fallback) || string.Equals(existing?.OnLost?.FallbackSource, fallback, StringComparison.Ordinal);

    private int IndexOf(string itemId)
    {
        for (var i = 0; i < Items.Count; i++)
        {
            if (string.Equals(Items[i].Id, itemId, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }
}
