using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Opten.StudioFlow.Infrastructure.Install;

/// <summary>
/// Reads the secrets the init service generated once into the <c>secrets</c> volume (issue #27) and completes the
/// configuration with them: the database password becomes part of <c>ConnectionStrings:StudioFlow</c>, the key pair of
/// LiveKit becomes <c>LiveKit:ApiKey</c> and <c>LiveKit:ApiSecret</c>. A value that is configured explicitly (environment,
/// appsettings: development, tests, an operator who knows better) is never replaced. The values go into the configuration
/// only; nothing here logs them, and no endpoint returns the configuration.
/// </summary>
public static class SecretFiles
{
    /// <summary>File with the password of the PostgreSQL user.</summary>
    public const string PostgresPassword = "postgres-password";

    /// <summary>File with the LiveKit API key.</summary>
    public const string LiveKitApiKey = "livekit-api-key";

    /// <summary>File with the LiveKit API secret.</summary>
    public const string LiveKitApiSecret = "livekit-api-secret";

    /// <summary>Completes <paramref name="configuration"/> from the secrets folder <c>Install:SecretsPath</c>, if one is configured.</summary>
    public static void Apply(ConfigurationManager configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        if (configuration["Install:SecretsPath"] is not { Length: > 0 } folder)
        {
            return;
        }

        if (string.IsNullOrEmpty(configuration["LiveKit:ApiKey"]))
        {
            configuration["LiveKit:ApiKey"] = Read(folder, LiveKitApiKey);
        }

        if (string.IsNullOrEmpty(configuration["LiveKit:ApiSecret"]))
        {
            configuration["LiveKit:ApiSecret"] = Read(folder, LiveKitApiSecret);
        }

        var connection = configuration.GetConnectionString(InfrastructureServices.ConnectionStringName);
        if (!string.IsNullOrEmpty(connection) && !HasPassword(connection))
        {
            var builder = new NpgsqlConnectionStringBuilder(connection) { Password = Read(folder, PostgresPassword) };
            configuration[$"ConnectionStrings:{InfrastructureServices.ConnectionStringName}"] = builder.ConnectionString;
        }
    }

    private static bool HasPassword(string connectionString) => !string.IsNullOrEmpty(new NpgsqlConnectionStringBuilder(connectionString).Password);

    private static string Read(string folder, string name)
    {
        var path = Path.Combine(folder, name);
        try
        {
            var value = File.ReadAllText(path).Trim();
            return value.Length > 0 ? value : throw new InvalidOperationException($"{path} is empty. The init service generates the secrets once; check: docker compose logs init");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // The message names the file, never its content.
            throw new InvalidOperationException($"{path} cannot be read ({exception.GetType().Name}). The init service generates the secrets once; check: docker compose logs init", exception);
        }
    }
}
