using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>Result of a program or preview change.</summary>
/// <param name="ProgramSceneId">New program scene.</param>
/// <param name="PreviewSceneId">New preview scene.</param>
/// <param name="PreviousProgramSceneId">Program before the change.</param>
/// <param name="Transition">Transition to play (a cut when only the preview changed).</param>
/// <param name="At">Time of the change.</param>
public sealed record ProgramChange(string? ProgramSceneId, string? PreviewSceneId, string? PreviousProgramSceneId, TransitionDto Transition, DateTimeOffset At);

/// <summary>
/// A production (OBS: scene collection), the aggregate root of scenes and switching state (spec 4.2).
/// </summary>
public sealed class Production
{
    /// <summary>The only tenant for now (multi-tenancy is prepared, not active).</summary>
    public const string DefaultTenant = "opten";

    /// <summary>Maximum number of scenes per production.</summary>
    public const int MaxScenes = 99;

    /// <summary>Names of the scenes every new production starts with.</summary>
    public static IReadOnlyList<string> DefaultSceneNames { get; } = ["Welcome", "Presentation", "Break"];

    private const int SlateTextMax = 120;

    private readonly List<Scene> scenes = [];

    private Production()
    {
    }

    /// <summary>Production id.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>Tenant id.</summary>
    public string TenantId { get; private set; } = DefaultTenant;

    /// <summary>Display name.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>URL slug of the output page, fixed at creation.</summary>
    public string Slug { get; private set; } = string.Empty;

    /// <summary>The active production is the one /join pairs into.</summary>
    public bool IsActive { get; private set; }

    /// <summary>Broadcast state.</summary>
    public BroadcastState Broadcast { get; private set; }

    /// <summary>Start of the current broadcast.</summary>
    public DateTimeOffset? LiveSince { get; private set; }

    /// <summary>End of the last broadcast.</summary>
    public DateTimeOffset? EndedAt { get; private set; }

    /// <summary>Scene on air.</summary>
    public string? ProgramSceneId { get; private set; }

    /// <summary>Scene in the preview.</summary>
    public string? PreviewSceneId { get; private set; }

    /// <summary>Transition of the last program switch.</summary>
    public TransitionDto? LastTransition { get; private set; }

    /// <summary>Time of the last program switch.</summary>
    public DateTimeOffset? LastSwitchAt { get; private set; }

    /// <summary>Slate before the start.</summary>
    public SlateDto StandbySlate { get; private set; } = new("Starting soon", null, null);

    /// <summary>Slate after the end.</summary>
    public SlateDto EndSlate { get; private set; } = new("Thanks for watching", null, null);

    /// <summary>Colours of all texts and lower thirds.</summary>
    public TextThemeDto TextTheme { get; private set; } = TextSourceRules.DefaultTheme;

    /// <summary>Texts and lower thirds of the production (source kind text), in creation order.</summary>
    public IReadOnlyList<TextSourceDto> TextSources { get; private set; } = [];

    /// <summary>Aspect ratio of the output canvas.</summary>
    public CanvasFormat CanvasFormat { get; private set; } = Canvases.DefaultFormat;

    /// <summary>Target resolution of the output canvas.</summary>
    public CanvasResolution CanvasResolution { get; private set; } = Canvases.DefaultResolution;

    /// <summary>Size of the output canvas in pixels, the coordinate system of all scene items.</summary>
    public CanvasSize Canvas => Canvases.SizeOf(CanvasFormat, CanvasResolution);

    /// <summary>Creation time.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Scenes (unordered navigation; use <see cref="OrderedScenes"/> for the list order).</summary>
    public IReadOnlyCollection<Scene> Scenes => scenes;

    /// <summary>Scenes ordered by <see cref="Scene.SortOrder"/>.</summary>
    public IReadOnlyList<Scene> OrderedScenes => [.. scenes.OrderBy(s => s.SortOrder)];

