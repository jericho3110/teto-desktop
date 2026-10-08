# Changelog: python/

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `main.py` + `tools/runner.py`: doctor, build, run, test, voice, package.
- `tools/security_scan.py`: dependency scanners, RCE/injection pattern sweep,
  invariants (no secrets, no voicebank in git, strict CSP); verified by planting
  bad code. Runs as `check_all.py security`.
- Safe zip extraction for the voicebank download (zip slip, Shift-JIS names), 4 tests.
- Mood engine (`mood/`): lexicon-based reply → emotion over JSON lines.
- Skin generator (`skin_gen/`): original chibi Teto-style SVG, 9 expressions.
- Tools: `smoke_brain.py` (live brain test), `check_links.py` (doc links).

### Changed
- Moved from `mood/`, `tools/` to `python/mood/`, `python/skin_gen/`, `python/tools/`.

### Fixed
- `check_links.py` no longer treats `http://<scheme>.localhost` prose as a link.
