using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Http.Connections.Client;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Testcontainers.PostgreSql;

[assembly: AssemblyFixture(typeof(Opten.StudioFlow.Web.Tests.Support.PostgresFixture))]

namespace Opten.StudioFlow.Web.Tests.Support;

/// <summary>One PostgreSQL 17 container for the whole test run; every app gets its own database.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("postgres")
        .WithUsername("postgres")
        .WithPassword("sf-test-only")
        .WithCommand("-c", "max_connections=300")
        .Build();

    public async ValueTask InitializeAsync() => await container.StartAsync();

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    /// <summary>Creates an empty database and returns its connection string.</summary>
    public async Task<string> CreateDatabaseAsync()
    {
        var name = "sf_" + Guid.NewGuid().ToString("N");
        await using (var connection = new NpgsqlConnection(container.GetConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE {name}", connection);
            await command.ExecuteNonQueryAsync();
        }

        return new NpgsqlConnectionStringBuilder(container.GetConnectionString()) { Database = name }.ConnectionString;
    }
}

/// <summary>
/// The API on a TestServer with its own database, a fake LiveKit room service and a header that sets the client
/// address (TestServer has none), so rate limits and IP rules can be tested per test.
/// </summary>
public class StudioFlowApp(PostgresFixture postgres) : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string AdminUser = "admin";
    public const string AdminPassword = "Test-Password-1!";
    public const string LiveKitKey = "testkey";
    public const string LiveKitSecret = "sk-test-secret-with-more-than-32-characters";
    public const long MaxImageBytes = 200_000;
    public const long MaxVideoBytes = 400_000;
    public const string PublicBaseUrl = "https://sf.test";

    private static int nextAddress;

    private string connectionString = string.Empty;

    public FakeLiveKitRooms Rooms { get; } = new();

    /// <summary>Warnings and errors the app logged.</summary>
    public LogCapture Logs { get; } = new();

    /// <summary>Name of the app's own database (for <see cref="SqlCommandRecorder"/>).</summary>
    public string DatabaseName => new NpgsqlConnectionStringBuilder(connectionString).Database!;

    public string MediaPath { get; } = Path.Combine(Path.GetTempPath(), "sf-media-" + Guid.NewGuid().ToString("N"));

    public string ConnectionString => connectionString;

    protected virtual string EnvironmentName => "Testing";

    /// <summary>True when the app sets up the Regie account at start, like an operator who finished the first-run setup.</summary>
    protected virtual bool SetUpAccount => true;

    public virtual async ValueTask InitializeAsync()
    {
        connectionString = await postgres.CreateDatabaseAsync();
        _ = Server;
        if (SetUpAccount && Service<AdminAccountState>().SetupRequired)
        {
            await Service<AdminAccountService>().SetUpAsync(new SetupRequest(Service<SetupCode>().Current!, AdminUser, AdminPassword), NextAddress(), CancellationToken.None);
        }
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (Directory.Exists(MediaPath))
        {
            Directory.Delete(MediaPath, recursive: true);
        }

        GC.SuppressFinalize(this);
    }

    /// <summary>A unique client address per call (rate limits and lockouts are per address).</summary>
    public static string NextAddress()
    {
        var n = Interlocked.Increment(ref nextAddress);
        return $"172.16.{(n / 250) % 250}.{(n % 250) + 1}";
    }

    /// <summary>An anonymous client from its own address.</summary>
    public HttpClient Anonymous(string? address = null)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false, AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add(TestClientAddress.Header, address ?? NextAddress());
        return client;
    }

    /// <summary>Signs in and returns a client with the session cookie and the CSRF header.</summary>
    public async Task<AdminSession> AdminAsync()
    {
        var client = Anonymous();
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(AdminUser, AdminPassword), ContractJson.Options);
        response.EnsureSuccessStatusCode();
        var cookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("sf_session=", StringComparison.Ordinal)).Split(';')[0];
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        client.DefaultRequestHeaders.Add("X-StudioFlow", "1");
        var active = await client.GetFromJsonAsync<ProductionSummaryDto>("/api/productions/active", ContractJson.Options);
        return new AdminSession(client, cookie, active!.Id);
    }

    /// <summary>A client authenticated as a device.</summary>
    public HttpClient DeviceClient(DeviceCredentialsDto credentials)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        var client = Anonymous();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", $"{credentials.DeviceId}.{credentials.DeviceSecret}");
        return client;
    }

    /// <summary>A hub connection over the TestServer (long polling unless configured otherwise).</summary>
    public HubConnection Hub(string path, Action<HttpConnectionOptions>? configure = null) => new HubConnectionBuilder()
        .WithUrl(new Uri(Server.BaseAddress, path), options =>
        {
            options.Transports = HttpTransportType.LongPolling;
            options.HttpMessageHandlerFactory = _ => Server.CreateHandler();
            options.Headers[TestClientAddress.Header] = NextAddress();
            configure?.Invoke(options);
        })
        .AddJsonProtocol(json => ContractJson.Configure(json.PayloadSerializerOptions))
        .Build();

    /// <summary>A service of the running app.</summary>
    public T Service<T>()
        where T : notnull => Services.GetRequiredService<T>();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.UseEnvironment(EnvironmentName);
        builder.UseSetting("ConnectionStrings:StudioFlow", connectionString);
        builder.UseSetting("LiveKit:ApiKey", LiveKitKey);
        builder.UseSetting("LiveKit:ApiSecret", LiveKitSecret);
        builder.UseSetting("LiveKit:InternalUrl", "http://livekit.invalid:7880");
        builder.UseSetting("Media:Path", MediaPath);
        builder.UseSetting("Media:MaxImageBytes", MaxImageBytes.ToString(System.Globalization.CultureInfo.InvariantCulture));
        builder.UseSetting("Media:MaxVideoBytes", MaxVideoBytes.ToString(System.Globalization.CultureInfo.InvariantCulture));
        builder.UseSetting("StudioFlow:PublicBaseUrl", PublicBaseUrl);
        builder.UseSetting("StudioFlow:FrameAncestors", "'self' https://stream.example");
        builder.UseSetting("ForwardedHeaders:KnownNetworks:0", "10.99.0.0/16");
        builder.ConfigureLogging(logging => logging.AddProvider(Logs));
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ILiveKitRoomClient>();
            services.AddSingleton<ILiveKitRoomClient>(Rooms);
            services.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, TestClientAddress>();
        });
    }
}

