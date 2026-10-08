# Changelog: go/brain

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Permission requests now carry the complete tool input (`detail`); the
  160-character summary could hide the dangerous end of a command.
- Host header check against DNS rebinding; `?token=` only accepted on `/events`;
  an empty configured token rejects everyone.
- Default working folder is `~/TetoWorkspace` (Claude can read its working
  folder without asking), and tools that act without a prompt
  (`RemoteTrigger`, `CronCreate`, `CronDelete`, `SendUserFile`,
  `PushNotification`) are disallowed.
- Reminder client sends the shared token; `/remind` limits text to 500
  characters and delays to 1 minute..7 days (no `Duration` overflow).
- `MaxBytesReader` gets the real `ResponseWriter`.

### Changed
- A missing Claude Code now produces a clear "install it from code.claude.com"
  message in the bubble instead of a raw `exec` error (test added).
- Moved from `brain/` to `go/brain/`.

### Added
- Brain daemon: Claude Code driver (stream-json), SSE events, permission
  round trip (deny on timeout), `/remind`, token auth, CORS allow-list,
  clients for the mood engine, companion and reminder service.
