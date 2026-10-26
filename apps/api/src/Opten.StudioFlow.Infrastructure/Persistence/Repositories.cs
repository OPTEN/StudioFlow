using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>EF Core implementation of <see cref="IProductionRepository"/>.</summary>
internal sealed class ProductionRepository(StudioFlowDbContext db) : IProductionRepository
{
    public Task<Production?> GetAsync(string productionId, CancellationToken cancellationToken) =>
        db.Productions.Include(p => p.Scenes).AsSplitQuery().FirstOrDefaultAsync(p => p.Id == productionId, cancellationToken);

    public async Task<IReadOnlyList<Production>> ListAsync(CancellationToken cancellationToken) =>
        await db.Productions.AsNoTracking().OrderBy(p => p.CreatedAt).ToListAsync(cancellationToken);

    public Task<Production?> GetActiveAsync(string tenantId, CancellationToken cancellationToken) =>
        db.Productions.AsNoTracking().FirstOrDefaultAsync(p => p.TenantId == tenantId && p.IsActive, cancellationToken);

    public Task<bool> ExistsAsync(string productionId, CancellationToken cancellationToken) =>
        db.Productions.AnyAsync(p => p.Id == productionId, cancellationToken);

    public Task<string?> GetNameAsync(string productionId, CancellationToken cancellationToken) =>
        db.Productions.Where(p => p.Id == productionId).Select(p => p.Name).FirstOrDefaultAsync(cancellationToken);

    public Task<bool> AnyLiveAsync(CancellationToken cancellationToken) =>
        db.Productions.AnyAsync(p => p.Broadcast == BroadcastState.Live, cancellationToken);

    public void Add(Production production) => db.Productions.Add(production);
}

/// <summary>EF Core implementation of <see cref="IOutputLinkRepository"/>.</summary>
internal sealed class OutputLinkRepository(StudioFlowDbContext db) : IOutputLinkRepository
{
    public Task<OutputLink?> GetAsync(string productionId, string linkId, CancellationToken cancellationToken) =>
        db.OutputLinks.FirstOrDefaultAsync(l => l.Id == linkId && l.ProductionId == productionId, cancellationToken);

    public async Task<IReadOnlyList<OutputLink>> ListAsync(string productionId, CancellationToken cancellationToken) =>
        await db.OutputLinks.Where(l => l.ProductionId == productionId).OrderBy(l => l.CreatedAt).ThenBy(l => l.Id).ToListAsync(cancellationToken);

    public Task<IReadOnlyList<OutputLinkAccess>> ListAccessAsync(string productionId, CancellationToken cancellationToken) =>
        AccessAsync(p => p.Id == productionId, cancellationToken);

    public Task<IReadOnlyList<OutputLinkAccess>> ListAccessBySlugAsync(string slug, CancellationToken cancellationToken) =>
        AccessAsync(p => p.Slug == slug, cancellationToken);

    public Task<IReadOnlyList<OutputLinkAccess>> ListAllAccessAsync(CancellationToken cancellationToken) =>
        AccessAsync(_ => true, cancellationToken);

    public void Add(OutputLink link) => db.OutputLinks.Add(link);

    public void Remove(OutputLink link) => db.OutputLinks.Remove(link);

    private async Task<IReadOnlyList<OutputLinkAccess>> AccessAsync(Expression<Func<Production, bool>> production, CancellationToken cancellationToken) =>
        await db.OutputLinks.AsNoTracking()
            .Join(db.Productions.Where(p => p.TenantId == Production.DefaultTenant).Where(production), l => l.ProductionId, p => p.Id, (l, p) => new OutputLinkAccess(p.Id, p.Slug, l.Id, l.Name, l.Key, l.AllowedIps))
            .ToListAsync(cancellationToken);
}

/// <summary>EF Core implementation of <see cref="IDeviceRepository"/>.</summary>
internal sealed class DeviceRepository(StudioFlowDbContext db) : IDeviceRepository
{
    public Task<Device?> GetAsync(string deviceId, CancellationToken cancellationToken) =>
        db.Devices.FirstOrDefaultAsync(d => d.Id == deviceId, cancellationToken);

    public async Task<IReadOnlyList<Device>> ListAsync(string productionId, CancellationToken cancellationToken) =>
        await db.Devices.Where(d => d.ProductionId == productionId).OrderBy(d => d.PairedAt).ToListAsync(cancellationToken);

    public void Add(Device device) => db.Devices.Add(device);

    public void Remove(Device device) => db.Devices.Remove(device);
}

/// <summary>EF Core implementation of <see cref="IAssetRepository"/>.</summary>
internal sealed class AssetRepository(StudioFlowDbContext db) : IAssetRepository
{
    public Task<Asset?> GetAsync(string productionId, string assetId, CancellationToken cancellationToken) =>
        db.Assets.FirstOrDefaultAsync(a => a.Id == assetId && a.ProductionId == productionId, cancellationToken);

    public async Task<IReadOnlyList<Asset>> ListAsync(string productionId, CancellationToken cancellationToken) =>
        await db.Assets.Where(a => a.ProductionId == productionId).OrderBy(a => a.CreatedAt).ToListAsync(cancellationToken);

    public void Add(Asset asset) => db.Assets.Add(asset);

    public void Remove(Asset asset) => db.Assets.Remove(asset);
}

/// <summary>EF Core implementation of <see cref="IInviteRepository"/>.</summary>
internal sealed class InviteRepository(StudioFlowDbContext db) : IInviteRepository
{
    public Task<Invite?> GetAsync(string productionId, string inviteId, CancellationToken cancellationToken) =>
        db.Invites.FirstOrDefaultAsync(i => i.Id == inviteId && i.ProductionId == productionId, cancellationToken);

