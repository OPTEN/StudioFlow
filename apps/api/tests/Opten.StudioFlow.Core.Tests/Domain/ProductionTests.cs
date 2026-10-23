using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class ProductionTests
{
    private readonly Production production = Build.Production();

    private IReadOnlyList<Scene> Scenes => production.OrderedScenes;

    [Fact]
    public void Create_Defaults_MatchTheSpecification()
    {
        Assert.Equal(["Begrüssung", "Präsentation", "Pause"], Scenes.Select(s => s.Name));
        Assert.Equal([0, 1, 2], Scenes.Select(s => s.SortOrder));
        Assert.Equal(Scenes[0].Id, production.ProgramSceneId);
        Assert.Null(production.PreviewSceneId);
        Assert.Equal(BroadcastState.Standby, production.Broadcast);
        Assert.Equal(new SlateDto("Gleich geht's los", "Webinar", null), production.StandbySlate);
        Assert.Equal("Danke fürs Zuschauen", production.EndSlate.Title);
        Assert.Equal("opten", production.TenantId);
        Assert.Equal(43, production.OutputKey.Length);
        Assert.Empty(production.AllowedIps);
    }

    [Fact]
    public void Create_InvalidName_Throws() => Assert.Throws<StudioFlowException>(() => Production.Create(" ", "x", true, Build.T0));

    [Fact]
    public void StartBroadcast_FromStandbyAndEnded_GoesLive()
    {
        Assert.True(production.StartBroadcast(Build.T0));
        Assert.Equal(BroadcastState.Live, production.Broadcast);
        Assert.Equal(Build.T0, production.LiveSince);
        Assert.False(production.StartBroadcast(Build.T0.AddMinutes(1)));
        Assert.True(production.EndBroadcast(Build.T0.AddHours(1)));
        Assert.True(production.StartBroadcast(Build.T0.AddHours(2)));
        Assert.Null(production.EndedAt);
        Assert.Equal(Build.T0.AddHours(2), production.LiveSince);
    }

    [Fact]
    public void EndBroadcast_InStandby_IsConflict() =>
        Assert.Equal(ErrorCodes.Conflict, Assert.Throws<StudioFlowException>(() => production.EndBroadcast(Build.T0)).Code);

    [Fact]
    public void EndBroadcast_Twice_IsNoOp()
    {
        production.StartBroadcast(Build.T0);
        Assert.True(production.EndBroadcast(Build.T0.AddMinutes(5)));

        Assert.False(production.EndBroadcast(Build.T0.AddMinutes(6)));
        Assert.Equal(Build.T0.AddMinutes(5), production.EndedAt);
    }

    [Fact]
    public void ResetBroadcast_AnyState_ReturnsToStandbyAndClearsTimes()
    {
        Assert.False(production.ResetBroadcast());
        production.StartBroadcast(Build.T0);
        production.EndBroadcast(Build.T0.AddMinutes(1));

        Assert.True(production.ResetBroadcast());
        Assert.Equal(BroadcastState.Standby, production.Broadcast);
        Assert.Null(production.LiveSince);
        Assert.Null(production.EndedAt);
    }

    [Fact]
    public void SwitchProgram_CurrentProgram_IsNoOp() => Assert.Null(production.SwitchProgram(Scenes[0].Id, Build.Fade(), Build.T0));

    [Fact]
    public void SwitchProgram_OtherScene_ReportsPreviousAndTransition()
    {
        var change = production.SwitchProgram(Scenes[1].Id, Build.Fade(500), Build.T0);

        Assert.NotNull(change);
        Assert.Equal(Scenes[1].Id, change.ProgramSceneId);
        Assert.Equal(Scenes[0].Id, change.PreviousProgramSceneId);
        Assert.Equal(Build.Fade(500), production.LastTransition);
        Assert.Equal(Build.T0, production.LastSwitchAt);
    }

    [Fact]
    public void SwitchProgram_WhileFadeRuns_IsTransitionRunning()
    {
        production.SwitchProgram(Scenes[1].Id, Build.Fade(300), Build.T0);

        var error = Assert.Throws<StudioFlowException>(() => production.SwitchProgram(Scenes[2].Id, Transitions.Cut, Build.T0.AddMilliseconds(299)));

        Assert.Equal(ErrorCodes.TransitionRunning, error.Code);
        Assert.NotNull(production.SwitchProgram(Scenes[2].Id, Transitions.Cut, Build.T0.AddMilliseconds(300)));
    }

    [Fact]
    public void SwitchProgram_AfterCut_IsNeverBlocked()
    {
        production.SwitchProgram(Scenes[1].Id, Transitions.Cut, Build.T0);

        Assert.NotNull(production.SwitchProgram(Scenes[2].Id, Transitions.Cut, Build.T0));
    }

    [Fact]
    public void SwitchProgram_ToPreview_MovesOldProgramToPreview()
    {
        production.SetPreview(Scenes[1].Id, Build.T0);

        var change = production.SwitchProgram(Scenes[1].Id, Transitions.Cut, Build.T0)!;

        Assert.Equal(Scenes[0].Id, change.PreviewSceneId);
        Assert.Equal(Scenes[1].Id, production.ProgramSceneId);
    }

    [Fact]
    public void SwitchProgram_UnknownScene_IsNotFound() =>
        Assert.Equal(ErrorKind.NotFound, Assert.Throws<StudioFlowException>(() => production.SwitchProgram("scn_none", Transitions.Cut, Build.T0)).Kind);

    [Fact]
    public void SetPreview_Changes_ReportCutWithUnchangedProgram()
    {
        var change = production.SetPreview(Scenes[2].Id, Build.T0)!;

        Assert.Equal(Scenes[0].Id, change.ProgramSceneId);
        Assert.Equal(change.ProgramSceneId, change.PreviousProgramSceneId);
        Assert.Equal(Transitions.Cut, change.Transition);
        Assert.Null(production.SetPreview(Scenes[2].Id, Build.T0));
        Assert.NotNull(production.SetPreview(null, Build.T0));
        Assert.Null(production.PreviewSceneId);
        Assert.Null(production.LastSwitchAt);
    }

    [Fact]
    public void SetPreview_UnknownScene_IsNotFound() => Assert.Throws<StudioFlowException>(() => production.SetPreview("scn_none", Build.T0));

    [Fact]
    public void Take_WithPreview_SwapsProgramAndPreview()
    {
        production.SetPreview(Scenes[2].Id, Build.T0);

        var change = production.Take(Build.Fade(), Build.T0);

        Assert.Equal(Scenes[2].Id, production.ProgramSceneId);
        Assert.Equal(Scenes[0].Id, production.PreviewSceneId);
        Assert.Equal(Scenes[0].Id, change.PreviousProgramSceneId);
    }

    [Fact]
    public void Take_WithoutPreview_IsConflict() =>
        Assert.Equal(ErrorCodes.Conflict, Assert.Throws<StudioFlowException>(() => production.Take(Transitions.Cut, Build.T0)).Code);

    [Fact]
    public void Take_PreviewEqualsProgram_IsConflict()
    {
        production.SetPreview(Scenes[0].Id, Build.T0);

        Assert.Equal(ErrorCodes.Conflict, Assert.Throws<StudioFlowException>(() => production.Take(Transitions.Cut, Build.T0)).Code);
    }

    [Fact]
    public void Take_WhileFadeRuns_IsTransitionRunning()
    {
        production.SetPreview(Scenes[1].Id, Build.T0);
        production.Take(Build.Fade(2000), Build.T0);

        Assert.Equal(ErrorCodes.TransitionRunning, Assert.Throws<StudioFlowException>(() => production.Take(Transitions.Cut, Build.T0.AddSeconds(1))).Code);
    }

    [Fact]
    public void Take_InvalidTransition_IsValidationError() =>
        Assert.Equal(ErrorKind.Validation, Assert.Throws<StudioFlowException>(() => production.Take(Build.Fade(123), Build.T0)).Kind);

    [Fact]
    public void RemoveScene_Program_IsSceneIsLive() =>
        Assert.Equal(ErrorCodes.SceneIsLive, Assert.Throws<StudioFlowException>(() => production.RemoveScene(Scenes[0].Id, Build.T0)).Code);

    [Fact]
    public void RemoveScene_Preview_ClearsPreviewAndRenumbers()
    {
        production.SetPreview(Scenes[1].Id, Build.T0);
        var middle = Scenes[1];

        var (removed, previewChange, reordered) = production.RemoveScene(middle.Id, Build.T0);

        Assert.Same(middle, removed);
        Assert.NotNull(previewChange);
        Assert.Null(production.PreviewSceneId);
        Assert.True(reordered);
        Assert.Equal([0, 1], Scenes.Select(s => s.SortOrder));
    }

    [Fact]
    public void RemoveScene_Last_DoesNotReorder() => Assert.False(production.RemoveScene(Scenes[2].Id, Build.T0).Reordered);

    [Fact]
    public void AddScene_Clone_CopiesItemsWithNewIds()
    {
        var phone = Build.Phone(production);
        var catalog = new SourceCatalog([phone], []);
        var original = Scenes[0];
        var item = original.AddItem(Build.Add(phone.SourceIdOf(phone.Slots[0])), catalog);
        original.Update(new UpdateSceneRequest(null, SceneLayoutMode.AutoGrid, new SceneBackgroundDto("#ffffff", null)), catalog);

        var (clone, programChange) = production.AddScene("Kopie", original.Id, Build.T0);

        Assert.Null(programChange);
        Assert.Equal(3, clone.SortOrder);
        Assert.Equal(SceneLayoutMode.AutoGrid, clone.LayoutMode);
        Assert.Equal("#ffffff", clone.Background.Color);
        Assert.Single(clone.Items);
        Assert.NotEqual(item.Id, clone.Items[0].Id);
        Assert.Equal(item.Source, clone.Items[0].Source);
    }

    [Fact]
    public void AddScene_UnknownCloneSource_IsValidationError() =>
        Assert.True(Assert.Throws<StudioFlowException>(() => production.AddScene("X", "scn_none", Build.T0)).Errors!.ContainsKey("cloneFromSceneId"));

    [Fact]
    public void AddScene_HundredthScene_IsLimitReached()
    {
        while (production.Scenes.Count < Production.MaxScenes)
        {
            production.AddScene("S", null, Build.T0);
        }

        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<StudioFlowException>(() => production.AddScene("S", null, Build.T0)).Code);
    }

    [Fact]
    public void ReorderScenes_Permutation_AppliesOrder()
    {
        var ids = Scenes.Select(s => s.Id).Reverse().ToList();

        Assert.True(production.ReorderScenes(ids));
        Assert.Equal(ids, Scenes.Select(s => s.Id));
        Assert.False(production.ReorderScenes(ids));
    }

    [Fact]
    public void ReorderScenes_NotAPermutation_IsValidationError()
    {
        var ids = Scenes.Select(s => s.Id).ToList();

        Assert.Throws<StudioFlowException>(() => production.ReorderScenes([ids[0], ids[1]]));
        Assert.Throws<StudioFlowException>(() => production.ReorderScenes([ids[0], ids[1], ids[1]]));
        Assert.Throws<StudioFlowException>(() => production.ReorderScenes([ids[0], ids[1], "scn_other"]));
        Assert.Throws<StudioFlowException>(() => production.ReorderScenes(null));
    }

    [Fact]
    public void Update_SlateWithVideoBackground_IsValidationError()
    {
        var video = Build.Video(production);
        var catalog = new SourceCatalog([], [video]);

        var error = Assert.Throws<StudioFlowException>(() => production.Update(new UpdateProductionRequest(null, new SlateDto("Gleich", null, video.Id), null), catalog));

        Assert.True(error.Errors!.ContainsKey("standbySlate.backgroundAssetId"));
    }

    [Fact]
    public void Update_NameAndSlate_ChangesOnlyGivenFields()
    {
        var image = Build.Image(production);
        var catalog = new SourceCatalog([], [image]);

        Assert.True(production.Update(new UpdateProductionRequest("Neu", null, new SlateDto("Ende", "Bis bald", image.Id)), catalog));

        Assert.Equal("Neu", production.Name);
        Assert.Equal("webinar", production.Slug);
        Assert.Equal("Gleich geht's los", production.StandbySlate.Title);
        Assert.Equal(image.Id, production.EndSlate.BackgroundAssetId);
        Assert.True(production.UsesAsset(image.Id));
        Assert.False(production.Update(new UpdateProductionRequest(null, null, null), catalog));
    }

    [Fact]
    public void SetAllowedIps_Valid_NormalizesAndDeduplicates()
    {
        production.SetAllowedIps(["10.1.2.3/8", " 10.0.0.0/8", "::1"]);

        Assert.Equal(["10.0.0.0/8", "::1"], production.AllowedIps);
    }

    [Fact]
    public void SetAllowedIps_InvalidEntry_NamesTheIndex() =>
        Assert.True(Assert.Throws<StudioFlowException>(() => production.SetAllowedIps(["10.0.0.0/8", "nope"])).Errors!.ContainsKey("allowedIps[1]"));

    [Fact]
    public void SetAllowedIps_TooMany_IsValidationError() =>
        Assert.Throws<StudioFlowException>(() => production.SetAllowedIps([.. Enumerable.Range(0, 51).Select(i => $"10.0.0.{i}")]));

    [Fact]
    public void RegenerateOutputKey_Always_ReplacesKey()
    {
        var old = production.OutputKey;

        production.RegenerateOutputKey(Build.T0.AddDays(1));

        Assert.NotEqual(old, production.OutputKey);
        Assert.Equal(Build.T0.AddDays(1), production.OutputKeyCreatedAt);
    }
}
