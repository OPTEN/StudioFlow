using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Domain;

public sealed class AudioSourcesTests
{
    private readonly Production production = Build.Production();

    [Fact]
    public void AudioStation_Pair_GetsOnlyTheMicrophoneSlotWithCodeA1()
    {
        var station = Build.AudioStation(production);

        var slot = Assert.Single(station.Slots);
        Assert.Equal((DeviceSlots.Mic, "A1", SourceKind.Audio), (slot.Slot, slot.Code, slot.Kind));
        Assert.Equal("Mixing desk", station.LabelOf(slot));
    }

    [Fact]
    public void AllocateSlot_Audio_GivesTheDeviceOneMicrophoneAndTheNextACode()
    {
        var station = Build.AudioStation(production);
        var phone = Build.Phone(production, codes: station.Slots.Select(s => s.Code));

        var mic = phone.AllocateSlot(SourceKind.Audio, ["A1", "K1"]);

        Assert.Equal(("mic", "A2", SourceKind.Audio), (mic.Slot, mic.Code, mic.Kind));
        Assert.Equal("Phone 1 · Microphone", phone.LabelOf(mic));
        var error = Assert.Throws<StudioFlowException>(() => phone.AllocateSlot(SourceKind.Audio, ["A1", "A2"]));
        Assert.Equal(ErrorCodes.LimitReached, error.Code);
    }

    [Fact]
    public void AllocateSlot_Laptop_MayHaveScreensCameraAndMicrophone()
    {
        var laptop = Build.Laptop(production);

        laptop.AllocateSlot(SourceKind.Camera, ["S1"]);
        laptop.AllocateSlot(SourceKind.Audio, ["S1", "K1"]);

        Assert.Equal(["screen-1", "camera", "mic"], laptop.Slots.Select(s => s.Slot));
    }

    [Theory]
    [InlineData(SourceKind.Camera)]
    [InlineData(SourceKind.Screen)]
    [InlineData(SourceKind.Image)]
    public void AllocateSlot_AudioStation_RefusesEverythingButTheMicrophone(SourceKind kind)
    {
        var station = Build.AudioStation(production);

        var error = Assert.Throws<StudioFlowException>(() => station.AllocateSlot(kind, ["A1"]));

        Assert.Equal(ErrorCodes.ValidationFailed, error.Code);
        Assert.Contains("kind", error.Errors!.Keys);
    }

    [Fact]
    public void ReleaseSlot_TheMicrophoneOfAnAudioStation_IsAConflictButAPhoneMicrophoneGoes()
    {
        var station = Build.AudioStation(production);
        var phone = Build.Phone(production);
        phone.AllocateSlot(SourceKind.Audio, ["A1", "K1"]);

        var error = Assert.Throws<StudioFlowException>(() => station.ReleaseSlot(DeviceSlots.Mic));
        var released = phone.ReleaseSlot(DeviceSlots.Mic);

        Assert.Equal(ErrorCodes.Conflict, error.Code);
        Assert.Equal("A2", released?.Code);
        Assert.Single(phone.Slots);
    }

    [Fact]
    public void DefaultName_AudioStation_CountsFromOne()
    {
        Assert.Equal("Audio station 1", Device.DefaultName(DeviceKind.AudioStation, ["Phone 1"]));
        Assert.Equal("Audio station 2", Device.DefaultName(DeviceKind.AudioStation, ["Audio station 1"]));
    }

    [Fact]
    public void SlotCode_Audio_UsesTheLetterA()
    {
        Assert.Equal("A1", SlotCodes.Allocate(SourceKind.Audio, ["K1", "S1", "M1"]));
        Assert.Equal("A3", SlotCodes.Allocate(SourceKind.Audio, ["A1", "A2"]));
        Assert.Equal("A2", SlotCodes.Allocate(SourceKind.Audio, ["A1", "A3"]));
    }

    [Fact]
    public void SourceRef_Mic_IsADeviceSlot()
    {
        Assert.True(SourceRef.TryParse("dev_abcd1234/mic", out var parsed));
        Assert.True(parsed.IsDevice);
        Assert.Equal("mic", parsed.Slot);
        Assert.True(DeviceSlots.IsValid("mic"));
        Assert.False(DeviceSlots.IsValid("mic-1"));
        Assert.False(DeviceSlots.IsValid("screen-1-audio"));
    }

