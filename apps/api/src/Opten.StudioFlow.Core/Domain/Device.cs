using System.Globalization;
using Opten.StudioFlow.Core.Contracts;

namespace Opten.StudioFlow.Core.Domain;

/// <summary>A slot of a device with its permanent slot code.</summary>
/// <param name="Slot">Slot name (LiveKit track name).</param>
/// <param name="Code">Slot code, e.g. K2.</param>
/// <param name="Kind">Camera, screen or audio (microphone).</param>
public sealed record DeviceSlot(string Slot, string Code, SourceKind Kind);

/// <summary>
/// A paired device (aggregate root, spec 4.6). Its slots are sources of the production. Live data (connection,
/// telemetry, technical check) is kept in memory by the application layer.
/// </summary>
public sealed class Device
{
    private Device()
    {
    }

    /// <summary>Device id, also the LiveKit identity.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>Production the device belongs to.</summary>
    public string ProductionId { get; private set; } = string.Empty;

    /// <summary>Display name (1–60 characters).</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Phone, laptop or audio station.</summary>
    public DeviceKind Kind { get; private set; }

    /// <summary>Platform text reported by the sender (≤ 80 characters).</summary>
    public string Platform { get; private set; } = string.Empty;

    /// <summary>Active or blocked.</summary>
    public DeviceState State { get; private set; }

    /// <summary>How the device was paired.</summary>
    public PairingMethod PairingMethod { get; private set; }

    /// <summary>Pairing time.</summary>
    public DateTimeOffset PairedAt { get; private set; }

    /// <summary>Last control connection.</summary>
    public DateTimeOffset? LastSeenAt { get; private set; }

    /// <summary>SHA-256 of the device secret.</summary>
    public string SecretHash { get; private set; } = string.Empty;

    /// <summary>Slots in allocation order.</summary>
    public IReadOnlyList<DeviceSlot> Slots { get; private set; } = [];

    /// <summary>True when the device is blocked.</summary>
    public bool IsBlocked => State == DeviceState.Blocked;

    /// <summary>
    /// Pairs a new device. A phone gets its <c>camera</c> slot, a laptop <c>screen-1</c>, an audio station its <c>mic</c> slot. Returns the device and its
    /// secret, which is shown to the device exactly once.
    /// </summary>
    public static (Device Device, string Secret) Pair(string productionId, string name, DeviceKind kind, string? platform, PairingMethod method, DateTimeOffset now, IEnumerable<string> codesInUse)
    {
        ArgumentException.ThrowIfNullOrEmpty(productionId);
        var secret = Secrets.New();
        var device = new Device
        {
            Id = EntityIds.New(EntityIds.Device),
            ProductionId = productionId,
            Name = TextRules.RequireName(name, TextRules.DeviceNameMax, "name"),
            Kind = kind,
            Platform = TextRules.Truncate(platform, TextRules.PlatformMax) ?? string.Empty,
            State = DeviceState.Active,
            PairingMethod = method,
            PairedAt = now,
            SecretHash = Secrets.Hash(secret),
        };
        device.AllocateSlot(FirstSlotKind(kind), codesInUse);
        return (device, secret);
    }

