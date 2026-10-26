using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Hosting;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class AuthTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Fact]
    public async Task Login_Correct_SetsHttpOnlyStrictSessionCookie()
    {
        using var response = await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword));

        await response.ExpectAsync(HttpStatusCode.OK);
        var cookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("sf_session=", StringComparison.Ordinal)).ToLowerInvariant();
        Assert.Contains("httponly", cookie, StringComparison.Ordinal);
        Assert.Contains("samesite=strict", cookie, StringComparison.Ordinal);
        Assert.Contains("path=/", cookie, StringComparison.Ordinal);
        Assert.Contains("expires=", cookie, StringComparison.Ordinal);
        Assert.DoesNotContain("secure", cookie, StringComparison.Ordinal);
        Assert.Equal(StudioFlowApp.AdminUser, (await response.Content.ReadFromJsonAsync<SessionDto>(ContractJson.Options, TestContext.Current.CancellationToken))!.Username);
    }

    [Fact]
    public async Task Login_WrongPassword_IsUnauthorized() =>
        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest("admin", "wrong")).ExpectProblemAsync(HttpStatusCode.Unauthorized));

    [Fact]
    public async Task Login_MissingBodyOrMalformedJson_IsValidationFailed()
    {
        var client = app.Anonymous();

        Assert.Equal(ErrorCodes.ValidationFailed, await client.PostAsync("/api/auth/login", new StringContent("{nope", Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest));
        Assert.Equal(ErrorCodes.ValidationFailed, await client.PostAsync("/api/auth/login", new StringContent(string.Empty, Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest));
    }

    [Fact]
    public async Task Login_FiveFailures_LocksTheAddressWithRetryAfter()
    {
        var client = app.Anonymous();
        for (var i = 0; i < 4; i++)
        {
            await client.PostJsonAsync("/api/auth/login", new LoginRequest("admin", $"wrong{i}")).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        }

        using var locked = await client.PostJsonAsync("/api/auth/login", new LoginRequest("admin", "wrong5"));
        using var stillLocked = await client.PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword));

        await locked.ExpectAsync(HttpStatusCode.TooManyRequests);
        await stillLocked.ExpectAsync(HttpStatusCode.TooManyRequests);
        Assert.InRange(int.Parse(stillLocked.Headers.GetValues("Retry-After").Single(), System.Globalization.CultureInfo.InvariantCulture), 800, 900);
        await app.AdminAsync();
    }

    [Fact]
    public async Task Me_WithAndWithoutSession_IsUserOrUnauthorized()
    {
        var admin = await app.AdminAsync();

        Assert.Equal(StudioFlowApp.AdminUser, (await admin.Client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectAsync<SessionDto>()).Username);
        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));
    }

    [Fact]
    public async Task Me_ForgedCookie_IsUnauthorized()
    {
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("Cookie", "sf_session=CfDJ8forged");

        await client.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Logout_WithSession_ExpiresCookie()
    {
        var admin = await app.AdminAsync();

        using var response = await admin.Client.PostAsync("/api/auth/logout", null, TestContext.Current.CancellationToken);

        await response.ExpectAsync(HttpStatusCode.NoContent);
        Assert.Contains(response.Headers.GetValues("Set-Cookie"), c => c.StartsWith("sf_session=;", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Logout_WithCookieButWithoutCsrfHeader_IsForbidden()
    {
        var admin = await app.AdminAsync();
        admin.Client.DefaultRequestHeaders.Remove("X-StudioFlow");

        Assert.Equal(ErrorCodes.Forbidden, await admin.Client.PostAsync("/api/auth/logout", null, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
    }
}

public sealed class ProductionModeTests(ProductionModeApp app) : IClassFixture<ProductionModeApp>
{
    [Fact]
    public async Task Login_ProductionEnvironment_CookieIsSecure()
    {
        using var response = await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword));

        await response.ExpectAsync(HttpStatusCode.OK);
        Assert.Contains("secure", response.Headers.GetValues("Set-Cookie").Single().ToLowerInvariant(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task OpenApi_ProductionEnvironment_IsNotServed() => await app.Anonymous().GetAsync("/openapi/v1.json", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NotFound);
}

public sealed class SecurityTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    public static TheoryData<string, string> AdminRoutes => new()
    {
        { "GET", "/api/productions" },
        { "POST", "/api/productions" },
        { "GET", "/api/productions/prd_x/snapshot" },
        { "POST", "/api/productions/prd_x/program" },
        { "POST", "/api/productions/prd_x/scenes" },
        { "DELETE", "/api/productions/prd_x/devices/dev_x" },
        { "GET", "/api/productions/prd_x/pairing/phone-invite" },
        { "GET", "/api/productions/prd_x/assets" },
        { "POST", "/api/productions/prd_x/output/links" },
        { "PATCH", "/api/productions/prd_x/output/links/olk_x" },
        { "PUT", "/api/productions/prd_x/output/links/olk_x/access" },
        { "POST", "/api/productions/prd_x/output/links/olk_x/regenerate-key" },
        { "DELETE", "/api/productions/prd_x/output/links/olk_x" },
        { "GET", "/api/audit" },
        { "GET", "/api/audit/export.csv" },
        { "GET", "/api/audit/export.json" },
    };

    [Theory]
    [MemberData(nameof(AdminRoutes))]
    public async Task AdminRoute_WithoutSession_IsUnauthorized(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) };

        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().SendAsync(request, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));
    }

    [Fact]
    public async Task AdminMutation_WithoutCsrfHeader_IsForbiddenAndChangesNothing()
    {
        var admin = await app.AdminAsync();
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        Assert.Equal(ErrorCodes.Forbidden, await client.PostJsonAsync("/api/productions", new CreateProductionRequest("CSRF")).ExpectProblemAsync(HttpStatusCode.Forbidden));
        client.DefaultRequestHeaders.Add("X-StudioFlow", "0");
        await client.PostJsonAsync("/api/productions", new CreateProductionRequest("CSRF")).ExpectProblemAsync(HttpStatusCode.Forbidden);
        Assert.DoesNotContain(await admin.Client.GetAsync("/api/productions", TestContext.Current.CancellationToken).ExpectAsync<List<ProductionSummaryDto>>(), p => p.Name == "CSRF");
        await client.GetAsync("/api/productions", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task DeviceRoute_WithAdminCookieButNoHeader_IsNotCsrfChecked()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        var device = app.DeviceClient(credentials);
        device.DefaultRequestHeaders.Add("Cookie", admin.Cookie);

        await device.PostJsonAsync("/api/device/report", new DeviceReportDto(RtcState.Connected, [], null, null, null, null, null)).ExpectAsync(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task JsonBody_LargerThan256Kb_IsRejectedWith413()
    {
        var admin = await app.AdminAsync();
        using var huge = new StringContent($$"""{"name":"{{new string('x', 300 * 1024)}}"}""", Encoding.UTF8, "application/json");

        Assert.Equal(ErrorCodes.UnsupportedMedia, await admin.Client.PostAsync("/api/productions", huge, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.RequestEntityTooLarge));
    }

    [Fact]
    public async Task Hub_ForeignOrigin_IsForbidden()
    {
        var client = app.Anonymous();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/hubs/output/negotiate?negotiateVersion=1");
        request.Headers.Add("Origin", "https://evil.example");

        Assert.Equal(ErrorCodes.Forbidden, await client.SendAsync(request, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden));
    }

    [Fact]
    public async Task Hub_SameOrigin_PassesTheOriginCheck()
    {
        var client = app.Anonymous();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/hubs/output/negotiate?negotiateVersion=1");
        request.Headers.Add("Origin", "http://localhost");

        await client.SendAsync(request, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Forbidden);
        using var sameHost = new HttpRequestMessage(HttpMethod.Post, "/hubs/studio/negotiate?negotiateVersion=1");
        sameHost.Headers.Add("Origin", "http://localhost");
        Assert.Equal(ErrorCodes.Unauthorized, await client.SendAsync(sameHost, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));
    }

    [Fact]
    public async Task AccessTokenQuery_OnRestRoute_IsIgnored()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);

        await app.Anonymous().GetAsync($"/api/device/me?access_token={credentials.DeviceId}.{credentials.DeviceSecret}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task UnknownRoute_IsProblemNotFound() =>
        Assert.Equal(ErrorCodes.NotFound, await app.Anonymous().GetAsync("/api/nothing-here", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.NotFound));

    [Fact]
    public async Task WrongMethod_IsProblemWithCode()
    {
        using var response = await app.Anonymous().DeleteAsync("/api/system/info", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    [Fact]
    public async Task Problem_InvalidEnum_IsValidationFailed()
    {
        var admin = await app.AdminAsync();
        using var content = new StringContent("""{"kind":"teleporter"}""", Encoding.UTF8, "application/json");

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/invites", content, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Problem_NumberAsString_IsRejected()
    {
        var admin = await app.AdminAsync();
        var scene = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes", new CreateSceneRequest("Strict", null)).ExpectAsync<SceneDto>(HttpStatusCode.Created);
        var credentials = await app.PairPhoneAsync(admin);
        using var content = new StringContent($$"""{"source":"{{credentials.DeviceId}}/camera","x":"10","y":null,"w":null,"h":null,"fit":null,"radius":null}""", Encoding.UTF8, "application/json");

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/scenes/{scene.Id}/items", content, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Health_LiveAndReady_AreHealthy()
    {
        var client = app.Anonymous();

        Assert.Equal("Healthy", await client.GetStringAsync("/health/live", TestContext.Current.CancellationToken));
        Assert.Equal("Healthy", await client.GetStringAsync("/health/ready", TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task SystemInfo_Admin_ReturnsBaseUrlAndAnonymousIsUnauthorized()
    {
        var admin = await app.AdminAsync();

        var info = await admin.Client.GetAsync("/api/system/info", TestContext.Current.CancellationToken).ExpectAsync<SystemInfoDto>();
        var anonymous = await app.Anonymous().GetAsync("/api/system/info", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);

        Assert.Equal(StudioFlowApp.PublicBaseUrl, info.PublicBaseUrl);
        Assert.Equal(AppVersion.Current, info.Version);
        Assert.Matches(@"^\d+\.\d+\.\d+(\+[0-9A-Za-z]{1,7})?$", info.Version);
        Assert.Equal(ErrorCodes.Unauthorized, anonymous);
    }

    [Fact]
    public async Task ResponseHeaders_DoNotRevealTheServer()
    {
        using var response = await app.Anonymous().GetAsync("/api/system/info", TestContext.Current.CancellationToken);

        Assert.False(response.Headers.Contains("Server"));
    }

    [Fact]
    public async Task Authorization_BasicScheme_OnDeviceRoute_IsUnauthorized()
    {
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", "YWRtaW46YWRtaW4=");

        await client.GetAsync("/api/device/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }
}
