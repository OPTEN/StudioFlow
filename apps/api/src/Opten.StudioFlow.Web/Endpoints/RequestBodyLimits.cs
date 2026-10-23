using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.Server.Kestrel.Core.Features;
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Infrastructure.Media;
using Opten.StudioFlow.Web.Errors;

namespace Opten.StudioFlow.Web.Endpoints;

/// <summary>Endpoint metadata that raises the request body limit (spec 5: JSON ≤ 256 KB, bandwidth test ≤ 4 MB, uploads).</summary>
/// <param name="MaxBytes">Limit for this endpoint; ignored for uploads.</param>
/// <param name="IsUpload">Asset upload: the limit follows <see cref="MediaOptions.MaxBytes"/> and slow uploads are tolerated.</param>
internal sealed record RequestBodyLimit(long MaxBytes, bool IsUpload = false)
{
    /// <summary>Default limit of every other request.</summary>
    public const long DefaultBytes = 256 * 1024;

    /// <summary>The asset upload.</summary>
    public static RequestBodyLimit Upload { get; } = new(0, IsUpload: true);
}

/// <summary>
/// Applies the body limit of the matched endpoint: requests that announce a larger body get 413 at once, Kestrel stops
/// reading beyond the limit, and only the upload accepts a slow minimum data rate (phones on weak Wi-Fi).
/// </summary>
internal sealed class RequestBodyLimitMiddleware(RequestDelegate next, IOptions<MediaOptions> media)
{
    // Multipart boundaries and part headers around the file.
    private const long MultipartOverhead = 1024 * 1024;

    private static readonly MinDataRate SlowUploadRate = new(bytesPerSecond: 100, gracePeriod: TimeSpan.FromSeconds(30));

    public async Task InvokeAsync(HttpContext context)
    {
        var metadata = context.GetEndpoint()?.Metadata.GetMetadata<RequestBodyLimit>();
        var limit = metadata switch
        {
            { IsUpload: true } => media.Value.MaxBytes + MultipartOverhead,
            { } explicitLimit => explicitLimit.MaxBytes,
            null => RequestBodyLimit.DefaultBytes,
        };
        if (context.Request.ContentLength > limit)
        {
            await Problems.WriteAsync(context, StatusCodes.Status413PayloadTooLarge, ErrorCodes.UnsupportedMedia, "The request is too large.");
            return;
        }

        if (context.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } size)
        {
            size.MaxRequestBodySize = limit;
        }

        if (metadata?.IsUpload == true && context.Features.Get<IHttpMinRequestBodyDataRateFeature>() is { } rate)
        {
            rate.MinDataRate = SlowUploadRate;
        }

        await next(context);
    }
}
