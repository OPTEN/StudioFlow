using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Opten.StudioFlow.Core.Application.Ports;

namespace Opten.StudioFlow.Web.Tests.Support;

/// <summary>Caddy's admin API as a recorder; it forgets what it loaded when it "restarts".</summary>
public sealed class RecordingCaddy : ICaddyGateway
{
    public string? Loaded { get; private set; }

    public string? Name { get; private set; }

    public int Loads { get; private set; }

    public bool IsConfigured => true;

    public void Restart()
    {
        Loaded = null;
        Name = null;
    }

    public Task<bool> IsLoadedAsync(string serverName, CancellationToken cancellationToken) => Task.FromResult(string.Equals(Name, serverName, StringComparison.Ordinal));

    public Task LoadAsync(string caddyfile, CancellationToken cancellationToken)
    {
        Loaded = caddyfile;
        Name = System.Text.RegularExpressions.Regex.Match(caddyfile, @"name (sf-[0-9a-f]{12})").Groups[1].Value;
        Loads++;
        return Task.CompletedTask;
    }
}

/// <summary>
/// The API as an installation runs it: the shared volumes are folders, Caddy is a recorder, and a small loop plays the
/// LiveKit supervisor (it writes <c>applied.json</c> when <c>livekit.yaml</c> changes). Address and embedding come from the
/// server settings, not from the overrides the other tests use.
/// </summary>
public class InstalledApp(PostgresFixture postgres, string? database = null) : StudioFlowApp(postgres)
{
    private readonly CancellationTokenSource stopSupervisor = new();
    private Task supervisor = Task.CompletedTask;

    public RecordingCaddy Caddy { get; private set; } = new();

    public string Root { get; } = Directory.CreateTempSubdirectory("sf-install-").FullName;

    public string LiveKitFolder => Path.Combine(Root, "livekit");

    public string CertsFolder => Path.Combine(Root, "certs");

    public string BackupFolder => Path.Combine(Root, "backup");

    public string BackupStatusFile => Path.Combine(Root, "backup-status.json");

    public string LiveKitYaml => File.ReadAllText(Path.Combine(LiveKitFolder, "livekit.yaml"));

    public override async ValueTask InitializeAsync()
    {
        await base.InitializeAsync();
        supervisor = Task.Run(() => SuperviseAsync(stopSupervisor.Token));
    }

    public override async ValueTask DisposeAsync()
    {
        await stopSupervisor.CancelAsync();
        await supervisor;
        await base.DisposeAsync();
        if (Directory.Exists(Root))
        {
            Directory.Delete(Root, recursive: true);
        }

        GC.SuppressFinalize(this);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        Directory.CreateDirectory(LiveKitFolder);
        Directory.CreateDirectory(CertsFolder);
        Directory.CreateDirectory(BackupFolder);
        base.ConfigureWebHost(builder);
        if (database is not null)
        {
            builder.UseSetting("ConnectionStrings:StudioFlow", database);
        }

        // The overrides of the other tests would hide that links and embedding follow the settings.
        builder.UseSetting("StudioFlow:PublicBaseUrl", string.Empty);
        builder.UseSetting("StudioFlow:FrameAncestors", string.Empty);
        builder.UseSetting("Install:HttpsPort", "8443");
        builder.UseSetting("Install:CaddyAdminUrl", "http://caddy.invalid:2019");
        builder.UseSetting("Install:CaddyCertsPath", CertsFolder);
        builder.UseSetting("Install:LiveKitConfigPath", LiveKitFolder);
        builder.UseSetting("Install:BackupConfigPath", BackupFolder);
        builder.UseSetting("Backup:StatusFile", BackupStatusFile);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICaddyGateway>();
            services.AddSingleton<ICaddyGateway>(Caddy);
        });
    }

    /// <summary>What the LiveKit supervisor does: start the server with the file and report the hash of it.</summary>
    private async Task SuperviseAsync(CancellationToken cancellationToken)
    {
        var config = Path.Combine(LiveKitFolder, "livekit.yaml");
        var applied = Path.Combine(LiveKitFolder, "applied.json");
        var last = string.Empty;
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(20));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                try
                {
                    if (!File.Exists(config))
                    {
                        continue;
                    }

                    var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(await File.ReadAllTextAsync(config, cancellationToken))));
                    if (!string.Equals(hash, last, StringComparison.Ordinal))
                    {
                        await File.WriteAllTextAsync(applied, $$"""{"configSha256":"{{hash}}"}""", cancellationToken);
                        last = hash;
                    }
                }
                catch (IOException)
                {
                    // The file is being replaced; the next tick sees the new one.
                }
            }
        }
        catch (OperationCanceledException)
        {
            // The app is disposed.
        }
    }
}
