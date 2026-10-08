# Changelog: typescript/ui

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Permission cards show the brain's complete `detail`, not the shortened summary.
- Skins are sanitized with an allow-list (`sanitize.ts`): scripts, event
  handlers, `foreignObject`, links and external `url()` are removed.

### Added
- Skin loader, animator, speech bubble with permission cards, command bar,
  quirk loader, physics wrapper, brain client; 9 Node tests.

### Changed
- Moved from `app/` to `typescript/ui/`; the Rust part moved to `rust/shell/`.
- `scripts/sync-assets` is now TypeScript, run by Node's type stripping.
