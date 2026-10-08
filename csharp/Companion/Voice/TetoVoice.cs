using System.Text;

namespace Teto.Companion.Voice;

/// <summary>
/// Teto's voice: babble built from her real UTAU voicebank (the free,
/// official single-syllable bank, downloaded by the user; never bundled,
/// because its terms forbid redistribution).
///
/// Japanese kana are spoken as the matching syllables; any other text
/// becomes "Animalese"-style babble: each word maps to 1-3 of her
/// syllables, picked deterministically so the same word always sounds the same.
/// </summary>
public sealed class TetoVoice
{
    private const int MaxSyllables = 40;     // ~6 s at most per reply
    private const double SyllableMs = 125;   // how much of each syllable we play
    private const double FadeMs = 18;        // crossfade between syllables (no clicks)

    private readonly Dictionary<string, short[]> _clips; // alias -> samples, already trimmed
    private readonly string[] _palette;                  // aliases used for babble
    public int SampleRate { get; }
    public int ClipCount => _clips.Count;

    private TetoVoice(Dictionary<string, short[]> clips, int sampleRate)
    {
        _clips = clips;
        SampleRate = sampleRate;
        // Babble sounds best with plain consonant+vowel syllables.
        _palette = clips.Keys.Where(a => a.Length == 1 && a[0] is >= 'か' and <= 'ん' && a != "ん").Order().ToArray();
        if (_palette.Length == 0)
        {
            _palette = clips.Keys.Order().ToArray();
        }
    }

    /// <summary>The default voicebank folder: %LOCALAPPDATA%\Teto\voices (override with TETO_VOICEBANK).</summary>
    public static string DefaultFolder =>
        Environment.GetEnvironmentVariable("TETO_VOICEBANK")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Teto", "voices");

    /// <summary>
    /// Finds the biggest oto.ini under <paramref name="folder"/> (the main
    /// bank, not the "extra" one) and loads its syllables. Null if none.
    /// </summary>
    public static TetoVoice? Load(string folder)
    {
        if (!Directory.Exists(folder))
        {
            return null;
        }
        var best = Directory.EnumerateFiles(folder, "oto.ini", SearchOption.AllDirectories)
            .Select(f => (File: f, Entries: OtoIni.Parse(File.ReadAllText(f, OtoIni.ShiftJis))))
            .OrderByDescending(x => x.Entries.Count)
            .FirstOrDefault();
        if (best.File is null)
        {
            return null;
        }

        var dir = Path.GetDirectoryName(best.File)!;
        var clips = new Dictionary<string, short[]>();
        var rate = 0;
        foreach (var e in best.Entries)
        {
            // Only plain aliases ("か"), not UTAU's "- か" / "* か" variants.
            if (e.Alias.Contains(' ') || clips.ContainsKey(e.Alias) || OtoIni.SafePath(dir, e.File) is not { } path
                || !File.Exists(path) || new FileInfo(path).Length > Wav.MaxFileBytes)
            {
                continue;
            }
            if (Wav.Read(File.ReadAllBytes(path)) is not { } wav || (rate != 0 && wav.SampleRate != rate))
            {
                continue;
            }
            rate = wav.SampleRate;
            if (Trim(wav.Samples, rate, e) is { } clip)
            {
                clips[e.Alias] = clip;
            }
        }
        return clips.Count > 0 ? new TetoVoice(clips, rate) : null;
    }

    /// <summary>Cuts one syllable out of its file using the oto.ini timings.</summary>
    internal static short[]? Trim(short[] samples, int rate, OtoEntry e)
    {
        int Ms(double ms) => (int)(ms * rate / 1000);
        var start = Math.Clamp(Ms(e.Offset), 0, samples.Length);
        var end = e.Cutoff >= 0 ? samples.Length - Ms(e.Cutoff) : start + Ms(-e.Cutoff);
        // Keep the consonant plus a bit of vowel: enough to be recognizable, short enough to babble.
        end = Math.Clamp(Math.Min(end, start + Ms(e.Consonant + SyllableMs)), start, samples.Length);
        return end - start > Ms(30) ? samples[start..end] : null; // a range copy: start..end
    }

    /// <summary>Turns text into the syllable aliases Teto will say.</summary>
    public List<string> Syllables(string text)
    {
        var result = new List<string>();
        foreach (var word in Words(text))
        {
            if (result.Count >= MaxSyllables)
            {
                break;
            }
            if (word == "|")
            {
                result.Add("|"); // pause between words/sentences
                continue;
            }
            var kana = KanaSyllables(word);
            if (kana.Count > 0)
            {
                result.AddRange(kana);
                continue;
            }
            // Babble: 1-3 syllables per word, chosen by a stable hash of the word
            // (string.GetHashCode is randomized per process, so we use FNV-1a).
            var hash = Fnv1a(word.ToLowerInvariant());
            var count = Math.Clamp((word.Length + 2) / 3, 1, 3);
            for (var k = 0; k < count; k++)
            {
                result.Add(_palette[(int)((hash >> (k * 8)) % (uint)_palette.Length)]);
            }
        }
        if (result.Count > MaxSyllables)
        {
            result.RemoveRange(MaxSyllables, result.Count - MaxSyllables);
        }
        return result;
    }

