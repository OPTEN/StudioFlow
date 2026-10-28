using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Infrastructure.LiveKit;
using Opten.StudioFlow.Infrastructure.Media;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Infrastructure.Security;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

public sealed class MediaInspectorTests
{
    public static TheoryData<byte[], string> Allowed => new()
    {
        { MediaSamples.Png(10, 10), "image/png" },
        { MediaSamples.Jpeg(10, 10), "image/jpeg" },
        { MediaSamples.WebPLossy(10, 10), "image/webp" },
        { MediaSamples.Mp4("isom"), "video/mp4" },
        { MediaSamples.Mp4("mp42"), "video/mp4" },
        { MediaSamples.WebM(), "video/webm" },
    };

    public static TheoryData<byte[]> Rejected => new()
    {
        MediaSamples.Gif(),
        MediaSamples.Svg(),
        MediaSamples.Mp4("avif"),
        MediaSamples.Mp4("heic"),
        MediaSamples.Mp4("qt  "),
        MediaSamples.WebM("matroska"),
        "%PDF-1.7"u8.ToArray(),
        Array.Empty<byte>(),
        new byte[] { 0xFF, 0xD8 },
    };

    [Theory]
    [MemberData(nameof(Allowed))]
    public void Detect_AllowedType_IsRecognised(byte[] header, string contentType) => Assert.Equal(contentType, MediaInspector.Detect(header)?.ContentType);

    [Theory]
    [MemberData(nameof(Rejected))]
    public void Detect_OtherType_IsRejected(byte[] header) => Assert.Null(MediaInspector.Detect(header));

    [Fact]
    public void ReadImageSize_Png_ReadsIhdr() => Assert.Equal((1920, 1080), Size(MediaSamples.Png(1920, 1080), MediaInspector.Png));

    [Fact]
    public void ReadImageSize_JpegWithExif_FindsFrameHeader() => Assert.Equal((4032, 3024), Size(MediaSamples.Jpeg(4032, 3024, 40_000), MediaInspector.Jpeg));

    [Fact]
    public void ReadImageSize_WebPVariants_AreRead()
    {
        Assert.Equal((640, 360), Size(MediaSamples.WebPLossy(640, 360), MediaInspector.WebP));
        Assert.Equal((800, 600), Size(MediaSamples.WebPLossless(800, 600), MediaInspector.WebP));
        Assert.Equal((5000, 3000), Size(MediaSamples.WebPExtended(5000, 3000), MediaInspector.WebP));
    }

    [Fact]
    public void ReadImageSize_TruncatedOrBrokenJpeg_IsNull()
    {
        Assert.Null(Size([0xFF, 0xD8, 0xFF, 0xE1, 0x10], MediaInspector.Jpeg));
        Assert.Null(Size([0xFF, 0xD8, 0xFF, 0xFF, 0xFF], MediaInspector.Jpeg));
        Assert.Null(Size([0xFF, 0xD8, 0x00, 0x00], MediaInspector.Jpeg));
    }

    [Theory]
    [InlineData(0, 100, false)]
    [InlineData(16_384, 16_384, true)]
    [InlineData(16_385, 1, false)]
    [InlineData(60_000, 60_000, false)]
    public void IsAcceptedSize_PngDimensions_OnlyOneTo16384(int width, int height, bool accepted) =>
        Assert.Equal(accepted, MediaInspector.IsAcceptedSize(Size(MediaSamples.Png(width, height), MediaInspector.Png)));

    [Theory]
    [InlineData("iso5", "mp41", true)]
    [InlineData("dash", "iso6", false)]
    [InlineData("mif1", "mp42", false)]
    [InlineData("M4V ", "", true)]
    public void Detect_Mp4CompatibleBrands_FollowTheAllowList(string major, string compatible, bool accepted)
    {
        var header = MediaSamples.Mp4(major);
        System.Text.Encoding.ASCII.GetBytes(compatible).CopyTo(header, 16);

        Assert.Equal(accepted, MediaInspector.Detect(header) is not null);
    }

    private static (int, int)? Size(byte[] bytes, MediaType type)
    {
        using var stream = new MemoryStream(bytes);
        return MediaInspector.ReadImageSize(stream, type);
    }
}

