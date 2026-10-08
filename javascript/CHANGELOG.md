# Changelog: javascript/

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `apps` quirk: comments on the program you switch to (at most every 20 min).
- Quirks: `greetings` (time-of-day hello, late-night nag), `poke` (annoyed
  after 3 quick pokes), `sleepy` (wake-up line), `bread` (baguette love).
- `tools/ui_probe.mjs`: DevTools-Protocol UI probe with exact viewport.

### Changed
- Moved from `quirks/`, `tools/` to `javascript/quirks/`, `javascript/tools/`.
