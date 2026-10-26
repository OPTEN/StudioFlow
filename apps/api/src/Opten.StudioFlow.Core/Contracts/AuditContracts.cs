namespace Opten.StudioFlow.Core.Contracts;

/// <summary>An entry of the audit log as the Regie shows it.</summary>
/// <param name="Id">Database id; ascending in the order the entries were written.</param>
/// <param name="At">Time of the action.</param>
/// <param name="Actor"><c>admin</c>, <c>system</c> or <c>device:{id}</c>.</param>
/// <param name="Action">Action code such as <c>scene.live</c>.</param>
/// <param name="Category">What the action is about.</param>
/// <param name="ProductionId">Production of the action; null for global actions such as sign-ins.</param>
/// <param name="ProductionName">Current name of the production, or null.</param>
/// <param name="Code">Log code for the text of the entry, or null for an action this version does not describe (then <paramref name="Text"/> is the action code).</param>
/// <param name="Params">Values for the text of the code, keyed in camelCase; the same as in <see cref="LogEntryDto.Params"/>.</param>
/// <param name="Text">English text for clients that do not know the code.</param>
/// <param name="Details">All details of the entry (device name, scene, IP address of a sign-in); never secrets.</param>
public sealed record AuditEntryDto(
    long Id,
    DateTimeOffset At,
    string Actor,
    string Action,
    AuditCategory Category,
    string? ProductionId,
    string? ProductionName,
    LogCode? Code,
    IReadOnlyDictionary<string, string> Params,
    string Text,
    IReadOnlyDictionary<string, string> Details);

/// <summary>One page of the audit log, newest first.</summary>
/// <param name="Entries">The entries of the page.</param>
/// <param name="NextCursor">Pass as <c>cursor</c> to get the next page; null on the last page.</param>
public sealed record AuditPageDto(IReadOnlyList<AuditEntryDto> Entries, string? NextCursor);
