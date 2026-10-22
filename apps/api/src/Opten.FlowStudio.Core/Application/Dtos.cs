using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application;

/// <summary>Maps domain objects and live data to the wire contracts.</summary>
public static class Dtos
{
    /// <summary>Production settings and switching state.</summary>
    public static ProductionDto Production(Production production)
    {
        ArgumentNullException.ThrowIfNull(production);
        return new ProductionDto(
            production.Id,
            production.TenantId,
            production.Name,
            production.Slug,
            production.IsActive,
            production.Broadcast,
            production.LiveSince,
            production.EndedAt,
            production.ProgramSceneId,
            production.PreviewSceneId,
            production.LastTransition,
            production.LastSwitchAt,
            production.StandbySlate,
            production.EndSlate);
    }

    /// <summary>Short production entry.</summary>
    public static ProductionSummaryDto Summary(Production production)
    {
        ArgumentNullException.ThrowIfNull(production);
        return new ProductionSummaryDto(production.Id, production.Name, production.Slug, production.IsActive, production.CreatedAt);
    }

    /// <summary>A scene.</summary>
    public static SceneDto Scene(Scene scene)
    {
        ArgumentNullException.ThrowIfNull(scene);
        return new SceneDto(scene.Id, scene.Name, scene.SortOrder, scene.Version, scene.LayoutMode, scene.Background, scene.Items);
    }

    /// <summary>An asset.</summary>
    public static AssetDto Asset(Asset asset)
    {
        ArgumentNullException.ThrowIfNull(asset);
        return new AssetDto(asset.Id, asset.Code, asset.Kind, asset.Name, asset.ContentType, asset.SizeBytes, asset.Width, asset.Height, asset.CreatedAt, asset.ContentUrl);
    }

    /// <summary>An invite with its absolute URL.</summary>
    public static InviteDto Invite(Invite invite, string publicBaseUrl)
    {
        ArgumentNullException.ThrowIfNull(invite);
        return new InviteDto(invite.Id, invite.Kind, invite.UrlFor(publicBaseUrl), invite.CreatedAt, invite.ExpiresAt);
    }

    /// <summary>A device with its live data.</summary>
    public static DeviceDto Device(Device device, DeviceRuntime? live)
    {
        ArgumentNullException.ThrowIfNull(device);
        var lastSeen = live?.LastSeenAt is { } seen && (device.LastSeenAt is null || seen > device.LastSeenAt) ? seen : device.LastSeenAt;
        return new DeviceDto(
            device.Id,
            device.Name,
            device.Kind,
            device.Platform,
            device.State,
            device.PairedAt,
            lastSeen,
            device.PairingMethod,
            live?.PublishedConnection ?? DeviceConnection.Offline,
            live?.ConnectionSince,
            live?.TechCheck,
            live?.Telemetry);
    }

    /// <summary>What a device learns about itself.</summary>
    public static DeviceSelfDto Self(Device device, string productionName)
    {
        ArgumentNullException.ThrowIfNull(device);
        return new DeviceSelfDto(
            device.Id,
            device.Name,
            device.Kind,
            device.State,
            device.ProductionId,
            productionName,
            [.. device.Slots.Select(s => new DeviceSlotDto(s.Slot, s.Code, s.Kind))]);
    }

    /// <summary>A source with its health (device slots) or always ok (media).</summary>
    public static SourceDto Source(SourceEntry entry, SourceHealth? health)
    {
        ArgumentNullException.ThrowIfNull(entry);
        SourceStatus status;
        DateTimeOffset? since = null;
        if (entry.Asset is not null)
        {
            status = SourceStatus.Ok;
        }
        else if (health is not null)
        {
            status = health.Status;
            since = health.Since;
        }
        else
        {
            status = entry.Device!.IsBlocked ? SourceStatus.Blocked : SourceStatus.Offline;
        }

        return new SourceDto(entry.Id, entry.Code, entry.Kind, entry.Label, entry.Device?.Id, entry.Slot?.Slot, entry.Asset?.Id, status, since);
    }
}
