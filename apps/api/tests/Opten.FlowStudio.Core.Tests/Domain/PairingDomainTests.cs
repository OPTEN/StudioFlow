using Opten.FlowStudio.Core.Application.Runtime;
using Opten.FlowStudio.Core.Contracts;
using Opten.FlowStudio.Core.Domain;

namespace Opten.FlowStudio.Core.Tests.Domain;

public sealed class DeviceTests
{
    private readonly Production production = Build.Production();

    [Fact]
    public void Pair_Phone_GetsCameraSlotAndSecret()
    {
        var (device, secret) = Device.Pair(production.Id, "Handy 1", DeviceKind.Phone, "iPhone", PairingMethod.Qr, Build.T0, ["K1"]);

        Assert.Equal(new DeviceSlot("camera", "K2", SourceKind.Camera), Assert.Single(device.Slots));
        Assert.True(device.HasSecret(secret));
        Assert.False(device.HasSecret(secret[..^1]));
        Assert.Equal(DeviceState.Active, device.State);
        Assert.Equal("Handy 1", device.LabelOf(device.Slots[0]));
    }

    [Fact]
    public void Pair_Laptop_GetsFirstScreenSlot()
    {
        var device = Build.Laptop(production);

        Assert.Equal(new DeviceSlot("screen-1", "S1", SourceKind.Screen), Assert.Single(device.Slots));
        Assert.Equal("Laptop Lea · Screen 1", device.LabelOf(device.Slots[0]));
    }

    [Fact]
    public void Pair_LongPlatform_IsTruncated() =>
        Assert.Equal(80, Device.Pair(production.Id, "X", DeviceKind.Phone, new string('p', 300), PairingMethod.Qr, Build.T0, []).Device.Platform.Length);

    [Fact]
    public void AllocateSlot_Screens_StopAtNine()
    {
        var laptop = Build.Laptop(production);
        for (var i = 2; i <= 9; i++)
        {
            Assert.Equal($"screen-{i}", laptop.AllocateSlot(SourceKind.Screen, laptop.Slots.Select(s => s.Code)).Slot);
        }

        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<FlowStudioException>(() => laptop.AllocateSlot(SourceKind.Screen, [])).Code);
        Assert.Equal(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"], laptop.Slots.Select(s => s.Code));
    }

    [Fact]
    public void AllocateSlot_Camera_OnlyOnceWithKameraLabel()
    {
        var laptop = Build.Laptop(production);

        var camera = laptop.AllocateSlot(SourceKind.Camera, ["K1"]);

        Assert.Equal("K2", camera.Code);
        Assert.Equal("Laptop Lea · Kamera", laptop.LabelOf(camera));
        Assert.Equal(ErrorCodes.LimitReached, Assert.Throws<FlowStudioException>(() => laptop.AllocateSlot(SourceKind.Camera, [])).Code);
    }

    [Theory]
    [InlineData(SourceKind.Image)]
    [InlineData(SourceKind.Video)]
    [InlineData((SourceKind)42)]
    public void AllocateSlot_MediaKind_IsValidationError(SourceKind kind) =>
        Assert.Equal(ErrorKind.Validation, Assert.Throws<FlowStudioException>(() => Build.Laptop(production).AllocateSlot(kind, [])).Kind);

    [Fact]
    public void ReleaseSlot_FreesScreenNumberForReuse()
    {
        var laptop = Build.Laptop(production);
        laptop.AllocateSlot(SourceKind.Screen, ["S1"]);

        Assert.NotNull(laptop.ReleaseSlot("screen-1"));
        Assert.Null(laptop.ReleaseSlot("screen-1"));
        Assert.Equal("screen-1", laptop.AllocateSlot(SourceKind.Screen, laptop.Slots.Select(s => s.Code)).Slot);
    }

    [Fact]
    public void DefaultName_ExistingNames_PicksLowestFreeNumber()
    {
        Assert.Equal("Handy 2", Device.DefaultName(DeviceKind.Phone, ["Handy 1", "Handy 3", "Laptop 2"]));
        Assert.Equal("Laptop 1", Device.DefaultName(DeviceKind.Laptop, ["Handy 1"]));
    }

    [Fact]
    public void RotateSecret_OldSecretStopsWorking()
    {
        var (device, secret) = Device.Pair(production.Id, "X", DeviceKind.Phone, null, PairingMethod.Qr, Build.T0, []);

        var rotated = device.RotateSecret();

        Assert.False(device.HasSecret(secret));
        Assert.True(device.HasSecret(rotated));
    }

    [Fact]
    public void BlockAndUnblock_AreIdempotent()
    {
        var device = Build.Phone(production);

        Assert.True(device.Block());
        Assert.False(device.Block());
        Assert.True(device.IsBlocked);
        Assert.True(device.Unblock());
        Assert.False(device.Unblock());
    }

