using System.Buffers.Binary;

namespace Opten.StudioFlow.Infrastructure.Media;

/// <summary>
/// Finds out whether an uploaded video has an audio track (issue #7), so only videos with sound get a channel in the audio
/// mixer. It reads the container structure and nothing else: the <c>moov</c> box of an MP4 (<c>trak</c> → <c>mdia</c> →
/// <c>hdlr</c> with the handler <c>soun</c>) and the <c>Tracks</c> element of a WebM (a <c>TrackEntry</c> of type 2). The file
/// was accepted by <see cref="MediaInspector"/> before, but it is still untrusted: every size is bounded and a broken
/// structure means “no audio”, never an exception.
/// </summary>
public static class MediaTrackReader
{
    // A real moov box is a few kilobytes up to some megabytes (long videos with many samples); more is not a video we trust.
    private const long MaxMoovBytes = 64L * 1024 * 1024;
    private const int MaxBoxes = 100_000;
    private const int MaxElements = 100_000;

    private const uint EbmlSegment = 0x18538067;
    private const uint EbmlTracks = 0x1654AE6B;
    private const uint EbmlTrackEntry = 0xAE;
    private const uint EbmlTrackType = 0x83;
    private const uint EbmlCluster = 0x1F43B675;
    private const uint EbmlHeader = 0x1A45DFA3;
    private const long UnknownSize = -1;

    /// <summary>True when the video has an audio track; false for images, other types and every file that cannot be read.</summary>
    public static bool HasAudio(Stream video, MediaType type)
    {
        ArgumentNullException.ThrowIfNull(video);
        ArgumentNullException.ThrowIfNull(type);
        if (type.Kind != Core.Contracts.AssetKind.Video || !video.CanSeek)
        {
            return false;
        }

        try
        {
            video.Position = 0;
            return type == MediaInspector.Mp4 ? Mp4HasAudio(video) : type == MediaInspector.WebM && WebMHasAudio(video);
        }
        catch (Exception exception) when (exception is EndOfStreamException or IOException or ArgumentException or OverflowException)
        {
            return false;
        }
    }

    private static bool Mp4HasAudio(Stream video)
    {
        Span<byte> header = stackalloc byte[16];
        for (var count = 0; count < MaxBoxes && video.Position + 8 <= video.Length; count++)
        {
            var start = video.Position;
            video.ReadExactly(header[..8]);
            long size = BinaryPrimitives.ReadUInt32BigEndian(header[..4]);
            var headerLength = 8;
            if (size == 1)
            {
                video.ReadExactly(header[8..16]);
                size = (long)Math.Min(BinaryPrimitives.ReadUInt64BigEndian(header[8..16]), (ulong)long.MaxValue);
                headerLength = 16;
            }
            else if (size == 0)
            {
                size = video.Length - start;
            }

            if (size < headerLength || start + size > video.Length)
            {
                return false;
            }

            if (header[4..8].SequenceEqual("moov"u8))
            {
                var payload = size - headerLength;
                if (payload > MaxMoovBytes)
                {
                    return false;
                }

                var moov = new byte[payload];
                video.ReadExactly(moov);
                return Mp4ContainerHasAudio(moov, 0);
            }

            video.Position = start + size;
        }

        return false;
    }

    /// <summary>Walks the boxes of a <c>moov</c>, <c>trak</c> or <c>mdia</c> payload; true at the first <c>hdlr</c> of an audio track.</summary>
    private static bool Mp4ContainerHasAudio(ReadOnlySpan<byte> data, int depth)
    {
        if (depth > 3)
        {
            return false;
        }

        var position = 0;
        while (position + 8 <= data.Length)
        {
            long size = BinaryPrimitives.ReadUInt32BigEndian(data[position..]);
            var type = data.Slice(position + 4, 4);
            if (size < 8 || position + size > data.Length)
            {
                return false;
            }

            var payload = data.Slice(position + 8, (int)size - 8);
            if (type.SequenceEqual("hdlr"u8))
            {
                // version and flags (4), pre_defined (4), handler_type (4).
                if (payload.Length >= 12 && payload[8..12].SequenceEqual("soun"u8))
                {
                    return true;
                }
            }
            else if ((type.SequenceEqual("trak"u8) || type.SequenceEqual("mdia"u8)) && Mp4ContainerHasAudio(payload, depth + 1))
            {
                return true;
            }

            position += (int)size;
        }

        return false;
    }

