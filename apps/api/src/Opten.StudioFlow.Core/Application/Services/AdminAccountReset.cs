using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// Deletes the Regie account (<c>reset-admin</c>, issue #4). Run by the command line tool in its own process: the running
/// API notices within seconds (<see cref="AdminAccountState.RefreshAsync"/>), ends the old sessions and opens the
/// first-run setup with a new code.
/// </summary>
public sealed class AdminAccountReset(IAdminAccountStore store, TimeProvider clock)
{
    /// <summary>Deletes the account and records it in the audit log; false when there was no account.</summary>
    public Task<bool> ResetAsync(CancellationToken cancellationToken) =>
        store.TryDeleteAsync(AuditEntry.Create(null, clock.StorageNow(), AuditActors.System, AuditActions.AccountReset), cancellationToken);
}
