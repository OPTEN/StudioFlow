using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Opten.StudioFlow.Core.Application;
using Opten.StudioFlow.Core.Application.Ports;
using Opten.StudioFlow.Core.Application.Services;
using Opten.StudioFlow.Core.Contracts;
using Opten.StudioFlow.Core.Domain;

namespace Opten.StudioFlow.Core.Tests.Application;

public sealed class SetupCodeTests
{
    [Fact]
    public void Issue_IsTwoGroupsOfFourUnambiguousCharacters()
    {
        var code = new SetupCode().Issue();

        Assert.Matches("^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$", code);
    }

    [Fact]
    public void Issue_ManyCodes_AreAllDifferent()
    {
        var codes = new SetupCode();

        var issued = Enumerable.Range(0, 500).Select(_ => codes.Issue()).ToHashSet(StringComparer.Ordinal);

        Assert.Equal(500, issued.Count);
    }

    [Fact]
    public void Current_BeforeIssueAndAfterClear_IsNull()
    {
        var codes = new SetupCode();
        Assert.Null(codes.Current);

        codes.Issue();
        codes.Clear();

        Assert.Null(codes.Current);
    }

    [Fact]
    public void Issue_AgainReplacesTheOldCode()
    {
        var codes = new SetupCode();
        var first = codes.Issue();

        var second = codes.Issue();

        Assert.False(codes.Matches(first));
        Assert.True(codes.Matches(second));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public void Matches_CaseSpacesAndHyphenDoNotMatter(bool lower, bool dropHyphen)
    {
        var codes = new SetupCode();
        var typed = " " + codes.Issue() + " ";
        typed = lower ? typed.ToLowerInvariant() : typed;
        typed = dropHyphen ? typed.Replace("-", string.Empty, StringComparison.Ordinal) : typed;

        Assert.True(codes.Matches(typed));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("AAAA-AAAA")]
    [InlineData("AAAA")]
    public void Matches_WrongOrMissing_IsFalse(string? typed)
    {
        var codes = new SetupCode();
        codes.Issue();

        Assert.False(codes.Matches(typed));
    }

    [Fact]
    public void Matches_NoCodeIssued_IsFalseForEverything()
    {
        var codes = new SetupCode();

        Assert.False(codes.Matches(string.Empty));
        Assert.False(codes.Matches(null));
        Assert.False(codes.Matches("AAAA-AAAA"));
    }

    [Fact]
    public void Matches_AfterClear_IsFalseForTheOldCode()
    {
        var codes = new SetupCode();
        var code = codes.Issue();

        codes.Clear();

        Assert.False(codes.Matches(code));
    }
}

public sealed class AdminAccountRulesTests
{
    [Theory]
    [InlineData("admin")]
    [InlineData("Regie.Team-2")]
    [InlineData("admin@example.com")]
    [InlineData("a")]
    public void ValidateUsername_Valid_IsReturnedTrimmed(string username)
    {
        var errors = new ValidationErrors();

        Assert.Equal(username, AdminAccountRules.ValidateUsername($" {username} ", errors));
        Assert.False(errors.HasErrors);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("two words")]
    [InlineData("umlaut-ä")]
    [InlineData("semi;colon")]
    public void ValidateUsername_Invalid_AddsTheReason(string? username)
    {
        var errors = new ValidationErrors();

        Assert.Null(AdminAccountRules.ValidateUsername(username, errors));
        Assert.Equal([FieldErrorCodes.UsernameInvalid], errors.ToDictionary()["username"]);
    }

    [Fact]
    public void ValidateUsername_SixtyFourCharacters_FitsAndSixtyFiveDoNot()
    {
        var fits = new ValidationErrors();
        var tooLong = new ValidationErrors();

        Assert.NotNull(AdminAccountRules.ValidateUsername(new string('a', AdminAccount.UsernameMaxLength), fits));
        Assert.Null(AdminAccountRules.ValidateUsername(new string('a', AdminAccount.UsernameMaxLength + 1), tooLong));
        Assert.False(fits.HasErrors);
        Assert.True(tooLong.HasErrors);
    }

    [Theory]
    [InlineData("Another-Long-Passphrase-2")]
    [InlineData("exactly12char")]
    [InlineData("correct horse battery")]
    [InlineData("Pässwörd mit Umlauten 1")]
    public void ValidatePassword_Good_HasNoErrors(string password)
    {
        var errors = new ValidationErrors();

        AdminAccountRules.ValidatePassword(password, "regie", "password", errors);

        Assert.False(errors.HasErrors);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("elevenchars")]
    public void ValidatePassword_ShortOrMissing_IsTooShort(string? password)
    {
        var errors = new ValidationErrors();

        AdminAccountRules.ValidatePassword(password, "regie", "password", errors);

        Assert.Equal([FieldErrorCodes.PasswordTooShort], errors.ToDictionary()["password"]);
    }

