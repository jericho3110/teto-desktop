# Changelog: typescript/vscode (Teto Buddy)

## [0.1.0] - 2026-10-10

### Added
- A VS Code extension that shows Teto in the Explorer sidebar, reusing the desktop UI's skin, animator, wasm drill physics and particles. She reacts to typing, saving, errors appearing and being fixed, and 5 minutes of idleness; clicking her makes her bounce. Command **Teto: Wave**.
- `webview/messages.ts`: the host-to-webview message types with an allow-list validator. 3 tests.
- `scripts/pack_vsix.py`: builds the `.vsix` with Python's `zipfile` (no `vsce`), outside OneDrive, and checks its contents.

### Security
- A strict webview Content-Security-Policy (`default-src 'none'`, a nonce'd script, `wasm-unsafe-eval` only for the physics, files only from the extension), `localResourceRoots` limited to `out/`, `media/` and `static/`, and no network access.
