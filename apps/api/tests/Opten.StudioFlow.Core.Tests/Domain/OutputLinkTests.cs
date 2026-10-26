using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class OutputLinkTests
{
    private readonly OutputLink link = OutputLink.Create("prd_x", "Proxy", [], Build.T0);

    [Fact]
    public void Create_Defaults_HaveAHighEntropyKeyAndNoRestriction()
    {
        Assert.StartsWith(EntityIds.OutputLink, link.Id, StringComparison.Ordinal);
        Assert.Equal("prd_x", link.ProductionId);
        Assert.Equal("Proxy", link.Name);
        Assert.Equal(43, link.Key.Length);
        Assert.Equal(Build.T0, link.KeyCreatedAt);
        Assert.Empty(link.AllowedIps);
        Assert.Null(link.LastSeenAt);
    }

    [Fact]
    public void Create_Always_GivesDistinctKeysAndIds()
    {
        var keys = Enumerable.Range(0, 50).Select(_ => OutputLink.Create("prd_x", "L", [], Build.T0)).ToList();

        Assert.Equal(50, keys.Select(l => l.Key).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(50, keys.Select(l => l.Id).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Create_NameIsTrimmed()
    {
        Assert.Equal("Teams camera", OutputLink.Create("prd_x", "  Teams camera ", [], Build.T0).Name);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_EmptyName_IsValidationError(string name)
    {
        var error = Assert.Throws<StudioFlowException>(() => OutputLink.Create("prd_x", name, [], Build.T0));

        Assert.True(error.Errors!.ContainsKey("name"));
    }

    [Fact]
    public void Create_NameAtAndOverTheLimit_IsAcceptedAndRejected()
    {
        Assert.Equal(OutputLink.NameMax, OutputLink.Create("prd_x", new string('x', OutputLink.NameMax), [], Build.T0).Name.Length);
        Assert.Throws<StudioFlowException>(() => OutputLink.Create("prd_x", new string('x', OutputLink.NameMax + 1), [], Build.T0));
    }

    [Fact]
    public void Create_NameUsedIgnoringCase_IsValidationError()
    {
        var error = Assert.Throws<StudioFlowException>(() => OutputLink.Create("prd_x", "PROXY", [link], Build.T0));

        Assert.True(error.Errors!.ContainsKey("name"));
    }

    [Fact]
    public void Create_AtTheLimit_IsLimitReached()
    {
        var full = Enumerable.Range(0, OutputLink.MaxPerProduction).Select(i => OutputLink.Create("prd_x", $"L{i}", [], Build.T0)).ToList();

        var error = Assert.Throws<StudioFlowException>(() => OutputLink.Create("prd_x", "More", full, Build.T0));

        Assert.Equal(ErrorCodes.LimitReached, error.Code);
    }

    [Fact]
    public void Rename_OwnNameWithOtherCase_IsAllowedButAnotherLinksNameIsNot()
    {
        var teams = OutputLink.Create("prd_x", "Teams", [link], Build.T0);
        List<OutputLink> both = [link, teams];

        teams.Rename("TEAMS", both);

        Assert.Equal("TEAMS", teams.Name);
        Assert.Throws<StudioFlowException>(() => teams.Rename("proxy", both));
        Assert.Equal("TEAMS", teams.Name);
    }

    [Fact]
    public void RegenerateKey_Always_ReplacesKeyAndKeepsTheRest()
    {
        var old = link.Key;
        link.SetAllowedIps(["10.0.0.0/8"]);

        link.RegenerateKey(Build.T0.AddDays(1));

        Assert.NotEqual(old, link.Key);
        Assert.Equal(Build.T0.AddDays(1), link.KeyCreatedAt);
        Assert.Equal(["10.0.0.0/8"], link.AllowedIps);
        Assert.Equal("Proxy", link.Name);
    }

    [Fact]
    public void SetAllowedIps_Valid_NormalizesAndDeduplicates()
    {
        link.SetAllowedIps(["10.1.2.3/8", " 10.0.0.0/8", "::1"]);

        Assert.Equal(["10.0.0.0/8", "::1"], link.AllowedIps);
    }

    [Fact]
    public void SetAllowedIps_InvalidEntry_NamesTheIndex() =>
        Assert.True(Assert.Throws<StudioFlowException>(() => link.SetAllowedIps(["10.0.0.0/8", "nope"])).Errors!.ContainsKey("allowedIps[1]"));

    [Fact]
    public void SetAllowedIps_TooMany_IsValidationError() =>
        Assert.Throws<StudioFlowException>(() => link.SetAllowedIps([.. Enumerable.Range(0, 51).Select(i => $"10.0.0.{i}")]));

    [Fact]
    public void SetAllowedIps_Missing_IsValidationError() =>
        Assert.Throws<StudioFlowException>(() => link.SetAllowedIps(null));

    [Fact]
    public void MarkSeen_SetsTheTime()
    {
        link.MarkSeen(Build.T0.AddHours(1));

        Assert.Equal(Build.T0.AddHours(1), link.LastSeenAt);
    }

    [Fact]
    public void Find_ComparesEveryKeyAndReturnsTheMatch()
    {
        var teams = OutputLink.Create("prd_x", "Teams", [link], Build.T0);
        OutputLinkAccess[] access =
        [
            new("prd_x", "webinar", link.Id, link.Name, link.Key, []),
            new("prd_x", "webinar", teams.Id, teams.Name, teams.Key, []),
        ];

        Assert.Equal(teams.Id, OutputLinkAccess.Find(access, teams.Key)!.LinkId);
        Assert.Equal(link.Id, OutputLinkAccess.Find(access, link.Key)!.LinkId);
        Assert.Null(OutputLinkAccess.Find(access, link.Key + "x"));
        Assert.Null(OutputLinkAccess.Find(access, null));
        Assert.Null(OutputLinkAccess.Find([], link.Key));
    }
}
