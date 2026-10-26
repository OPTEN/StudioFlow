using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Opten.StudioFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddServerSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "server_settings",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                    media_address = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true),
                    tls_mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    domain = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: true),
                    acme_email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    dns_challenge_domain = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: true),
                    dns_credentials_protected = table.Column<string>(type: "character varying(65536)", maxLength: 65536, nullable: true),
                    certificate_pem = table.Column<string>(type: "character varying(65536)", maxLength: 65536, nullable: true),
                    private_key_protected = table.Column<string>(type: "character varying(65536)", maxLength: 65536, nullable: true),
                    frame_ancestors = table.Column<string>(type: "character varying(5120)", maxLength: 5120, nullable: false),
                    backup_schedule = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    backup_timezone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    backup_keep_daily = table.Column<int>(type: "integer", nullable: false),
                    backup_keep_weekly = table.Column<int>(type: "integer", nullable: false),
                    rclone_remote = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: true),
                    rclone_config_protected = table.Column<string>(type: "character varying(131072)", maxLength: 131072, nullable: true),
                    age_recipients = table.Column<string>(type: "character varying(640)", maxLength: 640, nullable: false),
                    offsite_unencrypted = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_server_settings", x => x.id);
                    table.CheckConstraint("ck_server_settings_only_row", "id = 1");
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "server_settings");
        }
    }
}
