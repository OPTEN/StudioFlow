using System.Reflection;

namespace Opten.StudioFlow.Web.Hosting;

/// <summary>
/// The version of the running API, reported by <c>GET /api/system/info</c>. It comes from the <c>Version</c> property in
/// <c>apps/api/Directory.Build.props</c> (the one version of the release, kept by release-please). A build that knows
/// its commit (the Docker build passes <c>SourceRevisionId</c>) appends it as SemVer build metadata, so
/// <c>0.1.0+1a2b3c4</c> tells exactly what runs when something goes wrong; without a commit the version is <c>0.1.0</c>.
/// </summary>
internal static class AppVersion
{
    private const string Unknown = "0.0.0";
    private const int RevisionLength = 7;

    /// <summary>The version of this assembly.</summary>
    public static string Current { get; } =
        From(typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);

    /// <summary>Shortens the build metadata of an informational version (a full commit hash) to seven characters.</summary>
    internal static string From(string? informationalVersion)
    {
        if (string.IsNullOrWhiteSpace(informationalVersion))
        {
            return Unknown;
        }

        var parts = informationalVersion.Split('+', 2);
        if (parts.Length == 1 || parts[1].Length == 0)
        {
            return parts[0];
        }

        return $"{parts[0]}+{parts[1][..Math.Min(parts[1].Length, RevisionLength)]}";
    }
}