    [Fact]
    public void ValidatePassword_TwelveCharacters_IsLongEnough()
    {
        var errors = new ValidationErrors();

        AdminAccountRules.ValidatePassword("abcdefgh-1234", "regie", "password", errors);

        Assert.False(errors.HasErrors);
    }

    [Fact]
    public void ValidatePassword_LongerThanTheMaximum_IsTooLong()
    {
        var errors = new ValidationErrors();
        AdminAccountRules.ValidatePassword(new string('x', AdminAccountRules.MaxPasswordLength), "regie", "password", errors);
        Assert.False(errors.HasErrors);

        AdminAccountRules.ValidatePassword(new string('x', AdminAccountRules.MaxPasswordLength + 1), "regie", "password", errors);

        Assert.Equal([FieldErrorCodes.PasswordTooLong], errors.ToDictionary()["password"]);
    }

    [Theory]
    [InlineData("studio.admin.account", "STUDIO.ADMIN.ACCOUNT")]
    [InlineData("studio.admin.account", "Studio.Admin.Account")]
    [InlineData(" studio.admin.account ", "studio.admin.account")]
    public void ValidatePassword_EqualToTheUserNameIgnoringCase_IsRefused(string username, string password)
    {
        var errors = new ValidationErrors();

        AdminAccountRules.ValidatePassword(password, username, "password", errors);

        Assert.Equal([FieldErrorCodes.PasswordEqualsUsername], errors.ToDictionary()["password"]);
    }

    [Theory]
    [InlineData("Password1234")]
    [InlineData("PASSWORDPASSWORD")]
    [InlineData("123456789012")]
    [InlineData("Administrator")]
    [InlineData("StudioFlow2026")]
    public void ValidatePassword_CommonPassword_IsRefusedIgnoringCase(string password)
    {
        var errors = new ValidationErrors();

        AdminAccountRules.ValidatePassword(password, "regie", "password", errors);

        Assert.Equal([FieldErrorCodes.PasswordTooCommon], errors.ToDictionary()["password"]);
    }

    [Fact]
    public void ValidatePassword_CommonAndEqualToTheUserName_ReportsBoth()
    {
        var errors = new ValidationErrors();

        AdminAccountRules.ValidatePassword("administrator", "Administrator", "newPassword", errors);

        Assert.Equal([FieldErrorCodes.PasswordEqualsUsername, FieldErrorCodes.PasswordTooCommon], errors.ToDictionary()["newPassword"]);
    }
}

public sealed class AdminAccountStateTests
{
    private readonly FakeAccountStore store = new();
    private readonly SetupCode setupCode = new();
    private readonly CapturingLogger logger = new();
    private readonly AdminAccountState state;

    public AdminAccountStateTests()
    {
        state = new AdminAccountState(store, new PrefixHasher(), setupCode, logger);
    }

    [Fact]
    public void Initially_NoAccount_SetupIsRequiredAndLoginsFail()
    {
        Assert.True(state.SetupRequired);
        Assert.Null(state.Verify("regie", "secret-password"));
        Assert.False(state.IsCurrent("regie", "stamp"));
    }

    [Fact]
    public async Task Refresh_NoAccount_IssuesTheSetupCodeOnceAndLogsIt()
    {
        await state.RefreshAsync(CancellationToken.None);
        var code = setupCode.Current;
        await state.RefreshAsync(CancellationToken.None);

        Assert.NotNull(code);
        Assert.Equal(code, setupCode.Current);
        Assert.Equal($"No Regie account exists: the first-run setup is open. Setup code: {code}", Assert.Single(logger.Messages));
    }

    [Fact]
    public async Task Refresh_AccountExists_ClosesTheSetupAndClearsTheCode()
    {
        setupCode.Issue();
        store.Account = Account("regie", "secret-password");

        var changed = await state.RefreshAsync(CancellationToken.None);

        Assert.True(changed);
        Assert.False(state.SetupRequired);
        Assert.Null(setupCode.Current);
        Assert.Equal("The Regie account exists: the first-run setup is closed", Assert.Single(logger.Messages));
    }

