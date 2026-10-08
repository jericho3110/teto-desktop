# Changelog: c/win32hooks

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `teto_idle_ms`, `teto_cursor_pos`, `teto_hotkey_start/stop` (own thread +
  message loop), `teto_kill_children_on_exit` (job object). 7 checks; the
  real-keystroke check is opt-in (`TETO_TEST_INPUT=1`).
