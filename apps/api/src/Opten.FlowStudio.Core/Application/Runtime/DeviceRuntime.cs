using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>How a new hub session relates to the previous one of the same device.</summary>
/// <param name="ReplacedConnectionId">Old connection to abort, if any.</param>
/// <param name="NotifyReplaced">True when the old connection belongs to another tab and gets <c>sessionReplaced</c>.</param>
public sealed record SessionTakeover(string? ReplacedConnectionId, bool NotifyReplaced);

/// <summary>
/// Live data of a device (spec 4.6), in memory only: the single active hub session, the last report, telemetry, the
/// technical check and the last tally sent. Mutated only inside the production lock.
/// </summary>
public sealed class DeviceRuntime(string deviceId)
{
    /// <summary>How many replaced tab sessions are remembered per device.</summary>
    private const int ReplacedSessionMemory = 16;

    private readonly Dictionary<string, SlotState> slotStates = new(StringComparer.Ordinal);
    private readonly Queue<string> replacedSessions = new();

    /// <summary>Session of the latest Hello; unlike <see cref="SessionId"/> it survives a disconnect.</summary>
    private string? lastSessionId;

    /// <summary>Device id.</summary>
    public string DeviceId { get; } = deviceId;

    /// <summary>Active hub connection, null when the device is not connected.</summary>
    public string? ConnectionId { get; private set; }

    /// <summary>Browser tab of the active session.</summary>
    public string? SessionId { get; private set; }

    /// <summary>Media connection state from the latest report of the current session.</summary>
    public RtcState? Rtc { get; private set; }

    /// <summary>Last telemetry.</summary>
    public DeviceTelemetryDto? Telemetry { get; private set; }

    /// <summary>Last technical check result.</summary>
    public TechCheckDto? TechCheck { get; private set; }

    /// <summary>Last control connection or report.</summary>
    public DateTimeOffset? LastSeenAt { get; private set; }

    /// <summary>Time of the last report of the active session, or of its start when it has not reported yet.</summary>
    public DateTimeOffset? LastReportAt { get; private set; }

    /// <summary>Connection state last published in a <c>deviceUpserted</c> event.</summary>
    public DeviceConnection PublishedConnection { get; private set; } = DeviceConnection.Offline;

    /// <summary>Time of the last change of <see cref="PublishedConnection"/>.</summary>
    public DateTimeOffset? ConnectionSince { get; private set; }

    /// <summary>Slots of the device (for the tally).</summary>
    public IReadOnlyList<string> Slots { get; set; } = [];

    /// <summary>Last tally pushed to the active session.</summary>
    public TallyDto? LastTally { get; set; }

    /// <summary>True while a hub session is active.</summary>
    public bool IsConnected => ConnectionId is not null;

    /// <summary>
    /// Makes <paramref name="connectionId"/> the active session (newer Hello wins). A different tab is told that it was
    /// replaced; a reconnect of the same tab just drops the stale connection. A new session (another tab, or the same
    /// tab after a reload: every page load has its own session id) starts without reported slot states and without a
    /// media state, because what the previous page reported does not describe this one; until it reports, only LiveKit
    /// can make its slots live. A reconnect of the same session keeps them until its next report.
    /// </summary>
    public SessionTakeover Attach(string connectionId, string sessionId, DateTimeOffset now)
    {
        var previous = ConnectionId;
        var isNewConnection = !string.Equals(previous, connectionId, StringComparison.Ordinal);
        var replaced = previous is not null && isNewConnection ? previous : null;
        var notify = replaced is not null && !string.Equals(SessionId, sessionId, StringComparison.Ordinal);

        if (!string.Equals(lastSessionId, sessionId, StringComparison.Ordinal))
        {
            slotStates.Clear();
            Rtc = null;
        }

        // The stale-report clock keeps running across a takeover (GAP-29): a new session that never reports is noticed
        // as early as the old one would have been.
        if (isNewConnection)
        {
            LastTally = null;
            LastReportAt ??= now;
        }

        if (notify && SessionId is { } old)
        {
            RememberReplaced(old);
        }

        ConnectionId = connectionId;
        SessionId = sessionId;
        lastSessionId = sessionId;
        LastSeenAt = now;
        return new SessionTakeover(replaced, notify);
    }

    /// <summary>
    /// True when <paramref name="sessionId"/> belongs to a tab that another tab took over (GAP-21): its later
    /// <c>Hello</c> is refused, so a replaced tab cannot take the session back by reconnecting on its own.
    /// </summary>
    public bool WasReplaced(string sessionId) =>
        !string.Equals(SessionId, sessionId, StringComparison.Ordinal) && replacedSessions.Contains(sessionId, StringComparer.Ordinal);

