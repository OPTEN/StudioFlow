using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Infrastructure.Security;
using Opten.StudioFlow.Web.Errors;
using Opten.StudioFlow.Web.Hosting;
using Opten.StudioFlow.Web.Security;

namespace Opten.StudioFlow.Web.Endpoints;

/// <summary>Regie session: first-run setup, login with lockout, logout, current session, password change.</summary>
internal static class AuthEndpoints
{
    public static async Task<IResult> LoginAsync([FromBody] LoginRequest body, AdminLoginService logins, HttpContext context)
    {
        var result = await logins.LoginAsync(body.Username, body.Password, ClientAddress.Of(context));
        switch (result.Outcome)
        {
            case LoginOutcome.Succeeded:
                await SignInAsync(context, result.Identity!);
                return TypedResults.Ok(new SessionDto(result.Identity!.Username));
            case LoginOutcome.Locked:
                var seconds = Math.Max(1, (int)Math.Ceiling(result.RetryAfter!.Value.TotalSeconds));
                context.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
                return Problems.Result(StatusCodes.Status429TooManyRequests, ErrorCodes.RateLimited, LockoutDetail(seconds));
            default:
                return Problems.Result(StatusCodes.Status401Unauthorized, ErrorCodes.Unauthorized, "Username or password is incorrect.");
        }
    }

    public static IResult GetSetupStatus(AdminAccountState account) => TypedResults.Ok(new SetupStatusDto(account.SetupRequired));

    // The account is created and the new admin is signed in at once.
    public static async Task<IResult> SetUpAsync([FromBody] SetupRequest body, AdminAccountService accounts, HttpContext context, CancellationToken cancellationToken)
    {
        var identity = await accounts.SetUpAsync(body, ClientAddress.Of(context), cancellationToken);
        await SignInAsync(context, identity);
        return TypedResults.Ok(new SessionDto(identity.Username));
    }

    // Every other session ends: the new stamp is only in this session's renewed cookie, and the other sessions' hub
    // connections are closed.
    public static async Task<IResult> ChangePasswordAsync([FromBody] ChangePasswordRequest body, AdminAccountService accounts, AdminSessions sessions, HttpContext context, CancellationToken cancellationToken)
    {
        var identity = await accounts.ChangePasswordAsync(context.User.Identity!.Name!, body, ClientAddress.Of(context), cancellationToken);
        var sessionId = context.User.FindFirstValue(StudioFlowClaims.SessionId);
        await SignInAsync(context, identity, sessionId);
        sessions.EndAllExcept(sessionId);
        return TypedResults.NoContent();
    }

    private static Task SignInAsync(HttpContext context, AdminIdentity identity, string? sessionId = null) =>
        context.SignInAsync(AuthSchemes.Admin, AdminSessions.Principal(identity, sessionId), new AuthenticationProperties { IsPersistent = true });

    /// <summary>Detail of the answer to a locked login: the wait rounded up to whole minutes.</summary>
    internal static string LockoutDetail(int seconds)
    {
        var minutes = (int)Math.Ceiling(seconds / 60d);
        return $"Too many failed attempts. Please try again in {minutes.ToString(CultureInfo.InvariantCulture)} {(minutes == 1 ? "minute" : "minutes")}.";
    }

    // Ends the session on the server too (GAP-04): the cookie is refused from now on and the Regie hub connections of
    // this session are closed.
    public static async Task<IResult> LogoutAsync(HttpContext context, AdminSessions sessions, AdminLoginService logins, TimeProvider clock, IOptions<AdminOptions> admin)
    {
        if (context.User.FindFirstValue(StudioFlowClaims.SessionId) is { Length: > 0 } sessionId)
        {
            // No copy of the cookie (sliding renewals included) can be valid longer than one lifetime from now.
            sessions.Revoke(sessionId, clock.GetUtcNow() + admin.Value.SessionLifetime);
        }

        await context.SignOutAsync(AuthSchemes.Admin);
        await logins.LogoutAsync(context.User.Identity?.Name ?? string.Empty, ClientAddress.Of(context));
        return TypedResults.NoContent();
    }

    public static IResult GetSession(ClaimsPrincipal user) => TypedResults.Ok(new SessionDto(user.Identity?.Name ?? string.Empty));
}

