using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>An audit log in memory: the retention operations work on the rows, the reads return what the test sets.</summary>
internal sealed class FakeAuditLog : IAuditLog
{
    public List<AuditRow> Rows { get; } = [];

    public int Counted { get; set; }

    public (AuditFilter Filter, AuditCursor? After, int Limit)? LastQuery { get; private set; }

    public List<int> BatchSizes { get; } = [];

    public Task<IReadOnlyList<AuditRow>> QueryAsync(AuditFilter filter, AuditCursor? after, int limit, CancellationToken cancellationToken)
    {
        LastQuery = (filter, after, limit);
        return Task.FromResult<IReadOnlyList<AuditRow>>([.. Rows.OrderByDescending(r => r.At).ThenByDescending(r => r.Id).Take(limit)]);
    }

    public Task<int> CountAsync(AuditFilter filter, int limit, CancellationToken cancellationToken) => Task.FromResult(Math.Min(Counted, limit));

    public async IAsyncEnumerable<AuditRow> StreamAsync(AuditFilter filter, int limit, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        foreach (var row in Rows.Take(limit))
        {
            await Task.Yield();
            yield return row;
        }
    }

    public Task<int> DeleteOlderThanAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken)
    {
        BatchSizes.Add(batchSize);
        var old = Rows.Where(r => r.At < cutoff).OrderBy(r => r.At).Take(batchSize).ToList();
        Rows.RemoveAll(old.Contains);
        return Task.FromResult(old.Count);
    }

    public Task<int> RemoveIpAddressesOlderThanAsync(DateTimeOffset cutoff, int batchSize, CancellationToken cancellationToken)
    {
        BatchSizes.Add(batchSize);
        var withIp = Rows.Where(r => r.At < cutoff && r.Details.ContainsKey(AuditDetails.Ip)).Take(batchSize).ToList();
        foreach (var row in withIp)
        {
            Rows[Rows.IndexOf(row)] = row with { Details = row.Details.Where(d => d.Key != AuditDetails.Ip).ToDictionary(d => d.Key, d => d.Value, StringComparer.Ordinal) };
        }

        return Task.FromResult(withIp.Count);
    }
}

