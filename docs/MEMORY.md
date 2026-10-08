# Memory management, from C to Rust (and everything in between)

How each of Teto's languages gets and gives back memory, applied to
real features: C hands a heap object across an API, C++ runs a particle
pool inside WebAssembly, Rust wraps C memory so it can't leak or dangle,
and the garbage-collected languages show what they do for you (and what
they don't).

## Contents

1. [Where memory lives: stack, heap, static](#where-memory-lives-stack-heap-static)
2. [The five classic memory bugs](#the-five-classic-memory-bugs)
3. [C: manual memory, made explicit](#c-manual-memory-made-explicit)
4. [C++: RAII, arenas, pools and data layout](#c-raii-arenas-pools-and-data-layout)
5. [WebAssembly linear memory: sharing bytes with JavaScript](#webassembly-linear-memory-sharing-bytes-with-javascript)
6. [Rust: ownership, borrowing, lifetimes](#rust-ownership-borrowing-lifetimes)
7. [Garbage-collected languages: Go, Java, C#, Python, JS](#garbage-collected-languages-go-java-c-python-js)
8. [Which language prevents which bug](#which-language-prevents-which-bug)
9. [Other languages with strict memory systems](#other-languages-with-strict-memory-systems)
10. [Exercises](#exercises)
11. [References](#references)

## Where memory lives: stack, heap, static

```text
┌──────────────── a process's memory ────────────────┐
│ static / global   lives for the whole program        │  g_store, g_arena_bytes (C++), HOTKEY (Rust)
│ heap              you ask for it, you give it back   │  malloc'ed teto_window_info (C), Box (Rust)
│   ...                                                 │
│ stack             automatic: one frame per call;      │  wchar_t title[512] (C), let (mut x, mut y) (Rust)
│                   freed when the function returns     │
└──────────────────────────────────────────────────────┘
```

| | Stack | Heap | Static |
| --- | --- | --- | --- |
| Allocation | automatic, very fast | explicit (`malloc`, `new`, `Box::new`) or by the runtime | at program start (or compile time) |
| Freed | when the function returns | when you (or the GC / owner) free it | never (program end) |
| Size | small (MBs), fixed per thread | as big as RAM | fixed at compile time |
| Teto example | `wchar_t path[MAX_PATH*4]` in `teto_foreground_window` | the `teto_window_info` it returns | the C++ particle pool |

**The key rule:** anything that must outlive the function that created it
can't live on that function's stack. `teto_foreground_window` reads the
title into a stack buffer, then **copies** it to the heap before returning.

## The five classic memory bugs

| Bug | What happens | Example of the mistake |
| --- | --- | --- |
| **Leak** | memory never freed; the program grows until it dies | forgetting `teto_window_info_free` |
| **Use-after-free** | reading memory that was given back (garbage, or an attacker's data) | keeping `teto_window_app(info)` after freeing `info` |
| **Double free** | freeing twice corrupts the allocator | two owners both calling free |
| **Buffer overflow** | writing past the end of a buffer: the #1 source of security holes | copying a long title into a short array |
| **Data race** | two threads touch the same memory, one writing, no lock | the hotkey thread and the UI thread sharing the callback |

Roughly 70% of the serious security bugs in large C/C++ codebases (Microsoft's
and Chrome's figures) are memory-safety bugs. That's why the industry is
moving toward memory-safe languages, and why Teto keeps C and C++ small and fenced in.

## C: manual memory, made explicit

C gives you `malloc` (allocate), `calloc` (allocate zeroed), `free` (give
back), and no help. Safety comes from **conventions you write down**.
`c/win32hooks` shows the important ones:

| Technique | Where | What it prevents |
| --- | --- | --- |
| **Documented ownership** in the header: "the CALLER owns the result and must release it exactly once with `teto_window_info_free()`" | `teto_win32.h` | leaks, double frees |
| **Opaque type**: callers only get a `teto_window_info *`; the fields are private to the `.c` file | `struct teto_window_info` | callers freeing the inner strings themselves |
| **Paired create/free functions** (no "call `free()` on this") | `teto_foreground_window` / `teto_window_info_free` | mismatched allocators across DLL boundaries |
| **Two-call sizing**: ask `WideCharToMultiByte` for the size, allocate exactly that (+1 for `'\0'`), then fill | `utf8_from_wide` | buffer overflows |
| **Bounded copies**: `GetWindowTextW(hwnd, title, 512)` never writes past 512 | `teto_foreground_window` | buffer overflows |
| **`calloc` + free-on-error**: a half-built object has NULL pointers, and `free(NULL)` is a no-op, so cleanup is always safe | `teto_foreground_window` | leaks on error paths |
| **NULL-safe free** | `teto_window_info_free(NULL)` | crashes in cleanup code |
| **Measure it**: allocate/free 20,000 snapshots and compare the process's private memory | `tests/test_teto_win32.c` | leaks (result: 36 KB growth = allocator bookkeeping; a leak would be 600 KB+) |

**Strings in C** are just `char` arrays ending in `'\0'`. Windows uses
UTF-16 (`wchar_t`); the rest of Teto uses UTF-8, so the C module converts at
the boundary.

## C++: RAII, arenas, pools and data layout

C++ adds **constructors and destructors**, which enable its central idea:
**RAII** (Resource Acquisition Is Initialization): tie a resource's
lifetime to an object's scope, so the destructor releases it
automatically, even on early returns. In normal C++ that's
`std::vector`, `std::string`, `std::unique_ptr<T>` (single owner, freed
automatically), `std::shared_ptr<T>` (reference-counted).

Our physics is **freestanding WebAssembly** (no standard library, no
`malloc`), so `cpp/physics` builds the low-level tools those types are
made of:

| Technique | Where | Concept |
| --- | --- | --- |
| **Static storage** | `g_store`, `g_arena_bytes` in `particles.cpp` | memory reserved once, lives forever, no allocator needed |
| **Arena (bump) allocator** | `teto::Arena` in `memory.hpp` | allocation = round up to the alignment + move a pointer, O(1); free *everything* at once with `reset()` |
| **Alignment** | `alignas(16)`, `(used_ + align - 1) & ~(align - 1)` | each type must sit at an address divisible by its alignment |
| **Placement new** | `new (mem) T(args...)` in `Arena::create` | construct an object in memory you already own (no allocation) |
| **Deleted copy operations** | `Arena(const Arena&) = delete;` | two arenas handing out the same bytes can't happen: it won't compile |
| **Object pool + free list** | `fx::Store` in `particles.hpp` | fixed-capacity slots; `acquire`/`release` are O(1) pushes/pops on a linked list threaded through `next_free[]`; no fragmentation; when full, spawning just fails |
| **Struct of Arrays (SoA)** | `float x[N], y[N], …` instead of `Particle p[N]` | each field is contiguous: cache-friendly loops, and each array can be shared with JS as one typed array |
| **`constinit` + `constexpr` constructor** | `constinit Arena g_arena{...}` | the global is built at **compile time**: no startup code |
| **Trivially-destructible objects in an arena** | emitters | `reset()` never runs destructors, so objects there must own nothing |
| **`.bss` vs `.data`** (found by measuring) | `fx::Store` has *no* default member initializers | an all-zero global costs 0 bytes in the file (`.bss`); one non-zero field forced all ~9 KB into the `DATA` section (15 KB → 5.7 KB after the fix) |

**Arena vs pool vs `malloc`:**

| | Arena | Pool | `malloc`/`new` |
| --- | --- | --- | --- |
| Allocate | bump a pointer | pop the free list | search free blocks |
| Free one object | ❌ (only all at once) | ✅ push to the free list | ✅ |
| Object sizes | any | one fixed size | any |
| Fragmentation | none | none | yes, over time |
| Teto uses it for | emitters (live as long as the system) | particles (constantly born and dying) | nothing (wasm has no allocator here) |

## WebAssembly linear memory: sharing bytes with JavaScript

A wasm module has one **linear memory**: a flat array of bytes. A C++
pointer inside wasm is just a byte offset into it. JavaScript can see the
same bytes:

```ts
// typescript/ui/src/physics.ts
this.py = new Float32Array(x.memory.buffer, x.fx_field(1), n);   // a VIEW, not a copy
```

Every frame C++ writes particle positions and JavaScript reads them
through the same view, with **zero copying** (tested in
`particles.test.mjs`). The catch: if wasm memory **grows**, the old
`ArrayBuffer` is *detached* and every view becomes empty. Our C++ never
allocates, so memory never grows; a test pins that too. The sandbox also
matters for safety: wasm code can only touch its own linear memory, so even a
C++ bug there can't corrupt the rest of the app.

## Rust: ownership, borrowing, lifetimes

Rust prevents all five classic bugs **at compile time**, without a
garbage collector:

| Rule | Prevents | In Teto |
| --- | --- | --- |
| **One owner per value**; freed when the owner goes out of scope (`Drop`) | leaks, double frees | `ForegroundWindow` frees the C snapshot in `drop()`, exactly once |
| **Moves**: assigning or passing transfers ownership; the old variable is unusable | use-after-move | `token` moved into `Config` |
| **Borrowing**: `&T` (many readers) XOR `&mut T` (one writer) | data races, iterator invalidation | `start_all(&token, …)`, `spawn(&mut services, …)` |
| **Lifetimes**: a borrow can't outlive its owner | use-after-free, dangling pointers | `ForegroundWindow::app(&self) -> &str`: the string is tied to the snapshot, so using it after the snapshot is dropped won't compile |
| **Bounds checks** on slices and arrays | buffer overflows | (all indexing) |
| **`Send`/`Sync`**: the compiler checks what may cross threads | data races | the hotkey closure must be `Send + Sync + 'static` |
| **No `Clone` on owners of raw resources** | double free | `ForegroundWindow` deliberately isn't `Clone` |
| **`NonNull<T>`** | null dereference | the snapshot pointer is non-null by construction (`Option` handles "none") |

The compiler can't check C, so FFI calls are `unsafe`, and Teto confines
them to `native.rs`, each with a `// SAFETY:` explanation, behind safe
functions. This shows the real-world pattern: **unsafe at the edges, safe
in the middle**.

```rust
let name = match ForegroundWindow::now() {   // `fg` owns C memory
    Some(fg) => fg.app().to_owned(),         // copy the borrowed &str into an owned String
    None => String::new(),
};                                           // fg dropped at the end of its arm → teto_window_info_free
// using fg.app() here would be a compile error: fg no longer exists
```

## Garbage-collected languages: Go, Java, C#, Python, JS

These languages free memory **for you**: a garbage collector (GC) finds
objects nothing points to and reclaims them. No leaks of unreachable
objects, no use-after-free, no double free.

| Language | How | Teto detail |
| --- | --- | --- |
| Go | concurrent tracing GC | goroutine stacks start at a few KB and grow as needed |
| Java | tracing GC (generational) | virtual threads are tiny heap objects, not OS threads |
| C# | tracing GC (generational) | `IDisposable` for non-memory resources |
| Python | **reference counting** + a cycle collector | an object is freed the moment its last reference goes |
| JS/TS | tracing GC | wasm memory is *not* GC'd: it's one big buffer the module manages itself |

**But GC only manages memory.** Files, pipes, sockets, locks, OS handles
and processes still need **deterministic cleanup**, and every GC language
has a construct for it:

| Language | Construct | In Teto |
| --- | --- | --- |
| Go | `defer` | `defer c.mu.Unlock()`, `defer resp.Body.Close()` |
| Java | try-with-resources | `try (OutputStream os = ex.getResponseBody())` |
| C# | `using` / `IDisposable` | `await using var pipe = ...`, `TrayApp.Dispose` |
| Python | `with` | `with urllib.request.urlopen(...) as stream` |
| JS | `finally` (and the newer `using`) | `ui_probe.mjs` kills the browser in `finally` |

GC languages *can* still leak by keeping references you forgot about (an
ever-growing map, an event listener never removed). Teto's Go `Hub`
removes subscribers with `defer unsubscribe()` for exactly that reason.

## Which language prevents which bug

| Bug | C | C++ | Rust | Go/Java/C#/JS | Python |
| --- | --- | --- | --- | --- | --- |
| Leak | ❌ discipline | ✅ with RAII | ✅ ownership (leaks possible only deliberately) | ✅ for unreachable objects | ✅ (cycles via collector) |
| Use-after-free | ❌ | ⚠️ RAII helps, raw pointers don't | ✅ compile time | ✅ | ✅ |
| Double free | ❌ | ⚠️ `unique_ptr` helps | ✅ | ✅ | ✅ |
| Buffer overflow | ❌ | ⚠️ `.at()`/span, not by default | ✅ bounds checks | ✅ bounds checks | ✅ |
| Data race | ❌ | ❌ | ✅ compile time | ⚠️ runtime detectors (Go `-race`) | ⚠️ GIL hides some |
| Runtime cost | none | none | none (checks at compile time) | GC pauses + memory overhead | interpreter + refcounts |

## Other languages with strict memory systems

You asked whether Rust's strict model is unique. Its ownership model is the
best-known, but several languages make memory safety a compile-time
guarantee (or try to), each in its own way:

| Language | Approach | Status |
| --- | --- | --- |
| **Swift** | automatic reference counting (ARC) + compile-time **exclusivity** checks; Swift 6 adds compile-time data-race checking and `~Copyable` (move-only) types | production (Apple platforms, also Linux/Windows) |
| **Ada / SPARK** | strong typing and runtime checks; SPARK adds **formal proofs** of no overflow and no invalid access, plus Rust-like pointer ownership | production (aviation, rail, defense) |
| **Mojo** | Python-like syntax with Rust-style **ownership and borrow checking** | young, AI/performance-focused |
| **Pony** | **reference capabilities** in the type system: data-race freedom proven at compile time; actor-based | niche |
| **Vale** | **generational references**: each pointer checks a generation number, so use-after-free is caught without a borrow checker | experimental |
| **Hylo** (formerly Val) | **mutable value semantics**: no shared mutable references at all | experimental |
| **Austral** | **linear types**: every resource must be used exactly once, so forgetting to free is a compile error | experimental |
| **D** | `@safe` subset; `@live` functions use an ownership/borrowing checker | production language, optional checker |
| **Cyclone** | region-based memory for a C dialect | historical (2000s); its ideas inspired Rust |
| **C++** | smart pointers + RAII by convention; "profiles"/lifetime-safety proposals | not memory-safe by default |
| **Zig** | *not* memory-safe, but explicit allocators everywhere and safety checks in debug builds | production-ish, a "better C" |

The common thread: make the **compiler** (or the type system) responsible
for lifetimes instead of programmer discipline.

## Exercises

1. **C:** comment out `free(info->title)` in `teto_window_info_free` and run
   the C tests. How many KB does the leak check report now?
2. **C++:** add a non-zero default (`int alive = 0;` → `= 1;`) to `fx::Store`,
   rebuild, and compare `llvm-objdump -h dist/physics.wasm` before/after.
3. **C++:** change the pool to an array of structs (`Particle p[N]`). What
   breaks in the TypeScript zero-copy views, and how would you fix it?
4. **Rust:** in a test, store `fg.app()` in a variable declared *outside*
   the block where `fg` lives. Read the compiler error: which rule does it cite?
5. **Self-check:** why is the Go `Hub` careful to unsubscribe, even though Go has a garbage collector?

## References

### Official

- cppreference, C dynamic memory management (`malloc`, `calloc`, `free`): <https://en.cppreference.com/w/c/memory>
- cppreference, RAII: <https://en.cppreference.com/w/cpp/language/raii>
- cppreference, placement new: <https://en.cppreference.com/w/cpp/language/new#Placement_new>
- cppreference, `constinit`: <https://en.cppreference.com/w/cpp/language/constinit>
- cppreference, `std::unique_ptr`: <https://en.cppreference.com/w/cpp/memory/unique_ptr>
- Microsoft, `WideCharToMultiByte` (two-call sizing): <https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte>
- Microsoft, `GetProcessMemoryInfo`: <https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo>
- MDN, `WebAssembly.Memory` (growth detaches buffers): <https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory>
- The Rust Book, ownership, references and lifetimes: <https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html>
- The Rustonomicon, opaque types in FFI: <https://doc.rust-lang.org/nomicon/ffi.html#representing-opaque-structs>
- `std::ptr::NonNull`: <https://doc.rust-lang.org/std/ptr/struct.NonNull.html>
- Go, a guide to the garbage collector: <https://go.dev/doc/gc-guide>
- .NET, fundamentals of garbage collection: <https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals>
- Python, `gc` module (reference counting + cycle collector): <https://docs.python.org/3/library/gc.html>
- Swift, memory safety: <https://docs.swift.org/swift-book/documentation/the-swift-programming-language/memorysafety/>
- SPARK user's guide: <https://docs.adacore.com/spark2014-docs/html/ug/>
- Mojo, ownership: <https://docs.modular.com/mojo/manual/values/ownership>
- Pony, reference capabilities: <https://tutorial.ponylang.io/reference-capabilities/>
- Vale, generational references: <https://vale.dev/>
- Hylo: <https://www.hylo-lang.org/>
- Austral: <https://austral-lang.org/>
- D, ownership and borrowing (`@live`): <https://dlang.org/spec/ob.html>
- Zig, memory and allocators: <https://ziglang.org/documentation/master/#Memory>

### Other

- Microsoft Security Response Center, *A proactive approach to more secure code* (~70% memory safety): <https://msrc.microsoft.com/blog/2019/07/a-proactive-approach-to-more-secure-code/>
- Chromium, memory safety (~70% of high-severity bugs): <https://www.chromium.org/Home/chromium-security/memory-safety/>
- CISA et al., *The Case for Memory Safe Roadmaps*: <https://www.cisa.gov/resources-tools/resources/case-memory-safe-roadmaps>
- Ryan Fleury, *Untangling Lifetimes: The Arena Allocator*: <https://www.rfleury.com/p/untangling-lifetimes-the-arena-allocator>
- Mike Acton, *Data-Oriented Design and C++* (CppCon 2014): <https://www.youtube.com/watch?v=rX0ItVEVjHc>
