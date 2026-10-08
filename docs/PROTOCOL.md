# Protocols

Every message that crosses a process boundary. If you change one side,
change the other and this file.

## Contents

1. [UI ↔ brain (HTTP + SSE)](#ui--brain-http--sse)
2. [Brain ↔ Claude Code (stream-json)](#brain--claude-code-stream-json)
3. [Brain ↔ mood engine](#brain--mood-engine)
4. [Brain → reminder service](#brain--reminder-service)
5. [Brain → companion](#brain--companion)
6. [References](#references)

## UI ↔ brain (HTTP + SSE)

Base URL `http://127.0.0.1:47800`. Every endpoint except `/health` needs
the token: header `Authorization: Bearer <token>`, or `?token=` (only
needed by `/events`, because `EventSource` can't set headers).

| Method + path | Body | Response |
| --- | --- | --- |
| `GET /health` | – | `200 ok` (no token needed) |
| `GET /events` | – | `text/event-stream`, one `data: <json>` per event |
| `POST /prompt` | `{"text": "..."}` | `202` accepted · `409` busy · `400` empty · `401` bad token |
| `POST /permission` | `{"id": "...", "allow": true}` | `204` · `404` unknown/expired id |
| `POST /cancel` | – | `204` (sends an `interrupt` to Claude) |

Text starting with `/remind` is handled by the brain itself:
`/remind 10m text`, `/remind 2h text`, `/remind 17:30 text` (today, or
tomorrow if already past).

### Events (brain → UI)

| `type` | Fields | When |
| --- | --- | --- |
| `status` | `state`: `"thinking"` \| `"idle"` | a prompt starts / finishes (or Claude exits) |
| `text_delta` | `text` | each streamed chunk of the reply |
| `tool_use` | `tool`, `summary` | Claude decided to call a tool |
| `permission_request` | `id`, `tool`, `summary` | Claude needs approval: show Allow/Deny |
| `permission_expired` | `id` | nobody answered in 5 min; it was denied |
| `reply_done` | `text`, `is_error` | the final reply (authoritative full text) |
| `mood` | `emotion`, `intensity` (0..1) | right after `reply_done` |
| `reminder` | `text` | a reminder came due |

Real example, recorded from `tools/smoke_brain.py` (denying a Bash call):

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

```
claude -p --input-format stream-json --output-format stream-json --verbose
          --include-partial-messages --permission-prompt-tool stdio
          --permission-mode manual --append-system-prompt "<persona>" [--model X]
```

| Flag | Why |
| --- | --- |
| `-p` | non-interactive ("print") mode |
| `--input-format stream-json` | we send JSON lines on stdin, so one process can take many prompts |
| `--output-format stream-json` + `--verbose` | it sends JSON lines on stdout (`--verbose` is required with stream-json) |
| `--include-partial-messages` | adds `stream_event` lines with token-by-token `text_delta`s |
| `--permission-prompt-tool stdio` | permission requests come to *us* as `control_request`s |
| `--permission-mode manual` | otherwise the starting mode may be `auto` and approve things itself |
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

Verified against Claude Code 2.1.268 with `tools/smoke_brain.py`
(both Allow and Deny). The `can_use_tool` / `control_response` shapes are
the ones the official Agent SDKs use; the public docs describe the SDK
callbacks, not the raw wire format, so if a future version changes them,
the smoke test is how you'll notice.

## Brain ↔ mood engine

`python -u mood/mood.py`, one request line → exactly one response line:

```
→ {"text": "Done! All 12 tests passed."}
← {"emotion": "happy", "intensity": 0.67}
```

Emotions: `neutral happy excited sad worried confused smug`. Bad input
still gets a (neutral) reply, so the brain never waits forever.

## Brain → reminder service

`http://127.0.0.1:47801` (Java). Requests are form-encoded, responses JSON.

| Request | Response |
| --- | --- |
| `POST /reminders` `at=<unix ms>&text=<text>` | `201 {"id":"…","at":…,"text":"…"}` · `400` bad input |
| `GET /reminders` | `200 [ … ]` |
| `POST /due` | `200 [ due reminders ]`, which are removed: each fires once |

The brain polls `/due` every 15 s.

## Brain → companion

Named pipe `\\.\pipe\teto-companion` (C#). The brain connects, writes one
JSON line, disconnects. If the pipe doesn't exist, nothing happens.

```json
{"cmd": "speak",  "text": "Done! All tests pass."}
{"cmd": "notify", "title": "Teto reminder", "text": "stretch"}
```

## References

**HTTP / SSE**
- HTML Standard, Server-sent events (`data:` lines, blank-line separator, comments starting with `:`) ✔: https://html.spec.whatwg.org/multipage/server-sent-events.html
- RFC 6750, Bearer token usage: https://www.rfc-editor.org/rfc/rfc6750
- Go `net/http` routing patterns (`"POST /prompt"`, Go 1.22+): https://pkg.go.dev/net/http#hdr-Patterns-ServeMux

**Claude Code**
- Run Claude Code programmatically ✔: https://code.claude.com/docs/en/headless
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Agent SDK, handling permissions / user input: https://code.claude.com/docs/en/agent-sdk/user-input

**Others**
- Python `-u` (unbuffered output): https://docs.python.org/3/using/cmdline.html#cmdoption-u
- HTML, `application/x-www-form-urlencoded`: https://url.spec.whatwg.org/#application/x-www-form-urlencoded
- Microsoft, Named pipe names (`\\.\pipe\name`): https://learn.microsoft.com/en-us/windows/win32/ipc/pipe-names
