using System.Text;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Opten.StudioFlow.Web.Hosting;

/// <summary>
/// Body of <c>/health/ready</c>: the overall status on the first line, exactly as the default writer prints it, then one
/// line for every check that is not healthy, so a warning (Degraded) names its reason. Descriptions only: exception
/// messages can hold connection strings.
/// </summary>
internal static class HealthResponse
{
    public static Task WriteAsync(HttpContext context, HealthReport report)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(report);
        context.Response.ContentType = "text/plain";
        return context.Response.WriteAsync(Format(report));
    }

    internal static string Format(HealthReport report)
    {
        var text = new StringBuilder(report.Status.ToString());
        foreach (var (name, entry) in report.Entries.Where(e => e.Value.Status != HealthStatus.Healthy))
        {
            text.Append('\n').Append(name).Append(": ").Append(entry.Status).Append(" - ").Append(entry.Description ?? "no details");
        }

        return text.ToString();
    }
}
