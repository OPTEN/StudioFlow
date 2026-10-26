namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// Where the installation can be reached (configuration section <c>StudioFlow</c>). The address and the embedding list come
/// from the server settings (issue #27: first-run wizard and "Server settings"), which the host attaches with
/// <see cref="UseSettings"/>; the two keys below only override them (development, tests, a deliberate public address).
/// </summary>
public sealed class StudioFlowOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "StudioFlow";

    private ServerSettingsState? settings;

    /// <summary>Public base URL override, e.g. <c>https://studioflow.example.com:8443</c>. Empty: the address from the server settings.</summary>
    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>Space separated CSP sources override. Empty: <c>'self'</c> and the origins from the server settings.</summary>
    public string FrameAncestors { get; set; } = string.Empty;

    /// <summary>The base URL without a trailing slash; it carries the HTTPS port (invite and output links, QR codes, the LiveKit address).</summary>
    public string BaseUrl => !string.IsNullOrWhiteSpace(PublicBaseUrl) ? PublicBaseUrl.TrimEnd('/') : settings?.BaseUrl ?? "https://localhost:8443";

    /// <summary>The CSP sources that may frame the output (shown read-only in the Regie, enforced by Caddy).</summary>
    public IReadOnlyList<string> FrameAncestorList => !string.IsNullOrWhiteSpace(FrameAncestors)
        ? FrameAncestors.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        : settings?.FrameAncestorSources ?? ["'self'"];

    /// <summary>Lets the address follow the server settings. Called once by the host.</summary>
    public void UseSettings(ServerSettingsState state) => settings = state;
}
