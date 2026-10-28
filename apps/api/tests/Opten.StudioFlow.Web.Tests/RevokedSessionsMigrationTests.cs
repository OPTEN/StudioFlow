using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>
/// The migration that adds the table of signed-out sessions also removes the typed user names that failed sign-ins recorded
/// before (a password put into the user name field must not stay in the audit log, issue #71).
/// </summary>
public sealed class RevokedSessionsMigrationTests(PostgresFixture postgres)
{
    private const string Before = "AddAudioMixer";

    [Fact]
    public async Task Up_RemovesTypedUserNamesThatAreNotTheAccountsFromFailedAndLockedSignIns()
    {
        await using var db = await DatabaseBeforeAsync();
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO admin_account (id, username, password_hash, security_stamp, created_at, password_changed_at) VALUES (1, 'regie', 'h', 's', now(), now())",
            TestContext.Current.CancellationToken);
        await AuditAsync(db, "login.failed", "typed-by-mistake-Passw0rd!");
        await AuditAsync(db, "login.failed", "regie");
        await AuditAsync(db, "login.locked", "typed-by-mistake-Passw0rd!");
        await AuditAsync(db, "login.succeeded", "regie");
        await AuditAsync(db, "scene.live", "kept");

        await db.GetService<IMigrator>().MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);

        var entries = await db.AuditEntries.AsNoTracking().OrderBy(a => a.Id).ToListAsync(TestContext.Current.CancellationToken);
        Assert.Equal(["", "regie", "", "regie", "kept"], entries.Select(e => e.Detail("username")));
        Assert.All(entries, e => Assert.Equal("203.0.113.5", e.Detail("ip")));
        Assert.Equal(0, await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM admin_revoked_session").SingleAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Up_WithoutAnAccount_RemovesEveryTypedUserName()
    {
        await using var db = await DatabaseBeforeAsync();
        await AuditAsync(db, "login.failed", "anything");

        await db.GetService<IMigrator>().MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal(string.Empty, (await db.AuditEntries.AsNoTracking().SingleAsync(TestContext.Current.CancellationToken)).Detail("username"));
    }

    [Fact]
    public async Task Down_DropsTheTable()
    {
        await using var db = await DatabaseBeforeAsync();
        await db.GetService<IMigrator>().MigrateAsync(cancellationToken: TestContext.Current.CancellationToken);

        await db.GetService<IMigrator>().MigrateAsync(Before, TestContext.Current.CancellationToken);

        Assert.Equal(0, await db.Database.SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM information_schema.tables WHERE table_name = 'admin_revoked_session'").SingleAsync(TestContext.Current.CancellationToken));
    }

    private static Task<int> AuditAsync(StudioFlowDbContext db, string action, string username) =>
        db.Database.ExecuteSqlRawAsync(
            "INSERT INTO audit_entries (production_id, at, actor, action, details) VALUES (NULL, now(), 'admin', {0}, jsonb_build_object('username', {1}::text, 'ip', '203.0.113.5'))",
            [action, username],
            TestContext.Current.CancellationToken);

    private async Task<StudioFlowDbContext> DatabaseBeforeAsync()
    {
        var options = new DbContextOptionsBuilder<StudioFlowDbContext>().UseNpgsql(await postgres.CreateDatabaseAsync()).Options;
        var db = new StudioFlowDbContext(options);
        await db.GetService<IMigrator>().MigrateAsync(Before, TestContext.Current.CancellationToken);
        return db;
    }
}
