namespace Opten.StudioFlow.Core.Contracts;

/// <summary>Scene: ordered items on a fixed 1920 × 1080 canvas. Item order is the z-order (first = back).</summary>
/// <param name="Id">Scene id, e.g. <c>scn_…</c>.</param>
/// <param name="Name">Display name, 1–80 characters.</param>
/// <param name="SortOrder">Position in the scene list, 0-based (keys 1–9 select the first nine).</param>
/// <param name="Version">Increments with every change of this scene.</param>
/// <param name="LayoutMode">Free geometry or Auto-Grid.</param>
/// <param name="Background">Canvas background.</param>
/// <param name="Items">Items, back to front.</param>
public sealed record SceneDto(
    string Id,
    string Name,
    int SortOrder,
    int Version,
    SceneLayoutMode LayoutMode,
    SceneBackgroundDto Background,
    IReadOnlyList<SceneItemDto> Items);

/// <summary>Canvas background: a colour and an optional image asset on top of it.</summary>
/// <param name="Color">Hex colour <c>#rrggbb</c>.</param>
/// <param name="AssetId">Optional image asset, drawn with cover fit.</param>
public sealed record SceneBackgroundDto(string Color, string? AssetId);

/// <summary>Element of a scene (OBS: scene item). Geometry is in canvas pixels.</summary>
/// <param name="Id">Item id, e.g. <c>itm_…</c>; unique within the scene.</param>
/// <param name="Source">Source reference: <c>{deviceId}/{slot}</c> for device slots, <c>{assetId}</c> for media.</param>
/// <param name="X">Left edge, -3840…3840.</param>
/// <param name="Y">Top edge, -2160…2160.</param>
/// <param name="W">Width, 16…3840.</param>
/// <param name="H">Height, 16…2160.</param>
/// <param name="Fit">Cover or contain.</param>
/// <param name="Crop">Crop per side as a fraction of the source picture.</param>
/// <param name="Radius">Corner radius in canvas pixels, 0…200.</param>
/// <param name="Mirror">Mirror horizontally.</param>
/// <param name="Rotation">Rotation in degrees: 0, 90, 180 or 270.</param>
/// <param name="Hidden">Hidden items are not rendered.</param>
/// <param name="Locked">Locked items cannot be moved in the editor.</param>
/// <param name="Border">Optional border.</param>
/// <param name="OnLost">Behaviour when the source fails.</param>
public sealed record SceneItemDto(
    string Id,
    string Source,
    int X,
    int Y,
    int W,
    int H,
    ItemFit Fit,
    CropDto Crop,
    int Radius,
    bool Mirror,
    int Rotation,
    bool Hidden,
    bool Locked,
    BorderDto? Border,
    LostBehaviorDto OnLost);

/// <summary>Crop per side as a fraction (0–0.45) of the source picture. Opposite sides sum to less than 0.9.</summary>
public sealed record CropDto(double Top, double Right, double Bottom, double Left);

/// <summary>Border drawn inside the item rectangle.</summary>
/// <param name="Width">Width in canvas pixels, 1–40.</param>
/// <param name="Color">Hex colour <c>#rrggbb</c>.</param>
public sealed record BorderDto(int Width, string Color);

/// <summary>Fallback when the source of an item fails.</summary>
/// <param name="HoldMs">How long the last frame stays sharp (0…600000 ms); null keeps it forever. Afterwards the frame is blurred and darkened with “Picture returns shortly”, or the fallback source is shown.</param>
/// <param name="FallbackSource">Optional replacement source reference (e.g. a pause slate image).</param>
public sealed record LostBehaviorDto(int? HoldMs, string? FallbackSource);

/// <summary>Request to create a scene.</summary>
/// <param name="Name">Name of the new scene.</param>
/// <param name="CloneFromSceneId">Copy items, layout mode and background from this scene.</param>
public sealed record CreateSceneRequest(string Name, string? CloneFromSceneId);

/// <summary>Partial update of scene settings. Null fields stay unchanged.</summary>
public sealed record UpdateSceneRequest(string? Name, SceneLayoutMode? LayoutMode, SceneBackgroundDto? Background);

/// <summary>New order of all scenes; must contain every scene id exactly once.</summary>
public sealed record ReorderScenesRequest(IReadOnlyList<string> SceneIds);

/// <summary>Request to add a source to a scene. Missing values are chosen by the server (1240/680, 600 × 338, radius 12, contain for screens).</summary>
public sealed record AddSceneItemRequest(
    string Source,
    int? X,
    int? Y,
    int? W,
    int? H,
    ItemFit? Fit,
    int? Radius);

/// <summary>New z-order of a scene: the ids of all its items, back to front. Only the order changes, never an item.</summary>
/// <param name="ItemIds">Every item id of the scene exactly once; a list that does not match the current items is a 409 <c>conflict</c>.</param>
public sealed record ReorderSceneItemsRequest(IReadOnlyList<string> ItemIds);

/// <summary>Replaces all items of a scene (templates, undo/redo, reordering).</summary>
/// <param name="Items">Complete new item list, back to front.</param>
/// <param name="LayoutMode">Optional new layout mode (the Auto-Grid template sets <see cref="SceneLayoutMode.AutoGrid"/>).</param>
public sealed record ReplaceSceneItemsRequest(IReadOnlyList<SceneItemDto> Items, SceneLayoutMode? LayoutMode);
