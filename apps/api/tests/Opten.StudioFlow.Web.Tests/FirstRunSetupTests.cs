using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The app as it is after a fresh install: no Regie account, the first-run setup is open (issue #4).</summary>
public class FirstRunApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    protected override bool SetUpAccount => false;
}

/// <summary>A restart: the app on the database of an earlier app.</summary>
public sealed class RestartedFirstRunApp(PostgresFixture postgres, string database) : FirstRunApp(postgres)
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("ConnectionStrings:StudioFlow", database);
    }
}

/// <summary>The fresh app with settings of older versions that are ignored now.</summary>
public sealed class LegacySettingsApp(PostgresFixture postgres) : FirstRunApp(postgres)
{
    public const string LegacyPassword = "legacy-secret-from-env";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Admin:Username", "legacy");
        builder.UseSetting("Admin:Password", LegacyPassword);
    }
}

/// <summary>The fresh app after one successful setup through the API; the tests look at what the setup left behind.</summary>
public sealed class CompletedSetupApp(PostgresFixture postgres) : FirstRunApp(postgres)
{
    public const string Username = "regie";
    public const string Password = "A-Long-Passphrase-1";

    /// <summary>The setup code that was used.</summary>
    public string UsedCode { get; private set; } = string.Empty;

    /// <summary>The answer of the setup request.</summary>
    public HttpStatusCode SetupStatus { get; private set; }

    /// <summary>The session of the setup answer.</summary>
    public SessionDto? SetupSession { get; private set; }

    /// <summary>The session cookie the setup answer set.</summary>
    public string SessionCookie { get; private set; } = string.Empty;

    public override async ValueTask InitializeAsync()
    {
        await base.InitializeAsync();
        UsedCode = Service<SetupCode>().Current!;
        using var response = await Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(UsedCode, $"  {Username}  ", Password));
        SetupStatus = response.StatusCode;
        SetupSession = await response.Content.ReadFromJsonAsync<SessionDto>(ContractJson.Options);
        SessionCookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("sf_session=", StringComparison.Ordinal)).Split(';')[0];
    }

    /// <summary>A client holding the session cookie of the setup.</summary>
    public HttpClient SignedIn()
    {
        var client = Anonymous();
        client.DefaultRequestHeaders.Add("Cookie", SessionCookie);
        return client;
    }
}

/// <summary>What the open first-run setup refuses, and what stays closed before the account exists.</summary>
public sealed class FirstRunSetupOpenTests(FirstRunApp app) : IClassFixture<FirstRunApp>
{
    private const string NewPassword = "A-Long-Passphrase-1";

