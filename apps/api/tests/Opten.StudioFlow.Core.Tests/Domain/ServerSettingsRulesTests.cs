using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

/// <summary>The rules for every value of the server settings (issue #27): what the wizard may save.</summary>
public sealed class ServerSettingsRulesTests
{
    private static string? Codes(ValidationErrors errors, string field) =>
        errors.ToDictionary().TryGetValue(field, out var codes) ? string.Join(',', codes) : null;

    [Theory]
    [InlineData("192.168.1.50")]
    [InlineData("10.0.0.1")]
    [InlineData("172.30.0.2")]
    [InlineData("127.0.0.1")]
    [InlineData("  192.168.1.50  ")]
    public void MediaAddress_AValidIpv4_IsAccepted(string input)
    {
        var errors = new ValidationErrors();

        var address = ServerSettingsRules.ValidateMediaAddress(input, "address", errors);

        Assert.Equal(input.Trim(), address);
        Assert.False(errors.HasErrors);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("localhost")]
    [InlineData("192.168.1")]
    [InlineData("192.168.1.256")]
    [InlineData("192.168.001.050")]
    [InlineData("192.168.1.50:7881")]
    [InlineData("192.168.1.50.1")]
    [InlineData("::1")]
    [InlineData("fe80::1")]
    [InlineData("0.0.0.0")]
    [InlineData("255.255.255.255")]
    [InlineData("224.0.0.1")]
    [InlineData("240.0.0.1")]
    [InlineData("1.2.3.4\n5.6.7.8")]
    [InlineData("studio.example.ch")]
    public void MediaAddress_AnythingElse_IsRefused(string? input)
    {
        var errors = new ValidationErrors();

        Assert.Null(ServerSettingsRules.ValidateMediaAddress(input, "address", errors));
        Assert.Equal(SettingsFieldErrors.MediaAddressInvalid, Codes(errors, "address"));
    }

    [Theory]
    [InlineData("Studio.Example.CH", "studio.example.ch")]
    [InlineData("studio.example.ch.", "studio.example.ch")]
    [InlineData("a-b.example.ch", "a-b.example.ch")]
    [InlineData("xn--stdio-gva.example.ch", "xn--stdio-gva.example.ch")]
    public void Domain_AHostName_IsNormalised(string input, string expected)
    {
        var errors = new ValidationErrors();

        Assert.Equal(expected, ServerSettingsRules.ValidateDomain(input, required: true, needsDot: true, "domain", errors));
        Assert.False(errors.HasErrors);
    }

    [Theory]
    [InlineData("-a.example.ch")]
    [InlineData("a-.example.ch")]
    [InlineData("a..example.ch")]
    [InlineData("a b.example.ch")]
    [InlineData("a_b.example.ch")]
    [InlineData("studio.example.ch/path")]
    [InlineData("https://studio.example.ch")]
    [InlineData("studio.example.ch:8443")]
    [InlineData("*.example.ch")]
    [InlineData("studio.example.ch\nimport /etc/passwd")]
    [InlineData("192.168.1.50")]
    [InlineData("münchen.example.ch")]
    public void Domain_NotAHostName_IsRefused(string input)
    {
        var errors = new ValidationErrors();

        Assert.Null(ServerSettingsRules.ValidateDomain(input, required: false, needsDot: false, "domain", errors));
        Assert.Equal(SettingsFieldErrors.DomainInvalid, Codes(errors, "domain"));
    }

    [Fact]
    public void Domain_TooLong_IsRefused()
    {
        var errors = new ValidationErrors();
        var name = string.Join('.', Enumerable.Repeat(new string('a', 60), 5));

        Assert.Null(ServerSettingsRules.ValidateDomain(name, required: false, needsDot: false, "domain", errors));
        Assert.Equal(SettingsFieldErrors.DomainInvalid, Codes(errors, "domain"));
    }

    [Fact]
    public void Domain_EmptyWhereOptional_IsFineAndWhereRequired_IsNot()
    {
        var optional = new ValidationErrors();
        var required = new ValidationErrors();

        Assert.Null(ServerSettingsRules.ValidateDomain("  ", required: false, needsDot: false, "domain", optional));
        Assert.Null(ServerSettingsRules.ValidateDomain(null, required: true, needsDot: true, "domain", required));

        Assert.False(optional.HasErrors);
        Assert.Equal(SettingsFieldErrors.DomainRequired, Codes(required, "domain"));
    }

