# Concepts: Teto Buddy (VS Code extension)

Every concept the extension uses, where it is, a small example and the gotcha.

## Contents

1. [The extension model](#1-the-extension-model)
2. [Webviews](#2-webviews)
3. [Security in a webview](#3-security-in-a-webview)
4. [TypeScript and build](#4-typescript-and-build)
5. [Packaging: what a .vsix is](#5-packaging-what-a-vsix-is)
6. [Exercises](#6-exercises)
7. [References](#references)

---

## 1. The extension model

| Concept | Where | Example | Gotcha |
| --- | --- | --- | --- |
| **manifest** (`package.json`) | `package.json` | `"contributes": {"views": {"explorer": [...]}}` | it's both npm's file *and* VS Code's manifest; VS Code reads `main`, `engines`, `contributes`, `activationEvents` |
| **contribution points** | `contributes.views`, `contributes.commands` | a webview view in the Explorer named "Teto" | declarative: VS Code shows the view before any of our code runs |
| **activation event** | `"onStartupFinished"` | start shortly after VS Code is ready | `*` would also work but slows startup for everyone |
| **`activate(context)`** | `src/extension.ts` | registers the view provider and event listeners | everything that must be cleaned up goes in `context.subscriptions` |
| **Disposable** | `ctx.subscriptions.push(...)` | listeners, the command, `{ dispose: () => clearInterval(idle) }` | forget one and it keeps running after the extension is turned off (a leak) |
| **events** (observer pattern) | `workspace.onDidChangeTextDocument`, `onDidSaveTextDocument`, `languages.onDidChangeDiagnostics`, `window.onDidChangeWindowState` | `onDidSaveTextDocument(() => post(happy))` | some fire very often (typing, diagnostics): throttle (`TYPING_EVERY_MS`) and keep handlers cheap |
| **diagnostics** | `countErrors()` | `languages.getDiagnostics()` → every file's problems | "errors" here means severity `Error`, not warnings |
| **command** | `teto.wave` | `commands.registerCommand("teto.wave", ...)` | must also be listed in `contributes.commands` to appear in the Command Palette |

## 2. Webviews

| Concept | Where | Example | Gotcha |
| --- | --- | --- | --- |
| **WebviewViewProvider** | `class TetoView` | `resolveWebviewView(view)` sets `options` and `html` | it's called when the view is first *shown*, not at activation; `post()` before that is silently dropped (`this.view?.`) |
| **two processes** | host ↔ page | the host has the VS Code API; the page has the DOM | they share no memory: only messages cross |
| **`postMessage`** | `teto.post({type: "typing"})` → `addEventListener("message", ...)` | JSON-like objects (structured clone) | messages are untrusted input on arrival: `parseMessage` validates them |
| **`asWebviewUri`** | `page()` | turns a file path into a URL the page may load | a plain `file:` URL won't load |
| **`retainContextWhenHidden`** | `registerWebviewViewProvider(..., {webviewOptions})` | keeps her animation running while the panel is collapsed | VS Code warns it has "high memory overhead"; worth it here (a small page) so she doesn't reload each time |
| **`document.currentScript.dataset`** | `webview/main.ts` | the host passes URLs as `data-skin` / `data-wasm` on the `<script>` tag | only valid while the script first runs (fine for our IIFE bundle) |

## 3. Security in a webview

A webview is a web page, so the usual web risks apply. The defenses:

| Defense | Where | Why |
| --- | --- | --- |
| **Content-Security-Policy** `default-src 'none'` | `page()` | start from "nothing allowed", then allow only what's needed |
| script only with a random **nonce** | `script-src 'nonce-…'` | an injected `<script>` without the nonce can't run |
| `'wasm-unsafe-eval'` | `script-src` | allows compiling WebAssembly (the drill physics), nothing else |
| `'unsafe-inline'` for **styles** only | `style-src` | the skin SVG uses `style="..."` attributes; styles can't run code |
| `connect-src ${cspSource}` | CSP | `fetch` can reach only the extension's own files: no network |
| **`localResourceRoots`** = `out`, `media`, `static` | `resolveWebviewView` | the page can't read anything else on disk, not even your workspace |
| **allow-list validation** of messages | `webview/messages.ts` | unknown types, unknown emotions, non-booleans and odd numbers are dropped; intensity is clamped |
| the skin is **sanitized** before it's inserted | reused `ui/src/sanitize.ts` | no scripts, event handlers or external links from an SVG |

## 4. TypeScript and build

| Concept | Where | Example | Gotcha |
| --- | --- | --- | --- |
| **two tsconfigs** | `tsconfig.json`, `tsconfig.webview.json` | host: CommonJS for Node; webview: ESNext + DOM for the browser | one config can't describe two runtimes |
| **CommonJS vs ES modules** | host output, `vite.config.mts` | VS Code loads the extension with `require()` | that's why `package.json` has no `"type": "module"`, and the Vite config is `.mts` (an ES module by its extension) |
| **`import type`** | `extension.ts` imports `HostMessage` | shared types, no runtime import | erased at compile time: the host never loads webview code |
| **derived types** | `Awaited<ReturnType<typeof loadPhysics>>` | the physics exports' type without changing the UI | lets us reuse code that doesn't export a type name |
| **compile-time compatibility check** | `const emotion: UiEmotion = msg.emotion` | fails to compile if our emotion list drifts from the UI's | a type assignment used as a test |
| **bundling** (Vite, library mode, IIFE) | `vite.config.mts` | the webview plus 7 UI modules → one `out/webview.js` | IIFE = one self-running script; works with the nonce'd `<script>` tag |
| **graceful fallback** | `physics()` in `main.ts` | try streaming compile, then compile from bytes, else run without physics | `instantiateStreaming` needs the server to say `application/wasm` |

## 5. Packaging: what a .vsix is

A `.vsix` is a **zip** (try renaming one to `.zip`) with:

```text
extension.vsixmanifest     XML: id, version, publisher, engine ("^1.95.0")
[Content_Types].xml        XML: the MIME type for each file extension (an Open Packaging Convention file)
extension/package.json     the manifest VS Code actually reads
extension/out/…            compiled code
extension/media/…          skin + physics.wasm
extension/static/…, README.md, LICENSE.txt, NOTICE.md
```

The official tool, `vsce`, builds this and adds checks. `scripts/pack_vsix.py`
does the same with Python's `zipfile` in ~90 lines: fewer dependencies, and
you can see exactly what goes in. It escapes values put into the XML
(`xml.sax.saxutils.escape`) and finishes with an assert-based self-check.
VS Code validated it on install:
`Extension 'jericho3110.teto-buddy' v0.1.0 was successfully installed.`

## 5b. The animated sticker (SVG animation)

| Concept | Where | Example | Gotcha |
| --- | --- | --- | --- |
| **SMIL animation** | `scripts/make_sticker.py` | `<animateTransform type="rotate" values="-4;4;-4" dur="2.6s" repeatCount="indefinite"/>` | runs even when the SVG is only an image; scripts never do |
| **`additive="sum"`** | `spin()` | adds the sway on top of the element's own `translate(...)` | without it the animation *replaces* the transform and the drill jumps to (0,0) |
| **phase offset** (`begin="-0.22s"` per joint) | drills | each joint starts slightly later: the drill moves like a wave | a negative `begin` means "already this far into the loop" |
| **presentation attribute vs `style`** | blink | `display="none"` can be animated; `style="display:none"` wins over any animation | that's why the generator rewrites the closed-eyes group |
| **padding the viewBox** | `-24 -24 348 448` | room for drill tips swinging outside the original 300 x 400 | found live: the first render clipped the drills at the edges |
| **found live: CSS transform ownership** | `static/webview.css` | centring with `translateX(-50%)` broke, because the animator writes `transform` each frame | one property, one owner: centre with `margin: 0 auto` |

## 6. Exercises

1. Add a reaction: when a debug session starts (`vscode.debug.onDidStartDebugSession`), send `{type: "emote", emotion: "excited"}`.
2. Remove `'wasm-unsafe-eval'` from the CSP and reload. What happens to the drills, and why does she still work?
3. Make the idle time a setting (`contributes.configuration`, `workspace.getConfiguration("teto")`).
4. Rename the built `.vsix` to `.zip` and open it. Find each file from §5.

**Self-check:** why does `parseMessage` validate messages that only our own extension sends?

## References

### Official

- VS Code API: [Webview guide](https://code.visualstudio.com/api/extension-guides/webview) ✔ (localResourceRoots, CSP, asWebviewUri, retainContextWhenHidden memory note), [Activation events](https://code.visualstudio.com/api/references/activation-events) ✔ (onStartupFinished vs `*`), [Contribution points](https://code.visualstudio.com/api/references/contribution-points), [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api), [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- MDN: [Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy), [`WebAssembly.instantiateStreaming`](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/instantiateStreaming_static), [`document.currentScript`](https://developer.mozilla.org/en-US/docs/Web/API/Document/currentScript)
- Vite: [Library mode](https://vite.dev/guide/build#library-mode); Python: [zipfile](https://docs.python.org/3/library/zipfile.html)
- [ECMA-376 Open Packaging Conventions](https://ecma-international.org/publications-and-standards/standards/ecma-376/) (where `[Content_Types].xml` comes from)

### Further learning

- [VS Code extension samples](https://github.com/microsoft/vscode-extension-samples)
- [Exercism TypeScript track](https://exercism.org/tracks/typescript)
