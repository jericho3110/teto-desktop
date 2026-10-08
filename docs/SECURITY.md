# Security

Teto can run commands on your computer through Claude Code. This page is
the threat model, the defenses, the results of the security review done
before publishing, and the limits that remain.

## Contents

1. [Reporting a vulnerability](#reporting-a-vulnerability)
2. [What we protect, and from whom](#what-we-protect-and-from-whom)
3. [Trust boundaries](#trust-boundaries)
4. [Defenses, layer by layer](#defenses-layer-by-layer)
5. [Security review (2026-10-08)](#security-review-2026-10-08)
6. [Known limits (accepted risks)](#known-limits-accepted-risks)
7. [Safe-use checklist](#safe-use-checklist)
8. [Developer notes](#developer-notes)
9. [References](#references)

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository
("Security" tab → "Report a vulnerability") instead of a public issue.

## What we protect, and from whom

| Asset | Threat |
| --- | --- |
| Your files and system | Claude running a harmful command, either through a mistake or **prompt injection** (malicious text in a file or web page it reads) |
| Your secrets (SSH keys, tokens, browser data) | being read silently and sent somewhere |
| Teto's control channels | **a web page you visit** sending requests to `127.0.0.1` (CSRF, DNS rebinding) |
| What Teto shows you | spoofed messages ("⏰ Your PC is infected, call…") used for social engineering |
| Teto's UI | malicious skins or quirks shared online |

**Out of scope:** malware already running as your user. It can do anything you
can, with or without Teto.

## Trust boundaries

```text
 internet / web pages ──✗── 127.0.0.1 services (token + Host check + CORS)
 Claude's model output ──── untrusted: shown as text, tool calls need YOUR click
 shared skins (SVG) ─────── untrusted: sanitized with an allow-list
 quirks (JS) ────────────── TRUSTED CODE: only install what you've read
 other Windows accounts ─✗─ companion pipe (current user only)
```

## Defenses, layer by layer

| Layer | Defense | Where |
| --- | --- | --- |
| Claude Code | `--permission-mode manual` + `--permission-prompt-tool stdio`: every action that needs approval comes to the bubble | `go/brain/claude.go` |
| | **fail closed**: no answer in 5 min, a crash, or an unknown request → deny | `claude.go: askPermission, readLoop` |
| | tools that act without a prompt are disabled: `RemoteTrigger`, `CronCreate`, `CronDelete`, `SendUserFile`, `PushNotification` | `claude.go: DisallowedTools` |
| | dedicated working folder `~/TetoWorkspace` (Claude reads its working folder without asking) | `go/brain/main.go` |
| Permission UI | the card shows the **complete** tool input, never a shortened summary | `claude.go: fullDetail`, `typescript/ui/src/bubble.ts` |
| Brain HTTP | listens on 127.0.0.1 only | `main.go` |
| | 256-bit random token, constant-time compare, empty token never valid; via env var, not command line | `server.go: withAuth`, `rust/shell/src/supervisor.rs` |
| | `Host` must be `127.0.0.1`/`localhost` (DNS rebinding) | `server.go: withLocalHost` |
| | CORS allow-list (Tauri origin + Vite dev); `?token=` only on `/events` | `server.go` |
| | 1 MiB body limit | `server.go: decode` |
| Java reminders | same token + Host check; 8 KB body / 500-character text limits; refuses to start without a token | `java/reminders/.../ReminderServer.java` |
| C# companion | pipe accepts only the current user; refuses to join a pre-existing pipe; input parsed defensively with size limits | `csharp/Companion/PipeListener.cs`, `Commands.cs` |
| UI | model text via `textContent` only (no HTML injection) | `bubble.ts` |
| | strict Content Security Policy: scripts only from the app, network only to the brain | `rust/shell/tauri.conf.json` |
| | least-privilege Tauri capabilities (drag, focus, click-through on its own window) | `rust/shell/capabilities/default.json` |
| | skins sanitized with an allow-list (no scripts, handlers, `foreignObject`, links, external `url()`) | `typescript/ui/src/sanitize.ts` |
| Privacy | the C module can read window titles, but only the foreground **program name** ever leaves the C/Rust layer (data minimization); `OpenProcess` asks only for `PROCESS_QUERY_LIMITED_INFORMATION` | `c/win32hooks`, `rust/shell/src/lib.rs` |
| Processes | job object kills every helper when Teto exits or crashes (verified live: force-killing only `teto-shell.exe` took down brain, Python, Java and C# with it) | `c/win32hooks/src/teto_win32.c` |
| | children started by absolute path or `PATH`, never through a shell | `supervisor.rs`, `claude.go` |

## Security review (2026-10-08)

Done before making the repository public. Every fix has a regression test.

| # | Severity | Finding | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | **High** | Permission cards showed a 160-character summary, so `echo hi` + spaces + `&& curl … \| sh` looked harmless | brain sends full `detail`; card shows it all (scrollable) | `TestPermissionDetailShowsTheWholeCommand` |
| 2 | **High** | Reminder service had no auth: any web page could POST a form to `127.0.0.1:47801` and make Teto display/announce attacker text | shared token + Host check | `ReminderTest.httpApi` ("no token → 401") |
| 3 | **High** | Default working folder was your home folder: `Read`/`Grep`/`Glob` need no approval inside it, so prompt injection could read secrets silently | default `~/TetoWorkspace` | `go/brain` flag default; documented |
| 4 | Medium | Some tools act without any prompt even in manual mode | `--disallowedTools` | `TestClaudeArgsKeepSafetyFlags`; verified live (Claude reports only `Read, Bash`) |
| 5 | Medium | DNS rebinding against localhost services (token already blocked it) | Host checks in Go and Java | `TestRejectsForeignHost`, Java "foreign Host → 403" |
| 6 | Medium | Tauri template shipped `"csp": null` | strict CSP + devCsp | `rust/shell/tauri.conf.json` |
| 7 | Medium | Shared skins could carry `<script>`/`onload` | allow-list sanitizer | `sanitize.test.ts` |
| 8 | Medium | An empty configured token would match an empty header (`ConstantTimeCompare("", "") == 1`) | reject when the configured token is empty | `TestEmptyConfiguredTokenRejectsEveryone` |
| 9 | Low | Unbounded bodies (Java), unbounded reminder text and delays (`Duration` overflow) | limits | `TestRemindLimits`, Java 413/400 checks |
| 10 | Low | Companion pipe could join a pipe pre-created by another program | `FirstPipeInstance` | `PipeListener.cs` |
| 11 | Low | The C test typed real keystrokes into your session | opt-in `TETO_TEST_INPUT=1` | `c/win32hooks/tests` |
| 12 | Info | `?token=` was accepted on every endpoint | only `/events` | `TestQueryTokenOnlyWorksForEvents` |

Also checked, no issue found:

- **Secrets in git history:** none. Tokens are generated at runtime; docs use `devtoken`.
- **Commit identity:** commits use the GitHub `noreply` address.
- **Command injection:** no shell is ever involved; arguments are passed as lists.
- **Dependencies:** Go, Python, C, C++ and Java use only their standard
  libraries. `npm audit` (typescript/ui): 0 vulnerabilities.
  `dotnet list package --vulnerable --include-transitive` (csharp): none.
  Rust: see [rust/README.md](../rust/README.md#security).

## Known limits (accepted risks)

| Limit | Why it's accepted | Mitigation |
| --- | --- | --- |
| **You** are the last line of defense: Allow means allow | that's the design ("ask in bubble") | the card shows the full command; read it |
| Read-only tools need no approval inside `~/TetoWorkspace` | Claude Code's design; makes her useful | keep secrets out of that folder |
| Quirks are full JavaScript inside the UI | they're plugins by design | only install quirks you've read |
| The Go client doesn't verify the companion pipe's owner | Go's standard library can't easily do it | worst case, local malware that can already run as you reads the text Teto speaks |
| Same-user programs can talk to the services if they find the token | the token lives in process environments | same-user malware is out of scope |
| `ui_probe.mjs` opens a DevTools port (9333) while it runs | dev tool only, temporary profile | don't run it on shared machines |

## Safe-use checklist

- Read every permission card before clicking **Allow**, especially `Bash`/`PowerShell`.
- Don't point `-workdir` at your home folder or anywhere with secrets.
- Only add skins and quirks from people you trust (skins are sanitized; quirks are not).
- Keep Claude Code updated (`claude update`).

## Developer notes

- The **Smart App Control** setting in Windows 11 blocks Cargo build
  scripts, so building the Rust shell requires turning it off (Windows
  Security → App & browser control). Since KB5083769 (April 2026) it can be
  turned back on afterwards without reinstalling Windows.
- New endpoint? Add it behind `withLocalHost` + `withAuth` and write a
  "no token → 401" test.
- New field shown to the user? `textContent`, never `innerHTML`.

## References

### Official

- Claude Code, permission modes and tools that need approval ✔: <https://code.claude.com/docs/en/tools-reference>
- Claude Code, run programmatically (`--permission-mode`, `--disallowedTools`) ✔: <https://code.claude.com/docs/en/headless>
- OWASP, Cross-Site Request Forgery: <https://owasp.org/www-community/attacks/csrf>
- OWASP, XSS prevention cheat sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html>
- MDN, Content Security Policy: <https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP>
- MDN, CORS ("simple requests" are sent without a preflight): <https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#simple_requests>
- Tauri, Content Security Policy: <https://v2.tauri.app/security/csp/>
- Tauri, capabilities: <https://v2.tauri.app/security/capabilities/>
- .NET `PipeOptions.CurrentUserOnly` ✔: <https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.pipeoptions>
- Microsoft, job objects: <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- Go `os/exec`, executables in the current directory ✔: <https://pkg.go.dev/os/exec#hdr-Executables_in_the_current_directory>

### Other

- Simon Willison, *Prompt injection* series: <https://simonwillison.net/series/prompt-injection/>
- Wikipedia, DNS rebinding: <https://en.wikipedia.org/wiki/DNS_rebinding>
- Smart App Control re-enable without reinstall (KB5083769): <https://blog-en.topedia.com/2026/04/smart-app-control-in-windows-11-can-now-be-re-enabled-without-reinstalling/>
