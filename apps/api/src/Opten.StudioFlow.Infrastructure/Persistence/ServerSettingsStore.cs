using Microsoft.EntityFrameworkCore;
using Npgsql;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// EF Core implementation of <see cref="IServerSettingsStore"/>. The row is created by the first save. A change is applied
/// to the tracked row and saved with its audit entry in one transaction; <see cref="ServerSettings.Revision"/> is the
/// concurrency token, so two saves at the same time never overwrite each other (the later one runs again on the newer row),
/// and two first saves cannot both insert the row (the primary key is the constant 1).
/// </summary>
internal sealed class ServerSettingsStore(IDbContextFactory<StudioFlowDbContext> contexts) : IServerSettingsStore
{
    private const int Attempts = 5;

    public async Task<ServerSettings?> GetAsync(CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        return await db.ServerSettings.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<ServerSettings> UpdateAsync(DateTimeOffset now, Action<ServerSettings> change, AuditEntry audit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(change);
        ArgumentNullException.ThrowIfNull(audit);
        for (var attempt = 1; ; attempt++)
        {
            await using var db = await contexts.CreateDbContextAsync(cancellationToken);
            var row = await db.ServerSettings.FirstOrDefaultAsync(cancellationToken);
            var isNew = row is null;
            row ??= ServerSettings.CreateDefault(now);
            change(row);
            if (isNew)
            {
                db.ServerSettings.Add(row);
            }

            db.AuditEntries.Add(audit);
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                db.ChangeTracker.Clear();
                return row;
            }
            catch (Exception exception) when (attempt < Attempts && (exception is DbUpdateConcurrencyException || exception is DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } }))
            {
                // Another save won: apply the change to its row.
            }
        }
    }
}
