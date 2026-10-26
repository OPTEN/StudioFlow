using System.Text.RegularExpressions;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// Rules for the user name and the password of the Regie account (issue #4): a password has at least
/// <see cref="MinPasswordLength"/> characters, differs from the user name (ignoring case) and is not one of the common
/// passwords. Violations are reported as <see cref="FieldErrorCodes"/> the client turns into its own texts.
/// </summary>
public static partial class AdminAccountRules
{
    /// <summary>Minimum length of the password.</summary>
    public const int MinPasswordLength = 12;

    /// <summary>Maximum length of the password; longer input is refused before it reaches the hasher.</summary>
    public const int MaxPasswordLength = 256;

    /// <summary>Passwords people choose first. Only entries of at least <see cref="MinPasswordLength"/> characters can matter; compared in lower case.</summary>
    private static readonly HashSet<string> CommonPasswords = new(StringComparer.Ordinal)
    {
        "password1234", "password12345", "password123456", "passwordpassword", "password!234", "passw0rd1234", "p@ssw0rd1234",
        "p@ssword1234", "123456789012", "1234567890123", "12345678901234", "123456123456", "111111111111", "000000000000",
        "aaaaaaaaaaaa", "123123123123", "qwertyuiop12", "qwertyuiop123", "qwertyuiopas", "qwerty123456", "qwertz123456",
        "qwertzuiop12", "1q2w3e4r5t6y", "1qaz2wsx3edc", "abcdefghijkl", "abcd12345678", "iloveyou1234", "letmein12345",
        "welcome12345", "willkommen123", "passwort1234", "administrator", "administrator1", "admin1234567", "adminadmin12",
        "changeme1234", "changemenow", "changeme12345", "trustno1trustno1", "monkeymonkey12", "football1234", "baseball1234",
        "superman1234", "correcthorsebatterystaple", "studioflow", "studioflow123", "studioflow1234", "studioflow2026",
        "opten123456", "opten1234567",
    };

    /// <summary>Checks the user name of a new account; adds <see cref="FieldErrorCodes.UsernameInvalid"/> when it does not fit.</summary>
    public static string? ValidateUsername(string? username, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var trimmed = username?.Trim();
        if (trimmed is null || !UsernamePattern().IsMatch(trimmed))
        {
            errors.Add("username", FieldErrorCodes.UsernameInvalid);
            return null;
        }

        return trimmed;
    }

    /// <summary>Checks a new password against the user name; adds one error per violated rule.</summary>
    public static void ValidatePassword(string? password, string? username, string field, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (string.IsNullOrEmpty(password) || password.Length < MinPasswordLength)
        {
            errors.Add(field, FieldErrorCodes.PasswordTooShort);
            return;
        }

        if (password.Length > MaxPasswordLength)
        {
            errors.Add(field, FieldErrorCodes.PasswordTooLong);
            return;
        }

        if (string.Equals(password, username?.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            errors.Add(field, FieldErrorCodes.PasswordEqualsUsername);
        }

        if (CommonPasswords.Contains(password.ToLowerInvariant()))
        {
            errors.Add(field, FieldErrorCodes.PasswordTooCommon);
        }
    }

    [GeneratedRegex(@"^[A-Za-z0-9._@-]{1,64}$")]
    private static partial Regex UsernamePattern();
}
