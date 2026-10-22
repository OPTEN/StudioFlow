namespace Opten.FlowStudio.Infrastructure.LiveKit;

/// <summary>LiveKit settings (configuration section <c>LiveKit</c>).</summary>
public sealed class LiveKitOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "LiveKit";

    /// <summary>API key (<c>iss</c> of every token; also the webhook key).</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>API secret (HS256 key, at least 32 characters).</summary>
    public string ApiSecret { get; set; } = string.Empty;

    /// <summary>URL of the LiveKit server inside the compose network for the room service (Twirp).</summary>
    public string InternalUrl { get; set; } = "http://livekit:7880";

    /// <summary>
    /// WebSocket URL handed to clients. Empty means the public origin (<c>wss://{host}</c>, Caddy proxies <c>/rtc</c>).
    /// </summary>
    public string PublicUrl { get; set; } = string.Empty;

    /// <summary>
    /// <c>LiveKit:RequestTimeout</c>: timeout of one room service call (kick, list). LiveKit calls never run inside a
    /// production lock, and a call that times out is logged and skipped (default 5 s).
    /// </summary>
    public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// <c>LiveKit:TokenTtl</c>: validity of participant tokens (spec 7, default 10 minutes). LiveKit refreshes the token of
    /// a connected participant itself; clients fetch a fresh one for every rejoin.
    /// </summary>
    public TimeSpan TokenTtl { get; set; } = TimeSpan.FromMinutes(10);
}
