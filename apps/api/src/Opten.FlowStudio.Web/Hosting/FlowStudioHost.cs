using System.Globalization;
using System.Reflection;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Opten.FlowStudio.Core.Application;
using Opten.FlowStudio.Core.Application.Ports;
using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Infrastructure;
using Opten.FlowStudio.Infrastructure.Persistence;
using Opten.FlowStudio.Infrastructure.Security;
using Opten.FlowStudio.Web.Endpoints;
using Opten.FlowStudio.Web.Errors;
using Opten.FlowStudio.Web.Hubs;
using Opten.FlowStudio.Web.OpenApi;
using Opten.FlowStudio.Web.Security;

namespace Opten.FlowStudio.Web.Hosting;

/// <summary>Composition root of the web host: services and the request pipeline.</summary>
internal static class FlowStudioHost
{
    /// <summary>Environment name of the integration tests (cookies without <c>Secure</c> like Development).</summary>
    public const string TestingEnvironment = "Testing";

    /// <summary>Configuration section of the trusted proxy networks.</summary>
    private const string ForwardedHeadersSection = "ForwardedHeaders:KnownNetworks";

    /// <summary>True while <c>dotnet build</c> generates the OpenAPI document (the app is started without a database).</summary>
    public static bool IsDocumentGeneration => Assembly.GetEntryAssembly()?.GetName().Name == "GetDocument.Insider";

