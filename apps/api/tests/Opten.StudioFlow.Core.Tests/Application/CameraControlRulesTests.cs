using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>Camera control rules (issue #11): what a report may say, validation and clamping of commands, merging.</summary>
public sealed class CameraControlRulesTests
{
    private static readonly CameraCapabilitiesDto Android = new(
        [new CameraLensDto("back-main", "camera2 0, facing back", CameraLensKind.Standard), new CameraLensDto("back-wide", "camera2 2, facing back", CameraLensKind.UltraWide)],
        new CameraRangeDto(1, 8, 0.1),
        [CameraFocusMode.Auto, CameraFocusMode.Manual],
        new CameraRangeDto(0.1, 2, 0.05),
        new CameraRangeDto(-2, 2, 0.5),
        Torch: true);

    private static CameraControlDto Command(double? zoom = null, double? exposure = null, double? distance = null, string? lens = null, CameraFocusMode? focus = null, bool? torch = null, bool? reset = null, int v = 1) =>
        new(v, lens, zoom, focus, distance, exposure, torch, reset);

    private static CameraStateDto State(CameraCapabilitiesDto? capabilities = null, string? problem = null, int v = 1) =>
        new(v, capabilities ?? Android, new CameraSettingsDto("back-main", 1, CameraFocusMode.Auto, null, 0, false), problem);

    private static void AssertInvalid(Action action, string field)
    {
        var error = Assert.Throws<StudioFlowException>(action);
        Assert.Equal(ErrorKind.Validation, error.Kind);
        Assert.Contains(field, error.Errors!.Keys);
    }

    [Fact]
    public void Sanitize_ValidState_IsKept()
    {
        var state = CameraControlRules.Sanitize(State());

        Assert.NotNull(state);
        Assert.Equal(2, state.Capabilities.Lenses.Count);
        Assert.Equal(new CameraRangeDto(1, 8, 0.1), state.Capabilities.Zoom);
        Assert.Equal("back-main", state.Settings.LensId);
    }

    [Fact]
    public void Sanitize_UnknownVersionOrMissingParts_IsDropped()
    {
        Assert.Null(CameraControlRules.Sanitize(null));
        Assert.Null(CameraControlRules.Sanitize(State(v: 2)));
        Assert.Null(CameraControlRules.Sanitize(State(v: 0)));
        Assert.Null(CameraControlRules.Sanitize(new CameraStateDto(1, null!, null!, null)));
    }

    [Fact]
    public void Sanitize_ImpossibleRanges_AreDropped()
    {
        var broken = Android with
        {
            Zoom = new CameraRangeDto(8, 1, 0.1),
            FocusDistance = new CameraRangeDto(double.NaN, 2, 0.1),
            ExposureCompensation = new CameraRangeDto(-2, 2, -1),
        };

        var state = CameraControlRules.Sanitize(State(broken))!;

        Assert.Null(state.Capabilities.Zoom);
        Assert.Null(state.Capabilities.FocusDistance);
        Assert.Null(state.Capabilities.ExposureCompensation);
    }

    [Fact]
    public void Sanitize_Lenses_AreDeduplicatedCappedAndLabelsTrimmed()
    {
        var many = Enumerable.Range(0, 20).Select(i => new CameraLensDto($"cam-{i}", new string('x', 200), CameraLensKind.Other)).ToList();
        many.Add(new CameraLensDto("cam-0", "again", CameraLensKind.Front));
        many.Add(new CameraLensDto("", "no id", CameraLensKind.Front));
        many.Add(new CameraLensDto("odd", "odd kind", (CameraLensKind)99));

        var state = CameraControlRules.Sanitize(State(Android with { Lenses = many }))!;

        Assert.Equal(CameraControlRules.MaxLenses, state.Capabilities.Lenses.Count);
        Assert.All(state.Capabilities.Lenses, lens => Assert.Equal(80, lens.Label!.Length));
        Assert.Equal(state.Capabilities.Lenses.Count, state.Capabilities.Lenses.Select(l => l.Id).Distinct().Count());
    }

    [Fact]
    public void Sanitize_SettingsAndProblem_AreCleaned()
    {
        var reported = new CameraStateDto(1, Android, new CameraSettingsDto(" ", double.PositiveInfinity, (CameraFocusMode)9, double.NaN, 0.5, true), "<script>");

        var state = CameraControlRules.Sanitize(reported)!;

        Assert.Null(state.Settings.LensId);
        Assert.Null(state.Settings.Zoom);
        Assert.Null(state.Settings.FocusMode);
        Assert.Null(state.Settings.FocusDistance);
        Assert.Equal(0.5, state.Settings.ExposureCompensation);
        Assert.Null(state.Problem);
        Assert.Equal(CameraProblems.Overconstrained, CameraControlRules.Sanitize(State(problem: CameraProblems.Overconstrained))!.Problem);
    }

    [Fact]
    public void SameState_NewListsWithTheSameContent_AreEqual()
    {
        var a = CameraControlRules.Sanitize(State())!;
        var b = CameraControlRules.Sanitize(State(Android with { Lenses = [.. Android.Lenses] }))!;
        var zoomed = CameraControlRules.Sanitize(State() with { Settings = new CameraSettingsDto("back-main", 2, CameraFocusMode.Auto, null, 0, false) })!;

        Assert.True(CameraControlRules.SameState(a, b));
        Assert.False(CameraControlRules.SameState(a, zoomed));
        Assert.False(CameraControlRules.SameState(a, null));
        Assert.True(CameraControlRules.SameState(null, null));
    }

    [Fact]
    public void Prepare_ValueInsideTheRange_IsSnappedToTheStep()
    {
        var command = CameraControlRules.Prepare(Command(zoom: 2.04, exposure: 0.6, distance: 0.52), Android);

        Assert.Equal(2.0, command.Zoom);
        Assert.Equal(0.5, command.ExposureCompensation);
        Assert.Equal(0.5, command.FocusDistance);
    }

    [Fact]
    public void Prepare_ValueOutsideTheRange_IsClampedToTheReportedCapabilities()
    {
        var command = CameraControlRules.Prepare(Command(zoom: 50, exposure: -9), Android);

        Assert.Equal(8, command.Zoom);
        Assert.Equal(-2, command.ExposureCompensation);
        Assert.Equal(1, CameraControlRules.Prepare(Command(zoom: 0.5), Android).Zoom);
    }

    [Fact]
    public void Prepare_WithoutKnownCapabilities_OnlyTheHardLimitsApply()
    {
        var command = CameraControlRules.Prepare(Command(zoom: 7.77, lens: "any"), null);

        Assert.Equal(7.77, command.Zoom);
        Assert.Equal("any", command.LensId);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(101)]
    public void Prepare_ZoomBeyondTheHardLimits_IsRefused(double zoom)
    {
        AssertInvalid(() => CameraControlRules.Prepare(Command(zoom: zoom), null), "camera.zoom");
        AssertInvalid(() => CameraControlRules.Prepare(Command(zoom: zoom), Android), "camera.zoom");
    }

    [Fact]
    public void Prepare_OtherHardLimits_AreRefused()
    {
        AssertInvalid(() => CameraControlRules.Prepare(Command(exposure: 21), null), "camera.exposureCompensation");
        AssertInvalid(() => CameraControlRules.Prepare(Command(distance: -0.1), null), "camera.focusDistance");
        AssertInvalid(() => CameraControlRules.Prepare(Command(focus: (CameraFocusMode)7), null), "camera.focusMode");
        AssertInvalid(() => CameraControlRules.Prepare(Command(lens: new string('l', 513)), null), "camera.lensId");
    }

    [Fact]
    public void Prepare_ControlTheCameraDoesNotHave_IsRefused()
    {
        var iphone = new CameraCapabilitiesDto([new CameraLensDto("front", "Front Camera", CameraLensKind.Front)], null, [], null, null, Torch: false);

        AssertInvalid(() => CameraControlRules.Prepare(Command(zoom: 2), iphone), "camera.zoom");
        AssertInvalid(() => CameraControlRules.Prepare(Command(exposure: 1), iphone), "camera.exposureCompensation");
        AssertInvalid(() => CameraControlRules.Prepare(Command(distance: 1), iphone), "camera.focusDistance");
        AssertInvalid(() => CameraControlRules.Prepare(Command(focus: CameraFocusMode.Manual), iphone), "camera.focusMode");
        AssertInvalid(() => CameraControlRules.Prepare(Command(torch: true), iphone), "camera.torch");
        Assert.Equal("front", CameraControlRules.Prepare(Command(lens: "front"), iphone).LensId);
    }

    [Fact]
    public void Prepare_UnknownLens_IsRefused() =>
        AssertInvalid(() => CameraControlRules.Prepare(Command(lens: "someone-elses-camera"), Android), "camera.lensId");

    [Fact]
    public void Prepare_WrongVersionMissingPayloadOrNoChange_IsRefused()
    {
        AssertInvalid(() => CameraControlRules.Prepare(Command(zoom: 2, v: 2), Android), "camera.v");
        AssertInvalid(() => CameraControlRules.Prepare(null, Android), "camera");
        AssertInvalid(() => CameraControlRules.Prepare(Command(), Android), "camera");
        AssertInvalid(() => CameraControlRules.Prepare(Command(reset: false), Android), "camera");
    }

    [Fact]
    public void Prepare_ResetAlone_IsValidEvenForACameraWithoutControls()
    {
        var bare = new CameraCapabilitiesDto([], null, [], null, null, Torch: false);

        var command = CameraControlRules.Prepare(Command(reset: true), bare);

        Assert.True(command.Reset);
    }

    [Fact]
    public void Merge_NewerValuesWinPerField()
    {
        var merged = CameraControlRules.Merge(Command(zoom: 2, exposure: 1), Command(zoom: 3, torch: true));

        Assert.Equal(3, merged.Zoom);
        Assert.Equal(1, merged.ExposureCompensation);
        Assert.True(merged.Torch);
    }

    [Fact]
    public void Merge_NewerReset_DropsOlderValuesButKeepsTheLensSwitch()
    {
        var merged = CameraControlRules.Merge(Command(zoom: 4, lens: "back-wide"), Command(reset: true));

        Assert.True(merged.Reset);
        Assert.Null(merged.Zoom);
        Assert.Equal("back-wide", merged.LensId);
    }

    [Fact]
    public void Merge_ValueAfterAReset_KeepsBothSoTheDeviceResetsFirst()
    {
        var merged = CameraControlRules.Merge(Command(reset: true), Command(zoom: 2));

        Assert.True(merged.Reset);
        Assert.Equal(2, merged.Zoom);
    }
}
