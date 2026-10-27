using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>The files the API writes for the other services (issue #27): the Caddyfile, livekit.yaml and the backup settings.</summary>
public sealed class ServerConfigRendererTests
{
    private static CaddyModel Model(
        string mode = TlsModes.Internal,
        string? domain = null,
        int port = 8443,
        string? email = null,
        string? challenge = null,
        IReadOnlyList<string>? dns = null,
        CertificateFiles? certificate = null,
        IReadOnlyList<string>? ancestors = null,
        int hsts = 31_536_000,
        int localHsts = 3_600) =>
        new(port, mode, domain, email, challenge, dns, certificate, ancestors ?? [], hsts, localHsts);

    [Fact]
    public void Caddyfile_WithoutADomain_HasOnlyTheSiteForAnyNameWithTheLocalCa()
    {
        var config = CaddyfileRenderer.Render(Model());

        Assert.Contains("https_port 8443", config.Text, StringComparison.Ordinal);
        Assert.Contains("servers :8443 {", config.Text, StringComparison.Ordinal);
        Assert.Contains($"name {config.ServerName}", config.Text, StringComparison.Ordinal);
        Assert.Contains(":8443 {\n\ttls internal {\n\t\ton_demand\n\t}\n\timport sf_ca_download\n\timport studioflow_site 3600 \"'self'\"\n}", config.Text, StringComparison.Ordinal);
        Assert.DoesNotContain("https://", config.Text, StringComparison.Ordinal);
        Assert.Null(config.Warning);
    }

    [Fact]
    public void Caddyfile_NeverListensOnPort80()
    {
        foreach (var model in new[]
        {
            Model(),
            Model(domain: "studio.example.ch"),
            Model(TlsModes.Custom, "studio.example.ch", certificate: new CertificateFiles("/certs/c.pem", "/certs/k.pem")),
            Model("dns-cloudflare", "studio.example.ch", dns: ["tokentokentokentokentoken"]),
        })
        {
            var text = CaddyfileRenderer.Render(model).Text;

            Assert.DoesNotContain("http://", text, StringComparison.Ordinal);
            Assert.DoesNotContain(":80 ", text, StringComparison.Ordinal);
            Assert.DoesNotContain("http_port", text, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Caddyfile_ServerNameIsStableAndFollowsTheContent()
    {
        var first = CaddyfileRenderer.Render(Model(domain: "studio.example.ch"));
        var same = CaddyfileRenderer.Render(Model(domain: "studio.example.ch"));
        var otherDomain = CaddyfileRenderer.Render(Model(domain: "other.example.ch"));
        var otherPort = CaddyfileRenderer.Render(Model(domain: "studio.example.ch", port: 9443));
        var otherAncestors = CaddyfileRenderer.Render(Model(domain: "studio.example.ch", ancestors: ["https://a.example"]));

        Assert.Equal(first.ServerName, same.ServerName);
        Assert.Matches("^sf-[0-9a-f]{12}$", first.ServerName);
        Assert.Equal(4, new[] { first, otherDomain, otherPort, otherAncestors }.Select(c => c.ServerName).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Caddyfile_InternalModeWithADomain_GivesTheDomainItsOwnSiteWithTheLocalCa()
    {
        var text = CaddyfileRenderer.Render(Model(domain: "studio.example.ch")).Text;

        Assert.Contains("https://studio.example.ch:8443 {\n\ttls internal\n\timport sf_ca_download\n\timport studioflow_site 3600 \"'self'\"\n}", text, StringComparison.Ordinal);
        Assert.Contains("\n:8443 {\n", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_CustomCertificate_UsesTheUploadedFilesAndTheLongHsts()
    {
        var text = CaddyfileRenderer.Render(Model(TlsModes.Custom, "studio.example.ch", certificate: new CertificateFiles("/certs/cert-1.pem", "/certs/key-1.pem"))).Text;

        Assert.Contains("https://studio.example.ch:8443 {\n\ttls /certs/cert-1.pem /certs/key-1.pem\n\timport studioflow_site 31536000 \"'self'\"\n}", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_CustomCertificateThatCannotBeRead_LeavesOutTheDomainSiteAndSaysWhy()
    {
        var config = CaddyfileRenderer.Render(Model(TlsModes.Custom, "studio.example.ch"));

        Assert.DoesNotContain("studio.example.ch", config.Text, StringComparison.Ordinal);
        Assert.Contains("Upload it again", config.Warning, StringComparison.Ordinal);
        Assert.Contains("\n:8443 {\n", config.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_DnsChallenge_ImportsTheProviderSnippetWithTheQuotedCredentials()
    {
        var text = CaddyfileRenderer.Render(Model("dns-route53", "studio.example.ch", email: "admin@example.ch", challenge: "_acme-challenge.studioflow.dedyn.io", dns: ["AKIAEXAMPLE", "secret/with+chars=", "eu-central-1"])).Text;

        Assert.Contains("https://studio.example.ch:8443 {\n\ttls admin@example.ch {\n", text, StringComparison.Ordinal);
        Assert.Contains("\t\timport /etc/caddy/tls/dns-route53.caddy \"AKIAEXAMPLE\" \"secret/with+chars=\" \"eu-central-1\"\n", text, StringComparison.Ordinal);
        Assert.Contains("\t\tresolvers {$STUDIOFLOW_DNS_RESOLVERS}\n", text, StringComparison.Ordinal);
        Assert.Contains("\t\tdns_challenge_override_domain _acme-challenge.studioflow.dedyn.io\n", text, StringComparison.Ordinal);
        Assert.Contains("\timport studioflow_site 31536000 \"'self'\"\n", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_HstsSetByTheOperator_AppliesToTheLocalCaSitesToo()
    {
        var text = CaddyfileRenderer.Render(Model(TlsModes.Internal, "studio.example.ch", hsts: 600, localHsts: 600)).Text;

        Assert.Contains(":8443 {\n\ttls internal {\n\t\ton_demand\n\t}\n\timport sf_ca_download\n\timport studioflow_site 600 \"'self'\"\n}", text, StringComparison.Ordinal);
        Assert.Contains("https://studio.example.ch:8443 {\n\ttls internal\n\timport sf_ca_download\n\timport studioflow_site 600 \"'self'\"\n}", text, StringComparison.Ordinal);
        Assert.DoesNotContain("3600", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_DnsChallengeWithoutEmailOrDelegation_LeavesThemOut()
    {
        var text = CaddyfileRenderer.Render(Model("dns-cloudflare", "studio.example.ch", dns: ["tokentokentokentokentoken"])).Text;

        Assert.DoesNotContain("dns_challenge_override_domain", text, StringComparison.Ordinal);
        Assert.Contains("\ttls  {\n", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_DnsChallengeWithoutReadableCredentials_LeavesOutTheDomainSiteAndSaysWhy()
    {
        var config = CaddyfileRenderer.Render(Model("dns-cloudflare", "studio.example.ch", dns: null));

        Assert.DoesNotContain("studio.example.ch", config.Text, StringComparison.Ordinal);
        Assert.Contains("Enter them again", config.Warning, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_AValueWithAQuote_IsEscapedSoItCannotEndTheToken()
    {
        var text = CaddyfileRenderer.Render(Model("dns-cloudflare", "studio.example.ch", dns: ["a\"b\\c"])).Text;

        Assert.Contains("\"a\\\"b\\\\c\"", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Caddyfile_TheEmbeddingOriginsArePassedAsOneArgument_OnEverySite()
    {
        var text = CaddyfileRenderer.Render(Model("dns-cloudflare", "studio.example.ch", dns: ["tokentokentokentokentoken"], ancestors: ["https://proxy.example.ch", "https://*.example.com"])).Text;

        Assert.Equal(2, text.Split("\"'self' https://proxy.example.ch https://*.example.com\"").Length - 1);
    }

    [Theory]
    [InlineData(443)]
    [InlineData(8443)]
    [InlineData(9443)]
    public void Caddyfile_TheHttpsPortIsTheListenPort(int port)
    {
        var text = CaddyfileRenderer.Render(Model(domain: "studio.example.ch", port: port)).Text;

        Assert.Contains($"https_port {port}\n", text, StringComparison.Ordinal);
        Assert.Contains($"servers :{port} {{", text, StringComparison.Ordinal);
        Assert.Contains($"https://studio.example.ch:{port} {{", text, StringComparison.Ordinal);
        Assert.Contains($"\n:{port} {{\n", text, StringComparison.Ordinal);
    }

    [Fact]
    public void LiveKit_WithTheMediaAddress_AnnouncesIt()
    {
        var yaml = LiveKitConfigRenderer.Render("APIkey", "Secret0123456789", "192.168.1.50", new InstallOptions { LiveKitRtcTcpPort = 7901, LiveKitRtcUdpPort = 7902, LiveKitEmptyTimeout = 10 });

        Assert.Contains("rtc:\n  tcp_port: 7901\n  udp_port: 7902\n  use_external_ip: false\n  node_ip: 192.168.1.50\n", yaml, StringComparison.Ordinal);
        Assert.Contains("keys:\n  \"APIkey\": \"Secret0123456789\"\n", yaml, StringComparison.Ordinal);
        Assert.Contains("  empty_timeout: 10\n", yaml, StringComparison.Ordinal);
        Assert.Contains("webhook:\n  api_key: \"APIkey\"\n  urls:\n    - \"http://api:8080/api/livekit/webhook\"\n", yaml, StringComparison.Ordinal);
    }

    [Fact]
    public void LiveKit_WithoutAMediaAddress_AnnouncesNoneAndDefaultsTheTimeouts()
    {
        var yaml = LiveKitConfigRenderer.Render("APIkey", "Secret0123456789", null, new InstallOptions());

        Assert.DoesNotContain("node_ip", yaml, StringComparison.Ordinal);
        Assert.Contains("tcp_port: 7881", yaml, StringComparison.Ordinal);
        Assert.Contains("empty_timeout: 300", yaml, StringComparison.Ordinal);
    }

    [Fact]
    public void LiveKit_ASecretOfDigits_StaysAString()
    {
        var yaml = LiveKitConfigRenderer.Render("key", "12345678901234567890123456789012", null, new InstallOptions());

        Assert.Contains("\"key\": \"12345678901234567890123456789012\"", yaml, StringComparison.Ordinal);
    }

    [Fact]
    public void LiveKit_HashChangesWithTheAddressOnly()
    {
        var install = new InstallOptions();
        var a = LiveKitConfigRenderer.Hash(LiveKitConfigRenderer.Render("k", "s0123456789", "10.0.0.1", install));
        var same = LiveKitConfigRenderer.Hash(LiveKitConfigRenderer.Render("k", "s0123456789", "10.0.0.1", install));
        var b = LiveKitConfigRenderer.Hash(LiveKitConfigRenderer.Render("k", "s0123456789", "10.0.0.2", install));

        Assert.Equal(a, same);
        Assert.NotEqual(a, b);
        Assert.Equal(64, a.Length);
    }

    [Fact]
    public void BackupSettings_OffByDefault_HaveNoOffsite()
    {
        var json = BackupSettingsRenderer.Render(ServerSettings.CreateDefault(DateTimeOffset.UnixEpoch), null);

        Assert.Contains("\"schedule\": \"\"", json, StringComparison.Ordinal);
        Assert.Contains("\"keepDaily\": 7", json, StringComparison.Ordinal);
        Assert.Contains("\"offsite\": null", json, StringComparison.Ordinal);
        Assert.EndsWith("\n", json, StringComparison.Ordinal);
    }

    [Fact]
    public void BackupSettings_WithAnOffsiteTarget_CarryTheHashOfTheRcloneConfigButNotItsContent()
    {
        var settings = ServerSettings.CreateDefault(DateTimeOffset.UnixEpoch);
        settings.ChangeBackup("0 3 * * *", "Europe/Zurich", 14, 8, "offsite:bucket", "protected", ["age1abc"], offsiteUnencrypted: false, DateTimeOffset.UnixEpoch);

        var first = BackupSettingsRenderer.Render(settings, "[offsite]\ntype = s3\nsecret_access_key = TOPSECRET\n");
        var second = BackupSettingsRenderer.Render(settings, "[offsite]\ntype = s3\nsecret_access_key = OTHER\n");

        Assert.Contains("\"schedule\": \"0 3 * * *\"", first, StringComparison.Ordinal);
        Assert.Contains("\"timezone\": \"Europe/Zurich\"", first, StringComparison.Ordinal);
        Assert.Contains("\"remote\": \"offsite:bucket\"", first, StringComparison.Ordinal);
        Assert.Contains("\"ageRecipients\": [", first, StringComparison.Ordinal);
        Assert.Contains("rcloneConfigSha256", first, StringComparison.Ordinal);
        Assert.DoesNotContain("TOPSECRET", first, StringComparison.Ordinal);
        Assert.NotEqual(BackupSettingsRenderer.Hash(first), BackupSettingsRenderer.Hash(second));
    }
}
