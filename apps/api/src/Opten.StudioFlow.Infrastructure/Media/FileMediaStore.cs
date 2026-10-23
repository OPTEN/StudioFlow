using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Infrastructure.Media;

/// <summary>Media settings (configuration section <c>Media</c>).</summary>
public sealed class MediaOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Media";

    /// <summary>Root folder; files live in <c>{Path}/{productionId}/{assetId}{ext}</c>.</summary>
    public string Path { get; set; } = "/data/media";

    /// <summary>Largest image (default 25 MB).</summary>
    public long MaxImageBytes { get; set; } = 25L * 1024 * 1024;

    /// <summary>Largest video (default 1 GB).</summary>
    public long MaxVideoBytes { get; set; } = 1024L * 1024 * 1024;

    /// <summary>The largest file of any type.</summary>
    public long MaxBytes => Math.Max(MaxImageBytes, MaxVideoBytes);
}

/// <summary>
/// Stores uploads on the file system. The type comes from the magic bytes; the size is checked against the declared
/// length first and against the bytes actually written, so a lying client cannot exceed the limit. Files are written to
/// a temporary name and moved into place when complete.
/// </summary>
internal sealed class FileMediaStore(IOptions<MediaOptions> options) : IMediaStore
{
    private const int CopyBufferSize = 81_920;

    public async Task<StoredMedia> StoreAsync(string productionId, string assetId, Stream content, long? declaredLength, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        var folder = FolderOf(productionId);
        if (!EntityIds.IsValid(assetId, EntityIds.Asset))
        {
            throw new ArgumentException("Invalid asset id.", nameof(assetId));
        }

        var header = new byte[MediaInspector.HeaderLength];
        var headerLength = await content.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, cancellationToken);
        var type = MediaInspector.Detect(header.AsSpan(0, headerLength))
            ?? throw new StudioFlowException(ErrorKind.UnsupportedMedia, ErrorCodes.UnsupportedMedia, "Allowed types are PNG, JPEG, WebP, MP4 and WebM.");
        var limit = type.Kind == AssetKind.Image ? options.Value.MaxImageBytes : options.Value.MaxVideoBytes;
        if (declaredLength > limit)
        {
            throw TooLarge(type);
        }

        Directory.CreateDirectory(folder);
        var fileName = assetId + type.Extension;
        var finalPath = Path.Combine(folder, fileName);
        var tempPath = finalPath + ".part";
        try
        {
            long written;
            await using (var file = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, CopyBufferSize, useAsync: true))
            {
                await file.WriteAsync(header.AsMemory(0, headerLength), cancellationToken);
                written = headerLength + await CopyLimitedAsync(content, file, limit - headerLength, type, cancellationToken);
            }

            (int Width, int Height)? size = null;
            if (type.Kind == AssetKind.Image)
            {
                await using (var image = new FileStream(tempPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: false))
                {
                    size = MediaInspector.ReadImageSize(image, type);
                }

                // An image without a readable size, with a zero side or larger than 16384 px is not accepted (GAP-13).
                if (!MediaInspector.IsAcceptedSize(size))
                {
                    throw new StudioFlowException(ErrorKind.UnsupportedMedia, ErrorCodes.UnsupportedMedia, $"Images need a readable size of 1 to {MediaInspector.MaxDimension} pixels per side.");
                }
            }

            File.Move(tempPath, finalPath);
            return new StoredMedia(type.Kind, type.ContentType, fileName, written, size?.Width, size?.Height);
        }
        finally
        {
            File.Delete(tempPath);
        }
    }

    public string? GetPath(string productionId, string fileName)
    {
        var path = PathOf(productionId, fileName);
        return path is not null && File.Exists(path) ? path : null;
    }

    public void Delete(string productionId, string fileName)
    {
        if (PathOf(productionId, fileName) is { } path)
        {
            File.Delete(path);
        }
    }

    private static StudioFlowException TooLarge(MediaType type) => new(
        ErrorKind.PayloadTooLarge,
        ErrorCodes.UnsupportedMedia,
        type.Kind == AssetKind.Image ? "The image is too large." : "The video is too large.");

    private static async Task<long> CopyLimitedAsync(Stream source, Stream target, long remaining, MediaType type, CancellationToken cancellationToken)
    {
        var buffer = new byte[CopyBufferSize];
        long copied = 0;
        int read;
        while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
        {
            copied += read;
            if (copied > remaining)
            {
                throw TooLarge(type);
            }

            await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        return copied;
    }

    /// <summary>The folder of a production; ids are validated so no path can escape the media root.</summary>
    private string FolderOf(string productionId)
    {
        if (!EntityIds.IsValid(productionId, EntityIds.Production))
        {
            throw new ArgumentException("Invalid production id.", nameof(productionId));
        }

        return Path.Combine(Path.GetFullPath(options.Value.Path), productionId);
    }

    private string? PathOf(string productionId, string fileName)
    {
        var dot = fileName.IndexOf('.', StringComparison.Ordinal);
        if (!EntityIds.IsValid(productionId, EntityIds.Production) || dot < 0 || !EntityIds.IsValid(fileName[..dot], EntityIds.Asset)
            || fileName[dot..] is not (".png" or ".jpg" or ".webp" or ".mp4" or ".webm"))
        {
            return null;
        }

        return Path.Combine(FolderOf(productionId), fileName);
    }
}
