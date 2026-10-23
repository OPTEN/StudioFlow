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
    public static IReadOnlyList<string> DefaultSceneNames { get; } = ["Begrüssung", "Präsentation", "Pause"];

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
    public SlateDto StandbySlate { get; private set; } = new("Gleich geht's los", null, null);

    /// <summary>Slate after the end.</summary>
    public SlateDto EndSlate { get; private set; } = new("Danke fürs Zuschauen", null, null);

    /// <summary>Secret key of the output link (shown to the Regie, therefore not hashed).</summary>
    public string OutputKey { get; private set; } = string.Empty;

    /// <summary>When the output key was created.</summary>
    public DateTimeOffset OutputKeyCreatedAt { get; private set; }

    /// <summary>IP addresses or CIDR ranges allowed to open the output; empty allows every address.</summary>
    public IReadOnlyList<string> AllowedIps { get; private set; } = [];

    /// <summary>Creation time.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Scenes (unordered navigation; use <see cref="OrderedScenes"/> for the list order).</summary>
    public IReadOnlyCollection<Scene> Scenes => scenes;

    /// <summary>Scenes ordered by <see cref="Scene.SortOrder"/>.</summary>
    public IReadOnlyList<Scene> OrderedScenes => [.. scenes.OrderBy(s => s.SortOrder)];

    /// <summary>Creates a production with the default scenes; the first scene is on air, the broadcast is in standby.</summary>
    public static Production Create(string name, string slug, bool isActive, DateTimeOffset now)
    {
        var validName = TextRules.RequireName(name, TextRules.NameMax, "name");
        if (!Slugs.IsValid(slug))
        {
            throw new ArgumentException("Invalid slug.", nameof(slug));
        }

        var production = new Production
        {
            Id = EntityIds.New(EntityIds.Production),
            Name = validName,
            Slug = slug,
            IsActive = isActive,
            Broadcast = BroadcastState.Standby,
            StandbySlate = new SlateDto("Gleich geht's los", validName, null),
            OutputKey = Secrets.New(),
            OutputKeyCreatedAt = now,
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
    public Scene GetScene(string sceneId) => FindScene(sceneId) ?? throw StudioFlowException.NotFound("Die Szene");

    /// <summary>The scene with the given id, if any.</summary>
    public Scene? FindScene(string? sceneId) => sceneId is null ? null : scenes.FirstOrDefault(s => string.Equals(s.Id, sceneId, StringComparison.Ordinal));

    /// <summary>Applies a partial update of name and slates; returns false when nothing changed.</summary>
    public bool Update(UpdateProductionRequest request, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        var name = request.Name is null ? null : TextRules.RequiredName(request.Name, TextRules.NameMax, "name", errors);
        var standby = request.StandbySlate is null ? null : ValidateSlate(request.StandbySlate, "standbySlate", errors, catalog);
        var end = request.EndSlate is null ? null : ValidateSlate(request.EndSlate, "endSlate", errors, catalog);
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

        return changed;
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
                throw StudioFlowException.Conflict(ErrorCodes.Conflict, "Die Sendung läuft nicht.");
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
            throw StudioFlowException.Conflict(ErrorCodes.Conflict, "Für einen Take muss eine andere Szene in der Preview sein.");
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
            errors.Add("cloneFromSceneId", "Diese Szene gibt es nicht.");
        }

        errors.ThrowIfAny();
        if (scenes.Count >= MaxScenes)
        {
            throw StudioFlowException.LimitReached("Eine Produktion kann höchstens 99 Szenen haben.");
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
            throw StudioFlowException.Conflict(ErrorCodes.SceneIsLive, "Die Szene ist live und kann nicht gelöscht werden.");
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
            throw StudioFlowException.Invalid("sceneIds", "Die Reihenfolge muss jede Szene genau einmal enthalten.");
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

    /// <summary>Creates a new output key; the old one is invalid immediately.</summary>
    public void RegenerateOutputKey(DateTimeOffset now)
    {
        OutputKey = Secrets.New();
        OutputKeyCreatedAt = now;
    }

    /// <summary>Validates and normalises the IP restriction of the output.</summary>
    public void SetAllowedIps(IReadOnlyList<string>? rules)
    {
        if (rules is null)
        {
            throw StudioFlowException.Invalid("allowedIps", "Liste fehlt.");
        }

        if (rules.Count > IpRule.MaxRules)
        {
            throw StudioFlowException.Invalid("allowedIps", $"Höchstens {IpRule.MaxRules} Einträge.");
        }

        var errors = new ValidationErrors();
        var normalized = new List<string>(rules.Count);
        for (var i = 0; i < rules.Count; i++)
        {
            if (IpRule.TryParse(rules[i], out var rule))
            {
                normalized.Add(rule.ToString());
            }
            else
            {
                errors.Add($"allowedIps[{i}]", "IP-Adresse oder Bereich (CIDR) angeben, z. B. 192.168.1.0/24.");
            }
        }

        errors.ThrowIfAny();
        AllowedIps = [.. normalized.Distinct(StringComparer.Ordinal)];
    }

    /// <summary>True when a slate, a scene background, an item or a fallback uses the asset.</summary>
    public bool UsesAsset(string assetId) =>
        string.Equals(StandbySlate.BackgroundAssetId, assetId, StringComparison.Ordinal)
        || string.Equals(EndSlate.BackgroundAssetId, assetId, StringComparison.Ordinal)
        || scenes.Any(s => s.UsesAsset(assetId));

    private static SlateDto? ValidateSlate(SlateDto slate, string path, ValidationErrors errors, SourceCatalog catalog)
    {
        var title = TextRules.RequiredName(slate.Title, TextRules.NameMax, $"{path}.title", errors);
        var subtitle = TextRules.Truncate(slate.Subtitle, SlateTextMax);
        if (slate.BackgroundAssetId is not null && !catalog.IsImageAsset(slate.BackgroundAssetId))
        {
            errors.Add($"{path}.backgroundAssetId", "Als Hintergrund ist nur ein Bild möglich.");
        }

        return title is null ? null : new SlateDto(title, subtitle, slate.BackgroundAssetId);
    }

    private void EnsureNoRunningTransition(DateTimeOffset now)
    {
        if (IsTransitionRunning(now))
        {
            throw StudioFlowException.Conflict(ErrorCodes.TransitionRunning, "Der Übergang läuft noch.");
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
