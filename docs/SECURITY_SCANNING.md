# The security scanner (`python/tools/security_scan.py`)

What the scanner checks, **why each check exists**, how it works inside,
how we proved it works, and what no scanner can catch. Run it with:

```powershell
python main.py test security                  # via the runner
python python/tools/security_scan.py           # directly
python python/tools/security_scan.py --no-scanners   # only the fast offline checks
```

Exit code 0 = no findings. It runs as part of every full `python main.py test`.

## Contents

1. [The three layers](#the-three-layers)
2. [Layer 1: dependency scanners (SCA)](#layer-1-dependency-scanners-sca)
3. [Layer 2: the dangerous-pattern sweep (a tiny SAST)](#layer-2-the-dangerous-pattern-sweep-a-tiny-sast)
4. [Layer 3: project invariants](#layer-3-project-invariants)
5. [How the script works](#how-the-script-works)
6. [Exceptions: `security-scan: allow`](#exceptions-security-scan-allow)
7. [How we know it works](#how-we-know-it-works)
8. [What it can't catch](#what-it-cant-catch)
9. [Other security checks in the project](#other-security-checks-in-the-project)
10. [Exercises](#exercises)
11. [References](#references)

## The three layers

| Layer | Question it answers | Industry name |
| --- | --- | --- |
| 1. dependency scanners | "Does code we *depend on* have known vulnerabilities?" | **SCA**: software composition analysis |
| 2. pattern sweep | "Did *we* write a construct that's known to be dangerous?" | **SAST**: static application security testing (a tiny, regex-based one) |
| 3. invariants | "Are the project's security rules still true?" | policy checks |

## Layer 1: dependency scanners (SCA)

Public databases record known vulnerabilities as **advisories**, usually
with a **CVE** id (Common Vulnerabilities and Exposures). Each scanner
compares the *exact* versions in our lock files against its language's database:

| Ecosystem | Command | Database | Notes |
| --- | --- | --- | --- |
| npm (TypeScript UI) | `npm audit --audit-level=low --json` | GitHub Advisory Database | reads `package-lock.json`; we parse the JSON instead of scraping text |
| .NET (C#) | `dotnet list package --vulnerable --include-transitive` | GitHub Advisory Database via NuGet | `--include-transitive` also checks dependencies of dependencies |
| Go | `go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...` | Go vulnerability database | **reachability**: reports only vulnerabilities in functions our code actually calls, including the standard library; pinned version for reproducibility |
| Rust | `cargo audit` | RustSec advisory database | also reports *warnings* (unmaintained, unsound) that we review by hand |
| Python, C, C++, Java | none needed | | zero third-party dependencies |

**Vulnerabilities vs warnings (Rust):** `cargo audit` exits non-zero
only for vulnerabilities. Our two reviewed warnings: `proc-macro-error`
is unmaintained (compile-time only) and `glib` is "unsound" (Tauri's Linux
backend, not compiled on Windows). Both come in through Tauri.

## Layer 2: the dangerous-pattern sweep (a tiny SAST)

Each rule targets a well-known **weakness class**, identified by its **CWE**
number (Common Weakness Enumeration, MITRE's catalogue of software weaknesses):

| Rule | Languages | Why it's dangerous | CWE |
| --- | --- | --- | --- |
| HTML injection sinks: `.innerHTML =`, `outerHTML`, `insertAdjacentHTML`, `document.write` | TS/JS | text from Claude or a skin could contain `<img onerror=…>`, which runs script (**XSS**) | [CWE-79](https://cwe.mitre.org/data/definitions/79.html) |
| dynamic code evaluation: `eval(`, `new Function(`, `exec(` | TS/JS/Python | turns data into code: if an attacker controls the string, they control the program | [CWE-95](https://cwe.mitre.org/data/definitions/95.html) |
| shell execution: `shell=True`, `os.system`, `exec.Command("sh"/"cmd"…)`, `Command::new("powershell")`, `Runtime.exec`, `UseShellExecute=true` | Python/Go/Rust/Java/C# | a shell interprets `;`, `&&`, `|`, so text that reaches it can add commands (**OS command injection**) | [CWE-78](https://cwe.mitre.org/data/definitions/78.html) |
| unsafe deserialization: `ObjectInputStream`, `BinaryFormatter`, `pickle.load`, `yaml.load` without `SafeLoader` | Java/C#/Python | these formats can encode *objects that run code while being rebuilt*: a classic RCE | [CWE-502](https://cwe.mitre.org/data/definitions/502.html) |
| unbounded C string copies: `strcpy`, `strcat`, `sprintf`, `gets`, `wcscpy` | C/C++ | they don't know the destination size: long input overflows the buffer | [CWE-120](https://cwe.mitre.org/data/definitions/120.html) |
| listening on all interfaces: `0.0.0.0`, `ListenAndServe(":port")` | Go/Java/C#/Rust/Python/TS | exposes the service to the network instead of only this PC | [CWE-1327](https://cwe.mitre.org/data/definitions/1327.html) |
| disabled TLS verification: `InsecureSkipVerify: true`, `verify=False`, custom certificate callbacks | all | anyone on the network can impersonate the server (man-in-the-middle) | [CWE-295](https://cwe.mitre.org/data/definitions/295.html) |

Why these and not hundreds of rules? Teto's risky surfaces are exactly
these: it runs processes, renders model text, parses downloaded files and
listens on localhost. Each rule maps to a door an attacker could use.

## Layer 3: project invariants

Rules specific to Teto that must stay true forever:

| Invariant | Why | CWE |
| --- | --- | --- |
| no secrets in tracked files (Anthropic/GitHub/AWS/Slack token patterns, private keys) | anything committed is public forever once the repo is public | [CWE-798](https://cwe.mitre.org/data/definitions/798.html) |
| no secret-looking files (`.env`, `.pem`, `.key`, `.pfx`) | same | CWE-798 |
| no voicebank files (`.wav`, `.frq`, `oto.ini`) | the voicebank licence forbids redistribution | – (licence) |
| `tauri.conf.json` has a CSP | the CSP is the backstop against injected scripts | CWE-79 |
| `withGlobalTauri` is off | otherwise every script in the page gets the Tauri API on `window` | – |
| no `shell:`/`fs:`/`http:`/`process:`/`opener:` permissions in capabilities | those would let the web UI run programs or read files | [CWE-250](https://cwe.mitre.org/data/definitions/250.html) (excessive privilege) |

## How the script works

```text
git ls-files --cached --others --exclude-standard     ← what WOULD be committed (respects .gitignore)
   │
   ├─ sweep(): for each (rule, globs, regex) × matching file × line
   │     skip comment lines and lines marked "security-scan: allow"
   │     regex hit → FINDING "rule: path:line: code"
   │
   ├─ invariants(): file types, secret regex, tauri.conf.json + capabilities parsed as JSON
   │
   └─ scanners(): run the four tools, parse their output (JSON where possible)
   │
exit 1 if any finding, else 0
```

Design choices:

- **Data-driven rules:** `PATTERNS` is a table; adding a rule is one line, not new code.
- **Scan what git would commit:** untracked-but-not-ignored files are
  scanned too, so a new file can't slip past before its first commit.
- **Comments are skipped:** documentation that *mentions* `innerHTML`
  (like `bubble.ts` saying "never innerHTML") isn't a finding.
- **Scanners are optional offline:** `--no-scanners` runs the instant checks.

## Exceptions: `security-scan: allow`

If a match is genuinely safe, add `// security-scan: allow <reason>` (or
`#` in Python) on that line. The reason stays visible in code review. The
repo currently needs **zero** exceptions.

## How we know it works

A scanner that never finds anything might simply be broken. So we
**planted** three problems in temporary files:

| Planted | Reported as |
| --- | --- |
| `document.body.innerHTML = location.hash;` | HTML injection sink |
| `subprocess.run("dir", shell=True)` | shell execution |
| a line assigning a fake Anthropic-style key (`sk-ant-` followed by 20 made-up letters; written out like that here, because the scanner would rightly flag this doc otherwise) | possible secret |

All three were reported, and after deleting the files the scan was clean
again. Deliberately planting faults to check that your checks catch them
is the idea behind **mutation testing**.

## What it can't catch

Being honest about limits is part of security:

- **Regexes don't understand data flow.** `subprocess.run(args)` with an
  argument list is safe, and the same call with a string from a web page
  isn't; only a human (or a much bigger tool like CodeQL or Semgrep)
  can follow where data comes from.
- **Logic flaws** (a missing permission check, a 160-character summary
  hiding a command) aren't patterns. That's why manual review is still
  done every change (see SECURITY.md's review table).
- **Unknown vulnerabilities** in dependencies aren't in any database yet.
- **Malicious but "valid" code** in a dependency (supply-chain attacks)
  usually looks normal.

Bigger tools worth knowing: **CodeQL** (GitHub's semantic analysis, free
for public repos), **Semgrep**, **Dependabot** (automatic dependency
alerts and update PRs on GitHub).

## Other security checks in the project

| Check | Where |
| --- | --- |
| privacy check: no home path / user name in shipped binaries | `runner.py: assert_no_local_paths` (runs during `package`) |
| zip-slip-safe extraction of downloads | `runner.py: safe_extract` + `test_runner.py` |
| security regression tests per finding | Go `brain_test.go`, Java `ReminderTest`, C# `VoiceTests`, TS `sanitize.test.ts` |
| full git-history secret scan before going public | documented in SECURITY.md |

## Exercises

1. Add a rule for Go's `template.HTML(` (which turns off HTML escaping). Plant a test line, run `--no-scanners`, then delete it.
2. Why does the scanner skip comment lines? Find a real comment in the repo that would otherwise be a false positive.
3. Run `go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 -show verbose ./...` in `go/brain`. What does "reachability" change compared to just listing versions?
4. Self-check: the scanner passed, so is Teto secure? What would you check next?

## References

### Official

- MITRE, Common Weakness Enumeration (CWE): <https://cwe.mitre.org/>
- MITRE, CWE Top 25 Most Dangerous Software Weaknesses: <https://cwe.mitre.org/top25/>
- CVE program: <https://www.cve.org/>
- GitHub Advisory Database: <https://github.com/advisories>
- npm, `npm audit`: <https://docs.npmjs.com/cli/v11/commands/npm-audit>
- .NET, `dotnet list package --vulnerable`: <https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-list>
- Go, vulnerability management and `govulncheck`: <https://go.dev/doc/security/vuln/>
- RustSec advisory database / `cargo audit`: <https://rustsec.org/>
- OWASP, Source Code Analysis Tools (SAST): <https://owasp.org/www-community/Source_Code_Analysis_Tools>
- OWASP, Component Analysis (SCA): <https://owasp.org/www-community/Component_Analysis>
- OWASP, Deserialization cheat sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html>
- OWASP, OS command injection defense: <https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html>
- GitHub, CodeQL: <https://codeql.github.com/>
- GitHub, Dependabot alerts: <https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts>

### Further learning

- OWASP Top Ten: <https://owasp.org/www-project-top-ten/>
- Semgrep, rule writing tutorial: <https://semgrep.dev/learn>
- PortSwigger Web Security Academy (free, hands-on XSS, injection, deserialization labs): <https://portswigger.net/web-security>
- Python, `subprocess` security considerations: <https://docs.python.org/3/library/subprocess.html#security-considerations>
