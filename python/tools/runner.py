"""Teto's runner: one entry point for setting up, building, running,
testing and packaging all nine languages. Called by the root main.py.

    python main.py doctor     what's installed / missing
    python main.py build      build every helper (Go, C++/wasm, Java, C#, UI)
    python main.py run        build, then start Teto (cargo tauri dev)
    python main.py test [x]   all checks incl. security (python/tools/check_all.py)
    python main.py voice      download Teto's official UTAU voicebank (asks first)
    python main.py package    build the Windows installer into dist/

Standard library only. Every external command is run with an argument
list (never through a shell) and stops at the first failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_all import ROOT, env_with_tools  # noqa: E402  (shared PATH + CARGO_TARGET_DIR setup)

ENV = env_with_tools()
VOICEBANK_URL = "https://kasaneteto.jp/assets/download/utau/TETO-tandoku-100619.zip"
VOICES_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Teto" / "voices"
BINARIES = ROOT / "rust/shell/binaries"
# Staging lives OUTSIDE OneDrive: the bundled Java runtime is ~40 MB and
# OneDrive syncs (and briefly locks) files there (found live).
STAGE = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Teto" / "stage"


def sh(argv: list[str], cwd: str | Path = ".", check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run a command (argument list, no shell) in a repo folder, streaming its output."""
    exe = shutil.which(argv[0], path=ENV["PATH"]) or argv[0]  # finds npm.cmd etc.
    print(f"$ {' '.join(argv)}   (in {cwd})", flush=True)
    proc = subprocess.run([exe, *argv[1:]], cwd=ROOT / cwd, env=ENV, text=True)
    if check and proc.returncode != 0:
        sys.exit(f"failed: {' '.join(argv)} (exit {proc.returncode})")
    return proc


def capture(argv: list[str]) -> str:
    """Run a command and return its stdout. On Windows, `env=` sets the
    CHILD's PATH but the program itself is looked up with OUR PATH, so we
    resolve it with shutil.which first (found live: rustc "not found")."""
    exe = shutil.which(argv[0], path=ENV["PATH"]) or argv[0]
    return subprocess.run([exe, *argv[1:]], env=ENV, capture_output=True, text=True, check=True).stdout


def have(tool: str) -> bool:
    return shutil.which(tool, path=ENV["PATH"]) is not None


# ---- doctor ----------------------------------------------------------------

def smart_app_control() -> str:
    try:
        import winreg  # Windows-only standard module
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\CI\Policy") as k:
            value, _ = winreg.QueryValueEx(k, "VerifiedAndReputablePolicyState")
        return {0: "off", 1: "ON (blocks Rust build scripts)", 2: "evaluation"}.get(value, str(value))
    except (ImportError, OSError):
        return "unknown"


def doctor(_: argparse.Namespace) -> None:
    rows = [
        ("go", "Go brain", "winget install GoLang.Go"),
        ("python", "mood engine, tools", "python.org"),
        ("node", "UI build", "nodejs.org"),
        ("clang", "C++ → wasm, C tests", "winget install LLVM.LLVM"),
        ("javac", "Java reminders", "winget install EclipseAdoptium.Temurin.25.JDK"),
        ("jlink", "packaging: bundled Java runtime", "(part of the JDK)"),
        ("dotnet", "C# companion", "winget install Microsoft.DotNet.SDK.10"),
        ("cargo", "Rust shell", "rustup.rs"),
        ("cargo-tauri", "run/package", "cargo install tauri-cli --version ^2 --locked"),
        ("cargo-audit", "security check", "cargo install cargo-audit --locked"),
        ("claude", "Claude Code (required at runtime)", "code.claude.com"),
    ]
    print(f"{'tool':12} {'needed for':34} status")
    for tool, why, how in rows:
        ok = have(tool)
        print(f"{tool:12} {why:34} {'ok' if ok else 'MISSING  → ' + how}")
    bank = any(VOICES_DIR.rglob("oto.ini")) if VOICES_DIR.exists() else False
    print(f"\nvoicebank    {'installed' if bank else 'not installed  → python main.py voice'}  ({VOICES_DIR})")
    print(f"Smart App Control: {smart_app_control()}")


# ---- build -------------------------------------------------------------------

