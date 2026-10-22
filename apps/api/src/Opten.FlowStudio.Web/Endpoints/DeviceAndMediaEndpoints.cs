using System.Buffers;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Infrastructure.LiveKit;
using Opten.FlowStudio.Web.Errors;
using Opten.FlowStudio.Web.Security;

namespace Opten.FlowStudio.Web.Endpoints;

/// <summary>The sender's own routes (device bearer).</summary>
internal static class DeviceEndpoints
{
    /// <summary>Largest body of the bandwidth test (spec 5).</summary>
    public const long BandwidthTestMaxBytes = 4 * 1024 * 1024;

    public static async Task<IResult> GetSelfAsync(ClaimsPrincipal user, DeviceSessionService devices, CancellationToken cancellationToken) =>
        TypedResults.Ok(await devices.GetSelfAsync(IdentityOf(user), cancellationToken));

    public static async Task<IResult> GetSessionAsync(ClaimsPrincipal user, DeviceSessionService devices, CancellationToken cancellationToken) =>
        TypedResults.Ok(await devices.GetSessionAsync(IdentityOf(user), cancellationToken));

    public static async Task<IResult> IssueLiveKitTokenAsync(ClaimsPrincipal user, DeviceSessionService devices, CancellationToken cancellationToken) =>
        TypedResults.Ok(await devices.IssueTokenAsync(IdentityOf(user), cancellationToken));

    public static async Task<IResult> AllocateSlotAsync([FromBody] AllocateSlotRequest body, ClaimsPrincipal user, DeviceSessionService devices, CancellationToken cancellationToken) =>
        TypedResults.Ok(await devices.AllocateSlotAsync(IdentityOf(user), body, cancellationToken));

    public static async Task<IResult> ReleaseSlotAsync(string slot, ClaimsPrincipal user, DeviceSessionService devices, CancellationToken cancellationToken)
    {
        await devices.ReleaseSlotAsync(IdentityOf(user), slot, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> ReportAsync([FromBody] DeviceReportDto body, ClaimsPrincipal user, DeviceSessionService devices, CancellationToken cancellationToken)
    {
        await devices.ReportAsync(IdentityOf(user), null, body, cancellationToken);
        return TypedResults.NoContent();
    }

    // Receives the upload of the technical check and reports how long it took the server. (No XML doc here: handler
    // docs would become OpenAPI summaries and change the generated contract.)
    public static async Task<IResult> BandwidthTestAsync(HttpRequest request, TimeProvider clock, CancellationToken cancellationToken)
    {
        var started = clock.GetTimestamp();
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
        try
        {
            long total = 0;
            int read;
            while ((read = await request.Body.ReadAsync(buffer, cancellationToken)) > 0)
            {
                total += read;
                if (total > BandwidthTestMaxBytes)
                {
                    return Problems.Result(StatusCodes.Status413PayloadTooLarge, ErrorCodes.UnsupportedMedia, "Höchstens 4 MB.");
                }
            }

            return TypedResults.Ok(new BandwidthTestResultDto(total, Math.Round(clock.GetElapsedTime(started).TotalMilliseconds, 1)));
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    public static async Task<IResult> UnpairAsync(ClaimsPrincipal user, DeviceSessionService devices, CancellationToken cancellationToken)
    {
        await devices.UnpairAsync(IdentityOf(user), cancellationToken);
        return TypedResults.NoContent();
    }

    private static DeviceIdentity IdentityOf(ClaimsPrincipal user) => new(
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty,
        user.FindFirstValue(FlowStudioClaims.ProductionId) ?? string.Empty,
        user.HasClaim(c => c.Type == FlowStudioClaims.Blocked));
}

/// <summary>Uploaded images and videos.</summary>
internal static class AssetEndpoints
{
    public static async Task<IResult> ListAsync(string productionId, AssetService assets, CancellationToken cancellationToken) =>
        TypedResults.Ok(await assets.ListAsync(productionId, cancellationToken));

    public static async Task<IResult> UploadAsync(string productionId, IFormFile file, AssetService assets, CancellationToken cancellationToken)
    {
        await using var content = file.OpenReadStream();
        var asset = await assets.UploadAsync(productionId, content, file.Length, file.FileName, cancellationToken);
        return TypedResults.Created($"/api/productions/{productionId}/assets/{asset.Id}", asset);
    }

    public static async Task<IResult> RenameAsync(string productionId, string assetId, [FromBody] RenameAssetRequest body, AssetService assets, CancellationToken cancellationToken) =>
        TypedResults.Ok(await assets.RenameAsync(productionId, assetId, body, cancellationToken));

    public static async Task<IResult> DeleteAsync(string productionId, string assetId, AssetService assets, CancellationToken cancellationToken)
    {
        await assets.DeleteAsync(productionId, assetId, cancellationToken);
        return TypedResults.NoContent();
    }

    // Streams the content with range support for the admin cookie or the output key (?k=). The verified type, nosniff,
    // an inline disposition with the sanitised name and a sandboxing CSP keep a polyglot file from running as a page
    // (GAP-13); ETag and Last-Modified allow 304 answers.
    public static async Task<IResult> GetContentAsync(string productionId, string assetId, [FromQuery] string? k, AssetService assets, HttpContext context, CancellationToken cancellationToken)
    {
        var isAdmin = context.User.Identity is { IsAuthenticated: true, AuthenticationType: AuthSchemes.Admin };
        var content = await assets.GetContentAsync(productionId, assetId, isAdmin, k, context.Connection.RemoteIpAddress, cancellationToken);
        var headers = context.Response.Headers;
        headers.CacheControl = "private, max-age=3600";
        headers.XContentTypeOptions = "nosniff";
        headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = content.DisplayFileName }.ToString();
        return TypedResults.PhysicalFile(content.Path, content.ContentType, lastModified: content.LastModified, entityTag: new EntityTagHeaderValue(content.ETag), enableRangeProcessing: true);
    }
}

/// <summary>LiveKit webhooks (verified by signature, never logged: they carry the TURN password).</summary>
internal static class LiveKitEndpoints
{
    public static async Task<IResult> ReceiveWebhookAsync(HttpRequest request, LiveKitWebhookReceiver receiver, LiveKitSyncService sync, CancellationToken cancellationToken)
    {
        var body = await ReadBodyAsync(request, LiveKitWebhookReceiver.MaxBodyBytes, cancellationToken);
        if (body is null)
        {
            return Problems.Result(StatusCodes.Status413PayloadTooLarge, ErrorCodes.UnsupportedMedia, "Der Webhook ist zu gross.");
        }

        if (!await receiver.VerifyAsync(request.Headers.Authorization.ToString(), body))
        {
            return Problems.Result(StatusCodes.Status401Unauthorized, ErrorCodes.Unauthorized, "Ungültige Webhook-Signatur.");
        }

        if (LiveKitWebhookReceiver.Parse(body) is not { } webhook)
        {
            return Problems.Result(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed, "Unbekanntes Webhook-Format.");
        }

        await sync.HandleAsync(webhook, cancellationToken);
        return TypedResults.Ok();
    }

    private static async Task<byte[]?> ReadBodyAsync(HttpRequest request, int maxBytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > maxBytes)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
