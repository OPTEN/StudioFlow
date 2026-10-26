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
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Infrastructure;
using Opten.StudioFlow.Infrastructure.Backup;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Infrastructure.Security;
using Opten.StudioFlow.Web.Endpoints;
using Opten.StudioFlow.Web.Errors;
using Opten.StudioFlow.Web.Hubs;
using Opten.StudioFlow.Web.OpenApi;
using Opten.StudioFlow.Web.Security;

namespace Opten.StudioFlow.Web.Hosting;

/// <summary>Composition root of the web host: services and the request pipeline.</summary>
internal static class StudioFlowHost
{
    /// <summary>Environment name of the integration tests (cookies without <c>Secure</c> like Development).</summary>
    public const string TestingEnvironment = "Testing";

    /// <summary>Configuration section of the trusted proxy networks.</summary>
    private const string ForwardedHeadersSection = "ForwardedHeaders:KnownNetworks";

    /// <summary>
    /// How long a graceful shutdown may take (OBS-01). Hub connections are aborted when the host begins to stop, so the
    /// shutdown normally takes well under a second; the bound stays below the 10 s stop grace period of Docker.
    /// </summary>
    public static readonly TimeSpan ShutdownTimeout = TimeSpan.FromSeconds(5);

    /// <summary>The window of the pairing rate limits (part of the key names <c>…PerIpPer10Min</c>).</summary>
    private static readonly TimeSpan PairingLimitWindow = TimeSpan.FromMinutes(10);

    /// <summary>True while <c>dotnet build</c> generates the OpenAPI document (the app is started without a database).</summary>
    public static bool IsDocumentGeneration => Assembly.GetEntryAssembly()?.GetName().Name == "GetDocument.Insider";

    /// <summary>Registers every service.</summary>
    public static WebApplicationBuilder AddStudioFlow(this WebApplicationBuilder builder)
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

        // BUG-08: a body that cannot be bound (unknown enum text, wrong type, broken JSON) throws in every environment,
        // so StudioFlowExceptionHandler can name the field in a 400 validation_failed instead of an empty 400.
        services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
        services.Configure<HostOptions>(options => options.ShutdownTimeout = ShutdownTimeout);
        services.AddSingleton(sp => new HostShutdown(sp.GetRequiredService<IHostApplicationLifetime>().ApplicationStopping));
        services.AddOpenApi(options =>
        {
            options.AddDocumentTransformer<ContractSchemasTransformer>();
            options.AddDocumentTransformer<LineEndingTransformer>();
            options.AddSchemaTransformer<DiscriminatorRequiredTransformer>();
        });

