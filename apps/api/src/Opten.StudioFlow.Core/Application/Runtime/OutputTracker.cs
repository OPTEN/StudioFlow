using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Application.Runtime;

/// <summary>
/// Output consumer status of a production (spec 4.8), kept per output link: connected output hub pages, their addresses
/// and the last report of the link. A link is <c>connected</c> with at least one page and a rendering report within
/// <c>Output:StaleAfter</c> (6 s), <c>stale</c> when connected without a fresh rendering report, <c>none</c> without a
/// page. The summary over all links is connected when any link is, else stale when any link is. Latency and fps updates
/// are published at most every <c>Output:MetricsInterval</c> (5 s) unless they change by more than 20 %.
/// </summary>
public sealed class OutputTracker(OutputMonitorOptions options)
{
    private const double SignificantChange = 0.2;

    private readonly Dictionary<string, string> linkNames = new(StringComparer.Ordinal);
    private readonly Dictionary<string, LinkState> links = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> connectionLinks = new(StringComparer.Ordinal);
    private DateTimeOffset? lastMetricsPublishedAt;

    /// <summary>Status last published to the Regie.</summary>
    public OutputStatusDto Published { get; private set; } = new(OutputState.None, 0, [], null, null, null, []);

    /// <summary>True once the links were set (<see cref="LoadLinks"/> or <see cref="SetLinks"/>).</summary>
    public bool HasLinks { get; private set; }

    /// <summary>Ids of the connected output hub connections.</summary>
    public IReadOnlyCollection<string> ConnectionIds => connectionLinks.Keys;

    /// <summary>Ids of the connected output hub connections of one link.</summary>
    public IReadOnlyList<string> ConnectionIdsOf(string linkId) => links.TryGetValue(linkId, out var state) ? [.. state.Connections.Keys] : [];

    /// <summary>Remote address of a connection.</summary>
    public string? AddressOf(string connectionId) =>
        connectionLinks.TryGetValue(connectionId, out var linkId) ? links[linkId].Connections[connectionId] : null;

    /// <summary>
    /// Sets the links the first time after a start: nobody has seen a status of this process yet, so the status of the
    /// links is also what counts as published (a later change of the links, even to none, is then an event).
    /// </summary>
    public void LoadLinks(IEnumerable<(string Id, string Name)> current, DateTimeOffset now)
    {
        SetLinks(current);
        Published = Current(now);
    }

    /// <summary>Sets the links of the production (id and name): new ones appear, renamed ones change, revoked ones are forgotten.</summary>
    public void SetLinks(IEnumerable<(string Id, string Name)> current)
    {
        ArgumentNullException.ThrowIfNull(current);
        linkNames.Clear();
        foreach (var (id, name) in current)
        {
            linkNames[id] = name;
        }

        foreach (var gone in links.Keys.Where(id => !linkNames.ContainsKey(id)).ToList())
        {
            foreach (var connectionId in links[gone].Connections.Keys)
            {
                connectionLinks.Remove(connectionId);
            }

            links.Remove(gone);
        }

        HasLinks = true;
    }

    /// <summary>Registers an output page connection of a link.</summary>
    public void Connect(string connectionId, string linkId, string address)
    {
        if (!links.TryGetValue(linkId, out var state))
        {
            links[linkId] = state = new LinkState();
        }

        state.Connections[connectionId] = address;
        connectionLinks[connectionId] = linkId;
    }

    /// <summary>Removes an output page connection; false when it was not connected.</summary>
    public bool Disconnect(string connectionId)
    {
        if (!connectionLinks.Remove(connectionId, out var linkId))
        {
            return false;
        }

        links[linkId].Connections.Remove(connectionId);
        return true;
    }

    /// <summary>Id of the link a connection belongs to.</summary>
    public string? LinkOf(string connectionId) => connectionLinks.GetValueOrDefault(connectionId);

    /// <summary>Records a report (hub or REST) of a link.</summary>
    public void Report(string linkId, OutputReport report, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(report);
        if (!links.TryGetValue(linkId, out var state))
        {
            links[linkId] = state = new LinkState();
        }

        state.LastReport = report with
        {
            LatencyMs = report.LatencyMs is >= 0 and <= 600_000 ? report.LatencyMs : null,
            Fps = report.Fps is >= 0 and <= 1000 ? report.Fps : null,
        };
        state.LastReportAt = now;
        if (report.Rendering)
        {
            state.LastRenderingAt = now;
        }
    }

