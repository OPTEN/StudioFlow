using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Web.Security;

/// <summary>
/// Protects the secrets of the server settings (DNS credentials, the private key of a custom certificate, the rclone
/// configuration) with ASP.NET Core Data Protection. The keys live in the <c>keys</c> volume next to the cookie keys and are
/// part of every backup, so a restore can read what it restores. The purpose string separates these payloads from every
/// other use of the keys.
/// </summary>
internal sealed class DataProtectionSecretProtector(IDataProtectionProvider provider) : ISecretProtector
{
    private const string Purpose = "StudioFlow.ServerSettings.v1";

    private readonly IDataProtector protector = provider.CreateProtector(Purpose);

    public string Protect(string plain)
    {
        ArgumentNullException.ThrowIfNull(plain);
        return protector.Protect(plain);
    }

    public string? Unprotect(string? protectedValue)
    {
        if (string.IsNullOrEmpty(protectedValue))
        {
            return null;
        }

        try
        {
            return protector.Unprotect(protectedValue);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }
}
