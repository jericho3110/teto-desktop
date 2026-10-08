# C# concepts used in Teto

Every C# and .NET concept and principle in `csharp/`: the companion (tray
icon, notifications, voice) and its tests.

## Contents

1. [Projects, solutions and target frameworks](#1-projects-solutions-and-target-frameworks)
2. [Namespaces, file-scoped namespaces, implicit usings](#2-namespaces-file-scoped-namespaces-implicit-usings)
3. [Classes: sealed, static, partial](#3-classes-sealed-static-partial)
4. [Records and enums](#4-records-and-enums)
5. [Nullable reference types](#5-nullable-reference-types)
6. [Pattern matching and switch expressions](#6-pattern-matching-and-switch-expressions)
7. [Strings: ranges, raw literals, interpolation](#7-strings-ranges-raw-literals-interpolation)
8. [Delegates and lambdas: `Action<T>`](#8-delegates-and-lambdas-actiont)
9. [async/await, Task, CancellationToken](#9-asyncawait-task-cancellationtoken)
10. [IDisposable, `using`, `await using`](#10-idisposable-using-await-using)
11. [Exceptions](#11-exceptions)
12. [System.Text.Json](#12-systemtextjson)
13. [Source-generated regex](#13-source-generated-regex)
14. [Named pipes and `PipeOptions.CurrentUserOnly`](#14-named-pipes-and-pipeoptionscurrentuseronly)
15. [Windows Forms without a window: ApplicationContext, NotifyIcon](#15-windows-forms-without-a-window-applicationcontext-notifyicon)
16. [Threads and the UI: STAThread, SynchronizationContext](#16-threads-and-the-ui-stathread-synchronizationcontext)
17. [Single instance with a named Mutex](#17-single-instance-with-a-named-mutex)
18. [Speech synthesis](#18-speech-synthesis)
19. [Attributes and analyzers](#19-attributes-and-analyzers)
20. [Testing with xUnit](#20-testing-with-xunit)
21. [Principles applied](#21-principles-applied)
22. [Exercises](#22-exercises)
23. [References](#references)

## 1. Projects, solutions and target frameworks

- A **project** (`.csproj`) builds one assembly (`TetoCompanion.exe`, `Teto.Companion.Tests.dll`).
- A **solution** (`Teto.slnx`, the newer XML format) groups projects so
  `dotnet test Teto.slnx` builds and tests everything.
- `<TargetFramework>net10.0-windows</TargetFramework>`: .NET 10 with Windows
  APIs (needed for Windows Forms). **Gotcha (found live):** the test
  project must target `net10.0-windows` too, or it can't reference the companion.
- `<OutputType>WinExe</OutputType>`: a GUI app, so no console window opens.
- `<PackageReference Include="System.Speech" />`: a NuGet package (Microsoft's own).

## 2. Namespaces, file-scoped namespaces, implicit usings

`namespace Teto.Companion;` (with a semicolon) applies to the whole file:
one less indentation level. `<ImplicitUsings>enable</ImplicitUsings>`
auto-imports common namespaces (`System`, `System.IO`, `System.Linq`,
`System.Windows.Forms` for WinForms projects, …).

## 3. Classes: sealed, static, partial

- `sealed class TrayApp`: can't be inherited (like Java's `final`).
- `static class Commands`: only static members; can't be instantiated. A home for pure functions.
- `partial`: a class split across several files. Needed here because the
  **regex source generator** writes the other half (see §13).

## 4. Records and enums

```csharp
public enum CommandKind { Speak, Notify }
public sealed record Command(CommandKind Kind, string Text, string Title);
```

A **positional record** generates a constructor, read-only properties,
**value equality** (two `Command`s with the same fields are `Equal`, which the
tests rely on) and `ToString`.

## 5. Nullable reference types

`<Nullable>enable</Nullable>` makes `string` mean "never null" and
`string?` mean "may be null". The compiler warns, and with
`TreatWarningsAsErrors` *fails*, if you use a `string?` without checking.
`Commands.Parse` returns `Command?`, so callers must handle `null`.

## 6. Pattern matching and switch expressions

```csharp
return Get("cmd") switch {
    "speak" => new Command(...),
    "notify" => new Command(...),
    _ => null,                      // discard pattern: anything else
};
if (Commands.Parse(line) is { } cmd) { ... }   // property pattern: "not null, call it cmd"
case CommandKind.Speak when _speak:            // case guard
```

## 7. Strings: ranges, raw literals, interpolation

- `s[..(max - 1)]`: a **range**, "the first max-1 characters".
- `"""{"cmd":"speak","text":"hi"}"""`: a **raw string literal** (C# 11).
  Quotes inside need no escaping, which is perfect for JSON in tests.
- `$$"""{"text":"{{value}}"}"""`: an *interpolated* raw literal; `$$` means
  `{{ }}` interpolates, so single `{ }` stay literal JSON braces.
- `@"Local\TetoCompanion"`: a **verbatim string**, where backslashes are literal.

## 8. Delegates and lambdas: `Action<T>`

`PipeListener(string name, Action<Command> onCommand)`: an `Action<T>` is
a delegate (function value) taking a `T` and returning nothing. The tray
passes `cmd => _ui.Post(_ => Handle(cmd), null)`. Menu items take lambdas
`(_, _) => ToggleVoice()` (the two `_` are discards for sender/args).

## 9. async/await, Task, CancellationToken

- `async Task RunAsync(CancellationToken ct)` runs the accept loop without
  blocking a thread while waiting (`await pipe.WaitForConnectionAsync(ct)`).
- `Task.Run(...)` starts it on the thread pool.
- **Cancellation is cooperative**: `Dispose()` calls `_stop.Cancel()`, every
  awaited call receives `ct` and throws `OperationCanceledException`, and the
  loop returns. The analyzer rule CA2016 insists that tokens get forwarded:
  it caught a `ContinueWith` that ignored it.
- `TaskCompletionSource<T>` (tests) turns a callback into an awaitable task;
  `.WaitAsync(timeout)` bounds the wait.

## 10. IDisposable, `using`, `await using`

Objects holding OS resources (pipes, the synthesizer, the tray icon,
mutexes) implement `IDisposable`. `using var x = ...;` disposes at the end
of the scope; `await using` does it asynchronously for `IAsyncDisposable`
(the pipe). `TrayApp.Dispose(bool)` follows the standard **dispose pattern**
and hides the tray icon first, or a "ghost" icon lingers until you hover over it.

## 11. Exceptions

Catch specific types: `JsonException` (bad input → `null`),
`OperationCanceledException` (shutting down), `IOException` (client gone,
pipe busy), `InvalidOperationException` (no female voice installed).

## 12. System.Text.Json

`JsonDocument.Parse(line)` reads JSON into a read-only DOM;
`root.TryGetProperty("text", out var v)` + `v.ValueKind == JsonValueKind.String`
validates types instead of assuming them. `using var doc` returns its
pooled memory.

## 13. Source-generated regex

```csharp
[GeneratedRegex(@"https?://\S+")]
private static partial Regex Url();
```

The compiler **generates** the matching code at build time: faster
startup than `new Regex(...)`, and an invalid pattern is a build error.

## 14. Named pipes and `PipeOptions.CurrentUserOnly`

`NamedPipeServerStream("teto-companion", ...)` creates
`\\.\pipe\teto-companion`.

- `PipeOptions.CurrentUserOnly` on a **server**: only clients running as
  the same user (and, on Windows, the same elevation level) can connect.
  On a **client** it would also check the *server's* owner, but our client
  is Go, which doesn't, so see docs/SECURITY.md for that limit.
- `PipeOptions.FirstPipeInstance`: creating the server fails if a pipe with
  that name already exists, so we never join a pipe another program
  created first ("pipe squatting").
- `maxNumberOfServerInstances: 1`: one connection at a time, handled in order.

## 15. Windows Forms without a window: ApplicationContext, NotifyIcon

`TrayApp : ApplicationContext` runs a message loop (`Application.Run(app)`)
with **no main form**: just a `NotifyIcon` in the tray, with a
`ContextMenuStrip`. `ShowBalloonTip` appears as a toast notification on Windows 10/11.
`ExitThread()` ends the loop.

## 16. Threads and the UI: STAThread, SynchronizationContext

- `[STAThread]` on `Main`: WinForms (and the COM components it uses) need a
  **single-threaded apartment** on the UI thread.
- UI objects may only be touched on the UI thread. The pipe loop runs on
  a background thread, so it **posts** work back with
  `SynchronizationContext.Post(...)`: the same idea as `Control.Invoke`.

## 17. Single instance with a named Mutex

`new Mutex(true, @"Local\TetoCompanion", out var first)`: the first
process creates and owns it; a second finds `first == false` and exits.
`Local\` scopes the name to your login session.

## 18. Speech synthesis

`System.Speech.Synthesis.SpeechSynthesizer` uses Windows' built-in SAPI
voices. `SelectVoiceByHints(VoiceGender.Female)`, `Rate`,
`SpeakAsync` (doesn't block) and `SpeakAsyncCancelAll` (a new reply
interrupts the old). `Commands.ForSpeech` turns Markdown into speakable
text: code blocks become "(code)" and URLs become "(link)".

## 19. Attributes and analyzers

- Attributes (`[STAThread]`, `[GeneratedRegex]`, `[Fact]`) are metadata
  that the compiler, runtime or tools read.
- `<AnalysisLevel>latest-recommended</AnalysisLevel>` + `<TreatWarningsAsErrors>`
  turn the .NET code-quality rules into build errors (that's how CA2016 was caught).

## 20. Testing with xUnit

- `[Fact]` = one test; `[Theory]` + `[InlineData(...)]` = one test run with
  many inputs (eight malformed messages, each must return `null`).
- `Assert.Equal(expected, actual)` uses record equality.
- `PipeListenerTests` uses a **unique random pipe name** per run, so the
  test never touches the real `teto-companion` pipe.
- `dotnet test Teto.slnx` builds both projects and runs all 13 tests.

## 21. Principles applied

| Principle | Where |
| --- | --- |
| **Untrusted input at the boundary** | `Commands.Parse`: size limits, type checks, unknown commands → `null` |
| **Pure core, OS shell** | `Commands` has no Windows APIs, so it's fully testable; `TrayApp` does the I/O |
| **Least privilege** | `CurrentUserOnly` + `FirstPipeInstance` pipe |
| **Deterministic cleanup** | `IDisposable` everywhere, tray icon hidden on exit |
| **Fail quietly where it's harmless** | no female voice → default voice |

## 22. Exercises

1. Add a `"mute"` command that turns the voice off from the brain.
2. Replace `SystemIcons.Information` with a Teto `.ico` rendered from the SVG.
3. Show a real Windows toast with the Windows App SDK. What do you need
   that a balloon tip doesn't (hint: an app identity)?
4. Self-check: why does `Handle` run on the UI thread, but `Commands.Parse` doesn't need to?

## References

### Official

- C# language docs: <https://learn.microsoft.com/en-us/dotnet/csharp/>
- Records: <https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record>
- Nullable reference types: <https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references>
- Pattern matching: <https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/functional/pattern-matching>
- Raw string literals: <https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/raw-string>
- Regex source generators: <https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators>
- `PipeOptions.CurrentUserOnly`: <https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.pipeoptions>
- Cancellation in managed threads: <https://learn.microsoft.com/en-us/dotnet/standard/threading/cancellation-in-managed-threads>
- Implementing Dispose: <https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose>
- CA2016: <https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2016>
- `NotifyIcon`: <https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon>
- `SpeechSynthesizer`: <https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer>
- xUnit getting started: <https://xunit.net/docs/getting-started/v2/netcore/cmdline>

### Other

- Stephen Cleary, *Async and Await*: <https://blog.stephencleary.com/2012/02/async-and-await.html>
