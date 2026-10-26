using System.IO.Compression;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Application.Transfer;

/// <summary>
/// Writes an export as a ZIP file (spec 4.2.2): <c>media/…</c> files first, then <c>manifest.json</c>, which holds the SHA-256 of
/// every file – the checksum is only known after the file went through, so the manifest comes last and the archive can be
/// written to a stream that cannot seek (the HTTP response) without holding a file in memory or on disk. Images and videos
/// are compressed already, so they go in with the fastest level; the manifest is compressed best.
/// </summary>
public static class ExportArchive
{
    /// <summary>
    /// Writes the archive. <paramref name="files"/> holds the open content of every file in the order of <paramref name="media"/>;
    /// the streams are read to the end and disposed. The manifest of the result has the checksums.
    /// </summary>
    public static async Task WriteAsync(
        Stream output,
        ProductionManifest manifest,
        IReadOnlyList<ExportMedia> media,
        IReadOnlyList<Stream> files,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(manifest);
        ArgumentNullException.ThrowIfNull(media);
        ArgumentNullException.ThrowIfNull(files);
        if (media.Count != files.Count)
        {
            throw new ArgumentException("Every medium needs its content.", nameof(files));
        }

        var entries = new List<ManifestAsset>(media.Count);
        await using (var zip = await ZipArchive.CreateAsync(output, ZipArchiveMode.Create, leaveOpen: true, entryNameEncoding: null, cancellationToken))
        {
            for (var i = 0; i < media.Count; i++)
            {
                var entry = media[i].Entry;
                await using var content = files[i];
                using var hashing = new HashingReadStream(content);
                var zipEntry = zip.CreateEntry(entry.File, CompressionLevel.Fastest);
                zipEntry.LastWriteTime = manifest.App.ExportedAt;
                await using (var target = await zipEntry.OpenAsync(cancellationToken))
                {
                    await hashing.CopyToAsync(target, cancellationToken);
                }

                entries.Add(entry with { Sha256 = hashing.Finish(), SizeBytes = hashing.BytesRead });
            }

            var manifestEntry = zip.CreateEntry(ManifestFormat.ManifestEntry, CompressionLevel.Optimal);
            manifestEntry.LastWriteTime = manifest.App.ExportedAt;
            await using var manifestTarget = await manifestEntry.OpenAsync(cancellationToken);
            await manifestTarget.WriteAsync(ManifestJson.Serialize(manifest with { Assets = entries }), cancellationToken);
        }
    }
}
