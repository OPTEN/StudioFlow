namespace Opten.StudioFlow.Core.Contracts;

/// <summary>Live state of the output consumer (chip «Output an Proxy» in the header).</summary>
/// <param name="State">None, connected or stale.</param>
/// <param name="Consumers">Number of connected output pages.</param>
/// <param name="Addresses">Remote IP addresses of the output pages.</param>
/// <param name="LatencyMs">Estimated receive latency reported by the output page.</param>
/// <param name="Fps">Rendered frames per second of the program.</param>
/// <param name="LastReportAt">Last report time.</param>
public sealed record OutputStatusDto(
    OutputState State,
    int Consumers,
    IReadOnlyList<string> Addresses,
    int? LatencyMs,
    double? Fps,
    DateTimeOffset? LastReportAt);

/// <summary>Output settings for the Regie.</summary>
/// <param name="Url">Absolute output URL including the secret key.</param>
/// <param name="KeyCreatedAt">When the current key was created.</param>
/// <param name="AllowedIps">IP addresses or CIDR ranges allowed to open the output; empty allows every address.</param>
/// <param name="FrameAncestors">Domains allowed to embed the output (from configuration, read-only).</param>
public sealed record OutputSettingsDto(
    string Url,
    DateTimeOffset KeyCreatedAt,
    IReadOnlyList<string> AllowedIps,
    IReadOnlyList<string> FrameAncestors);

/// <summary>Sets the IP restriction of the output.</summary>
public sealed record UpdateOutputAccessRequest(IReadOnlyList<string> AllowedIps);

/// <summary>Production state for the output page. Contains no device, pairing or incident data.</summary>
/// <param name="Revision">Same revision counter as the Regie snapshot.</param>
/// <param name="ServerTime">Server clock.</param>
/// <param name="Production">Production settings and switching state.</param>
/// <param name="Scenes">All scenes (the output preloads their sources).</param>
/// <param name="Sources">Sources without health.</param>
/// <param name="Assets">Media with content URLs.</param>
public sealed record OutputSnapshot(
    long Revision,
    DateTimeOffset ServerTime,
    ProductionDto Production,
    IReadOnlyList<SceneDto> Scenes,
    IReadOnlyList<SourceDto> Sources,
    IReadOnlyList<AssetDto> Assets);

/// <summary>Status report of an output page, sent about every two seconds.</summary>
/// <param name="Rendering">The page renders the program (false while connecting).</param>
/// <param name="LatencyMs">Estimated receive latency (RTT/2 plus jitter buffer delay).</param>
/// <param name="Fps">Rendered frames per second.</param>
/// <param name="ProgramSceneId">Scene the page currently shows.</param>
public sealed record OutputReport(bool Rendering, int? LatencyMs, double? Fps, string? ProgramSceneId);
