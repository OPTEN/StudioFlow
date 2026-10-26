using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The migration of issue #7: productions that exist before the audio mixer start with an empty mixer and videos without sound.</summary>
public sealed class AudioMixerMigrationTests(PostgresFixture postgres)
{
    private const string MigrationBefore = "20261026092544_AddOutputLinks";

    [Fact]
    public async Task Up_ExistingProductionAndVideo_GetAnEmptyMixerAndNoSound()
    {
        await using var db = new StudioFlowDbContext(new DbContextOptionsBuilder<StudioFlowDbContext>().UseNpgsql(await postgres.CreateDatabaseAsync()).Options);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(MigrationBefore, TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO productions (id, tenant_id, name, slug, is_active, broadcast, standby_slate, end_slate, created_at)
            VALUES ('prd_before0000000001', 'opten', 'Before', 'before', true, 'Standby', '{{"title":"a","subtitle":null,"backgroundAssetId":null}}', '{{"title":"b","subtitle":null,"backgroundAssetId":null}}', now());
            INSERT INTO assets (id, production_id, code, kind, name, content_type, size_bytes, file_name, created_at)
            VALUES ('ast_before0000000001', 'prd_before0000000001', 'M1', 'Video', 'Intro', 'video/mp4', 100, 'ast_before0000000001.mp4', now())
            """,
            TestContext.Current.CancellationToken);

        await migrator.MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);
        var production = await db.Productions.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken);
        var asset = await db.Assets.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken);

        Assert.Empty(production.AudioChannels);
        Assert.False(asset.HasAudio);
        Assert.Empty(await db.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken));
    }
}
