using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The migration from one output key per production to named output links keeps every existing output URL working.</summary>
public sealed class OutputLinkMigrationTests(PostgresFixture postgres)
{
    private const string BeforeOutputLinks = "AddTexts";
    private const string OldKey = "old-key-of-the-proxy-aaaaaaaaaaaaaaaaaaaaaaaa";

    [Fact]
    public async Task Up_ExistingProduction_KeepsKeyRestrictionAndNameThemProxy()
    {
        await using var db = await DatabaseBeforeAsync();
        await InsertProductionAsync(db, "prd_one", "one", OldKey, """["10.0.0.0/8"]""");
        await InsertProductionAsync(db, "prd_two", "two", "old-key-of-another-production-bbbbbbbbbbbbbb", "[]");

        await db.GetService<IMigrator>().MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);

        var links = await db.OutputLinks.AsNoTracking().OrderBy(l => l.ProductionId).ToListAsync(TestContext.Current.CancellationToken);
        Assert.Equal(["prd_one", "prd_two"], links.Select(l => l.ProductionId));
        Assert.All(links, l => Assert.Equal("Proxy", l.Name));
        Assert.Equal(OldKey, links[0].Key);
        Assert.Equal(["10.0.0.0/8"], links[0].AllowedIps);
        Assert.Empty(links[1].AllowedIps);
        Assert.Equal(2, links.Select(l => l.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(links, l => Assert.StartsWith("olk_", l.Id, StringComparison.Ordinal));
        Assert.Null(links[0].LastSeenAt);
    }

    [Fact]
    public async Task Up_AuditEntriesOfTheOldKey_NameTheProxyLink()
    {
        await using var db = await DatabaseBeforeAsync();
        await InsertProductionAsync(db, "prd_one", "one", OldKey, "[]");
        foreach (var action in new[] { "output.key.regenerated", "output.access.changed", "scene.live" })
        {
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO audit_entries (production_id, at, actor, action, details) VALUES ('prd_one', now(), 'admin', {0}, '{{\"scene\":\"Welcome\"}}'::jsonb)",
                [action],
                TestContext.Current.CancellationToken);
        }

        await db.GetService<IMigrator>().MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);

        var entries = await db.AuditEntries.AsNoTracking().OrderBy(a => a.Id).ToListAsync(TestContext.Current.CancellationToken);
        Assert.Equal(["Proxy", "Proxy", ""], entries.Select(e => e.Detail("name")));
        Assert.Equal("Welcome", entries[0].Detail("scene"));
    }

    [Fact]
    public async Task Up_ThenDown_RestoresTheOldestLinkAsTheOneKey()
    {
        await using var db = await DatabaseBeforeAsync();
        await InsertProductionAsync(db, "prd_one", "one", OldKey, """["10.0.0.0/8"]""");
        await db.GetService<IMigrator>().MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO output_links (id, production_id, name, key, key_created_at, allowed_ips, created_at) VALUES ('olk_newer', 'prd_one', 'Teams', 'newer-key', now() + interval '1 hour', '[]'::jsonb, now() + interval '1 hour')",
            TestContext.Current.CancellationToken);

        await db.GetService<IMigrator>().MigrateAsync(BeforeOutputLinks, TestContext.Current.CancellationToken);

        await using var connection = new NpgsqlConnection(db.Database.GetConnectionString());
        await connection.OpenAsync(TestContext.Current.CancellationToken);
        await using var command = new NpgsqlCommand("SELECT output_key, allowed_ips::text FROM productions WHERE id = 'prd_one'", connection);
        await using var reader = await command.ExecuteReaderAsync(TestContext.Current.CancellationToken);
        Assert.True(await reader.ReadAsync(TestContext.Current.CancellationToken));
        Assert.Equal(OldKey, reader.GetString(0));
        Assert.Contains("10.0.0.0/8", reader.GetString(1), StringComparison.Ordinal);
    }

    private async Task<StudioFlowDbContext> DatabaseBeforeAsync()
    {
        var options = new DbContextOptionsBuilder<StudioFlowDbContext>().UseNpgsql(await postgres.CreateDatabaseAsync()).Options;
        var db = new StudioFlowDbContext(options);
        await db.GetService<IMigrator>().MigrateAsync(BeforeOutputLinks, TestContext.Current.CancellationToken);
        return db;
    }

    private static Task<int> InsertProductionAsync(StudioFlowDbContext db, string id, string slug, string key, string allowedIps) =>
        db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO productions (id, tenant_id, name, slug, is_active, broadcast, standby_slate, end_slate, output_key, output_key_created_at, allowed_ips, created_at)
            VALUES ({0}, 'opten', {1}, {1}, false, 'Standby', '{{"title":"a"}}'::jsonb, '{{"title":"b"}}'::jsonb, {2}, now(), {3}::jsonb, now())
            """,
            [id, slug, key, allowedIps],
            TestContext.Current.CancellationToken);
}
