# JavaScript concepts used in Teto

Every JavaScript concept and principle in `javascript/`: the quirks
(personality plugins that run in the UI) and `tools/ui_probe.mjs` (a Node
script that drives a headless browser). Plain JavaScript, no build step:
what you write is what runs.

## Contents

1. [JavaScript vs TypeScript here](#1-javascript-vs-typescript-here)
2. [ES modules: `export default`, `.mjs`, `node:` imports](#2-es-modules-export-default-mjs-node-imports)
3. [Plugins: a function that receives an API](#3-plugins-a-function-that-receives-an-api)
4. [Closures as private state](#4-closures-as-private-state)
5. [Arrays: filter, map, find, push](#5-arrays-filter-map-find-push)
6. [Dates, time and randomness](#6-dates-time-and-randomness)
7. [Regular expressions](#7-regular-expressions)
8. [Event-driven code](#8-event-driven-code)
9. [async/await, Promises, and a promise-based RPC](#9-asyncawait-promises-and-a-promise-based-rpc)
10. [Node: child processes, temp folders, fetch, WebSocket](#10-node-child-processes-temp-folders-fetch-websocket)
11. [The Chrome DevTools Protocol](#11-the-chrome-devtools-protocol)
12. [Error handling: try/finally and cleanup](#12-error-handling-tryfinally-and-cleanup)
13. [Principles applied](#13-principles-applied)
14. [Exercises](#14-exercises)
15. [References](#references)

## 1. JavaScript vs TypeScript here

Quirks are JavaScript on purpose: they're loaded **at runtime** with
`import()`, so a quirk is just a file you drop into `javascript/quirks/`.
There's no compiler, no types, nothing to rebuild. The cost: no type
checking, so the quirk API (`typescript/ui/src/quirks.ts: QuirkAPI`) is the
documentation of what you may call.

## 2. ES modules: `export default`, `.mjs`, `node:` imports

```js
export default function poke(teto) { ... }      // quirks/poke.js
import { spawn } from "node:child_process";     // tools/ui_probe.mjs
```

- A module's **default export** is what `import()` returns as `mod.default`.
- `.mjs` tells Node "this is an ES module", even without `"type": "module"`.
- The `node:` prefix marks built-in modules unambiguously (no npm package
  can shadow them).
- **Top-level `await`** works in ES modules (`const bytes = await readFile(...)`
  in `cpp/physics/test/physics.test.mjs`).

## 3. Plugins: a function that receives an API

Each quirk gets one object, `teto`, with `on`, `say`, `emote`, `bounce`,
`wave`, `isBusy`. That's the **plugin pattern**: the host decides what
plugins may do. Quirks can't reach the animator or the brain directly, so
the UI's internals can change without breaking quirks. (Quirks are still
*code* running in the page, so only install quirks you trust: see
docs/SECURITY.md.)

## 4. Closures as private state

```js
export default function poke(teto) {
  let times = [];                         // private to this quirk
  teto.on("poke", () => { times.push(Date.now()); ... });
}
```

The arrow function **closes over** `times`, so it survives between calls
but nothing else can see it. `greetings.js` keeps `lastNag` the same way.

## 5. Arrays: filter, map, find, push

`times = times.filter((t) => now - t < 2000)` keeps only recent pokes
(a **sliding window**); `.map`, `.find`, `.every` appear in the probe and tests.
These return new arrays instead of mutating, which keeps reasoning simple.

## 6. Dates, time and randomness

- `Date.now()` = milliseconds since 1970 (a number, cheap to compare).
- `new Date().getHours()` = local hour, used for greetings.
- **Gotcha:** `now - lastNag` with a `Date` works (it's converted to a
  number), but `now.getTime()` says what you mean, so the code uses it.
- `Math.random() < 1 / 180` per minute ≈ once every three hours on average
  (a Bernoulli trial per tick). Fine for personality; never for security.

## 7. Regular expressions

`/\b(baguette|bread|croissant)s?\b/i.test(text)`: `\b` = word boundary,
`(a|b)` = alternatives, `s?` = optional plural, `i` = case-insensitive.

## 8. Event-driven code

Quirks never loop or poll; they register handlers (`teto.on("tick", ...)`)
and the host calls them. `quirks.ts` wraps every call in `try/catch`, so
one quirk throwing can't stop the others.

## 9. async/await, Promises, and a promise-based RPC

`ui_probe.mjs` turns the DevTools WebSocket (messages in, messages out)
into simple `await send("Page.navigate", {...})` calls:

```js
const send = (method, params) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);                    // remember who's waiting for this id
  ws.send(JSON.stringify({ id, method, params }));
});
// in the message handler: pending.get(msg.id)(msg)  → resolves that promise
```

That's **request/response correlation by id**, the same idea as the
`request_id` in the Claude protocol.

## 10. Node: child processes, temp folders, fetch, WebSocket

| API | Use |
| --- | --- |
| `spawn(browser, args)` | start headless Edge |
| `mkdtempSync(join(tmpdir(), "teto-probe-"))` | a throwaway browser profile, so your real browser data is never touched |
| global `fetch` | read `http://127.0.0.1:9333/json` to find the page |
| global `WebSocket` (Node 22+) | talk to the browser |
| `Buffer.from(base64, "base64")` | decode the screenshot |

## 11. The Chrome DevTools Protocol

Chromium browsers (Edge, Chrome) can be remote-controlled over a
WebSocket (`--remote-debugging-port`). Commands used: `Runtime.enable`
(console events), `Page.navigate`, `Runtime.evaluate` (run JS in the page),
`Emulation.setDeviceMetricsOverride` (exact viewport, found live:
`--window-size` isn't exact headless), `Page.captureScreenshot`.

## 12. Error handling: try/finally and cleanup

The probe kills the browser and deletes the temp profile in `finally`,
so cleanup happens even if a step throws.

## 13. Principles applied

| Principle | Where |
| --- | --- |
| **Plugin architecture / open-closed** | add behavior by adding a quirk file, not by editing the UI |
| **Least privilege** | quirks only get the `teto` API |
| **Fault isolation** | per-quirk try/catch in the host |
| **Leave no trace** | probe uses a temp profile and cleans it up |

## 14. Exercises

1. Write `quirks/coffee.js`: between 9:00 and 10:00, once per day, ask if
   you've had coffee. Where do you store "already asked today"?
2. Make `poke.js` escalate: the 2nd annoyed line differs from the 1st.
3. Add a `--wait 5000` option to the probe.
4. Self-check: why does `poke.js` filter old timestamps *before* pushing the new one?

## References

### Official

- MDN, JavaScript modules: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules>
- MDN, closures: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures>
- MDN, `Array.prototype.filter`: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter>
- MDN, regular expressions: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions>
- MDN, using promises: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises>
- Node, ES modules: <https://nodejs.org/api/esm.html>
- Node, `child_process`: <https://nodejs.org/api/child_process.html>
- Node, `WebSocket` global: <https://nodejs.org/api/globals.html#websocket>
- Chrome DevTools Protocol: <https://chromedevtools.github.io/devtools-protocol/>

### Other

- javascript.info, closures: <https://javascript.info/closure>
