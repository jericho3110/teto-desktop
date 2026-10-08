# Brain architecture

## Files and their one job each

| File | Responsibility |
| --- | --- |
| `main.go` | flags, wiring (who calls whom), start the server. The *composition root* |
| `server.go` | HTTP: middleware (Host check → CORS → token), routes, SSE, `/remind` parsing |
| `hub.go` | publish/subscribe: fan events out to every connected UI |
| `claude.go` | the Claude Code protocol: start the process, read its lines, permission round trips |
| `services.go` | clients for the helpers: mood (pipes), companion (named pipe), reminders (HTTP) |
| `brain_test.go` | tests, including a fake Claude |

## Data flow

```text
 HTTP POST /prompt ─► Server.prompt ─► Claude.Prompt ─► claude stdin
                                                         │
 claude stdout ─► Claude.readLoop ─► handle() ─► Hub.Publish ─► SSE /events ─► UI
                                       │
                                       ├─ can_use_tool ─► askPermission (goroutine, waits on channel)
                                       │                        ▲
 HTTP POST /permission ─► AnswerPermission ─────────────────────┘
                                       │
                                       └─ result ─► OnReply ─► MoodEngine.Analyze ─► Hub (mood)
                                                           └─► Companion.Speak
```

## Decisions

| Decision | Alternatives | Why this one | Cost |
| --- | --- | --- | --- |
| One long-lived `claude` process | a new `claude -p` per prompt (+ `--resume`) | conversation memory for free, no startup delay per prompt | must handle the process dying (`readLoop` resets state) |
| SSE + POST | WebSocket | stdlib only; traffic is mostly server→UI | token in the query string for `/events` |
| `map[string]any` events | typed structs per event | short, flexible | typos in keys aren't caught by the compiler; the TS `BrainEvent` union is the real contract |
| Mutex + channels | only channels (an actor goroutine owning all state) | simplest code for a small amount of state | must be careful about lock scope |
| Stateless companion client (connect per message) | a persistent pipe connection | companion can restart any time | a connect per message (trivial at this rate) |

## Known limits

- One prompt at a time (409 when busy).
- No restart of a crashed mood engine; the Rust supervisor would be the place for that.
- If the UI isn't connected when a permission request arrives, nobody sees
  it and it's denied after 5 minutes (fail closed).

## References

- Go blog, *Go Concurrency Patterns: Pipelines*: <https://go.dev/blog/pipelines>
- Mark Seemann, *Composition Root*: <https://blog.ploeh.dk/2011/07/28/CompositionRoot/>
