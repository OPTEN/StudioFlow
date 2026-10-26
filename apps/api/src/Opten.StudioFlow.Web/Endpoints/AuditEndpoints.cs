using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Web.Endpoints;

/// <summary>The filter of the audit log, as query parameters (list and exports).</summary>
/// <param name="From">First moment to include (ISO 8601).</param>
/// <param name="To">First moment to leave out (ISO 8601).</param>
/// <param name="Production">A production id, or <c>none</c> for entries without a production (sign-ins, account changes).</param>
/// <param name="Category">Only these categories (repeatable): production, devices, security, media, output, system.</param>
/// <param name="Action">Only these actions (repeatable), such as <c>scene.live</c>.</param>
/// <param name="Actor"><c>admin</c>, <c>system</c> or <c>device:{id}</c>.</param>
/// <param name="Q">Text in the action code or in a detail (device name, scene, user name), any case.</param>
internal sealed record AuditFilterParameters(
    [FromQuery(Name = "from")] string? From,
    [FromQuery(Name = "to")] string? To,
    [FromQuery(Name = "production")] string? Production,
    [FromQuery(Name = "category")] string[]? Category,
    [FromQuery(Name = "action")] string[]? Action,
    [FromQuery(Name = "actor")] string? Actor,
    [FromQuery(Name = "q")] string? Q)
{
    public AuditFilterInput ToInput() => new(From, To, Production, Category, Action, Actor, Q);
}

/// <summary>The audit log: paged view and exports. Admin only, read only.</summary>
internal static class AuditEndpoints
{
    /// <summary>Value of <c>separator</c> for the semicolon (Excel in a German or Swiss installation).</summary>
    public const string SemicolonSeparator = "semicolon";

    public static async Task<IResult> ListAsync(
        [AsParameters] AuditFilterParameters filter,
        [FromQuery(Name = "cursor")] string? cursor,
        [FromQuery(Name = "limit")] int? limit,
        AuditLogService audit,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await audit.QueryAsync(filter.ToInput(), cursor, limit, cancellationToken));

    public static async Task<IResult> ExportCsvAsync(
        [AsParameters] AuditFilterParameters filter,
        [FromQuery(Name = "separator")] string? separator,
        AuditLogService audit,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var delimiter = ParseSeparator(separator);
        var export = await audit.StartExportAsync(filter.ToInput(), AuditLogService.Csv, cancellationToken);
        return new CsvResult(export, delimiter, FileName(clock, AuditLogService.Csv));
    }

    public static async Task<IResult> ExportJsonAsync(
        [AsParameters] AuditFilterParameters filter,
        AuditLogService audit,
        TimeProvider clock,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var export = await audit.StartExportAsync(filter.ToInput(), AuditLogService.Json, cancellationToken);
        context.Response.Headers.ContentDisposition = Attachment(FileName(clock, AuditLogService.Json));
        return TypedResults.Ok(export.Entries);
    }

    private static char ParseSeparator(string? separator) => separator switch
    {
        null or "" or "comma" => AuditCsv.Comma,
        SemicolonSeparator => AuditCsv.Semicolon,
        _ => throw StudioFlowException.Invalid("separator", "Use comma or semicolon."),
    };

    private static string FileName(TimeProvider clock, string extension) =>
        string.Create(CultureInfo.InvariantCulture, $"studioflow-audit-{clock.GetUtcNow():yyyy-MM-dd}.{extension}");

    private static string Attachment(string fileName) => $"attachment; filename=\"{fileName}\"";

    /// <summary>
    /// Writes the export while it is read from the database: UTF-8 with a byte order mark (Excel shows umlauts correctly
    /// with it), header row, one row per entry. Nothing is collected in memory.
    /// </summary>
    private sealed class CsvResult(AuditExport export, char separator, string fileName) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            var response = httpContext.Response;
            response.ContentType = "text/csv; charset=utf-8";
            response.Headers.ContentDisposition = Attachment(fileName);
            await using var writer = new StreamWriter(response.Body, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), bufferSize: 16 * 1024, leaveOpen: true);
            await writer.WriteAsync(AuditCsv.Header(separator));
            await foreach (var entry in export.Entries.WithCancellation(httpContext.RequestAborted))
            {
                await writer.WriteAsync(AuditCsv.Row(entry, separator));
            }
        }
    }
}