public sealed class FileMediaStoreTests : IDisposable
{
    private const string ProductionId = "prd_aaaaaaaaaaaaaaaa";
    private readonly string root = Path.Combine(Path.GetTempPath(), "sf-store-" + Guid.NewGuid().ToString("N"));
    private readonly FileMediaStore store;

    public FileMediaStoreTests() => store = new FileMediaStore(Options.Create(new MediaOptions { Path = root, MaxImageBytes = 1000, MaxVideoBytes = 2000 }));

    [Fact]
    public async Task StoreAsync_Png_WritesFileWithDimensions()
    {
        var stored = await store.StoreAsync(ProductionId, "ast_bbbbbbbbbbbbbbbb", new MemoryStream(MediaSamples.Png(32, 16, 500)), 500, CancellationToken.None);

        Assert.Equal(("image/png", "ast_bbbbbbbbbbbbbbbb.png", 500L, 32, 16), (stored.ContentType, stored.FileName, stored.SizeBytes, stored.Width!.Value, stored.Height!.Value));
        Assert.True(File.Exists(store.GetPath(ProductionId, stored.FileName)));
        Assert.Single(Directory.GetFiles(Path.Combine(root, ProductionId)));
    }

    [Fact]
    public async Task StoreAsync_LyingLength_IsStoppedAtTheLimitAndLeavesNoFile()
    {
        var error = await Assert.ThrowsAsync<Core.Domain.StudioFlowException>(() =>
            store.StoreAsync(ProductionId, "ast_cccccccccccccccc", new MemoryStream(MediaSamples.Png(1, 1, 5000)), 10, CancellationToken.None));

        Assert.Equal(Core.Domain.ErrorKind.PayloadTooLarge, error.Kind);
        Assert.Empty(Directory.GetFiles(Path.Combine(root, ProductionId)));
    }

    [Fact]
    public async Task StoreAsync_DeclaredTooLarge_FailsBeforeWriting()
    {
        await Assert.ThrowsAsync<Core.Domain.StudioFlowException>(() =>
            store.StoreAsync(ProductionId, "ast_dddddddddddddddd", new MemoryStream(MediaSamples.Mp4()), 5000, CancellationToken.None));

        Assert.False(Directory.Exists(Path.Combine(root, ProductionId)));
    }

    [Fact]
    public async Task StoreAsync_Svg_IsUnsupported()
    {
        var error = await Assert.ThrowsAsync<Core.Domain.StudioFlowException>(() =>
            store.StoreAsync(ProductionId, "ast_eeeeeeeeeeeeeeee", new MemoryStream(MediaSamples.Svg()), null, CancellationToken.None));

        Assert.Equal(ErrorCodes.UnsupportedMedia, error.Code);
        Assert.Equal(Core.Domain.ErrorKind.UnsupportedMedia, error.Kind);
    }

    [Theory]
    [InlineData("../prd_aaaaaaaaaaaaaaaa", "ast_x.png")]
    [InlineData(ProductionId, "../../secret.png")]
    [InlineData(ProductionId, "ast_bbbbbbbbbbbbbbbb.exe")]
    [InlineData(ProductionId, "noextension")]
    public void GetPath_PathTraversal_IsRejected(string productionId, string fileName) => Assert.Null(store.GetPath(productionId, fileName));

    [Fact]
    public async Task Delete_ExistingAndMissing_DoesNotThrow()
    {
        var stored = await store.StoreAsync(ProductionId, "ast_ffffffffffffffff", new MemoryStream(MediaSamples.WebM()), null, CancellationToken.None);

        store.Delete(ProductionId, stored.FileName);
        store.Delete(ProductionId, stored.FileName);

        Assert.Null(store.GetPath(ProductionId, stored.FileName));
    }

    public void Dispose()
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
}

public sealed class LiveKitTokenIssuerTests
{
    private static readonly TimeProvider Clock = TimeProvider.System;

    private static LiveKitTokenIssuer Issuer(string publicUrl = "", HttpContext? request = null, string baseUrl = "https://studioflow.example.com/") => new(
        Options.Create(new LiveKitOptions { ApiKey = "key", ApiSecret = "sk-secret-with-more-than-thirty-two-chars", PublicUrl = publicUrl }),
        Options.Create(new StudioFlowOptions { PublicBaseUrl = baseUrl }),
        Clock,
        new HttpContextAccessor { HttpContext = request });

