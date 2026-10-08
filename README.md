# Teto Desktop

A chibi desktop assistant who lives on your screen, has quirks and
animations, and does real work: behind her speech bubble is
[Claude Code](https://code.claude.com/docs/en/overview), running headless.

It's also a **polyglot learning project**: each part is written in the
language that suits it, and every pair of parts is linked with a
*different* technique (FFI, WebAssembly, pipes, HTTP, Server-Sent Events,
named pipes), so you can see how real systems glue languages together.

![expression sheet](docs/img/expressions.png)

## Status (milestone 1 "thin slice", in progress)

| Part | Language | State |
| --- | --- | --- |
| Brain daemon: drives Claude Code, permission prompts | **Go** | ✅ done, tested (unit + live) |
| Mood engine: reply → emotion | **Python** | ✅ done, tested |
| Hair physics for the drills | **C++ → WebAssembly** | ✅ done, tested |
| UI: animator, bubble, command bar | **TypeScript** | ✅ done, tested in a browser |
| Quirks (personality scripts) | **JavaScript** | ✅ done |
| Skin generator (the art) | **Python** | ✅ done |
| Desktop window: transparent, always on top, click-through | **Rust** (Tauri) | 🚧 waiting for the MSVC linker |
| Win32 hooks: idle time, cursor, global hotkey, kill-children job | **C** | 🚧 waiting for the C compiler |
| Reminder service | **Java** | 🚧 written, waiting for the JDK |
| Tray icon, notifications, voice | **C#** | 🚧 waiting for the .NET SDK |

## How it fits together

```
 you ──type──► [TypeScript UI in a Tauri window]  ◄── native events ── [Rust] ──FFI──► [C: Win32]
                    │ ▲            ▲
        HTTP POST   │ │ SSE        └── WebAssembly ── [C++ hair physics]
                    ▼ │
               [Go brain] ──stdin/stdout JSON──► claude -p (Claude Code)
                 │   │   └──named pipe──► [C#: tray, toasts, voice]
                 │   └──HTTP form/JSON──► [Java: reminders]
                 └──stdin/stdout JSON lines──► [Python: mood]
```

Full explanation: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

You need: Go 1.22+, Python 3.10+, Node 22.18+ (type stripping), LLVM/clang
(for the wasm build), and Claude Code logged in. Rust + MSVC Build Tools,
a JDK 21+ and .NET 8+ are needed for the parts still in progress.

```powershell
winget install GoLang.Go LLVM.LLVM          # what this milestone needs so far
cd physics; npm run build; cd ..            # C++ → physics/dist/physics.wasm
cd brain;   go build -o bin/teto-brain.exe .; cd ..
cd app;     npm install; cd ..
```

| Command | What it does |
| --- | --- |
| `npm run build` (in `physics/`) | `clang++ --target=wasm32 -nostdlib ...`: compiles freestanding C++ to a ~1.4 KB `.wasm` (flags explained in [docs/PHYSICS.md](docs/PHYSICS.md)) |
| `go build -o bin/teto-brain.exe .` | compiles the brain into one self-contained `.exe` |
| `npm install` | downloads Vite, TypeScript and the Tauri JS API into `app/node_modules` |

## Running (until the Rust shell lands)

```powershell
# 1. the brain (TETO_TOKEN is the shared secret; the Rust shell will generate it)
$env:TETO_TOKEN = "devtoken"
.\brain\bin\teto-brain.exe -workdir C:\some\folder -mood mood\mood.py -speak=false

# 2. the UI, in your browser
cd app; npm run dev        # then open http://localhost:1420/?token=devtoken
```

| Brain flag | Meaning |
| --- | --- |
| `-workdir` | the folder Claude Code works in (its "project") |
| `-mood` | path to `mood/mood.py`; empty disables the mood engine |
| `-model` | model override, e.g. `claude-haiku-4-5-20251001` for cheap testing |
| `-speak=false` | don't send replies to the (not yet built) C# voice |
| `-addr` | listen address, default `127.0.0.1:47800`. Keep it on localhost |

Type in the bar (click Teto to open it). `/remind 10m stretch` and
`/remind 17:30 call mom` set reminders (once the Java service runs).

## Tests

| Part | Command | What it covers |
| --- | --- | --- |
| Go brain | `cd brain; go vet ./...; go test ./...` | token check, the full permission round trip against a **fake Claude** (allow + deny), `/remind` parsing |
| Python mood | `python -m unittest discover -s mood` | emotions, negation, the JSON-lines protocol as a real child process |
| C++ physics | `cd physics; npm run build; npm test` | loads the real `.wasm` in Node: rest, swing direction, settling, clamping |
| TS animator | `cd app; npm run typecheck; npm test` | face priority, blinking, mouth flaps, frame-rate-independent smoothing |
| Live, real Claude | `python tools/smoke_brain.py --token devtoken "Say hi"` | one real prompt through the running brain (add `--allow` to approve tools) |
| Live UI | `node tools/ui_probe.mjs "http://localhost:1420/?token=devtoken" out.png` | headless Edge: console errors + screenshot |

## Layout

```
brain/       Go     brain daemon (HTTP+SSE server, Claude Code driver, service clients)
mood/        Python mood engine (stdin/stdout JSON lines)
physics/     C++    spring-chain hair physics → WebAssembly
app/         TS     UI (src/) + Tauri/Rust shell (src-tauri/, in progress)
quirks/      JS     personality scripts, loaded at runtime
skins/       SVG    teto-chibi/: manifest.json + teto.svg (swappable)
reminders/   Java   reminder service (in progress)
tools/              skin generator, live smoke test, UI probe
docs/               everything explained
```

## Docs

| Doc | Read it for |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | why it's built this way, how a prompt flows end to end, trade-offs |
| [PROTOCOL.md](docs/PROTOCOL.md) | every message between UI, brain, Claude Code and the services |
| [PHYSICS.md](docs/PHYSICS.md) | the hair simulation and freestanding WebAssembly |
| [LEARNING_PATH.md](docs/LEARNING_PATH.md) | a reading order through the code, with exercises |
| [CONVENTIONS.md](docs/CONVENTIONS.md) | naming, layout, commits |
| [LIBRARIES_AND_BUILTINS.md](docs/LIBRARIES_AND_BUILTINS.md) | every library/stdlib module/language feature used, and why |
| [CHANGELOG.md](CHANGELOG.md) | what changed per version |

## Art & credits

Teto's look is an **original** chibi drawing in the style of Kasane Teto
(character © TWINDRILL), generated as SVG by
[tools/skin_gen/gen_teto.py](tools/skin_gen/gen_teto.py). Personal,
non-commercial fan project. Skins are swappable: see the manifest format
in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#skins).

## References

- Claude Code headless / `-p` mode: https://code.claude.com/docs/en/headless ✔
- Tauri 2: https://v2.tauri.app/
- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