    /// <summary>Renders text to 16-bit PCM: syllables crossfaded, slightly varied in pitch.</summary>
    public short[] Render(string text)
    {
        var syllables = Syllables(text);
        var output = new List<short>();
        var fade = (int)(FadeMs * SampleRate / 1000);
        var pause = new short[(int)(70.0 * SampleRate / 1000)];
        var n = 0;
        foreach (var s in syllables)
        {
            if (s == "|" || !_clips.TryGetValue(s, out var clip))
            {
                output.AddRange(pause);
                continue;
            }
            // Pitch variation by resampling: playing 6% faster = 6% higher.
            // A gentle up-down pattern sounds like intonation instead of noise.
            var speed = 1.0 + 0.06 * Math.Sin(n++ * 1.3);
            var piece = Resample(clip, speed);
            Mix(output, piece, fade);
        }
        return output.ToArray();
    }

    internal static short[] Resample(short[] input, double speed)
    {
        var length = (int)(input.Length / speed);
        var output = new short[length];
        for (var i = 0; i < length; i++)
        {
            var pos = i * speed;
            var i0 = (int)pos;
            var i1 = Math.Min(i0 + 1, input.Length - 1);
            var t = pos - i0;
            output[i] = (short)(input[i0] * (1 - t) + input[i1] * t); // linear interpolation
        }
        return output;
    }

    /// <summary>Appends with a short crossfade so syllables join without clicks.</summary>
    internal static void Mix(List<short> output, short[] piece, int fade)
    {
        var overlap = Math.Min(fade, Math.Min(output.Count, piece.Length));
        var start = output.Count - overlap;
        for (var i = 0; i < piece.Length; i++)
        {
            var fadeIn = i < fade ? i / (double)fade : 1.0;
            var tail = piece.Length - i;
            var fadeOut = tail < fade ? tail / (double)fade : 1.0;
            var v = piece[i] * fadeIn * fadeOut;
            if (i < overlap)
            {
                var j = start + i;
                output[j] = (short)Math.Clamp(output[j] + v, short.MinValue, short.MaxValue);
            }
            else
            {
                output.Add((short)v);
            }
        }
    }

    /// <summary>Hiragana/katakana → aliases. "きゃ" stays together; "ー" and "っ" become pauses.</summary>
    internal List<string> KanaSyllables(string word)
    {
        var result = new List<string>();
        var hira = ToHiragana(word);
        for (var i = 0; i < hira.Length; i++)
        {
            var c = hira[i];
            if (c is 'ー' or 'っ')
            {
                result.Add("|");
                continue;
            }
            if (c is < 'ぁ' or > 'ゖ')
            {
                return []; // not (only) kana: let the caller babble the whole word
            }
            // small ゃゅょ etc. combine with the previous kana if the bank has that alias
            if (i + 1 < hira.Length && "ゃゅょぁぃぅぇぉ".Contains(hira[i + 1])
                && _clips.ContainsKey(new string([c, hira[i + 1]])))
            {
                result.Add(new string([c, hira[i + 1]]));
                i++;
                continue;
            }
            var alias = c.ToString();
            if (_clips.ContainsKey(alias))
            {
                result.Add(alias);
            }
        }
        return result;
    }

    private static string ToHiragana(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
        {
            sb.Append(c is >= 'ァ' and <= 'ヶ' ? (char)(c - 0x60) : c); // katakana block sits 0x60 above hiragana
        }
        return sb.ToString();
    }

    private static IEnumerable<string> Words(string text)
    {
        var word = new StringBuilder();
        foreach (var c in Commands.ForSpeech(text))
        {
            if (char.IsLetterOrDigit(c) || c is 'ー')
            {
                word.Append(c);
                continue;
            }
            if (word.Length > 0)
            {
                yield return word.ToString();
                word.Clear();
            }
            if (c is '.' or '!' or '?' or ',' or '。' or '、' or '！' or '？')
            {
                yield return "|";
            }
        }
        if (word.Length > 0)
        {
            yield return word.ToString();
        }
    }

    internal static uint Fnv1a(string s)
    {
        var h = 2166136261u;
        foreach (var c in s)
        {
            h = (h ^ c) * 16777619u;
        }
        return h;
    }

    /// <summary>For tests: a voice built from in-memory clips.</summary>
    internal static TetoVoice FromClips(Dictionary<string, short[]> clips, int rate) => new(clips, rate);
}
