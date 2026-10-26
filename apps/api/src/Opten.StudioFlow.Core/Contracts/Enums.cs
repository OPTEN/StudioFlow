namespace Opten.StudioFlow.Core.Contracts;

// All enums are serialized as camelCase strings (configured globally for REST and SignalR).

/// <summary>Broadcast state of a production. Standby and Ended show a slate on the output.</summary>
public enum BroadcastState
{
    /// <summary>Before the start: the output shows the standby slate (“Starting soon”).</summary>
    Standby,

    /// <summary>On air: the output shows the program scene.</summary>
    Live,

    /// <summary>After the end: the output shows the end slate.</summary>
    Ended,
}

/// <summary>Format (aspect ratio) of the output canvas. One format per production; the list is fixed so the layouts fit.</summary>
public enum CanvasFormat
{
    /// <summary>16:9, the default.</summary>
    Widescreen,

    /// <summary>9:16 (portrait, social media).</summary>
    Portrait,

    /// <summary>1:1.</summary>
    Square,

    /// <summary>4:3.</summary>
    Standard,
}

/// <summary>Target resolution of the output canvas, named after the short side. Together with the format it gives the canvas size.</summary>
public enum CanvasResolution
{
    /// <summary>720 on the short side (1280 × 720 in 16:9).</summary>
    P720,

    /// <summary>1080 on the short side (1920 × 1080 in 16:9), the default.</summary>
    P1080,
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
    /// <summary>Fill the rectangle and crop the overflow (“Fill”).</summary>
    Cover,

    /// <summary>Show the whole picture with bars (“Show all”).</summary>
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

    /// <summary>Text or lower third rendered as HTML. Slot code T1, T2, …</summary>
    Text,
}

/// <summary>Fixed design of a text source; the colours come from the production's <see cref="TextThemeDto"/>.</summary>
public enum TextStyle
{
    /// <summary>Bar at the bottom left with a name and a role.</summary>
    LowerThird,

    /// <summary>Large title, centred by default.</summary>
    Title,

    /// <summary>Small note in a corner.</summary>
    Note,
}

/// <summary>Horizontal alignment of a text source (the lower third always follows the reading direction).</summary>
public enum TextAlign
{
    /// <summary>Left edge.</summary>
    Left,

    /// <summary>Centred.</summary>
    Center,

    /// <summary>Right edge.</summary>
    Right,
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

    /// <summary>The sender ended the screen share (red, “Sharing stopped”).</summary>
    Ended,

    /// <summary>The camera failed on the device (red, “no picture”).</summary>
    Lost,

    /// <summary>The device is blocked by the Regie (red, “blocked”).</summary>
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

    /// <summary>
    /// The capture is suspended but expected back: the operating system paused the camera (e.g. the phone app went to
    /// the background). The Regie shows the source as <c>reconnecting</c>; a stop on purpose is <see cref="Ended"/>.
    /// </summary>
    Paused,

    /// <summary>The user stopped the capture on purpose (“Stop sharing”, browser stop button, camera stopped).</summary>
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

    /// <summary>Show a short text message on the device (“Live in 10 s”).</summary>
    Message,

    /// <summary>Change zoom, lens, focus, brightness or light of the camera (<see cref="CameraControlDto"/>).</summary>
    CameraControl,
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

/// <summary>
/// What an entry of "Recent events" reports. Clients show their own text for the code and fill in the params of the
/// entry; the English text of the entry is the fallback for clients that do not know the code yet.
/// </summary>
public enum LogCode
{
    /// <summary>A scene went on air. Params: <c>scene</c>.</summary>
    SceneLive,

    /// <summary>A scene was created. Params: <c>scene</c>.</summary>
    SceneCreated,

    /// <summary>A scene was deleted. Params: <c>scene</c>.</summary>
    SceneDeleted,

    /// <summary>The broadcast started.</summary>
    BroadcastStarted,

    /// <summary>The broadcast ended.</summary>
    BroadcastEnded,

    /// <summary>A device was paired. Params: <c>subject</c> (slot codes and device name).</summary>
    DevicePaired,

    /// <summary>A device was blocked. Params: <c>subject</c>.</summary>
    DeviceBlocked,

    /// <summary>A device was unblocked. Params: <c>subject</c>.</summary>
    DeviceUnblocked,

    /// <summary>A device was removed. Params: <c>subject</c>.</summary>
    DeviceRemoved,

    /// <summary>A pairing request was denied. Params: <c>name</c> (the requested device name).</summary>
    PairingDenied,

    /// <summary>A laptop invite link was created.</summary>
    InviteLinkCreated,

    /// <summary>A laptop invite link was revoked.</summary>
    InviteLinkRevoked,

    /// <summary>An output link was created. Params: <c>name</c>.</summary>
    OutputLinkCreated,

    /// <summary>An output link was renamed (to the name in <c>name</c>).</summary>
    OutputLinkRenamed,

    /// <summary>An output link was revoked. Params: <c>name</c>.</summary>
    OutputLinkRevoked,

    /// <summary>The key of an output link was regenerated. Params: <c>name</c>.</summary>
    OutputLinkRegenerated,

    /// <summary>The access rules (IP restriction) of an output link changed. Params: <c>name</c>.</summary>
    OutputAccessChanged,

    /// <summary>A media file was uploaded. Params: <c>code</c> (slot code), <c>name</c>.</summary>
    AssetUploaded,

