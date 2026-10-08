# Architecture

Why Teto is built the way she is.

## Contents

1. [The big picture](#the-big-picture)
2. [Why each language does its job](#why-each-language-does-its-job)
3. [How the languages link](#how-the-languages-link)
4. [One prompt, end to end](#one-prompt-end-to-end)
5. [Permissions: the safety design](#permissions-the-safety-design)
6. [The UI: skin, animator, physics](#the-ui-skin-animator-physics)
7. [Skins](#skins)
8. [Patterns and principles used](#patterns-and-principles-used)
9. [Found live](#found-live)
10. [Trade-offs and known limits](#trade-offs-and-known-limits)
11. [References](#references)

## The big picture

**Architecture style:** a small *process-based* system (a hub and its
spokes), not one program. Each part is its own process (or a module loaded
into one) that talks over a well-defined protocol. Inside each process
the code is *layered* in a light way (transport → logic), and the
logic modules are kept free of I/O so they can be tested (a hexagonal
idea: `face.ts`, `ReminderStore`, `ParseRemind`, `analyze()` are all pure).

```
                         ┌──────────────── Tauri window (Rust) ─────────────────┐
                         │  TypeScript UI                                        │
   you ── click/type ──► │   main.ts ─► animator ─► skin (SVG)                   │
                         │      │          └──► physics.wasm (C++)              │
                         │      │                                                │
                         │      │ native://cursor, idle, hotkey  ◄── Rust ◄─FFI─ C (Win32)
                         └──────┼───────────────────────────────────────────────┘
                     POST /prompt│ ▲ SSE /events
                                 ▼ │
                         ┌──────────────── Go brain ──────────────┐
                         │  Server ─► Claude ─► claude -p (child)  │
                         │    │                                    │
                         │    ├─► MoodEngine ─► python mood.py     │
                         │    ├─► Companion  ─► \\.\pipe\… (C#)    │
                         │    └─► Reminders  ─► http :47801 (Java) │
                         └─────────────────────────────────────────┘
```

Compare with the alternatives:

| Style | What it would look like here | Why not (for now) |
| --- | --- | --- |
| **Monolith** in one language | e.g. everything in Electron/TypeScript | simplest, but the whole point is to learn how languages link |
| **Microservices** | each part a network service with its own deployment | overkill: one user, one machine; no need for service discovery, retries, etc. |
| **Hub with child processes** (chosen) | the brain owns its helpers; protocols are tiny | each part can be built, tested and restarted alone; the brain degrades gracefully when one is missing |

## Why each language does its job

| Part | Language | Why this language |
| --- | --- | --- |
| Window shell | **Rust** (Tauri) | Tauri gives a native, small (~10 MB) transparent window using the OS webview instead of bundling Chromium like Electron; Rust is memory-safe and has first-class C FFI |
| UI | **TypeScript** | it runs in the webview; types catch protocol mistakes (`BrainEvent` is a typed union) |
| Quirks | **JavaScript** | loaded at runtime with `import()`, no build step: drop a file in, she has a new habit |
| Win32 hooks | **C** | the Windows API *is* a C API; C is the lingua franca every other language can call |
| Hair physics | **C++** → WebAssembly | numeric code that runs 60×/s; classes/templates make the model tidy; wasm runs it at near-native speed inside the webview |
| Brain | **Go** | great at juggling processes, pipes, timeouts and concurrent requests (goroutines + channels); compiles to one `.exe` |
| Mood | **Python** | text processing is pleasant in Python; the natural place to later plug in an ML model |
| Reminders | **Java** | a long-running service with a built-in HTTP server and virtual threads |
| Tray/voice | **C#** | .NET has the nicest access to Windows UI (tray icon, notifications) and speech synthesis |

## How the languages link

Each link uses a different technique on purpose. This table is the heart
of the project:

| Link | Technique | Format | Where |
| --- | --- | --- | --- |
| TS → Go | HTTP `POST` with a bearer token | JSON | `app/src/brain.ts`, `brain/server.go` |
| Go → TS | **Server-Sent Events** (one long HTTP response) | `data: <json>\n\n` | `server.go: events`, `brain.ts: connect` |
| Go ↔ Claude Code | child process, **stdin/stdout pipes** | newline-delimited JSON (`stream-json`) | `brain/claude.go` |
| Go ↔ Python | child process, stdin/stdout pipes | JSON lines, strict request→response | `brain/services.go`, `mood/mood.py` |
| Go → Java | HTTP | form-encoded in, JSON out | `services.go: Reminders`, `reminders/` |
| Go → C# | **Windows named pipe** | one JSON line per connection | `services.go: Companion` |
| TS → C++ | **WebAssembly** exports | plain numbers only | `app/src/physics.ts`, `physics/src/exports.cpp` |
| Rust → C | **FFI** over the C ABI | C types, function pointers | *in progress* |
| Rust → TS | Tauri events + commands | JSON (serde) | *in progress* |

**Why SSE and not WebSocket?** Go's standard library has no WebSocket
package (it would need a dependency), and our traffic is lopsided: the
reply *streams* to the UI, while the UI only sends the occasional short
command. SSE is exactly "server pushes a stream of events over plain
HTTP", and the browser's `EventSource` even reconnects by itself. Cost:
`EventSource` can't send headers, so the token goes in the query string
for that one endpoint.

**Why form-encoded to Java?** The JDK can *write* JSON with a
`StringBuilder` but has no JSON *parser*. Form encoding can be decoded
with `URLDecoder`. So each side uses the format the other finds easy.

## One prompt, end to end

You type "run the tests" and press Enter:

1. `commandbar.ts` → `main.ts` → `Brain.prompt()` sends
   `POST /prompt {"text":"run the tests"}` with `Authorization: Bearer <token>`.
2. `server.go: withCORS → withAuth → prompt` checks the token (constant-time
   compare) and calls `Claude.Prompt()`.
3. `claude.go` starts `claude -p --input-format stream-json ...` if it
   isn't running yet (one long-lived process = the conversation keeps its
   memory), publishes `status: thinking`, and writes
   `{"type":"user","message":{...}}` to its stdin.
4. The UI got `status: thinking` over SSE: the bubble shows "…", her ahoge
   wiggles, eyes look up (`thinking` face).
5. Claude streams `stream_event` lines; each `text_delta` is re-published.
   The bubble fills in and her mouth flaps (`animator.talk()`).
6. Claude wants `Bash: npm test`. It writes a
   `control_request` / `can_use_tool` line. The brain publishes
   `permission_request`; the bubble shows **Allow / Deny**.
7. You click Allow → `POST /permission {"id":..,"allow":true}` →
   `AnswerPermission` hands the answer to the waiting goroutine through a
   channel → the brain writes a `control_response` with
   `"behavior":"allow"`.
8. Claude runs the tests, then sends a `result` line. The brain publishes
   `reply_done` and asks Python for a mood (`{"emotion":"happy",...}`),
   publishes `mood`, and (later) asks C# to speak the reply.
9. The UI shows the final text and the happy ^^ face; her drills bounce
   (an emotion impulse into the physics).

## Permissions: the safety design

Teto can run commands on your PC, so the design is "fail closed":

- **Claude Code runs with `--permission-mode manual`** and
  `--permission-prompt-tool stdio`, so every action that needs approval
  comes to the brain and then to your bubble. (Without `manual`, Claude
  Code may start in `auto` mode and approve "safe" commands itself: see
  [Found live](#found-live).)
- **No answer = deny.** A request nobody answers in 5 minutes is denied
  (`PermissionTimeout`). If Claude exits, all pending requests are denied.
- **The brain only listens on 127.0.0.1** and **every request needs the
  token**. Without the token, any web page you visit could `fetch()` your
  localhost and tell Claude to run commands (cross-site request forgery).
  The token is passed by environment variable, not command line, because
  other programs can read process command lines.
- **CORS allow-list**: only the Tauri origin and the Vite dev server may
  read responses.
- **Model text is never HTML**: the bubble sets `textContent`, so a reply
  containing `<img onerror=...>` is shown as text, not run.

## The UI: skin, animator, physics

- **`skin.ts`** is the only code that knows SVG ids. It exposes
  `pose(part, deg)`, `setEyes(state)`, `setMouth(state)`, `look(dx, dy)`,
  `poseChain(chain, angles)`.
- **`face.ts`** is pure decision logic: from the `Mind` (thinking?
  talking? sleeping? current emotion?) it picks a face by priority
  `sleeping > emotion > talking > thinking > neutral`.
- **`animator.ts`** runs the `requestAnimationFrame` loop: blink timer,
  breathing bob, smoothed head tilt (`approach()`, frame-rate independent),
  waving, eye tracking of the cursor, and feeds the head's acceleration
  into the physics.
- **`physics.ts`** wraps the wasm module. See [PHYSICS.md](PHYSICS.md).

Rendering choice: **inline SVG + attribute updates**, not canvas or a
game engine. Each frame changes ~30 `transform` attributes; the browser
repaints only what changed. Alternatives: Canvas/PixiJS (faster for many
sprites, but you'd redraw everything every frame and lose the DOM's hit
testing that click-through relies on), Live2D (beautiful, but a
proprietary SDK and a rigged model).

## Skins

A skin is a folder in `skins/` with `manifest.json` + one SVG. The
manifest maps roles to element ids, so the animator never hard-codes art:

| Manifest key | Meaning |
| --- | --- |
| `parts.head/armL/armR/ahoge` | element id + rotation pivot |
| `eyes.groups`, `eyes.states` | each eye group contains `.eyes-<state>` children; exactly one is shown |
| `eyes.look`, `lookRange` | the class of the iris group that slides toward the cursor, and how far (px) |
| `mouth.group`, `mouth.states` | `.mouth-<state>` children |
| `chains[]` | `prefix-0 … prefix-(n-1)` **nested** `<g>`s, so rotating joint 2 carries 3..n along |
| `physics` | stiffness, damping, falloff, gravity for the chains |
| `expressions` | per face: eyes, mouth, blush, fx overlays, head tilt, ahoge angle, … |

To make a new skin, copy `skins/teto-chibi`, redraw the SVG keeping the
ids, and change `skin` in the config.

## Patterns and principles used

| Principle / pattern | Where |
| --- | --- |
| **Single Responsibility** | one module per job: `skin.ts` (SVG), `face.ts` (decisions), `animator.ts` (time), `bubble.ts` (text) |
| **Publish/subscribe** | `brain/hub.go`: producers publish events, the SSE handler subscribes |
| **Dependency injection** | `Server.Now` (clock), `Claude.Bin` (the tests inject a fake Claude), `Quirks` receives its API object |
| **Functional core, imperative shell** | `face.ts`, `ParseRemind`, `analyze()`, `ReminderStore` are pure/testable; I/O lives at the edges |
| **Graceful degradation** | no mood engine → neutral; no physics → still hair; no companion → silent; broken quirk → logged, others still load |
| **Fail closed** | permissions default to deny on timeout or crash |
| **Back-pressure by dropping** | `Hub.Publish` never blocks; a slow UI misses events rather than freezing the brain |
| **Test double (fake)** | `brain_test.go`'s `TestMain` makes the test binary impersonate Claude Code |
| **Atomic write** | `ReminderStore.save`: write a temp file, then move it over the real one |

## Found live

Things learned by running against the real systems, each pinned by code or a test:

| Surprise | Fix | Pinned by |
| --- | --- | --- |
| `claude -p` ran `echo hi` **without asking** the host: the default starting permission mode can be `auto` | always pass `--permission-mode manual` | comment in `claude.go: args()`; live smoke test with Deny leaves no file |
| On Windows a running child process **locks its working folder**, so tests couldn't delete their temp dir | `Claude.Close()` closes stdin and waits for exit; tests register it with `t.Cleanup` | `TestPermissionRoundTrip` (cleanup runs LIFO) |
| Python crashed printing `✨`: Windows consoles default to `cp1252` | `sys.stdout.reconfigure(encoding="utf-8")` | `tools/smoke_brain.py` |
| Headless Edge `--window-size=360,…` gave a **496 px** viewport; `--virtual-time-budget` hangs forever on a page with SSE + animation | the probe pins the viewport via DevTools `Emulation.setDeviceMetricsOverride` and uses real time | `tools/ui_probe.mjs` |
| Node 24's `node --test test/` treats `test/` as a file | pass a glob: `"test/**/*.test.mjs"` | `physics/package.json` |

## Trade-offs and known limits

- **One prompt at a time.** A second prompt while she's busy gets `409`.
  Fine for one person; queueing would be the next step.
- **No restart supervision yet**: if the mood engine dies it's disabled
  until the brain restarts. The Rust shell will supervise processes.
- **Mood is a keyword lexicon**, not a model. It's instant and
  explainable but misses sarcasm. Upgrade path: a small local sentiment
  model behind the same JSON-lines protocol; nothing else changes.
- **The Java service has no token**: it's loopback-only and can only
  store reminders, so the risk is low, but any local program could add one.
- **Physics is a game-feel model**, not a rigid-body simulation (see PHYSICS.md).

## References

**The big picture / patterns**
- Martin Fowler, *Microservices* (and when not to use them): https://martinfowler.com/articles/microservices.html
- Alistair Cockburn, *Hexagonal architecture*: https://alistair.cockburn.us/hexagonal-architecture/
- Gary Bernhardt, *Functional core, imperative shell*: https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell

**Links between languages**
- HTML Standard, Server-sent events ✔: https://html.spec.whatwg.org/multipage/server-sent-events.html
- MDN, `EventSource` (no custom headers; auto-reconnect): https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- Claude Code, run programmatically (`-p`, `stream-json`, `--include-partial-messages`, permission modes) ✔: https://code.claude.com/docs/en/headless
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Microsoft, Named pipes: https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipes
- MDN, WebAssembly: https://developer.mozilla.org/en-US/docs/WebAssembly

**Security**
- OWASP, Cross-Site Request Forgery: https://owasp.org/www-community/attacks/csrf
- MDN, CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- Go, `crypto/subtle.ConstantTimeCompare`: https://pkg.go.dev/crypto/subtle#ConstantTimeCompare
- Tauri, Windows custom-protocol origin `http://<scheme>.localhost` ✔: https://v2.tauri.app/release/tauri/v2.1.0/

**UI**
- MDN, `requestAnimationFrame`: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- MDN, SVG `transform`: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/transform
- MDN, `pointer-events` (SVG values like `visiblePainted`): https://developer.mozilla.org/en-US/docs/Web/CSS/pointer-events