    [Fact]
    public void AddItem_AnAudioSource_HasNoPicture()
    {
        var station = Build.AudioStation(production);
        var scene = production.OrderedScenes[0];
        var catalog = new SourceCatalog([station], []);

        var error = Assert.Throws<StudioFlowException>(() => scene.AddItem(Build.Add(station.SourceIdOf(station.Slots[0])), catalog, CanvasSize.FullHd));

        Assert.Equal(ErrorCodes.ValidationFailed, error.Code);
        Assert.Equal("An audio source has no picture.", error.Errors!["source"].Single());
    }

    [Fact]
    public void ReplaceItems_AnAudioSource_IsRefusedAsItemAndAsFallback()
    {
        var station = Build.AudioStation(production);
        var phone = Build.Phone(production, codes: ["A1"]);
        var scene = production.OrderedScenes[0];
        var catalog = new SourceCatalog([station, phone], []);
        var mic = station.SourceIdOf(station.Slots[0]);
        var camera = phone.SourceIdOf(phone.Slots[0]);

        var asItem = Assert.Throws<StudioFlowException>(() => scene.ReplaceItems([Build.Item(mic)], null, catalog));
        var asFallback = Assert.Throws<StudioFlowException>(() => scene.ReplaceItems([Build.Item(camera) with { OnLost = new LostBehaviorDto(3000, mic) }], null, catalog));

        Assert.Contains("items[0].source", asItem.Errors!.Keys);
        Assert.Contains("items[0].onLost.fallbackSource", asFallback.Errors!.Keys);
        Assert.Empty(scene.Items);
    }
}

public sealed class AudioMixerRulesTests
{
    private readonly Production production = Build.Production();

    private static SourceCatalog Catalog(params Device[] devices) => new(devices, []);

    private static SourceEntry Entry(SourceCatalog catalog, Device device, int slot = 0) => catalog.Find(device.SourceIdOf(device.Slots[slot]))!;

    [Fact]
    public void CarriesSound_OnlyMicrophonesScreensAndVideosWithAudio()
    {
        var phone = Build.Phone(production);
        var laptop = Build.Laptop(production);
        var station = Build.AudioStation(production);
        var withSound = Build.Video(production, hasAudio: true);
        var silent = Build.Video(production, "Silent");
        var image = Build.Image(production);
        var text = SourceCatalog.TextEntry(new TextSourceDto("txt_abcd1234", "T1", "Mia", null, TextStyle.Title, TextAlign.Center));
        var catalog = new SourceCatalog([phone, laptop, station], [withSound, silent, image], [new TextSourceDto("txt_abcd1234", "T1", "Mia", null, TextStyle.Title, TextAlign.Center)]);

        Assert.False(AudioMixerRules.CarriesSound(Entry(catalog, phone)));
        Assert.True(AudioMixerRules.CarriesSound(Entry(catalog, laptop)));
        Assert.True(AudioMixerRules.CarriesSound(Entry(catalog, station)));
        Assert.True(AudioMixerRules.CarriesSound(SourceCatalog.AssetEntry(withSound)));
        Assert.False(AudioMixerRules.CarriesSound(SourceCatalog.AssetEntry(silent)));
        Assert.False(AudioMixerRules.CarriesSound(SourceCatalog.AssetEntry(image)));
        Assert.False(AudioMixerRules.CarriesSound(text));
    }

    [Fact]
    public void DefaultChannel_AnAudioStationIsAlwaysAudibleAndADeviceMicrophoneStartsMuted()
    {
        var station = Build.AudioStation(production);
        var phone = Build.Phone(production, codes: ["A1"]);
        var mic = phone.AllocateSlot(SourceKind.Audio, ["A1", "K1"]);
        var catalog = Catalog(station, phone);

        var stationChannel = AudioMixerRules.DefaultChannel(Entry(catalog, station));
        var micChannel = AudioMixerRules.DefaultChannel(catalog.Find(phone.SourceIdOf(mic))!);

        Assert.Equal(new AudioChannelDto(station.SourceIdOf(station.Slots[0]), 0, false, AudioMode.Always, 0), stationChannel);
        Assert.Equal(new AudioChannelDto(phone.SourceIdOf(mic), 0, true, AudioMode.Follow, 0), micChannel);
    }