def build(_: argparse.Namespace | None = None) -> None:
    sh(["go", "build", "-o", "bin/teto-brain.exe", "."], "go/brain")
    sh(["npm", "run", "build", "--silent"], "cpp/physics")
    java_sources = [str(p) for p in (ROOT / "java/reminders/src/teto/reminders").glob("*.java")]
    sh(["javac", "-Xlint:all", "-Werror", "-d", "out", *java_sources], "java/reminders")
    sh(["dotnet", "build", "Companion", "-c", "Release", "--nologo", "-v", "quiet"], "csharp")
    if not (ROOT / "typescript/ui/node_modules").exists():
        sh(["npm", "install"], "typescript/ui")
    sh(["npm", "run", "sync-assets", "--silent"], "typescript/ui")
    print("\nbuild: all helpers built")


def run(_: argparse.Namespace) -> None:
    build()
    sh(["cargo", "tauri", "dev"], "rust/shell")


def test(args: argparse.Namespace) -> None:
    sys.exit(sh([sys.executable, "python/tools/check_all.py", *args.checks], check=False).returncode)


# ---- voice -------------------------------------------------------------------

TERMS = """\
Kasane Teto UTAU voice library (single syllables), (c) Oyama Mayo / TWINDRILL.
Terms (summary of the bundled 使用許諾条件.txt; the full text is authoritative):
  - free for NON-COMMERCIAL use, no credit required
  - do NOT redistribute the library (modified or not)
  - no illegal, hateful or obscene use; don't claim you made the voice
Official page: https://kasaneteto.jp/utau/
"""


