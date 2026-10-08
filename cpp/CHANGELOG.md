# Changelog: cpp/physics

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Spring-chain hair physics in freestanding C++20, compiled to a 1.4 KB
  WebAssembly module with no imports; 6 Node tests on the real `.wasm`.

### Changed
- Moved from `physics/` to `cpp/physics/`.

### Fixed
- `npm run build` failed on a fresh clone because `dist/` didn't exist;
  a `prebuild` step now creates it.