    [Fact]
    public void Rename_Invalid_Throws()
    {
        var device = Build.Phone(production);

        Assert.Throws<FlowStudioException>(() => device.Rename(new string('x', 61)));
        device.Rename("Kamera Bühne");
        Assert.Equal("Kamera Bühne", device.LabelOf(device.Slots[0]));
        Assert.Equal("K1", device.CodesText());
    }
}

public sealed class InviteTests
{
    [Fact]
    public void Create_Always_ValidForThirtyMinutes()
    {
        var invite = Invite.Create("prd_x", InviteKind.PhoneQr, Build.T0);

        Assert.True(invite.IsOpen(Build.T0.AddMinutes(29)));
        Assert.False(invite.IsOpen(Build.T0.AddMinutes(30)));
        Assert.Equal(PairingMethod.Qr, invite.PairingMethod);
    }

    [Fact]
    public void UrlFor_Kind_UsesJoinPathOrShortLink()
    {
        var phone = Invite.Create("prd_x", InviteKind.PhoneQr, Build.T0);
        var link = Invite.Create("prd_x", InviteKind.LaptopLink, Build.T0);

        Assert.Equal($"https://fs.example/join/i/{phone.Token}", phone.UrlFor("https://fs.example/"));
        Assert.Equal($"https://fs.example/j/{link.Token}", link.UrlFor("https://fs.example"));
        Assert.Equal(PairingMethod.Link, link.PairingMethod);
    }

    [Fact]
    public void Redeem_Twice_SecondIsExpired()
    {
        var invite = Invite.Create("prd_x", InviteKind.LaptopLink, Build.T0);
        invite.Redeem("client-1", "dev_aaaa", Build.T0);

        Assert.Equal(ErrorCodes.PairingExpired, Assert.Throws<FlowStudioException>(() => invite.Redeem("client-2", "dev_bbbb", Build.T0)).Code);
    }

    [Fact]
    public void CanReplay_SameClientWithinFiveMinutes_IsTrue()
    {
        var invite = Invite.Create("prd_x", InviteKind.LaptopLink, Build.T0);
        invite.Redeem("client-1", "dev_aaaa", Build.T0);

        Assert.True(invite.CanReplay("client-1", Build.T0.AddMinutes(5)));
        Assert.False(invite.CanReplay("client-1", Build.T0.AddMinutes(5).AddSeconds(1)));
        Assert.False(invite.CanReplay("client-2", Build.T0));
    }

    [Fact]
    public void Revoke_Open_ClosesAndSecondRevokeIsNoOp()
    {
        var invite = Invite.Create("prd_x", InviteKind.LaptopLink, Build.T0);

        Assert.True(invite.Revoke(Build.T0));
        Assert.False(invite.IsOpen(Build.T0));
        Assert.False(invite.Revoke(Build.T0));
        Assert.Throws<FlowStudioException>(() => invite.Redeem("c", "dev_x", Build.T0));
    }

    [Fact]
    public void NeedsRenewal_OnlyPhoneInvitesNearExpiry()
    {
        var phone = Invite.Create("prd_x", InviteKind.PhoneQr, Build.T0);
        var link = Invite.Create("prd_x", InviteKind.LaptopLink, Build.T0);

        Assert.False(phone.NeedsRenewal(Build.T0.AddMinutes(27)));
        Assert.True(phone.NeedsRenewal(Build.T0.AddMinutes(28).AddSeconds(1)));
        Assert.False(link.NeedsRenewal(Build.T0.AddMinutes(29)));
    }
}

public sealed class PairingRequestTests
{
    private static readonly CreatePairingRequest Knock = new("Laptop Lea", DeviceKind.Laptop, "Windows · Chrome");

    [Fact]
    public void Create_Valid_IsPendingForTenMinutes()
    {
        var (request, token) = PairingRequest.Create("prd_x", Knock, "4712", Build.T0);

        Assert.True(request.IsPending(Build.T0.AddMinutes(9)));
        Assert.False(request.IsPending(Build.T0.AddMinutes(10)));
        Assert.True(request.HasPollToken(token));
        Assert.False(request.HasPollToken("wrong"));
        Assert.Equal(PairingRequestStatus.Pending, request.StatusFor(Build.T0).Status);
    }

    [Theory]
    [InlineData("", DeviceKind.Laptop)]
    [InlineData("x", (DeviceKind)5)]
    public void Create_Invalid_IsValidationError(string name, DeviceKind kind) =>
        Assert.Throws<FlowStudioException>(() => PairingRequest.Create("prd_x", new CreatePairingRequest(name, kind, "p"), "0001", Build.T0));