    /// <summary>A request as the API sees it behind Caddy: the Host of the browser (the scheme is not used, the base URL decides).</summary>
    private static DefaultHttpContext Request(string host, string scheme = "http")
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = scheme;
        context.Request.Host = new HostString(host);
        return context;
    }

    public static TheoryData<string, string> CallerAddresses => new()
    {
        { "127.0.0.1:8491", "wss://127.0.0.1:8491" },
        { "localhost:8491", "wss://localhost:8491" },
        { "studioflow.example.com", "wss://studioflow.example.com" },
        { "studioflow.example.com:9443", "wss://studioflow.example.com:9443" },
        { "192.168.1.50:8443", "wss://192.168.1.50:8443" },
        { "[::1]:8443", "wss://[::1]:8443" },
    };

    [Theory]
    [MemberData(nameof(CallerAddresses))]
    public void ClientUrl_ARequest_IsTheAddressTheCallerUsed(string host, string expected)
    {
        // A page opened by the IP address or a second name connects to that same name: it is the one its Content-Security-Policy allows.
        // The request may arrive as plain http (the API sits behind Caddy; a direct call has no forwarded protocol): the base URL says https.
        var dto = Issuer(request: Request(host)).IssueViewerToken("prd_x", "studio_a", "Regie");

        Assert.Equal(expected, dto.Url);
    }

    [Fact]
    public void ClientUrl_AnHttpBaseUrl_GivesPlainWebSocketsOnTheHostOfTheRequest()
    {
        // Development: the API is reached over http (appsettings.Development.json).
        var dto = Issuer(request: Request("localhost:5298"), baseUrl: "http://localhost:5298").IssueViewerToken("prd_x", "studio_a", "Regie");

        Assert.Equal("ws://localhost:5298", dto.Url);
    }

    [Fact]
    public void ClientUrl_PublicUrlConfigured_WinsOverTheRequest()
    {
        var dto = Issuer("wss://media.example.com", Request("127.0.0.1:8491")).IssueSenderToken("prd_x", "dev_a", "Phone 1");

        Assert.Equal("wss://media.example.com", dto.Url);
    }

    [Fact]
    public void ClientUrl_NoRequest_IsTheBaseUrlOfTheServer()
    {
        // The wizard test, background work: no caller, so the address of the server settings.
        Assert.Equal("wss://studioflow.example.com", Issuer().IssueViewerToken("prd_x", "studio_a", "Regie").Url);
        Assert.Equal("wss://studioflow.example.com", Issuer(request: new DefaultHttpContext()).IssueViewerToken("prd_x", "studio_a", "Regie").Url);
    }

    [Theory]
    [InlineData("evil.example/path")]
    [InlineData("user@evil.example")]
    [InlineData("evil.example?x=1")]
    [InlineData("evil example")]
    public void ClientUrl_AHostThatIsNotHostAndPort_IsNotUsed(string host)
    {
        var dto = Issuer(request: Request(host)).IssueViewerToken("prd_x", "studio_a", "Regie");

        Assert.Equal("wss://studioflow.example.com", dto.Url);
    }

    [Fact]
    public void IssueSenderToken_Claims_MatchTheSenderGrant()
    {
        var dto = Issuer().IssueSenderToken("prd_x", "dev_a", "Phone 1");
        var token = new JsonWebToken(dto.Token);
        using var video = JsonDocument.Parse(token.GetPayloadValue<JsonElement>("video").GetRawText());

        Assert.Equal("wss://studioflow.example.com", dto.Url);
        Assert.Equal("key", token.Issuer);
        Assert.Equal("dev_a", token.Subject);
        Assert.Equal("Phone 1", token.GetPayloadValue<string>("name"));
        Assert.Equal("""{"role":"sender"}""", token.GetPayloadValue<string>("metadata"));
        Assert.Equal("HS256", token.Alg);
        Assert.InRange((token.ValidTo - token.ValidFrom).TotalMinutes, 9.99, 10.01);
        Assert.True(video.RootElement.GetProperty("roomJoin").GetBoolean());
        Assert.Equal("prd_x", video.RootElement.GetProperty("room").GetString());
        Assert.True(video.RootElement.GetProperty("canPublish").GetBoolean());
        Assert.False(video.RootElement.GetProperty("canSubscribe").GetBoolean());
        Assert.False(video.RootElement.GetProperty("canPublishData").GetBoolean());
        Assert.Equal(["camera", "screen_share", "microphone", "screen_share_audio"], video.RootElement.GetProperty("canPublishSources").EnumerateArray().Select(e => e.GetString()));
        Assert.False(video.RootElement.TryGetProperty("hidden", out _));
    }

    [Fact]
    public void IssueViewerToken_Claims_AreHiddenSubscriberWithoutPublish()
    {
        var dto = Issuer("ws://localhost:7880").IssueViewerToken("prd_x", "output_webinar_abc", "Output");
        using var video = JsonDocument.Parse(new JsonWebToken(dto.Token).GetPayloadValue<JsonElement>("video").GetRawText());

        Assert.Equal("ws://localhost:7880", dto.Url);
        Assert.Equal("output_webinar_abc", dto.Identity);
        Assert.True(video.RootElement.GetProperty("hidden").GetBoolean());
        Assert.True(video.RootElement.GetProperty("canSubscribe").GetBoolean());
        Assert.False(video.RootElement.GetProperty("canPublish").GetBoolean());
    }

    [Fact]
    public void CreateAdminToken_Room_HasRoomAdminGrant()
    {
        var token = new JsonWebToken(Issuer().CreateAdminToken("prd_x"));
        using var video = JsonDocument.Parse(token.GetPayloadValue<JsonElement>("video").GetRawText());

        Assert.True(video.RootElement.GetProperty("roomAdmin").GetBoolean());
        Assert.Equal("prd_x", video.RootElement.GetProperty("room").GetString());
    }
}

