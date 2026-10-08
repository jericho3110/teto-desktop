# Changelog: c/win32hooks

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `teto_foreground_window` / `teto_window_app` / `teto_window_title` /
  `teto_window_info_free`: an opaque heap object with documented ownership,
  UTF-16 → UTF-8 two-call conversion, and a 20,000-cycle leak check (12 checks).
- `teto_idle_ms`, `teto_cursor_pos`, `teto_hotkey_start/stop` (own thread +
  message loop), `teto_kill_children_on_exit` (job object). 7 checks; the
  real-keystroke check is opt-in (`TETO_TEST_INPUT=1`).
