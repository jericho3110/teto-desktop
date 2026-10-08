"""Run every component's checks (format, lint, build, tests) in one go.

    python python/tools/check_all.py            # all
    python python/tools/check_all.py go java    # only some
    python python/tools/check_all.py --list

Exit code 0 only if every selected check passed, so it can gate commits:
    python python/tools/check_all.py && git commit ...

Tools are looked up on PATH first, then in their default Windows install
folders, so a fresh terminal isn't required after installing them.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Default install folders (Windows) for tools that may not be on PATH yet.
EXTRA_PATHS = [
    r"C:\Program Files\Go\bin",
    r"C:\Program Files\LLVM\bin",
    r"C:\Program Files\dotnet",
    *[str(p / "bin") for p in Path(r"C:\Program Files\Eclipse Adoptium").glob("jdk-*")],
    str(Path.home() / ".cargo" / "bin"),
]

# name -> (working folder, [commands]); each command is an argv list.
CHECKS: dict[str, tuple[str, list[list[str]]]] = {
    "go": ("go/brain", [
        ["gofmt", "-l", "."],  # special-cased: must print nothing
        ["go", "vet", "./..."],
        ["go", "test", "-count=1", "./..."],
        ["go", "build", "-o", "bin/teto-brain.exe", "."],
    ]),
    "python": (".", [
        [sys.executable, "-m", "unittest", "discover", "-s", "python/mood"],
        [sys.executable, "-m", "unittest", "discover", "-s", "python/tools"],
    ]),
    "cpp": ("cpp/physics", [
        ["npm", "run", "build", "--silent"],
        ["npm", "test", "--silent"],
    ]),
    "typescript": ("typescript/ui", [
        ["npm", "run", "sync-assets", "--silent"],
        ["npm", "run", "typecheck", "--silent"],
        ["npm", "test", "--silent"],
    ]),
    "java": ("java/reminders", [
        ["javac", "-Xlint:all", "-Werror", "-d", "out", *[str(p) for p in Path(ROOT, "java/reminders/src/teto/reminders").glob("*.java")]],
        ["javac", "-Xlint:all", "-Werror", "-cp", "out", "-d", "out-test", *[str(p) for p in Path(ROOT, "java/reminders/test/teto/reminders").glob("*.java")]],
        ["java", "-Djdk.httpclient.allowRestrictedHeaders=host", "-cp", os.pathsep.join(["out", "out-test"]), "teto.reminders.ReminderTest"],
    ]),
    "c": ("c/win32hooks", [
        ["clang", "-std=c11", "-Wall", "-Wextra", "-Werror", "-Iinclude", "src/teto_win32.c",
         "tests/test_teto_win32.c", "-luser32", "-o", "build/test_teto_win32.exe"],
        [str(ROOT / "c/win32hooks/build/test_teto_win32.exe")],
    ]),
    "csharp": ("csharp", [
        ["dotnet", "test", "Teto.slnx", "--nologo"],
        # Build into a temp folder: this only verifies it compiles, and a running
        # Teto locks bin/Release/TetoCompanion.exe (found live).
        ["dotnet", "build", "Companion", "-c", "Release", "--nologo",
         "-o", str(Path(tempfile.gettempdir()) / "teto-check-companion")],
    ]),
    "rust": ("rust/shell", [
        ["cargo", "fmt", "--check"],
        ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"],
        ["cargo", "test"],
    ]),
    "links": (".", [
        [sys.executable, "python/tools/check_links.py"],
    ]),
    # Dependency scanners + RCE/injection pattern sweep + project invariants.
    "security": (".", [
        [sys.executable, "python/tools/security_scan.py"],
    ]),
}


def env_with_tools() -> dict[str, str]:
    env = dict(os.environ)
    extra = [p for p in EXTRA_PATHS if Path(p).exists()]
    env["PATH"] = os.pathsep.join([*extra, env.get("PATH", "")])
    # Rust build output goes outside OneDrive: it's several GB, and OneDrive
    # folders make some build scripts (autocfg) think they can't write (found live).
    local = os.environ.get("LOCALAPPDATA")
    if local and "CARGO_TARGET_DIR" not in env:
        env["CARGO_TARGET_DIR"] = str(Path(local) / "Teto" / "cargo-target")
    return env


def run(name: str, env: dict[str, str]) -> bool:
    folder, commands = CHECKS[name]
    cwd = ROOT / folder
    (ROOT / "c/win32hooks/build").mkdir(parents=True, exist_ok=True)
    for argv in commands:
        exe = shutil.which(argv[0], path=env["PATH"]) or argv[0]  # resolves npm.cmd etc. on Windows
        print(f"  $ {' '.join(argv[:6])}{' …' if len(argv) > 6 else ''}", flush=True)
        proc = subprocess.run([exe, *argv[1:]], cwd=cwd, env=env, capture_output=True, text=True,
                              encoding="utf-8", errors="replace")
        failed = proc.returncode != 0 or (argv[0] == "gofmt" and proc.stdout.strip())
        if failed:
            print((proc.stdout + proc.stderr)[-3000:])
            return False
    return True


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if "--list" in args:
        print(" ".join(CHECKS))
        return 0
    selected = args or list(CHECKS)
    unknown = [a for a in selected if a not in CHECKS]
    if unknown:
        print(f"unknown check(s): {unknown}; try --list")
        return 2
    env = env_with_tools()
    results: dict[str, bool] = {}
    for name in selected:
        print(f"== {name}", flush=True)
        start = time.monotonic()
        results[name] = run(name, env)
        print(f"   {'PASS' if results[name] else 'FAIL'} ({time.monotonic() - start:.1f}s)", flush=True)
    print("\n" + "  ".join(f"{n}:{'ok' if ok else 'FAIL'}" for n, ok in results.items()))
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
