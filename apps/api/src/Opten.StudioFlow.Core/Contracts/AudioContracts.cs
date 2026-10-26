namespace Opten.StudioFlow.Core.Contracts;

/// <summary>
/// One channel of the audio mixer of a production (issue #7): the level, the mute switch, the mode and the sync offset of
/// one audio source. The mixer is one global state per production, revisioned like the scenes; the output page mixes the
/// sound itself (Web Audio) from this state. There is one channel for every source that can carry sound: a microphone
/// slot (<c>{deviceId}/mic</c>, source kind audio), a screen (<c>{deviceId}/screen-n</c>, the audio of the shared tab or
/// system) and a video with sound (<c>{assetId}</c>).
/// </summary>
/// <param name="SourceId">The source the channel belongs to.</param>
/// <param name="GainDb">Fader in dB, −100 (silence, shown as −∞) to +10. 0 is unity gain.</param>
/// <param name="Muted">Mute switch; a muted channel is silent whatever the mode.</param>
/// <param name="Mode">Always audible, follows the picture, or off.</param>
/// <param name="SyncOffsetMs">Delay in milliseconds, 0 to 500, to bring the sound in step with a picture that arrives later.</param>
public sealed record AudioChannelDto(string SourceId, double GainDb, bool Muted, AudioMode Mode, int SyncOffsetMs);

/// <summary>
/// Sets channels of the mixer (<c>PUT …/audio/channels</c>). Every listed channel replaces the stored one in full; channels
/// that are not listed stay as they are, so two Regie seats that move different faders do not overwrite each other.
/// Undo and redo send the previous state of the channels they touched.
/// </summary>
/// <param name="Channels">The channels to set; at most one entry per source.</param>
/// <param name="Adjusting">
/// True while a fader is being dragged: the change is applied and sent at once, but not written to the audit log. The last
/// request of the drag is sent with false.
/// </param>
public sealed record SetAudioChannelsRequest(IReadOnlyList<AudioChannelDto> Channels, bool Adjusting = false);

/// <summary>The sound of an output page as it reports it.</summary>
/// <param name="State">Off (on purpose), running, blocked by the browser or unavailable.</param>
/// <param name="LevelDb">Peak level of the program mix in dBFS over the report interval; null without signal (below −90 dBFS) or without audio.</param>
public sealed record OutputAudioDto(OutputAudioState State, double? LevelDb);
