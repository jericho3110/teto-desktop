"""Security scan: run before every commit (python python/tools/check_all.py security).

Three layers:
1. Dependency scanners: known vulnerabilities in what we depend on
   (npm audit, dotnet list --vulnerable, govulncheck, cargo audit).
2. Dangerous-pattern sweep over tracked source files: constructs that
   classically lead to remote code execution (RCE) or injection.
3. Project invariants: no secrets, no voicebank files in git, the Tauri
   CSP and capabilities stay strict.

Exit code 0 = clean. A line can opt out of one pattern with a trailing
comment containing "security-scan: allow" plus a reason, so every
exception is visible in review.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALLOW = "security-scan: allow"

# (description, file globs, regex). Each entry is a known RCE / injection vector.
PATTERNS: list[tuple[str, tuple[str, ...], str]] = [
    ("HTML injection sink (use textContent)", ("*.ts", "*.js", "*.mjs"),
     r"\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\("),
    ("dynamic code evaluation", ("*.ts", "*.js", "*.mjs", "*.py"), r"(?<![\w.])eval\(|new Function\(|(?<![\w.])exec\("),
    ("shell execution", ("*.py",), r"shell\s*=\s*True|os\.system\(|os\.popen\("),
    ("shell execution", ("*.go",), r"exec\.Command\(\s*\"(sh|bash|cmd|cmd\.exe|powershell|pwsh)\""),
    ("shell execution", ("*.rs",), r"Command::new\(\s*\"(sh|bash|cmd|cmd\.exe|powershell|pwsh)\""),
    ("shell execution", ("*.java",), r"Runtime\.getRuntime\(\)\.exec|new ProcessBuilder\(\s*\"(sh|cmd)"),
    ("shell execution", ("*.cs",), r"UseShellExecute\s*=\s*true|Process\.Start\("),
    ("unsafe deserialization (classic RCE)", ("*.java",), r"ObjectInputStream|XMLDecoder"),
    ("unsafe deserialization (classic RCE)", ("*.cs",), r"BinaryFormatter|NetDataContractSerializer|SoapFormatter|TypeNameHandling"),
    ("unsafe deserialization (classic RCE)", ("*.py",), r"pickle\.loads?\(|marshal\.loads?\(|yaml\.load\((?!.*SafeLoader)"),
    ("unbounded C string copy", ("*.c", "*.h", "*.cpp", "*.hpp"), r"\b(strcpy|strcat|sprintf|vsprintf|gets|wcscpy|wcscat|lstrcpy\w*)\s*\("),
    ("listener on all interfaces", ("*.go", "*.java", "*.cs", "*.rs", "*.py", "*.ts"), r"0\.0\.0\.0|ListenAndServe\(\":"),
    ("TLS verification disabled", ("*.go", "*.py", "*.cs", "*.java", "*.ts", "*.rs"),
     r"InsecureSkipVerify:\s*true|verify\s*=\s*False|ServerCertificateCustomValidationCallback|danger_accept_invalid"),
]

SECRETS = re.compile(
    r"sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[bp]-[A-Za-z0-9-]{10,}"
)

findings: list[str] = []


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True).stdout
    return [ROOT / line for line in out.splitlines() if line]


def sweep(files: list[Path]) -> None:
    for desc, globs, pattern in PATTERNS:
        rx = re.compile(pattern)
        for f in files:
            if not any(f.match(g) for g in globs) or "security_scan.py" in f.name:
                continue
            for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith(("//", "#", "*", "/*")) or ALLOW in line:
                    continue  # comments describing a pattern aren't uses of it
                if rx.search(line):
                    findings.append(f"{desc}: {f.relative_to(ROOT)}:{n}: {stripped[:120]}")


def invariants(files: list[Path]) -> None:
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        if f.suffix.lower() in {".wav", ".frq"} or f.name.lower() == "oto.ini":
            findings.append(f"voicebank file in the repo (its terms forbid redistribution): {rel}")
        if f.suffix.lower() in {".png", ".ico", ".icns", ".wasm", ".exe", ".dll"}:
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if SECRETS.search(text):
            findings.append(f"possible secret: {rel}")
        if f.name in {".env"} or f.suffix in {".pem", ".key", ".pfx"}:
            findings.append(f"secret-looking file tracked: {rel}")

    conf = json.loads((ROOT / "rust/shell/tauri.conf.json").read_text(encoding="utf-8"))
    if not conf.get("app", {}).get("security", {}).get("csp"):
        findings.append("tauri.conf.json: Content Security Policy is missing")
    if conf.get("app", {}).get("withGlobalTauri"):
        findings.append("tauri.conf.json: withGlobalTauri exposes the API to every script")
    caps = json.loads((ROOT / "rust/shell/capabilities/default.json").read_text(encoding="utf-8"))
    for perm in caps.get("permissions", []):
        name = perm if isinstance(perm, str) else perm.get("identifier", "")
        if re.match(r"(shell|fs|http|process|opener):", name):
            findings.append(f"capabilities: powerful permission granted to the UI: {name}")


def run(argv: list[str], cwd: str) -> subprocess.CompletedProcess[str]:
    exe = shutil.which(argv[0], path=os.environ.get("PATH")) or argv[0]
    return subprocess.run([exe, *argv[1:]], cwd=ROOT / cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def scanners() -> None:
    npm = run(["npm", "audit", "--audit-level=low", "--json"], "typescript/ui")
    try:
        vulns = json.loads(npm.stdout).get("metadata", {}).get("vulnerabilities", {})
        total = sum(v for k, v in vulns.items() if k != "total" and isinstance(v, int))
        print(f"  npm audit: {total} vulnerabilities")
        if total:
            findings.append(f"npm audit: {vulns}")
    except json.JSONDecodeError:
        findings.append("npm audit: could not run")

    dn = run(["dotnet", "list", "Teto.slnx", "package", "--vulnerable", "--include-transitive"], "csharp")
    bad = "has the following vulnerable packages" in dn.stdout
    print(f"  dotnet vulnerable packages: {'FOUND' if bad else 'none'}")
    if bad or dn.returncode != 0:
        findings.append("dotnet: vulnerable packages\n" + dn.stdout[-1500:])

    gv = run(["go", "run", "golang.org/x/vuln/cmd/govulncheck@v1.8.0", "./..."], "go/brain")
    print(f"  govulncheck: {'clean' if gv.returncode == 0 else 'FOUND'}")
    if gv.returncode != 0:
        findings.append("govulncheck:\n" + (gv.stdout + gv.stderr)[-1500:])

    if shutil.which("cargo-audit") or (Path.home() / ".cargo/bin/cargo-audit.exe").exists():
        ca = run(["cargo", "audit"], "rust/shell")
        # Exit code != 0 only for real vulnerabilities; "unmaintained"/"unsound"
        # warnings are reviewed and documented in docs/SECURITY.md.
        print(f"  cargo audit: {'clean (warnings reviewed)' if ca.returncode == 0 else 'FOUND'}")
        if ca.returncode != 0:
            findings.append("cargo audit:\n" + ca.stdout[-1500:])
    else:
        findings.append("cargo-audit not installed (cargo install cargo-audit --locked)")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    files = [f for f in tracked_files() if f.is_file()]
    sweep(files)
    invariants(files)
    print(f"  pattern sweep + invariants: {len(files)} files")
    if "--no-scanners" not in sys.argv:
        scanners()
    for f in findings:
        print("FINDING:", f)
    print(f"security: {len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
