using Microsoft.Extensions.Logging;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Services;

/// <summary>Regie actions on devices: rename, block, unblock, delete, remote commands (spec 4.6).</summary>
public sealed class DeviceAdminService(ProductionCoordinator coordinator, LiveKitKicker kicker)
{
    /// <summary>Renames a device; the labels of its sources follow and the device learns its new name.</summary>
    public Task<DeviceDto> RenameAsync(string productionId, string deviceId, RenameDeviceRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var device = await context.DeviceAsync(deviceId, cancellationToken);
                var name = TextRules.RequireName(request.Name, TextRules.DeviceNameMax, "name");
                if (string.Equals(name, device.Name, StringComparison.Ordinal))
                {
                    return Dtos.Device(device, context.Runtime.FindDevice(device.Id));
                }

                device.Rename(name);
                DeviceEvents.EmitDevice(context, device);
                SourceMonitor.PublishSources(context, device);
                await DeviceEvents.SendSelfAsync(context, device, cancellationToken);
                return Dtos.Device(device, context.Runtime.FindDevice(device.Id));
            },
            cancellationToken);
    }

    /// <summary>
    /// Blocks a device: its sources turn red («gesperrt»), incidents disappear, the device gets a final <c>self</c>,
    /// its hub connection is aborted and LiveKit removes it. The token endpoint refuses it from now on.
    /// </summary>
    public async Task<DeviceDto> BlockAsync(string productionId, string deviceId, CancellationToken cancellationToken)
    {
        var (dto, changed) = await coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var device = await context.DeviceAsync(deviceId, cancellationToken);
                if (!device.Block())
                {
                    return (Dtos.Device(device, context.Runtime.FindDevice(device.Id)), false);
                }

                await DeviceEvents.SendSelfAsync(context, device, cancellationToken);
                DeviceEvents.Disconnect(context, device.Id);
                SourceMonitor.Reevaluate(context, device);
                DeviceEvents.EmitDevice(context, device);
                context.Audit(AuditActors.Admin, AuditActions.DeviceBlocked, MutationContextExtensions.DeviceDetails(device));
                return (Dtos.Device(device, context.Runtime.FindDevice(device.Id)), true);
            },
            cancellationToken);
        if (changed)
        {
            await kicker.KickAsync(productionId, deviceId);
        }

        return dto;
    }

    /// <summary>Unblocks a device; it may connect again (the sender retries every 15 s while blocked).</summary>
    public Task<DeviceDto> UnblockAsync(string productionId, string deviceId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var device = await context.DeviceAsync(deviceId, cancellationToken);
                if (device.Unblock())
                {
                    SourceMonitor.Reevaluate(context, device);
                    DeviceEvents.EmitDevice(context, device);
                    context.Audit(AuditActors.Admin, AuditActions.DeviceUnblocked, MutationContextExtensions.DeviceDetails(device));
                }

                return Dtos.Device(device, context.Runtime.FindDevice(device.Id));
            },
            cancellationToken);

    /// <summary>Deletes a device and its sources; scene items keep the references («Quelle fehlt»).</summary>
    public async Task DeleteAsync(string productionId, string deviceId, CancellationToken cancellationToken)
    {
        await coordinator.ExecuteAsync(
            productionId,
            async context => DeviceEvents.Remove(context, await context.DeviceAsync(deviceId, cancellationToken), AuditActors.Admin),
            cancellationToken);
        await kicker.KickAsync(productionId, deviceId);
    }

    /// <summary>Sends a remote command; accepted (202) even when the device is offline, then it is dropped.</summary>
    public Task<DeviceCommandDto> SendCommandAsync(string productionId, string deviceId, DeviceCommandRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var device = await context.DeviceAsync(deviceId, cancellationToken);
                var command = CreateCommand(device, request, context.Now);
                if (context.Runtime.FindDevice(device.Id)?.ConnectionId is { } connectionId)
                {
                    context.Send(p => p.SendCommandAsync(connectionId, command));
                }

                return command;
            },
            cancellationToken);
    }

    private static DeviceCommandDto CreateCommand(Device device, DeviceCommandRequest request, DateTimeOffset now)
    {
        switch (request.Kind)
        {
            case DeviceCommandKind.Message:
                var text = TextRules.RequireName(request.Text, TextRules.MessageMax, "text");
                return new DeviceCommandDto(EntityIds.New(EntityIds.Command), request.Kind, null, text, now);
            case DeviceCommandKind.Reshare:
                if (request.Slot is null || device.FindSlot(request.Slot) is not { Kind: SourceKind.Screen })
                {
                    throw FlowStudioException.Invalid("slot", "Das Gerät hat keinen solchen Bildschirm.");
                }

                return new DeviceCommandDto(EntityIds.New(EntityIds.Command), request.Kind, request.Slot, null, now);
            case DeviceCommandKind.SwitchCamera:
                if (device.FindSlot(DeviceSlots.Camera) is null)
                {
                    throw FlowStudioException.Invalid("kind", "Das Gerät hat keine Kamera.");
                }

                return new DeviceCommandDto(EntityIds.New(EntityIds.Command), request.Kind, DeviceSlots.Camera, null, now);
            default:
                throw FlowStudioException.Invalid("kind", "Unbekannter Befehl.");
        }
    }
}

