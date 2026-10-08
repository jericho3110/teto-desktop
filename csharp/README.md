# csharp/: the companion (tray, notifications, voice)

| Component | What it is |
| --- | --- |
| [`Companion/`](Companion/) | `TetoCompanion.exe`: a tray icon (Voice on/off, Quit), Windows notifications for reminders, and text-to-speech for replies. Listens on the named pipe `\\.\pipe\teto-companion` |
| [`Companion.Tests/`](Companion.Tests/) | 13 xUnit tests: message parsing, limits, speech cleanup, a real pipe round trip |

**Why C#:** .NET has the most direct access to Windows UI pieces (tray,
notifications) and the built-in speech voices.

## Commands (in `csharp/`, .NET 10 SDK)

| Command | What it does |
| --- | --- |
| `dotnet test Teto.slnx` | restore NuGet packages, build both projects, run the tests |
| `dotnet build Companion -c Release` | build `Companion/bin/Release/net10.0-windows/TetoCompanion.exe` (`-c` = configuration) |
| `dotnet run --project Companion` | run it; a tray icon appears |

The Rust shell starts the companion automatically if it has been built.

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every C#/.NET concept used
- [CHANGELOG.md](CHANGELOG.md)

## References

- .NET CLI: <https://learn.microsoft.com/en-us/dotnet/core/tools/>
