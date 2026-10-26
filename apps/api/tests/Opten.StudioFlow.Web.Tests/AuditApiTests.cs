using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;
using Opten.StudioFlow.Infrastructure.Persistence;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>Direct access to the audit table for tests that need rows of a certain age or amount.</summary>
internal static class AuditSeed
{
    public static async Task AddAsync(StudioFlowApp app, params AuditEntry[] entries)
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        db.AuditEntries.AddRange(entries);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
    }

    public static AuditEntry Entry(string? production, DateTimeOffset at, string action = AuditActions.SceneLive, string actor = AuditActors.Admin, params (string Key, string Value)[] details) =>
        AuditEntry.Create(production, at, actor, action, details.ToDictionary(d => d.Key, d => d.Value, StringComparer.Ordinal));

    public static async Task<List<AuditEntry>> AllAsync(StudioFlowApp app)
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        return await db.AuditEntries.AsNoTracking().OrderBy(a => a.Id).ToListAsync(TestContext.Current.CancellationToken);
    }

    public static async Task ExecuteAsync(StudioFlowApp app, string sql)
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlRawAsync(sql, TestContext.Current.CancellationToken);
    }

    public static DateTimeOffset Micros(DateTimeOffset time) => time.AddTicks(-(time.Ticks % 10));
}