    /// <summary>A media file was deleted. Params: <c>code</c>, <c>name</c>.</summary>
    AssetDeleted,

    /// <summary>A live source is reconnecting. Params: <c>code</c>.</summary>
    SourceReconnecting,

    /// <summary>The sender stopped a camera on purpose. Params: <c>code</c>.</summary>
    CameraEnded,

    /// <summary>The sender stopped a screen share. Params: <c>code</c>.</summary>
    ScreenEnded,

    /// <summary>A live camera lost its picture. Params: <c>code</c>.</summary>
    SourceLost,

    /// <summary>A source is back after an outage. Params: <c>code</c>, <c>downSeconds</c>.</summary>
    SourceRecovered,

    /// <summary>The Regie account was set up in the first-run setup.</summary>
    AccountSetUp,

    /// <summary>The password of the Regie account was changed.</summary>
    PasswordChanged,

    /// <summary>The Regie account was reset (<c>reset-admin</c>); the first-run setup is open again.</summary>
    AccountReset,

    /// <summary>A text was created. Params: <c>code</c>, <c>name</c> (line 1).</summary>
    TextCreated,

    /// <summary>A text was deleted. Params: <c>code</c>, <c>name</c> (line 1).</summary>
    TextDeleted,

    /// <summary>A text was shown on the program scene. Params: <c>code</c>.</summary>
    TextShown,

    /// <summary>A text was hidden on the program scene. Params: <c>code</c>.</summary>
    TextHidden,

    /// <summary>The Regie account signed in. Params: <c>username</c>.</summary>
    LoginSucceeded,

    /// <summary>A sign-in failed. Params: <c>username</c>.</summary>
    LoginFailed,

    /// <summary>Too many failed sign-ins locked the address or the account for a while.</summary>
    LoginLocked,

    /// <summary>The Regie account signed out. Params: <c>username</c>.</summary>
    LoggedOut,

    /// <summary>A production was created. Params: <c>name</c>.</summary>
    ProductionCreated,

    /// <summary>A production was renamed. Params: <c>from</c> (old name), <c>name</c> (new name).</summary>
    ProductionRenamed,

    /// <summary>The format or resolution of the output changed. Params: <c>from</c>, <c>to</c> (size and ratio, e.g. "1080 × 1920 (9:16)").</summary>
    CanvasChanged,

    /// <summary>A production was created as a copy of another one. Params: <c>from</c> (name of the original), <c>name</c> (name of the copy).</summary>
    ProductionDuplicated,

    /// <summary>A production was exported as a file. Params: <c>name</c>.</summary>
    ProductionExported,

    /// <summary>A production was imported from a file. Params: <c>name</c>.</summary>
    ProductionImported,

    /// <summary>A placeholder was assigned to a source. Params: <c>code</c> (of the placeholder), <c>target</c> (code and name of the source).</summary>
    PlaceholderAssigned,

    /// <summary>A placeholder was removed together with its scene items. Params: <c>code</c>.</summary>
    PlaceholderRemoved,

    /// <summary>A production became the active one. Params: <c>name</c>.</summary>
    ProductionActivated,

    /// <summary>The broadcast was reset to standby.</summary>
    BroadcastReset,

    /// <summary>The slate shown before the broadcast was changed.</summary>
    StandbySlateChanged,

    /// <summary>The slate shown after the broadcast was changed.</summary>
    EndSlateChanged,

    /// <summary>A recovered source message was marked as seen. Params: <c>code</c>.</summary>
    IncidentAcknowledged,

    /// <summary>A device was renamed. Params: <c>subject</c> (slot codes and old name), <c>name</c> (new name).</summary>
    DeviceRenamed,

    /// <summary>The lens of a phone camera was switched. Params: <c>subject</c>, <c>lens</c> (<see cref="CameraLensKind"/>, camelCase).</summary>
    CameraLensSwitched,

    /// <summary>The audit log was exported. Params: <c>format</c>, <c>rows</c>.</summary>
    AuditExported,

    /// <summary>Old audit entries were deleted and old IP addresses removed. Params: <c>days</c>, <c>deleted</c>, <c>anonymised</c>.</summary>
    AuditRetention,

    /// <summary>The media address of the server settings was saved. Params: <c>address</c>.</summary>
    SettingsMediaChanged,

    /// <summary>The address or the certificate of the server settings changed. Params: <c>mode</c> (<c>internal</c>, <c>custom</c>, <c>dns-*</c>).</summary>
    SettingsAddressChanged,

    /// <summary>The origins that may embed the output changed. Params: <c>count</c>.</summary>
    SettingsEmbeddingChanged,

    /// <summary>The backup schedule or the off-site target changed.</summary>
    SettingsBackupChanged,

    /// <summary>The Regie asked the backup service for a backup.</summary>
    BackupRequested,
}

/// <summary>What an entry of the audit log is about: the category filter of the log view and a column of the export.</summary>
public enum AuditCategory
{
    /// <summary>Productions, broadcast, scenes and slates.</summary>
    Production,

    /// <summary>Devices, pairing, invites and source status changes.</summary>
    Devices,

    /// <summary>Sign-ins, the Regie account and the audit log itself.</summary>
    Security,

    /// <summary>Uploaded media.</summary>
    Media,

    /// <summary>The output link and its access rules.</summary>
    Output,

    /// <summary>Maintenance by the server.</summary>
    System,
}
