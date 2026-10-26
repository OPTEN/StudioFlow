namespace Opten.StudioFlow.Core.Application;

/// <summary>
/// Limits of importing a production (configuration section <c>Transfer</c>, spec 4.2.2). An export holds the media of a
/// production, so the file is far larger than a JSON request; the limits keep a damaged or malicious file from filling the
/// disk or the memory: the size of the upload, the number of files, the unpacked size and the compression ratio (a ZIP bomb
/// is a small file that unpacks to something huge).
/// </summary>
public sealed class TransferOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Transfer";

    /// <summary>Compression ratios above this are only checked for files larger than this (a manifest of repetitive JSON compresses well).</summary>
    public const long RatioCheckFromBytes = 1024 * 1024;

    /// <summary><c>Transfer:MaxImportBytes</c>: the largest file an import accepts (default 4 GiB, Caddy: <c>STUDIOFLOW_MAX_IMPORT</c>).</summary>
    public long MaxImportBytes { get; set; } = 4L * 1024 * 1024 * 1024;

    /// <summary><c>Transfer:MaxEntries</c>: the largest number of files in the ZIP, the manifest and the media (default 1000).</summary>
    public int MaxEntries { get; set; } = 1000;

    /// <summary><c>Transfer:MaxUnpackedBytes</c>: the largest size of all files together after unpacking (default 8 GiB).</summary>
    public long MaxUnpackedBytes { get; set; } = 8L * 1024 * 1024 * 1024;

    /// <summary><c>Transfer:MaxManifestBytes</c>: the largest <c>manifest.json</c> (default 8 MiB; the 99 scenes of 32 items fit in 2 MiB).</summary>
    public int MaxManifestBytes { get; set; } = 8 * 1024 * 1024;

    /// <summary><c>Transfer:MaxCompressionRatio</c>: a file that unpacks to more than this many times its size is refused (default 100; JPEG, PNG, MP4 and WebM stay near 1).</summary>
    public int MaxCompressionRatio { get; set; } = 100;

    /// <inheritdoc />
    public IEnumerable<string> Validate()
    {
        if (MaxImportBytes is < 1024 * 1024 or > 1024L * 1024 * 1024 * 1024)
        {
            yield return $"Transfer:MaxImportBytes must be between 1 MiB and 1 TiB (is {MaxImportBytes}).";
        }

        if (MaxUnpackedBytes < MaxImportBytes)
        {
            yield return $"Transfer:MaxUnpackedBytes must not be smaller than Transfer:MaxImportBytes (is {MaxUnpackedBytes}).";
        }

        foreach (var message in OptionRules.Count("Transfer:MaxEntries", MaxEntries, 2, 100_000))
        {
            yield return message;
        }

        foreach (var message in OptionRules.Count("Transfer:MaxManifestBytes", MaxManifestBytes, 64 * 1024, 64 * 1024 * 1024))
        {
            yield return message;
        }

        foreach (var message in OptionRules.Count("Transfer:MaxCompressionRatio", MaxCompressionRatio, 2, 10_000))
        {
            yield return message;
        }
    }
}
