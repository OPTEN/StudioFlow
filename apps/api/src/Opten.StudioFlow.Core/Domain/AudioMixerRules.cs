using System.Globalization;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>
/// The rules of the audio mixer (spec 4.4, issue #7): which sources have a channel, what a new channel starts with, which
/// values are valid and when a channel is audible. The server is authoritative; <c>packages/scene-model</c> mirrors the
/// numbers and the audibility rule (<c>audio.ts</c>), the output page and the Regie mix with them.
/// </summary>
public static class AudioMixerRules
{
    /// <summary>The lowest fader position: silence, shown as −∞. Every lower value is invalid, so the number is never a float infinity.</summary>
    public const double MinGainDb = -100;

    /// <summary>The highest fader position.</summary>
    public const double MaxGainDb = 10;

    /// <summary>The longest sync offset (delay of the sound) in milliseconds.</summary>
    public const int MaxSyncOffsetMs = 500;

    /// <summary>
    /// True when the source can have a channel: a microphone slot, a screen (the audio of the shared tab or system) and a
    /// video that has an audio track. Cameras, images and texts have no sound.
    /// </summary>
    public static bool CarriesSound(SourceEntry source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return source.Kind switch
        {
            SourceKind.Audio or SourceKind.Screen => true,
            SourceKind.Video => source.Asset?.HasAudio == true,
            _ => false,
        };
    }

    /// <summary>
    /// The channel a source starts with. An audio station feeds the finished mix of the mixing desk: always audible. A device
    /// microphone starts <em>muted</em>, so no open microphone goes on air by accident; unmuted it follows the picture of its
    /// device. The sound of a screen or a video belongs to the picture and follows it.
    /// </summary>
    public static AudioChannelDto DefaultChannel(SourceEntry source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return source.Kind switch
        {
            SourceKind.Audio when source.Device?.Kind == DeviceKind.AudioStation => new AudioChannelDto(source.Id, 0, false, AudioMode.Always, 0),
            SourceKind.Audio => new AudioChannelDto(source.Id, 0, true, AudioMode.Follow, 0),
            _ => new AudioChannelDto(source.Id, 0, false, AudioMode.Follow, 0),
        };
    }

    /// <summary>Validates the channels of a request against the sources of the production; throws <c>validation_failed</c> with the field paths.</summary>
    public static void Validate(IReadOnlyList<AudioChannelDto?>? channels, SourceCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new ValidationErrors();
        if (channels is null || channels.Count == 0)
        {
            errors.Add("channels", "Send at least one channel.");
            errors.ThrowIfAny();
            return;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < channels.Count; i++)
        {
            ValidateChannel(channels[i], $"channels[{i.ToString(CultureInfo.InvariantCulture)}]", catalog, seen, errors);
        }

        errors.ThrowIfAny();
    }

    /// <summary>True when the channel is audible: the broadcast is live, it is not muted, its fader is up and its mode lets it through.</summary>
    public static bool IsAudible(AudioChannelDto channel, BroadcastState broadcast, IReadOnlySet<string> programSources)
    {
        ArgumentNullException.ThrowIfNull(channel);
        ArgumentNullException.ThrowIfNull(programSources);
        if (broadcast != BroadcastState.Live || channel.Muted || channel.GainDb <= MinGainDb)
        {
            return false;
        }

        return channel.Mode switch
        {
            AudioMode.Always => true,
            AudioMode.Follow => FollowsPicture(channel.SourceId, programSources),
            _ => false,
        };
    }

    /// <summary>
    /// The picture a channel follows: a screen or a video follows its own item, a microphone follows every source of its
    /// device (the camera of the phone it sits in, the screens of the laptop).
    /// </summary>
    public static bool FollowsPicture(string channelSourceId, IReadOnlySet<string> visibleSources)
    {
        ArgumentNullException.ThrowIfNull(channelSourceId);
        ArgumentNullException.ThrowIfNull(visibleSources);
        if (!SourceRef.TryParse(channelSourceId, out var channel))
        {
            return false;
        }

        if (!channel.IsDevice || !string.Equals(channel.Slot, DeviceSlots.Mic, StringComparison.Ordinal))
        {
            return visibleSources.Contains(channelSourceId);
        }

        return visibleSources.Any(source => SourceRef.TryParse(source, out var shown) && shown.IsDevice && string.Equals(shown.DeviceId, channel.DeviceId, StringComparison.Ordinal));
    }

    private static void ValidateChannel(AudioChannelDto? channel, string path, SourceCatalog catalog, HashSet<string> seen, ValidationErrors errors)
    {
        if (channel is null)
        {
            errors.Add(path, "The channel is missing.");
            return;
        }

        var source = channel.SourceId is null ? null : catalog.Find(channel.SourceId);
        if (source is null || !CarriesSound(source))
        {
            errors.Add($"{path}.sourceId", "This source has no audio channel.");
        }
        else if (!seen.Add(channel.SourceId!))
        {
            errors.Add($"{path}.sourceId", "Each source can appear only once.");
        }
        else if (source.Kind == SourceKind.Video && channel.Mode == AudioMode.Always)
        {
            errors.Add($"{path}.mode", "The sound of a video always belongs to its picture.");
        }

        if (!double.IsFinite(channel.GainDb) || channel.GainDb < MinGainDb || channel.GainDb > MaxGainDb)
        {
            errors.Add($"{path}.gainDb", $"Must be between {MinGainDb.ToString(CultureInfo.InvariantCulture)} and {MaxGainDb.ToString(CultureInfo.InvariantCulture)} dB.");
        }

        if (channel.SyncOffsetMs < 0 || channel.SyncOffsetMs > MaxSyncOffsetMs)
        {
            errors.Add($"{path}.syncOffsetMs", $"Must be between 0 and {MaxSyncOffsetMs.ToString(CultureInfo.InvariantCulture)} ms.");
        }

        if (!Enum.IsDefined(channel.Mode))
        {
            errors.Add($"{path}.mode", "Unknown mode.");
        }
    }
}
