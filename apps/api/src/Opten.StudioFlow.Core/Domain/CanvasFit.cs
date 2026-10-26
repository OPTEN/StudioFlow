using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Moves scene items from one canvas to another: everything is scaled by one factor, the largest that lets the old canvas
/// fit into the new one, and centred. For the same format that factor is the resolution ratio and nothing moves off
/// centre, so a resolution change is proportional and lossless up to rounding; for another format the old canvas ends up
/// as a centred rectangle inside the new one. Crops are fractions of the picture and stay as they are.
/// </summary>
public static class CanvasFit
{
    /// <summary>The item on the new canvas.</summary>
    public static SceneItemDto Item(SceneItemDto item, CanvasSize from, CanvasSize to)
    {
        ArgumentNullException.ThrowIfNull(item);
        var scale = Math.Min(to.Width / (double)from.Width, to.Height / (double)from.Height);
        var offsetX = (to.Width - (from.Width * scale)) / 2;
        var offsetY = (to.Height - (from.Height * scale)) / 2;
        return item with
        {
            X = Rounded((item.X * scale) + offsetX, SceneItemRules.MinX, SceneItemRules.MaxX),
            Y = Rounded((item.Y * scale) + offsetY, SceneItemRules.MinY, SceneItemRules.MaxY),
            W = Rounded(item.W * scale, SceneItemRules.MinSize, SceneItemRules.MaxW),
            H = Rounded(item.H * scale, SceneItemRules.MinSize, SceneItemRules.MaxH),
            Radius = Rounded(item.Radius * scale, 0, SceneItemRules.MaxRadius),
            Border = item.Border is { } border ? border with { Width = Rounded(border.Width * scale, 1, SceneItemRules.MaxBorderWidth) } : null,
        };
    }

    private static int Rounded(double value, int min, int max) => Math.Clamp((int)Math.Round(value, MidpointRounding.AwayFromZero), min, max);
}
