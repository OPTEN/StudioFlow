using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Infrastructure.LiveKit;
using Opten.FlowStudio.Infrastructure.Media;
using Opten.FlowStudio.Infrastructure.Persistence;
using Opten.FlowStudio.Infrastructure.Security;

namespace Opten.FlowStudio.Infrastructure;

/// <summary>Registers the adapters of the infrastructure layer.</summary>
public static class InfrastructureServices
{
    /// <summary>Name of the connection string.</summary>
    public const string ConnectionStringName = "FlowStudio";

    /// <summary>Minimum length of the LiveKit API secret (HS256 needs 256 bits).</summary>
    public const int MinSecretLength = 32;

    /// <summary>Database access only (also used by the <c>broadcast-status</c> command).</summary>
    public static IServiceCollection AddFlowStudioPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        // Read lazily: build-time OpenAPI generation and design-time tools run the composition without a database.
        services.AddPooledDbContextFactory<FlowStudioDbContext>(options => options.UseNpgsql(
            configuration.GetConnectionString(ConnectionStringName) ?? throw new InvalidOperationException($"ConnectionStrings:{ConnectionStringName} is not configured."),
            npgsql => npgsql.EnableRetryOnFailure(3, TimeSpan.FromSeconds(2), null)));
        services.AddSingleton<IUnitOfWorkFactory, UnitOfWorkFactory>();
        return services;
    }

    /// <summary>
    /// Persistence, LiveKit, media storage and admin credentials. The settings are validated when they are first read;
    /// the web host reads them during startup (not with <c>ValidateOnStart</c>, which would also run during the
    /// build-time OpenAPI generation that has no configuration).
    /// </summary>
    public static IServiceCollection AddFlowStudioInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddFlowStudioPersistence(configuration);

        services.AddOptions<LiveKitOptions>().Bind(configuration.GetSection(LiveKitOptions.Section))
            .Validate(o => !string.IsNullOrWhiteSpace(o.ApiKey), "LiveKit:ApiKey is required.")
            .Validate(o => o.ApiSecret.Length >= MinSecretLength, $"LiveKit:ApiSecret must have at least {MinSecretLength} characters.")
            .Validate(o => Uri.TryCreate(o.InternalUrl, UriKind.Absolute, out _), "LiveKit:InternalUrl must be an absolute URL.");
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
            .Validate(o => !string.IsNullOrEmpty(o.PasswordHash) || !string.IsNullOrEmpty(o.Password), "Admin:PasswordHash (or, for local setups, Admin:Password) is required.");
        services.AddSingleton<IAdminCredentials, AdminCredentials>();
        return services;
    }
}
