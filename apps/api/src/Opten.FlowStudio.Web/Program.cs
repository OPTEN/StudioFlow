using System.Text.Json;
using System.Text.Json.Serialization;
using Opten.FlowStudio.Web.Endpoints;
using Opten.FlowStudio.Web.OpenApi;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer<ContractSchemasTransformer>();
    options.AddSchemaTransformer<DiscriminatorRequiredTransformer>();
});

var app = builder.Build();

app.MapOpenApi();
app.MapFlowStudioApi();

await app.RunAsync();
