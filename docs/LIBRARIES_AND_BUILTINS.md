# Libraries, built-ins and language features

Every library, standard-library module and notable language feature the
code uses: **where**, **what for**, **why**, and the alternatives.
Rule of thumb: standard library first; every external dependency has to
justify itself. Keep this in sync when imports change
(`grep` the imports, as in the "How to check" section at the end).

## Contents

1. [External dependencies](#external-dependencies)
2. [Go standard library](#go-standard-library)
3. [Go language features](#go-language-features)
4. [Python](#python)
5. [TypeScript / JavaScript](#typescript--javascript)
6. [C++ (freestanding)](#c-freestanding)
7. [How to check this list](#how-to-check-this-list)
8. [References](#references)

## External dependencies

The whole project has **four** external packages (all in the UI):

| Package | Where | Why | Alternatives considered |
| --- | --- | --- | --- |
| `@tauri-apps/api` | `app/src/main.ts` | the JS side of Tauri: `invoke` Rust commands, `listen` to events, control the window (`setIgnoreCursorEvents`, `startDragging`) | none: it's how a Tauri webview talks to Rust |
| `@tauri-apps/cli` (dev) | `app/` | `npm run tauri dev/build` | – |
| `vite` (dev) | `app/` | dev server with instant reload; bundles TS for release | esbuild directly (no dev server), webpack (slower, more config) |
| `typescript` (dev) | `app/` | type checker (`tsc`, with `noEmit`: Vite does the compiling) | plain JS: we'd lose the typed `BrainEvent` union |
| `@types/node` (dev) | `app/` | types for `node:test` in the TS tests | – |

Go, Python, C++ and the quirks use **zero** third-party packages.

## Go standard library

| Package | Where | What for | Why / alternatives |
| --- | --- | --- | --- |
| `net/http` | `server.go`, `services.go` | the HTTP server (routes like `"POST /prompt"`), SSE, and the HTTP client for Java | Go's server is production grade; frameworks (gin, chi) add little here |
| `net/http/httptest` | `brain_test.go` | a real server on a random port for tests | – |
| `net/url` | `services.go` | `url.Values` → form encoding for Java | – |
| `os/exec` | `claude.go`, `services.go` | start `claude` and `python` with pipes | – |
| `bufio` | `claude.go`, `services.go` | `Scanner` reads stdout line by line; `sc.Buffer` raises the 64 KB line limit to 32 MB (tool results can be big) | – |
| `encoding/json` | everywhere | `Marshal`/`Unmarshal`; struct tags like `` `json:"request_id"` ``; `json.RawMessage` keeps tool input un-decoded so we can pass it back unchanged | – |
| `sync` | `hub.go`, `claude.go`, `services.go` | `Mutex` protects shared state between goroutines | channels everywhere would be more complex for simple maps |
| `crypto/rand` | `claude.go: newID` | unpredictable ids and tokens from the OS | `math/rand` is **not** for secrets: predictable |
| `crypto/subtle` | `server.go` | `ConstantTimeCompare` for the token (no timing leak) | `==` stops at the first differing byte |
| `encoding/hex` | `claude.go` | bytes → printable id | – |
| `regexp` | `server.go` | parse `/remind 10m text` | hand-written parsing: longer, more bugs |
| `strconv`, `strings`, `fmt`, `errors` | various | number parsing, trimming, formatting, sentinel errors (`ErrBusy`) | – |
| `time` | various | timeouts (`time.After`), polling (`time.Tick`), the injectable clock | – |
| `flag` | `main.go` | command-line flags | cobra: worth it for many subcommands, not for one binary |
| `log` | various | timestamped logs to stderr | `log/slog` for structured logs, later |
| `io`, `os` | various | pipes, env vars (`TETO_TOKEN`), opening the named pipe as a file | – |
| `testing` | `brain_test.go` | `TestMain`, subtests (`t.Run`), `t.Setenv`, `t.TempDir`, `t.Cleanup` | testify: nicer asserts, but a dependency |

## Go language features

| Feature | Where | Note |
| --- | --- | --- |
| goroutines (`go f()`) | `claude.go: readLoop`, `askPermission` | each waiting permission request gets its own goroutine; cheap (a few KB) |
| channels + `select` | `askPermission`, SSE handler | wait for "user answered" **or** "timeout" **or** "client left", whichever is first |
| `defer` | everywhere | unlock/close/unsubscribe on every return path |
| interfaces (implicit) | `logWriter` satisfies `io.Writer` just by having `Write` | no `implements` keyword in Go |
| struct embedding of anonymous structs | `wireMsg` | describes only the JSON fields we read |
| `TestMain` | `brain_test.go` | runs before flag parsing → the test binary can impersonate `claude` |
| method-aware routing (`"POST /x"`) | `server.go` | Go 1.22+ |

## Python

| Module / feature | Where | What for | Why / alternatives |
| --- | --- | --- | --- |
| `json` | `mood.py`, tools | JSON lines in/out | – |
| `re` | `mood.py` | split text into words: `[a-z0-9']+` | `str.split` keeps punctuation glued on |
| `sys` | `mood.py`, tools | `sys.stdin` loop; `sys.stdout.reconfigure(encoding="utf-8")` (Windows console fix); `sys.executable` in tests | – |
| `subprocess` | `test_mood.py` | run `mood.py` exactly like Go does | – |
| `unittest` | `test_mood.py` | tests, no install needed | pytest: nicer, but a dependency |
| `argparse` | `smoke_brain.py` | CLI flags | – |
| `threading` | `smoke_brain.py` | read SSE in the background while posting | asyncio: more concepts for a 60-line script |
| `urllib.request` | `smoke_brain.py` | HTTP + streaming response | requests: a dependency |
| `pathlib.Path` | generator, tests | paths as objects (`/` joins) | `os.path`: string juggling |
| `from __future__ import annotations` | `mood.py`, `smoke_brain.py` | annotations are not evaluated at runtime (lets `dict[str, …]` hints stay cheap) | – |
| `dict.fromkeys` | `mood.py` | all emotions start at 0.0 | – |
| `max(..., key=scores.__getitem__)` | `mood.py` | argmax of a dict; `__getitem__` is the dunder behind `scores[k]` | `max(scores, key=scores.get)` is equivalent |
| `if __name__ == "__main__":` | scripts | run `main()` only when executed, not when imported (the test imports `analyze`) | – |
| `__file__` | generator, tests | locate files relative to the script, not the current folder | – |
| `-u` flag | started by Go | unbuffered stdout, so each reply leaves immediately | `print(..., flush=True)` (we do both) |

## TypeScript / JavaScript

| Feature / API | Where | Note |
| --- | --- | --- |
| discriminated union (`BrainEvent`) | `types.ts`, `main.ts` | `switch (ev.type)` narrows the type in each branch |
| `import type` | `face.ts`, others | erased at compile time; lets Node run `face.ts` by stripping types |
| `EventSource` | `brain.ts` | SSE client, auto-reconnects |
| `fetch` | `brain.ts`, `skin.ts` | HTTP |
| `DOMParser`, `document.importNode` | `skin.ts` | parse the SVG file into live DOM |
| `CSS.escape` | `skin.ts` | safe id selectors |
| `requestAnimationFrame` | `animator.ts` | one callback per screen refresh |
| `WebAssembly.instantiateStreaming` | `physics.ts` | load the C++ module |
| dynamic `import()` | `quirks.ts` | load quirk files at runtime (`/* @vite-ignore */` stops Vite trying to bundle them) |
| `document.elementFromPoint` | `main.ts` | is the cursor over something solid? (click-through) |
| `import.meta.env.DEV` | `main.ts` | Vite replaces it at build time; the debug handle disappears in production |
| `node:test`, `node:assert/strict` | tests | Node's built-in test runner: no Jest/Vitest needed |
| `node:fs`, `node:path`, `node:url`, `node:child_process`, `node:os` | tools/scripts | file copying, paths, launching Edge |
| global `WebSocket`, `fetch` in Node 24 | `tools/ui_probe.mjs` | talk to Edge's DevTools Protocol with no packages |

## C++ (freestanding)

| Feature | Where | Note |
| --- | --- | --- |
| `namespace teto` | `spring_chain.hpp` | avoid name clashes |
| class template `SpringChain<MaxJoints>` | `spring_chain.hpp` | array size fixed at compile time: no heap needed |
| `constexpr` | `kPi`, `clamp` | computed at compile time |
| anonymous namespace | `exports.cpp` | globals visible only in this file (like `static`) |
| `extern "C"` | `exports.cpp` | no name mangling, so JS sees `phys_angle` |
| `__attribute__((export_name(...)))` | `exports.cpp` | clang-specific: export from the wasm module |
| `#pragma once` | header | include guard |
| `static_cast<float>` | physics | explicit int → float conversion |

## How to check this list

```bash
grep -h '^\s*"[a-z/]*"$' brain/*.go | sort -u           # Go imports
grep -hE '^(import|from) ' mood/*.py tools/*.py tools/skin_gen/*.py | sort -u
grep -hoE 'from "[^"]+"' app/src/*.ts tools/*.mjs physics/test/*.mjs | sort -u
```

## References

**External**
- Tauri JS API: https://v2.tauri.app/reference/javascript/api/
- Vite: https://vite.dev/guide/
- TypeScript handbook, narrowing / discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html

**Go**
- Standard library index: https://pkg.go.dev/std
- `net/http` routing patterns: https://pkg.go.dev/net/http#hdr-Patterns-ServeMux
- `bufio.Scanner.Buffer`: https://pkg.go.dev/bufio#Scanner.Buffer
- `testing.M` / `TestMain`: https://pkg.go.dev/testing#hdr-Main
- Effective Go (goroutines, channels, defer): https://go.dev/doc/effective_go

**Python**
- Standard library: https://docs.python.org/3/library/
- `sys.stdout.reconfigure` (TextIOWrapper.reconfigure): https://docs.python.org/3/library/io.html#io.TextIOWrapper.reconfigure
- PEP 563, postponed evaluation of annotations: https://peps.python.org/pep-0563/
- `__main__`: https://docs.python.org/3/library/__main__.html

**JS / Node**
- Node, TypeScript type stripping ✔ (default since 23.6/22.18; `.ts` extensions required; no enums/parameter properties): https://nodejs.org/api/typescript.html
- Node test runner: https://nodejs.org/api/test.html
- Vite, env variables (`import.meta.env.DEV`): https://vite.dev/guide/env-and-mode
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/

**C++**
- cppreference, templates: https://en.cppreference.com/w/cpp/language/templates
- cppreference, unnamed namespaces: https://en.cppreference.com/w/cpp/language/namespace#Unnamed_namespaces
