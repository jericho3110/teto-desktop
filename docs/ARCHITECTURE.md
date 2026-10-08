# Architecture

Why Teto is built the way she is. Each language folder has its own
`docs/ARCHITECTURE.md` or `docs/CONCEPTS.md` for the inside of its
component; this page is about how they fit together.

## Contents

1. [The big picture](#the-big-picture)
2. [Why one folder per language](#why-one-folder-per-language)
3. [Why each language does its job](#why-each-language-does-its-job)
4. [How the languages link](#how-the-languages-link)
5. [Startup and shutdown](#startup-and-shutdown)
6. [One prompt, end to end](#one-prompt-end-to-end)
7. [Permissions: the safety design](#permissions-the-safety-design)
8. [Skins](#skins)
9. [Patterns and principles used](#patterns-and-principles-used)
10. [Found live](#found-live)
11. [Trade-offs and known limits](#trade-offs-and-known-limits)
12. [References](#references)

## The big picture

**Architecture style:** a small **hub-and-spoke system of processes**. The
Rust shell owns the window and supervises the helpers; the Go brain is
the hub every message passes through; each helper speaks one small
protocol. Inside each component the code is lightly *layered*
(transport → logic), and the logic is kept free of I/O so it can be
tested: a **functional core with an imperative shell** (`face.ts`,
`ParseRemind`, `analyze()`, `ReminderStore`, `Commands.Parse`).

```text
┌──────────────────────── rust/shell (Tauri window) ────────────────────────┐
│  typescript/ui                                                            │
│    main.ts ─► Animator ─► Skin (assets/skins SVG, sanitized)              │
│      │           └─► HairPhysics ─► cpp/physics (WebAssembly)             │
│      │  ◄── native://cursor, idle, hotkey ── Rust ──FFI──► c/win32hooks   │
│      │  ◄── get_config (token) ──────────── Rust (supervisor starts ↓)    │
└──────┼────────────────────────────────────────────────────────────────────┘
       │ POST /prompt, /permission   ▲ SSE /events
       ▼                             │
┌──────────── go/brain ─────────────────┐
│  Server ─► Claude ─► claude -p (child) │  ← Claude Code, headless
│    ├─► MoodEngine ─► python/mood       │  ← child process, JSON lines
│    ├─► Companion  ─► csharp/Companion  │  ← named pipe
│    └─► Reminders  ─► java/reminders    │  ← HTTP + token
└────────────────────────────────────────┘
```

| Style | What it would look like | Why not (for now) |
| --- | --- | --- |
| **Monolith** in one language | e.g. all Electron/TypeScript | simplest, but the point is learning how languages link |
| **Microservices** | each part a networked service with its own deployment | overkill: one user, one machine |
| **Hub + child processes** (chosen) | parts talk over tiny protocols; brain degrades gracefully | each part builds, tests and restarts alone |

## Why one folder per language

The repo is **packaged by language** at the top level (`go/`, `rust/`, …)
and by component inside (`go/brain`, `python/mood`). That makes it obvious
which language does what, and each folder has its own toolchain files
(`go.mod`, `Cargo.toml`, `package.json`, `.csproj`), README and concepts
guide.

The usual alternative is **packaging by component** (`brain/`, `ui/`,
`shell/`), which keeps a feature's code together when one feature spans
languages. Here every component is a single language, so the two layouts
group the same files; language-first is better for learning.
Cross-language contracts live in [PROTOCOL.md](PROTOCOL.md) and
`assets/skins/*/manifest.json`, not in any one language's folder.

## Why each language does its job

| Part | Language | Why this language |
| --- | --- | --- |
| Window shell + supervisor | **Rust** (Tauri) | small native window using the OS webview (~10 MB vs Electron's ~150 MB), memory safety, first-class C FFI |
| Win32 hooks | **C** | the Windows API *is* a C API; C's ABI is what every language can call |
| UI | **TypeScript** | runs in the webview; the `BrainEvent` union types the protocol |
| Quirks | **JavaScript** | loaded at runtime with `import()`: no build step |
| Hair physics | **C++** → WebAssembly | numeric hot loop; templates at zero cost; near-native speed in the browser |
| Brain | **Go** | processes, pipes, timeouts, concurrent connections: goroutines + channels; one static `.exe` |
| Mood, art, tools | **Python** | text processing and scripting; the place to plug in ML later |
| Reminders | **Java** | long-running service with a built-in HTTP server and virtual threads |
| Tray, toasts, voice | **C#** | .NET has direct access to the Windows tray, notifications and speech |

## How the languages link

Every link uses a different technique, on purpose:

| Link | Technique | Format | Where |
| --- | --- | --- | --- |
| TS → Rust | Tauri **command** (`invoke("get_config")`) | JSON (serde) | `typescript/ui/src/main.ts`, `rust/shell/src/lib.rs` |
| Rust → TS | Tauri **events** (`native://cursor`, …) | JSON (serde) | `lib.rs: spawn_native_pollers` |
| Rust → C | **FFI** over the C ABI, static library built by `build.rs` | C types, callback + `void*` | `rust/shell/src/native.rs`, `c/win32hooks` |
| Rust → Go/Java/C# | child processes + environment variable | `TETO_TOKEN` | `rust/shell/src/supervisor.rs` |
| TS → Go | HTTP `POST` with a bearer token | JSON | `brain.ts`, `go/brain/server.go` |
| Go → TS | **Server-Sent Events** | `data: <json>\n\n` | `server.go: events`, `brain.ts` |
| Go ↔ Claude Code | child process, stdin/stdout | `stream-json` lines | `go/brain/claude.go` |
| Go ↔ Python | child process, stdin/stdout | JSON lines | `services.go`, `python/mood/mood.py` |
| Go → Java | HTTP + bearer token | form in, JSON out | `services.go`, `java/reminders` |
| Go → C# | Windows **named pipe** | one JSON line per connection | `services.go`, `csharp/Companion/PipeListener.cs` |
| TS → C++ | **WebAssembly** exports | numbers only | `typescript/ui/src/physics.ts`, `cpp/physics/src/exports.cpp` |
| TS → JS | dynamic `import()` + an API object | function calls | `typescript/ui/src/quirks.ts` |

**Why SSE and not WebSocket?** Go's standard library has no WebSocket, and
the traffic is lopsided: replies *stream* to the UI, while commands are
short POSTs. `EventSource` reconnects by itself. Cost: the token rides in
the query string for `/events` only.

**Why form-encoded to Java?** The JDK can write JSON easily but has no JSON
parser; it *can* decode forms. Each side uses what the other finds easy.

## Voice and packaging

- **Voice:** the C# companion renders Teto's real UTAU voicebank (downloaded by the user, never bundled) into babble audio; see [VOICE.md](VOICE.md).
- **Packaging:** `python main.py package` builds every language into one NSIS installer with sidecars, resources and a jlink Java runtime; see [PACKAGING.md](PACKAGING.md).

## Startup and shutdown

1. `cargo tauri dev` starts Vite (the UI) and the Rust shell.
2. Rust calls `teto_kill_children_on_exit()` (C): the process joins a
   **job object**, so every helper started later dies with it, even on a crash.
3. Rust makes a 256-bit token (`getrandom`) and starts the brain, Java
   reminders and C# companion with `TETO_TOKEN` in their environment
   (`supervisor.rs`). Missing helpers are skipped.
4. The brain starts Python (mood) itself, and Claude Code on the first prompt.
5. The UI asks Rust for `{brainUrl, token}`, loads the skin and physics,
   connects to `/events`, loads quirks.
6. Rust polls the C module: cursor (~30 Hz, only when moved) and idle time
   (every 2 s); the C hotkey thread fires `native://hotkey`.
7. On exit: Rust stops the hotkey (joins its thread), kills the helpers;
   the job object catches anything left.

## One prompt, end to end

You type "run the tests" and press Enter:

1. `commandbar.ts` → `Brain.prompt()` → `POST /prompt` with `Authorization: Bearer <token>`.
2. `server.go`: Host check → CORS → token (constant time) → `Claude.Prompt()`.
3. `claude.go` starts `claude -p ... --permission-mode manual ...` if needed
   (one long-lived process = conversation memory), publishes
   `status: thinking`, writes the user message to stdin.
4. UI: "…" bubble, ahoge wiggle, eyes up.
5. Claude streams `stream_event` → `text_delta` events → bubble fills, mouth flaps.
6. Claude wants `Bash: npm test` → `control_request can_use_tool` → brain
   publishes `permission_request` with the **full** input → Allow/Deny card.
7. You click Allow → `POST /permission` → a channel wakes the waiting
   goroutine → `control_response {"behavior":"allow"}`.
8. `result` → `reply_done`; Python returns a mood; C# speaks the reply.
9. Happy ^^ face; the drills bounce (an impulse into the physics).

## Permissions: the safety design

Summary (full threat model in [SECURITY.md](SECURITY.md)):

- Manual permission mode; every approval goes to your bubble, with the
  complete command shown. **No answer = deny.**
- Tools that would act without asking are disabled; Claude works in a
  dedicated `~/TetoWorkspace`.
- Every localhost service needs the token and a localhost `Host` header.
- Model text is never HTML; the CSP blocks foreign scripts; skins are sanitized.

## Skins

A skin is a folder in `assets/skins/` with `manifest.json` + one SVG. The
manifest maps roles to element ids, so the animator never hard-codes art:

| Manifest key | Meaning |
| --- | --- |
| `parts.head/armL/armR/ahoge` | element id + rotation pivot |
| `eyes.groups`, `eyes.states` | each eye group has `.eyes-<state>` children; one is shown |
| `eyes.look`, `lookRange` | the iris group that follows the cursor, and how far (px) |
| `mouth.group`, `mouth.states` | `.mouth-<state>` children |
| `chains[]` | `prefix-0 … prefix-(n-1)`: **nested** `<g>`s, so rotating joint 2 carries 3..n |
| `physics` | stiffness, damping, falloff, gravity |
| `expressions` | per face: eyes, mouth, blush, effects, head tilt, ahoge angle, … |

To make a skin: copy `assets/skins/teto-chibi`, redraw the SVG keeping the
ids, and change `skin` in `rust/shell/src/lib.rs`. Unsafe SVG markup is
stripped on load.

## Patterns and principles used

| Principle / pattern | Where (examples) |
| --- | --- |
| **Single responsibility** | one job per module: `skin.ts`, `face.ts`, `hub.go`, `supervisor.rs`, `PipeListener.cs` |
| **Publish/subscribe** | `go/brain/hub.go` |
| **Dependency injection** | `Server.Now`, `Claude.Bin` (fake Claude in tests), quirk API object |
| **Functional core, imperative shell** | `face.ts`, `analyze()`, `ReminderStore`, `Commands.Parse` |
| **Composition root** | `main.go`, `main.ts`, `lib.rs: run` |
| **Plugin architecture** | quirks, skins |
| **Graceful degradation** | missing helpers, physics or quirks never stop Teto |
| **Fail closed / least privilege / defense in depth** | see SECURITY.md |
| **Back-pressure by dropping** | `Hub.Publish` never blocks |
| **Test doubles** | fake Claude (`TestMain`), fake DOM (`sanitize.test.ts`) |
| **Atomic write** | `ReminderStore.save` |
| **RAII / deterministic cleanup** | Rust drop order, C# `IDisposable`, Go `defer`, Java try-with-resources |

## Found live

Things learned by running against real systems, each pinned by code or a test:

| Surprise | Fix | Pinned by |
| --- | --- | --- |
| `claude -p` ran `echo hi` **without asking**: the default mode can be `auto` | `--permission-mode manual` | `TestClaudeArgsKeepSafetyFlags`; live Deny test |
| A running child **locks its working folder** on Windows | `Claude.Close()`, LIFO `t.Cleanup` | `TestPermissionRoundTrip` |
| Python crashed printing `✨` (`cp1252` console) | `sys.stdout.reconfigure(encoding="utf-8")` | `python/tools/*.py` |
| Headless Edge viewport 496 px instead of 360; `--virtual-time-budget` hangs | DevTools `setDeviceMetricsOverride`, real time | `javascript/tools/ui_probe.mjs` |
| `node --test test/` treated the folder as a file | glob pattern | `cpp/physics/package.json` |
| Fresh clone: `wasm-ld` couldn't create `dist/physics.wasm` | `prebuild` creates `dist/` | `cpp/physics/package.json` |
| Node can't strip TS **parameter properties** | explicit fields in Node-run files | `sanitize.test.ts` |
| A freshly built `.exe` gave "Permission denied" from Git Bash for a moment (antivirus scan) | launch via PowerShell / retry | – |
| **Smart App Control** blocks Cargo build scripts | turn it off to build Rust (re-enable later) | SECURITY.md |
| Windows reserves **F12** for debuggers (`RegisterHotKey` docs) | tests use F9 | C and Rust hotkey tests |
| Windows Forms test project must target `net10.0-windows` too | changed TFM | `Teto.Companion.Tests.csproj` |

## Trade-offs and known limits

- **One prompt at a time** (409 while busy).
- **No automatic restart** of crashed helpers yet; the supervisor is where it would go.
- **Mood is a keyword lexicon**: instant and explainable, misses sarcasm.
- **Physics is game-feel**, not rigid-body dynamics ([cpp/docs/ARCHITECTURE.md](../cpp/docs/ARCHITECTURE.md)).
- **Development layout**: the shell finds helpers relative to the repo;
  a packaged release would bundle them as Tauri sidecars.
- **Windows only**: the C module, job objects and named pipes are Win32.

## References

### Patterns

- Martin Fowler, *Microservices*: <https://martinfowler.com/articles/microservices.html>
- Alistair Cockburn, *Hexagonal architecture*: <https://alistair.cockburn.us/hexagonal-architecture/>
- Gary Bernhardt, *Functional core, imperative shell*: <https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell>
- Simon Brown, *Package by component and architecturally-aligned testing*: <https://www.codingthearchitecture.com/2015/03/08/package_by_component_and_architecturally_aligned_testing.html>

### Links between languages

- HTML Standard, Server-sent events ✔: <https://html.spec.whatwg.org/multipage/server-sent-events.html>
- Claude Code, run programmatically ✔: <https://code.claude.com/docs/en/headless>
- Tauri, calling Rust from the frontend: <https://v2.tauri.app/develop/calling-rust/>
- The Rustonomicon, FFI: <https://doc.rust-lang.org/nomicon/ffi.html>
- Microsoft, named pipes: <https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipes>
- MDN, WebAssembly: <https://developer.mozilla.org/en-US/docs/WebAssembly>
- Microsoft, job objects: <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>

### Further learning

- The Architecture of Open Source Applications (free books): <https://aosabook.org/en/>
- Martin Fowler, Software Architecture Guide: <https://martinfowler.com/architecture/>
