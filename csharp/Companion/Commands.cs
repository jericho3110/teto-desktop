using System.Text.Json;
using System.Text.RegularExpressions;

namespace Teto.Companion;

/// <summary>What the brain can ask the companion to do.</summary>
public enum CommandKind { Speak, Notify }

/// <summary>
/// One validated command. A <c>record</c> is an immutable class with
/// value equality and a generated ToString, ideal for messages.
/// </summary>
public sealed record Command(CommandKind Kind, string Text, string Title);

/// <summary>
/// Parsing and cleaning, kept free of Windows APIs so it can be unit-tested.
/// Everything that arrives on the pipe is treated as untrusted input.
/// </summary>
public static partial class Commands
{
    /// <summary>Longest text we will speak or show (characters).</summary>
    public const int MaxText = 1000;
    public const int MaxTitle = 64;

    /// <summary>
    /// Parses one JSON line like <c>{"cmd":"speak","text":"hi"}</c>.
    /// Returns null (and never throws) for anything malformed or unknown.
    /// </summary>
    public static Command? Parse(string? line)
    {
        if (string.IsNullOrWhiteSpace(line) || line.Length > 16 * 1024)
        {
            return null;
        }
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return null;
            }
            string? Get(string name) =>
                root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

            var text = Clip(Get("text"), MaxText);
            if (string.IsNullOrWhiteSpace(text))
            {
                return null;
            }
            return Get("cmd") switch // C# switch expression
            {
                "speak" => new Command(CommandKind.Speak, text, ""),
                "notify" => new Command(CommandKind.Notify, text, Clip(Get("title"), MaxTitle) ?? "Teto"),
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Clip(string? s, int max) =>
        s is null ? null : (s.Length <= max ? s : s[..(max - 1)] + "…"); // s[..n] is a range: the first n chars

    // [GeneratedRegex] makes the compiler generate the regex code at build
    // time (faster startup, no runtime parsing). Requires `partial`.
    [GeneratedRegex(@"```.*?```", RegexOptions.Singleline)]
    private static partial Regex CodeBlock();

    [GeneratedRegex(@"https?://\S+")]
    private static partial Regex Url();

    [GeneratedRegex(@"[`*_#>\[\]]")]
    private static partial Regex MarkdownSymbols();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    /// <summary>
    /// Turns a Markdown reply into something pleasant to hear: code blocks
    /// and URLs are summarized instead of read out character by character.
    /// </summary>
    public static string ForSpeech(string text)
    {
        var s = CodeBlock().Replace(text, " (code) ");
        s = Url().Replace(s, " (link) ");
        s = MarkdownSymbols().Replace(s, "");
        return Spaces().Replace(s, " ").Trim();
    }
}
