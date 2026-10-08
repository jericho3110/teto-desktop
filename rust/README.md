# rust/: the desktop shell

| Component | What it is |
| --- | --- |
| [`shell/`](shell/) | `teto-shell.exe`: the transparent, frameless, always-on-top window (Tauri) that shows the TypeScript UI; starts and stops every helper; bridges to the C Win32 module via FFI |

**Why Rust:** a small native window using the OS webview, memory safety
without a garbage collector, and first-class C interop.

## Build and run (in `rust/shell`)

```powershell
# Once per terminal: build output outside OneDrive (it's several GB, and
# OneDrive folders break some build scripts; see docs/CONCEPTS.md §14)
$env:CARGO_TARGET_DIR = "$env:LOCALAPPDATA\Teto\cargo-target"

cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test                    # 4 tests
cargo tauri dev               # starts Vite + the app (needs: cargo install tauri-cli)
# or, without the Tauri CLI:  (cd ../../typescript/ui; npm run dev)  then  cargo run
```

Before running, build the helpers once (see the root README): the shell
starts `go/brain/bin/teto-brain.exe`, `java/reminders/out`, and
`csharp/Companion/bin/Release/.../TetoCompanion.exe` if they exist.

> **Smart App Control** must be off to *build* Rust crates with build
> scripts. It can be turned back on afterwards.

## Files

| File | Role |
| --- | --- |
| `src/main.rs` | entry point: calls `teto_shell_lib::run()` |
| `src/lib.rs` | the app: config, commands, native pollers, exit handling |
| `src/native.rs` | safe wrappers around the C module (all `unsafe` lives here) |
| `src/supervisor.rs` | token, starting/stopping helpers, logs |
| `build.rs` | compiles the C module, then Tauri's code generation |
| `tauri.conf.json` | window, dev/build commands, Content Security Policy |
| `capabilities/default.json` | what the UI is allowed to do |
| `Cargo.toml` / `Cargo.lock` | dependencies / exact pinned versions |
| `icons/` | app icons (still Tauri's defaults) |

## Security

- `cargo audit` (RustSec advisory database) is run before releases; see
  [docs/SECURITY.md](../docs/SECURITY.md).
- Tauri ≥ 2.10.3 fixes CVE-2026-42184 (remote URLs treated as local on
  Windows); `Cargo.lock` pins a fixed version.

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every Rust concept used
- [CHANGELOG.md](CHANGELOG.md)

## References

- Tauri 2: <https://v2.tauri.app/>
- The Cargo Book: <https://doc.rust-lang.org/cargo/>