    /// <summary>
    /// Creates a production with the default scenes; the first scene is on air, the broadcast is in standby. The canvas
    /// is 16:9 at 1080p unless the caller chooses another one from the fixed list.
    /// </summary>
    public static Production Create(
        string name,
        string slug,
        bool isActive,
        DateTimeOffset now,
        CanvasFormat format = Canvases.DefaultFormat,
        CanvasResolution resolution = Canvases.DefaultResolution)
    {
        var validName = TextRules.RequireName(name, TextRules.NameMax, "name");
        if (!Slugs.IsValid(slug))
        {
            throw new ArgumentException("Invalid slug.", nameof(slug));
        }

        var errors = new ValidationErrors();
        Canvases.Validate(format, resolution, errors);
        errors.ThrowIfAny();

        var production = new Production
        {
            Id = EntityIds.New(EntityIds.Production),
            Name = validName,
            Slug = slug,
            IsActive = isActive,
            Broadcast = BroadcastState.Standby,
            CanvasFormat = format,
            CanvasResolution = resolution,
            StandbySlate = new SlateDto("Starting soon", validName, null),
            CreatedAt = now,
        };
        for (var i = 0; i < DefaultSceneNames.Count; i++)
        {
            production.scenes.Add(Scene.Create(production.Id, DefaultSceneNames[i], i));
        }

        production.ProgramSceneId = production.OrderedScenes[0].Id;
        return production;
    }

    /// <summary>The scene with the given id, or a <c>not_found</c> error.</summary>
    public Scene GetScene(string sceneId) => FindScene(sceneId) ?? throw StudioFlowException.NotFound("Scene");

    /// <summary>The scene with the given id, if any.</summary>
    public Scene? FindScene(string? sceneId) => sceneId is null ? null : scenes.FirstOrDefault(s => string.Equals(s.Id, sceneId, StringComparison.Ordinal));

    /// <summary>Applies a partial update of name, slates and text colours; returns false when nothing changed.</summary>
    public bool Update(UpdateProductionRequest request, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        var name = request.Name is null ? null : TextRules.RequiredName(request.Name, TextRules.NameMax, "name", errors);
        var standby = request.StandbySlate is null ? null : ValidateSlate(request.StandbySlate, "standbySlate", errors, catalog);
        var end = request.EndSlate is null ? null : ValidateSlate(request.EndSlate, "endSlate", errors, catalog);
        if (request.TextTheme is not null)
        {
            TextSourceRules.ValidateTheme(request.TextTheme, "textTheme", errors);
        }

        errors.ThrowIfAny();
        var changed = false;
        if (name is not null && !string.Equals(name, Name, StringComparison.Ordinal))
        {
            Name = name;
            changed = true;
        }

        if (standby is not null && standby != StandbySlate)
        {
            StandbySlate = standby;
            changed = true;
        }

        if (end is not null && end != EndSlate)
        {
            EndSlate = end;
            changed = true;
        }

        if (request.TextTheme is { } theme && theme != TextTheme)
        {
            TextTheme = theme;
            changed = true;
        }

        return changed;
    }

    /// <summary>
    /// Sets format and resolution of the canvas and moves every scene item onto it (see <see cref="CanvasFit"/>). Returns
    /// the scenes whose items moved, or null when the canvas stays the same. Throws <c>broadcast_live</c> while the
    /// broadcast is live: the output shows the program scene, which would jump in front of the audience.
    /// </summary>
    public IReadOnlyList<Scene>? ChangeCanvas(CanvasFormat format, CanvasResolution resolution)
    {
        var errors = new ValidationErrors();
        Canvases.Validate(format, resolution, errors);
        errors.ThrowIfAny();
        if (format == CanvasFormat && resolution == CanvasResolution)
        {
            return null;
        }

        if (Broadcast == BroadcastState.Live)
        {
            throw StudioFlowException.Conflict(ErrorCodes.BroadcastLive, "The format cannot be changed while the broadcast is live.");
        }

        var from = Canvas;
        CanvasFormat = format;
        CanvasResolution = resolution;
        var to = Canvas;
        return [.. OrderedScenes.Where(scene => scene.FitTo(from, to))];
    }

