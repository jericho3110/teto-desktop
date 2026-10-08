# go/: the brain

| Component | What it is |
| --- | --- |
| [`brain/`](brain/) | Teto's brain daemon: drives Claude Code headless, streams replies to the UI over Server-Sent Events, turns Claude's tool requests into Allow/Deny prompts, and talks to the Python, Java and C# helpers |

**Why Go:** juggling processes, pipes, timeouts and many concurrent HTTP
connections is what Go's goroutines and channels are made for, and it
compiles to a single `.exe` with zero dependencies (standard library only).

## Build, test, run

```powershell
cd go/brain
gofmt -l .                          # lists badly formatted files (should print nothing)
go vet ./...                        # static checks
go test -count=1 ./...              # 11 tests, uses a FAKE Claude: no API usage
go build -o bin/teto-brain.exe .    # one self-contained executable
```

Normally the Rust shell starts the brain for you. To run it alone:

```powershell
$env:TETO_TOKEN = "devtoken"        # the shared secret; the shell generates a random one
.\bin\teto-brain.exe -mood ..\..\python\mood\mood.py -speak=false
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `-addr` | `127.0.0.1:47800` | listen address. Keep it on localhost |
| `-workdir` | `~/TetoWorkspace` | Claude Code's working folder. **She can read files here without asking**, so don't point it at your whole home folder |
| `-claude` | `claude` | the Claude Code executable |
| `-model` | (your default) | e.g. `claude-haiku-4-5-20251001` for cheap testing |
| `-python`, `-mood` | `python`, empty | the mood engine; empty = disabled |
| `-reminders` | `http://127.0.0.1:47801` | Java reminder service |
| `-companion-pipe` | `\\.\pipe\teto-companion` | C# companion |
| `-speak` | `true` | read replies aloud via the companion |

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every Go concept used, with examples
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the brain is put together
- [../docs/PROTOCOL.md](../docs/PROTOCOL.md): the wire formats
- [CHANGELOG.md](CHANGELOG.md)

## References

- Go documentation: <https://go.dev/doc/>
- `go` command reference: <https://pkg.go.dev/cmd/go>
