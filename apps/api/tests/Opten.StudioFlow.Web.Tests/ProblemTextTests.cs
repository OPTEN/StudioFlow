using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Endpoints;
using Opten.StudioFlow.Web.Errors;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// The titles and details of problem details are English (#6): clients localise by <c>code</c> and never show them,
/// so the texts only have to be stable and readable in logs and API tools.
/// </summary>
public sealed class ProblemTextTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    [Theory]
    [InlineData(StatusCodes.Status400BadRequest, "Invalid input")]
    [InlineData(StatusCodes.Status401Unauthorized, "Not signed in")]
    [InlineData(StatusCodes.Status403Forbidden, "No access")]
    [InlineData(StatusCodes.Status404NotFound, "Not found")]
    [InlineData(StatusCodes.Status405MethodNotAllowed, "Not found")]
    [InlineData(StatusCodes.Status408RequestTimeout, "Request timeout")]
    [InlineData(StatusCodes.Status409Conflict, "Conflict")]
    [InlineData(StatusCodes.Status410Gone, "No longer valid")]
    [InlineData(StatusCodes.Status413PayloadTooLarge, "Too large")]
    [InlineData(StatusCodes.Status415UnsupportedMediaType, "Unsupported file type")]
    [InlineData(StatusCodes.Status429TooManyRequests, "Too many attempts")]
    [InlineData(StatusCodes.Status503ServiceUnavailable, "Temporarily unavailable")]
    [InlineData(StatusCodes.Status500InternalServerError, "Server error")]
    [InlineData(StatusCodes.Status502BadGateway, "Server error")]
    public void TitleFor_Status_IsTheEnglishTitle(int status, string title) => Assert.Equal(title, Problems.TitleFor(status));

    [Theory]
    [InlineData(1, "Too many failed attempts. Please try again in 1 minute.")]
    [InlineData(60, "Too many failed attempts. Please try again in 1 minute.")]
    [InlineData(61, "Too many failed attempts. Please try again in 2 minutes.")]
    [InlineData(900, "Too many failed attempts. Please try again in 15 minutes.")]
    public void LockoutDetail_Seconds_AreRoundedUpToMinutes(int seconds, string detail) => Assert.Equal(detail, AuthEndpoints.LockoutDetail(seconds));

    [Fact]
    public void Messages_DatabaseOutageAndBindingError_AreEnglish()
    {
        Assert.Equal("The database is currently not reachable. Please try again in a moment.", DatabaseOutage.Message);
        Assert.Equal("Invalid value.", JsonBindingErrors.InvalidValue);
    }

    [Fact]
    public async Task Login_WrongPassword_IsNotSignedInWithAnEnglishDetail()
    {
        var problem = await ProblemOfAsync(app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest("admin", "wrong")), HttpStatusCode.Unauthorized);

        Assert.Equal("Not signed in", problem.GetProperty("title").GetString());
        Assert.Equal("Username or password is incorrect.", problem.GetProperty("detail").GetString());
        Assert.Equal(ErrorCodes.Unauthorized, problem.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Login_FiveFailures_AnswersWithTheWaitInMinutes()
    {
        var client = app.Anonymous();
        for (var i = 0; i < 4; i++)
        {
            await client.PostJsonAsync("/api/auth/login", new LoginRequest("admin", $"wrong{i}")).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        }

        var locked = await ProblemOfAsync(client.PostJsonAsync("/api/auth/login", new LoginRequest("admin", "wrong5")), HttpStatusCode.TooManyRequests);

        Assert.Equal("Too many attempts", locked.GetProperty("title").GetString());
        Assert.Equal("Too many failed attempts. Please try again in 15 minutes.", locked.GetProperty("detail").GetString());
        Assert.Equal(ErrorCodes.RateLimited, locked.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Snapshot_UnknownProduction_IsNotFoundNamingTheEntity()
    {
        var admin = await app.AdminAsync();

        var problem = await ProblemOfAsync(admin.Client.GetAsync("/api/productions/prd_doesnotexist00/snapshot", TestContext.Current.CancellationToken), HttpStatusCode.NotFound);

        Assert.Equal("Not found", problem.GetProperty("title").GetString());
        Assert.Equal("Production was not found.", problem.GetProperty("detail").GetString());
        Assert.Equal(ErrorCodes.NotFound, problem.GetProperty("code").GetString());
    }

    [Fact]
    public async Task CreateScene_EmptyName_IsInvalidInputWithAnEnglishFieldMessage()
    {
        var admin = await app.AdminAsync();

        var problem = await ProblemOfAsync(admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes", new CreateSceneRequest("", null)), HttpStatusCode.BadRequest);

        Assert.Equal("Invalid input", problem.GetProperty("title").GetString());
        Assert.Equal("The input is invalid.", problem.GetProperty("detail").GetString());
        Assert.Equal(["Must be 1–80 characters long."], problem.GetProperty("errors").GetProperty("name").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task DeleteScene_LiveScene_IsAConflict()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Problem texts")).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var scenes = (await admin.Client.GetAsync($"/api/productions/{production.Id}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>()).Scenes;

        var problem = await ProblemOfAsync(admin.Client.DeleteAsync($"/api/productions/{production.Id}/scenes/{scenes[0].Id}", TestContext.Current.CancellationToken), HttpStatusCode.Conflict);

        Assert.Equal("Conflict", problem.GetProperty("title").GetString());
        Assert.Equal("The scene is live and cannot be deleted.", problem.GetProperty("detail").GetString());
        Assert.Equal(ErrorCodes.SceneIsLive, problem.GetProperty("code").GetString());
    }

    [Fact]
    public async Task AdminMutation_WithoutCsrfHeader_IsNoAccess()
    {
        var admin = await app.AdminAsync();
        admin.Client.DefaultRequestHeaders.Remove("X-StudioFlow");

        var problem = await ProblemOfAsync(admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("CSRF")), HttpStatusCode.Forbidden);

        Assert.Equal("No access", problem.GetProperty("title").GetString());
        Assert.Equal("The X-StudioFlow header is missing.", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Redeem_UnknownToken_IsNoLongerValid()
    {
        var problem = await ProblemOfAsync(
            app.Anonymous().PostJsonAsync("/api/pairing/invites/not-a-token/redeem", new RedeemInviteRequest("c", "Lea", DeviceKind.Laptop, "Mac")),
            HttpStatusCode.Gone);

        Assert.Equal("No longer valid", problem.GetProperty("title").GetString());
        Assert.Equal("The invite has expired or has already been used.", problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task UnknownRoute_IsNotFoundWithAnEnglishTitle()
    {
        using var response = await app.Anonymous().GetAsync("/api/does-not-exist", TestContext.Current.CancellationToken);

        await response.ExpectAsync(HttpStatusCode.NotFound);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("Not found", json.RootElement.GetProperty("title").GetString());
    }

    private static async Task<JsonElement> ProblemOfAsync(Task<HttpResponseMessage> request, HttpStatusCode status)
    {
        using var response = await request;
        await response.ExpectAsync(status);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        return json.RootElement.Clone();
    }
}
