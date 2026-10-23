using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>Values of <see cref="CameraStateDto.Problem"/>.</summary>
public static class CameraProblems
{
    /// <summary>The camera cannot do what was asked (<c>OverconstrainedError</c>).</summary>
    public const string Overconstrained = "overconstrained";

    /// <summary>The camera failed to apply the change.</summary>
    public const string Failed = "failed";
}

/// <summary>
/// Rules of the remote camera control (issue #11): what a report may say about the camera, how a Regie command is
/// validated and clamped to the capabilities the device reported, and how a command held back by the throttle merges
/// with a newer one (the last command wins).
/// </summary>
public static class CameraControlRules
{
    /// <summary>Most lenses taken from one report.</summary>
    public const int MaxLenses = 8;

    private const int IdMax = 512;
    private const int LabelMax = 80;
    private const double ZoomLimit = 100;
    private const double ExposureLimit = 20;
    private const double FocusDistanceLimit = 100_000;

    /// <summary>
    /// The camera section of a report as the server keeps it: wrong version, impossible ranges, too many or duplicate
    /// lenses and unknown problem codes are dropped. Returns null when the report carries no usable camera.
    /// </summary>
    public static CameraStateDto? Sanitize(CameraStateDto? reported)
    {
        if (reported is not { V: CameraProtocol.Version, Capabilities: { } capabilities, Settings: { } settings })
        {
            return null;
        }

        var lenses = (capabilities.Lenses ?? [])
            .Where(l => l is not null && IsId(l.Id) && Enum.IsDefined(l.Kind))
            .DistinctBy(l => l.Id, StringComparer.Ordinal)
            .Take(MaxLenses)
            .Select(l => l with { Label = TextRules.Truncate(l.Label, LabelMax) })
            .ToList();
        var cleanCapabilities = new CameraCapabilitiesDto(
            lenses,
            SaneRange(capabilities.Zoom),
            [.. (capabilities.FocusModes ?? []).Where(Enum.IsDefined).Distinct()],
            SaneRange(capabilities.FocusDistance),
            SaneRange(capabilities.ExposureCompensation),
            capabilities.Torch);
        var cleanSettings = new CameraSettingsDto(
            IsId(settings.LensId) ? settings.LensId : null,
            Finite(settings.Zoom),
            settings.FocusMode is { } mode && Enum.IsDefined(mode) ? mode : null,
            Finite(settings.FocusDistance),
            Finite(settings.ExposureCompensation),
            settings.Torch);
        var problem = reported.Problem is CameraProblems.Overconstrained or CameraProblems.Failed ? reported.Problem : null;
        return new CameraStateDto(CameraProtocol.Version, cleanCapabilities, cleanSettings, problem);
    }

    /// <summary>True when two sanitised camera states say the same (the reports build new lists every time).</summary>
    public static bool SameState(CameraStateDto? a, CameraStateDto? b)
    {
        if (a is null || b is null)
        {
            return a is null && b is null;
        }

        return a.Problem == b.Problem
            && a.Settings == b.Settings
            && a.Capabilities.Zoom == b.Capabilities.Zoom
            && a.Capabilities.FocusDistance == b.Capabilities.FocusDistance
            && a.Capabilities.ExposureCompensation == b.Capabilities.ExposureCompensation
            && a.Capabilities.Torch == b.Capabilities.Torch
            && a.Capabilities.FocusModes.SequenceEqual(b.Capabilities.FocusModes)
            && a.Capabilities.Lenses.SequenceEqual(b.Capabilities.Lenses);
    }

    /// <summary>
    /// Validates a command: version, finite numbers within hard limits, at least one change. When the device reported
    /// its capabilities the values are clamped to them (zoom, brightness and focus distance to range and step) and a
    /// control the camera does not have, or an unknown lens, is refused. Without capabilities (the device never
    /// reported a camera) only the hard limits apply and the sender clamps again.
    /// </summary>
    public static CameraControlDto Prepare(CameraControlDto? request, CameraCapabilitiesDto? capabilities)
    {
        if (request is null)
        {
            throw StudioFlowException.Invalid("camera", "The camera control is missing.");
        }

        var errors = new ValidationErrors();
        if (request.V != CameraProtocol.Version)
        {
            errors.Add("camera.v", $"Unsupported version; this server speaks version {CameraProtocol.Version}.");
        }

        var command = request with { Reset = request.Reset is true ? true : null };
        if (!HasChange(command))
        {
            errors.Add("camera", "The command changes nothing.");
        }

        CheckNumber(errors, "camera.zoom", command.Zoom, 0.1, ZoomLimit);
        CheckNumber(errors, "camera.exposureCompensation", command.ExposureCompensation, -ExposureLimit, ExposureLimit);
        CheckNumber(errors, "camera.focusDistance", command.FocusDistance, 0, FocusDistanceLimit);
        if (command.FocusMode is { } mode && !Enum.IsDefined(mode))
        {
            errors.Add("camera.focusMode", "Unknown focus mode.");
        }

        if (command.LensId is { } lensId && !IsId(lensId))
        {
            errors.Add("camera.lensId", "Must be 1–512 characters long.");
        }

        errors.ThrowIfAny();
        return capabilities is null ? command : ClampTo(command, capabilities, errors);
    }