    [Fact]
    public async Task Status_WithoutAccount_SaysSetupIsRequiredAndNothingElse()
    {
        using var response = await app.Anonymous().GetAsync("/api/auth/setup", TestContext.Current.CancellationToken);

        await response.ExpectAsync(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.Equal("""{"setupRequired":true}""", body);
        Assert.DoesNotContain(app.Service<SetupCode>().Current!, body, StringComparison.Ordinal);
    }

    [Fact]
    public void SetupCode_IsIssuedAtStartAndOnlyInTheServerLog()
    {
        var code = app.Service<SetupCode>().Current;

        Assert.Matches("^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$", code);
        Assert.Contains(app.Logs.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains($"Setup code: {code}", StringComparison.Ordinal));
    }

    [Fact]
    public void Startup_WithoutSettingsOfOlderVersions_DoesNotWarnAboutThem() =>
        Assert.DoesNotContain(app.Logs.Entries, e => e.Message.Contains("are ignored", StringComparison.Ordinal));

    [Fact]
    public async Task Login_BeforeSetup_IsUnauthorized() =>
        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword)).ExpectProblemAsync(HttpStatusCode.Unauthorized));

    [Fact]
    public async Task AdminRoute_BeforeSetup_IsUnauthorized() =>
        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().GetAsync("/api/productions", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));

    [Theory]
    [InlineData("")]
    [InlineData("AAAA-AAAA")]
    [InlineData("not a code")]
    public async Task Setup_WrongOrMissingCode_IsForbiddenAndCreatesNothing(string code)
    {
        var problem = await app.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(code, "regie", NewPassword)).ExpectProblemAsync(HttpStatusCode.Forbidden);

        Assert.Equal(ErrorCodes.SetupCodeInvalid, problem);
        Assert.True(app.Service<AdminAccountState>().SetupRequired);
    }

    [Fact]
    public async Task Setup_BodyWithoutCode_IsForbidden()
    {
        using var content = JsonContent.Create(new { username = "regie", password = NewPassword });

        Assert.Equal(ErrorCodes.SetupCodeInvalid, await app.Anonymous().PostAsync("/api/auth/setup", content, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
    }

    [Fact]
    public async Task Setup_FiveWrongCodesFromOneAddress_LockThatAddressEvenForTheRightCode()
    {
        var client = app.Anonymous();
        for (var i = 0; i < 4; i++)
        {
            await client.PostJsonAsync("/api/auth/setup", new SetupRequest($"WRONG-{i}", "regie", NewPassword)).ExpectProblemAsync(HttpStatusCode.Forbidden);
        }

        using var locked = await client.PostJsonAsync("/api/auth/setup", new SetupRequest("WRONG-5", "regie", NewPassword));
        using var stillLocked = await client.PostJsonAsync("/api/auth/setup", new SetupRequest(app.Service<SetupCode>().Current!, "regie", NewPassword));

        await locked.ExpectAsync(HttpStatusCode.TooManyRequests);
        await stillLocked.ExpectAsync(HttpStatusCode.TooManyRequests);
        Assert.InRange(int.Parse(stillLocked.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture), 800, 900);
        Assert.True(app.Service<AdminAccountState>().SetupRequired);
    }

    [Theory]
    [InlineData("regie", "short", "password", FieldErrorCodes.PasswordTooShort)]
    [InlineData("regie", "elevenchars", "password", FieldErrorCodes.PasswordTooShort)]
    [InlineData("regie.studio", "Regie.Studio", "password", FieldErrorCodes.PasswordEqualsUsername)]
    [InlineData("regie", "Password12345", "password", FieldErrorCodes.PasswordTooCommon)]
    [InlineData("regie", "STUDIOFLOW123", "password", FieldErrorCodes.PasswordTooCommon)]
    [InlineData("", "A-Long-Passphrase-1", "username", FieldErrorCodes.UsernameInvalid)]
    [InlineData("two words", "A-Long-Passphrase-1", "username", FieldErrorCodes.UsernameInvalid)]
    [InlineData("a-very-long-user-name-with-more-than-sixty-four-characters-in-total-1234", "A-Long-Passphrase-1", "username", FieldErrorCodes.UsernameInvalid)]
    public async Task Setup_RuleViolation_IsValidationFailedWithTheReasonAndKeepsTheCode(string username, string password, string field, string reason)
    {
        var code = app.Service<SetupCode>().Current!;

        using var response = await app.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(code, username, password));

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        Assert.Contains(reason, json.RootElement.GetProperty("errors").GetProperty(field).EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(code, app.Service<SetupCode>().Current);
        Assert.True(app.Service<AdminAccountState>().SetupRequired);
    }
}

/// <summary>What one completed setup leaves behind, and that it is closed for good afterwards.</summary>
public sealed class FirstRunSetupCompletedTests(CompletedSetupApp app) : IClassFixture<CompletedSetupApp>
{
    [Fact]
    public async Task Setup_ValidCode_SignsTheNewAccountInWithoutALoginStep()
    {
        Assert.Equal(HttpStatusCode.OK, app.SetupStatus);
        Assert.Equal(CompletedSetupApp.Username, app.SetupSession!.Username);
        Assert.Equal(CompletedSetupApp.Username, (await app.SignedIn().GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync<SessionDto>()).Username);
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(CompletedSetupApp.Username, CompletedSetupApp.Password)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Setup_ValidCode_ClosesTheStatusAndInvalidatesTheCode()
    {
        Assert.Equal("""{"setupRequired":false}""", await app.Anonymous().GetStringAsync("/api/auth/setup", TestContext.Current.CancellationToken));
        Assert.Null(app.Service<SetupCode>().Current);
    }

    [Fact]
    public async Task Setup_ValidCode_StoresAHashedPasswordAndAnAuditEntryWithoutSecrets()
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);

        var account = await db.AdminAccounts.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken);
        var audit = await db.AuditEntries.AsNoTracking().SingleAsync(a => a.Action == AuditActions.AccountSetUp, TestContext.Current.CancellationToken);

        Assert.Equal(CompletedSetupApp.Username, account.Username);
        Assert.StartsWith("AQAAAA", account.PasswordHash, StringComparison.Ordinal);
        Assert.DoesNotContain(CompletedSetupApp.Password, account.PasswordHash, StringComparison.Ordinal);
        Assert.Equal((null, AuditActors.Admin, CompletedSetupApp.Username), (audit.ProductionId, audit.Actor, audit.Detail(AuditDetails.Username)));
        var details = string.Join(' ', audit.Details.Values);
        Assert.DoesNotContain(CompletedSetupApp.Password, details, StringComparison.Ordinal);
        Assert.DoesNotContain(app.UsedCode, details, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Setup_ValidCode_ShowsInRecentEventsOfTheRegie()
    {
        var client = app.SignedIn();
        var active = await client.GetAsync("/api/productions/active", TestContext.Current.CancellationToken).ExpectAsync<ProductionSummaryDto>();

        var snapshot = await client.GetAsync($"/api/productions/{active.Id}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        var entry = Assert.Single(snapshot.RecentLog, l => l.Code == LogCode.AccountSetUp);
        Assert.Equal("Account set up", entry.Text);
    }

    [Fact]
    public async Task Setup_AccountExists_AnyFurtherAttemptIsAConflict()
    {
        var withOldCode = await app.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(app.UsedCode, "intruder", CompletedSetupApp.Password)).ExpectProblemAsync(HttpStatusCode.Conflict);
        var withWrongCode = await app.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest("AAAA-AAAA", "intruder", CompletedSetupApp.Password)).ExpectProblemAsync(HttpStatusCode.Conflict);
        var withNothing = await app.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(string.Empty, string.Empty, string.Empty)).ExpectProblemAsync(HttpStatusCode.Conflict);

        Assert.All(new[] { withOldCode, withWrongCode, withNothing }, code => Assert.Equal(ErrorCodes.SetupClosed, code));
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest("intruder", CompletedSetupApp.Password)).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Database_RefusesASecondAccountRow()
    {
        var store = app.Service<IAdminAccountStore>();
        var second = AdminAccount.Create("second", "hash", DateTimeOffset.UtcNow);
        var audit = AuditEntry.Create(null, DateTimeOffset.UtcNow, AuditActors.Admin, AuditActions.AccountSetUp);

        Assert.False(await store.TryCreateAsync(second, audit, TestContext.Current.CancellationToken));
        Assert.Equal(CompletedSetupApp.Username, (await store.GetAsync(TestContext.Current.CancellationToken))!.Username);
    }
}

