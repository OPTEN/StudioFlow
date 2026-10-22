namespace Opten.FlowStudio.Infrastructure.Persistence;

/// <summary>
/// Row of <c>source_activity</c>: when a device source was last live (GAP-08). Persistence detail only; the core sees
/// <see cref="Core.Application.Ports.SourceLastLive"/>.
/// </summary>
internal sealed class SourceActivity
{
    /// <summary>Source reference <c>{deviceId}/{slot}</c>.</summary>
    public string SourceId { get; set; } = string.Empty;

    /// <summary>Production of the device.</summary>
    public string ProductionId { get; set; } = string.Empty;

    /// <summary>The device (deleting it deletes the row).</summary>
    public string DeviceId { get; set; } = string.Empty;

    /// <summary>Last time the source was live.</summary>
    public DateTimeOffset LastLiveAt { get; set; }
}
