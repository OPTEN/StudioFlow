namespace Opten.StudioFlow.Core.Application.Runtime;

/// <summary>
/// Tells the application services that the host is shutting down (BUG-20, OBS-01). The hub connections that end
/// because the API stops are no outage of their sources: the source-loss path does not run, nothing is written and no
/// incident or “reconnecting” entry is created. After the restart the restart watch of spec 12 (GAP-08 b) flags a
/// source whose device does not come back.
/// </summary>
/// <param name="stopping">Cancelled when the host begins to stop (<c>IHostApplicationLifetime.ApplicationStopping</c>).</param>
public sealed class HostShutdown(CancellationToken stopping)
{
    /// <summary>A shutdown signal that never fires (tests, command line tools).</summary>
    public static HostShutdown None { get; } = new(CancellationToken.None);

    /// <summary>True once the host began to stop. Already true inside the stopping callbacks of the host.</summary>
    public bool IsStopping => stopping.IsCancellationRequested;

    /// <summary>Cancelled when the host begins to stop.</summary>
    public CancellationToken Token => stopping;
}
