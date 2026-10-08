# Glossary: every concept in Teto

One line per concept, and a link to where it's explained in depth.
If you meet a word in the code or docs that isn't here, it's a gap in the
docs: please add it.

Abbreviations for the links: **ARCH** [ARCHITECTURE](ARCHITECTURE.md),
**ANIM** [ANIMATION](ANIMATION.md), **MEM** [MEMORY](MEMORY.md),
**PAR** [PARADIGMS](PARADIGMS.md), **LANG** [LANGUAGES](LANGUAGES.md),
**MOD** [MODULES_AND_LIBRARIES](MODULES_AND_LIBRARIES.md),
**FILES** [FILE_TYPES](FILE_TYPES.md), **SEC** [SECURITY](SECURITY.md),
**PROTO** [PROTOCOL](PROTOCOL.md), **VOICE** [VOICE](VOICE.md),
**PKG** [PACKAGING](PACKAGING.md), and `<lang>` = `<lang>/docs/CONCEPTS.md`.

## A–C

| Term | Meaning | Where |
| --- | --- | --- |
| ABI | how compiled functions are called at the machine level; C's is the one every language speaks | MOD, `c` |
| abstraction | a simple interface hiding complex details | PAR |
| `abs(sin)` bounce | folding a sine wave upward to make a hop | ANIM |
| allow-list | permit only known-good items (vs block-list) | SEC, `typescript` |
| alignment | an object must start at an address divisible by its size class | MEM, `cpp` |
| `approach()` | frame-rate-independent exponential smoothing | ANIM |
| arena (bump) allocator | allocate by moving a pointer; free everything at once | MEM, `cpp` |
| assembly (.NET) | a compiled `.dll`/`.exe` unit | MOD, `csharp` |
| async / await | write asynchronous code that reads like sequential code | `typescript`, `csharp` |
| atomic write | write a temp file, then rename over the original | `java` |
| back-pressure (by dropping) | a fast producer drops events instead of blocking on a slow consumer | `go` |
| bearer token | a secret sent as `Authorization: Bearer …` | SEC, PROTO |
| borrow / borrow checker | Rust's compile-time rules for references | MEM, `rust` |
| `.bss` vs `.data` | zero-initialized globals cost nothing in the file; others are stored | MEM |
| buffer overflow | writing past the end of a buffer | MEM, SEC |
| build script (`build.rs`) | Rust code Cargo runs before compiling the crate | `rust` |
| bytecode | instructions for a virtual machine (`.class`, `.pyc`, .NET IL) | FILES |
| capability (Tauri) | a permission the web UI is granted | SEC, FILES |
| CSP | Content Security Policy: which scripts/connections a page may use | SEC |
| channel | a typed pipe between goroutines | `go` |
| child process | a program started by another program | ARCH |
| click-through | a window that lets mouse clicks pass through transparent areas | ANIM |
| closure | a function that captures variables from its surroundings | `go`, `javascript`, `rust` |
| composition | building objects from other objects ("has a") | PAR |
| composition root | the one place that creates and wires everything (`main`) | ARCH |
| constant-time compare | comparison whose duration doesn't leak where strings differ | SEC, `go` |
| `constexpr` / `constinit` | computed / initialized at compile time | `cpp` |
| coordinate space | which units and origin a position is expressed in | ANIM |
| CORS | browser rules for cross-origin requests | SEC |
| crate (Rust) | a compilation unit / package | MOD, `rust` |
| CSRF | a web page making your browser send requests to another site/localhost | SEC |
| CSP (concurrency) | communicating sequential processes: goroutines + channels | LANG, PAR |

## D–I

