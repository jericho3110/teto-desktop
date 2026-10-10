# Teto Buddy (VS Code extension)

Teto lives in VS Code's Explorer sidebar. It's the same chibi Teto as the
desktop app, running the same code: she blinks, breathes, follows your mouse
with her eyes, her drills swing with the C++ spring physics (WebAssembly), and
she reacts to what you do in the editor.

| You do | Teto |
| --- | --- |
| type in a file | makes her thinking face while you type |
| save | smiles (hearts) |
| a new error appears | gets worried (sweat drop) |
| all errors are fixed | gets excited (sparkles) |
| nothing for 5 minutes | falls asleep (zzz) |
| come back | wakes up and waves |
| click her | bounces and smiles |
| **Teto: Wave** (Command Palette) | waves |

## Contents

- [Build and install](#build-and-install)
- [How it works](#how-it-works)
- [Layout](#layout)
- [Checks](#checks)
- [Docs](#docs)
- [References](#references)

## Build and install

```bash
cd cpp/physics && npm run build          # once: builds physics.wasm, which Teto Buddy copies
cd ../../typescript/vscode
npm install --ignore-scripts             # dev tools only; nothing runs at install time
npm run package                          # build + pack -> %LOCALAPPDATA%\Teto\vsix\jericho3110.teto-buddy-0.1.0.vsix
code --install-extension "%LOCALAPPDATA%\Teto\vsix\jericho3110.teto-buddy-0.1.0.vsix" --force
```

Then reload VS Code (**Developer: Reload Window**) and open the Explorer: Teto
is in the **Teto** section. Drag the section's border to give her more room.

| Command | What it does |
| --- | --- |
| `npm run sync-assets` | copies the skin and `physics.wasm` into `media/` (build output) |
| `npm run build` | sync-assets, then type-checks and compiles the host (`tsc`), type-checks the webview, and bundles it (`vite build`) |
| `npm test` | tests the message validation (`node --test`) |
| `npm run package` | build, then `scripts/pack_vsix.py` zips everything into a `.vsix` |
| `code --install-extension <vsix> --force` | installs it; `--force` replaces an older build |

## An animated Teto sticker for the Doki Theme

The Doki Theme can show a sticker in the corner of the editor. Its own
characters are static pictures; `npm run sticker` makes an **animated** Teto
instead (drills sway joint by joint, ahoge wiggles, head tilts, blinks, bobs)
at `%LOCALAPPDATA%\Teto\sticker\teto-animated.svg`. Point the Doki setting at it
(in JSON every backslash is written twice):

```jsonc
"doki.sticker.path": "C:\\Users\\<you>\\AppData\\Local\\Teto\\sticker\\teto-animated.svg"
```

Doki notices the change and installs the sticker by itself (it edits VS Code's
CSS, so VS Code asks to restart and shows an "Unsupported" warning). Remove it
with **Doki-Theme: Remove Sticker/Background**.

**Why an SVG can animate safely here:** an SVG used as an image may run its
built-in animations (SMIL `<animate>`, `<animateTransform>`) but never scripts.
The generator checks that the output has no `<script>`.

## How it works

```text
 VS Code (extension host process, Node.js)          Explorer sidebar (webview: a sandboxed web page)
 ───────────────────────────────────────            ─────────────────────────────────────────────────
 src/extension.ts                                     webview/main.ts
   onDidChangeTextDocument → {type:"typing"}  ──postMessage──►  parseMessage() → animator.setThinking()
   onDidSaveTextDocument   → {emote:"happy"}                    animator.emote("happy")
   onDidChangeDiagnostics  → worried / excited                  ...
   idle timer (5 min)      → {sleep:true}                       animator.sleep(true)
                                                      reuses ../ui/src: Skin, Animator,
                                                      HairPhysics + Effects (C++ → wasm), FxLayer
```

- **Two worlds, one message channel.** The extension (Node.js, has the VS Code API, can't draw) and the webview (a browser page, can draw, has no VS Code API) only talk through `postMessage`. That's the same "separate processes, JSON messages" idea as the rest of Teto ([docs/INTEROP.md](../../docs/INTEROP.md)).
- **Reuse, not copy.** `webview/main.ts` imports the desktop UI's modules directly; Vite bundles them into one 10.6 kB `out/webview.js`. The skin and physics stay exactly the same code as the desktop app.
- **Packaging without vsce.** A `.vsix` is a zip with an `extension.vsixmanifest`, a `[Content_Types].xml`, and the extension under `extension/`. `scripts/pack_vsix.py` writes it with Python's `zipfile` and checks the result.

Details: [docs/CONCEPTS.md](docs/CONCEPTS.md).

## Layout

```text
package.json          the extension manifest: the view, the command, activation, build scripts
src/extension.ts      host side: editor events → messages; builds the page and its security policy
webview/main.ts       page side: loads skin + physics, runs the animator, obeys messages
webview/messages.ts   the message types and their validation (shared by both sides)
static/webview.css    page layout
scripts/              sync-assets.mjs (copy skin + wasm), pack_vsix.py (build the .vsix)
out/, media/          build output (git-ignored)
```

## Checks

Part of the repo gate (`python python/tools/check_all.py`, component `vscode`):
`npm run build` (type-checks both sides) and `npm test` (3 tests).

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every VS Code API, TypeScript and packaging concept used
- [CHANGELOG.md](CHANGELOG.md)

## References

### Official

- VS Code: [Webview API](https://code.visualstudio.com/api/extension-guides/webview) ✔, [Activation events](https://code.visualstudio.com/api/references/activation-events) ✔, [Contribution points](https://code.visualstudio.com/api/references/contribution-points), [Extension manifest](https://code.visualstudio.com/api/references/extension-manifest), [Publishing (VSIX)](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

### Further learning

- [Your first extension](https://code.visualstudio.com/api/get-started/your-first-extension)
- [VS Code extension samples: webview-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample)