public sealed class LiveKitWebhookReceiverTests
{
    private const string Body = """{"event":"track_published","room":{"sid":"RM_1","name":"prd_x"},"participant":{"sid":"PA_1","identity":"dev_a"},"track":{"name":"screen-2"}}""";

    private static readonly LiveKitWebhookReceiver Receiver = new(Options.Create(new LiveKitOptions { ApiKey = StudioFlowApp.LiveKitKey, ApiSecret = StudioFlowApp.LiveKitSecret }));

    [Fact]
    public async Task VerifyAsync_ValidSignature_IsTrue() => Assert.True(await Receiver.VerifyAsync(Webhooks.Sign(Body), Encoding.UTF8.GetBytes(Body)));

    [Fact]
    public async Task VerifyAsync_TamperedBody_IsFalse() => Assert.False(await Receiver.VerifyAsync(Webhooks.Sign(Body), Encoding.UTF8.GetBytes(Body.Replace("screen-2", "screen-3", StringComparison.Ordinal))));

    [Fact]
    public async Task VerifyAsync_BearerPrefix_IsFalse() => Assert.False(await Receiver.VerifyAsync("Bearer " + Webhooks.Sign(Body), Encoding.UTF8.GetBytes(Body)));

    [Fact]
    public async Task VerifyAsync_WrongSecretIssuerOrExpired_IsFalse()
    {
        var body = Encoding.UTF8.GetBytes(Body);

        Assert.False(await Receiver.VerifyAsync(Webhooks.Sign(Body, secret: "another-secret-with-more-than-32-characters"), body));
        Assert.False(await Receiver.VerifyAsync(Webhooks.Sign(Body, issuer: "otherkey"), body));
        Assert.False(await Receiver.VerifyAsync(Webhooks.Sign(Body, lifetime: TimeSpan.FromMinutes(-5)), body));
        Assert.False(await Receiver.VerifyAsync(Webhooks.Sign(Body, hashOverride: "AAAA"), body));
        Assert.False(await Receiver.VerifyAsync(null, body));
        Assert.False(await Receiver.VerifyAsync("not-a-jwt", body));
    }

    [Fact]
    public void Parse_TrackEvent_MapsKindAndIds()
    {
        var parsed = LiveKitWebhookReceiver.Parse(Encoding.UTF8.GetBytes(Body))!;

        Assert.Equal(new LiveKitEvent(LiveKitEventKind.TrackPublished, "prd_x", "RM_1", "PA_1", "dev_a", "screen-2"), parsed);
    }

