using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Web.Endpoints;

/// <summary>
/// The complete REST surface of FlowStudio. This file is the contract: routes, operation names, request and response
/// types. It is the input for the generated TypeScript types (packages/scene-model/src/generated/api.ts).
/// Handlers marked with <see cref="NotImplemented"/> are placeholders and must be replaced by real implementations
/// without changing route, verb, name, request or response types.
/// </summary>
internal static class ApiSurface
{
    /// <summary>Maps every API route.</summary>
    public static IEndpointRouteBuilder MapFlowStudioApi(this IEndpointRouteBuilder app)
    {
        MapAuth(app.MapGroup("/api/auth").WithTags("Auth"));
        MapSystem(app.MapGroup("/api/system").WithTags("System"));
        MapProductions(app.MapGroup("/api/productions").WithTags("Productions"));
        MapScenes(app.MapGroup("/api/productions/{productionId}/scenes").WithTags("Scenes"));
        MapDevices(app.MapGroup("/api/productions/{productionId}/devices").WithTags("Devices"));
        MapPairingAdmin(app.MapGroup("/api/productions/{productionId}/pairing").WithTags("Pairing"));
        MapAssets(app.MapGroup("/api/productions/{productionId}/assets").WithTags("Assets"));
        MapOutputAdmin(app.MapGroup("/api/productions/{productionId}/output").WithTags("Output"));
        MapPairingPublic(app.MapGroup("/api/pairing").WithTags("Pairing (public)"));
        MapDevice(app.MapGroup("/api/device").WithTags("Device (sender)"));
        MapOutputPublic(app.MapGroup("/api/output/{slug}").WithTags("Output (public)"));
        app.MapPost("/api/livekit/webhook", NotImplemented).WithName("receiveLiveKitWebhook").WithTags("LiveKit")
            .Accepts<object>("application/webhook+json").Produces(200);
        return app;
    }

    private static void MapAuth(RouteGroupBuilder g)
    {
        g.MapPost("/login", ([FromBody] LoginRequest body) => NotImplemented()).WithName("login")
            .Produces<SessionDto>().ProducesProblem(401).ProducesProblem(429);
        g.MapPost("/logout", NotImplemented).WithName("logout").Produces(204);
        g.MapGet("/me", NotImplemented).WithName("getSession").Produces<SessionDto>().ProducesProblem(401);
    }

    private static void MapSystem(RouteGroupBuilder g)
    {
        g.MapGet("/info", NotImplemented).WithName("getSystemInfo").Produces<SystemInfoDto>();
    }

    private static void MapProductions(RouteGroupBuilder g)
    {
        g.MapGet("/", NotImplemented).WithName("listProductions").Produces<IReadOnlyList<ProductionSummaryDto>>();
        g.MapPost("/", ([FromBody] CreateProductionRequest body) => NotImplemented()).WithName("createProduction")
            .Produces<ProductionDto>(201).ProducesValidationProblem();
        g.MapGet("/active", NotImplemented).WithName("getActiveProduction").Produces<ProductionSummaryDto>().ProducesProblem(404);
        g.MapGet("/{productionId}/snapshot", (string productionId) => NotImplemented()).WithName("getSnapshot")
            .Produces<ProductionSnapshot>().ProducesProblem(404);
        g.MapGet("/{productionId}/changes", (string productionId, [FromQuery] long since) => NotImplemented()).WithName("getChanges")
            .Produces<ProductionChangesDto>().ProducesProblem(404);
        g.MapPatch("/{productionId}", (string productionId, [FromBody] UpdateProductionRequest body) => NotImplemented())
            .WithName("updateProduction").Produces<ProductionDto>().ProducesValidationProblem();
        g.MapPost("/{productionId}/activate", (string productionId) => NotImplemented()).WithName("activateProduction").Produces<ProductionDto>();
        g.MapPost("/{productionId}/broadcast/start", (string productionId) => NotImplemented()).WithName("startBroadcast").Produces<ProductionDto>();
        g.MapPost("/{productionId}/broadcast/end", (string productionId) => NotImplemented()).WithName("endBroadcast").Produces<ProductionDto>();
        g.MapPost("/{productionId}/broadcast/reset", (string productionId) => NotImplemented()).WithName("resetBroadcast").Produces<ProductionDto>();
        g.MapPut("/{productionId}/preview", (string productionId, [FromBody] SetPreviewRequest body) => NotImplemented())
            .WithName("setPreview").Produces<ProductionDto>().ProducesProblem(404);
        g.MapPost("/{productionId}/program", (string productionId, [FromBody] SwitchProgramRequest body) => NotImplemented())
            .WithName("switchProgram").Produces<ProductionDto>().ProducesProblem(404).ProducesProblem(409);
        g.MapPost("/{productionId}/take", (string productionId, [FromBody] TakeRequest body) => NotImplemented())
            .WithName("take").Produces<ProductionDto>().ProducesProblem(409);
        g.MapPost("/{productionId}/incidents/{incidentId}/ack", (string productionId, string incidentId) => NotImplemented())
            .WithName("acknowledgeIncident").Produces(204).ProducesProblem(404);
        g.MapPost("/{productionId}/livekit-token", (string productionId) => NotImplemented()).WithName("getStudioLiveKitToken")
            .Produces<LiveKitTokenDto>();
        g.MapGet("/{productionId}/telemetry", (string productionId) => NotImplemented()).WithName("getTelemetry")
            .Produces<IReadOnlyList<DeviceTelemetryMessage>>();
    }

