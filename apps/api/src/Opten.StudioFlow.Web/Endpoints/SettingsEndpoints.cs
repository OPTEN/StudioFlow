using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using Microsoft.AspNetCore.Mvc;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Web.Endpoints;

/// <summary>
/// Server settings (issue #27): the steps of the first-run wizard after the account and the "Server settings" page. All
/// routes need the Regie session and the CSRF header. Answers never contain a secret.
/// </summary>
internal static class SettingsEndpoints
{
    /// <summary>Configuration section of the networks the API trusts (the compose network); the addresses of these interfaces are not the host's.</summary>
    private const string KnownNetworksSection = "ForwardedHeaders:KnownNetworks";

    public static IResult Get(ServerSettingsService settings) => TypedResults.Ok(settings.Get());

    public static async Task<IResult> GetStatusAsync(ServerSettingsService settings, Core.Application.ServerConfigApplier applier, CancellationToken cancellationToken)
    {
        // The maintenance loop applies every few seconds; a poll right after a save should not wait for it.
        await applier.ApplyAsync(cancellationToken);
        return TypedResults.Ok(settings.GetApplyStatus());
    }

    public static async Task<IResult> UpdateMediaAsync([FromBody] UpdateMediaRequest body, ServerSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.UpdateMediaAsync(body, cancellationToken));

    public static async Task<IResult> UpdateAddressAsync([FromBody] UpdateAddressRequest body, ServerSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.UpdateAddressAsync(body, cancellationToken));

    public static async Task<IResult> UploadCertificateAsync([FromBody] UploadCertificateRequest body, ServerSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.UploadCertificateAsync(body, cancellationToken));

    public static async Task<IResult> UpdateEmbeddingAsync([FromBody] UpdateEmbeddingRequest body, ServerSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.UpdateEmbeddingAsync(body, cancellationToken));

    public static async Task<IResult> UpdateBackupAsync([FromBody] UpdateBackupRequest body, ServerSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.UpdateBackupAsync(body, cancellationToken));

    public static IResult GetMediaSuggestions(HttpContext context, IConfiguration configuration) =>
        TypedResults.Ok(ServerSettingsService.Suggest(context.Request.Host.Host, InterfaceAddresses(configuration)));

    public static async Task<IResult> StartMediaTestAsync([FromBody] MediaTestRequest body, ServerSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.StartMediaTestAsync(body, cancellationToken));

    public static async Task<IResult> EndMediaTestAsync(ServerSettingsService settings, CancellationToken cancellationToken)
    {
        await settings.EndMediaTestAsync(cancellationToken);
        return TypedResults.NoContent();
    }

    public static async Task<IResult> ListBackupsAsync(ServerSettingsService settings, CancellationToken cancellationToken) =>
        TypedResults.Ok(await settings.GetBackupsAsync(cancellationToken));

    public static async Task<IResult> RequestBackupAsync(ServerSettingsService settings, CancellationToken cancellationToken)
    {
        await settings.RequestBackupAsync(cancellationToken);
        return TypedResults.Accepted((string?)null);
    }

    /// <summary>
    /// The IPv4 addresses of the interfaces of the API that can be an address of the server: up, not loopback, not
    /// link-local, and not in the compose network (inside Docker those addresses belong to the container, not to the host).
    /// </summary>
    internal static IReadOnlyList<string> InterfaceAddresses(IConfiguration configuration)
    {
        var internalNetworks = (configuration.GetSection(KnownNetworksSection).Get<string[]>() ?? [])
            .Select(network => IPNetwork.TryParse(network, out var parsed) ? parsed : (IPNetwork?)null)
            .Where(network => network is not null)
            .Select(network => network!.Value)
            .ToList();
        var result = new List<string>();
        foreach (var network in NetworkInterface.GetAllNetworkInterfaces().Where(i => i.OperationalStatus == OperationalStatus.Up && i.NetworkInterfaceType != NetworkInterfaceType.Loopback))
        {
            foreach (var unicast in network.GetIPProperties().UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork))
            {
                var address = unicast.Address;
                if (!IPAddress.IsLoopback(address) && !IsLinkLocal(address) && !internalNetworks.Any(n => n.Contains(address)))
                {
                    result.Add(address.ToString());
                }
            }
        }

        return result;
    }

    private static bool IsLinkLocal(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return bytes[0] == 169 && bytes[1] == 254;
    }
}