/// <summary>Concurrent setups, restarts and settings of older versions: each needs its own app.</summary>
public sealed class FirstRunSetupLifecycleTests(PostgresFixture postgres)
{
    private const string Password = "A-Long-Passphrase-1";

    [Fact]
    public async Task Setup_ConcurrentRequests_ExactlyOneWins()
    {
        await using var app = await StartAsync();
        var code = app.Service<SetupCode>().Current!;

        var attempts = await Task.WhenAll(Enumerable.Range(0, 8).Select(async i =>
        {
            using var response = await app.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(code, $"user{i}", Password));
            return (Status: response.StatusCode, Code: response.StatusCode == HttpStatusCode.Conflict ? await ProblemCodeAsync(response) : null);
        }));

        Assert.Equal(1, attempts.Count(a => a.Status == HttpStatusCode.OK));
        Assert.All(attempts.Where(a => a.Status != HttpStatusCode.OK), a => Assert.Equal((HttpStatusCode.Conflict, ErrorCodes.SetupClosed), (a.Status, a.Code)));
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        Assert.Single(await db.AdminAccounts.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken));
        Assert.Single(await db.AuditEntries.AsNoTracking().Where(a => a.Action == AuditActions.AccountSetUp).ToListAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Restart_AccountRemains_SetupStaysClosedAndLoginWorks()
    {
        string database;
        await using (var first = await StartAsync())
        {
            database = first.ConnectionString;
            await first.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(first.Service<SetupCode>().Current!, "regie", Password)).ExpectAsync(HttpStatusCode.OK);
        }

        await using var second = await StartAsync(database);

        Assert.False(second.Service<AdminAccountState>().SetupRequired);
        Assert.Null(second.Service<SetupCode>().Current);
        Assert.DoesNotContain(second.Logs.Entries, e => e.Message.Contains("Setup code", StringComparison.Ordinal));
        Assert.Equal("""{"setupRequired":false}""", await second.Anonymous().GetStringAsync("/api/auth/setup", TestContext.Current.CancellationToken));
        await second.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest("regie", Password)).ExpectAsync(HttpStatusCode.OK);
        await second.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest("AAAA-AAAA", "intruder", Password)).ExpectProblemAsync(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Restart_WithoutAccount_IssuesANewCodeAndTheOldOneIsInvalid()
    {
        string database;
        string oldCode;
        await using (var first = await StartAsync())
        {
            database = first.ConnectionString;
            oldCode = first.Service<SetupCode>().Current!;
        }

        await using var second = await StartAsync(database);

        Assert.NotEqual(oldCode, second.Service<SetupCode>().Current);
        await second.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(oldCode, "regie", Password)).ExpectProblemAsync(HttpStatusCode.Forbidden);
        await second.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(second.Service<SetupCode>().Current!, "regie", Password)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Startup_SettingsOfOlderVersions_AreIgnoredWithAWarningThatNamesNoValue()
    {
        await using var app = new LegacySettingsApp(postgres);
        await app.InitializeAsync();

        var warning = Assert.Single(app.Logs.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("are ignored", StringComparison.Ordinal));

        Assert.Contains("Admin:Username", warning.Message, StringComparison.Ordinal);
        Assert.Contains("Admin:Password", warning.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("Admin:PasswordHash", warning.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(LegacySettingsApp.LegacyPassword, warning.Message, StringComparison.Ordinal);
        Assert.True(app.Service<AdminAccountState>().SetupRequired);
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest("legacy", LegacySettingsApp.LegacyPassword)).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    private async Task<FirstRunApp> StartAsync(string? database = null)
    {
        FirstRunApp app = database is null ? new FirstRunApp(postgres) : new RestartedFirstRunApp(postgres, database);
        await app.InitializeAsync();
        return app;
    }

    private static async Task<string?> ProblemCodeAsync(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("code").GetString();
    }
}
