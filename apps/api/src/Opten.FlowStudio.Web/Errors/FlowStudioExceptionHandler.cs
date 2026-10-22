using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Web.Errors;

/// <summary>
/// Turns exceptions into problem details with a <c>code</c>: expected use case errors keep their status and German
/// message, malformed requests become 400, an unreachable database 503 <c>service_unavailable</c> with
/// <c>Retry-After</c> (GAP-32), everything else 500 without internals (the message only in Development).
/// </summary>
internal sealed class FlowStudioExceptionHandler(IProblemDetailsService problems, IHostEnvironment environment, ILogger<FlowStudioExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            // The client went away; nobody reads an answer.
            return true;
        }

        var (status, code, detail, errors, retryAfter) = Describe(exception);
        if (status == StatusCodes.Status503ServiceUnavailable)
        {
            // An operational state, not a bug: no stack trace for every request while PostgreSQL is down.
            logger.LogWarning("Request {Method} failed: the database is not reachable ({Reason})", httpContext.Request.Method, exception.GetBaseException().GetType().Name);
        }
        else if (status >= StatusCodes.Status500InternalServerError)
        {
            // The route template, not the path: paths carry invite tokens (/api/pairing/invites/{token}/redeem).
            var route = (httpContext.Features.Get<IExceptionHandlerFeature>()?.Endpoint as RouteEndpoint)?.RoutePattern.RawText ?? "unmatched";
            logger.LogError(exception, "Unhandled error on {Method} {Route}", httpContext.Request.Method, route);
        }
        else
        {
            logger.LogDebug(exception, "Request failed with {Status} {Code}", status, code);
        }

        httpContext.Response.StatusCode = status;
        if (retryAfter is { } wait)
        {
            httpContext.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        }

        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = Problems.Create(status, code, detail, errors),
            Exception = exception,
        });
    }

    /// <summary>HTTP status of a use case error.</summary>
    internal static int StatusOf(ErrorKind kind) => kind switch
    {
        ErrorKind.Validation => StatusCodes.Status400BadRequest,
        ErrorKind.Unauthorized => StatusCodes.Status401Unauthorized,
        ErrorKind.Forbidden => StatusCodes.Status403Forbidden,
        ErrorKind.NotFound => StatusCodes.Status404NotFound,
        ErrorKind.Conflict => StatusCodes.Status409Conflict,
        ErrorKind.Gone => StatusCodes.Status410Gone,
        ErrorKind.PayloadTooLarge => StatusCodes.Status413PayloadTooLarge,
        ErrorKind.UnsupportedMedia => StatusCodes.Status415UnsupportedMediaType,
        ErrorKind.RateLimited => StatusCodes.Status429TooManyRequests,
        _ => StatusCodes.Status500InternalServerError,
    };

    private (int Status, string Code, string Detail, IReadOnlyDictionary<string, string[]>? Errors, TimeSpan? RetryAfter) Describe(Exception exception) => exception switch
    {
        FlowStudioException e => (StatusOf(e.Kind), e.Code, e.Message, e.Errors, e.RetryAfter),
        _ when DatabaseOutage.IsOutage(exception) => (StatusCodes.Status503ServiceUnavailable, ErrorCodes.ServiceUnavailable, DatabaseOutage.Message, null, DatabaseOutage.RetryAfter),
        BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge } => (StatusCodes.Status413PayloadTooLarge, ErrorCodes.UnsupportedMedia, "Die Anfrage ist zu gross.", null, null),
        BadHttpRequestException e => (e.StatusCode, Problems.CodeFor(e.StatusCode), "Die Anfrage ist ungültig.", null, null),
        JsonException or InvalidDataException or NotSupportedException { Source: "System.Text.Json" } => (StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed, "Die Anfrage ist ungültig.", null, null),
        _ => (StatusCodes.Status500InternalServerError, ErrorCodes.InternalError, environment.IsDevelopment() ? exception.Message : "Ein unerwarteter Fehler ist aufgetreten.", null, null),
    };
}