    /// <summary>
    /// Merges a command held back by the throttle with a newer one: the newer value of each field wins. A newer reset
    /// drops the older values (a reset leaves the lens alone, so an older lens switch stays).
    /// </summary>
    public static CameraControlDto Merge(CameraControlDto older, CameraControlDto newer)
    {
        ArgumentNullException.ThrowIfNull(older);
        ArgumentNullException.ThrowIfNull(newer);
        if (newer.Reset is true)
        {
            return newer with { LensId = newer.LensId ?? older.LensId };
        }

        return new CameraControlDto(
            CameraProtocol.Version,
            newer.LensId ?? older.LensId,
            newer.Zoom ?? older.Zoom,
            newer.FocusMode ?? older.FocusMode,
            newer.FocusDistance ?? older.FocusDistance,
            newer.ExposureCompensation ?? older.ExposureCompensation,
            newer.Torch ?? older.Torch,
            older.Reset);
    }

    private static CameraControlDto ClampTo(CameraControlDto command, CameraCapabilitiesDto capabilities, ValidationErrors errors)
    {
        var zoom = ClampToRange(errors, "camera.zoom", command.Zoom, capabilities.Zoom);
        var exposure = ClampToRange(errors, "camera.exposureCompensation", command.ExposureCompensation, capabilities.ExposureCompensation);
        var distance = ClampToRange(errors, "camera.focusDistance", command.FocusDistance, capabilities.FocusDistance);
        if (command.FocusMode is { } mode && !capabilities.FocusModes.Contains(mode))
        {
            errors.Add("camera.focusMode", "The camera does not support this focus mode.");
        }

        if (command.Torch is not null && !capabilities.Torch)
        {
            errors.Add("camera.torch", "The camera has no light.");
        }

        if (command.LensId is { } lensId && !capabilities.Lenses.Any(l => string.Equals(l.Id, lensId, StringComparison.Ordinal)))
        {
            errors.Add("camera.lensId", "The device has no such camera.");
        }

        errors.ThrowIfAny();
        return command with { Zoom = zoom, ExposureCompensation = exposure, FocusDistance = distance };
    }

    private static double? ClampToRange(ValidationErrors errors, string field, double? value, CameraRangeDto? range)
    {
        if (value is null)
        {
            return null;
        }

        if (range is null)
        {
            errors.Add(field, "The camera does not support this control.");
            return null;
        }

        var snapped = range.Step > 0 ? range.Min + (Math.Round((value.Value - range.Min) / range.Step) * range.Step) : value.Value;
        return Math.Round(Math.Clamp(snapped, range.Min, range.Max), 4);
    }

    private static void CheckNumber(ValidationErrors errors, string field, double? value, double min, double max)
    {
        if (value is { } number && (!double.IsFinite(number) || number < min || number > max))
        {
            errors.Add(field, $"Must be between {min} and {max}.");
        }
    }

    private static bool HasChange(CameraControlDto command) =>
        command.Reset is true
        || command.LensId is not null
        || command.Zoom is not null
        || command.FocusMode is not null
        || command.FocusDistance is not null
        || command.ExposureCompensation is not null
        || command.Torch is not null;

    private static bool IsId(string? id) => !string.IsNullOrWhiteSpace(id) && id.Length <= IdMax;

    private static double? Finite(double? value) => value is { } number && double.IsFinite(number) ? number : null;

    private static CameraRangeDto? SaneRange(CameraRangeDto? range) =>
        range is not null && double.IsFinite(range.Min) && double.IsFinite(range.Max) && double.IsFinite(range.Step) && range.Min <= range.Max && range.Step >= 0
            ? range
            : null;
}
