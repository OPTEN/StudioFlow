using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The migration of issue #14: productions that exist before it have no placeholders, and placeholders survive a round trip.</summary>
public sealed class PlaceholdersMigrationTests(PostgresFixture postgres)
{
    private const string MigrationBefore = "20261026092544_AddOutputLinks";

    [Fact]
    public async Task Migrate_ExistingProduction_HasNoPlaceholders()
    {
        await using var db = new StudioFlowDbContext(await OptionsAsync());
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(MigrationBefore, TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO productions (id, tenant_id, name, slug, is_active, broadcast, standby_slate, end_slate, created_at, canvas_format, canvas_resolution)
            VALUES ('prd_before0000000001', 'opten', 'Before', 'before', true, 'Standby', '{{"title":"a"}}'::jsonb, '{{"title":"b"}}'::jsonb, now(), 'Widescreen', 'P1080')
            """,
            TestContext.Current.CancellationToken);

        await migrator.MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);
        var production = await db.Productions.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken);

        Assert.Empty(production.Placeholders);
        Assert.Empty(await db.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Placeholders_AreStoredInTheProductionAndReadBack()
    {
        var options = await OptionsAsync();
        var placeholder = SourcePlaceholders.Create("K1", SourceKind.Camera, "camera", "Stage phone with “quotes” 😀");
        await using (var db = new StudioFlowDbContext(options))
        {
            await db.GetService<IMigrator>().MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);
            db.Productions.Add(Production.Restore("prd_roundtrip0000001", "Round trip", "round-trip", DateTimeOffset.UtcNow, CanvasFormat.Widescreen, CanvasResolution.P1080, new SlateDto("a", null, null), new SlateDto("b", null, null), TextSourceRules.DefaultTheme, [], [placeholder], []));
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        await using var other = new StudioFlowDbContext(options);
        var read = await other.Productions.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken);

        Assert.Equal([placeholder], read.Placeholders);
    }

    private async Task<DbContextOptions<StudioFlowDbContext>> OptionsAsync() =>
        new DbContextOptionsBuilder<StudioFlowDbContext>().UseNpgsql(await postgres.CreateDatabaseAsync()).Options;
}
