using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Opten.StudioFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOutputLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "output_links",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    production_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    key_created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    allowed_ips = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_output_links", x => x.id);
                    table.ForeignKey(
                        name: "fk_output_links_production_id",
                        column: x => x.production_id,
                        principalTable: "productions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_output_links_key",
                table: "output_links",
                column: "key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_output_links_production_id",
                table: "output_links",
                column: "production_id");

            // The one key of every production becomes its first link "Proxy", so existing proxies keep working with
            // the same URL and the same IP restriction.
            migrationBuilder.Sql(
                """
                INSERT INTO output_links (id, production_id, name, key, key_created_at, allowed_ips, created_at)
                SELECT 'olk_' || substr(md5(id), 1, 16), id, 'Proxy', output_key, output_key_created_at, allowed_ips, created_at
                FROM productions;
                """);

            // Log entries of the old key and access changes name the link they belong to.
            migrationBuilder.Sql(
                """
                UPDATE audit_entries SET details = details || '{"name": "Proxy"}'::jsonb
                WHERE action IN ('output.key.regenerated', 'output.access.changed');
                """);

            migrationBuilder.DropIndex(
                name: "ix_productions_output_key",
                table: "productions");

            migrationBuilder.DropColumn(
                name: "allowed_ips",
                table: "productions");

            migrationBuilder.DropColumn(
                name: "output_key",
                table: "productions");

            migrationBuilder.DropColumn(
                name: "output_key_created_at",
                table: "productions");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "allowed_ips",
                table: "productions",
                type: "jsonb",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "output_key",
                table: "productions",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "output_key_created_at",
                table: "productions",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            // The oldest link of a production becomes its one key again; a production without a link gets a new key.
            migrationBuilder.Sql(
                """
                UPDATE productions p SET
                    output_key = COALESCE(l.key, md5(random()::text || p.id) || md5(random()::text)),
                    output_key_created_at = COALESCE(l.key_created_at, p.created_at),
                    allowed_ips = COALESCE(l.allowed_ips, '[]'::jsonb)
                FROM productions p2
                LEFT JOIN LATERAL (
                    SELECT key, key_created_at, allowed_ips FROM output_links
                    WHERE production_id = p2.id ORDER BY created_at, id LIMIT 1
                ) l ON true
                WHERE p.id = p2.id;
                """);

            migrationBuilder.DropTable(
                name: "output_links");

            migrationBuilder.CreateIndex(
                name: "ix_productions_output_key",
                table: "productions",
                column: "output_key",
                unique: true);
        }
    }
}