/// <summary>Event helpers shared by the Regie and the sender use cases of devices.</summary>
internal static class DeviceEvents
{
    /// <summary>Emits <c>deviceUpserted</c>.</summary>
    public static void EmitDevice(MutationContext context, Device device)
    {
        var dto = Dtos.Device(device, context.Runtime.FindDevice(device.Id));
        context.Emit(revision => new DeviceUpsertedEvent(revision, dto));
    }

    /// <summary>Sends the device its own data when it is connected.</summary>
    public static async Task SendSelfAsync(MutationContext context, Device device, CancellationToken cancellationToken)
    {
        if (context.Runtime.FindDevice(device.Id)?.ConnectionId is not { } connectionId)
        {
            return;
        }

        var self = Dtos.Self(device, await context.ProductionNameAsync(cancellationToken));
        context.Send(p => p.SendSelfAsync(connectionId, self));
    }

    /// <summary>
    /// Ends the device's hub session and aborts the connection after the commit, once the messages sent before (the final
    /// <c>self</c>) had time to arrive.
    /// </summary>
    public static void Disconnect(MutationContext context, string deviceId)
    {
        var live = context.Runtime.FindDevice(deviceId);
        if (live?.ConnectionId is not { } connectionId)
        {
            return;
        }

        live.Detach(connectionId, context.Now);
        context.Send(p =>
        {
            p.AbortAfterDelivery(connectionId);
            return Task.CompletedTask;
        });
    }

    /// <summary>Deletes a device with its sources and session.</summary>
    public static void Remove(MutationContext context, Device device, string actor)
    {
        foreach (var slot in device.Slots)
        {
            var sourceId = device.SourceIdOf(slot);
            SourceMonitor.Forget(context, sourceId);
            context.Emit(revision => new SourceRemovedEvent(revision, sourceId));
        }

        Disconnect(context, device.Id);
        context.Data.Devices.Remove(device);
        context.OnCommitted(() => context.Runtime.ForgetDevice(device.Id));
        context.Emit(revision => new DeviceRemovedEvent(revision, device.Id));
        context.Audit(actor, AuditActions.DeviceRemoved, MutationContextExtensions.DeviceDetails(device));
    }
}

/// <summary>Removes participants from LiveKit after a block, delete or key rotation (best effort, outside the lock).</summary>
public sealed class LiveKitKicker(ILiveKitRoomClient rooms, ILogger<LiveKitKicker> logger)
{
    /// <summary>Removes one identity from the production's room.</summary>
    public async Task KickAsync(string productionId, string identity)
    {
        try
        {
            await rooms.RemoveParticipantAsync(productionId, identity, CancellationToken.None);
        }
        catch (LiveKitUnavailableException exception)
        {
            logger.LogWarning("LiveKit could not remove {Identity} from {Room}: {Reason}", identity, productionId, exception.Message);
        }
    }

    /// <summary>Removes every participant whose identity starts with <paramref name="identityPrefix"/>.</summary>
    public async Task KickPrefixAsync(string productionId, string identityPrefix)
    {
        try
        {
            var participants = await rooms.ListParticipantsAsync(productionId, CancellationToken.None);
            foreach (var participant in participants.Where(p => p.Identity.StartsWith(identityPrefix, StringComparison.Ordinal)))
            {
                await rooms.RemoveParticipantAsync(productionId, participant.Identity, CancellationToken.None);
            }
        }
        catch (LiveKitUnavailableException exception)
        {
            logger.LogWarning("LiveKit could not remove participants {Prefix}* from {Room}: {Reason}", identityPrefix, productionId, exception.Message);
        }
    }
}
