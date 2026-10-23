using System.Buffers.Binary;
using System.Text;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Infrastructure.Media;

/// <summary>A media type recognised by its magic bytes.</summary>
/// <param name="Kind">Image or video.</param>
/// <param name="ContentType">MIME type.</param>
/// <param name="Extension">File extension including the dot.</param>
public sealed record MediaType(AssetKind Kind, string ContentType, string Extension);

/// <summary>
/// Recognises the allowed upload types by magic bytes (spec 4.7, GAP-13) – PNG, JPEG, WebP, MP4 (<c>ftyp</c> with an
/// allowed brand) and WebM (EBML with DocType <c>webm</c>) – and reads image dimensions from the headers. Everything else
/// (SVG, GIF, HEIC/AVIF in an <c>ftyp</c> box, QuickTime, Matroska, …) is rejected. The client's content type is never
/// trusted.
/// </summary>
public static class MediaInspector
{
    /// <summary>Bytes needed to recognise a type.</summary>
    public const int HeaderLength = 64;

    /// <summary>Largest accepted image width and height (GAP-13); larger images are rejected as unsupported.</summary>
    public const int MaxDimension = 16_384;

    // Bounds the marker walk of crafted files with very many tiny segments.
    private const int MaxJpegSegments = 10_000;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Ebml = [0x1A, 0x45, 0xDF, 0xA3];

    /// <summary>MP4 brands browsers play as H.264/AAC MP4 (GAP-13 allow-list); <c>M4V </c> is padded to four characters.</summary>
    private static readonly string[] Mp4Brands = ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "];

