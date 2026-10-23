using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Infrastructure.Persistence.Configurations;

/// <summary>Length of ids (prefix + 16 characters; client item ids may be longer, but they live inside jsonb).</summary>
internal static class Columns
{
    public const int Id = 64;
    public const int Name = 200;
    public const int Secret = 100;
    public const int Enum = 32;
}

/// <summary>Table <c>productions</c>.</summary>
internal sealed class ProductionConfiguration : IEntityTypeConfiguration<Production>
{
    public void Configure(EntityTypeBuilder<Production> builder)
    {
        builder.ToTable("productions");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasMaxLength(Columns.Id).ValueGeneratedNever();
        builder.Property(p => p.TenantId).HasMaxLength(Columns.Id).IsRequired();
        builder.Property(p => p.Name).HasMaxLength(Columns.Name).IsRequired();
        builder.Property(p => p.Slug).HasMaxLength(Slugs.MaxLength).IsRequired();
        builder.Property(p => p.Broadcast).HasConversion<string>().HasMaxLength(Columns.Enum);
        builder.Property(p => p.ProgramSceneId).HasMaxLength(Columns.Id);
        builder.Property(p => p.PreviewSceneId).HasMaxLength(Columns.Id);
        builder.Property(p => p.LastTransition).AsJson();
        builder.Property(p => p.StandbySlate).AsJson().IsRequired();
        builder.Property(p => p.EndSlate).AsJson().IsRequired();
        builder.Property(p => p.OutputKey).HasMaxLength(Columns.Secret).IsRequired();
        builder.Property(p => p.AllowedIps).AsJson().IsRequired();
        builder.HasIndex(p => new { p.TenantId, p.Slug }).IsUnique();
        builder.HasIndex(p => p.TenantId).IsUnique().HasFilter("is_active");
        builder.HasIndex(p => p.OutputKey).IsUnique();
        builder.HasMany(p => p.Scenes).WithOne().HasForeignKey(s => s.ProductionId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(p => p.Scenes).HasField("scenes").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Ignore(p => p.OrderedScenes);
    }
}

/// <summary>Table <c>scenes</c>; items are one <c>jsonb</c> array.</summary>
internal sealed class SceneConfiguration : IEntityTypeConfiguration<Scene>
{
    public void Configure(EntityTypeBuilder<Scene> builder)
    {
        builder.ToTable("scenes");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasMaxLength(Columns.Id).ValueGeneratedNever();
        builder.Property(s => s.ProductionId).HasMaxLength(Columns.Id).IsRequired();
        builder.Property(s => s.Name).HasMaxLength(Columns.Name).IsRequired();
        builder.Property(s => s.LayoutMode).HasConversion<string>().HasMaxLength(Columns.Enum);
        builder.Property(s => s.Background).AsJson().IsRequired();
        builder.Property(s => s.Items).AsJson().IsRequired();
        builder.Ignore(s => s.VisibleSources);
    }
}

/// <summary>Table <c>devices</c>; slots are one <c>jsonb</c> array.</summary>
internal sealed class DeviceConfiguration : IEntityTypeConfiguration<Device>
{
    public void Configure(EntityTypeBuilder<Device> builder)
    {
        builder.ToTable("devices");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Id).HasMaxLength(Columns.Id).ValueGeneratedNever();
        builder.Property(d => d.ProductionId).HasMaxLength(Columns.Id).IsRequired();
        builder.Property(d => d.Name).HasMaxLength(Columns.Name).IsRequired();
        builder.Property(d => d.Kind).HasConversion<string>().HasMaxLength(Columns.Enum);
        builder.Property(d => d.Platform).HasMaxLength(Columns.Name).IsRequired();
        builder.Property(d => d.State).HasConversion<string>().HasMaxLength(Columns.Enum);
        builder.Property(d => d.PairingMethod).HasConversion<string>().HasMaxLength(Columns.Enum);
        builder.Property(d => d.SecretHash).HasMaxLength(Columns.Secret).IsRequired();
        builder.Property(d => d.Slots).AsJson().IsRequired();
        builder.HasOne<Production>().WithMany().HasForeignKey(d => d.ProductionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(d => d.ProductionId);
        builder.Ignore(d => d.IsBlocked);
    }
}

/// <summary>Table <c>assets</c>.</summary>
internal sealed class AssetConfiguration : IEntityTypeConfiguration<Asset>
{
    public void Configure(EntityTypeBuilder<Asset> builder)
    {
        builder.ToTable("assets");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).HasMaxLength(Columns.Id).ValueGeneratedNever();
        builder.Property(a => a.ProductionId).HasMaxLength(Columns.Id).IsRequired();
        builder.Property(a => a.Code).HasMaxLength(Columns.Enum).IsRequired();
        builder.Property(a => a.Kind).HasConversion<string>().HasMaxLength(Columns.Enum);
        builder.Property(a => a.Name).HasMaxLength(Columns.Name).IsRequired();
        builder.Property(a => a.ContentType).HasMaxLength(Columns.Enum).IsRequired();
        builder.Property(a => a.FileName).HasMaxLength(Columns.Id).IsRequired();
        builder.HasOne<Production>().WithMany().HasForeignKey(a => a.ProductionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(a => a.ProductionId);
        builder.Ignore(a => a.ContentUrl);
        builder.Ignore(a => a.SourceKind);
    }
}

/// <summary>Table <c>invites</c>.</summary>
internal sealed class InviteConfiguration : IEntityTypeConfiguration<Invite>
{
    public void Configure(EntityTypeBuilder<Invite> builder)
    {
        builder.ToTable("invites");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.Id).HasMaxLength(Columns.Id).ValueGeneratedNever();
        builder.Property(i => i.ProductionId).HasMaxLength(Columns.Id).IsRequired();
        builder.Property(i => i.Kind).HasConversion<string>().HasMaxLength(Columns.Enum);
        builder.Property(i => i.Token).HasMaxLength(Columns.Secret).IsRequired();
        builder.Property(i => i.RedeemedClientId).HasMaxLength(Columns.Name);
        builder.Property(i => i.RedeemedDeviceId).HasMaxLength(Columns.Id);
        builder.HasOne<Production>().WithMany().HasForeignKey(i => i.ProductionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(i => i.Token).IsUnique();
        builder.HasIndex(i => new { i.ProductionId, i.ExpiresAt });
        builder.Ignore(i => i.PairingMethod);
        builder.Ignore(i => i.DeviceKind);
    }
}

/// <summary>Table <c>source_activity</c>: last-live time per device source (restart watch, GAP-08).</summary>
internal sealed class SourceActivityConfiguration : IEntityTypeConfiguration<SourceActivity>
{
    public void Configure(EntityTypeBuilder<SourceActivity> builder)
    {
        builder.ToTable("source_activity");
        builder.HasKey(a => a.SourceId);
        builder.Property(a => a.SourceId).HasMaxLength(Columns.Id + 16).ValueGeneratedNever();
        builder.Property(a => a.ProductionId).HasMaxLength(Columns.Id).IsRequired();
        builder.Property(a => a.DeviceId).HasMaxLength(Columns.Id).IsRequired();
        builder.HasOne<Device>().WithMany().HasForeignKey(a => a.DeviceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(a => a.DeviceId);
        builder.HasIndex(a => a.LastLiveAt);
    }
}

/// <summary>Table <c>audit_entries</c>.</summary>
internal sealed class AuditEntryConfiguration : IEntityTypeConfiguration<AuditEntry>
{
    public void Configure(EntityTypeBuilder<AuditEntry> builder)
    {
        builder.ToTable("audit_entries");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).UseIdentityAlwaysColumn();
        builder.Property(a => a.ProductionId).HasMaxLength(Columns.Id);
        builder.Property(a => a.Actor).HasMaxLength(Columns.Id + 8).IsRequired();
        builder.Property(a => a.Action).HasMaxLength(Columns.Id).IsRequired();
        builder.Property(a => a.Details).AsJson().IsRequired();
        builder.HasIndex(a => new { a.ProductionId, a.Id });
    }
}
