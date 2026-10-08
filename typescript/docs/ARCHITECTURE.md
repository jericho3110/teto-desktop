# UI architecture

## Layers

```text
main.ts (composition root: creates and wires everything)
   │
   ├── widgets:  Bubble, CommandBar           (DOM, user input)
   ├── clients:  Brain (HTTP/SSE → Go)        HairPhysics (wasm → C++)    Tauri API (→ Rust)
   ├── behavior: Animator ──uses──► face.ts (pure decisions)
   │                 └──writes──► Skin (the only code that knows SVG ids)
   └── plugins:  Quirks ──loads──► javascript/quirks/*.js
```

Dependencies point inward: `face.ts` knows nothing about the DOM, `Skin`
knows nothing about emotions, and the widgets know nothing about the brain.
Only `main.ts` knows everyone.

## The frame

Every animation frame `Animator.frame(now)`:

1. update blink timer → `Mind.blinkUntil`
2. `currentFace(mind)` → expression from the skin manifest
3. eyes / mouth / blush / effects → `Skin`
4. head bob + smoothed tilt, hop, ahoge wiggle, arms (wave)
5. eye tracking toward the cursor (from Rust's `native://cursor`)
6. head acceleration (window drag + bob + tilt) → `HairPhysics.step` → `Skin.poseChain`

## Click-through

The window is transparent and ignores the mouse except over "solid" UI.
While ignoring, the webview receives **no** mouse events, so the Rust
side polls the cursor (through the C module) and sends `native://cursor`.
The UI checks `elementFromPoint(x, y)?.closest("[data-solid]")` and toggles
`setIgnoreCursorEvents` only when the answer changes.

## Decisions

| Decision | Alternatives | Why | Cost |
| --- | --- | --- | --- |
| inline SVG + attributes | Canvas/PixiJS, Live2D | DOM hit-testing for click-through; art is data; no SDK | slower than canvas with hundreds of parts (we have ~40) |
| no framework | React, Svelte | a few widgets; frameworks would hide the mechanics you're learning | manual DOM updates |
| pure `face.ts` | logic inside the animator | testable in Node without a browser | one more file |

## References

- MDN, `pointer-events`: <https://developer.mozilla.org/en-US/docs/Web/CSS/pointer-events>
- Tauri, window customization: <https://v2.tauri.app/learn/window-customization/>

### Further learning

- web.dev, rendering performance: <https://web.dev/articles/rendering-performance>
