# Learning path

A reading order through Teto, from "one process" to "many languages
talking". Each stage: what to read, the concepts, an exercise, and a
self-check question. Budget about an evening per stage.

## Contents

1. [Stage 1: one pure function (Python)](#stage-1-one-pure-function-python)
2. [Stage 2: a process as a function (pipes)](#stage-2-a-process-as-a-function-pipes)
3. [Stage 3: the brain's server (Go)](#stage-3-the-brains-server-go)
4. [Stage 4: driving Claude Code](#stage-4-driving-claude-code)
5. [Stage 5: art as data (SVG + manifest)](#stage-5-art-as-data-svg--manifest)
6. [Stage 6: the animator (TypeScript)](#stage-6-the-animator-typescript)
7. [Stage 7: C++ in the browser (WebAssembly)](#stage-7-c-in-the-browser-webassembly)
8. [Stage 8: personality as plugins (quirks)](#stage-8-personality-as-plugins-quirks)
9. [References](#references)

## Stage 1: one pure function (Python)

**Read:** `mood/mood.py: analyze()`, then `mood/test_mood.py: AnalyzeTest`.

**Concepts:** a *pure function* (same input → same output, no I/O) is
the easiest thing to test. Lexicons, negation handling, a saturating
curve `x / (x + 1)` to squash any score into 0..1.

**Exercise:** add an emotion `sleepy` (words: "tired", "yawn", "sleep").
Add a test first, watch it fail, then make it pass.

**Self-check:** why does `"It's not working yet."` come out `neutral` rather than `worried`?

## Stage 2: a process as a function (pipes)

**Read:** `mood.py: main()`, `ProtocolTest`, then `brain/services.go: MoodEngine`.

**Concepts:** stdin/stdout as a protocol; *JSON lines* (one object per
line, so the reader knows where a message ends); buffering (`python -u`,
`flush=True`); why a strict "one request → one response" rule matters
(the Go side holds a mutex and waits).

**Exercise:** run it by hand: `python -u mood/mood.py`, then type
`{"text": "yay"}` and press Enter. Then type `oops` and see what happens.

**Self-check:** what would happen to the brain if `mood.py` printed
nothing for invalid input?

## Stage 3: the brain's server (Go)

**Read:** `brain/main.go` → `server.go: Routes, withAuth, withCORS, events` → `hub.go`.

**Concepts:** middleware (a handler wrapping a handler), bearer tokens,
CSRF and why localhost isn't automatically safe, CORS, Server-Sent
Events, publish/subscribe, non-blocking sends with `select { default: }`.

**Exercise:** add `GET /version` that returns `"0.1.0"`. Should it need
the token? Write the test.

**Self-check:** why is the token compared with `subtle.ConstantTimeCompare` instead of `==`?

## Stage 4: driving Claude Code

**Read:** `brain/claude.go` top to bottom, then `brain_test.go: fakeClaude, TestPermissionRoundTrip`.
Then [PROTOCOL.md](PROTOCOL.md#brain--claude-code-stream-json).

**Concepts:** long-lived child processes, goroutines reading pipes,
channels as "a box one goroutine waits on", timeouts with `select`,
fail-closed security, test doubles (the test binary pretends to be Claude).

**Exercise:** run the brain and `tools/smoke_brain.py` once with Deny and
once with `--allow` (in a scratch `-workdir`!). Compare the events.

**Self-check:** if you close Teto while a permission card is open, what
does Claude receive, and which line of code decides that?

## Stage 5: art as data (SVG + manifest)

**Read:** `tools/skin_gen/gen_teto.py`, open `skins/teto-chibi/teto.svg`
in a browser, then `manifest.json`.

**Concepts:** SVG painting order (later = on top: that's why the arms
had to move after the torso), nested `<g>` transforms, the manifest as
the contract between art and code.

**Exercise:** give her a hair clip: draw it in the generator inside
`#head`, regenerate, and check it moves with her head.

**Self-check:** why are the drill segments *nested* instead of siblings?

## Stage 6: the animator (TypeScript)

**Read:** `app/src/face.ts` + `face.test.ts`, then `animator.ts`, `skin.ts`, `main.ts`.

**Concepts:** separating *deciding* (pure `face.ts`) from *doing*
(`animator.ts`); `requestAnimationFrame`; frame-rate-independent smoothing
with `exp(-rate·dt)`; discriminated unions for events.

**Exercise:** make her look at the command bar while you type (hint:
`Animator.cursor`).

**Self-check:** why would `current += (target - current) * 0.1` per frame
behave differently on a 144 Hz monitor than on 60 Hz?

## Stage 7: C++ in the browser (WebAssembly)

**Read:** [PHYSICS.md](PHYSICS.md), `physics/src/*`, `app/src/physics.ts`.

**Concepts:** cross-compiling, freestanding code (no standard library),
name mangling and `extern "C"`, semi-implicit Euler.

**Exercise:** do the exercises at the end of PHYSICS.md.

**Self-check:** the `.wasm` imports nothing. What would it need to import
if you used `std::sin`?

## Stage 8: personality as plugins (quirks)

**Read:** `app/src/quirks.ts`, then the files in `quirks/`.

**Concepts:** plugin architecture (a small API object passed to each
plugin), dynamic `import()`, isolating failures with `try/catch` per plugin.

**Exercise:** write `quirks/coffee.js`: between 9 and 10 AM, once a day,
she asks if you've had coffee.

**Self-check:** why does a quirk receive an API object instead of
importing `animator.ts` directly?

## References

- Python `subprocess` and pipes: https://docs.python.org/3/library/subprocess.html
- JSON Lines: https://jsonlines.org/
- Go by Example (goroutines, channels, select, timeouts): https://gobyexample.com/
- MDN, Using server-sent events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- MDN, SVG tutorial: https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial
- Freya Holmér, *Lerp smoothing is broken* (frame-rate-independent smoothing): https://www.youtube.com/watch?v=LSNQuFEDOyQ
- Martin Fowler, *Test Double*: https://martinfowler.com/bliki/TestDouble.html
