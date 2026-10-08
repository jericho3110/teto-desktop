# Changelog

Workspace-level changes. Each language folder has its own
`CHANGELOG.md` for its component. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Repository reorganized into one folder per language** (`c/ cpp/
  csharp/ go/ java/ javascript/ python/ rust/ typescript/`), with art in
  `assets/` and workspace docs in `docs/`.

### Added
- Java reminder service, C Win32 module, C# companion (tray,
  notifications, voice), Rust/Tauri shell with process supervisor.
- `docs/SECURITY.md`: threat model, defenses, security review.
- A `docs/CONCEPTS.md` per language explaining every concept and principle used.
- `python/tools/check_all.py`: one command runs every language's checks.
- MIT `LICENSE`.

### Security
- Security review before publishing: 12 findings fixed, each with a
  regression test (see `docs/SECURITY.md`).

## [0.1.0-dev] - 2026-10-08

### Added
- First thin slice: Go brain, Python mood engine, C++ hair physics,
  TypeScript UI, JavaScript quirks, original chibi skin, docs.

## References

- Keep a Changelog 1.1.0: <https://keepachangelog.com/en/1.1.0/>
- Semantic Versioning 2.0.0: <https://semver.org/spec/v2.0.0.html>