    /// <summary>Still-image and QuickTime brands: never a video, even when they list an MP4 brand as compatible.</summary>
    private static readonly string[] RejectedFtypBrands = ["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "miaf", "qt  ", "crx "];

    /// <summary>PNG image.</summary>
    public static MediaType Png { get; } = new(AssetKind.Image, "image/png", ".png");

    /// <summary>JPEG image.</summary>
    public static MediaType Jpeg { get; } = new(AssetKind.Image, "image/jpeg", ".jpg");

    /// <summary>WebP image.</summary>
    public static MediaType WebP { get; } = new(AssetKind.Image, "image/webp", ".webp");

    /// <summary>MP4 video.</summary>
    public static MediaType Mp4 { get; } = new(AssetKind.Video, "video/mp4", ".mp4");

    /// <summary>WebM video.</summary>
    public static MediaType WebM { get; } = new(AssetKind.Video, "video/webm", ".webm");

    /// <summary>Recognises the type from the first bytes of a file; null when the type is not allowed.</summary>
    public static MediaType? Detect(ReadOnlySpan<byte> header)
    {
        if (header.StartsWith(PngSignature))
        {
            return Png;
        }

        if (header.Length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF)
        {
            return Jpeg;
        }

        if (header.Length >= 16 && header[..4].SequenceEqual("RIFF"u8) && header[8..12].SequenceEqual("WEBP"u8))
        {
            return WebP;
        }

        if (header.Length >= 12 && header[4..8].SequenceEqual("ftyp"u8))
        {
            return IsMp4(header) ? Mp4 : null;
        }

        if (header.StartsWith(Ebml) && string.Equals(ReadEbmlDocType(header), "webm", StringComparison.Ordinal))
        {
            return WebM;
        }

        return null;
    }

    /// <summary>True when the image size is within 1…<see cref="MaxDimension"/> in both directions.</summary>
    public static bool IsAcceptedSize((int Width, int Height)? size) =>
        size is { Width: >= 1 and <= MaxDimension, Height: >= 1 and <= MaxDimension };

    /// <summary>
    /// The major brand must be on the allow-list, or – for other ISO brands such as <c>iso5</c> of fragmented files – one
    /// of the compatible brands in the header must be, while still-image and QuickTime brands are always rejected.
    /// </summary>
    private static bool IsMp4(ReadOnlySpan<byte> header)
    {
        var major = Encoding.ASCII.GetString(header[8..12]);
        if (RejectedFtypBrands.Contains(major, StringComparer.Ordinal))
        {
            return false;
        }

        if (Mp4Brands.Contains(major, StringComparer.Ordinal))
        {
            return true;
        }

        // Box layout: size (4), "ftyp" (4), major brand (4), minor version (4), compatible brands (4 each).
        var boxSize = (int)Math.Min(BinaryPrimitives.ReadUInt32BigEndian(header[..4]), (uint)header.Length);
        for (var offset = 16; offset + 4 <= boxSize; offset += 4)
        {
            var compatible = Encoding.ASCII.GetString(header[offset..(offset + 4)]);
            if (RejectedFtypBrands.Contains(compatible, StringComparer.Ordinal))
            {
                return false;
            }

            if (Mp4Brands.Contains(compatible, StringComparer.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>The DocType of an EBML header (element 0x4282), or null when it is not in the first bytes.</summary>
    private static string? ReadEbmlDocType(ReadOnlySpan<byte> header)
    {
        // Element ids and sizes are variable-length integers; the header element follows the 4-byte EBML id.
        var position = 4;
        if (!TryReadVint(header, ref position, out _))
        {
            return null;
        }

        while (position + 2 < header.Length)
        {
            var isDocType = header[position] == 0x42 && header[position + 1] == 0x82;
            var idLength = header[position] switch
            {
                >= 0x80 => 1,
                >= 0x40 => 2,
                >= 0x20 => 3,
                >= 0x10 => 4,
                _ => 0,
            };
            if (idLength == 0)
            {
                return null;
            }

            position += idLength;
            if (!TryReadVint(header, ref position, out var size) || size > header.Length - position)
            {
                return null;
            }

            if (isDocType)
            {
                return Encoding.ASCII.GetString(header.Slice(position, (int)size));
            }

            position += (int)size;
        }

        return null;
    }

    private static bool TryReadVint(ReadOnlySpan<byte> data, ref int position, out long value)
    {
        value = 0;
        if (position >= data.Length || data[position] == 0)
        {
            return false;
        }

        var first = data[position];
        var length = System.Numerics.BitOperations.LeadingZeroCount((uint)first) - 23;
        if (length is < 1 or > 8 || position + length > data.Length)
        {
            return false;
        }

        value = first & (0xFF >> length);
        for (var i = 1; i < length; i++)
        {
            value = (value << 8) | data[position + i];
        }

        position += length;
        return true;
    }

    /// <summary>
    /// Reads width and height of a stored image as written in its header; null when the header is unreadable. Use
    /// <see cref="IsAcceptedSize"/> to check the limits.
    /// </summary>
    public static (int Width, int Height)? ReadImageSize(Stream image, MediaType type)
    {
        ArgumentNullException.ThrowIfNull(image);
        ArgumentNullException.ThrowIfNull(type);
        try
        {
            return type == Png ? ReadPng(image) : type == WebP ? ReadWebP(image) : type == Jpeg ? ReadJpeg(image) : null;
        }
        catch (EndOfStreamException)
        {
            return null;
        }
    }

    private static (int Width, int Height)? ReadPng(Stream image)
    {
        Span<byte> header = stackalloc byte[24];
        image.Position = 0;
        image.ReadExactly(header);
        if (!header[12..16].SequenceEqual("IHDR"u8))
        {
            return null;
        }

        return ((int)BinaryPrimitives.ReadUInt32BigEndian(header[16..20]), (int)BinaryPrimitives.ReadUInt32BigEndian(header[20..24]));
    }

    private static (int Width, int Height)? ReadWebP(Stream image)
    {
        Span<byte> header = stackalloc byte[30];
        image.Position = 0;
        image.ReadExactly(header);
        var chunk = header[12..16];
        if (chunk.SequenceEqual("VP8 "u8))
        {
            return (BinaryPrimitives.ReadUInt16LittleEndian(header[26..28]) & 0x3FFF, BinaryPrimitives.ReadUInt16LittleEndian(header[28..30]) & 0x3FFF);
        }

        if (chunk.SequenceEqual("VP8L"u8))
        {
            var bits = BinaryPrimitives.ReadUInt32LittleEndian(header[21..25]);
            return ((int)(bits & 0x3FFF) + 1, (int)((bits >> 14) & 0x3FFF) + 1);
        }

        if (chunk.SequenceEqual("VP8X"u8))
        {
            return (ReadUInt24(header[24..27]) + 1, ReadUInt24(header[27..30]) + 1);
        }

        return null;
    }

    private static (int Width, int Height)? ReadJpeg(Stream image)
    {
        image.Position = 2;
        Span<byte> marker = stackalloc byte[2];
        Span<byte> frame = stackalloc byte[5];
        for (var segment = 0; segment < MaxJpegSegments; segment++)
        {
            image.ReadExactly(marker);
            if (marker[0] != 0xFF)
            {
                return null;
            }

            var code = marker[1];
            while (code == 0xFF)
            {
                var next = image.ReadByte();
                if (next < 0)
                {
                    return null;
                }

                code = (byte)next;
            }

            if (code is 0xD8 or 0x01 or (>= 0xD0 and <= 0xD7))
            {
                continue;
            }

            if (code is 0xD9 or 0xDA)
            {
                return null;
            }

            image.ReadExactly(marker);
            var length = BinaryPrimitives.ReadUInt16BigEndian(marker);
            if (length < 2)
            {
                return null;
            }

            if (code is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
            {
                image.ReadExactly(frame);
                return (BinaryPrimitives.ReadUInt16BigEndian(frame[3..5]), BinaryPrimitives.ReadUInt16BigEndian(frame[1..3]));
            }

            image.Seek(length - 2, SeekOrigin.Current);
            if (image.Position >= image.Length)
            {
                return null;
            }
        }

        return null;
    }

    private static int ReadUInt24(ReadOnlySpan<byte> bytes) => bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
}