public sealed class AuditRetentionTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 3, 0, 0, TimeSpan.Zero);

    private readonly FakeAuditLog log = new();
    private readonly InMemoryData data = new();
    private readonly FakeTimeProvider clock = new(Now);
    private long nextId;

    private AuditRetentionService Service(AuditOptions? options = null) => new(log, data, options ?? new AuditOptions(), clock, NullLogger<AuditRetentionService>.Instance);

    private void Add(TimeSpan age, string action = AuditActions.SceneLive, bool ip = false) => log.Rows.Add(new AuditRow(
        ++nextId,
        Now - age,
        AuditActors.Admin,
        action,
        null,
        null,
        ip ? new Dictionary<string, string> { [AuditDetails.Ip] = "203.0.113.9", [AuditDetails.Username] = "regie" } : new Dictionary<string, string>()));

    [Fact]
    public async Task Run_DeletesExactlyTheEntriesOlderThanTheRetentionAndRecordsIt()
    {
        Add(TimeSpan.FromDays(366));
        Add(TimeSpan.FromDays(400));
        Add(TimeSpan.FromDays(365) - TimeSpan.FromMinutes(1));
        Add(TimeSpan.FromDays(1));

        await Service().RunAsync(CancellationToken.None);

        Assert.Equal([3L, 4], log.Rows.Select(r => r.Id).Order());
        var entry = Assert.Single(data.Audit);
        Assert.Equal((AuditActors.System, AuditActions.AuditRetention, (string?)null), (entry.Actor, entry.Action, entry.ProductionId));
        Assert.Equal(("365", "2", "0"), (entry.Detail(AuditDetails.Days), entry.Detail(AuditDetails.Deleted), entry.Detail(AuditDetails.Anonymised)));
        Assert.Equal(Now, entry.At);
    }

    [Fact]
    public async Task Run_RemovesTheIpAddressAfter90DaysAndKeepsTheRestOfTheEntry()
    {
        Add(TimeSpan.FromDays(91), AuditActions.LoginFailed, ip: true);
        Add(TimeSpan.FromDays(89), AuditActions.LoginFailed, ip: true);
        Add(TimeSpan.FromDays(200), AuditActions.SceneLive);

        await Service().RunAsync(CancellationToken.None);

        var old = log.Rows.Single(r => r.Id == 1);
        Assert.Equal(new Dictionary<string, string> { [AuditDetails.Username] = "regie" }, old.Details);
        Assert.Equal("203.0.113.9", log.Rows.Single(r => r.Id == 2).Details[AuditDetails.Ip]);
        Assert.Equal(3, log.Rows.Count);
        Assert.Equal(("0", "1"), (data.Audit.Single().Detail(AuditDetails.Deleted), data.Audit.Single().Detail(AuditDetails.Anonymised)));
    }

    [Fact]
    public async Task Run_Twice_ChangesNothingTheSecondTimeAndWritesNoSecondEntry()
    {
        Add(TimeSpan.FromDays(400), ip: true);
        Add(TimeSpan.FromDays(100), AuditActions.LoginFailed, ip: true);
        var service = Service();

        await service.RunAsync(CancellationToken.None);
        var afterFirst = log.Rows.ToList();
        await service.RunAsync(CancellationToken.None);

        Assert.Equal(afterFirst, log.Rows);
        Assert.Single(data.Audit);
    }

    [Fact]
    public async Task Run_NothingToDo_WritesNothing()
    {
        Add(TimeSpan.FromDays(1));

        await Service().RunAsync(CancellationToken.None);

        Assert.Empty(data.Audit);
    }

    [Fact]
    public async Task Run_WorksInBatchesUntilEverythingIsDone()
    {
        for (var i = 0; i < 25; i++)
        {
            Add(TimeSpan.FromDays(400 + i));
        }

        Add(TimeSpan.FromDays(1));
        await Service(new AuditOptions { BatchSize = 10 }).RunAsync(CancellationToken.None);

        Assert.Single(log.Rows);
        Assert.Equal("25", data.Audit.Single().Detail(AuditDetails.Deleted));

        // 25 rows in batches of 10 take three delete calls (10, 10, 5), then one call that finds the IP work done.
        Assert.Equal(3 + 1, log.BatchSizes.Count);
        Assert.All(log.BatchSizes, size => Assert.Equal(10, size));
    }

    [Fact]
    public async Task Run_ABatchThatEndsExactlyFull_AsksOnceMoreAndStops()
    {
        for (var i = 0; i < 10; i++)
        {
            Add(TimeSpan.FromDays(400 + i));
        }

        await Service(new AuditOptions { BatchSize = 10 }).RunAsync(CancellationToken.None);

        Assert.Empty(log.Rows);
        Assert.Equal("10", data.Audit.Single().Detail(AuditDetails.Deleted));
    }

    [Fact]
    public async Task Run_WhileABroadcastIsLive_DoesNothing()
    {
        var production = Core.Domain.Production.Create("Webinar", "webinar", isActive: true, Now);
        production.StartBroadcast(Now);
        data.Productions.Add(production);
        Add(TimeSpan.FromDays(400));

        await Service().RunAsync(CancellationToken.None);

        Assert.Single(log.Rows);
        Assert.Empty(data.Audit);
    }

    [Fact]
    public async Task Run_AfterTheBroadcastEnded_CatchesUp()
    {
        var production = Core.Domain.Production.Create("Webinar", "webinar", isActive: true, Now);
        production.StartBroadcast(Now);
        data.Productions.Add(production);
        Add(TimeSpan.FromDays(400));
        var service = Service();
        await service.RunAsync(CancellationToken.None);

        production.EndBroadcast(Now);
        clock.Advance(TimeSpan.FromHours(1));
        await service.RunAsync(CancellationToken.None);

        Assert.Empty(log.Rows);
        Assert.Equal(Now + TimeSpan.FromHours(1), data.Audit.Single().At);
    }

    [Fact]
    public async Task Run_UsesTheConfiguredPeriods()
    {
        Add(TimeSpan.FromDays(31));
        Add(TimeSpan.FromDays(8), AuditActions.LoginFailed, ip: true);

        await Service(new AuditOptions { RetentionDays = 30, IpRetentionDays = 7 }).RunAsync(CancellationToken.None);

        Assert.Equal([2L], log.Rows.Select(r => r.Id));
        Assert.False(log.Rows.Single().Details.ContainsKey(AuditDetails.Ip));
        Assert.Equal("30", data.Audit.Single().Detail(AuditDetails.Days));
    }

    [Fact]
    public async Task Run_WhenTheTimeMovesOn_TheCutoffMovesWithIt()
    {
        Add(TimeSpan.FromDays(364));
        var service = Service();
        await service.RunAsync(CancellationToken.None);
        Assert.Single(log.Rows);

        clock.Advance(TimeSpan.FromDays(2));
        await service.RunAsync(CancellationToken.None);

        Assert.Empty(log.Rows);
    }
}

