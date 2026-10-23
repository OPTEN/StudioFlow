using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Validation bounds and defaults of scene items and backgrounds (spec 4.3). The server is authoritative; the clients
/// clamp with the same numbers (<c>ITEM_BOUNDS</c> in <c>packages/scene-model</c>). The item contract records are
/// immutable value objects and serve as the domain's item type, so there is no parallel copy of the same shape.
/// </summary>
public static partial class SceneItemRules
{
    /// <summary>Maximum number of items per scene.</summary>
    public const int MaxItems = 32;

    /// <summary>Smallest left edge.</summary>
    public const int MinX = -3840;

    /// <summary>Largest left edge.</summary>
    public const int MaxX = 3840;

    /// <summary>Smallest top edge.</summary>
    public const int MinY = -2160;

    /// <summary>Largest top edge.</summary>
    public const int MaxY = 2160;

    /// <summary>Smallest width and height.</summary>
    public const int MinSize = 16;

    /// <summary>Largest width.</summary>
    public const int MaxW = 3840;

    /// <summary>Largest height.</summary>
    public const int MaxH = 2160;

    /// <summary>Largest crop per side.</summary>
    public const double MaxCropPerSide = 0.45;

    /// <summary>Upper bound (exclusive) of the crop of two opposite sides.</summary>
    public const double MaxCropPerAxis = 0.9;

    /// <summary>Largest corner radius.</summary>
    public const int MaxRadius = 200;

    /// <summary>Largest border width.</summary>
    public const int MaxBorderWidth = 40;

    /// <summary>Largest hold time of the last frame.</summary>
    public const int MaxHoldMs = 600_000;

    /// <summary>Default hold time of new items.</summary>
    public const int DefaultHoldMs = 3000;

    /// <summary>Default background colour of new scenes.</summary>
    public const string DefaultBackgroundColor = "#0d1117";

    private static readonly int[] Rotations = [0, 90, 180, 270];

    /// <summary>Crop without cropping.</summary>
    public static CropDto NoCrop { get; } = new(0, 0, 0, 0);

    /// <summary>Creates a new item with the server defaults for every value the request leaves open.</summary>
    public static SceneItemDto CreateItem(AddSceneItemRequest request, SourceKind kind)
    {
        ArgumentNullException.ThrowIfNull(request);
        return new SceneItemDto(
            EntityIds.New(EntityIds.Item),
            request.Source,
            request.X ?? 1240,
            request.Y ?? 680,
            request.W ?? 600,
            request.H ?? 338,
            request.Fit ?? (kind == SourceKind.Screen ? ItemFit.Contain : ItemFit.Cover),
            NoCrop,
            request.Radius ?? 12,
            Mirror: false,
            Rotation: 0,
            Hidden: false,
            Locked: false,
            Border: null,
            OnLost: new LostBehaviorDto(DefaultHoldMs, null));
    }

    /// <summary>
    /// Validates one item. <paramref name="isSourceAllowed"/> decides whether a (syntactically valid) source reference may
    /// be used: it must exist, unless the item already showed it before it was deleted.
    /// </summary>
    public static void Validate(SceneItemDto? item, string path, ValidationErrors errors, Func<string, bool> isSourceAllowed, Func<string, bool> isFallbackAllowed)
    {
        ArgumentNullException.ThrowIfNull(errors);
        ArgumentNullException.ThrowIfNull(isSourceAllowed);
        ArgumentNullException.ThrowIfNull(isFallbackAllowed);
        if (item is null)
        {
            errors.Add(path, "Element fehlt.");
            return;
        }

        if (!EntityIds.IsValid(item.Id, EntityIds.Item))
        {
            errors.Add($"{path}.id", "Ungültige Element-ID.");
        }

        if (!SourceRef.TryParse(item.Source, out _))
        {
            errors.Add($"{path}.source", "Ungültige Quelle.");
        }
        else if (!isSourceAllowed(item.Source))
        {
            errors.Add($"{path}.source", "Diese Quelle gibt es nicht.");
        }

        CheckRange(item.X, MinX, MaxX, $"{path}.x", errors);
        CheckRange(item.Y, MinY, MaxY, $"{path}.y", errors);
        CheckRange(item.W, MinSize, MaxW, $"{path}.w", errors);
        CheckRange(item.H, MinSize, MaxH, $"{path}.h", errors);
        CheckRange(item.Radius, 0, MaxRadius, $"{path}.radius", errors);
        if (!Enum.IsDefined(item.Fit))
        {
            errors.Add($"{path}.fit", "Unbekannte Einpassung.");
        }

        if (!Rotations.Contains(item.Rotation))
        {
            errors.Add($"{path}.rotation", "Erlaubt sind 0, 90, 180 oder 270 Grad.");
        }

        ValidateCrop(item.Crop, $"{path}.crop", errors);
        ValidateBorder(item.Border, $"{path}.border", errors);
        ValidateOnLost(item, $"{path}.onLost", errors, isFallbackAllowed);
    }

