# Packaging: from nine languages to one installer

How `python main.py package` turns the whole polyglot project into a
single Windows installer anyone can download, what the user still needs,
and what it would take to run Teto on macOS or Linux.

## Contents

1. [The runner: `main.py`](#the-runner-mainpy)
2. [What ends up in the installer](#what-ends-up-in-the-installer)
3. [The packaging pipeline, step by step](#the-packaging-pipeline-step-by-step)
4. [Concepts: sidecars, resources, jlink, single-file publish](#concepts-sidecars-resources-jlink-single-file-publish)
5. [Dev layout vs installed layout](#dev-layout-vs-installed-layout)
6. [What users need](#what-users-need)
7. [Publishing a release on GitHub](#publishing-a-release-on-github)
8. [Cross-platform: what would it take?](#cross-platform-what-would-it-take)
9. [Security of the package](#security-of-the-package)
10. [References](#references)

## The runner: `main.py`

One front door for everything (logic in `python/tools/runner.py`):

| Command | What it runs |
| --- | --- |
| `python main.py doctor` | finds each tool on `PATH` (and in default install folders), checks the voicebank and Smart App Control |
| `python main.py build` | `go build`, the C++→wasm build, `javac`, `dotnet build`, `npm install` (first time), asset sync |
| `python main.py run` | `build`, then `cargo tauri dev` |
| `python main.py test [checks]` | `python/tools/check_all.py` (every language + links + security) |
| `python main.py voice [--yes]` | shows the voicebank terms, asks, downloads over HTTPS, extracts safely |
| `python main.py package` | everything below; the installer lands in `dist/` |

Why Python for the runner? It's on every developer machine, its standard
library covers processes, zips, downloads and the Windows registry, and it
reads like a recipe. `main.py` at the root is just the front door; it uses
`runpy.run_path` to run the real script.

## What ends up in the installer

```text
Teto_0.1.0_x64-setup.exe  (NSIS installer, per-user, no admin rights)
└─ %LOCALAPPDATA%\Programs\Teto\        (default install folder)
   ├─ Teto.exe                 Rust/Tauri shell, with the UI + wasm + skins + quirks embedded
   ├─ teto-brain.exe           Go brain (sidecar)
   ├─ TetoCompanion.exe        C# tray/voice (sidecar; framework-dependent single file)
   └─ helpers\
      ├─ mood\mood.py           Python mood engine (resource)
      └─ java\
         ├─ classes\...          compiled reminder service
         └─ runtime\...          a minimal Java runtime built by jlink
```

## The packaging pipeline, step by step

| Step | Command | Flags explained |
| --- | --- | --- |
| 1. build everything | `python main.py build` | see above |
| 2. brain sidecar | `go build -trimpath -ldflags=-s -w -o binaries/teto-brain-<triple>.exe .` | `-trimpath` removes your local folder paths from the binary; `-s -w` strips debug symbols (smaller) |
| 3. companion | `dotnet publish Companion -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true` | `-r win-x64` = target platform; `--self-contained false` = use the installed .NET runtime (small); `PublishSingleFile` = one `.exe` |
| 4. Java modules | `jdeps --print-module-deps --ignore-missing-deps java/reminders/out` | analyzes the compiled classes and prints which JDK modules they use (`java.base,jdk.httpserver`) |
| 5. Java runtime | `jlink --add-modules <mods> --strip-debug --no-header-files --no-man-pages --compress=zip-6 --output %LOCALAPPDATA%\Teto\stage\helpers\java
untime` | builds a runtime containing *only* those modules. The stage is **outside OneDrive**: OneDrive synced and locked the ~40 MB runtime (found live) |
| 6. the app | `cargo tauri build --config <stage>	auri.bundle.conf.json` (generated from the template in `rust/shell/` with the stage's absolute paths) | release build (optimized, LTO, stripped), embeds the built UI, adds sidecars + resources from the extra config, makes the NSIS installer |
| 7. copy | → `dist/Teto_<version>_x64-setup.exe` | |

`<triple>` is Rust's **target triple**, e.g. `x86_64-pc-windows-msvc`
(CPU-vendor-OS-ABI). Tauri requires sidecars to carry it so one repo can
hold binaries for several platforms; the installer installs them without it.

## Concepts: sidecars, resources, jlink, single-file publish

- **Sidecar**: a helper executable shipped with a Tauri app
  (`bundle.externalBin`). Ours are the Go brain and the C# companion.
- **Resource**: a data file shipped with the app (`bundle.resources`),
  mapped from a source path to a path inside the install folder.
- **Two config files**: `tauri.conf.json` (always used) and
  `tauri.bundle.conf.json` (merged only when packaging, via `--config`).
  Tauri checks that sidecars exist on *every* build, so keeping them in the
  packaging-only file lets `cargo test` and `cargo tauri dev` work on a fresh clone.
- **jlink + jdeps**: since Java 9 the JDK is split into modules.
  `jdeps` finds which ones your code uses; `jlink` assembles a custom
  runtime with just those (tens of MB instead of a full JDK), so users
  don't need Java installed.
- **Framework-dependent vs self-contained (.NET)**: framework-dependent
  needs the .NET runtime installed but is ~200 KB; self-contained bundles
  the runtime (~70+ MB for Windows Forms). We chose small: if the .NET 10
  Desktop Runtime is missing, the supervisor skips the companion (no
  voice/tray) instead of letting it show an error dialog.
- **NSIS**: the Nullsoft Scriptable Install System, which makes a classic
  `setup.exe`. `installMode: currentUser` installs into your profile, with no
  admin rights and no UAC prompt.
- **LTO** (link-time optimization) in `[profile.release]`: the compiler
  optimizes across crate boundaries; slower build, smaller faster binary.

## Dev layout vs installed layout

`rust/shell/src/supervisor.rs: Layout` chooses where helpers live:

| | Debug build (`cargo tauri dev`) | Release build (installed) |
| --- | --- | --- |
| brain | `go/brain/bin/teto-brain.exe` | `<install>/teto-brain.exe` |
| mood | `python/mood/mood.py` | `<install>/helpers/mood/mood.py` |
| Java | `java` on PATH + `java/reminders/out` | `<install>/helpers/java/runtime/bin/java.exe` + `classes` |
| companion | `csharp/Companion/bin/Release/.../TetoCompanion.exe` | `<install>/TetoCompanion.exe` |

The dev paths use `env!("CARGO_MANIFEST_DIR")`, a **compile-time** value,
and are compiled only into debug builds (`#[cfg(debug_assertions)]`).
Otherwise a released `.exe` would contain the developer's folder path,
including their Windows user name.

## What users need

| Need | Why | If missing |
| --- | --- | --- |
| Windows 10/11 (x64) | Win32 APIs, WebView2 | – |
| WebView2 runtime | Tauri's web view | preinstalled on Windows 11; the installer can fetch it |
| **Claude Code**, logged in | the brain | prompts fail with an explanation in the bubble |
| .NET 10 Desktop Runtime | companion (tray, voice) | Teto works without voice/tray |
| Python 3.10+ | mood engine | moods stay neutral |
| Teto's voicebank (`python main.py voice`, or from kasaneteto.jp) | Teto voice | Windows voice is used instead |

## Publishing a release on GitHub

```powershell
gh release create v0.1.0 dist\Teto_0.1.0_x64-setup.exe --title "Teto 0.1.0" --notes-file CHANGELOG.md
```

`gh release create <tag> <files>` creates a git tag and a GitHub
Release with the installer attached as a download. Users get it from the
repo's **Releases** page. The installer is **not code-signed**, so Windows
SmartScreen will warn "unknown publisher" (code-signing certificates cost
money; the docs explain this to users).

## Cross-platform: what would it take?

Today Teto is **Windows-only**. Here is each part, honestly:

| Part | Windows-only? | Port to macOS / Linux |
| --- | --- | --- |
| Rust shell (Tauri) | no | Tauri supports both; transparency/click-through differ per OS |
| TypeScript UI, C++ wasm, quirks | no | unchanged |
| Go brain | almost | named-pipe client → Unix domain socket |
| Python mood | no | unchanged |
| Java reminders | no | jlink per platform |
| **C module** | **yes** (Win32) | rewrite per OS behind the same header: macOS (Quartz `CGEventSourceSecondsSinceLastEventType`, `NSEvent.mouseLocation`, Carbon hotkeys), Linux X11 (`XScreenSaverQueryInfo`, `XQueryPointer`, `XGrabKey`); Wayland restricts global cursors/hotkeys. Job objects → process groups (`setpgid`/`killpg`) |
| **C# companion** | **yes** (Windows Forms, SAPI voice, named pipes) | tray via a cross-platform library (Avalonia) or move tray into Tauri (it has a tray API); voice playback via a cross-platform audio library |
| Installer | NSIS | Tauri also builds `.dmg`/`.app` (macOS) and `.deb`/`.AppImage`/`.rpm` (Linux) |

So a port is a real but bounded project: one new C file per OS, the C#
parts moved into Tauri or a cross-platform UI library, and a socket instead
of a pipe. The architecture (small processes with small protocols) is
what makes that possible without touching the rest.

## Security of the package

- The voicebank is **never** bundled (licence + the scanner enforces it).
- **No local paths in binaries** (found live: the first installer contained the user name
  200 times): Go `-trimpath`; Rust `--remap-path-prefix` for `~/.cargo`, `~/.rustup` and the
  repo (Rust embeds source paths for panic messages, including the standard library's
  generic code); C# `DebugType=none` (no `.pdb` path); the debug-only `env!` in the
  supervisor. `package` scans every shipped binary for the home path and user name
  (UTF-8 and UTF-16) and refuses to finish if it finds one.
- Tested end to end: silent install (`setup.exe /S /D=<folder>`), all 107 files scanned,
  the installed app started all four helpers from its own folder, killing it took the
  helpers down (job object), and `uninstall.exe /S` left no files.
- Release Rust builds use `panic = "abort"` and are stripped.
- Downloads (`voice`) use HTTPS with certificate checks (Python's default),
  and extraction refuses zip-slip paths and unexpected file types (tested).
- Unsigned binaries: users have to trust the GitHub release. Publishing
  checksums (`Get-FileHash`) next to the installer lets them verify the download.

## References

### Official

- Tauri, distributing (NSIS, Windows installer): <https://v2.tauri.app/distribute/windows-installer/>
- Tauri, embedding external binaries (sidecars): <https://v2.tauri.app/develop/sidecar/>
- Tauri, resources: <https://v2.tauri.app/develop/resources/>
- Tauri CLI, `build --config`: <https://v2.tauri.app/reference/cli/#build>
- Go command, `-trimpath`, `-ldflags`: <https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies>
- .NET, single-file deployment: <https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview>
- .NET, framework-dependent vs self-contained: <https://learn.microsoft.com/en-us/dotnet/core/deploying/>
- `jlink`: <https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html>
- `jdeps`: <https://docs.oracle.com/en/java/javase/25/docs/specs/man/jdeps.html>
- Python, `zipfile` (`metadata_encoding`): <https://docs.python.org/3/library/zipfile.html#zipfile.ZipFile>
- Python, `runpy`: <https://docs.python.org/3/library/runpy.html>
- GitHub CLI, `gh release create`: <https://cli.github.com/manual/gh_release_create>
- Rust, platform support and target triples: <https://doc.rust-lang.org/rustc/platform-support.html>

### Other

- Snyk, *Zip Slip vulnerability*: <https://security.snyk.io/research/zip-slip-vulnerability>
- NSIS: <https://nsis.sourceforge.io/Main_Page>

### Further learning

- Tauri, distribute your app: <https://v2.tauri.app/distribute/>
- Microsoft, introduction to code signing: <https://learn.microsoft.com/en-us/windows/win32/seccrypto/cryptography-tools>
