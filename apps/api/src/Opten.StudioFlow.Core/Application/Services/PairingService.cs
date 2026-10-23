using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Runtime;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Application.Services;

/// <summary>
/// The three ways of pairing (spec 4.6): phone QR invite (always fresh), short URL with check code and approval, and
/// laptop invite links. Every way ends with <see cref="DeviceCredentialsDto"/>; the secret is stored hashed only.
/// </summary>
public sealed class PairingService(
    ProductionCoordinator coordinator,
    IUnitOfWorkFactory data,
    PairingRequestStore requests,
    StudioFlowOptions options,
    PairingOptions pairing,
    TimeProvider clock)
{
    private const int ClientIdMax = 128;

    /// <summary>The current phone QR invite; creates one when none is valid.</summary>
    public Task<InviteDto> GetPhoneInviteAsync(string productionId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var current = (await context.Data.Invites.ListOpenAsync(productionId, context.Now, cancellationToken))
                    .Where(i => i.Kind == InviteKind.PhoneQr && !i.NeedsRenewal(context.Now, pairing.PhoneInviteRenewalLead))
                    .MaxBy(i => i.CreatedAt);
                return current is null ? await RenewPhoneInviteAsync(context, cancellationToken) : Dtos.Invite(current, options.BaseUrl);
            },
            cancellationToken);

    /// <summary>Replaces the phone QR invite with a new one.</summary>
    public Task<InviteDto> RenewPhoneInviteAsync(string productionId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(productionId, context => RenewPhoneInviteAsync(context, cancellationToken), cancellationToken);

    /// <summary>Creates an invite link for a laptop (a phone QR request renews the phone invite).</summary>
    public Task<InviteDto> CreateInviteAsync(string productionId, CreateInviteRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!Enum.IsDefined(request.Kind))
        {
            throw StudioFlowException.Invalid("kind", "Unknown invite type.");
        }

        return coordinator.ExecuteAsync(
            productionId,
            context => request.Kind == InviteKind.PhoneQr
                ? RenewPhoneInviteAsync(context, cancellationToken)
                : Task.FromResult(CreateInvite(context, InviteKind.LaptopLink, AuditActors.Admin)),
            cancellationToken);
    }

    /// <summary>Revokes an invite; a revoked phone invite is replaced at once.</summary>
    public Task RevokeInviteAsync(string productionId, string inviteId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var invite = await context.Data.Invites.GetAsync(productionId, inviteId, cancellationToken) ?? throw StudioFlowException.NotFound("Invite");
                if (!invite.Revoke(context.Now))
                {
                    return;
                }

                RemoveInvite(context, invite, AuditActors.Admin);
                if (invite.Kind == InviteKind.PhoneQr)
                {
                    CreateInvite(context, InviteKind.PhoneQr, AuditActors.System);
                }
            },
            cancellationToken);

    /// <summary>
    /// Approves a knock: creates the device; the poll returns its credentials for <c>Pairing:CredentialsWindow</c>. A knock
    /// that was already decided (the second of two approvals) is <c>not_found</c> and creates no second device, an
    /// expired one is <c>pairing_expired</c> (GAP-09).
    /// </summary>
    public Task<DeviceDto> ApproveAsync(string productionId, string requestId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var request = FindRequest(productionId, requestId);
                if (request.IsDecided)
                {
                    throw StudioFlowException.NotFound("Request");
                }

                if (!request.IsPending(context.Now))
                {
                    throw StudioFlowException.PairingExpired();
                }

                var catalog = await context.CatalogAsync(cancellationToken);
                var (device, secret) = Device.Pair(productionId, request.Name, request.Kind, request.Platform, PairingMethod.Code, context.Now, catalog.CodesInUse);
                context.Data.Devices.Add(device);
                var credentials = new DeviceCredentialsDto(device.Id, secret, productionId);
                var now = context.Now;
                context.OnCommitted(() => request.Approve(credentials, now));
                context.Emit(revision => new PairingRequestRemovedEvent(revision, request.Id, PairingRequestStatus.Approved));
                Paired(context, device, AuditActors.Admin);
                return Dtos.Device(device, context.Runtime.FindDevice(device.Id));
            },
            cancellationToken);

    /// <summary>Denies a knock; deciding twice is a no-op.</summary>
    public Task DenyAsync(string productionId, string requestId, CancellationToken cancellationToken) =>
        coordinator.ExecuteAsync(
            productionId,
            context =>
            {
                var request = FindRequest(productionId, requestId);
                if (request.IsPending(context.Now))
                {
                    var now = context.Now;
                    context.OnCommitted(() => request.Deny(now));
                    context.Emit(revision => new PairingRequestRemovedEvent(revision, request.Id, PairingRequestStatus.Denied));
                    context.Audit(AuditActors.Admin, AuditActions.PairingDenied, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Name] = request.Name });
                }

                return Task.CompletedTask;
            },
            cancellationToken);

    /// <summary>An anonymous knock from /join into the active production.</summary>
    public async Task<PairingRequestCreatedDto> CreateRequestAsync(CreatePairingRequest input, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        string productionId;
        await using (var unit = data.Create())
        {
            productionId = (await unit.Productions.GetActiveAsync(Production.DefaultTenant, cancellationToken))?.Id ?? throw StudioFlowException.NotFound("Active production");
        }

        return await coordinator.ExecuteAsync(
            productionId,
            context =>
            {
                var (request, pollToken) = requests.Create(productionId, input, context.Now);
                var dto = request.ToDto();
                context.Emit(revision => new PairingRequestUpsertedEvent(revision, dto));
                return Task.FromResult(new PairingRequestCreatedDto(request.Id, pollToken, request.CheckCode, request.ExpiresAt));
            },
            cancellationToken);
    }

    /// <summary>Poll of a knock. Unknown requests and wrong tokens look expired.</summary>
    public PairingRequestStatusDto Poll(string requestId, string? pollToken)
    {
        var request = requests.Find(requestId);
        return request is not null && request.HasPollToken(pollToken)
            ? request.StatusFor(clock.GetUtcNow())
            : new PairingRequestStatusDto(PairingRequestStatus.Expired, null);
    }

    /// <summary>The requester withdraws a pending knock.</summary>
    public async Task CancelRequestAsync(string requestId, string? pollToken, CancellationToken cancellationToken)
    {
        var request = requests.Find(requestId);
        if (request is null || !request.HasPollToken(pollToken))
        {
            return;
        }

        await coordinator.ExecuteAsync(
            request.ProductionId,
            context =>
            {
                if (request.IsPending(context.Now))
                {
                    context.OnCommitted(() => requests.Remove(request.Id));
                    context.Emit(revision => new PairingRequestRemovedEvent(revision, request.Id, PairingRequestStatus.Expired));
                }

                return Task.CompletedTask;
            },
            cancellationToken);
    }

    /// <summary>
    /// Redeems a QR code or invite link. Idempotent per client id for <c>Pairing:RedeemIdempotencyWindow</c>: the same
    /// client gets the same device with a rotated secret. Unknown, expired, used or revoked tokens are
    /// <c>pairing_expired</c> (410). The invite decides the device kind: a QR code pairs a phone, a link a laptop; the
    /// kind in the request is ignored (GAP-19).
    /// </summary>
    public async Task<DeviceCredentialsDto> RedeemAsync(string token, RedeemInviteRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var clientId = ValidateRedeem(request);
        string productionId;
        await using (var unit = data.Create())
        {
            productionId = (await unit.Invites.GetByTokenAsync(token, cancellationToken))?.ProductionId ?? throw StudioFlowException.PairingExpired();
        }

        return await coordinator.ExecuteAsync(
            productionId,
            async context =>
            {
                var invite = await context.Data.Invites.GetByTokenAsync(token, cancellationToken) ?? throw StudioFlowException.PairingExpired();
                if (invite.CanReplay(clientId, context.Now, pairing.RedeemIdempotencyWindow))
                {
                    var existing = await context.Data.Devices.GetAsync(invite.RedeemedDeviceId!, cancellationToken) ?? throw StudioFlowException.PairingExpired();
                    return new DeviceCredentialsDto(existing.Id, existing.RotateSecret(), productionId);
                }

                if (!invite.IsOpen(context.Now))
                {
                    throw StudioFlowException.PairingExpired();
                }

                var devices = await context.Data.Devices.ListAsync(productionId, cancellationToken);
                var assets = await context.Data.Assets.ListAsync(productionId, cancellationToken);
                var kind = invite.DeviceKind;
                var name = TextRules.Truncate(request.Name, TextRules.DeviceNameMax) ?? Device.DefaultName(kind, devices.Select(d => d.Name));
                var (device, secret) = Device.Pair(productionId, name, kind, request.Platform, invite.PairingMethod, context.Now, new SourceCatalog(devices, assets).CodesInUse);
                invite.Redeem(clientId, device.Id, context.Now);
                context.Data.Devices.Add(device);
                context.Emit(revision => new InviteRemovedEvent(revision, invite.Id));
                Paired(context, device, AuditActors.Device(device.Id));
                if (invite.Kind == InviteKind.PhoneQr)
                {
                    CreateInvite(context, InviteKind.PhoneQr, AuditActors.System);
                }

                return new DeviceCredentialsDto(device.Id, secret, productionId);
            },
            cancellationToken);
    }

    /// <summary>Removes knocks that expired while pending (1 s maintenance tick).</summary>
    public async Task ExpireRequestsAsync(CancellationToken cancellationToken)
    {
        foreach (var group in requests.RemoveExpired(clock.GetUtcNow()).GroupBy(r => r.ProductionId, StringComparer.Ordinal))
        {
            await coordinator.ExecuteAsync(
                group.Key,
                context =>
                {
                    foreach (var request in group)
                    {
                        context.Emit(revision => new PairingRequestRemovedEvent(revision, request.Id, PairingRequestStatus.Expired));
                    }

                    return Task.CompletedTask;
                },
                cancellationToken);
        }
    }

    /// <summary>
    /// Removes expired invites, renews phone invites before they expire (so the Regie always shows a valid code) and
    /// deletes old invite rows (10 s maintenance tick).
    /// </summary>
    public async Task MaintainInvitesAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<string> due;
        await using (var unit = data.Create())
        {
            due = await unit.Invites.ListProductionsWithDueInvitesAsync(clock.GetUtcNow(), pairing.PhoneInviteRenewalLead, cancellationToken);
            await unit.Invites.DeleteExpiredAsync(clock.GetUtcNow() - TimeSpan.FromDays(1), cancellationToken);
        }

        foreach (var productionId in due)
        {
            await coordinator.ExecuteAsync(productionId, context => MaintainInvitesAsync(context, cancellationToken), cancellationToken);
        }
    }

    private static string ValidateRedeem(RedeemInviteRequest request)
    {
        var errors = new ValidationErrors();
        var clientId = request.ClientId;
        if (string.IsNullOrEmpty(clientId) || clientId.Length > ClientIdMax || clientId.Any(c => c is <= ' ' or > '~'))
        {
            errors.Add("clientId", "Invalid client ID.");
        }

        if (!Enum.IsDefined(request.Kind))
        {
            errors.Add("kind", "Unknown device type.");
        }

        // A name that is empty after cleaning falls back to the default name (“Phone n”, UNIT-PAIR-06).
        if (TextRules.Truncate(request.Name, int.MaxValue) is not null)
        {
            TextRules.RequiredName(request.Name, TextRules.DeviceNameMax, "name", errors);
        }

        errors.ThrowIfAny();
        return clientId;
    }

    private static void Paired(MutationContext context, Device device, string actor)
    {
        DeviceEvents.EmitDevice(context, device);
        foreach (var slot in device.Slots)
        {
            SourceMonitor.Introduce(context, device, slot);
        }

        context.Audit(actor, AuditActions.DevicePaired, MutationContextExtensions.DeviceDetails(device));
    }

    private static void RemoveInvite(MutationContext context, Invite invite, string actor)
    {
        context.Emit(revision => new InviteRemovedEvent(revision, invite.Id));
        context.Audit(actor, AuditActions.InviteRevoked, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Kind] = invite.Kind.ToString() });
    }

    private PairingRequest FindRequest(string productionId, string requestId)
    {
        var request = requests.Find(requestId);
        return request is not null && string.Equals(request.ProductionId, productionId, StringComparison.Ordinal)
            ? request
            : throw StudioFlowException.NotFound("Request");
    }

    private InviteDto CreateInvite(MutationContext context, InviteKind kind, string actor)
    {
        var invite = Invite.Create(context.ProductionId, kind, context.Now, pairing.InviteTtl);
        context.Data.Invites.Add(invite);
        var dto = Dtos.Invite(invite, options.BaseUrl);
        context.Emit(revision => new InviteUpsertedEvent(revision, dto));
        context.Audit(actor, AuditActions.InviteCreated, new Dictionary<string, string>(StringComparer.Ordinal) { [AuditDetails.Kind] = kind.ToString() });
        return dto;
    }

    private async Task<InviteDto> RenewPhoneInviteAsync(MutationContext context, CancellationToken cancellationToken)
    {
        foreach (var open in (await context.Data.Invites.ListOpenAsync(context.ProductionId, context.Now, cancellationToken)).Where(i => i.Kind == InviteKind.PhoneQr))
        {
            open.Revoke(context.Now);
            RemoveInvite(context, open, AuditActors.Admin);
        }

        return CreateInvite(context, InviteKind.PhoneQr, AuditActors.Admin);
    }

    private async Task MaintainInvitesAsync(MutationContext context, CancellationToken cancellationToken)
    {
        var renewPhone = false;
        foreach (var invite in await context.Data.Invites.ListUnusedAsync(context.ProductionId, cancellationToken))
        {
            if (!invite.IsOpen(context.Now))
            {
                // Expired without being used: the Regie forgets it and the row is not needed any more.
                context.Data.Invites.Remove(invite);
                context.Emit(revision => new InviteRemovedEvent(revision, invite.Id));
                renewPhone |= invite.Kind == InviteKind.PhoneQr;
            }
            else if (invite.NeedsRenewal(context.Now, pairing.PhoneInviteRenewalLead))
            {
                invite.Revoke(context.Now);
                RemoveInvite(context, invite, AuditActors.System);
                renewPhone = true;
            }
        }

        if (renewPhone && !(await context.Data.Invites.ListOpenAsync(context.ProductionId, context.Now, cancellationToken)).Any(i => i.Kind == InviteKind.PhoneQr && !i.NeedsRenewal(context.Now, pairing.PhoneInviteRenewalLead)))
        {
            CreateInvite(context, InviteKind.PhoneQr, AuditActors.System);
        }
    }
}
