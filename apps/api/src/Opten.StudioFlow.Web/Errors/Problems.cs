using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Web.Errors;

/// <summary>
/// RFC 7807 problem details with the extension <c>code</c> (spec 5). Titles are English; clients localise by <c>code</c>.
/// </summary>
internal static class Problems
{
    /// <summary>Name of the code extension.</summary>
    public const string CodeExtension = "code";

    /// <summary>The default code of a status without a more specific one.</summary>
    public static string CodeFor(int status) => status switch
    {
        StatusCodes.Status400BadRequest => ErrorCodes.ValidationFailed,
        StatusCodes.Status401Unauthorized => ErrorCodes.Unauthorized,
        StatusCodes.Status403Forbidden => ErrorCodes.Forbidden,
        StatusCodes.Status404NotFound or StatusCodes.Status405MethodNotAllowed => ErrorCodes.NotFound,
        StatusCodes.Status408RequestTimeout => ErrorCodes.RequestTimeout,
        StatusCodes.Status409Conflict => ErrorCodes.Conflict,
        StatusCodes.Status410Gone => ErrorCodes.PairingExpired,
        StatusCodes.Status413PayloadTooLarge or StatusCodes.Status415UnsupportedMediaType => ErrorCodes.UnsupportedMedia,
        StatusCodes.Status429TooManyRequests => ErrorCodes.RateLimited,
        StatusCodes.Status503ServiceUnavailable => ErrorCodes.ServiceUnavailable,
        _ => ErrorCodes.InternalError,
    };

    /// <summary>English title of a status.</summary>
    public static string TitleFor(int status) => status switch
    {
        StatusCodes.Status400BadRequest => "Invalid input",
        StatusCodes.Status401Unauthorized => "Not signed in",
        StatusCodes.Status403Forbidden => "No access",
        StatusCodes.Status404NotFound or StatusCodes.Status405MethodNotAllowed => "Not found",
        StatusCodes.Status408RequestTimeout => "Request timeout",
        StatusCodes.Status409Conflict => "Conflict",
        StatusCodes.Status410Gone => "No longer valid",
        StatusCodes.Status413PayloadTooLarge => "Too large",
        StatusCodes.Status415UnsupportedMediaType => "Unsupported file type",
        StatusCodes.Status429TooManyRequests => "Too many attempts",
        StatusCodes.Status503ServiceUnavailable => "Temporarily unavailable",
        _ => "Server error",
    };

    /// <summary>A problem result for an endpoint or filter.</summary>
    public static ProblemHttpResult Result(int status, string code, string detail) =>
        TypedResults.Problem(Create(status, code, detail));

    /// <summary>Writes a problem response directly (middleware).</summary>
    public static async Task WriteAsync(HttpContext context, int status, string code, string detail)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Response.StatusCode = status;
        var writer = context.RequestServices.GetRequiredService<IProblemDetailsService>();
        await writer.WriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = Create(status, code, detail) });
    }

    /// <summary>Creates problem details with a code.</summary>
    public static ProblemDetails Create(int status, string code, string? detail, IReadOnlyDictionary<string, string[]>? errors = null)
    {
        ProblemDetails problem = errors is null
            ? new ProblemDetails()
            : new HttpValidationProblemDetails(errors.ToDictionary(e => e.Key, e => e.Value, StringComparer.Ordinal));
        problem.Status = status;
        problem.Title = TitleFor(status);
        problem.Detail = detail;
        problem.Extensions[CodeExtension] = code;
        return problem;
    }
}