/// <summary>The admin-only audit endpoints: authorisation, filters, paging and input validation.</summary>
public sealed class AuditApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static readonly DateTimeOffset Base = new(2026, 3, 1, 10, 0, 0, TimeSpan.Zero);

    private static Task<AuditPageDto> PageAsync(HttpClient client, string query) =>
        client.GetAsync("/api/audit" + query, TestContext.Current.CancellationToken).ExpectAsync<AuditPageDto>();

    private static async Task<List<AuditEntryDto>> AllPagesAsync(HttpClient client, string query, int limit = 200)
    {
        var all = new List<AuditEntryDto>();
        string? cursor = null;
        do
        {
            var page = await PageAsync(client, $"{query}&limit={limit}" + (cursor is null ? string.Empty : "&cursor=" + cursor));
            all.AddRange(page.Entries);
            cursor = page.NextCursor;
        }
        while (cursor is not null);
        return all;
    }

    [Theory]
    [InlineData("/api/audit")]
    [InlineData("/api/audit/export.csv")]
    [InlineData("/api/audit/export.json")]
    public async Task Routes_WithoutSession_AreUnauthorized(string path) =>
        Assert.Equal(ErrorCodes.Unauthorized, await app.Anonymous().GetAsync(path, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized));

    [Theory]
    [InlineData("/api/audit")]
    [InlineData("/api/audit/export.csv")]
    [InlineData("/api/audit/export.json")]
    public async Task Routes_WithADeviceToken_AreUnauthorized(string path)
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);

        await app.DeviceClient(credentials).GetAsync(path, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.DeviceClient(credentials with { DeviceSecret = "wrong" }).GetAsync(path, TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Routes_WithABlockedDevice_AreStillRefused()
    {
        var admin = await app.AdminAsync();
        var credentials = await app.PairPhoneAsync(admin);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/devices/{credentials.DeviceId}/block", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        await app.DeviceClient(credentials).GetAsync("/api/audit", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Routes_WithAnOutputKey_AreUnauthorized()
    {
        var admin = await app.AdminAsync();
        var output = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("X-Output-Key", output.Url[(output.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..]);

        await client.GetAsync("/api/audit", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task List_NewestFirst_WithTheNamesAndTextsOfTheEntries()
    {
        var admin = await app.AdminAsync();
        await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Listing")).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var page = await PageAsync(admin.Client, "?limit=200");

        Assert.Equal(page.Entries.Select(e => (e.At, e.Id)).OrderDescending(), page.Entries.Select(e => (e.At, e.Id)));
        var created = page.Entries.First(e => e.Action == AuditActions.ProductionCreated && e.Details["name"] == "Listing");
        Assert.Equal((AuditCategory.Production, LogCode.ProductionCreated, "Production “Listing” created", "Listing", "admin"), (created.Category, created.Code, created.Text, created.ProductionName, created.Actor));
    }

    [Fact]
    public async Task List_FiltersByTimeRange_FromInclusiveToExclusive()
    {
        var admin = await app.AdminAsync();
        var production = "prd_range_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, 5).Select(i => AuditSeed.Entry(production, Base.AddHours(i)))]);

        var inRange = await AllPagesAsync(admin.Client, $"?production={production}&from={Uri.EscapeDataString(Base.AddHours(1).ToString("O"))}&to={Uri.EscapeDataString(Base.AddHours(4).ToString("O"))}");

        Assert.Equal([Base.AddHours(3), Base.AddHours(2), Base.AddHours(1)], inRange.Select(e => e.At));
    }

    [Fact]
    public async Task List_FiltersByProduction_ByNoProductionAndByActor()
    {
        var admin = await app.AdminAsync();
        var tag = Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(
            app,
            AuditSeed.Entry("prd_a_" + tag, Base, actor: AuditActors.Admin),
            AuditSeed.Entry("prd_b_" + tag, Base, actor: AuditActors.System),
            AuditSeed.Entry(null, Base, AuditActions.LoginFailed, AuditActors.Admin, (AuditDetails.Username, "who" + tag)));

        Assert.Equal(["prd_a_" + tag], (await AllPagesAsync(admin.Client, $"?production=prd_a_{tag}")).Select(e => e.ProductionId));
        var global = await AllPagesAsync(admin.Client, $"?production=none&q=who{tag}");
        Assert.Equal([AuditActions.LoginFailed], global.Select(e => e.Action));
        Assert.Null(global[0].ProductionId);
        Assert.Equal(["prd_b_" + tag], (await AllPagesAsync(admin.Client, $"?production=prd_b_{tag}&actor=system")).Select(e => e.ProductionId));
        Assert.Empty(await AllPagesAsync(admin.Client, $"?production=prd_a_{tag}&actor=system"));
    }

    [Fact]
    public async Task List_FiltersByCategoryAndAction()
    {
        var admin = await app.AdminAsync();
        var production = "prd_cat_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(
            app,
            AuditSeed.Entry(production, Base, AuditActions.SceneLive),
            AuditSeed.Entry(production, Base, AuditActions.DeviceBlocked),
            AuditSeed.Entry(production, Base, AuditActions.AssetUploaded),
            AuditSeed.Entry(production, Base, AuditActions.OutputKeyRegenerated));

        Assert.Equal([AuditActions.AssetUploaded], (await AllPagesAsync(admin.Client, $"?production={production}&category=media")).Select(e => e.Action));
        Assert.Equal(
            [AuditActions.OutputKeyRegenerated, AuditActions.DeviceBlocked],
            (await AllPagesAsync(admin.Client, $"?production={production}&category=devices&category=output")).Select(e => e.Action));
        Assert.Equal([AuditActions.SceneLive], (await AllPagesAsync(admin.Client, $"?production={production}&action=scene.live&action=login.failed")).Select(e => e.Action));
        Assert.Empty(await AllPagesAsync(admin.Client, $"?production={production}&category=media&action=scene.live"));
    }

    [Fact]
    public async Task List_FreeText_FindsDetailsAndActionInAnyCase_AndTreatsWildcardsAsText()
    {
        var admin = await app.AdminAsync();
        var production = "prd_text_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(
            app,
            AuditSeed.Entry(production, Base, AuditActions.DevicePaired, AuditActors.Admin, (AuditDetails.Device, "Lena’s Zürich Laptop"), (AuditDetails.Codes, "S1")),
            AuditSeed.Entry(production, Base, AuditActions.DevicePaired, AuditActors.Admin, (AuditDetails.Device, "100% sure_name")),
            AuditSeed.Entry(production, Base, AuditActions.DeviceBlocked, AuditActors.Admin, (AuditDetails.Device, "Other")));

        Assert.Single(await AllPagesAsync(admin.Client, $"?production={production}&q={Uri.EscapeDataString("zürich")}"));
        Assert.Equal(2, (await AllPagesAsync(admin.Client, $"?production={production}&q=DEVICE.PAIRED")).Count);
        Assert.Single(await AllPagesAsync(admin.Client, $"?production={production}&q={Uri.EscapeDataString("100%")}"));
        Assert.Single(await AllPagesAsync(admin.Client, $"?production={production}&q={Uri.EscapeDataString("sure_name")}"));
        Assert.Empty(await AllPagesAsync(admin.Client, $"?production={production}&q={Uri.EscapeDataString("sure%name")}"));
        Assert.Empty(await AllPagesAsync(admin.Client, $"?production={production}&q={Uri.EscapeDataString("%")}&category=output"));
        Assert.Empty(await AllPagesAsync(admin.Client, $"?production={production}&q=nothing-like-this"));
    }

    [Theory]
    [InlineData("' OR '1'='1")]
    [InlineData("'; DROP TABLE audit_entries; --")]
    [InlineData("\\")]
    [InlineData("\"; SELECT pg_sleep(30); --")]
    public async Task List_SqlInTheFilters_IsOnlyText(string attack)
    {
        var admin = await app.AdminAsync();
        var production = "prd_inj_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, AuditSeed.Entry(production, Base, AuditActions.DevicePaired, AuditActors.Admin, (AuditDetails.Device, attack)));
        var escaped = Uri.EscapeDataString(attack);

        Assert.Single(await AllPagesAsync(admin.Client, $"?production={production}&q={escaped}"));
        Assert.Empty(await AllPagesAsync(admin.Client, $"?production={production}&actor={escaped}"));
        Assert.Empty(await AllPagesAsync(admin.Client, $"?production={escaped}"));
        Assert.Contains(await AuditSeed.AllAsync(app), a => a.ProductionId == production);
    }

    [Theory]
    [InlineData("from=yesterday", "from")]
    [InlineData("to=31.31.2026", "to")]
    [InlineData("from=2026-03-02T00:00:00Z&to=2026-03-01T00:00:00Z", "to")]
    [InlineData("from=2026-03-02T00:00:00Z&to=2026-03-02T00:00:00Z", "to")]
    [InlineData("category=everything", "category")]
    [InlineData("action=scene.explode", "action")]
    [InlineData("limit=0", "limit")]
    [InlineData("limit=-5", "limit")]
    [InlineData("limit=201", "limit")]
    [InlineData("cursor=not-a-cursor", "cursor")]
    [InlineData("q=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "q")]
    public async Task List_InvalidInput_IsAValidationProblemNamingTheField(string query, string field)
    {
        var admin = await app.AdminAsync();
        using var response = await admin.Client.GetAsync("/api/audit?" + query, TestContext.Current.CancellationToken);

        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        Assert.True(json.RootElement.GetProperty("errors").TryGetProperty(field, out _), await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task List_LimitNotANumber_IsABadRequest()
    {
        var admin = await app.AdminAsync();

        await admin.Client.GetAsync("/api/audit?limit=many", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task List_LimitAtTheBounds_IsAccepted()
    {
        var admin = await app.AdminAsync();

        Assert.Single((await PageAsync(admin.Client, "?limit=1")).Entries);
        Assert.True((await PageAsync(admin.Client, "?limit=200")).Entries.Count <= 200);
    }

    [Fact]
    public async Task List_EmptyResult_IsAnEmptyPage()
    {
        var admin = await app.AdminAsync();

        var page = await PageAsync(admin.Client, "?production=prd_none_such");

        Assert.Empty(page.Entries);
        Assert.Null(page.NextCursor);
    }

    [Fact]
    public async Task Paging_EntriesWithTheSameTimestamp_AreNeitherSkippedNorRepeated()
    {
        var admin = await app.AdminAsync();
        var production = "prd_same_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, 130).Select(i => AuditSeed.Entry(production, Base.AddSeconds(i / 40)))]);

        var all = await AllPagesAsync(admin.Client, $"?production={production}", limit: 7);

        Assert.Equal(130, all.Count);
        Assert.Equal(130, all.Select(e => e.Id).Distinct().Count());
        Assert.Equal(all.Select(e => (e.At, e.Id)).OrderDescending(), all.Select(e => (e.At, e.Id)));
    }

    [Fact]
    public async Task Paging_WhileNewEntriesArrive_ContinuesExactlyWhereThePreviousPageEnded()
    {
        var admin = await app.AdminAsync();
        var production = "prd_live_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, 60).Select(i => AuditSeed.Entry(production, Base.AddMinutes(i / 3)))]);
        var first = await PageAsync(admin.Client, $"?production={production}&limit=25");
        var original = (await AllPagesAsync(admin.Client, $"?production={production}")).Select(e => e.Id).ToList();

        // Newer entries, and entries that share the time of the cursor but were written later.
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, 12).Select(i => AuditSeed.Entry(production, Base.AddDays(1).AddSeconds(i)))]);
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, 4).Select(_ => AuditSeed.Entry(production, first.Entries[^1].At))]);
        var rest = new List<AuditEntryDto>();
        var cursor = first.NextCursor;
        while (cursor is not null)
        {
            var page = await PageAsync(admin.Client, $"?production={production}&limit=25&cursor={cursor}");
            rest.AddRange(page.Entries);
            cursor = page.NextCursor;
        }

        Assert.Equal(original, first.Entries.Concat(rest).Select(e => e.Id));
        Assert.Equal(16, (await AllPagesAsync(admin.Client, $"?production={production}")).Count - original.Count);
    }

    [Fact]
    public async Task Paging_WithInsertsRunningInParallel_NeverRepeatsOrLosesAnEntry()
    {
        var admin = await app.AdminAsync();
        var production = "prd_par_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, 200).Select(i => AuditSeed.Entry(production, Base.AddSeconds(i / 5)))]);
        var original = (await AllPagesAsync(admin.Client, $"?production={production}")).Select(e => e.Id).ToHashSet();
        using var stop = new CancellationTokenSource();
        var writer = Task.Run(
            async () =>
            {
                var n = 0;
                while (!stop.IsCancellationRequested)
                {
                    await AuditSeed.AddAsync(app, AuditSeed.Entry(production, Base.AddDays(2).AddSeconds(n++)));
                }
            },
            TestContext.Current.CancellationToken);

        var seen = await AllPagesAsync(admin.Client, $"?production={production}", limit: 10);
        await stop.CancelAsync();
        await writer;

        Assert.Equal(seen.Count, seen.Select(e => e.Id).Distinct().Count());
        Assert.Empty(original.Except(seen.Select(e => e.Id)));
    }

    [Fact]
    public async Task List_LegacyPhoneQrInviteEntries_AreHidden()
    {
        var admin = await app.AdminAsync();
        var production = "prd_qr_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(
            app,
            AuditSeed.Entry(production, Base, AuditActions.InviteCreated, AuditActors.System, (AuditDetails.Kind, "PhoneQr")),
            AuditSeed.Entry(production, Base, AuditActions.InviteRevoked, AuditActors.Admin, (AuditDetails.Kind, "PhoneQr")),
            AuditSeed.Entry(production, Base, AuditActions.InviteCreated, AuditActors.Admin, (AuditDetails.Kind, "LaptopLink")));

        var entries = await AllPagesAsync(admin.Client, $"?production={production}");

        Assert.Equal("LaptopLink", Assert.Single(entries).Details[AuditDetails.Kind]);
    }

    [Fact]
    public async Task Indexes_ForTheNewestFirstReadsAndTheRetentionExist()
    {
        await using var db = await app.Service<IDbContextFactory<StudioFlowDbContext>>().CreateDbContextAsync(TestContext.Current.CancellationToken);

        var indexes = await db.Database.SqlQueryRaw<string>("SELECT indexdef AS \"Value\" FROM pg_indexes WHERE tablename = 'audit_entries'").ToListAsync(TestContext.Current.CancellationToken);

        Assert.Contains(indexes, i => i.Contains("(at DESC, id DESC)", StringComparison.Ordinal));
        Assert.Contains(indexes, i => i.Contains("(production_id, at DESC, id DESC)", StringComparison.Ordinal));
        Assert.Contains(indexes, i => i.Contains("ix_audit_entries_at_with_ip", StringComparison.Ordinal) && i.Contains("WHERE", StringComparison.Ordinal));
    }
}

/// <summary>The exports: format, quoting, the log entry, the size limit and the rate limit.</summary>
public sealed class AuditExportApiTests(LimitedExportApp app) : IClassFixture<LimitedExportApp>
{
    private static readonly DateTimeOffset Base = new(2026, 3, 1, 10, 0, 0, TimeSpan.Zero);

    private static async Task<(HttpResponseMessage Response, byte[] Bytes)> DownloadAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        return (response, await response.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
    }

    private async Task<string> SeedAsync(params AuditEntry[] extra)
    {
        var production = "prd_exp_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, 3).Select(i => AuditSeed.Entry(production, Base.AddMinutes(i), AuditActions.SceneLive, AuditActors.Admin, (AuditDetails.Scene, $"Scene {i}"))), .. extra.Select(e => AuditEntry.Create(production, e.At, e.Actor, e.Action, e.Details))]);
        return production;
    }

    [Fact]
    public async Task Csv_IsUtf8WithBomAndHasAHeaderTheRowsAndADatedFileName()
    {
        var admin = await app.AdminAsync();
        var production = await SeedAsync();

        var (response, bytes) = await DownloadAsync(admin.Client, $"/api/audit/export.csv?production={production}");
        using var _ = response;

        await response.ExpectAsync(HttpStatusCode.OK);
        Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("utf-8", response.Content.Headers.ContentType?.CharSet);
        Assert.Matches("^attachment; filename=\"studioflow-audit-\\d{4}-\\d{2}-\\d{2}\\.csv\"$", response.Content.Headers.ContentDisposition!.ToString());
        Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
        var lines = Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("time,actor,category,action,description,production,production_id,details", lines[0]);
        Assert.Equal(4, lines.Length);
        Assert.StartsWith("2026-03-01T10:02:00.000Z,admin,production,scene.live,Scene “Scene 2” is live,", lines[1], StringComparison.Ordinal);
    }

    [Fact]
    public async Task Csv_WithTheSemicolonSeparator_UsesItAndOtherSeparatorsAreRefused()
    {
        var admin = await app.AdminAsync();
        var production = await SeedAsync();

        var (response, bytes) = await DownloadAsync(admin.Client, $"/api/audit/export.csv?production={production}&separator=semicolon");
        using var _ = response;

        Assert.StartsWith("time;actor;category;action;description;production;production_id;details\r\n", Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3), StringComparison.Ordinal);
        await admin.Client.GetAsync("/api/audit/export.csv?separator=tab", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Csv_NamesThatStartLikeAFormula_AreNeutralisedAndQuotesAndUmlautsSurvive()
    {
        var admin = await app.AdminAsync();
        var production = await SeedAsync(
            AuditSeed.Entry(null, Base.AddHours(1), AuditActions.DevicePaired, AuditActors.Admin, (AuditDetails.Device, "=HYPERLINK(\"http://evil.example\",\"x\")"), (AuditDetails.Codes, "")),
            AuditSeed.Entry(null, Base.AddHours(2), AuditActions.DevicePaired, AuditActors.Admin, (AuditDetails.Device, "@SUM(1+1)"), (AuditDetails.Codes, "")),
            AuditSeed.Entry(null, Base.AddHours(3), AuditActions.DevicePaired, AuditActors.Admin, (AuditDetails.Device, "+41 79"), (AuditDetails.Codes, "")),
            AuditSeed.Entry(null, Base.AddHours(4), AuditActions.DevicePaired, AuditActors.Admin, (AuditDetails.Device, "Zoë, “the \"best\"” phone"), (AuditDetails.Codes, "K1")));

        var (response, bytes) = await DownloadAsync(admin.Client, $"/api/audit/export.csv?production={production}&action=device.paired");
        using var _ = response;
        var text = Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);

        Assert.Contains("\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"x\"\") paired\"", text, StringComparison.Ordinal);
        Assert.Contains(",'@SUM(1+1) paired,", text, StringComparison.Ordinal);
        Assert.Contains(",'+41 79 paired,", text, StringComparison.Ordinal);
        Assert.Contains("\"K1 Zoë, “the \"\"best\"\"” phone paired\"", text, StringComparison.Ordinal);
        Assert.DoesNotContain(",=HYPERLINK", text, StringComparison.Ordinal);
        Assert.DoesNotContain("\n=", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Json_IsAnArrayOfTheSameEntriesWithADatedFileName()
    {
        var admin = await app.AdminAsync();
        var production = await SeedAsync();

        var (response, bytes) = await DownloadAsync(admin.Client, $"/api/audit/export.json?production={production}");
        using var _ = response;

        await response.ExpectAsync(HttpStatusCode.OK);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Matches("filename=\"?studioflow-audit-\\d{4}-\\d{2}-\\d{2}\\.json", response.Content.Headers.ContentDisposition!.ToString());
        var entries = JsonSerializer.Deserialize<List<AuditEntryDto>>(bytes, ContractJson.Options)!;
        Assert.Equal(3, entries.Count);
        Assert.Equal(["Scene 2", "Scene 1", "Scene 0"], entries.Select(e => e.Details["scene"]));
    }

    [Fact]
    public async Task Export_RespectsTheFiltersAndIsLoggedAsAnAuditEntry()
    {
        var admin = await app.AdminAsync();
        var production = await SeedAsync();
        var (response, _) = await DownloadAsync(admin.Client, $"/api/audit/export.csv?production={production}&q=Scene%201");
        response.Dispose();

        var entry = (await AuditSeed.AllAsync(app)).Last(a => a.Action == AuditActions.AuditExported);

        Assert.Equal((AuditActors.Admin, "csv", "1", production, "Scene 1"), (entry.Actor, entry.Detail(AuditDetails.Format), entry.Detail(AuditDetails.Rows), entry.Detail("production"), entry.Detail("q")));
    }

    [Fact]
    public async Task Export_OfNothing_IsAHeaderOnly()
    {
        var admin = await app.AdminAsync();

        var (response, bytes) = await DownloadAsync(admin.Client, "/api/audit/export.csv?production=prd_nothing_here");
        using var _ = response;

        Assert.Single(Encoding.UTF8.GetString(bytes).Split("\r\n", StringSplitOptions.RemoveEmptyEntries));
    }

    [Fact]
    public async Task Export_MoreRowsThanTheLimit_IsRefusedWithoutAnEntryAndWithoutBytes()
    {
        var admin = await app.AdminAsync();
        var production = "prd_big_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, [.. Enumerable.Range(0, LimitedExportApp.MaxRows + 1).Select(i => AuditSeed.Entry(production, Base.AddSeconds(i)))]);
        var before = (await AuditSeed.AllAsync(app)).Count(a => a.Action == AuditActions.AuditExported);

        Assert.Equal(ErrorCodes.LimitReached, await admin.Client.GetAsync($"/api/audit/export.csv?production={production}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict));
        Assert.Equal(ErrorCodes.LimitReached, await admin.Client.GetAsync($"/api/audit/export.json?production={production}", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict));
        Assert.Equal(before, (await AuditSeed.AllAsync(app)).Count(a => a.Action == AuditActions.AuditExported));

        var (response, bytes) = await DownloadAsync(admin.Client, $"/api/audit/export.csv?production={production}&to={Uri.EscapeDataString(Base.AddSeconds(LimitedExportApp.MaxRows).ToString("O"))}");
        using var _ = response;
        Assert.Equal(LimitedExportApp.MaxRows + 1, Encoding.UTF8.GetString(bytes).Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);
    }

    [Fact]
    public async Task Export_InvalidFilter_IsRefusedWithoutAnEntry()
    {
        var admin = await app.AdminAsync();
        var before = (await AuditSeed.AllAsync(app)).Count(a => a.Action == AuditActions.AuditExported);

        await admin.Client.GetAsync("/api/audit/export.csv?from=nonsense", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.BadRequest);

        Assert.Equal(before, (await AuditSeed.AllAsync(app)).Count(a => a.Action == AuditActions.AuditExported));
    }

    [Fact]
    public async Task Export_MoreOftenThanTheLimit_IsRateLimitedPerClient()
    {
        var admin = await app.AdminAsync();
        var other = await app.AdminAsync();

        for (var i = 0; i < LimitedExportApp.ExportsPerMinute; i++)
        {
            await admin.Client.GetAsync("/api/audit/export.csv?production=prd_rate", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        }

        using var limited = await admin.Client.GetAsync("/api/audit/export.json?production=prd_rate", TestContext.Current.CancellationToken);
        await limited.ExpectAsync(HttpStatusCode.TooManyRequests);
        Assert.True(limited.Headers.Contains("Retry-After"));
        await other.Client.GetAsync("/api/audit/export.csv?production=prd_rate", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        // Reading the log is not an export.
        await admin.Client.GetAsync("/api/audit?limit=1", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
    }
}

/// <summary>The app with a small export limit and a small export rate limit.</summary>
public sealed class LimitedExportApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    public const int MaxRows = 40;
    public const int ExportsPerMinute = 4;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Audit:ExportMaxRows", MaxRows.ToString(CultureInfo.InvariantCulture));
        builder.UseSetting("Audit:ExportsPerMinute", ExportsPerMinute.ToString(CultureInfo.InvariantCulture));
    }
}

/// <summary>The app with a large export limit, for the streaming test.</summary>
public sealed class LargeExportApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    public const int Rows = 100_000;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Audit:ExportMaxRows", "200000");
    }
}

/// <summary>An export of 100 000 entries is written while it is read, so the memory of the server does not grow with its size.</summary>
/// <summary>The heap is measured, so no other test may run next to it.</summary>
[CollectionDefinition(nameof(AuditExportStreamingTests), DisableParallelization = true)]
public sealed class RunsAloneForTheHeapMeasurement;

[Collection(nameof(AuditExportStreamingTests))]
public sealed class AuditExportStreamingTests(LargeExportApp app) : IClassFixture<LargeExportApp>
{
    private const long MaxLiveGrowthBytes = 24 * 1024 * 1024;

    [Fact]
    public async Task Csv_Of100000Entries_IsStreamedWithoutHoldingItInMemory()
    {
        await AuditSeed.ExecuteAsync(
            app,
            $"""
            INSERT INTO audit_entries (production_id, at, actor, action, details)
            SELECT 'prd_bulk', now() - (g * interval '1 second'), 'admin', 'device.paired',
                   jsonb_build_object('device', 'Phone ' || g, 'codes', 'K1', 'note', repeat('x', 300))
            FROM generate_series(1, {LargeExportApp.Rows}) g
            """);
        var admin = await app.AdminAsync();
        GC.Collect();
        var baseline = GC.GetTotalMemory(forceFullCollection: true);

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/audit/export.csv?production=prd_bulk");
        using var response = await admin.Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, TestContext.Current.CancellationToken);
        await response.ExpectAsync(HttpStatusCode.OK);
        await using var body = await response.Content.ReadAsStreamAsync(TestContext.Current.CancellationToken);
        var buffer = new byte[64 * 1024];
        long total = 0;
        long lines = 0;
        long nextSample = 4 * 1024 * 1024;
        long peakGrowth = 0;
        int read;
        while ((read = await body.ReadAsync(buffer, TestContext.Current.CancellationToken)) > 0)
        {
            total += read;
            lines += buffer.AsSpan(0, read).Count((byte)'\n');
            if (total >= nextSample)
            {
                nextSample += 4 * 1024 * 1024;
                peakGrowth = Math.Max(peakGrowth, GC.GetTotalMemory(forceFullCollection: true) - baseline);
            }
        }

        TestContext.Current.SendDiagnosticMessage($"Audit export of {LargeExportApp.Rows} rows: {total / 1024 / 1024} MiB, peak live heap growth {peakGrowth / 1024 / 1024} MiB");
        Assert.Equal(LargeExportApp.Rows + 1, lines);
        Assert.True(total > 40 * 1024 * 1024, $"the export has only {total} bytes");
        Assert.True(peakGrowth < MaxLiveGrowthBytes, $"the live heap grew by {peakGrowth / 1024 / 1024} MiB while {total / 1024 / 1024} MiB were exported");
    }
}

/// <summary>Everything an operator does in the Regie leaves an entry, and no entry holds a secret.</summary>
public sealed class AuditEventsApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static async Task<List<AuditEntryDto>> EntriesAsync(HttpClient client)
    {
        var all = new List<AuditEntryDto>();
        string? cursor = null;
        do
        {
            var page = await client.GetAsync("/api/audit?limit=200" + (cursor is null ? string.Empty : "&cursor=" + cursor), TestContext.Current.CancellationToken).ExpectAsync<AuditPageDto>();
            all.AddRange(page.Entries);
            cursor = page.NextCursor;
        }
        while (cursor is not null);
        return all;
    }

    [Fact]
    public async Task EveryAction_LeavesAnEntry_AndNoEntryHoldsASecret()
    {
        var secrets = new List<string> { StudioFlowApp.AdminPassword };
        var admin = await app.AdminAsync();
        var id = admin.ProductionId;
        var tag = Guid.NewGuid().ToString("N")[..6];

        // Sign-in: failure and lockout from one address, success, sign-out.
        var attacker = app.Anonymous();
        for (var i = 0; i < 5; i++)
        {
            await attacker.PostJsonAsync("/api/auth/login", new LoginRequest("admin", "Wrong-password-" + i)).ExpectAsync(i < 4 ? HttpStatusCode.Unauthorized : HttpStatusCode.TooManyRequests);
        }

        var leaving = await app.AdminAsync();
        await leaving.Client.PostAsync("/api/auth/logout", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        // Productions.
        var spring = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Spring " + tag)).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        await admin.Client.PatchJsonAsync($"/api/productions/{spring.Id}", new UpdateProductionRequest("Autumn " + tag, new SlateDto("Soon", null, null), null)).ExpectAsync<ProductionDto>();
        await admin.Client.PostAsync($"/api/productions/{spring.Id}/activate", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PostAsync($"/api/productions/{id}/activate", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        // Devices, invites and the output.
        var phone = await app.PairPhoneAsync(admin, "Phone " + tag);
        secrets.Add(phone.DeviceSecret);
        var devices = $"/api/productions/{id}/devices/{phone.DeviceId}";
        await admin.Client.PatchJsonAsync(devices, new RenameDeviceRequest("Stage " + tag)).ExpectAsync<DeviceDto>();
        await admin.Client.PostAsync(devices + "/block", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PostAsync(devices + "/unblock", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.DeleteAsync(devices, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        var invite = await admin.Client.PostJsonAsync($"/api/productions/{id}/pairing/invites", new CreateInviteRequest(InviteKind.LaptopLink)).ExpectAsync<InviteDto>(HttpStatusCode.Created);
        secrets.Add(Pairing.TokenOf(invite));
        await admin.Client.DeleteAsync($"/api/productions/{id}/pairing/invites/{invite.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);
        var oldOutput = await admin.Client.GetAsync($"/api/productions/{id}/output", TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        var newOutput = await admin.Client.PostAsync($"/api/productions/{id}/output/regenerate-key", null, TestContext.Current.CancellationToken).ExpectAsync<OutputSettingsDto>();
        secrets.AddRange([KeyOf(oldOutput), KeyOf(newOutput)]);
        await admin.Client.PutJsonAsync($"/api/productions/{id}/output/access", new UpdateOutputAccessRequest(["203.0.113.0/24"])).ExpectAsync<OutputSettingsDto>();

        // Media.
        using var upload = new MultipartFormDataContent { { UploadFile(), "file", "Cover " + tag + ".png" } };
        var asset = await admin.Client.PostAsync($"/api/productions/{id}/assets", upload, TestContext.Current.CancellationToken).ExpectAsync<AssetDto>(HttpStatusCode.Created);
        await admin.Client.DeleteAsync($"/api/productions/{id}/assets/{asset.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        // The broadcast: start, a direct switch, a preview and its take, end, reset.
        var snapshot = await admin.Client.GetAsync($"/api/productions/{id}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();
        await admin.Client.PostAsync($"/api/productions/{id}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PostJsonAsync($"/api/productions/{id}/program", new SwitchProgramRequest(snapshot.Scenes[1].Id, new TransitionDto(TransitionKind.Cut, 0))).ExpectAsync<ProductionDto>();
        await admin.Client.PutJsonAsync($"/api/productions/{id}/preview", new SetPreviewRequest(snapshot.Scenes[2].Id)).ExpectAsync<ProductionDto>();
        await admin.Client.PostJsonAsync($"/api/productions/{id}/take", new TakeRequest(new TransitionDto(TransitionKind.Cut, 0))).ExpectAsync<ProductionDto>();
        await admin.Client.PostAsync($"/api/productions/{id}/broadcast/end", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PostAsync($"/api/productions/{id}/broadcast/reset", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        var entries = await EntriesAsync(admin.Client);
        var actions = entries.Select(e => e.Action).ToHashSet(StringComparer.Ordinal);
        string[] expected =
        [
            AuditActions.LoginSucceeded, AuditActions.LoginFailed, AuditActions.LoginLocked, AuditActions.Logout,
            AuditActions.ProductionCreated, AuditActions.ProductionRenamed, AuditActions.SlateChanged, AuditActions.ProductionActivated,
            AuditActions.DevicePaired, AuditActions.DeviceRenamed, AuditActions.DeviceBlocked, AuditActions.DeviceUnblocked, AuditActions.DeviceRemoved,
            AuditActions.InviteCreated, AuditActions.InviteRevoked, AuditActions.OutputKeyRegenerated, AuditActions.OutputAccessChanged,
            AuditActions.AssetUploaded, AuditActions.AssetDeleted,
            AuditActions.BroadcastStarted, AuditActions.SceneLive, AuditActions.BroadcastEnded, AuditActions.BroadcastReset,
        ];
        Assert.Empty(expected.Except(actions));
        var via = entries.Where(e => e.Action == AuditActions.SceneLive && e.Details.GetValueOrDefault("via") is not null).Select(e => e.Details["via"]).ToList();
        Assert.Contains(AuditVia.Click, via);
        Assert.Contains(AuditVia.Take, via);
        Assert.All(entries.Where(e => e.Action == AuditActions.LoginFailed), e => Assert.Equal("admin", e.Details[AuditDetails.Username]));
        Assert.Contains(entries, e => e.Action == AuditActions.LoginSucceeded && e.Details.ContainsKey(AuditDetails.Ip));

        // Nothing secret: not in the table, not in the view, not in the exports.
        var table = string.Join('\n', (await AuditSeed.AllAsync(app)).Select(a => a.Action + a.Actor + JsonSerializer.Serialize(a.Details)));
        using var csv = await admin.Client.GetAsync("/api/audit/export.csv", TestContext.Current.CancellationToken);
        var exported = await csv.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var viewed = JsonSerializer.Serialize(entries, ContractJson.Options);
        foreach (var secret in secrets.Where(s => s.Length > 0))
        {
            Assert.DoesNotContain(secret, table, StringComparison.Ordinal);
            Assert.DoesNotContain(secret, exported, StringComparison.Ordinal);
            Assert.DoesNotContain(secret, viewed, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task PhoneQrCodes_AreNoLongerAudited()
    {
        var admin = await app.AdminAsync();
        var before = (await AuditSeed.AllAsync(app)).Count(a => a.Action is AuditActions.InviteCreated or AuditActions.InviteRevoked);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite/renew", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite/renew", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        Assert.Equal(before, (await AuditSeed.AllAsync(app)).Count(a => a.Action is AuditActions.InviteCreated or AuditActions.InviteRevoked));
    }

    private static string KeyOf(OutputSettingsDto output) => output.Url[(output.Url.IndexOf("?k=", StringComparison.Ordinal) + 3)..];

    private static ByteArrayContent UploadFile()
    {
        var file = new ByteArrayContent(MediaSamples.Png(64, 36));
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        return file;
    }
}

/// <summary>The retention against the real database: batches, the IP removal and the entry that records it.</summary>
public sealed class AuditRetentionApiTests(AuditRetentionApp app) : IClassFixture<AuditRetentionApp>
{
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;

    [Fact]
    public async Task Run_DeletesOldEntriesInBatchesRemovesOldIpsAndRecordsIt()
    {
        var production = "prd_ret_" + Guid.NewGuid().ToString("N")[..8];
        var ip = ((string Key, string Value)[])[(AuditDetails.Ip, "203.0.113.5"), (AuditDetails.Username, "regie")];
        await AuditSeed.AddAsync(
            app,
            [
                .. Enumerable.Range(0, AuditRetentionApp.Batch * 2 + 30).Select(i => AuditSeed.Entry(production, Now.AddDays(-366 - i % 20), AuditActions.SceneLive)),
                AuditSeed.Entry(production, Now.AddDays(-400), AuditActions.LoginFailed, AuditActors.Admin, ip),
                AuditSeed.Entry(production, Now.AddDays(-100), AuditActions.LoginFailed, AuditActors.Admin, ip),
                AuditSeed.Entry(production, Now.AddDays(-95), AuditActions.LoginSucceeded, AuditActors.Admin, ip),
                AuditSeed.Entry(production, Now.AddDays(-85), AuditActions.LoginFailed, AuditActors.Admin, ip),
                AuditSeed.Entry(production, Now.AddDays(-364), AuditActions.SceneLive),
            ]);
        var expectedDeleted = AuditRetentionApp.Batch * 2 + 30 + 1;

        await app.Service<AuditRetentionService>().RunAsync(TestContext.Current.CancellationToken);

        var rows = (await AuditSeed.AllAsync(app)).Where(a => a.ProductionId == production).ToList();
        Assert.Equal(4, rows.Count);
        Assert.Equal(
            [false, false, true],
            rows.Where(r => r.Action != AuditActions.SceneLive).OrderBy(r => r.At).Select(r => r.Details.ContainsKey(AuditDetails.Ip)));
        Assert.All(rows.Where(r => r.Action != AuditActions.SceneLive), r => Assert.Equal("regie", r.Detail(AuditDetails.Username)));
        var entry = (await AuditSeed.AllAsync(app)).Last(a => a.Action == AuditActions.AuditRetention);
        Assert.Equal((AuditActors.System, (string?)null, "365", expectedDeleted.ToString(CultureInfo.InvariantCulture), "2"), (entry.Actor, entry.ProductionId, entry.Detail(AuditDetails.Days), entry.Detail(AuditDetails.Deleted), entry.Detail(AuditDetails.Anonymised)));
    }

    [Fact]
    public async Task Run_Again_ChangesNothingAndWritesNoEntry()
    {
        await app.Service<AuditRetentionService>().RunAsync(TestContext.Current.CancellationToken);
        var before = await AuditSeed.AllAsync(app);

        await app.Service<AuditRetentionService>().RunAsync(TestContext.Current.CancellationToken);

        Assert.Equal(before.Select(a => a.Id), (await AuditSeed.AllAsync(app)).Select(a => a.Id));
    }

    [Fact]
    public async Task Run_WhileABroadcastIsLive_WaitsForTheEnd()
    {
        var admin = await app.AdminAsync();
        var production = "prd_retlive_" + Guid.NewGuid().ToString("N")[..8];
        await AuditSeed.AddAsync(app, AuditSeed.Entry(production, Now.AddDays(-500)));
        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/start", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);

        await app.Service<AuditRetentionService>().RunAsync(TestContext.Current.CancellationToken);
        Assert.Contains(await AuditSeed.AllAsync(app), a => a.ProductionId == production);

        await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/broadcast/end", null, TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.OK);
        await app.Service<AuditRetentionService>().RunAsync(TestContext.Current.CancellationToken);
        Assert.DoesNotContain(await AuditSeed.AllAsync(app), a => a.ProductionId == production);
    }

    [Fact]
    public async Task Entry_OfTheRetention_IsInTheViewWithItsText()
    {
        var admin = await app.AdminAsync();
        await AuditSeed.AddAsync(app, AuditSeed.Entry(null, Now.AddDays(-700)));
        await app.Service<AuditRetentionService>().RunAsync(TestContext.Current.CancellationToken);

        var page = await admin.Client.GetAsync("/api/audit?action=audit.retention&limit=1", TestContext.Current.CancellationToken).ExpectAsync<AuditPageDto>();

        var entry = Assert.Single(page.Entries);
        Assert.Equal((AuditCategory.System, LogCode.AuditRetention, AuditActors.System), (entry.Category, entry.Code, entry.Actor));
    }
}

/// <summary>The app with a small batch size for the retention (the lowest the settings allow).</summary>
public sealed class AuditRetentionApp(PostgresFixture postgres) : StudioFlowApp(postgres)
{
    public const int Batch = 100;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Audit:BatchSize", Batch.ToString(CultureInfo.InvariantCulture));
    }
}
