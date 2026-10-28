using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Infrastructure.Security;
using Opten.StudioFlow.Web.Security;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>Issue #71: no typed user name in the audit log of failed sign-ins, and the password hash is renewed on login.</summary>
public sealed class LoginAuditAndRehashTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private const string TypedByMistake = "Tr0ub4dor&3-typed-into-the-name-field";

    [Fact]
    public async Task FailedLogin_WithATypedTextThatIsNotTheUserName_RecordsNothingOfIt()
    {
        var ip = StudioFlowApp.NextAddress();
        using var response = await app.Anonymous(ip).PostJsonAsync("/api/auth/login", new LoginRequest(TypedByMistake, TypedByMistake));
        await response.ExpectAsync(HttpStatusCode.Unauthorized);
        var admin = await app.AdminAsync();

        var entry = Assert.Single(await AuditSeed.AllAsync(app), a => a.Action == AuditActions.LoginFailed && a.Details.GetValueOrDefault(AuditDetails.Ip) == ip);
        Assert.DoesNotContain(AuditDetails.Username, entry.Details.Keys);
        Assert.DoesNotContain(TypedByMistake, JsonSerializer.Serialize(await AuditSeed.AllAsync(app)), StringComparison.Ordinal);

        // The view and both exports carry nothing of it either, and the entry says what it is.
        using var csv = await admin.Client.GetAsync("/api/audit/export.csv", TestContext.Current.CancellationToken);
        using var json = await admin.Client.GetAsync("/api/audit/export.json", TestContext.Current.CancellationToken);
        Assert.DoesNotContain(TypedByMistake, await csv.Content.ReadAsStringAsync(TestContext.Current.CancellationToken), StringComparison.Ordinal);
        Assert.DoesNotContain(TypedByMistake, await json.Content.ReadAsStringAsync(TestContext.Current.CancellationToken), StringComparison.Ordinal);
        var described = LogTexts.Describe(entry);
        Assert.Equal(LogCode.LoginFailedUnknownUser, described!.Value.Code);
        Assert.DoesNotContain(TypedByMistake, described.Value.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FailedLogin_WithTheRightUserNameAndAWrongPassword_RecordsTheAccountName()
    {
        var ip = StudioFlowApp.NextAddress();
        using var response = await app.Anonymous(ip).PostJsonAsync("/api/auth/login", new LoginRequest("  " + StudioFlowApp.AdminUser + " ", TypedByMistake));
        await response.ExpectAsync(HttpStatusCode.Unauthorized);

        var entry = Assert.Single(await AuditSeed.AllAsync(app), a => a.Action == AuditActions.LoginFailed && a.Details.GetValueOrDefault(AuditDetails.Ip) == ip);
        Assert.Equal(StudioFlowApp.AdminUser, entry.Details[AuditDetails.Username]);
        Assert.Equal(LogCode.LoginFailed, LogTexts.Describe(entry)!.Value.Code);
        Assert.DoesNotContain(TypedByMistake, JsonSerializer.Serialize(entry.Details), StringComparison.Ordinal);
    }

    [Fact]
    public async Task LockedLogin_RecordsNoTypedText()
    {
        var ip = StudioFlowApp.NextAddress();
        var client = app.Anonymous(ip);
        for (var attempt = 0; attempt < 5; attempt++)
        {
            using var response = await client.PostJsonAsync("/api/auth/login", new LoginRequest(TypedByMistake + attempt, "x"));
            Assert.True(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.TooManyRequests);
        }

        var entries = (await AuditSeed.AllAsync(app)).Where(a => a.Details.GetValueOrDefault(AuditDetails.Ip) == ip).ToList();
        Assert.Contains(entries, a => a.Action == AuditActions.LoginLocked);
        Assert.DoesNotContain(TypedByMistake, JsonSerializer.Serialize(entries), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Login_WithAHashOfTheOldIterationCount_RenewsItAndKeepsEverySessionAndTheStamp()
    {
        var first = await app.AdminAsync();
        var state = app.Service<AdminAccountState>();
        var stampBefore = await StoredAsync(app, a => a.SecurityStamp);
        await SetHashAsync(app, AdminPasswordHasherTests.OldHash(StudioFlowApp.AdminPassword, 100_000));
        await state.RefreshAsync(TestContext.Current.CancellationToken);
        Assert.Equal(100_000, AdminPasswordHasherTests.IterationCountOf(await StoredAsync(app, a => a.PasswordHash)));

        // A wrong password changes nothing.
        using var wrong = await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, "wrong-password"));
        await wrong.ExpectAsync(HttpStatusCode.Unauthorized);
        Assert.Equal(100_000, AdminPasswordHasherTests.IterationCountOf(await StoredAsync(app, a => a.PasswordHash)));

        // The right one signs in with the old hash and stores a new one.
        var second = await app.AdminAsync();

        Assert.Equal(AdminPasswordHasher.IterationCount, AdminPasswordHasherTests.IterationCountOf(await StoredAsync(app, a => a.PasswordHash)));
        Assert.Equal(stampBefore, await StoredAsync(app, a => a.SecurityStamp));
        await first.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await second.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        // The new hash works, and needs no further renewal.
        var third = await app.AdminAsync();
        await third.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        Assert.Equal(AdminPasswordHasher.IterationCount, AdminPasswordHasherTests.IterationCountOf(await StoredAsync(app, a => a.PasswordHash)));
    }

    [Fact]
    public async Task ChangedPassword_IsHashedWithTheCurrentIterationCount()
    {
        var admin = await app.AdminAsync();
        const string next = "A-New-Password-For-The-Test-9";
        using var changed = await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest(StudioFlowApp.AdminPassword, next));
        await changed.ExpectAsync(HttpStatusCode.NoContent);
        try
        {
            Assert.Equal(AdminPasswordHasher.IterationCount, AdminPasswordHasherTests.IterationCountOf(await StoredAsync(app, a => a.PasswordHash)));
        }
        finally
        {
            // The change ended every other session and renewed only this one's cookie: change the password back with it, so
            // the other tests of the class sign in with the usual one.
            var renewed = changed.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("sf_session=", StringComparison.Ordinal)).Split(';')[0];
            using var client = app.Anonymous();
            client.DefaultRequestHeaders.Add("Cookie", renewed);
            client.DefaultRequestHeaders.Add("X-StudioFlow", "1");
            await client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest(next, StudioFlowApp.AdminPassword)).ExpectAsync(HttpStatusCode.NoContent);
        }
    }

    internal static async Task<T> StoredAsync<T>(StudioFlowApp app, Func<AdminAccount, T> select)
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        return select(await db.AdminAccounts.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken));
    }

    internal static async Task SetHashAsync(StudioFlowApp app, string hash)
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        await db.AdminAccounts.ExecuteUpdateAsync(set => set.SetProperty(a => a.PasswordHash, hash), TestContext.Current.CancellationToken);
    }
}