    private static void MapScenes(RouteGroupBuilder g)
    {
        g.MapPost("/", (string productionId, [FromBody] CreateSceneRequest body) => NotImplemented()).WithName("createScene")
            .Produces<SceneDto>(201).ProducesValidationProblem().ProducesProblem(409);
        g.MapPatch("/{sceneId}", (string productionId, string sceneId, [FromBody] UpdateSceneRequest body) => NotImplemented())
            .WithName("updateScene").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapDelete("/{sceneId}", (string productionId, string sceneId) => NotImplemented()).WithName("deleteScene")
            .Produces(204).ProducesProblem(404).ProducesProblem(409);
        g.MapPut("/order", (string productionId, [FromBody] ReorderScenesRequest body) => NotImplemented()).WithName("reorderScenes")
            .Produces(204).ProducesValidationProblem();
        g.MapPost("/{sceneId}/items", (string productionId, string sceneId, [FromBody] AddSceneItemRequest body) => NotImplemented())
            .WithName("addSceneItem").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapPut("/{sceneId}/items/{itemId}", (string productionId, string sceneId, string itemId, [FromBody] SceneItemDto body) => NotImplemented())
            .WithName("updateSceneItem").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapDelete("/{sceneId}/items/{itemId}", (string productionId, string sceneId, string itemId) => NotImplemented())
            .WithName("removeSceneItem").Produces<SceneDto>().ProducesProblem(404);
        g.MapPut("/{sceneId}/items", (string productionId, string sceneId, [FromBody] ReplaceSceneItemsRequest body) => NotImplemented())
            .WithName("replaceSceneItems").Produces<SceneDto>().ProducesValidationProblem().ProducesProblem(404);
    }

    private static void MapDevices(RouteGroupBuilder g)
    {
        g.MapPatch("/{deviceId}", (string productionId, string deviceId, [FromBody] RenameDeviceRequest body) => NotImplemented())
            .WithName("renameDevice").Produces<DeviceDto>().ProducesValidationProblem().ProducesProblem(404);
        g.MapPost("/{deviceId}/block", (string productionId, string deviceId) => NotImplemented()).WithName("blockDevice")
            .Produces<DeviceDto>().ProducesProblem(404);
        g.MapPost("/{deviceId}/unblock", (string productionId, string deviceId) => NotImplemented()).WithName("unblockDevice")
            .Produces<DeviceDto>().ProducesProblem(404);
        g.MapDelete("/{deviceId}", (string productionId, string deviceId) => NotImplemented()).WithName("deleteDevice")
            .Produces(204).ProducesProblem(404);
        g.MapPost("/{deviceId}/commands", (string productionId, string deviceId, [FromBody] DeviceCommandRequest body) => NotImplemented())
            .WithName("sendDeviceCommand").Produces<DeviceCommandDto>(202).ProducesValidationProblem().ProducesProblem(404);
    }

    private static void MapPairingAdmin(RouteGroupBuilder g)
    {
        g.MapGet("/phone-invite", (string productionId) => NotImplemented()).WithName("getPhoneInvite").Produces<InviteDto>();
        g.MapPost("/phone-invite/renew", (string productionId) => NotImplemented()).WithName("renewPhoneInvite").Produces<InviteDto>();
        g.MapPost("/invites", (string productionId, [FromBody] CreateInviteRequest body) => NotImplemented()).WithName("createInvite")
            .Produces<InviteDto>(201);
        g.MapDelete("/invites/{inviteId}", (string productionId, string inviteId) => NotImplemented()).WithName("revokeInvite")
            .Produces(204).ProducesProblem(404);
        g.MapPost("/requests/{requestId}/approve", (string productionId, string requestId) => NotImplemented())
            .WithName("approvePairingRequest").Produces<DeviceDto>().ProducesProblem(404).ProducesProblem(410);
        g.MapPost("/requests/{requestId}/deny", (string productionId, string requestId) => NotImplemented())
            .WithName("denyPairingRequest").Produces(204).ProducesProblem(404);
    }

