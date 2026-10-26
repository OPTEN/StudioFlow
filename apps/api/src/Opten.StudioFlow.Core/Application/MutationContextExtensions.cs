using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application;

/// <summary>Loading helpers for mutations: every lookup is scoped to the production of the mutation.</summary>
public static class MutationContextExtensions
{
    /// <summary>The production with its scenes (tracked).</summary>
    public static async Task<Production> ProductionAsync(this MutationContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        return await context.Data.Productions.GetAsync(context.ProductionId, cancellationToken) ?? throw StudioFlowException.NotFound("Production");
    }

    /// <summary>A device of the production (tracked); other productions' devices are not found.</summary>
    public static async Task<Device> DeviceAsync(this MutationContext context, string deviceId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var device = await context.Data.Devices.GetAsync(deviceId, cancellationToken);
        return device is not null && string.Equals(device.ProductionId, context.ProductionId, StringComparison.Ordinal)
            ? device
            : throw StudioFlowException.NotFound("Device");
    }

    /// <summary>An asset of the production (tracked).</summary>
    public static async Task<Asset> AssetAsync(this MutationContext context, string assetId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        return await context.Data.Assets.GetAsync(context.ProductionId, assetId, cancellationToken) ?? throw StudioFlowException.NotFound("Media item");
    }

    /// <summary>All sources of the production: device slots, media and texts.</summary>
    public static async Task<SourceCatalog> CatalogAsync(this MutationContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var devices = await context.Data.Devices.ListAsync(context.ProductionId, cancellationToken);
        var assets = await context.Data.Assets.ListAsync(context.ProductionId, cancellationToken);
        var production = await context.ProductionAsync(cancellationToken);
        return new SourceCatalog(devices, assets, production.TextSources);
    }

    /// <summary>The production name for device self messages.</summary>
    public static async Task<string> ProductionNameAsync(this MutationContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        return await context.Data.Productions.GetNameAsync(context.ProductionId, cancellationToken) ?? string.Empty;
    }

    /// <summary>Audit details of a device (name and codes).</summary>
    public static Dictionary<string, string> DeviceDetails(Device device)
    {
        ArgumentNullException.ThrowIfNull(device);
        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [AuditDetails.Device] = device.Name,
            [AuditDetails.Codes] = device.CodesText(),
        };
    }
}