/// <summary>Static installation data.</summary>
internal static class SystemEndpoints
{
    public static IResult GetInfo(StudioFlowOptions options) =>
        TypedResults.Ok(new SystemInfoDto(AppVersion.Current, options.BaseUrl, 1920, 1080));
}

/// <summary>Productions, broadcast, switching, incidents.</summary>
internal static class ProductionEndpoints
{
    public static async Task<IResult> ListAsync(ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.ListAsync(cancellationToken));

    public static async Task<IResult> CreateAsync([FromBody] CreateProductionRequest body, ProductionService productions, CancellationToken cancellationToken)
    {
        var created = await productions.CreateAsync(body, cancellationToken);
        return TypedResults.Created($"/api/productions/{created.Id}", created);
    }

    public static async Task<IResult> GetActiveAsync(ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.GetActiveAsync(cancellationToken));

    public static async Task<IResult> GetSnapshotAsync(string productionId, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.GetSnapshotAsync(productionId, cancellationToken));

    public static async Task<IResult> GetChangesAsync(string productionId, [FromQuery] long since, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.GetChangesAsync(productionId, since, cancellationToken));

    public static async Task<IResult> UpdateAsync(string productionId, [FromBody] UpdateProductionRequest body, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.UpdateAsync(productionId, body, cancellationToken));

    public static async Task<IResult> ActivateAsync(string productionId, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.ActivateAsync(productionId, cancellationToken));

    public static async Task<IResult> StartBroadcastAsync(string productionId, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.StartBroadcastAsync(productionId, cancellationToken));

    public static async Task<IResult> EndBroadcastAsync(string productionId, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.EndBroadcastAsync(productionId, cancellationToken));

    public static async Task<IResult> ResetBroadcastAsync(string productionId, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.ResetBroadcastAsync(productionId, cancellationToken));

    public static async Task<IResult> SetPreviewAsync(string productionId, [FromBody] SetPreviewRequest body, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.SetPreviewAsync(productionId, body, cancellationToken));

    public static async Task<IResult> SwitchProgramAsync(string productionId, [FromBody] SwitchProgramRequest body, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.SwitchProgramAsync(productionId, body, cancellationToken));

    public static async Task<IResult> TakeAsync(string productionId, [FromBody] TakeRequest body, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.TakeAsync(productionId, body, cancellationToken));

