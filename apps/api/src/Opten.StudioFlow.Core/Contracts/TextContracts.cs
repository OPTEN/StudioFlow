namespace Opten.StudioFlow.Core.Contracts;

/// <summary>
/// A text or lower third (source kind <see cref="SourceKind.Text"/>). Scene items reference it by its <c>Id</c>, so
/// editing the text changes every scene that shows it. The renderer draws it as HTML text, never as a picture.
/// </summary>
/// <param name="Id">Source reference, e.g. <c>txt_…</c>.</param>
/// <param name="Code">Slot code T1, T2, …</param>
/// <param name="Line1">Main line (a name or a title), 1–120 characters.</param>
/// <param name="Line2">Optional second line (a role), at most 120 characters.</param>
/// <param name="Style">Design of the text.</param>
/// <param name="Align">Horizontal alignment; the lower third ignores it.</param>
public sealed record TextSourceDto(string Id, string Code, string Line1, string? Line2, TextStyle Style, TextAlign Align);

/// <summary>Colours of all texts of a production (accent, background and text colour), each <c>#rrggbb</c>.</summary>
/// <param name="Accent">Accent bar or rule.</param>
/// <param name="Background">Bar behind the text.</param>
/// <param name="Foreground">Text colour.</param>
public sealed record TextThemeDto(string Accent, string Background, string Foreground);

/// <summary>Request to create a text source.</summary>
/// <param name="Line1">Main line.</param>
/// <param name="Line2">Optional second line.</param>
/// <param name="Style">Design of the text.</param>
/// <param name="Align">Alignment; the style's default when missing.</param>
public sealed record CreateTextSourceRequest(string Line1, string? Line2, TextStyle Style, TextAlign? Align);

/// <summary>Replaces the content of a text source (last writer wins).</summary>
/// <param name="Line1">Main line.</param>
/// <param name="Line2">Optional second line.</param>
/// <param name="Style">Design of the text.</param>
/// <param name="Align">Alignment.</param>
public sealed record UpdateTextSourceRequest(string Line1, string? Line2, TextStyle Style, TextAlign Align);