/// <summary>The same app in the Production environment (secure cookies, no detailed errors).</summary>
public sealed class ProductionModeApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    protected override string EnvironmentName => "Production";
}

/// <summary>A signed-in admin.</summary>
/// <param name="Client">Client with cookie and CSRF header.</param>
/// <param name="Cookie">The cookie header value <c>sf_session=…</c>.</param>
/// <param name="ProductionId">The active production.</param>
public sealed record AdminSession(HttpClient Client, string Cookie, string ProductionId);

/// <summary>Sets the client address from a header because TestServer requests have none.</summary>
public sealed class TestClientAddress : Microsoft.AspNetCore.Hosting.IStartupFilter
{
    public const string Header = "X-Test-Remote-Ip";

    public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next) => app =>
    {
        app.Use((context, nextMiddleware) =>
        {
            context.Connection.RemoteIpAddress = IPAddress.TryParse(context.Request.Headers[Header].ToString(), out var address) ? address : IPAddress.Loopback;
            return nextMiddleware(context);
        });
        next(app);
    };
}

/// <summary>LiveKit room service fake: records removals, returns a configurable list, and is unavailable by default so the background reconcile does not interfere.</summary>
public sealed class FakeLiveKitRooms : ILiveKitRoomClient
{
    public ConcurrentQueue<(string Room, string Identity)> Removed { get; } = new();

    public ConcurrentDictionary<string, List<LiveKitParticipant>> Participants { get; } = new(StringComparer.Ordinal);

    public bool Available { get; set; }

    public Task<IReadOnlyList<LiveKitParticipant>> ListParticipantsAsync(string room, CancellationToken cancellationToken) =>
        Available
            ? Task.FromResult<IReadOnlyList<LiveKitParticipant>>(Participants.TryGetValue(room, out var list) ? [.. list] : [])
            : throw new LiveKitUnavailableException("LiveKit is not available in this test.");

    public Task RemoveParticipantAsync(string room, string identity, CancellationToken cancellationToken)
    {
        Removed.Enqueue((room, identity));
        return Task.CompletedTask;
    }
}
