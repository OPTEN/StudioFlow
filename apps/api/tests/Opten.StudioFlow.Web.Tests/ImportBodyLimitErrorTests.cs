using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Web.Endpoints;
using Opten.StudioFlow.Web.Errors;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// Kestrel stops reading a body that crosses the limit while it streams (no <c>Content-Length</c>, chunked): the failure
/// arrives as a <see cref="BadHttpRequestException"/> with status 413. For the import it must read “archive too large”,
/// not the message about media of the upload; any other endpoint keeps <c>unsupported_media</c>.
/// </summary>
public sealed class ImportBodyLimitErrorTests
{
    [Fact]
    public async Task KestrelBodyLimit_OnTheImport_IsArchiveTooLarge()
    {
        var problem = await HandleAsync(RequestBodyLimit.Import);

        Assert.Equal(StatusCodes.Status413PayloadTooLarge, problem.Status);
        Assert.Equal(ErrorCodes.ArchiveTooLarge, problem.Code);
    }

    [Fact]
    public async Task KestrelBodyLimit_OnTheAssetUpload_StaysUnsupportedMedia()
    {
        var problem = await HandleAsync(RequestBodyLimit.Upload);

        Assert.Equal(StatusCodes.Status413PayloadTooLarge, problem.Status);
        Assert.Equal(ErrorCodes.UnsupportedMedia, problem.Code);
    }

    [Fact]
    public async Task KestrelBodyLimit_WithoutEndpoint_StaysUnsupportedMedia()
    {
        var problem = await HandleAsync(null);

        Assert.Equal(ErrorCodes.UnsupportedMedia, problem.Code);
    }

    private static async Task<(int Status, string? Code)> HandleAsync(RequestBodyLimit? limit)
    {
        var writer = new CapturingProblemDetails();
        var handler = new StudioFlowExceptionHandler(writer, new Development(), NullLogger<StudioFlowExceptionHandler>.Instance);
        var context = new DefaultHttpContext();
        var exception = new BadHttpRequestException("Request body too large.", StatusCodes.Status413PayloadTooLarge);
        var endpoint = limit is null
            ? null
            : new RouteEndpoint(_ => Task.CompletedTask, RoutePatternFactory.Parse("/api/x"), 0, new EndpointMetadataCollection(limit), "x");
        context.Features.Set<IExceptionHandlerFeature>(new ExceptionHandlerFeature { Error = exception, Path = "/api/x", Endpoint = endpoint });

        Assert.True(await handler.TryHandleAsync(context, exception, CancellationToken.None));

        var details = Assert.IsType<ProblemDetailsContext>(writer.Written).ProblemDetails;
        return (context.Response.StatusCode, details.Extensions[Problems.CodeExtension] as string);
    }

    private sealed class CapturingProblemDetails : IProblemDetailsService
    {
        public ProblemDetailsContext? Written { get; private set; }

        public ValueTask WriteAsync(ProblemDetailsContext context)
        {
            Written = context;
            return ValueTask.CompletedTask;
        }

        public ValueTask<bool> TryWriteAsync(ProblemDetailsContext context)
        {
            Written = context;
            return ValueTask.FromResult(true);
        }
    }

    private sealed class Development : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;

        public string ApplicationName { get; set; } = "Test";

        public string ContentRootPath { get; set; } = string.Empty;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
