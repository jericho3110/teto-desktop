# Libraries, built-ins and language features

Every external library and standard-library module the code uses:
**where**, **what for**, **why**, and the alternatives. Rule of thumb:
standard library first; every external dependency has to justify
itself. Language *features* (goroutines, records, templates, …) are
explained in each `<language>/docs/CONCEPTS.md`; this page is the
inventory. Keep it in sync when imports change ([How to check](#how-to-check-this-list)).

## Contents

1. [External dependencies (all of them)](#external-dependencies-all-of-them)
2. [Go standard library](#go-standard-library)
3. [Python standard library](#python-standard-library)
4. [TypeScript / browser / Node APIs](#typescript--browser--node-apis)
5. [C++ (freestanding)](#c-freestanding)
6. [C and the Windows API](#c-and-the-windows-api)
7. [Rust standard library](#rust-standard-library)
8. [Java standard library (JDK)](#java-standard-library-jdk)
9. [C# / .NET](#c--net)
10. [How to check this list](#how-to-check-this-list)
11. [References](#references)

## External dependencies (all of them)

| Package | Language | Where | Why | Alternatives considered |
| --- | --- | --- | --- | --- |
| `@tauri-apps/api` | TS | `typescript/ui/src/main.ts` | the JS side of Tauri: `invoke`, `listen`, window control | none: it's how a Tauri webview talks to Rust |
| `vite` (dev) | TS | `typescript/ui` | dev server with instant reload; production bundling | esbuild alone (no dev server), webpack (slower, more config) |
| `typescript` (dev) | TS | `typescript/ui` | the type checker | plain JS: no typed protocol |
| `@types/node` (dev) | TS | `typescript/ui`, `typescript/vscode` | types for `node:test` in tests | – |
| `@types/vscode` (dev) | TS | `typescript/vscode` | type definitions for the VS Code extension API (types only; VS Code supplies the real `vscode` module at run time) | none: writing an extension in TS needs it; pinned to the minimum engine (1.95) |
| `vite`, `typescript` (dev) | TS | `typescript/vscode` | bundle the webview (reusing `ui/src`) and type-check both sides | `vsce` for packaging: replaced by `scripts/pack_vsix.py` (stdlib `zipfile`) |
| `tauri` | Rust | `rust/shell` | native window with the OS webview, IPC, permissions | Electron (bundles Chromium, ~150 MB), raw WebView2 + `windows` crate (lots of COM code) |
| `tauri-build` (build) | Rust | `rust/shell/build.rs` | generates code from `tauri.conf.json` + capabilities | – (required by Tauri) |
| `serde` + `serde_json` | Rust | `lib.rs` | `#[derive(Serialize)]` turns structs into JSON for the UI | hand-written JSON (error-prone) |
| `getrandom` | Rust | `supervisor.rs` | OS random bytes for the token (`std` has no RNG) | `rand` (bigger; we only need bytes); calling `BCryptGenRandom` via FFI ourselves |
| `cc` (build) | Rust | `build.rs` | compiles `c/win32hooks` with MSVC and links it | a prebuilt `.lib` + manual linker flags (fragile) |
| `System.Speech` | C# | `csharp/Companion/TrayApp.cs` | Windows' built-in SAPI voices | `Windows.Media.SpeechSynthesis` (WinRT, nicer voices, needs a Windows-specific TFM and audio plumbing) |
| `xunit`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk` (test) | C# | `csharp/Companion.Tests` | the test framework + runner for `dotnet test` | MSTest, NUnit (equivalent) |

**Go, Python, C, C++ and Java use zero third-party packages.** Tauri pulls
in many transitive crates; that is the price of a cross-platform webview shell.

## Go standard library

| Package | Where (`go/brain/`) | What for |
| --- | --- | --- |
| `net/http` | `server.go`, `services.go` | server (method-aware routes), SSE, client for Java |
| `net/http/httptest` | `brain_test.go` | real test servers on random ports |
| `net/url` | `services.go` | form encoding |
| `os/exec` | `claude.go`, `services.go` | child processes with pipes |
| `bufio` | `claude.go`, `services.go`, tests | line scanning (with a 32 MB max line) |
| `bytes` | `claude.go` | `json.Indent` target buffer |
| `encoding/json`, `encoding/hex` | everywhere | JSON; ids as hex |
| `sync` | `hub.go`, `claude.go`, `services.go` | `Mutex` |
| `crypto/rand` | `claude.go: newID` | unpredictable ids/tokens (never `math/rand`) |
| `crypto/subtle` | `server.go` | constant-time token compare |
| `regexp`, `strconv`, `strings`, `fmt`, `errors` | various | parsing and formatting |
| `time` | various | timeouts, polling, injectable clock |
| `flag`, `os`, `io`, `log`, `path/filepath` | `main.go` and others | flags, env vars, pipes, logs, paths |
| `testing` | `brain_test.go` | tests |

## Python standard library

| Module | Where (`python/`) | What for |
| --- | --- | --- |
| `json`, `re`, `sys` | `mood/mood.py`, tools | protocol, word splitting, stdio |
| `subprocess`, `unittest` | `mood/test_mood.py`, `tools/check_all.py` | run children; tests |
| `pathlib` | generator, tools | paths relative to `__file__` |
| `argparse`, `threading`, `urllib.request` | `tools/smoke_brain.py` | CLI, background SSE reader, HTTP |
| `concurrent.futures`, `urllib.error` | `tools/check_links.py` | parallel link checks |
| `os`, `shutil`, `time` | `tools/check_all.py` | env/PATH, `which`, timing |
| `runpy` | `main.py` | run `runner.py` as `__main__` |
| `argparse` (sub-commands), `tempfile`, `urllib.request`, `zipfile`, `json` | `tools/runner.py` | the runner: commands, downloads, safe zip extraction, generated config |
| `winreg` | `tools/runner.py: smart_app_control` | read a Windows registry value (Windows-only module) |
| `re`, `json`, `subprocess` | `tools/security_scan.py` | pattern sweep, scanner output parsing |
| `__future__` | several | postponed annotations |

## TypeScript / browser / Node APIs

| API | Where | What for |
| --- | --- | --- |
| `fetch`, `EventSource` | `typescript/ui/src/brain.ts` | HTTP + SSE to the brain |
| `DOMParser`, `importNode`, `CSS.escape`, `elementFromPoint` | `skin.ts`, `main.ts` | SVG loading, hit testing |
| `requestAnimationFrame` | `animator.ts` | frame loop |
| `WebAssembly.instantiateStreaming` | `physics.ts` | load the C++ module |
| dynamic `import()` | `quirks.ts` | load quirks at runtime |
| `node:test`, `node:assert/strict` | `*.test.ts`, `cpp/physics/test` | Node's built-in test runner |
| `node:fs`, `node:path`, `node:url`, `node:child_process`, `node:os` | `scripts/sync-assets.ts`, `javascript/tools/ui_probe.mjs` | files, paths, launching Edge |
| global `WebSocket`, `fetch` (Node 22+) | `ui_probe.mjs` | DevTools Protocol |

## C++ (freestanding)

No standard library at all (`-nostdlib`): `cpp/physics` uses only the
core language and one clang attribute (`export_name`). See
[cpp/docs/CONCEPTS.md](../cpp/docs/CONCEPTS.md#11-freestanding-c-no-standard-library).

## C and the Windows API

| Header / library | Where | What for |
| --- | --- | --- |
| `<stdint.h>` | `teto_win32.h` | exact-width integers at the ABI boundary |
| `<windows.h>` (`user32.lib`, `kernel32`) | `teto_win32.c` | `GetLastInputInfo`, `GetCursorPos`, `RegisterHotKey`, message loop, threads, events, critical sections, job objects |
| `<stdlib.h>` | `teto_win32.c` | `malloc`, `calloc`, `free` |
| `<wchar.h>` | `teto_win32.c` | `wcslen`, `wcsrchr` on UTF-16 strings |
| `<psapi.h>` | tests | `GetProcessMemoryInfo` for the leak check |
| `<stdio.h>`, `<string.h>` | tests | `printf`, `strcmp`, `strlen` |

## Rust standard library

| Module | Where (`rust/shell/src`) | What for |
| --- | --- | --- |
| `std::ffi::{c_void, c_char, CStr}` | `native.rs` | C's `void*`, `char`, and borrowed C strings |
| `std::ptr::NonNull` | `native.rs` | a never-null raw pointer for the C snapshot |
| `std::sync::Mutex` | `native.rs`, `lib.rs` | the hotkey closure slot; shared `Services` |
| `std::process::{Command, Child, Stdio}` | `supervisor.rs` | start helpers |
| `std::os::windows::process::CommandExt` | `supervisor.rs` | `CREATE_NO_WINDOW` flag |
| `std::fs`, `std::path` | `supervisor.rs` | log files, paths |
| `std::thread`, `std::time` | `lib.rs` | the native poller thread |
| `std::panic::catch_unwind` | `native.rs` | never unwind across the C boundary |

## Java standard library (JDK)

| Package / class | Where (`java/reminders`) | What for |
| --- | --- | --- |
| `com.sun.net.httpserver` | `ReminderServer` | the built-in HTTP server |
| `java.net.http.HttpClient` | tests | real HTTP requests |
| `java.nio.file.*` | `ReminderStore`, tests | files, atomic move, temp dirs |
| `java.util.concurrent.Executors` | `ReminderServer` | virtual-thread executor |
| `java.security.MessageDigest.isEqual` | `ReminderServer` | constant-time token compare |
| `java.net.URLDecoder`, `InetAddress`, `InetSocketAddress`, `URI` | server, tests | form decoding, loopback binding |
| `java.util.*` (`ArrayList`, `HashMap`, `List`, `Map`, `UUID`, `Comparator`) | both | collections, ids, sorting |
| `java.nio.charset.StandardCharsets.UTF_8` | all | explicit encoding |

## C# / .NET

| Namespace | Where (`csharp/Companion`) | What for |
| --- | --- | --- |
| `System.IO.Pipes` | `PipeListener.cs`, tests | named-pipe server/client |
| `System.Text.Json` | `Commands.cs` | defensive JSON parsing |
| `System.Text.RegularExpressions` | `Commands.cs` | source-generated regexes |
| `System.Speech.Synthesis` (package) | `TrayApp.cs` | Windows voice |
| `System.Media.SoundPlayer` | `TrayApp.cs` | play Teto's rendered WAV |
| `System.Buffers.Binary.BinaryPrimitives` | `Voice/Wav.cs` | little-endian reads/writes for WAV |
| `System.Text.CodePagesEncodingProvider` | `Voice/OtoIni.cs` | Shift-JIS (code page 932) |
| `System.Globalization.CultureInfo` | `Voice/OtoIni.cs` | culture-independent number parsing |
| `System.Windows.Forms` (implicit) | `TrayApp.cs`, `Program.cs` | `NotifyIcon`, menus, message loop |
| `System.Threading` (implicit) | all | `Mutex`, `SynchronizationContext`, `CancellationToken`, `Task` |

## How to check this list

```bash
grep -hE '^\s*"[a-z/]*"$' go/brain/*.go | sort -u
grep -hE '^(import|from) ' python/*/*.py | sort -u
grep -hoE 'from "[^"]+"' typescript/ui/src/*.ts typescript/ui/scripts/*.ts javascript/tools/*.mjs cpp/physics/test/*.mjs | sort -u
grep -hoE '^use [a-z_:]+' rust/shell/src/*.rs | sort -u
grep -h '^import' java/reminders/*/teto/reminders/*.java | sort -u
grep -h '^using' csharp/*/*.cs | sort -u
grep -h '^#include' c/win32hooks/*/*.c | sort -u
```

## References

### Official

- Tauri: <https://v2.tauri.app/>
- serde: <https://serde.rs/>
- `getrandom` crate: <https://docs.rs/getrandom/>
- `cc` crate: <https://docs.rs/cc/>
- Vite: <https://vite.dev/guide/>
- Go standard library: <https://pkg.go.dev/std>
- Python standard library: <https://docs.python.org/3/library/>
- Rust standard library: <https://doc.rust-lang.org/std/>
- Java SE 25 API: <https://docs.oracle.com/en/java/javase/25/docs/api/>
- .NET API browser: <https://learn.microsoft.com/en-us/dotnet/api/>
- Windows API index: <https://learn.microsoft.com/en-us/windows/win32/apiindex/windows-api-list>
- Node.js API: <https://nodejs.org/api/>

### Other

- Russ Cox, *Our Software Dependency Problem*: <https://research.swtch.com/deps>
