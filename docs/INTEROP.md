# Language interoperability: how the languages talk to each other

[ARCHITECTURE.md](ARCHITECTURE.md#how-the-languages-link) lists *which*
technique each link uses, and [PROTOCOL.md](PROTOCOL.md) gives the exact
messages. This guide explains **how each technique works underneath**, why
it was picked, and what it costs. It also compares Teto with the
[unstoppable-force](https://github.com/jericho3110/unstoppable-force) math
project, which made the opposite choice.

## Contents

1. [Two families: same process or separate processes](#1-two-families-same-process-or-separate-processes)
2. [The C ABI: the common language of native code](#2-the-c-abi-the-common-language-of-native-code)
3. [Rust → C in Teto, step by step](#3-rust--c-in-teto-step-by-step)
4. [WebAssembly: C++ inside the browser engine](#4-webassembly-c-inside-the-browser-engine)
5. [The Tauri bridge: TypeScript ↔ Rust](#5-the-tauri-bridge-typescript--rust)
6. [Separate processes: pipes, HTTP, named pipes](#6-separate-processes-pipes-http-named-pipes)
7. [Framing and formats: how bytes become messages](#7-framing-and-formats-how-bytes-become-messages)
8. [The math project: the simplest possible interop](#8-the-math-project-the-simplest-possible-interop)
9. [Security at every boundary](#9-security-at-every-boundary)
10. [Choosing a technique](#10-choosing-a-technique)
11. [Exercises](#11-exercises)
12. [References](#references)

---

## 1. Two families: same process or separate processes

```text
 SAME PROCESS (one address space)            SEPARATE PROCESSES (each has its own memory)
 ┌──────────────────────────────┐           ┌────────────┐   bytes    ┌────────────┐
 │ Rust code ──call──► C code   │           │  Go brain  │ ─────────► │ Python mood│
 │      shares pointers, memory │           │            │ ◄───────── │            │
 └──────────────────────────────┘           └────────────┘  pipe/HTTP └────────────┘
 FFI (Rust→C), WebAssembly (TS→C++)          stdin/stdout, HTTP, SSE, named pipes
```

| | Same process (FFI, WASM) | Separate processes (pipes, HTTP) |
| --- | --- | --- |
| Speed of one call | nanoseconds: a function call | micro- to milliseconds: copy, encode, decode |
| What crosses | numbers and pointers | bytes you encode (JSON, CSV, forms) |
| A crash in one side | can take down both | the other side survives and can restart it |
| Memory bugs | can corrupt the other side | impossible across the boundary |
| Debugging | one debugger, but mixed languages | run and test each side alone |
| Build | link step, matching headers | no linking at all |

The Python comparison: `ctypes` (load a DLL and call it) is the same-process
family; `subprocess.run([...], capture_output=True)` is the separate-process
family.

**Teto uses both on purpose**: same-process only where the speed or the OS
API needs it (Win32 calls, 60 fps physics), and separate processes everywhere
else, so a bug in one language can't crash the pet.

## 2. The C ABI: the common language of native code

Almost every language can call C, and C can be called from almost every
language. That's because C has a simple, stable **ABI** (Application Binary
Interface): the rules for how a compiled function is called.

| ABI rule | What it decides |
| --- | --- |
| **calling convention** | which registers or stack slots hold the arguments and the return value |
| **type layout** | how big an `int32_t` is, and where each struct field sits in memory |
| **symbol name** | the name the linker looks for: C uses the plain name, `teto_idle_ms` |

An **API** is what the source code says (`fn idle_ms() -> u32`). An **ABI** is
what the machine code agrees on. Two languages that each speak the C ABI
can call each other, even if neither knows the other exists.

The language features that make this work:

| Feature | Language | What it does |
| --- | --- | --- |
| `extern "C" { fn ... }` | Rust | "these functions exist elsewhere and use the C ABI" |
| `extern "C" fn f()` | Rust | "compile this function with the C ABI so C can call it" |
| `#[repr(C)]` | Rust | lay this struct out the way C would (Rust may reorder fields otherwise) |
| `extern "C" { ... }` | C++ | turn off **name mangling**: C++ encodes argument types into the symbol (`phys_step` → roughly `_Z9phys_stepffff`), which C callers can't guess |

**The compiler can't check the other side.** Rust trusts that your
`extern` declaration matches the C header. If they disagree (say Rust says
`i32` and C says `int64_t`), the program compiles and then misbehaves.
That's why every FFI call is `unsafe` in Rust: you, not the compiler,
promise it's correct.

## 3. Rust → C in Teto, step by step

### 3.1 Building and linking

[rust/shell/build.rs](../rust/shell/build.rs) runs **before** the Rust crate
compiles:

```rust
cc::Build::new()
    .file(c_dir.join("src/teto_win32.c"))
    .include(c_dir.join("include"))
    .warnings_into_errors(true)
    .compile("teto_win32");                     // → teto_win32.lib, a static library
println!("cargo:rustc-link-lib=user32");        // the Win32 functions the C code calls
println!("cargo:rerun-if-changed=../../c/win32hooks/src/teto_win32.c");
```

A **static library** is copied into the final `.exe` at link time, so there
is no separate DLL to ship or to go missing. (The alternative, a DLL loaded
at run time, is what Python's `ctypes.CDLL` does.)

### 3.2 Declaring the functions

[rust/shell/src/native.rs](../rust/shell/src/native.rs) mirrors
`c/win32hooks/include/teto_win32.h` line by line:

```c
/* C header */
uint32_t teto_idle_ms(void);
int teto_cursor_pos(int32_t *x, int32_t *y);
typedef struct teto_window_info teto_window_info;   /* opaque: fields hidden */
teto_window_info *teto_foreground_window(void);
void teto_window_info_free(teto_window_info *info);
```

```rust
// Rust side, in a private `ffi` module
extern "C" {
    pub fn teto_idle_ms() -> u32;
    pub fn teto_cursor_pos(x: *mut i32, y: *mut i32) -> i32;
    pub fn teto_foreground_window() -> *mut WindowInfo;
    pub fn teto_window_info_free(info: *mut WindowInfo);
}
#[repr(C)]
pub struct WindowInfo { _private: [u8; 0] }   // opaque: Rust can't build or copy one
```

**Out-parameters:** `teto_cursor_pos` writes two answers through pointers,
because C functions return only one value. Rust passes `&mut x` as `*mut i32`.

### 3.3 Who frees the memory? (ownership across the boundary)

**The rule: memory is freed by the side that allocated it.** C allocated the
window info with C's `malloc`, so C must free it. Rust's allocator mustn't
touch it. Rust makes this automatic with **RAII**, the `Drop` trait:

```rust
pub struct ForegroundWindow { ptr: NonNull<ffi::WindowInfo> }

impl Drop for ForegroundWindow {
    fn drop(&mut self) {
        // SAFETY: we own `ptr` and this is the only place that frees it.
        unsafe { ffi::teto_window_info_free(self.ptr.as_ptr()) }
    }
}
```

When a `ForegroundWindow` goes out of scope, Rust calls C's free function
exactly once. A test runs this 5000 times to show nothing leaks. In
Python terms it's like a context manager (`with`) whose `__exit__` always
runs, without needing the `with`.

### 3.4 Callbacks: C calling back into Rust

The global hotkey runs on a C thread and must call Rust code (a closure)
when the key is pressed. A C function pointer can't carry a Rust closure, so
the code uses the classic **`void *user` + trampoline** pattern:

```text
 Rust: hotkey_start(closure)
   ├─ boxes the closure, keeps it alive in a static
   └─ calls C: teto_hotkey_start(mods, key, trampoline, user = pointer to the box)
 C thread, key pressed:
   └─ cb(user)  ──►  Rust `extern "C" fn trampoline(user)`
                        ├─ turns `user` back into &closure
                        └─ catch_unwind(closure)   ← a Rust panic must NEVER unwind into C
```

Unwinding a Rust panic through C frames is **undefined behaviour**, so the
trampoline catches it at the border. The same rule applies the other way:
C++ exceptions must not escape into Rust or C.

## 4. WebAssembly: C++ inside the browser engine

The hair and particle physics are C++ compiled to **WebAssembly** (wasm), a
portable bytecode that the WebView's JavaScript engine runs at near-native
speed, inside a **sandbox**: the module can touch only its own memory and
the functions you hand it.

### 4.1 Building

From [cpp/physics/package.json](../cpp/physics/package.json):

```text
clang++ --target=wasm32 -O2 -std=c++20 -nostdlib -fno-exceptions -fno-rtti
        -Wl,--no-entry -Wl,--strip-all -o dist/physics.wasm src/exports.cpp src/particles.cpp
```

| Flag | Why |
| --- | --- |
| `--target=wasm32` | emit WebAssembly instead of x86 |
| `-nostdlib` | **freestanding**: no C++ standard library, no `malloc`; all data is static arrays |
| `-fno-exceptions -fno-rtti` | exceptions can't cross into JavaScript anyway; smaller output |
| `-Wl,--no-entry` | a library, not a program: no `main` |
| `-Wl,--strip-all` | drop debug names to keep the file small |

### 4.2 Exporting functions

[cpp/physics/src/exports.cpp](../cpp/physics/src/exports.cpp):

```cpp
#define EXPORT(name) __attribute__((export_name(#name)))
extern "C" {
EXPORT(phys_step_chain) void phys_step_chain(int chain, float dt, float ax, float ay, float gravity) {
    if (chain >= 0 && chain < g_count) g_chains[chain].step(dt, ax, ay, gravity);
}
}
```

**Only numbers cross the boundary.** Wasm functions take and return `i32`,
`i64`, `f32` and `f64`, never strings, objects or C++ classes. So the
objects stay inside the module (static `g_chains`), and JavaScript refers to
them by index. The bounds check (`chain < g_count`) matters: the index comes
from the other side.

### 4.3 Sharing memory without copying

[typescript/ui/src/physics.ts](../typescript/ui/src/physics.ts):

```ts
const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
// ...
const view = (field: number) => new Float32Array(x.memory.buffer, x.fx_field(field), n);
this.px = view(0);   // a VIEW of the particle x-positions inside wasm memory
```

A wasm module has one **linear memory**: a big `ArrayBuffer`. C++ returns
the *offset* of its particle array (`fx_field`), and TypeScript wraps that
range in a `Float32Array`. It's a **view, not a copy**, so drawing 60 times
a second costs nothing extra.

**The gotcha:** if the module ever *grows* its memory, the old buffer is
detached and every view breaks. It's safe here only because the C++ side is
freestanding and never grows memory (the comment in `physics.ts` says so).

## 5. The Tauri bridge: TypeScript ↔ Rust

The UI (TypeScript in a WebView) and the shell (Rust) are in the same
program but different worlds. Tauri connects them with **IPC messages
carrying JSON**:

| Direction | Mechanism | Example |
| --- | --- | --- |
| TS → Rust | a **command**: `invoke("get_config")` calls a `#[tauri::command]` function | `main.ts` → `lib.rs` |
| Rust → TS | an **event**: Rust `emit`s, TS `listen`s | `native://cursor` from `spawn_native_pollers` |

`serde` turns Rust structs into JSON and back. That's the **serialization**
idea from §7, applied inside one app. Which commands the UI may call is
limited by Tauri's capability files (see [SECURITY.md](SECURITY.md)).

## 6. Separate processes: pipes, HTTP, named pipes

### 6.1 Child process + stdin/stdout (Go ↔ Python, Go ↔ Claude Code)

The Go brain starts Python once and keeps it running
([go/brain/services.go](../go/brain/services.go)):

```go
cmd := exec.Command(python, "-u", script)        // -u: unbuffered, or replies sit in Python's buffer
stdin, _ := cmd.StdinPipe()
stdout, _ := cmd.StdoutPipe()
m.in, m.out = json.NewEncoder(stdin), bufio.NewScanner(stdout)
```

```python
# python/mood/mood.py
for line in sys.stdin:                       # one JSON request per line
    text = json.loads(line).get("text", "")
    ...
    print(json.dumps(reply), flush=True)     # one JSON reply per line, flushed now
```

A **pipe** is a one-way byte stream the OS provides between two processes.
Two pipes (stdin and stdout) make a conversation. **Buffering** is the classic
bug: if Python holds the reply in its output buffer, Go waits forever. Both
`-u` and `flush=True` prevent it.

Claude Code is driven the same way, with its `stream-json` line format
([PROTOCOL.md](PROTOCOL.md#brain--claude-code-stream-json)).

### 6.2 HTTP on loopback (TS → Go, Go → Java)

HTTP over `127.0.0.1` is a pipe with a standard format on top: every
language has a client and a server for it, and you can test it with `curl`.
The costs are a port and authentication, so each service binds to loopback
only and requires a random **bearer token**. Rust generates the token and
hands it to each child through the `TETO_TOKEN` **environment variable**.

**Server-Sent Events** (Go → TS) are one long HTTP response that never ends.
Each `data: <json>\n\n` block is one event, which suits streaming replies.

### 6.3 Windows named pipe (Go → C#)

A **named pipe** is a pipe with a name (`\\.\pipe\...`) that unrelated
processes can open, like a local-only socket. C# listens with
`NamedPipeServerStream` and reads one JSON line per connection. There's no
TCP port to bind and no network exposure, and `PipeOptions.CurrentUserOnly`
lets only processes running as the same Windows user connect.

## 7. Framing and formats: how bytes become messages

A pipe or socket delivers a **stream** of bytes, not messages. **Framing**
decides where one message ends:

| Framing | Used by | Rule |
| --- | --- | --- |
| newline-delimited (JSON Lines) | Go ↔ Python, Go ↔ Claude, Go → C# | one message per `\n`; JSON never contains a raw newline |
| HTTP | TS → Go, Go → Java | `Content-Length` header, or a chunked body |
| SSE | Go → TS | a blank line (`\n\n`) ends each event |
| process exit | math project | the whole stdout is one answer |

**Format** decides what the bytes mean. The rule Teto follows is to *use
what the receiver parses easily*:

| Format | Where | Why |
| --- | --- | --- |
| JSON | most links | every language here has a parser (Go `encoding/json`, Python `json`, Rust `serde`, C# `System.Text.Json`) |
| form-encoded | Go → Java | the JDK has no JSON parser but decodes forms built in |
| raw numbers | TS → C++ (wasm) | the wasm boundary allows nothing else |
| CSV / plain text | math project | readable by eye and by Python's `csv` module |

## 8. The math project: the simplest possible interop

[unstoppable-force](https://github.com/jericho3110/unstoppable-force) uses
**one** technique: Python runs each compiled program and reads its stdout.

```text
python main.py simulate
  └─ subprocess.run([".../collide.exe", "sweep"], capture_output=True, text=True)   # argv list, no shell
       Rust prints CSV  ──►  Python reads text
```

Why not compile the Rust into a Python module (PyO3) or call C++ through
`ctypes`?

| Reason | Detail |
| --- | --- |
| **YAGNI** | a few lines of numbers cross once per run; in-process speed buys nothing |
| **Debuggable** | each program runs alone: `collide.exe sweep` prints the same CSV Python sees |
| **No build scripts** | PyO3 needs a build step that Windows Smart App Control may block; a plain binary doesn't |
| **Isolation** | a crash in C++ is an error code in Python, not a dead interpreter |

**Same languages, opposite choice.** Teto needs in-process calls (60 fps
physics, Win32 hooks), and the math project doesn't, so it doesn't pay their
cost. Picking the *simplest* technique the requirement allows is the lesson.

## 9. Security at every boundary

Every boundary is a place where **input arrives from another program**. Treat
it as untrusted:

| Boundary | Risk | What the code does |
| --- | --- | --- |
| FFI | a wrong declaration corrupts memory | all `unsafe` in one file (`native.rs`), each with a `SAFETY:` comment; C compiled with warnings as errors |
| FFI callbacks | a panic unwinding into C | `catch_unwind` in the trampoline |
| wasm exports | out-of-range index from JS | bounds checks in every export |
| child processes | shell injection | argument lists (`exec.Command`, `subprocess.run([...])`), never a shell string |
| HTTP | other local programs or web pages calling in | loopback bind, random bearer token, Host header check |
| named pipe | another user's process connecting | `PipeOptions.CurrentUserOnly` (same Windows user only) and `FirstPipeInstance` (no one can grab the name first); one JSON line per connection. The line length isn't capped: accepted, since only your own processes can connect |
| any parser | huge or malformed input | size limits, and a parse error is answered, not crashed on |

Full threat model: [SECURITY.md](SECURITY.md).

## 10. Choosing a technique

```text
Does the call happen thousands of times a second, or need an OS/C API directly?
├─ yes → same process
│        ├─ both native (Rust, C, C++, Go via cgo)?  → FFI over the C ABI
│        └─ one side runs in a browser/WebView?      → WebAssembly
└─ no  → separate processes
         ├─ one request → one answer, then exit?      → run it, read stdout (math project)
         ├─ long-lived helper, one caller?            → stdin/stdout JSON Lines (mood engine)
         ├─ several callers, or a standard tool needed? → HTTP on 127.0.0.1 + token
         └─ Windows-only, no port wanted?             → named pipe
```

## 11. Exercises

1. Change `teto_idle_ms`'s Rust declaration to return `u64` (leave C as is). It still compiles. Why, and what could go wrong at run time?
2. Remove `flush=True` from `mood.py` and start Teto. What happens to the mood replies?
3. In `physics.ts`, why would `memory.grow()` inside the C++ break `Effects`? Find the comment that warns about it.
4. Add a `--json` flag to the math project's Rust binary and parse it in Python with `json.loads` instead of CSV. What did you gain, and what did you lose?
5. Draw Teto's processes and draw every link between them, labelled with its technique from §1.

**Self-check:** why must a Rust panic never unwind into a C function?

## References

### §1–3 ABI and FFI (official)

- The Rustonomicon: [FFI](https://doc.rust-lang.org/nomicon/ffi.html) ✔ (opaque types with `[u8; 0]`, callbacks, unwinding)
- The Rust Reference: [External blocks](https://doc.rust-lang.org/reference/items/external-blocks.html), [Type layout / `repr(C)`](https://doc.rust-lang.org/reference/type-layout.html)
- [The `cc` crate](https://docs.rs/cc/latest/cc/), [Cargo build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html)
- [`std::panic::catch_unwind`](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html)
- cppreference: [Language linkage (`extern "C"`)](https://en.cppreference.com/w/cpp/language/language_linkage)
- Python: [ctypes](https://docs.python.org/3/library/ctypes.html) (the same idea from Python)

### §4 WebAssembly

- MDN: [WebAssembly concepts](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Concepts), [`WebAssembly.Memory`](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory) ✔ (growing detaches the old buffer)
- [WebAssembly specification](https://webassembly.github.io/spec/core/)

### §5 Tauri

- Tauri: [Calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/), [Calling the frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)

### §6–7 Processes, pipes, framing

- Go: [os/exec](https://pkg.go.dev/os/exec); Python: [subprocess](https://docs.python.org/3/library/subprocess.html), [`-u` option](https://docs.python.org/3/using/cmdline.html#cmdoption-u) ✔
- Microsoft: [Named pipes](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipes)
- HTML Standard: [Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [JSON Lines](https://jsonlines.org/)

### Other explanations

- [PyO3 user guide](https://pyo3.rs/) (the in-process alternative §8 didn't pick)
- Michael Kerrisk, *The Linux Programming Interface*, ch. 44 "Pipes and FIFOs" (the same ideas on Linux)

### Further learning

- [Rust FFI Omnibus](https://jakegoulding.com/rust-ffi-omnibus/): small examples calling Rust from many languages
- [WebAssembly by example: Hello World in C](https://wasmbyexample.dev/examples/hello-world/hello-world.c.en-us.html)
- [Exercism Rust track](https://exercism.org/tracks/rust) (ownership practice before FFI)
