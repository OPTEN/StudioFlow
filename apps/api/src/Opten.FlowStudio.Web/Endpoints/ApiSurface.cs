using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Web.Security;

namespace Opten.FlowStudio.Web.Endpoints;

/// <summary>
/// The complete REST surface of FlowStudio. This file is the contract: routes, operation names, request and response
/// types. It is the input for the generated TypeScript types (packages/scene-model/src/generated/api.ts). The handlers
/// live in the feature classes next to this file and only delegate to the application services.
/// </summary>
internal static class ApiSurface
{
    /// <summary>Rate limit of anonymous knocks (<c>Pairing:Limits:RequestsPerIpPer10Min</c>, default 10 per IP per 10 minutes; 429).</summary>
    public const string PairingRequestsLimit = "pairing-requests";

    /// <summary>Rate limit of invite redemptions (<c>Pairing:Limits:RedeemPerIpPer10Min</c>, default 20 per IP per 10 minutes; 429).</summary>
    public const string RedeemLimit = "pairing-redeem";

    /// <summary>Maps every API route.</summary>
    public static IEndpointRouteBuilder MapFlowStudioApi(this IEndpointRouteBuilder app)
    {
        MapAuth(app.MapGroup("/api/auth").WithTags("Auth"));
        MapSystem(app.MapGroup("/api/system").WithTags("System"));
        MapProductions(Admin(app.MapGroup("/api/productions").WithTags("Productions")));
        MapScenes(Admin(app.MapGroup("/api/productions/{productionId}/scenes").WithTags("Scenes")));
        MapDevices(Admin(app.MapGroup("/api/productions/{productionId}/devices").WithTags("Devices")));
        MapPairingAdmin(Admin(app.MapGroup("/api/productions/{productionId}/pairing").WithTags("Pairing")));
        MapAssets(Admin(app.MapGroup("/api/productions/{productionId}/assets").WithTags("Assets")));
        MapOutputAdmin(Admin(app.MapGroup("/api/productions/{productionId}/output").WithTags("Output")));
        MapPairingPublic(app.MapGroup("/api/pairing").WithTags("Pairing (public)"));
        MapDevice(app.MapGroup("/api/device").WithTags("Device (sender)").RequireAuthorization(Policies.Device));
        MapOutputPublic(app.MapGroup("/api/output/{slug}").WithTags("Output (public)"));
        app.MapPost("/api/livekit/webhook", LiveKitEndpoints.ReceiveWebhookAsync).WithName("receiveLiveKitWebhook").WithTags("LiveKit")
            .Accepts<object>("application/webhook+json").Produces(200)
            .WithMetadata(new RequestBodyLimit(Infrastructure.LiveKit.LiveKitWebhookReceiver.MaxBodyBytes));
        return app;
    }

    private static RouteGroupBuilder Admin(RouteGroupBuilder group) =>
        group.RequireAuthorization(Policies.Admin).AddEndpointFilter<CsrfHeaderFilter>();

    private static void MapAuth(RouteGroupBuilder g)
    {
        g.MapPost("/login", AuthEndpoints.LoginAsync).WithName("login")
            .Produces<SessionDto>().ProducesProblem(401).ProducesProblem(429);
        g.MapPost("/logout", (Delegate)AuthEndpoints.LogoutAsync).WithName("logout").Produces(204).ProducesProblem(401).ProducesProblem(403)
            .RequireAuthorization(Policies.Admin).AddEndpointFilter<CsrfHeaderFilter>();
        g.MapGet("/me", AuthEndpoints.GetSession).WithName("getSession").Produces<SessionDto>().ProducesProblem(401)
            .RequireAuthorization(Policies.Admin);
    }

    private static void MapSystem(RouteGroupBuilder g)
    {
        g.MapGet("/info", SystemEndpoints.GetInfo).WithName("getSystemInfo").Produces<SystemInfoDto>().ProducesProblem(401)
            .RequireAuthorization(Policies.Admin);
    }

