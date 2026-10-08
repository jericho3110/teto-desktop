# Changelog: rust/shell

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `ForegroundWindow`: RAII owner of the C snapshot (`NonNull` + `Drop`,
  borrowed `&str` tied to the owner's lifetime); `native://app` event with
  the program name only (never the window title).
- Tauri 2 shell: transparent, frameless, always-on-top window; `get_config`
  command; `native://cursor`, `native://idle`, `native://hotkey` events.
- FFI bindings to `c/win32hooks` (built by `build.rs` with the `cc` crate),
  with all `unsafe` in `native.rs` behind safe wrappers; a trampoline for
  C → Rust callbacks; panics stopped at the C boundary.
- Supervisor: 256-bit token from the OS, starts brain/reminders/companion
  with the token in their environment, logs to `%LOCALAPPDATA%\Teto\logs`,
  joins a kill-on-close job object first.

### Security
- Strict Content Security Policy; least-privilege capabilities.
- Tauri 2.12.1 (includes the fix for CVE-2026-42184).