    [Fact]
    public void DefaultChannel_ScreensAndVideosFollowThePicture()
    {
        var laptop = Build.Laptop(production);
        var video = Build.Video(production, hasAudio: true);
        var catalog = new SourceCatalog([laptop], [video]);

        Assert.Equal(new AudioChannelDto(laptop.SourceIdOf(laptop.Slots[0]), 0, false, AudioMode.Follow, 0), AudioMixerRules.DefaultChannel(Entry(catalog, laptop)));
        Assert.Equal(new AudioChannelDto(video.Id, 0, false, AudioMode.Follow, 0), AudioMixerRules.DefaultChannel(SourceCatalog.AssetEntry(video)));
    }

    [Theory]
    [InlineData(10, true)]
    [InlineData(-100, true)]
    [InlineData(0, true)]
    [InlineData(10.01, false)]
    [InlineData(11, false)]
    [InlineData(-100.01, false)]
    [InlineData(double.NaN, false)]
    [InlineData(double.PositiveInfinity, false)]
    [InlineData(double.NegativeInfinity, false)]
    public void Validate_Gain_MustBeAFiniteNumberFromMinus100To10(double gain, bool valid)
    {
        var station = Build.AudioStation(production);
        var catalog = Catalog(station);
        var channel = new AudioChannelDto(station.SourceIdOf(station.Slots[0]), gain, false, AudioMode.Always, 0);

        if (valid)
        {
            AudioMixerRules.Validate([channel], catalog);
        }
        else
        {
            var error = Assert.Throws<StudioFlowException>(() => AudioMixerRules.Validate([channel], catalog));
            Assert.Equal(["channels[0].gainDb"], error.Errors!.Keys);
        }
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(500, true)]
    [InlineData(501, false)]
    [InlineData(-1, false)]
    [InlineData(int.MaxValue, false)]
    public void Validate_SyncOffset_MustBeZeroTo500Milliseconds(int offset, bool valid)
    {
        var station = Build.AudioStation(production);
        var catalog = Catalog(station);
        var channel = new AudioChannelDto(station.SourceIdOf(station.Slots[0]), 0, false, AudioMode.Always, offset);

        if (valid)
        {
            AudioMixerRules.Validate([channel], catalog);
        }
        else
        {
            var error = Assert.Throws<StudioFlowException>(() => AudioMixerRules.Validate([channel], catalog));
            Assert.Equal(["channels[0].syncOffsetMs"], error.Errors!.Keys);
        }
    }

