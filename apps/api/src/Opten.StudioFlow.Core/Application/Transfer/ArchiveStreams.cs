using System.Security.Cryptography;
using Opten.StudioFlow.Core.Domain.Transfer;

namespace Opten.StudioFlow.Core.Application.Transfer;

/// <summary>The bytes unpacked from one archive so far, shared by all its entries, against <see cref="TransferOptions.MaxUnpackedBytes"/>.</summary>
public sealed class UnpackBudget(long limit)
{
    private long used;

    /// <summary>Bytes unpacked so far.</summary>
    public long Used => Interlocked.Read(ref used);

    /// <summary>Counts bytes and throws <c>archive_too_large</c> when the limit is exceeded.</summary>
    public void Spend(long bytes)
    {
        if (Interlocked.Add(ref used, bytes) > limit)
        {
            throw TransferErrors.TooLarge("The files in the archive are larger together than this installation accepts.");
        }
    }
}

/// <summary>
/// The content of one ZIP entry, held to what the directory says about it: more bytes than declared (the directory lies to
/// pass the checks), fewer (a truncated file) and damaged compressed data are <c>invalid_archive</c>; the bytes count
/// against the budget of the archive. A bomb therefore never gets further than the size the directory announced.
/// </summary>
public sealed class DeclaredLengthStream(Stream inner, long declaredLength, UnpackBudget budget) : Stream
{
    private long read;

    /// <inheritdoc />
    public override bool CanRead => true;

    /// <inheritdoc />
    public override bool CanSeek => false;

    /// <inheritdoc />
    public override bool CanWrite => false;

    /// <inheritdoc />
    public override long Length => declaredLength;

    /// <inheritdoc />
    public override long Position
    {
        get => read;
        set => throw new NotSupportedException();
    }

    /// <inheritdoc />
    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    /// <inheritdoc />
    public override int Read(Span<byte> buffer)
    {
        if (buffer.IsEmpty)
        {
            return 0;
        }

        int count;
        try
        {
            count = inner.Read(buffer);
        }
        catch (InvalidDataException)
        {
            throw TransferErrors.Invalid("A file in the archive is damaged.");
        }

        return Account(count);
    }

    /// <inheritdoc />
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        if (buffer.IsEmpty)
        {
            return 0;
        }

        int count;
        try
        {
            count = await inner.ReadAsync(buffer, cancellationToken);
        }
        catch (InvalidDataException)
        {
            throw TransferErrors.Invalid("A file in the archive is damaged.");
        }

        return Account(count);
    }

    /// <inheritdoc />
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <inheritdoc />
    public override void Flush()
    {
    }

    /// <inheritdoc />
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void SetLength(long value) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            inner.Dispose();
        }

        base.Dispose(disposing);
    }

    private int Account(int count)
    {
        if (count == 0)
        {
            if (read != declaredLength)
            {
                throw TransferErrors.Invalid("A file in the archive is shorter than the directory says.");
            }

            return 0;
        }

        read += count;
        if (read > declaredLength)
        {
            throw TransferErrors.Invalid("A file in the archive is larger than the directory says.");
        }

        budget.Spend(count);
        return count;
    }
}

/// <summary>A read-through stream that computes the SHA-256 of everything read from it.</summary>
public sealed class HashingReadStream(Stream inner) : Stream
{
    private readonly IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

    /// <summary>Bytes read so far.</summary>
    public long BytesRead { get; private set; }

    /// <inheritdoc />
    public override bool CanRead => true;

    /// <inheritdoc />
    public override bool CanSeek => false;

    /// <inheritdoc />
    public override bool CanWrite => false;

    /// <inheritdoc />
    public override long Length => inner.Length;

    /// <inheritdoc />
    public override long Position
    {
        get => BytesRead;
        set => throw new NotSupportedException();
    }

    /// <summary>The SHA-256 of what was read, as 64 lowercase hex characters; call it once, after the last read.</summary>
    public string Finish() => Convert.ToHexStringLower(hash.GetHashAndReset());

    /// <inheritdoc />
    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    /// <inheritdoc />
    public override int Read(Span<byte> buffer)
    {
        var count = inner.Read(buffer);
        Add(buffer[..count]);
        return count;
    }

    /// <inheritdoc />
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var count = await inner.ReadAsync(buffer, cancellationToken);
        Add(buffer.Span[..count]);
        return count;
    }

    /// <inheritdoc />
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <inheritdoc />
    public override void Flush()
    {
    }

    /// <inheritdoc />
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void SetLength(long value) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            hash.Dispose();
            inner.Dispose();
        }

        base.Dispose(disposing);
    }

    private void Add(ReadOnlySpan<byte> bytes)
    {
        hash.AppendData(bytes);
        BytesRead += bytes.Length;
    }
}
