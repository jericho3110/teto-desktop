# Changelog: typescript/ui

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Permission cards show the brain's complete `detail`, not the shortened summary.
- Skins are sanitized with an allow-list (`sanitize.ts`): scripts, event
  handlers, `foreignObject`, links and external `url()` are removed.

### Added
- Particle layer: `Effects` reads the C++ particle arrays through typed-array
  views (zero copy) and `FxLayer` paints them on a canvas; effects start
  and stop when her face changes. One wasm instance serves hair + particles.
- `native://app` forwarded to quirks as the `app` event.
- Skin loader, animator, speech bubble with permission cards, command bar,
  quirk loader, physics wrapper, brain client; 9 Node tests.

### Changed
- Moved from `app/` to `typescript/ui/`; the Rust part moved to `rust/shell/`.
- `scripts/sync-assets` is now TypeScript, run by Node's type stripping.
