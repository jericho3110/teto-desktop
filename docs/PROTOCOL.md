# Protocols

Every message that crosses a process boundary. If you change one side,
change the other and this file.

## Contents

1. [UI ↔ Rust shell (Tauri)](#ui--rust-shell-tauri)
1. [UI ↔ brain (HTTP + SSE)](#ui--brain-http--sse)
2. [Brain ↔ Claude Code (stream-json)](#brain--claude-code-stream-json)
3. [Brain ↔ mood engine](#brain--mood-engine)
4. [Brain → reminder service](#brain--reminder-service)
5. [Brain → companion](#brain--companion)
6. [References](#references)

## UI ↔ Rust shell (Tauri)

| Direction | Name | Payload |
| --- | --- | --- |
| UI → Rust (command) | `invoke("quit_app")` | none: exits; Rust stops every helper in `RunEvent::Exit` |
| UI → Rust (command) | `invoke("hide_window")` | none: hides the window; the tray icon or the hotkey shows it again |
| UI → Rust (command) | `invoke("get_config")` | returns `{"brainUrl": "http://127.0.0.1:47800", "token": "<64 hex>", "skin": "teto-chibi"}` |
| Rust → UI (event) | `native://cursor` | `{"x": 120.5, "y": 300}`: cursor in window CSS pixels, sent ~30×/s only when it moved |
| Rust → UI (event) | `native://idle` | `{"ms": 4200}`: time since the last keyboard/mouse input, every 2 s |
| Rust → UI (event) | `native://hotkey` | none: Ctrl+Alt+Space was pressed |
| Rust → UI (event) | `native://app` | `{"app": "Code.exe"}`: the foreground program changed (checked every 2 s). Only the program name; window titles are never sent |

The UI also calls Tauri's window API directly (allowed by
`rust/shell/capabilities/default.json`): `startDragging`, `setFocus`,
`setIgnoreCursorEvents`, `outerPosition`, `scaleFactor`, `onMoved`.

## UI ↔ brain (HTTP + SSE)

Base URL `http://127.0.0.1:47800`. Every request must have
`Host: 127.0.0.1` or `localhost` (else `403`), and every endpoint except
`/health` needs the token: header `Authorization: Bearer <token>`.
Only `/events` may pass it as `?token=` instead, because `EventSource`
can't set headers.

| Method + path | Body | Response |
| --- | --- | --- |
| `GET /health` | – | `200 ok` (no token needed) |
| `GET /events` | – | `text/event-stream`, one `data: <json>` per event |
| `POST /prompt` | `{"text": "..."}` (max 1 MiB) | `202` accepted · `409` busy · `400` empty · `401` bad token · `403` bad Host |
| `POST /permission` | `{"id": "...", "allow": true}` | `204` · `404` unknown/expired id |
| `POST /cancel` | – | `204` (sends an `interrupt` to Claude) |

Text starting with `/remind` is handled by the brain itself:
`/remind 10m text`, `/remind 2h text`, `/remind 17:30 text` (today, or
tomorrow if already past). Delays: 1 minute to 7 days; text: at most 500 characters.

### Events (brain → UI)

| `type` | Fields | When |
| --- | --- | --- |
| `status` | `state`: `"thinking"` \| `"idle"` | a prompt starts / finishes (or Claude exits) |
| `text_delta` | `text` | each streamed chunk of the reply |
| `tool_use` | `tool`, `summary` | Claude decided to call a tool |
| `permission_request` | `id`, `tool`, `summary` (≤160 chars, for status lines), `detail` (the **complete** input: shown on the card) | Claude needs approval: show Allow/Deny |
| `permission_expired` | `id` | nobody answered in 5 min; it was denied |
| `reply_done` | `text`, `is_error` | the final reply (authoritative full text) |
| `mood` | `emotion`, `intensity` (0..1) | right after `reply_done` |
| `reminder` | `text` | a reminder came due |

Real example, recorded with `python/tools/smoke_brain.py` (denying a Bash call; recorded before `detail` was added):

```json
{"state": "thinking", "type": "status"}
{"summary": "echo teto > hello.txt", "tool": "Bash", "type": "tool_use"}
{"id": "a0a6caa1-…", "summary": "echo teto > hello.txt", "tool": "Bash", "type": "permission_request"}
{"text": "Whoops! Permission", "type": "text_delta"}
{"is_error": false, "text": "Whoops! Permission denied for that bash command. …", "type": "reply_done"}
{"state": "idle", "type": "status"}
{"emotion": "sad", "intensity": 0.55, "type": "mood"}
```

## Brain ↔ Claude Code (stream-json)

Started as (see `claude.go: args()`):

```text
claude -p --input-format stream-json --output-format stream-json --verbose
          --include-partial-messages --permission-prompt-tool stdio
          --permission-mode manual
          --disallowedTools RemoteTrigger,CronCreate,CronDelete,SendUserFile,PushNotification
          --append-system-prompt "<persona>" [--model X]
```

Working folder: `-workdir`, default `~/TetoWorkspace`.

| Flag | Why |
| --- | --- |
| `-p` | non-interactive ("print") mode |
| `--input-format stream-json` | we send JSON lines on stdin, so one process can take many prompts |
| `--output-format stream-json` + `--verbose` | it sends JSON lines on stdout (`--verbose` is required with stream-json) |
| `--include-partial-messages` | adds `stream_event` lines with token-by-token `text_delta`s |
| `--permission-prompt-tool stdio` | permission requests come to *us* as `control_request`s |
| `--permission-mode manual` | otherwise the starting mode may be `auto` and approve things itself |
| `--disallowedTools ...` | tools that would act without a prompt even in manual mode (one comma-joined value: the flag is variadic) |
| `--append-system-prompt` | adds Teto's persona while keeping Claude Code's own system prompt |

**We write** (one JSON object per line):

```json
{"type":"control_request","request_id":"<id>","request":{"subtype":"initialize"}}
{"type":"user","message":{"role":"user","content":"run the tests"}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}
{"type":"control_response","response":{"subtype":"success","request_id":"<their id>",
  "response":{"behavior":"allow","updatedInput":{...the tool input...}}}}
{"type":"control_response","response":{"subtype":"success","request_id":"<their id>",
  "response":{"behavior":"deny","message":"The user denied this in Teto's bubble."}}}
```

**We read** (fields we use; others ignored):

| `type` | Used fields |
| --- | --- |
| `stream_event` | `event.delta.type == "text_delta"` → `event.delta.text` |
| `assistant` | `message.content[]` blocks with `type == "tool_use"`: `name`, `input` |
| `control_request` | `request.subtype == "can_use_tool"`: `request_id`, `request.tool_name`, `request.input` |
| `result` | `result` (final text), `is_error` |

Verified against Claude Code 2.1.268 with `python/tools/smoke_brain.py`
(both Allow and Deny, and the disallowed tools). The `can_use_tool` / `control_response` shapes are
the ones the official Agent SDKs use; the public docs describe the SDK
callbacks, not the raw wire format, so if a future version changes them,
the smoke test is how you'll notice.

## Brain ↔ mood engine

`python -u python/mood/mood.py`, one request line → exactly one response line:

```text
→ {"text": "Done! All 12 tests passed."}
← {"emotion": "happy", "intensity": 0.67}
```

Emotions: `neutral happy excited sad worried confused smug`. Bad input
still gets a (neutral) reply, so the brain never waits forever.

## Brain → reminder service

`http://127.0.0.1:47801` (Java). Requests are form-encoded, responses JSON.
Every request needs `Authorization: Bearer <token>` (else `401`) and a
localhost `Host` (else `403`). Bodies over 8 KB get `413`.

| Request | Response |
| --- | --- |
| `POST /reminders` `at=<unix ms>&text=<text>` | `201 {"id":"…","at":…,"text":"…"}` · `400` bad input or text over 500 characters |
| `GET /reminders` | `200 [ … ]` |
| `POST /due` | `200 [ due reminders ]`, which are removed: each fires once |

The brain polls `/due` every 15 s.

## Brain → companion

Named pipe `\\.\pipe\teto-companion` (C#). The brain connects, writes one
JSON line, disconnects. If the pipe doesn't exist, nothing happens. Only
processes of the same user can connect. Unknown commands, non-string
fields and lines over 16 KB are ignored; text is clipped to 1000
characters, titles to 64.

```json
{"cmd": "speak",  "text": "Done! All tests pass."}
{"cmd": "notify", "title": "Teto reminder", "text": "stretch"}
```

## References

### HTTP / SSE

- HTML Standard, Server-sent events (`data:` lines, blank-line separator, comments starting with `:`) ✔: <https://html.spec.whatwg.org/multipage/server-sent-events.html>
- RFC 6750, Bearer token usage: <https://www.rfc-editor.org/rfc/rfc6750>
- Go `net/http` routing patterns (`"POST /prompt"`, Go 1.22+): <https://pkg.go.dev/net/http#hdr-Patterns-ServeMux>

### Claude Code

- Run Claude Code programmatically ✔: <https://code.claude.com/docs/en/headless>
- CLI reference: <https://code.claude.com/docs/en/cli-reference>
- Agent SDK, handling permissions / user input: <https://code.claude.com/docs/en/agent-sdk/user-input>

### Others

- Python `-u` (unbuffered output): <https://docs.python.org/3/using/cmdline.html#cmdoption-u>
- HTML, `application/x-www-form-urlencoded`: <https://url.spec.whatwg.org/#application/x-www-form-urlencoded>
- Microsoft, Named pipe names (`\\.\pipe\name`): <https://learn.microsoft.com/en-us/windows/win32/ipc/pipe-names>

### Further learning

- MDN, an overview of HTTP: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview>
- Ilya Grigorik, High Performance Browser Networking (free book): <https://hpbn.co/>
