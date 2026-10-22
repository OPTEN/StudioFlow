using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>Everything the server knows about one device slot at a moment (spec 4.5).</summary>
/// <param name="Blocked">The device is blocked.</param>
/// <param name="Connected">The device hub connection is up (the fast signal; LiveKit only notices after ~21 s).</param>
/// <param name="Published">LiveKit reports a published track with the slot name for the device identity.</param>
/// <param name="Reported">Slot state from the last device report, if any.</param>
/// <param name="Rtc">Media connection state from the last device report, if any.</param>
public sealed record SlotSignals(bool Blocked, bool Connected, bool Published, SlotState? Reported, RtcState? Rtc)
{
    /// <summary>True when the track is published or the device itself reports the slot live over a connected media session.</summary>
    public bool IsLive => Published || (Reported == SlotState.Live && Rtc == RtcState.Connected);
}

/// <summary>Pure rules that turn <see cref="SlotSignals"/> into a <see cref="SourceStatus"/> (spec 4.5).</summary>
public static class SourceStatusRules
{
    /// <summary>
    /// Evaluates the status. <paramref name="wasLive"/> is true when the slot was <c>ok</c> before and has not been
    /// blocked or removed since; it distinguishes an outage (<c>reconnecting</c>, no escalation) from a slot that never
    /// went live (<c>connecting</c> / <c>offline</c>). A paused slot counts as ended by the sender.
    /// </summary>
    public static SourceStatus Evaluate(SlotSignals signals, bool wasLive)
    {
        ArgumentNullException.ThrowIfNull(signals);
        if (signals.Blocked)
        {
            return SourceStatus.Blocked;
        }

        if (signals.Reported is SlotState.Ended or SlotState.Paused)
        {
            return SourceStatus.Ended;
        }

        if (signals.Reported == SlotState.Failed)
        {
            return SourceStatus.Lost;
        }

        if (signals.Connected && signals.IsLive)
        {
            return SourceStatus.Ok;
        }

        if (wasLive)
        {
            return SourceStatus.Reconnecting;
        }

        return signals.Connected ? SourceStatus.Connecting : SourceStatus.Offline;
    }

    /// <summary>True for the states shown as an outage.</summary>
    public static bool IsDown(SourceStatus status) => status is SourceStatus.Reconnecting or SourceStatus.Ended or SourceStatus.Lost;

    /// <summary>Incident kind of a down status.</summary>
    public static IncidentKind IncidentKindOf(SourceStatus status) => status switch
    {
        SourceStatus.Ended => IncidentKind.Ended,
        SourceStatus.Lost => IncidentKind.Lost,
        _ => IncidentKind.Reconnecting,
    };
}

/// <summary>What changed when a new status was applied.</summary>
/// <param name="StatusChanged">The status (and its timestamp) changed: emit <c>sourceUpserted</c>.</param>
/// <param name="RemovedIncident">Incident that was replaced or cleared: emit <c>incidentRemoved</c>.</param>
/// <param name="UpsertedIncident">Incident that was opened, escalated or recovered: emit <c>incidentUpserted</c>.</param>
/// <param name="LogAction">Audit action for «Letzte Ereignisse», if any.</param>
public sealed record SourceHealthChange(bool StatusChanged, IncidentDto? RemovedIncident, IncidentDto? UpsertedIncident, string? LogAction)
{
    /// <summary>Nothing changed.</summary>
    public static SourceHealthChange None { get; } = new(false, null, null, null);
}

/// <summary>
/// The status and incident state machine of one source (spec 4.5). Only a transition from <c>ok</c> to an outage opens
/// an incident (replacing an earlier one of the same source); an escalation of an open incident from
/// <c>reconnecting</c> to <c>ended</c> or <c>lost</c> updates its kind; returning to <c>ok</c> sets <c>endedAt</c>
/// until someone acknowledges it; blocking removes it.
/// </summary>
public sealed class SourceHealth(string sourceId, string code, SourceStatus initial, DateTimeOffset? since = null)
{
    /// <summary>The source.</summary>
    public string SourceId { get; } = sourceId;

    /// <summary>Slot code (for incidents and log texts).</summary>
    public string Code { get; } = code;

    /// <summary>Current status.</summary>
    public SourceStatus Status { get; private set; } = initial;

    /// <summary>Time of the last status change; null before the first change.</summary>
    public DateTimeOffset? Since { get; private set; } = since;

    /// <summary>The slot was ok and has not been blocked since.</summary>
    public bool WasLive { get; private set; }

    /// <summary>The current incident (open or recovered and not acknowledged).</summary>
    public IncidentDto? Incident { get; private set; }

    /// <summary>Applies a newly evaluated status.</summary>
    public SourceHealthChange Apply(SourceStatus next, DateTimeOffset now)
    {
        if (next == Status)
        {
            return SourceHealthChange.None;
        }

        var previous = Status;
        Status = next;
        Since = now;
        if (next == SourceStatus.Ok)
        {
            WasLive = true;
            return Recover(now);
        }

        if (next == SourceStatus.Blocked)
        {
            WasLive = false;
            return new SourceHealthChange(true, ClearIncident(), null, null);
        }

        if (!SourceStatusRules.IsDown(next))
        {
            return new SourceHealthChange(true, null, null, null);
        }

        var kind = SourceStatusRules.IncidentKindOf(next);
        if (previous == SourceStatus.Ok)
        {
            var replaced = Incident;
            Incident = new IncidentDto(EntityIds.New(EntityIds.Incident), SourceId, Code, kind, now, null);
            return new SourceHealthChange(true, replaced, Incident, LogActionOf(kind));
        }

        if (Incident is { EndedAt: null } && kind != IncidentKind.Reconnecting && Incident.Kind != kind)
        {
            Incident = Incident with { Kind = kind };
            return new SourceHealthChange(true, null, Incident, LogActionOf(kind));
        }

        return new SourceHealthChange(true, null, null, null);
    }

    /// <summary>Removes the incident when its id matches («Gesehen»); returns false for another id.</summary>
    public bool Acknowledge(string incidentId)
    {
        if (Incident is null || !string.Equals(Incident.Id, incidentId, StringComparison.Ordinal))
        {
            return false;
        }

        Incident = null;
        return true;
    }

    /// <summary>Removes the incident (device blocked or source removed) and returns it.</summary>
    public IncidentDto? ClearIncident()
    {
        var removed = Incident;
        Incident = null;
        return removed;
    }

    private static string LogActionOf(IncidentKind kind) => kind switch
    {
        IncidentKind.Ended => AuditActions.SourceEnded,
        IncidentKind.Lost => AuditActions.SourceLost,
        _ => AuditActions.SourceReconnecting,
    };

    private SourceHealthChange Recover(DateTimeOffset now)
    {
        if (Incident is null || Incident.EndedAt is not null)
        {
            return new SourceHealthChange(true, null, null, null);
        }

        Incident = Incident with { EndedAt = now };
        return new SourceHealthChange(true, null, Incident, AuditActions.SourceRecovered);
    }
}