    [Theory]
    [InlineData("""{"event":"participant_connection_aborted","room":{"name":"prd_x"},"participant":{"sid":"PA_1"}}""", LiveKitEventKind.ParticipantLeft)]
    [InlineData("""{"event":"room_started","room":{"name":"prd_x"},"createdAt":"1792660682"}""", LiveKitEventKind.Other)]
    [InlineData("""{"event":"room_finished","room":{"sid":"RM_9","name":"prd_x"},"numParticipants":"3"}""", LiveKitEventKind.RoomFinished)]
    public void Parse_EventNames_AreMapped(string body, LiveKitEventKind kind) => Assert.Equal(kind, LiveKitWebhookReceiver.Parse(Encoding.UTF8.GetBytes(body))!.Kind);

    [Theory]
    [InlineData("not json")]
    [InlineData("""{"event":"track_published"}""")]
    [InlineData("[]")]
    public void Parse_Malformed_IsNull(string body) => Assert.Null(LiveKitWebhookReceiver.Parse(Encoding.UTF8.GetBytes(body)));
}

public sealed class LiveKitRoomClientTests
{
    private static (LiveKitRoomClient Client, StubHandler Handler) Create(HttpStatusCode status, string body, TimeSpan? delay = null, TimeSpan? timeout = null)
    {
        var handler = new StubHandler(status, body, delay ?? TimeSpan.Zero);
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://livekit:7880/") };
        var issuer = new LiveKitTokenIssuer(
            Options.Create(new LiveKitOptions { ApiKey = "key", ApiSecret = "sk-secret-with-more-than-thirty-two-chars" }),
            Options.Create(new StudioFlowOptions()),
            TimeProvider.System);
        return (new LiveKitRoomClient(http, issuer, Options.Create(new LiveKitOptions { RequestTimeout = timeout ?? TimeSpan.FromSeconds(5) })), handler);
    }

    [Fact]
    public async Task ListParticipantsAsync_SnakeCaseResponse_IsParsed()
    {
        var (client, handler) = Create(HttpStatusCode.OK, """{"participants":[{"sid":"PA_1","identity":"dev_a","joined_at":"1792660682","tracks":[{"sid":"TR_1","name":"camera","mime_type":"video/H264","width":1280}]},{"sid":"","identity":"x"}]}""");

        var participants = await client.ListParticipantsAsync("prd_x", CancellationToken.None);

        Assert.Equal("dev_a", Assert.Single(participants).Identity);
        Assert.Equal(["camera"], participants[0].TrackNames);
        Assert.Equal("/twirp/livekit.RoomService/ListParticipants", handler.LastRequest!.RequestUri!.AbsolutePath);
        Assert.Equal("Bearer", handler.LastRequest.Headers.Authorization!.Scheme);
        Assert.Equal("""{"room":"prd_x"}""", handler.LastBody);
    }

    [Fact]
    public async Task RemoveParticipantAsync_NotInRoom_IsNotAnError()
    {
        var (client, _) = Create(HttpStatusCode.NotFound, """{"code":"not_found","msg":"participant does not exist"}""");

        await client.RemoveParticipantAsync("prd_x", "dev_a", CancellationToken.None);
    }

    [Fact]
    public async Task ListParticipantsAsync_ServerError_IsUnavailable()
    {
        var (client, _) = Create(HttpStatusCode.Unauthorized, """{"code":"unauthenticated","msg":"invalid API key"}""");

        var error = await Assert.ThrowsAsync<LiveKitUnavailableException>(() => client.ListParticipantsAsync("prd_x", CancellationToken.None));

        Assert.Contains("401", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ListParticipantsAsync_Unreachable_IsUnavailable()
    {
        var issuer = new LiveKitTokenIssuer(Options.Create(new LiveKitOptions { ApiKey = "k", ApiSecret = "sk-secret-with-more-than-thirty-two-chars" }), Options.Create(new StudioFlowOptions()), TimeProvider.System);
        using var http = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:1/"), Timeout = TimeSpan.FromSeconds(2) };

        await Assert.ThrowsAsync<LiveKitUnavailableException>(() => new LiveKitRoomClient(http, issuer, Options.Create(new LiveKitOptions())).ListParticipantsAsync("prd_x", CancellationToken.None));
    }

    [Fact]
    public async Task RemoveParticipantAsync_LiveKitHangs_TimesOutAsUnavailable()
    {
        var (client, _) = Create(HttpStatusCode.OK, "{}", delay: TimeSpan.FromSeconds(30), timeout: TimeSpan.FromMilliseconds(200));
        var watch = System.Diagnostics.Stopwatch.StartNew();

        var error = await Assert.ThrowsAsync<LiveKitUnavailableException>(() => client.RemoveParticipantAsync("prd_x", "dev_a", CancellationToken.None));

        Assert.Contains("timed out", error.Message, StringComparison.Ordinal);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5), $"took {watch.Elapsed}");
    }

