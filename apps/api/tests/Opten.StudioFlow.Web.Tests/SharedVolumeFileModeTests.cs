using System.Runtime.Versioning;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Infrastructure.Install;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// Issue #71: the private key of an uploaded certificate is readable by the API and the group it shares with Caddy only
/// (mode 640), no longer by everybody in a container that mounts the volume (644).
/// </summary>
[UnsupportedOSPlatform("windows")]
public sealed class SharedVolumeFileModeTests : IDisposable
{
    private const UnixFileMode OwnerAndGroupRead = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead;
    private const UnixFileMode Everyone = OwnerAndGroupRead | UnixFileMode.OtherRead;
    private const string Fingerprint = "0123456789abcdef0123456789abcdef";

    private readonly string folder = Directory.CreateTempSubdirectory("sf-certs-").FullName;

    public void Dispose() => Directory.Delete(folder, recursive: true);

    [Fact]
    public async Task Sync_WritesTheKeyForOwnerAndGroupAndTheCertificateForEverybody()
    {
        Assert.SkipWhen(OperatingSystem.IsWindows(), "Unix file modes");
        var files = new CaddyCertificateFiles(new InstallOptions { CaddyCertsPath = folder });

        var result = await files.SyncAsync(Fingerprint, "CERT", "KEY", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(OwnerAndGroupRead, File.GetUnixFileMode(Path.Combine(folder, "key-0123456789abcdef.pem")));
        Assert.Equal(Everyone, File.GetUnixFileMode(Path.Combine(folder, "cert-0123456789abcdef.pem")));
    }

    [Fact]
    public async Task Sync_AKeyThatAnEarlierVersionWroteForEverybody_IsClosedWithoutRewritingIt()
    {
        Assert.SkipWhen(OperatingSystem.IsWindows(), "Unix file modes");
        var key = Path.Combine(folder, "key-0123456789abcdef.pem");
        await File.WriteAllTextAsync(key, "KEY", new System.Text.UTF8Encoding(false), TestContext.Current.CancellationToken);
        File.SetUnixFileMode(key, Everyone);
        var files = new CaddyCertificateFiles(new InstallOptions { CaddyCertsPath = folder });

        await files.SyncAsync(Fingerprint, "CERT", "KEY", CancellationToken.None);

        Assert.Equal(OwnerAndGroupRead, File.GetUnixFileMode(key));
        Assert.Equal("KEY", await File.ReadAllTextAsync(key, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task WriteIfChanged_ModesFollowTheAudience()
    {
        Assert.SkipWhen(OperatingSystem.IsWindows(), "Unix file modes");
        foreach (var (audience, mode) in new[]
        {
            (FileAudience.Owner, UnixFileMode.UserRead | UnixFileMode.UserWrite),
            (FileAudience.OwnerAndGroup, OwnerAndGroupRead),
            (FileAudience.Everyone, Everyone),
        })
        {
            var path = Path.Combine(folder, audience + ".txt");

            Assert.True(await SharedVolumeFiles.WriteIfChangedAsync(path, "x", audience, "test", CancellationToken.None));

            Assert.Equal(mode, File.GetUnixFileMode(path));
        }
    }
}
