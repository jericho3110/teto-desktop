# typescript/: the UI

| Component | What it is |
| --- | --- |
| [`ui/`](ui/) | everything you see: the skin loader, animator, speech bubble with permission cards, command bar, quirk loader. Runs inside the Rust/Tauri window (or a plain browser for development) |

**Why TypeScript:** it runs in the webview, and types catch protocol
mistakes: the `BrainEvent` union *is* the contract with the Go brain.

## Commands (in `typescript/ui`)

| Command | What it does |
| --- | --- |
| `npm install` | install Vite, TypeScript, the Tauri JS API, Node types |
| `npm run dev` | sync assets, then serve on <http://localhost:1420> (open `/?token=devtoken` with a dev brain running) |
| `npm run typecheck` | type-check everything (`tsc`) |
| `npm test` | 9 tests: animator logic + the skin sanitizer |
| `npm run build` | type-check and bundle to `dist/` (the Rust shell packages this) |

Visual checks without Tauri: `node javascript/tools/ui_probe.mjs "http://localhost:1420/?token=devtoken" shot.png`.

## Files in `ui/src`

| File | Job |
| --- | --- |
| `main.ts` | composition root: loads everything and wires events |
| `types.ts` | shared types: skin manifest, `BrainEvent` |
| `skin.ts` | the only code that knows SVG ids |
| `sanitize.ts` | allow-list sanitizer for skins |
| `face.ts` | pure decisions: which face/eyes/mouth now |
| `animator.ts` | the frame loop |
| `physics.ts` | wrapper around the C++ wasm |
| `brain.ts` | HTTP + SSE client for the Go brain |
| `bubble.ts`, `commandbar.ts` | the two widgets |
| `quirks.ts` | loads JavaScript quirks |

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every TypeScript/browser concept used
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the UI is put together
- [CHANGELOG.md](CHANGELOG.md)

## References

- TypeScript: <https://www.typescriptlang.org/docs/>
- Vite: <https://vite.dev/guide/>
