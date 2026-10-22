using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Ports;

/// <summary>Output access data of a production (key lookup without loading the aggregate).</summary>
/// <param name="ProductionId">Production id.</param>
/// <param name="Slug">Output slug.</param>
/// <param name="OutputKey">Current output key.</param>
/// <param name="AllowedIps">IP restriction.</param>
public sealed record OutputKeyInfo(string ProductionId, string Slug, string OutputKey, IReadOnlyList<string> AllowedIps);

/// <summary>Persistence of productions with their scenes.</summary>
public interface IProductionRepository
{
    /// <summary>Loads a production with its scenes for a change.</summary>
    Task<Production?> GetAsync(string productionId, CancellationToken cancellationToken);

    /// <summary>Loads all productions (without scenes) ordered by creation time.</summary>
    Task<IReadOnlyList<Production>> ListAsync(CancellationToken cancellationToken);

    /// <summary>The active production of the tenant (without scenes), if any.</summary>
    Task<Production?> GetActiveAsync(string tenantId, CancellationToken cancellationToken);

    /// <summary>True when the production exists.</summary>
    Task<bool> ExistsAsync(string productionId, CancellationToken cancellationToken);

    /// <summary>Name of a production, if it exists.</summary>
    Task<string?> GetNameAsync(string productionId, CancellationToken cancellationToken);

    /// <summary>Output access data by production id.</summary>
    Task<OutputKeyInfo?> GetOutputKeyAsync(string productionId, CancellationToken cancellationToken);

    /// <summary>Output access data by slug.</summary>
    Task<OutputKeyInfo?> GetOutputKeyBySlugAsync(string slug, CancellationToken cancellationToken);

    /// <summary>Output access data of every production (for hub connections that only carry the key).</summary>
    Task<IReadOnlyList<OutputKeyInfo>> ListOutputKeysAsync(CancellationToken cancellationToken);

    /// <summary>True when any production is live.</summary>
    Task<bool> AnyLiveAsync(CancellationToken cancellationToken);

    /// <summary>Adds a new production.</summary>
    void Add(Production production);
}

/// <summary>Persistence of devices.</summary>
public interface IDeviceRepository
{
    /// <summary>Loads a device.</summary>
    Task<Device?> GetAsync(string deviceId, CancellationToken cancellationToken);

    /// <summary>All devices of a production ordered by pairing time.</summary>
    Task<IReadOnlyList<Device>> ListAsync(string productionId, CancellationToken cancellationToken);

    /// <summary>Adds a device.</summary>
    void Add(Device device);

    /// <summary>Deletes a device.</summary>
    void Remove(Device device);
}

/// <summary>Persistence of assets.</summary>
public interface IAssetRepository
{
    /// <summary>Loads an asset of a production.</summary>
    Task<Asset?> GetAsync(string productionId, string assetId, CancellationToken cancellationToken);

    /// <summary>All assets of a production ordered by upload time.</summary>
    Task<IReadOnlyList<Asset>> ListAsync(string productionId, CancellationToken cancellationToken);

    /// <summary>Adds an asset.</summary>
    void Add(Asset asset);

    /// <summary>Deletes an asset.</summary>
    void Remove(Asset asset);
}

/// <summary>Persistence of invites.</summary>
public interface IInviteRepository
{
    /// <summary>Loads an invite of a production.</summary>
    Task<Invite?> GetAsync(string productionId, string inviteId, CancellationToken cancellationToken);

    /// <summary>Loads an invite by its token.</summary>
    Task<Invite?> GetByTokenAsync(string token, CancellationToken cancellationToken);

    /// <summary>Invites of a production that are still open at <paramref name="now"/>.</summary>
    Task<IReadOnlyList<Invite>> ListOpenAsync(string productionId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Ids of productions with an invite that is open but expired, or a phone invite due for renewal.</summary>
    Task<IReadOnlyList<string>> ListProductionsWithDueInvitesAsync(DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Invites of a production that are not redeemed or revoked (including expired ones).</summary>
    Task<IReadOnlyList<Invite>> ListUnusedAsync(string productionId, CancellationToken cancellationToken);

    /// <summary>Deletes invites that expired before <paramref name="before"/>.</summary>
    Task<int> DeleteExpiredAsync(DateTimeOffset before, CancellationToken cancellationToken);

    /// <summary>Adds an invite.</summary>
    void Add(Invite invite);

    /// <summary>Deletes an invite.</summary>
    void Remove(Invite invite);
}

/// <summary>Persistence of the audit log.</summary>
public interface IAuditRepository
{
    /// <summary>Adds an entry.</summary>
    void Add(AuditEntry entry);

    /// <summary>The newest entries of a production that have a log text, newest first.</summary>
    Task<IReadOnlyList<AuditEntry>> ListRecentAsync(string productionId, IReadOnlyCollection<string> actions, int count, CancellationToken cancellationToken);
}

/// <summary>A unit of work over the repositories; changes are committed together.</summary>
public interface IUnitOfWork : IAsyncDisposable
{
    /// <summary>Productions and scenes.</summary>
    IProductionRepository Productions { get; }

    /// <summary>Devices.</summary>
    IDeviceRepository Devices { get; }

    /// <summary>Assets.</summary>
    IAssetRepository Assets { get; }

    /// <summary>Invites.</summary>
    IInviteRepository Invites { get; }

    /// <summary>Audit log.</summary>
    IAuditRepository Audit { get; }

    /// <summary>Commits all changes in one transaction.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken);
}

/// <summary>Creates units of work; each mutation gets a fresh one so it never sees stale tracked state.</summary>
public interface IUnitOfWorkFactory
{
    /// <summary>Creates a unit of work.</summary>
    IUnitOfWork Create();
}
