using System.Buffers.Binary;

namespace Teto.Companion.Voice;

/// <summary>
/// Minimal, defensive WAV (RIFF) reading and writing for 16-bit mono PCM,
/// the format UTAU voicebanks use. Voicebank files are downloaded data, so
/// every size field is bounds-checked before it's trusted.
/// </summary>
public static class Wav
{
    public const int MaxFileBytes = 16 * 1024 * 1024; // a syllable is ~100 KB; refuse anything absurd

    /// <summary>Parses a WAV file. Returns null (never throws) for anything that isn't 16-bit mono PCM.</summary>
    public static (short[] Samples, int SampleRate)? Read(ReadOnlySpan<byte> file)
    {
        if (file.Length < 12 || file.Length > MaxFileBytes
            || !file[..4].SequenceEqual("RIFF"u8) || !file.Slice(8, 4).SequenceEqual("WAVE"u8))
        {
            return null;
        }

        int rate = 0, channels = 0, bits = 0, format = 0;
        ReadOnlySpan<byte> data = default;
        var pos = 12;
        // Walk the chunks: [4-byte id][4-byte little-endian size][size bytes (+1 pad if odd)]
        while (pos + 8 <= file.Length)
        {
            var id = file.Slice(pos, 4);
            var size = BinaryPrimitives.ReadUInt32LittleEndian(file.Slice(pos + 4, 4));
            pos += 8;
            if (size > (uint)(file.Length - pos))
            {
                return null; // chunk claims to be bigger than the file: corrupt or malicious
            }
            var body = file.Slice(pos, (int)size);
            if (id.SequenceEqual("fmt "u8) && body.Length >= 16)
            {
                format = BinaryPrimitives.ReadUInt16LittleEndian(body);
                channels = BinaryPrimitives.ReadUInt16LittleEndian(body[2..]);
                rate = (int)BinaryPrimitives.ReadUInt32LittleEndian(body[4..]);
                bits = BinaryPrimitives.ReadUInt16LittleEndian(body[14..]);
            }
            else if (id.SequenceEqual("data"u8))
            {
                data = body;
            }
            pos += (int)size + (int)(size & 1); // chunks are padded to even sizes
        }

        if (format != 1 || channels != 1 || bits != 16 || rate is < 8000 or > 96000 || data.IsEmpty)
        {
            return null;
        }
        var samples = new short[data.Length / 2];
        for (var i = 0; i < samples.Length; i++)
        {
            samples[i] = BinaryPrimitives.ReadInt16LittleEndian(data.Slice(i * 2, 2));
        }
        return (samples, rate);
    }

    /// <summary>Wraps 16-bit mono samples in a WAV header (for SoundPlayer).</summary>
    public static byte[] Write(ReadOnlySpan<short> samples, int sampleRate)
    {
        var dataBytes = samples.Length * 2;
        var bytes = new byte[44 + dataBytes];
        var s = bytes.AsSpan();
        "RIFF"u8.CopyTo(s);
        BinaryPrimitives.WriteUInt32LittleEndian(s[4..], (uint)(36 + dataBytes));
        "WAVE"u8.CopyTo(s[8..]);
        "fmt "u8.CopyTo(s[12..]);
        BinaryPrimitives.WriteUInt32LittleEndian(s[16..], 16);          // fmt chunk size
        BinaryPrimitives.WriteUInt16LittleEndian(s[20..], 1);           // PCM
        BinaryPrimitives.WriteUInt16LittleEndian(s[22..], 1);           // mono
        BinaryPrimitives.WriteUInt32LittleEndian(s[24..], (uint)sampleRate);
        BinaryPrimitives.WriteUInt32LittleEndian(s[28..], (uint)(sampleRate * 2)); // bytes per second
        BinaryPrimitives.WriteUInt16LittleEndian(s[32..], 2);           // bytes per sample frame
        BinaryPrimitives.WriteUInt16LittleEndian(s[34..], 16);          // bits per sample
        "data"u8.CopyTo(s[36..]);
        BinaryPrimitives.WriteUInt32LittleEndian(s[40..], (uint)dataBytes);
        for (var i = 0; i < samples.Length; i++)
        {
            BinaryPrimitives.WriteInt16LittleEndian(s[(44 + i * 2)..], samples[i]);
        }
        return bytes;
    }
}
