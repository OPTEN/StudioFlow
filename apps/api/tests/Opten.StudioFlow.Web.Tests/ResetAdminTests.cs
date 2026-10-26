using System.Net;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Hosting;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The <c>reset-admin</c> command for a forgotten password (issue #4).</summary>
public sealed class ResetAdminTests(PostgresFixture postgres)
{
    private const string Password = "A-Long-Passphrase-1";

    [Fact]
    public async Task ResetAdmin_Yes_DeletesTheAccountAndTheRunningApiReopensTheSetupWithANewCode()
    {
        await using var app = new StudioFlowApp(postgres);
        await app.InitializeAsync();
        var admin = await app.AdminAsync();
        await using var hub = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var closed = HubClosed.Watch(hub);
        await hub.StartAsync(TestContext.Current.CancellationToken);

        var (code, output, _) = await RunAsync(app, "", CliCommands.YesOption);
        await WaitForAsync(() => app.Service<AdminAccountState>().SetupRequired);

        Assert.Equal(0, code);
        Assert.Contains("The Regie account was deleted", output, StringComparison.Ordinal);
        await closed.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        Assert.Equal("""{"setupRequired":true}""", await app.Anonymous().GetStringAsync("/api/auth/setup", TestContext.Current.CancellationToken));
        await app.Anonymous().PostJsonAsync("/api/auth/login", new LoginRequest(StudioFlowApp.AdminUser, StudioFlowApp.AdminPassword)).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        var oldSession = app.Anonymous();
        oldSession.DefaultRequestHeaders.Add("Cookie", admin.Cookie);
        await oldSession.GetAsync("/api/auth/me", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        var newCode = app.Service<SetupCode>().Current!;
        Assert.Contains(app.Logs.Entries, e => e.Message.Contains($"Setup code: {newCode}", StringComparison.Ordinal));
        await app.Anonymous().PostJsonAsync("/api/auth/setup", new SetupRequest(newCode, "second-admin", Password)).ExpectAsync(HttpStatusCode.OK);
        await using var db = await app.Service<Microsoft.EntityFrameworkCore.IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        var reset = await db.AuditEntries.AsNoTracking().SingleAsync(a => a.Action == AuditActions.AccountReset, TestContext.Current.CancellationToken);
        Assert.Equal((null, AuditActors.System), (reset.ProductionId, reset.Actor));
    }

    [Fact]
    public async Task ResetAdmin_ThenRestart_SetupIsOpenWithANewCode()
    {
        string database;
        await using (var first = new StudioFlowApp(postgres))
        {
            await first.InitializeAsync();
            database = first.ConnectionString;
            Assert.Equal(0, (await RunAsync(first, "", CliCommands.YesOption)).Code);
        }

        await using var second = new RestartedFirstRunApp(postgres, database);
        await second.InitializeAsync();

        Assert.True(second.Service<AdminAccountState>().SetupRequired);
        Assert.NotNull(second.Service<SetupCode>().Current);
    }

    [Fact]
    public async Task ResetAdmin_WithoutYes_AsksAndOnlyTypedYesDeletes()
    {
        await using var app = new StudioFlowApp(postgres);
        await app.InitializeAsync();

        var (declined, prompt, declinedError) = await RunAsync(app, "no\n");
        var (endOfInput, _, _) = await RunAsync(app, string.Empty);
        await app.Service<AdminAccountState>().RefreshAsync(TestContext.Current.CancellationToken);
        var stillThere = !app.Service<AdminAccountState>().SetupRequired;
        var (accepted, _, _) = await RunAsync(app, "yes\n");

        Assert.Equal((CliCommands.NotConfirmedExitCode, CliCommands.NotConfirmedExitCode), (declined, endOfInput));
        Assert.Contains("Type yes to continue", prompt, StringComparison.Ordinal);
        Assert.Contains("not changed", declinedError, StringComparison.Ordinal);
        Assert.True(stillThere);
        Assert.Equal(0, accepted);
        await WaitForAsync(() => app.Service<AdminAccountState>().SetupRequired);
    }

    [Fact]
    public async Task ResetAdmin_NoAccount_SaysSoAndSucceeds()
    {
        await using var app = new FirstRunApp(postgres);
        await app.InitializeAsync();

        var (code, output, error) = await RunAsync(app, "", CliCommands.YesOption);

        Assert.True(code == 0, error);
        Assert.Contains("There is no Regie account", output, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ResetAdmin_DatabaseDown_ExitsWithOneWithoutLeakingTheConnectionString()
    {
        using var output = new StringWriter();
        using var error = new StringWriter();

        var code = await CliCommands.ResetAdminAsync([CliCommands.YesOption, "--ConnectionStrings:StudioFlow=Host=127.0.0.1;Port=1;Password=leak-me;Timeout=1"], new StringReader(string.Empty), output, error);

        Assert.Equal(1, code);
        Assert.DoesNotContain("leak-me", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task TryRunAsync_HashPasswordIsNoCommandAnyMore() =>
        Assert.Null(await CliCommands.TryRunAsync(["hash-password"]));

    private static async Task<(int Code, string Output, string Error)> RunAsync(StudioFlowApp app, string input, params string[] options)
    {
        using var output = new StringWriter();
        using var error = new StringWriter();
        var code = await CliCommands.ResetAdminAsync([.. options, $"--ConnectionStrings:StudioFlow={app.ConnectionString}"], new StringReader(input), output, error);
        return (code, output.ToString(), error.ToString());
    }

    /// <summary>The running API notices the reset on its next maintenance tick (every 5 s).</summary>
    private static async Task WaitForAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
        while (!condition())
        {
            Assert.True(DateTime.UtcNow < deadline, "the API did not notice the reset within 20 s");
            await Task.Delay(100, TestContext.Current.CancellationToken);
        }
    }
}
