using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The server settings API (issue #27): wizard steps after the account and the "Server settings" page.</summary>
public sealed class ServerSettingsApiTests(PostgresFixture postgres)
{
    private const string CloudflareToken = "build-validation-dummy-token-0123456789abcdef";
    private const string RcloneConf = "[offsite]\ntype = s3\nprovider = Other\nsecret_access_key = TOPSECRETVALUE\n";
    private const string AgeKey = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static async Task<InstalledApp> StartAsync(PostgresFixture postgres, string? database = null)
    {
        var app = new InstalledApp(postgres, database);
        await app.InitializeAsync();
        return app;
    }

    private static async Task<JsonDocument> ErrorsOfAsync(Task<HttpResponseMessage> request)
    {
        using var response = await request;
        await response.ExpectAsync(HttpStatusCode.BadRequest);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct));
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        return json;
    }

    [Fact]
    public async Task EveryRoute_WithoutTheSession_IsUnauthorized_AndWithoutTheCsrfHeaderForbidden()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        var withoutCsrf = app.Anonymous();
        withoutCsrf.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        foreach (var (method, url, body) in new[]
        {
            (HttpMethod.Get, "/api/settings", null), (HttpMethod.Get, "/api/settings/status", null), (HttpMethod.Put, "/api/settings/media", """{"address":"192.168.1.50"}"""),
            (HttpMethod.Get, "/api/settings/media/suggestions", null), (HttpMethod.Post, "/api/settings/media/test", """{"address":"192.168.1.50"}"""), (HttpMethod.Delete, "/api/settings/media/test", null),
            (HttpMethod.Put, "/api/settings/address", """{"tlsMode":"internal"}"""), (HttpMethod.Put, "/api/settings/certificate", """{"certificatePem":"x","privateKeyPem":"y"}"""),
            (HttpMethod.Put, "/api/settings/embedding", """{"origins":[]}"""), (HttpMethod.Put, "/api/settings/backup", """{"keepDaily":7,"keepWeekly":4,"offsiteUnencrypted":false}"""),
            (HttpMethod.Get, "/api/settings/backups", null), (HttpMethod.Post, "/api/settings/backups", null),
        })
        {
            HttpRequestMessage Request() => new(method, url) { Content = body is null ? null : new StringContent(body, System.Text.Encoding.UTF8, "application/json") };

            using var anonymous = await app.Anonymous().SendAsync(Request(), Ct);
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

            // Reads need no CSRF header; the changes do.
            if (method != HttpMethod.Get)
            {
                using var noHeader = await withoutCsrf.SendAsync(Request(), Ct);
                Assert.True(noHeader.StatusCode == HttpStatusCode.Forbidden, $"{method} {url} without the CSRF header answered {(int)noHeader.StatusCode}");
            }
        }
    }

    [Fact]
    public async Task EveryRoute_BeforeTheAccountExists_IsUnauthorized()
    {
        await using var app = new FirstRunApp(postgres);
        await app.InitializeAsync();

        using var read = await app.Anonymous().GetAsync("/api/settings", Ct);
        using var write = await app.Anonymous().PutAsJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50"), ContractJson.Options, Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, read.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, write.StatusCode);
    }

    [Fact]
    public async Task Get_OnAFreshInstallation_IsUnconfiguredWithTheDefaults()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        var settings = await admin.Client.GetAsync("/api/settings", Ct).ExpectAsync<ServerSettingsDto>();

        Assert.False(settings.Configured);
        Assert.Equal(8443, settings.HttpsPort);
        Assert.Equal("https://localhost:8443", settings.BaseUrl);
        Assert.Equal(TlsModes.Internal, settings.Address.TlsMode);
        Assert.Equal(TlsModes.DnsProviders.Count, settings.DnsProviders.Count);
    }

    [Fact]
    public async Task Media_Saved_ConfiguresTheInstallation_FillsEveryLink_AndWritesTheLiveKitConfiguration()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        var settings = await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();

        Assert.True(settings.Configured);
        Assert.Equal("https://192.168.1.50:8443", settings.BaseUrl);
        Assert.Equal("https://192.168.1.50:8443", (await admin.Client.GetAsync("/api/system/info", Ct).ExpectAsync<SystemInfoDto>()).PublicBaseUrl);
        var invite = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite", Ct).ExpectAsync<InviteDto>();
        Assert.StartsWith("https://192.168.1.50:8443/join/", invite.Url, StringComparison.Ordinal);
        var output = await admin.GetOutputLinksAsync();
        Assert.StartsWith("https://192.168.1.50:8443/o/", output[0].Url, StringComparison.Ordinal);
        var yaml = app.LiveKitYaml;
        Assert.Contains("node_ip: 192.168.1.50", yaml, StringComparison.Ordinal);
        Assert.Contains($"\"{StudioFlowApp.LiveKitKey}\": \"{StudioFlowApp.LiveKitSecret}\"", yaml, StringComparison.Ordinal);
        Assert.Contains("tcp_port: 7881", yaml, StringComparison.Ordinal);
        // LiveKit counts as applied once its supervisor (a background loop in the test) wrote applied.json, and a Caddy load can
        // be held back for a moment: poll like the Regie does instead of judging the first answer (issue #74).
        var status = await WaitForAppliedAsync(admin);
        Assert.True(status.LiveKit.Applied);
        Assert.True(status.Caddy.Applied);
    }

    private static async Task<ApplyStatusDto> WaitForAppliedAsync(AdminSession admin)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (true)
        {
            var status = await admin.Client.GetAsync("/api/settings/status", Ct).ExpectAsync<ApplyStatusDto>();
            if ((status.LiveKit.Applied && status.Caddy.Applied) || DateTime.UtcNow >= deadline)
            {
                return status;
            }

            await Task.Delay(100, Ct);
        }
    }

    [Fact]
    public async Task Media_Invalid_IsAValidationFailureWithTheReason()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        using var json = await ErrorsOfAsync(admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("studio.example.ch")));

        Assert.Equal(SettingsFieldErrors.MediaAddressInvalid, json.RootElement.GetProperty("errors").GetProperty("address")[0].GetString());
        Assert.False((await admin.Client.GetAsync("/api/settings", Ct).ExpectAsync<ServerSettingsDto>()).Configured);
    }

    [Fact]
    public async Task Media_ChangeWhileALiveBroadcast_IsRefusedAndTheSameAddressIsNot()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/start", null, Ct).ExpectAsync<ProductionDto>();

        var code = await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.51")).ExpectProblemAsync(HttpStatusCode.Conflict);
        var testCode = await admin.Client.PostJsonAsync("/api/settings/media/test", new MediaTestRequest("192.168.1.51")).ExpectProblemAsync(HttpStatusCode.Conflict);
        var same = await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();

        Assert.Equal(ErrorCodes.BroadcastLive, code);
        Assert.Equal(ErrorCodes.BroadcastLive, testCode);
        Assert.Equal("192.168.1.50", same.Media.Address);
        Assert.Contains("node_ip: 192.168.1.50", app.LiveKitYaml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task MediaSuggestions_ComeFromTheHostHeaderAndNotFromTheComposeNetwork()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/settings/media/suggestions");
        request.Headers.Host = "192.168.1.50:8443";

        using var response = await admin.Client.SendAsync(request, Ct);
        var suggestions = await response.Content.ReadFromJsonAsync<MediaSuggestionsDto>(ContractJson.Options, Ct);

        Assert.Equal("192.168.1.50", suggestions!.FromHost);
        Assert.DoesNotContain("127.0.0.1", suggestions.Interfaces);
    }

    [Fact]
    public async Task MediaTest_RestartsLiveKitWithTheTestedAddress_ThenRestoresTheSavedOne()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();

        var test = await admin.Client.PostJsonAsync("/api/settings/media/test", new MediaTestRequest("192.168.1.99")).ExpectAsync<MediaTestDto>();

        Assert.Contains("node_ip: 192.168.1.99", app.LiveKitYaml, StringComparison.Ordinal);
        Assert.Equal("192.168.1.50", (await admin.Client.GetAsync("/api/settings", Ct).ExpectAsync<ServerSettingsDto>()).Media.Address);
        var handler = new JsonWebTokenHandler();
        foreach (var token in new[] { test.First, test.Second })
        {
            var jwt = handler.ReadJsonWebToken(token.Token);
            var grant = JsonDocument.Parse(jwt.GetPayloadValue<object>("video").ToString()!).RootElement;
            Assert.Equal(test.Room, grant.GetProperty("room").GetString());
            Assert.True(grant.GetProperty("canPublishData").GetBoolean());
            Assert.False(grant.GetProperty("canPublish").GetBoolean());
            Assert.Equal(StudioFlowApp.LiveKitKey, jwt.Issuer);
        }

        await admin.Client.DeleteAsync("/api/settings/media/test", Ct).ExpectAsync(HttpStatusCode.NoContent);

        Assert.Contains("node_ip: 192.168.1.50", app.LiveKitYaml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Address_Internal_WithADomain_ChangesEveryLinkAndTheCaddyfile()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();

        var settings = await admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest(TlsModes.Internal, "Studio.Example.CH", null, null, null)).ExpectAsync<ServerSettingsDto>();

        Assert.Equal("https://studio.example.ch:8443", settings.BaseUrl);
        var invite = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite", Ct).ExpectAsync<InviteDto>();
        Assert.StartsWith("https://studio.example.ch:8443/join/", invite.Url, StringComparison.Ordinal);
        Assert.Contains("https://studio.example.ch:8443 {", app.Caddy.Loaded, StringComparison.Ordinal);
        Assert.Contains("https_port 8443", app.Caddy.Loaded, StringComparison.Ordinal);
        Assert.Contains("node_ip: 192.168.1.50", app.LiveKitYaml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Address_ValidationErrors_NameEveryField()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        using var json = await ErrorsOfAsync(admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest("dns-route53", "localhost", "no-mail", "x", new Dictionary<string, string> { ["accessKeyId"] = "AKIAIOSFODNN7EXAMPLE", ["extra"] = "y" })));

        var errors = json.RootElement.GetProperty("errors");
        Assert.Equal(SettingsFieldErrors.DomainInvalid, errors.GetProperty("domain")[0].GetString());
        Assert.Equal(SettingsFieldErrors.EmailInvalid, errors.GetProperty("acmeEmail")[0].GetString());
        Assert.Equal(SettingsFieldErrors.DomainInvalid, errors.GetProperty("dnsChallengeDomain")[0].GetString());
        Assert.Equal(SettingsFieldErrors.CredentialRequired, errors.GetProperty("dnsCredentials.secretAccessKey")[0].GetString());
        Assert.Equal(SettingsFieldErrors.CredentialUnknown, errors.GetProperty("dnsCredentials.extra")[0].GetString());
    }

    [Fact]
    public async Task Address_AcmeOverHttp_IsNotOffered()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        using var json = await ErrorsOfAsync(admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest("acme", "studio.example.ch", null, null, null)));

        Assert.Equal(SettingsFieldErrors.TlsModeUnknown, json.RootElement.GetProperty("errors").GetProperty("tlsMode")[0].GetString());
    }

    [Fact]
    public async Task DnsCredentials_AreEncryptedInTheDatabase_AndInNoAnswerAndNoLog()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        var answers = new List<string>
        {
            await (await admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest("dns-cloudflare", "studio.example.ch", "admin@example.ch", null, new Dictionary<string, string> { ["token"] = CloudflareToken }))).Content.ReadAsStringAsync(Ct),
            await admin.Client.GetStringAsync("/api/settings", Ct),
            await admin.Client.GetStringAsync("/api/settings/status", Ct),
            await admin.Client.GetStringAsync("/api/audit?limit=200", Ct),
            await admin.Client.GetStringAsync("/api/audit/export.json", Ct),
            await admin.Client.GetStringAsync($"/api/productions/{admin.ProductionId}/snapshot", Ct),
        };

        // Caddy gets the token (it needs it); the database holds it only encrypted.
        Assert.Contains($"\"{CloudflareToken}\"", app.Caddy.Loaded, StringComparison.Ordinal);
        var stored = await app.Service<IServerSettingsStore>().GetAsync(Ct);
        Assert.DoesNotContain(CloudflareToken, stored!.DnsCredentialsProtected, StringComparison.Ordinal);
        Assert.NotEmpty(stored.DnsCredentialsProtected!);
        Assert.All(answers, answer => Assert.DoesNotContain(CloudflareToken, answer, StringComparison.Ordinal));
        Assert.DoesNotContain(app.Logs.Entries, e => e.Message.Contains(CloudflareToken, StringComparison.Ordinal) || (e.Exception?.ToString().Contains(CloudflareToken, StringComparison.Ordinal) ?? false));
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(Ct);
        var raw = await db.Database.SqlQueryRaw<string>("SELECT dns_credentials_protected AS \"Value\" FROM server_settings").SingleAsync(Ct);
        Assert.DoesNotContain(CloudflareToken, raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Certificate_Upload_IsCheckedAndTheKeyNeverComesBack()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest(TlsModes.Internal, "studio.example.ch", null, null, null)).ExpectAsync<ServerSettingsDto>();
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=studio.example.ch", key, HashAlgorithmName.SHA256);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("studio.example.ch");
        request.CertificateExtensions.Add(san.Build());
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(60));
        var keyPem = key.ExportPkcs8PrivateKeyPem();

        using var refused = await ErrorsOfAsync(admin.Client.PutJsonAsync("/api/settings/certificate", new UploadCertificateRequest("nonsense", keyPem)));
        var answer = await (await admin.Client.PutJsonAsync("/api/settings/certificate", new UploadCertificateRequest(certificate.ExportCertificatePem(), keyPem))).Content.ReadAsStringAsync(Ct);
        var custom = await admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest(TlsModes.Custom, "studio.example.ch", null, null, null)).ExpectAsync<ServerSettingsDto>();

        Assert.Equal(SettingsFieldErrors.CertificateInvalid, refused.RootElement.GetProperty("errors").GetProperty("certificatePem")[0].GetString());
        Assert.DoesNotContain("PRIVATE KEY", answer, StringComparison.Ordinal);
        Assert.Equal(["studio.example.ch"], custom.Address.Certificate!.Names);
        var files = Directory.GetFiles(app.CertsFolder).Select(Path.GetFileName).Order().ToList();
        Assert.Equal(2, files.Count);
        Assert.Matches("^cert-[0-9a-f]{16}\\.pem$", files[0]);
        Assert.Matches("^key-[0-9a-f]{16}\\.pem$", files[1]);
        Assert.Contains($"tls /certs/{files[0]} /certs/{files[1]}", app.Caddy.Loaded, StringComparison.Ordinal);
        Assert.Contains("BEGIN PRIVATE KEY", File.ReadAllText(Path.Combine(app.CertsFolder, files[1]!)), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Embedding_FollowsTheSettings_InTheOutputPopoverAndInCaddy()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        var settings = await admin.Client.PutJsonAsync("/api/settings/embedding", new UpdateEmbeddingRequest(["https://proxy.example.ch", "https://*.example.com"])).ExpectAsync<ServerSettingsDto>();

        Assert.Equal(["https://proxy.example.ch", "https://*.example.com"], settings.Embedding.Origins);
        var output = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", Ct).ExpectAsync<OutputSettingsDto>();
        Assert.Equal(["'self'", "https://proxy.example.ch", "https://*.example.com"], output.FrameAncestors);
        Assert.Contains("\"'self' https://proxy.example.ch https://*.example.com\"", app.Caddy.Loaded, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Embedding_ABodyWithoutOrigins_IsRefused_AndKeepsTheSavedOnes()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/embedding", new UpdateEmbeddingRequest(["https://proxy.example.ch"])).ExpectAsync<ServerSettingsDto>();

        using var json = await ErrorsOfAsync(admin.Client.PutAsync("/api/settings/embedding", new StringContent("{}", System.Text.Encoding.UTF8, "application/json"), Ct));

        Assert.Equal(SettingsFieldErrors.OriginsRequired, json.RootElement.GetProperty("errors").GetProperty("origins")[0].GetString());
        var output = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", Ct).ExpectAsync<OutputSettingsDto>();
        Assert.Equal(["'self'", "https://proxy.example.ch"], output.FrameAncestors);
    }

    [Fact]
    public async Task Embedding_AnInvalidOrigin_IsRefused()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        using var json = await ErrorsOfAsync(admin.Client.PutJsonAsync("/api/settings/embedding", new UpdateEmbeddingRequest(["https://ok.example.ch", "*"])));

        Assert.Equal(SettingsFieldErrors.OriginInvalid, json.RootElement.GetProperty("errors").GetProperty("origins[1]")[0].GetString());
    }

    [Fact]
    public async Task Backup_Settings_GoToTheServiceAsFiles_AndTheRcloneConfigStaysSecret()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        var answer = await (await admin.Client.PutJsonAsync("/api/settings/backup", new UpdateBackupRequest("0 3 * * *", "Europe/Zurich", 7, 4, "offsite:bucket", RcloneConf, [AgeKey], false))).Content.ReadAsStringAsync(Ct);

        Assert.DoesNotContain("TOPSECRETVALUE", answer, StringComparison.Ordinal);
        Assert.Contains("\"rcloneConfigured\":true", answer, StringComparison.Ordinal);
        var settingsFile = await File.ReadAllTextAsync(Path.Combine(app.BackupFolder, "backup-settings.json"), Ct);
        Assert.Contains("\"schedule\": \"0 3 * * *\"", settingsFile, StringComparison.Ordinal);
        Assert.DoesNotContain("TOPSECRETVALUE", settingsFile, StringComparison.Ordinal);
        Assert.Equal(RcloneConf, await File.ReadAllTextAsync(Path.Combine(app.BackupFolder, "rclone.conf"), Ct));
        var stored = await app.Service<IServerSettingsStore>().GetAsync(Ct);
        Assert.DoesNotContain("TOPSECRETVALUE", stored!.RcloneConfigProtected, StringComparison.Ordinal);
        if (!OperatingSystem.IsWindows())
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(Path.Combine(app.BackupFolder, "rclone.conf")));
        }
    }

    [Fact]
    public async Task Backup_Invalid_IsRefusedWithAllReasons()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        using var json = await ErrorsOfAsync(admin.Client.PutJsonAsync("/api/settings/backup", new UpdateBackupRequest("every night", "Mars Base", 0, 500, "nocolon", "garbage", ["nope"], false)));

        var errors = json.RootElement.GetProperty("errors");
        foreach (var field in new[] { "schedule", "timezone", "keepDaily", "keepWeekly", "rcloneRemote", "rcloneConfig", "ageRecipients[0]" })
        {
            Assert.True(errors.TryGetProperty(field, out _), field);
        }
    }

    [Fact]
    public async Task Backups_ListWhatTheServiceReports_AndBackUpNowLeavesARequest()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        var before = await admin.Client.GetAsync("/api/settings/backups", Ct).ExpectAsync<BackupsDto>();
        await File.WriteAllTextAsync(app.BackupStatusFile, """
            { "version": 1, "createdAt": "2026-10-20T00:00:00Z", "state": "idle",
              "lastSuccess": { "at": "2026-10-26T03:00:00Z", "name": "2026-10-26_0300_auto", "bytes": 1000 },
              "backups": [ { "name": "2026-10-25_0300_auto", "at": "2026-10-25T03:00:00Z", "bytes": 900, "kind": "auto" }, { "name": "2026-10-26_0300_auto", "at": "2026-10-26T03:00:00Z", "bytes": 1000, "kind": "auto" } ] }
            """, Ct);

        var listed = await admin.Client.GetAsync("/api/settings/backups", Ct).ExpectAsync<BackupsDto>();
        await admin.Client.PostAsync("/api/settings/backups", null, Ct).ExpectAsync(HttpStatusCode.Accepted);

        Assert.False(before.ServiceSeen);
        Assert.True(listed.ServiceSeen);
        Assert.Equal(["2026-10-26_0300_auto", "2026-10-25_0300_auto"], listed.Backups.Select(b => b.Name));
        Assert.True(File.Exists(Path.Combine(app.BackupFolder, "backup-now")));
        var log = await admin.Client.GetAsync("/api/audit?limit=50", Ct).ExpectAsync<AuditPageDto>();
        Assert.Contains(log.Entries, e => e.Code == LogCode.BackupRequested);
    }

    [Fact]
    public async Task BackUpNow_WhenTheServiceHasNotReported_IsRefused()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();

        var code = await admin.Client.PostAsync("/api/settings/backups", null, Ct).ExpectProblemAsync(HttpStatusCode.Conflict);

        Assert.Equal(ErrorCodes.ServiceUnavailable, code);
        Assert.False(File.Exists(Path.Combine(app.BackupFolder, "backup-now")));
    }

    [Fact]
    public async Task EveryChange_IsInTheAuditLog_WithoutSecrets()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();
        await admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest("dns-cloudflare", "studio.example.ch", null, null, new Dictionary<string, string> { ["token"] = CloudflareToken })).ExpectAsync<ServerSettingsDto>();
        await admin.Client.PutJsonAsync("/api/settings/embedding", new UpdateEmbeddingRequest(["https://proxy.example.ch"])).ExpectAsync<ServerSettingsDto>();
        await admin.Client.PutJsonAsync("/api/settings/backup", new UpdateBackupRequest(null, null, 7, 4, null, null, null, false)).ExpectAsync<ServerSettingsDto>();

        var log = await admin.Client.GetAsync("/api/audit?limit=50", Ct).ExpectAsync<AuditPageDto>();

        var texts = log.Entries.Select(e => e.Text).ToList();
        Assert.Contains("Media address set to 192.168.1.50", texts);
        Assert.Contains("Address and certificate changed (dns-cloudflare)", texts);
        Assert.Contains("Embedding changed (1 origins)", texts);
        Assert.Contains("Backup settings changed", texts);
        Assert.All(texts, text => Assert.DoesNotContain(CloudflareToken, text, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Settings_SurviveARestart_AndCaddyAndLiveKitGetThemAgain()
    {
        string database;
        await using (var first = await StartAsync(postgres))
        {
            database = first.ConnectionString;
            var admin = await first.AdminAsync();
            await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();
            await admin.Client.PutJsonAsync("/api/settings/address", new UpdateAddressRequest("dns-cloudflare", "studio.example.ch", "admin@example.ch", null, new Dictionary<string, string> { ["token"] = CloudflareToken })).ExpectAsync<ServerSettingsDto>();
            await admin.Client.PutJsonAsync("/api/settings/embedding", new UpdateEmbeddingRequest(["https://proxy.example.ch"])).ExpectAsync<ServerSettingsDto>();
        }

        await using var second = await StartAsync(postgres, database);
        var again = await second.AdminAsync();
        var settings = await again.Client.GetAsync("/api/settings", Ct).ExpectAsync<ServerSettingsDto>();

        Assert.True(settings.Configured);
        Assert.Equal("192.168.1.50", settings.Media.Address);
        Assert.Equal(("dns-cloudflare", "studio.example.ch", "admin@example.ch"), (settings.Address.TlsMode, settings.Address.Domain, settings.Address.AcmeEmail));
        Assert.Equal(["token"], settings.Address.CredentialFields);
        Assert.Equal(["https://proxy.example.ch"], settings.Embedding.Origins);
        Assert.Equal("https://studio.example.ch:8443", settings.BaseUrl);

        // The startup applied the saved state to the (new) services; the stored token decrypts with the persisted keys.
        Assert.Contains($"\"{CloudflareToken}\"", second.Caddy.Loaded, StringComparison.Ordinal);
        Assert.Contains("node_ip: 192.168.1.50", second.LiveKitYaml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ARestartedCaddy_IsConfiguredAgainByTheMaintenanceLoop()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();
        var loads = app.Caddy.Loads;

        app.Caddy.Restart();
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        while (app.Caddy.Loaded is null && DateTime.UtcNow < deadline)
        {
            await Task.Delay(100, Ct);
        }

        Assert.NotNull(app.Caddy.Loaded);
        Assert.True(app.Caddy.Loads > loads);
    }

    [Fact]
    public async Task ARestoredDatabase_IsNoticedWithoutARestart()
    {
        await using var app = await StartAsync(postgres);
        var admin = await app.AdminAsync();
        await admin.Client.PutJsonAsync("/api/settings/media", new UpdateMediaRequest("192.168.1.50")).ExpectAsync<ServerSettingsDto>();

        // Another process (a restore) changes the row.
        await app.Service<IServerSettingsStore>().UpdateAsync(DateTimeOffset.UtcNow, settings => settings.ChangeMediaAddress("10.1.1.1", DateTimeOffset.UtcNow), AuditEntry.Create(null, DateTimeOffset.UtcNow, AuditActors.System, AuditActions.SettingsMediaChanged), Ct);
        await app.Service<ServerSettingsState>().RefreshAsync(Ct);
        await app.Service<ServerConfigApplier>().ApplyAsync(Ct);

        Assert.Contains("node_ip: 10.1.1.1", app.LiveKitYaml, StringComparison.Ordinal);
        Assert.Equal("https://10.1.1.1:8443", app.Service<StudioFlowOptions>().BaseUrl);
    }
}

/// <summary>The route Caddy asks before it makes a certificate for an unknown name (issue #27).</summary>
public sealed class TlsAskTests(StudioFlowApp app, PostgresFixture postgres) : IClassFixture<StudioFlowApp>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("192.168.1.50")]
    [InlineData("127.0.0.1")]
    [InlineData("studio.example.ch")]
    [InlineData("localhost")]
    [InlineData("[::1]")]
    public async Task Ask_ANameOrAnAddress_IsAllowed(string domain)
    {
        using var response = await app.Anonymous().GetAsync($"/internal/tls/ask?domain={Uri.EscapeDataString(domain.Trim('[', ']'))}", Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("a b")]
    [InlineData("-bad.example.ch")]
    [InlineData("under_score.example.ch")]
    [InlineData("a/b")]
    public async Task Ask_AnythingElse_IsRefused(string domain)
    {
        using var response = await app.Anonymous().GetAsync($"/internal/tls/ask?domain={Uri.EscapeDataString(domain)}", Ct);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Ask_WithoutAName_IsRefused()
    {
        using var response = await app.Anonymous().GetAsync("/internal/tls/ask", Ct);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Ask_ManyNamesInAMinute_AreLimited()
    {
        await using var own = new StudioFlowApp(postgres);
        await own.InitializeAsync();
        var client = own.Anonymous();
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 70; i++)
        {
            using var response = await client.GetAsync($"/internal/tls/ask?domain=host{i}.example.ch", Ct);
            statuses.Add(response.StatusCode);
        }

        Assert.Equal(60, statuses.Count(s => s == HttpStatusCode.OK));
        Assert.Equal(10, statuses.Count(s => s == HttpStatusCode.Forbidden));
    }
}
