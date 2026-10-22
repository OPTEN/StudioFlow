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
/// Recognises the allowed upload types by magic bytes (spec 4.7) – PNG, JPEG, WebP, MP4 (<c>ftyp</c>) and WebM (EBML
/// with doc type <c>webm</c>) – and reads image dimensions from the headers. Everything else (SVG, GIF, HEIC/AVIF in an
/// <c>ftyp</c> box, QuickTime, Matroska, …) is rejected. The client's content type is never trusted.
/// </summary>
public static class MediaInspector
{
    /// <summary>Bytes needed to recognise a type.</summary>
    public const int HeaderLength = 64;

    private const int MaxDimension = 65_535;

    // Bounds the marker walk of crafted files with very many tiny segments.
    private const int MaxJpegSegments = 10_000;

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Ebml = [0x1A, 0x45, 0xDF, 0xA3];
    private static readonly string[] RejectedFtypBrands = ["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "qt  ", "crx "];

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
            var brand = Encoding.ASCII.GetString(header[8..12]);
            return RejectedFtypBrands.Contains(brand, StringComparer.Ordinal) ? null : Mp4;
        }

        if (header.StartsWith(Ebml) && header.IndexOf("webm"u8) > 0)
        {
            return WebM;
        }

        return null;
    }

    /// <summary>Reads width and height of a stored image; null when the header is unreadable.</summary>
    public static (int Width, int Height)? ReadImageSize(Stream image, MediaType type)
    {
        ArgumentNullException.ThrowIfNull(image);
        ArgumentNullException.ThrowIfNull(type);
        try
        {
            var size = type == Png ? ReadPng(image) : type == WebP ? ReadWebP(image) : type == Jpeg ? ReadJpeg(image) : null;
            return size is { Width: > 0 and <= MaxDimension, Height: > 0 and <= MaxDimension } ? size : null;
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
