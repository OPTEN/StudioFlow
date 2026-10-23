using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// Used by <c>dotnet ef migrations add</c> (which needs no database). Takes the connection string from the
/// <c>STUDIOFLOW_DESIGN_CONNECTION</c> environment variable for <c>dotnet ef database update</c>; the default only works
/// for generating migrations.
/// </summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<StudioFlowDbContext>
{
    public StudioFlowDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("STUDIOFLOW_DESIGN_CONNECTION") ?? "Host=localhost;Database=studioflow_design";
        var options = new DbContextOptionsBuilder<StudioFlowDbContext>().UseNpgsql(connectionString).Options;
        return new StudioFlowDbContext(options);
    }
}
