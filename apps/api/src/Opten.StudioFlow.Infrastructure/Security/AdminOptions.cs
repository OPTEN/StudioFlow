namespace Opten.StudioFlow.Infrastructure.Security;

/// <summary>
/// Settings of the Regie sessions (configuration section <c>Admin</c>). The account itself is no setting: it is created in
/// the first-run setup and lives in the database.
/// </summary>
public sealed class AdminOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Admin";

    /// <summary>
    /// <c>Admin:SessionLifetime</c>: sliding lifetime of the session cookie <c>sf_session</c> (spec 5, default 12 h); a
    /// studio hub connection is closed when its session expires.
    /// </summary>
    public TimeSpan SessionLifetime { get; set; } = TimeSpan.FromHours(12);
}
