# Rust concepts used in Teto

Every Rust concept and principle in `rust/shell/`: the Tauri window, the
FFI bridge to C, and the process supervisor.

## Contents

1. [Crates, modules and Cargo](#1-crates-modules-and-cargo)
2. [Ownership, moves and borrowing](#2-ownership-moves-and-borrowing)
3. [Box, fat pointers and the double box](#3-box-fat-pointers-and-the-double-box)
4. [Traits and derive](#4-traits-and-derive)
5. [Closures: Fn, move, Send + Sync + 'static](#5-closures-fn-move-send--sync--static)
6. [Option, Result and pattern matching](#6-option-result-and-pattern-matching)
7. [Shared state: Mutex, statics and Tauri State](#7-shared-state-mutex-statics-and-tauri-state)
8. [Threads](#8-threads)
9. [FFI: extern "C", unsafe and SAFETY comments](#9-ffi-extern-c-unsafe-and-safety-comments)
10. [Callbacks from C: the trampoline](#10-callbacks-from-c-the-trampoline)
11. [Panics never cross into C](#11-panics-never-cross-into-c)
12. [Child processes and platform-specific code](#12-child-processes-and-platform-specific-code)
13. [Macros and attributes](#13-macros-and-attributes)
14. [Build scripts (build.rs)](#14-build-scripts-buildrs)
15. [Tauri: commands, events, capabilities, CSP](#15-tauri-commands-events-capabilities-csp)
16. [Tooling: cargo fmt, clippy, test](#16-tooling-cargo-fmt-clippy-test)
17. [Principles applied](#17-principles-applied)
18. [Exercises](#18-exercises)
- [RAII over C memory: ForegroundWindow](#raii-over-c-memory-foregroundwindow)
19. [References](#references)

## 1. Crates, modules and Cargo

- A **crate** is a compilation unit; `Cargo.toml` describes the package
  `teto-shell`, its dependencies and two targets: a **library**
  (`teto_shell_lib`, all the code) and a **binary** (`main.rs`, one line
  calling `teto_shell_lib::run()`).
- `mod native;` in `lib.rs` pulls in `src/native.rs` as a module.
  Items are **private by default**; `pub` exports them.
- `mod ffi { ... }` inside `native.rs` is an inline module that keeps the
  raw C declarations hidden behind the safe wrappers.
- `Cargo.lock` pins exact versions of every (transitive) dependency, so
  builds are reproducible. For applications it's committed.

## 2. Ownership, moves and borrowing

Rust's core rule: **every value has exactly one owner**; when the owner
goes out of scope, the value is dropped (freed). No garbage collector, and
no manual `free`.

| Code | Concept |
| --- | --- |
| `let services = supervisor::start_all(&token, ...)` | `&token` **borrows**: `start_all` can read it, `run` still owns it |
| `Config { brain_url, token, ... }` | `token` is **moved** into the struct; using `token` afterwards is a compile error |
| `.manage(config)` | ownership moves into Tauri, which keeps it alive for the app's lifetime |
| `fn spawn(services: &mut Services, ...)` | a **mutable borrow**: one writer at a time, enforced at compile time |
| `config.inner().clone()` in `get_config` | an explicit copy, because the command can only borrow the managed state |

The borrow checker enforces *aliasing XOR mutation*: many readers or one
writer, never both. That rules out data races and use-after-free at
compile time. More in [docs/MEMORY.md](../../docs/MEMORY.md).

## 3. Box, fat pointers and the double box

`Box<T>` puts `T` on the heap with a single owner. `Box<dyn Fn()>` holds
"some closure" whose concrete type is erased; it's a **fat pointer**
(data pointer + vtable pointer = 2 words). C's `void*` is 1 word, so
`native.rs` boxes it again: `Box<Box<dyn Fn()>>` (named `Box<HotkeyFn>`)
is a thin pointer to the fat one, and *that* fits in `void*`.

## 4. Traits and derive

Traits are Rust's interfaces. Used here:

| Trait | Where | Meaning |
| --- | --- | --- |
| `Serialize` (serde) | `Config`, `CursorEvent`, `IdleEvent` | can be turned into JSON for the UI |
| `Clone`, `Copy` | `Config: Clone`, `CursorEvent: Copy` | explicit vs implicit (bitwise) copies |
| `PartialEq` | `CursorEvent` | `last_cursor != Some(ev)`: only emit when the cursor moved |
| `Default` | `Services` | `Services::default()` = empty |
| `Fn`, `Send`, `Sync` | hotkey closure | callable many times; may move to / be shared with another thread |
| `Emitter`, `Manager` (Tauri) | `lib.rs` | bring `.emit()` and `.get_webview_window()` into scope |
| `CommandExt` (std, Windows) | `supervisor.rs` | an **extension trait** adds `.creation_flags()` to `Command` |

`#[derive(...)]` generates the implementations at compile time.

## 5. Closures: Fn, move, Send + Sync + 'static

```rust
let hotkey_handle = handle.clone();
native::hotkey_start(MOD_CONTROL | MOD_ALT, VK_SPACE, move || {
    let _ = hotkey_handle.emit("native://hotkey", ());
});
```

- `move` makes the closure **own** its captures (`hotkey_handle`), so it can
  outlive the function that created it.
- The bound `impl Fn() + Send + Sync + 'static` in `hotkey_start` says: may be
  called repeatedly, from another thread, and holds no borrowed data that
  could expire. The compiler rejects closures that break any of these.

## 6. Option, Result and pattern matching

- `Option<T>` replaces null: `cursor_pos() -> Option<(i32, i32)>`;
  `(ok == 1).then_some((x, y))` builds one.
- `Result<T, E>` replaces exceptions: `child.kill()` returns a `Result` we
  inspect; `.expect("...")` panics with a message when failure is a bug.
- `let Some(win) = app.get_webview_window("main") else { continue };` is
  **let-else**: bind or bail out.
- `if let (Some(..), Ok(pos), Ok(scale)) = (...)` matches three results at once.

## 7. Shared state: Mutex, statics and Tauri State

- `static HOTKEY: Mutex<Option<...>> = Mutex::new(None);`: a global that's
  safe because every access goes through the lock (`Mutex::new` is `const`,
  so no lazy initialization is needed).
- `.manage(Mutex::new(services))` gives Tauri shared state; the exit handler
  reaches it with `app.state::<Mutex<Services>>()`.
- `.lock().unwrap()`: lock returns `Err` only if another thread panicked
  while holding it ("poisoning"); here that's a bug, so `unwrap` is fine.

## 8. Threads

`std::thread::spawn(move || loop { ... })` runs the native poller. The
closure must be `'static` and `Send`: it owns its `AppHandle` clone.
Rust guarantees at compile time that nothing non-thread-safe crosses over.

## 9. FFI: extern "C", unsafe and SAFETY comments

```rust
extern "C" { pub fn teto_cursor_pos(x: *mut i32, y: *mut i32) -> i32; }
let ok = unsafe { ffi::teto_cursor_pos(&mut x, &mut y) };   // SAFETY: …
```

- `extern "C"` declares functions with the C ABI; types must match the
  header exactly (`uint32_t` ↔ `u32`). The compiler **can't check** C, so
  calls are `unsafe`: *you* promise the contract holds.
- Every `unsafe` block has a `// SAFETY:` comment saying why it's sound,
  and each one is wrapped in a safe function (`cursor_pos`, `idle_ms`, …).
  The rest of the program never touches `unsafe`.

## 10. Callbacks from C: the trampoline

C can call a plain `extern "C" fn` but knows nothing about Rust closures.
So `hotkey_start` passes C two things: the function `trampoline` and a
`void*` to the boxed closure. When the hotkey fires, C calls
`trampoline(user)`, which casts the pointer back and calls the closure.
**Lifetime rule:** the closure is freed only *after* `teto_hotkey_stop()`
has joined the C thread, so C can never call into freed memory.

## 11. Panics never cross into C

Unwinding a Rust panic through C frames is undefined behavior.
`trampoline` wraps the call in `std::panic::catch_unwind(AssertUnwindSafe(f))`
so a panicking callback stops at the boundary.

## 12. Child processes and platform-specific code

- `Command::new(path).arg(..).env("TETO_TOKEN", token).spawn()`: arguments
  as a list, never a shell string, so no injection.
- `#[cfg(windows)] { ... }` compiles a block only on Windows; it sets
  `CREATE_NO_WINDOW` so helpers don't pop up consoles.
- `Child::kill` + `wait` stops and reaps each helper on exit; the C job
  object is the safety net for crashes.

## 13. Macros and attributes

| Macro / attribute | Meaning |
| --- | --- |
| `println!`, `eprintln!`, `format!` | formatted output / strings (checked at compile time) |
| `env!("CARGO_MANIFEST_DIR")` | a **compile-time** environment variable: the crate's folder |
| `tauri::generate_handler![get_config]` | builds the IPC dispatcher for commands |
| `tauri::generate_context!()` | embeds `tauri.conf.json`, capabilities and assets at compile time |
| `#[tauri::command]` | turns a function into an IPC command |
| `#[serde(rename_all = "camelCase")]` | `brain_url` → `brainUrl` in JSON |
| `#[cfg(test)] mod tests` | compiled only for `cargo test` |
| `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` | release builds don't open a console |

## 14. Build scripts (build.rs)

Cargo compiles and runs `build.rs` before the crate. Ours compiles
`c/win32hooks` with the `cc` crate into a static library, tells the linker
to add `user32.lib`, declares `rerun-if-changed` so edits to the C files
trigger a rebuild, and lets `tauri_build` generate code from the config.
**Found live:** Windows Smart App Control blocks running these freshly
built build scripts, and OneDrive folders make `autocfg` think the output
directory isn't writable. That's why `CARGO_TARGET_DIR` points outside OneDrive.

## 15. Tauri: commands, events, capabilities, CSP

| Piece | File | Role |
| --- | --- | --- |
| command `get_config` | `lib.rs` | TS → Rust request/response |
| events `native://cursor`, `idle`, `hotkey` | `lib.rs` | Rust → TS push |
| `tauri.conf.json` | config | window (transparent, frameless, always on top), dev/build commands, **CSP** |
| `capabilities/default.json` | permissions | the UI may only drag, focus and toggle click-through on its own window |
| `gen/schemas/` | generated | JSON Schemas so editors can autocomplete/validate the two files above (not committed) |

## 16. Tooling: cargo fmt, clippy, test

```powershell
$env:CARGO_TARGET_DIR = "$env:LOCALAPPDATA\Teto\cargo-target"   # keep GBs of build output out of OneDrive
cargo fmt --check                              # formatting
cargo clippy --all-targets -- -D warnings      # linter; warnings fail the build
cargo test                                     # 4 tests (FFI + supervisor)
cargo run                                      # debug build, loads the UI from Vite (npm run dev)
```

Clippy caught a needlessly complex type (now `type HotkeyFn`) and a
redundant closure.

## 17. Principles applied

| Principle | Where |
| --- | --- |
| **Make illegal states unrepresentable** | `Option` instead of null; ownership instead of manual frees |
| **Encapsulate unsafety** | all `unsafe` in `native.rs`, each with a SAFETY comment and a safe wrapper |
| **RAII** | values free themselves when their owner ends; `MutexGuard` unlocks on drop |
| **Least privilege** | Tauri capabilities, strict CSP |
| **Fail safe** | missing helpers skipped, panics stopped at the C boundary |
| **Composition root** | `lib.rs: run` wires everything |

## 18. Exercises

1. Make `Services` implement `Drop` so helpers stop automatically. What
   happens to the exit handler?
2. Restart a helper that crashed (`child.try_wait()` in the poller thread).
3. Self-check: what would go wrong if `hotkey_stop` set `*slot = None` *before*
   calling `teto_hotkey_stop()`?

## RAII over C memory: ForegroundWindow

`native.rs: ForegroundWindow` owns a heap object allocated by C and shows
Rust's memory rules guarding someone else's memory (more in
[docs/MEMORY.md](../../docs/MEMORY.md#rust-ownership-borrowing-lifetimes)):

| Concept | Code |
| --- | --- |
| opaque FFI type | `#[repr(C)] pub struct WindowInfo { _private: [u8; 0] }` |
| `NonNull<T>`: a raw pointer that can't be null | `NonNull::new(raw).map(\|ptr\| Self { ptr })`, null becomes `None` |
| `Drop` = RAII | `impl Drop for ForegroundWindow` calls `teto_window_info_free` exactly once |
| no `Clone` | two owners would double-free |
| lifetime elision ties a borrow to its owner | `fn app(&self) -> &str`: can't outlive the snapshot |
| an `unsafe fn` with a `# Safety` contract | `borrow_c_str` |
| `CStr::from_ptr(..).to_str()` | C string → `&str`, invalid UTF-8 becomes `""` |
| borrowed → owned | `fg.app().to_owned()` before `fg` is dropped |
| `#[cfg_attr(not(test), allow(dead_code))]` | `title()` exists for tests/learning, never sent to the UI |

## References

### Official

- The Rust Programming Language (the Book): <https://doc.rust-lang.org/book/>
- Ownership: <https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html>
- The Rustonomicon, FFI: <https://doc.rust-lang.org/nomicon/ffi.html>
- `std::panic::catch_unwind`: <https://doc.rust-lang.org/std/panic/fn.catch_unwind.html>
- Cargo build scripts: <https://doc.rust-lang.org/cargo/reference/build-scripts.html>
- Clippy lints: <https://rust-lang.github.io/rust-clippy/master/>
- Tauri, calling Rust from the frontend: <https://v2.tauri.app/develop/calling-rust/>
- Tauri, capabilities: <https://v2.tauri.app/security/capabilities/>
- Tauri, CSP: <https://v2.tauri.app/security/csp/>
- `cc` crate: <https://docs.rs/cc/>

### Other

- Rust by Example: <https://doc.rust-lang.org/rust-by-example/>
