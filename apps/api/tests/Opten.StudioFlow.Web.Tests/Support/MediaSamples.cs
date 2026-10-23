using System.Buffers.Binary;
using System.Text;

namespace Opten.StudioFlow.Web.Tests.Support;

/// <summary>Minimal files with valid headers for the media type checks.</summary>
public static class MediaSamples
{
    public static byte[] Png(int width, int height, int totalBytes = 64)
    {
        var bytes = new byte[Math.Max(totalBytes, 33)];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13 }.CopyTo(bytes, 0);
        "IHDR"u8.CopyTo(bytes.AsSpan(12));
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(16), (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(20), (uint)height);
        return bytes;
    }

    /// <summary>JPEG with an APP1 (EXIF) segment before the SOF0 frame header.</summary>
    public static byte[] Jpeg(int width, int height, int exifBytes = 1000)
    {
        var stream = new MemoryStream();
        stream.Write([0xFF, 0xD8, 0xFF, 0xE1]);
        WriteUInt16(stream, exifBytes + 2);
        stream.Write(new byte[exifBytes]);
        stream.Write([0xFF, 0xC0]);
        WriteUInt16(stream, 17);
        stream.WriteByte(8);
        WriteUInt16(stream, height);
        WriteUInt16(stream, width);
        stream.Write(new byte[10]);
        stream.Write([0xFF, 0xD9]);
        return stream.ToArray();
    }

    public static byte[] WebPLossy(int width, int height)
    {
        var bytes = WebPHeader("VP8 ", 30);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(26), (ushort)width);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(28), (ushort)height);
        return bytes;
    }

    public static byte[] WebPLossless(int width, int height)
    {
        var bytes = WebPHeader("VP8L", 30);
        bytes[20] = 0x2F;
        var bits = (uint)(width - 1) | ((uint)(height - 1) << 14);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(21), bits);
        return bytes;
    }

    public static byte[] WebPExtended(int width, int height)
    {
        var bytes = WebPHeader("VP8X", 30);
        WriteUInt24(bytes.AsSpan(24), width - 1);
        WriteUInt24(bytes.AsSpan(27), height - 1);
        return bytes;
    }

    public static byte[] Mp4(string brand = "isom", int totalBytes = 64)
    {
        var bytes = new byte[Math.Max(totalBytes, 32)];
        BinaryPrimitives.WriteUInt32BigEndian(bytes, 32);
        "ftyp"u8.CopyTo(bytes.AsSpan(4));
        Encoding.ASCII.GetBytes(brand).CopyTo(bytes, 8);
        return bytes;
    }

    public static byte[] WebM(string docType = "webm", int totalBytes = 64)
    {
        var bytes = new byte[Math.Max(totalBytes, 40)];
        new byte[] { 0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84 }.CopyTo(bytes, 0);
        Encoding.ASCII.GetBytes(docType).CopyTo(bytes, 12);
        return bytes;
    }

    public static byte[] Gif() => "GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;"u8.ToArray();

    public static byte[] Svg() => "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"u8.ToArray();

    private static byte[] WebPHeader(string chunk, int length)
    {
        var bytes = new byte[length];
        "RIFF"u8.CopyTo(bytes);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), (uint)(length - 8));
        "WEBP"u8.CopyTo(bytes.AsSpan(8));
        Encoding.ASCII.GetBytes(chunk).CopyTo(bytes, 12);
        return bytes;
    }

    private static void WriteUInt16(Stream stream, int value)
    {
        stream.WriteByte((byte)(value >> 8));
        stream.WriteByte((byte)value);
    }

    private static void WriteUInt24(Span<byte> target, int value)
    {
        target[0] = (byte)value;
        target[1] = (byte)(value >> 8);
        target[2] = (byte)(value >> 16);
    }
}
