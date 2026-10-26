using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain.Transfer;

/// <summary>
/// The errors of reading an export (spec 4.2.2). They are expected answers to a bad file, not bugs: the file is refused with
/// <c>invalid_archive</c> (400), <c>unsupported_format</c> (400) or <c>archive_too_large</c> (413), and nothing of it is kept.
/// The English messages are for diagnostics; the Regie shows its own text for the code.
/// </summary>
public static class TransferErrors
{
    /// <summary>The file is no StudioFlow export, is damaged or unsafe.</summary>
    public static StudioFlowException Invalid(string message, string? path = null) =>
        new(ErrorKind.Validation, ErrorCodes.InvalidArchive, message, path is null ? null : new Dictionary<string, string[]>(StringComparer.Ordinal) { [path] = [message] });

    /// <summary>The file was written by a newer version of the format.</summary>
    public static StudioFlowException Unsupported(int version) =>
        new(ErrorKind.Validation, ErrorCodes.UnsupportedFormat, $"The file uses export format {version}; this version of StudioFlow reads format {ManifestFormat.CurrentVersion} and older. Update StudioFlow first.");

    /// <summary>The file exceeds a limit of this installation.</summary>
    public static StudioFlowException TooLarge(string message) => new(ErrorKind.PayloadTooLarge, ErrorCodes.ArchiveTooLarge, message);

    /// <summary>Throws <see cref="Invalid"/> with the field errors when there are any.</summary>
    public static void ThrowIfAny(ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (errors.HasErrors)
        {
            throw new StudioFlowException(ErrorKind.Validation, ErrorCodes.InvalidArchive, "The file is not a valid StudioFlow export.", errors.ToDictionary());
        }
    }
}
