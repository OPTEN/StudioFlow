namespace Opten.FlowStudio.Core.Application;

/// <summary>Login lockout (configuration section <c>Admin:Lockout</c>, spec 5, GAP-03).</summary>
public sealed class LoginLockoutOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Admin:Lockout";

    /// <summary><c>Admin:Lockout:MaxFailuresPerIp</c>: failures per client address within the window that start a lockout (default 5).</summary>
    public int MaxFailuresPerIp { get; set; } = 5;

    /// <summary><c>Admin:Lockout:MaxFailuresPerUser</c>: failures per user name (from any address) within the window that lock the name (default 20).</summary>
    public int MaxFailuresPerUser { get; set; } = 20;

    /// <summary><c>Admin:Lockout:Window</c>: sliding window in which failures count (default 15 minutes).</summary>
    public TimeSpan Window { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary><c>Admin:Lockout:Duration</c>: how long a lockout lasts; every attempt answers 429 meanwhile (default 15 minutes).</summary>
    public TimeSpan Duration { get; set; } = TimeSpan.FromMinutes(15);

    /// <inheritdoc />
    public IEnumerable<string> Validate() =>
    [
        .. OptionRules.Count("Admin:Lockout:MaxFailuresPerIp", MaxFailuresPerIp, 1, 1_000),
        .. OptionRules.Count("Admin:Lockout:MaxFailuresPerUser", MaxFailuresPerUser, 1, 10_000),
        .. OptionRules.Duration("Admin:Lockout:Window", Window, TimeSpan.FromSeconds(1), TimeSpan.FromDays(1)),
        .. OptionRules.Duration("Admin:Lockout:Duration", Duration, TimeSpan.FromSeconds(1), TimeSpan.FromDays(1)),
    ];
}