    private static void MapAssets(RouteGroupBuilder g)
    {
        g.MapGet("/", (string productionId) => NotImplemented()).WithName("listAssets").Produces<IReadOnlyList<AssetDto>>();
        g.MapPost("/", (string productionId, IFormFile file) => NotImplemented()).WithName("uploadAsset").DisableAntiforgery()
            .Produces<AssetDto>(201).ProducesProblem(413).ProducesProblem(415);
        g.MapPatch("/{assetId}", (string productionId, string assetId, [FromBody] RenameAssetRequest body) => NotImplemented())
            .WithName("renameAsset").Produces<AssetDto>().ProducesProblem(404);
        g.MapDelete("/{assetId}", (string productionId, string assetId) => NotImplemented()).WithName("deleteAsset")
            .Produces(204).ProducesProblem(404).ProducesProblem(409);
        g.MapGet("/{assetId}/content", (string productionId, string assetId, [FromQuery] string? k) => NotImplemented())
            .WithName("getAssetContent").Produces(200, contentType: "application/octet-stream").ProducesProblem(404);
    }

    private static void MapOutputAdmin(RouteGroupBuilder g)
    {
        g.MapGet("/", (string productionId) => NotImplemented()).WithName("getOutputSettings").Produces<OutputSettingsDto>();
        g.MapPut("/access", (string productionId, [FromBody] UpdateOutputAccessRequest body) => NotImplemented())
            .WithName("updateOutputAccess").Produces<OutputSettingsDto>().ProducesValidationProblem();
        g.MapPost("/regenerate-key", (string productionId) => NotImplemented()).WithName("regenerateOutputKey")
            .Produces<OutputSettingsDto>();
    }

    private static void MapPairingPublic(RouteGroupBuilder g)
    {
        g.MapPost("/requests", ([FromBody] CreatePairingRequest body) => NotImplemented()).WithName("createPairingRequest")
            .Produces<PairingRequestCreatedDto>(201).ProducesValidationProblem().ProducesProblem(429);
        g.MapGet("/requests/{requestId}", (string requestId, [FromHeader(Name = "X-Pairing-Token")] string pollToken) => NotImplemented())
            .WithName("getPairingRequestStatus").Produces<PairingRequestStatusDto>();
        g.MapDelete("/requests/{requestId}", (string requestId, [FromHeader(Name = "X-Pairing-Token")] string pollToken) => NotImplemented())
            .WithName("cancelPairingRequest").Produces(204);
        g.MapPost("/invites/{token}/redeem", (string token, [FromBody] RedeemInviteRequest body) => NotImplemented())
            .WithName("redeemInvite").Produces<DeviceCredentialsDto>().ProducesValidationProblem().ProducesProblem(410).ProducesProblem(429);
    }

    private static void MapDevice(RouteGroupBuilder g)
    {
        g.MapGet("/me", NotImplemented).WithName("getDeviceSelf").Produces<DeviceSelfDto>().ProducesProblem(401).ProducesProblem(403);
        g.MapGet("/session", NotImplemented).WithName("getDeviceSession").Produces<DeviceSessionDto>();
        g.MapPost("/livekit-token", NotImplemented).WithName("getDeviceLiveKitToken").Produces<LiveKitTokenDto>().ProducesProblem(403);
        g.MapPost("/slots", ([FromBody] AllocateSlotRequest body) => NotImplemented()).WithName("allocateSlot")
            .Produces<DeviceSlotDto>().ProducesValidationProblem().ProducesProblem(409);
        g.MapDelete("/slots/{slot}", (string slot) => NotImplemented()).WithName("releaseSlot").Produces(204);
        g.MapPost("/report", ([FromBody] DeviceReportDto body) => NotImplemented()).WithName("reportDeviceStatus").Produces(204);
        g.MapPost("/bandwidth-test", NotImplemented).WithName("bandwidthTest").Accepts<byte[]>("application/octet-stream")
            .Produces<BandwidthTestResultDto>().ProducesProblem(413);
        g.MapPost("/unpair", NotImplemented).WithName("unpairDevice").Produces(204);
    }

    private static void MapOutputPublic(RouteGroupBuilder g)
    {
        g.MapGet("/snapshot", (string slug, [FromHeader(Name = "X-Output-Key")] string key) => NotImplemented()).WithName("getOutputSnapshot")
            .Produces<OutputSnapshot>().ProducesProblem(403).ProducesProblem(404);
        g.MapPost("/livekit-token", (string slug, [FromHeader(Name = "X-Output-Key")] string key) => NotImplemented())
            .WithName("getOutputLiveKitToken").Produces<LiveKitTokenDto>().ProducesProblem(403);
        g.MapPost("/report", (string slug, [FromHeader(Name = "X-Output-Key")] string key, [FromBody] OutputReport body) => NotImplemented())
            .WithName("reportOutputStatus").Produces(204);
    }

    /// <summary>Placeholder result for routes that are not implemented yet.</summary>
    private static ProblemHttpResult NotImplemented() => TypedResults.Problem(statusCode: StatusCodes.Status501NotImplemented, title: "Not implemented");
}
