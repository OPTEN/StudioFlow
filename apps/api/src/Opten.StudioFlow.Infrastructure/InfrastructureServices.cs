using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Infrastructure.LiveKit;
using Opten.StudioFlow.Infrastructure.Media;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Infrastructure.Security;

namespace Opten.StudioFlow.Infrastructure;

/// <summary>Registers the adapters of the infrastructure layer.</summary>
public static class InfrastructureServices
{
    /// <summary>Name of the connection string.</summary>
    public const string ConnectionStringName = "StudioFlow";

    /// <summary>Minimum length of the LiveKit API secret (HS256 needs 256 bits).</summary>
    public const int MinSecretLength = 32;

    /// <summary>
    /// Database access only (also used by the <c>broadcast-status</c> command): pooled contexts with the timeouts of
    /// <see cref="DatabaseOptions"/>, a retry strategy for transient errors and the <see cref="DatabaseCircuit"/> that
    /// makes requests fail fast while PostgreSQL is unreachable (GAP-32).
    /// </summary>
    public static IServiceCollection AddStudioFlowPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<DatabaseOptions>().Bind(configuration.GetSection(DatabaseOptions.Section));
        services.AddSingleton<IValidateOptions<DatabaseOptions>, DatabaseOptionsValidator>();
        services.AddSingleton(sp =>
        {
            var options = sp.GetRequiredService<IOptions<DatabaseOptions>>().Value;
            var probeConnection = options.Apply(ConnectionString(configuration), pooled: false);
            return new DatabaseCircuit(
                async cancellationToken =>
                {
                    await using var connection = new NpgsqlConnection(probeConnection);
                    await connection.OpenAsync(cancellationToken);
                },
                options.ProbeInterval,
                sp.GetService<TimeProvider>() ?? TimeProvider.System,
                (sp.GetService<ILoggerFactory>() ?? NullLoggerFactory.Instance).CreateLogger<DatabaseCircuit>());
        });

        // Read lazily: build-time OpenAPI generation and design-time tools run the composition without a database.
        services.AddPooledDbContextFactory<StudioFlowDbContext>((sp, options) =>
        {
            var database = sp.GetRequiredService<IOptions<DatabaseOptions>>().Value;
            var circuit = sp.GetRequiredService<DatabaseCircuit>();
            options.UseNpgsql(
                    database.Apply(ConnectionString(configuration)),
                    npgsql => npgsql.ExecutionStrategy(dependencies => new CircuitAwareRetryStrategy(dependencies, circuit)))
                .AddInterceptors(new DatabaseCircuitInterceptor(circuit));
        });
        services.AddSingleton<IUnitOfWorkFactory, UnitOfWorkFactory>();
        return services;
    }

    /// <summary>
    /// Persistence, LiveKit, media storage and admin credentials. The settings are validated when they are first read;
    /// the web host reads them during startup (not with <c>ValidateOnStart</c>, which would also run during the
    /// build-time OpenAPI generation that has no configuration).
    /// </summary>
    public static IServiceCollection AddStudioFlowInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddStudioFlowPersistence(configuration);

        services.AddOptions<LiveKitOptions>().Bind(configuration.GetSection(LiveKitOptions.Section))
            .Validate(o => !string.IsNullOrWhiteSpace(o.ApiKey), "LiveKit:ApiKey is required.")
            .Validate(o => o.ApiSecret.Length >= MinSecretLength, $"LiveKit:ApiSecret must have at least {MinSecretLength} characters.")
            .Validate(o => Uri.TryCreate(o.InternalUrl, UriKind.Absolute, out _), "LiveKit:InternalUrl must be an absolute URL.")
            .Validate(o => o.TokenTtl >= TimeSpan.FromMinutes(1) && o.TokenTtl <= TimeSpan.FromHours(24), "LiveKit:TokenTtl must be between 00:01:00 and 1.00:00:00.")
            .Validate(o => o.RequestTimeout >= TimeSpan.FromMilliseconds(100) && o.RequestTimeout <= TimeSpan.FromMinutes(1), "LiveKit:RequestTimeout must be between 00:00:00.1 and 00:01:00.");
        services.AddSingleton<LiveKitTokenIssuer>();
        services.AddSingleton<ILiveKitTokenIssuer>(sp => sp.GetRequiredService<LiveKitTokenIssuer>());
        services.AddSingleton<LiveKitWebhookReceiver>();
        services.AddHttpClient<ILiveKitRoomClient, LiveKitRoomClient>((sp, http) =>
        {
            var options = sp.GetRequiredService<IOptions<LiveKitOptions>>().Value;
            http.BaseAddress = new Uri(options.InternalUrl.TrimEnd('/') + "/");
            http.Timeout = options.RequestTimeout;
        });

        services.AddOptions<MediaOptions>().Bind(configuration.GetSection(MediaOptions.Section))
            .Validate(o => !string.IsNullOrWhiteSpace(o.Path), "Media:Path is required.")
            .Validate(o => o.MaxImageBytes > 0 && o.MaxVideoBytes > 0, "Media size limits must be positive.");
        services.AddSingleton<IMediaStore, FileMediaStore>();

        services.AddOptions<AdminOptions>().Bind(configuration.GetSection(AdminOptions.Section))
            .Validate(o => !string.IsNullOrWhiteSpace(o.Username), "Admin:Username is required.")
            .Validate(o => !string.IsNullOrEmpty(o.PasswordHash) || !string.IsNullOrEmpty(o.Password), "Admin:PasswordHash (or, for local setups, Admin:Password) is required.")
            .Validate(o => o.SessionLifetime >= TimeSpan.FromSeconds(1) && o.SessionLifetime <= TimeSpan.FromDays(30), "Admin:SessionLifetime must be between 00:00:01 and 30.00:00:00.");
        services.AddSingleton<IAdminCredentials, AdminCredentials>();
        return services;
    }

    private static string ConnectionString(IConfiguration configuration) =>
        configuration.GetConnectionString(ConnectionStringName) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"ConnectionStrings:{ConnectionStringName} is not configured.");

    /// <summary>Reports every out-of-range database timeout with its key.</summary>
    private sealed class DatabaseOptionsValidator : IValidateOptions<DatabaseOptions>
    {
        public ValidateOptionsResult Validate(string? name, DatabaseOptions options)
        {
            var errors = options.Validate().ToList();
            return errors.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(errors);
        }
    }
}
