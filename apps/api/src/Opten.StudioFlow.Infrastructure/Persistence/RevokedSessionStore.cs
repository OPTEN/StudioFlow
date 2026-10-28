using Microsoft.EntityFrameworkCore;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>EF Core implementation of <see cref="IRevokedSessionStore"/>; each call uses its own context.</summary>
internal sealed class RevokedSessionStore(IDbContextFactory<StudioFlowDbContext> contexts) : IRevokedSessionStore
{
    public async Task<IReadOnlyList<RevokedSessionEntry>> ListActiveAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        return await db.RevokedSessions.AsNoTracking()
            .Where(s => s.RevokedUntil > now)
            .Select(s => new RevokedSessionEntry(s.SessionId, s.RevokedUntil))
            .ToListAsync(cancellationToken);
    }

    public async Task SaveAsync(string sessionId, DateTimeOffset until, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        await db.Database.ExecuteSqlAsync(
            $"""
            insert into admin_revoked_session (session_id, revoked_until) values ({sessionId}, {until})
            on conflict (session_id) do update set revoked_until = greatest(admin_revoked_session.revoked_until, excluded.revoked_until)
            """,
            cancellationToken);
    }

    public async Task<int> DeleteExpiredAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        return await db.RevokedSessions.Where(s => s.RevokedUntil <= now).ExecuteDeleteAsync(cancellationToken);
    }
}
