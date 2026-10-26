using System.Security.Cryptography;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// The one-time code of the first-run setup (issue #4). It exists only while no Regie account exists, only in memory
/// (so every restart makes a new one) and is shown nowhere but in the server log. It has the form <c>XXXX-XXXX</c>
/// from 32 unambiguous characters (no I, O, 0, 1), about 40 bits, and is compared in constant time.
/// </summary>
public sealed class SetupCode
{
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private const int GroupLength = 4;
    private const int Groups = 2;

    private volatile string? current;

    /// <summary>The code in use as <c>XXXX-XXXX</c>, or null when the setup is closed.</summary>
    public string? Current
    {
        get
        {
            var code = current;
            return code is null ? null : string.Join('-', Enumerable.Range(0, Groups).Select(i => code.Substring(i * GroupLength, GroupLength)));
        }
    }

    /// <summary>Creates a new code that replaces the one in use.</summary>
    public string Issue()
    {
        current = new string(RandomNumberGenerator.GetItems<char>(Alphabet, GroupLength * Groups));
        return Current!;
    }

    /// <summary>Invalidates the code (the account exists now).</summary>
    public void Clear() => current = null;

    /// <summary>True when the typed code is the code in use; case, spaces and the hyphen do not matter.</summary>
    public bool Matches(string? candidate)
    {
        var code = current;
        return code is not null && Secrets.FixedTimeEquals(Normalize(candidate), code);
    }

    private static string Normalize(string? text) =>
        string.Concat((text ?? string.Empty).Where(c => c is not ('-' or ' ')).Select(char.ToUpperInvariant));
}
