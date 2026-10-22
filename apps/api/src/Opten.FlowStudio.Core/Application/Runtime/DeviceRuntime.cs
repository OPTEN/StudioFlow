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
    private readonly Dictionary<string, SlotState> slotStates = new(StringComparer.Ordinal);

    /// <summary>Device id.</summary>
    public string DeviceId { get; } = deviceId;

    /// <summary>Active hub connection, null when the device is not connected.</summary>
    public string? ConnectionId { get; private set; }

    /// <summary>Browser tab of the active session.</summary>
    public string? SessionId { get; private set; }

    /// <summary>Media connection state from the last report.</summary>
    public RtcState? Rtc { get; private set; }

    /// <summary>Last telemetry.</summary>
    public DeviceTelemetryDto? Telemetry { get; private set; }

    /// <summary>Last technical check result.</summary>
    public TechCheckDto? TechCheck { get; private set; }

    /// <summary>Last control connection or report.</summary>
    public DateTimeOffset? LastSeenAt { get; private set; }

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
    /// replaced; a reconnect of the same tab just drops the stale connection.
    /// </summary>
    public SessionTakeover Attach(string connectionId, string sessionId, DateTimeOffset now)
    {
        var previous = ConnectionId;
        var isNewConnection = !string.Equals(previous, connectionId, StringComparison.Ordinal);
        var replaced = previous is not null && isNewConnection ? previous : null;
        var notify = replaced is not null && !string.Equals(SessionId, sessionId, StringComparison.Ordinal);

        // The last report stays valid until the new session reports (about 2 s): a takeover by another tab must not
        // look like an outage while the old media session still sends.
        if (isNewConnection)
        {
            LastTally = null;
        }

        ConnectionId = connectionId;
        SessionId = sessionId;
        LastSeenAt = now;
        return new SessionTakeover(replaced, notify);
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
        LastSeenAt = now;
        return true;
    }

    /// <summary>Applies a report; returns the telemetry built from it and whether the technical check changed.</summary>
    public (DeviceTelemetryDto Telemetry, bool TechCheckChanged) ApplyReport(DeviceReportDto report, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(report);
        Rtc = Enum.IsDefined(report.Rtc) ? report.Rtc : RtcState.Disconnected;
        var slots = (report.Slots ?? []).Where(s => s is not null && DeviceSlots.IsValid(s.Slot) && Enum.IsDefined(s.State))
            .Take(DeviceSlots.MaxScreens + 1)
            .Select(Sanitize)
            .ToList();
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

    /// <summary>Reported state of a slot, if any. Ended and failed states survive a disconnect; live does not count without a connected media session.</summary>
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

    private static SlotTelemetryDto Sanitize(SlotTelemetryDto slot) => slot with
    {
        Width = slot.Width is > 0 and <= 16_384 ? slot.Width : null,
        Height = slot.Height is > 0 and <= 16_384 ? slot.Height : null,
        Fps = slot.Fps is >= 0 and <= 1000 ? slot.Fps : null,
        BitrateKbps = slot.BitrateKbps is >= 0 and <= 1_000_000 ? slot.BitrateKbps : null,
        PacketLossPct = slot.PacketLossPct is >= 0 and <= 100 ? slot.PacketLossPct : null,
        Codec = TextRules.Truncate(slot.Codec, 32),
    };
}
