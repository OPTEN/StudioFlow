using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class AuditCsvTests
{
    private static AuditEntryDto Entry(string text = "Scene “Break” is live", string? production = "Webinar", IReadOnlyDictionary<string, string>? details = null) => new(
        7,
        new DateTimeOffset(2026, 10, 26, 14, 3, 12, 345, TimeSpan.Zero),
        "admin",
        "scene.live",
        AuditCategory.Production,
        "prd_x",
        production,
        LogCode.SceneLive,
        new Dictionary<string, string>(),
        text,
        details ?? new Dictionary<string, string> { ["scene"] = "Break", ["via"] = "take" });

    [Theory]
    [InlineData("plain", "plain")]
    [InlineData("", "")]
    [InlineData("a,b", "\"a,b\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("two\nlines", "\"two\nlines\"")]
    [InlineData("two\r\nlines", "\"two\r\nlines\"")]
    [InlineData("a;b", "a;b")]
    [InlineData("Zürich café “Pause”", "Zürich café “Pause”")]
    public void Cell_Comma_QuotesWhatNeedsIt(string value, string expected) => Assert.Equal(expected, AuditCsv.Cell(value, AuditCsv.Comma));

    [Fact]
    public void Cell_Semicolon_QuotesTheSemicolonNotTheComma()
    {
        Assert.Equal("\"a;b\"", AuditCsv.Cell("a;b", AuditCsv.Semicolon));
        Assert.Equal("a,b", AuditCsv.Cell("a,b", AuditCsv.Semicolon));
    }

    [Theory]
    [InlineData("=1+1", "'=1+1")]
    [InlineData("+41 79 123", "'+41 79 123")]
    [InlineData("-2+3", "'-2+3")]
    [InlineData("@SUM(A1)", "'@SUM(A1)")]
    [InlineData("\tindented", "'\tindented")]
    [InlineData("=HYPERLINK(\"http://evil\",\"x\")", "\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\"")]
    [InlineData("=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0")]
    public void Cell_FormulaStart_GetsALeadingApostrophe(string value, string expected) => Assert.Equal(expected, AuditCsv.Cell(value, AuditCsv.Comma));

    [Fact]
    public void Cell_CarriageReturnStart_IsPrefixedAndQuoted() => Assert.Equal("\"'\rx\"", AuditCsv.Cell("\rx", AuditCsv.Comma));

    [Theory]
    [InlineData("a=b")]
    [InlineData("a+b")]
    [InlineData(" =x")]
    public void Cell_FormulaCharacterInsideTheText_IsLeftAlone(string value) => Assert.Equal(value, AuditCsv.Cell(value, AuditCsv.Comma));

    [Fact]
    public void Header_UsesTheSeparatorAndCrLf() =>
        Assert.Equal("time;actor;category;action;description;production;production_id;details\r\n", AuditCsv.Header(AuditCsv.Semicolon));

    [Fact]
    public void Row_HasTheTimeInUtcTheEnglishTextAndTheDetailsAsReadableJson()
    {
        var row = AuditCsv.Row(Entry(details: new Dictionary<string, string> { ["device"] = "Zoë’s phone" }), AuditCsv.Comma);

        Assert.Equal(
            "2026-10-26T14:03:12.345Z,admin,production,scene.live,Scene “Break” is live,Webinar,prd_x,\"{\"\"device\"\":\"\"Zoë’s phone\"\"}\"\r\n",
            row);
    }

    [Fact]
    public void Row_AnEntryWithoutProduction_HasEmptyProductionCells()
    {
        var entry = Entry() with { ProductionId = null, ProductionName = null };

        Assert.Contains(",Scene “Break” is live,,,", AuditCsv.Row(entry, AuditCsv.Comma), StringComparison.Ordinal);
    }

    [Fact]
    public void Row_ADeviceNamedLikeAFormula_IsNeutralisedInTheTextAndTheDetails()
    {
        var entry = Entry(text: "=HYPERLINK(\"x\") paired", production: "-Show", details: new Dictionary<string, string> { ["device"] = "=1+1" });

        var row = AuditCsv.Row(entry, AuditCsv.Comma);

        Assert.Contains("\"'=HYPERLINK(\"\"x\"\") paired\"", row, StringComparison.Ordinal);
        Assert.Contains(",'-Show,", row, StringComparison.Ordinal);

        // The details cell starts with a brace, so the formula inside the JSON text is harmless.
        Assert.Contains("\"{\"\"device\"\":\"\"=1+1\"\"}\"", row, StringComparison.Ordinal);
    }

    [Fact]
    public void Row_EveryLineEndsWithCrLfAndNeverHoldsABareLineBreakOutsideQuotes()
    {
        var row = AuditCsv.Row(Entry(text: "line one\nline two"), AuditCsv.Comma);

        Assert.EndsWith("\r\n", row, StringComparison.Ordinal);
        Assert.Contains("\"line one\nline two\"", row, StringComparison.Ordinal);
    }
}
