using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Validation and defaults of text sources and the production's text colours (spec 4.4). The server is authoritative;
/// the clients mirror the numbers (<c>TEXT_LIMITS</c> in <c>packages/scene-model</c>).
/// </summary>
public static class TextSourceRules
{
    /// <summary>Maximum number of text sources per production.</summary>
    public const int MaxPerProduction = 64;

    /// <summary>Colours of a new production.</summary>
    public static TextThemeDto DefaultTheme { get; } = new("#1f6feb", "#0d1117", "#ffffff");

    /// <summary>Alignment a new text of the style starts with: titles are centred, the others sit at the left edge.</summary>
    public static TextAlign DefaultAlign(TextStyle style) => style == TextStyle.Title ? TextAlign.Center : TextAlign.Left;

    /// <summary>
    /// Where a new item of a text lands on the canvas, inside the safe margin: the lower third at the bottom left, the
    /// title in the middle, the note in the top right corner.
    /// </summary>
    public static (int X, int Y, int W, int H) DefaultRect(TextStyle style) => style switch
    {
        TextStyle.LowerThird => (80, 820, 960, 180),
        TextStyle.Title => (160, 390, 1600, 300),
        _ => (1320, 60, 540, 96),
    };

    /// <summary>Validates and normalises the content of a text source; throws <c>validation_failed</c> with the field errors.</summary>
    public static (string Line1, string? Line2) ValidateContent(string? line1, string? line2, TextStyle style, TextAlign align)
    {
        var errors = new ValidationErrors();
        var first = TextRules.RequiredName(line1, TextRules.TextLineMax, "line1", errors);
        var second = TextRules.OptionalLine(line2, TextRules.TextLineMax, "line2", errors);
        if (!Enum.IsDefined(style))
        {
            errors.Add("style", "Unknown style.");
        }

        if (!Enum.IsDefined(align))
        {
            errors.Add("align", "Unknown alignment.");
        }

        errors.ThrowIfAny();
        return (first!, second);
    }

    /// <summary>Validates the colours of a text theme.</summary>
    public static void ValidateTheme(TextThemeDto? theme, string path, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (theme is null)
        {
            errors.Add(path, "The colours are missing.");
            return;
        }

        CheckColor(theme.Accent, $"{path}.accent", errors);
        CheckColor(theme.Background, $"{path}.background", errors);
        CheckColor(theme.Foreground, $"{path}.foreground", errors);
    }

    private static void CheckColor(string? color, string field, ValidationErrors errors)
    {
        if (!SceneItemRules.IsHexColor(color))
        {
            errors.Add(field, "Enter a colour in the format #rrggbb.");
        }
    }
}
