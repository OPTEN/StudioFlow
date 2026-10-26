using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class AuditFilterTests
{
    private static StudioFlowException Invalid(AuditFilterInput input) => Assert.Throws<StudioFlowException>(() => AuditFilter.Create(input));

    [Fact]
    public void Create_EmptyInput_IsNoRestriction()
    {
        var filter = AuditFilter.Create(new AuditFilterInput(From: " ", To: "", Production: null, Categories: [], Actions: [" "], Actor: "", Text: "  "));

        Assert.Equal(AuditFilter.Everything, filter with { });
    }

    [Fact]
    public void Create_Times_AreReadAsUtcAndBoundaryOrderIsKept()
    {
        var filter = AuditFilter.Create(new AuditFilterInput(From: "2026-10-26T14:00:00+02:00", To: "2026-10-27"));

        Assert.Equal(new DateTimeOffset(2026, 10, 26, 12, 0, 0, TimeSpan.Zero), filter.From);
        Assert.Equal(new DateTimeOffset(2026, 10, 27, 0, 0, 0, TimeSpan.Zero), filter.To);
    }

    [Theory]
    [InlineData("yesterday")]
    [InlineData("2026-13-45")]
    [InlineData("1; DROP TABLE audit_entries")]
    public void Create_UnreadableTime_NamesTheField(string value)
    {
        Assert.Contains("from", Invalid(new AuditFilterInput(From: value)).Errors!.Keys);
        Assert.Contains("to", Invalid(new AuditFilterInput(To: value)).Errors!.Keys);
    }

    [Theory]
    [InlineData("2026-10-26T10:00:00Z", "2026-10-26T10:00:00Z")]
    [InlineData("2026-10-26T10:00:00Z", "2026-10-25T10:00:00Z")]
    public void Create_EndNotAfterStart_IsInvalid(string from, string to) =>
        Assert.Contains("to", Invalid(new AuditFilterInput(From: from, To: to)).Errors!.Keys);

    [Fact]
    public void Create_Categories_BecomeTheActionsOfThoseCategories()
    {
        var filter = AuditFilter.Create(new AuditFilterInput(Categories: ["Media", "output"]));

        Assert.Equal(
            new[] { AuditActions.AssetDeleted, AuditActions.AssetUploaded, AuditActions.OutputAccessChanged, AuditActions.OutputKeyRegenerated },
            filter.Actions!.Order(StringComparer.Ordinal));
        Assert.All(filter.Actions!, action => Assert.Contains(AuditCategories.Of(action), new[] { AuditCategory.Media, AuditCategory.Output }));
    }

    [Fact]
    public void Create_CategoriesAndActions_AreIntersected()
    {
        var filter = AuditFilter.Create(new AuditFilterInput(Categories: ["security"], Actions: [AuditActions.LoginFailed, AuditActions.SceneLive]));

        Assert.Equal([AuditActions.LoginFailed], filter.Actions);
    }

    [Fact]
    public void Create_CategoriesAndActionsThatExcludeEachOther_MatchNothing()
    {
        var filter = AuditFilter.Create(new AuditFilterInput(Categories: ["media"], Actions: [AuditActions.SceneLive]));

        Assert.Empty(filter.Actions!);
    }

    [Theory]
    [InlineData("3")]
    [InlineData("everything")]
    [InlineData("media'; --")]
    public void Create_UnknownCategory_IsInvalid(string category) =>
        Assert.Contains("category", Invalid(new AuditFilterInput(Categories: [category])).Errors!.Keys);

    [Fact]
    public void Create_UnknownAction_IsInvalid() =>
        Assert.Contains("action", Invalid(new AuditFilterInput(Actions: ["scene.live", "scene.nothing"])).Errors!.Keys);

    [Fact]
    public void Create_TextAtTheLimit_IsAcceptedAndOneMoreIsNot()
    {
        Assert.Equal(new string('a', AuditFilter.TextMaxLength), AuditFilter.Create(new AuditFilterInput(Text: new string('a', AuditFilter.TextMaxLength))).Text);
        Assert.Contains("q", Invalid(new AuditFilterInput(Text: new string('a', AuditFilter.TextMaxLength + 1))).Errors!.Keys);
    }

    [Fact]
    public void Create_LongProductionOrActor_IsInvalid()
    {
        Assert.Contains("production", Invalid(new AuditFilterInput(Production: new string('p', 65))).Errors!.Keys);
        Assert.Contains("actor", Invalid(new AuditFilterInput(Actor: new string('a', 73))).Errors!.Keys);
    }

    [Fact]
    public void Create_SeveralMistakes_AreReportedTogether()
    {
        var errors = Invalid(new AuditFilterInput(From: "x", Categories: ["nope"], Actions: ["nope"])).Errors!;

        Assert.Equal(["action", "category", "from"], errors.Keys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void ToDetails_HoldsOnlyWhatIsSet()
    {
        var filter = AuditFilter.Create(new AuditFilterInput(From: "2026-10-26T10:00:00Z", Production: "none", Actions: [AuditActions.SceneLive], Text: "break"));

        Assert.Equal(
            new Dictionary<string, string>
            {
                ["from"] = "2026-10-26T10:00:00.0000000+00:00",
                ["production"] = "none",
                ["actions"] = "scene.live",
                ["q"] = "break",
            },
            filter.ToDetails());
        Assert.Empty(AuditFilter.Everything.ToDetails());
    }
}

public sealed class AuditCursorTests
{
    [Fact]
    public void Encode_ThenParse_GivesTheSameCursor()
    {
        var cursor = new AuditCursor(new DateTimeOffset(2026, 10, 26, 14, 3, 12, 345, TimeSpan.Zero).AddTicks(670), 123_456_789_012);

        Assert.True(AuditCursor.TryParse(cursor.Encode(), out var parsed));
        Assert.Equal(cursor, parsed);
    }

    [Fact]
    public void Encode_IsSafeInAUrl()
    {
        var text = new AuditCursor(DateTimeOffset.UnixEpoch.AddDays(20_000), 99).Encode();

        Assert.Matches("^[A-Za-z0-9_-]+$", text);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not a cursor")]
    [InlineData("MTIz")]
    [InlineData("MTIzLi0x")]
    [InlineData("YS5i")]
    [InlineData("OTk5OTk5OTk5OTk5OTk5OTk5OTk5LjE")]
    public void TryParse_AnythingElse_IsRefused(string? text) => Assert.False(AuditCursor.TryParse(text, out _));

    [Fact]
    public void TryParse_TooLong_IsRefused() => Assert.False(AuditCursor.TryParse(new string('A', 65), out _));
}

public sealed class AuditCategoriesTests
{
    [Fact]
    public void EveryAction_HasACategoryAndEveryCategoryAnAction()
    {
        var actions = typeof(AuditActions).GetFields().Select(f => (string)f.GetValue(null)!).ToList();

        Assert.All(actions, action => Assert.True(AuditCategories.IsKnown(action), $"{action} has no category"));
        Assert.Equal(actions.Order(StringComparer.Ordinal), AuditCategories.Actions.Order(StringComparer.Ordinal));
        Assert.All(Enum.GetValues<AuditCategory>(), category => Assert.NotEmpty(AuditCategories.ActionsOf([category])));
    }

    [Theory]
    [InlineData(AuditActions.LoginFailed, AuditCategory.Security)]
    [InlineData(AuditActions.AuditExported, AuditCategory.Security)]
    [InlineData(AuditActions.SceneLive, AuditCategory.Production)]
    [InlineData(AuditActions.DeviceBlocked, AuditCategory.Devices)]
    [InlineData(AuditActions.SourceLost, AuditCategory.Devices)]
    [InlineData(AuditActions.AssetUploaded, AuditCategory.Media)]
    [InlineData(AuditActions.OutputKeyRegenerated, AuditCategory.Output)]
    [InlineData(AuditActions.AuditRetention, AuditCategory.System)]
    [InlineData("from.a.newer.version", AuditCategory.System)]
    public void Of_GivesTheCategoryOfTheAction(string action, AuditCategory expected) => Assert.Equal(expected, AuditCategories.Of(action));
}

public sealed class AuditOptionsTests
{
    [Fact]
    public void Defaults_AreValidAndFollowTheDecision()
    {
        var options = new AuditOptions();

        Assert.Empty(options.Validate());
        Assert.Equal((365, 90), (options.RetentionDays, options.IpRetentionDays));
    }

    [Theory]
    [InlineData(0, 90)]
    [InlineData(3651, 90)]
    [InlineData(365, 0)]
    [InlineData(30, 31)]
    public void Validate_PeriodsOutOfRange_NameTheKey(int retention, int ipRetention)
    {
        var errors = new AuditOptions { RetentionDays = retention, IpRetentionDays = ipRetention }.Validate().ToList();

        Assert.NotEmpty(errors);
        Assert.Contains("Audit:", errors[0], StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_BatchExportAndIntervalLimits_AreChecked()
    {
        var errors = new AuditOptions { BatchSize = 1, ExportMaxRows = 0, ExportsPerMinute = 0, MaintenanceInterval = TimeSpan.FromSeconds(1) }.Validate().ToList();

        Assert.Equal(4, errors.Count);
    }
}
