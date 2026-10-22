namespace Opten.FlowStudio.Core.Contracts;

// All enums are serialized as camelCase strings (configured globally for REST and SignalR).

/// <summary>Broadcast state of a production. Standby and Ended show a slate on the output.</summary>
public enum BroadcastState
{
    /// <summary>Before the start: the output shows the standby slate («Gleich geht's los»).</summary>
    Standby,

    /// <summary>On air: the output shows the program scene.</summary>
    Live,

    /// <summary>After the end: the output shows the end slate.</summary>
    Ended,
}

/// <summary>Kind of transition between program scenes. A fade always runs to completion (no T-bar).</summary>
public enum TransitionKind
{
    /// <summary>Hard cut.</summary>
    Cut,

    /// <summary>Cross-fade with a fixed duration.</summary>
    Fade,
}

/// <summary>Layout mode of a scene.</summary>
public enum SceneLayoutMode
{
    /// <summary>Items keep their stored geometry.</summary>
    Free,

    /// <summary>The renderer arranges visible items with an available source in a grid (Auto-Grid).</summary>
    AutoGrid,
}

/// <summary>How a source is fitted into its item rectangle.</summary>
public enum ItemFit
{
    /// <summary>Fill the rectangle and crop the overflow («Füllen»).</summary>
    Cover,

    /// <summary>Show the whole picture with bars («Ganz zeigen»).</summary>
    Contain,
}

/// <summary>Kind of a source.</summary>
public enum SourceKind
{
    /// <summary>Camera of a device (slot <c>camera</c>). Slot code K1, K2, …</summary>
    Camera,

    /// <summary>Screen share of a laptop (slot <c>screen-n</c>). Slot code S1, S2, …</summary>
    Screen,

    /// <summary>Uploaded image. Slot code M1, M2, …</summary>
    Image,

    /// <summary>Uploaded video. Slot code M1, M2, …</summary>
    Video,
}

/// <summary>Health of a source as shown in the Regie (lamps, washes, message strip).</summary>
public enum SourceStatus
{
    /// <summary>Picture is available (or the source is a media asset).</summary>
    Ok,

    /// <summary>Device is paired and connecting, nothing published yet.</summary>
    Connecting,

    /// <summary>Device is not connected and was not live before (idle lamp, no incident).</summary>
    Offline,

    /// <summary>Picture was live and is gone; the device reconnects (amber).</summary>
    Reconnecting,

    /// <summary>The sender ended the screen share (red, «Teilen beendet»).</summary>
    Ended,

    /// <summary>The camera failed on the device (red, «kein Bild»).</summary>
    Lost,

    /// <summary>The device is blocked by the Regie (red, «gesperrt»).</summary>
    Blocked,
}

/// <summary>Kind of a paired device.</summary>
public enum DeviceKind
{
    /// <summary>Phone used as a fixed camera.</summary>
    Phone,

    /// <summary>Laptop sharing one or more screens, optionally a camera.</summary>
    Laptop,
}

/// <summary>Administrative state of a device.</summary>
public enum DeviceState
{
    /// <summary>The device may connect and publish.</summary>
    Active,

    /// <summary>The device was blocked and is disconnected immediately.</summary>
    Blocked,
}

/// <summary>Live connection state of a device as seen by the server.</summary>
public enum DeviceConnection
{
    /// <summary>Control connection is up.</summary>
    Online,

    /// <summary>Control or media connection was lost and the device is expected back.</summary>
    Reconnecting,

    /// <summary>The device is not connected.</summary>
    Offline,
}

/// <summary>How a device was paired.</summary>
public enum PairingMethod
{
    /// <summary>One-time QR code (phones).</summary>
    Qr,

    /// <summary>Short URL /join with check code and approval (laptops on site).</summary>
    Code,

    /// <summary>One-time invite link (laptops, also in advance).</summary>
    Link,
}

/// <summary>Kind of a one-time invite.</summary>
public enum InviteKind
{
    /// <summary>QR code shown in the pairing dock for phones.</summary>
    PhoneQr,

    /// <summary>Invite link for laptops, sent via Teams or mail.</summary>
    LaptopLink,
}

/// <summary>State of a slot on a device as reported by the sender.</summary>
public enum SlotState
{
    /// <summary>Capture is being started.</summary>
    Starting,

    /// <summary>Track is published and sending.</summary>
    Live,

    /// <summary>The sender paused the slot on purpose.</summary>
    Paused,

    /// <summary>The user ended the capture (screen share stop button).</summary>
    Ended,

    /// <summary>Capture failed (camera taken by another app, permission revoked).</summary>
    Failed,
}

/// <summary>Media connection state reported by the sender.</summary>
public enum RtcState
{
    /// <summary>Connected to LiveKit.</summary>
    Connected,

    /// <summary>Resuming or rejoining.</summary>
    Reconnecting,

    /// <summary>Not connected.</summary>
    Disconnected,
}

/// <summary>Traffic light used by the technical check.</summary>
public enum TechCheckLevel
{
    /// <summary>Not checked yet.</summary>
    Unknown,

    /// <summary>Good.</summary>
    Ok,

    /// <summary>Usable with limitations.</summary>
    Warn,

    /// <summary>Not usable.</summary>
    Bad,
}

/// <summary>Kind of an incident in the message strip.</summary>
public enum IncidentKind
{
    /// <summary>A live source is reconnecting (amber).</summary>
    Reconnecting,

    /// <summary>A screen share was ended by the sender (red).</summary>
    Ended,

    /// <summary>A camera failed (red).</summary>
    Lost,
}

/// <summary>Tally of a source or device.</summary>
public enum TallyState
{
    /// <summary>Not in program or preview.</summary>
    Off,

    /// <summary>In the preview scene (green, comes next).</summary>
    Preview,

    /// <summary>In the program scene (red, live).</summary>
    Program,
}

/// <summary>Remote command the Regie sends to a device.</summary>
public enum DeviceCommandKind
{
    /// <summary>Ask the sender to share the screen of a slot again.</summary>
    Reshare,

    /// <summary>Switch between front and back camera.</summary>
    SwitchCamera,

    /// <summary>Show a short text message on the device («In 10 s live»).</summary>
    Message,
}

/// <summary>Connection state of the output consumer (proxy).</summary>
public enum OutputState
{
    /// <summary>No output page is connected.</summary>
    None,

    /// <summary>At least one output page is connected and reports rendering.</summary>
    Connected,

    /// <summary>Output pages are connected but did not report recently or are not rendering.</summary>
    Stale,
}

/// <summary>Kind of an uploaded media asset.</summary>
public enum AssetKind
{
    /// <summary>PNG, JPEG or WebP image.</summary>
    Image,

    /// <summary>MP4 or WebM video (muted playback).</summary>
    Video,
}

/// <summary>Status of an anonymous pairing request from /join.</summary>
public enum PairingRequestStatus
{
    /// <summary>Waiting for the Regie.</summary>
    Pending,

    /// <summary>Approved; credentials are available to the requester.</summary>
    Approved,

    /// <summary>Denied by the Regie.</summary>
    Denied,

    /// <summary>Expired or unknown.</summary>
    Expired,
}
