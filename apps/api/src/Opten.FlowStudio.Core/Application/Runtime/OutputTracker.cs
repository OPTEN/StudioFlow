using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>
/// Output consumer status of a production (spec 4.8): connected output hub pages, their addresses and the last report.
/// <c>connected</c> needs at least one page and a rendering report within 6 s, <c>stale</c> means connected without a
/// fresh rendering report, <c>none</c> means no page. Latency and fps updates are published at most every 5 s unless
/// they change by more than 20 %.
/// </summary>
public sealed class OutputTracker
{
    /// <summary>How long a rendering report counts as fresh.</summary>
    public static readonly TimeSpan FreshReport = TimeSpan.FromSeconds(6);

    /// <summary>Minimum interval between metric-only updates.</summary>
    public static readonly TimeSpan MetricsInterval = TimeSpan.FromSeconds(5);

    private const double SignificantChange = 0.2;

    private readonly Dictionary<string, string> connections = new(StringComparer.Ordinal);
    private OutputReport? lastReport;
    private DateTimeOffset? lastReportAt;
    private DateTimeOffset? lastRenderingAt;
    private DateTimeOffset? lastMetricsPublishedAt;

    /// <summary>Status last published to the Regie.</summary>
    public OutputStatusDto Published { get; private set; } = new(OutputState.None, 0, [], null, null, null);

    /// <summary>Ids of the connected output hub connections.</summary>
    public IReadOnlyCollection<string> ConnectionIds => connections.Keys;

    /// <summary>Remote address of a connection.</summary>
    public string? AddressOf(string connectionId) => connections.GetValueOrDefault(connectionId);

    /// <summary>Registers an output page connection.</summary>
    public void Connect(string connectionId, string address) => connections[connectionId] = address;

    /// <summary>Removes an output page connection.</summary>
    public bool Disconnect(string connectionId) => connections.Remove(connectionId);

    /// <summary>Records a report (hub or REST).</summary>
    public void Report(OutputReport report, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(report);
        lastReport = report with
        {
            LatencyMs = report.LatencyMs is >= 0 and <= 600_000 ? report.LatencyMs : null,
            Fps = report.Fps is >= 0 and <= 1000 ? report.Fps : null,
        };
        lastReportAt = now;
        if (report.Rendering)
        {
            lastRenderingAt = now;
        }
    }

    /// <summary>The status at <paramref name="now"/>.</summary>
    public OutputStatusDto Current(DateTimeOffset now)
    {
        var consumers = connections.Count;
        var state = consumers == 0
            ? OutputState.None
            : lastRenderingAt is { } rendering && now - rendering <= FreshReport ? OutputState.Connected : OutputState.Stale;
        var addresses = connections.Values.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        return new OutputStatusDto(state, consumers, addresses, lastReport?.LatencyMs, lastReport?.Fps, lastReportAt);
    }

    /// <summary>
    /// The status to publish now, or null when the change is not worth an event (only the report time moved, or a small
    /// metric change within the 5 s interval).
    /// </summary>
    public OutputStatusDto? TakeChange(DateTimeOffset now)
    {
        var current = Current(now);
        var previous = Published;
        var structural = current.State != previous.State || current.Consumers != previous.Consumers || !current.Addresses.SequenceEqual(previous.Addresses, StringComparer.Ordinal);
        var metricsChanged = current.LatencyMs != previous.LatencyMs || !Nullable.Equals(current.Fps, previous.Fps);
        if (!structural && !metricsChanged)
        {
            return null;
        }

        var significant = IsSignificant(previous.LatencyMs, current.LatencyMs) || IsSignificant(previous.Fps, current.Fps);
        var intervalPassed = lastMetricsPublishedAt is not { } at || now - at >= MetricsInterval;
        if (!structural && !significant && !intervalPassed)
        {
            return null;
        }

        Published = current;
        if (metricsChanged)
        {
            lastMetricsPublishedAt = now;
        }

        return current;
    }

    private static bool IsSignificant(double? before, double? after)
    {
        if (before is null || after is null)
        {
            return before.HasValue != after.HasValue;
        }

        var reference = Math.Max(Math.Abs(before.Value), 1);
        return Math.Abs(after.Value - before.Value) / reference > SignificantChange;
    }
}