    /// <summary>Sets the active flag; returns false when it was already set.</summary>
    public bool SetActive(bool active)
    {
        if (IsActive == active)
        {
            return false;
        }

        IsActive = active;
        return true;
    }

    /// <summary>Starts the broadcast (standby or ended → live); returns false when it is already live.</summary>
    public bool StartBroadcast(DateTimeOffset now)
    {
        if (Broadcast == BroadcastState.Live)
        {
            return false;
        }

        Broadcast = BroadcastState.Live;
        LiveSince = now;
        EndedAt = null;
        return true;
    }

    /// <summary>Ends the broadcast (live → ended); returns false when it already ended. Throws when it never started.</summary>
    public bool EndBroadcast(DateTimeOffset now)
    {
        switch (Broadcast)
        {
            case BroadcastState.Ended:
                return false;
            case BroadcastState.Standby:
                throw StudioFlowException.Conflict(ErrorCodes.Conflict, "The broadcast is not running.");
            default:
                Broadcast = BroadcastState.Ended;
                EndedAt = now;
                return true;
        }
    }

    /// <summary>Resets the broadcast to standby; returns false when it already is in standby.</summary>
    public bool ResetBroadcast()
    {
        if (Broadcast == BroadcastState.Standby && LiveSince is null && EndedAt is null)
        {
            return false;
        }

        Broadcast = BroadcastState.Standby;
        LiveSince = null;
        EndedAt = null;
        return true;
    }

    /// <summary>True while the fade of the last program switch is still running.</summary>
    public bool IsTransitionRunning(DateTimeOffset now) =>
        LastSwitchAt is { } at && LastTransition is { DurationMs: > 0 } transition && now < at.AddMilliseconds(transition.DurationMs);

    /// <summary>Sets or clears the preview. Returns the change, or null when the preview stays the same.</summary>
    public ProgramChange? SetPreview(string? sceneId, DateTimeOffset now)
    {
        if (sceneId is not null)
        {
            GetScene(sceneId);
        }

        if (string.Equals(sceneId, PreviewSceneId, StringComparison.Ordinal))
        {
            return null;
        }

        PreviewSceneId = sceneId;
        return new ProgramChange(ProgramSceneId, PreviewSceneId, ProgramSceneId, Transitions.Cut, now);
    }

    /// <summary>
    /// Direct program switch. A no-op (null) when the scene already is on air. When the new program was the preview, the
    /// old program becomes the preview (like a take). Throws <c>transition_running</c> while a fade runs.
    /// </summary>
    public ProgramChange? SwitchProgram(string sceneId, TransitionDto transition, DateTimeOffset now)
    {
        var scene = GetScene(sceneId);
        var normalized = Transitions.Normalize(transition);
        if (string.Equals(scene.Id, ProgramSceneId, StringComparison.Ordinal))
        {
            return null;
        }

        EnsureNoRunningTransition(now);
        var previous = ProgramSceneId;
        if (string.Equals(PreviewSceneId, scene.Id, StringComparison.Ordinal))
        {
            PreviewSceneId = previous;
        }

        return ApplyProgram(scene.Id, previous, normalized, now);
    }

    /// <summary>Take: the preview goes on air and the old program moves to the preview.</summary>
    public ProgramChange Take(TransitionDto transition, DateTimeOffset now)
    {
        var normalized = Transitions.Normalize(transition);
        var preview = FindScene(PreviewSceneId);
        if (preview is null || string.Equals(preview.Id, ProgramSceneId, StringComparison.Ordinal))
        {
            throw StudioFlowException.Conflict(ErrorCodes.Conflict, "A Take needs a different scene in Preview.");
        }

        EnsureNoRunningTransition(now);
        var previous = ProgramSceneId;
        PreviewSceneId = previous;
        return ApplyProgram(preview.Id, previous, normalized, now);
    }

