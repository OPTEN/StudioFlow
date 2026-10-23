using System.Globalization;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application;

/// <summary>
/// Turns the three inputs of the source status – hub connection, LiveKit tracks and device reports – plus the block
/// state into source statuses, incidents, log entries and the device connection state (spec 4.5). Runs inside the
/// production lock.
/// </summary>
public static class SourceMonitor
{
    /// <summary>
    /// Re-evaluates every slot of a device and emits what changed. Not while the host shuts down (BUG-20): the hub
    /// connections end because the API stops, which is no outage of the sources; after the restart the restart watch
    /// (spec 12) flags a source whose device does not come back.
    /// </summary>
    public static void Reevaluate(MutationContext context, Device device)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(device);
        if (context.IsHostStopping)
        {
            return;
        }

        var runtime = context.Runtime;
        var live = runtime.Device(device.Id);
        foreach (var slot in device.Slots)
        {
            var health = HealthOf(runtime, device, slot);
            var signals = new SlotSignals(device.IsBlocked, live.IsConnected, runtime.Room.IsPublished(device.Id, slot.Slot), live.SlotStateOf(slot.Slot), live.Rtc);
            var wasOk = health.Status == SourceStatus.Ok;
            var change = health.Apply(SourceStatusRules.Evaluate(signals, health.WasLive), context.Now);
            if (change.StatusChanged && (wasOk || health.Status == SourceStatus.Ok))
            {
                // Going live and stopping being live both record the last-live time for the restart watch.
                context.MarkLive(health.SourceId, device.Id);
            }

            Publish(context, device, slot, health, change);
        }

