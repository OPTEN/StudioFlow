using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Tests.Support;

namespace Opten.FlowStudio.Web.Tests;

/// <summary>
/// Request handling details: webhook content types (BUG-05), binding errors that name the field (BUG-08) and HEAD on
/// the asset content (BUG-16).
/// </summary>
public sealed class RequestContractTests(FlowStudioApp app) : IClassFixture<FlowStudioApp>
{
    [Theory]
    [InlineData("application/webhook+json")]
    [InlineData("application/json")]
    public async Task Webhook_LiveKitOrPlainJsonContentType_IsAccepted(string contentType)
    {
        var admin = await app.AdminAsync();
        var body = Webhooks.Participant("participant_joined", admin.ProductionId, "PA_ct", "dev_cccccccccccccccc");

        await app.Anonymous().SendAsync(Webhooks.Request(body, Webhooks.Sign(body), contentType), TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Webhook_OtherContentType_IsUnsupported()
    {
        var admin = await app.AdminAsync();
        var body = Webhooks.Participant("participant_joined", admin.ProductionId, "PA_ct", "dev_cccccccccccccccc");

        await app.Anonymous().SendAsync(Webhooks.Request(body, Webhooks.Sign(body), "text/plain"), TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.UnsupportedMediaType);
    }

    [Fact]
    public async Task CreatePairingRequest_UnknownEnumText_IsValidationFailedNamingTheField()
    {
        var problem = await PostRawAsync(app.Anonymous(), "/api/pairing/requests", """{"name":"Laptop","kind":"tablet","platform":"x"}""");

        Assert.Equal(HttpStatusCode.BadRequest, problem.Status);
        Assert.Equal(ErrorCodes.ValidationFailed, problem.Code);
        Assert.Equal(["kind"], problem.Fields);
        AssertNoInternals(problem.Body);
    }

    [Fact]
    public async Task ReplaceSceneItems_UnknownEnumInAnItem_NamesTheCamelCasePath()
    {
        var admin = await app.AdminAsync();
        var snapshot = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
        const string body = """
            {"items":[{"id":"itm_abcd","source":"ast_aaaaaaaaaaaaaaaa","x":0,"y":0,"w":100,"h":100,"Fit":"stretch","crop":{"top":0,"right":0,"bottom":0,"left":0},"radius":0,"mirror":false,"rotation":0,"hidden":false,"border":null,"onLost":{"holdMs":3000,"fallbackSource":null}}],"layoutMode":null}
            """;

        var problem = await PutRawAsync(admin.Client, $"/api/productions/{admin.ProductionId}/scenes/{snapshot.Scenes[0].Id}/items", body);

        Assert.Equal(HttpStatusCode.BadRequest, problem.Status);
        Assert.Equal(ErrorCodes.ValidationFailed, problem.Code);
        Assert.Equal(["items[0].fit"], problem.Fields);
        AssertNoInternals(problem.Body);
    }

    [Theory]
    [InlineData("""{"name":"Laptop","kind":"laptop","platform":5}""", "platform")]
    [InlineData("""{"name":"Laptop",""", "body")]
    [InlineData("""[1,2]""", "body")]
    public async Task CreatePairingRequest_WrongTypeOrBrokenJson_IsValidationFailedNamingTheField(string body, string field)
    {
        var problem = await PostRawAsync(app.Anonymous(), "/api/pairing/requests", body);

        Assert.Equal(HttpStatusCode.BadRequest, problem.Status);
        Assert.Equal(ErrorCodes.ValidationFailed, problem.Code);
        Assert.Equal([field], problem.Fields);
        AssertNoInternals(problem.Body);
    }

    [Fact]
    public async Task ContentHead_OutputKey_HasTheHeadersOfGetWithoutBody()
    {
        var admin = await app.AdminAsync();
        var bytes = MediaSamples.Png(64, 32, 3000);
        var asset = await UploadAsync(admin, bytes, "head.png");
        var key = await OutputKeyAsync(admin);

        using var get = await app.Anonymous().GetAsync($"{asset.ContentUrl}?k={key}", TestContext.Current.CancellationToken);
        using var headRequest = new HttpRequestMessage(HttpMethod.Head, $"{asset.ContentUrl}?k={key}");
        using var head = await app.Anonymous().SendAsync(headRequest, TestContext.Current.CancellationToken);

        await head.ExpectAsync(HttpStatusCode.OK);
        Assert.Empty(await head.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        Assert.Equal("image/png", head.Content.Headers.ContentType!.MediaType);
        Assert.Equal(bytes.Length, head.Content.Headers.ContentLength);
        Assert.Equal("nosniff", head.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(get.Headers.ETag, head.Headers.ETag);
        Assert.Equal("bytes", head.Headers.AcceptRanges.Single());
        Assert.Equal(get.Headers.CacheControl, head.Headers.CacheControl);
        Assert.Equal(get.Content.Headers.ContentDisposition, head.Content.Headers.ContentDisposition);
        Assert.Equal(get.Headers.GetValues("Content-Security-Policy"), head.Headers.GetValues("Content-Security-Policy"));
    }

    [Fact]
    public async Task ContentHead_WithRange_AnswersPartialContentHeaders()
    {
        var admin = await app.AdminAsync();
        var asset = await UploadAsync(admin, MediaSamples.Png(64, 32, 3000), "head-range.png");
        var key = await OutputKeyAsync(admin);
        using var request = new HttpRequestMessage(HttpMethod.Head, $"{asset.ContentUrl}?k={key}");
        request.Headers.Range = new RangeHeaderValue(10, 19);

        using var head = await app.Anonymous().SendAsync(request, TestContext.Current.CancellationToken);

        await head.ExpectAsync(HttpStatusCode.PartialContent);
        Assert.Empty(await head.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        Assert.Equal(10, head.Content.Headers.ContentLength);
        Assert.Equal((10L, 19L, 3000L), (head.Content.Headers.ContentRange!.From!.Value, head.Content.Headers.ContentRange.To!.Value, head.Content.Headers.ContentRange.Length!.Value));
    }

    [Fact]
    public async Task ContentHead_WithoutCredential_IsUnauthorizedLikeGet()
    {
        var admin = await app.AdminAsync();
        var asset = await UploadAsync(admin, MediaSamples.Png(1, 1), "head-anon.png");
        using var request = new HttpRequestMessage(HttpMethod.Head, asset.ContentUrl);

        using var head = await app.Anonymous().SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, head.StatusCode);
    }

    private static void AssertNoInternals(string body)
    {
        Assert.DoesNotContain("Opten.", body, StringComparison.Ordinal);
        Assert.DoesNotContain("System.", body, StringComparison.Ordinal);
        Assert.DoesNotContain("LineNumber", body, StringComparison.Ordinal);
        Assert.DoesNotContain("BytePosition", body, StringComparison.Ordinal);
    }

    private static async Task<Problem> PostRawAsync(HttpClient client, string url, string json)
    {
        using var response = await client.PostAsync(url, new StringContent(json, Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken);
        return await Problem.ReadAsync(response);
    }

    private static async Task<Problem> PutRawAsync(HttpClient client, string url, string json)
    {
        using var response = await client.PutAsync(url, new StringContent(json, Encoding.UTF8, "application/json"), TestContext.Current.CancellationToken);
        return await Problem.ReadAsync(response);
    }

    private static async Task<string> OutputKeyAsync(AdminSession admin)
    {
        var settings = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        return settings.Url[(settings.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];
    }

    private static Task<AssetDto> UploadAsync(AdminSession admin, byte[] bytes, string fileName)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        content.Add(file, "file", fileName);
        return admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", content).ExpectAsync<AssetDto>(HttpStatusCode.Created);
    }

    /// <summary>The parts of a problem response these tests look at.</summary>
    private sealed record Problem(HttpStatusCode Status, string? Code, string[] Fields, string Body)
    {
        public static async Task<Problem> ReadAsync(HttpResponseMessage response)
        {
            var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            var code = root.TryGetProperty("code", out var c) ? c.GetString() : null;
            string[] fields = root.TryGetProperty("errors", out var errors) ? [.. errors.EnumerateObject().Select(e => e.Name)] : [];
            return new Problem(response.StatusCode, code, fields, body);
        }
    }
}
