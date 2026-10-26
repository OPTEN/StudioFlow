using System.Buffers.Binary;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Application.Transfer;

/// <summary>
/// Looks at the end of a ZIP file before anything reads its central directory. <see cref="System.IO.Compression.ZipArchive"/>
/// reads the whole directory when it is opened and creates an object for every entry, so a file whose directory lists
/// millions of entries (a few hundred megabytes of 46-byte records) could use up the memory of the server before the first
/// limit is checked. The number of entries and the size of the directory are in the end-of-directory record (and in its ZIP64
/// variant) and are read from there.
/// </summary>
public static class ZipDirectory
{
    private const int EndRecordLength = 22;
    private const int Zip64LocatorLength = 20;
    private const int Zip64EndRecordLength = 56;
    private static readonly byte[] EndSignature = [0x50, 0x4B, 0x05, 0x06];
    private static readonly byte[] Zip64LocatorSignature = [0x50, 0x4B, 0x06, 0x07];
    private static readonly byte[] Zip64EndSignature = [0x50, 0x4B, 0x06, 0x06];

    /// <summary>
    /// The number of entries the directory claims and the size of the area between the start of the directory and the end
    /// record. Throws <c>invalid_archive</c> when the stream is no ZIP file.
    /// </summary>
    public static (long Entries, long DirectoryBytes) Probe(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);
        var length = stream.Length;
        if (length < EndRecordLength)
        {
            throw TransferErrors.Invalid("The file is not a ZIP file.");
        }

        var tailLength = (int)Math.Min(length, EndRecordLength + ushort.MaxValue);
        var tail = new byte[tailLength];
        stream.Position = length - tailLength;
        stream.ReadExactly(tail);
        var index = tail.AsSpan(0, tailLength - EndRecordLength + 4).LastIndexOf(EndSignature);
        if (index < 0)
        {
            throw TransferErrors.Invalid("The file is not a ZIP file.");
        }

        var endPosition = length - tailLength + index;
        long entries = BinaryPrimitives.ReadUInt16LittleEndian(tail.AsSpan(index + 10));
        long directoryOffset = BinaryPrimitives.ReadUInt32LittleEndian(tail.AsSpan(index + 16));
        var directoryEnd = endPosition;
        if (entries == ushort.MaxValue || directoryOffset == uint.MaxValue || BinaryPrimitives.ReadUInt32LittleEndian(tail.AsSpan(index + 12)) == uint.MaxValue)
        {
            (entries, directoryOffset, directoryEnd) = ReadZip64(stream, endPosition);
        }

        var directoryBytes = directoryEnd - directoryOffset;
        if (directoryBytes < 0 || directoryOffset < 0)
        {
            throw TransferErrors.Invalid("The directory of the ZIP file is damaged.");
        }

        return (entries, directoryBytes);
    }

    private static (long Entries, long DirectoryOffset, long DirectoryEnd) ReadZip64(Stream stream, long endPosition)
    {
        if (endPosition < Zip64LocatorLength)
        {
            throw TransferErrors.Invalid("The directory of the ZIP file is damaged.");
        }

        var locator = new byte[Zip64LocatorLength];
        stream.Position = endPosition - Zip64LocatorLength;
        stream.ReadExactly(locator);
        var recordPosition = BinaryPrimitives.ReadInt64LittleEndian(locator.AsSpan(8));
        if (!locator.AsSpan(0, 4).SequenceEqual(Zip64LocatorSignature) || recordPosition < 0 || recordPosition + Zip64EndRecordLength > stream.Length)
        {
            throw TransferErrors.Invalid("The directory of the ZIP file is damaged.");
        }

        var record = new byte[Zip64EndRecordLength];
        stream.Position = recordPosition;
        stream.ReadExactly(record);
        if (!record.AsSpan(0, 4).SequenceEqual(Zip64EndSignature))
        {
            throw TransferErrors.Invalid("The directory of the ZIP file is damaged.");
        }

        return (BinaryPrimitives.ReadInt64LittleEndian(record.AsSpan(32)), BinaryPrimitives.ReadInt64LittleEndian(record.AsSpan(48)), recordPosition);
    }
}