    [Fact]
    public async Task ListParticipantsAsync_GarbageBody_IsUnavailable()
    {
        var (client, _) = Create(HttpStatusCode.OK, "<html>");

        await Assert.ThrowsAsync<LiveKitUnavailableException>(() => client.ListParticipantsAsync("prd_x", CancellationToken.None));
    }

    private sealed class StubHandler(HttpStatusCode status, string body, TimeSpan delay) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }

        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequest = request;
            LastBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            await Task.Delay(delay, cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }
}

public sealed class AdminPasswordHasherTests
{
    private readonly AdminPasswordHasher hasher = new();

    [Fact]
    public void Check_Password_AcceptsOnlyTheRightOne()
    {
        var hash = hasher.Hash("correct horse battery");

        Assert.Equal(PasswordCheck.Succeeded, hasher.Check(hash, "correct horse battery"));
        Assert.Equal(PasswordCheck.Failed, hasher.Check(hash, "Correct horse battery"));
        Assert.Equal(PasswordCheck.Failed, hasher.Check(hash, string.Empty));
    }

    [Fact]
    public void Check_CorruptHash_Fails() => Assert.Equal(PasswordCheck.Failed, hasher.Check("%%%not-base64%%%", "x"));

    [Fact]
    public void Hash_SamePassword_UsesRandomSalt() => Assert.NotEqual(hasher.Hash("x"), hasher.Hash("x"));

    [Fact]
    public void Hash_IsAnIdentityV3Hash() => Assert.StartsWith("AQAAAA", hasher.Hash("x"), StringComparison.Ordinal);

    [Fact]
    public void Hash_StoresTheCurrentIterationCountInTheHash()
    {
        Assert.Equal(AdminPasswordHasher.IterationCount, IterationCountOf(hasher.Hash("x")));
        Assert.True(AdminPasswordHasher.IterationCount >= 210_000, "OWASP guidance for PBKDF2-HMAC-SHA512");
    }

    [Fact]
    public void Check_FreshHash_NeedsNoRehash() => Assert.Equal(PasswordCheck.Succeeded, hasher.Check(hasher.Hash("secret-password"), "secret-password"));

    [Fact]
    public void Check_HashWithTheOldHundredThousandIterations_StillVerifiesAndAsksForARehash()
    {
        var old = OldHash("secret-password", 100_000);

        Assert.Equal(100_000, IterationCountOf(old));
        Assert.Equal(PasswordCheck.SucceededRehashNeeded, hasher.Check(old, "secret-password"));
        Assert.Equal(PasswordCheck.Failed, hasher.Check(old, "other-password"));
    }

    [Fact]
    public void Check_HashWithMoreIterationsThanTheCurrentOnes_NeedsNoRehash() =>
        Assert.Equal(PasswordCheck.Succeeded, hasher.Check(OldHash("secret-password", AdminPasswordHasher.IterationCount + 1), "secret-password"));

    /// <summary>A hash as the earlier versions made it (Identity v3 with a lower iteration count).</summary>
    internal static string OldHash(string password, int iterations) =>
        new PasswordHasher<object>(Options.Create(new PasswordHasherOptions { IterationCount = iterations })).HashPassword(new object(), password);

    /// <summary>The iteration count of an Identity v3 hash: byte 0 is the format marker, 1-4 the PRF, 5-8 the count (big endian).</summary>
    internal static int IterationCountOf(string hash) =>
        System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(Convert.FromBase64String(hash).AsSpan(5, 4));
}

public sealed class SnakeCaseTests
{
    [Theory]
    [InlineData("ProductionId", "production_id")]
    [InlineData("OutputKeyCreatedAt", "output_key_created_at")]
    [InlineData("Id", "id")]
    [InlineData("SizeBytes", "size_bytes")]
    public void ToSnakeCase_PascalCase_IsConverted(string input, string expected) => Assert.Equal(expected, StudioFlowDbContext.ToSnakeCase(input));
}
