namespace Opten.FlowStudio.Core.Application;

/// <summary>Durations and limits of pairing (configuration section <c>Pairing</c>, spec 4.6).</summary>
public sealed class PairingOptions : IValidatedOptions
{
    /// <summary>Configuration section name.</summary>
    public const string Section = "Pairing";

    /// <summary><c>Pairing:InviteTtl</c>: validity of a phone QR invite or a laptop invite link (default 30 minutes).</summary>
    public TimeSpan InviteTtl { get; set; } = TimeSpan.FromMinutes(30);

    /// <summary><c>Pairing:RequestTtl</c>: how long a /join knock waits for the Regie (default 10 minutes).</summary>
    public TimeSpan RequestTtl { get; set; } = TimeSpan.FromMinutes(10);

    /// <summary>
    /// <c>Pairing:CredentialsWindow</c>: how long the poll of an approved knock returns the credentials, and how long a
    /// denial stays visible to the poller (default 5 minutes).
    /// </summary>
    public TimeSpan CredentialsWindow { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// <c>Pairing:RedeemIdempotencyWindow</c>: how long the same client id may redeem a used invite again and gets the
    /// same device with a rotated secret (default 5 minutes).
    /// </summary>
    public TimeSpan RedeemIdempotencyWindow { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// <c>Pairing:PhoneInviteRenewBefore</c>: the phone QR invite is replaced when less than this time is left, so the
    /// Regie never shows an expiring code (default 2 minutes; at most half the invite validity is used, so a short
    /// <c>Pairing:InviteTtl</c> works without changing this value).
    /// </summary>
    public TimeSpan PhoneInviteRenewBefore { get; set; } = TimeSpan.FromMinutes(2);

    /// <summary>The renewal lead actually used: <see cref="PhoneInviteRenewBefore"/>, capped at half of <see cref="InviteTtl"/>.</summary>
    public TimeSpan PhoneInviteRenewalLead => PhoneInviteRenewBefore < InviteTtl / 2 ? PhoneInviteRenewBefore : InviteTtl / 2;

    /// <summary>Rate limits (<c>Pairing:Limits</c>).</summary>
    public PairingLimits Limits { get; set; } = new();

    /// <inheritdoc />
    public IEnumerable<string> Validate() =>
    [
        .. OptionRules.Duration("Pairing:InviteTtl", InviteTtl, TimeSpan.FromSeconds(10), TimeSpan.FromDays(7)),
        .. OptionRules.Duration("Pairing:RequestTtl", RequestTtl, TimeSpan.FromSeconds(5), TimeSpan.FromHours(24)),
        .. OptionRules.Duration("Pairing:CredentialsWindow", CredentialsWindow, TimeSpan.FromSeconds(5), TimeSpan.FromHours(1)),
        .. OptionRules.Duration("Pairing:RedeemIdempotencyWindow", RedeemIdempotencyWindow, TimeSpan.FromSeconds(5), TimeSpan.FromHours(1)),
        .. OptionRules.Duration("Pairing:PhoneInviteRenewBefore", PhoneInviteRenewBefore, TimeSpan.Zero, TimeSpan.FromDays(1)),
        .. OptionRules.Count("Pairing:Limits:RequestsPerIpPer10Min", Limits.RequestsPerIpPer10Min, 1, 10_000),
        .. OptionRules.Count("Pairing:Limits:PendingTotal", Limits.PendingTotal, 1, 1_000),
        .. OptionRules.Count("Pairing:Limits:RedeemPerIpPer10Min", Limits.RedeemPerIpPer10Min, 1, 10_000),
    ];
}

/// <summary>Rate limits of pairing (configuration section <c>Pairing:Limits</c>).</summary>
public sealed class PairingLimits
{
    /// <summary>
    /// <c>Pairing:Limits:RequestsPerIpPer10Min</c>: /join knocks per client address in a sliding 10 minute window
    /// (default 10); more answer 429 <c>rate_limited</c>.
    /// </summary>
    public int RequestsPerIpPer10Min { get; set; } = 10;

    /// <summary><c>Pairing:Limits:PendingTotal</c>: knocks pending at the same time over all productions (default 20); more answer 429.</summary>
    public int PendingTotal { get; set; } = 20;

    /// <summary>
    /// <c>Pairing:Limits:RedeemPerIpPer10Min</c>: invite redemptions per client address in a sliding 10 minute window,
    /// successful or not (default 20); more answer 429.
    /// </summary>
    public int RedeemPerIpPer10Min { get; set; } = 20;
}