    /// <summary>
    /// True when the active session has not reported for <paramref name="staleAfter"/> (GAP-29) and is not marked
    /// disconnected yet.
    /// </summary>
    public bool IsReportStale(DateTimeOffset now, TimeSpan staleAfter) =>
        IsConnected && Rtc != RtcState.Disconnected && LastReportAt is { } last && now - last > staleAfter;

    /// <summary>A silent device counts as <c>rtc: disconnected</c>; its telemetry shows that too, nothing is pushed.</summary>
    public void MarkReportStale()
    {
        Rtc = RtcState.Disconnected;
        if (Telemetry is { } telemetry)
        {
            Telemetry = telemetry with { Rtc = RtcState.Disconnected };
        }
    }

    /// <summary>Ends the session when <paramref name="connectionId"/> is the active one; returns false otherwise.</summary>
    public bool Detach(string connectionId, DateTimeOffset now)
    {
        if (!string.Equals(ConnectionId, connectionId, StringComparison.Ordinal))
        {
            return false;
        }

        ConnectionId = null;
        SessionId = null;
        Rtc = null;
        LastTally = null;
        LastReportAt = null;
        LastSeenAt = now;
        return true;
    }

    /// <summary>
    /// Applies a report (GAP-29): only slots the device owns count (at most 10), out-of-range numbers become null. The
    /// report replaces all slot states: a slot missing from it has no state (not live) from now on, so a stale
    /// <c>live</c> can never outlast the capture it described. Returns the telemetry built from it and whether the
    /// technical check changed.
    /// </summary>
    public (DeviceTelemetryDto Telemetry, bool TechCheckChanged) ApplyReport(DeviceReportDto report, IReadOnlyCollection<string> ownSlots, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(ownSlots);
        Rtc = Enum.IsDefined(report.Rtc) ? report.Rtc : RtcState.Disconnected;
        var slots = (report.Slots ?? []).Where(s => s is not null && ownSlots.Contains(s.Slot, StringComparer.Ordinal) && Enum.IsDefined(s.State))
            .DistinctBy(s => s.Slot, StringComparer.Ordinal)
            .Take(DeviceSlots.MaxScreens + 1)
            .Select(Sanitize)
            .ToList();
        slotStates.Clear();
        foreach (var slot in slots)
        {
            slotStates[slot.Slot] = slot.State;
        }

        var techCheckChanged = false;
        if (report.TechCheck is not null)
        {
            var techCheck = report.TechCheck with { Note = TextRules.Truncate(report.TechCheck.Note, 200) };
            techCheckChanged = techCheck != TechCheck;
            TechCheck = techCheck;
        }

        LastSeenAt = now;
        LastReportAt = now;
        Telemetry = new DeviceTelemetryDto(
            now,
            Rtc.Value,
            report.BatteryPct is >= 0 and <= 100 ? report.BatteryPct : null,
            report.Charging,
            TextRules.Truncate(report.Network, 32),
            report.RttMs is >= 0 and <= 60_000 ? report.RttMs : null,
            slots);
        return (Telemetry, techCheckChanged);
    }

    /// <summary>
    /// State of a slot in the latest report of the current session; null when the slot was missing from it or the
    /// session has not reported yet. Ended and failed states survive a hub disconnect of the same session (not a new
    /// session); live does not count without a connected media session.
    /// </summary>
    public SlotState? SlotStateOf(string slot) => slotStates.TryGetValue(slot, out var state) ? state : null;

    /// <summary>Forgets the reported state of a removed slot.</summary>
    public void ForgetSlot(string slot) => slotStates.Remove(slot);

    /// <summary>Records a new published connection state; returns false when it did not change.</summary>
    public bool PublishConnection(DeviceConnection connection, DateTimeOffset now)
    {
        if (connection == PublishedConnection)
        {
            return false;
        }

        PublishedConnection = connection;
        ConnectionSince = now;
        return true;
    }

    private void RememberReplaced(string sessionId)
    {
        if (replacedSessions.Contains(sessionId, StringComparer.Ordinal))
        {
            return;
        }

        if (replacedSessions.Count == ReplacedSessionMemory)
        {
            replacedSessions.Dequeue();
        }

        replacedSessions.Enqueue(sessionId);
    }

    private static SlotTelemetryDto Sanitize(SlotTelemetryDto slot) => slot with
    {
        Width = slot.Width is >= 0 and <= 16_384 ? slot.Width : null,
        Height = slot.Height is >= 0 and <= 16_384 ? slot.Height : null,
        Fps = slot.Fps is >= 0 and <= 1000 ? slot.Fps : null,
        BitrateKbps = slot.BitrateKbps is >= 0 and <= 1_000_000 ? slot.BitrateKbps : null,
        PacketLossPct = slot.PacketLossPct is >= 0 and <= 100 ? slot.PacketLossPct : null,
        Codec = TextRules.Truncate(slot.Codec, 32),
    };
}
