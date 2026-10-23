using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Infrastructure;
using Opten.StudioFlow.Infrastructure.Security;

namespace Opten.StudioFlow.Web.Hosting;

/// <summary>
/// Command line modes used by the ops scripts, dispatched on <c>args[0]</c> before the web host is built:
/// <c>hash-password</c> (setup.sh) and <c>broadcast-status</c> (update.sh refuses to update during a broadcast).
/// </summary>
internal static class CliCommands
{
    /// <summary>Reads a password from stdin and prints its Identity v3 hash.</summary>
    public const string HashPassword = "hash-password";

    /// <summary>Prints <c>live</c> (exit 3) or <c>idle</c> (exit 0); exit 1 on errors.</summary>
    public const string BroadcastStatus = "broadcast-status";

    /// <summary>Exit code when a production is live.</summary>
    public const int LiveExitCode = 3;

    /// <summary>Runs a command when <paramref name="args"/> names one; null otherwise.</summary>
    public static async Task<int?> TryRunAsync(string[] args)
    {
        return args switch
        {
            [HashPassword, ..] => await HashPasswordAsync(Console.In, Console.Out, Console.Error),
            [BroadcastStatus, .. var rest] => await BroadcastStatusAsync(rest, Console.Out, Console.Error),
            _ => null,
        };
    }

    /// <summary>The password is the first line of stdin (a trailing newline is not part of it).</summary>
    internal static async Task<int> HashPasswordAsync(TextReader input, TextWriter output, TextWriter error)
    {
        var password = (await input.ReadLineAsync())?.TrimEnd('\r');
        if (string.IsNullOrEmpty(password))
        {
            await error.WriteLineAsync("No password on stdin.");
            return 1;
        }

        await output.WriteLineAsync(AdminCredentials.HashPassword(password));
        return 0;
    }

    /// <summary>Reads the normal configuration (appsettings, environment, <paramref name="args"/>) and checks for live productions.</summary>
    internal static async Task<int> BroadcastStatusAsync(string[] args, TextWriter output, TextWriter error)
    {
        try
        {
            var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { Args = args, ContentRootPath = AppContext.BaseDirectory });
            builder.Logging.ClearProviders();
            builder.Services.AddStudioFlowPersistence(builder.Configuration);
            using var host = builder.Build();
            await using var unit = host.Services.GetRequiredService<IUnitOfWorkFactory>().Create();
            var live = await unit.Productions.AnyLiveAsync(CancellationToken.None);
            await output.WriteLineAsync(live ? "live" : "idle");
            return live ? LiveExitCode : 0;
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Only the type: connection errors can contain the connection string.
            await error.WriteLineAsync($"broadcast-status failed: {exception.GetType().Name}");
            return 1;
        }
    }
}
