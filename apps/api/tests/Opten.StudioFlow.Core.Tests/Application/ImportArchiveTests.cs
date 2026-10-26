using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Transfer;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Core.Domain.Transfer;
using Opten.StudioFlow.Core.Tests.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class ImportArchiveTests
{
    private static readonly byte[] Manifest = ManifestJson.Serialize(Fixture.Manifest());

    private static TransferOptions Options(Action<TransferOptions>? change = null)
    {
        var options = new TransferOptions { MaxEntries = 50 };
        change?.Invoke(options);
        return options;
    }

    private static byte[] Zip(params (string Name, byte[] Content)[] files)
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, content) in files)
            {
                using var target = zip.CreateEntry(name, CompressionLevel.Optimal).Open();
                target.Write(content);
            }
        }

        return stream.ToArray();
    }

    private static ImportArchive Open(byte[] archive, TransferOptions? options = null) => ImportArchive.Open(new MemoryStream(archive), options ?? Options());

    private static StudioFlowException Refused(byte[] archive, TransferOptions? options = null) =>
        Assert.Throws<StudioFlowException>(() => Open(archive, options).Dispose());

    [Theory]
    [InlineData("manifest.json", true)]
    [InlineData("media/a1.png", true)]
    [InlineData("media/", true)]
    [InlineData("a/b/c.txt", true)]
    [InlineData("Ünïcode/ü.png", true)]
    [InlineData("", false)]
    [InlineData("/etc/passwd", false)]
    [InlineData("../x", false)]
    [InlineData("media/../../x", false)]
    [InlineData("media/..", false)]
    [InlineData("media/../", false)]
    [InlineData("./x", false)]
    [InlineData("a/./b", false)]
    [InlineData("a//b", false)]
    [InlineData("a\\b", false)]
    [InlineData("..\\x", false)]
    [InlineData("C:/x", false)]
    [InlineData("C:x", false)]
    [InlineData("a:b", false)]
    [InlineData("a\0b", false)]
    [InlineData("a\nb", false)]
    [InlineData("a\u007fb", false)]
    public void IsSafeName_AcceptsOnlyNamesInsideTheArchive(string name, bool safe) => Assert.Equal(safe, ImportArchive.IsSafeName(name));

    [Fact]
    public void IsSafeName_VeryLongName_IsRefused() => Assert.False(ImportArchive.IsSafeName(new string('a', 256)));

    [Fact]
    public void Open_ValidArchive_ReadsTheManifestAndTheMedia()
    {
        var picture = new byte[] { 1, 2, 3, 4 };
        using var archive = Open(Zip(("manifest.json", Manifest), ("media/a1.png", picture)));

        var manifest = archive.ReadManifest();
        using var content = archive.OpenMedia("media/a1.png", 4);
        using var copy = new MemoryStream();
        content.CopyTo(copy);

        Assert.Equal(["manifest.json", "media/a1.png"], archive.FileNames.Order(StringComparer.Ordinal));
        Assert.Equal("Intro", manifest.Scenes[0].Name);
        Assert.Equal(picture, copy.ToArray());
        archive.RequireFiles(["media/a1.png"]);
    }

    [Theory]
    [InlineData("../evil.txt")]
    [InlineData("media/../../evil.txt")]
    [InlineData("/absolute.txt")]
    [InlineData("media\\evil.png")]
    [InlineData("C:/evil.txt")]
    public void Open_UnsafeName_IsInvalidArchive(string name)
    {
        var error = Refused(Zip(("manifest.json", Manifest), (name, [1])));

        Assert.Equal((ErrorKind.Validation, ErrorCodes.InvalidArchive), (error.Kind, error.Code));
        Assert.Contains("unsafe", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("readme.txt")]
    [InlineData("media/sub/a1.png")]
    [InlineData("other/a1.png")]
    [InlineData("Manifest.json")]
    public void Open_FileOfAnotherKind_IsInvalidArchive(string name)
    {
        var error = Refused(Zip(("manifest.json", Manifest), (name, [1])));

        Assert.Equal(ErrorCodes.InvalidArchive, error.Code);
        Assert.Contains("does not export", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Open_DirectoryEntries_AreTolerated()
    {
        using var archive = Open(Zip(("manifest.json", Manifest), ("media/", [])));

        Assert.Equal(["manifest.json"], archive.FileNames);
    }

    [Fact]
    public void Open_SameNameTwice_IsInvalidArchive()
    {
        var error = Refused(Zip(("manifest.json", Manifest), ("media/a1.png", [1]), ("media/a1.png", [2])));

        Assert.Contains("twice", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Open_ZipBomb_RatioAboveTheLimit_IsInvalidArchive()
    {
        var bomb = new byte[20 * 1024 * 1024];
        var archive = Zip(("manifest.json", Manifest), ("media/a1.png", bomb));
        Assert.True(archive.Length < 100_000);

        var error = Refused(archive);

        Assert.Equal(ErrorCodes.InvalidArchive, error.Code);
        Assert.Contains("times its size", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Open_SmallFilesMayCompressWell_BelowTheCheckedSize()
    {
        using var archive = Open(Zip(("manifest.json", Manifest), ("media/a1.png", new byte[500_000])));

        Assert.Equal(2, archive.FileNames.Count);
    }

    [Fact]
    public void Open_HighRatioInAllFilesTogether_IsInvalidArchive()
    {
        // Each file alone stays below the size the ratio is checked from; together they do not.
        var files = Enumerable.Range(0, 8).Select(i => ($"media/f{i}.png", new byte[900_000])).Prepend(("manifest.json", Manifest)).ToArray();

        var error = Refused(Zip(files));

        Assert.Contains("the archive", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Open_MoreEntriesThanTheLimit_IsTooLarge()
    {
        var files = Enumerable.Range(0, 60).Select(i => ($"media/f{i}.png", new byte[] { 1 })).ToArray();

        var error = Refused(Zip(files));

        Assert.Equal((ErrorKind.PayloadTooLarge, ErrorCodes.ArchiveTooLarge), (error.Kind, error.Code));
    }

    [Fact]
    public void Open_DirectoryThatClaimsMoreEntries_IsRefusedBeforeItIsRead()
    {
        var archive = Zip(("manifest.json", Manifest));
        BinaryPrimitives.WriteUInt16LittleEndian(archive.AsSpan(archive.Length - 22 + 10), 40_000);

        Assert.Equal(ErrorCodes.ArchiveTooLarge, Refused(archive).Code);
    }

    [Fact]
    public void Open_Zip64DirectoryThatClaimsBillionsOfEntries_IsRefusedBeforeItIsRead()
    {
        // A ZIP64 end record claiming 4 billion entries behind a normal-looking file.
        var body = Zip(("manifest.json", Manifest));
        using var stream = new MemoryStream();
        stream.Write(body, 0, body.Length - 22);
        var endOfZip64 = stream.Position;
        var record = new byte[56];
        "PK\u0006\u0006"u8.CopyTo(record);
        BinaryPrimitives.WriteInt64LittleEndian(record.AsSpan(4), 44);
        BinaryPrimitives.WriteInt64LittleEndian(record.AsSpan(24), 4_000_000_000);
        BinaryPrimitives.WriteInt64LittleEndian(record.AsSpan(32), 4_000_000_000);
        BinaryPrimitives.WriteInt64LittleEndian(record.AsSpan(48), BinaryPrimitives.ReadUInt32LittleEndian(body.AsSpan(body.Length - 22 + 16)));
        stream.Write(record);
        var locator = new byte[20];
        "PK\u0006\u0007"u8.CopyTo(locator);
        BinaryPrimitives.WriteInt64LittleEndian(locator.AsSpan(8), endOfZip64);
        BinaryPrimitives.WriteUInt32LittleEndian(locator.AsSpan(16), 1);
        stream.Write(locator);
        var end = body.AsSpan(body.Length - 22).ToArray();
        BinaryPrimitives.WriteUInt16LittleEndian(end.AsSpan(10), ushort.MaxValue);
        stream.Write(end);

        Assert.Equal(ErrorCodes.ArchiveTooLarge, Refused(stream.ToArray()).Code);
    }

    [Fact]
    public void Open_UnpackedSizeAboveTheLimit_IsTooLarge()
    {
        var random = new Random(3);
        var data = new byte[3_000_000];
        for (var i = 0; i < data.Length; i++)
        {
            data[i] = (byte)random.Next(4);
        }

        var error = Refused(Zip(("manifest.json", Manifest), ("media/a1.png", data)), Options(o => o.MaxUnpackedBytes = 2_000_000));

        Assert.Equal(ErrorCodes.ArchiveTooLarge, error.Code);
    }

    [Fact]
    public void Open_FileLargerThanTheImportLimit_IsTooLarge()
    {
        var archive = Zip(("manifest.json", Manifest));

        Assert.Equal(ErrorCodes.ArchiveTooLarge, Refused(archive, Options(o => o.MaxImportBytes = 10)).Code);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    [InlineData(21)]
    public void Open_TooShortToBeAZipFile_IsInvalidArchive(int length) =>
        Assert.Equal(ErrorCodes.InvalidArchive, Refused(new byte[length]).Code);

    [Fact]
    public void Open_NoZipFile_IsInvalidArchive() =>
        Assert.Equal(ErrorCodes.InvalidArchive, Refused(Encoding.UTF8.GetBytes(new string('x', 5000))).Code);

    [Fact]
    public void Open_TruncatedZip_IsInvalidArchive()
    {
        var archive = Zip(("manifest.json", Manifest), ("media/a1.png", new byte[5000]));

        Assert.Equal(ErrorCodes.InvalidArchive, Refused(archive[..(archive.Length / 2)]).Code);
    }

    [Fact]
    public void Open_NotSeekable_Throws() =>
        Assert.Throws<ArgumentException>(() => ImportArchive.Open(new NonSeekable(), Options()));

    [Fact]
    public void ReadManifest_Missing_IsInvalidArchive()
    {
        using var archive = Open(Zip(("media/a1.png", [1])));

        Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => archive.ReadManifest()).Code);
    }

    [Fact]
    public void ReadManifest_LargerThanTheLimit_IsTooLarge()
    {
        using var archive = Open(Zip(("manifest.json", Manifest)), Options(o => o.MaxManifestBytes = 100));

        Assert.Equal(ErrorCodes.ArchiveTooLarge, Assert.Throws<StudioFlowException>(() => archive.ReadManifest()).Code);
    }

    [Fact]
    public void ReadManifest_NewerFormat_IsUnsupported()
    {
        var newer = Encoding.UTF8.GetBytes("""{"format":"studioflow-production","formatVersion":7}""");
        using var archive = Open(Zip(("manifest.json", newer)));

        Assert.Equal(ErrorCodes.UnsupportedFormat, Assert.Throws<StudioFlowException>(() => archive.ReadManifest()).Code);
    }

    [Fact]
    public void RequireFiles_ExtraAndMissingFiles_AreInvalid()
    {
        using var archive = Open(Zip(("manifest.json", Manifest), ("media/a1.png", [1]), ("media/extra.png", [1])));

        Assert.Contains("does not name", Assert.Throws<StudioFlowException>(() => archive.RequireFiles(["media/a1.png"])).Message, StringComparison.Ordinal);
        Assert.Contains("does not contain", Assert.Throws<StudioFlowException>(() => archive.RequireFiles(["media/a1.png", "media/extra.png", "media/missing.png"])).Message, StringComparison.Ordinal);
        archive.RequireFiles(["media/a1.png", "media/extra.png"]);
    }

    [Fact]
    public void OpenMedia_SizeDifferentFromTheManifest_IsInvalid()
    {
        using var archive = Open(Zip(("manifest.json", Manifest), ("media/a1.png", [1, 2, 3])));

        Assert.Contains("size", Assert.Throws<StudioFlowException>(() => archive.OpenMedia("media/a1.png", 4)).Message, StringComparison.Ordinal);
        Assert.Throws<StudioFlowException>(() => archive.OpenMedia("media/missing.png", 3));
    }

    [Fact]
    public void OpenMedia_CompressedEntryWhoseDirectoryUnderstatesTheSize_NeverDeliversMoreThanDeclared()
    {
        var data = new byte[4_000_000];
        var archive = Zip(("manifest.json", Manifest), ("media/a1.png", data));
        PatchUncompressedSize(archive, "media/a1.png", 1000);
        using var imported = Open(archive);

        using var content = imported.OpenMedia("media/a1.png", 1000);
        using var copy = new MemoryStream();
        var outcome = Record.Exception(() => content.CopyTo(copy));

        // The decompressor cuts the data at the declared size or refuses it; either way no byte beyond it arrives.
        Assert.True(copy.Length <= 1000);
        Assert.True(outcome is null or StudioFlowException);
    }

    [Fact]
    public void OpenMedia_StoredEntryWhoseDirectoryUnderstatesTheSize_IsInvalid()
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, content) in new[] { ("manifest.json", Manifest), ("media/a1.png", new byte[20_000]) })
            {
                using var target = zip.CreateEntry(name, CompressionLevel.NoCompression).Open();
                target.Write(content);
            }
        }

        var archive = stream.ToArray();
        PatchUncompressedSize(archive, "media/a1.png", 1000);
        var error = Record.Exception(() =>
        {
            using var imported = Open(archive);
            using var content = imported.OpenMedia("media/a1.png", 1000);
            content.CopyTo(Stream.Null);
        });

        Assert.Equal(ErrorCodes.InvalidArchive, Assert.IsType<StudioFlowException>(error).Code);
    }

    [Fact]
    public async Task OpenMedia_EverythingUnpacked_CountsAgainstTheBudgetOfTheArchive()
    {
        var one = new byte[1_000_000];
        var random = new Random(5);
        for (var i = 0; i < one.Length; i++)
        {
            one[i] = (byte)random.Next(4);
        }

        var archive = Zip(("manifest.json", Manifest), ("media/a1.png", one));
        using var imported = Open(archive, Options(o => o.MaxUnpackedBytes = 1_500_000));

        // Once is what the directory announced; reading the file a second time would unpack more than the limit.
        await using (var first = imported.OpenMedia("media/a1.png", one.Length))
        {
            await first.CopyToAsync(Stream.Null, TestContext.Current.CancellationToken);
        }

        await using var second = imported.OpenMedia("media/a1.png", one.Length);
        var error = await Assert.ThrowsAsync<StudioFlowException>(() => second.CopyToAsync(Stream.Null, TestContext.Current.CancellationToken));

        Assert.Equal(ErrorCodes.ArchiveTooLarge, error.Code);
    }

    [Fact]
    public void DeclaredLengthStream_ShorterThanDeclared_IsInvalid()
    {
        using var stream = new DeclaredLengthStream(new MemoryStream(new byte[10]), 20, new UnpackBudget(100));

        Assert.Equal(ErrorCodes.InvalidArchive, Assert.Throws<StudioFlowException>(() => stream.CopyTo(Stream.Null)).Code);
    }

    [Fact]
    public void DeclaredLengthStream_Exact_ReadsToTheEnd()
    {
        using var stream = new DeclaredLengthStream(new MemoryStream(new byte[10]), 10, new UnpackBudget(100));
        using var copy = new MemoryStream();

        stream.CopyTo(copy);

        Assert.Equal(10, copy.Length);
        Assert.Equal(10, stream.Position);
        Assert.Equal(10, stream.Length);
        Assert.Equal(0, stream.Read([]));
    }

    [Fact]
    public void HashingReadStream_ComputesTheSha256OfWhatWasRead()
    {
        var data = new byte[100_000];
        new Random(7).NextBytes(data);
        using var stream = new HashingReadStream(new MemoryStream(data));

        stream.CopyTo(Stream.Null);

        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(data)), stream.Finish());
        Assert.Equal(data.Length, stream.BytesRead);
    }

    [Fact]
    public async Task ExportArchive_WritesMediaThenTheManifestWithTheChecksums()
    {
        var picture = new byte[] { 9, 8, 7, 6, 5 };
        var manifest = Fixture.Manifest();
        var entry = manifest.Assets[0];
        using var output = new MemoryStream();

        await ExportArchive.WriteAsync(output, manifest, [new ExportMedia("ast_x", "ast_x.png", entry with { Sha256 = string.Empty, SizeBytes = 0 })], [new MemoryStream(picture)], TestContext.Current.CancellationToken);

        using var reader = ImportArchive.Open(new MemoryStream(output.ToArray()), Options());
        var read = reader.ReadManifest();
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(picture)), read.Assets[0].Sha256);
        Assert.Equal(picture.Length, read.Assets[0].SizeBytes);
        reader.RequireFiles(["media/a1.png"]);
        using var content = reader.OpenMedia("media/a1.png", picture.Length);
        using var copy = new MemoryStream();
        content.CopyTo(copy);
        Assert.Equal(picture, copy.ToArray());
    }

    /// <summary>Writes another uncompressed size into the central directory entry of a file (a directory that lies).</summary>
    private static void PatchUncompressedSize(byte[] archive, string name, uint size)
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        for (var i = 0; i < archive.Length - 46; i++)
        {
            if (archive[i] == 0x50 && archive[i + 1] == 0x4B && archive[i + 2] == 0x01 && archive[i + 3] == 0x02 && archive.AsSpan(i + 46, nameBytes.Length).SequenceEqual(nameBytes))
            {
                BinaryPrimitives.WriteUInt32LittleEndian(archive.AsSpan(i + 24), size);
                return;
            }
        }

        throw new InvalidOperationException("Entry not found.");
    }

    private sealed class NonSeekable : MemoryStream
    {
        public override bool CanSeek => false;
    }
}
