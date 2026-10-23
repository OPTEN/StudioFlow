namespace Opten.StudioFlow.Core.Application;

/// <summary>Installation settings (configuration section <c>StudioFlow</c>).</summary>
public sealed class StudioFlowOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "StudioFlow";

    /// <summary>Public base URL, e.g. <c>https://studioflow.opten.ch</c>; used in invite, QR and output URLs.</summary>
    public string PublicBaseUrl { get; set; } = "https://localhost";

    /// <summary>Space separated CSP sources allowed to embed the output (read-only in the Regie, enforced by Caddy).</summary>
    public string FrameAncestors { get; set; } = "'self'";

    /// <summary>The base URL without a trailing slash.</summary>
    public string BaseUrl => PublicBaseUrl.TrimEnd('/');

    /// <summary>The frame ancestors as a list.</summary>
    public IReadOnlyList<string> FrameAncestorList => FrameAncestors.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
