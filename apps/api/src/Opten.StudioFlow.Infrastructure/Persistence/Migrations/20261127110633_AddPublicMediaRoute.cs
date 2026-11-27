using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Opten.StudioFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPublicMediaRoute : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "public_media_address",
                table: "server_settings",
                type: "character varying(15)",
                maxLength: 15,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "use_public_media_address",
                table: "server_settings",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "public_media_address",
                table: "server_settings");

            migrationBuilder.DropColumn(
                name: "use_public_media_address",
                table: "server_settings");
        }
    }
}
