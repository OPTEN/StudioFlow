using Microsoft.AspNetCore.SignalR;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Web.Hubs;

/// <summary>
/// Delivers realtime messages through the three hubs. Every message goes into the outbox of each target connection
/// (<see cref="HubConnectionRegistry"/>) and the call returns at once: the ordered dispatcher of a production never waits
/// for a client, and one stuck connection cannot delay the others. Per connection the order of the calls is kept.
/// </summary>
internal sealed class SignalRRealtimePublisher(
    IHubContext<StudioHub, IStudioClient> studio,
    IHubContext<OutputHub, IOutputClient> output,
    IHubContext<DeviceHub, IDeviceClient> devices,
    HubConnectionRegistry registry) : IRealtimePublisher
{
    public Task JoinStudioAsync(string connectionId, string productionId)
    {
        registry.Join(StudioGroup(productionId), connectionId);
        return Task.CompletedTask;
    }

    public Task LeaveStudioAsync(string connectionId, string productionId)
    {
        registry.Leave(StudioGroup(productionId), connectionId);
        return Task.CompletedTask;
    }

    public Task JoinOutputAsync(string connectionId, string productionId)
    {
        registry.Join(OutputGroup(productionId), connectionId);
        return Task.CompletedTask;
    }

    public Task PublishEventAsync(string productionId, ProductionEvent studioEvent, ProductionEvent outputEvent)
    {
        registry.SendToGroup(StudioGroup(productionId), id => studio.Clients.Client(id).ReceiveEvent(studioEvent));
        registry.SendToGroup(OutputGroup(productionId), id => output.Clients.Client(id).ReceiveEvent(outputEvent));
        return Task.CompletedTask;
    }

    public Task PublishTelemetryAsync(string productionId, DeviceTelemetryMessage message)
    {
        registry.SendToGroup(StudioGroup(productionId), id => studio.Clients.Client(id).ReceiveTelemetry(message));
        return Task.CompletedTask;
    }

    public Task PublishPresenceAsync(string productionId, int operatorsOnline)
    {
        registry.SendToGroup(StudioGroup(productionId), id => studio.Clients.Client(id).ReceivePresence(operatorsOnline));
        return Task.CompletedTask;
    }

    public Task RequestStudioResyncAsync(string activeProductionId)
    {
        registry.SendToGroup(HubConnectionRegistry.AllStudios, id => studio.Clients.Client(id).ReceiveResync(activeProductionId));
        return Task.CompletedTask;
    }

    public Task SendTallyAsync(string connectionId, TallyDto tally)
    {
        registry.Send(connectionId, () => devices.Clients.Client(connectionId).ReceiveTally(tally));
        return Task.CompletedTask;
    }

    public Task SendSelfAsync(string connectionId, DeviceSelfDto self)
    {
        registry.Send(connectionId, () => devices.Clients.Client(connectionId).ReceiveSelf(self));
        return Task.CompletedTask;
    }

    public Task SendCommandAsync(string connectionId, DeviceCommandDto command)
    {
        registry.Send(connectionId, () => devices.Clients.Client(connectionId).ReceiveCommand(command));
        return Task.CompletedTask;
    }

    public Task SendSessionReplacedAsync(string connectionId)
    {
        registry.Send(connectionId, () => devices.Clients.Client(connectionId).ReceiveSessionReplaced());
        return Task.CompletedTask;
    }

    public void Abort(string connectionId) => registry.Abort(connectionId);

    public void AbortAfterDelivery(string connectionId) => registry.AbortAfterDelivery(connectionId);

    private static string StudioGroup(string productionId) => $"studio:{productionId}";

    private static string OutputGroup(string productionId) => $"output:{productionId}";
}
