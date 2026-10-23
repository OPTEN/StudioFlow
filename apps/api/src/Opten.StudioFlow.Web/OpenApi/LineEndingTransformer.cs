using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Opten.StudioFlow.Web.OpenApi;

/// <summary>
/// Writes every description and summary with <c>\n</c> line breaks. The XML documentation comments reach the document
/// with the line breaks of the building platform, so without this the committed OpenAPI file (and the TypeScript
/// contracts generated from it) would differ between a Windows and a Linux build and the CI contract check would fail.
/// Registered after <see cref="ContractSchemasTransformer"/>, so it also sees the schemas that transformer adds.
/// </summary>
internal sealed class LineEndingTransformer : IOpenApiDocumentTransformer
{
    private const string WindowsNewLine = "\r\n";

    /// <inheritdoc />
    public Task TransformAsync(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken cancellationToken)
    {
        // Component schemas first: a reference without a description of its own reads its target's description, so the
        // targets must be clean before the references are inspected.
        foreach (var component in ValuesOf(document.Components?.Schemas).OfType<OpenApiSchema>())
        {
            component.Description = Normalize(component.Description);
        }

        var visited = new HashSet<IOpenApiSchema>(ReferenceEqualityComparer.Instance);
        foreach (var schema in ValuesOf(document.Components?.Schemas))
        {
            NormalizeSchema(schema, visited);
        }

        foreach (var pathItem in ValuesOf(document.Paths))
        {
            foreach (var operation in ValuesOf(pathItem.Operations))
            {
                NormalizeOperation(operation, visited);
            }
        }

        return Task.CompletedTask;
    }

    private static void NormalizeOperation(OpenApiOperation operation, HashSet<IOpenApiSchema> visited)
    {
        operation.Summary = Normalize(operation.Summary);
        operation.Description = Normalize(operation.Description);

        foreach (var parameter in operation.Parameters ?? [])
        {
            if (parameter is OpenApiParameter concrete)
            {
                concrete.Description = Normalize(concrete.Description);
            }

            if (parameter.Schema is not null)
            {
                NormalizeSchema(parameter.Schema, visited);
            }
        }

        if (operation.RequestBody is OpenApiRequestBody body)
        {
            body.Description = Normalize(body.Description);
        }

        foreach (var response in ValuesOf(operation.Responses))
        {
            if (response is OpenApiResponse concrete)
            {
                concrete.Description = Normalize(concrete.Description);
            }
        }
    }

    private static void NormalizeSchema(IOpenApiSchema schema, HashSet<IOpenApiSchema> visited)
    {
        if (!visited.Add(schema))
        {
            return;
        }

        switch (schema)
        {
            case OpenApiSchema concrete:
                concrete.Description = Normalize(concrete.Description);
                break;
            case OpenApiSchemaReference reference:
                // Only a description of the reference itself (the property's doc comment) can still contain CRLF here.
                // Assigning the inherited target description would write it out on every reference.
                if (reference.Description?.Contains(WindowsNewLine, StringComparison.Ordinal) == true)
                {
                    reference.Description = Normalize(reference.Description);
                }

                return;
        }

        foreach (var property in ValuesOf(schema.Properties))
        {
            NormalizeSchema(property, visited);
        }

        foreach (var child in (schema.AllOf ?? []).Concat(schema.OneOf ?? []).Concat(schema.AnyOf ?? []))
        {
            NormalizeSchema(child, visited);
        }

        if (schema.Items is not null)
        {
            NormalizeSchema(schema.Items, visited);
        }

        if (schema.AdditionalProperties is not null)
        {
            NormalizeSchema(schema.AdditionalProperties, visited);
        }
    }

    private static string? Normalize(string? text) => text?.Replace(WindowsNewLine, "\n", StringComparison.Ordinal);

    private static IEnumerable<TValue> ValuesOf<TKey, TValue>(IDictionary<TKey, TValue>? dictionary) =>
        dictionary?.Values ?? Enumerable.Empty<TValue>();
}
