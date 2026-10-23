using System.Collections.Concurrent;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Application.Runtime;

/// <summary>
/// In-memory state of one production: the mutation lock, the revision counter, the event ring, what is on air, device
/// sessions, source health, LiveKit tracks, output consumers and Regie sessions. Everything except the lock is mutated
/// only while the lock is held.
/// </summary>
public sealed class ProductionRuntime(string productionId, long initialRevision, OutputMonitorOptions? outputOptions = null) : IDisposable
{
    private readonly Dictionary<string, DeviceRuntime> devices = new(StringComparer.Ordinal);

    /// <summary>Production id (= LiveKit room name).</summary>
    public string ProductionId { get; } = productionId;

    /// <summary>Serializes the mutations of this production.</summary>
    internal SemaphoreSlim Gate { get; } = new(1, 1);

    /// <summary>Current revision.</summary>
    public long Revision { get; private set; } = initialRevision;

    /// <summary>The last events.</summary>
    public EventRing Events { get; } = new(EventRing.DefaultCapacity);

    /// <summary>What is on air (for tallies); null until the production was loaded once.</summary>
    public OnAirState? OnAir { get; set; }

    /// <summary>Health of the device sources by source id.</summary>
    public Dictionary<string, SourceHealth> Sources { get; } = new(StringComparer.Ordinal);

    /// <summary>Published LiveKit tracks of the production's room.</summary>
    public LiveKitRoomState Room { get; } = new();

    /// <summary>Output consumers.</summary>
    public OutputTracker Output { get; } = new(outputOptions ?? new OutputMonitorOptions());

    /// <summary>Connected Regie sessions subscribed to this production.</summary>
    public HashSet<string> StudioConnections { get; } = new(StringComparer.Ordinal);

    /// <summary>Device sessions that exist so far.</summary>
    public IEnumerable<DeviceRuntime> Devices => devices.Values;

    /// <summary>The live data of a device (created on first use).</summary>
    public DeviceRuntime Device(string deviceId)
    {
        if (!devices.TryGetValue(deviceId, out var device))
        {
            device = new DeviceRuntime(deviceId);
            devices[deviceId] = device;
        }

        return device;
    }

    /// <summary>The live data of a device, if any.</summary>
    public DeviceRuntime? FindDevice(string deviceId) => devices.GetValueOrDefault(deviceId);

    /// <summary>Forgets a deleted device.</summary>
    public void ForgetDevice(string deviceId) => devices.Remove(deviceId);

    /// <summary>Advances the revision for the next event.</summary>
    internal long NextRevision() => ++Revision;

    /// <inheritdoc />
    public void Dispose() => Gate.Dispose();
}

/// <summary>
/// The runtimes of all productions. Revisions start at <c>unixTimeMs * 1000</c> of the process start, so they are
/// monotonic across restarts (spec 5).
/// </summary>
public sealed class ProductionRuntimeRegistry(TimeProvider clock, OutputMonitorOptions? outputOptions = null) : IDisposable
{
    private readonly ConcurrentDictionary<string, ProductionRuntime> runtimes = new(StringComparer.Ordinal);

    /// <summary>First revision of every production in this process.</summary>
    public long RevisionBase { get; } = clock.GetUtcNow().ToUnixTimeMilliseconds() * 1000;

    /// <summary>When this process started (the API restart watch of GAP-08 counts from here).</summary>
    public DateTimeOffset StartedAt { get; } = clock.GetUtcNow();

    /// <summary>Every production runtime created so far.</summary>
    public IReadOnlyCollection<ProductionRuntime> All => [.. runtimes.Values];

    /// <summary>The runtime of a production that is known to exist.</summary>
    public ProductionRuntime GetOrAdd(string productionId) => runtimes.GetOrAdd(productionId, id => new ProductionRuntime(id, RevisionBase, outputOptions));

    /// <summary>The runtime of a production, if it was created already.</summary>
    public ProductionRuntime? Find(string productionId) => runtimes.GetValueOrDefault(productionId);

    /// <inheritdoc />
    public void Dispose()
    {
        foreach (var runtime in runtimes.Values)
        {
            runtime.Dispose();
        }
    }
}