        PublishConnection(context, device, live);
    }

    /// <summary>
    /// The restart watch of spec 12 / GAP-08: flags a source of <paramref name="device"/> that was live shortly before
    /// the API started but whose device has not come back. Returns true when the source changed.
    /// </summary>
    public static bool MarkMissingAfterRestart(MutationContext context, Device device, DeviceSlot slot, DateTimeOffset outageSince)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(device);
        ArgumentNullException.ThrowIfNull(slot);
        var runtime = context.Runtime;
        if (context.IsHostStopping || device.IsBlocked || runtime.FindDevice(device.Id)?.IsConnected == true)
        {
            return false;
        }

        var health = HealthOf(runtime, device, slot);
        var change = health.MarkMissingAfterRestart(context.Now, outageSince);
        if (!change.StatusChanged)
        {
            return false;
        }

        Publish(context, device, slot, health, change);
        PublishConnection(context, device, runtime.Device(device.Id));
        return true;
    }

    /// <summary>Records the last-live time of every live device source of the production (periodic, GAP-08).</summary>
    public static int MarkLiveSources(MutationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var count = 0;
        foreach (var health in context.Runtime.Sources.Values.Where(h => h.Status == SourceStatus.Ok))
        {
            if (SourceRef.TryParse(health.SourceId, out var source) && source.IsDevice)
            {
                context.MarkLive(health.SourceId, source.DeviceId);
                count++;
            }
        }

        return count;
    }

    /// <summary>Starts the health of a new slot with its evaluated status and emits the new source.</summary>
    public static void Introduce(MutationContext context, Device device, DeviceSlot slot)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(device);
        ArgumentNullException.ThrowIfNull(slot);
        var runtime = context.Runtime;
        var live = runtime.Device(device.Id);
        var signals = new SlotSignals(device.IsBlocked, live.IsConnected, runtime.Room.IsPublished(device.Id, slot.Slot), live.SlotStateOf(slot.Slot), live.Rtc);
        var id = device.SourceIdOf(slot);
        runtime.Sources[id] = new SourceHealth(id, slot.Code, SourceStatusRules.Evaluate(signals, wasLive: false), context.Now);
        var dto = SourceOf(runtime, device, slot);
        context.Emit(revision => new SourceUpsertedEvent(revision, dto));
    }

    /// <summary>Emits <c>sourceUpserted</c> for every slot (labels changed after a rename; the output sees these).</summary>
    public static void PublishSources(MutationContext context, Device device)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(device);
        foreach (var slot in device.Slots)
        {
            var dto = SourceOf(context.Runtime, device, slot);
            context.Emit(revision => new SourceUpsertedEvent(revision, dto));
        }
    }

    /// <summary>Forgets the health of a removed source and removes its incident.</summary>
    public static void Forget(MutationContext context, string sourceId)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.Runtime.Sources.Remove(sourceId, out var health) && health.Incident is { } incident)
        {
            context.Emit(revision => new IncidentRemovedEvent(revision, incident.Id));
        }
    }

    /// <summary>The source DTO of a device slot with its current health.</summary>
    public static SourceDto SourceOf(ProductionRuntime runtime, Device device, DeviceSlot slot)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        ArgumentNullException.ThrowIfNull(device);
        ArgumentNullException.ThrowIfNull(slot);
        var id = device.SourceIdOf(slot);
        var entry = new SourceEntry(id, slot.Code, slot.Kind, device.LabelOf(slot), device, slot, null);
        return Dtos.Source(entry, runtime.Sources.GetValueOrDefault(id));
    }

    /// <summary>
    /// Device connection state (spec 4.6): online with a hub session (reconnecting while the media session reconnects, or
    /// is reported disconnected while a source that was live is expected back); without a session reconnecting when a
    /// source that was live is expected back, offline otherwise.
    /// </summary>
    public static DeviceConnection ConnectionOf(ProductionRuntime runtime, Device device, DeviceRuntime live)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        ArgumentNullException.ThrowIfNull(device);
        ArgumentNullException.ThrowIfNull(live);
        var expectedBack = !device.IsBlocked && device.Slots.Any(s => runtime.Sources.TryGetValue(device.SourceIdOf(s), out var h) && h.Status == SourceStatus.Reconnecting);
        if (live.IsConnected)
        {
            return live.Rtc == RtcState.Reconnecting || (live.Rtc == RtcState.Disconnected && expectedBack) ? DeviceConnection.Reconnecting : DeviceConnection.Online;
        }

        return expectedBack ? DeviceConnection.Reconnecting : DeviceConnection.Offline;
    }

    private static SourceHealth HealthOf(ProductionRuntime runtime, Device device, DeviceSlot slot)
    {
        var id = device.SourceIdOf(slot);
        if (!runtime.Sources.TryGetValue(id, out var health))
        {
            health = new SourceHealth(id, slot.Code, device.IsBlocked ? SourceStatus.Blocked : SourceStatus.Offline);
            runtime.Sources[id] = health;
        }

        return health;
    }

    private static void Publish(MutationContext context, Device device, DeviceSlot slot, SourceHealth health, SourceHealthChange change)
    {
        if (change.StatusChanged)
        {
            // Health only: the output page sees revisionOnly (GAP-07).
            var dto = SourceOf(context.Runtime, device, slot);
            context.EmitHiddenFromOutput(revision => new SourceUpsertedEvent(revision, dto));
        }

        if (change.RemovedIncident is { } removed)
        {
            context.Emit(revision => new IncidentRemovedEvent(revision, removed.Id));
        }

        if (change.UpsertedIncident is { } upserted)
        {
            context.Emit(revision => new IncidentUpsertedEvent(revision, upserted));
        }

        if (change.LogAction is { } action)
        {
            var details = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [AuditDetails.Code] = health.Code,
                [AuditDetails.Kind] = slot.Kind.ToString(),
            };
            if (action == AuditActions.SourceRecovered && change.UpsertedIncident is { EndedAt: { } endedAt } recovered)
            {
                var seconds = (int)Math.Round((endedAt - recovered.StartedAt).TotalSeconds);
                details[AuditDetails.DownSeconds] = seconds.ToString(CultureInfo.InvariantCulture);
            }

            context.Audit(AuditActors.System, action, details);
        }
    }

    private static void PublishConnection(MutationContext context, Device device, DeviceRuntime live)
    {
        if (live.PublishConnection(ConnectionOf(context.Runtime, device, live), context.Now))
        {
            var dto = Dtos.Device(device, live);
            context.Emit(revision => new DeviceUpsertedEvent(revision, dto));
        }
    }
}
