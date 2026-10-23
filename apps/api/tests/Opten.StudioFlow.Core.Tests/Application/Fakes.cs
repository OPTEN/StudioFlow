using System.Collections.Concurrent;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>In-memory persistence; objects are shared references, so "saving" is a no-op except for the counter.</summary>
internal sealed class InMemoryData : IUnitOfWorkFactory
{
    public List<Production> Productions { get; } = [];

    public List<Device> Devices { get; } = [];

    public List<Asset> Assets { get; } = [];

    public List<Invite> Invites { get; } = [];

    public List<AuditEntry> Audit { get; } = [];

    public Dictionary<string, SourceLastLive> LiveMarks { get; } = new(StringComparer.Ordinal);

    public int Commits { get; private set; }

    public bool FailNextCommit { get; set; }

    /// <summary>While true, device reads throw like an unreachable database.</summary>
    public bool FailDeviceReads { get; set; }

    public IUnitOfWork Create() => new Unit(this);

    private sealed class Unit(InMemoryData data) : IUnitOfWork, IProductionRepository, IDeviceRepository, IAssetRepository, IInviteRepository, IAuditRepository, ISourceActivityRepository
    {
        private readonly List<AuditEntry> pendingAudit = [];
        private readonly List<SourceLastLive> pendingMarks = [];

        public IProductionRepository Productions => this;

        public IDeviceRepository Devices => this;

        public IAssetRepository Assets => this;

        public IInviteRepository Invites => this;

        public IAuditRepository Audit => this;

        public ISourceActivityRepository SourceActivity => this;

        public Task SaveChangesAsync(CancellationToken cancellationToken)
        {
            if (data.FailNextCommit)
            {
                data.FailNextCommit = false;
                throw new InvalidOperationException("Database unavailable.");
            }

            lock (data)
            {
                data.Audit.AddRange(pendingAudit);
                foreach (var mark in pendingMarks)
                {
                    data.LiveMarks[mark.SourceId] = mark;
                }

                data.Commits++;
            }

            pendingAudit.Clear();
            pendingMarks.Clear();
            return Task.CompletedTask;
        }

        Task ISourceActivityRepository.MarkLiveAsync(string productionId, IReadOnlyCollection<SourceLiveMark> marks, DateTimeOffset at, CancellationToken cancellationToken)
        {
            pendingMarks.AddRange(marks.Select(m => new SourceLastLive(m.SourceId, productionId, m.DeviceId, at)));
            return Task.CompletedTask;
        }

