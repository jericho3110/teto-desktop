using System.Globalization;
using System.Text;

namespace Teto.Companion.Voice;

/// <summary>
/// One line of a UTAU <c>oto.ini</c>: where a syllable sits inside its WAV.
/// <c>_か.wav=か,12,101,1475,31,0</c> = file, alias, then milliseconds:
/// offset (skip this much), consonant (the fixed, non-stretchable start),
/// cutoff (positive: trim this much from the END; negative: length after
/// offset), preutterance and overlap (how notes blend; unused for babble).
/// </summary>
public sealed record OtoEntry(string File, string Alias, double Offset, double Consonant, double Cutoff);

public static class OtoIni
{
    /// <summary>
    /// UTAU dates from 2008 Japanese Windows, so oto.ini is Shift-JIS
    /// (code page 932), not UTF-8. .NET (Core) only ships UTF encodings
    /// by default; the CodePages provider adds the legacy ones.
    /// </summary>
    public static Encoding ShiftJis
    {
        get
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            return Encoding.GetEncoding(932);
        }
    }

    /// <summary>Parses oto.ini text. Malformed lines are skipped, never fatal.</summary>
    public static List<OtoEntry> Parse(string text)
    {
        var entries = new List<OtoEntry>();
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            var eq = line.IndexOf('=');
            if (eq <= 0)
            {
                continue;
            }
            var file = line[..eq];
            var parts = line[(eq + 1)..].Split(',');
            if (parts.Length < 4 || !TryMs(parts[1], out var offset) || !TryMs(parts[2], out var consonant)
                || !TryMs(parts[3], out var cutoff))
            {
                continue;
            }
            var alias = parts[0].Length > 0 ? parts[0] : Path.GetFileNameWithoutExtension(file);
            entries.Add(new OtoEntry(file, alias, offset, consonant, cutoff));
        }
        return entries;
    }

    // InvariantCulture: "12.5" must parse the same on a PC set to German ("12,5").
    private static bool TryMs(string s, out double ms) =>
        double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out ms) && double.IsFinite(ms) && Math.Abs(ms) < 600_000;

    /// <summary>
    /// Resolves an oto.ini file name inside <paramref name="bankDir"/>.
    /// Returns null if the name tries to escape the folder (path traversal:
    /// "..\..\Windows\x.wav", "C:\x.wav") or isn't a .wav.
    /// </summary>
    public static string? SafePath(string bankDir, string file)
    {
        if (Path.IsPathRooted(file) || !file.EndsWith(".wav", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        var root = Path.GetFullPath(bankDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(root, file));
        return full.StartsWith(root, StringComparison.OrdinalIgnoreCase) ? full : null;
    }
}
