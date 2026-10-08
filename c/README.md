# c/: Win32 hooks

| Component | What it is |
| --- | --- |
| [`win32hooks/`](win32hooks/) | the bits of the Windows API Teto needs that a webview can't do: idle time (she falls asleep), cursor position (click-through + eye tracking), a global hotkey (Ctrl+Alt+Space), and a job object that kills all helpers when Teto exits |

**Why C:** the Windows API *is* a C API, and C's simple ABI is the one every
other language can call. Rust links this module in through FFI.

## Commands (in `c/win32hooks`, with LLVM installed)

```powershell
mkdir build -Force
clang -std=c11 -Wall -Wextra -Werror -Iinclude src/teto_win32.c tests/test_teto_win32.c -luser32 -o build/test_teto_win32.exe
.\build\test_teto_win32.exe                     # 7 checks
$env:TETO_TEST_INPUT = "1"; .\build\test_teto_win32.exe   # also presses the hotkey (types real keys!)
```

In the app, `rust/shell/build.rs` compiles `src/teto_win32.c` with the `cc` crate.

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every C and Win32 concept used
- [CHANGELOG.md](CHANGELOG.md)

## References

- Windows API index: <https://learn.microsoft.com/en-us/windows/win32/apiindex/windows-api-list>
