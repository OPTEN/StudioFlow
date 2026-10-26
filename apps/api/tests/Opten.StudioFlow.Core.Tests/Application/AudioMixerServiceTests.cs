using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class AudioMixerServiceTests : IDisposable
{
    private readonly ServiceHarness harness = new();

    private string ProductionId => harness.Production.Id;

    private Task<IReadOnlyList<AudioChannelDto>> SetAsync(bool adjusting, params AudioChannelDto[] channels) =>
        harness.Audio.SetChannelsAsync(ProductionId, new SetAudioChannelsRequest(channels, adjusting), CancellationToken.None);

    private async Task<(Device Device, DeviceIdentity Identity, string Mic)> PairStationAsync()
    {
        var (device, identity) = await harness.PairAudioStationAsync();
        return (device, identity, device.SourceIdOf(device.Slots[0]));
    }

    private IEnumerable<AuditEntry> AudioAudit() => harness.Data.Audit.Where(a => a.Action == AuditActions.AudioChanged);

    public void Dispose() => harness.Dispose();

    [Fact]
    public async Task Pair_AnAudioStation_CreatesItsChannelAlwaysAudible()
    {
        var (_, _, mic) = await PairStationAsync();

        var channel = Assert.Single(harness.Production.AudioChannels);
        Assert.Equal(new AudioChannelDto(mic, 0, false, AudioMode.Always, 0), channel);
        var changed = Assert.Single(harness.Events.OfType<AudioChannelsChangedEvent>());
        Assert.Equal([channel], changed.Channels);
        Assert.Equal("Mixing desk", harness.Source(mic).Label);
        Assert.Equal((SourceKind.Audio, "A1"), (harness.Source(mic).Kind, harness.Source(mic).Code));
    }

    [Fact]
    public async Task Pair_APhoneHasNoChannel_UntilItAllocatesAMicrophone_WhichStartsMuted()
    {
        var (_, phoneIdentity) = await harness.PairPhoneAsync();
        Assert.Empty(harness.Production.AudioChannels);

        var slot = await harness.Devices.AllocateSlotAsync(phoneIdentity, new AllocateSlotRequest(SourceKind.Audio), CancellationToken.None);

        var channel = Assert.Single(harness.Production.AudioChannels);
        Assert.Equal(("mic", "A1", SourceKind.Audio), (slot.Slot, slot.Code, slot.Kind));
        Assert.Equal(new AudioChannelDto($"{phoneIdentity.DeviceId}/mic", 0, true, AudioMode.Follow, 0), channel);
    }

    [Fact]
    public async Task Pair_ALaptop_GetsAChannelForItsScreen()
    {
        var (device, _) = await harness.PairLaptopAsync();

        var channel = Assert.Single(harness.Production.AudioChannels);
        Assert.Equal(new AudioChannelDto($"{device.Id}/screen-1", 0, false, AudioMode.Follow, 0), channel);
    }

    [Fact]
    public async Task ReleaseSlot_RemovesTheChannelWithTheSource()
    {
        var (_, identity) = await harness.PairLaptopAsync();
        await harness.Devices.AllocateSlotAsync(identity, new AllocateSlotRequest(SourceKind.Audio), CancellationToken.None);
        Assert.Equal(2, harness.Production.AudioChannels.Count);

        await harness.Devices.ReleaseSlotAsync(identity, "mic", CancellationToken.None);

        Assert.Equal([$"{identity.DeviceId}/screen-1"], harness.Production.AudioChannels.Select(c => c.SourceId));
        Assert.Contains(harness.Events, e => e is SourceRemovedEvent { SourceId: var id } && id == $"{identity.DeviceId}/mic");
    }

    [Fact]
    public async Task DeleteDevice_RemovesAllItsChannels()
    {
        var (device, _, _) = await PairStationAsync();

        await harness.DeviceAdmin.DeleteAsync(ProductionId, device.Id, CancellationToken.None);

        Assert.Empty(harness.Production.AudioChannels);
    }

    [Fact]
    public async Task SetChannels_EmitsOneRevisionedEvent_AndReturnsAllChannels()
    {
        var (_, _, mic) = await PairStationAsync();
        var (laptop, _) = await harness.PairLaptopAsync();
        var screen = $"{laptop.Id}/screen-1";
        harness.Publisher.StudioEvents.Clear();

        var all = await SetAsync(false, new AudioChannelDto(mic, -6, false, AudioMode.Always, 40), new AudioChannelDto(screen, 0, true, AudioMode.Follow, 0));

        var changed = Assert.Single(harness.Events.OfType<AudioChannelsChangedEvent>());
        Assert.Equal(2, changed.Channels.Count);
        Assert.Equal(2, all.Count);
        Assert.Equal(harness.Runtime.Revision, changed.Revision);
        Assert.Equal(-6, harness.Production.FindAudioChannel(mic)!.GainDb);
        Assert.True(harness.Production.FindAudioChannel(screen)!.Muted);
    }

    [Fact]
    public async Task SetChannels_ThatChangesNothing_SendsNoEventAndWritesNoAudit()
    {
        var (_, _, mic) = await PairStationAsync();
        harness.Publisher.StudioEvents.Clear();

        await SetAsync(false, new AudioChannelDto(mic, 0, false, AudioMode.Always, 0));

        Assert.Empty(harness.Events);
        Assert.Empty(AudioAudit());
    }

    [Fact]
    public async Task SetChannels_Invalid_ChangesAndPublishesNothing()
    {
        var (_, _, mic) = await PairStationAsync();
        harness.Publisher.StudioEvents.Clear();

        var error = await Assert.ThrowsAsync<StudioFlowException>(() => SetAsync(false, new AudioChannelDto(mic, 10.5, false, AudioMode.Always, 0)));

        Assert.Equal(ErrorCodes.ValidationFailed, error.Code);
        Assert.Contains("channels[0].gainDb", error.Errors!.Keys);
        Assert.Empty(harness.Events);
        Assert.Equal(0, harness.Production.FindAudioChannel(mic)!.GainDb);
    }

    [Fact]
    public async Task SetChannels_UnknownProduction_IsNotFound()
    {
        var error = await Assert.ThrowsAsync<StudioFlowException>(() =>
            harness.Audio.SetChannelsAsync("prd_unknown1", new SetAudioChannelsRequest([new AudioChannelDto("dev_x/mic", 0, false, AudioMode.Always, 0)]), CancellationToken.None));

        Assert.Equal(ErrorCodes.NotFound, error.Code);
    }

    [Fact]
    public async Task SetChannels_WritesOneAuditEntryPerChange_AndNoneWhileAdjusting()
    {
        var (_, _, mic) = await PairStationAsync();

        await SetAsync(true, new AudioChannelDto(mic, -12, false, AudioMode.Always, 0));
        Assert.Empty(AudioAudit());

        await SetAsync(false, new AudioChannelDto(mic, -12, true, AudioMode.Off, 250));
        await SetAsync(false, new AudioChannelDto(mic, -12, false, AudioMode.Off, 250));

        var entries = AudioAudit().ToList();
        Assert.Equal(
            [
                (AuditAudioChanges.Muted, ""),
                (AuditAudioChanges.Mode, "off"),
                (AuditAudioChanges.SyncOffset, "250"),
                (AuditAudioChanges.Unmuted, ""),
            ],
            entries.Select(e => (e.Detail(AuditDetails.Change), e.Detail(AuditDetails.Value))));
        Assert.All(entries, e => Assert.Equal(("A1", AuditActors.Admin), (e.Detail(AuditDetails.Code), e.Actor)));
    }

    [Fact]
    public async Task SetChannels_TheFinalRequestOfAFaderDrag_WritesTheGainEntry()
    {
        var (_, _, mic) = await PairStationAsync();

        await SetAsync(true, new AudioChannelDto(mic, -3, false, AudioMode.Always, 0));
        await SetAsync(true, new AudioChannelDto(mic, -9.5, false, AudioMode.Always, 0));

        Assert.Empty(AudioAudit());
        Assert.Equal(-9.5, harness.Production.FindAudioChannel(mic)!.GainDb);
    }

    [Fact]
    public async Task SetChannels_TwoSeatsMovingDifferentFaders_BothSurvive()
    {
        var (_, _, mic) = await PairStationAsync();
        var (laptop, _) = await harness.PairLaptopAsync();
        var screen = $"{laptop.Id}/screen-1";

        await Task.WhenAll(
            SetAsync(false, new AudioChannelDto(mic, -6, false, AudioMode.Always, 0)),
            SetAsync(false, new AudioChannelDto(screen, -12, false, AudioMode.Follow, 0)));

        Assert.Equal(-6, harness.Production.FindAudioChannel(mic)!.GainDb);
        Assert.Equal(-12, harness.Production.FindAudioChannel(screen)!.GainDb);
    }

    [Fact]
    public async Task Snapshots_CarryTheChannels_AndTheOutputSeesTheEvents()
    {
        var (_, _, mic) = await PairStationAsync();
        harness.Publisher.StudioEvents.Clear();
        harness.Publisher.OutputEvents.Clear();

        await SetAsync(false, new AudioChannelDto(mic, -6, false, AudioMode.Always, 0));
        var snapshot = await harness.Productions.GetSnapshotAsync(ProductionId, CancellationToken.None);
        var output = await harness.Outputs.GetSnapshotAsync(new OutputLinkAccess(ProductionId, "webinar", harness.Link.Id, harness.Link.Name, harness.Link.Key, []), CancellationToken.None);

        Assert.Equal(-6, Assert.Single(snapshot.AudioChannels).GainDb);
        Assert.Equal(-6, Assert.Single(output.AudioChannels).GainDb);
        var forOutput = Assert.IsType<AudioChannelsChangedEvent>(Assert.Single(harness.Publisher.OutputEvents));
        Assert.Equal(-6, Assert.Single(forOutput.Channels).GainDb);
    }

    [Fact]
    public async Task Tally_TheMicrophoneOfTheStationIsLiveOnlyWhileBroadcasting_AndWhenMutedOrOff()
    {
        var (_, identity, mic) = await PairStationAsync();
        var session = await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Windows", "1.0"), CancellationToken.None);
        Assert.Equal(TallyState.Off, session.Tally.Slots["mic"]);

        await harness.Productions.StartBroadcastAsync(ProductionId, CancellationToken.None);
        Assert.Equal(TallyState.Program, harness.Publisher.Tallies.Last().Tally.Slots["mic"]);
        Assert.Equal(TallyState.Off, harness.Publisher.Tallies.Last().Tally.Overall);

        await SetAsync(false, new AudioChannelDto(mic, 0, true, AudioMode.Always, 0));
        Assert.Equal(TallyState.Off, harness.Publisher.Tallies.Last().Tally.Slots["mic"]);

        await SetAsync(false, new AudioChannelDto(mic, 0, false, AudioMode.Always, 0));
        Assert.Equal(TallyState.Program, harness.Publisher.Tallies.Last().Tally.Slots["mic"]);

        await harness.Productions.EndBroadcastAsync(ProductionId, CancellationToken.None);
        Assert.Equal(TallyState.Off, harness.Publisher.Tallies.Last().Tally.Slots["mic"]);
    }

    [Fact]
    public async Task Tally_AMicrophoneThatFollowsThePicture_IsLiveWhenItsPhoneIsInTheProgram()
    {
        var (phone, identity) = await harness.PairPhoneAsync();
        await harness.Devices.AllocateSlotAsync(identity, new AllocateSlotRequest(SourceKind.Audio), CancellationToken.None);
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "iPhone", "1.0"), CancellationToken.None);
        var scenes = harness.Production.OrderedScenes;
        await harness.Scenes.AddItemAsync(ProductionId, scenes[1].Id, Build.Add($"{phone.Id}/camera"), CancellationToken.None);
        await SetAsync(false, new AudioChannelDto($"{phone.Id}/mic", 0, false, AudioMode.Follow, 0));
        await harness.Productions.StartBroadcastAsync(ProductionId, CancellationToken.None);
        await harness.Productions.SetPreviewAsync(ProductionId, new SetPreviewRequest(scenes[1].Id), CancellationToken.None);

        Assert.Equal(TallyState.Off, harness.Publisher.Tallies.Last().Tally.Slots["mic"]);
        Assert.Equal(TallyState.Preview, harness.Publisher.Tallies.Last().Tally.Slots["camera"]);

        await harness.Productions.TakeAsync(ProductionId, new TakeRequest(Transitions.Cut), CancellationToken.None);

        var tally = harness.Publisher.Tallies.Last().Tally;
        Assert.Equal((TallyState.Program, TallyState.Program, TallyState.Program), (tally.Slots["mic"], tally.Slots["camera"], tally.Overall));
    }

    [Fact]
    public async Task AudioSourceFailure_OpensAnIncidentAndWritesALogEntry()
    {
        var (_, identity, mic) = await PairStationAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Windows", "1.0"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("mic", SlotState.Live), CancellationToken.None);
        Assert.Equal(SourceStatus.Ok, harness.Source(mic).Status);

        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("mic", SlotState.Failed), CancellationToken.None);

        Assert.Equal(SourceStatus.Lost, harness.Source(mic).Status);
        var incident = harness.Events.OfType<IncidentUpsertedEvent>().Last().Incident;
        Assert.Equal((mic, "A1", IncidentKind.Lost), (incident.SourceId, incident.Code, incident.Kind));
        var log = harness.Events.OfType<LogAppendedEvent>().Last().Entry;
        Assert.Equal((LogCode.AudioLost, "A1 no sound"), (log.Code, log.Text));
    }

    [Fact]
    public async Task AudioSourceStoppedOnPurpose_IsLoggedAsAMicrophoneStopped()
    {
        var (_, identity, mic) = await PairStationAsync();
        await harness.Devices.HelloAsync(identity, "c1", new DeviceHelloDto("tab-1", "Windows", "1.0"), CancellationToken.None);
        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("mic", SlotState.Live), CancellationToken.None);

        await harness.Devices.ReportAsync(identity, "c1", ServiceHarness.Report("mic", SlotState.Ended), CancellationToken.None);

        var log = harness.Events.OfType<LogAppendedEvent>().Last().Entry;
        Assert.Equal((LogCode.AudioEnded, "A1 microphone stopped"), (log.Code, log.Text));
        Assert.Equal(IncidentKind.Ended, harness.Events.OfType<IncidentUpsertedEvent>().Last().Incident.Kind);
        Assert.Equal(mic, harness.Events.OfType<IncidentUpsertedEvent>().Last().Incident.SourceId);
    }

    [Fact]
    public async Task SyncAll_GivesAProductionFromBeforeTheMixerItsChannels_AndIsIdempotent()
    {
        var (device, _) = await harness.PairLaptopAsync();
        var video = Build.Video(harness.Production, hasAudio: true, codes: ["S1"]);
        harness.Data.Assets.Add(video);
        harness.Production.RemoveAudioChannels(harness.Production.AudioChannels.Select(c => c.SourceId));
        harness.Publisher.StudioEvents.Clear();

        await harness.Audio.SyncAllAsync(CancellationToken.None);
        var first = harness.Production.AudioChannels.Select(c => c.SourceId).Order(StringComparer.Ordinal).ToList();
        harness.Publisher.StudioEvents.Clear();
        await harness.Audio.SyncAllAsync(CancellationToken.None);

        Assert.Equal(new[] { $"{device.Id}/screen-1", video.Id }.Order(StringComparer.Ordinal), first);
        Assert.Empty(harness.Events);
    }

    [Fact]
    public async Task UploadedVideoWithAudio_GetsAChannel_AndDeletingItRemovesIt()
    {
        var (_, _, _) = await PairStationAsync();
        var video = Build.Video(harness.Production, hasAudio: true);
        harness.Data.Assets.Add(video);
        await harness.Audio.SyncAllAsync(CancellationToken.None);
        Assert.Contains(harness.Production.AudioChannels, c => c.SourceId == video.Id);

        var mixed = await SetAsync(false, new AudioChannelDto(video.Id, -4, false, AudioMode.Follow, 0));

        Assert.Equal(-4, mixed.Single(c => c.SourceId == video.Id).GainDb);
    }
}
