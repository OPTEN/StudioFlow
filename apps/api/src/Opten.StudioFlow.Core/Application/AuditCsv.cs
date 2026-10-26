using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// The CSV export of the audit log: RFC 4180 quoting with CRLF line ends, English column names and the English text of
/// each entry. A cell that starts with a character a spreadsheet treats as a formula (<c>= + - @</c>, tab, carriage
/// return) gets a leading <c>'</c>, so a device named <c>=HYPERLINK(…)</c> is shown as text and never run.
/// </summary>
public static class AuditCsv
{
    /// <summary>The separator Excel expects in an English installation.</summary>
    public const char Comma = ',';

    /// <summary>The separator Excel expects in a German or Swiss installation.</summary>
    public const char Semicolon = ';';

    private const string LineEnd = "\r\n";

    private static readonly string[] Columns = ["time", "actor", "category", "action", "description", "production", "production_id", "details"];

    private static readonly char[] FormulaStarts = ['=', '+', '-', '@', '\t', '\r'];

    // The details are read by people in a spreadsheet: umlauts stay readable instead of becoming escape sequences.
    private static readonly JsonSerializerOptions DetailsJson = new(JsonSerializerDefaults.Web) { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>The header row.</summary>
    public static string Header(char separator) => string.Join(separator, Columns) + LineEnd;

    /// <summary>The row of an entry.</summary>
    public static string Row(AuditEntryDto entry, char separator)
    {
        ArgumentNullException.ThrowIfNull(entry);
        string[] cells =
        [
            entry.At.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
            entry.Actor,
            entry.Category.ToString().ToLowerInvariant(),
            entry.Action,
            entry.Text,
            entry.ProductionName ?? string.Empty,
            entry.ProductionId ?? string.Empty,
            JsonSerializer.Serialize(entry.Details, DetailsJson),
        ];
        return string.Join(separator, cells.Select(cell => Cell(cell, separator))) + LineEnd;
    }

    /// <summary>One cell: protected against formulas, and quoted when it holds the separator, a quote or a line break.</summary>
    public static string Cell(string value, char separator)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Length > 0 && Array.IndexOf(FormulaStarts, value[0]) >= 0)
        {
            value = "'" + value;
        }

        return value.AsSpan().IndexOfAny([separator, '"', '\r', '\n']) >= 0 ? "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : value;
    }
}
