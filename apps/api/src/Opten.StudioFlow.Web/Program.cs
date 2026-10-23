using Opten.FlowStudio.Web.Hosting;

if (await CliCommands.TryRunAsync(args) is { } exitCode)
{
    return exitCode;
}

var builder = WebApplication.CreateBuilder(args);
builder.AddFlowStudio();

var app = builder.Build();
app.UseFlowStudio();

await app.RunAsync();
return 0;

/// <summary>Entry point (public for <c>WebApplicationFactory</c> in the integration tests).</summary>
public partial class Program;