        Task<IReadOnlyList<SourceLastLive>> ISourceActivityRepository.ListLiveSinceAsync(DateTimeOffset since, CancellationToken cancellationToken)
        {
            lock (data)
            {
                return Task.FromResult<IReadOnlyList<SourceLastLive>>([.. data.LiveMarks.Values.Where(m => m.LastLiveAt >= since)]);
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        Task<Production?> IProductionRepository.GetAsync(string productionId, CancellationToken cancellationToken) =>
            Task.FromResult(data.Productions.FirstOrDefault(p => p.Id == productionId));

        Task<IReadOnlyList<Production>> IProductionRepository.ListAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Production>>([.. data.Productions]);

        Task<Production?> IProductionRepository.GetActiveAsync(string tenantId, CancellationToken cancellationToken) =>
            Task.FromResult(data.Productions.FirstOrDefault(p => p.IsActive));

        Task<bool> IProductionRepository.ExistsAsync(string productionId, CancellationToken cancellationToken) =>
            Task.FromResult(data.Productions.Any(p => p.Id == productionId));

        Task<string?> IProductionRepository.GetNameAsync(string productionId, CancellationToken cancellationToken) =>
            Task.FromResult(data.Productions.FirstOrDefault(p => p.Id == productionId)?.Name);

        Task<OutputKeyInfo?> IProductionRepository.GetOutputKeyAsync(string productionId, CancellationToken cancellationToken) =>
            Task.FromResult(data.Productions.Where(p => p.Id == productionId).Select(Key).FirstOrDefault());

        Task<OutputKeyInfo?> IProductionRepository.GetOutputKeyBySlugAsync(string slug, CancellationToken cancellationToken) =>
            Task.FromResult(data.Productions.Where(p => p.Slug == slug).Select(Key).FirstOrDefault());

        Task<IReadOnlyList<OutputKeyInfo>> IProductionRepository.ListOutputKeysAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<OutputKeyInfo>>([.. data.Productions.Select(Key)]);

        Task<bool> IProductionRepository.AnyLiveAsync(CancellationToken cancellationToken) =>
            Task.FromResult(data.Productions.Any(p => p.Broadcast == BroadcastState.Live));

        void IProductionRepository.Add(Production production) => data.Productions.Add(production);

        Task<Device?> IDeviceRepository.GetAsync(string deviceId, CancellationToken cancellationToken) =>
            data.FailDeviceReads
                ? Task.FromException<Device?>(new TimeoutException("Database unavailable."))
                : Task.FromResult(data.Devices.FirstOrDefault(d => d.Id == deviceId));

        Task<IReadOnlyList<Device>> IDeviceRepository.ListAsync(string productionId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Device>>([.. data.Devices.Where(d => d.ProductionId == productionId)]);

        void IDeviceRepository.Add(Device device) => data.Devices.Add(device);

        void IDeviceRepository.Remove(Device device) => data.Devices.Remove(device);

        Task<Asset?> IAssetRepository.GetAsync(string productionId, string assetId, CancellationToken cancellationToken) =>
            Task.FromResult(data.Assets.FirstOrDefault(a => a.Id == assetId && a.ProductionId == productionId));

        Task<IReadOnlyList<Asset>> IAssetRepository.ListAsync(string productionId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Asset>>([.. data.Assets.Where(a => a.ProductionId == productionId)]);

        void IAssetRepository.Add(Asset asset) => data.Assets.Add(asset);

        void IAssetRepository.Remove(Asset asset) => data.Assets.Remove(asset);

        Task<Invite?> IInviteRepository.GetAsync(string productionId, string inviteId, CancellationToken cancellationToken) =>
            Task.FromResult(data.Invites.FirstOrDefault(i => i.Id == inviteId && i.ProductionId == productionId));

        Task<Invite?> IInviteRepository.GetByTokenAsync(string token, CancellationToken cancellationToken) =>
            Task.FromResult(data.Invites.FirstOrDefault(i => i.Token == token));

        Task<IReadOnlyList<Invite>> IInviteRepository.ListOpenAsync(string productionId, DateTimeOffset now, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Invite>>([.. data.Invites.Where(i => i.ProductionId == productionId && i.IsOpen(now))]);

        Task<IReadOnlyList<string>> IInviteRepository.ListProductionsWithDueInvitesAsync(DateTimeOffset now, TimeSpan renewBefore, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>>([.. data.Invites.Where(i => i.RedeemedAt is null && i.RevokedAt is null && (i.ExpiresAt <= now || i.NeedsRenewal(now, renewBefore))).Select(i => i.ProductionId).Distinct()]);

        Task<IReadOnlyList<Invite>> IInviteRepository.ListUnusedAsync(string productionId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<Invite>>([.. data.Invites.Where(i => i.ProductionId == productionId && i.RedeemedAt is null && i.RevokedAt is null)]);

        Task<int> IInviteRepository.DeleteExpiredAsync(DateTimeOffset before, CancellationToken cancellationToken) =>
            Task.FromResult(data.Invites.RemoveAll(i => i.ExpiresAt < before));

        void IInviteRepository.Add(Invite invite) => data.Invites.Add(invite);

        void IInviteRepository.Remove(Invite invite) => data.Invites.Remove(invite);

        void IAuditRepository.Add(AuditEntry entry) => pendingAudit.Add(entry);

        Task<IReadOnlyList<AuditEntry>> IAuditRepository.ListRecentAsync(string productionId, IReadOnlyCollection<string> actions, int count, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<AuditEntry>>([.. data.Audit.Where(a => a.ProductionId == productionId && actions.Contains(a.Action)).Reverse().Take(count)]);

        private static OutputKeyInfo Key(Production p) => new(p.Id, p.Slug, p.OutputKey, p.AllowedIps);
    }
}

/// <summary>Records everything that would go to SignalR.</summary>
internal sealed class RecordingPublisher : IRealtimePublisher
{
    public ConcurrentQueue<ProductionEvent> StudioEvents { get; } = new();

    public ConcurrentQueue<ProductionEvent> OutputEvents { get; } = new();

    public ConcurrentQueue<(string ConnectionId, TallyDto Tally)> Tallies { get; } = new();

    public ConcurrentQueue<(string ConnectionId, DeviceSelfDto Self)> Selves { get; } = new();

    public ConcurrentQueue<string> Replaced { get; } = new();

    public ConcurrentQueue<string> Aborted { get; } = new();

    public ConcurrentQueue<string> AbortedAfterDelivery { get; } = new();

    public ConcurrentQueue<DeviceTelemetryMessage> Telemetry { get; } = new();

    public ConcurrentQueue<(string ProductionId, int Count)> Presence { get; } = new();

    public ConcurrentQueue<string> Joined { get; } = new();

    public int DelayMs { get; set; }

    public Task JoinStudioAsync(string connectionId, string productionId)
    {
        Joined.Enqueue($"studio:{connectionId}:{productionId}");
        return Task.CompletedTask;
    }

    public Task LeaveStudioAsync(string connectionId, string productionId) => Task.CompletedTask;

    public Task JoinOutputAsync(string connectionId, string productionId)
    {
        Joined.Enqueue($"output:{connectionId}:{productionId}");
        return Task.CompletedTask;
    }

    public async Task PublishEventAsync(string productionId, ProductionEvent studioEvent, ProductionEvent outputEvent)
    {
        if (DelayMs > 0)
        {
            await Task.Delay(DelayMs);
        }

        StudioEvents.Enqueue(studioEvent);
        OutputEvents.Enqueue(outputEvent);
    }

    public Task PublishTelemetryAsync(string productionId, DeviceTelemetryMessage message)
    {
        Telemetry.Enqueue(message);
        return Task.CompletedTask;
    }

    public Task PublishPresenceAsync(string productionId, int operatorsOnline)
    {
        Presence.Enqueue((productionId, operatorsOnline));
        return Task.CompletedTask;
    }

    public Task RequestStudioResyncAsync(string activeProductionId) => Task.CompletedTask;

    public Task SendTallyAsync(string connectionId, TallyDto tally)
    {
        Tallies.Enqueue((connectionId, tally));
        return Task.CompletedTask;
    }

    public Task SendSelfAsync(string connectionId, DeviceSelfDto self)
    {
        Selves.Enqueue((connectionId, self));
        return Task.CompletedTask;
    }

    public Task SendCommandAsync(string connectionId, DeviceCommandDto command) => Task.CompletedTask;

    public Task SendSessionReplacedAsync(string connectionId)
    {
        Replaced.Enqueue(connectionId);
        return Task.CompletedTask;
    }

    public void Abort(string connectionId) => Aborted.Enqueue(connectionId);

    public void AbortAfterDelivery(string connectionId) => AbortedAfterDelivery.Enqueue(connectionId);
}

/// <summary>
/// Delivers at once on the calling thread, so tests see the events right after the mutation returns (the ordered
/// production dispatcher has its own tests).
/// </summary>
internal sealed class InlineDispatcher(IRealtimePublisher publisher) : IRealtimeDispatcher
{
    public void Enqueue(string productionId, Func<IRealtimePublisher, Task> delivery)
    {
        try
        {
            delivery(publisher).GetAwaiter().GetResult();
        }
        catch (InvalidOperationException)
        {
            // Like the real dispatcher: a failing delivery never fails the mutation.
        }
    }

    public Task WhenIdleAsync(string productionId, CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>Room service that remembers removals and returns a configurable participant list.</summary>
internal sealed class FakeRoomClient : ILiveKitRoomClient
{
    public List<LiveKitParticipant> Participants { get; } = [];

    public ConcurrentQueue<string> Removed { get; } = new();

    public bool Unavailable { get; set; }

    public Task<IReadOnlyList<LiveKitParticipant>> ListParticipantsAsync(string room, CancellationToken cancellationToken) =>
        Unavailable ? throw new LiveKitUnavailableException("down") : Task.FromResult<IReadOnlyList<LiveKitParticipant>>([.. Participants]);

    public Task RemoveParticipantAsync(string room, string identity, CancellationToken cancellationToken)
    {
        if (Unavailable)
        {
            throw new LiveKitUnavailableException("down");
        }

        Removed.Enqueue(identity);
        return Task.CompletedTask;
    }
}

/// <summary>Token issuer that encodes the grant in the token string.</summary>
internal sealed class FakeTokens : ILiveKitTokenIssuer
{
    public LiveKitTokenDto IssueSenderToken(string room, string identity, string name) => new("ws://lk", $"sender:{identity}", identity, room, Build.T0);

    public LiveKitTokenDto IssueViewerToken(string room, string identity, string name) => new("ws://lk", $"viewer:{identity}", identity, room, Build.T0);
}