    private static void MapProductions(RouteGroupBuilder g)
    {
        g.MapGet("/", ProductionEndpoints.ListAsync).WithName("listProductions").Produces<IReadOnlyList<ProductionSummaryDto>>();
        g.MapPost("/", ProductionEndpoints.CreateAsync).WithName("createProduction")
            .Produces<ProductionDto>(201).ProducesValidationProblem();
        g.MapGet("/active", ProductionEndpoints.GetActiveAsync).WithName("getActiveProduction").Produces<ProductionSummaryDto>().ProducesProblem(404);
        g.MapGet("/{productionId}/snapshot", ProductionEndpoints.GetSnapshotAsync).WithName("getSnapshot")
            .Produces<ProductionSnapshot>().ProducesProblem(404);
        g.MapGet("/{productionId}/changes", ProductionEndpoints.GetChangesAsync).WithName("getChanges")
            .Produces<ProductionChangesDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapPatch("/{productionId}", ProductionEndpoints.UpdateAsync)
            .WithName("updateProduction").Produces<ProductionDto>().ProducesValidationProblem();
        g.MapPost("/{productionId}/activate", ProductionEndpoints.ActivateAsync).WithName("activateProduction").Produces<ProductionDto>();
        g.MapPost("/{productionId}/broadcast/start", ProductionEndpoints.StartBroadcastAsync).WithName("startBroadcast").Produces<ProductionDto>();
        g.MapPost("/{productionId}/broadcast/end", ProductionEndpoints.EndBroadcastAsync).WithName("endBroadcast").Produces<ProductionDto>();
        g.MapPost("/{productionId}/broadcast/reset", ProductionEndpoints.ResetBroadcastAsync).WithName("resetBroadcast").Produces<ProductionDto>();
        g.MapPut("/{productionId}/preview", ProductionEndpoints.SetPreviewAsync)
            .WithName("setPreview").Produces<ProductionDto>().ProducesProblem(404);
        g.MapPost("/{productionId}/program", ProductionEndpoints.SwitchProgramAsync)
            .WithName("switchProgram").Produces<ProductionDto>().ProducesProblem(404).ProducesProblem(409);
        g.MapPost("/{productionId}/take", ProductionEndpoints.TakeAsync)
            .WithName("take").Produces<ProductionDto>().ProducesProblem(409);
        g.MapPost("/{productionId}/incidents/{incidentId}/ack", ProductionEndpoints.AcknowledgeIncidentAsync)
            .WithName("acknowledgeIncident").Produces(204).ProducesProblem(404).ProducesProblem(409);
        g.MapPost("/{productionId}/livekit-token", ProductionEndpoints.IssueLiveKitTokenAsync).WithName("getStudioLiveKitToken")
            .Produces<LiveKitTokenDto>();
        g.MapGet("/{productionId}/telemetry", ProductionEndpoints.GetTelemetryAsync).WithName("getTelemetry")
            .Produces<IReadOnlyList<DeviceTelemetryMessage>>();
    }