| Term | Meaning | Where |
| --- | --- | --- |
| data race | two threads, same memory, one writing, no lock | MEM |
| data-oriented design | organize code around data layout (e.g. struct of arrays) | PAR |
| data minimization | collect/send only the data you need (app name, not titles) | SEC |
| `defer` | Go: run this when the function returns | `go`, MEM |
| defense in depth | several independent defenses for the same threat | SEC |
| dependency injection | pass in what a component needs (clock, binary path) | PAR |
| deserialization RCE | turning untrusted bytes into live objects that run code | SEC |
| discriminated union | a TS union whose `type` field tells the variants apart | `typescript` |
| DNS rebinding | a malicious domain re-resolving to 127.0.0.1 | SEC |
| double free | freeing memory twice | MEM |
| `Drop` | Rust's destructor: runs when the owner goes out of scope | MEM, `rust` |
| dt | seconds since the last frame | ANIM |
| dynamic `import()` | loading a JS module at runtime | `javascript` |
| encapsulation | hiding state so only an object's methods change it | PAR |
| event loop | JS's single-threaded "run handlers as events arrive" model | LANG |
| event-driven | code that reacts to events | PAR |
| `extern "C"` | use the C ABI / no name mangling | `cpp`, `rust` |
| fail closed | on doubt or error, deny | SEC |
| FFI | calling functions written in another language | `rust`, `c` |
| free list | linked list of free slots in a pool | MEM |
| freestanding | code without the standard library | `cpp` |
| functional core, imperative shell | pure decisions in the middle, I/O at the edges | PAR, ARCH |
| garbage collector (GC) | runtime that frees unreachable memory | MEM |
| goroutine | Go's lightweight thread | `go`, LANG |
| graceful degradation | missing parts reduce features instead of crashing | ARCH |
| half-life | time to close half the gap when smoothing (`ln2 / rate`) | ANIM |
| header (`.h`) | C/C++ declarations pasted in by `#include` | MOD, `c` |
| heap | memory you request and give back | MEM |
| hotkey (global) | a key combo that works in any app | `c` |
| `IDisposable` / `using` | C#'s deterministic cleanup | `csharp`, MEM |
| include guard / `#pragma once` | prevent a header being pasted twice | `c`, `cpp` |
| inheritance | a class built on another class | PAR |
| `InternalsVisibleTo` | let one assembly (tests) see `internal` members | `csharp` |
| IPC | communication between processes | ARCH |

## J–P

