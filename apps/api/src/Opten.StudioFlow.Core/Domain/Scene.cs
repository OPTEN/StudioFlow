using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// A scene of a production (spec 4.3): ordered items on the canvas of the production, back to front. Every change increments
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

    /// <summary>
    /// A scene of a production that is built from an export (duplicate, import): every value is already validated and the
    /// items carry their new ids. The version starts at 1 like any new scene.
    /// </summary>
    internal static Scene Restore(string productionId, string name, int sortOrder, SceneLayoutMode layoutMode, SceneBackgroundDto background, IReadOnlyList<SceneItemDto> items) => new()
    {
        Id = EntityIds.New(EntityIds.Scene),
        ProductionId = productionId,
        Name = name,
        SortOrder = sortOrder,
        Version = 1,
        LayoutMode = layoutMode,
        Background = background,
        Items = items,
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

    /// <summary>
    /// Moves every item from one canvas to another (see <see cref="CanvasFit"/>); returns false for a scene without items,
    /// which has nothing to move. The background is drawn to cover the canvas and needs no change.
    /// </summary>
    internal bool FitTo(CanvasSize from, CanvasSize to)
    {
        if (Items.Count == 0)
        {
            return false;
        }

        Items = [.. Items.Select(item => CanvasFit.Item(item, from, to))];
        Version++;
        return true;
    }

    /// <summary>Applies a partial settings update; returns false when the request changes nothing.</summary>
    public bool Update(UpdateSceneRequest request, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        var name = request.Name is null ? null : TextRules.RequiredName(request.Name, TextRules.NameMax, "name", errors);
        if (request.LayoutMode is { } mode && !Enum.IsDefined(mode))
        {
            errors.Add("layoutMode", "Unknown layout mode.");
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

    /// <summary>Adds a source as new front-most item with server defaults for missing geometry, placed on the canvas.</summary>
    public SceneItemDto AddItem(AddSceneItemRequest request, SourceCatalog catalog, CanvasSize canvas)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        SceneItemRules.ValidateAddRequest(request, errors);
        var source = request.Source is null ? null : catalog.Find(request.Source);
        if (source is null)
        {
            errors.Add("source", "This source does not exist.");
        }
        else if (source.Kind == SourceKind.Audio)
        {
            errors.Add("source", "An audio source has no picture.");
        }

        errors.ThrowIfAny();
        if (Items.Count >= SceneItemRules.MaxItems)
        {
            throw StudioFlowException.LimitReached("A scene can have at most 32 items.");
        }

        var item = SceneItemRules.CreateItem(request, source!, canvas);
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
            throw StudioFlowException.NotFound("Item");
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
            throw StudioFlowException.NotFound("Item");
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
            errors.Add("items", "The items are missing.");
            errors.ThrowIfAny();
            return;
        }

        if (items.Count > SceneItemRules.MaxItems)
        {
            throw StudioFlowException.LimitReached("A scene can have at most 32 items.");
        }

        if (layoutMode is { } mode && !Enum.IsDefined(mode))
        {
            errors.Add("layoutMode", "Unknown layout mode.");
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
                errors.Add($"items[{i}].id", "Item IDs must be unique.");
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

    /// <summary>
    /// Applies a new z-order without touching any item: the ids must be exactly the current item ids, otherwise the
    /// caller worked on an outdated list (409). Returns false when the order is unchanged.
    /// </summary>
    public bool ReorderItems(IReadOnlyList<string>? itemIds)
    {
        if (itemIds is null)
        {
            throw StudioFlowException.Invalid("itemIds", "The item ids are missing.");
        }

        var byId = Items.ToDictionary(i => i.Id, StringComparer.Ordinal);
        if (itemIds.Count != byId.Count || itemIds.Distinct(StringComparer.Ordinal).Count() != byId.Count || !itemIds.All(byId.ContainsKey))
        {
            throw StudioFlowException.Conflict(ErrorCodes.Conflict, "The order must contain exactly the items of the scene.");
        }

        if (Items.Select(i => i.Id).SequenceEqual(itemIds, StringComparer.Ordinal))
        {
            return false;
        }

        Items = [.. itemIds.Select(id => byId[id])];
        Version++;
        return true;
    }

    /// <summary>True when an item, the fallback of an item or the background uses the asset.</summary>
    public bool UsesAsset(string assetId) =>
        string.Equals(Background.AssetId, assetId, StringComparison.Ordinal)
        || Items.Any(i => string.Equals(i.Source, assetId, StringComparison.Ordinal) || string.Equals(i.OnLost?.FallbackSource, assetId, StringComparison.Ordinal));

    /// <summary>True when an item or the fallback of an item shows the source.</summary>
    public bool UsesSource(string sourceId) =>
        Items.Any(i => string.Equals(i.Source, sourceId, StringComparison.Ordinal) || string.Equals(i.OnLost.FallbackSource, sourceId, StringComparison.Ordinal));

    /// <summary>
    /// Lets every item that shows <paramref name="from"/> (a placeholder) show <paramref name="to"/> instead, as item and as
    /// fallback; with a null <paramref name="to"/> the items are removed and the fallbacks cleared. A fallback that would
    /// then equal the source of its item is cleared (an item cannot be its own fallback). Returns whether the scene changed
    /// (its version is incremented) and how many items changed their source or were removed.
    /// </summary>
    internal (bool Changed, int Items) ReplaceSource(string from, string? to)
    {
        var items = new List<SceneItemDto>(Items.Count);
        var affected = 0;
        var changed = false;
        foreach (var item in Items)
        {
            var next = item;
            if (string.Equals(next.Source, from, StringComparison.Ordinal))
            {
                affected++;
                changed = true;
                if (to is null)
                {
                    continue;
                }

                next = next with { Source = to };
            }

            if (string.Equals(next.OnLost.FallbackSource, from, StringComparison.Ordinal))
            {
                next = next with { OnLost = next.OnLost with { FallbackSource = to } };
                changed = true;
            }

            if (next.OnLost.FallbackSource is { } fallback && string.Equals(fallback, next.Source, StringComparison.Ordinal))
            {
                next = next with { OnLost = next.OnLost with { FallbackSource = null } };
                changed = true;
            }

            items.Add(next);
        }

        if (!changed)
        {
            return (false, 0);
        }

        Items = items;
        Version++;
        return (true, affected);
    }

    /// <summary>Removes every item that shows the source (a deleted text); returns false when there was none.</summary>
    internal bool RemoveItemsOf(string sourceId)
    {
        var remaining = Items.Where(i => !string.Equals(i.Source, sourceId, StringComparison.Ordinal)).ToList();
        if (remaining.Count == Items.Count)
        {
            return false;
        }

        Items = remaining;
        Version++;
        return true;
    }

    private static bool IsKept(string source, SceneItemDto? existing, SourceCatalog catalog) =>
        (catalog.Contains(source) && !catalog.IsAudioOnly(source)) || string.Equals(existing?.Source, source, StringComparison.Ordinal);

    private static bool IsKeptFallback(string fallback, SceneItemDto? existing, SourceCatalog catalog) =>
        (catalog.Contains(fallback) && !catalog.IsText(fallback) && !catalog.IsAudioOnly(fallback)) || string.Equals(existing?.OnLost?.FallbackSource, fallback, StringComparison.Ordinal);

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
