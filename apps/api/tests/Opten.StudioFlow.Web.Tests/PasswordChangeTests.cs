using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The app after the admin changed the password while a second session was open (issue #4).</summary>
public sealed class ChangedPasswordApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    public const string NewPassword = "Another-Long-Passphrase-2";

    private HubConnection? currentHub;
    private HubConnection? otherHub;

    /// <summary>The session that changed the password, with its old cookie.</summary>
    public AdminSession Current { get; private set; } = null!;

    /// <summary>The cookie the change renewed for the current session.</summary>
    public string RenewedCookie { get; private set; } = string.Empty;

    /// <summary>A second session that was open during the change, with its cookie.</summary>
    public AdminSession Other { get; private set; } = null!;

    /// <summary>Resolves when the Regie hub connection of the other session was closed.</summary>
    public Task OtherHubClosed { get; private set; } = Task.CompletedTask;

    /// <summary>The Regie hub connection of the current session.</summary>
    public HubConnection CurrentHub => currentHub!;

    /// <summary>A client with a session cookie and the CSRF header.</summary>
    public HttpClient WithCookie(string cookie)
    {
        var client = Anonymous();
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        client.DefaultRequestHeaders.Add("X-StudioFlow", "1");
        return client;
    }

    public override async ValueTask InitializeAsync()
    {
        await base.InitializeAsync();
        Current = await AdminAsync();
        Other = await AdminAsync();
        otherHub = Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = Other.Cookie);
        OtherHubClosed = HubClosed.Watch(otherHub);
        await otherHub.StartAsync();
        currentHub = Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = Current.Cookie);
        await currentHub.StartAsync();

        using var response = await Current.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest(AdminPassword, NewPassword));

        await response.ExpectAsync(HttpStatusCode.NoContent);
        RenewedCookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("sf_session=", StringComparison.Ordinal)).Split(';')[0];
    }

    public override async ValueTask DisposeAsync()
    {
        if (currentHub is not null)
        {
            await currentHub.DisposeAsync();
        }

        if (otherHub is not null)
        {
            await otherHub.DisposeAsync();
        }

        await base.DisposeAsync();
    }
}

/// <summary>What a successful password change does.</summary>
public sealed class PasswordChangedTests(ChangedPasswordApp app) : IClassFixture<ChangedPasswordApp>
{
    [Fact]
    public async Task Change_OtherSessions_EndAtOnceAndTheirHubConnectionsClose()
    {
        await app.OtherHubClosed.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);

        await app.WithCookie(app.Other.Cookie).GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.WithCookie(app.Other.Cookie).GetAsync("/api/productions", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Change_CurrentSession_ContinuesWithTheRenewedCookieAndItsHubConnectionStaysOpen()
    {
        var session = await app.WithCookie(app.RenewedCookie).GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync<SessionDto>();

        Assert.Equal(StudioFlowApp.AdminUser, session.Username);
        Assert.Equal(HubConnectionState.Connected, app.CurrentHub.State);
        await app.WithCookie(app.Current.Cookie).GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Change_OldPassword_NoLongerSignsIn()
    {
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword)).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, ChangedPasswordApp.NewPassword)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Change_WritesTheAuditEntryWithoutPasswordsAndShowsInRecentEvents()
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        var audit = await db.AuditEntries.AsNoTracking().SingleAsync(a => a.Action == AuditActions.PasswordChanged, TestContext.Current.CancellationToken);

        var snapshot = await app.WithCookie(app.RenewedCookie).GetAsync($"/api/productions/{app.Current.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

        Assert.Equal((null, AuditActors.Admin, StudioFlowApp.AdminUser), (audit.ProductionId, audit.Actor, audit.Detail(AuditDetails.Username)));
        var details = string.Join(' ', audit.Details.Values);
        Assert.DoesNotContain(ChangedPasswordApp.NewPassword, details, StringComparison.Ordinal);
        Assert.DoesNotContain(StudioFlowApp.AdminPassword, details, StringComparison.Ordinal);
        Assert.Equal("Password changed", Assert.Single(snapshot.RecentLog, l => l.Code == LogCode.PasswordChanged).Text);
    }
}

/// <summary>What a password change refuses; none of these change the password.</summary>
public sealed class PasswordChangeRefusedTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private const string NewPassword = "Another-Long-Passphrase-2";

    [Fact]
    public async Task Change_WrongCurrentPassword_IsRejectedAndChangesNothing()
    {
        var admin = await app.AdminAsync();

        var code = await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest("not-the-password", NewPassword)).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal(ErrorCodes.PasswordIncorrect, code);
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword)).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Change_FiveWrongCurrentPasswords_LockTheAddressLikeFailedLogins()
    {
        var admin = await app.AdminAsync();
        for (var i = 0; i < 4; i++)
        {
            await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest($"wrong-{i}", NewPassword)).ExpectProblemAsync(HttpStatusCode.BadRequest);
        }

        using var locked = await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest("wrong-5", NewPassword));
        using var stillLocked = await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest(StudioFlowApp.AdminPassword, NewPassword));

        await locked.ExpectAsync(HttpStatusCode.TooManyRequests);
        await stillLocked.ExpectAsync(HttpStatusCode.TooManyRequests);
        Assert.True(stillLocked.Headers.Contains("Retry-After"));
    }

    [Theory]
    [InlineData("short", FieldErrorCodes.PasswordTooShort)]
    [InlineData("Admin", FieldErrorCodes.PasswordTooShort)]
    [InlineData("Passwort1234", FieldErrorCodes.PasswordTooCommon)]
    public async Task Change_NewPasswordBreaksARule_IsValidationFailedAndKeepsTheOldPassword(string newPassword, string reason)
    {
        var admin = await app.AdminAsync();

        using var response = await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest(StudioFlowApp.AdminPassword, newPassword));

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        Assert.Contains(reason, json.RootElement.GetProperty("errors").GetProperty("newPassword").EnumerateArray().Select(e => e.GetString()));
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword)).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Change_WithoutSession_IsUnauthorized() =>
        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().PostJsonAsync("/api/auth/password", new ChangePasswordRequest(StudioFlowApp.AdminPassword, NewPassword)).ExpectProblemAsync(HttpStatusCode.Unauthorized));

    [Fact]
    public async Task Change_WithoutCsrfHeader_IsForbidden()
    {
        var admin = await app.AdminAsync();
        admin.Client.DefaultRequestHeaders.Remove("X-StudioFlow");

        Assert.Equal(ErrorCodes.Forbidden, await admin.Client.PostJsonAsync("/api/auth/password", new ChangePasswordRequest(StudioFlowApp.AdminPassword, NewPassword)).ExpectProblemAsync(HttpStatusCode.Forbidden));
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword)).ExpectAsync(HttpStatusCode.OK);
    }
}