    [Fact]
    public void Approve_Pending_ReturnsSameCredentialsForFiveMinutes()
    {
        var (request, _) = PairingRequest.Create("prd_x", Knock, "4712", Build.T0);
        var credentials = new DeviceCredentialsDto("dev_a", "secret", "prd_x");

        request.Approve(credentials, Build.T0.AddMinutes(1));

        Assert.Equal(credentials, request.StatusFor(Build.T0.AddMinutes(2)).Credentials);
        Assert.Equal(credentials, request.StatusFor(Build.T0.AddMinutes(5).AddSeconds(59)).Credentials);
        Assert.Equal(new PairingRequestStatusDto(PairingRequestStatus.Expired, null), request.StatusFor(Build.T0.AddMinutes(6)));
    }

    [Fact]
    public void Approve_AfterDecisionOrExpiry_IsPairingExpired()
    {
        var (request, _) = PairingRequest.Create("prd_x", Knock, "4712", Build.T0);
        var (expired, _) = PairingRequest.Create("prd_x", Knock, "4713", Build.T0);
        request.Deny(Build.T0);

        Assert.Equal(ErrorCodes.PairingExpired, Assert.Throws<FlowStudioException>(() => request.Approve(new("dev_a", "s", "prd_x"), Build.T0)).Code);
        Assert.Throws<FlowStudioException>(() => expired.Approve(new("dev_a", "s", "prd_x"), Build.T0.AddMinutes(11)));
        Assert.Equal(new PairingRequestStatusDto(PairingRequestStatus.Denied, null), request.StatusFor(Build.T0.AddMinutes(1)));
    }

    [Fact]
    public void NewCheckCode_TakenCodes_AreAvoided()
    {
        var taken = Enumerable.Range(0, 9_999).Select(i => i.ToString("D4", System.Globalization.CultureInfo.InvariantCulture)).ToHashSet(StringComparer.Ordinal);

        Assert.Equal("9999", PairingRequest.NewCheckCode(taken));
    }
}

public sealed class PairingRequestStoreTests
{
    private static readonly CreatePairingRequest Knock = new("Laptop", DeviceKind.Laptop, "p");

    [Fact]
    public void Create_TwentyPending_TwentyFirstIsRateLimited()
    {
        var store = new PairingRequestStore();
        var codes = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < PairingRequestStore.MaxPending; i++)
        {
            Assert.True(codes.Add(store.Create("prd_x", Knock, Build.T0).Request.CheckCode));
        }

        var error = Assert.Throws<FlowStudioException>(() => store.Create("prd_y", Knock, Build.T0));

        Assert.Equal(ErrorCodes.RateLimited, error.Code);
        Assert.NotNull(error.RetryAfter);
    }

    [Fact]
    public void Create_AfterExpiry_FreesCapacity()
    {
        var store = new PairingRequestStore();
        for (var i = 0; i < PairingRequestStore.MaxPending; i++)
        {
            store.Create("prd_x", Knock, Build.T0);
        }

        Assert.NotNull(store.Create("prd_x", Knock, Build.T0.AddMinutes(10)).Request);
    }

    [Fact]
    public void RemoveExpired_ReturnsOnlyRequestsThatExpiredPending()
    {
        var store = new PairingRequestStore();
        var pending = store.Create("prd_x", Knock, Build.T0).Request;
        var approved = store.Create("prd_x", Knock, Build.T0).Request;
        approved.Approve(new("dev_a", "s", "prd_x"), Build.T0);

        var expired = store.RemoveExpired(Build.T0.AddMinutes(10));

        Assert.Equal([pending.Id], expired.Select(r => r.Id));
        Assert.Null(store.Find(pending.Id));
        Assert.Null(store.Find(approved.Id));
    }

    [Fact]
    public void Pending_FiltersByProduction()
    {
        var store = new PairingRequestStore();
        store.Create("prd_x", Knock, Build.T0);
        store.Create("prd_y", Knock, Build.T0);

        Assert.Single(store.Pending("prd_x", Build.T0));
        Assert.Empty(store.Pending("prd_x", Build.T0.AddMinutes(11)));
    }

    [Fact]
    public async Task Create_Concurrently_NeverExceedsLimitAndCodesStayUnique()
    {
        var store = new PairingRequestStore();
        var results = await Task.WhenAll(Enumerable.Range(0, 100).Select(_ => Task.Run(() =>
        {
            try
            {
                return store.Create("prd_x", Knock, Build.T0).Request.CheckCode;
            }
            catch (FlowStudioException)
            {
                return null;
            }
        })));

        var created = results.Where(c => c is not null).ToList();
        Assert.Equal(PairingRequestStore.MaxPending, created.Count);
        Assert.Equal(created.Count, created.Distinct(StringComparer.Ordinal).Count());
    }
}