    [Fact]
    public async Task Refresh_NothingChanged_ReportsNoChange()
    {
        store.Account = Account("regie", "secret-password");
        await state.RefreshAsync(CancellationToken.None);

        Assert.False(await state.RefreshAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Refresh_AccountDeletedElsewhere_ReopensTheSetupWithANewCode()
    {
        store.Account = Account("regie", "secret-password");
        await state.RefreshAsync(CancellationToken.None);
        store.Account = null;

        var changed = await state.RefreshAsync(CancellationToken.None);

        Assert.True(changed);
        Assert.True(state.SetupRequired);
        Assert.NotNull(setupCode.Current);
        Assert.Null(state.Verify("regie", "secret-password"));
    }

    [Fact]
    public async Task Refresh_PasswordChangedElsewhere_EndsOldSessionsAndTakesTheNewPassword()
    {
        store.Account = Account("regie", "old-password-1");
        await state.RefreshAsync(CancellationToken.None);
        var oldStamp = state.Verify("regie", "old-password-1")!.SecurityStamp;
        store.Account = Account("regie", "new-password-1");

        var changed = await state.RefreshAsync(CancellationToken.None);

        Assert.True(changed);
        Assert.False(state.IsCurrent("regie", oldStamp));
        Assert.Null(state.Verify("regie", "old-password-1"));
        Assert.NotNull(state.Verify("regie", "new-password-1"));
    }

    [Fact]
    public async Task Refresh_ReadStartedBeforeAUseCaseFinished_DoesNotOverwriteTheNewerState()
    {
        store.Account = null;
        var staleRead = new TaskCompletionSource();
        store.BeforeReturning = () => staleRead.Task;
        var refresh = state.RefreshAsync(CancellationToken.None);

        state.Replace(Account("regie", "secret-password"));
        staleRead.SetResult();
        var changed = await refresh;

        Assert.False(changed);
        Assert.False(state.SetupRequired);
        Assert.Null(setupCode.Current);
    }

    [Fact]
    public void Verify_RightUserAndPassword_ReturnsTheIdentity()
    {
        var account = Account("regie", "secret-password");
        state.Replace(account);

        var identity = state.Verify(" regie ", "secret-password");

        Assert.Equal(new AdminIdentity("regie", account.SecurityStamp), identity);
    }

    [Theory]
    [InlineData("regie", "wrong-password")]
    [InlineData("Regie", "secret-password")]
    [InlineData("other", "secret-password")]
    [InlineData(null, null)]
    [InlineData("", "")]
    public void Verify_WrongPair_ReturnsNull(string? username, string? password)
    {
        state.Replace(Account("regie", "secret-password"));

        Assert.Null(state.Verify(username, password));
    }

    [Fact]
    public void Verify_WrongUserName_StillChecksAPasswordHash()
    {
        var hasher = new PrefixHasher();
        var counting = new AdminAccountState(store, hasher, setupCode, logger);
        counting.Replace(Account("regie", "secret-password"));

        counting.Verify("other", "secret-password");
        counting.Verify("regie", "wrong-password");

        Assert.Equal(2, hasher.Verifications);
    }

    [Fact]
    public void IsCurrent_OnlyForTheCurrentUserAndStamp()
    {
        var account = Account("regie", "secret-password");
        state.Replace(account);

        Assert.True(state.IsCurrent("regie", account.SecurityStamp));
        Assert.False(state.IsCurrent("regie", "old-stamp"));
        Assert.False(state.IsCurrent("regie", null));
        Assert.False(state.IsCurrent("other", account.SecurityStamp));
        Assert.False(state.IsCurrent(null, account.SecurityStamp));
    }

    [Fact]
    public void Replace_Null_ReopensTheSetup()
    {
        state.Replace(Account("regie", "secret-password"));

        state.Replace(null);

        Assert.True(state.SetupRequired);
        Assert.NotNull(setupCode.Current);
    }

    private static AdminAccount Account(string username, string password) =>
        AdminAccount.Create(username, new PrefixHasher().Hash(password), DateTimeOffset.UtcNow);

    private sealed class FakeAccountStore : IAdminAccountStore
    {
        public AdminAccount? Account { get; set; }

        public Func<Task>? BeforeReturning { get; set; }

        public async Task<AdminAccount?> GetAsync(CancellationToken cancellationToken)
        {
            var account = Account;
            if (BeforeReturning is { } wait)
            {
                await wait();
            }

            return account;
        }

        public Task<bool> TryCreateAsync(AdminAccount account, AuditEntry audit, CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<bool> TryUpdateAsync(AdminAccount account, AuditEntry audit, CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<bool> TryDeleteAsync(AuditEntry audit, CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    /// <summary>A reversible stand-in for the real hasher; counts the checks.</summary>
    private sealed class PrefixHasher : IAdminPasswordHasher
    {
        public int Verifications { get; private set; }

        public string Hash(string password) => "hash:" + password;

        public bool Verify(string hash, string password)
        {
            Verifications++;
            return string.Equals(hash, "hash:" + password, StringComparison.Ordinal);
        }
    }

    private sealed class CapturingLogger : ILogger<AdminAccountState>
    {
        public List<string> Messages { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => NullLogger.Instance.BeginScope(state);

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            Messages.Add(formatter(state, exception));
        }
    }
}
