using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Application.Ports;

/// <summary>
/// Fan-out to the SignalR hubs (spec 6). Called only by the ordered dispatcher of a production (never inside the
/// production lock), one call after the other, so events reach every client in revision order. Implementations must not
/// let one slow client delay the messages of the others.
/// </summary>
public interface IRealtimePublisher
{
    /// <summary>Adds a Regie connection to the production's studio group.</summary>
    Task JoinStudioAsync(string connectionId, string productionId);

    /// <summary>Removes a Regie connection from the production's studio group.</summary>
    Task LeaveStudioAsync(string connectionId, string productionId);

    /// <summary>Adds an output page connection to the production's output group.</summary>
    Task JoinOutputAsync(string connectionId, string productionId);

    /// <summary>Sends an event to the Regie and its output view (the full event or <c>revisionOnly</c>) to the outputs.</summary>
    Task PublishEventAsync(string productionId, ProductionEvent studioEvent, ProductionEvent outputEvent);

    /// <summary>Relays device telemetry to the Regie (not revisioned).</summary>
    Task PublishTelemetryAsync(string productionId, DeviceTelemetryMessage message);

    /// <summary>Sends the number of connected Regie sessions to the Regie.</summary>
    Task PublishPresenceAsync(string productionId, int operatorsOnline);

    /// <summary>Tells every Regie connection to resubscribe (the active production changed).</summary>
    Task RequestStudioResyncAsync(string activeProductionId);

    /// <summary>Sends the tally to a device connection.</summary>
    Task SendTallyAsync(string connectionId, TallyDto tally);

    /// <summary>Sends the device's own data after a change.</summary>
    Task SendSelfAsync(string connectionId, DeviceSelfDto self);

    /// <summary>Sends a remote command.</summary>
    Task SendCommandAsync(string connectionId, DeviceCommandDto command);

    /// <summary>Tells an old device connection that another tab took over.</summary>
    Task SendSessionReplacedAsync(string connectionId);

    /// <summary>Aborts a hub connection at once (stale session, rotated output key, forbidden address).</summary>
    void Abort(string connectionId);

    /// <summary>
    /// Aborts a hub connection shortly after the messages just sent to it had time to arrive (replaced session, blocked
    /// device): a client that never sees <c>sessionReplaced</c> would reconnect and take the session back.
    /// </summary>
    void AbortAfterDelivery(string connectionId);
}
