using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Opten.FlowStudio.Core.Application.Services;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;
using Opten.FlowStudio.Web.Security;

namespace Opten.FlowStudio.Web.Hubs;

/// <summary>Regie hub (<c>/hubs/studio</c>, admin cookie).</summary>
[Authorize(Policy = Policies.Admin)]
public sealed class StudioHub(StudioSessionService sessions) : Hub<IStudioClient>
{
    /// <summary>Subscribes to a production: missed events or a snapshot, then <c>event</c>, <c>telemetry</c>, <c>presence</c>.</summary>
    [HubMethodName(HubMethods.Subscribe)]
    public Task<ProductionChangesDto> SubscribeAsync(string productionId, long? sinceRevision) =>
        sessions.SubscribeAsync(Context.ConnectionId, productionId, sinceRevision, Context.ConnectionAborted);

    /// <inheritdoc />
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await sessions.DisconnectedAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}

/// <summary>Output hub (<c>/hubs/output</c>, output key).</summary>
[Authorize(Policy = Policies.Output)]
public sealed class OutputHub(OutputService outputs, HubConnectionRegistry registry) : Hub<IOutputClient>
{
    /// <inheritdoc />
    public override async Task OnConnectedAsync()
    {
        registry.Register(Context);
        var address = Context.GetHttpContext() is { } http ? ClientAddress.Of(http) : "unknown";
        await outputs.ConnectedAsync(ProductionId, Context.ConnectionId, address, Context.ConnectionAborted);
        await base.OnConnectedAsync();
    }

    /// <summary>Subscribes the output page: missed events (private ones as <c>revisionOnly</c>) or a snapshot.</summary>
    [HubMethodName(HubMethods.SubscribeOutput)]
    public Task<OutputChangesDto> SubscribeOutputAsync(long? sinceRevision) =>
        outputs.SubscribeAsync(ProductionId, Context.ConnectionId, sinceRevision, Context.ConnectionAborted);

    /// <summary>Status report of the page (about every two seconds).</summary>
    [HubMethodName(HubMethods.Report)]
    public Task ReportAsync(OutputReport report) => outputs.ReportAsync(ProductionId, report, Context.ConnectionAborted);

    /// <inheritdoc />
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        registry.Unregister(Context.ConnectionId);
        await outputs.DisconnectedAsync(ProductionId, Context.ConnectionId, CancellationToken.None);
        await base.OnDisconnectedAsync(exception);
    }

    private string ProductionId => Context.User?.FindFirstValue(FlowStudioClaims.ProductionId) ?? throw new HubException(ErrorCodes.Forbidden);
}

/// <summary>Sender hub (<c>/hubs/device</c>, device credential).</summary>
[Authorize(Policy = Policies.Device)]
public sealed class DeviceHub(DeviceSessionService sessions, HubConnectionRegistry registry) : Hub<IDeviceClient>
{
    /// <inheritdoc />
    public override async Task OnConnectedAsync()
    {
        registry.Register(Context);
        await base.OnConnectedAsync();
    }

    /// <summary>First message after connecting; a newer session replaces an older one.</summary>
    [HubMethodName(HubMethods.Hello)]
    public Task<DeviceSessionDto> HelloAsync(DeviceHelloDto hello) =>
        sessions.HelloAsync(Identity, Context.ConnectionId, hello, Context.ConnectionAborted);

    /// <summary>Periodic report (about every two seconds).</summary>
    [HubMethodName(HubMethods.Report)]
    public Task ReportAsync(DeviceReportDto report) => sessions.ReportAsync(Identity, Context.ConnectionId, report, Context.ConnectionAborted);

    /// <inheritdoc />
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        registry.Unregister(Context.ConnectionId);
        await sessions.DisconnectedAsync(Identity, Context.ConnectionId, CancellationToken.None);
        await base.OnDisconnectedAsync(exception);
    }

    private DeviceIdentity Identity => new(
        Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new HubException(ErrorCodes.Unauthorized),
        Context.User?.FindFirstValue(FlowStudioClaims.ProductionId) ?? throw new HubException(ErrorCodes.Unauthorized),
        Blocked: false);
}

/// <summary>Live hub connections by id, so the server can abort them (blocked device, replaced session, new key).</summary>
public sealed class HubConnectionRegistry(TimeProvider clock)
{
    /// <summary>Time a final message gets before its connection is aborted.</summary>
    public static readonly TimeSpan DeliveryGrace = TimeSpan.FromSeconds(1);

    private readonly ConcurrentDictionary<string, HubCallerContext> connections = new(StringComparer.Ordinal);

    /// <summary>Tracks a connection.</summary>
    public void Register(HubCallerContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        connections[context.ConnectionId] = context;
    }

    /// <summary>Forgets a closed connection.</summary>
    public void Unregister(string connectionId) => connections.TryRemove(connectionId, out _);

    /// <summary>Aborts a connection when it is still open.</summary>
    public void Abort(string connectionId)
    {
        if (connections.TryRemove(connectionId, out var context))
        {
            context.Abort();
        }
    }

    /// <summary>Aborts a connection after <paramref name="delay"/> unless it closed by itself before.</summary>
    public void AbortLater(string connectionId, TimeSpan delay) => _ = AbortAfterAsync(connectionId, delay);

    private async Task AbortAfterAsync(string connectionId, TimeSpan delay)
    {
        await Task.Delay(delay, clock);
        Abort(connectionId);
    }
}

/// <summary>Turns use case errors into <see cref="HubException"/> messages <c>{code}: {message}</c> for the clients.</summary>
internal sealed class HubErrorFilter(ILogger<HubErrorFilter> logger) : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext invocationContext, Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            return await next(invocationContext);
        }
        catch (FlowStudioException exception)
        {
            throw new HubException($"{exception.Code}: {exception.Message}");
        }
        catch (Exception exception) when (exception is not HubException and not OperationCanceledException)
        {
            logger.LogError(exception, "Hub method {Method} failed", invocationContext.HubMethodName);
            throw new HubException($"{ErrorCodes.InternalError}: Ein unerwarteter Fehler ist aufgetreten.");
        }
    }
}
