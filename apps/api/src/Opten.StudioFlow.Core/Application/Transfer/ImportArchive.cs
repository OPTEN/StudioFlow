using System.IO.Compression;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Application.Transfer;

/// <summary>
/// An uploaded export, opened for reading (spec 4.2.2). Nothing of the file is trusted: <see cref="Open"/> checks the size
/// of the directory and the number of entries before the directory is read, every name (no <c>..</c>, no absolute path,
/// no backslash, no drive letter: the names are only looked up, nothing is ever unpacked to a path from the file), the
/// declared sizes against the limits, the compression ratio against ZIP bombs and that the file holds only the manifest and
/// media. The content of an entry is read through a stream that holds it to the size the directory announced.
/// </summary>
public sealed class ImportArchive : IDisposable
{
    private readonly ZipArchive zip;
    private readonly TransferOptions options;
    private readonly Dictionary<string, ZipArchiveEntry> files = new(StringComparer.Ordinal);
    private readonly UnpackBudget budget;

    private ImportArchive(ZipArchive zip, TransferOptions options)
    {
        this.zip = zip;
        this.options = options;
        budget = new UnpackBudget(options.MaxUnpackedBytes);
    }

    /// <summary>Names of the files in the archive (directories left out).</summary>
    public IReadOnlyCollection<string> FileNames => files.Keys;

    /// <summary>
    /// Opens the archive and checks everything that does not need the content. Throws <c>invalid_archive</c> for a file that is
    /// no ZIP, has an unsafe name, an unexpected file or a suspicious compression ratio, and <c>archive_too_large</c> for a
    /// file over a limit. The stream must be seekable and stay open as long as the archive is used.
    /// </summary>
    public static ImportArchive Open(Stream stream, TransferOptions options)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(options);
        if (!stream.CanSeek)
        {
            throw new ArgumentException("The archive stream must be seekable.", nameof(stream));
        }

        if (stream.Length > options.MaxImportBytes)
        {
            throw TransferErrors.TooLarge("The file is larger than this installation accepts.");
        }

        var (entries, directoryBytes) = ZipDirectory.Probe(stream);
        if (entries > options.MaxEntries)
        {
            throw TransferErrors.TooLarge($"The archive lists {entries} files; this installation accepts {options.MaxEntries}.");
        }

        // A directory entry is about 100 bytes; a directory far larger than its entries need is a trick to use up memory.
        if (directoryBytes > (long)options.MaxEntries * 1024)
        {
            throw TransferErrors.Invalid("The directory of the ZIP file is damaged.");
        }

        stream.Position = 0;
        ZipArchive zip;
        try
        {
            zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
        }
        catch (InvalidDataException)
        {
            throw TransferErrors.Invalid("The file is not a ZIP file.");
        }