    /// <summary>Validates the geometry overrides of <see cref="AddSceneItemRequest"/>.</summary>
    public static void ValidateAddRequest(AddSceneItemRequest request, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(errors);
        CheckOptionalRange(request.X, MinX, MaxX, "x", errors);
        CheckOptionalRange(request.Y, MinY, MaxY, "y", errors);
        CheckOptionalRange(request.W, MinSize, MaxW, "w", errors);
        CheckOptionalRange(request.H, MinSize, MaxH, "h", errors);
        CheckOptionalRange(request.Radius, 0, MaxRadius, "radius", errors);
        if (request.Fit is { } fit && !Enum.IsDefined(fit))
        {
            errors.Add("fit", "Unbekannte Einpassung.");
        }
    }

    /// <summary>Validates a scene background: hex colour and an optional image asset.</summary>
    public static void ValidateBackground(SceneBackgroundDto? background, string path, ValidationErrors errors, Func<string, bool> isImageAsset)
    {
        ArgumentNullException.ThrowIfNull(errors);
        ArgumentNullException.ThrowIfNull(isImageAsset);
        if (background is null)
        {
            errors.Add(path, "Hintergrund fehlt.");
            return;
        }

        if (!IsHexColor(background.Color))
        {
            errors.Add($"{path}.color", "Farbe im Format #rrggbb angeben.");
        }

        if (background.AssetId is not null && !isImageAsset(background.AssetId))
        {
            errors.Add($"{path}.assetId", "Als Hintergrund ist nur ein Bild möglich.");
        }
    }

    /// <summary>True for <c>#rrggbb</c>.</summary>
    public static bool IsHexColor(string? value) => value is not null && HexColor().IsMatch(value);

    private static void ValidateCrop(CropDto? crop, string path, ValidationErrors errors)
    {
        if (crop is null)
        {
            errors.Add(path, "Zuschnitt fehlt.");
            return;
        }

        CheckCropSide(crop.Top, $"{path}.top", errors);
        CheckCropSide(crop.Right, $"{path}.right", errors);
        CheckCropSide(crop.Bottom, $"{path}.bottom", errors);
        CheckCropSide(crop.Left, $"{path}.left", errors);
        if (crop.Top + crop.Bottom >= MaxCropPerAxis)
        {
            errors.Add($"{path}.bottom", "Oben und unten zusammen müssen unter 90 % bleiben.");
        }

        if (crop.Left + crop.Right >= MaxCropPerAxis)
        {
            errors.Add($"{path}.right", "Links und rechts zusammen müssen unter 90 % bleiben.");
        }
    }

    private static void ValidateBorder(BorderDto? border, string path, ValidationErrors errors)
    {
        if (border is null)
        {
            return;
        }

        CheckRange(border.Width, 1, MaxBorderWidth, $"{path}.width", errors);
        if (!IsHexColor(border.Color))
        {
            errors.Add($"{path}.color", "Farbe im Format #rrggbb angeben.");
        }
    }

    private static void ValidateOnLost(SceneItemDto item, string path, ValidationErrors errors, Func<string, bool> isFallbackAllowed)
    {
        if (item.OnLost is null)
        {
            errors.Add(path, "Verhalten bei Ausfall fehlt.");
            return;
        }

        if (item.OnLost.HoldMs is { } hold && (hold < 0 || hold > MaxHoldMs))
        {
            errors.Add($"{path}.holdMs", $"Muss zwischen 0 und {MaxHoldMs} ms liegen.");
        }

        var fallback = item.OnLost.FallbackSource;
        if (fallback is null)
        {
            return;
        }

        if (!SourceRef.TryParse(fallback, out _))
        {
            errors.Add($"{path}.fallbackSource", "Ungültige Ersatzquelle.");
        }
        else if (string.Equals(fallback, item.Source, StringComparison.Ordinal))
        {
            errors.Add($"{path}.fallbackSource", "Die Ersatzquelle muss eine andere Quelle sein.");
        }
        else if (!isFallbackAllowed(fallback))
        {
            errors.Add($"{path}.fallbackSource", "Diese Quelle gibt es nicht.");
        }
    }

    private static void CheckCropSide(double value, string field, ValidationErrors errors)
    {
        if (double.IsNaN(value) || value < 0 || value > MaxCropPerSide)
        {
            errors.Add(field, "Muss zwischen 0 und 0,45 liegen.");
        }
    }

    private static void CheckRange(int value, int min, int max, string field, ValidationErrors errors)
    {
        if (value < min || value > max)
        {
            errors.Add(field, $"Muss zwischen {min} und {max} liegen.");
        }
    }

    private static void CheckOptionalRange(int? value, int min, int max, string field, ValidationErrors errors)
    {
        if (value is { } v)
        {
            CheckRange(v, min, max, field, errors);
        }
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant)]
    private static partial Regex HexColor();
}
