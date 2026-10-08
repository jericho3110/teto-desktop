# The languages: strengths, weaknesses, and who covers for whom

Teto is built so that **every language does what it's best at, and its
weak spots are handled by a language that's strong there**. This page is
that map. The details of each language are in `<language>/docs/CONCEPTS.md`.

## Contents

1. [The map at a glance](#the-map-at-a-glance)
2. [C](#c)
3. [C++](#c-1)
4. [Rust](#rust)
5. [Go](#go)
6. [Python](#python)
7. [Java](#java)
8. [C#](#c-2)
9. [TypeScript and JavaScript](#typescript-and-javascript)
10. [Why TypeScript here and JavaScript there?](#why-typescript-here-and-javascript-there)
11. [Concurrency: each language's model](#concurrency-each-languages-model)
12. [Who covers for whom](#who-covers-for-whom)
13. [Exercises](#exercises)
14. [References](#references)

## The map at a glance

| Language | Teto's use | Major strength used | Major weakness | Covered by |
| --- | --- | --- | --- | --- |
| **C** | Win32 hooks | speaks the OS's native API; universal ABI | no memory safety, no package manager, no strings/containers | **Rust** wraps it safely and builds it with Cargo |
| **C++** | hair physics (wasm) | zero-cost abstractions for hot numeric loops | complex, unsafe memory, slow builds, no standard GUI | **TypeScript** drives it; physics only does math |
| **Rust** | window shell, supervisor | memory safety *without* a garbage collector; great FFI | steep learning curve; small std (no JSON/HTTP/RNG); slow compiles | crates; **Go** handles the networking-heavy brain |
| **Go** | the brain | goroutines + channels; huge std (HTTP, JSON, exec); single static binary | no desktop GUI; no WebSocket in std; less expressive types | **Rust/TS** for the UI; SSE instead of WebSocket |
| **Python** | mood, art generator, tools | fastest to write; text processing; the ML ecosystem | slow CPU-bound code; GIL; dynamic types; needs an interpreter installed | heavy work stays in Go/C++; types are only hints |
| **Java** | reminder service | stable long-running services; huge JDK; virtual threads | no JSON parser in the JDK; verbose; JVM startup and memory | **Go** sends it forms instead of JSON |
| **C#** | tray, notifications, voice | first-class Windows desktop APIs; async/await | Windows-centric for desktop UI; another runtime to install | it's exactly the Windows-specific corner, isolated behind a pipe |
| **TypeScript** | the UI | runs in the webview; types catch protocol mistakes | must be compiled; types vanish at runtime; JS's quirks remain | **Rust/C** for native access; **C++/wasm** for speed |
| **JavaScript** | quirks, probe tool | no build step: drop a file in and it runs | no type checking | the TS host validates and isolates quirks |

## C

**Strengths.** The Windows API *is* C (`GetCursorPos`, `RegisterHotKey`,
job objects). C's ABI is the one every language can call: Rust, Go, C#,
Python and wasm all speak "C". Tiny, predictable, no runtime.

**Weaknesses.** Manual memory: buffer overflows, use-after-free and
double-free are on you. No real strings, containers or modules (headers
are copy-paste). No package manager. Error handling by return codes.

**How Teto compensates.** C does only the thin Win32 layer (157 lines);
Rust calls it through `native.rs`, where every call is wrapped in a safe
function with a written safety argument, and Cargo's `build.rs` builds the C.

## C++

**Strengths.** Classes and templates with **zero runtime cost**: the
physics compiles to 1.4 KB of wasm. Direct control over memory layout
(arrays of floats, no allocation), as fast as C.

**Weaknesses.** The same memory hazards as C, plus a huge, complicated
language. Long compile times; header-based builds.

**How Teto compensates.** C++ gets one small, pure job (numbers in,
numbers out) in a sandbox: WebAssembly can't touch anything outside its
own memory, and every exported function validates its indexes.

## Rust

**Strengths.** **Memory safety without a garbage collector**: the
compiler proves no dangling pointers and no data races (ownership and
borrowing). Excellent C FFI. Cargo is a superb build tool and package manager.
Tauri gives a native window with the OS's webview.

**Weaknesses.** Steep learning curve (the borrow checker). A deliberately
small standard library: JSON, HTTP and random numbers are crates. Slow
compiles. (Found live: Cargo's build scripts trip Windows Smart App
Control and OneDrive folders.)

**How Teto compensates.** Rust does the parts where safety matters most
(talking to C, owning processes); the network-heavy brain is in Go,
whose standard library has everything built in.

## Go

**Strengths.** **Goroutines and channels**: thousands of cheap concurrent
tasks, and `select` to wait on "whichever happens first" (a click, a
timeout, a disconnect), exactly what the permission flow needs. The
standard library covers HTTP, JSON, crypto, processes and testing.
Compiles to one static `.exe`.

**Weaknesses.** No native GUI toolkit. No WebSocket in the standard
library. A simpler type system (generics arrived late; errors as plain
values make code verbose). A garbage collector, so latency is less
predictable than Rust (irrelevant here).

**How Teto compensates.** The UI lives in TypeScript inside Rust's
window; streaming uses Server-Sent Events, which Go's standard library handles.

## Python

**Strengths.** The fastest to write and read; superb text processing; the
ecosystem for ML (where the mood engine could grow). Great for scripts and
tools (`check_all.py`, the art generator).

**Weaknesses.** Slow for CPU-heavy work; the **GIL** keeps threads from
running Python code in parallel; types are only hints; the user needs an
interpreter.

**How Teto compensates.** Python only gets light, text-shaped work, run as a
child process that can be swapped for anything speaking the same JSON-lines protocol.

## Java

**Strengths.** Mature for long-running services; a huge JDK (HTTP server,
NIO, concurrency); **virtual threads** (Java 21+) give goroutine-like
cheap threads; strong typing; records.

**Weaknesses.** No JSON parser in the JDK. Verbose. The JVM's startup time and
memory use are heavier than a Go binary's.

**How Teto compensates.** The brain talks to it in what the JDK reads
easily (form encoding) and Java writes JSON with a `StringBuilder`.

## C#

**Strengths.** Direct access to the Windows desktop: tray icons,
notifications, the built-in speech voices, named pipes with
current-user-only security. Modern language: records, pattern matching,
`async`/`await`, nullable reference types.

**Weaknesses.** Desktop UI (Windows Forms) is Windows-only; it's another
runtime (.NET) to install.

**How Teto compensates.** The Windows-only parts are isolated in one
small companion process behind a pipe; if it's missing, Teto just has no voice.

## TypeScript and JavaScript

**TypeScript = JavaScript + a static type system.** You understood it
right: every JavaScript program is (nearly) a valid TypeScript program,
and TypeScript compiles to plain JavaScript by **erasing** the types. The
types exist only at compile time; at runtime it's JavaScript.

**Strengths (both).** The only language that runs natively in the webview;
event-driven; huge ecosystem. TypeScript adds compile-time checking,
editor autocomplete and refactoring safety.

**Weaknesses (both).** JavaScript's quirks (`==` coercion, `this`,
floating-point-only numbers before `BigInt`). TypeScript needs a compile
step, and its types can't protect you from data that arrives at runtime
(JSON from the brain could still be wrong).

## Why TypeScript here and JavaScript there?

You asked: why not TypeScript for everything? It's a fair question. The
rule I used is **TypeScript where code is compiled and maintained with the
app; JavaScript where code is loaded at runtime or is a standalone tool**:

| Code | Language | Why |
| --- | --- | --- |
| `typescript/ui/src/*` | TypeScript | the core app: many modules, a protocol with the Go brain (`BrainEvent` union), a skin format (`SkinManifest`). Types catch mismatches at compile time, and refactors are safe |
| `typescript/ui/scripts/sync-assets.ts` | TypeScript | part of the UI's build; Node runs it directly by stripping types |
| `javascript/quirks/*.js` | JavaScript | loaded **at runtime** with `import()`: the browser can only execute JavaScript, and a `.ts` file would need compiling first, defeating "drop a file in". They're also meant to be written by anyone, with no tooling |
| `javascript/tools/ui_probe.mjs` | JavaScript | a standalone dev tool: run with `node` anywhere, no `tsconfig`, no dependencies |
| `cpp/physics/test/*.mjs` | JavaScript | tests for the C++ package, which has no TypeScript setup |

**Could it all be TypeScript?** Yes: Node 22.18+ runs `.ts` directly
(with limits: no enums or parameter properties), so the probe and tests
could be `.ts`. Quirks could be `.ts` if the build compiled them, or if
the UI shipped a TypeScript compiler (≈10 MB) to compile them at runtime.
The trade-off: TypeScript buys safety at the cost of a build step; for
small runtime plugins, the build step costs more than it saves. A middle
ground worth knowing: **JSDoc types** in `.js` files (`/** @param {QuirkAPI} teto */`)
give editor checking with no build step.

## Concurrency: each language's model

| Language | Model | In Teto |
| --- | --- | --- |
| Go | goroutines + channels (CSP), preemptive scheduler | permission waits, Claude reader, SSE clients |
| Java | virtual threads (21+) + `synchronized` | one virtual thread per HTTP request |
| C# | `async`/`await` tasks + `CancellationToken` | pipe accept loop |
| Rust | OS threads; ownership proves thread safety (`Send`/`Sync`) | native poller thread; `Mutex` statics |
| C | OS threads, critical sections, events | hotkey message-loop thread |
| Python | threads (GIL) or `asyncio` | SSE reader thread, link-checker thread pool |
| TypeScript/JS | one thread + **event loop**; `async`/`await` | everything in the UI; `requestAnimationFrame` |
| C++ (wasm) | single-threaded here | physics step per frame |

## Who covers for whom

```text
            needs the OS API ──────────────────────► C  (Win32)
                 │ unsafe? ───────────────────────► Rust wraps C safely (FFI)
 UI must run in a webview ────► TypeScript ──slow math?──► C++ via WebAssembly
                 │ native window? ────────────────► Rust (Tauri)
 juggling processes/streams ──► Go ──needs Windows tray/voice?──► C# (named pipe)
                 │ text/ML-ish analysis? ─────────► Python (pipes)
                 │ long-running stateful service? ─► Java (HTTP)
 personality without rebuilds ► JavaScript quirks
```

## Exercises

1. Pick one weakness from the table and find the line of code where
   another language covers it.
2. Rewrite one quirk with JSDoc type comments; does VS Code now catch a typo in `teto.sya()`?
3. Self-check: why would putting the mood engine *inside* the Go brain
   (rewriting it in Go) be simpler but worse for the project's goals?

## References

### Official

- Go, Effective Go (concurrency): <https://go.dev/doc/effective_go#concurrency>
- The Rust Book, ownership: <https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html>
- Python glossary, GIL: <https://docs.python.org/3/glossary.html#term-global-interpreter-lock>
- JEP 444, virtual threads: <https://openjdk.org/jeps/444>
- C#, asynchronous programming: <https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/>
- TypeScript handbook, TypeScript for JavaScript programmers: <https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html>
- TypeScript, JSDoc type checking in JS files: <https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html>
- Node, TypeScript type stripping: <https://nodejs.org/api/typescript.html>
- MDN, the event loop: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop>

### Other

- Rob Pike, *Concurrency is not Parallelism*: <https://go.dev/blog/waza-talk>
- Stack Overflow Developer Survey (popularity/strengths context): <https://survey.stackoverflow.co/>