/// <summary>Issue #71: a session has an absolute lifetime, and a logout survives an API restart.</summary>
public sealed class AdminSessionLifetimeTests(PostgresFixture postgres)
{
    [Fact]
    public async Task Session_EndsAfterTheAbsoluteLifetimeHoweverActiveItWas()
    {
        await using var app = new ConfiguredApp(postgres, absoluteLifetime: "00:00:03");
        await app.InitializeAsync();
        var admin = await app.AdminAsync();

        // Activity slides the cookie, not the absolute limit.
        for (var i = 0; i < 3; i++)
        {
            await admin.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
            await Task.Delay(TimeSpan.FromMilliseconds(700), TestContext.Current.CancellationToken);
        }

        await Task.Delay(TimeSpan.FromSeconds(1.5), TestContext.Current.CancellationToken);

        Assert.Equal(ErrorCodes.Unauthorized, await admin.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));
        // A new sign-in starts a new session.
        await (await app.AdminAsync()).Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task IsOverAbsoluteLifetime_JudgesTheTimeOfIssue()
    {
        await using var app = new ConfiguredApp(postgres, absoluteLifetime: "00:00:04");
        await app.InitializeAsync();
        var sessions = app.Service<AdminSessions>();

        Assert.False(sessions.IsOverAbsoluteLifetime(DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture)));
        Assert.True(sessions.IsOverAbsoluteLifetime(DateTimeOffset.UtcNow.AddSeconds(-5).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture)));
        Assert.True(sessions.IsOverAbsoluteLifetime(null));
        Assert.True(sessions.IsOverAbsoluteLifetime("not-a-number"));
    }

    [Fact]
    public async Task PasswordChange_RenewsTheCookieButKeepsTheTimeOfIssue()
    {
        await using var app = new ConfiguredApp(postgres);
        await app.InitializeAsync();
        var admin = await app.AdminAsync();
        var format = app.Service<IOptionsMonitor<CookieAuthenticationOptions>>().Get(AuthSchemes.Admin).TicketDataFormat;
        string IssuedAt(string cookie) => format.Unprotect(cookie[(cookie.IndexOf('=', StringComparison.Ordinal) + 1)..])!.Principal.FindFirstValue(StudioFlowClaims.IssuedAt)!;
        var before = IssuedAt(admin.Cookie);
        await Task.Delay(TimeSpan.FromSeconds(1.2), TestContext.Current.CancellationToken);

        using var response = await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest(StudioFlowApp.AdminPassword, "A-New-Password-For-The-Test-9"));

        await response.ExpectAsync(HttpStatusCode.NoContent);
        var renewed = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("sf_session=", StringComparison.Ordinal)).Split(';')[0];
        Assert.NotEqual(admin.Cookie, renewed);
        Assert.Equal(before, IssuedAt(renewed));
    }

    [Fact]
    public async Task CookieWithoutTheTimeOfIssue_IsRefused()
    {
        await using var app = new ConfiguredApp(postgres);
        await app.InitializeAsync();
        var identity = app.Service<AdminAccountState>().Check(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword).Identity!;

        var old = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.Name, identity.Username),
                new Claim(StudioFlowClaims.SessionId, AdminSessions.NewSessionId()),
                new Claim(StudioFlowClaims.SecurityStamp, identity.SecurityStamp),
            ],
            AuthSchemes.Admin));
        var current = AdminSessions.Principal(identity, DateTimeOffset.UtcNow);

        Assert.Equal(HttpStatusCode.Unauthorized, (await ProbeAsync(app, old)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ProbeAsync(app, current)).StatusCode);
    }

    [Fact]
    public async Task Logout_SurvivesAnApiRestart_AndOnlyEndsThatSession()
    {
        var keys = Directory.CreateTempSubdirectory("sf-keys-").FullName;
        try
        {
            string database;
            string ended;
            string kept;
            await using (var first = new ConfiguredApp(postgres, keysPath: keys))
            {
                await first.InitializeAsync();
                database = first.ConnectionString;
                var one = await first.AdminAsync();
                var two = await first.AdminAsync();
                ended = one.Cookie;
                kept = two.Cookie;

                await one.Client.PostAsync("/api/auth/logout", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

                Assert.Equal(HttpStatusCode.Unauthorized, (await CookieProbeAsync(first, ended)).StatusCode);
                Assert.Equal(HttpStatusCode.OK, (await CookieProbeAsync(first, kept)).StatusCode);
                await using var db = await first.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
                Assert.Equal(1, await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM admin_revoked_session").SingleAsync(TestContext.Current.CancellationToken));
            }

            await using var second = new ConfiguredApp(postgres, database, keys);
            await second.InitializeAsync();

            // The keys are shared, so the cookie that was not signed out is still good: the refusal below is the stored revocation.
            Assert.Equal(HttpStatusCode.OK, (await CookieProbeAsync(second, kept)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await CookieProbeAsync(second, ended)).StatusCode);
        }
        finally
        {
            Directory.Delete(keys, recursive: true);
        }
    }

    [Fact]
    public async Task Logout_WhenTheDatabaseFails_StillRevokesInMemoryAndStoresItLater()
    {
        await using var app = new ConfiguredApp(postgres);
        await app.InitializeAsync();
        var sessions = app.Service<AdminSessions>();
        var id = AdminSessions.NewSessionId();
        var until = DateTimeOffset.UtcNow.AddHours(1);

        // The table is gone: the store fails, the logout does not.
        await using (var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE admin_revoked_session RENAME TO admin_revoked_session_away", TestContext.Current.CancellationToken);
        }

        await sessions.RevokeAsync(id, until, TestContext.Current.CancellationToken);
        Assert.True(sessions.IsRevoked(id));

        await using (var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken))
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE admin_revoked_session_away RENAME TO admin_revoked_session", TestContext.Current.CancellationToken);
        }

        await sessions.StorePendingAsync(TestContext.Current.CancellationToken);

        await using var check = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        Assert.Equal([id], await check.Database.SqlQueryRaw<string>("SELECT session_id AS \"Value\" FROM admin_revoked_session").ToListAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Prune_RemovesOnlyExpiredRevocations()
    {
        await using var app = new ConfiguredApp(postgres);
        await app.InitializeAsync();
        var sessions = app.Service<AdminSessions>();
        await sessions.RevokeAsync("expired", DateTimeOffset.UtcNow.AddSeconds(-1), TestContext.Current.CancellationToken);
        await sessions.RevokeAsync("active", DateTimeOffset.UtcNow.AddHours(1), TestContext.Current.CancellationToken);

        await sessions.PruneAsync(TestContext.Current.CancellationToken);

        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        Assert.Equal(["active"], await db.Database.SqlQueryRaw<string>("SELECT session_id AS \"Value\" FROM admin_revoked_session").ToListAsync(TestContext.Current.CancellationToken));
        Assert.False(sessions.IsRevoked("expired"));
        Assert.True(sessions.IsRevoked("active"));
    }

    private static async Task<HttpResponseMessage> ProbeAsync(StudioFlowApp app, ClaimsPrincipal principal)
    {
        var options = app.Service<IOptionsMonitor<CookieAuthenticationOptions>>().Get(AuthSchemes.Admin);
        var ticket = new AuthenticationTicket(principal, new AuthenticationProperties { IsPersistent = true, ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1), IssuedUtc = DateTimeOffset.UtcNow }, AuthSchemes.Admin);
        return await CookieProbeAsync(app, $"{SecurityNames.SessionCookie}={options.TicketDataFormat.Protect(ticket)}");
    }

    private static async Task<HttpResponseMessage> CookieProbeAsync(StudioFlowApp app, string cookie)
    {
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        return await client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken);
    }

    /// <summary>The app with an absolute lifetime and shared Data Protection keys, optionally on the database of an earlier app.</summary>
    private sealed class ConfiguredApp(PostgresFixture postgres, string? database = null, string? keysPath = null, string? absoluteLifetime = null) : StudioFlowApp(postgres)
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            if (database is not null)
            {
                builder.UseSetting("ConnectionStrings:StudioFlow", database);
            }

            if (keysPath is not null)
            {
                builder.UseSetting("DataProtection:KeysPath", keysPath);
            }

            if (absoluteLifetime is not null)
            {
                builder.UseSetting("Admin:AbsoluteSessionLifetime", absoluteLifetime);
            }
        }
    }
}