    /// <summary>The status at <paramref name="now"/>.</summary>
    public OutputStatusDto Current(DateTimeOffset now)
    {
        var statuses = linkNames
            .OrderBy(l => l.Value, StringComparer.OrdinalIgnoreCase).ThenBy(l => l.Key, StringComparer.Ordinal)
            .Select(l => Status(l.Key, l.Value, links.GetValueOrDefault(l.Key), now))
            .ToArray();
        var lastReported = statuses.Where(s => s.LastReportAt is not null).MaxBy(s => s.LastReportAt);
        var state = statuses.Any(s => s.State == OutputState.Connected) ? OutputState.Connected
            : statuses.Any(s => s.State == OutputState.Stale) ? OutputState.Stale
            : OutputState.None;
        var addresses = statuses.SelectMany(s => s.Addresses).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
        return new OutputStatusDto(state, statuses.Sum(s => s.Consumers), addresses, lastReported?.LatencyMs, lastReported?.Fps, lastReported?.LastReportAt, statuses);
    }

    /// <summary>
    /// The status to publish now, or null when the change is not worth an event (only the report time moved, or a small
    /// metric change within the 5 s interval).
    /// </summary>
    public OutputStatusDto? TakeChange(DateTimeOffset now)
    {
        var current = Current(now);
        var previous = Published;
        var structural = !SameStructure(current, previous) || !current.Links.Select(Structure).SequenceEqual(previous.Links.Select(Structure));
        var metricsChanged = MetricsDiffer(current.LatencyMs, current.Fps, previous.LatencyMs, previous.Fps)
            || current.Links.Count != previous.Links.Count
            || current.Links.Zip(previous.Links).Any(pair => MetricsDiffer(pair.First.LatencyMs, pair.First.Fps, pair.Second.LatencyMs, pair.Second.Fps));
        if (!structural && !metricsChanged)
        {
            return null;
        }

        var significant = IsSignificant(previous.LatencyMs, current.LatencyMs) || IsSignificant(previous.Fps, current.Fps)
            || current.Links.Zip(previous.Links).Any(pair => IsSignificant(pair.Second.LatencyMs, pair.First.LatencyMs) || IsSignificant(pair.Second.Fps, pair.First.Fps));
        var intervalPassed = lastMetricsPublishedAt is not { } at || now - at >= options.MetricsInterval;
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

    private OutputLinkStatusDto Status(string linkId, string name, LinkState? state, DateTimeOffset now)
    {
        var consumers = state?.Connections.Count ?? 0;
        var status = consumers == 0
            ? OutputState.None
            : state!.LastRenderingAt is { } rendering && now - rendering <= options.StaleAfter ? OutputState.Connected : OutputState.Stale;
        var addresses = state?.Connections.Values.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray() ?? [];
        return new OutputLinkStatusDto(linkId, name, status, consumers, addresses, state?.LastReport?.LatencyMs, state?.LastReport?.Fps, state?.LastReportAt);
    }

    private static bool SameStructure(OutputStatusDto current, OutputStatusDto previous) =>
        current.State == previous.State && current.Consumers == previous.Consumers && current.Addresses.SequenceEqual(previous.Addresses, StringComparer.Ordinal);

    private static string Structure(OutputLinkStatusDto link) =>
        $"{link.LinkId}|{link.Name}|{link.State}|{link.Consumers}|{string.Join(',', link.Addresses)}";

    private static bool MetricsDiffer(int? latency, double? fps, int? previousLatency, double? previousFps) =>
        latency != previousLatency || !Nullable.Equals(fps, previousFps);

    private static bool IsSignificant(double? before, double? after)
    {
        if (before is null || after is null)
        {
            return before.HasValue != after.HasValue;
        }

        var reference = Math.Max(Math.Abs(before.Value), 1);
        return Math.Abs(after.Value - before.Value) / reference > SignificantChange;
    }

    /// <summary>Pages and last report of one link.</summary>
    private sealed class LinkState
    {
        public Dictionary<string, string> Connections { get; } = new(StringComparer.Ordinal);

        public OutputReport? LastReport { get; set; }

        public DateTimeOffset? LastReportAt { get; set; }

        public DateTimeOffset? LastRenderingAt { get; set; }
    }
}
