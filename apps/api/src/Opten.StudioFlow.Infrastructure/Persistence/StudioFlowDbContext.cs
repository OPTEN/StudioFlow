using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Infrastructure.Persistence;

/// <summary>
/// The StudioFlow database (PostgreSQL 17): productions with scenes (items as <c>jsonb</c>), devices, assets, invites,
/// the audit log, the Regie account and the last-live times of sources. Tables, columns, keys and indexes use snake_case names.
/// </summary>
public sealed class StudioFlowDbContext(DbContextOptions<StudioFlowDbContext> options) : DbContext(options)
{
    /// <summary>Productions.</summary>
    public DbSet<Production> Productions => Set<Production>();

    /// <summary>Scenes.</summary>
    public DbSet<Scene> Scenes => Set<Scene>();

    /// <summary>Devices.</summary>
    public DbSet<Device> Devices => Set<Device>();

    /// <summary>Assets.</summary>
    public DbSet<Asset> Assets => Set<Asset>();

    /// <summary>Invites.</summary>
    public DbSet<Invite> Invites => Set<Invite>();

    /// <summary>Output links.</summary>
    public DbSet<OutputLink> OutputLinks => Set<OutputLink>();

    /// <summary>Audit log.</summary>
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();

    /// <summary>The Regie account (at most one row).</summary>
    public DbSet<AdminAccount> AdminAccounts => Set<AdminAccount>();

    /// <summary>The server settings of the wizard and the "Server settings" page (at most one row).</summary>
    public DbSet<ServerSettings> ServerSettings => Set<ServerSettings>();

    /// <summary>Last-live times of device sources.</summary>
    internal DbSet<SourceActivity> SourceActivity => Set<SourceActivity>();

    /// <summary>Regie sessions that a logout ended.</summary>
    internal DbSet<RevokedSession> RevokedSessions => Set<RevokedSession>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(StudioFlowDbContext).Assembly);
        ApplySnakeCaseNames(modelBuilder);
    }

    /// <summary>Converts a PascalCase name to snake_case.</summary>
    internal static string ToSnakeCase(string name)
    {
        var builder = new StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (char.IsLower(name[i - 1]) || (i + 1 < name.Length && char.IsLower(name[i + 1]) && char.IsUpper(name[i - 1]))))
                {
                    builder.Append('_');
                }

                builder.Append(char.ToLowerInvariant(c));
            }
            else
            {
                builder.Append(c);
            }
        }

        return builder.ToString();
    }

    private static void ApplySnakeCaseNames(ModelBuilder modelBuilder)
    {
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            var table = entity.GetTableName() ?? ToSnakeCase(entity.ClrType.Name);
            foreach (var property in entity.GetProperties())
            {
                property.SetColumnName(ToSnakeCase(property.Name));
            }

            entity.FindPrimaryKey()?.SetName($"pk_{table}");

            foreach (var foreignKey in entity.GetForeignKeys())
            {
                var columns = string.Join('_', foreignKey.Properties.Select(p => ToSnakeCase(p.Name)));
                foreignKey.SetConstraintName($"fk_{table}_{columns}");
            }

            // An index with a name of its own (a filtered index that shares its columns with another one) keeps it.
            foreach (var index in entity.GetIndexes().Where(i => i.FindAnnotation(RelationalAnnotationNames.Name) is null))
            {
                var columns = string.Join('_', index.Properties.Select(p => ToSnakeCase(p.Name)));
                index.SetDatabaseName($"ix_{table}_{columns}");
            }
        }
    }
}
