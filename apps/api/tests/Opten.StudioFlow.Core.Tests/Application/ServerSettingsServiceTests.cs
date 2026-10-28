using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>The wizard steps after the account and the "Server settings" page (issue #27), with in-memory fakes of Caddy, LiveKit and the backup service.</summary>
public sealed class ServerSettingsServiceTests
{
    private const string CloudflareToken = "build-validation-dummy-token-0123456789abcdef";

    private static async Task<StudioFlowException> Refused(Func<Task> action) => await Assert.ThrowsAsync<StudioFlowException>(action);

    private static string Codes(StudioFlowException exception, string field) => string.Join(',', exception.Errors![field]);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public void Get_BeforeAnythingIsSaved_IsUnconfiguredWithTheDefaults()
    {
        var settings = new SettingsHarness().Service.Get();

        Assert.False(settings.Configured);
        Assert.Equal(8443, settings.HttpsPort);
        Assert.Equal("https://localhost:8443", settings.BaseUrl);
        Assert.Null(settings.Media.Address);
        Assert.Equal(TlsModes.Internal, settings.Address.TlsMode);
        Assert.Empty(settings.Embedding.Origins);
        Assert.Null(settings.Backup.Schedule);
        Assert.Equal((7, 4), (settings.Backup.KeepDaily, settings.Backup.KeepWeekly));
        Assert.Equal(TlsModes.DnsProviders.Count, settings.DnsProviders.Count);
        Assert.Contains(settings.DnsProviders, p => p.Id == "dns-route53" && p.Fields.SequenceEqual(["accessKeyId", "secretAccessKey", "region"]));
    }

    [Fact]
    public async Task UpdateMedia_SavesTheAddress_ConfiguresTheInstallation_AndTellsLiveKit()
    {
        var h = new SettingsHarness();

        var settings = await h.Service.UpdateMediaAsync(new UpdateMediaRequest(" 192.168.1.50 "), Ct);

        Assert.True(settings.Configured);
        Assert.Equal("192.168.1.50", settings.Media.Address);
        Assert.Equal("https://192.168.1.50:8443", settings.BaseUrl);
        Assert.Contains("node_ip: 192.168.1.50", h.LiveKit.Written, StringComparison.Ordinal);
        var entry = Assert.Single(h.Store.Audit);
        Assert.Equal((AuditActors.Admin, AuditActions.SettingsMediaChanged), (entry.Actor, entry.Action));
        Assert.Equal("192.168.1.50", entry.Detail(AuditDetails.Address));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not an address")]
    [InlineData("192.168.1.300")]
    [InlineData("::1")]
    public async Task UpdateMedia_NotAnIpv4_IsRefusedAndNothingChanges(string address)
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateMediaAsync(new UpdateMediaRequest(address), Ct));

        Assert.Equal(SettingsFieldErrors.MediaAddressInvalid, Codes(refused, "address"));
        Assert.Equal(0, h.Store.Saves);
        Assert.False(h.Service.Get().Configured);
    }

    [Fact]
    public async Task UpdateMedia_WhileABroadcastIsLive_IsRefusedBecauseLiveKitWouldRestart()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        var production = Build.Production();
        production.StartBroadcast(h.Clock.Now);
        h.Data.Productions.Add(production);
        var writes = h.LiveKit.Writes;

        var refused = await Refused(() => h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.51"), Ct));

        Assert.Equal((ErrorKind.Conflict, ErrorCodes.BroadcastLive), (refused.Kind, refused.Code));
        Assert.Equal("192.168.1.50", h.Service.Get().Media.Address);
        Assert.Equal(writes, h.LiveKit.Writes);
    }

    [Fact]
    public async Task UpdateMedia_TheSameAddressWhileLive_IsNotAChange()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        var production = Build.Production();
        production.StartBroadcast(h.Clock.Now);
        h.Data.Productions.Add(production);

        var settings = await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);

        Assert.Equal("192.168.1.50", settings.Media.Address);
    }

    [Fact]
    public async Task UpdateAddress_InternalWithADomain_MakesTheDomainTheAddressOfEveryLink()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);

        var settings = await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, "Studio.Example.CH", null, null, null), Ct);

        Assert.Equal("studio.example.ch", settings.Address.Domain);
        Assert.Equal("https://studio.example.ch:8443", settings.BaseUrl);
        Assert.Contains("https://studio.example.ch:8443 {", h.Caddy.Loaded, StringComparison.Ordinal);
        var entry = h.Store.Audit.Last();
        Assert.Equal((AuditActions.SettingsAddressChanged, TlsModes.Internal, "studio.example.ch"), (entry.Action, entry.Detail(AuditDetails.Mode), entry.Detail(AuditDetails.Domain)));
    }

    [Fact]
    public async Task UpdateAddress_InternalWithoutADomain_UsesTheMediaAddressAsHost()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);

        var settings = await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, null, null, null, null), Ct);

        Assert.Null(settings.Address.Domain);
        Assert.Equal("https://192.168.1.50:8443", settings.BaseUrl);
    }

    [Theory]
    [InlineData("acme")]
    [InlineData("dns-unknown")]
    [InlineData("")]
    [InlineData(null)]
    public async Task UpdateAddress_AModeThisVersionDoesNotKnow_IsRefused_AcmeNeedsPort80(string? mode)
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateAddressAsync(new UpdateAddressRequest(mode!, "studio.example.ch", null, null, null), Ct));

        Assert.Equal(SettingsFieldErrors.TlsModeUnknown, Codes(refused, "tlsMode"));
    }

    [Fact]
    public async Task UpdateAddress_AnInvalidDomain_IsRefused()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, "not a domain", null, null, null), Ct));

        Assert.Equal(SettingsFieldErrors.DomainInvalid, Codes(refused, "domain"));
        Assert.Equal(0, h.Store.Saves);
    }

    [Fact]
    public async Task UpdateAddress_DnsModeNeedsADomainWithADotAndEveryCredential()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateAddressAsync(new UpdateAddressRequest("dns-route53", "localhost", "no-mail", null, new Dictionary<string, string> { ["accessKeyId"] = "AKIAIOSFODNN7EXAMPLE" }), Ct));

        Assert.Equal(SettingsFieldErrors.DomainInvalid, Codes(refused, "domain"));
        Assert.Equal(SettingsFieldErrors.EmailInvalid, Codes(refused, "acmeEmail"));
        Assert.Equal(SettingsFieldErrors.CredentialRequired, Codes(refused, "dnsCredentials.secretAccessKey"));
        Assert.Equal(SettingsFieldErrors.CredentialRequired, Codes(refused, "dnsCredentials.region"));
    }

    [Fact]
    public async Task UpdateAddress_DnsModeWithoutADomain_RequiresIt()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateAddressAsync(new UpdateAddressRequest("dns-cloudflare", null, null, null, new Dictionary<string, string> { ["token"] = CloudflareToken }), Ct));

        Assert.Equal(SettingsFieldErrors.DomainRequired, Codes(refused, "domain"));
    }

    [Fact]
    public async Task UpdateAddress_DnsMode_StoresTheCredentialsProtected_AndNeverReturnsThem()
    {
        var h = new SettingsHarness();

        var settings = await h.Service.UpdateAddressAsync(new UpdateAddressRequest("dns-cloudflare", "studio.example.ch", "admin@example.ch", null, new Dictionary<string, string> { ["token"] = CloudflareToken }), Ct);

        var row = h.State.Row!;
        Assert.StartsWith("protected:", row.DnsCredentialsProtected, StringComparison.Ordinal);
        Assert.DoesNotContain(CloudflareToken, row.DnsCredentialsProtected, StringComparison.Ordinal);
        Assert.Equal(["token"], settings.Address.CredentialFields);
        Assert.DoesNotContain(CloudflareToken, System.Text.Json.JsonSerializer.Serialize(settings, ContractJson.Options), StringComparison.Ordinal);
        Assert.DoesNotContain(CloudflareToken, string.Join('\n', h.Store.Audit.SelectMany(a => a.Details.Values)), StringComparison.Ordinal);
        Assert.Contains($"import /etc/caddy/tls/dns-cloudflare.caddy \"{CloudflareToken}\"", h.Caddy.Loaded, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UpdateAddress_DnsModeAgainWithoutCredentials_KeepsTheStoredOnes()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateAddressAsync(new UpdateAddressRequest("dns-cloudflare", "studio.example.ch", null, null, new Dictionary<string, string> { ["token"] = CloudflareToken }), Ct);

        var settings = await h.Service.UpdateAddressAsync(new UpdateAddressRequest("dns-cloudflare", "other.example.ch", null, null, null), Ct);

        Assert.Equal("other.example.ch", settings.Address.Domain);
        Assert.Equal(["token"], settings.Address.CredentialFields);
        Assert.Contains($"\"{CloudflareToken}\"", h.Caddy.Loaded, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UpdateAddress_AnotherProviderNeedsItsOwnCredentials_AndTheOldOnesAreDropped()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateAddressAsync(new UpdateAddressRequest("dns-cloudflare", "studio.example.ch", null, null, new Dictionary<string, string> { ["token"] = CloudflareToken }), Ct);

        var refused = await Refused(() => h.Service.UpdateAddressAsync(new UpdateAddressRequest("dns-desec", "studio.example.ch", null, null, null), Ct));
        var internalMode = await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, "studio.example.ch", null, null, null), Ct);

        Assert.Equal(SettingsFieldErrors.CredentialRequired, Codes(refused, "dnsCredentials.token"));
        Assert.Empty(internalMode.Address.CredentialFields);
        Assert.Null(h.State.Row!.DnsCredentialsProtected);
    }

    [Fact]
    public async Task UpdateAddress_CustomWithoutACertificate_IsRefused()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Custom, "studio.example.ch", null, null, null), Ct));

        Assert.Equal(SettingsFieldErrors.CertificateRequired, Codes(refused, "tlsMode"));
    }

    private static (string Certificate, string Key) Certificate(string name, TimeSpan validFor)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={name}", key, HashAlgorithmName.SHA256);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName(name);
        request.CertificateExtensions.Add(san.Build());
        var now = DateTimeOffset.UtcNow;
        using var certificate = request.CreateSelfSigned(now.AddDays(-1), now + validFor);
        return (certificate.ExportCertificatePem(), key.ExportPkcs8PrivateKeyPem());
    }

    /// <summary>A harness whose clock is the real one, because the certificates of these tests are valid from today.</summary>
    private static async Task<SettingsHarness> HarnessWithDomainAsync()
    {
        var h = new SettingsHarness();
        h.Clock.Advance(DateTimeOffset.UtcNow - h.Clock.Now);
        await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, "studio.example.ch", null, null, null), Ct);
        return h;
    }

    [Fact]
    public async Task Certificate_UploadedForTheDomain_IsStoredWithAProtectedKey_AndUsedByCaddy()
    {
        var (certificate, key) = Certificate("studio.example.ch", TimeSpan.FromDays(60));
        var h = await HarnessWithDomainAsync();

        var settings = await h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key), Ct);

        Assert.StartsWith("protected:", h.State.Row!.PrivateKeyProtected, StringComparison.Ordinal);
        Assert.DoesNotContain("PRIVATE KEY", h.State.Row.PrivateKeyProtected, StringComparison.Ordinal);
        Assert.Equal(["studio.example.ch"], settings.Address.Certificate!.Names);
        Assert.DoesNotContain("PRIVATE KEY", System.Text.Json.JsonSerializer.Serialize(settings, ContractJson.Options), StringComparison.Ordinal);

        var custom = await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Custom, "studio.example.ch", null, null, null), Ct);

        Assert.Equal(TlsModes.Custom, custom.Address.TlsMode);
        Assert.Contains("tls /certs/cert-", h.Caddy.Loaded, StringComparison.Ordinal);
        Assert.Contains("PRIVATE KEY", h.Certificates.Key, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Certificate_ForAnotherDomain_IsRefused()
    {
        var (certificate, key) = Certificate("other.example.ch", TimeSpan.FromDays(60));
        var h = await HarnessWithDomainAsync();

        var refused = await Refused(() => h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key), Ct));

        Assert.Equal(SettingsFieldErrors.CertificateNameMismatch, Codes(refused, "certificatePem"));
        Assert.Null(h.State.Row!.CertificatePem);
    }

    [Fact]
    public async Task Certificate_UploadedForTheDomainThatIsAboutToBeSaved_IsCheckedAgainstThatDomain()
    {
        var (certificate, key) = Certificate("new.example.ch", TimeSpan.FromDays(60));
        var h = await HarnessWithDomainAsync();

        var refused = await Refused(() => h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key, "other.example.ch"), Ct));
        Assert.Equal(SettingsFieldErrors.CertificateNameMismatch, Codes(refused, "certificatePem"));

        await h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key, "new.example.ch"), Ct);
        var custom = await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Custom, "new.example.ch", null, null, null), Ct);

        Assert.Equal("new.example.ch", custom.Address.Domain);
        Assert.Equal(TlsModes.Custom, custom.Address.TlsMode);
    }

    [Fact]
    public async Task Certificate_UploadedWithAnInvalidDomain_IsRefused()
    {
        var (certificate, key) = Certificate("studio.example.ch", TimeSpan.FromDays(60));
        var h = await HarnessWithDomainAsync();

        var refused = await Refused(() => h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key, "not a host"), Ct));

        Assert.Equal(SettingsFieldErrors.DomainInvalid, Codes(refused, "domain"));
    }

    [Fact]
    public async Task Certificate_ThatDoesNotCoverALaterChangeOfTheDomain_BlocksTheCustomMode()
    {
        var (certificate, key) = Certificate("studio.example.ch", TimeSpan.FromDays(60));
        var h = await HarnessWithDomainAsync();
        await h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key), Ct);

        var refused = await Refused(() => h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Custom, "elsewhere.example.ch", null, null, null), Ct));

        Assert.Equal(SettingsFieldErrors.CertificateNameMismatch, Codes(refused, "domain"));
    }

    [Fact]
    public async Task Certificate_SwitchingBackToTheLocalCa_DropsTheStoredKey()
    {
        var (certificate, key) = Certificate("studio.example.ch", TimeSpan.FromDays(60));
        var h = await HarnessWithDomainAsync();
        await h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key), Ct);
        await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Custom, "studio.example.ch", null, null, null), Ct);

        var settings = await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, "studio.example.ch", null, null, null), Ct);

        Assert.Null(settings.Address.Certificate);
        Assert.Null(h.State.Row!.PrivateKeyProtected);
        Assert.Null(h.Certificates.Key);
    }

    [Fact]
    public async Task Embedding_SavesTheOrigins_AndTheOutputMayBeFramedByThem()
    {
        var h = new SettingsHarness();

        var settings = await h.Service.UpdateEmbeddingAsync(new UpdateEmbeddingRequest(["https://Proxy.example.ch/", "https://*.example.com"]), Ct);

        Assert.Equal(["https://proxy.example.ch", "https://*.example.com"], settings.Embedding.Origins);
        Assert.Equal(["'self'", "https://proxy.example.ch", "https://*.example.com"], h.State.FrameAncestorSources);
        Assert.Contains("\"'self' https://proxy.example.ch https://*.example.com\"", h.Caddy.Loaded, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Embedding_WithoutTheList_IsRefused_AndKeepsTheSavedOrigins()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateEmbeddingAsync(new UpdateEmbeddingRequest(["https://proxy.example.ch"]), Ct);
        var saves = h.Store.Saves;

        var refused = await Refused(() => h.Service.UpdateEmbeddingAsync(new UpdateEmbeddingRequest(null!), Ct));

        Assert.Equal(SettingsFieldErrors.OriginsRequired, Codes(refused, "origins"));
        Assert.Equal(saves, h.Store.Saves);
        Assert.Equal(["'self'", "https://proxy.example.ch"], h.State.FrameAncestorSources);
    }

    [Fact]
    public async Task Embedding_AnEmptyList_ClearsTheOrigins()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateEmbeddingAsync(new UpdateEmbeddingRequest(["https://proxy.example.ch"]), Ct);

        var settings = await h.Service.UpdateEmbeddingAsync(new UpdateEmbeddingRequest([]), Ct);

        Assert.Empty(settings.Embedding.Origins);
    }

    [Fact]
    public async Task Embedding_AnInvalidOrigin_IsRefusedWithItsIndex()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateEmbeddingAsync(new UpdateEmbeddingRequest(["https://ok.example.ch", "*"]), Ct));

        Assert.Equal(SettingsFieldErrors.OriginInvalid, Codes(refused, "origins[1]"));
        Assert.Equal(0, h.Store.Saves);
    }

    [Fact]
    public async Task Backup_ScheduleAndRetention_AreSavedAndPassedToTheService()
    {
        var h = new SettingsHarness();

        var settings = await h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 3 * * *", "Europe/Zurich", 10, 6, null, null, null, false), Ct);

        Assert.Equal(("0 3 * * *", "Europe/Zurich", 10, 6), (settings.Backup.Schedule, settings.Backup.Timezone, settings.Backup.KeepDaily, settings.Backup.KeepWeekly));
        Assert.Contains("\"schedule\": \"0 3 * * *\"", h.Backup.SettingsJson, StringComparison.Ordinal);
        Assert.Equal("0 3 * * *", h.State.BackupSchedule);
    }

    [Fact]
    public async Task Backup_InvalidValues_AreRefusedTogether()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateBackupAsync(new UpdateBackupRequest("every night", "Mars Base", 0, 200, "nocolon", null, ["nope"], false), Ct));

        Assert.Equal(SettingsFieldErrors.ScheduleInvalid, Codes(refused, "schedule"));
        Assert.Equal(SettingsFieldErrors.TimezoneInvalid, Codes(refused, "timezone"));
        Assert.Equal(SettingsFieldErrors.KeepInvalid, Codes(refused, "keepDaily"));
        Assert.Equal(SettingsFieldErrors.KeepInvalid, Codes(refused, "keepWeekly"));
        Assert.Equal(SettingsFieldErrors.RemoteInvalid, Codes(refused, "rcloneRemote"));
        Assert.Equal(SettingsFieldErrors.AgeRecipientInvalid, Codes(refused, "ageRecipients[0]"));
    }

    private const string AgeKey = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
    private const string RcloneConf = "[offsite]\ntype = s3\nprovider = Other\naccess_key_id = AKIA\nsecret_access_key = TOPSECRETVALUE\n";

    [Fact]
    public async Task Backup_Offsite_NeedsAnAgeKeyOrTheStatementThatTheRemoteEncrypts()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 3 * * *", null, 7, 4, "offsite:bucket", RcloneConf, null, false), Ct));
        var ok = await h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 3 * * *", null, 7, 4, "offsite:bucket", RcloneConf, null, true), Ct);

        Assert.Equal(SettingsFieldErrors.AgeRecipientRequired, Codes(refused, "ageRecipients"));
        Assert.True(ok.Backup.OffsiteUnencrypted);
    }

    [Fact]
    public async Task Backup_ARemoteThatTheConfigurationDoesNotDefine_IsRefused()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.UpdateBackupAsync(new UpdateBackupRequest(null, null, 7, 4, "other:bucket", RcloneConf, [AgeKey], false), Ct));

        Assert.Equal(SettingsFieldErrors.RemoteNotInConfig, Codes(refused, "rcloneRemote"));
    }

    [Fact]
    public async Task Backup_RcloneConfig_IsStoredProtected_NeverReturned_AndHandedOnlyToTheService()
    {
        var h = new SettingsHarness();

        var settings = await h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 3 * * *", null, 7, 4, "offsite:bucket", RcloneConf, [AgeKey], false), Ct);

        Assert.True(settings.Backup.RcloneConfigured);
        Assert.StartsWith("protected:", h.State.Row!.RcloneConfigProtected, StringComparison.Ordinal);
        Assert.DoesNotContain("TOPSECRETVALUE", System.Text.Json.JsonSerializer.Serialize(settings, ContractJson.Options), StringComparison.Ordinal);
        Assert.DoesNotContain("TOPSECRETVALUE", h.Backup.SettingsJson, StringComparison.Ordinal);
        Assert.Equal(RcloneConf, h.Backup.RcloneConfig);
    }

    [Fact]
    public async Task Backup_UpdateWithoutAConfig_KeepsTheStoredOne_AndRemovingTheRemoteDropsIt()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 3 * * *", null, 7, 4, "offsite:bucket", RcloneConf, [AgeKey], false), Ct);

        var kept = await h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 4 * * *", null, 7, 4, "offsite:bucket", null, [AgeKey], false), Ct);
        Assert.True(kept.Backup.RcloneConfigured);
        Assert.Equal(RcloneConf, h.Backup.RcloneConfig);

        var removed = await h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 4 * * *", null, 7, 4, null, null, null, false), Ct);
        Assert.False(removed.Backup.RcloneConfigured);
        Assert.Null(h.Backup.RcloneConfig);
    }

    [Fact]
    public void Suggest_UsesTheHostTheAdminOpenedAndTheInterfaces()
    {
        var withIp = ServerSettingsService.Suggest("192.168.1.50", ["10.0.0.5", "10.0.0.5", "not an ip", "0.0.0.0"]);
        var withName = ServerSettingsService.Suggest("studio.example.ch", []);
        var withLocalhost = ServerSettingsService.Suggest("localhost", ["192.168.1.7"]);

        Assert.Equal("192.168.1.50", withIp.FromHost);
        Assert.Equal(["10.0.0.5"], withIp.Interfaces);
        Assert.Null(withName.FromHost);
        Assert.Null(withLocalhost.FromHost);
        Assert.Equal(["192.168.1.7"], withLocalhost.Interfaces);
    }

    [Fact]
    public async Task MediaTest_AnnouncesTheAddressForTwoMinutes_AndGivesTwoTokensOfTheSameRoom()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);

        var test = await h.Service.StartMediaTestAsync(new MediaTestRequest("192.168.1.99"), Ct);

        Assert.Contains("node_ip: 192.168.1.99", h.LiveKit.Written, StringComparison.Ordinal);
        Assert.Equal("192.168.1.50", h.State.Row!.MediaAddress);
        Assert.StartsWith("mediatest-", test.Room, StringComparison.Ordinal);
        Assert.Matches("^mediatest-[a-z0-9]{12}$", test.Room);
        Assert.Equal(test.Room, test.First.Room);
        Assert.Equal(test.Room, test.Second.Room);
        Assert.NotEqual(test.First.Identity, test.Second.Identity);
        Assert.Equal(h.Clock.Now + ServerConfigApplier.TrialDuration, test.ExpiresAt);
    }

    [Fact]
    public async Task MediaTest_TheTrialEndsByItself_AndLiveKitGoesBackToTheSavedAddress()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        await h.Service.StartMediaTestAsync(new MediaTestRequest("192.168.1.99"), Ct);

        h.Clock.Advance(ServerConfigApplier.TrialDuration + TimeSpan.FromSeconds(1));
        await h.Applier.ApplyAsync(Ct);

        Assert.Contains("node_ip: 192.168.1.50", h.LiveKit.Written, StringComparison.Ordinal);
        Assert.Null(h.Applier.TrialAddress);
    }

    [Fact]
    public async Task MediaTest_EndedByTheAdmin_GoesBackToTheSavedAddressAtOnce()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        await h.Service.StartMediaTestAsync(new MediaTestRequest("192.168.1.99"), Ct);

        await h.Service.EndMediaTestAsync(Ct);

        Assert.Contains("node_ip: 192.168.1.50", h.LiveKit.Written, StringComparison.Ordinal);
    }

    [Fact]
    public async Task MediaTest_ThenSavingTheTestedAddress_NeedsNoSecondRestart()
    {
        var h = new SettingsHarness();
        await h.Service.StartMediaTestAsync(new MediaTestRequest("192.168.1.99"), Ct);
        var writes = h.LiveKit.Writes;

        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.99"), Ct);

        Assert.Equal(writes, h.LiveKit.Writes);
        Assert.Contains("node_ip: 192.168.1.99", h.LiveKit.Written, StringComparison.Ordinal);
        Assert.Null(h.Applier.TrialAddress);
    }

    [Fact]
    public async Task MediaTest_WhileABroadcastIsLive_IsRefused()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        var production = Build.Production();
        production.StartBroadcast(h.Clock.Now);
        h.Data.Productions.Add(production);

        var refused = await Refused(() => h.Service.StartMediaTestAsync(new MediaTestRequest("192.168.1.99"), Ct));

        Assert.Equal(ErrorCodes.BroadcastLive, refused.Code);
        Assert.Contains("node_ip: 192.168.1.50", h.LiveKit.Written, StringComparison.Ordinal);
    }

    [Fact]
    public async Task MediaTest_InvalidAddress_IsRefusedBeforeLiveKitIsTouched()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.StartMediaTestAsync(new MediaTestRequest("studio.example.ch"), Ct));

        Assert.Equal(SettingsFieldErrors.MediaAddressInvalid, Codes(refused, "address"));
        Assert.Equal(0, h.LiveKit.Writes);
    }

    [Fact]
    public async Task MediaTest_LiveKitThatDoesNotComeBack_EndsTheTrialAndSaysSo()
    {
        var h = new SettingsHarness();
        h.LiveKit.AutoApply = false;
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        h.LiveKit.Supervise();
        h.LiveKit.AutoApply = false;

        // The clock moves with every wait, so the 30 seconds pass at once.
        var test = Task.Run(() => h.Service.StartMediaTestAsync(new MediaTestRequest("192.168.1.99"), Ct), Ct);
        while (!test.IsCompleted)
        {
            h.Clock.Advance(TimeSpan.FromSeconds(5));
            await Task.Delay(10, Ct);
        }

        var refused = await Refused(() => test);

        Assert.Equal(ErrorCodes.ServiceUnavailable, refused.Code);
        Assert.Null(h.Applier.TrialAddress);
    }

    [Fact]
    public async Task Apply_CaddyThatRestarted_GetsTheConfigurationAgain()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        Assert.Equal(1, h.Caddy.Loads);

        await h.Applier.ApplyAsync(Ct);
        Assert.Equal(1, h.Caddy.Loads);

        h.Caddy.Restart();
        await h.Applier.ApplyAsync(Ct);

        Assert.Equal(2, h.Caddy.Loads);
        Assert.True(h.Applier.Status.Caddy.Applied);
    }

    [Fact]
    public async Task Apply_CaddyThatRefuses_IsReported_AndRetriedAfterAWhile()
    {
        var h = new SettingsHarness();
        h.Caddy.Refuse = "adapting config: unrecognized directive";

        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);

        Assert.False(h.Applier.Status.Caddy.Applied);
        Assert.Contains("unrecognized directive", h.Applier.Status.Caddy.Error, StringComparison.Ordinal);
        Assert.Equal(0, h.Caddy.Loads);

        h.Caddy.Refuse = null;
        await h.Applier.ApplyAsync(Ct);
        Assert.False(h.Applier.Status.Caddy.Applied);
        h.Clock.Advance(TimeSpan.FromSeconds(11));
        await h.Applier.ApplyAsync(Ct);

        Assert.True(h.Applier.Status.Caddy.Applied);
        Assert.Equal(1, h.Caddy.Loads);
    }

    [Fact]
    public async Task Apply_CaddyThatIsDown_DoesNotFailTheSave()
    {
        var h = new SettingsHarness();
        h.Caddy.Down = true;

        var settings = await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);

        Assert.True(settings.Configured);
        Assert.False(h.Applier.Status.Caddy.Applied);
        Assert.Contains("not reachable", h.Applier.Status.Caddy.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Apply_CustomCertificateWhoseKeyCannotBeDecrypted_LeavesOutTheDomainSiteAndReportsIt()
    {
        var (certificate, key) = Certificate("studio.example.ch", TimeSpan.FromDays(60));
        var h = await HarnessWithDomainAsync();
        await h.Service.UploadCertificateAsync(new UploadCertificateRequest(certificate, key), Ct);
        await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Custom, "studio.example.ch", null, null, null), Ct);
        Assert.Contains("https://studio.example.ch:8443", h.Caddy.Loaded, StringComparison.Ordinal);

        // The Data Protection keys are gone: nothing protected can be read any more.
        h.Protector.Broken = true;
        await h.Applier.ApplyAsync(Ct);

        Assert.DoesNotContain("studio.example.ch", h.Caddy.Loaded, StringComparison.Ordinal);
        Assert.Contains("\n:8443 {", h.Caddy.Loaded, StringComparison.Ordinal);
        Assert.True(h.Applier.Status.Caddy.Applied);
        Assert.Contains("Upload it again", h.Applier.Status.Caddy.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Apply_LiveKitThatRestarted_IsNotYetApplied_UntilItReports()
    {
        var h = new SettingsHarness();
        h.LiveKit.AutoApply = false;

        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        Assert.False(h.Applier.Status.LiveKit.Applied);

        h.LiveKit.Supervise();
        await h.Applier.ApplyAsync(Ct);

        Assert.True(h.Applier.Status.LiveKit.Applied);
    }

    [Fact]
    public async Task Apply_BackupServiceReportsTheSettingsItRuns()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateBackupAsync(new UpdateBackupRequest("0 3 * * *", null, 7, 4, null, null, null, false), Ct);
        Assert.False(h.Applier.Status.Backup.Applied);

        h.Backup.Status = new BackupServiceStatus(null, "idle", BackupSettingsRenderer.Hash(h.Backup.SettingsJson!), null, null, null, null);
        await h.Applier.ApplyAsync(Ct);

        Assert.True(h.Applier.Status.Backup.Applied);
    }

    [Fact]
    public async Task Apply_NothingIsPushedToServicesThatAreNotPartOfTheInstallation()
    {
        var h = new SettingsHarness();
        h.Caddy.IsConfigured = false;
        h.LiveKit.IsConfigured = false;
        h.Backup.IsConfigured = false;

        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);

        Assert.Null(h.Caddy.Loaded);
        Assert.Null(h.LiveKit.Written);
        Assert.Null(h.Backup.SettingsJson);
        Assert.True(h.Applier.Status.Caddy.Applied && h.Applier.Status.LiveKit.Applied && h.Applier.Status.Backup.Applied);
    }

    [Fact]
    public async Task Backups_ListTheLatestFirst_AndShowTheStateOfTheService()
    {
        var h = new SettingsHarness();
        Assert.False((await h.Service.GetBackupsAsync(Ct)).ServiceSeen);
        var at = h.Clock.Now;
        h.Backup.Status = new BackupServiceStatus(
            at,
            "postponed",
            null,
            new BackupAttemptStatus(at, false, "pg_dump failed."),
            null,
            null,
            [new BackupFolderStatus("2026-10-24_0300_auto", at.AddDays(-2), 100, "auto"), new BackupFolderStatus("2026-10-26_0900_manual", at, 300, "manual"), new BackupFolderStatus("2026-10-25_0300_auto", at.AddDays(-1), 200, "auto")]);

        var backups = await h.Service.GetBackupsAsync(Ct);

        Assert.True(backups.ServiceSeen);
        Assert.True(backups.Running);
        Assert.True(backups.Postponed);
        Assert.Equal("pg_dump failed.", backups.LastError);
        Assert.Equal(["2026-10-26_0900_manual", "2026-10-25_0300_auto", "2026-10-24_0300_auto"], backups.Backups.Select(b => b.Name));
        Assert.Equal(["manual", "auto", "auto"], backups.Backups.Select(b => b.Kind));
    }

    [Fact]
    public async Task RequestBackup_AsksTheService_AndIsAudited()
    {
        var h = new SettingsHarness();
        h.Backup.Status = new BackupServiceStatus(h.Clock.Now, "idle", null, null, null, null, []);

        await h.Service.RequestBackupAsync(Ct);

        Assert.Equal(1, h.Backup.Requests);
        Assert.Contains(h.Data.Audit, a => a.Action == AuditActions.BackupRequested && a.Actor == AuditActors.Admin);
    }

    [Fact]
    public async Task RequestBackup_ServiceThatHasNotReported_IsRefused()
    {
        var h = new SettingsHarness();

        var refused = await Refused(() => h.Service.RequestBackupAsync(Ct));

        Assert.Equal(ErrorCodes.ServiceUnavailable, refused.Code);
        Assert.Equal(0, h.Backup.Requests);
    }

    [Fact]
    public async Task State_FollowsAChangeMadeByAnotherProcess_ButNotOneThatIsOlder()
    {
        var h = new SettingsHarness();
        await h.Service.UpdateMediaAsync(new UpdateMediaRequest("192.168.1.50"), Ct);
        var other = new SettingsHarness();
        await other.Service.UpdateMediaAsync(new UpdateMediaRequest("10.0.0.7"), Ct);
        await other.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, "elsewhere.example.ch", null, null, null), Ct);

        Assert.False(await h.State.RefreshAsync(Ct));
        Assert.Equal("192.168.1.50", h.State.Row!.MediaAddress);
        Assert.Equal("https://192.168.1.50:8443", h.State.BaseUrl);
    }

    [Fact]
    public void StudioFlowOptions_FollowTheSettings_UnlessTheKeysOverrideThem()
    {
        var h = new SettingsHarness(new InstallOptions { HttpsPort = 9443 });
        var options = new StudioFlowOptions();
        options.UseSettings(h.State);

        Assert.Equal("https://localhost:9443", options.BaseUrl);
        Assert.Equal(["'self'"], options.FrameAncestorList);

        var overridden = new StudioFlowOptions { PublicBaseUrl = "https://sf.example/", FrameAncestors = "'self' https://x.example" };
        overridden.UseSettings(h.State);

        Assert.Equal("https://sf.example", overridden.BaseUrl);
        Assert.Equal(["'self'", "https://x.example"], overridden.FrameAncestorList);
    }

    [Fact]
    public async Task StudioFlowOptions_TheHttpsPortIsPartOfEveryAddress_UnlessItIs443()
    {
        foreach (var (port, expected) in new[] { (8443, "https://studio.example.ch:8443"), (9443, "https://studio.example.ch:9443"), (443, "https://studio.example.ch") })
        {
            var h = new SettingsHarness(new InstallOptions { HttpsPort = port });
            var options = new StudioFlowOptions();
            options.UseSettings(h.State);

            await h.Service.UpdateAddressAsync(new UpdateAddressRequest(TlsModes.Internal, "studio.example.ch", null, null, null), Ct);

            Assert.Equal(expected, options.BaseUrl);
        }
    }
}
