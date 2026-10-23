using Microsoft.AspNetCore.SignalR;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Web.Hubs;

/// <summary>Server → Regie messages. Wire names are the camelCase constants of <see cref="HubMethods"/>.</summary>
public interface IStudioClient
{
    /// <summary>One revisioned event.</summary>
    [HubMethodName(HubMethods.Event)]
    Task ReceiveEvent(ProductionEvent productionEvent);

    /// <summary>Device telemetry (not revisioned).</summary>
    [HubMethodName(HubMethods.Telemetry)]
    Task ReceiveTelemetry(DeviceTelemetryMessage message);

    /// <summary>Number of connected Regie sessions.</summary>
    [HubMethodName(HubMethods.Presence)]
    Task ReceivePresence(int operatorsOnline);

    /// <summary>Resubscribe (the active production changed).</summary>
    [HubMethodName(HubMethods.Resync)]
    Task ReceiveResync(string productionId);
}

/// <summary>Server → output page messages.</summary>
public interface IOutputClient
{
    /// <summary>One revisioned event (private changes as <c>revisionOnly</c>).</summary>
    [HubMethodName(HubMethods.Event)]
    Task ReceiveEvent(ProductionEvent productionEvent);
}

/// <summary>Server → sender messages.</summary>
public interface IDeviceClient
{
    /// <summary>Tally of the device.</summary>
    [HubMethodName(HubMethods.Tally)]
    Task ReceiveTally(TallyDto tally);

    /// <summary>Remote command.</summary>
    [HubMethodName(HubMethods.Command)]
    Task ReceiveCommand(DeviceCommandDto command);

    /// <summary>The device's own data after a change.</summary>
    [HubMethodName(HubMethods.Self)]
    Task ReceiveSelf(DeviceSelfDto self);

    /// <summary>Another tab took over; this session stays off.</summary>
    [HubMethodName(HubMethods.SessionReplaced)]
    Task ReceiveSessionReplaced();
}