    /// <summary>Registers every service.</summary>
    public static WebApplicationBuilder AddFlowStudio(this WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        var services = builder.Services;
        var configuration = builder.Configuration;
        var environment = builder.Environment;

        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            kestrel.AddServerHeader = false;
            kestrel.Limits.MaxRequestBodySize = RequestBodyLimit.DefaultBytes;
        });

        services.ConfigureHttpJsonOptions(options => ContractJson.Configure(options.SerializerOptions));
        services.AddOpenApi(options =>
        {
            options.AddDocumentTransformer<ContractSchemasTransformer>();
            options.AddSchemaTransformer<DiscriminatorRequiredTransformer>();
        });

        services.AddOptions<FlowStudioOptions>().Bind(configuration.GetSection(FlowStudioOptions.Section))
            .Validate(o => Uri.TryCreate(o.PublicBaseUrl, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp), "FlowStudio:PublicBaseUrl must be an absolute http(s) URL.");
        services.AddSingleton(sp => sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<FlowStudioOptions>>().Value);
        services.AddSingleton(TimeProvider.System);
        services.AddFlowStudioInfrastructure(configuration);
        AddApplication(services);
        AddSecurity(services, configuration, environment);
        AddRealtime(services, environment);

        services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
        {
            // Problems created by the framework (status code pages, authentication) get the code and a German title.
            var status = context.ProblemDetails.Status ?? context.HttpContext.Response.StatusCode;
            if (context.ProblemDetails.Extensions.TryAdd(Problems.CodeExtension, Problems.CodeFor(status)))
            {
                context.ProblemDetails.Title = Problems.TitleFor(status);
            }
        });
        services.AddExceptionHandler<FlowStudioExceptionHandler>();
        services.AddHealthChecks().AddDatabaseCheck();

        if (!IsDocumentGeneration)
        {
            services.AddHostedService<StartupInitializer>();
            services.AddHostedService<MaintenanceWorker>();
        }

        return builder;
    }

    /// <summary>Builds the request pipeline and maps endpoints and hubs.</summary>
    public static WebApplication UseFlowStudio(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // The proxy's client address must be known before rate limiting, IP rules and logging.
        app.UseForwardedHeaders();
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        app.UseRouting();
        app.UseMiddleware<HubOriginMiddleware>();
        app.UseMiddleware<RequestBodyLimitMiddleware>();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false }).DisableRateLimiting();
        app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains(DatabaseMaintenance.ReadyTag) }).DisableRateLimiting();
        app.MapFlowStudioApi();
        app.MapHub<StudioHub>(HubMethods.StudioHubPath);
        app.MapHub<DeviceHub>(HubMethods.DeviceHubPath);
        app.MapHub<OutputHub>(HubMethods.OutputHubPath);
        return app;
    }

    private static void AddApplication(IServiceCollection services)
    {
        services.AddSingleton<ProductionRuntimeRegistry>();
        services.AddSingleton<PairingRequestStore>();
        services.AddSingleton<ProductionCoordinator>();
        services.AddSingleton<SnapshotBuilder>();
        services.AddSingleton<LiveKitKicker>();
        services.AddSingleton<LoginThrottle>();
        services.AddSingleton<ProductionService>();
        services.AddSingleton<SceneService>();
        services.AddSingleton<DeviceAdminService>();
        services.AddSingleton<DeviceSessionService>();
        services.AddSingleton<PairingService>();
        services.AddSingleton<AssetService>();
        services.AddSingleton<OutputService>();
        services.AddSingleton<LiveKitSyncService>();
        services.AddSingleton<StudioSessionService>();
        services.AddSingleton<AdminLoginService>();
    }

    private static void AddSecurity(IServiceCollection services, ConfigurationManager configuration, IWebHostEnvironment environment)
    {
        var dataProtection = services.AddDataProtection().SetApplicationName("FlowStudio");
        if (configuration["DataProtection:KeysPath"] is { Length: > 0 } keysPath)
        {
            dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));
        }

        services.AddAuthentication(AuthSchemes.Admin)
            .AddCookie(AuthSchemes.Admin, cookie =>
            {
                cookie.Cookie.Name = SecurityNames.SessionCookie;
                cookie.Cookie.HttpOnly = true;
                cookie.Cookie.SameSite = SameSiteMode.Strict;

                // Caddy always terminates TLS; only local development and the tests run over plain HTTP.
                cookie.Cookie.SecurePolicy = environment.IsDevelopment() || environment.IsEnvironment(TestingEnvironment) ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
                cookie.ExpireTimeSpan = TimeSpan.FromHours(12);
                cookie.SlidingExpiration = true;
                cookie.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                cookie.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
                cookie.Events.OnValidatePrincipal = context =>
                {
                    // A session of a renamed admin user ends.
                    var admin = context.HttpContext.RequestServices.GetRequiredService<IAdminCredentials>();
                    if (!string.Equals(context.Principal?.Identity?.Name, admin.Username, StringComparison.Ordinal))
                    {
                        context.RejectPrincipal();
                    }

                    return Task.CompletedTask;
                };
            })
            .AddScheme<AuthenticationSchemeOptions, DeviceAuthenticationHandler>(AuthSchemes.Device, null)
            .AddScheme<AuthenticationSchemeOptions, OutputAuthenticationHandler>(AuthSchemes.Output, null);

        services.AddSingleton<IAuthorizationHandler, DeviceNotBlockedRequirement>();
        services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationMiddlewareResultHandler, ProblemAuthorizationResultHandler>();
        services.AddAuthorizationBuilder()
            .AddPolicy(Policies.Admin, policy => policy.AddAuthenticationSchemes(AuthSchemes.Admin).RequireAuthenticatedUser())
            .AddPolicy(Policies.Device, policy => policy.AddAuthenticationSchemes(AuthSchemes.Device).RequireAuthenticatedUser().AddRequirements(new DeviceNotBlockedRequirement()))
            .AddPolicy(Policies.Output, policy => policy.AddAuthenticationSchemes(AuthSchemes.Output).RequireAuthenticatedUser());

        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = 1;
            var networks = configuration.GetSection(ForwardedHeadersSection).Get<string[]>() ?? [];
            if (networks.Length > 0)
            {
                options.KnownIPNetworks.Clear();
                options.KnownProxies.Clear();
                foreach (var network in networks)
                {
                    options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
                }
            }
        });

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, cancellationToken) =>
            {
                var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait) ? wait : TimeSpan.FromMinutes(1);
                context.HttpContext.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                await Problems.WriteAsync(context.HttpContext, StatusCodes.Status429TooManyRequests, ErrorCodes.RateLimited, "Zu viele Versuche. Bitte später erneut versuchen.");
            };
            options.AddPolicy(ApiSurface.PairingRequestsLimit, context => PerClient(context, 10));
            options.AddPolicy(ApiSurface.RedeemLimit, context => PerClient(context, 20));
        });
    }

    private static void AddRealtime(IServiceCollection services, IWebHostEnvironment environment)
    {
        services.AddSingleton<HubConnectionRegistry>();
        services.AddSingleton<IRealtimePublisher, SignalRRealtimePublisher>();
        services.AddSignalR(hub =>
        {
            hub.KeepAliveInterval = TimeSpan.FromSeconds(2);
            hub.ClientTimeoutInterval = TimeSpan.FromSeconds(6);
            hub.MaximumReceiveMessageSize = 64 * 1024;
            hub.EnableDetailedErrors = environment.IsDevelopment();
            hub.AddFilter<HubErrorFilter>();
        }).AddJsonProtocol(json => ContractJson.Configure(json.PayloadSerializerOptions));
    }

    /// <summary>Sliding window of 10 minutes per client address.</summary>
    private static RateLimitPartition<string> PerClient(HttpContext context, int permits) =>
        RateLimitPartition.GetSlidingWindowLimiter(ClientAddress.Of(context), _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = TimeSpan.FromMinutes(10),
            SegmentsPerWindow = 10,
            QueueLimit = 0,
        });
}
