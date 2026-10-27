namespace Opten.StudioFlow.Core.Contracts;

/// <summary>Live state of one output link (a consumer such as the proxy or the Teams camera).</summary>
/// <param name="LinkId">Link id.</param>
/// <param name="Name">Link name.</param>
/// <param name="State">None, connected or stale.</param>
/// <param name="Consumers">Number of connected output pages of the link.</param>
/// <param name="Addresses">Remote IP addresses of the output pages of the link.</param>
/// <param name="LatencyMs">Estimated receive latency reported by the output page.</param>
/// <param name="Fps">Rendered frames per second of the program.</param>
/// <param name="LastReportAt">Last report time.</param>
/// <param name="DroppedFramesPct">Share of the frames the output page could not show, in percent (the computer cannot keep up).</param>
/// <param name="DecodedStreams">Number of video streams the output page decodes.</param>
/// <param name="SoftwareDecodedStreams">Number of those streams decoded in software.</param>
public sealed record OutputLinkStatusDto(
    string LinkId,
    string Name,
    OutputState State,
    int Consumers,
    IReadOnlyList<string> Addresses,
    int? LatencyMs,
    double? Fps,
    DateTimeOffset? LastReportAt,
    double? DroppedFramesPct = null,
    int? DecodedStreams = null,
    int? SoftwareDecodedStreams = null);

/// <summary>
/// Live state of the output (chip “Output” in the header): the summary over all links, and every link on its own.
/// </summary>
/// <param name="State">Connected when any link is connected, else stale when any link is stale, else none.</param>
/// <param name="Consumers">Number of connected output pages of all links.</param>
/// <param name="Addresses">Remote IP addresses of the output pages of all links.</param>
/// <param name="LatencyMs">Estimated receive latency reported by the output page that reported last.</param>
/// <param name="Fps">Rendered frames per second of the program, from the same report.</param>
/// <param name="LastReportAt">Last report time of any link.</param>
/// <param name="Links">Every output link of the production, ordered by name.</param>
/// <param name="DroppedFramesPct">Dropped frames of the output page that reported last, in percent.</param>
/// <param name="DecodedStreams">Streams that page decodes.</param>
/// <param name="SoftwareDecodedStreams">Of those, the streams decoded in software.</param>
public sealed record OutputStatusDto(
    OutputState State,
    int Consumers,
    IReadOnlyList<string> Addresses,
    int? LatencyMs,
    double? Fps,
    DateTimeOffset? LastReportAt,
    IReadOnlyList<OutputLinkStatusDto> Links,
    double? DroppedFramesPct = null,
    int? DecodedStreams = null,
    int? SoftwareDecodedStreams = null);

/// <summary>An output link for the Regie.</summary>
/// <param name="Id">Link id.</param>
/// <param name="Name">Link name, unique per production.</param>
/// <param name="Url">Absolute output URL including the secret key of the link.</param>
/// <param name="KeyCreatedAt">When the current key was created.</param>
/// <param name="LastSeenAt">When a page of the link last connected or disconnected; null while it was never used.</param>
/// <param name="AllowedIps">IP addresses or CIDR ranges allowed to open the link; empty allows every address.</param>
public sealed record OutputLinkDto(
    string Id,
    string Name,
    string Url,
    DateTimeOffset KeyCreatedAt,
    DateTimeOffset? LastSeenAt,
    IReadOnlyList<string> AllowedIps);

/// <summary>Output settings for the Regie.</summary>
/// <param name="Links">The output links, oldest first.</param>
/// <param name="MaxLinks">Maximum number of links per production.</param>
/// <param name="FrameAncestors">Domains allowed to embed the output (from configuration, read-only).</param>
public sealed record OutputSettingsDto(
    IReadOnlyList<OutputLinkDto> Links,
    int MaxLinks,
    IReadOnlyList<string> FrameAncestors);

/// <summary>Creates a named output link.</summary>
/// <param name="Name">1–40 characters, unique per production (ignoring case).</param>
public sealed record CreateOutputLinkRequest(string Name);

/// <summary>Renames an output link.</summary>
/// <param name="Name">1–40 characters, unique per production (ignoring case).</param>
public sealed record RenameOutputLinkRequest(string Name);

/// <summary>Sets the IP restriction of an output link.</summary>
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
/// <param name="DroppedFramesPct">Share of the frames the page dropped since the previous report, in percent.</param>
/// <param name="DecodedStreams">Number of video streams the page decodes (paused sources do not count).</param>
/// <param name="SoftwareDecodedStreams">Of those, the number decoded in software.</param>
public sealed record OutputReport(
    bool Rendering,
    int? LatencyMs,
    double? Fps,
    string? ProgramSceneId,
    double? DroppedFramesPct = null,
    int? DecodedStreams = null,
    int? SoftwareDecodedStreams = null);
