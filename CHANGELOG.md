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
- `docs/SECURITY_SCANNING.md`, `docs/SMART_APP_CONTROL.md`, a language effectiveness
  scorecard in `docs/LANGUAGES.md`, and verified further-learning links in every doc.
- Teto's voice from her official voicebank (C#), `docs/VOICE.md`.
- `main.py` runner and a Windows installer (`python main.py package`), `docs/PACKAGING.md`.
- Security scan on every change (`python main.py test security`), RCE review in `docs/SECURITY.md`.
- `docs/ANIMATION.md` (eye tracking, smoothing, oscillation, faces) and `docs/GLOSSARY.md`.
- New guides: `docs/MEMORY.md` (C/C++/Rust/GC memory management and other
  memory-safe languages), `docs/PARADIGMS.md` (procedural, OOP pillars,
  functional, data-oriented…), `docs/LANGUAGES.md` (strengths, weaknesses,
  who covers for whom, TypeScript vs JavaScript), `docs/MODULES_AND_LIBRARIES.md`,
  `docs/FILE_TYPES.md`, `assets/skins/README.md` (manifest reference).
- C++ particle system, C foreground-window API, Rust RAII wrapper, `apps` quirk.
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