    [Fact]
    public void Validate_UnknownSourceACameraAnImageAndAMissingChannel_AreRefusedWithTheirPath()
    {
        var phone = Build.Phone(production);
        var station = Build.AudioStation(production);
        var image = Build.Image(production);
        var catalog = new SourceCatalog([phone, station], [image]);
        var mic = station.SourceIdOf(station.Slots[0]);

        var error = Assert.Throws<StudioFlowException>(() => AudioMixerRules.Validate(
            [
                new AudioChannelDto("dev_unknown1/mic", 0, false, AudioMode.Always, 0),
                new AudioChannelDto(phone.SourceIdOf(phone.Slots[0]), 0, false, AudioMode.Always, 0),
                new AudioChannelDto(image.Id, 0, false, AudioMode.Always, 0),
                null,
                new AudioChannelDto(mic, 0, false, AudioMode.Always, 0),
                new AudioChannelDto(mic, 0, false, AudioMode.Always, 0),
            ],
            catalog));

        Assert.Equal(
            ["channels[0].sourceId", "channels[1].sourceId", "channels[2].sourceId", "channels[3]", "channels[5].sourceId"],
            error.Errors!.Keys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Validate_NoChannelsAndAnUndefinedMode_AreRefused()
    {
        var station = Build.AudioStation(production);
        var catalog = Catalog(station);

        Assert.Contains("channels", Assert.Throws<StudioFlowException>(() => AudioMixerRules.Validate(null, catalog)).Errors!.Keys);
        Assert.Contains("channels", Assert.Throws<StudioFlowException>(() => AudioMixerRules.Validate([], catalog)).Errors!.Keys);
        var undefined = new AudioChannelDto(station.SourceIdOf(station.Slots[0]), 0, false, (AudioMode)42, 0);
        Assert.Contains("channels[0].mode", Assert.Throws<StudioFlowException>(() => AudioMixerRules.Validate([undefined], catalog)).Errors!.Keys);
    }

    [Fact]
    public void Validate_TheSoundOfAVideoCannotBeAlwaysAudible()
    {
        var video = Build.Video(production, hasAudio: true);
        var catalog = new SourceCatalog([], [video]);

        AudioMixerRules.Validate([new AudioChannelDto(video.Id, 0, false, AudioMode.Follow, 0)], catalog);
        AudioMixerRules.Validate([new AudioChannelDto(video.Id, 0, false, AudioMode.Off, 0)], catalog);
        var error = Assert.Throws<StudioFlowException>(() => AudioMixerRules.Validate([new AudioChannelDto(video.Id, 0, false, AudioMode.Always, 0)], catalog));

        Assert.Equal(["channels[0].mode"], error.Errors!.Keys);
    }

    [Theory]
    [InlineData(BroadcastState.Live, false, 0, AudioMode.Always, true)]
    [InlineData(BroadcastState.Live, false, 10, AudioMode.Always, true)]
    [InlineData(BroadcastState.Live, false, -99.9, AudioMode.Always, true)]
    [InlineData(BroadcastState.Live, false, -100, AudioMode.Always, false)]
    [InlineData(BroadcastState.Live, true, 0, AudioMode.Always, false)]
    [InlineData(BroadcastState.Live, false, 0, AudioMode.Off, false)]
    [InlineData(BroadcastState.Standby, false, 0, AudioMode.Always, false)]
    [InlineData(BroadcastState.Ended, false, 0, AudioMode.Always, false)]
    public void IsAudible_NeedsALiveBroadcastAnOpenFaderNoMuteAndAMode(BroadcastState broadcast, bool muted, double gain, AudioMode mode, bool expected)
    {
        var channel = new AudioChannelDto("dev_abcd1234/mic", gain, muted, mode, 0);

        Assert.Equal(expected, AudioMixerRules.IsAudible(channel, broadcast, new HashSet<string>()));
    }

    [Fact]
    public void IsAudible_FollowThePicture_ForAMicrophoneTheWholeDeviceCounts()
    {
        var mic = new AudioChannelDto("dev_abcd1234/mic", 0, false, AudioMode.Follow, 0);

        Assert.True(AudioMixerRules.IsAudible(mic, BroadcastState.Live, new HashSet<string> { "dev_abcd1234/camera" }));
        Assert.True(AudioMixerRules.IsAudible(mic, BroadcastState.Live, new HashSet<string> { "ast_other0001", "dev_abcd1234/screen-2" }));
        Assert.False(AudioMixerRules.IsAudible(mic, BroadcastState.Live, new HashSet<string> { "dev_efgh5678/camera", "ast_other0001" }));
        Assert.False(AudioMixerRules.IsAudible(mic, BroadcastState.Live, new HashSet<string>()));
    }

    [Fact]
    public void IsAudible_FollowThePicture_AScreenOrVideoNeedsItsOwnItem()
    {
        var screen = new AudioChannelDto("dev_abcd1234/screen-1", 0, false, AudioMode.Follow, 0);
        var video = new AudioChannelDto("ast_video0001", 0, false, AudioMode.Follow, 0);

        Assert.True(AudioMixerRules.IsAudible(screen, BroadcastState.Live, new HashSet<string> { "dev_abcd1234/screen-1" }));
        Assert.False(AudioMixerRules.IsAudible(screen, BroadcastState.Live, new HashSet<string> { "dev_abcd1234/screen-2", "dev_abcd1234/camera" }));
        Assert.True(AudioMixerRules.IsAudible(video, BroadcastState.Live, new HashSet<string> { "ast_video0001" }));
        Assert.False(AudioMixerRules.IsAudible(video, BroadcastState.Live, new HashSet<string> { "ast_video0002" }));
    }
}

public sealed class ProductionMixerTests
{
    private readonly Production production = Build.Production();

    [Fact]
    public void ApplyAudioChannels_ReplacesOnlyTheListedChannels_AndReportsBeforeAndAfter()
    {
        var station = Build.AudioStation(production);
        var laptop = Build.Laptop(production, codes: ["A1"]);
        laptop.AllocateSlot(SourceKind.Audio, ["A1", "S1"]);
        var catalog = new SourceCatalog([station, laptop], []);
        production.SyncAudioChannels(catalog);
        var stationMic = station.SourceIdOf(station.Slots[0]);
        var laptopMic = laptop.SourceIdOf(laptop.Slots[1]);

        var changes = production.ApplyAudioChannels([new AudioChannelDto(laptopMic, -6, false, AudioMode.Follow, 120)], catalog);

        var change = Assert.Single(changes);
        Assert.Equal(new AudioChannelDto(laptopMic, 0, true, AudioMode.Follow, 0), change.Before);
        Assert.Equal(new AudioChannelDto(laptopMic, -6, false, AudioMode.Follow, 120), change.After);
        Assert.Equal(new AudioChannelDto(stationMic, 0, false, AudioMode.Always, 0), production.FindAudioChannel(stationMic));
        Assert.Equal(change.After, production.FindAudioChannel(laptopMic));
    }

    [Fact]
    public void ApplyAudioChannels_AnUnchangedChannel_IsNoChange()
    {
        var station = Build.AudioStation(production);
        var catalog = new SourceCatalog([station], []);
        production.SyncAudioChannels(catalog);
        var current = production.AudioChannels.Single();

        Assert.Empty(production.ApplyAudioChannels([current with { }], catalog));
    }

    [Fact]
    public void ApplyAudioChannels_OneInvalidChannel_AppliesNothing()
    {
        var station = Build.AudioStation(production);
        var catalog = new SourceCatalog([station], []);
        production.SyncAudioChannels(catalog);
        var before = production.AudioChannels;
        var mic = station.SourceIdOf(station.Slots[0]);

        Assert.Throws<StudioFlowException>(() => production.ApplyAudioChannels(
            [new AudioChannelDto(mic, -3, false, AudioMode.Always, 10), new AudioChannelDto(mic.Replace("dev_", "dev_x", StringComparison.Ordinal), 0, false, AudioMode.Always, 0)],
            catalog));

        Assert.Same(before, production.AudioChannels);
    }

    [Fact]
    public void ApplyAudioChannels_ASourceWithoutAStoredChannel_GetsOne()
    {
        var station = Build.AudioStation(production);
        var catalog = new SourceCatalog([station], []);
        var mic = station.SourceIdOf(station.Slots[0]);

        var changes = production.ApplyAudioChannels([new AudioChannelDto(mic, -3, false, AudioMode.Always, 0)], catalog);

        Assert.Equal(AudioMixerRules.DefaultChannel(catalog.Find(mic)!), Assert.Single(changes).Before);
        Assert.Equal(-3, production.FindAudioChannel(mic)!.GainDb);
    }

    [Fact]
    public void SyncAudioChannels_CreatesMissingChannels_AndDropsTheOnesOfSourcesThatAreGone()
    {
        var station = Build.AudioStation(production);
        var laptop = Build.Laptop(production, codes: ["A1"]);
        var video = Build.Video(production, hasAudio: true);
        var silent = Build.Video(production, "Silent", ["M1"]);
        var catalog = new SourceCatalog([station, laptop], [video, silent]);

        var created = production.SyncAudioChannels(catalog);

        Assert.Equal(
            new[] { station.SourceIdOf(station.Slots[0]), laptop.SourceIdOf(laptop.Slots[0]), video.Id }.Order(StringComparer.Ordinal),
            created.Select(c => c.SourceId).Order(StringComparer.Ordinal));
        Assert.Empty(production.SyncAudioChannels(catalog));

        var withoutLaptop = new SourceCatalog([station], [video, silent]);
        production.SyncAudioChannels(withoutLaptop);

        Assert.DoesNotContain(production.AudioChannels, c => c.SourceId == laptop.SourceIdOf(laptop.Slots[0]));
        Assert.Equal(2, production.AudioChannels.Count);
    }

    [Fact]
    public void AddAndRemoveAudioChannels_AreIdempotent()
    {
        var station = Build.AudioStation(production);
        var entries = new[] { SourceCatalog.DeviceEntry(station, station.Slots[0]) };

        Assert.Single(production.AddAudioChannels(entries));
        Assert.Empty(production.AddAudioChannels(entries));
        Assert.True(production.RemoveAudioChannels([entries[0].Id]));
        Assert.False(production.RemoveAudioChannels([entries[0].Id]));
        Assert.Empty(production.AudioChannels);
    }

    [Fact]
    public void AddAudioChannels_ACamera_GetsNone()
    {
        var phone = Build.Phone(production);

        Assert.Empty(production.AddAudioChannels(phone.Slots.Select(s => SourceCatalog.DeviceEntry(phone, s))));
    }
}

public sealed class AudioTallyTests
{
    private readonly Production production = Build.Production();

    private OnAirState OnAir(Device[] devices, params AudioChannelDto[] channels)
    {
        var catalog = new SourceCatalog(devices, []);
        production.SyncAudioChannels(catalog);
        if (channels.Length > 0)
        {
            production.ApplyAudioChannels(channels, catalog);
        }

        return OnAirState.From(production);
    }

    [Fact]
    public void TallyFor_TheMicrophoneOfAnAudioStation_IsProgramWhileTheBroadcastIsLive()
    {
        var station = Build.AudioStation(production);
        var onAir = OnAir([station]);

        Assert.Equal(TallyState.Off, onAir.TallyFor(station.Id, ["mic"]).Slots["mic"]);

        production.StartBroadcast(Build.T0);
        var live = OnAirState.From(production).TallyFor(station.Id, ["mic"]);

        Assert.Equal(TallyState.Program, live.Slots["mic"]);
        Assert.Equal(TallyState.Off, live.Overall);
    }

    [Fact]
    public void TallyFor_AMutedMicrophone_IsOff()
    {
        var phone = Build.Phone(production);
        phone.AllocateSlot(SourceKind.Audio, ["K1"]);
        var mic = phone.SourceIdOf(phone.Slots[1]);
        production.StartBroadcast(Build.T0);
        production.OrderedScenes[0].AddItem(Build.Add(phone.SourceIdOf(phone.Slots[0])), new SourceCatalog([phone], []), CanvasSize.FullHd);

        var muted = OnAir([phone]);
        var open = OnAir([phone], new AudioChannelDto(mic, 0, false, AudioMode.Follow, 0));

        Assert.Equal(TallyState.Off, muted.TallyFor(phone.Id, ["camera", "mic"]).Slots["mic"]);
        var tally = open.TallyFor(phone.Id, ["camera", "mic"]);
        Assert.Equal((TallyState.Program, TallyState.Program), (tally.Slots["camera"], tally.Slots["mic"]));
    }

    [Fact]
    public void TallyFor_AMicrophoneThatFollowsThePicture_IgnoresThePreviewScene()
    {
        var phone = Build.Phone(production);
        phone.AllocateSlot(SourceKind.Audio, ["K1"]);
        var camera = phone.SourceIdOf(phone.Slots[0]);
        var mic = phone.SourceIdOf(phone.Slots[1]);
        var catalog = new SourceCatalog([phone], []);
        production.OrderedScenes[1].AddItem(Build.Add(camera), catalog, CanvasSize.FullHd);
        production.SetPreview(production.OrderedScenes[1].Id, Build.T0);
        production.StartBroadcast(Build.T0);

        var inPreview = OnAir([phone], new AudioChannelDto(mic, 0, false, AudioMode.Follow, 0));
        production.Take(Build.Fade(), Build.T0);
        var afterTake = OnAirState.From(production);

        Assert.Equal(TallyState.Off, inPreview.TallyFor(phone.Id, ["mic"]).Slots["mic"]);
        Assert.Equal(TallyState.Program, afterTake.TallyFor(phone.Id, ["mic"]).Slots["mic"]);
    }

    [Fact]
    public void AudibleSources_EndedBroadcast_IsEmpty()
    {
        var station = Build.AudioStation(production);
        OnAir([station]);
        production.StartBroadcast(Build.T0);
        Assert.Single(OnAirState.From(production).AudibleSources);

        production.EndBroadcast(Build.T0);

        Assert.Empty(OnAirState.From(production).AudibleSources);
    }
}