    /// <summary>Default name for a device paired without a name: “Phone n” / “Laptop n” with the lowest free n.</summary>
    public static string DefaultName(DeviceKind kind, IEnumerable<string> existingNames)
    {
        ArgumentNullException.ThrowIfNull(existingNames);
        var stem = kind switch
        {
            DeviceKind.Phone => "Phone ",
            DeviceKind.AudioStation => "Audio station ",
            _ => "Laptop ",
        };
        var used = new HashSet<int>();
        foreach (var existing in existingNames)
        {
            if (existing.StartsWith(stem, StringComparison.Ordinal) && int.TryParse(existing.AsSpan(stem.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var n))
            {
                used.Add(n);
            }
        }

        var next = 1;
        while (used.Contains(next))
        {
            next++;
        }

        return stem + next.ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Allocates another slot: the camera (once), the microphone (once) or the next free screen (max 9, laptops only).
    /// Throws <c>limit_reached</c> (409) when no slot of the kind is left and <c>validation_failed</c> (400) for a kind
    /// the device cannot have (GAP-05, GAP-19): a phone has no screen, an audio station only a microphone.
    /// </summary>
    public DeviceSlot AllocateSlot(SourceKind kind, IEnumerable<string> codesInUse)
    {
        string slot;
        if (kind == SourceKind.Screen && Kind == DeviceKind.Phone)
        {
            throw StudioFlowException.Invalid("kind", "A phone cannot share a screen.");
        }

        if (Kind == DeviceKind.AudioStation && kind != SourceKind.Audio)
        {
            throw StudioFlowException.Invalid("kind", "An audio station only has a microphone.");
        }

        if (kind == SourceKind.Audio)
        {
            if (FindSlot(DeviceSlots.Mic) is not null)
            {
                throw StudioFlowException.LimitReached("This device already has a microphone.");
            }

            slot = DeviceSlots.Mic;
        }
        else if (kind == SourceKind.Camera)
        {
            if (FindSlot(DeviceSlots.Camera) is not null)
            {
                throw StudioFlowException.LimitReached("This device already has a camera.");
            }

            slot = DeviceSlots.Camera;
        }
        else if (kind == SourceKind.Screen)
        {
            var free = Enumerable.Range(1, DeviceSlots.MaxScreens).Select(DeviceSlots.Screen).FirstOrDefault(s => FindSlot(s) is null)
                ?? throw StudioFlowException.LimitReached("A device can have at most 9 screens.");
            slot = free;
        }
        else
        {
            throw StudioFlowException.Invalid("kind", "A device can only have camera, screen or microphone slots.");
        }

        var allocated = new DeviceSlot(slot, SlotCodes.Allocate(kind, codesInUse), kind);
        Slots = [.. Slots, allocated];
        return allocated;
    }

    /// <summary>
    /// Removes a slot; returns the removed slot or null when the device has no such slot. The camera of a phone is the
    /// phone's only source and so is the microphone of an audio station: they cannot be removed (<c>conflict</c>, GAP-19);
    /// the device is removed as a whole instead.
    /// </summary>
    public DeviceSlot? ReleaseSlot(string slot)
    {
        var existing = FindSlot(slot);
        if (existing is null)
        {
            return null;
        }

        if (Kind == DeviceKind.Phone && existing.Kind == SourceKind.Camera)
        {
            throw StudioFlowException.Conflict(ErrorCodes.Conflict, "The camera of a phone cannot be removed.");
        }

        if (Kind == DeviceKind.AudioStation && existing.Kind == SourceKind.Audio)
        {
            throw StudioFlowException.Conflict(ErrorCodes.Conflict, "The microphone of an audio station cannot be removed.");
        }

        Slots = [.. Slots.Where(s => s != existing)];
        return existing;
    }

    /// <summary>
    /// Gives a slot another code: a source that is not used anywhere takes over the code of the placeholder it replaces
    /// (“Use as K1”). Throws <c>not_found</c> for a slot the device does not have.
    /// </summary>
    public DeviceSlot RecodeSlot(string slot, string code)
    {
        var existing = FindSlot(slot) ?? throw StudioFlowException.NotFound("Source");
        var recoded = existing with { Code = code };
        Slots = [.. Slots.Select(s => s == existing ? recoded : s)];
        return recoded;
    }

    /// <summary>The slot with the given name, if any.</summary>
    public DeviceSlot? FindSlot(string slot) => Slots.FirstOrDefault(s => string.Equals(s.Slot, slot, StringComparison.Ordinal));

    /// <summary>Renames the device (labels of its sources follow).</summary>
    public void Rename(string name) => Name = TextRules.RequireName(name, TextRules.DeviceNameMax, "name");

    /// <summary>Updates the platform text from the sender.</summary>
    public void UpdatePlatform(string? platform) => Platform = TextRules.Truncate(platform, TextRules.PlatformMax) ?? Platform;

    /// <summary>Blocks the device; returns false when it was already blocked.</summary>
    public bool Block()
    {
        if (IsBlocked)
        {
            return false;
        }

        State = DeviceState.Blocked;
        return true;
    }

    /// <summary>Unblocks the device; returns false when it was not blocked.</summary>
    public bool Unblock()
    {
        if (!IsBlocked)
        {
            return false;
        }

        State = DeviceState.Active;
        return true;
    }

    /// <summary>Replaces the secret (idempotent redeem) and returns the new one.</summary>
    public string RotateSecret()
    {
        var secret = Secrets.New();
        SecretHash = Secrets.Hash(secret);
        return secret;
    }

    /// <summary>True when <paramref name="secret"/> is the device secret (constant time).</summary>
    public bool HasSecret(string? secret) => Secrets.MatchesHash(secret, SecretHash);

    /// <summary>Records a control connection.</summary>
    public void MarkSeen(DateTimeOffset at) => LastSeenAt = at;

    /// <summary>Source reference of a slot.</summary>
    public string SourceIdOf(DeviceSlot slot)
    {
        ArgumentNullException.ThrowIfNull(slot);
        return SourceRef.ForDevice(Id, slot.Slot);
    }

    /// <summary>
    /// Label of a slot: phones “{name}”, laptop screens “{name} · Screen {n}”, a laptop camera “{name} · Camera”, the
    /// microphone of an audio station “{name}” and the microphone of another device “{name} · Microphone”.
    /// </summary>
    public string LabelOf(DeviceSlot slot)
    {
        ArgumentNullException.ThrowIfNull(slot);
        if (slot.Kind == SourceKind.Audio)
        {
            return Kind == DeviceKind.AudioStation ? Name : $"{Name} · Microphone";
        }

        if (DeviceSlots.ScreenNumber(slot.Slot) is { } screen)
        {
            return $"{Name} · Screen {screen.ToString(CultureInfo.InvariantCulture)}";
        }

        return Kind == DeviceKind.Phone ? Name : $"{Name} · Camera";
    }

    /// <summary>The kind of the first slot a device of the kind gets when it is paired.</summary>
    private static SourceKind FirstSlotKind(DeviceKind kind) => kind switch
    {
        DeviceKind.Phone => SourceKind.Camera,
        DeviceKind.AudioStation => SourceKind.Audio,
        _ => SourceKind.Screen,
    };

    /// <summary>Slot codes joined for log texts, e.g. “S1, S2”.</summary>
    public string CodesText() => string.Join(", ", Slots.Select(s => s.Code));
}