public sealed class AuditLogServiceTests
{
    private readonly FakeAuditLog log = new();
    private readonly InMemoryData data = new();

    private AuditLogService Service(AuditOptions? options = null) => new(log, data, options ?? new AuditOptions(), TimeProvider.System);

    private void AddRows(int count)
    {
        for (var i = 1; i <= count; i++)
        {
            log.Rows.Add(new AuditRow(i, new DateTimeOffset(2026, 10, 26, 10, 0, 0, TimeSpan.Zero).AddMinutes(i), AuditActors.Admin, AuditActions.SceneLive, "prd_x", "Webinar", new Dictionary<string, string> { [AuditDetails.Scene] = $"Scene {i}" }));
        }
    }

    [Fact]
    public async Task Query_FullPage_GivesACursorThatContinuesAfterTheLastEntry()
    {
        AddRows(5);

        var page = await Service().QueryAsync(new AuditFilterInput(), cursor: null, limit: 2, CancellationToken.None);

        Assert.Equal([5L, 4], page.Entries.Select(e => e.Id));
        Assert.Equal(3, log.LastQuery!.Value.Limit);
        Assert.True(AuditCursor.TryParse(page.NextCursor, out var next));
        Assert.Equal(4, next.Id);
    }

    [Fact]
    public async Task Query_LastPage_HasNoCursor()
    {
        AddRows(2);

        var page = await Service().QueryAsync(new AuditFilterInput(), null, 2, CancellationToken.None);

        Assert.Equal(2, page.Entries.Count);
        Assert.Null(page.NextCursor);
    }

    [Fact]
    public async Task Query_Empty_IsAnEmptyPage()
    {
        var page = await Service().QueryAsync(new AuditFilterInput(), null, null, CancellationToken.None);

        Assert.Empty(page.Entries);
        Assert.Null(page.NextCursor);
        Assert.Equal(AuditLogService.DefaultLimit + 1, log.LastQuery!.Value.Limit);
    }

    [Fact]
    public async Task Query_GivesTheCursorAndTheFilterToTheLog()
    {
        var cursor = new AuditCursor(new DateTimeOffset(2026, 10, 26, 10, 0, 0, TimeSpan.Zero), 17);

        await Service().QueryAsync(new AuditFilterInput(Text: "break"), cursor.Encode(), 10, CancellationToken.None);

        Assert.Equal((cursor, "break"), (log.LastQuery!.Value.After, log.LastQuery.Value.Filter.Text));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(AuditLogService.MaxLimit + 1)]
    [InlineData(int.MaxValue)]
    public async Task Query_LimitOutOfRange_IsInvalid(int limit)
    {
        var error = await Assert.ThrowsAsync<StudioFlowException>(() => Service().QueryAsync(new AuditFilterInput(), null, limit, CancellationToken.None));

        Assert.Contains("limit", error.Errors!.Keys);
        Assert.Null(log.LastQuery);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(AuditLogService.MaxLimit)]
    public async Task Query_LimitAtTheBounds_IsAccepted(int limit)
    {
        await Service().QueryAsync(new AuditFilterInput(), null, limit, CancellationToken.None);

        Assert.Equal(limit + 1, log.LastQuery!.Value.Limit);
    }

