using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Web.Errors;
using Opten.StudioFlow.Web.Security;

namespace Opten.StudioFlow.Web.Hubs;

/// <summary>
/// Regie hub (<c>/hubs/studio</c>, admin cookie). The connection belongs to the admin session that opened it: logout
/// closes it, and so does the expiry of the session (GAP-04).
/// </summary>
[Authorize(Policy = Policies.Admin)]
public sealed class StudioHub(StudioSessionService sessions, HubConnectionRegistry registry) : Hub<IStudioClient>
{
    /// <inheritdoc />
    public override async Task OnConnectedAsync()
    {
        registry.Register(Context, Context.User?.FindFirstValue(StudioFlowClaims.SessionId));
        registry.Join(HubConnectionRegistry.AllStudios, Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    /// <summary>Subscribes to a production: missed events or a snapshot, then <c>event</c>, <c>telemetry</c>, <c>presence</c>.</summary>
    [HubMethodName(HubMethods.Subscribe)]
    public Task<ProductionChangesDto> SubscribeAsync(string productionId, long? sinceRevision) =>
        sessions.SubscribeAsync(Context.ConnectionId, productionId, sinceRevision, Context.ConnectionAborted);

    /// <inheritdoc />
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        registry.Unregister(Context.ConnectionId);
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

    private string ProductionId => Context.User?.FindFirstValue(StudioFlowClaims.ProductionId) ?? throw new HubException(ErrorCodes.Forbidden);
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
        Context.User?.FindFirstValue(StudioFlowClaims.ProductionId) ?? throw new HubException(ErrorCodes.Unauthorized),
        Blocked: false);
}

/// <summary>
/// Turns use case errors into <see cref="HubException"/> messages <c>{code}: {message}</c> for the clients. A database
/// outage is <c>service_unavailable</c>: the connection stays open and the client retries later (GAP-32).
/// </summary>
internal sealed class HubErrorFilter(ILogger<HubErrorFilter> logger) : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext invocationContext, Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            return await next(invocationContext);
        }
        catch (StudioFlowException exception)
        {
            throw new HubException($"{exception.Code}: {exception.Message}");
        }
        catch (Exception exception) when (DatabaseOutage.IsOutage(exception))
        {
            logger.LogWarning("Hub method {Method} failed: the database is not reachable", invocationContext.HubMethodName);
            throw new HubException($"{ErrorCodes.ServiceUnavailable}: {DatabaseOutage.Message}");
        }
        catch (Exception exception) when (exception is not HubException and not OperationCanceledException)
        {
            logger.LogError(exception, "Hub method {Method} failed", invocationContext.HubMethodName);
            throw new HubException($"{ErrorCodes.InternalError}: An unexpected error occurred.");
        }
    }
}
