using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Opten.FlowStudio.Infrastructure.Persistence;

/// <summary>
/// Used by <c>dotnet ef migrations add</c> (which needs no database). Takes the connection string from the
/// <c>FLOWSTUDIO_DESIGN_CONNECTION</c> environment variable for <c>dotnet ef database update</c>; the default only works
/// for generating migrations.
/// </summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<FlowStudioDbContext>
{
    public FlowStudioDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("FLOWSTUDIO_DESIGN_CONNECTION") ?? "Host=localhost;Database=flowstudio_design";
        var options = new DbContextOptionsBuilder<FlowStudioDbContext>().UseNpgsql(connectionString).Options;
        return new FlowStudioDbContext(options);
    }
}
