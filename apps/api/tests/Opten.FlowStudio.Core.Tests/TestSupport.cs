using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Tests;

/// <summary>A clock the tests move by hand.</summary>
internal sealed class ManualClock(DateTimeOffset start) : TimeProvider
{
    public ManualClock()
        : this(new DateTimeOffset(2026, 10, 22, 9, 0, 0, TimeSpan.Zero))
    {
    }

    public DateTimeOffset Now { get; private set; } = start;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan by) => Now += by;
}

/// <summary>Builders for domain objects used by many tests.</summary>
internal static class Build
{
    public static readonly DateTimeOffset T0 = new(2026, 10, 22, 9, 0, 0, TimeSpan.Zero);

    public static Production Production(string name = "Webinar") => Core.Domain.Production.Create(name, Slugs.FromName(name), isActive: true, T0);

    public static Device Phone(Production production, string name = "Handy 1", IEnumerable<string>? codes = null) =>
        Device.Pair(production.Id, name, DeviceKind.Phone, "iPhone · Safari", PairingMethod.Qr, T0, codes ?? []).Device;

    public static Device Laptop(Production production, string name = "Laptop Lea", IEnumerable<string>? codes = null) =>
        Device.Pair(production.Id, name, DeviceKind.Laptop, "Windows · Chrome", PairingMethod.Code, T0, codes ?? []).Device;

    public static Asset Image(Production production, string name = "Pause", IEnumerable<string>? codes = null) =>
        Asset.Create(EntityIds.New(EntityIds.Asset), production.Id, name, AssetKind.Image, "image/png", 1000, 1920, 1080, "x.png", T0, codes ?? []);

    public static Asset Video(Production production, string name = "Intro", IEnumerable<string>? codes = null) =>
        Asset.Create(EntityIds.New(EntityIds.Asset), production.Id, name, AssetKind.Video, "video/mp4", 1000, null, null, "x.mp4", T0, codes ?? []);

    public static SceneItemDto Item(string source, string? id = null) => new(
        id ?? EntityIds.New(EntityIds.Item),
        source,
        100,
        100,
        640,
        360,
        ItemFit.Cover,
        SceneItemRules.NoCrop,
        12,
        Mirror: false,
        Rotation: 0,
        Hidden: false,
        Locked: false,
        Border: null,
        OnLost: new LostBehaviorDto(3000, null));

    public static AddSceneItemRequest Add(string source) => new(source, null, null, null, null, null, null);

    public static TransitionDto Fade(int ms = 300) => new(TransitionKind.Fade, ms);
}
