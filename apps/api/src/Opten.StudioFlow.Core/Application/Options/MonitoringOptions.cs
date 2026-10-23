namespace Opten.StudioFlow.Core.Application;

/// <summary>Staleness and restart timings of the source status (configuration section <c>Sources</c>, spec 4.5, GAP-08, GAP-29).</summary>
public sealed class SourceMonitorOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Sources";

    /// <summary>
    /// <c>Sources:ReportStaleAfter</c>: a connected device without a report for this long counts as
    /// <c>rtc: disconnected</c>; its telemetry is no longer pushed (default 6 s, reports arrive every 2 s).
    /// </summary>
    public TimeSpan ReportStaleAfter { get; set; } = TimeSpan.FromSeconds(6);

    /// <summary>
    /// <c>Sources:RestartGrace</c>: after an API start, a source that was live shortly before, is used in the program or
    /// preview scene and whose device did not reconnect within this time becomes <c>reconnecting</c> with an incident
    /// (default 15 s, spec 12).
    /// </summary>
    public TimeSpan RestartGrace { get; set; } = TimeSpan.FromSeconds(15);

    /// <summary><c>Sources:RestartLiveWindow</c>: how recently a source must have been live to be watched after an API start (default 12 h).</summary>
    public TimeSpan RestartLiveWindow { get; set; } = TimeSpan.FromHours(12);

    /// <summary><c>Sources:LiveMarkInterval</c>: how often the last-live time of live sources is persisted (default 1 minute).</summary>
    public TimeSpan LiveMarkInterval { get; set; } = TimeSpan.FromMinutes(1);

    /// <summary>
    /// <c>Sources:TelemetryInterval</c>: at most one telemetry message per device and this interval goes to the Regie
    /// (default 2 s, spec 6, BUG-19); reports in between are held back and the newest one is relayed when the interval
    /// has passed.
    /// </summary>
    public TimeSpan TelemetryInterval { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>
    /// <c>Sources:CameraCommandInterval</c>: at most one camera command per device and this interval goes to the phone
    /// (default 100 ms, issue #11); commands in between merge and the newest value of each setting is sent when the
    /// interval has passed, so a dragged slider does not flood a weak Wi-Fi.
    /// </summary>
    public TimeSpan CameraCommandInterval { get; set; } = TimeSpan.FromMilliseconds(100);

    /// <inheritdoc />
    public IEnumerable<string> Validate() =>
    [
        .. OptionRules.Duration("Sources:ReportStaleAfter", ReportStaleAfter, TimeSpan.FromSeconds(2), TimeSpan.FromMinutes(5)),
        .. OptionRules.Duration("Sources:RestartGrace", RestartGrace, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(10)),
        .. OptionRules.Duration("Sources:RestartLiveWindow", RestartLiveWindow, TimeSpan.FromMinutes(1), TimeSpan.FromDays(7)),
        .. OptionRules.Duration("Sources:LiveMarkInterval", LiveMarkInterval, TimeSpan.FromSeconds(5), TimeSpan.FromHours(1)),
        .. OptionRules.Duration("Sources:TelemetryInterval", TelemetryInterval, TimeSpan.Zero, TimeSpan.FromMinutes(1)),
        .. OptionRules.Duration("Sources:CameraCommandInterval", CameraCommandInterval, TimeSpan.Zero, TimeSpan.FromSeconds(10)),
    ];
}

/// <summary>Output consumer status timings (configuration section <c>Output</c>, spec 4.8).</summary>
public sealed class OutputMonitorOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Output";

    /// <summary>
    /// <c>Output:StaleAfter</c>: a connected output page counts as <c>connected</c> while its last rendering report is
    /// younger, else <c>stale</c> (default 6 s, reports arrive every 2 s).
    /// </summary>
    public TimeSpan StaleAfter { get; set; } = TimeSpan.FromSeconds(6);

    /// <summary>
    /// <c>Output:MetricsInterval</c>: latency and fps changes are published at most this often unless they change by
    /// more than 20 % (default 5 s).
    /// </summary>
    public TimeSpan MetricsInterval { get; set; } = TimeSpan.FromSeconds(5);

    /// <inheritdoc />
    public IEnumerable<string> Validate() =>
    [
        .. OptionRules.Duration("Output:StaleAfter", StaleAfter, TimeSpan.FromSeconds(2), TimeSpan.FromMinutes(5)),
        .. OptionRules.Duration("Output:MetricsInterval", MetricsInterval, TimeSpan.Zero, TimeSpan.FromMinutes(5)),
    ];
}

/// <summary>SignalR timings and delivery limits (configuration section <c>Realtime</c>, spec 6, GAP-12).</summary>
public sealed class RealtimeOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Realtime";

    /// <summary><c>Realtime:KeepAliveInterval</c>: server keep-alive ping of every hub connection (default 2 s).</summary>
    public TimeSpan KeepAliveInterval { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>
    /// <c>Realtime:ClientTimeout</c>: a hub connection that sent nothing (not even a ping) for this long is closed – the
    /// fast outage signal of a device (default 5 s, at least twice the keep-alive; clients use the same server timeout).
    /// </summary>
    public TimeSpan ClientTimeout { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// <c>Realtime:DeliveryWait</c>: how long the ordered dispatcher of a production waits for one delivery before it
    /// moves on to the next; the slow delivery still completes in the background (default 2 s).
    /// </summary>
    public TimeSpan DeliveryWait { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>
    /// <c>Realtime:ConnectionQueueLimit</c>: messages buffered for one hub connection that does not keep up; when it is
    /// exceeded the connection is closed and the client resubscribes (default 1000; the event ring holds 500).
    /// </summary>
    public int ConnectionQueueLimit { get; set; } = 1000;

    /// <summary>
    /// <c>Realtime:DeliveryGrace</c>: time a final message (<c>sessionReplaced</c>, the blocked <c>self</c>) gets before
    /// its connection is aborted (default 1 s).
    /// </summary>
    public TimeSpan DeliveryGrace { get; set; } = TimeSpan.FromSeconds(1);

    /// <inheritdoc />
    public IEnumerable<string> Validate()
    {
        foreach (var error in OptionRules.Duration("Realtime:KeepAliveInterval", KeepAliveInterval, TimeSpan.FromMilliseconds(500), TimeSpan.FromMinutes(1))
            .Concat(OptionRules.Duration("Realtime:ClientTimeout", ClientTimeout, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(5)))
            .Concat(OptionRules.Duration("Realtime:DeliveryWait", DeliveryWait, TimeSpan.FromMilliseconds(100), TimeSpan.FromMinutes(1)))
            .Concat(OptionRules.Count("Realtime:ConnectionQueueLimit", ConnectionQueueLimit, 16, 100_000))
            .Concat(OptionRules.Duration("Realtime:DeliveryGrace", DeliveryGrace, TimeSpan.Zero, TimeSpan.FromSeconds(30))))
        {
            yield return error;
        }

        if (ClientTimeout < KeepAliveInterval * 2)
        {
            yield return "Realtime:ClientTimeout must be at least twice Realtime:KeepAliveInterval.";
        }
    }
}