def safe_extract(zip_path: Path, dest: Path) -> int:
    """Extract a downloaded zip as UNTRUSTED data: no path traversal, only
    the file types a voicebank contains, Shift-JIS file names decoded."""
    allowed = {".wav", ".frq", ".ini", ".txt", ".bmp"}
    root = dest.resolve()
    count = 0
    # The zip was made on Japanese Windows: names without the UTF-8 flag are
    # Shift-JIS (cp932). metadata_encoding (Python 3.11+) decodes exactly those.
    # (Found live: re-encoding Python's cp437 guess broke on Python 3.14.)
    with zipfile.ZipFile(zip_path, metadata_encoding="cp932") as z:
        for info in z.infolist():
            name = info.filename
            target = (root / name).resolve()
            if not target.is_relative_to(root):
                sys.exit(f"refusing to extract {name!r}: it points outside {root}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if target.suffix.lower() not in allowed or info.file_size > 16 * 1024 * 1024:
                print(f"  skipping unexpected file {name!r}")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
            count += 1
    return count


def voice(args: argparse.Namespace) -> None:
    print(TERMS)
    if any(VOICES_DIR.rglob("oto.ini")) if VOICES_DIR.exists() else False:
        print(f"Already installed in {VOICES_DIR}.")
        return
    if not args.yes and input("Do you accept these terms and want to download it? [y/N] ").strip().lower() != "y":
        print("Not downloaded.")
        return
    dest = VOICES_DIR / "teto-tandoku"
    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / "teto.zip"
        print(f"downloading {VOICEBANK_URL} ...")
        urllib.request.urlretrieve(VOICEBANK_URL, zip_path)  # HTTPS, certificate checked by default
        print(f"extracted {safe_extract(zip_path, dest)} files to {dest}")
    print("Restart Teto (or the companion) and pick Voice → Teto in the tray menu.")


# ---- package -----------------------------------------------------------------

def target_triple() -> str:
    out = capture(["rustc", "-vV"])
    return next(line.split(": ", 1)[1] for line in out.splitlines() if line.startswith("host: "))


def assert_no_local_paths(files: list[Path]) -> None:
    """Fail the package if a shipped binary contains this machine's home
    folder or user name (ASCII or UTF-16). Found live: Rust panic paths and
    the C# .pdb path both leaked the user name before the fixes above."""
    user = Path.home().name
    needles = {str(Path.home()), user} if len(user) >= 4 else {str(Path.home())}
    for f in files:
        data = f.read_bytes()
        for n in needles:
            if n.encode("utf-8") in data or n.encode("utf-16-le") in data:
                sys.exit(f"{f.name} contains a local path / user name ({n!r}); refusing to package")
    print(f"privacy check: {len(files)} binaries contain no local paths")


def package(_: argparse.Namespace) -> None:
    triple = target_triple()
    build()
    BINARIES.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(STAGE, ignore_errors=True)

    # Sidecars must be named <name>-<target triple>.exe (Tauri strips the suffix on install).
    sh(["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(BINARIES / f"teto-brain-{triple}.exe"), "."], "go/brain")
    # DebugType=none: no .pdb, so the exe doesn't record the folder it was built in.
    sh(["dotnet", "publish", "Companion", "-c", "Release", "-r", "win-x64", "--self-contained", "false",
        "-p:PublishSingleFile=true", "-p:DebugType=none", "-p:DebugSymbols=false",
        "-o", str(STAGE / "companion"), "--nologo"], "csharp")
    shutil.copy2(STAGE / "companion/TetoCompanion.exe", BINARIES / f"TetoCompanion-{triple}.exe")

    # Java: compiled classes + a minimal runtime containing only the modules
    # the code uses (jdeps finds them, jlink builds the runtime).
    java_out = ROOT / "java/reminders/out"
    shutil.copytree(java_out, STAGE / "helpers/java/classes", dirs_exist_ok=True)
    mods = capture(["jdeps", "--print-module-deps", "--ignore-missing-deps", str(java_out)]).strip()
    print(f"java modules needed: {mods}")
    sh(["jlink", "--add-modules", mods, "--strip-debug", "--no-header-files", "--no-man-pages",
        "--compress=zip-6", "--output", str(STAGE / "helpers/java/runtime")])

    # The packaging-only config (sidecars + resources), with the stage's
    # absolute paths filled in. tauri.bundle.conf.json is the template.
    bundle_conf = json.loads((ROOT / "rust/shell/tauri.bundle.conf.json").read_text(encoding="utf-8"))
    bundle_conf["bundle"]["resources"] = {
        str(ROOT / "python/mood/mood.py"): "helpers/mood/mood.py",
        str(STAGE / "helpers/java") + os.sep: "helpers/java/",
    }
    conf_path = STAGE / "tauri.bundle.conf.json"
    conf_path.write_text(json.dumps(bundle_conf, indent=2), encoding="utf-8")
    # Rust embeds source paths (for panic messages), including dependencies in
    # ~/.cargo, so the binary would contain your user name. Remap them.
    # Also the toolchain: generic std code compiled into our binary carries
    # ~/.rustup paths (found by the privacy check below).
    cargo_home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    rustup_home = Path(os.environ.get("RUSTUP_HOME", Path.home() / ".rustup"))
    ENV["RUSTFLAGS"] = " ".join(f"--remap-path-prefix={src}={dst}" for src, dst in
                                [(cargo_home, "cargo"), (rustup_home, "rustup"), (ROOT, "teto")])
    sh(["cargo", "tauri", "build", "--config", str(conf_path)], "rust/shell")
    del ENV["RUSTFLAGS"]

    assert_no_local_paths([BINARIES / f"teto-brain-{triple}.exe", BINARIES / f"TetoCompanion-{triple}.exe",
                           Path(ENV["CARGO_TARGET_DIR"]) / "release/teto-shell.exe"])

    bundle = Path(ENV["CARGO_TARGET_DIR"]) / "release/bundle/nsis"
    installers = sorted(bundle.glob("*-setup.exe"), key=lambda p: p.stat().st_mtime)
    if not installers:
        sys.exit(f"no installer found in {bundle}")
    (ROOT / "dist").mkdir(exist_ok=True)
    final = ROOT / "dist" / installers[-1].name
    shutil.copy2(installers[-1], final)
    print(f"\ninstaller: {final} ({final.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="python main.py", description="Build, run, test and package Teto.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor", help="check installed tools").set_defaults(fn=doctor)
    sub.add_parser("build", help="build every helper").set_defaults(fn=build)
    sub.add_parser("run", help="build, then start Teto").set_defaults(fn=run)
    t = sub.add_parser("test", help="run all checks (or some: go rust security ...)")
    t.add_argument("checks", nargs="*")
    t.set_defaults(fn=test)
    v = sub.add_parser("voice", help="download Teto's voicebank (asks first)")
    v.add_argument("--yes", action="store_true", help="accept the terms without asking")
    v.set_defaults(fn=voice)
    sub.add_parser("package", help="build the Windows installer into dist/").set_defaults(fn=package)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
