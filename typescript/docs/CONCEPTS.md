# TypeScript concepts used in Teto

Every TypeScript (and browser) concept and principle in `typescript/ui/`.

## Contents

1. [What TypeScript adds to JavaScript](#1-what-typescript-adds-to-javascript)
2. [ES modules and `import type`](#2-es-modules-and-import-type)
3. [Interfaces, type aliases, unions and literal types](#3-interfaces-type-aliases-unions-and-literal-types)
4. [Discriminated unions and narrowing](#4-discriminated-unions-and-narrowing)
5. [Utility and indexed types: Record, Omit, ArrayLike](#5-utility-and-indexed-types-record-omit-arraylike)
6. [Classes: private, readonly, parameter properties](#6-classes-private-readonly-parameter-properties)
7. [Generics](#7-generics)
8. [null handling: `?.`, `??`, `!`, optional fields](#8-null-handling----optional-fields)
9. [async / await and Promises](#9-async--await-and-promises)
10. [Closures and callbacks](#10-closures-and-callbacks)
11. [The DOM: parsing, querying, events](#11-the-dom-parsing-querying-events)
12. [requestAnimationFrame and frame-rate independence](#12-requestanimationframe-and-frame-rate-independence)
13. [Talking to other languages: fetch, EventSource, WebAssembly, Tauri](#13-talking-to-other-languages-fetch-eventsource-webassembly-tauri)
14. [Dynamic `import()`](#14-dynamic-import)
15. [Security in the UI](#15-security-in-the-ui)
16. [CSS used](#16-css-used)
17. [Build tooling: tsc, Vite, tsconfig](#17-build-tooling-tsc-vite-tsconfig)
18. [Testing: node:test and type stripping](#18-testing-nodetest-and-type-stripping)
19. [Principles applied](#19-principles-applied)
20. [Exercises](#20-exercises)
- [Typed arrays over WebAssembly memory; canvas drawing](#typed-arrays-over-webassembly-memory-canvas-drawing)
- [The right-click menu](#the-right-click-menu)
21. [References](#references)

## 1. What TypeScript adds to JavaScript

TypeScript = JavaScript + a **static type system** that is erased before
the code runs. `tsc` checks types (`noEmit`: it never writes JS here);
Vite strips the types and bundles. Types catch mistakes like reading
`ev.txt` instead of `ev.text` before you ever run the app.

`"strict": true` in `tsconfig.json` turns on the useful checks, e.g.
`strictNullChecks` (you must handle `null`), `noImplicitAny`.

## 2. ES modules and `import type`

- Each file is a module; `export class Bubble`, `import { Bubble } from "./bubble"`.
- `import type { Skin } from "./skin"` imports **only a type**. It's
  erased completely, so no runtime dependency is created. `face.ts` uses
  *only* type imports, which is what lets Node run it by stripping types.
- `@tauri-apps/api/core` etc. are **package imports** resolved from `node_modules`.

## 3. Interfaces, type aliases, unions and literal types

```ts
export type Emotion = "neutral" | "happy" | "excited" | ...;   // union of string literal types
export type Face = Emotion | "sleeping" | "thinking";           // union of unions
export interface Expression { eyes: string; headDrop?: number; ... }   // ? = optional
```

- **Literal types** restrict a string to exact values; a typo like
  `"hapy"` is a compile error.
- `interface` vs `type`: both describe shapes. Interfaces can be extended
  and merged; type aliases can name unions. This code uses interfaces
  for object shapes and `type` for unions (a common convention).

## 4. Discriminated unions and narrowing

```ts
type BrainEvent =
  | { type: "text_delta"; text: string }
  | { type: "mood"; emotion: Emotion; intensity: number } | ...;

switch (ev.type) {
  case "text_delta": bubble.stream(ev.text); break;   // here ev is the text_delta member
  case "mood": animator.emote(ev.emotion, ev.intensity); break;
}
```

The shared `type` field is the **discriminant**. Inside each `case`,
TypeScript **narrows** `ev` to that member, so `ev.text` only compiles
where it exists. This union *is* the UI side of the protocol contract.

## 5. Utility and indexed types: Record, Omit, ArrayLike

| Type | Where | Meaning |
| --- | --- | --- |
| `Record<Face, Expression>` | `SkinManifest.expressions` | an object with exactly these keys |
| `Record<"head" \| "armL" \| ..., PartSpec>` | `SkinManifest.parts` | ditto, keys from a union |
| `Omit<QuirkAPI, "on">` | `Quirks` constructor | QuirkAPI without `on` (Quirks adds it) |
| `ArrayLike<T>` | `sanitize.ts` | anything with `length` + `[i]`: arrays *and* DOM collections |
| `[number, number]` | `PartSpec.pivot` | a **tuple**: fixed length, typed positions |

## 6. Classes: private, readonly, parameter properties

```ts
export class Skin {
  readonly root: SVGSVGElement;          // can't be reassigned after construction
  private parts = new Map<string, Posable>();
  private constructor(readonly manifest: SkinManifest, ...) {}   // parameter property
  static async load(...): Promise<Skin> { ... return new Skin(...) }
}
```

- `private`/`readonly` are **compile-time** checks (erased at runtime).
- **Parameter properties** (`constructor(private physics: ...)`) declare and
  assign a field in one go. **Gotcha (found live):** they need code
  generation, so Node's type stripping rejects them. Files that Node runs
  directly (`face.ts`, tests) avoid them.
- **Private constructor + static async factory** (`Skin.load`): a constructor
  can't be `async`, so loading happens in `load()`, which then builds a
  fully initialized object. No half-built `Skin` can exist.

## 7. Generics

```ts
private byId<T extends Element>(id: string): T { ... }
this.byId<SVGGElement>("mouth");
invoke<Config>("get_config");
new Map<string, Posable>();
```

A generic function works for many types; `T extends Element` is a
**constraint**: T must be some kind of Element.

## 8. null handling: `?.`, `??`, `!`, optional fields

| Syntax | Example | Meaning |
| --- | --- | --- |
| `?.` | `this.cards.get(id)?.remove()` | call only if not null/undefined |
| `??` | `q.get("brain") ?? "http://..."` | default only for null/undefined (unlike `\|\|`, keeps `""` and `0`) |
| `!` | `root.querySelector(".bubble-text")!` | "trust me, it's not null". Use only where the HTML guarantees it |
| `?:` field | `headDrop?: number` | may be missing |

## 9. async / await and Promises

`async` functions return a Promise; `await` pauses until it settles.
`main()` awaits the skin, physics and config in order. `.catch(...)`
handles failure without stopping startup (`HairPhysics.load(...).catch(() => null)`):
graceful degradation. `void brain.cancel()`: `void` marks a Promise we
intentionally don't wait for.

## 10. Closures and callbacks

The command bar receives `onSubmit` and `onStop` callbacks; the brain
client receives `onEvent` and `onConnection`. Each callback **closes over**
variables like `busy`, so modules don't import each other: `main.ts`
wires them (the composition root).

## 11. The DOM: parsing, querying, events

- `DOMParser().parseFromString(svg, "image/svg+xml")` builds an inert
  document; `document.importNode(..., true)` deep-copies it into the page.
- `querySelector(".eyes-open")`, `CSS.escape(id)` for safe selectors.
- `el.setAttribute("transform", ...)`, `el.style.display = "none"`.
- Events: `addEventListener("pointerdown", ...)`; **pointer events** cover
  mouse, pen and touch. Events **bubble** from the SVG shape up to `#character`.
- `document.elementFromPoint(x, y)` + `closest("[data-solid]")`: "is the
  cursor over something solid?" (click-through).

## 12. requestAnimationFrame and frame-rate independence

`requestAnimationFrame(loop)` calls `loop` before each repaint (60 Hz,
144 Hz, …). Everything is computed from **elapsed time** (`dt`), and
smoothing uses `approach()`:

```ts
target + (current - target) * Math.exp(-rate * dt)
```

The naive `current += (target - current) * 0.1` per frame converges 2.4×
faster at 144 Hz than at 60 Hz; the exponential form doesn't (tested in
`face.test.ts`).

## 13. Talking to other languages: fetch, EventSource, WebAssembly, Tauri

| API | Talks to | Where |
| --- | --- | --- |
| `fetch` + JSON | Go brain (HTTP POST) | `brain.ts` |
| `EventSource` | Go brain (SSE stream), auto-reconnects | `brain.ts` |
| `WebAssembly.instantiateStreaming` | C++ physics | `physics.ts` |
| `invoke` (Tauri) | Rust command `get_config` | `main.ts` |
| `listen` (Tauri) | Rust events `native://cursor`, `idle`, `hotkey` | `main.ts` |
| `getCurrentWindow()` | Rust window API: drag, focus, click-through | `main.ts` |

## 14. Dynamic `import()`

`await import(/* @vite-ignore */ `${baseUrl}/${file}`)` loads quirk files
at runtime, so there's no rebuild. Each module's `default` export is called
with the API object. The comment stops Vite from trying to bundle a path it
can't know in advance.

## 15. Security in the UI

| Rule | Where |
| --- | --- |
| Model output only via `textContent`, never `innerHTML` | `bubble.ts` |
| Permission cards show the **complete** tool input | `bubble.ask`, `main.ts` |
| Skins are sanitized with an allow-list before entering the page | `sanitize.ts`, `skin.ts` |
| One broken quirk can't break the others (`try/catch` per quirk) | `quirks.ts` |
| Debug handle only in dev (`import.meta.env.DEV` is replaced at build time) | `main.ts` |
| A strict Content Security Policy (set by the Rust shell) | `rust/shell/tauri.conf.json` |

## 16. CSS used

- **Custom properties** (`--accent`, `--bar-h`) and `calc()` position
  everything from the bottom, so nothing jumps when the bar appears.
- `position: absolute` + `left: 50%` + `transform: translateX(-50%)` to center.
- `pointer-events: none` on boxes, `visiblePainted` on SVG shapes, so only
  painted pixels are clickable.
- `@keyframes` for the bubble pop and the "…" blink; `[hidden] { display: none !important }`.

## 17. Build tooling: tsc, Vite, tsconfig

| Command | What it does |
| --- | --- |
| `npm install` | installs the four dev tools listed in `package.json` |
| `npm run sync-assets` | `node scripts/sync-assets.ts` copies skins, quirks, physics.wasm into `public/` |
| `npm run dev` | `predev` (sync) then Vite's dev server on port 1420 with instant reload |
| `npm run build` | `prebuild` (sync), `tsc` (type check), `vite build` → `dist/` |
| `npm run typecheck` | `tsc` only |
| `npm test` | `node --test "src/**/*.test.ts"` |

npm runs `preX` automatically before `X`. Key `tsconfig.json` options:
`strict`, `noEmit` (Vite emits), `moduleResolution: "bundler"`,
`allowImportingTsExtensions` (so tests can import `./face.ts`), `types: ["node"]`.

## 18. Testing: node:test and type stripping

Node 22.18+/23.6+ runs `.ts` files by **erasing types** (no compile step).
Limits: no `enum`, no parameter properties, no `namespace` with code, and
imports must say `.ts`. That's why tested modules (`face.ts`, `sanitize.ts`)
are pure and DOM-free. `sanitize.test.ts` uses a tiny **fake DOM** class
that satisfies the `SanitizableElement` interface (a test double).

## 19. Principles applied

| Principle | Where |
| --- | --- |
| **Separation of decision and effect** | `face.ts` (pure) vs `animator.ts` (applies) |
| **Single responsibility** | one class per file, one job each |
| **Program to an interface** | `SanitizableElement`, `QuirkAPI` |
| **Composition root** | `main.ts` creates and wires everything |
| **Graceful degradation** | no physics → still hair; no brain → bubble explains |
| **Plugin architecture** | quirks get an API object, not internals |

## 20. Exercises

1. Add a `"surprised"` face: manifest entry, a `Face` member, and handle it
   in `currentFace`. Let the compiler tell you what you missed.
2. Make the bubble render **bold** text from `**x**` safely (no `innerHTML`!).
3. Write a test for `Bubble.readingTime`. Which part of `bubble.ts` stops
   Node from importing it, and how would you split it?
4. Self-check: why does `main.ts` pass `ev.detail ?? ev.summary` and not `ev.detail || ev.summary`?

## Typed arrays over WebAssembly memory; canvas drawing

- `new Float32Array(memory.buffer, byteOffset, length)` creates a **view**
  of the C++ particle arrays, so no data is copied. `Uint8Array` does the same for
  the `kind` bytes (`physics.ts: Effects`).
- **Gotcha:** if wasm memory grows, `memory.buffer` is replaced and old
  views become empty (detached). The C++ never grows memory; a test pins it.
- `fxlayer.ts` paints with the **Canvas 2D API** (`beginPath`, `lineTo`,
  `bezierCurveTo`, `globalAlpha`) and scales by `devicePixelRatio` so
  shapes stay sharp at 125%/150% Windows scaling.
- The canvas has `pointer-events: none`, so it never catches the mouse.
- `loadPhysics()` loads the module once; `HairPhysics` and `Effects` share
  its exports (**composition**: two small classes over one resource).

## The right-click menu

`src/menu.ts` + the `contextmenu` listener in `main.ts`:

- `contextmenu` is the browser's right-click event; `e.preventDefault()`
  stops the built-in menu ("Reload", "Inspect"), which an app shouldn't show.
- Menu items are **data** (`{ label, action }`), so adding a control is one line.
- Labels go in via `textContent` (never HTML).
- `getBoundingClientRect()` + `Math.min` keeps the menu inside the window.
- Quit is **graceful**: she says goodbye and waves, then `invoke("quit_app")`
  after 1.1 s; Rust stops every helper on exit.

## References

### Official

- TypeScript Handbook: <https://www.typescriptlang.org/docs/handbook/intro.html>
- Narrowing / discriminated unions: <https://www.typescriptlang.org/docs/handbook/2/narrowing.html>
- Utility types: <https://www.typescriptlang.org/docs/handbook/utility-types.html>
- tsconfig reference: <https://www.typescriptlang.org/tsconfig/>
- Node, TypeScript type stripping ✔: <https://nodejs.org/api/typescript.html>
- MDN, `requestAnimationFrame`: <https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame>
- MDN, `EventSource`: <https://developer.mozilla.org/en-US/docs/Web/API/EventSource>
- MDN, dynamic `import()`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import>
- MDN, `textContent` vs `innerHTML` (security note): <https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent>
- Vite guide: <https://vite.dev/guide/>
- Tauri, calling Rust from the frontend: <https://v2.tauri.app/develop/calling-rust/>

### Other

- Freya Holmér, *Lerp smoothing is broken*: <https://www.youtube.com/watch?v=LSNQuFEDOyQ>
- OWASP, XSS prevention cheat sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html>

### Further learning

- TypeScript, The Basics (handbook): <https://www.typescriptlang.org/docs/handbook/2/basic-types.html>
- Total TypeScript free tutorials: <https://www.totaltypescript.com/tutorials>
- Exercism TypeScript track: <https://exercism.org/tracks/typescript>
