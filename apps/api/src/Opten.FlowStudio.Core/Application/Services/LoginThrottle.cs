namespace Opten.FlowStudio.Core.Application.Services;

/// <summary>
/// Login lockout (spec 5): 5 failed attempts per client IP within 15 minutes lock that IP for 15 minutes; 20 failures
/// per user name within 15 minutes lock the user name. In memory, bounded in size.
/// </summary>
public sealed class LoginThrottle(TimeProvider clock)
{
    /// <summary>Failures per IP before the lockout.</summary>
    public const int MaxFailuresPerIp = 5;

    /// <summary>Failures per user name before the lockout.</summary>
    public const int MaxFailuresPerUser = 20;

    /// <summary>Window in which failures count.</summary>
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    /// <summary>Duration of a lockout.</summary>
    public static readonly TimeSpan Lockout = TimeSpan.FromMinutes(15);

    private const int MaxTrackedKeys = 10_000;
    private const int MaxUserKeyLength = 100;

    private readonly Lock gate = new();
    private readonly Dictionary<string, Counter> ips = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Counter> users = new(StringComparer.Ordinal);

    /// <summary>Remaining lockout for the IP or the user name, or null when a login may be tried.</summary>
    public TimeSpan? LockedFor(string ip, string? username)
    {
        var now = clock.GetUtcNow();
        lock (gate)
        {
            var remaining = Remaining(ips.GetValueOrDefault(ip), now);
            var userRemaining = Remaining(users.GetValueOrDefault(UserKey(username)), now);
            return Max(remaining, userRemaining);
        }
    }

    /// <summary>Counts a failure; returns the lockout when this failure started one.</summary>
    public TimeSpan? RegisterFailure(string ip, string? username)
    {
        var now = clock.GetUtcNow();
        lock (gate)
        {
            var ipLock = Count(ips, ip, MaxFailuresPerIp, now);
            var userLock = Count(users, UserKey(username), MaxFailuresPerUser, now);
            return Max(ipLock, userLock);
        }
    }

    /// <summary>A successful login clears the failures of the IP.</summary>
    public void RegisterSuccess(string ip)
    {
        lock (gate)
        {
            ips.Remove(ip);
        }
    }

    /// <summary>Forgets counters without recent failures or active lockouts.</summary>
    public void Prune()
    {
        var now = clock.GetUtcNow();
        lock (gate)
        {
            PruneMap(ips, now);
            PruneMap(users, now);
        }
    }

    private static TimeSpan? Count(Dictionary<string, Counter> map, string key, int limit, DateTimeOffset now)
    {
        if (!map.TryGetValue(key, out var counter))
        {
            if (map.Count >= MaxTrackedKeys)
            {
                PruneMap(map, now);
                if (map.Count >= MaxTrackedKeys)
                {
                    map.Remove(map.MinBy(e => e.Value.LastFailure).Key);
                }
            }

            counter = new Counter();
            map[key] = counter;
        }

        counter.Failures.RemoveAll(f => now - f > Window);
        counter.Failures.Add(now);
        counter.LastFailure = now;
        if (counter.Failures.Count >= limit && Remaining(counter, now) is null)
        {
            counter.LockedUntil = now + Lockout;
            counter.Failures.Clear();
            return Lockout;
        }

        return null;
    }

    private static TimeSpan? Remaining(Counter? counter, DateTimeOffset now) =>
        counter?.LockedUntil is { } until && until > now ? until - now : null;

    private static TimeSpan? Max(TimeSpan? left, TimeSpan? right) =>
        left is null ? right : right is null ? left : left > right ? left : right;

    private static void PruneMap(Dictionary<string, Counter> map, DateTimeOffset now)
    {
        foreach (var key in map.Where(e => Remaining(e.Value, now) is null && now - e.Value.LastFailure > Window).Select(e => e.Key).ToList())
        {
            map.Remove(key);
        }
    }

    private static string UserKey(string? username)
    {
        var key = (username ?? string.Empty).Trim().ToLowerInvariant();
        return key.Length > MaxUserKeyLength ? key[..MaxUserKeyLength] : key;
    }

    private sealed class Counter
    {
        public List<DateTimeOffset> Failures { get; } = [];

        public DateTimeOffset LastFailure { get; set; }

        public DateTimeOffset? LockedUntil { get; set; }
    }
}
