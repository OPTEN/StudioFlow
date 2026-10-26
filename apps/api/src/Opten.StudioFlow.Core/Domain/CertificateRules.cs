using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>A certificate and key pair that passed <see cref="CertificateRules"/>, in the normal form that is stored and given to Caddy.</summary>
/// <param name="CertificatePem">The certificate chain, leaf first, one PEM block per certificate.</param>
/// <param name="PrivateKeyPem">The private key as one PEM block.</param>
/// <param name="Subject">Subject of the leaf.</param>
/// <param name="Names">DNS names the leaf covers.</param>
/// <param name="NotAfter">When the leaf expires.</param>
/// <param name="Fingerprint">SHA-256 of the leaf (lower case hex).</param>
public sealed record CertificatePair(string CertificatePem, string PrivateKeyPem, string Subject, IReadOnlyList<string> Names, DateTimeOffset NotAfter, string Fingerprint);

/// <summary>
/// Checks an uploaded certificate and private key (mode <c>custom</c>, issue #27) before anything is saved: both are PEM,
/// the key is not encrypted and belongs to the certificate, the certificate is valid now and covers the domain. The result
/// holds only the PEM blocks that were checked, re-encoded, so nothing else from the upload reaches the disk.
/// </summary>
public static class CertificateRules
{
    private const int MaxChain = 6;

    private static readonly string[] KeyLabels = ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY"];

    /// <summary>Validates the pair; adds the codes of <see cref="SettingsFieldErrors"/> and returns null when it is not usable.</summary>
    public static CertificatePair? Validate(string? certificatePem, string? privateKeyPem, string? domain, DateTimeOffset now, ValidationErrors errors)
    {
        ArgumentNullException.ThrowIfNull(errors);
        var chain = ReadChain(certificatePem);
        if (chain is null)
        {
            errors.Add("certificatePem", SettingsFieldErrors.CertificateInvalid);
        }

        var keyPem = ReadKey(privateKeyPem, errors);
        if (chain is null || keyPem is null)
        {
            return null;
        }

        try
        {
            using var leaf = X509Certificate2.CreateFromPem(chain[0], keyPem);
            if (!leaf.HasPrivateKey)
            {
                errors.Add("privateKeyPem", SettingsFieldErrors.CertificateKeyMismatch);
                return null;
            }

            return CheckValidity(leaf, chain, keyPem, domain, now, errors);
        }
        catch (Exception exception) when (exception is CryptographicException or ArgumentException)
        {
            errors.Add("privateKeyPem", SettingsFieldErrors.CertificateKeyMismatch);
            return null;
        }
    }

