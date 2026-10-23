using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Web.OpenApi;

/// <summary>
/// Adds the public types of <see cref="Opten.StudioFlow.Core.Contracts"/> that no REST endpoint references (SignalR-only
/// messages) to the OpenAPI components. The TypeScript contracts (packages/scene-model) are
/// generated from this document, so REST and SignalR share one source of truth.
/// </summary>
internal sealed class ContractSchemasTransformer : IOpenApiDocumentTransformer
{
    /// <inheritdoc />
    public async Task TransformAsync(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken cancellationToken)
    {
        var contractTypes = typeof(ProductionDto).Assembly
            .GetExportedTypes()
            .Where(t => string.Equals(t.Namespace, typeof(ProductionDto).Namespace, StringComparison.Ordinal))
            .Where(t => !(t.IsAbstract && t.IsSealed))
            // Event subtypes are emitted by the generator as ProductionEvent{Name} through the polymorphic base type.
            .Where(t => !t.IsSubclassOf(typeof(ProductionEvent)))
            .OrderBy(t => t.Name, StringComparer.Ordinal);

        document.Components ??= new OpenApiComponents();
        document.Components.Schemas ??= new Dictionary<string, IOpenApiSchema>(StringComparer.Ordinal);

        foreach (var type in contractTypes)
        {
            if (document.Components.Schemas.ContainsKey(type.Name))
            {
                continue;
            }

            var schema = await context.GetOrCreateSchemaAsync(type, null, cancellationToken);
            document.Components.Schemas[type.Name] = schema;
        }
    }
}