        var archive = new ImportArchive(zip, options);
        try
        {
            archive.Check();
            return archive;
        }
        catch
        {
            archive.Dispose();
            throw;
        }
    }

    /// <summary>
    /// True for a name that stays inside the archive: not empty, no control characters, no backslash, no drive letter or
    /// other colon, not absolute, and no <c>.</c>, <c>..</c> or empty path segment. A trailing slash (a directory) is fine.
    /// </summary>
    public static bool IsSafeName(string? name)
    {
        if (string.IsNullOrEmpty(name) || name.Length > 255 || name[0] == '/' || name.Any(c => c < ' ' || c == '\\' || c == ':' || c == '\u007f'))
        {
            return false;
        }

        var segments = (name.EndsWith('/') ? name[..^1] : name).Split('/');
        return segments.All(segment => segment.Length > 0 && segment is not ("." or ".."));
    }

    /// <summary>
    /// Reads <c>manifest.json</c> (at most <see cref="TransferOptions.MaxManifestBytes"/>), migrates it and checks its types.
    /// Throws <c>invalid_archive</c> when the manifest is missing or damaged, <c>unsupported_format</c> for a newer format.
    /// </summary>
    public ProductionManifest ReadManifest()
    {
        if (!files.TryGetValue(ManifestFormat.ManifestEntry, out var entry))
        {
            throw TransferErrors.Invalid("The archive has no manifest.json.");
        }

        if (entry.Length > options.MaxManifestBytes)
        {
            throw TransferErrors.TooLarge("The manifest is larger than this installation accepts.");
        }

        using var content = new DeclaredLengthStream(OpenEntry(entry), entry.Length, budget);
        using var buffer = new MemoryStream((int)entry.Length);
        content.CopyTo(buffer);
        return ManifestJson.Read(buffer.GetBuffer().AsSpan(0, (int)buffer.Length));
    }

    /// <summary>
    /// Makes sure the archive holds exactly the manifest and the given media files: a file the manifest does not name is
    /// <c>invalid_archive</c>, so nothing in the archive is ignored and nothing hides in it, a named file that is missing is too.
    /// </summary>
    public void RequireFiles(IEnumerable<string> mediaFiles)
    {
        ArgumentNullException.ThrowIfNull(mediaFiles);
        var expected = new HashSet<string>(mediaFiles, StringComparer.Ordinal) { ManifestFormat.ManifestEntry };
        foreach (var missing in expected.Where(name => !files.ContainsKey(name)))
        {
            throw TransferErrors.Invalid($"The archive does not contain {missing}.");
        }

        foreach (var unexpected in files.Keys.Where(name => !expected.Contains(name)))
        {
            throw TransferErrors.Invalid($"The archive contains a file the manifest does not name: {unexpected}.");
        }
    }

    /// <summary>
    /// The content of a media file, held to the size of its directory entry, which must be <paramref name="expectedLength"/>
    /// (the size the manifest names). The caller reads it to the end and disposes it.
    /// </summary>
    public Stream OpenMedia(string name, long expectedLength)
    {
        if (!files.TryGetValue(name, out var entry))
        {
            throw TransferErrors.Invalid($"The archive does not contain {name}.");
        }

        if (entry.Length != expectedLength)
        {
            throw TransferErrors.Invalid($"{name} has not the size the manifest names.");
        }

        return new DeclaredLengthStream(OpenEntry(entry), entry.Length, budget);
    }

    /// <inheritdoc />
    public void Dispose() => zip.Dispose();

    private static Stream OpenEntry(ZipArchiveEntry entry)
    {
        try
        {
            return entry.Open();
        }
        catch (Exception exception) when (exception is InvalidDataException or NotSupportedException)
        {
            throw TransferErrors.Invalid("A file in the archive is damaged or uses a feature that is not supported (encryption).");
        }
    }

    private void Check()
    {
        long unpacked = 0;
        long packed = 0;
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName;
            if (!IsSafeName(name))
            {
                throw TransferErrors.Invalid("The archive contains a file with an unsafe name.");
            }

            if (name.EndsWith('/'))
            {
                if (entry.Length != 0)
                {
                    throw TransferErrors.Invalid("The archive contains a directory with content.");
                }

                continue;
            }

            if (!IsAllowed(name))
            {
                throw TransferErrors.Invalid($"The archive contains a file StudioFlow does not export: {name}.");
            }

            if (!files.TryAdd(name, entry))
            {
                throw TransferErrors.Invalid($"The archive contains {name} twice.");
            }

            unpacked += entry.Length;
            packed += entry.CompressedLength;
            if (unpacked > options.MaxUnpackedBytes)
            {
                throw TransferErrors.TooLarge("The files in the archive are larger together than this installation accepts.");
            }

            RequireRatio(name, entry.Length, entry.CompressedLength);
        }

        RequireRatio("the archive", unpacked, packed);
    }

    /// <summary>The manifest and one level of media files; nothing else is part of an export.</summary>
    private static bool IsAllowed(string name) =>
        string.Equals(name, ManifestFormat.ManifestEntry, StringComparison.Ordinal)
        || (name.StartsWith(ManifestFormat.MediaFolder, StringComparison.Ordinal) && name.IndexOf('/', ManifestFormat.MediaFolder.Length) < 0);

    private void RequireRatio(string what, long unpacked, long packed)
    {
        if (unpacked > TransferOptions.RatioCheckFromBytes && unpacked > Math.Max(packed, 1) * options.MaxCompressionRatio)
        {
            throw TransferErrors.Invalid($"{what} unpacks to more than {options.MaxCompressionRatio} times its size.");
        }
    }
}