| Term | Meaning | Where |
| --- | --- | --- |
| job object | Windows group of processes that can be killed together | `c`, SEC |
| `jlink` | builds a minimal Java runtime with only the modules you need | PKG |
| JSON / JSON lines | data format / one JSON object per line as a protocol | FILES, PROTO |
| JSON Schema | JSON describing the shape of other JSON | FILES |
| leak (memory) | memory never freed | MEM |
| least privilege | grant only what's needed | SEC |
| lifetime (Rust) | how long a borrow is valid | MEM, `rust` |
| linear memory | WebAssembly's single flat byte array | MEM |
| linker | joins compiled object files and libraries | MOD |
| lock file | exact pinned dependency versions | FILES |
| manifest | a file describing a package of files (`manifest.json`, `Cargo.toml`) | FILES, `assets/skins` |
| message loop | a thread waiting for and dispatching OS messages | `c` |
| middleware | an HTTP handler that wraps another handler | `go` |
| module | a unit of code organization (meaning differs per language) | MOD |
| move (Rust) | transferring ownership | MEM |
| mutex | a lock: one thread at a time | `go`, `rust` |
| name mangling | C++ encoding parameter types into symbol names | `cpp` |
| named pipe | a Windows IPC channel with a name | `csharp`, ARCH |
| `NonNull` | a Rust raw pointer that can't be null | `rust` |
| object pool | pre-allocated reusable slots | MEM |
| opaque type | a type whose fields callers can't see | `c`, PAR |
| `oto.ini` | UTAU's per-syllable timing table | VOICE |
| ownership | each value has one owner that frees it | MEM |
| package (Go/Java/npm/Python) | a unit of code grouping or distribution (differs per language) | MOD |
| path traversal | `..\..\` names escaping a folder | SEC, VOICE |
| path remapping (`--remap-path-prefix`, `-trimpath`) | rewriting build-machine paths embedded in binaries | PKG |
| permission prompt (`can_use_tool`) | Claude Code asking the host to approve a tool | PROTO |
| pivot | the point a part rotates around | ANIM |
| placement new | constructing an object in existing memory | MEM |
| polymorphism | one interface, many implementations | PAR |
| procedural | step-by-step procedures over data | PAR |
| prompt injection | malicious text steering an AI agent | SEC |
| prototype-key lookup | plain JS objects inherit keys like `__proto__` | SEC |
| publish/subscribe | producers publish events, subscribers receive them | `go` |
| pure function | same input → same output, no side effects | PAR |

## R–Z

| Term | Meaning | Where |
| --- | --- | --- |
| RAII | tie a resource's lifetime to an object's scope | MEM |
| RCE | an attacker running code on your machine | SEC |
| record | an immutable data type with value equality (Java, C#) | `java`, `csharp` |
| reference counting | free when the last reference goes (Python) | MEM |
| `requestAnimationFrame` | browser callback before each repaint | ANIM |
| resampling | changing playback speed/pitch by interpolating samples | VOICE |
| RIFF / WAV | the chunked audio file format | VOICE |
| semi-implicit Euler | stable physics integration (velocity first) | `cpp/docs/ARCHITECTURE.md` |
| Server-Sent Events (SSE) | a long HTTP response streaming `data:` lines | PROTO |
| Shift-JIS (code page 932) | legacy Japanese text encoding | VOICE |
| sidecar | a helper executable bundled with a Tauri app | PKG |
| sine oscillation | `amplitude × sin(ω t)` for periodic motion | ANIM |
| Smart App Control | Windows feature blocking unknown unsigned programs | [SMART_APP_CONTROL](SMART_APP_CONTROL.md) |
| SOLID | five OOP design principles | PAR |
| stack | automatic per-call memory | MEM |
| standard library | what ships with the language | MOD |
| static vs dynamic linking | library copied into the exe vs loaded at runtime | MOD |
| struct of arrays (SoA) | one array per field instead of an array of structs | MEM, PAR |
| supply chain | the dependencies you ship | SEC |
| SAST / SCA | scanning your own code / your dependencies for known problems | [SECURITY_SCANNING](SECURITY_SCANNING.md) |
| CWE / CVE | catalogue of weakness types / ids of specific known vulnerabilities | [SECURITY_SCANNING](SECURITY_SCANNING.md) |
| build script / proc-macro (and why SAC blocks them) | Rust code compiled and run during the build | [SMART_APP_CONTROL](SMART_APP_CONTROL.md) |
| `textContent` vs `innerHTML` | insert text vs parse HTML | SEC |
| Template Method | fixed algorithm calling overridable steps | PAR |
| token (shared secret) | random value proving a request comes from Teto | SEC |
| trampoline | a plain function that forwards a C callback to a Rust closure | `rust` |
| translation unit | one `.c`/`.cpp` file plus its includes, compiled alone | MOD |
| type stripping | Node running `.ts` by erasing types | `typescript` |
| typed array view | a `Float32Array` over existing memory, no copy | MEM |
| unit vector | a direction of length 1 | ANIM |
| `unsafe` (Rust) | code the compiler can't verify; you promise | `rust` |
| use-after-free | using memory after giving it back | MEM |
| UTAU / voicebank | singing-synthesis software / a set of recorded syllables | VOICE |
| UTF-8 / UTF-16 | Unicode encodings (Windows APIs use UTF-16) | `c` |
| virtual function / vtable | runtime-dispatched method / its lookup table | PAR, `cpp` |
| virtual threads | cheap JVM-managed threads | `java` |
| WebAssembly (wasm) | portable sandboxed bytecode for browsers | `cpp`, MEM |
| zero-copy | sharing memory instead of copying it | MEM |
| zero value | Go's default value for every type | `go` |

## References

### Official

- MDN glossary: <https://developer.mozilla.org/en-US/docs/Glossary>
- Python glossary: <https://docs.python.org/3/glossary.html>
- The Rust Reference, glossary: <https://doc.rust-lang.org/reference/glossary.html>

### Further learning

- Wikipedia, glossary of computer science: <https://en.wikipedia.org/wiki/Glossary_of_computer_science>