    [Fact]
    public void Domain_AHostWithoutADotNeedsNoDotOnlyForTheLocalCa()
    {
        var local = new ValidationErrors();
        var publicCertificate = new ValidationErrors();

        Assert.Equal("localhost", ServerSettingsRules.ValidateDomain("localhost", required: false, needsDot: false, "domain", local));
        Assert.Null(ServerSettingsRules.ValidateDomain("localhost", required: true, needsDot: true, "domain", publicCertificate));

        Assert.False(local.HasErrors);
        Assert.Equal(SettingsFieldErrors.DomainInvalid, Codes(publicCertificate, "domain"));
    }

    [Theory]
    [InlineData("_acme-challenge.studioflow.dedyn.io", true)]
    [InlineData("studioflow.dedyn.io", true)]
    [InlineData("", true)]
    [InlineData("nodot", false)]
    [InlineData("a b.example.ch", false)]
    [InlineData("_acme-challenge.example.ch\nimport x", false)]
    public void ChallengeDomain_AHostWithADot_IsAccepted(string input, bool valid)
    {
        var errors = new ValidationErrors();

        var result = ServerSettingsRules.ValidateChallengeDomain(input, "dnsChallengeDomain", errors);

        Assert.Equal(valid, !errors.HasErrors);
        Assert.Equal(valid && input.Length > 0, result is not null);
    }

    [Theory]
    [InlineData("admin@example.ch", true)]
    [InlineData("a.b+c@sub.example.ch", true)]
    [InlineData("", true)]
    [InlineData("admin", false)]
    [InlineData("admin@example", false)]
    [InlineData("ad min@example.ch", false)]
    [InlineData("admin@example.ch {", false)]
    [InlineData("\"admin@example.ch\"", false)]
    public void Email_IsAnAddressOrEmpty(string input, bool valid)
    {
        var errors = new ValidationErrors();

        ServerSettingsRules.ValidateEmail(input, "acmeEmail", errors);

        Assert.Equal(valid, !errors.HasErrors);
    }

    [Fact]
    public void DnsCredentials_EveryFieldOfTheProvider_IsAccepted()
    {
        var errors = new ValidationErrors();
        var given = new Dictionary<string, string> { ["token"] = "build-validation-dummy-token-0123456789abcdef" };

        var values = ServerSettingsRules.ValidateDnsCredentials("dns-cloudflare", given, keepStored: false, "dnsCredentials", errors);

        Assert.Equal(["build-validation-dummy-token-0123456789abcdef"], values);
        Assert.False(errors.HasErrors);
    }

