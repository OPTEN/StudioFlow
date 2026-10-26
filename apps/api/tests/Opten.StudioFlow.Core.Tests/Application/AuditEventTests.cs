using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

/// <summary>The actions of the audit log that the services record (spec 4.9), with their actor and details.</summary>
public sealed class AuditEventTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    private IReadOnlyList<Scene> Scenes => harness.Production.OrderedScenes;

    private AuditEntry Single(string action) => Assert.Single(harness.Data.Audit, a => a.Action == action);

    [Fact]
    public async Task CreateProduction_RecordsTheNameForTheNewProduction()
    {
        var created = await harness.Productions.CreateAsync(new CreateProductionRequest("Spring"), CancellationToken.None);

        var entry = Single(AuditActions.ProductionCreated);
        Assert.Equal((created.Id, AuditActors.Admin, "Spring"), (entry.ProductionId, entry.Actor, entry.Detail(AuditDetails.Name)));
    }

    [Fact]
    public async Task EnsureDefaultProduction_RecordsTheServerAsActor()
    {
        using var empty = new ServiceHarness();
        empty.Data.Productions.Clear();

        await empty.Productions.EnsureDefaultProductionAsync(CancellationToken.None);

        var entry = Assert.Single(empty.Data.Audit, a => a.Action == AuditActions.ProductionCreated);
        Assert.Equal((AuditActors.System, "Webinar"), (entry.Actor, entry.Detail(AuditDetails.Name)));
    }

    [Fact]
    public async Task Update_Rename_RecordsTheOldAndTheNewName()
    {
        await harness.Productions.UpdateAsync(harness.Production.Id, new UpdateProductionRequest("Autumn", null, null), CancellationToken.None);

        var entry = Single(AuditActions.ProductionRenamed);
        Assert.Equal(("Webinar", "Autumn"), (entry.Detail(AuditDetails.From), entry.Detail(AuditDetails.Name)));
        Assert.DoesNotContain(harness.Data.Audit, a => a.Action == AuditActions.SlateChanged);
    }

    [Fact]
    public async Task Update_SameName_RecordsNothing()
    {
        await harness.Productions.UpdateAsync(harness.Production.Id, new UpdateProductionRequest("Webinar", null, null), CancellationToken.None);

        Assert.Empty(harness.Data.Audit);
    }

    [Fact]
    public async Task Update_BothSlates_RecordsOneEntryPerSlate()
    {
        var request = new UpdateProductionRequest(null, new SlateDto("Soon", null, null), new SlateDto("Bye", "See you", null));

        await harness.Productions.UpdateAsync(harness.Production.Id, request, CancellationToken.None);

        Assert.Equal(
            [AuditSlates.Standby, AuditSlates.End],
            harness.Data.Audit.Where(a => a.Action == AuditActions.SlateChanged).Select(a => a.Detail(AuditDetails.Slate)));
    }

    [Fact]
    public async Task Activate_RecordsTheActivatedProductionOnly()
    {
        var second = await harness.Productions.CreateAsync(new CreateProductionRequest("Second"), CancellationToken.None);

        await harness.Productions.ActivateAsync(second.Id, CancellationToken.None);

        var entry = Single(AuditActions.ProductionActivated);
        Assert.Equal((second.Id, "Second"), (entry.ProductionId, entry.Detail(AuditDetails.Name)));
    }

    [Fact]
    public async Task ResetBroadcast_IsRecorded()
    {
        await harness.Productions.StartBroadcastAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.EndBroadcastAsync(harness.Production.Id, CancellationToken.None);

        await harness.Productions.ResetBroadcastAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal(
            [AuditActions.BroadcastStarted, AuditActions.BroadcastEnded, AuditActions.BroadcastReset],
            harness.Data.Audit.Select(a => a.Action));
    }

    [Fact]
    public async Task SwitchProgram_RecordsViaClick()
    {
        await harness.Productions.SwitchProgramAsync(harness.Production.Id, new SwitchProgramRequest(Scenes[2].Id, Transitions.Cut), CancellationToken.None);

        var entry = Single(AuditActions.SceneLive);
        Assert.Equal(("Break", AuditVia.Click), (entry.Detail(AuditDetails.Scene), entry.Detail(AuditDetails.Via)));
    }

    [Fact]
    public async Task Take_RecordsViaTake()
    {
        await harness.Productions.SetPreviewAsync(harness.Production.Id, new SetPreviewRequest(Scenes[2].Id), CancellationToken.None);

        await harness.Productions.TakeAsync(harness.Production.Id, new TakeRequest(Transitions.Cut), CancellationToken.None);

        var entry = Single(AuditActions.SceneLive);
        Assert.Equal(("Break", AuditVia.Take), (entry.Detail(AuditDetails.Scene), entry.Detail(AuditDetails.Via)));
    }

    [Fact]
    public async Task RenameDevice_RecordsTheOldSubjectAndTheNewName()
    {
        var (device, _) = await harness.PairPhoneAsync("Phone 1");
        harness.Data.Audit.Clear();

        await harness.DeviceAdmin.RenameAsync(harness.Production.Id, device.Id, new RenameDeviceRequest("Stage left"), CancellationToken.None);

        var entry = Single(AuditActions.DeviceRenamed);
        Assert.Equal(("Phone 1", "Stage left"), (entry.Detail(AuditDetails.Device), entry.Detail(AuditDetails.Name)));
    }

    [Fact]
    public async Task PhoneQrInvites_AreNotRecordedButInviteLinksAre()
    {
        await harness.Pairing.GetPhoneInviteAsync(harness.Production.Id, CancellationToken.None);
        await harness.Pairing.RenewPhoneInviteAsync(harness.Production.Id, CancellationToken.None);
        Assert.Empty(harness.Data.Audit);

        await harness.Pairing.CreateInviteAsync(harness.Production.Id, new CreateInviteRequest(InviteKind.LaptopLink), CancellationToken.None);

        Assert.Equal("LaptopLink", Single(AuditActions.InviteCreated).Detail(AuditDetails.Kind));
    }

    [Fact]
    public async Task NewProductionEvents_AreNotShownInRecentEvents()
    {
        await harness.Productions.UpdateAsync(harness.Production.Id, new UpdateProductionRequest("Autumn", null, null), CancellationToken.None);
        await harness.Productions.StartBroadcastAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.EndBroadcastAsync(harness.Production.Id, CancellationToken.None);
        await harness.Productions.ResetBroadcastAsync(harness.Production.Id, CancellationToken.None);

        Assert.Equal(
            [LogCode.BroadcastStarted, LogCode.BroadcastEnded],
            harness.Events.OfType<LogAppendedEvent>().Select(e => e.Entry.Code));
    }

    public void Dispose() => harness.Dispose();
}
