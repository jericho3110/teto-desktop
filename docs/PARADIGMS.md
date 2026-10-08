# Programming paradigms in Teto

A **paradigm** is a style of organizing code: what you think of as the
building blocks (procedures? objects? pure functions? data tables?
events?). Teto uses several, each where it fits. This page shows exactly
where, including the four pillars of OOP, and what's ideal.

## Contents

1. [The paradigms at a glance](#the-paradigms-at-a-glance)
2. [Procedural programming](#procedural-programming)
3. [Object-oriented programming: the four pillars](#object-oriented-programming-the-four-pillars)
4. [Inheritance vs composition](#inheritance-vs-composition)
5. [Functional programming](#functional-programming)
6. [Event-driven programming](#event-driven-programming)
7. [Data-oriented design (and when it beats OOP)](#data-oriented-design-and-when-it-beats-oop)
8. [Declarative code](#declarative-code)
9. [Concurrency paradigms](#concurrency-paradigms)
10. [SOLID, mapped to the code](#solid-mapped-to-the-code)
11. [So what's ideal?](#so-whats-ideal)
12. [Exercises](#exercises)
13. [References](#references)

## The paradigms at a glance

| Paradigm | Building block | Where in Teto |
| --- | --- | --- |
| **Procedural** | procedures (functions) that run step by step, changing state | the C module, `go/brain/main.go` wiring, Python scripts, build scripts |
| **Object-oriented** | objects = data + the methods that act on it | C++ emitters, TS classes, Java store/server, C# companion |
| **Functional** | pure functions, immutable data, functions as values | `face.ts`, `analyze()`, Java streams/records, Rust `Option` |
| **Event-driven** | handlers that react to events | the UI, quirks, SSE, Tauri events, the C message loop |
| **Data-oriented** | arrays of plain data, processed in bulk | the C++ particle pool (struct of arrays) |
| **Declarative** | describe *what*, not *how* | CSS, JSON manifests, capabilities, SVG |
| **Concurrent (CSP / async)** | goroutines + channels, async/await, threads | Go brain, C# pipe loop, Java virtual threads |

Most real programs mix paradigms. Languages encourage some styles over
others: C is procedural; Java and C# are object-oriented first; Go and Rust
deliberately have **no class inheritance**; TypeScript and Python support all of them.

## Procedural programming

A program is a sequence of steps grouped into procedures, operating on
data passed in or held in variables. Simple, direct, easy to follow top to bottom.

| Example | Why procedural fits |
| --- | --- |
| `c/win32hooks/src/teto_win32.c` | the Windows API is procedural; each function does one OS task in order |
| `go/brain/main.go: main` | read flags → build parts → wire them → listen. A script of steps |
| `python/tools/check_all.py` | for each language, run commands, collect results |
| `rust/shell/build.rs`, `typescript/ui/scripts/sync-assets.ts` | build steps |

**Weakness:** as programs grow, shared state spread across many procedures
gets hard to reason about, which is exactly what the other paradigms address.

## Object-oriented programming: the four pillars

### 1. Encapsulation: hide the data, expose behavior

Keep an object's state private so only its own methods can change it,
and the object can keep its rules (invariants) true.

| Language | Example | Rule it protects |
| --- | --- | --- |
| C | `struct teto_window_info` is **opaque**: fields exist only in `teto_win32.c` | the strings are freed only by `teto_window_info_free` |
| C++ | `Emitter::stream()` clamps the rate; `rate_` is private | no absurd emission rates |
| C++ | `Arena(const Arena&) = delete` | no two arenas sharing bytes |
| Rust | `ForegroundWindow { ptr }`: the field is private, no `Clone` | the C pointer is freed exactly once |
| Go | lowercase fields `mu`, `pending`, `busy` in `Claude` | state only changes under the lock |
| Java | `private final List<Reminder> items` + `synchronized` methods | the list and the file stay in sync |
| C# | `private bool _speak`, `sealed class TrayApp` | voice state changes only through the menu |
| TS | `private parts`, `readonly root` in `Skin` | only `Skin` knows SVG ids |

### 2. Abstraction: a simple interface over complex details

Callers use *what* an object does without knowing *how*.

| Abstraction | Hides |
| --- | --- |
| `Skin.setEyes("happy")` (TS) | SVG ids, classes, `display` toggling |
| `Brain.prompt(text)` (TS) | HTTP, the token, error codes |
| `native::cursor_pos()` (Rust) | `unsafe`, raw pointers, the C ABI |
| `Emitter` (C++) | each effect's motion |
| `ReminderStore` (Java) | the TSV file, escaping, atomic writes |
| `Commands.Parse` (C#) | JSON, validation, limits |

### 3. Inheritance: a class built on another class

A subclass inherits its parent's fields and methods and can override some.

| Where | Relationship | Why it's used |
| --- | --- | --- |
| C++ `Sparkle`, `Heart`, `Sweat`, `Zzz` : `Emitter` | each **is an** emitter | they share the timing logic (`tick`, `burst`) and differ only in `spawn`/`update`: the **Template Method** pattern |
| C# `TrayApp : ApplicationContext` | framework extension | Windows Forms is designed to be extended this way |
| Java `Refused extends RuntimeException` | is an exception | to be thrown and caught like any exception, carrying an HTTP status |
| TS/Go/Rust | **none** | Go and Rust don't have class inheritance; Teto's TS doesn't need it |

### 4. Polymorphism: one interface, many implementations

Code written against a general type works with any specific type.

| Kind | Example |
| --- | --- |
| **Subtype (virtual) polymorphism**, C++ | `g_emitters[k]->update(...)`: the same call runs `Sparkle::update` or `Zzz::update` depending on the object (via its **vtable**; that's why the wasm has a `TABLE` section) |
| **Interface polymorphism**, Java | `Handler` and `HttpHandler` lambdas: `handle(ex, token, () -> ...)` |
| **Structural (implicit) interfaces**, Go | `logWriter` is an `io.Writer` just by having `Write` |
| **Traits**, Rust | anything `Fn() + Send + Sync` can be the hotkey callback; anything `Serialize` can be emitted |
| **Structural typing**, TS | `sanitizeSvg` accepts real DOM elements *and* the test's `FakeEl`: both fit `SanitizableElement` |
| **Function pointers**, C | `teto_hotkey_cb`: C's way of "call whatever behavior you were given" |
| **Duck typing**, Python | `json.dumps` accepts any dict/list structure |

## Inheritance vs composition

**Composition** means building objects out of other objects ("has a")
instead of inheriting ("is a"). Most of Teto is composed:

- `Animator` **has a** `Skin`, a `HairPhysics` and an `FxLayer`; it doesn't extend them.
- Go's `Server` **has a** `Hub`, a `Claude`, a `Reminders`.
- `TrayApp` **has a** `PipeListener` and a `SpeechSynthesizer`.

The widely taught guideline is **"favor composition over inheritance"**:
inheritance couples the child to the parent's internals (the "fragile
base class" problem), and hierarchies get rigid. Use inheritance when
there's a true *is-a* relationship **and** shared behavior worth reusing
(the emitters), or when a framework is built around it (`ApplicationContext`).

## Functional programming

Build programs from **pure functions** (same input → same output, no side
effects) and **immutable data**; pass functions as values.

| Where | Functional idea |
| --- | --- |
| `typescript/ui/src/face.ts` | pure functions: `currentFace(mind)`, `approach(...)`: no DOM, no clock, trivially testable |
| `python/mood/mood.py: analyze` | pure function; `main()` is the impure shell |
| Java `record Reminder`, `List.copyOf`, `stream().map(...).toList()` | immutable data, transformations |
| C# `record Command`, switch expressions | immutable messages, expressions over statements |
| Rust `Option::map`, `then_some`, iterators | transforming values instead of mutating |
| Go closures `OnReply`, middleware `withAuth(next)` | functions as values, higher-order functions |

**The architecture-level version:** *functional core, imperative shell*:
keep decisions pure, push I/O to the edges.

## Event-driven programming

The program waits for events and runs handlers: control flow is decided
by the outside world.

- UI: `addEventListener("pointerdown", …)`, `EventSource.onmessage`, `requestAnimationFrame`.
- Quirks: `teto.on("poke", …)`, `"app"`, `"tick"`.
- Tauri events: `native://cursor`, `native://hotkey`.
- C: the Win32 **message loop** (`GetMessage` → `WM_HOTKEY`).
- Go: the `switch m.Type` over Claude's stream.

## Data-oriented design (and when it beats OOP)

Data-oriented design organizes code around **how data is laid out and
processed in bulk**, not around objects. The particle pool is the example:

```text
OOP (array of objects)              Data-oriented (struct of arrays)
Particle p[256]                      float x[256]; float y[256]; ...
  each: x y vx vy age life ...       loops stream through one field at a time
  virtual update() per object        JS views each field as one Float32Array
```

Teto deliberately **mixes** the two in `particles.hpp`: data is SoA, but
behavior is polymorphic (`g_emitters[kind]->update(store, i, dt)`), one
virtual call per particle. For 256 particles that's nothing. For a
million, a data-oriented engine would drop the virtual call and run one
tight loop per kind (or `switch (kind)`), which is faster and easier for the
compiler to vectorize. That trade-off is the honest answer to "OOP
everywhere?": OOP organizes *behavior* well; data-oriented design wins when
*throughput over lots of data* dominates.

## Declarative code

Describe the result; let something else work out the steps.

| File | Declares |
| --- | --- |
| `styles.css` | how things look and where they sit |
| `manifest.json` | which SVG parts are which, what each face looks like |
| `tauri.conf.json`, `capabilities/default.json` | the window and its permissions |
| `teto.svg` | the drawing |
| `.gitignore` | what git ignores |

## Concurrency paradigms

| Paradigm | Where |
| --- | --- |
| **CSP** (communicating sequential processes): goroutines + channels | Go brain |
| **async/await** | TS UI, C# pipe listener |
| **threads + locks** | Rust poller, C hotkey thread, Java `synchronized` |
| **actor-like processes** | the whole system: each helper is an isolated process that only communicates by messages |

See [LANGUAGES.md](LANGUAGES.md#concurrency-each-languages-model).

## SOLID, mapped to the code

| Principle | Meaning | In Teto |
| --- | --- | --- |
| **S**ingle responsibility | one reason to change | `hub.go`, `skin.ts`, `sanitize.ts`, `supervisor.rs` each do one job |
| **O**pen/closed | extend without modifying | new quirk = new file; new effect = new `Emitter` subclass; new skin = new folder |
| **L**iskov substitution | a subtype works wherever the base type does | any `Emitter` works in `fx_step`; `FakeEl` works wherever `SanitizableElement` is expected |
| **I**nterface segregation | small, focused interfaces | `QuirkAPI` gives quirks six functions, not the whole app |
| **D**ependency inversion | depend on abstractions | `Claude.OnReply` callback; `Server.Now` clock; tests inject a fake Claude |

## So what's ideal?

There's no single ideal paradigm. The ideal is to **match the paradigm to the problem**:

| Problem shape | Best fit | Teto example |
| --- | --- | --- |
| a sequence of steps, little state | procedural | build scripts, `main.go`, C Win32 calls |
| things with state + rules that must stay true | OOP encapsulation | `Arena`, `ReminderStore`, `ForegroundWindow` |
| a family of variants sharing a skeleton | inheritance + polymorphism (Template Method) | emitters |
| plug-in behavior | interfaces / function values | quirks, `Handler`, callbacks |
| decisions and calculations | pure functions | `face.ts`, `analyze()`, `ParseRemind` |
| lots of uniform data, every frame | data-oriented | particle pool |
| reacting to the outside world | event-driven | UI, quirks, message loop |
| configuration and looks | declarative | CSS, JSON |

Rules of thumb used throughout this repo:

1. **Default to composition**; reach for inheritance only for real *is-a* + shared behavior, or when a framework expects it.
2. **Keep the core pure** (functional), and put side effects at the edges.
3. **Encapsulate invariants**: if a rule must always hold, make it impossible to break from outside.
4. **Use the language's grain**: procedural C, classes in Java/C#, traits and ownership in Rust, interfaces and goroutines in Go.

## Exercises

1. Add a `NoteEmitter` (music notes ♪ for when she sings): a new subclass. Which files change? Which don't (open/closed)?
2. Rewrite `fx_step`'s update loop data-oriented style (a `switch` on kind, no virtual calls). Compare the `.wasm` size.
3. Find a place where Teto uses composition and sketch how it would look with inheritance instead. What gets worse?
4. Self-check: why can `sanitizeSvg` be tested with `FakeEl` without any inheritance?

## References

### Official / primary

- C++ Core Guidelines, class hierarchies (C.120 ff.): <https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#S-hier>
- cppreference, virtual functions: <https://en.cppreference.com/w/cpp/language/virtual>
- Go FAQ, "Why is there no type inheritance?": <https://go.dev/doc/faq#inheritance>
- The Rust Book, OOP features of Rust: <https://doc.rust-lang.org/book/ch18-00-oop.html>
- Java tutorial, inheritance: <https://docs.oracle.com/javase/tutorial/java/IandI/subclasses.html>
- C#, object-oriented programming: <https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/oop>
- TypeScript handbook, type compatibility (structural typing): <https://www.typescriptlang.org/docs/handbook/type-compatibility.html>

### Other

- Gamma, Helm, Johnson, Vlissides, *Design Patterns* (1994): Template Method, Composite; "favor object composition over class inheritance"
- Robert C. Martin, *Design Principles and Design Patterns* (SOLID): <https://web.archive.org/web/20150906155800/<http://www.objectmentor.com/resources/articles/Principles_and_Patterns.pdf>>
- Gary Bernhardt, *Functional core, imperative shell*: <https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell>
- Richard Fabian, *Data-Oriented Design* (free online book): <https://www.dataorienteddesign.com/dodbook/>
- Mike Acton, *Data-Oriented Design and C++*: <https://www.youtube.com/watch?v=rX0ItVEVjHc>