    [Fact]
    public void DnsCredentials_ValuesComeInTheOrderOfTheSnippetArguments()
    {
        var errors = new ValidationErrors();
        var given = new Dictionary<string, string>
        {
            ["region"] = "eu-central-1",
            ["secretAccessKey"] = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            ["accessKeyId"] = "AKIAIOSFODNN7EXAMPLE",
        };

        var values = ServerSettingsRules.ValidateDnsCredentials("dns-route53", given, keepStored: false, "dnsCredentials", errors);

        Assert.Equal(["AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "eu-central-1"], values);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void DnsCredentials_ATokenThatIsMissing_IsRequired(string? token)
    {
        var errors = new ValidationErrors();
        var given = new Dictionary<string, string> { ["token"] = token! };

        Assert.Null(ServerSettingsRules.ValidateDnsCredentials("dns-cloudflare", given, keepStored: false, "dnsCredentials", errors));
        Assert.Equal(SettingsFieldErrors.CredentialRequired, Codes(errors, "dnsCredentials.token"));
    }

    [Fact]
    public void DnsCredentials_NoneAtAll_AreRequiredUnlessTheStoredOnesStay()
    {
        var first = new ValidationErrors();
        var later = new ValidationErrors();

        Assert.Null(ServerSettingsRules.ValidateDnsCredentials("dns-ovh", null, keepStored: false, "dnsCredentials", first));
        Assert.Null(ServerSettingsRules.ValidateDnsCredentials("dns-ovh", null, keepStored: true, "dnsCredentials", later));

        Assert.Equal(4, first.ToDictionary().Count);
        Assert.False(later.HasErrors);
    }

    [Theory]
    [InlineData("short")]
    [InlineData("has space in the token 0123456789")]
    [InlineData("quote\"in-the-token-0123456789")]
    [InlineData("brace{in-the-token-0123456789")]
    [InlineData("new\nline-in-the-token-0123456789")]
    [InlineData("backslash\\in-the-token-0123456789")]
    public void DnsCredentials_AValueThatCouldBreakTheCaddyfile_IsRefused(string token)
    {
        var errors = new ValidationErrors();

        ServerSettingsRules.ValidateDnsCredentials("dns-cloudflare", new Dictionary<string, string> { ["token"] = token }, keepStored: false, "dnsCredentials", errors);

        Assert.Equal(SettingsFieldErrors.CredentialInvalid, Codes(errors, "dnsCredentials.token"));
    }

    [Fact]
    public void DnsCredentials_AFieldTheProviderDoesNotHave_IsRefused()
    {
        var errors = new ValidationErrors();
        var given = new Dictionary<string, string> { ["token"] = "build-validation-dummy-token-0123456789abcdef", ["apiKey"] = "x" };

        ServerSettingsRules.ValidateDnsCredentials("dns-cloudflare", given, keepStored: false, "dnsCredentials", errors);

        Assert.Equal(SettingsFieldErrors.CredentialUnknown, Codes(errors, "dnsCredentials.apiKey"));
    }

    [Fact]
    public void Origins_AreNormalisedAndDeduplicated()
    {
        var errors = new ValidationErrors();

        var origins = ServerSettingsRules.ValidateOrigins(["HTTPS://Proxy.Example.CH/", "https://proxy.example.ch", "https://*.example.com", "http://localhost:4200", "'self'", " "], "origins", errors);

        Assert.Equal(["https://proxy.example.ch", "https://*.example.com", "http://localhost:4200"], origins);
        Assert.False(errors.HasErrors);
    }

    [Theory]
    [InlineData("*")]
    [InlineData("https://*")]
    [InlineData("proxy.example.ch")]
    [InlineData("ftp://proxy.example.ch")]
    [InlineData("data:")]
    [InlineData("'unsafe-inline'")]
    [InlineData("https://proxy.example.ch/path")]
    [InlineData("https://proxy.example.ch https://other.example.ch")]
    [InlineData("https://proxy.example.ch; script-src *")]
    [InlineData("https://proxy.example.ch\nimport x")]
    [InlineData("https://-bad.example.ch")]
    public void Origins_NotAnOrigin_IsRefusedWithItsIndex(string origin)
    {
        var errors = new ValidationErrors();

        ServerSettingsRules.ValidateOrigins(["https://ok.example.ch", origin], "origins", errors);

        Assert.Equal(SettingsFieldErrors.OriginInvalid, Codes(errors, "origins[1]"));
        Assert.Null(Codes(errors, "origins[0]"));
    }

    [Fact]
    public void Origins_MoreThanTheLimit_AreRefused()
    {
        var errors = new ValidationErrors();

        ServerSettingsRules.ValidateOrigins([.. Enumerable.Range(0, ServerSettingsRules.MaxOrigins + 1).Select(i => $"https://h{i}.example.ch")], "origins", errors);

        Assert.Equal(SettingsFieldErrors.TooManyOrigins, Codes(errors, "origins"));
    }

    [Theory]
    [InlineData("0 3 * * *", true)]
    [InlineData("*/15 * * * *", true)]
    [InlineData("0 3 * * 1-5", true)]
    [InlineData("30 2 1,15 * *", true)]
    [InlineData("0 3 * * MON", true)]
    [InlineData("0 3 1 JAN-MAR *", true)]
    [InlineData("0 0-23/6 * * *", true)]
    [InlineData("@daily", true)]
    [InlineData("  0   3 * * *  ", true)]
    [InlineData("", true)]
    [InlineData("0 3 * *", false)]
    [InlineData("0 3 * * * *", false)]
    [InlineData("60 3 * * *", false)]
    [InlineData("0 24 * * *", false)]
    [InlineData("0 3 32 * *", false)]
    [InlineData("0 3 * 13 *", false)]
    [InlineData("0 3 * * 8", false)]
    [InlineData("*/0 * * * *", false)]
    [InlineData("a b c d e", false)]
    [InlineData("@sometimes", false)]
    [InlineData("0 3 * * *; rm -rf /", false)]
    [InlineData("0 3 * * *\n* * * * *", false)]
    public void Schedule_IsACronExpressionOrEmpty(string input, bool valid)
    {
        var errors = new ValidationErrors();

        var schedule = ServerSettingsRules.ValidateSchedule(input, "schedule", errors);

        Assert.Equal(valid, !errors.HasErrors);
        if (valid && input.Trim().Length > 0)
        {
            Assert.Equal(string.Join(' ', input.Split(' ', StringSplitOptions.RemoveEmptyEntries)), schedule);
        }
    }

    [Theory]
    [InlineData("Europe/Zurich", true)]
    [InlineData("UTC", true)]
    [InlineData("America/Argentina/Buenos_Aires", true)]
    [InlineData("Etc/GMT+1", true)]
    [InlineData("", true)]
    [InlineData("Europe Zurich", false)]
    [InlineData("../etc/passwd", false)]
    [InlineData("Europe/Zurich;rm", false)]
    public void Timezone_IsAnIanaName(string input, bool valid)
    {
        var errors = new ValidationErrors();

        ServerSettingsRules.ValidateTimezone(input, "timezone", errors);

        Assert.Equal(valid, !errors.HasErrors);
    }

    [Theory]
    [InlineData(7, 4, true)]
    [InlineData(1, 1, true)]
    [InlineData(365, 104, true)]
    [InlineData(0, 4, false)]
    [InlineData(7, 0, false)]
    [InlineData(366, 4, false)]
    [InlineData(7, 105, false)]
    [InlineData(-1, -1, false)]
    public void Retention_IsWithinTheLimits(int daily, int weekly, bool valid)
    {
        var errors = new ValidationErrors();

        ServerSettingsRules.ValidateRetention(daily, weekly, errors);

        Assert.Equal(valid, !errors.HasErrors);
    }

    [Theory]
    [InlineData("offsite:studioflow-backups", true)]
    [InlineData("s3:bucket/path/to", true)]
    [InlineData("sftp:", true)]
    [InlineData("", true)]
    [InlineData("nocolon", false)]
    [InlineData(":path", false)]
    [InlineData("name with space:path", false)]
    [InlineData("offsite:path;rm", false)]
    [InlineData("offsite:path\nx", false)]
    public void Remote_IsNameColonPathOrEmpty(string input, bool valid)
    {
        var errors = new ValidationErrors();

        ServerSettingsRules.ValidateRemote(input, "rcloneRemote", errors);

        Assert.Equal(valid, !errors.HasErrors);
    }

    [Fact]
    public void RcloneConfig_ASectionedFile_IsAccepted_AndLineEndingsAreNormalised()
    {
        var errors = new ValidationErrors();

        var text = ServerSettingsRules.ValidateRcloneConfig("[offsite]\r\ntype = s3\r\nprovider = Other\r\n", "rcloneConfig", errors);

        Assert.Equal("[offsite]\ntype = s3\nprovider = Other\n", text);
        Assert.True(ServerSettingsRules.RemoteIsDefined("offsite:bucket", text!));
        Assert.False(ServerSettingsRules.RemoteIsDefined("other:bucket", text!));
    }

    [Theory]
    [InlineData("just some text")]
    [InlineData("type = s3")]
    [InlineData("[offsite]\u0000\ntype = s3")]
    public void RcloneConfig_NotAnRcloneFile_IsRefused(string input)
    {
        var errors = new ValidationErrors();

        Assert.Null(ServerSettingsRules.ValidateRcloneConfig(input, "rcloneConfig", errors));
        Assert.Equal(SettingsFieldErrors.RcloneConfigInvalid, Codes(errors, "rcloneConfig"));
    }

    [Fact]
    public void AgeRecipients_PublicKeys_AreAccepted_AndOthersRefusedWithTheirIndex()
    {
        var errors = new ValidationErrors();
        const string key = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";

        var recipients = ServerSettingsRules.ValidateAgeRecipients([key, key, "AGE-SECRET-KEY-1ABC", "  "], "ageRecipients", errors);

        Assert.Equal([key], recipients);
        Assert.Equal(SettingsFieldErrors.AgeRecipientInvalid, Codes(errors, "ageRecipients[2]"));
    }
}
