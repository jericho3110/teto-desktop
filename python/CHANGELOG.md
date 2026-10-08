# Changelog: python/

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Mood engine (`mood/`): lexicon-based reply → emotion over JSON lines.
- Skin generator (`skin_gen/`): original chibi Teto-style SVG, 9 expressions.
- Tools: `smoke_brain.py` (live brain test), `check_links.py` (doc links).

### Changed
- Moved from `mood/`, `tools/` to `python/mood/`, `python/skin_gen/`, `python/tools/`.

### Fixed
- `check_links.py` no longer treats `http://<scheme>.localhost` prose as a link.
