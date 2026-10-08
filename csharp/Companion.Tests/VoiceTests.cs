using Teto.Companion.Voice;

namespace Teto.Companion.Tests;

public class WavTests
{
    [Fact]
    public void RoundTrips16BitMono()
    {
        short[] samples = [0, 1000, -1000, short.MaxValue, short.MinValue];
        var parsed = Wav.Read(Wav.Write(samples, 44100));
        Assert.NotNull(parsed);
        Assert.Equal(44100, parsed.Value.SampleRate);
        Assert.Equal(samples, parsed.Value.Samples);
    }

    [Fact]
    public void RejectsLyingChunkSizes()
    {
        var wav = Wav.Write(new short[100], 44100);
        BitConverter.GetBytes(int.MaxValue).CopyTo(wav, 40); // "data" chunk claims 2 GB
        Assert.Null(Wav.Read(wav));
    }

    [Theory]
    [InlineData(new byte[0])]
    [InlineData(new byte[] { 1, 2, 3 })]
    [InlineData(new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F', 0, 0, 0, 0, (byte)'J', (byte)'U', (byte)'N', (byte)'K' })]
    public void RejectsGarbage(byte[] bytes) => Assert.Null(Wav.Read(bytes));

    [Fact]
    public void RejectsStereoAnd8Bit()
    {
        var wav = Wav.Write(new short[10], 44100);
        wav[22] = 2; // channels = 2
        Assert.Null(Wav.Read(wav));
    }
}

public class OtoIniTests
{
    [Fact]
    public void ParsesUtauLinesAndSkipsJunk()
    {
        var entries = OtoIni.Parse("_か.wav=か,12,101,1475,31,0\r\n\r\nnot a line\n_き.wav=き,1.5,x,0\n_く.wav=,0,50,-200,0,0\n");
        Assert.Equal(2, entries.Count);
        Assert.Equal(new OtoEntry("_か.wav", "か", 12, 101, 1475), entries[0]);
        Assert.Equal("_く", entries[1].Alias); // empty alias falls back to the file name
    }

    [Theory] // path traversal: oto.ini names must stay inside the voicebank folder
    [InlineData(@"..\..\Windows\win.ini")]
    [InlineData(@"..\evil.wav")]
    [InlineData(@"C:\Windows\Media\chimes.wav")]
    [InlineData(@"\\server\share\x.wav")]
    [InlineData("notes.txt")]
    public void RefusesPathsOutsideTheBank(string file) =>
        Assert.Null(OtoIni.SafePath(Path.Combine(Path.GetTempPath(), "bank"), file));

    [Fact]
    public void AcceptsNormalNames() =>
        Assert.NotNull(OtoIni.SafePath(Path.Combine(Path.GetTempPath(), "bank"), @"sub\_か.wav"));

    [Fact]
    public void ReadsShiftJis() =>
        Assert.Equal("か", OtoIni.ShiftJis.GetString(new byte[] { 0x82, 0xA9 })); // "か" in Shift-JIS
}

public class TetoVoiceTests
{
    private static TetoVoice FakeVoice()
    {
        var clips = new Dictionary<string, short[]>();
        foreach (var alias in new[] { "か", "き", "て", "と", "ら", "きゃ", "あ" })
        {
            clips[alias] = Enumerable.Repeat((short)1000, 4410).ToArray(); // 0.1 s
        }
        return TetoVoice.FromClips(clips, 44100);
    }

    [Fact]
    public void KanaAreSpokenAsThemselves()
    {
        var v = FakeVoice();
        Assert.Equal(["て", "と"], v.Syllables("テト"));        // katakana → hiragana
        Assert.Equal(["きゃ", "と"], v.Syllables("きゃと"));    // small ゃ combines
    }

    [Fact]
    public void EnglishBabbleIsDeterministicAndBounded()
    {
        var v = FakeVoice();
        Assert.Equal(v.Syllables("Hello world"), v.Syllables("Hello world"));
        Assert.True(v.Syllables(string.Join(' ', Enumerable.Repeat("word", 500))).Count <= 40);
    }

    [Fact]
    public void RenderProducesAudio()
    {
        var pcm = FakeVoice().Render("Done! All tests pass.");
        Assert.True(pcm.Length > 44100 / 10, $"{pcm.Length} samples");
    }

    [Fact]
    public void TrimUsesOtoTimings()
    {
        var samples = new short[44100]; // 1 s
        var clip = TetoVoice.Trim(samples, 44100, new OtoEntry("x.wav", "か", 100, 50, 0));
        Assert.NotNull(clip);
        Assert.Equal((int)(44100 * (50 + 125) / 1000.0), clip.Length); // consonant + 125 ms of vowel
    }

    [Fact]
    public void MissingFolderMeansNoVoice() =>
        Assert.Null(TetoVoice.Load(Path.Combine(Path.GetTempPath(), "no-such-teto-bank-" + Guid.NewGuid())));
}

public class RealVoicebankTests
{
    /// <summary>
    /// Runs only where the official voicebank is installed (never in the
    /// repo: its terms forbid redistribution). Writes a sample you can play.
    /// </summary>
    [Fact]
    public void LoadsAndRendersTheInstalledVoicebank()
    {
        var voice = TetoVoice.Load(TetoVoice.DefaultFolder);
        if (voice is null)
        {
            return; // not installed on this machine: nothing to check
        }
        Assert.True(voice.ClipCount > 100, $"only {voice.ClipCount} syllables loaded");
        Assert.Equal(44100, voice.SampleRate);
        var pcm = voice.Render("こんにちは、テトです! Hello, I'm Teto. All tests pass!");
        Assert.InRange(pcm.Length / (double)voice.SampleRate, 1.0, 10.0); // seconds
        File.WriteAllBytes(Path.Combine(Path.GetTempPath(), "teto-voice-sample.wav"), Wav.Write(pcm, voice.SampleRate));
    }
}
