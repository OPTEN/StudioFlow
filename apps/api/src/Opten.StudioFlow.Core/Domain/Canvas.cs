using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>Size of an output canvas in pixels.</summary>
/// <param name="Width">Width in pixels.</param>
/// <param name="Height">Height in pixels.</param>
public readonly record struct CanvasSize(int Width, int Height)
{
    /// <summary>1920 × 1080, the canvas of every production before the format became selectable.</summary>
    public static CanvasSize FullHd { get; } = new(1920, 1080);
}

/// <summary>
/// The canvases a production can have (spec 4.2): four fixed formats with two fixed resolutions each, named after the
/// short side (720 or 1080). The list is fixed so that the layout templates fit and every canvas stays inside the
/// geometry bounds of <see cref="SceneItemRules"/>. Mirrored by <c>CANVAS_SIZES</c> in <c>packages/scene-model</c>.
/// </summary>
public static class Canvases
{
    /// <summary>The format of a new production.</summary>
    public const CanvasFormat DefaultFormat = CanvasFormat.Widescreen;

    /// <summary>The resolution of a new production.</summary>
    public const CanvasResolution DefaultResolution = CanvasResolution.P1080;

    /// <summary>The canvas size of a format and resolution.</summary>
    public static CanvasSize SizeOf(CanvasFormat format, CanvasResolution resolution)
    {
        var shortSide = resolution == CanvasResolution.P720 ? 720 : 1080;
        return format switch
        {
            CanvasFormat.Widescreen => new CanvasSize(shortSide * 16 / 9, shortSide),
            CanvasFormat.Portrait => new CanvasSize(shortSide, shortSide * 16 / 9),
            CanvasFormat.Square => new CanvasSize(shortSide, shortSide),
            _ => new CanvasSize(shortSide * 4 / 3, shortSide),
        };
    }

    /// <summary>The canvas as the wire contract.</summary>
    public static CanvasDto Dto(CanvasFormat format, CanvasResolution resolution)
    {
        var size = SizeOf(format, resolution);
        return new CanvasDto(format, resolution, size.Width, size.Height);
    }

    /// <summary>The format and resolution of a change request; throws <c>validation_failed</c> when one is missing or not on the fixed list.</summary>
    public static (CanvasFormat Format, CanvasResolution Resolution) Required(CanvasFormat? format, CanvasResolution? resolution)
    {
        var errors = new ValidationErrors();
        if (format is null)
        {
            errors.Add("format", "The format is missing.");
        }

        if (resolution is null)
        {
            errors.Add("resolution", "The resolution is missing.");
        }

        errors.ThrowIfAny();
        return (format!.Value, resolution!.Value);
    }

    /// <summary>Adds an error for each value of the request that is not on the fixed list.</summary>
    public static void Validate(CanvasFormat format, CanvasResolution resolution, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (!Enum.IsDefined(format))
        {
            errors.Add("format", "Unknown format.");
        }

        if (!Enum.IsDefined(resolution))
        {
            errors.Add("resolution", "Unknown resolution.");
        }
    }

    /// <summary>
    /// Places a rectangle of the 1920 × 1080 reference layout on a canvas (defaults of new items). The size scales with
    /// the smaller of the two axis factors, so the rectangle keeps its shape (a text keeps its proportions, a picture its
    /// 16:9). On each axis the rectangle stays at the edge it is nearest to, with its distance scaled, or in the middle
    /// when that is nearest, so a note in the top right corner stays in that corner and a title stays centred on every
    /// canvas. Mirrored by <c>placeOnCanvas</c> in <c>packages/scene-model</c>.
    /// </summary>
    public static (int X, int Y, int W, int H) Place(CanvasSize canvas, int x, int y, int w, int h)
    {
        var reference = CanvasSize.FullHd;
        var size = Math.Min(canvas.Width / (double)reference.Width, canvas.Height / (double)reference.Height);
        return (
            Round(PlaceSpan(x, w, reference.Width, canvas.Width, size)),
            Round(PlaceSpan(y, h, reference.Height, canvas.Height, size)),
            Round(w * size),
            Round(h * size));
    }

    private static double PlaceSpan(int start, int length, int reference, int canvasLength, double size)
    {
        var before = start;
        var after = reference - start - length;
        var middle = Math.Abs(start + (length / 2d) - (reference / 2d));
        var scaled = length * size;
        if (middle <= Math.Min(before, after))
        {
            return (canvasLength / 2d) + ((start + (length / 2d) - (reference / 2d)) * size) - (scaled / 2);
        }

        return after < before ? canvasLength - (after * size) - scaled : before * size;
    }

    private static int Round(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);
}
