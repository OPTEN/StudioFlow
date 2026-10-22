using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Opten.FlowStudio.Web.Tests.Support;

/// <summary>A log entry of the app under test (warnings and above).</summary>
/// <param name="Category">Logger category.</param>
/// <param name="Level">Level.</param>
/// <param name="Message">Formatted message.</param>
/// <param name="Exception">Attached exception, if any.</param>
public sealed record CapturedLog(string Category, LogLevel Level, string Message, Exception? Exception);

/// <summary>Collects the warnings and errors an app logs, so tests can assert that a path stays quiet.</summary>
public sealed class LogCapture : ILoggerProvider
{
    private readonly ConcurrentQueue<CapturedLog> entries = new();

    /// <summary>Everything logged at warning level or above, oldest first.</summary>
    public IReadOnlyList<CapturedLog> Entries => [.. entries];

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, entries);

    public void Dispose()
    {
    }

    private sealed class Logger(string category, ConcurrentQueue<CapturedLog> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            if (IsEnabled(logLevel))
            {
                entries.Enqueue(new CapturedLog(category, logLevel, formatter(state, exception), exception));
            }
        }
    }
}

/// <summary>A SQL command of the app under test.</summary>
/// <param name="Sql">Command text.</param>
/// <param name="HubMethod">Hub method whose invocation ran it (SignalR server activity), null outside a hub call.</param>
public sealed record RecordedCommand(string Sql, string? HubMethod)
{
    /// <summary>True for INSERT, UPDATE and DELETE statements.</summary>
    public bool IsWrite =>
        Sql.Contains("INSERT ", StringComparison.OrdinalIgnoreCase)
        || Sql.Contains("UPDATE ", StringComparison.OrdinalIgnoreCase)
        || Sql.Contains("DELETE ", StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Records the SQL commands EF Core executes against one database (EF diagnostics; other test apps use other databases
/// and are ignored) while it is alive, each with the hub method it ran in. EF caches its logging configuration for about
/// a second, so commands right after the start can be missed: warm up for longer than that before counting.
/// </summary>
public sealed class SqlCommandRecorder : IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>, IDisposable
{
    private const string SignalRSource = "Microsoft.AspNetCore.SignalR.Server";

    private readonly string database;
    private readonly ConcurrentQueue<RecordedCommand> commands = new();
    private readonly List<IDisposable> subscriptions = [];
    private readonly IDisposable allListeners;
    private readonly ActivityListener hubActivities;
    private volatile bool recording = true;

    private SqlCommandRecorder(string database)
    {
        this.database = database;
        hubActivities = new ActivityListener
        {
            ShouldListenTo = source => source.Name == SignalRSource,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
        };
        ActivitySource.AddActivityListener(hubActivities);
        allListeners = DiagnosticListener.AllListeners.Subscribe(this);
    }

    /// <summary>The commands recorded so far, in execution order.</summary>
    public IReadOnlyList<RecordedCommand> Commands => [.. commands];

    /// <summary>Starts recording the commands sent to <paramref name="database"/>.</summary>
    public static SqlCommandRecorder For(string database) => new(database);

    public void Dispose()
    {
        recording = false;
        allListeners.Dispose();
        hubActivities.Dispose();
        lock (subscriptions)
        {
            foreach (var subscription in subscriptions)
            {
                subscription.Dispose();
            }

            subscriptions.Clear();
        }
    }

    void IObserver<DiagnosticListener>.OnNext(DiagnosticListener value)
    {
        if (value.Name == DbLoggerCategory.Name)
        {
            lock (subscriptions)
            {
                subscriptions.Add(value.Subscribe(this, name => name == RelationalEventId.CommandExecuted.Name));
            }
        }
    }

    void IObserver<KeyValuePair<string, object?>>.OnNext(KeyValuePair<string, object?> value)
    {
        if (recording && value.Value is CommandExecutedEventData data && string.Equals(data.Command.Connection?.Database, database, StringComparison.Ordinal))
        {
            commands.Enqueue(new RecordedCommand(data.Command.CommandText, HubMethodOf(Activity.Current)));
        }
    }

    void IObserver<DiagnosticListener>.OnCompleted()
    {
    }

    void IObserver<DiagnosticListener>.OnError(Exception error)
    {
    }

    void IObserver<KeyValuePair<string, object?>>.OnCompleted()
    {
    }

    void IObserver<KeyValuePair<string, object?>>.OnError(Exception error)
    {
    }

    private static string? HubMethodOf(Activity? activity)
    {
        for (var current = activity; current is not null; current = current.Parent)
        {
            if (current.Source.Name == SignalRSource && current.GetTagItem("rpc.method") is string method)
            {
                return method;
            }
        }

        return null;
    }
}

/// <summary>
/// An HTTP handler whose network can be cut: while <see cref="Cut"/> is set, every request fails and responses that
/// are still on their way are dropped. The server is not told – to it the client looks alive until its timeout, like a
/// page that was just reloaded or a phone whose Wi-Fi dropped.
/// </summary>
public sealed class CuttableHandler(HttpMessageHandler inner) : DelegatingHandler(inner)
{
    private volatile bool cut;

    /// <summary>Cuts the network of this client.</summary>
    public void Cut() => cut = true;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (cut)
        {
            throw new HttpRequestException("The network of this test client is cut.");
        }

        var response = await base.SendAsync(request, cancellationToken);
        if (cut)
        {
            response.Dispose();
            throw new HttpRequestException("The network of this test client is cut.");
        }

        return response;
    }
}
