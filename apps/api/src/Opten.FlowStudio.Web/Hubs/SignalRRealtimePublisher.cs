using Microsoft.AspNetCore.SignalR;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Web.Hubs;

/// <summary>Delivers realtime messages through the three hubs (groups per production for the Regie and the output).</summary>
internal sealed class SignalRRealtimePublisher(
    IHubContext<StudioHub, IStudioClient> studio,
    IHubContext<OutputHub, IOutputClient> output,
    IHubContext<DeviceHub, IDeviceClient> devices,
    HubConnectionRegistry registry) : IRealtimePublisher
{
    public Task JoinStudioAsync(string connectionId, string productionId) => studio.Groups.AddToGroupAsync(connectionId, StudioGroup(productionId));

    public Task LeaveStudioAsync(string connectionId, string productionId) => studio.Groups.RemoveFromGroupAsync(connectionId, StudioGroup(productionId));

    public Task JoinOutputAsync(string connectionId, string productionId) => output.Groups.AddToGroupAsync(connectionId, OutputGroup(productionId));

    public async Task PublishEventAsync(string productionId, ProductionEvent studioEvent, ProductionEvent outputEvent)
    {
        await studio.Clients.Group(StudioGroup(productionId)).ReceiveEvent(studioEvent);
        await output.Clients.Group(OutputGroup(productionId)).ReceiveEvent(outputEvent);
    }

    public Task PublishTelemetryAsync(string productionId, DeviceTelemetryMessage message) => studio.Clients.Group(StudioGroup(productionId)).ReceiveTelemetry(message);

    public Task PublishPresenceAsync(string productionId, int operatorsOnline) => studio.Clients.Group(StudioGroup(productionId)).ReceivePresence(operatorsOnline);

    public Task RequestStudioResyncAsync(string activeProductionId) => studio.Clients.All.ReceiveResync(activeProductionId);

    public Task SendTallyAsync(string connectionId, TallyDto tally) => devices.Clients.Client(connectionId).ReceiveTally(tally);

    public Task SendSelfAsync(string connectionId, DeviceSelfDto self) => devices.Clients.Client(connectionId).ReceiveSelf(self);

    public Task SendCommandAsync(string connectionId, DeviceCommandDto command) => devices.Clients.Client(connectionId).ReceiveCommand(command);

    public Task SendSessionReplacedAsync(string connectionId) => devices.Clients.Client(connectionId).ReceiveSessionReplaced();

    public void Abort(string connectionId) => registry.Abort(connectionId);

    public void AbortAfterDelivery(string connectionId) => registry.AbortLater(connectionId, HubConnectionRegistry.DeliveryGrace);

    private static string StudioGroup(string productionId) => $"studio:{productionId}";

    private static string OutputGroup(string productionId) => $"output:{productionId}";
}
