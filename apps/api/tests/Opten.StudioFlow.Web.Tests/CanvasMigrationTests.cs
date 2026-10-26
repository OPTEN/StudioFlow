using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The migration of issue #8: productions that exist before it become 16:9 at 1080p, so nothing changes for them.</summary>
public sealed class CanvasMigrationTests(PostgresFixture postgres)
{
    private const string MigrationBefore = "20261023223135_AddTexts";

    [Fact]
    public async Task Migrate_ExistingProduction_BecomesWidescreenAtFullHd()
    {
        await using var db = new StudioFlowDbContext(new DbContextOptionsBuilder<StudioFlowDbContext>().UseNpgsql(await postgres.CreateDatabaseAsync()).Options);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(MigrationBefore, TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO productions (id, tenant_id, name, slug, is_active, broadcast, standby_slate, end_slate, output_key, output_key_created_at, allowed_ips, created_at)
            VALUES ('prd_before0000000001', 'opten', 'Before', 'before', true, 'Standby', '{{"title":"a","subtitle":null,"backgroundAssetId":null}}', '{{"title":"b","subtitle":null,"backgroundAssetId":null}}', 'key', now(), '[]', now())
            """,
            TestContext.Current.CancellationToken);

        await migrator.MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);
        var production = await db.Productions.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken);

        Assert.Equal((CanvasFormat.Widescreen, CanvasResolution.P1080), (production.CanvasFormat, production.CanvasResolution));
        Assert.Equal(CanvasSize.FullHd, production.Canvas);
        Assert.Empty(await db.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken));
    }
}
