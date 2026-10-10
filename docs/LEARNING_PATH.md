# Learning path

A reading order through Teto, from "one pure function" to "nine
languages talking". Each stage: what to read, the concepts, an exercise,
and a self-check question. Budget about an evening per stage. The deep
dives for each language are in `<language>/docs/CONCEPTS.md`.

## Contents

1. [Stage 1: one pure function (Python)](#stage-1-one-pure-function-python)
2. [Stage 2: a process as a function (pipes)](#stage-2-a-process-as-a-function-pipes)
3. [Stage 3: an HTTP service (Java)](#stage-3-an-http-service-java)
4. [Stage 4: the brain's server (Go)](#stage-4-the-brains-server-go)
5. [Stage 5: driving Claude Code (Go)](#stage-5-driving-claude-code-go)
6. [Stage 6: art as data (SVG + manifest)](#stage-6-art-as-data-svg--manifest)
7. [Stage 7: the animator (TypeScript)](#stage-7-the-animator-typescript)
8. [Stage 8: C++ in the browser (WebAssembly)](#stage-8-c-in-the-browser-webassembly)
9. [Stage 9: personality as plugins (JavaScript)](#stage-9-personality-as-plugins-javascript)
10. [Stage 10: talking to Windows (C)](#stage-10-talking-to-windows-c)
11. [Stage 11: the shell and FFI (Rust)](#stage-11-the-shell-and-ffi-rust)
12. [Stage 12: tray, toasts and voice (C#)](#stage-12-tray-toasts-and-voice-c)
13. [Stage 13: thinking like an attacker](#stage-13-thinking-like-an-attacker)
14. [References](#references)

## Stage 1: one pure function (Python)

**Read:** `python/mood/mood.py: analyze()`, then `python/mood/test_mood.py: AnalyzeTest`.
**Concepts:** pure functions, lexicons, negation, a saturating curve `x/(x+1)`.
**Exercise:** add a `sleepy` emotion, test first.
**Self-check:** why does `"It's not working yet."` come out `neutral`, not `worried`?

## Stage 2: a process as a function (pipes)

**Read:** `mood.py: main()`, `ProtocolTest`, then `go/brain/services.go: MoodEngine`.
**Concepts:** stdin/stdout as a protocol, JSON lines, buffering (`-u`), "always reply".
**Exercise:** run `python -u python/mood/mood.py`, type `{"text": "yay"}`, then `oops`.
**Self-check:** what would happen to the brain if `mood.py` printed nothing for bad input?

## Stage 3: an HTTP service (Java)

**Read:** `java/reminders/src/teto/reminders/ReminderStore.java`, then `ReminderServer.java`, then the test.
**Concepts:** separating storage from transport, records, synchronized,
virtual threads, atomic file writes, central error handling.
**Exercise:** add `DELETE /reminders/{id}` with a test.
**Self-check:** a web page can send a form POST to `127.0.0.1` without asking. Which line stops it here?

## Stage 4: the brain's server (Go)

**Read:** `go/brain/main.go` → `server.go` → `hub.go`. Deep dive: [go/docs/CONCEPTS.md](../go/docs/CONCEPTS.md).
**Concepts:** middleware, bearer tokens, CSRF, DNS rebinding, CORS, SSE, publish/subscribe.
**Exercise:** add `GET /version`; decide whether it needs the token.
**Self-check:** why `subtle.ConstantTimeCompare` instead of `==`, and why check for an empty token?

## Stage 5: driving Claude Code (Go)

**Read:** `go/brain/claude.go`, then `brain_test.go: fakeClaude, TestPermissionRoundTrip`, then [PROTOCOL.md](PROTOCOL.md). For how each link works underneath (FFI, WebAssembly, pipes), read [INTEROP.md](INTEROP.md).
**Concepts:** long-lived child processes, goroutines, channels + `select`, fail closed, test doubles.
**Exercise:** run the brain and `python/tools/smoke_brain.py` with and without `--allow` in a scratch `-workdir`.
**Self-check:** if you close Teto while a card is open, what does Claude receive, and which line decides?

## Stage 6: art as data (SVG + manifest)

**Read:** `python/skin_gen/gen_teto.py`, open `assets/skins/teto-chibi/teto.svg`, then `manifest.json`.
**Concepts:** SVG painting order, nested `<g>` transforms, a manifest as a contract.
**Exercise:** give her a hair clip inside `#head`; regenerate; check it moves with her head.
**Self-check:** why are the drill segments nested instead of siblings?

## Stage 7: the animator (TypeScript)

**Read:** `typescript/ui/src/face.ts` + test, `animator.ts`, `skin.ts`, `main.ts`. Deep dive: [typescript/docs/CONCEPTS.md](../typescript/docs/CONCEPTS.md).
**Concepts:** deciding vs doing, `requestAnimationFrame`, `exp(-rate·dt)` smoothing, discriminated unions.
**Exercise:** make her look at the command bar while you type.
**Self-check:** why does `current += (target-current)*0.1` per frame differ at 144 Hz vs 60 Hz?

## Stage 8: C++ in the browser (WebAssembly)

**Read:** [cpp/docs/ARCHITECTURE.md](../cpp/docs/ARCHITECTURE.md), `cpp/physics/src/*`, `typescript/ui/src/physics.ts`.
**Concepts:** cross-compiling, freestanding code, `extern "C"`, semi-implicit Euler.
**Exercise:** the exercises at the end of cpp/docs/ARCHITECTURE.md.
**Self-check:** what would the `.wasm` need to import if you used `std::sin`?

## Stage 9: personality as plugins (JavaScript)

**Read:** `typescript/ui/src/quirks.ts`, then `javascript/quirks/*.js`.
**Concepts:** plugin architecture, dynamic `import()`, closures as private state, fault isolation.
**Exercise:** write `javascript/quirks/coffee.js`.
**Self-check:** why does a quirk get an API object instead of importing `animator.ts`?

## Stage 10: talking to Windows (C)

**Read:** `c/win32hooks/include/teto_win32.h`, then `src/teto_win32.c`, then the test. Deep dive: [c/docs/CONCEPTS.md](../c/docs/CONCEPTS.md).
**Concepts:** the C ABI, out-parameters, callbacks with `void *user`,
message loops, thread joins, job objects, unsigned wraparound.
**Exercise:** add `teto_foreground_title` safely (buffer + capacity).
**Self-check:** why must `teto_hotkey_stop` join the thread instead of only posting `WM_QUIT`?

## Stage 11: the shell and FFI (Rust)

**Read:** `rust/shell/src/native.rs`, `supervisor.rs`, `lib.rs`, `build.rs`, `tauri.conf.json`. Deep dive: [rust/docs/CONCEPTS.md](../rust/docs/CONCEPTS.md).
**Concepts:** ownership, `unsafe` with written safety arguments, trampolines,
`Mutex` statics, build scripts, Tauri commands/events/capabilities, CSP.
**Exercise:** add a tray-free "toggle always-on-top" command and give it the narrowest capability.
**Self-check:** in `hotkey_stop`, why is the closure freed only *after* `teto_hotkey_stop()` returns?

## Stage 12: tray, toasts and voice (C#)

**Read:** `csharp/Companion/Commands.cs` + tests, `PipeListener.cs`, `TrayApp.cs`, `Program.cs`. Deep dive: [csharp/docs/CONCEPTS.md](../csharp/docs/CONCEPTS.md).
**Concepts:** records, nullable references, pattern matching, async +
cancellation, `IDisposable`, UI-thread marshalling, named-pipe security.
**Exercise:** add a `mute` command end to end (Go sends it, C# handles it).
**Self-check:** why does `Handle` run via `SynchronizationContext.Post`?

## Stage 12b: how she moves and speaks

**Read:** [ANIMATION.md](ANIMATION.md) (eye tracking math, smoothing, sine waves, the face state machine), then [VOICE.md](VOICE.md).
**Exercise:** make her blink twice in a row sometimes (a "double blink"); make babble pitch rise at the end of questions.
**Self-check:** why do the breathing, sway and ahoge periods use unrelated numbers?

## Stage 13: thinking like an attacker

**Read:** [SECURITY.md](SECURITY.md), especially the review table.
**Exercise:** pick one finding, revert its fix locally, and watch its regression test fail. Then restore it.
**Self-check:** list every way a *web page* could try to make Teto do something, and the defense that stops each.

## References

- Python `subprocess`: <https://docs.python.org/3/library/subprocess.html>
- JSON Lines: <https://jsonlines.org/>
- Go by Example: <https://gobyexample.com/>
- MDN, server-sent events: <https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>
- MDN, SVG tutorial: <https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial>
- The Rust Book: <https://doc.rust-lang.org/book/>
- Microsoft, C# guide: <https://learn.microsoft.com/en-us/dotnet/csharp/>
- Freya Holmér, *Lerp smoothing is broken*: <https://www.youtube.com/watch?v=LSNQuFEDOyQ>
- Martin Fowler, *Test Double*: <https://martinfowler.com/bliki/TestDouble.html>
- OWASP Top Ten: <https://owasp.org/www-project-top-ten/>

### Further learning

- roadmap.sh (learning roadmaps): <https://roadmap.sh/>
- Exercism (free practice tracks for every language here): <https://exercism.org/tracks>
- The Missing Semester of Your CS Education (shell, git, tools): <https://missing.csail.mit.edu/>
