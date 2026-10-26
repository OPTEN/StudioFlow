using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>Regie actions on devices: rename, block, unblock, delete, remote commands (spec 4.6).</summary>
public sealed class DeviceAdminService(ProductionCoordinator coordinator, LiveKitKicker kicker, SourceMonitorOptions options)
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

                var details = MutationContextExtensions.DeviceDetails(device);
                details[AuditDetails.Name] = name;
                device.Rename(name);
                context.Audit(AuditActors.Admin, AuditActions.DeviceRenamed, details);
                DeviceEvents.EmitDevice(context, device);
                SourceMonitor.PublishSources(context, device);
                await DeviceEvents.SendSelfAsync(context, device, cancellationToken);
                return Dtos.Device(device, context.Runtime.FindDevice(device.Id));
            },
            cancellationToken);
    }

    /// <summary>
    /// Blocks a device: its sources turn red (“blocked”), incidents disappear, the device gets a final <c>self</c>,
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

    /// <summary>Deletes a device and its sources; scene items keep the references (“Source missing”).</summary>
    public async Task DeleteAsync(string productionId, string deviceId, CancellationToken cancellationToken)
    {
        await coordinator.ExecuteAsync(
            productionId,
            async context => await DeviceEvents.RemoveAsync(context, await context.DeviceAsync(deviceId, cancellationToken), AuditActors.Admin, cancellationToken),
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
                var live = context.Runtime.FindDevice(device.Id);
                if (request.Kind == DeviceCommandKind.CameraControl)
                {
                    return SendCameraControl(context, device, live, request);
                }

                var command = CreateCommand(device, request, context.Now);
                if (live?.ConnectionId is { } connectionId)
                {
                    context.Send(p => p.SendCommandAsync(connectionId, command));
                }

                return command;
            },
            cancellationToken);
    }

    /// <summary>
    /// Camera control of a phone (issue #11): validated and clamped to the capabilities the phone reported, then sent
    /// through the throttle (<c>Sources:CameraCommandInterval</c>): commands in quick succession merge and the newest
    /// value of each setting reaches the phone. A command to a disconnected phone is dropped, like the others.
    /// </summary>
    private DeviceCommandDto SendCameraControl(MutationContext context, Device device, DeviceRuntime? live, DeviceCommandRequest request)
    {
        if (device.Kind != DeviceKind.Phone || device.FindSlot(DeviceSlots.Camera) is null)
        {
            throw StudioFlowException.Invalid("kind", "Only the camera of a phone can be controlled.");
        }

        var camera = CameraControlRules.Prepare(request.Camera, live?.Camera?.Capabilities);
        AuditLensSwitch(context, device, camera.LensId, live?.Camera);
        var accepted = new DeviceCommandDto(EntityIds.New(EntityIds.Command), request.Kind, DeviceSlots.Camera, null, context.Now, camera);
        if (live?.ConnectionId is { } connectionId && live.OfferCameraCommand(camera, context.Now, options.CameraCommandInterval) is { } due)
        {
            DeviceEvents.SendCameraCommand(context, connectionId, accepted with { Camera = due });
        }

        return accepted;
    }

    /// <summary>Only a change of the lens is worth an entry; the sliders (zoom, focus, brightness) and the light send no lens.</summary>
    private static void AuditLensSwitch(MutationContext context, Device device, string? lensId, CameraStateDto? state)
    {
        if (lensId is null || string.Equals(lensId, state?.Settings.LensId, StringComparison.Ordinal))
        {
            return;
        }

        var kind = state?.Capabilities.Lenses.FirstOrDefault(l => string.Equals(l.Id, lensId, StringComparison.Ordinal))?.Kind ?? CameraLensKind.Other;
        var details = MutationContextExtensions.DeviceDetails(device);
        details[AuditDetails.Lens] = kind.ToString();
        context.Audit(AuditActors.Admin, AuditActions.CameraLensSwitched, details);
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
                    throw StudioFlowException.Invalid("slot", "The device has no such screen.");
                }

                return new DeviceCommandDto(EntityIds.New(EntityIds.Command), request.Kind, request.Slot, null, now);
            case DeviceCommandKind.SwitchCamera:
                if (device.FindSlot(DeviceSlots.Camera) is null)
                {
                    throw StudioFlowException.Invalid("kind", "The device has no camera.");
                }

                return new DeviceCommandDto(EntityIds.New(EntityIds.Command), request.Kind, DeviceSlots.Camera, null, now);
            default:
                throw StudioFlowException.Invalid("kind", "Unknown command.");
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

    /// <summary>Sends a camera control command to the connected phone.</summary>
    public static void SendCameraCommand(MutationContext context, string connectionId, DeviceCommandDto command) =>
        context.Send(p => p.SendCommandAsync(connectionId, command));

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

    /// <summary>Deletes a device with its sources (and their mixer channels) and session.</summary>
    public static async Task RemoveAsync(MutationContext context, Device device, string actor, CancellationToken cancellationToken)
    {
        foreach (var slot in device.Slots)
        {
            var sourceId = device.SourceIdOf(slot);
            SourceMonitor.Forget(context, sourceId);
            context.Emit(revision => new SourceRemovedEvent(revision, sourceId));
        }

        await AudioMixerSync.RemoveAsync(context, device.Slots.Select(device.SourceIdOf), cancellationToken);

        Disconnect(context, device.Id);
        context.Data.Devices.Remove(device);
        context.OnCommitted(() => context.Runtime.ForgetDevice(device.Id));
        context.Emit(revision => new DeviceRemovedEvent(revision, device.Id));
        context.Audit(actor, AuditActions.DeviceRemoved, MutationContextExtensions.DeviceDetails(device));
    }
}

/// <summary>
/// Removes participants from LiveKit after a block, delete or key rotation: best effort, always called after the
/// production lock was released, every call bounded by <c>LiveKit:RequestTimeout</c>. A failure is logged and never
/// fails the request (the token endpoints refuse the participant anyway).
/// </summary>
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
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            logger.LogWarning(exception, "LiveKit could not remove {Identity} from {Room}", identity, productionId);
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
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            logger.LogWarning(exception, "LiveKit could not remove participants {Prefix}* from {Room}", identityPrefix, productionId);
        }
    }
}
