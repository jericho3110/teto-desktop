# Go concepts used in Teto

Every Go concept and principle in `go/brain/`, with where it is used, a
small example, and the gotchas. Read it next to the code.

## Contents

1. [Packages, modules and visibility](#1-packages-modules-and-visibility)
2. [Structs, methods and pointer receivers](#2-structs-methods-and-pointer-receivers)
3. [Interfaces (implicit)](#3-interfaces-implicit)
4. [Errors as values](#4-errors-as-values)
5. [defer](#5-defer)
6. [Goroutines](#6-goroutines)
7. [Channels and select](#7-channels-and-select)
8. [Mutexes: protecting shared state](#8-mutexes-protecting-shared-state)
9. [Closures](#9-closures)
10. [JSON: struct tags, RawMessage, maps](#10-json-struct-tags-rawmessage-maps)
11. [net/http: handlers, middleware, routing](#11-nethttp-handlers-middleware-routing)
12. [Server-Sent Events and http.Flusher](#12-server-sent-events-and-httpflusher)
13. [os/exec: child processes and pipes](#13-osexec-child-processes-and-pipes)
14. [bufio.Scanner: reading lines](#14-bufioscanner-reading-lines)
15. [time: durations, timers, injectable clocks](#15-time-durations-timers-injectable-clocks)
16. [Strings, runes and regexp](#16-strings-runes-and-regexp)
17. [Security primitives: crypto/rand, crypto/subtle](#17-security-primitives-cryptorand-cryptosubtle)
18. [flag and environment variables](#18-flag-and-environment-variables)
19. [Testing: TestMain, subtests, httptest, cleanups](#19-testing-testmain-subtests-httptest-cleanups)
20. [Principles applied](#20-principles-applied)
21. [Tooling: gofmt, vet, build](#21-tooling-gofmt-vet-build)
22. [Exercises](#22-exercises)
23. [References](#references)

## 1. Packages, modules and visibility

- **Module** = a versioned unit with a `go.mod`
  (`module github.com/jericho3110/teto-desktop/brain`, `go 1.27`).
  **Package** = a folder of `.go` files sharing `package main`.
- `package main` + `func main()` = an executable.
- **Visibility is by capitalization**: `Claude.Prompt` (capital P) is
  exported; `summarize` is private to the package. No `public`/`private` keywords.
- All files in a folder are one package: `server.go` calls `summarize` from
  `claude.go` without importing anything.

## 2. Structs, methods and pointer receivers

```go
type Claude struct { Bin string; mu sync.Mutex; busy bool }
func (c *Claude) Prompt(text string) error { c.busy = true; ... }
```

- A method is a function with a **receiver** (`c *Claude`).
- **Pointer receiver** (`*Claude`): the method can modify the struct, and
  the struct isn't copied. Needed whenever a struct holds a `sync.Mutex`
  (copying a mutex breaks it; `go vet` warns about this).
- **Value receiver** (`func (c Companion) Speak(...)` in `services.go`): fine
  for small structs that are never modified.
- **Zero values**: every type has a usable zero value: `""` for strings,
  `false` for bools, `nil` for maps/pointers, and an unlocked `sync.Mutex`.
  `MoodEngine{}` (with `ok == false`) is a valid "disabled" engine, which is
  how graceful degradation works with no extra code.

## 3. Interfaces (implicit)

```go
type logWriter struct{ prefix string }
func (w logWriter) Write(p []byte) (int, error) { ... }   // claude.go
cmd.Stderr = logWriter{prefix: "claude stderr: "}          // expects io.Writer
```

`logWriter` never says "implements io.Writer". Having a `Write` method with
the right signature is enough (**structural typing**). Same for
`http.Handler`: anything with `ServeHTTP` is a handler; `http.HandlerFunc`
turns a plain function into one.

**Type assertion**: `flusher, ok := w.(http.Flusher)` in `server.go: events`
asks "does this value also implement Flusher?" without panicking.

## 4. Errors as values

Go has no exceptions for normal failures. Functions return an `error` last:

```go
if err := cmd.Start(); err != nil {
    return fmt.Errorf("start claude: %w", err)   // %w wraps: errors.Is still sees the cause
}
```

- **Sentinel errors**: `var ErrBusy = errors.New(...)` and the caller checks
  `err == ErrBusy` → HTTP 409 (`server.go: prompt`).
- **Ignoring on purpose**: `_ = json.Unmarshal(...)` makes "I know this can
  fail and I don't care" visible.
- `log.Fatal` only in `main`: libraries return errors, programs decide to exit.

## 5. defer

```go
c.mu.Lock()
defer c.mu.Unlock()   // runs when the function returns, on every path
```

Used for unlocking, closing response bodies (`defer resp.Body.Close()`),
unsubscribing SSE clients, and stopping tickers. Deferred calls run
**last-in, first-out**.

**Gotcha:** arguments are evaluated when `defer` runs, not when the
deferred call executes.

## 6. Goroutines

`go f()` runs `f` concurrently on a lightweight thread (a few KB of stack,
scheduled by the Go runtime onto OS threads).

| Goroutine | Where | Why |
| --- | --- | --- |
| `go c.readLoop(stdout, cmd)` | `claude.go: start` | read Claude's output forever without blocking the HTTP server |
| `go c.askPermission(...)` | `claude.go: handle` | each permission request waits (up to 5 min) on its own |
| `go c.OnReply(m.Result)` | `claude.go: handle` | mood/voice work must not slow the reader |
| `go reminders.Poll(...)` | `main.go` | background polling loop |
| one per HTTP request | `net/http` does this for you | every request handler runs concurrently |

**Gotcha:** a goroutine blocked forever is a leak. Every goroutine here has
a way out: EOF, a timeout, or the client's context ending.

## 7. Channels and select

A channel is a typed pipe between goroutines.

```go
ch := make(chan bool, 1)          // buffered: one send never blocks
select {
case allow = <-ch:                 // the user clicked
case <-time.After(PermissionTimeout): // or 5 minutes passed
}
```

- `askPermission` waits on **whichever happens first**: that's `select`.
- **Buffered vs unbuffered**: `AnswerPermission` sends into a channel with
  capacity 1, so it never blocks even if the waiter already timed out.
- **Non-blocking send** with `default` (`hub.go: Publish`): if the
  subscriber's buffer is full, drop the event rather than freeze.
- **Closing as a broadcast**: `close(c.done)` wakes *everyone* waiting on
  `<-done` (`Claude.Close`). Closing twice panics, which is why it only
  happens in `readLoop`, exactly once.
- `r.Context().Done()` in the SSE handler is a channel that closes when the
  browser disconnects.

## 8. Mutexes: protecting shared state

Several goroutines touch `Claude.busy`, `Claude.pending` and `Hub.subs`.
Without a lock that's a **data race** (undefined results).

- `sync.Mutex`: one goroutine at a time between `Lock` and `Unlock`.
- **Convention:** methods ending in `Locked` (`writeLocked`) expect the
  caller to hold the lock; plain methods (`write`) take it themselves.
- **Lock scope:** `AnswerPermission` takes the channel *out* of the map
  under the lock, then sends *after* unlocking, so no lock is held while
  waiting on something else (a classic way to avoid deadlocks).
- **Rule of thumb ("share memory by communicating")**: channels for
  hand-offs, mutexes for simple shared maps and flags. Both appear here.

## 9. Closures

```go
claude.OnReply = func(text string) {
    m := mood.Analyze(text)             // captures `mood`, `hub`, `companion`, `speak`
    hub.Publish(Event{"type": "mood", ...})
}
```

A closure is a function value that **captures variables** from where it was
written. `main.go` builds the wiring with closures, so `Claude` doesn't need
to know that moods or voices exist (dependency inversion). Middleware
(`withAuth`) returns closures that capture `next`.

## 10. JSON: struct tags, RawMessage, maps

```go
type wireMsg struct {
    RequestID string          `json:"request_id"`   // struct tag: the JSON key
    Request   json.RawMessage `json:"request"`      // keep raw bytes, decode later
    Event *struct{ ... }      `json:"event"`        // pointer: nil when absent
}
```

- **Struct tags** map Go names to JSON keys; unknown JSON keys are ignored.
- **`json.RawMessage`** delays decoding: the request is decoded into
  `canUseTool` only for `control_request` lines, and the tool `Input` is
  passed back to Claude **byte-for-byte** in `updatedInput`.
- **`map[string]any`** (`Event`) for small, ad-hoc messages: flexible, but
  no compile-time checks. Typed structs are used where the shape matters.
- `json.Indent` pretty-prints for the permission card (`fullDetail`).

## 11. net/http: handlers, middleware, routing

```go
mux.HandleFunc("POST /prompt", s.prompt)            // Go 1.22+: method + path
return withLocalHost(s.withCORS(s.withAuth(mux)))   // middleware chain
```

- A **handler** is `func(w http.ResponseWriter, r *http.Request)`.
- **Middleware** = a function that takes a handler and returns a handler
  that does something before/after calling it. The order matters: outermost
  runs first (Host check → CORS → token → route).
- **Method-aware patterns** reject `GET /prompt` with 405 automatically.
- `http.Error(w, msg, code)` writes a plain-text error.
- `http.MaxBytesReader(w, r.Body, 1<<20)` caps request bodies at 1 MiB.
- **Client side** (`services.go`): `http.NewRequest` + `client.Do` lets us
  set headers (the token); `client.Timeout` bounds every call.

## 12. Server-Sent Events and http.Flusher

`server.go: events` keeps the response open and writes
`data: {json}\n\n` per event. Normally Go buffers output; `flusher.Flush()`
pushes it to the client **now**. A `: ping` comment every 20 s keeps idle
connections alive. When the client leaves, `r.Context().Done()` fires and
the deferred `unsubscribe()` cleans up.

## 13. os/exec: child processes and pipes

```go
cmd := exec.Command(c.Bin, c.args()...)   // args... spreads a slice into variadic args
cmd.Dir = c.Workdir
stdin, _ := cmd.StdinPipe()
stdout, _ := cmd.StdoutPipe()
cmd.Start()                                // don't wait; Wait() later reaps it
```

- Arguments are passed as a **list**, never through a shell, so text can't
  inject extra commands.
- **Windows gotcha (found live):** a running child keeps its working folder
  locked, so `Close()` closes stdin (Claude's "no more input" signal) and
  waits on `done`.
- Since Go 1.19, `exec.Command("claude")` won't run a `claude.exe` sitting in
  the *current folder*; it only searches `PATH`. That closes a classic Windows
  hijacking trick.

## 14. bufio.Scanner: reading lines

```go
sc := bufio.NewScanner(stdout)
sc.Buffer(make([]byte, 64*1024), 32*1024*1024)
for sc.Scan() { line := sc.Bytes() ... }
```

**Gotcha:** the default max line is 64 KB; a big tool result in one JSON
line would silently stop the scanner. `sc.Buffer` raises it to 32 MB.

## 15. time: durations, timers, injectable clocks

- `time.Duration` is an `int64` of nanoseconds: `5 * time.Minute`.
- **Overflow gotcha:** `time.Duration(n) * time.Hour` overflows for huge
  `n`, which is why `parseRemind` checks `n` against `MaxReminderDelay/unit`
  *before* multiplying.
- `time.After(d)` is a channel that fires once; `time.Tick(d)` fires forever;
  `time.NewTicker` can be stopped (`defer keepAlive.Stop()`).
- **Injectable clock**: `Server.Now func() time.Time`. Production passes
  `time.Now`; tests pass a fixed time, so `/remind 17:30` is deterministic.

## 16. Strings, runes and regexp

- A Go `string` is bytes (UTF-8). `len(s)` counts **bytes**; `[]rune(s)`
  counts **characters**. `truncate` and the 500-character reminder limit
  use runes, so emoji and Japanese aren't cut in half.
- `regexp.MustCompile` at package level compiles once; `Must` panics on a
  bad pattern at startup instead of returning an error later.
- `FindStringSubmatch` returns the capture groups (`m[1]`, `m[2]`, …).

## 17. Security primitives: crypto/rand, crypto/subtle

- `crypto/rand.Read` → unpredictable bytes from the OS (ids, tokens).
  **Never** `math/rand` for secrets.
- `subtle.ConstantTimeCompare` takes the same time whether the first or
  last byte differs, so attackers can't guess the token byte by byte from
  response timings.
- **Gotcha found in review:** `ConstantTimeCompare("", "")` is 1, so an
  empty configured token would accept everyone; `withAuth` refuses that case.

## 18. flag and environment variables

`flag.String("workdir", defaultWorkdir(), "...")` returns a `*string`
filled by `flag.Parse()`; `-h` prints the generated help. Secrets come
from `os.Getenv("TETO_TOKEN")` instead, because other programs can read a
process's command line but not its environment.

## 19. Testing: TestMain, subtests, httptest, cleanups

| Tool | Where | What it gives you |
| --- | --- | --- |
| `TestMain(m *testing.M)` | `brain_test.go` | runs before flag parsing; lets the test binary act as a **fake Claude** when `FAKE_CLAUDE=1` |
| `t.Run(name, func)` | `TestPermissionRoundTrip` | subtests: `allow=true` and `allow=false` reported separately |
| table-driven tests | `TestParseRemind`, `TestRemindLimits` | a slice of cases, one loop |
| `httptest.NewServer` | `newTestServer` | a real HTTP server on a free port |
| `t.Setenv`, `t.TempDir`, `t.Cleanup` | helpers | auto-restored env, auto-deleted folders, teardown that runs LIFO |
| `t.Helper()` | `waitFor` | failures point at the caller's line |

Run `go test -count=1 ./...` (`-count=1` disables the result cache).
The race detector (`-race`) needs cgo, which needs a C compiler that Go
supports on Windows (gcc/MinGW); it's not part of the default checks.

## 20. Principles applied

| Principle | Where in Go |
| --- | --- |
| **Single responsibility** | `hub.go` only fans out events; `claude.go` only speaks the Claude protocol; `server.go` only does HTTP |
| **Dependency injection** | `Claude.Bin`, `Server.Now`, `Claude.OnReply`: tests swap them |
| **Fail closed** | timeouts, crashes and unknown requests all end in *deny* |
| **Graceful degradation** | `MoodEngine` with `ok=false`, `Companion` ignoring a missing pipe |
| **Least privilege** | `--disallowedTools`, dedicated workdir, `?token=` only on `/events` |
| **Defense in depth** | Host check + token + CORS, each enough on its own for some attacks |
| **Make the zero value useful** | `MoodEngine{}`, `Companion{}` (empty pipe name = silent) |

## 21. Tooling: gofmt, vet, build

| Command | What it does |
| --- | --- |
| `gofmt -l .` / `-w .` | list / rewrite files that aren't in standard format (tabs, alignment) |
| `go vet ./...` | static checks: copied mutexes, wrong `Printf` verbs, unreachable code |
| `go test -count=1 ./...` | build and run all tests, no caching |
| `go build -o bin/teto-brain.exe .` | compile to one static executable; `.` = this package |

## 22. Exercises

1. Add `GET /version` (no token needed? decide and justify) with a test.
2. Make `/prompt` queue a second prompt instead of returning 409. Which
   goroutine owns the queue? Do you need a mutex or a channel?
3. Replace `map[string]any` events with typed structs implementing a
   `type()` method. What do you gain, what do you lose?
4. Self-check: why does `AnswerPermission` delete the map entry *before*
   sending on the channel?

## References

**Language**
- The Go Programming Language Specification: <https://go.dev/ref/spec>
- Effective Go: <https://go.dev/doc/effective_go>
- Go Tour, concurrency: <https://go.dev/tour/concurrency/1>
- Go blog, *Share Memory By Communicating*: <https://go.dev/blog/codelab-share>
- Go blog, *Working with Errors in Go 1.13* (`%w`, `errors.Is`): <https://go.dev/blog/go1.13-errors>

**Standard library**
- `net/http` patterns (Go 1.22): <https://pkg.go.dev/net/http#hdr-Patterns-ServeMux>
- `os/exec` and the current-directory lookup change ✔ (security section): <https://pkg.go.dev/os/exec#hdr-Executables_in_the_current_directory>
- `bufio.Scanner.Buffer`: <https://pkg.go.dev/bufio#Scanner.Buffer>
- `crypto/subtle`: <https://pkg.go.dev/crypto/subtle>
- `testing`: <https://pkg.go.dev/testing>

**Other explanations**
- Go by Example: <https://gobyexample.com/>
- Dave Cheney, *Practical Go*: <https://dave.cheney.net/practical-go/presentations/qcon-china.html>
