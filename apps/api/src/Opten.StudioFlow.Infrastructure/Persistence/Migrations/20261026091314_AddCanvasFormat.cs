using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Opten.StudioFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCanvasFormat : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "canvas_format",
                table: "productions",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "Widescreen");

            migrationBuilder.AddColumn<string>(
                name: "canvas_resolution",
                table: "productions",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "P1080");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "canvas_format",
                table: "productions");

            migrationBuilder.DropColumn(
                name: "canvas_resolution",
                table: "productions");
        }
    }
}