    /// <summary>Adds a scene at the end, optionally as a copy of another scene. The first scene goes on air.</summary>
    public (Scene Scene, ProgramChange? ProgramChange) AddScene(string? name, string? cloneFromSceneId, DateTimeOffset now)
    {
        var errors = new ValidationErrors();
        var validName = TextRules.RequiredName(name, TextRules.NameMax, "name", errors);
        var template = cloneFromSceneId is null ? null : FindScene(cloneFromSceneId);
        if (cloneFromSceneId is not null && template is null)
        {
            errors.Add("cloneFromSceneId", "This scene does not exist.");
        }

        errors.ThrowIfAny();
        if (scenes.Count >= MaxScenes)
        {
            throw StudioFlowException.LimitReached("A production can have at most 99 scenes.");
        }

        var sortOrder = scenes.Count == 0 ? 0 : scenes.Max(s => s.SortOrder) + 1;
        var scene = template is null ? Scene.Create(Id, validName!, sortOrder) : template.CloneAs(validName!, sortOrder);
        scenes.Add(scene);
        ProgramChange? change = null;
        if (ProgramSceneId is null)
        {
            ProgramSceneId = scene.Id;
            change = new ProgramChange(scene.Id, PreviewSceneId, null, Transitions.Cut, now);
        }

        return (scene, change);
    }

    /// <summary>
    /// Deletes a scene. The program scene cannot be deleted (<c>scene_is_live</c>); deleting the preview clears it.
    /// Returns the preview change (or null) and whether the order of the remaining scenes changed.
    /// </summary>
    public (Scene Removed, ProgramChange? PreviewChange, bool Reordered) RemoveScene(string sceneId, DateTimeOffset now)
    {
        var scene = GetScene(sceneId);
        if (string.Equals(scene.Id, ProgramSceneId, StringComparison.Ordinal))
        {
            throw StudioFlowException.Conflict(ErrorCodes.SceneIsLive, "The scene is live and cannot be deleted.");
        }

        ProgramChange? previewChange = null;
        if (string.Equals(scene.Id, PreviewSceneId, StringComparison.Ordinal))
        {
            PreviewSceneId = null;
            previewChange = new ProgramChange(ProgramSceneId, null, ProgramSceneId, Transitions.Cut, now);
        }

        scenes.Remove(scene);
        return (scene, previewChange, Renumber());
    }

    /// <summary>Applies a new scene order; the list must contain every scene exactly once. Returns false when unchanged.</summary>
    public bool ReorderScenes(IReadOnlyList<string>? sceneIds)
    {
        var current = OrderedScenes;
        if (sceneIds is null || sceneIds.Count != current.Count || sceneIds.Distinct(StringComparer.Ordinal).Count() != current.Count || sceneIds.Any(id => FindScene(id) is null))
        {
            throw StudioFlowException.Invalid("sceneIds", "The order must contain every scene exactly once.");
        }

        if (current.Select(s => s.Id).SequenceEqual(sceneIds, StringComparer.Ordinal))
        {
            return false;
        }

        for (var i = 0; i < sceneIds.Count; i++)
        {
            GetScene(sceneIds[i]).MoveTo(i);
        }

        return true;
    }

    /// <summary>True when a slate, a scene background, an item or a fallback uses the asset.</summary>
    public bool UsesAsset(string assetId) =>
        string.Equals(StandbySlate.BackgroundAssetId, assetId, StringComparison.Ordinal)
        || string.Equals(EndSlate.BackgroundAssetId, assetId, StringComparison.Ordinal)
        || scenes.Any(s => s.UsesAsset(assetId));