    public Task<Invite?> GetByTokenAsync(string token, CancellationToken cancellationToken) =>
        db.Invites.FirstOrDefaultAsync(i => i.Token == token, cancellationToken);

    public async Task<IReadOnlyList<Invite>> ListOpenAsync(string productionId, DateTimeOffset now, CancellationToken cancellationToken) =>
        await db.Invites.Where(i => i.ProductionId == productionId && i.RedeemedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
            .OrderBy(i => i.CreatedAt).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Invite>> ListUnusedAsync(string productionId, CancellationToken cancellationToken) =>
        await db.Invites.Where(i => i.ProductionId == productionId && i.RedeemedAt == null && i.RevokedAt == null)
            .OrderBy(i => i.CreatedAt).ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<string>> ListProductionsWithDueInvitesAsync(DateTimeOffset now, TimeSpan renewBefore, CancellationToken cancellationToken)
    {
        var renewalLimit = now + renewBefore;
        return await db.Invites
            .Where(i => i.RedeemedAt == null && i.RevokedAt == null && (i.ExpiresAt <= now || (i.Kind == InviteKind.PhoneQr && i.ExpiresAt < renewalLimit)))
            .Select(i => i.ProductionId).Distinct().ToListAsync(cancellationToken);
    }

    public Task<int> DeleteExpiredAsync(DateTimeOffset before, CancellationToken cancellationToken) =>
        db.Invites.Where(i => i.ExpiresAt < before).ExecuteDeleteAsync(cancellationToken);

    public void Add(Invite invite) => db.Invites.Add(invite);

    public void Remove(Invite invite) => db.Invites.Remove(invite);
}

/// <summary>EF Core implementation of <see cref="IAuditRepository"/>.</summary>
internal sealed class AuditRepository(StudioFlowDbContext db) : IAuditRepository
{
    public void Add(AuditEntry entry) => db.AuditEntries.Add(entry);

    public async Task<IReadOnlyList<AuditEntry>> ListRecentAsync(string productionId, IReadOnlyCollection<string> actions, int count, CancellationToken cancellationToken) =>
        await db.AuditEntries.AsNoTracking()
            .Where(a => (a.ProductionId == productionId || a.ProductionId == null) && actions.Contains(a.Action))
            .OrderByDescending(a => a.Id).Take(count).ToListAsync(cancellationToken);
}

/// <summary>EF Core implementation of <see cref="ISourceActivityRepository"/>.</summary>
internal sealed class SourceActivityRepository(StudioFlowDbContext db) : ISourceActivityRepository
{
    public async Task MarkLiveAsync(string productionId, IReadOnlyCollection<SourceLiveMark> marks, DateTimeOffset at, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(marks);
        var ids = marks.Select(m => m.SourceId).ToList();
        var existing = await db.SourceActivity.Where(a => ids.Contains(a.SourceId)).ToDictionaryAsync(a => a.SourceId, StringComparer.Ordinal, cancellationToken);

        // A mark must never fail the mutation it belongs to: marks of devices that are gone (or deleted in this unit) are dropped.
        var deviceIds = marks.Select(m => m.DeviceId).Distinct(StringComparer.Ordinal).ToList();
        var devices = (await db.Devices.Where(d => deviceIds.Contains(d.Id)).Select(d => d.Id).ToListAsync(cancellationToken)).ToHashSet(StringComparer.Ordinal);
        devices.ExceptWith(db.ChangeTracker.Entries<Device>().Where(e => e.State == EntityState.Deleted).Select(e => e.Entity.Id));
        foreach (var mark in marks.Where(m => devices.Contains(m.DeviceId)))
        {
            if (existing.TryGetValue(mark.SourceId, out var row))
            {
                row.LastLiveAt = at;
            }
            else
            {
                db.SourceActivity.Add(new SourceActivity { SourceId = mark.SourceId, ProductionId = productionId, DeviceId = mark.DeviceId, LastLiveAt = at });
            }
        }
    }

    public async Task<IReadOnlyList<SourceLastLive>> ListLiveSinceAsync(DateTimeOffset since, CancellationToken cancellationToken) =>
        await db.SourceActivity.AsNoTracking().Where(a => a.LastLiveAt >= since)
            .Select(a => new SourceLastLive(a.SourceId, a.ProductionId, a.DeviceId, a.LastLiveAt))
            .ToListAsync(cancellationToken);
}

/// <summary>A unit of work over one <see cref="StudioFlowDbContext"/>.</summary>
internal sealed class UnitOfWork : IUnitOfWork
{
    private readonly StudioFlowDbContext db;

    public UnitOfWork(StudioFlowDbContext db)
    {
        this.db = db;
        Productions = new ProductionRepository(db);
        Devices = new DeviceRepository(db);
        Assets = new AssetRepository(db);
        Invites = new InviteRepository(db);
        OutputLinks = new OutputLinkRepository(db);
        Audit = new AuditRepository(db);
        SourceActivity = new SourceActivityRepository(db);
    }

    public ISourceActivityRepository SourceActivity { get; }

    public IProductionRepository Productions { get; }

    public IDeviceRepository Devices { get; }

    public IAssetRepository Assets { get; }

    public IInviteRepository Invites { get; }

    public IOutputLinkRepository OutputLinks { get; }

    public IAuditRepository Audit { get; }

    public Task SaveChangesAsync(CancellationToken cancellationToken) => db.SaveChangesAsync(cancellationToken);

    public ValueTask DisposeAsync() => db.DisposeAsync();
}

/// <summary>Creates a unit of work with a pooled context per mutation.</summary>
internal sealed class UnitOfWorkFactory(IDbContextFactory<StudioFlowDbContext> contexts) : IUnitOfWorkFactory
{
    public IUnitOfWork Create() => new UnitOfWork(contexts.CreateDbContext());
}