    [Fact]
    public async Task Query_BrokenCursor_IsInvalid()
    {
        var error = await Assert.ThrowsAsync<StudioFlowException>(() => Service().QueryAsync(new AuditFilterInput(), "garbage!", null, CancellationToken.None));

        Assert.Contains("cursor", error.Errors!.Keys);
    }

    [Fact]
    public async Task Query_Entry_HasCategoryCodeParamsTextAndDetails()
    {
        AddRows(1);
        log.Rows.Add(new AuditRow(99, new DateTimeOffset(2026, 10, 27, 0, 0, 0, TimeSpan.Zero), AuditActors.Admin, "from.a.newer.version", null, null, new Dictionary<string, string>()));

        var page = await Service().QueryAsync(new AuditFilterInput(), null, null, CancellationToken.None);

        var unknown = page.Entries[0];
        Assert.Equal((AuditCategory.System, (LogCode?)null, "from.a.newer.version"), (unknown.Category, unknown.Code, unknown.Text));
        var known = page.Entries[1];
        Assert.Equal((AuditCategory.Production, LogCode.SceneLive, "Scene “Scene 1” is live", "Webinar"), (known.Category, known.Code, known.Text, known.ProductionName));
        Assert.Equal("Scene 1", known.Params["scene"]);
        Assert.Equal("Scene 1", known.Details["scene"]);
    }

    [Fact]
    public async Task StartExport_RecordsTheExportWithTheFilterAndTheRowCount()
    {
        AddRows(3);
        log.Counted = 3;

        var export = await Service().StartExportAsync(new AuditFilterInput(Text: "scene", Production: "prd_x"), AuditLogService.Csv, CancellationToken.None);

        Assert.Equal(3, export.Rows);
        var entry = Assert.Single(data.Audit);
        Assert.Equal((AuditActors.Admin, AuditActions.AuditExported), (entry.Actor, entry.Action));
        Assert.Equal(("csv", "3", "scene", "prd_x"), (entry.Detail(AuditDetails.Format), entry.Detail(AuditDetails.Rows), entry.Detail("q"), entry.Detail("production")));
        Assert.Equal(3, await export.Entries.CountAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task StartExport_MoreRowsThanTheLimit_IsRefusedAndNothingIsRecorded()
    {
        log.Counted = 1_000;

        var error = await Assert.ThrowsAsync<StudioFlowException>(() => Service(new AuditOptions { ExportMaxRows = 999 }).StartExportAsync(new AuditFilterInput(), AuditLogService.Csv, CancellationToken.None));

        Assert.Equal((ErrorKind.Conflict, ErrorCodes.LimitReached), (error.Kind, error.Code));
        Assert.Empty(data.Audit);
    }

    [Fact]
    public async Task StartExport_ExactlyTheLimit_IsAllowed()
    {
        log.Counted = 999;

        var export = await Service(new AuditOptions { ExportMaxRows = 999 }).StartExportAsync(new AuditFilterInput(), AuditLogService.Json, CancellationToken.None);

        Assert.Equal(999, export.Rows);
    }

    [Fact]
    public async Task StartExport_InvalidFilter_IsRefusedAndNothingIsRecorded()
    {
        await Assert.ThrowsAsync<StudioFlowException>(() => Service().StartExportAsync(new AuditFilterInput(From: "x"), AuditLogService.Csv, CancellationToken.None));

        Assert.Empty(data.Audit);
    }
}
