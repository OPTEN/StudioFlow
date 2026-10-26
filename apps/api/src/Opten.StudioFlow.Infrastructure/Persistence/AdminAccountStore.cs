using Microsoft.EntityFrameworkCore;
using Npgsql;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// EF Core implementation of <see cref="IAdminAccountStore"/>. Each method uses its own context and writes the account and
/// its audit entry in one transaction. Creating relies on the primary key: of two concurrent setups the database lets
/// exactly one insert succeed.
/// </summary>
internal sealed class AdminAccountStore(IDbContextFactory<StudioFlowDbContext> contexts) : IAdminAccountStore
{
    public async Task<AdminAccount?> GetAsync(CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        return await db.AdminAccounts.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<bool> TryCreateAsync(AdminAccount account, AuditEntry audit, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        db.AdminAccounts.Add(account);
        db.AuditEntries.Add(audit);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return false;
        }
    }

    public async Task<bool> TryUpdateAsync(AdminAccount account, AuditEntry audit, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        db.AdminAccounts.Update(account);
        db.AuditEntries.Add(audit);
        return await TrySaveAsync(db, cancellationToken);
    }

    public async Task<bool> TryDeleteAsync(AuditEntry audit, CancellationToken cancellationToken)
    {
        await using var db = await contexts.CreateDbContextAsync(cancellationToken);
        var account = await db.AdminAccounts.FirstOrDefaultAsync(cancellationToken);
        if (account is null)
        {
            return false;
        }

        db.AdminAccounts.Remove(account);
        db.AuditEntries.Add(audit);
        return await TrySaveAsync(db, cancellationToken);
    }

    /// <summary>Saves; false when the account row was changed or deleted by someone else meanwhile.</summary>
    private static async Task<bool> TrySaveAsync(StudioFlowDbContext db, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            return false;
        }
    }
}
