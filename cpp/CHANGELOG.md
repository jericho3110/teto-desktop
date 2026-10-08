# Changelog: cpp/physics

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Particle effects (sparkle, heart, sweat, Zzz): arena allocator, object
  pool with a free list, struct-of-arrays memory shared zero-copy with JS,
  and an `Emitter` class hierarchy (Template Method + virtual dispatch).
  Second translation unit `particles.cpp`; 8 new tests (14 total).
- Spring-chain hair physics in freestanding C++20, compiled to a 1.4 KB
  WebAssembly module with no imports; 6 Node tests on the real `.wasm`.

### Changed
- Moved from `physics/` to `cpp/physics/`.

### Fixed
- Kept the particle pool in `.bss` (no default member initializers): the
  module shrank from 15 KB to 5.7 KB.
- `fx_step` before `fx_init` no longer dereferences null emitters.
- `npm run build` failed on a fresh clone because `dist/` didn't exist;
  a `prebuild` step now creates it.
