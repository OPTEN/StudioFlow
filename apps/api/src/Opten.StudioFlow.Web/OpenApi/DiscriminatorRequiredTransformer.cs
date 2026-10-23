using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Web.OpenApi;

/// <summary>
/// Marks the <c>type</c> discriminator of every <see cref="ProductionEvent"/> subtype as required. System.Text.Json always
/// writes it, and a required discriminator lets the generated TypeScript narrow the event union with <c>switch (e.type)</c>.
/// </summary>
internal sealed class DiscriminatorRequiredTransformer : IOpenApiSchemaTransformer
{
    private const string Discriminator = "type";

    /// <inheritdoc />
    public Task TransformAsync(OpenApiSchema schema, OpenApiSchemaTransformerContext context, CancellationToken cancellationToken)
    {
        var type = context.JsonTypeInfo.Type;
        if (type.IsSubclassOf(typeof(ProductionEvent)) && schema.Properties?.ContainsKey(Discriminator) == true)
        {
            schema.Required ??= new HashSet<string>(StringComparer.Ordinal);
            schema.Required.Add(Discriminator);
        }

        return Task.CompletedTask;
    }
}
