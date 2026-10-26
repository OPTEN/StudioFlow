using System.Net;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class EntityIdsTests
{
    [Theory]
    [InlineData(EntityIds.Production)]
    [InlineData(EntityIds.Scene)]
    [InlineData(EntityIds.Device)]
    [InlineData(EntityIds.Incident)]
    public void New_AnyPrefix_HasPrefixAndSixteenBase32Characters(string prefix)
    {
        var id = EntityIds.New(prefix);

        Assert.StartsWith(prefix, id, StringComparison.Ordinal);
        Assert.Equal(prefix.Length + 16, id.Length);
        Assert.All(id[prefix.Length..], c => Assert.Contains(c, EntityIds.Alphabet));
    }

    [Fact]
    public void New_ManyIds_AreUnique()
    {
        var ids = Enumerable.Range(0, 5000).Select(_ => EntityIds.New(EntityIds.Item)).ToHashSet(StringComparer.Ordinal);

        Assert.Equal(5000, ids.Count);
    }

    [Theory]
    [InlineData("itm_abcd", true)]
    [InlineData("itm_0123456789abcdefghij", true)]
    [InlineData("itm_abc", false)]
    [InlineData("itm_ABCD", false)]
    [InlineData("itm_ab-cd", false)]
    [InlineData("scn_abcd", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsValid_Input_MatchesClientPattern(string? id, bool expected) => Assert.Equal(expected, EntityIds.IsValid(id, EntityIds.Item));

    [Fact]
    public void IsValid_FortyOneCharacters_IsRejected() => Assert.False(EntityIds.IsValid("itm_" + new string('a', 41), EntityIds.Item));
}

public sealed class SecretsTests
{
    [Fact]
    public void New_Always_Is32BytesBase64UrlWithoutPadding()
    {
        var secret = Secrets.New();

        Assert.Equal(43, secret.Length);
        Assert.DoesNotContain('=', secret);
        Assert.DoesNotContain('+', secret);
        Assert.DoesNotContain('/', secret);
    }

    [Fact]
    public void MatchesHash_SameSecret_IsTrueAndOtherSecretFalse()
    {
        var secret = Secrets.New();
        var hash = Secrets.Hash(secret);

        Assert.True(Secrets.MatchesHash(secret, hash));
        Assert.False(Secrets.MatchesHash(secret + "x", hash));
        Assert.False(Secrets.MatchesHash(null, hash));
        Assert.Equal(64, hash.Length);
    }

    [Theory]
    [InlineData("a", "a", true)]
    [InlineData("a", "b", false)]
    [InlineData("a", "ab", false)]
    [InlineData(null, "a", false)]
    [InlineData(null, null, false)]
    public void FixedTimeEquals_Input_ComparesExactly(string? left, string? right, bool expected) => Assert.Equal(expected, Secrets.FixedTimeEquals(left, right));
}

public sealed class SourceRefTests
{
    [Fact]
    public void TryParse_DeviceSlot_ReturnsDeviceAndSlot()
    {
        Assert.True(SourceRef.TryParse("dev_abcd1234/screen-3", out var parsed));

        Assert.True(parsed.IsDevice);
        Assert.Equal("dev_abcd1234", parsed.DeviceId);
        Assert.Equal("screen-3", parsed.Slot);
        Assert.Equal("dev_abcd1234/screen-3", parsed.ToString());
    }

    [Fact]
    public void TryParse_Asset_ReturnsAsset()
    {
        Assert.True(SourceRef.TryParse("ast_abcd1234", out var parsed));

        Assert.False(parsed.IsDevice);
        Assert.Equal("ast_abcd1234", parsed.AssetId);
    }

    [Fact]
    public void TryParse_Text_ReturnsText()
    {
        Assert.True(SourceRef.TryParse("txt_abcd1234", out var parsed));

        Assert.False(parsed.IsDevice);
        Assert.Equal("txt_abcd1234", parsed.TextId);
        Assert.Null(parsed.AssetId);
        Assert.Equal("txt_abcd1234", parsed.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("dev_abcd1234")]
    [InlineData("dev_abcd1234/screen-0")]
    [InlineData("dev_abcd1234/screen-10")]
    [InlineData("dev_abcd1234/mic-1")]
    [InlineData("dev_abcd1234/screen-1-audio")]
    [InlineData("dev_abcd1234/camera/x")]
    [InlineData("ast_abcd1234/camera")]
    [InlineData("txt_abcd1234/camera")]
    [InlineData("txt_ab")]
    [InlineData("txt_ABCD1234")]
    [InlineData("scn_abcd1234")]
    [InlineData("../etc/passwd")]
    public void TryParse_Malformed_ReturnsFalse(string? value) => Assert.False(SourceRef.TryParse(value, out _));
}

public sealed class DeviceSlotsTests
{
    [Theory]
    [InlineData("camera", true)]
    [InlineData("mic", true)]
    [InlineData("screen-1", true)]
    [InlineData("screen-9", true)]
    [InlineData("screen-0", false)]
    [InlineData("screen-", false)]
    [InlineData("Screen-1", false)]
    [InlineData(null, false)]
    public void IsValid_Slot_AcceptsCameraMicrophoneAndNineScreens(string? slot, bool expected) => Assert.Equal(expected, DeviceSlots.IsValid(slot));

    [Fact]
    public void Screen_OutOfRange_Throws() => Assert.Throws<ArgumentOutOfRangeException>(() => DeviceSlots.Screen(10));
}

public sealed class SlotCodesTests
{
    [Fact]
    public void Allocate_NoCodes_ReturnsFirstOfLetter()
    {
        Assert.Equal("K1", SlotCodes.Allocate(SourceKind.Camera, []));
        Assert.Equal("S1", SlotCodes.Allocate(SourceKind.Screen, []));
        Assert.Equal("M1", SlotCodes.Allocate(SourceKind.Image, []));
        Assert.Equal("M1", SlotCodes.Allocate(SourceKind.Video, []));
    }

    [Fact]
    public void Allocate_Gap_ReturnsLowestFreeNumber() => Assert.Equal("K2", SlotCodes.Allocate(SourceKind.Camera, ["K1", "K3", "S2"]));

    [Fact]
    public void Allocate_OtherLettersAndJunk_AreIgnored() => Assert.Equal("S1", SlotCodes.Allocate(SourceKind.Screen, ["K1", "M1", "S", "Sx", "S-1"]));

    [Fact]
    public void Allocate_ImagesAndVideos_ShareTheMediaLetter() => Assert.Equal("M3", SlotCodes.Allocate(SourceKind.Video, ["M1", "M2"]));
}

public sealed class SlugsTests
{
    [Theory]
    [InlineData("Webinar", "webinar")]
    [InlineData("Grüezi Zürich 2026", "grueezi-zuerich-2026")]
    [InlineData("  Café   Crème!! ", "cafe-creme")]
    [InlineData("###", "production")]
    [InlineData("Straße", "strasse")]
    [InlineData("Ä-Ö-Ü", "ae-oe-ue")]
    public void FromName_Name_IsLowercaseAscii(string name, string expected) => Assert.Equal(expected, Slugs.FromName(name));

    [Fact]
    public void FromName_LongName_IsCutTo48WithoutTrailingDash()
    {
        var slug = Slugs.FromName(new string('a', 47) + " bcd");

        Assert.True(slug.Length <= Slugs.MaxLength);
        Assert.False(slug.EndsWith('-'));
        Assert.True(Slugs.IsValid(slug));
    }

    [Fact]
    public void MakeUnique_Taken_AppendsLowestFreeSuffix()
    {
        var taken = new HashSet<string>(StringComparer.Ordinal) { "webinar", "webinar-2" };

        Assert.Equal("webinar-3", Slugs.MakeUnique("webinar", taken.Contains));
        Assert.Equal("another", Slugs.MakeUnique("another", taken.Contains));
    }

    [Fact]
    public void MakeUnique_MaxLength_KeepsLimit()
    {
        var full = new string('a', 48);

        var unique = Slugs.MakeUnique(full, s => string.Equals(s, full, StringComparison.Ordinal));

        Assert.Equal(48, unique.Length);
        Assert.EndsWith("-2", unique, StringComparison.Ordinal);
    }
}

public sealed class TextRulesTests
{
    [Theory]
    [InlineData("  Scene 1  ", "Scene 1")]
    [InlineData("A", "A")]
    [InlineData("Line\u0007with\u0000control", "Linewithcontrol")]
    public void RequiredName_Valid_IsTrimmedAndCleaned(string input, string expected) => Assert.Equal(expected, TextRules.RequireName(input, 80, "name"));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("\u0001\u0002")]
    public void RequiredName_Empty_ThrowsValidationError(string? input)
    {
        var error = Assert.Throws<StudioFlowException>(() => TextRules.RequireName(input, 80, "name"));

        Assert.Equal(ErrorKind.Validation, error.Kind);
        Assert.Equal(ErrorCodes.ValidationFailed, error.Code);
        Assert.True(error.Errors!.ContainsKey("name"));
    }

    [Fact]
    public void RequiredName_TooLong_ThrowsAndExactLimitPasses()
    {
        Assert.Equal(60, TextRules.RequireName(new string('x', 60), 60, "name").Length);
        Assert.Throws<StudioFlowException>(() => TextRules.RequireName(new string('x', 61), 60, "name"));
    }

    [Fact]
    public void RequiredName_Emoji_CountsAsOneCharacter() => Assert.NotNull(TextRules.RequireName(string.Concat(Enumerable.Repeat("👍🏽", 60)), 60, "name"));

    [Fact]
    public void Truncate_LongText_IsCutAtLimit()
    {
        Assert.Equal(80, TextRules.Truncate(new string('p', 500), 80)!.Length);
        Assert.Null(TextRules.Truncate("   ", 80));
        Assert.Null(TextRules.Truncate(null, 80));
    }
}

public sealed class TransitionsTests
{
    [Fact]
    public void Normalize_CutWithDuration_BecomesZero() => Assert.Equal(Transitions.Cut, Transitions.Normalize(new TransitionDto(TransitionKind.Cut, 999)));

    [Theory]
    [InlineData(200)]
    [InlineData(300)]
    [InlineData(2000)]
    public void Normalize_AllowedFade_IsKept(int ms) => Assert.Equal(ms, Transitions.Normalize(Build.Fade(ms)).DurationMs);

    [Theory]
    [InlineData(0)]
    [InlineData(250)]
    [InlineData(-300)]
    [InlineData(2001)]
    public void Normalize_OtherFadeDuration_IsInvalid(int ms)
    {
        var error = Assert.Throws<StudioFlowException>(() => Transitions.Normalize(Build.Fade(ms)));

        Assert.True(error.Errors!.ContainsKey("transition.durationMs"));
    }

    [Fact]
    public void Normalize_Missing_IsInvalid() => Assert.Throws<StudioFlowException>(() => Transitions.Normalize(null));

    [Fact]
    public void Normalize_UnknownKind_IsInvalid() => Assert.Throws<StudioFlowException>(() => Transitions.Normalize(new TransitionDto((TransitionKind)7, 300)));
}

public sealed class IpRuleTests
{
    [Theory]
    [InlineData("192.168.1.10", "192.168.1.10", true)]
    [InlineData("192.168.1.10", "192.168.1.11", false)]
    [InlineData("192.168.1.0/24", "192.168.1.200", true)]
    [InlineData("192.168.1.0/24", "192.168.2.1", false)]
    [InlineData("192.168.1.77/24", "192.168.1.5", true)]
    [InlineData("10.0.0.0/8", "::ffff:10.1.2.3", true)]
    [InlineData("2001:db8::/32", "2001:db8:1::5", true)]
    [InlineData("2001:db8::/32", "2001:db9::5", false)]
    [InlineData("::1", "::1", true)]
    [InlineData("0.0.0.0/0", "8.8.8.8", true)]
    public void Matches_Rule_FollowsCidr(string rule, string client, bool expected)
    {
        Assert.True(IpRule.TryParse(rule, out var parsed));

        Assert.Equal(expected, parsed.Matches(IPAddress.Parse(client)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("example.com")]
    [InlineData("192.168.1.0/33")]
    [InlineData("192.168.1.0/-1")]
    [InlineData("192.168.1.0/abc")]
    [InlineData("::/129")]
    [InlineData("fe80::1%eth0")]
    [InlineData("300.1.1.1")]
    public void TryParse_Invalid_ReturnsFalse(string rule) => Assert.False(IpRule.TryParse(rule, out _));

    [Fact]
    public void ToString_Range_IsCanonical()
    {
        Assert.True(IpRule.TryParse(" 192.168.1.77/24 ", out var range));
        Assert.True(IpRule.TryParse("10.1.1.1", out var single));

        Assert.Equal("192.168.1.0/24", range.ToString());
        Assert.Equal("10.1.1.1", single.ToString());
    }

    [Fact]
    public void IsAllowed_EmptyList_AllowsEveryone()
    {
        Assert.True(IpRule.IsAllowed([], IPAddress.Parse("1.2.3.4")));
        Assert.True(IpRule.IsAllowed([], null));
    }

    [Fact]
    public void IsAllowed_UnknownClientWithRules_IsDenied() => Assert.False(IpRule.IsAllowed(["10.0.0.0/8"], null));
}
