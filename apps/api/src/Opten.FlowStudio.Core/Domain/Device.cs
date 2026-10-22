using System.Globalization;
using Opten.FlowStudio.Core.Contracts;

namespace Opten.FlowStudio.Core.Domain;

/// <summary>A slot of a device with its permanent slot code.</summary>
/// <param name="Slot">Slot name (LiveKit track name).</param>
/// <param name="Code">Slot code, e.g. K2.</param>
/// <param name="Kind">Camera or screen.</param>
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

    /// <summary>Phone or laptop.</summary>
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
    /// Pairs a new device. A phone gets its <c>camera</c> slot, a laptop <c>screen-1</c>. Returns the device and its
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
        device.AllocateSlot(kind == DeviceKind.Phone ? SourceKind.Camera : SourceKind.Screen, codesInUse);
        return (device, secret);
    }

    /// <summary>Default name for a device paired without a name: «Handy n» / «Laptop n» with the lowest free n.</summary>
    public static string DefaultName(DeviceKind kind, IEnumerable<string> existingNames)
    {
        ArgumentNullException.ThrowIfNull(existingNames);
        var stem = kind == DeviceKind.Phone ? "Handy " : "Laptop ";
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
    /// Allocates another slot: the camera (once) or the next free screen (max 9, laptops only). Throws
    /// <c>limit_reached</c> (409) when no slot of the kind is left and <c>validation_failed</c> (400) for a kind the
    /// device cannot have (GAP-05, GAP-19).
    /// </summary>
    public DeviceSlot AllocateSlot(SourceKind kind, IEnumerable<string> codesInUse)
    {
        string slot;
        if (kind == SourceKind.Screen && Kind == DeviceKind.Phone)
        {
            throw FlowStudioException.Invalid("kind", "Ein Handy kann keinen Bildschirm teilen.");
        }

        if (kind == SourceKind.Camera)
        {
            if (FindSlot(DeviceSlots.Camera) is not null)
            {
                throw FlowStudioException.LimitReached("Dieses Gerät hat bereits eine Kamera.");
            }

            slot = DeviceSlots.Camera;
        }
        else if (kind == SourceKind.Screen)
        {
            var free = Enumerable.Range(1, DeviceSlots.MaxScreens).Select(DeviceSlots.Screen).FirstOrDefault(s => FindSlot(s) is null)
                ?? throw FlowStudioException.LimitReached("Pro Gerät sind höchstens 9 Bildschirme möglich.");
            slot = free;
        }
        else
        {
            throw FlowStudioException.Invalid("kind", "Ein Gerät kann nur Kamera- oder Bildschirm-Slots haben.");
        }

        var allocated = new DeviceSlot(slot, SlotCodes.Allocate(kind, codesInUse), kind);
        Slots = [.. Slots, allocated];
        return allocated;
    }

    /// <summary>
    /// Removes a slot; returns the removed slot or null when the device has no such slot. The camera of a phone is the
    /// phone's only source and cannot be removed (<c>conflict</c>, GAP-19); the phone is removed as a whole instead.
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
            throw FlowStudioException.Conflict(ErrorCodes.Conflict, "Die Kamera eines Handys kann nicht entfernt werden.");
        }

        Slots = [.. Slots.Where(s => s != existing)];
        return existing;
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
    /// Label of a slot: phones «{name}», laptop screens «{name} · Screen {n}», a laptop camera «{name} · Kamera».
    /// </summary>
    public string LabelOf(DeviceSlot slot)
    {
        ArgumentNullException.ThrowIfNull(slot);
        if (DeviceSlots.ScreenNumber(slot.Slot) is { } screen)
        {
            return $"{Name} · Screen {screen.ToString(CultureInfo.InvariantCulture)}";
        }

        return Kind == DeviceKind.Phone ? Name : $"{Name} · Kamera";
    }

    /// <summary>Slot codes joined for log texts, e.g. «S1, S2».</summary>
    public string CodesText() => string.Join(", ", Slots.Select(s => s.Code));
}