    public static async Task<IResult> AcknowledgeIncidentAsync(string productionId, string incidentId, ProductionService productions, CancellationToken cancellationToken)
    {
        await productions.AcknowledgeIncidentAsync(productionId, incidentId, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> IssueLiveKitTokenAsync(string productionId, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.IssueStudioTokenAsync(productionId, cancellationToken));

    public static async Task<IResult> GetTelemetryAsync(string productionId, ProductionService productions, CancellationToken cancellationToken) =>
        TypedResults.Ok(await productions.GetTelemetryAsync(productionId, cancellationToken));
}

/// <summary>Scenes and items.</summary>
internal static class SceneEndpoints
{
    public static async Task<IResult> CreateAsync(string productionId, [FromBody] CreateSceneRequest body, SceneService scenes, CancellationToken cancellationToken)
    {
        var scene = await scenes.CreateAsync(productionId, body, cancellationToken);
        return TypedResults.Created($"/api/productions/{productionId}/scenes/{scene.Id}", scene);
    }

    public static async Task<IResult> UpdateAsync(string productionId, string sceneId, [FromBody] UpdateSceneRequest body, SceneService scenes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await scenes.UpdateAsync(productionId, sceneId, body, cancellationToken));

    public static async Task<IResult> DeleteAsync(string productionId, string sceneId, SceneService scenes, CancellationToken cancellationToken)
    {
        await scenes.DeleteAsync(productionId, sceneId, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> ReorderAsync(string productionId, [FromBody] ReorderScenesRequest body, SceneService scenes, CancellationToken cancellationToken)
    {
        await scenes.ReorderAsync(productionId, body, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> AddItemAsync(string productionId, string sceneId, [FromBody] AddSceneItemRequest body, SceneService scenes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await scenes.AddItemAsync(productionId, sceneId, body, cancellationToken));

    public static async Task<IResult> UpdateItemAsync(string productionId, string sceneId, string itemId, [FromBody] SceneItemDto body, SceneService scenes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await scenes.UpdateItemAsync(productionId, sceneId, itemId, body, cancellationToken));

    public static async Task<IResult> RemoveItemAsync(string productionId, string sceneId, string itemId, SceneService scenes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await scenes.RemoveItemAsync(productionId, sceneId, itemId, cancellationToken));

    public static async Task<IResult> ReorderItemsAsync(string productionId, string sceneId, [FromBody] ReorderSceneItemsRequest body, SceneService scenes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await scenes.ReorderItemsAsync(productionId, sceneId, body, cancellationToken));

    public static async Task<IResult> ReplaceItemsAsync(string productionId, string sceneId, [FromBody] ReplaceSceneItemsRequest body, SceneService scenes, CancellationToken cancellationToken) =>
        TypedResults.Ok(await scenes.ReplaceItemsAsync(productionId, sceneId, body, cancellationToken));
}

/// <summary>Texts and lower thirds.</summary>
internal static class TextEndpoints
{
    public static async Task<IResult> CreateAsync(string productionId, [FromBody] CreateTextSourceRequest body, TextService texts, CancellationToken cancellationToken)
    {
        var text = await texts.CreateAsync(productionId, body, cancellationToken);
        return TypedResults.Created($"/api/productions/{productionId}/texts/{text.Id}", text);
    }

    public static async Task<IResult> UpdateAsync(string productionId, string textId, [FromBody] UpdateTextSourceRequest body, TextService texts, CancellationToken cancellationToken) =>
        TypedResults.Ok(await texts.UpdateAsync(productionId, textId, body, cancellationToken));

    public static async Task<IResult> DeleteAsync(string productionId, string textId, TextService texts, CancellationToken cancellationToken)
    {
        await texts.DeleteAsync(productionId, textId, cancellationToken);
        return TypedResults.NoContent();
    }
}

/// <summary>Regie actions on devices.</summary>
internal static class DeviceAdminEndpoints
{
    public static async Task<IResult> RenameAsync(string productionId, string deviceId, [FromBody] RenameDeviceRequest body, DeviceAdminService devices, CancellationToken cancellationToken) =>
        TypedResults.Ok(await devices.RenameAsync(productionId, deviceId, body, cancellationToken));

    public static async Task<IResult> BlockAsync(string productionId, string deviceId, DeviceAdminService devices, CancellationToken cancellationToken) =>
        TypedResults.Ok(await devices.BlockAsync(productionId, deviceId, cancellationToken));

    public static async Task<IResult> UnblockAsync(string productionId, string deviceId, DeviceAdminService devices, CancellationToken cancellationToken) =>
        TypedResults.Ok(await devices.UnblockAsync(productionId, deviceId, cancellationToken));

    public static async Task<IResult> DeleteAsync(string productionId, string deviceId, DeviceAdminService devices, CancellationToken cancellationToken)
    {
        await devices.DeleteAsync(productionId, deviceId, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> SendCommandAsync(string productionId, string deviceId, [FromBody] DeviceCommandRequest body, DeviceAdminService devices, CancellationToken cancellationToken) =>
        TypedResults.Accepted((string?)null, await devices.SendCommandAsync(productionId, deviceId, body, cancellationToken));
}

/// <summary>Regie side of pairing and the anonymous /join side.</summary>
internal static class PairingEndpoints
{
    public static async Task<IResult> GetPhoneInviteAsync(string productionId, PairingService pairing, CancellationToken cancellationToken) =>
        TypedResults.Ok(await pairing.GetPhoneInviteAsync(productionId, cancellationToken));

    public static async Task<IResult> RenewPhoneInviteAsync(string productionId, PairingService pairing, CancellationToken cancellationToken) =>
        TypedResults.Ok(await pairing.RenewPhoneInviteAsync(productionId, cancellationToken));

    public static async Task<IResult> CreateInviteAsync(string productionId, [FromBody] CreateInviteRequest body, PairingService pairing, CancellationToken cancellationToken)
    {
        var invite = await pairing.CreateInviteAsync(productionId, body, cancellationToken);
        return TypedResults.Created((string?)null, invite);
    }

    public static async Task<IResult> RevokeInviteAsync(string productionId, string inviteId, PairingService pairing, CancellationToken cancellationToken)
    {
        await pairing.RevokeInviteAsync(productionId, inviteId, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> ApproveAsync(string productionId, string requestId, PairingService pairing, CancellationToken cancellationToken) =>
        TypedResults.Ok(await pairing.ApproveAsync(productionId, requestId, cancellationToken));

    public static async Task<IResult> DenyAsync(string productionId, string requestId, PairingService pairing, CancellationToken cancellationToken)
    {
        await pairing.DenyAsync(productionId, requestId, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> CreateRequestAsync([FromBody] CreatePairingRequest body, PairingService pairing, CancellationToken cancellationToken)
    {
        var created = await pairing.CreateRequestAsync(body, cancellationToken);
        return TypedResults.Created($"/api/pairing/requests/{created.RequestId}", created);
    }

    public static IResult GetRequestStatus(string requestId, [FromHeader(Name = "X-Pairing-Token")] string pollToken, PairingService pairing) =>
        TypedResults.Ok(pairing.Poll(requestId, pollToken));

    public static async Task<IResult> CancelRequestAsync(string requestId, [FromHeader(Name = "X-Pairing-Token")] string pollToken, PairingService pairing, CancellationToken cancellationToken)
    {
        await pairing.CancelRequestAsync(requestId, pollToken, cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> RedeemAsync(string token, [FromBody] RedeemInviteRequest body, PairingService pairing, CancellationToken cancellationToken) =>
        TypedResults.Ok(await pairing.RedeemAsync(token, body, cancellationToken));
}

/// <summary>Output settings for the Regie and the output page routes (key in <c>X-Output-Key</c>).</summary>
internal static class OutputEndpoints
{
    private const string OutputKeyHeader = "X-Output-Key";

    public static async Task<IResult> GetSettingsAsync(string productionId, OutputService outputs, CancellationToken cancellationToken) =>
        TypedResults.Ok(await outputs.GetSettingsAsync(productionId, cancellationToken));

    public static async Task<IResult> UpdateAccessAsync(string productionId, [FromBody] UpdateOutputAccessRequest body, OutputService outputs, CancellationToken cancellationToken) =>
        TypedResults.Ok(await outputs.UpdateAccessAsync(productionId, body, cancellationToken));

    public static async Task<IResult> RegenerateKeyAsync(string productionId, OutputService outputs, CancellationToken cancellationToken) =>
        TypedResults.Ok(await outputs.RegenerateKeyAsync(productionId, cancellationToken));

    // The key header is optional for the binder: a missing key must give the same 403 as a wrong one, not a 400 (GAP-06).
    public static async Task<IResult> GetSnapshotAsync(string slug, [FromHeader(Name = OutputKeyHeader)] string? key, OutputService outputs, HttpContext context, CancellationToken cancellationToken)
    {
        var access = await outputs.AuthorizeAsync(slug, key, context.Connection.RemoteIpAddress, cancellationToken);
        return TypedResults.Ok(await outputs.GetSnapshotAsync(access, cancellationToken));
    }

    public static async Task<IResult> GetChangesAsync(string slug, [FromQuery] long since, [FromHeader(Name = OutputKeyHeader)] string? key, OutputService outputs, HttpContext context, CancellationToken cancellationToken)
    {
        var access = await outputs.AuthorizeAsync(slug, key, context.Connection.RemoteIpAddress, cancellationToken);
        return TypedResults.Ok(await outputs.GetChangesAsync(access, since, cancellationToken));
    }

    public static async Task<IResult> IssueLiveKitTokenAsync(string slug, [FromHeader(Name = OutputKeyHeader)] string? key, OutputService outputs, HttpContext context, CancellationToken cancellationToken)
    {
        var access = await outputs.AuthorizeAsync(slug, key, context.Connection.RemoteIpAddress, cancellationToken);
        return TypedResults.Ok(outputs.IssueToken(access));
    }

    public static async Task<IResult> ReportAsync(string slug, [FromHeader(Name = OutputKeyHeader)] string? key, [FromBody] OutputReport body, OutputService outputs, HttpContext context, CancellationToken cancellationToken)
    {
        var access = await outputs.AuthorizeAsync(slug, key, context.Connection.RemoteIpAddress, cancellationToken);
        await outputs.ReportAsync(access.ProductionId, body, cancellationToken);
        return TypedResults.NoContent();
    }
}