    /// <summary>Describes a stored certificate (public part only), or null when it cannot be read.</summary>
    public static CertificateInfoDto? Describe(string? certificatePem)
    {
        var chain = ReadChain(certificatePem);
        if (chain is null)
        {
            return null;
        }

        try
        {
            using var leaf = X509Certificate2.CreateFromPem(chain[0]);
            return new CertificateInfoDto(leaf.Subject, NamesOf(leaf), new DateTimeOffset(leaf.NotAfter.ToUniversalTime()), Convert.ToHexStringLower(leaf.GetCertHash(HashAlgorithmName.SHA256)));
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    private static CertificatePair? CheckValidity(X509Certificate2 leaf, List<string> chain, string keyPem, string? domain, DateTimeOffset now, ValidationErrors errors)
    {
        var notAfter = new DateTimeOffset(leaf.NotAfter.ToUniversalTime());
        var failed = false;
        if (notAfter <= now)
        {
            errors.Add("certificatePem", SettingsFieldErrors.CertificateExpired);
            failed = true;
        }
        else if (new DateTimeOffset(leaf.NotBefore.ToUniversalTime()) > now)
        {
            errors.Add("certificatePem", SettingsFieldErrors.CertificateNotYetValid);
            failed = true;
        }

        var names = NamesOf(leaf);
        if (domain is not null && !names.Any(name => Covers(name, domain)))
        {
            errors.Add("certificatePem", SettingsFieldErrors.CertificateNameMismatch);
            failed = true;
        }

        return failed
            ? null
            : new CertificatePair(string.Concat(chain), keyPem, leaf.Subject, names, notAfter, Convert.ToHexStringLower(leaf.GetCertHash(HashAlgorithmName.SHA256)));
    }

    /// <summary>The CERTIFICATE blocks of the text, each re-encoded; null when there is none, too many, or one cannot be read.</summary>
    private static List<string>? ReadChain(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > ServerSettingsRules.MaxTextLength)
        {
            return null;
        }

        var blocks = new List<string>();
        var rest = text.AsSpan();
        while (PemEncoding.TryFind(rest, out var fields))
        {
            if (!rest[fields.Label].SequenceEqual("CERTIFICATE"))
            {
                return null;
            }

            try
            {
                var der = Convert.FromBase64String(new string(rest[fields.Base64Data]));
                using (X509CertificateLoader.LoadCertificate(der))
                {
                    blocks.Add(new string(PemEncoding.Write("CERTIFICATE", der)) + "\n");
                }
            }
            catch (Exception exception) when (exception is FormatException or CryptographicException)
            {
                return null;
            }

            rest = rest[fields.Location.End..];
            if (blocks.Count > MaxChain)
            {
                return null;
            }
        }

        return blocks.Count == 0 ? null : blocks;
    }

    /// <summary>The one private key block, re-encoded; adds a code and returns null when there is none, it is encrypted or there are several.</summary>
    private static string? ReadKey(string? text, ValidationErrors errors)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > ServerSettingsRules.MaxTextLength)
        {
            errors.Add("privateKeyPem", SettingsFieldErrors.PrivateKeyInvalid);
            return null;
        }

        if (text.Contains("ENCRYPTED PRIVATE KEY", StringComparison.Ordinal) || text.Contains("Proc-Type: 4,ENCRYPTED", StringComparison.Ordinal))
        {
            errors.Add("privateKeyPem", SettingsFieldErrors.PrivateKeyEncrypted);
            return null;
        }

        string? result = null;
        var rest = text.AsSpan();
        while (PemEncoding.TryFind(rest, out var fields))
        {
            var label = new string(rest[fields.Label]);
            if (Array.IndexOf(KeyLabels, label) >= 0 && result is null)
            {
                try
                {
                    result = new string(PemEncoding.Write(label, Convert.FromBase64String(new string(rest[fields.Base64Data])))) + "\n";
                }
                catch (FormatException)
                {
                    result = null;
                }
            }
            else if (Array.IndexOf(KeyLabels, label) >= 0)
            {
                errors.Add("privateKeyPem", SettingsFieldErrors.PrivateKeyInvalid);
                return null;
            }

            rest = rest[fields.Location.End..];
        }

        if (result is null)
        {
            errors.Add("privateKeyPem", SettingsFieldErrors.PrivateKeyInvalid);
        }

        return result;
    }

    /// <summary>The DNS names of the subject alternative name extension; the common name only when the extension is missing.</summary>
    private static List<string> NamesOf(X509Certificate2 certificate)
    {
        var names = new List<string>();
        foreach (var extension in certificate.Extensions.OfType<X509SubjectAlternativeNameExtension>())
        {
            names.AddRange(extension.EnumerateDnsNames().Select(name => name.ToLowerInvariant()));
        }

        if (names.Count == 0 && certificate.GetNameInfo(X509NameType.SimpleName, forIssuer: false) is { Length: > 0 } common)
        {
            names.Add(common.ToLowerInvariant());
        }

        return names;
    }

    /// <summary>True when the certificate name (maybe <c>*.example.ch</c>) covers the host, as a browser matches it: the wildcard stands for exactly one label.</summary>
    public static bool Covers(string name, string host)
    {
        if (!name.StartsWith("*.", StringComparison.Ordinal))
        {
            return string.Equals(name, host, StringComparison.Ordinal);
        }

        var dot = host.IndexOf('.', StringComparison.Ordinal);
        return dot > 0 && string.Equals(name[1..], host[dot..], StringComparison.Ordinal);
    }
}