    /// <summary>The text source with the given id, or a <c>not_found</c> error.</summary>
    public TextSourceDto GetTextSource(string textId) =>
        TextSources.FirstOrDefault(t => string.Equals(t.Id, textId, StringComparison.Ordinal)) ?? throw StudioFlowException.NotFound("Text");

    /// <summary>Adds a text source with the lowest free slot code T1, T2, … Throws <c>limit_reached</c> at 64 texts.</summary>
    public TextSourceDto AddTextSource(CreateTextSourceRequest request, IEnumerable<string> codesInUse)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(codesInUse);
        var align = request.Align ?? TextSourceRules.DefaultAlign(request.Style);
        var (line1, line2) = TextSourceRules.ValidateContent(request.Line1, request.Line2, request.Style, align);
        if (TextSources.Count >= TextSourceRules.MaxPerProduction)
        {
            throw StudioFlowException.LimitReached($"A production can have at most {TextSourceRules.MaxPerProduction} texts.");
        }

        var text = new TextSourceDto(EntityIds.New(EntityIds.Text), SlotCodes.Allocate(SourceKind.Text, codesInUse), line1, line2, request.Style, align);
        TextSources = [.. TextSources, text];
        return text;
    }

    /// <summary>Replaces the content of a text source; <c>Changed</c> is false when the request changes nothing.</summary>
    public (TextSourceDto Text, bool Changed) UpdateTextSource(string textId, UpdateTextSourceRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var existing = GetTextSource(textId);
        var (line1, line2) = TextSourceRules.ValidateContent(request.Line1, request.Line2, request.Style, request.Align);
        var updated = existing with { Line1 = line1, Line2 = line2, Style = request.Style, Align = request.Align };
        if (updated == existing)
        {
            return (existing, false);
        }

        TextSources = [.. TextSources.Select(t => ReferenceEquals(t, existing) ? updated : t)];
        return (updated, true);
    }

    /// <summary>
    /// Deletes a text source together with every scene item that shows it. Returns the text and the scenes that lost items
    /// (their version is incremented).
    /// </summary>
    public (TextSourceDto Text, IReadOnlyList<Scene> ChangedScenes) RemoveTextSource(string textId)
    {
        var text = GetTextSource(textId);
        var changed = scenes.Where(s => s.RemoveItemsOf(text.Id)).OrderBy(s => s.SortOrder).ToList();
        TextSources = [.. TextSources.Where(t => !ReferenceEquals(t, text))];
        return (text, changed);
    }

    private static SlateDto? ValidateSlate(SlateDto slate, string path, ValidationErrors errors, SourceCatalog catalog)
    {
        var title = TextRules.RequiredName(slate.Title, TextRules.NameMax, $"{path}.title", errors);
        var subtitle = TextRules.Truncate(slate.Subtitle, SlateTextMax);
        if (slate.BackgroundAssetId is not null && !catalog.IsImageAsset(slate.BackgroundAssetId))
        {
            errors.Add($"{path}.backgroundAssetId", "Only an image can be used as a background.");
        }

        return title is null ? null : new SlateDto(title, subtitle, slate.BackgroundAssetId);
    }

    private void EnsureNoRunningTransition(DateTimeOffset now)
    {
        if (IsTransitionRunning(now))
        {
            throw StudioFlowException.Conflict(ErrorCodes.TransitionRunning, "The transition is still running.");
        }
    }

    private ProgramChange ApplyProgram(string sceneId, string? previous, TransitionDto transition, DateTimeOffset now)
    {
        ProgramSceneId = sceneId;
        LastTransition = transition;
        LastSwitchAt = now;
        return new ProgramChange(ProgramSceneId, PreviewSceneId, previous, transition, now);
    }

    private bool Renumber()
    {
        var changed = false;
        var ordered = OrderedScenes;
        for (var i = 0; i < ordered.Count; i++)
        {
            if (ordered[i].SortOrder != i)
            {
                ordered[i].MoveTo(i);
                changed = true;
            }
        }

        return changed;
    }
}
