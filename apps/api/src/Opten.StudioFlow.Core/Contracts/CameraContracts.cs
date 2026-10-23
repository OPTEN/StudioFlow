namespace Opten.StudioFlow.Core.Contracts;

/// <summary>Version of the camera control messages (<see cref="CameraStateDto"/> and <see cref="CameraControlDto"/>).</summary>
public static class CameraProtocol
{
    /// <summary>The only version so far; a message of another version is refused by the server and ignored by the sender.</summary>
    public const int Version = 1;
}

/// <summary>What a lens is, derived by the sender from the name the browser gives the camera.</summary>
public enum CameraLensKind
{
    /// <summary>Camera facing the person (selfie camera).</summary>
    Front,

    /// <summary>Back camera with a wider view than the standard one.</summary>
    UltraWide,

    /// <summary>The standard back camera.</summary>
    Standard,

    /// <summary>Back camera with a narrower view (telephoto).</summary>
    Tele,

    /// <summary>A camera the sender could not classify; the Regie numbers it.</summary>
    Other,
}

/// <summary>Focus behaviour of a camera.</summary>
public enum CameraFocusMode
{
    /// <summary>The camera focuses by itself.</summary>
    Auto,

    /// <summary>Focus distance is fixed (locked or set by the Regie).</summary>
    Manual,
}

/// <summary>Range of a numeric camera setting.</summary>
/// <param name="Min">Smallest value.</param>
/// <param name="Max">Largest value.</param>
/// <param name="Step">Smallest change the camera applies.</param>
public sealed record CameraRangeDto(double Min, double Max, double Step);

/// <summary>One camera (lens) of the device.</summary>
/// <param name="Id">Browser device id; stable while the browser is.</param>
/// <param name="Label">Name from the browser, if it gives one.</param>
/// <param name="Kind">What the lens is.</param>
public sealed record CameraLensDto(string Id, string? Label, CameraLensKind Kind);

/// <summary>
/// What the camera in use can do (from <c>MediaStreamTrack.getCapabilities()</c>). A control the camera does not
/// support is missing here and the Regie does not show it.
/// </summary>
/// <param name="Lenses">The device's cameras; empty when the browser lists none.</param>
/// <param name="Zoom">Zoom factor range.</param>
/// <param name="FocusModes">Supported focus modes; empty without focus control.</param>
/// <param name="FocusDistance">Manual focus distance range (metres).</param>
/// <param name="ExposureCompensation">Brightness range in EV.</param>
/// <param name="Torch">The camera has a light.</param>
public sealed record CameraCapabilitiesDto(
    IReadOnlyList<CameraLensDto> Lenses,
    CameraRangeDto? Zoom,
    IReadOnlyList<CameraFocusMode> FocusModes,
    CameraRangeDto? FocusDistance,
    CameraRangeDto? ExposureCompensation,
    bool Torch);

/// <summary>The settings the camera really has right now (from <c>getSettings()</c>); null where the camera reports none.</summary>
/// <param name="LensId">Device id of the lens in use.</param>
/// <param name="Zoom">Zoom factor.</param>
/// <param name="FocusMode">Focus mode.</param>
/// <param name="FocusDistance">Focus distance in metres.</param>
/// <param name="ExposureCompensation">Brightness in EV.</param>
/// <param name="Torch">The light is on.</param>
public sealed record CameraSettingsDto(
    string? LensId,
    double? Zoom,
    CameraFocusMode? FocusMode,
    double? FocusDistance,
    double? ExposureCompensation,
    bool? Torch);

/// <summary>Camera section of a device report (and of the telemetry the Regie gets).</summary>
/// <param name="V">Protocol version, currently 1.</param>
/// <param name="Capabilities">What the camera can do.</param>
/// <param name="Settings">What the camera does now.</param>
/// <param name="Problem">The last command the camera refused (<c>overconstrained</c>, <c>failed</c>); null once a command works again.</param>
public sealed record CameraStateDto(int V, CameraCapabilitiesDto Capabilities, CameraSettingsDto Settings, string? Problem);

/// <summary>
/// Remote camera control (partial update, command kind <see cref="DeviceCommandKind.CameraControl"/>). The device
/// resets first when <paramref name="Reset"/> is set, then applies every other field that is set.
/// </summary>
/// <param name="V">Protocol version, currently 1.</param>
/// <param name="LensId">Switch to this lens (an id from the reported lenses); the picture freezes briefly.</param>
/// <param name="Zoom">Zoom factor.</param>
/// <param name="FocusMode">Focus mode.</param>
/// <param name="FocusDistance">Focus distance in metres (manual focus).</param>
/// <param name="ExposureCompensation">Brightness in EV.</param>
/// <param name="Torch">Light on or off.</param>
/// <param name="Reset">Back to automatic: zoom out, automatic focus, no brightness shift, light off. The lens stays.</param>
public sealed record CameraControlDto(
    int V,
    string? LensId,
    double? Zoom,
    CameraFocusMode? FocusMode,
    double? FocusDistance,
    double? ExposureCompensation,
    bool? Torch,
    bool? Reset);
