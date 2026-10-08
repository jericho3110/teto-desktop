# Teto's voice

How Teto speaks with her **real voice**, what the licence allows, and
how audio is built from a voicebank, sample by sample.

## Contents

1. [The options we looked at](#the-options-we-looked-at)
2. [The licence, in plain English](#the-licence-in-plain-english)
3. [Installing the voicebank](#installing-the-voicebank)
4. [What's inside a UTAU voicebank](#whats-inside-a-utau-voicebank)
5. [From reply text to audio](#from-reply-text-to-audio)
6. [Digital audio basics used here](#digital-audio-basics-used-here)
7. [Treating the voicebank as untrusted data](#treating-the-voicebank-as-untrusted-data)
8. [Tests](#tests)
9. [Limits and ideas](#limits-and-ideas)
10. [References](#references)

## The options we looked at

| Option | Speaks text? | Cost | Usable from our code? | Verdict |
| --- | --- | --- | --- | --- |
| **UTAU voicebank** (official, 2008–) | sings/says syllables | free, non-commercial | yes: it's WAV files + a timing table | ✅ **chosen**: real Teto, free, small amount of work |
| TALQu Teto model | yes (Japanese) | free/donationware software | no documented API | ❌ no clean integration |
| Synthesizer V / VOICEPEAK Teto | yes / sings | paid | proprietary | ❌ cost, closed |
| Online "Teto AI voice" generators | yes | free tiers | cloud APIs | ❌ unofficial voice clones; sends your text to a third party |
| Windows built-in voice (System.Speech) | yes, any text | free | yes | ✅ kept as the fallback ("Windows voice" in the tray) |

None of these are **open source**: UTAU, TALQu and the voicebanks are
free to *use*, not free software. The code that plays the voicebank (ours)
is open source; the voice itself stays under TWINDRILL's terms.

## The licence, in plain English

From the voicebank's own `使用許諾条件.txt` (terms) and readme:

- ✅ Free for anyone, for **non-commercial** use (including fan works).
- ✅ No need to credit or contact the author when publishing works.
- ✅ "The voice of Teto" includes **any audio generated** from the
  library, so generating speech-like audio locally is covered.
- ❌ **No redistribution** of the library, modified or not. That's why the
  voicebank is **never in this repo** and never bundled in the installer;
  each user downloads it from the official site. (Editing and sharing
  `oto.ini`/`.frq` files *is* allowed.)
- ❌ No illegal, hateful or obscene content; no claiming you made the voice.
- Commercial use needs a separate licence (via Crypton Future Media).

Voice library © 小山乃舞世 (2008). The scanner (`security_scan.py`)
fails if a `.wav`, `.frq` or `oto.ini` is ever tracked in git.

## Installing the voicebank

1. Download **"Standard voice: single syllables" (単独音)** from the
   official site: <https://kasaneteto.jp/utau/> (`TETO-tandoku-100619.zip`, ~11 MB).
2. Extract it anywhere under `%LOCALAPPDATA%\Teto\voices\`. The file names
   inside are **Shift-JIS**; extract with a tool that handles that, or run
   `python main.py voice`, which downloads and extracts it correctly after
   showing you the terms.
3. Restart the companion: the tray menu shows **Voice → Teto (N syllables)**.

Another folder? Set the environment variable `TETO_VOICEBANK`.

## What's inside a UTAU voicebank

```text
重音テト単独音/
  _あ.wav  _か.wav  _き.wav ...   one recorded syllable per file (44.1 kHz, 16-bit, mono)
  _あ.frq  ...                     pitch analysis (used by UTAU resamplers; we don't need it)
  oto.ini                          the timing table, one line per alias
```

An `oto.ini` line, e.g. `_か.wav=か,12,101,1475,31,0`:

| Field | Value | Meaning |
| --- | --- | --- |
| file | `_か.wav` | the recording |
| alias | `か` | the syllable's name |
| offset | 12 ms | skip the silence at the start |
| consonant | 101 ms | the fixed part (the "k" sound) that must never be stretched |
| cutoff | 1475 ms | positive = trim this much from the **end**; negative = length after the offset |
| preutterance | 31 ms | how early the note starts before the beat (singing only) |
| overlap | 0 ms | crossfade with the previous note (singing only) |

Aliases like `- か` and `* か` are UTAU variants for phrase starts and
other contexts; we only use plain ones.

## From reply text to audio

`csharp/Companion/Voice/TetoVoice.cs`:

```text
reply text ──► Commands.ForSpeech (drop code blocks, URLs, markdown)
           ──► words ──► kana?  yes: each kana is a syllable ("テト" → て, と; "きゃ" stays together)
                         │      no:  "Animalese" babble: 1–3 syllables per word, chosen by a
                         │           stable hash of the word (same word → same sound)
                         ▼
           syllable list (max 40 ≈ 6 s; punctuation → short pauses)
           ──► for each syllable: its clip (consonant + 125 ms of vowel, cut using oto.ini)
               ──► resample 0.94×–1.06× in a gentle wave (intonation)
               ──► crossfade 18 ms onto the output (no clicks)
           ──► 16-bit PCM ──► WAV header ──► SoundPlayer.Play() (async)
```

**Why a hash, and why FNV-1a?** Babble sounds better when "Teto" always
sounds like the same three syllables. .NET's `string.GetHashCode()` is
deliberately **randomized per process** (to resist hash-flooding
attacks), so it would change every run. FNV-1a is a tiny, stable hash.

## Digital audio basics used here

| Concept | In the code |
| --- | --- |
| **sample**: one amplitude measurement; 16-bit = −32768…32767 | `short[]` everywhere |
| **sample rate**: samples per second (44,100 Hz here) | `ms × rate / 1000` converts times to sample counts |
| **mono**: one channel | the parser rejects stereo |
| **WAV/RIFF**: chunks of `[id][size][data]`, little-endian | `Wav.Read` / `Wav.Write` |
| **resampling with linear interpolation**: read the input at a different speed, blending neighbours | `TetoVoice.Resample`; faster = higher pitch *and* shorter |
| **fade in/out, crossfade**: ramp volume to avoid clicks at cut points | `TetoVoice.Mix` |
| **clipping**: sums over 32767 must be clamped, not wrapped | `Math.Clamp` in `Mix` |

## Treating the voicebank as untrusted data

The voicebank is a file from the internet, so the code assumes it could be
hostile (see [SECURITY.md](SECURITY.md#remote-code-execution-rce-every-path-and-what-closes-it)):

- **WAV parser**: every chunk size is checked against the bytes actually
  present; anything but 16-bit mono PCM at 8–96 kHz is rejected; files over
  16 MB are refused. C# is memory-safe, so a bad file can at worst be
  rejected, not exploited.
- **Path traversal**: `oto.ini` names like `..\..\Windows\x.wav` or
  `C:\x.wav` are refused (`OtoIni.SafePath`).
- **Parsing**: numbers use `InvariantCulture` (a German PC would read
  "12.5" differently) and are bounded; bad lines are skipped.
- **Encoding**: `oto.ini` is Shift-JIS (code page 932), decoded
  explicitly, never guessed.

## Tests

`csharp/Companion.Tests/VoiceTests.cs`: WAV round trip, lying chunk sizes,
garbage and stereo input, `oto.ini` parsing, five path-traversal attempts,
Shift-JIS decoding, kana mapping, deterministic and bounded babble, audio
rendering, oto timings, and, *only where the real voicebank is installed*,
loading all its syllables and writing `%TEMP%\teto-voice-sample.wav` to listen to.

## Limits and ideas

- English is babble, not words: real English speech would need a speech
  synthesizer with a Teto model (TALQu/VOICEPEAK, Japanese only) or the
  English CVVC voicebank plus a phonemizer, which is a much bigger project.
- Pitch could follow punctuation (rise on "?").
- The `.frq` files would allow proper pitch-shifting without changing speed.

## References

### Official

- Kasane Teto official site, UTAU downloads: <https://kasaneteto.jp/utau/>
- Kasane Teto voice library terms: <https://kasaneteto.jp/guidelines/voice.html>
- Microsoft, `SoundPlayer`: <https://learn.microsoft.com/en-us/dotnet/api/system.media.soundplayer>
- Microsoft, `CodePagesEncodingProvider` (Shift-JIS in .NET): <https://learn.microsoft.com/en-us/dotnet/api/system.text.codepagesencodingprovider>
- Microsoft, `string.GetHashCode` (randomized per process): <https://learn.microsoft.com/en-us/dotnet/api/system.string.gethashcode>
- WAVE file format (RIFF), Library of Congress: <https://www.loc.gov/preservation/digital/formats/fdd/fdd000001.shtml>

### Other

- Wikipedia, Kasane Teto: <https://en.wikipedia.org/wiki/Kasane_Teto>
- Fowler–Noll–Vo hash: <https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function>

### Further learning

- Xiph.org, A Digital Media Primer for Geeks (video): <https://xiph.org/video/vid1.shtml>
- OpenUtau (open-source UTAU editor): <https://github.com/stakira/OpenUtau>
