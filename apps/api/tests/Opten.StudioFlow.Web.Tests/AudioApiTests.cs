using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.IdentityModel.JsonWebTokens;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Infrastructure.Media;
using Opten.StudioFlow.Web.Tests.Support;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The audio mixer of issue #7: the channels, their validation, their events and the grants for microphones.</summary>
public sealed class AudioMixerApiTests(StudioFlowApp app) : IClassFixture<StudioFlowApp>
{
    private static readonly string[] ChangeTexts = ["A1 gain -5.0 dB", "A1 mode follows the picture", "A1 muted", "A1 sync offset 120 ms"];

    private static string Channels(AdminSession admin) => $"/api/productions/{admin.ProductionId}/audio/channels";

    private static Task<HttpResponseMessage> SetAsync(AdminSession admin, bool adjusting, params AudioChannelDto[] channels) =>
        admin.Client.PutJsonAsync(Channels(admin), new SetAudioChannelsRequest(channels, adjusting));

    private static async Task<ProductionSnapshot> SnapshotAsync(AdminSession admin) =>
        await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/snapshot", TestContext.Current.CancellationToken).ExpectAsync<ProductionSnapshot>();

    /// <summary>A signed-in admin whose session points at a new production, so the tests of this class do not see each other's devices.</summary>
    private async Task<AdminSession> FreshAsync()
    {
        var admin = await app.AdminAsync();
        var production = await admin.Client.PostJsonAsync("/api/productions", new CreateProductionRequest("Audio " + Guid.NewGuid().ToString("N")[..8])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        return admin with { ProductionId = production.Id };
    }

    private async Task<(AdminSession Admin, DeviceCredentialsDto Station, string Mic)> StationAsync()
    {
        var admin = await FreshAsync();
        var station = await app.PairAudioStationAsync(admin);
        return (admin, station, $"{station.DeviceId}/mic");
    }

    private static async Task<IReadOnlyList<string>> ErrorFieldsAsync(Task<HttpResponseMessage> request)
    {
        using var response = await request;
        await response.ExpectAsync(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(ErrorCodes.ValidationFailed, json.RootElement.GetProperty("code").GetString());
        return [.. json.RootElement.GetProperty("errors").EnumerateObject().Select(e => e.Name).Order(StringComparer.Ordinal)];
    }

    [Fact]
    public async Task AudioStation_Pairing_CreatesTheMicrophoneSourceAndItsChannel()
    {
        var (admin, station, mic) = await StationAsync();

        var snapshot = await SnapshotAsync(admin);

        var source = snapshot.Sources.Single(s => s.Id == mic);
        Assert.Equal((SourceKind.Audio, "A1", "mic", station.DeviceId), (source.Kind, source.Code, source.Slot, source.DeviceId));
        Assert.Equal(new AudioChannelDto(mic, 0, false, AudioMode.Always, 0), snapshot.AudioChannels.Single(c => c.SourceId == mic));
        Assert.Equal(DeviceKind.AudioStation, snapshot.Devices.Single(d => d.Id == station.DeviceId).Kind);
    }

    [Fact]
    public async Task Pairing_TheKindAudioStation_IsHonouredOnlyOnALaptopLink()
    {
        var admin = await FreshAsync();
        var qr = await admin.Client.GetAsync($"/api/productions/{admin.ProductionId}/pairing/phone-invite", TestContext.Current.CancellationToken).ExpectAsync<InviteDto>();

        var phone = await app.Anonymous().PostJsonAsync($"/api/pairing/invites/{Pairing.TokenOf(qr)}/redeem", new RedeemInviteRequest(Guid.NewGuid().ToString(), "Cheeky", DeviceKind.AudioStation, "Test")).ExpectAsync<DeviceCredentialsDto>();

        var device = (await SnapshotAsync(admin)).Devices.Single(d => d.Id == phone.DeviceId);
        Assert.Equal(DeviceKind.Phone, device.Kind);
    }

    [Fact]
    public async Task AudioStation_KnockWithCheckCode_PairsAnAudioStation()
    {
        var admin = await app.AdminAsync();
        var anonymous = app.Anonymous();
        var knock = await anonymous.PostJsonAsync("/api/pairing/requests", new CreatePairingRequest("Mixing desk", DeviceKind.AudioStation, "Windows")).ExpectAsync<PairingRequestCreatedDto>(HttpStatusCode.Created);

        var device = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/pairing/requests/{knock.RequestId}/approve", null, TestContext.Current.CancellationToken).ExpectAsync<DeviceDto>();

        Assert.Equal(DeviceKind.AudioStation, device.Kind);
        Assert.Contains((await SnapshotAsync(admin)).AudioChannels, c => c.SourceId == $"{device.Id}/mic");
    }

    [Fact]
    public async Task SetChannels_RoundTripsThroughTheDatabase()
    {
        var (admin, _, mic) = await StationAsync();

        var all = await SetAsync(admin, false, new AudioChannelDto(mic, -6.5, true, AudioMode.Off, 240)).ExpectAsync<List<AudioChannelDto>>();

        var stored = (await SnapshotAsync(admin)).AudioChannels.Single(c => c.SourceId == mic);
        Assert.Equal(new AudioChannelDto(mic, -6.5, true, AudioMode.Off, 240), stored);
        Assert.Equal(stored, all.Single(c => c.SourceId == mic));
    }

    [Fact]
    public async Task SetChannels_OnTheWire_UsesCamelCaseNamesAndEnumStrings()
    {
        var (admin, _, mic) = await StationAsync();
        using var body = new StringContent($$"""{"channels":[{"sourceId":"{{mic}}","gainDb":-3,"muted":false,"mode":"follow","syncOffsetMs":20}],"adjusting":false}""", Encoding.UTF8, "application/json");

        using var response = await admin.Client.PutAsync(Channels(admin), body, TestContext.Current.CancellationToken);
        await response.ExpectAsync(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));

        var channel = json.RootElement.EnumerateArray().Single(c => c.GetProperty("sourceId").GetString() == mic);
        Assert.Equal(("follow", -3d, 20), (channel.GetProperty("mode").GetString(), channel.GetProperty("gainDb").GetDouble(), channel.GetProperty("syncOffsetMs").GetInt32()));
    }

    [Fact]
    public async Task SetChannels_InvalidValues_AreRefusedWithTheFieldPathAndChangeNothing()
    {
        var (admin, _, mic) = await StationAsync();
        var phone = await app.PairPhoneAsync(admin);
        var camera = $"{phone.DeviceId}/camera";

        Assert.Equal(["channels[0].gainDb"], await ErrorFieldsAsync(SetAsync(admin, false, new AudioChannelDto(mic, 10.5, false, AudioMode.Always, 0))));
        Assert.Equal(["channels[0].gainDb"], await ErrorFieldsAsync(SetAsync(admin, false, new AudioChannelDto(mic, -100.5, false, AudioMode.Always, 0))));
        Assert.Equal(["channels[0].syncOffsetMs"], await ErrorFieldsAsync(SetAsync(admin, false, new AudioChannelDto(mic, 0, false, AudioMode.Always, 501))));
        Assert.Equal(["channels[0].syncOffsetMs"], await ErrorFieldsAsync(SetAsync(admin, false, new AudioChannelDto(mic, 0, false, AudioMode.Always, -1))));
        Assert.Equal(["channels[0].sourceId"], await ErrorFieldsAsync(SetAsync(admin, false, new AudioChannelDto("dev_unknown000000001/mic", 0, false, AudioMode.Always, 0))));
        Assert.Equal(["channels[0].sourceId"], await ErrorFieldsAsync(SetAsync(admin, false, new AudioChannelDto(camera, 0, false, AudioMode.Always, 0))));
        Assert.Equal(["channels[1].sourceId"], await ErrorFieldsAsync(SetAsync(admin, false, new AudioChannelDto(mic, 0, false, AudioMode.Always, 0), new AudioChannelDto(mic, 0, false, AudioMode.Always, 0))));
        Assert.Equal(["channels"], await ErrorFieldsAsync(SetAsync(admin, false)));
        Assert.Equal(new AudioChannelDto(mic, 0, false, AudioMode.Always, 0), (await SnapshotAsync(admin)).AudioChannels.Single(c => c.SourceId == mic));
    }

    [Fact]
    public async Task SetChannels_UnknownModeOrWrongJsonType_IsAValidationErrorNamingTheField()
    {
        var (admin, _, mic) = await StationAsync();

        foreach (var channel in new[]
        {
            $$"""{"sourceId":"{{mic}}","gainDb":0,"muted":false,"mode":"loud","syncOffsetMs":0}""",
            $$"""{"sourceId":"{{mic}}","gainDb":"loud","muted":false,"mode":"always","syncOffsetMs":0}""",
            $$"""{"sourceId":"{{mic}}","gainDb":0,"muted":"yes","mode":"always","syncOffsetMs":0}""",
        })
        {
            using var body = new StringContent("{\"channels\":[" + channel + "]}", Encoding.UTF8, "application/json");
            var fields = await ErrorFieldsAsync(admin.Client.PutAsync(Channels(admin), body, TestContext.Current.CancellationToken));
            Assert.Single(fields);
            Assert.StartsWith("channels[0].", fields[0], StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task SetChannels_Security_NeedsASignedInAdminWithTheCsrfHeader_AndAKnownProduction()
    {
        var (admin, station, mic) = await StationAsync();
        var channel = new SetAudioChannelsRequest([new AudioChannelDto(mic, 0, false, AudioMode.Always, 0)]);

        await app.Anonymous().PutJsonAsync(Channels(admin), channel).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        await app.DeviceClient(station).PutJsonAsync(Channels(admin), channel).ExpectProblemAsync(HttpStatusCode.Unauthorized);
        var withoutCsrf = app.Anonymous();
        withoutCsrf.DefaultRequestHeaders.Add("Cookie", admin.Cookie);
        Assert.Equal(ErrorCodes.Forbidden, await withoutCsrf.PutJsonAsync(Channels(admin), channel).ExpectProblemAsync(HttpStatusCode.Forbidden));
        Assert.Equal(ErrorCodes.NotFound, await admin.Client.PutJsonAsync("/api/productions/prd_unknown000000001/audio/channels", channel).ExpectProblemAsync(HttpStatusCode.NotFound));
    }

    [Fact]
    public async Task Events_AreRevisionedAndReachTheRegieAndTheOutputWithTheSameRevision()
    {
        var (admin, _, mic) = await StationAsync();
        var key = (await admin.GetOutputLinksAsync())[0].Key();
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        await using var output = app.Hub(HubMethods.OutputHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>(key));
        var studioEvents = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        var outputEvents = HubProbe.On<ProductionEvent>(output, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await output.StartAsync(TestContext.Current.CancellationToken);
        var studioStart = await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        var outputStart = await output.InvokeAsync<OutputChangesDto>(HubMethods.SubscribeOutput, null, TestContext.Current.CancellationToken);
        studioEvents.Clear();
        outputEvents.Clear();

        await SetAsync(admin, false, new AudioChannelDto(mic, -6, false, AudioMode.Always, 0)).ExpectAsync(HttpStatusCode.OK);
        var fromStudio = await studioEvents.NextAsync(e => e is AudioChannelsChangedEvent);
        var fromOutput = await outputEvents.NextAsync(e => e is AudioChannelsChangedEvent);
        await SetAsync(admin, false, new AudioChannelDto(mic, -6, false, AudioMode.Always, 0)).ExpectAsync(HttpStatusCode.OK);
        await SetAsync(admin, false, new AudioChannelDto(mic, -9, true, AudioMode.Always, 0)).ExpectAsync(HttpStatusCode.OK);
        var next = await studioEvents.NextAsync(e => e is AudioChannelsChangedEvent);

        Assert.Equal(-6, ((AudioChannelsChangedEvent)fromStudio).Channels.Single().GainDb);
        Assert.Equal(fromStudio.Revision, fromOutput.Revision);
        Assert.True(fromStudio.Revision > studioStart.Revision);
        Assert.Equal(studioStart.Revision, outputStart.Revision);
        Assert.Equal(fromStudio.Revision + 1, next.Revision);
        Assert.Equal(-9, ((AudioChannelsChangedEvent)next).Channels.Single().GainDb);
    }

    [Fact]
    public async Task Subscribe_AfterAMixerChange_ReplaysTheEventToABehindClient()
    {
        var (admin, _, mic) = await StationAsync();
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        var start = await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);

        await SetAsync(admin, false, new AudioChannelDto(mic, -2, false, AudioMode.Always, 5)).ExpectAsync(HttpStatusCode.OK);
        var delta = await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, start.Revision, TestContext.Current.CancellationToken);

        Assert.Null(delta.Snapshot);
        Assert.Equal(-2, delta.Events!.OfType<AudioChannelsChangedEvent>().Single().Channels.Single().GainDb);
    }

    [Fact]
    public async Task Audit_EveryChangeIsAnEntry_ButNotWhileAFaderIsBeingDragged()
    {
        var (admin, _, mic) = await StationAsync();

        await SetAsync(admin, true, new AudioChannelDto(mic, -3, false, AudioMode.Always, 0)).ExpectAsync(HttpStatusCode.OK);
        await SetAsync(admin, true, new AudioChannelDto(mic, -4, false, AudioMode.Always, 0)).ExpectAsync(HttpStatusCode.OK);
        await SetAsync(admin, false, new AudioChannelDto(mic, -5, true, AudioMode.Follow, 120)).ExpectAsync(HttpStatusCode.OK);

        var page = await admin.Client.GetAsync("/api/audit?action=audio.changed&limit=50", TestContext.Current.CancellationToken).ExpectAsync<AuditPageDto>();
        var changes = page.Entries.Where(e => e.ProductionId == admin.ProductionId).ToList();
        Assert.All(changes, e => Assert.Equal(("audio.changed", AuditCategory.Production), (e.Action, e.Category)));
        Assert.Equal(ChangeTexts, changes.Select(e => e.Text).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task SetChannels_TwoSeatsMovingDifferentFaders_BothChangesSurvive()
    {
        var (admin, _, mic) = await StationAsync();
        var laptop = await app.PairLaptopAsync(admin);
        var screen = $"{laptop.DeviceId}/screen-1";

        await Task.WhenAll(
            Enumerable.Range(0, 20).Select(i => SetAsync(admin, true, new AudioChannelDto(mic, -i, false, AudioMode.Always, i))).Concat(
            Enumerable.Range(0, 20).Select(i => SetAsync(admin, true, new AudioChannelDto(screen, -i - 20, false, AudioMode.Follow, i)))).Select(r => r.ExpectAsync(HttpStatusCode.OK)));

        var channels = (await SnapshotAsync(admin)).AudioChannels;
        Assert.InRange(channels.Single(c => c.SourceId == mic).GainDb, -19, 0);
        Assert.InRange(channels.Single(c => c.SourceId == screen).GainDb, -39, -20);
    }

    [Fact]
    public async Task ManyChannels_AllAreMixedAndRemovedWithTheirDevices()
    {
        var admin = await FreshAsync();
        var stations = await Task.WhenAll(Enumerable.Range(0, 12).Select(i => app.PairAudioStationAsync(admin, $"Desk {i}")));

        var snapshot = await SnapshotAsync(admin);
        Assert.Equal(12, snapshot.AudioChannels.Count);
        await SetAsync(admin, false, [.. stations.Select((s, i) => new AudioChannelDto($"{s.DeviceId}/mic", -i, i % 2 == 0, AudioMode.Always, i * 10))]).ExpectAsync(HttpStatusCode.OK);
        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/devices/{stations[0].DeviceId}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        var after = (await SnapshotAsync(admin)).AudioChannels;
        Assert.Equal(11, after.Count);
        Assert.DoesNotContain(after, c => c.SourceId.StartsWith(stations[0].DeviceId, StringComparison.Ordinal));
        Assert.Equal(-5, after.Single(c => c.SourceId == $"{stations[5].DeviceId}/mic").GainDb);
    }

    [Fact]
    public async Task DeviceMicrophone_StartsMuted_AndIsNotASceneItem()
    {
        var admin = await FreshAsync();
        var phone = await app.PairPhoneAsync(admin);
        var device = app.DeviceClient(phone);

        var slot = await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Audio)).ExpectAsync<DeviceSlotDto>();
        await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Audio)).ExpectProblemAsync(HttpStatusCode.Conflict);
        var sceneId = (await SnapshotAsync(admin)).Scenes[1].Id;
        var asItem = await ErrorFieldsAsync(admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/scenes/{sceneId}/items", new AddSceneItemRequest($"{phone.DeviceId}/mic", null, null, null, null, null, null)));

        Assert.Equal(("mic", SourceKind.Audio), (slot.Slot, slot.Kind));
        Assert.Equal(new AudioChannelDto($"{phone.DeviceId}/mic", 0, true, AudioMode.Follow, 0), (await SnapshotAsync(admin)).AudioChannels.Single());
        Assert.Equal(["source"], asItem);
    }

    [Fact]
    public async Task AudioStation_CannotAllocateAScreen_OrRemoveItsMicrophone()
    {
        var (_, station, _) = await StationAsync();
        var device = app.DeviceClient(station);

        await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Screen)).ExpectProblemAsync(HttpStatusCode.BadRequest);
        await device.DeleteAsync("/api/device/slots/mic", TestContext.Current.CancellationToken).ExpectProblemAsync(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task ReleasedMicrophone_TakesItsChannelWithIt()
    {
        var admin = await FreshAsync();
        var laptop = await app.PairLaptopAsync(admin);
        var device = app.DeviceClient(laptop);
        await device.PostJsonAsync("/api/device/slots", new AllocateSlotRequest(SourceKind.Audio)).ExpectAsync<DeviceSlotDto>();
        Assert.Equal(2, (await SnapshotAsync(admin)).AudioChannels.Count);

        await device.DeleteAsync("/api/device/slots/mic", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        Assert.Equal([$"{laptop.DeviceId}/screen-1"], (await SnapshotAsync(admin)).AudioChannels.Select(c => c.SourceId));
    }

    [Fact]
    public async Task Report_Slots_AcceptTheMicrophoneSlot()
    {
        var (admin, station, mic) = await StationAsync();
        var device = app.DeviceClient(station);
        var report = new DeviceReportDto(RtcState.Connected, [new SlotTelemetryDto("mic", SlotState.Live, null, null, null, 128, 0, "opus")], null, null, null, 20, null);

        await device.PostJsonAsync("/api/device/report", report).ExpectAsync(HttpStatusCode.NoContent);

        Assert.NotNull((await SnapshotAsync(admin)).Sources.Single(s => s.Id == mic));
    }

    [Fact]
    public async Task OutputReport_AudioStateReachesTheRegieStatus_AndNonsenseIsDropped()
    {
        var admin = await FreshAsync();
        var key = (await admin.GetOutputLinksAsync())[0].Key();
        var slug = (await SnapshotAsync(admin)).Production.Slug;
        await using var studio = app.Hub(HubMethods.StudioHubPath, o => o.Headers["Cookie"] = admin.Cookie);
        var events = HubProbe.On<ProductionEvent>(studio, HubMethods.Event);
        await studio.StartAsync(TestContext.Current.CancellationToken);
        await studio.InvokeAsync<ProductionChangesDto>(HubMethods.Subscribe, admin.ProductionId, null, TestContext.Current.CancellationToken);
        await using var output = app.Hub(HubMethods.OutputHubPath, o => o.AccessTokenProvider = () => Task.FromResult<string?>(key));
        await output.StartAsync(TestContext.Current.CancellationToken);

        await output.InvokeAsync(HubMethods.Report, new OutputReport(true, 80, 30, null, Audio: new OutputAudioDto(OutputAudioState.Blocked, null)), TestContext.Current.CancellationToken);
        var blocked = await events.NextAsync(e => e is OutputStatusChangedEvent { Status.Links: [{ Audio.State: OutputAudioState.Blocked }] });
        await output.InvokeAsync(HubMethods.Report, new OutputReport(true, 80, 30, null, Audio: new OutputAudioDto(OutputAudioState.Running, -18.26)), TestContext.Current.CancellationToken);
        var running = await events.NextAsync(e => e is OutputStatusChangedEvent { Status.Links: [{ Audio.State: OutputAudioState.Running }] });
        using var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("X-Output-Key", key);
        await client.PostJsonAsync($"/api/output/{slug}/report", new OutputReport(true, 80, 30, null, Audio: new OutputAudioDto(OutputAudioState.Running, 300))).ExpectAsync(HttpStatusCode.NoContent);

        Assert.Null(((OutputStatusChangedEvent)blocked).Status.Links[0].Audio!.LevelDb);
        Assert.Equal(-18.3, ((OutputStatusChangedEvent)running).Status.Links[0].Audio!.LevelDb);
    }

    [Fact]
    public async Task OutputReport_UnknownAudioState_IsAValidationError()
    {
        var admin = await FreshAsync();
        var key = (await admin.GetOutputLinksAsync())[0].Key();
        var slug = (await SnapshotAsync(admin)).Production.Slug;
        using var client = app.Anonymous();
        client.DefaultRequestHeaders.Add("X-Output-Key", key);
        using var body = new StringContent("""{"rendering":true,"latencyMs":1,"fps":1,"programSceneId":null,"audio":{"state":"loud","levelDb":-3}}""", Encoding.UTF8, "application/json");

        var fields = await ErrorFieldsAsync(client.PostAsync($"/api/output/{slug}/report", body, TestContext.Current.CancellationToken));

        Assert.Equal(["audio.state"], fields);
    }

    [Fact]
    public async Task Upload_VideoWithSound_GetsAChannel_AVideoWithoutDoesNot_AndDeletingRemovesIt()
    {
        var admin = await FreshAsync();

        var withSound = await UploadAsync(admin, MediaSamples.Mp4WithTracks(["vide", "soun"]), "talk.mp4").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var silent = await UploadAsync(admin, MediaSamples.Mp4WithTracks(["vide"]), "silent.mp4").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var webm = await UploadAsync(admin, MediaSamples.WebMWithTracks(1, 2), "talk.webm").ExpectAsync<AssetDto>(HttpStatusCode.Created);

        Assert.Equal((true, false, true), (withSound.HasAudio, silent.HasAudio, webm.HasAudio));
        var channels = (await SnapshotAsync(admin)).AudioChannels;
        Assert.Equal(new AudioChannelDto(withSound.Id, 0, false, AudioMode.Follow, 0), channels.Single(c => c.SourceId == withSound.Id));
        Assert.DoesNotContain(channels, c => c.SourceId == silent.Id);
        await SetAsync(admin, false, new AudioChannelDto(withSound.Id, 0, false, AudioMode.Always, 0)).ExpectProblemAsync(HttpStatusCode.BadRequest);

        await admin.Client.DeleteAsync($"/api/productions/{admin.ProductionId}/assets/{withSound.Id}", TestContext.Current.CancellationToken).ExpectAsync(HttpStatusCode.NoContent);

        Assert.DoesNotContain((await SnapshotAsync(admin)).AudioChannels, c => c.SourceId == withSound.Id);
    }

    [Fact]
    public async Task DuplicateAndImport_TakeTheSoundOfVideosAlong_WithTheirMixerSettings()
    {
        var admin = await FreshAsync();
        var talk = await UploadAsync(admin, MediaSamples.Mp4WithTracks(["vide", "soun"]), "talk.mp4").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var interview = await UploadAsync(admin, MediaSamples.Mp4WithTracks(["vide", "soun"]), "interview.mp4").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        await UploadAsync(admin, MediaSamples.Mp4WithTracks(["vide"]), "silent.mp4").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        await app.PairAudioStationAsync(admin);
        await SetAsync(admin, false, new AudioChannelDto(interview.Id, -6.5, true, AudioMode.Off, 120)).ExpectAsync(HttpStatusCode.OK);

        var copy = await admin.Client.PostJsonAsync($"/api/productions/{admin.ProductionId}/duplicate", new DuplicateProductionRequest("Copy " + Guid.NewGuid().ToString("N")[..8])).ExpectAsync<ProductionDto>(HttpStatusCode.Created);
        var archive = await TransferSupport.ExportAsync(admin, admin.ProductionId);
        var imported = await TransferSupport.ImportAsync(admin, archive).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        foreach (var id in new[] { copy.Id, imported.Id })
        {
            var snapshot = await TransferSupport.SnapshotAsync(admin, id);
            Assert.Equal([("talk", true), ("interview", true), ("silent", false)], snapshot.Assets.Select(a => (a.Name, a.HasAudio)));

            // Every video with sound has its channel under its new id, with the settings of the original. The audio station is
            // a device and stays behind; the silent video has no channel.
            Assert.Equal(
                [new AudioChannelDto(snapshot.Assets[0].Id, 0, false, AudioMode.Follow, 0), new AudioChannelDto(snapshot.Assets[1].Id, -6.5, true, AudioMode.Off, 120)],
                snapshot.AudioChannels);
            Assert.DoesNotContain(snapshot.AudioChannels, c => c.SourceId == talk.Id || c.SourceId == interview.Id);
        }
    }

    [Fact]
    public async Task Import_OfAFileFromBeforeTheMixer_GivesTheVideosTheirDefaultChannels()
    {
        var admin = await FreshAsync();
        await UploadAsync(admin, MediaSamples.Mp4WithTracks(["vide", "soun"]), "talk.mp4").ExpectAsync<AssetDto>(HttpStatusCode.Created);
        var archive = await TransferSupport.ExportAsync(admin, admin.ProductionId);

        // The same file as version 1 wrote it: no sound settings.
        var old = TransferSupport.WithManifest(archive, manifest =>
        {
            manifest["formatVersion"] = 1;
            manifest.Remove("audioChannels");
        });
        var imported = await TransferSupport.ImportAsync(admin, old).ExpectAsync<ProductionDto>(HttpStatusCode.Created);

        var snapshot = await TransferSupport.SnapshotAsync(admin, imported.Id);
        Assert.Equal([new AudioChannelDto(snapshot.Assets[0].Id, 0, false, AudioMode.Follow, 0)], snapshot.AudioChannels);
    }

    [Fact]
    public async Task LiveKitToken_Sender_MayPublishPictureAndSound()
    {
        var admin = await FreshAsync();
        var credentials = await app.PairAudioStationAsync(admin);

        var token = await app.DeviceClient(credentials).PostAsync("/api/device/livekit-token", null, TestContext.Current.CancellationToken).ExpectAsync<LiveKitTokenDto>();
        var video = new JsonWebToken(token.Token).GetPayloadValue<JsonElement>("video");

        Assert.True(video.GetProperty("canPublish").GetBoolean());
        Assert.Equal(["camera", "screen_share", "microphone", "screen_share_audio"], video.GetProperty("canPublishSources").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task LiveKitToken_RegieAndOutput_CannotPublishAnything()
    {
        var admin = await FreshAsync();
        var key = (await admin.GetOutputLinksAsync())[0].Key();
        var slug = (await SnapshotAsync(admin)).Production.Slug;
        using var output = app.Anonymous();
        output.DefaultRequestHeaders.Add("X-Output-Key", key);

        var studioToken = await admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/livekit-token", null, TestContext.Current.CancellationToken).ExpectAsync<LiveKitTokenDto>();
        var outputToken = await output.PostAsync($"/api/output/{slug}/livekit-token", null, TestContext.Current.CancellationToken).ExpectAsync<LiveKitTokenDto>();

        foreach (var dto in new[] { studioToken, outputToken })
        {
            var video = new JsonWebToken(dto.Token).GetPayloadValue<JsonElement>("video");
            Assert.False(video.GetProperty("canPublish").GetBoolean());
            Assert.False(video.GetProperty("canPublishData").GetBoolean());
            Assert.True(video.GetProperty("canSubscribe").GetBoolean());
            Assert.False(video.TryGetProperty("canPublishSources", out _));
        }
    }

    private static Task<HttpResponseMessage> UploadAsync(AdminSession admin, byte[] bytes, string fileName)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        content.Add(file, "file", fileName);
        return admin.Client.PostAsync($"/api/productions/{admin.ProductionId}/assets", content);
    }
}

public sealed class MediaTrackReaderTests
{
    private static bool HasAudio(byte[] bytes, MediaType type)
    {
        using var stream = new MemoryStream(bytes);
        return MediaTrackReader.HasAudio(stream, type);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Mp4_WithASoundTrack_HasAudioWhereverTheMoovBoxIs(bool audio, bool moovFirst)
    {
        var bytes = MediaSamples.Mp4WithTracks(audio ? ["vide", "soun"] : ["vide"], moovFirst);

        Assert.Equal(audio, HasAudio(bytes, MediaInspector.Mp4));
    }

    [Fact]
    public void Mp4_OnlyVideoTracksAndAMoovWithoutTracks_HaveNoAudio()
    {
        Assert.False(HasAudio(MediaSamples.Mp4WithTracks(["vide", "vide"]), MediaInspector.Mp4));
        Assert.False(HasAudio(MediaSamples.Mp4WithTracks([]), MediaInspector.Mp4));
        Assert.False(HasAudio(MediaSamples.Mp4(), MediaInspector.Mp4));
    }

    [Theory]
    [InlineData(new[] { 1, 2 }, true)]
    [InlineData(new[] { 2 }, true)]
    [InlineData(new[] { 1 }, false)]
    [InlineData(new int[0], false)]
    public void WebM_WithAnAudioTrackEntry_HasAudio(int[] trackTypes, bool expected) =>
        Assert.Equal(expected, HasAudio(MediaSamples.WebMWithTracks(trackTypes), MediaInspector.WebM));

    [Fact]
    public void BrokenAndTruncatedFiles_HaveNoAudioAndNeverThrow()
    {
        var mp4 = MediaSamples.Mp4WithTracks(["vide", "soun"]);
        var webm = MediaSamples.WebMWithTracks(1, 2);

        for (var length = 0; length < mp4.Length; length += 7)
        {
            HasAudio(mp4[..length], MediaInspector.Mp4);
        }

        for (var length = 0; length < webm.Length; length += 5)
        {
            HasAudio(webm[..length], MediaInspector.WebM);
        }

        Assert.False(HasAudio(mp4[..60], MediaInspector.Mp4));
        Assert.False(HasAudio(webm[..30], MediaInspector.WebM));
        Assert.False(HasAudio(new byte[512], MediaInspector.Mp4));
        Assert.False(HasAudio(new byte[512], MediaInspector.WebM));
        Assert.False(HasAudio(Enumerable.Repeat((byte)0xFF, 512).ToArray(), MediaInspector.WebM));
    }

    [Fact]
    public void ImagesAndOtherTypes_HaveNoAudio()
    {
        Assert.False(HasAudio(MediaSamples.Png(8, 8), MediaInspector.Png));
        Assert.False(HasAudio(MediaSamples.Mp4WithTracks(["soun"]), MediaInspector.Jpeg));
    }
}
