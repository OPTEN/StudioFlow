using System.Globalization;
using System.Runtime.CompilerServices;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>An export that is ready to be written: <see cref="Rows"/> entries, read from the database while they are written.</summary>
/// <param name="Entries">The entries, newest first.</param>
/// <param name="Rows">How many entries there are.</param>
public sealed record AuditExport(IAsyncEnumerable<AuditEntryDto> Entries, int Rows);

/// <summary>Reads and exports the audit log for the Regie (spec 4.9). Entries are only ever read here, never changed.</summary>
public sealed class AuditLogService(IAuditLog log, IUnitOfWorkFactory data, AuditOptions options, TimeProvider clock)
{
    /// <summary>Entries per page when the client does not say.</summary>
    public const int DefaultLimit = 50;

    /// <summary>Most entries per page.</summary>
    public const int MaxLimit = 200;

    /// <summary>Export format <c>csv</c>.</summary>
    public const string Csv = "csv";

    /// <summary>Export format <c>json</c>.</summary>
    public const string Json = "json";

    /// <summary>One page of entries, newest first. The cursor of the previous page continues where it ended, even while new entries arrive.</summary>
    public async Task<AuditPageDto> QueryAsync(AuditFilterInput input, string? cursor, int? limit, CancellationToken cancellationToken)
    {
        var filter = AuditFilter.Create(input);
        var errors = new ValidationErrors();
        AuditCursor? after = null;
        if (cursor is { Length: > 0 })
        {
            if (AuditCursor.TryParse(cursor, out var parsed))
            {
                after = parsed;
            }
            else
            {
                errors.Add("cursor", "The cursor is invalid.");
            }
        }

        var pageSize = limit ?? DefaultLimit;
        if (pageSize is < 1 or > MaxLimit)
        {
            errors.Add("limit", $"The limit must be between 1 and {MaxLimit.ToString(CultureInfo.InvariantCulture)}.");
        }

        errors.ThrowIfAny();

        // One more than asked for tells whether there is a next page.
        var rows = await log.QueryAsync(filter, after, pageSize + 1, cancellationToken);
        var page = rows.Take(pageSize).ToList();
        var next = rows.Count > pageSize ? new AuditCursor(page[^1].At, page[^1].Id).Encode() : null;
        return new AuditPageDto([.. page.Select(ToDto)], next);
    }

    /// <summary>
    /// Starts an export of the filtered entries. An export of more than <see cref="AuditOptions.ExportMaxRows"/> rows is
    /// refused (409 <c>limit_reached</c>) instead of cut short. The export itself is logged as <c>audit.exported</c>.
    /// </summary>
    public async Task<AuditExport> StartExportAsync(AuditFilterInput input, string format, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(format);
        var filter = AuditFilter.Create(input);
        var rows = await log.CountAsync(filter, options.ExportMaxRows + 1, cancellationToken);
        if (rows > options.ExportMaxRows)
        {
            throw StudioFlowException.Conflict(
                ErrorCodes.LimitReached,
                string.Create(CultureInfo.InvariantCulture, $"An export has at most {options.ExportMaxRows} rows. Narrow the time range or the filters."));
        }

        var details = new Dictionary<string, string>(filter.ToDetails(), StringComparer.Ordinal)
        {
            [AuditDetails.Format] = format,
            [AuditDetails.Rows] = rows.ToString(CultureInfo.InvariantCulture),
        };
        await using (var unit = data.Create())
        {
            unit.Audit.Add(AuditEntry.Create(null, clock.StorageNow(), AuditActors.Admin, AuditActions.AuditExported, details));
            await unit.SaveChangesAsync(cancellationToken);
        }

        return new AuditExport(ReadAsync(filter, cancellationToken), rows);
    }

    private async IAsyncEnumerable<AuditEntryDto> ReadAsync(AuditFilter filter, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        await foreach (var row in log.StreamAsync(filter, options.ExportMaxRows, cancellationToken))
        {
            yield return ToDto(row);
        }
    }

    private static AuditEntryDto ToDto(AuditRow row)
    {
        var entry = AuditEntry.Create(row.ProductionId, row.At, row.Actor, row.Action, row.Details);
        var described = LogTexts.Describe(entry);
        return new AuditEntryDto(
            row.Id,
            row.At,
            row.Actor,
            row.Action,
            AuditCategories.Of(row.Action),
            row.ProductionId,
            row.ProductionName,
            described?.Code,
            described?.Params ?? new Dictionary<string, string>(StringComparer.Ordinal),
            described?.Text ?? row.Action,
            row.Details);
    }
}
