using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

/// <summary>The check of an uploaded certificate and key (mode <c>custom</c>, issue #27) before anything is saved.</summary>
public sealed class CertificateRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    /// <summary>A self-signed certificate for the given names and its key as PEM.</summary>
    private static (string Certificate, string Key, string EncryptedKey) Make(string[] names, TimeSpan validFrom, TimeSpan validFor, bool rsa = false)
    {
        using AsymmetricAlgorithm key = rsa ? RSA.Create(2048) : ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var subject = new X500DistinguishedName($"CN={names[0]}");
        var request = key is RSA rsaKey
            ? new CertificateRequest(subject, rsaKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            : new CertificateRequest(subject, (ECDsa)key, HashAlgorithmName.SHA256);
        var san = new SubjectAlternativeNameBuilder();
        foreach (var name in names)
        {
            san.AddDnsName(name);
        }

        request.CertificateExtensions.Add(san.Build());
        using var certificate = request.CreateSelfSigned(Now + validFrom, Now + validFrom + validFor);
        var pbe = new PbeParameters(PbeEncryptionAlgorithm.Aes256Cbc, HashAlgorithmName.SHA256, 1000);
        return (certificate.ExportCertificatePem(), key.ExportPkcs8PrivateKeyPem(), key.ExportEncryptedPkcs8PrivateKeyPem("secret", pbe));
    }

    private static (string Certificate, string Key, string EncryptedKey) Valid(params string[] names) => Make(names, TimeSpan.FromDays(-1), TimeSpan.FromDays(90));

    [Fact]
    public void Validate_AMatchingPairForTheDomain_IsAccepted_AndDescribed()
    {
        var (certificate, key, _) = Valid("studio.example.ch", "www.example.ch");
        var errors = new ValidationErrors();

        var pair = CertificateRules.Validate(certificate, key, "studio.example.ch", Now, errors);

        Assert.False(errors.HasErrors);
        Assert.NotNull(pair);
        Assert.Equal(["studio.example.ch", "www.example.ch"], pair.Names);
        Assert.Equal(Now.AddDays(89), pair.NotAfter);
        Assert.Equal(64, pair.Fingerprint.Length);
        Assert.StartsWith("-----BEGIN CERTIFICATE-----", pair.CertificatePem, StringComparison.Ordinal);
        Assert.StartsWith("-----BEGIN PRIVATE KEY-----", pair.PrivateKeyPem, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_AnRsaKeyInTheOldPkcs1Form_IsAccepted()
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=studio.example.ch", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("studio.example.ch");
        request.CertificateExtensions.Add(san.Build());
        using var certificate = request.CreateSelfSigned(Now.AddDays(-1), Now.AddDays(30));
        var errors = new ValidationErrors();

        var pair = CertificateRules.Validate(certificate.ExportCertificatePem(), rsa.ExportRSAPrivateKeyPem(), "studio.example.ch", Now, errors);

        Assert.False(errors.HasErrors);
        Assert.StartsWith("-----BEGIN RSA PRIVATE KEY-----", pair!.PrivateKeyPem, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_OnlyTheCheckedBlocksAreKept_NothingElseOfTheUpload()
    {
        var (certificate, key, _) = Valid("studio.example.ch");
        var errors = new ValidationErrors();

        var pair = CertificateRules.Validate("Bag Attributes\n  evil\n" + certificate + "\nTrailing garbage", "junk before\n" + key + "\njunk after", "studio.example.ch", Now, errors);

        Assert.False(errors.HasErrors);
        Assert.DoesNotContain("evil", pair!.CertificatePem, StringComparison.Ordinal);
        Assert.DoesNotContain("junk", pair.PrivateKeyPem, StringComparison.Ordinal);
        Assert.DoesNotContain("garbage", pair.CertificatePem, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_AWildcardCoversOneLabel()
    {
        var (certificate, key, _) = Valid("*.example.ch");

        var covered = new ValidationErrors();
        var notCovered = new ValidationErrors();
        var deeper = new ValidationErrors();

        Assert.NotNull(CertificateRules.Validate(certificate, key, "studio.example.ch", Now, covered));
        Assert.Null(CertificateRules.Validate(certificate, key, "example.ch", Now, notCovered));
        Assert.Null(CertificateRules.Validate(certificate, key, "a.studio.example.ch", Now, deeper));

        Assert.False(covered.HasErrors);
        Assert.Equal(SettingsFieldErrors.CertificateNameMismatch, string.Join(',', notCovered.ToDictionary()["certificatePem"]));
        Assert.Equal(SettingsFieldErrors.CertificateNameMismatch, string.Join(',', deeper.ToDictionary()["certificatePem"]));
    }

    [Fact]
    public void Validate_ACertificateForAnotherName_IsRefused()
    {
        var (certificate, key, _) = Valid("other.example.ch");
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, key, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateNameMismatch, string.Join(',', errors.ToDictionary()["certificatePem"]));
    }

    [Fact]
    public void Validate_ANameIsOnlyCheckedWhenThereIsADomain()
    {
        var (certificate, key, _) = Valid("anything.example.ch");

        Assert.NotNull(CertificateRules.Validate(certificate, key, null, Now, new ValidationErrors()));
    }

    [Fact]
    public void Validate_AKeyOfAnotherCertificate_IsRefused()
    {
        var (certificate, _, _) = Valid("studio.example.ch");
        var (_, otherKey, _) = Valid("studio.example.ch");
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, otherKey, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateKeyMismatch, string.Join(',', errors.ToDictionary()["privateKeyPem"]));
    }

    [Fact]
    public void Validate_AKeyOfAnotherAlgorithm_IsRefused()
    {
        var (certificate, _, _) = Make(["studio.example.ch"], TimeSpan.FromDays(-1), TimeSpan.FromDays(90));
        var (_, rsaKey, _) = Make(["studio.example.ch"], TimeSpan.FromDays(-1), TimeSpan.FromDays(90), rsa: true);
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, rsaKey, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateKeyMismatch, string.Join(',', errors.ToDictionary()["privateKeyPem"]));
    }

    [Fact]
    public void Validate_AKeyWithAPassword_IsRefusedWithItsOwnCode()
    {
        var (certificate, _, encrypted) = Valid("studio.example.ch");
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, encrypted, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.PrivateKeyEncrypted, string.Join(',', errors.ToDictionary()["privateKeyPem"]));
    }

    [Fact]
    public void Validate_AnExpiredCertificate_IsRefused()
    {
        var (certificate, key, _) = Make(["studio.example.ch"], TimeSpan.FromDays(-100), TimeSpan.FromDays(30));
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, key, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateExpired, string.Join(',', errors.ToDictionary()["certificatePem"]));
    }

    [Fact]
    public void Validate_ACertificateThatIsNotValidYet_IsRefused()
    {
        var (certificate, key, _) = Make(["studio.example.ch"], TimeSpan.FromDays(10), TimeSpan.FromDays(30));
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, key, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateNotYetValid, string.Join(',', errors.ToDictionary()["certificatePem"]));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("not a certificate", "not a key")]
    public void Validate_NoPemAtAll_IsRefusedForBoth(string? certificate, string? key)
    {
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, key, "studio.example.ch", Now, errors));

        Assert.True(errors.ToDictionary().ContainsKey("certificatePem"));
        Assert.True(errors.ToDictionary().ContainsKey("privateKeyPem"));
    }

    [Fact]
    public void Validate_PemBlocksThatAreNoCertificate_AreRefused()
    {
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----", "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateInvalid, string.Join(',', errors.ToDictionary()["certificatePem"]));
    }

    [Fact]
    public void Validate_TheKeyInPlaceOfTheCertificateAndBack_IsRefused()
    {
        var (certificate, key, _) = Valid("studio.example.ch");
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(key, certificate, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateInvalid, string.Join(',', errors.ToDictionary()["certificatePem"]));
        Assert.Equal(SettingsFieldErrors.PrivateKeyInvalid, string.Join(',', errors.ToDictionary()["privateKeyPem"]));
    }

    [Fact]
    public void Validate_TwoKeys_AreRefused()
    {
        var (certificate, key, _) = Valid("studio.example.ch");
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate, key + key, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.PrivateKeyInvalid, string.Join(',', errors.ToDictionary()["privateKeyPem"]));
    }

    [Fact]
    public void Validate_AHugeUpload_IsRefusedBeforeItIsParsed()
    {
        var (certificate, key, _) = Valid("studio.example.ch");
        var errors = new ValidationErrors();

        Assert.Null(CertificateRules.Validate(certificate + new string('A', ServerSettingsRules.MaxTextLength), key, "studio.example.ch", Now, errors));

        Assert.Equal(SettingsFieldErrors.CertificateInvalid, string.Join(',', errors.ToDictionary()["certificatePem"]));
    }

    [Fact]
    public void Describe_ReadsTheNamesWithoutAKey()
    {
        var (certificate, _, _) = Valid("studio.example.ch");

        var info = CertificateRules.Describe(certificate);

        Assert.Equal(["studio.example.ch"], info!.Names);
        Assert.Contains("studio.example.ch", info.Subject, StringComparison.Ordinal);
        Assert.Null(CertificateRules.Describe("garbage"));
        Assert.Null(CertificateRules.Describe(null));
    }
}
