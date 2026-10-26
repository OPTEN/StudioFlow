using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Infrastructure;

namespace Opten.StudioFlow.Web.Hosting;

/// <summary>
/// Command line modes used by the ops scripts and the operator, dispatched on <c>args[0]</c> before the web host is built:
/// <c>reset-admin</c> (forgotten password, issue #4) and <c>broadcast-status</c> (update.sh refuses to update during a broadcast).
/// </summary>
internal static class CliCommands
{
    /// <summary>Deletes the Regie account so the first-run setup opens again; asks first unless <see cref="YesOption"/> is given.</summary>
    public const string ResetAdmin = "reset-admin";

    /// <summary>Skips the confirmation of <see cref="ResetAdmin"/>.</summary>
    public const string YesOption = "--yes";

    /// <summary>Prints <c>live</c> (exit 3) or <c>idle</c> (exit 0); exit 1 on errors.</summary>
    public const string BroadcastStatus = "broadcast-status";

    /// <summary>Exit code when a production is live.</summary>
    public const int LiveExitCode = 3;

    /// <summary>Exit code when the operator did not confirm.</summary>
    public const int NotConfirmedExitCode = 2;

    /// <summary>Runs a command when <paramref name="args"/> names one; null otherwise.</summary>
    public static async Task<int?> TryRunAsync(string[] args)
    {
        return args switch
        {
            [ResetAdmin, .. var rest] => await ResetAdminAsync(rest, Console.In, Console.Out, Console.Error),
            [BroadcastStatus, .. var rest] => await BroadcastStatusAsync(rest, Console.Out, Console.Error),
            _ => null,
        };
    }

    /// <summary>
    /// Deletes the Regie account. Without <c>--yes</c> the operator has to type <c>yes</c>. The running API notices the
    /// missing account within a few seconds, ends the old sessions and logs a new setup code.
    /// </summary>
    internal static async Task<int> ResetAdminAsync(string[] args, TextReader input, TextWriter output, TextWriter error)
    {
        if (!args.Contains(YesOption, StringComparer.Ordinal))
        {
            await output.WriteAsync("This deletes the Regie account and signs everyone out. The first-run setup opens again with a new setup code.\nType yes to continue: ");
            if (!string.Equals((await input.ReadLineAsync())?.Trim(), "yes", StringComparison.OrdinalIgnoreCase))
            {
                await error.WriteLineAsync("Cancelled: the Regie account was not changed.");
                return NotConfirmedExitCode;
            }
        }

        try
        {
            // --yes is no setting: the command line configuration would take the next argument as its value.
            using var host = BuildPersistenceHost([.. args.Where(a => !string.Equals(a, YesOption, StringComparison.Ordinal))]);
            var deleted = await host.Services.GetRequiredService<AdminAccountReset>().ResetAsync(CancellationToken.None);
            await output.WriteLineAsync(deleted
                ? "The Regie account was deleted. The running API opens the first-run setup within a few seconds; read the new setup code with: docker compose logs api"
                : "There is no Regie account; the first-run setup is open already.");
            return 0;
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Only the type: connection errors can contain the connection string.
            await error.WriteLineAsync($"reset-admin failed: {exception.GetType().Name}");
            return 1;
        }
    }

    /// <summary>Reads the normal configuration (appsettings, environment, <paramref name="args"/>) and checks for live productions.</summary>
    internal static async Task<int> BroadcastStatusAsync(string[] args, TextWriter output, TextWriter error)
    {
        try
        {
            using var host = BuildPersistenceHost(args);
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

    /// <summary>A host with the database access only: the configuration of the API, no web server, no log output.</summary>
    private static IHost BuildPersistenceHost(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { Args = args, ContentRootPath = AppContext.BaseDirectory });
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddStudioFlowPersistence(builder.Configuration);
        builder.Services.AddSingleton<AdminAccountReset>();
        return builder.Build();
    }
}
