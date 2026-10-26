using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Opten.StudioFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAuditLogIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_audit_entries_at_id",
                table: "audit_entries",
                columns: new[] { "at", "id" },
                descending: new bool[0]);

            migrationBuilder.CreateIndex(
                name: "ix_audit_entries_at_with_ip",
                table: "audit_entries",
                column: "at",
                filter: "(details ->> 'ip') IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_audit_entries_production_id_at_id",
                table: "audit_entries",
                columns: new[] { "production_id", "at", "id" },
                descending: new[] { false, true, true });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_audit_entries_at_id",
                table: "audit_entries");

            migrationBuilder.DropIndex(
                name: "ix_audit_entries_at_with_ip",
                table: "audit_entries");

            migrationBuilder.DropIndex(
                name: "ix_audit_entries_production_id_at_id",
                table: "audit_entries");
        }
    }
}