    private static void MapScenes(RouteGroupBuilder g)
    {
        g.MapPost("/", SceneEndpoints.CreateAsync).WithName("createScene")
            .Produces<SceneDto>(201).ProducesValidationProblem().ProducesProblem(409);
        g.MapPatch("/{sceneId}", SceneEndpoints.UpdateAsync)
            .WithName("updateScene").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapDelete("/{sceneId}", SceneEndpoints.DeleteAsync).WithName("deleteScene")
            .Produces(204).ProducesProblem(404).ProducesProblem(409);
        g.MapPut("/order", SceneEndpoints.ReorderAsync).WithName("reorderScenes")
            .Produces(204).ProducesValidationProblem();
        g.MapPost("/{sceneId}/items", SceneEndpoints.AddItemAsync)
            .WithName("addSceneItem").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404).ProducesProblem(409);
        g.MapPut("/{sceneId}/items/{itemId}", SceneEndpoints.UpdateItemAsync)
            .WithName("updateSceneItem").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapDelete("/{sceneId}/items/{itemId}", SceneEndpoints.RemoveItemAsync)
            .WithName("removeSceneItem").Produces<SceneDto>().ProducesProblem(404);
        g.MapPut("/{sceneId}/items", SceneEndpoints.ReplaceItemsAsync)
            .WithName("replaceSceneItems").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404).ProducesProblem(409);
    }

    private static void MapDevices(RouteGroupBuilder g)
    {
        g.MapPatch("/{deviceId}", DeviceAdminEndpoints.RenameAsync)
            .WithName("renameDevice").Produces<DeviceDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapPost("/{deviceId}/block", DeviceAdminEndpoints.BlockAsync).WithName("blockDevice")
            .Produces<DeviceDto>().ProducesProblem(404);
        g.MapPost("/{deviceId}/unblock", DeviceAdminEndpoints.UnblockAsync).WithName("unblockDevice")
            .Produces<DeviceDto>().ProducesProblem(404);
        g.MapDelete("/{deviceId}", DeviceAdminEndpoints.DeleteAsync).WithName("deleteDevice")
            .Produces(204).ProducesProblem(404);
        g.MapPost("/{deviceId}/commands", DeviceAdminEndpoints.SendCommandAsync)
            .WithName("sendDeviceCommand").Produces<DeviceCommandDto>(202).ProducesValidationProblem().ProducesProblem(404);
    }

    private static void MapPairingAdmin(RouteGroupBuilder g)
    {
        g.MapGet("/phone-invite", PairingEndpoints.GetPhoneInviteAsync).WithName("getPhoneInvite").Produces<InviteDto>();
        g.MapPost("/phone-invite/renew", PairingEndpoints.RenewPhoneInviteAsync).WithName("renewPhoneInvite").Produces<InviteDto>();
        g.MapPost("/invites", PairingEndpoints.CreateInviteAsync).WithName("createInvite")
            .Produces<InviteDto>(201);
        g.MapDelete("/invites/{inviteId}", PairingEndpoints.RevokeInviteAsync).WithName("revokeInvite")
            .Produces(204).ProducesProblem(404);
        g.MapPost("/requests/{requestId}/approve", PairingEndpoints.ApproveAsync)
            .WithName("approvePairingRequest").Produces<DeviceDto>().ProducesProblem(404).ProducesProblem(410);
        g.MapPost("/requests/{requestId}/deny", PairingEndpoints.DenyAsync)
            .WithName("denyPairingRequest").Produces(204).ProducesProblem(404);
    }

    private static void MapAssets(RouteGroupBuilder g)
    {
        g.MapGet("/", AssetEndpoints.ListAsync).WithName("listAssets").Produces<IReadOnlyList<AssetDto>>();
        g.MapPost("/", AssetEndpoints.UploadAsync).WithName("uploadAsset").DisableAntiforgery()
            .Produces<AssetDto>(201).ProducesProblem(413).ProducesProblem(415)
            .WithMetadata(RequestBodyLimit.Upload).WithFormOptions(multipartBodyLengthLimit: long.MaxValue);
        g.MapPatch("/{assetId}", AssetEndpoints.RenameAsync)
            .WithName("renameAsset").Produces<AssetDto>().ProducesProblem(404);
        g.MapDelete("/{assetId}", AssetEndpoints.DeleteAsync).WithName("deleteAsset")
            .Produces(204).ProducesProblem(404).ProducesProblem(409);
        g.MapGet("/{assetId}/content", AssetEndpoints.GetContentAsync)
            .WithName("getAssetContent").Produces(200, contentType: "application/octet-stream").ProducesProblem(401).ProducesProblem(403).ProducesProblem(404)
            .AllowAnonymous();
    }

    private static void MapOutputAdmin(RouteGroupBuilder g)
    {
        g.MapGet("/", OutputEndpoints.GetSettingsAsync).WithName("getOutputSettings").Produces<OutputSettingsDto>();
        g.MapPut("/access", OutputEndpoints.UpdateAccessAsync)
            .WithName("updateOutputAccess").Produces<OutputSettingsDto>().ProducesValidationProblem();
        g.MapPost("/regenerate-key", OutputEndpoints.RegenerateKeyAsync).WithName("regenerateOutputKey")
            .Produces<OutputSettingsDto>();
    }

    private static void MapPairingPublic(RouteGroupBuilder g)
    {
        g.MapPost("/requests", PairingEndpoints.CreateRequestAsync).WithName("createPairingRequest")
            .Produces<PairingRequestCreatedDto>(201).ProducesValidationProblem().ProducesProblem(429)
            .RequireRateLimiting(PairingRequestsLimit);
        g.MapGet("/requests/{requestId}", PairingEndpoints.GetRequestStatus)
            .WithName("getPairingRequestStatus").Produces<PairingRequestStatusDto>();
        g.MapDelete("/requests/{requestId}", PairingEndpoints.CancelRequestAsync)
            .WithName("cancelPairingRequest").Produces(204);
        g.MapPost("/invites/{token}/redeem", PairingEndpoints.RedeemAsync)
            .WithName("redeemInvite").Produces<DeviceCredentialsDto>().ProducesValidationProblem().ProducesProblem(410).ProducesProblem(429)
            .RequireRateLimiting(RedeemLimit);
    }

    private static void MapDevice(RouteGroupBuilder g)
    {
        g.MapGet("/me", DeviceEndpoints.GetSelfAsync).WithName("getDeviceSelf").Produces<DeviceSelfDto>().ProducesProblem(401).ProducesProblem(403);
        g.MapGet("/session", DeviceEndpoints.GetSessionAsync).WithName("getDeviceSession").Produces<DeviceSessionDto>();
        g.MapPost("/livekit-token", DeviceEndpoints.IssueLiveKitTokenAsync).WithName("getDeviceLiveKitToken").Produces<LiveKitTokenDto>().ProducesProblem(403);
        g.MapPost("/slots", DeviceEndpoints.AllocateSlotAsync).WithName("allocateSlot")
            .Produces<DeviceSlotDto>().ProducesValidationProblem().ProducesProblem(409);
        g.MapDelete("/slots/{slot}", DeviceEndpoints.ReleaseSlotAsync).WithName("releaseSlot").Produces(204).ProducesProblem(404).ProducesProblem(409);
        g.MapPost("/report", DeviceEndpoints.ReportAsync).WithName("reportDeviceStatus").Produces(204);
        g.MapPost("/bandwidth-test", DeviceEndpoints.BandwidthTestAsync).WithName("bandwidthTest").Accepts<byte[]>("application/octet-stream")
            .Produces<BandwidthTestResultDto>().ProducesProblem(413)
            .WithMetadata(new RequestBodyLimit(DeviceEndpoints.BandwidthTestMaxBytes));
        g.MapPost("/unpair", DeviceEndpoints.UnpairAsync).WithName("unpairDevice").Produces(204);
    }

    private static void MapOutputPublic(RouteGroupBuilder g)
    {
        g.MapGet("/snapshot", OutputEndpoints.GetSnapshotAsync).WithName("getOutputSnapshot")
            .Produces<OutputSnapshot>().ProducesProblem(403);
        g.MapGet("/changes", OutputEndpoints.GetChangesAsync).WithName("getOutputChanges")
            .Produces<OutputChangesDto>().ProducesValidationProblem().ProducesProblem(403);
        g.MapPost("/livekit-token", OutputEndpoints.IssueLiveKitTokenAsync)
            .WithName("getOutputLiveKitToken").Produces<LiveKitTokenDto>().ProducesProblem(403);
        g.MapPost("/report", OutputEndpoints.ReportAsync)
            .WithName("reportOutputStatus").Produces(204).ProducesProblem(403);
    }
}
