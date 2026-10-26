using Microsoft.Extensions.Configuration;
using Npgsql;
using Opten.StudioFlow.Infrastructure.Install;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The secrets the init service generated once (issue #27): the API reads them, never writes or shows them.</summary>
public sealed class SecretFilesTests : IDisposable
{
    private const string Password = "p4ssw0rdFromTheVolume0123456789ab";
    private const string Key = "APIkeyFromTheVolume";
    private const string Secret = "SecretFromTheVolumeWithMoreThanThirtyTwoChars";

    private readonly string folder = Directory.CreateTempSubdirectory("sf-secrets-").FullName;

    public void Dispose() => Directory.Delete(folder, recursive: true);

    private void Write(string name, string content) => File.WriteAllText(Path.Combine(folder, name), content);

    private void WriteAll()
    {
        Write(SecretFiles.PostgresPassword, Password + "\n");
        Write(SecretFiles.LiveKitApiKey, Key);
        Write(SecretFiles.LiveKitApiSecret, Secret + "\r\n");
    }

    private static ConfigurationManager Configuration(params (string Key, string Value)[] values)
    {
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value));
        return configuration;
    }

    [Fact]
    public void Apply_CompletesTheConnectionStringAndTheLiveKitKeys()
    {
        WriteAll();
        var configuration = Configuration(("Install:SecretsPath", folder), ("ConnectionStrings:StudioFlow", "Host=postgres;Database=studioflow;Username=studioflow"));

        SecretFiles.Apply(configuration);

        var connection = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("StudioFlow"));
        Assert.Equal((Password, "postgres", "studioflow", "studioflow"), (connection.Password, connection.Host, connection.Database, connection.Username));
        Assert.Equal(Key, configuration["LiveKit:ApiKey"]);
        Assert.Equal(Secret, configuration["LiveKit:ApiSecret"]);
    }

    [Fact]
    public void Apply_NeverReplacesAValueThatIsConfigured()
    {
        WriteAll();
        var configuration = Configuration(
            ("Install:SecretsPath", folder),
            ("ConnectionStrings:StudioFlow", "Host=db;Database=x;Username=y;Password=configured"),
            ("LiveKit:ApiKey", "configured-key"),
            ("LiveKit:ApiSecret", "configured-secret-with-more-than-32-characters"));

        SecretFiles.Apply(configuration);

        Assert.Equal("configured", new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("StudioFlow")).Password);
        Assert.Equal("configured-key", configuration["LiveKit:ApiKey"]);
        Assert.Equal("configured-secret-with-more-than-32-characters", configuration["LiveKit:ApiSecret"]);
    }

    [Fact]
    public void Apply_WithoutAFolder_ChangesNothing()
    {
        var configuration = Configuration(("ConnectionStrings:StudioFlow", "Host=db;Database=x;Username=y"));

        SecretFiles.Apply(configuration);

        Assert.Equal("Host=db;Database=x;Username=y", configuration.GetConnectionString("StudioFlow"));
        Assert.Null(configuration["LiveKit:ApiKey"]);
    }

    [Fact]
    public void Apply_APasswordWithSpecialCharacters_StaysOneValue()
    {
        Write(SecretFiles.PostgresPassword, "pa;ss=word'\"x");
        Write(SecretFiles.LiveKitApiKey, Key);
        Write(SecretFiles.LiveKitApiSecret, Secret);
        var configuration = Configuration(("Install:SecretsPath", folder), ("ConnectionStrings:StudioFlow", "Host=postgres;Database=studioflow;Username=studioflow"));

        SecretFiles.Apply(configuration);

        Assert.Equal("pa;ss=word'\"x", new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("StudioFlow")).Password);
    }

    [Fact]
    public void Apply_AMissingFile_StopsTheStartWithAMessageThatNamesTheFileButNotAnyContent()
    {
        Write(SecretFiles.PostgresPassword, Password);
        Write(SecretFiles.LiveKitApiKey, Key);
        var configuration = Configuration(("Install:SecretsPath", folder), ("ConnectionStrings:StudioFlow", "Host=postgres;Database=studioflow;Username=studioflow"));

        var exception = Assert.Throws<InvalidOperationException>(() => SecretFiles.Apply(configuration));

        Assert.Contains(SecretFiles.LiveKitApiSecret, exception.Message, StringComparison.Ordinal);
        Assert.Contains("docker compose logs init", exception.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(Password, exception.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(Key, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Apply_AnEmptyFile_IsAnError()
    {
        WriteAll();
        Write(SecretFiles.LiveKitApiKey, " \n");
        var configuration = Configuration(("Install:SecretsPath", folder));

        var exception = Assert.Throws<InvalidOperationException>(() => SecretFiles.Apply(configuration));

        Assert.Contains("is empty", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Apply_ReadsTheFilesAgainOnEveryStart_SoARestartKeepsWhatWasGenerated()
    {
        WriteAll();
        var first = Configuration(("Install:SecretsPath", folder), ("ConnectionStrings:StudioFlow", "Host=postgres;Database=studioflow;Username=studioflow"));
        var second = Configuration(("Install:SecretsPath", folder), ("ConnectionStrings:StudioFlow", "Host=postgres;Database=studioflow;Username=studioflow"));

        SecretFiles.Apply(first);
        SecretFiles.Apply(second);

        Assert.Equal(first["LiveKit:ApiSecret"], second["LiveKit:ApiSecret"]);
        Assert.Equal(first.GetConnectionString("StudioFlow"), second.GetConnectionString("StudioFlow"));
        Assert.Equal(["livekit-api-key", "livekit-api-secret", "postgres-password"], Directory.GetFiles(folder).Select(Path.GetFileName).Order());
    }
}
