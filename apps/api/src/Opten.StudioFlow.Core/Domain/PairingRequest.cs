using System.Globalization;
using System.Security.Cryptography;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>The two lifetimes of a knock.</summary>
/// <param name="Pending">How long a request waits for the Regie (<c>Pairing:RequestTtl</c>, default 10 minutes).</param>
/// <param name="Decision">
/// How long an approval (with its credentials) or a denial stays visible to the poller (<c>Pairing:CredentialsWindow</c>,
/// default 5 minutes).
/// </param>
public sealed record PairingRequestLifetimes(TimeSpan Pending, TimeSpan Decision)
{
    /// <summary>The spec values (10 and 5 minutes).</summary>
    public static PairingRequestLifetimes Default { get; } = new(TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(5));
}

/// <summary>
/// An anonymous knock from /join (spec 4.6, way 2). Lives in memory only: pending for <c>Pairing:RequestTtl</c>; after
/// approval the poll returns the same credentials for <c>Pairing:CredentialsWindow</c>; a denial stays visible to the
/// poller for the same window.
/// </summary>
public sealed class PairingRequest
{
    private readonly TimeSpan decisionLifetime;
    private DeviceCredentialsDto? credentials;

    private PairingRequest(string productionId, string name, DeviceKind kind, string platform, string checkCode, string pollTokenHash, DateTimeOffset now, PairingRequestLifetimes lifetimes)
    {
        Id = EntityIds.New(EntityIds.PairingRequest);
        ProductionId = productionId;
        Name = name;
        Kind = kind;
        Platform = platform;
        CheckCode = checkCode;
        PollTokenHash = pollTokenHash;
        CreatedAt = now;
        ExpiresAt = now + lifetimes.Pending;
        decisionLifetime = lifetimes.Decision;
    }

    /// <summary>Request id.</summary>
    public string Id { get; }

    /// <summary>Production the device will belong to.</summary>
    public string ProductionId { get; }

    /// <summary>Device name typed on the laptop.</summary>
    public string Name { get; }

    /// <summary>Declared device kind.</summary>
    public DeviceKind Kind { get; }

    /// <summary>Platform text.</summary>
    public string Platform { get; }

    /// <summary>Four digit check code, unique among pending requests.</summary>
    public string CheckCode { get; }

    /// <summary>Hash of the poll token.</summary>
    public string PollTokenHash { get; }

    /// <summary>Creation time.</summary>
    public DateTimeOffset CreatedAt { get; }

    /// <summary>Expiry of the pending state.</summary>
    public DateTimeOffset ExpiresAt { get; }

    /// <summary>Current status (pending, approved, denied).</summary>
    public PairingRequestStatus Status { get; private set; } = PairingRequestStatus.Pending;

    /// <summary>Time of the approval or denial.</summary>
    public DateTimeOffset? DecidedAt { get; private set; }

    /// <summary>Creates a request with a fresh poll token; <paramref name="checkCode"/> must be unique among pending requests.</summary>
    public static (PairingRequest Request, string PollToken) Create(string productionId, CreatePairingRequest input, string checkCode, DateTimeOffset now, PairingRequestLifetimes? lifetimes = null)
    {
        ArgumentNullException.ThrowIfNull(input);
        var errors = new ValidationErrors();
        var name = TextRules.RequiredName(input.Name, TextRules.DeviceNameMax, "name", errors);
        if (!Enum.IsDefined(input.Kind))
        {
            errors.Add("kind", "Unknown device type.");
        }

        errors.ThrowIfAny();
        var pollToken = Secrets.New();
        var platform = TextRules.Truncate(input.Platform, TextRules.PlatformMax) ?? string.Empty;
        return (new PairingRequest(productionId, name!, input.Kind, platform, checkCode, Secrets.Hash(pollToken), now, lifetimes ?? PairingRequestLifetimes.Default), pollToken);
    }

    /// <summary>A random four digit check code that is not in <paramref name="taken"/>.</summary>
    public static string NewCheckCode(IReadOnlySet<string> taken)
    {
        ArgumentNullException.ThrowIfNull(taken);
        while (true)
        {
            var code = RandomNumberGenerator.GetInt32(10_000).ToString("D4", CultureInfo.InvariantCulture);
            if (!taken.Contains(code))
            {
                return code;
            }
        }
    }

    /// <summary>True while the Regie can still approve or deny.</summary>
    public bool IsPending(DateTimeOffset now) => Status == PairingRequestStatus.Pending && now < ExpiresAt;

    /// <summary>True once the Regie approved or denied the request.</summary>
    public bool IsDecided => Status != PairingRequestStatus.Pending;

    /// <summary>True when the request can be forgotten (expired, or decided longer ago than the decision window).</summary>
    public bool IsExpired(DateTimeOffset now) => Status == PairingRequestStatus.Pending
        ? now >= ExpiresAt
        : DecidedAt is { } decided && now - decided >= decisionLifetime;

    /// <summary>True when <paramref name="pollToken"/> belongs to this request.</summary>
    public bool HasPollToken(string? pollToken) => Secrets.MatchesHash(pollToken, PollTokenHash);

    /// <summary>Approves the request with the credentials of the new device.</summary>
    public void Approve(DeviceCredentialsDto deviceCredentials, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(deviceCredentials);
        EnsurePending(now);
        Status = PairingRequestStatus.Approved;
        DecidedAt = now;
        credentials = deviceCredentials;
    }

    /// <summary>Denies the request.</summary>
    public void Deny(DateTimeOffset now)
    {
        EnsurePending(now);
        Status = PairingRequestStatus.Denied;
        DecidedAt = now;
    }

    /// <summary>What the poller sees: approved requests return the same credentials until they are forgotten.</summary>
    public PairingRequestStatusDto StatusFor(DateTimeOffset now) => IsExpired(now)
        ? new PairingRequestStatusDto(PairingRequestStatus.Expired, null)
        : new PairingRequestStatusDto(Status, Status == PairingRequestStatus.Approved ? credentials : null);

    /// <summary>The knock card for the Regie.</summary>
    public PairingRequestDto ToDto() => new(Id, Name, Kind, Platform, CheckCode, CreatedAt, ExpiresAt);

    private void EnsurePending(DateTimeOffset now)
    {
        if (!IsPending(now))
        {
            throw StudioFlowException.PairingExpired();
        }
    }
}
