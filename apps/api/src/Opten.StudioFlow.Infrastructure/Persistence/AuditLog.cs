using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// The audit log queries (<see cref="IAuditLog"/>) as parameterised SQL: the free-text search runs over the
/// <c>jsonb</c> details as text, which a LINQ query cannot express. The statement text is assembled from fixed
/// fragments only; every value of the filter travels as a parameter.
/// </summary>
internal sealed class AuditLog(IDbContextFactory<StudioFlowDbContext> contexts) : IAuditLog
{
    private const string Select = """
        SELECT a.id AS "Id", a.at AS "At", a.actor AS "Actor", a.action AS "Action", a.production_id AS "ProductionId",
               p.name AS "ProductionName", a.details::text AS "Details"
        FROM audit_entries a
        LEFT JOIN productions p ON p.id = a.production_id
        """;

    private const string NewestFirst = "ORDER BY a.at DESC, a.id DESC";

    // Phone QR codes used to be audited on every renewal (every half hour); the entries that remain are noise.
    private const string WithoutPhoneInvites = "NOT (a.action IN ('invite.created', 'invite.revoked') AND a.details ->> 'kind' = 'PhoneQr')";

    public async Task<IReadOnlyList<AuditRow>> QueryAsync(AuditFilter filter, AuditCursor? after, int limit, CancellationToken cancellationToken)
    {
        var (where, parameters) = Where(filter, after);
        parameters.Add(new NpgsqlParameter("limit", limit));
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        var records = await db.Database.SqlQueryRaw<AuditRecord>(PageSql(where), [.. parameters]).ToListAsync(cancellationToken);
        return [.. records.Select(ToRow)];
    }

    public async Task<int> CountAsync(AuditFilter filter, int limit, CancellationToken cancellationToken)
    {
        var (where, parameters) = Where(filter, after: null);
        parameters.Add(new NpgsqlParameter("limit", limit));
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        return await db.Database
            .SqlQueryRaw<int>(CountSql(where), [.. parameters])
            .SingleAsync(cancellationToken);
    }

    public async IAsyncEnumerable<AuditRow> StreamAsync(AuditFilter filter, int limit, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var (where, parameters) = Where(filter, after: null);
        parameters.Add(new NpgsqlParameter("limit", limit));
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        var records = db.Database.SqlQueryRaw<AuditRecord>(PageSql(where), [.. parameters]).AsAsyncEnumerable();
        await foreach (var record in records.WithCancellation(cancellationToken))
        {
            yield return ToRow(record);
        }
    }

    public async Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        return await db.Database.ExecuteSqlAsync(
            $"DELETE FROM audit_entries WHERE id IN (SELECT id FROM audit_entries WHERE at < {cutoff} ORDER BY at LIMIT {batchSize})",
            cancellationToken);
    }

    public async Task<int> RemoveIpAddressesOlderThanAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);

        // The predicate is the one of the partial index ix_audit_entries_at_with_ip, which only holds entries that still have an address.
        return await db.Database.ExecuteSqlAsync(
            $"UPDATE audit_entries SET details = details - 'ip' WHERE id IN (SELECT id FROM audit_entries WHERE at < {cutoff} AND (details ->> 'ip') IS NOT NULL LIMIT {batchSize})",
            cancellationToken);
    }

    // Fixed fragments around the conditions of Where(); no value of a filter is ever part of the text.
    private static string PageSql(string where) => $"{Select} WHERE {where} {NewestFirst} LIMIT @limit";

    private static string CountSql(string where) => $"SELECT COUNT(*)::int AS \"Value\" FROM (SELECT 1 FROM audit_entries a WHERE {where} LIMIT @limit) AS matching";

    private static (string Where, List<NpgsqlParameter> Parameters) Where(AuditFilter filter, AuditCursor? after)
    {
        var clauses = new List<string> { WithoutPhoneInvites };
        var parameters = new List<NpgsqlParameter>();
        if (filter.From is { } from)
        {
            clauses.Add("a.at >= @from");
            parameters.Add(new NpgsqlParameter("from", from));
        }

        if (filter.To is { } to)
        {
            clauses.Add("a.at < @to");
            parameters.Add(new NpgsqlParameter("to", to));
        }

        if (string.Equals(filter.ProductionId, AuditFilter.NoProduction, StringComparison.Ordinal))
        {
            clauses.Add("a.production_id IS NULL");
        }
        else if (filter.ProductionId is { } production)
        {
            clauses.Add("a.production_id = @production");
            parameters.Add(new NpgsqlParameter("production", production));
        }

        if (filter.Actions is { } actions)
        {
            clauses.Add("a.action = ANY(@actions)");
            parameters.Add(new NpgsqlParameter("actions", NpgsqlDbType.Array | NpgsqlDbType.Varchar) { Value = actions.ToArray() });
        }

        if (filter.Actor is { } actor)
        {
            clauses.Add("a.actor = @actor");
            parameters.Add(new NpgsqlParameter("actor", actor));
        }

        if (filter.Text is { } text)
        {
            clauses.Add("(a.details::text ILIKE @text ESCAPE '\\' OR a.action ILIKE @text ESCAPE '\\')");
            parameters.Add(new NpgsqlParameter("text", "%" + EscapeLike(text) + "%"));
        }

        if (after is { } cursor)
        {
            clauses.Add("(a.at, a.id) < (@cursorAt, @cursorId)");
            parameters.Add(new NpgsqlParameter("cursorAt", cursor.At));
            parameters.Add(new NpgsqlParameter("cursorId", cursor.Id));
        }

        return (string.Join(" AND ", clauses), parameters);
    }

    /// <summary>Makes the characters of a LIKE pattern literal.</summary>
    internal static string EscapeLike(string text) =>
        new StringBuilder(text).Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_").ToString();

    private static AuditRow ToRow(AuditRecord record) => new(
        record.Id,
        record.At,
        record.Actor,
        record.Action,
        record.ProductionId,
        record.ProductionName,
        JsonSerializer.Deserialize<Dictionary<string, string>>(record.Details, ContractJson.Options) ?? []);

    /// <summary>The columns of <see cref="Select"/>.</summary>
    private sealed record AuditRecord(long Id, DateTimeOffset At, string Actor, string Action, string? ProductionId, string? ProductionName, string Details);
}
