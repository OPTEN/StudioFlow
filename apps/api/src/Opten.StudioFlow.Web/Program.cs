using Opten.StudioFlow.Web.Hosting;

if (await CliCommands.TryRunAsync(args) is { } exitCode)
{
    return exitCode;
}

var builder = WebApplication.CreateBuilder(args);
builder.AddStudioFlow();

var app = builder.Build();
app.UseStudioFlow();

await app.RunAsync();
return 0;

/// <summary>Entry point (public for <c>WebApplicationFactory</c> in the integration tests).</summary>
public partial class Program;
