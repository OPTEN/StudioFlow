using System.Xml.Linq;
using Opten.StudioFlow.Web.Hosting;

namespace Opten.StudioFlow.Web.Tests;

/// <summary>The version the API reports: one number from <c>Directory.Build.props</c>, plus the commit when the build knows it.</summary>
public sealed class AppVersionTests
{
    [Theory]
    [InlineData(null, "0.0.0")]
    [InlineData("", "0.0.0")]
    [InlineData("  ", "0.0.0")]
    [InlineData("0.1.0", "0.1.0")]
    [InlineData("0.1.0+", "0.1.0")]
    [InlineData("0.1.0+abc", "0.1.0+abc")]
    [InlineData("0.1.0+1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", "0.1.0+1a2b3c4")]
    [InlineData("1.2.3-rc.1+1a2b3c4d5e6f", "1.2.3-rc.1+1a2b3c4")]
    public void From_KeepsTheVersionAndShortensTheRevision(string? informationalVersion, string expected)
    {
        Assert.Equal(expected, AppVersion.From(informationalVersion));
    }

    [Fact]
    public void Current_StartsWithTheVersionInDirectoryBuildProps()
    {
        var expected = VersionInDirectoryBuildProps();

        Assert.Matches(@"^\d+\.\d+\.\d+$", expected);
        Assert.StartsWith(expected, AppVersion.Current, StringComparison.Ordinal);
        Assert.Matches(@"^[^+]+(\+[0-9A-Za-z]{1,7})?$", AppVersion.Current);
    }

    private static string VersionInDirectoryBuildProps()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var props = Path.Combine(directory.FullName, "Directory.Build.props");
            if (File.Exists(props))
            {
                return XDocument.Load(props).Descendants("Version").Single().Value.Trim();
            }
        }

        throw new FileNotFoundException("Directory.Build.props was not found above the test output folder.");
    }
}
