using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Services;

/// <summary>A device authenticated by its bearer credential.</summary>
/// <param name="DeviceId">Device id.</param>
/// <param name="ProductionId">Production of the device.</param>
/// <param name="Blocked">The device is blocked (403 <c>device_blocked</c>).</param>
public sealed record DeviceIdentity(string DeviceId, string ProductionId, bool Blocked);

/// <summary>
/// Use cases of the sender (spec 4.6): authentication, hub sessions with session replacement, reports, slots, LiveKit
/// tokens and unpairing.
/// </summary>
public sealed class DeviceSessionService(
    ProductionCoordinator coordinator,
    IUnitOfWorkFactory data,
    ProductionRuntimeRegistry runtimes,
    ILiveKitTokenIssuer tokens,
    LiveKitKicker kicker,
    SourceMonitorOptions options)
{
    private const int SessionIdMax = 128;

    /// <summary>
    /// Checks a credential <c>{deviceId}.{secret}</c>; returns null for malformed input, unknown devices and wrong
    /// secrets (constant-time comparison).
    /// </summary>
    public async Task<DeviceIdentity?> AuthenticateAsync(string? credential, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(credential) || credential.Length > 200)
        {
            return null;
        }

        var dot = credential.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0 || !EntityIds.IsValid(credential[..dot], EntityIds.Device))
        {
            return null;
        }

        await using var unit = data.Create();
        var device = await unit.Devices.GetAsync(credential[..dot], cancellationToken);
        return device is not null && device.HasSecret(credential[(dot + 1)..])
            ? new DeviceIdentity(device.Id, device.ProductionId, device.IsBlocked)
            : null;
    }

    /// <summary>What the device knows about itself.</summary>
    public Task<DeviceSelfDto> GetSelfAsync(DeviceIdentity identity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        return coordinator.ExecuteAsync(
            identity.ProductionId,
            async context => Dtos.Self(await context.DeviceAsync(identity.DeviceId, cancellationToken), await context.ProductionNameAsync(cancellationToken)),
            cancellationToken);
    }

    /// <summary>Self and current tally.</summary>
    public Task<DeviceSessionDto> GetSessionAsync(DeviceIdentity identity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        return coordinator.ExecuteAsync(
            identity.ProductionId,
            async context =>
            {
                var device = await context.DeviceAsync(identity.DeviceId, cancellationToken);
                var onAir = await OnAirAsync(context, cancellationToken);
                return new DeviceSessionDto(Dtos.Self(device, await context.ProductionNameAsync(cancellationToken)), onAir.TallyFor(device.Id, device.Slots.Select(s => s.Slot)));
            },
            cancellationToken);
    }

    /// <summary>LiveKit token for the sender; blocked devices are refused.</summary>
    public async Task<LiveKitTokenDto> IssueTokenAsync(DeviceIdentity identity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        await using var unit = data.Create();
        var device = await unit.Devices.GetAsync(identity.DeviceId, cancellationToken) ?? throw FlowStudioException.NotFound("Das Gerät");
        if (device.IsBlocked)
        {
            throw new FlowStudioException(ErrorKind.Forbidden, ErrorCodes.DeviceBlocked, "Das Gerät ist gesperrt.");
        }

        return tokens.IssueSenderToken(device.ProductionId, device.Id, device.Name);
    }

    /// <summary>
    /// Starts a hub session. A newer Hello wins: another tab's connection gets <c>sessionReplaced</c> and is aborted; a
    /// stale connection of the same tab is just aborted. A Hello of a tab that was replaced before is answered with
    /// <c>sessionReplaced</c> and a <c>conflict</c> error and the current session stays (GAP-21, no ping-pong): a tab
    /// that wants to take over again starts a new session id. After a reload the replaced connection is usually dead
    /// already; the <c>sessionReplaced</c> to it is dropped or never read, and its late disconnect or report changes
    /// nothing. A new session starts without the slot states of the previous one (spec 4.5).
    /// </summary>
    public async Task<DeviceSessionDto> HelloAsync(DeviceIdentity identity, string connectionId, DeviceHelloDto hello, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentNullException.ThrowIfNull(hello);
        var sessionId = TextRules.Truncate(hello.SessionId, SessionIdMax) ?? throw FlowStudioException.Invalid("sessionId", "Sitzungs-ID fehlt.");
        var session = await coordinator.ExecuteAsync(
            identity.ProductionId,
            async context =>
            {
                var device = await context.DeviceAsync(identity.DeviceId, cancellationToken);
                if (device.IsBlocked)
                {
                    throw new FlowStudioException(ErrorKind.Forbidden, ErrorCodes.DeviceBlocked, "Das Gerät ist gesperrt.");
                }

                var live = context.Runtime.Device(device.Id);
                if (live.WasReplaced(sessionId))
                {
                    context.Send(async p =>
                    {
                        await p.SendSessionReplacedAsync(connectionId);
                        p.AbortAfterDelivery(connectionId);
                    });
                    return null;
                }

                var onAir = await OnAirAsync(context, cancellationToken);
                var takeover = live.Attach(connectionId, sessionId, context.Now);
                if (takeover.ReplacedConnectionId is { } replaced)
                {
                    context.Send(async p =>
                    {
                        if (takeover.NotifyReplaced)
                        {
                            await p.SendSessionReplacedAsync(replaced);
                            p.AbortAfterDelivery(replaced);
                        }
                        else
                        {
                            p.Abort(replaced);
                        }
                    });
                }

                device.UpdatePlatform(hello.Platform);
                device.MarkSeen(context.Now);
                live.Slots = [.. device.Slots.Select(s => s.Slot)];
                var tally = onAir.TallyFor(device.Id, live.Slots);
                live.LastTally = tally;
                SourceMonitor.Reevaluate(context, device);
                return new DeviceSessionDto(Dtos.Self(device, await context.ProductionNameAsync(cancellationToken)), tally);
            },
            cancellationToken);
        return session ?? throw FlowStudioException.Conflict(ErrorCodes.Conflict, "Diese Sitzung wurde in einem anderen Tab übernommen.");
    }

    /// <summary>Ends a hub session when the connection was the active one.</summary>
    public Task DisconnectedAsync(DeviceIdentity identity, string connectionId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        return coordinator.ExecuteAsync(
            identity.ProductionId,
            async context =>
            {
                var live = context.Runtime.FindDevice(identity.DeviceId);
                if (live is null || !live.Detach(connectionId, context.Now))
                {
                    return;
                }

                // Detached first on purpose: even when the database is down (GAP-32) the closed connection is gone, and
                // the next reconcile or report re-evaluates the sources.
                var device = await context.Data.Devices.GetAsync(identity.DeviceId, cancellationToken);
                if (device is not null)
                {
                    device.MarkSeen(context.Now);
                    SourceMonitor.Reevaluate(context, device);
                }
            },
            cancellationToken);
    }

    /// <summary>
    /// Applies a periodic report: replaces the reported slot states, updates source statuses and relays telemetry to
    /// the Regie. Reports of a replaced hub connection are ignored; REST reports (<paramref name="connectionId"/> null)
    /// always count. The sender measures its RTT with this call, so it stays cheap: one device read, a database write
    /// only when a source status changes (audit entry, last-live time), delivery to the Regie after the call.
    /// </summary>
    public Task ReportAsync(DeviceIdentity identity, string? connectionId, DeviceReportDto report, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (report is null)
        {
            throw FlowStudioException.Invalid("report", "Bericht fehlt.");
        }

        return coordinator.ExecuteAsync(
            identity.ProductionId,
            async context =>
            {
                if (connectionId is not null && !string.Equals(context.Runtime.FindDevice(identity.DeviceId)?.ConnectionId, connectionId, StringComparison.Ordinal))
                {
                    return;
                }

                var device = await context.Data.Devices.GetAsync(identity.DeviceId, cancellationToken);
                if (device is null || device.IsBlocked)
                {
                    return;
                }

                var live = context.Runtime.Device(device.Id);
                var (telemetry, techCheckChanged) = live.ApplyReport(report, [.. device.Slots.Select(s => s.Slot)], context.Now);
                SourceMonitor.Reevaluate(context, device);
                if (techCheckChanged)
                {
                    DeviceEvents.EmitDevice(context, device);
                }

                var message = new DeviceTelemetryMessage(device.Id, telemetry);
                var productionId = context.ProductionId;
                context.Send(p => p.PublishTelemetryAsync(productionId, message));
            },
            cancellationToken);
    }

    /// <summary>
    /// Marks connected devices that stopped reporting as <c>rtc: disconnected</c> (GAP-29, 1 s maintenance tick); their
    /// live sources then turn <c>reconnecting</c> like after a reported media loss.
    /// </summary>
    public async Task ExpireStaleReportsAsync(CancellationToken cancellationToken)
    {
        foreach (var runtime in runtimes.All)
        {
            // Device runtimes are only read inside the lock; a mutation without changes does not touch the database.
            await coordinator.ExecuteAsync(
                runtime.ProductionId,
                async context =>
                {
                    foreach (var live in context.Runtime.Devices.Where(d => d.IsReportStale(context.Now, options.ReportStaleAfter)).ToList())
                    {
                        var device = await context.Data.Devices.GetAsync(live.DeviceId, cancellationToken);
                        if (device is null || !string.Equals(device.ProductionId, context.ProductionId, StringComparison.Ordinal))
                        {
                            continue;
                        }

                        live.MarkReportStale();
                        SourceMonitor.Reevaluate(context, device);
                    }
                },
                cancellationToken);
        }
    }

    /// <summary>Allocates another screen or the optional camera.</summary>
    public Task<DeviceSlotDto> AllocateSlotAsync(DeviceIdentity identity, AllocateSlotRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentNullException.ThrowIfNull(request);
        return coordinator.ExecuteAsync(
            identity.ProductionId,
            async context =>
            {
                var device = await context.DeviceAsync(identity.DeviceId, cancellationToken);
                var catalog = await context.CatalogAsync(cancellationToken);
                var slot = device.AllocateSlot(request.Kind, catalog.CodesInUse);
                SourceMonitor.Introduce(context, device, slot);
                await SlotsChangedAsync(context, device, cancellationToken);
                return new DeviceSlotDto(slot.Slot, slot.Code, slot.Kind);
            },
            cancellationToken);
    }

    /// <summary>
    /// Removes a slot and its source («Entfernen»). An unknown slot is <c>not_found</c>; the camera of a phone cannot be
    /// removed (<c>conflict</c>, GAP-19).
    /// </summary>
    public Task ReleaseSlotAsync(DeviceIdentity identity, string slot, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        return coordinator.ExecuteAsync(
            identity.ProductionId,
            async context =>
            {
                var device = await context.DeviceAsync(identity.DeviceId, cancellationToken);
                var released = device.ReleaseSlot(slot) ?? throw FlowStudioException.NotFound("Der Slot");
                var sourceId = device.SourceIdOf(released);
                SourceMonitor.Forget(context, sourceId);
                context.Emit(revision => new SourceRemovedEvent(revision, sourceId));
                context.Runtime.Device(device.Id).ForgetSlot(released.Slot);
                await SlotsChangedAsync(context, device, cancellationToken);
            },
            cancellationToken);
    }

    /// <summary>The device removes itself.</summary>
    public async Task UnpairAsync(DeviceIdentity identity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        await coordinator.ExecuteAsync(
            identity.ProductionId,
            async context => DeviceEvents.Remove(context, await context.DeviceAsync(identity.DeviceId, cancellationToken), AuditActors.Device(identity.DeviceId)),
            cancellationToken);
        await kicker.KickAsync(identity.ProductionId, identity.DeviceId);
    }

    private static async Task SlotsChangedAsync(MutationContext context, Device device, CancellationToken cancellationToken)
    {
        var live = context.Runtime.Device(device.Id);
        live.Slots = [.. device.Slots.Select(s => s.Slot)];
        await DeviceEvents.SendSelfAsync(context, device, cancellationToken);
        context.RefreshTallies();
    }

    private static async Task<OnAirState> OnAirAsync(MutationContext context, CancellationToken cancellationToken)
    {
        if (context.Runtime.OnAir is { } known)
        {
            return known;
        }

        var onAir = OnAirState.From(await context.ProductionAsync(cancellationToken));
        context.Runtime.OnAir = onAir;
        return onAir;
    }
}
