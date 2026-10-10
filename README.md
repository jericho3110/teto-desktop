# Teto Desktop

> **🎈 Just for fun.** This is a personal side project made for fun and for
> learning how nine programming languages can work together. It is not a
> product, not affiliated with TWINDRILL (Kasane Teto's creators) or Anthropic
> (Claude), and comes with no warranty (see [LICENSE](LICENSE)).

A chibi desktop assistant who lives on your screen, has quirks and
animations, and does real work: behind her speech bubble is
[Claude Code](https://code.claude.com/docs/en/overview), running headless.
Every action she wants to take on your PC shows up in her bubble with
**Allow / Deny** buttons.

It's also a **polyglot learning project**: nine languages, each in its own
folder and doing the job it's best at, linked to each other with a
*different* technique every time (FFI, WebAssembly, pipes, HTTP,
Server-Sent Events, named pipes, Tauri IPC).

![expression sheet](docs/img/expressions.png)

## Repository layout: one folder per language

| Folder | Language | Component | Linked to the rest by |
| --- | --- | --- | --- |
| [`rust/`](rust/) | Rust | `shell/`: the transparent, always-on-top desktop window (Tauri); starts every helper | Tauri IPC ↔ TypeScript, **FFI** → C |
| [`c/`](c/) | C | `win32hooks/`: idle time, cursor, global hotkey, kill-helpers-on-exit | C ABI (static library linked into Rust) |
| [`typescript/`](typescript/) | TypeScript | `ui/`: animator, speech bubble, command bar, skin loader | HTTP + **SSE** → Go, **WebAssembly** → C++ |
| [`javascript/`](javascript/) | JavaScript | `quirks/`: personality plugins; `tools/ui_probe.mjs` | dynamic `import()` |
| [`cpp/`](cpp/) | C++ | `physics/`: spring-chain physics for the drills | compiled to **WebAssembly** |
| [`go/`](go/) | Go | `brain/`: drives Claude Code, permission prompts, wiring | **stdin/stdout JSON** ↔ Claude Code & Python |
| [`python/`](python/) | Python | `mood/`: reply → emotion; `skin_gen/`: the art; `tools/` | JSON lines over pipes |
| [`java/`](java/) | Java | `reminders/`: the reminder service | HTTP (form in, JSON out) |
| [`csharp/`](csharp/) | C# | `Companion/`: tray icon, notifications, voice | Windows **named pipe** |
| [`assets/`](assets/) | SVG | `skins/teto-chibi/`: the art + manifest (swappable) | data |
| [`docs/`](docs/) | – | workspace-level docs | – |

Each language folder has its own `README.md` (build/test commands),
`docs/CONCEPTS.md` (**every concept and principle used in that language,
with where and why**), and `CHANGELOG.md`.

## How it fits together

```text
 you ─► [TypeScript UI in the Rust/Tauri window] ◄── native events ── Rust ──FFI──► C (Win32)
             │  ▲                ▲
   HTTP POST │  │ SSE            └── WebAssembly ── C++ hair physics
             ▼  │
          [Go brain] ──stdin/stdout JSON──► claude -p (Claude Code)
             │  │  └──named pipe──► C# (tray, toasts, voice)
             │  └──HTTP──► Java (reminders)
             └──JSON lines──► Python (mood)
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Just want to use Teto?

1. Install [Claude Code](https://code.claude.com/docs/en/overview) and log in.
2. Download `Teto_<version>_x64-setup.exe` from this repo's **Releases** page and run it
   (per-user install, no admin rights; Windows SmartScreen may warn because the
   installer isn't code-signed).
3. Optional: the [.NET 10 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/10.0)
   for the tray icon and voice, and Python for moods.
4. Optional, her real voice: download the free official voicebank yourself (its
   licence forbids bundling it): see [docs/VOICE.md](docs/VOICE.md).

Windows 10/11 only for now; [docs/PACKAGING.md](docs/PACKAGING.md#cross-platform-what-would-it-take)
explains what a macOS/Linux port would take.

## Developing: one command for everything

```powershell
python main.py doctor     # which toolchains are installed (and how to get the missing ones)
python main.py build      # build every helper (Go, C++/wasm, Java, C#, UI)
python main.py run        # build, then start Teto
python main.py test       # every language's checks + links + security scan
python main.py voice      # download Teto's voicebank (shows the terms, asks first)
python main.py package    # build the Windows installer into dist/
```

Toolchains (once):

```powershell
winget install GoLang.Go LLVM.LLVM Microsoft.DotNet.SDK.10 EclipseAdoptium.Temurin.25.JDK
winget install Microsoft.VisualStudio.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
# plus: Rust (https://rustup.rs), Node 22.18+, Python 3.10+, Claude Code (logged in)
cargo install tauri-cli --version "^2" --locked
cargo install cargo-audit --locked
```

> **Smart App Control** (Windows 11) blocks Cargo's build scripts, so Rust
> can't build while it's on. Why: [docs/SMART_APP_CONTROL.md](docs/SMART_APP_CONTROL.md).
> Keep the repo out of OneDrive-synced build folders: the runner already
> puts Rust and packaging output in `%LOCALAPPDATA%\Teto`.

## Using her

Click Teto (or press **Ctrl+Alt+Space**) to open the command bar. **Right-click her** for
the menu (Talk, Hide, **Quit Teto**); her **tray icon** (her face, next to the clock)
shows/hides her on left-click and has **Quit Teto** on right-click. Drag her
anywhere (watch the drills swing). `/remind 10m stretch` sets a reminder.
Every action Claude wants to take shows up as an **Allow / Deny** card with
the full command. Claude works in `~/TetoWorkspace`. Right-click the tray
icon for **Voice → Teto / Windows voice / Off**. Helper logs:
`%LOCALAPPDATA%\Teto\logs`.

## Tests

| Folder | Command | Tests |
| --- | --- | --- |
| `go/brain` | `go vet ./... ; go test -count=1 ./...` | 11, incl. permission round trip with a fake Claude, 7 security regressions |
| `python/` | `python -m unittest discover -s python/mood` | 5 |
| `cpp/physics` | `npm run build ; npm test` | 14 on the real `.wasm`: hair physics + particle memory (pool, free list, zero-copy views) |
| `typescript/ui` | `npm run typecheck ; npm test` | 9, incl. skin sanitizer |
| `typescript/vscode` | `npm run build ; npm test` | 3, message validation ([Teto in VS Code](typescript/vscode/README.md)) |
| `java/reminders` | see [java/README.md](java/README.md) | 19 checks, incl. forged requests |
| `c/win32hooks` | see [c/README.md](c/README.md) | 12, incl. a 20,000-cycle leak check |
| `csharp/` | `dotnet test Teto.slnx` | 33: pipe, message parsing, voice (WAV/oto.ini parsing, path traversal, babble) |
| `rust/shell` | `cargo test` (set `CARGO_TARGET_DIR` first, see rust/README) | 6: FFI, RAII wrapper, supervisor layouts |
| `python/tools` | `python -m unittest discover -s python/tools` | 4: safe zip extraction (zip slip, Shift-JIS names) |
| security | `python main.py test security` | npm/NuGet/Go/Rust vulnerability scanners + RCE pattern sweep + invariants |
| live | `python python/tools/smoke_brain.py --token devtoken "Say hi"` | real Claude through a running brain |

## Docs

| Doc | For |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the whole system: why it's built this way, one prompt end to end |
| [docs/ANIMATION.md](docs/ANIMATION.md) | how she moves: eye tracking math, blinking, talking, smoothing, physics, particles |
| [docs/VOICE.md](docs/VOICE.md) | her voice: the voicebank, its licence, how text becomes audio |
| [docs/PACKAGING.md](docs/PACKAGING.md) | the runner, the installer, sidecars, jlink, cross-platform |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | every concept in one table, linked to where it's explained |
| [docs/LANGUAGES.md](docs/LANGUAGES.md) | each language's strengths and weaknesses, who covers for whom, TypeScript vs JavaScript |
| [docs/MEMORY.md](docs/MEMORY.md) | stack/heap, C/C++/Rust memory management applied, GC languages, other memory-safe languages |
| [docs/PARADIGMS.md](docs/PARADIGMS.md) | procedural, the four OOP pillars, functional, data-oriented, event-driven: where and why |
| [docs/MODULES_AND_LIBRARIES.md](docs/MODULES_AND_LIBRARIES.md) | modules, packages, headers, standard libraries, package managers in every language |
| [docs/FILE_TYPES.md](docs/FILE_TYPES.md) | every file type in the repo (`.json`, `.toml`, `.gitattributes`, `.slnx`, `.class`, …) |
| [docs/SECURITY.md](docs/SECURITY.md) | threat model, defenses, security review, safe use |
| [docs/SECURITY_SCANNING.md](docs/SECURITY_SCANNING.md) | the security scanner: every check, why it's dangerous (CWE), limits |
| [docs/SMART_APP_CONTROL.md](docs/SMART_APP_CONTROL.md) | why building Rust needs Windows Smart App Control off |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | every message between the parts |
| [docs/INTEROP.md](docs/INTEROP.md) | **how** the languages talk underneath: the C ABI, FFI ownership and callbacks, WebAssembly memory, pipes, HTTP, named pipes, framing, and when to pick each |
| [docs/LEARNING_PATH.md](docs/LEARNING_PATH.md) | a reading order through all nine languages, with exercises |
| [docs/LIBRARIES_AND_BUILTINS.md](docs/LIBRARIES_AND_BUILTINS.md) | every dependency and standard-library module, and why |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | layout, naming, commits |
| `<language>/docs/CONCEPTS.md` | the language deep-dives |
| [assets/skins/README.md](assets/skins/README.md) | the skin format, `manifest.json` field by field |
| [CHANGELOG.md](CHANGELOG.md) | workspace changes |

## Art & credits

Teto's look is an **original** chibi drawing in the style of Kasane Teto
(character © TWINDRILL), generated as SVG by
[python/skin_gen/gen_teto.py](python/skin_gen/gen_teto.py). This is a
non-commercial fan project. Skins are swappable: see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#skins).

## License

[MIT](LICENSE) for the code. The Kasane Teto character belongs to TWINDRILL;
the MIT license does not grant any rights to the character. See [NOTICE.md](NOTICE.md).

## References

- Claude Code, run programmatically: <https://code.claude.com/docs/en/headless>
- Tauri 2: <https://v2.tauri.app/>
- Keep a Changelog: <https://keepachangelog.com/en/1.1.0/>
