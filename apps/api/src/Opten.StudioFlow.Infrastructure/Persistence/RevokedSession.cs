namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// Row of <c>admin_revoked_session</c>: a Regie session that a logout ended, kept until its cookie could not be valid any
/// more, so the revocation survives an API restart. Persistence detail only; the core sees
/// <see cref="Core.Application.Ports.RevokedSessionEntry"/>.
/// </summary>
internal sealed class RevokedSession
{
    /// <summary>Random id of the session (the <c>studioflow:sid</c> claim of its cookie).</summary>
    public string SessionId { get; set; } = string.Empty;

    /// <summary>The revocation is kept until then; later the session is expired anyway.</summary>
    public DateTimeOffset RevokedUntil { get; set; }
}
