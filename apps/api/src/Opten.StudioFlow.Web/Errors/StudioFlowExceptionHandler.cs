using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Web.Errors;

/// <summary>
/// Turns exceptions into problem details with a <c>code</c>: expected use case errors keep their status and English
/// message, malformed requests become 400 (a body that cannot be bound names the field in <c>errors</c>, BUG-08), an
/// unreachable database 503 <c>service_unavailable</c> with
/// <c>Retry-After</c> (GAP-32), everything else 500 without internals (the message only in Development).
/// </summary>
internal sealed class StudioFlowExceptionHandler(IProblemDetailsService problems, IHostEnvironment environment, ILogger<StudioFlowExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            // The client went away; nobody reads an answer.
            return true;
        }

        var (status, code, detail, errors, retryAfter) = Describe(exception, httpContext);
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

    private (int Status, string Code, string Detail, IReadOnlyDictionary<string, string[]>? Errors, TimeSpan? RetryAfter) Describe(Exception exception, HttpContext httpContext) => exception switch
    {
        StudioFlowException e => (StatusOf(e.Kind), e.Code, e.Message, e.Errors, e.RetryAfter),
        _ when DatabaseOutage.IsOutage(exception) => (StatusCodes.Status503ServiceUnavailable, ErrorCodes.ServiceUnavailable, DatabaseOutage.Message, null, DatabaseOutage.RetryAfter),
        BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge } when IsImport(httpContext) => (StatusCodes.Status413PayloadTooLarge, ErrorCodes.ArchiveTooLarge, "The file is larger than this installation accepts.", null, null),
        BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge } => (StatusCodes.Status413PayloadTooLarge, ErrorCodes.UnsupportedMedia, "The request is too large.", null, null),
        BadHttpRequestException { StatusCode: StatusCodes.Status400BadRequest } e when JsonBindingErrors.From(e) is { } fields => (StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed, "The input is invalid.", fields, null),
        BadHttpRequestException e => (e.StatusCode, Problems.CodeFor(e.StatusCode), "The request is invalid.", null, null),
        JsonException or InvalidDataException or NotSupportedException { Source: "System.Text.Json" } => (StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed, "The request is invalid.", null, null),
        _ => (StatusCodes.Status500InternalServerError, ErrorCodes.InternalError, environment.IsDevelopment() ? exception.Message : "An unexpected error occurred.", null, null),
    };

    /// <summary>The failed request was the import of a production: Kestrel stopped reading its body at the limit.</summary>
    private static bool IsImport(HttpContext httpContext) =>
        httpContext.Features.Get<IExceptionHandlerFeature>()?.Endpoint?.Metadata.GetMetadata<Endpoints.RequestBodyLimit>() is { IsImport: true };
}
