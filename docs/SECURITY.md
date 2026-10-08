# Security

Teto can run commands on your computer through Claude Code. This page is
the threat model, the defenses, the results of the security review done
before publishing, and the limits that remain.

## Contents

1. [Reporting a vulnerability](#reporting-a-vulnerability)
2. [What we protect, and from whom](#what-we-protect-and-from-whom)
3. [Trust boundaries](#trust-boundaries)
4. [Defenses, layer by layer](#defenses-layer-by-layer)
5. [Remote code execution (RCE): every path, and what closes it](#remote-code-execution-rce-every-path-and-what-closes-it)
6. [Security review (2026-10-08)](#security-review-2026-10-08)
7. [Continuous checks](#continuous-checks)
8. [Known limits (accepted risks)](#known-limits-accepted-risks)
9. [Safe-use checklist](#safe-use-checklist)
10. [Developer notes](#developer-notes)
11. [References](#references)

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
| Voice | the voicebank is downloaded by the user (its terms forbid redistribution, so it's never in the repo); parsed as untrusted data: bounded WAV parser, oto.ini paths can't leave the voicebank folder, size limits | `csharp/Companion/Voice/` |
| Downloads | `python main.py voice` shows the licence and asks first; HTTPS with certificate checks; the zip is extracted as untrusted data: zip-slip paths refused, only voicebank file types written (tests incl. a malicious zip) | `python/tools/runner.py: safe_extract` |
| Packaging | release binaries contain no local paths (`go build -trimpath`, debug-only `env!` in Rust); the voicebank is never bundled | `runner.py: package`, `supervisor.rs: Layout` |
| Processes | job object kills every helper when Teto exits or crashes (verified live: force-killing only `teto-shell.exe` took down brain, Python, Java and C# with it) | `c/win32hooks/src/teto_win32.c` |
| | children started by absolute path or `PATH`, never through a shell | `supervisor.rs`, `claude.go` |

## Remote code execution (RCE): every path, and what closes it

RCE means an attacker gets *their* code running on *your* machine. Teto
is unusual because one of its features is deliberately running commands
(Claude Code), so that feature is gated by you, and every *other* path is
closed. Walked through component by component:

| Entry point | How an attacker would try | Why it doesn't work |
| --- | --- | --- |
| **Claude Code itself** | prompt injection: a file or web page tells Claude to run `curl … \| sh` | every tool call that can change anything needs **your** click; the card shows the *complete* command; no answer / crash / unknown request = **deny**; tools that act without asking are disabled |
| **Brain HTTP API** (`127.0.0.1:47800`) | a web page you visit POSTs a prompt to localhost (CSRF), or rebinds its domain to 127.0.0.1 | 256-bit token required (pages can't read it, and can't send `Authorization` cross-origin without CORS approval), `Host` must be localhost, CORS allow-list; and even with the token, a prompt still needs your Allow |
| **Reminder service** (`127.0.0.1:47801`) | forge reminders to show scary text | token + Host check; it only stores text, executes nothing |
| **Companion pipe** | another program sends commands | current-user only; it can only *speak* or *notify*, never run anything |
| **Argument injection into child processes** | text like `"; rm -rf"` reaching a command line | no shell anywhere: every process is started with an argument **list**; user text goes to Claude on **stdin as JSON**, never as an argument |
| **Deserialization** (classic Java/.NET RCE) | a crafted object stream | no `ObjectInputStream`, `BinaryFormatter`, `pickle`, or YAML loading: only JSON/form/TSV parsers that build plain data (enforced by the scanner) |
| **UI script injection** | a reply containing `<img onerror=…>`, a malicious skin | model text only via `textContent`; skins pass an allow-list sanitizer; strict CSP (`script-src 'self'`) blocks inline and foreign scripts; no `eval` |
| **Tauri IPC** | a script in the webview calling powerful native APIs | no shell/fs/http/process plugins; capabilities allow only dragging, focus, click-through; one custom command (`get_config`); `withGlobalTauri` off |
| **Voicebank files** (downloaded data) | a crafted WAV with lying chunk sizes; an `oto.ini` naming `..\..\Windows\x.wav` | the WAV parser bounds-checks every chunk (C# is memory-safe; corrupt files are rejected, not trusted); oto.ini paths that leave the voicebank folder are refused (tests for both) |
| **C module** | an overly long window title overflowing a buffer | `GetWindowTextW` gets the buffer size; two-call sizing for conversions; no unbounded string functions (scanner-enforced) |
| **C++ in WebAssembly** | a bad index from JS writing outside an array | every exported function validates indexes; and wasm is sandboxed: it can only touch its own memory |
| **Quirks** (JS plugins) | a malicious quirk file | quirks are *trusted code by design*, bundled at build time from `javascript/quirks/`; the docs warn to install only quirks you've read |
| **DLL / binary hijacking** | a fake `claude.exe`/`python.exe` in the current folder | Go (≥1.19) and Rust never resolve programs from the current directory; helpers are started by absolute path. A malicious program earlier on your `PATH` is out of scope (it already runs as you) |
| **Dependencies** | a vulnerable or malicious package | stdlib-first (Go, Python, C, C++, Java have zero dependencies); lock files pin versions; four scanners run on every commit |

## Continuous checks

`python python/tools/check_all.py security` runs on every change
(`python/tools/security_scan.py`; full guide: [SECURITY_SCANNING.md](SECURITY_SCANNING.md)):

| Layer | What |
| --- | --- |
| Dependency scanners | `npm audit`, `dotnet list package --vulnerable --include-transitive`, `govulncheck`, `cargo audit` (RustSec) |
| Pattern sweep | HTML sinks, `eval`/`exec`, shell execution in every language, Java/.NET/Python deserialization, unbounded C string copies, `0.0.0.0` listeners, disabled TLS checks |
| Invariants | no secrets in tracked files, no voicebank files in git, CSP present, no powerful Tauri permissions |

The scanner was itself tested by planting an `innerHTML` sink,
`shell=True` and a fake API key in temporary files: all three were reported.

**Last results (2026-10-08):** npm 0, NuGet 0, govulncheck clean,
cargo audit 0 vulnerabilities in 407 crates with two reviewed warnings:
`proc-macro-error` is *unmaintained* (compile-time only, pulled in by
Tauri's macros) and `glib` has an *unsoundness* advisory (Tauri's Linux
GTK backend, not compiled on Windows). Both are transitive; they'll go
away when Tauri updates them.

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
| 13 | Low | `apps.js` looked up program names on a plain object: a program named `__proto__`/`constructor` hit JavaScript's built-ins (prototype-key lookup) | a `Map` | verified with a quick Node run |
| 14 | Medium (privacy) | Release binaries contained the developer's Windows user name: Rust embeds source paths for panic messages (174 paths into `~/.cargo`, 26 into `~/.rustup`), the C# exe recorded its `.pdb` path | `--remap-path-prefix` for cargo/rustup/repo paths, C# `DebugType=none`, Go `-trimpath`; `package` now **fails** if any shipped binary contains the home path or user name (UTF-8 or UTF-16) | `runner.py: assert_no_local_paths`; verified on all 107 installed files |

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
  scripts (explained in [SMART_APP_CONTROL.md](SMART_APP_CONTROL.md)), so building the Rust shell requires turning it off (Windows
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

### Further learning

- OWASP Cheat Sheet Series: <https://cheatsheetseries.owasp.org/>
- PortSwigger Web Security Academy (free labs): <https://portswigger.net/web-security>
- OWASP Top 10 for LLM Applications (prompt injection and more): <https://genai.owasp.org/llm-top-10/>
