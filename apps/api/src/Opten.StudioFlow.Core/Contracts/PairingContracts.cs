namespace Opten.FlowStudio.Core.Contracts;

/// <summary>A pending /join request as shown to the Regie (knock card).</summary>
/// <param name="Id">Request id.</param>
/// <param name="Name">Device name typed on the laptop.</param>
/// <param name="Kind">Device kind the requester declared.</param>
/// <param name="Platform">Platform text of the requester.</param>
/// <param name="CheckCode">Four digit check code, shown as «47 12» on both screens.</param>
/// <param name="CreatedAt">Creation time.</param>
/// <param name="ExpiresAt">Expiry (10 minutes).</param>
public sealed record PairingRequestDto(
    string Id,
    string Name,
    DeviceKind Kind,
    string Platform,
    string CheckCode,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt);

/// <summary>A one-time invite (QR code for phones, link for laptops). Valid once for 30 minutes.</summary>
/// <param name="Id">Invite id.</param>
/// <param name="Kind">QR or link.</param>
/// <param name="Url">Absolute URL with the secret token; only visible to the Regie.</param>
/// <param name="CreatedAt">Creation time.</param>
/// <param name="ExpiresAt">Expiry.</param>
public sealed record InviteDto(string Id, InviteKind Kind, string Url, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt);

/// <summary>Creates an invite link.</summary>
public sealed record CreateInviteRequest(InviteKind Kind);

/// <summary>Anonymous knock from /join.</summary>
/// <param name="Name">Device name, 1–60 characters.</param>
/// <param name="Kind">Phone or laptop.</param>
/// <param name="Platform">Platform text, up to 80 characters.</param>
public sealed record CreatePairingRequest(string Name, DeviceKind Kind, string Platform);

/// <summary>Answer to a knock: the requester keeps the poll token secret and polls with it.</summary>
public sealed record PairingRequestCreatedDto(string RequestId, string PollToken, string CheckCode, DateTimeOffset ExpiresAt);

/// <summary>Poll result for a knock. Credentials are present once the Regie approved.</summary>
public sealed record PairingRequestStatusDto(PairingRequestStatus Status, DeviceCredentialsDto? Credentials);

/// <summary>Redeems a QR code or invite link.</summary>
/// <param name="ClientId">Random id the browser generated before redeeming; repeating the call with the same id within five minutes returns the same device (lost responses).</param>
/// <param name="Name">Optional device name; defaults to a generated one.</param>
/// <param name="Kind">Phone or laptop.</param>
/// <param name="Platform">Platform text.</param>
public sealed record RedeemInviteRequest(string ClientId, string? Name, DeviceKind Kind, string Platform);

/// <summary>Credentials of a paired device. The secret is shown exactly to the device and stored only as a hash.</summary>
/// <param name="DeviceId">Device id.</param>
/// <param name="DeviceSecret">Secret; the sender sends <c>Authorization: Bearer {deviceId}.{deviceSecret}</c>.</param>
/// <param name="ProductionId">Production the device belongs to.</param>
public sealed record DeviceCredentialsDto(string DeviceId, string DeviceSecret, string ProductionId);
