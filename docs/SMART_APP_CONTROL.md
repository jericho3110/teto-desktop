# Why building Rust needs Smart App Control off

On this project's development PC, **Windows Smart App Control** stopped
every Rust build with `An Application Control policy has blocked this
file. (os error 4551)`. This page explains what Smart App Control is, why
it hits Rust and not the other eight languages, the options, and what it
means for people who download Teto.

## Contents

1. [What Smart App Control is](#what-smart-app-control-is)
2. [What Cargo does that trips it](#what-cargo-does-that-trips-it)
3. [Why the other languages built fine](#why-the-other-languages-built-fine)
4. [What we observed (found live)](#what-we-observed-found-live)
5. [Options, and what we chose](#options-and-what-we-chose)
6. [When to turn it back on](#when-to-turn-it-back-on)
7. [What it means for people downloading Teto](#what-it-means-for-people-downloading-teto)
8. [Exercises](#exercises)
9. [References](#references)

## What Smart App Control is

A Windows 11 security feature that decides, **before any program or DLL
runs**, whether it's likely to be safe. In Microsoft's words, it
"selectively allows apps and binaries to run only if they're likely to be
safe", combining two things:

1. **App intelligence (cloud reputation):** Microsoft's services know
   millions of files. Popular, known-good files are allowed.
2. **Code integrity + signatures:** if the cloud has no opinion, a file is
   still allowed when it's **code-signed** with a certificate from a
   trusted certificate authority.

Everything else, meaning **"unknown, unsigned code", is blocked by default**.

| Mode | Behavior |
| --- | --- |
| Evaluation | watches; may switch itself off for developers |
| On (enforcement) | blocks unknown, unsigned code |
| Off | does nothing |

Since the April 2026 update (KB5083769) it can be turned back on without
reinstalling Windows. Before that, turning it off was permanent.

## What Cargo does that trips it

Building a Rust crate isn't only compiling. Cargo **compiles small
programs and then runs them** as part of the build:

```text
cargo build
 ├─ for each dependency with a build.rs:
 │    compile build.rs → target/…/build-script-build.exe   ← brand-new, unsigned, never seen before
 │    RUN it (it generates code, finds C compilers, …)       ← Smart App Control blocks HERE
 ├─ for each procedural-macro crate (serde_derive, tauri-macros, …):
 │    compile it → a .dll                                    ← brand-new, unsigned
 │    the compiler (rustc) LOADS that DLL to expand #[derive] ← and HERE
 └─ compile and link our crate
```

| Rust feature | Why it exists | What Smart App Control sees |
| --- | --- | --- |
| **build scripts** (`build.rs`) | run code at build time: our `build.rs` compiles the C module; `tauri-build` generates code; `autocfg` probes the compiler | a fresh `.exe` with no reputation and no signature, then asked to run |
| **procedural macros** | code that writes code (`#[derive(Serialize)]`, `#[tauri::command]`) | a fresh `.dll` loaded into `rustc` |

Teto's shell depends on ~400 crates, and dozens have build scripts or are
proc-macros, so *no* Tauri build can finish while enforcement is on.

## Why the other languages built fine

| Toolchain | Runs freshly built code during the build? | Observed |
| --- | --- | --- |
| Go (`go build`) | no (but `go test` runs a fresh test binary) | builds ran; test binaries ran too |
| clang (C, C++/wasm) | no | ran; the fresh C test `.exe` ran too |
| .NET (`dotnet build/test`) | the IL runs inside the signed `dotnet.exe` host | ran |
| javac / java | bytecode runs inside the signed `java.exe` | ran |
| Python, Node | scripts run inside signed interpreters | ran |
| **Cargo** | **yes: build scripts + proc-macro DLLs, hundreds of them** | **blocked** |

Notice that a few fresh executables (the Go test binary, the C test, a
"hello world" Rust program) **were** allowed. Smart App Control's decision
is a cloud-backed prediction, and Microsoft doesn't document every factor,
so we can't say exactly why those passed. What's certain is that Cargo
generates many brand-new unsigned binaries every build and some are
always blocked. (A Microsoft Learn Q&A thread linked below shows that even
**signed** but brand-new apps can be blocked until they build reputation.)

## What we observed (found live)

| Step | Result |
| --- | --- |
| `cargo install tauri-cli` with SAC on | `An Application Control policy has blocked this file. (os error 4551)` |
| `cargo build` of `rust/shell` | `failed to run custom build command for serde_core` / `proc-macro2` / `icu_properties_data` |
| a dependency-free `cargo new` hello world | built and ran |
| registry `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState` | `1` (on) before, `0` (off) after |
| everything after turning it off | built normally |

`python main.py doctor` reads that registry value and reports the state.

## Options, and what we chose

| Option | Pros | Cons |
| --- | --- | --- |
| **Turn SAC off while developing Rust** (chosen) | one toggle; everything works | the PC loses that protection while it's off (Microsoft Defender antivirus keeps running) |
| Build Rust inside WSL / a Linux VM and cross-compile | SAC stays on | Tauri's Windows cross-compiling is experimental; slower; the final unsigned `.exe` may still be blocked |
| A dev machine or VM without SAC | isolation | more setup |
| Replace Tauri/Rust with a C# window | SAC stays on | loses the Rust part of the learning project |
| Code-sign every build artifact | the "proper" enterprise answer | impossible for hundreds of throwaway build scripts |

## When to turn it back on

- **Now is fine.** Rust work for this milestone is done.
- Turn it **off** again only while building Rust (`python main.py run`,
  `python main.py package`, `cargo …`).
- Go, Python, C, C++, Java, C# and the UI build fine with it **on**.

## What it means for people downloading Teto

Teto's installer and binaries are **not code-signed** (a certificate costs
money and needs identity verification). On a PC with Smart App Control
**on**, Windows may block `Teto_0.1.0_x64-setup.exe` or the installed
`.exe`s, and on other PCs SmartScreen shows "Windows protected your PC /
unknown publisher". On other PCs users can click through SmartScreen; with
SAC **on** there is no per-app exception ("There is currently no way to
bypass Smart App Control protection for individual apps", per Microsoft's
FAQ), so those users can't run unsigned Teto. The real fix for a wider release is **code
signing** (a certificate from a trusted CA, or Microsoft's Trusted Signing
service) plus reputation over time. That's listed as future work in
[PACKAGING.md](PACKAGING.md).

## Exercises

1. Run `python main.py doctor` and find the Smart App Control line. Which registry value does it read?
2. Count how many build scripts Teto's shell has: `cargo metadata --format-version 1` lists packages; look for `custom-build` targets.
3. Self-check: why can't a "hello world" Rust program tell you whether a Tauri build will work under Smart App Control?

## References

### Official

- Microsoft Learn, Smart App Control (for developers) ✔: <https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview>
- Microsoft Support, Smart App Control FAQ ✔ (no per-app exceptions; can be turned off and back on): <https://support.microsoft.com/windows/smart-app-control-faq-285ea03d-fa88-4d56-882e-6698afdb7003>
- Microsoft Learn, test your app with Smart App Control: <https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control>
- Microsoft Learn, App Control for Business (the code-integrity technology underneath): <https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/appcontrol>
- Microsoft Learn, Trusted Signing (code signing service): <https://learn.microsoft.com/en-us/azure/trusted-signing/overview>
- The Cargo Book, build scripts: <https://doc.rust-lang.org/cargo/reference/build-scripts.html>
- The Rust Reference, procedural macros: <https://doc.rust-lang.org/reference/procedural-macros.html>

### Further learning

- Microsoft Learn Q&A, "Application signed and blocked by Smart App Control" (reputation matters even when signed): <https://learn.microsoft.com/en-us/answers/questions/5791210/application-signed-and-blocked-by-smart-app-contro>
- Smart App Control can now be re-enabled without reinstalling (KB5083769): <https://blog-en.topedia.com/2026/04/smart-app-control-in-windows-11-can-now-be-re-enabled-without-reinstalling/>
- Rust by Example, build scripts: <https://doc.rust-lang.org/rust-by-example/cargo/build_scripts.html>
- The Little Book of Rust Macros: <https://veykril.github.io/tlborm/>
