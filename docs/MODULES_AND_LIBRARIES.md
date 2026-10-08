# Modules, packages and libraries in every language

How each of Teto's nine languages splits code into pieces, imports
them, and pulls in libraries, explained starting from the Python terms
you know. The inventory of *which* libraries are used where is in
[LIBRARIES_AND_BUILTINS.md](LIBRARIES_AND_BUILTINS.md); this page is the
concepts.

## Contents

1. [The vocabulary, translated](#the-vocabulary-translated)
2. [Three questions every language answers](#three-questions-every-language-answers)
3. [Python (the reference point)](#python-the-reference-point)
4. [C: headers, translation units and the linker](#c-headers-translation-units-and-the-linker)
5. [C++: headers, plus (optional) real modules](#c-headers-plus-optional-real-modules)
6. [Go: packages and modules](#go-packages-and-modules)
7. [Rust: crates and modules](#rust-crates-and-modules)
8. [Java: packages, classpath, JARs, modules](#java-packages-classpath-jars-modules)
9. [C#: namespaces and assemblies](#c-namespaces-and-assemblies)
10. [JavaScript and TypeScript: ES modules and npm](#javascript-and-typescript-es-modules-and-npm)
11. [Standard libraries compared](#standard-libraries-compared)
12. [External libraries in Teto, and why so few](#external-libraries-in-teto-and-why-so-few)
13. [Static vs dynamic linking](#static-vs-dynamic-linking)
14. [Principles](#principles)
15. [Exercises](#exercises)
16. [References](#references)

## The vocabulary, translated

| Python term | C | C++ | Go | Rust | Java | C# | JS / TS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **module** (one `.py` file) | a `.c` file (*translation unit*) + its `.h` header | `.cpp` + `.hpp` (or a C++20 *module*) | a **package** (a whole folder!) | a **module** (`mod`, a file or inline block) | a **class** file | a file (no meaning to the compiler) | a **module** (one file) |
| **package** (folder with `__init__.py`) | – (just folders) | – (namespaces group names, not files) | the folder *is* the package | a module tree inside a crate | a **package** (`teto.reminders` = folder `teto/reminders/`) | a **namespace** (`Teto.Companion`) | a folder (or an npm package) |
| **distribution** (what `pip install` gets) | a library (`.lib`/`.a` or `.dll`/`.so`) + headers | same | a **module** (`go.mod`) | a **crate** | a **JAR** | an **assembly** (`.dll`) in a **NuGet package** | an **npm package** |
| `import x` | `#include "x.h"` | `#include` / `import x;` | `import "net/http"` | `use std::sync::Mutex;` | `import java.nio.file.Path;` | `using System.Text.Json;` | `import { x } from "./x"` |
| **pip** + **PyPI** | none built in (vcpkg, Conan) | same | `go get` + proxy.golang.org | **Cargo** + crates.io | Maven/Gradle + Maven Central | `dotnet add package` + nuget.org | **npm** + npmjs.com |
| `requirements.txt` / `pyproject.toml` | – | – | `go.mod` | `Cargo.toml` | `pom.xml` / `build.gradle` | `.csproj` | `package.json` |
| a lock file | – | – | `go.sum` | `Cargo.lock` | (Gradle lockfile) | `packages.lock.json` | `package-lock.json` |
| private by convention (`_name`) | `static` (file-private) | `static` / anonymous namespace / `private:` | **lowercase** name | no `pub` | `private` / package-private | `private` / `internal` | not exported |
| standard library | **libc** (small) | libc + **STL** | huge ("batteries included") | `std` (medium) | **JDK** (huge) | **BCL** (huge) | the browser's or Node's APIs |

## Three questions every language answers

1. **How do I split my code?** (files, modules, packages)
2. **How do I use code from elsewhere?** (import/include, and is it resolved by the compiler, the linker, or at runtime?)
3. **How do I get other people's code?** (package manager, registry, lock file)

Python answers all three at **runtime**: `import` runs the module file the
first time it's imported. Compiled languages answer them at **build time**,
and C/C++ split it further between the *compiler* and the *linker*.

## Python (the reference point)

- `import json` finds `json` on `sys.path`, runs it once, caches it in
  `sys.modules`. A folder with `__init__.py` is a **regular package**.
- Teto's Python uses only the standard library: `json`, `re`, `pathlib`,
  `subprocess`, `unittest`, `urllib`, `threading`, `concurrent.futures`, …
- `python -m unittest discover -s python/mood` adds `python/mood` to
  `sys.path`, which is why the test can `from mood import analyze`.

## C: headers, translation units and the linker

You remembered right that headers are like modules, but there's an
important twist: **a header is not a module; it's text that gets pasted in.**

```text
teto_win32.h ──#include (copy-paste by the preprocessor)──► teto_win32.c ──compile──► teto_win32.obj ─┐
                                                                                                         ├─ link ─► program
teto_win32.h ──#include──► test_teto_win32.c ──compile──► test_teto_win32.obj ─────────────────────────┘
                                                              user32.lib (Windows) ────────────────────┘
```

1. **Preprocessor:** `#include "teto_win32.h"` literally inserts the file's
   text. Include guards (`#ifndef TETO_WIN32_H`) stop double insertion.
2. **Compiler:** each `.c` file plus everything it included is one
   **translation unit**, compiled alone into an object file. The header
   only *declares* `int teto_cursor_pos(int32_t *x, int32_t *y);`, a promise
   that it exists somewhere.
3. **Linker:** joins the object files and libraries, and connects each call
   to the one *definition*. A missing definition is a **linker** error
   ("unresolved external symbol"), not a compiler error.

| Concept | In Teto |
| --- | --- |
| interface vs implementation | `include/teto_win32.h` vs `src/teto_win32.c` |
| file-private (Python's `_name`) | `static` functions/globals (`hotkey_thread`, `g_lock`) |
| `#include <...>` vs `"..."` | angle brackets search system folders (`<windows.h>`, `<stdint.h>`); quotes search next to the file first |
| standard library | **libc**: small (`<stdio.h>`, `<stdint.h>`, `<string.h>`…). For windows, threads and hotkeys you go to the **OS API** (`<windows.h>`), linked from `user32.lib`/`kernel32.lib` |
| package manager | none built in (vcpkg, Conan exist). That's one of C's weaknesses, and a reason Rust's Cargo builds our C (`build.rs` + the `cc` crate) |

## C++: headers, plus (optional) real modules

C++ inherited C's model: `spring_chain.hpp` is pasted into `exports.cpp`.
Templates usually live **entirely in headers**, because the compiler must
see the whole template wherever it's used.

- **Namespaces** (`namespace teto`) group *names*, not files: they prevent
  clashes, but don't change how files are found.
- **C++20 modules** (`export module teto.physics;` / `import teto.physics;`)
  are a real module system: compiled once, no copy-paste, no include
  guards. Teto doesn't use them yet; build-tool support is still uneven.
- **Standard library:** the C++ standard library (containers like
  `std::vector`, algorithms, `std::unique_ptr`…, historically called the
  STL). Our wasm physics is **freestanding**: no standard library at all
  (`-nostdlib`), so it brings its own `sin` and `clamp`.

## Go: packages and modules

- A **package is a folder**: every `.go` file in `go/brain/` says
  `package main` and they all see each other's names without imports.
  That's different from Python, where each file is its own module.
- A **module** (`go.mod`) is a versioned tree of packages:
  `module github.com/jericho3110/teto-desktop/brain`. Import paths look
  like URLs because `go get` can fetch from them.
- **Visibility by capitalization:** `Claude.Prompt` is exported; `summarize`
  isn't.
- **Standard library:** famously large. HTTP server *and* client, JSON,
  crypto, testing, `os/exec`, regex: everything the brain needs.
  `go.sum` doesn't exist because we have zero dependencies.

## Rust: crates and modules

- A **crate** is a compilation unit: `teto-shell` builds a library crate
  (`teto_shell_lib`) and a binary crate (`main.rs`).
- **Modules** are declared, not discovered: `mod native;` in `lib.rs` makes
  the compiler read `native.rs`. Files that aren't declared are ignored.
- `use std::sync::Mutex;` brings a name into scope (like `from x import y`).
- Items are **private by default**; `pub` exports.
- **Cargo + crates.io** is the package manager; `Cargo.lock` pins versions.
- **Standard library:** `std` is medium-sized on purpose. No HTTP, no JSON,
  no random numbers. Those are crates (`serde_json`, `getrandom`), which is
  why Rust projects have more dependencies than Go ones.

## Java: packages, classpath, JARs, modules

- `package teto.reminders;` must match the folder `teto/reminders/`.
  One public class per file, file named after it.
- `import java.nio.file.Path;` imports one class; `import static ...UTF_8`
  imports a static member.
- At runtime the JVM finds classes on the **classpath** (`-cp out`).
  Libraries ship as **JARs** (zip files of `.class` files).
- Java 9 added the **module system** (JPMS, `module-info.java`), which declares
  which packages a JAR exports. The built-in HTTP server lives in the JDK
  module `jdk.httpserver`. Small apps like ours can ignore JPMS.
- **Standard library (JDK):** huge: HTTP server and client, NIO files,
  concurrency, crypto. But **no JSON parser**, which is why the brain sends
  Java forms.

## C#: namespaces and assemblies

- `namespace Teto.Companion;` groups names (like C++ namespaces); folders
  and namespaces are only *conventionally* aligned.
- `using System.Text.Json;` imports a namespace. **Implicit usings**
  (`<ImplicitUsings>`) auto-import common ones.
- The unit of distribution is an **assembly** (`TetoCompanion.exe`, `.dll`),
  shipped in **NuGet packages** (`System.Speech`, `xunit`).
- `internal` = visible inside the assembly only; `public` = everywhere.
- **Standard library (BCL):** huge: JSON, pipes, regex with source generation,
  Windows Forms on Windows.

## JavaScript and TypeScript: ES modules and npm

- Each file is a **module**; nothing is shared unless `export`ed.
  `import { Bubble } from "./bubble"`; `export default function poke(...)`.
- **Two module systems** exist for historical reasons: ES modules
  (`import`/`export`, used here) and Node's older CommonJS
  (`require`/`module.exports`). `.mjs` forces ES modules.
- **Dynamic import:** `await import("/quirks/poke.js")` loads a module at
  runtime: Python's `importlib.import_module`.
- `import type { Skin }` (TS only) imports a type that disappears after compilation.
- **npm** + `package.json` + `package-lock.json`. `@types/node` packages
  add TypeScript types for JavaScript libraries.
- **Standard library:** there isn't one in the Python sense. You get the
  *host's* APIs: the browser (`fetch`, `EventSource`, DOM, `WebAssembly`)
  or Node (`node:fs`, `node:test`…).

## Standard libraries compared

| Need in Teto | Python | Go | Rust | Java | C# | C | JS/TS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| JSON | ✅ `json` | ✅ `encoding/json` | ❌ crate `serde_json` | ❌ (writing by hand is easy) | ✅ `System.Text.Json` | ❌ | ✅ built in |
| HTTP server | ⚠️ basic `http.server` | ✅ `net/http` | ❌ crate | ✅ `jdk.httpserver` | ✅ `HttpListener` (ASP.NET Core ships alongside) | ❌ | Node ✅ |
| Child processes + pipes | ✅ `subprocess` | ✅ `os/exec` | ✅ `std::process` | ✅ `ProcessBuilder` | ✅ `Process` | OS API | Node ✅ |
| Random bytes for secrets | ✅ `secrets` | ✅ `crypto/rand` | ❌ crate `getrandom` | ✅ `SecureRandom` | ✅ `RandomNumberGenerator` | OS API | ✅ `crypto` |
| Regex | ✅ | ✅ | ❌ crate `regex` | ✅ | ✅ | ❌ | ✅ |
| Windows tray, voices | ❌ | ❌ | ❌ crates | ❌ | ✅ | OS API | ❌ |

That table *is* the project's division of labor: each job went to a
language whose standard library already does it.

## External libraries in Teto, and why so few

Only the UI (Vite, TypeScript, Tauri's JS API), the Rust shell (Tauri,
serde, getrandom, cc) and C# (System.Speech, xUnit) use external packages.
Every dependency is code you didn't write but now ship: more to audit,
more to update, a bigger attack surface (the "supply chain"). So the rule
is **standard library first**, and every exception is justified in
[LIBRARIES_AND_BUILTINS.md](LIBRARIES_AND_BUILTINS.md).

## Static vs dynamic linking

| | Static | Dynamic |
| --- | --- | --- |
| What | library code copied **into** the executable | executable loads a separate `.dll`/`.so` at runtime |
| In Teto | the C module → `teto_win32.lib`, linked into `teto-shell.exe` by Cargo; Go links everything statically into `teto-brain.exe` | Windows' own `user32.dll`; .NET assemblies; the WebView2 runtime |
| Pros | one file to ship, no "DLL not found" | shared updates, smaller files |
| Cons | bigger file; security fixes need a rebuild | version mismatches ("DLL hell") |

## Principles

- **Information hiding:** expose a small interface (a header, `pub`
  items, capitalized names, `export`) and keep the rest private.
- **Explicit dependencies:** declare them in one file (`go.mod`,
  `Cargo.toml`, `.csproj`, `package.json`) and pin them with a lock file.
- **Standard library first** (YAGNI applied to dependencies).

## Exercises

1. In `c/win32hooks`, delete the definition of `teto_idle_ms` from the
   `.c` file but keep the header. Does the compiler or the linker complain?
2. Add a second file `go/brain/version.go` with `func version() string`.
   Do you need to import it from `main.go`?
3. In Rust, create `src/extra.rs` without `mod extra;`. Does Cargo compile it?
4. Self-check: why does Rust need a crate for random numbers when Go doesn't?

## References

### Official

- Python, modules and packages: <https://docs.python.org/3/tutorial/modules.html>
- Python, the import system: <https://docs.python.org/3/reference/import.html>
- cppreference, translation phases (preprocessing, `#include`): <https://en.cppreference.com/w/c/language/translation_phases>
- cppreference, C++20 modules: <https://en.cppreference.com/w/cpp/language/modules>
- Go, How to Write Go Code (packages and modules): <https://go.dev/doc/code>
- Go modules reference: <https://go.dev/ref/mod>
- The Rust Book, packages, crates and modules: <https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html>
- Java tutorial, packages: <https://docs.oracle.com/javase/tutorial/java/package/index.html>
- JEP 261, the Java module system: <https://openjdk.org/jeps/261>
- .NET, assemblies: <https://learn.microsoft.com/en-us/dotnet/standard/assembly/>
- C#, namespaces: <https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/namespaces>
- MDN, JavaScript modules: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules>
- Node, module systems: <https://nodejs.org/api/packages.html#determining-module-system>

### Other

- Russ Cox, *Our Software Dependency Problem*: <https://research.swtch.com/deps>

### Further learning

- Python Packaging User Guide: <https://packaging.python.org/>
- Ian Lance Taylor, Linkers (a 20-part series, part 1): <https://lwn.net/Articles/276782/>
- The Cargo Book: <https://doc.rust-lang.org/cargo/>