    private static bool WebMHasAudio(Stream video)
    {
        // The EBML header, then the segment; inside the segment the tracks come before the first cluster.
        if (!TryReadElement(video, out var header) || header.Id != EbmlHeader || header.Size == UnknownSize)
        {
            return false;
        }

        video.Position = header.DataStart + header.Size;
        if (!TryReadElement(video, out var segment) || segment.Id != EbmlSegment)
        {
            return false;
        }

        var segmentEnd = segment.Size == UnknownSize ? video.Length : Math.Min(video.Length, segment.DataStart + segment.Size);
        for (var count = 0; count < MaxElements && video.Position < segmentEnd; count++)
        {
            if (!TryReadElement(video, out var element))
            {
                return false;
            }

            if (element.Id == EbmlCluster)
            {
                return false;
            }

            if (element.Id == EbmlTracks)
            {
                return TracksHaveAudio(video, element.DataStart, element.Size == UnknownSize ? segmentEnd : Math.Min(segmentEnd, element.DataStart + element.Size));
            }

            if (element.Size == UnknownSize)
            {
                return false;
            }

            video.Position = element.DataStart + element.Size;
        }

        return false;
    }

    private static bool TracksHaveAudio(Stream video, long start, long end)
    {
        video.Position = start;
        for (var count = 0; count < MaxElements && video.Position < end; count++)
        {
            if (!TryReadElement(video, out var entry) || entry.Size == UnknownSize)
            {
                return false;
            }

            if (entry.Id == EbmlTrackEntry && TrackEntryIsAudio(video, entry.DataStart, Math.Min(end, entry.DataStart + entry.Size)))
            {
                return true;
            }

            video.Position = entry.DataStart + entry.Size;
        }

        return false;
    }

    private static bool TrackEntryIsAudio(Stream video, long start, long end)
    {
        Span<byte> value = stackalloc byte[8];
        video.Position = start;
        for (var count = 0; count < MaxElements && video.Position < end; count++)
        {
            if (!TryReadElement(video, out var field) || field.Size == UnknownSize)
            {
                return false;
            }

            if (field.Id == EbmlTrackType && field.Size is >= 1 and <= 8)
            {
                video.ReadExactly(value[..(int)field.Size]);
                long type = 0;
                foreach (var b in value[..(int)field.Size])
                {
                    type = (type << 8) | b;
                }

                if (type == 2)
                {
                    return true;
                }
            }

            video.Position = field.DataStart + field.Size;
        }

        return false;
    }

    private static bool TryReadElement(Stream stream, out EbmlElement element)
    {
        element = default;
        var first = stream.ReadByte();
        if (first <= 0)
        {
            return false;
        }

        var idLength = System.Numerics.BitOperations.LeadingZeroCount((uint)first) - 23;
        if (idLength is < 1 or > 4)
        {
            return false;
        }

        uint id = (uint)first;
        for (var i = 1; i < idLength; i++)
        {
            var next = stream.ReadByte();
            if (next < 0)
            {
                return false;
            }

            id = (id << 8) | (uint)next;
        }

        var sizeFirst = stream.ReadByte();
        if (sizeFirst <= 0)
        {
            return false;
        }

        var sizeLength = System.Numerics.BitOperations.LeadingZeroCount((uint)sizeFirst) - 23;
        if (sizeLength is < 1 or > 8)
        {
            return false;
        }

        long size = sizeFirst & (0xFF >> sizeLength);
        var allOnes = size == (0xFF >> sizeLength);
        for (var i = 1; i < sizeLength; i++)
        {
            var next = stream.ReadByte();
            if (next < 0)
            {
                return false;
            }

            size = (size << 8) | (uint)next;
            allOnes &= next == 0xFF;
        }

        element = new EbmlElement(id, allOnes ? UnknownSize : size, stream.Position);
        return true;
    }

    private readonly record struct EbmlElement(uint Id, long Size, long DataStart);
}
