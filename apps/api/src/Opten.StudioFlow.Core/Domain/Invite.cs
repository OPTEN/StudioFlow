using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>
/// A one-time invite (spec 4.6): the phone QR code or a laptop invite link. Valid once (30 minutes by default,
/// <c>Pairing:InviteTtl</c>) and revocable. Redeeming is idempotent per client id for a short window
/// (<c>Pairing:RedeemIdempotencyWindow</c>), so a lost response does not burn the invite.
/// </summary>
public sealed class Invite
{
    private Invite()
    {
    }

    /// <summary>Invite id.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>Production the invite pairs into.</summary>
    public string ProductionId { get; private set; } = string.Empty;

    /// <summary>QR or link.</summary>
    public InviteKind Kind { get; private set; }

    /// <summary>Secret token in the URL (shown to the Regie, therefore not hashed).</summary>
    public string Token { get; private set; } = string.Empty;

    /// <summary>Creation time.</summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Expiry.</summary>
    public DateTimeOffset ExpiresAt { get; private set; }

    /// <summary>Time of the (first) redemption.</summary>
    public DateTimeOffset? RedeemedAt { get; private set; }

    /// <summary>Client id of the redeemer.</summary>
    public string? RedeemedClientId { get; private set; }

    /// <summary>Device created by the redemption.</summary>
    public string? RedeemedDeviceId { get; private set; }

    /// <summary>Revocation time.</summary>
    public DateTimeOffset? RevokedAt { get; private set; }

    /// <summary>Creates an invite valid for <paramref name="lifetime"/>.</summary>
    public static Invite Create(string productionId, InviteKind kind, DateTimeOffset now, TimeSpan lifetime)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(lifetime, TimeSpan.Zero);
        return new Invite
        {
            Id = EntityIds.New(EntityIds.Invite),
            ProductionId = productionId,
            Kind = kind,
            Token = Secrets.New(),
            CreatedAt = now,
            ExpiresAt = now + lifetime,
        };
    }

    /// <summary>Kind of a device paired through this invite: the invite decides, not the redeeming client (GAP-19).</summary>
    public DeviceKind DeviceKind => Kind == InviteKind.PhoneQr ? DeviceKind.Phone : DeviceKind.Laptop;

    /// <summary>Pairing method of a device created through this invite.</summary>
    public PairingMethod PairingMethod => Kind == InviteKind.PhoneQr ? PairingMethod.Qr : PairingMethod.Link;

    /// <summary>True while the invite can be redeemed.</summary>
    public bool IsOpen(DateTimeOffset now) => RedeemedAt is null && RevokedAt is null && now < ExpiresAt;

    /// <summary>
    /// True when an open phone invite should be replaced by a fresh one because less than <paramref name="renewBefore"/>
    /// is left (the Regie never shows an expiring code).
    /// </summary>
    public bool NeedsRenewal(DateTimeOffset now, TimeSpan renewBefore) => Kind == InviteKind.PhoneQr && IsOpen(now) && ExpiresAt - now < renewBefore;

    /// <summary>True when <paramref name="clientId"/> redeemed this invite at most <paramref name="window"/> ago.</summary>
    public bool CanReplay(string clientId, DateTimeOffset now, TimeSpan window) =>
        RedeemedAt is { } at && RevokedAt is null && RedeemedDeviceId is not null && now - at <= window
        && Secrets.FixedTimeEquals(RedeemedClientId, clientId);

    /// <summary>Marks the invite as used by a client and its new device.</summary>
    public void Redeem(string clientId, string deviceId, DateTimeOffset now)
    {
        if (!IsOpen(now))
        {
            throw FlowStudioException.PairingExpired();
        }

        RedeemedAt = now;
        RedeemedClientId = clientId;
        RedeemedDeviceId = deviceId;
    }

    /// <summary>Revokes the invite; returns false when it was not open anyway.</summary>
    public bool Revoke(DateTimeOffset now)
    {
        if (!IsOpen(now))
        {
            return false;
        }

        RevokedAt = now;
        return true;
    }

    /// <summary>Absolute URL with the token: <c>/join/i/{token}</c> for the QR code, <c>/j/{token}</c> for links.</summary>
    public string UrlFor(string publicBaseUrl)
    {
        ArgumentNullException.ThrowIfNull(publicBaseUrl);
        var path = Kind == InviteKind.PhoneQr ? "/join/i/" : "/j/";
        return publicBaseUrl.TrimEnd('/') + path + Token;
    }
}
