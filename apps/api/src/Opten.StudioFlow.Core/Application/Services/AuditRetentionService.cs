using System.Globalization;
using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// Keeps the audit log small (spec 4.9): deletes entries older than <see cref="AuditOptions.RetentionDays"/> and removes
/// the IP addresses from entries older than <see cref="AuditOptions.IpRetentionDays"/>, in batches of
/// <see cref="AuditOptions.BatchSize"/>. A run is idempotent, so a run that stops halfway (restart, database down) is
/// finished by the next one. It is skipped while a broadcast is live, and it records what it did as an
/// <c>audit.retention</c> entry of the actor <c>system</c>.
/// </summary>
public sealed class AuditRetentionService(IAuditLog log, IUnitOfWorkFactory data, AuditOptions options, TimeProvider clock, ILogger<AuditRetentionService> logger)
{
    /// <summary>Runs the retention once.</summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        if (await AnyBroadcastLiveAsync(cancellationToken))
        {
            logger.LogDebug("Audit retention skipped: a broadcast is live");
            return;
        }

        var now = clock.StorageNow();
        var deleted = await DrainAsync((batch, token) => log.DeleteOlderThanAsync(now.AddDays(-options.RetentionDays), batch, token), cancellationToken);
        var anonymised = await DrainAsync((batch, token) => log.RemoveIpAddressesOlderThanAsync(now.AddDays(-options.IpRetentionDays), batch, token), cancellationToken);
        if (deleted + anonymised == 0)
        {
            return;
        }

        await RecordAsync(now, deleted, anonymised, cancellationToken);
        logger.LogInformation(
            "Audit retention: deleted {Deleted} entries older than {Days} days, removed the IP address from {Anonymised} entries older than {IpDays} days",
            deleted,
            options.RetentionDays,
            anonymised,
            options.IpRetentionDays);
    }

    private async Task<bool> AnyBroadcastLiveAsync(CancellationToken cancellationToken)
    {
        await using var unit = data.Create();
        return await unit.Productions.AnyLiveAsync(cancellationToken);
    }

    /// <summary>Runs a batch operation until a batch is not full any more; returns the total.</summary>
    private async Task<int> DrainAsync(Func<int, CancellationToken, Task<int>> batchOperation, CancellationToken cancellationToken)
    {
        var total = 0;
        int done;
        do
        {
            done = await batchOperation(options.BatchSize, cancellationToken);
            total += done;
        }
        while (done == options.BatchSize);
        return total;
    }

    private async Task RecordAsync(DateTimeOffset now, int deleted, int anonymised, CancellationToken cancellationToken)
    {
        var details = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AuditDetails.Days] = options.RetentionDays.ToString(CultureInfo.InvariantCulture),
            [AuditDetails.Deleted] = deleted.ToString(CultureInfo.InvariantCulture),
            [AuditDetails.Anonymised] = anonymised.ToString(CultureInfo.InvariantCulture),
        };
        await using var unit = data.Create();
        unit.Audit.Add(AuditEntry.Create(null, now, AuditActors.System, AuditActions.AuditRetention, details));
        await unit.SaveChangesAsync(cancellationToken);
    }
}
