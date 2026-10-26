using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Opten.StudioFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTexts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "text_sources",
                table: "productions",
                type: "jsonb",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "text_theme",
                table: "productions",
                type: "jsonb",
                nullable: false,
                defaultValue: "{\"accent\":\"#1f6feb\",\"background\":\"#0d1117\",\"foreground\":\"#ffffff\"}");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "text_sources",
                table: "productions");

            migrationBuilder.DropColumn(
                name: "text_theme",
                table: "productions");
        }
    }
}
