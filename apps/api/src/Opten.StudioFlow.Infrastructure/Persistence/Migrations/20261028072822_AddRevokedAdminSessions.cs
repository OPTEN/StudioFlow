using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Opten.StudioFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRevokedAdminSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "admin_revoked_session",
                columns: table => new
                {
                    session_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    revoked_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_admin_revoked_session", x => x.session_id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_admin_revoked_session_revoked_until",
                table: "admin_revoked_session",
                column: "revoked_until");

            // Failed sign-ins used to record up to 100 characters of the typed user name, which can be a password put into the
            // wrong field. From now on only the name of the account is recorded: remove what is there from every older entry
            // whose typed name is not the account's (the login.locked entries carried it as well).
            migrationBuilder.Sql(
                """
                update audit_entries
                set details = details - 'username'
                where action in ('login.failed', 'login.locked')
                  and details ? 'username'
                  and (details ->> 'username') is distinct from (select username from admin_account limit 1);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "admin_revoked_session");
        }
    }
}
