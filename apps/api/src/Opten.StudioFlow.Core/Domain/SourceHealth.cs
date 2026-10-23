using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>Everything the server knows about one device slot at a moment (spec 4.5).</summary>
/// <param name="Blocked">The device is blocked.</param>
/// <param name="Connected">The device hub connection is up (the fast signal; LiveKit only notices after ~21 s).</param>
/// <param name="Published">LiveKit reports a published track with the slot name for the device identity.</param>
/// <param name="Reported">
/// Slot state in the latest report of the device's current session; null (“no state”) when the slot was missing from
/// that report or the session has not reported yet – a new session starts without states, so nothing a previous page
/// or tab reported can make the slot look live.
/// </param>
/// <param name="Rtc">Media connection state in the latest report of the current session, if any.</param>
public sealed record SlotSignals(bool Blocked, bool Connected, bool Published, SlotState? Reported, RtcState? Rtc)
{
    /// <summary>
    /// True when the slot is sending: the track is published (LiveKit) or the device reports the slot live over a
    /// connected media session. Never while the device reports the slot <c>paused</c> (the operating system suspended
    /// the capture) or its media session as reconnecting or disconnected: a frozen or cut-off LiveKit connection sends
    /// no webhook for about 21 s, so the device report is the fast signal (GAP-08, spec 12).
    /// </summary>
    public bool IsLive => Reported != SlotState.Paused
        && Rtc is not (RtcState.Reconnecting or RtcState.Disconnected)
        && (Published || (Reported == SlotState.Live && Rtc == RtcState.Connected));
}

/// <summary>Pure rules that turn <see cref="SlotSignals"/> into a <see cref="SourceStatus"/> (spec 4.5).</summary>
public static class SourceStatusRules
{
    /// <summary>
    /// Evaluates the status. <paramref name="wasLive"/> is true when the slot was <c>ok</c> before and has not been
    /// blocked or removed since; it distinguishes an outage (<c>reconnecting</c>, no escalation) from a slot that never
    /// went live (<c>connecting</c> / <c>offline</c>). A slot reported <c>ended</c> (stopped on purpose: “Stop
    /// sharing”, camera stopped) is <c>ended</c> and <c>failed</c> is <c>lost</c>, whatever the connection; a slot
    /// reported <c>paused</c> (the operating system suspended the camera, e.g. the phone app went to the background) is
    /// not live but expected back, so it is <c>reconnecting</c> when it was live. <c>ok</c> needs a connected device
    /// hub and a live slot (<see cref="SlotSignals.IsLive"/>).
    /// </summary>
    public static SourceStatus Evaluate(SlotSignals signals, bool wasLive)
    {
        ArgumentNullException.ThrowIfNull(signals);
        if (signals.Blocked)
        {
            return SourceStatus.Blocked;
        }

        if (signals.Reported == SlotState.Ended)
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
/// <param name="LogAction">Audit action for “Recent events”, if any.</param>
public sealed record SourceHealthChange(bool StatusChanged, IncidentDto? RemovedIncident, IncidentDto? UpsertedIncident, string? LogAction)
{
    /// <summary>Nothing changed.</summary>
    public static SourceHealthChange None { get; } = new(false, null, null, null);
}

/// <summary>
/// The status and incident state machine of one source (spec 4.5). Only a transition from <c>ok</c> to an outage opens
/// an incident (replacing an earlier one of the same source); an escalation of an open incident from
/// <c>reconnecting</c> to <c>ended</c> or <c>lost</c> updates its kind (a paused camera that is then stopped on purpose:
/// “K1 reconnecting”, then “K1 camera stopped”); the way back from <c>ended</c> or <c>lost</c> to <c>reconnecting</c>
/// keeps the kind; returning to <c>ok</c> sets <c>endedAt</c> until someone acknowledges it; blocking removes it.
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

    /// <summary>
    /// After an API start (spec 12, GAP-08): the source was live shortly before the restart, is on air or in the preview,
    /// and its device did not come back within the grace time. The in-memory history is gone, so the source becomes
    /// <c>reconnecting</c> with an incident that started at <paramref name="outageSince"/> (the restart). Only a source
    /// that is still <c>offline</c> and was not live in this process is affected.
    /// </summary>
    public SourceHealthChange MarkMissingAfterRestart(DateTimeOffset now, DateTimeOffset outageSince)
    {
        if (Status != SourceStatus.Offline || WasLive)
        {
            return SourceHealthChange.None;
        }

        var replaced = Incident;
        Status = SourceStatus.Reconnecting;
        Since = now;
        WasLive = true;
        Incident = new IncidentDto(EntityIds.New(EntityIds.Incident), SourceId, Code, IncidentKind.Reconnecting, outageSince, null);
        return new SourceHealthChange(true, replaced, Incident, AuditActions.SourceReconnecting);
    }

    /// <summary>
    /// Removes the incident when its id matches and the source recovered (“Seen”, UNIT-SRC-02). An open incident
    /// cannot be acknowledged (<c>conflict</c>); another id is not this source's incident.
    /// </summary>
    public bool Acknowledge(string incidentId)
    {
        if (Incident is null || !string.Equals(Incident.Id, incidentId, StringComparison.Ordinal))
        {
            return false;
        }

        if (Incident.EndedAt is null)
        {
            throw StudioFlowException.Conflict(ErrorCodes.Conflict, "The incident is still ongoing; it can only be acknowledged once the source is back.");
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