        services.AddOptions<StudioFlowOptions>().Bind(configuration.GetSection(StudioFlowOptions.Section))
            .Validate(o => Uri.TryCreate(o.PublicBaseUrl, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp), "StudioFlow:PublicBaseUrl must be an absolute http(s) URL.");
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<StudioFlowOptions>>().Value);
        services.AddValidatedOptions<PairingOptions>(configuration, PairingOptions.Section);
        services.AddValidatedOptions<LoginLockoutOptions>(configuration, LoginLockoutOptions.Section);
        services.AddValidatedOptions<SourceMonitorOptions>(configuration, SourceMonitorOptions.Section);
        services.AddValidatedOptions<OutputMonitorOptions>(configuration, OutputMonitorOptions.Section);
        services.AddValidatedOptions<RealtimeOptions>(configuration, RealtimeOptions.Section);
        services.AddValidatedOptions<BackupOptions>(configuration, BackupOptions.Section);
        services.AddSingleton(TimeProvider.System);
        services.AddStudioFlowInfrastructure(configuration);
        AddApplication(services);
        AddSecurity(services, configuration, environment);
        AddRealtime(services, environment);

        services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
        {
            // Problems created by the framework (status code pages, authentication) get the code and an English title.
            var status = context.ProblemDetails.Status ?? context.HttpContext.Response.StatusCode;
            if (context.ProblemDetails.Extensions.TryAdd(Problems.CodeExtension, Problems.CodeFor(status)))
            {
                context.ProblemDetails.Title = Problems.TitleFor(status);
            }
        });
        services.AddExceptionHandler<StudioFlowExceptionHandler>();
        services.AddHealthChecks().AddDatabaseCheck().AddBackupCheck();

        if (!IsDocumentGeneration)
        {
            services.AddHostedService<StartupInitializer>();
            services.AddHostedService<MaintenanceWorker>();
        }

        return builder;
    }

    /// <summary>Builds the request pipeline and maps endpoints and hubs.</summary>
    public static WebApplication UseStudioFlow(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // The proxy's client address must be known before rate limiting, IP rules and logging.
        app.UseForwardedHeaders();
        app.UseMiddleware<ResponseHardeningMiddleware>();
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        app.UseRouting();
        app.UseMiddleware<HubOriginMiddleware>();
        app.UseMiddleware<RequestBodyLimitMiddleware>();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();

        // GAP-04c: the OpenAPI document is served only in Development (and built at build time, which needs no route).
        if (app.Environment.IsDevelopment() || IsDocumentGeneration)
        {
            app.MapOpenApi();
        }

        app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false }).DisableRateLimiting();
        app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains(DatabaseMaintenance.ReadyTag), ResponseWriter = HealthResponse.WriteAsync }).DisableRateLimiting();
        app.MapStudioFlowApi();

        // A Regie connection ends with its admin session (GAP-04b).
        app.MapHub<StudioHub>(HubMethods.StudioHubPath, options => options.CloseOnAuthenticationExpiration = true);
        app.MapHub<DeviceHub>(HubMethods.DeviceHubPath);
        app.MapHub<OutputHub>(HubMethods.OutputHubPath);

        // OBS-01: close every hub connection as soon as the host begins to stop. The disconnects caused by this are no
        // outage (BUG-20, HostShutdown); without the abort Kestrel waits for the WebSockets until the shutdown timeout.
        var registry = app.Services.GetRequiredService<HubConnectionRegistry>();
        var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(StudioFlowHost).FullName!);
        app.Lifetime.ApplicationStopping.Register(() =>
        {
            var closed = registry.AbortAll();
            logger.LogInformation("Shutting down: closed {Count} hub connection(s)", closed);
        });
        return app;
    }

    /// <summary>
    /// Binds settings that validate themselves (<see cref="IValidatedOptions"/>) and registers their value as a singleton
    /// for the core services. Invalid values stop the host at startup with messages naming the keys (GAP-01).
    /// </summary>
    private static void AddValidatedOptions<T>(this IServiceCollection services, ConfigurationManager configuration, string section)
        where T : class, IValidatedOptions, new()
    {
        services.AddOptions<T>().Bind(configuration.GetSection(section));
        services.AddSingleton<IValidateOptions<T>, SelfValidatingOptions<T>>();
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<T>>().Value);
    }

    private static void AddApplication(IServiceCollection services)
    {
        services.AddSingleton<ProductionRuntimeRegistry>();
        services.AddSingleton<PairingRequestStore>();
        services.AddSingleton<OrderedRealtimeDispatcher>();
        services.AddSingleton<IRealtimeDispatcher>(sp => sp.GetRequiredService<OrderedRealtimeDispatcher>());
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
        services.AddSingleton<SetupCode>();
        services.AddSingleton<AdminAccountState>();
        services.AddSingleton<AdminAccountService>();
        services.AddSingleton<AdminLoginService>();
        services.AddSingleton<SourceRestartWatch>();
    }

    private static void AddSecurity(IServiceCollection services, ConfigurationManager configuration, IWebHostEnvironment environment)
    {
        var dataProtection = services.AddDataProtection().SetApplicationName("StudioFlow");
        if (configuration["DataProtection:KeysPath"] is { Length: > 0 } keysPath)
        {
            dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));
        }

        services.AddSingleton<AdminSessions>();
        services.AddAuthentication(AuthSchemes.Admin)
            .AddCookie(AuthSchemes.Admin, cookie =>
            {
                cookie.Cookie.Name = SecurityNames.SessionCookie;
                cookie.Cookie.HttpOnly = true;
                cookie.Cookie.SameSite = SameSiteMode.Strict;

                // Caddy always terminates TLS; only local development and the tests run over plain HTTP.
                cookie.Cookie.SecurePolicy = environment.IsDevelopment() || environment.IsEnvironment(TestingEnvironment) ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
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

                // Logged-out sessions (GAP-04b) and sessions of a renamed admin user end.
                cookie.Events.OnValidatePrincipal = AdminSessions.ValidateAsync;
            })
            .AddScheme<AuthenticationSchemeOptions, DeviceAuthenticationHandler>(AuthSchemes.Device, null)
            .AddScheme<AuthenticationSchemeOptions, OutputAuthenticationHandler>(AuthSchemes.Output, null);

        // The cookie lifetime comes from Admin:SessionLifetime (12 h by default).
        services.AddOptions<CookieAuthenticationOptions>(AuthSchemes.Admin)
            .Configure<IOptions<AdminOptions>>((cookie, admin) => cookie.ExpireTimeSpan = admin.Value.SessionLifetime);

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
                await Problems.WriteAsync(context.HttpContext, StatusCodes.Status429TooManyRequests, ErrorCodes.RateLimited, "Too many attempts. Please try again later.");
            };
            options.AddPolicy(ApiSurface.PairingRequestsLimit, context => PerClient(context, Limits(context).RequestsPerIpPer10Min));
            options.AddPolicy(ApiSurface.RedeemLimit, context => PerClient(context, Limits(context).RedeemPerIpPer10Min));
        });
    }

    private static void AddRealtime(IServiceCollection services, IWebHostEnvironment environment)
    {
        services.AddSingleton<HubConnectionRegistry>();
        services.AddSingleton<IRealtimePublisher, SignalRRealtimePublisher>();
        services.AddSignalR(hub =>
        {
            hub.MaximumReceiveMessageSize = 64 * 1024;
            hub.EnableDetailedErrors = environment.IsDevelopment();
            hub.AddFilter<HubErrorFilter>();
        }).AddJsonProtocol(json => ContractJson.Configure(json.PayloadSerializerOptions));

        // GAP-12: keep-alive 2 s and client timeout 5 s by default (Realtime:KeepAliveInterval, Realtime:ClientTimeout).
        services.AddOptions<HubOptions>().Configure<IOptions<RealtimeOptions>>((hub, realtime) =>
        {
            hub.KeepAliveInterval = realtime.Value.KeepAliveInterval;
            hub.ClientTimeoutInterval = realtime.Value.ClientTimeout;
        });
    }

    private static PairingLimits Limits(HttpContext context) => context.RequestServices.GetRequiredService<PairingOptions>().Limits;

    /// <summary>Sliding window of 10 minutes per client address.</summary>
    private static RateLimitPartition<string> PerClient(HttpContext context, int permits) =>
        RateLimitPartition.GetSlidingWindowLimiter(ClientAddress.Of(context), _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = PairingLimitWindow,
            SegmentsPerWindow = 10,
            QueueLimit = 0,
        });

    /// <summary>Runs <see cref="IValidatedOptions.Validate"/> when the options are first read.</summary>
    private sealed class SelfValidatingOptions<T> : IValidateOptions<T>
        where T : class, IValidatedOptions
    {
        public ValidateOptionsResult Validate(string? name, T options)
        {
            var errors = options.Validate().ToList();
            return errors.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(errors);
        }
    }
}
