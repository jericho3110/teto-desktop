# Python concepts used in Teto

Every Python concept and principle in `python/`: the mood engine, the
skin generator and the dev tools.

## Contents

1. [Modules, scripts and `if __name__ == "__main__"`](#1-modules-scripts-and-if-__name__--__main__)
2. [Type hints and `from __future__ import annotations`](#2-type-hints-and-from-__future__-import-annotations)
3. [Data structures: dict, tuple, set, comprehensions](#3-data-structures-dict-tuple-set-comprehensions)
4. [Pure functions and the functional core](#4-pure-functions-and-the-functional-core)
5. [Regular expressions](#5-regular-expressions)
6. [Text I/O: stdin/stdout, buffering, encodings](#6-text-io-stdinstdout-buffering-encodings)
7. [JSON lines as a protocol](#7-json-lines-as-a-protocol)
8. [Exceptions: catching narrowly](#8-exceptions-catching-narrowly)
9. [f-strings and generating text (the SVG generator)](#9-f-strings-and-generating-text-the-svg-generator)
10. [pathlib and `__file__`](#10-pathlib-and-__file__)
11. [Concurrency: threads and thread pools](#11-concurrency-threads-and-thread-pools)
12. [HTTP with urllib](#12-http-with-urllib)
13. [argparse: command-line tools](#13-argparse-command-line-tools)
14. [Dunder methods and attributes used](#14-dunder-methods-and-attributes-used)
15. [Testing with unittest and subprocess](#15-testing-with-unittest-and-subprocess)
16. [Principles applied](#16-principles-applied)
17. [Exercises](#17-exercises)
18. [References](#references)

## 1. Modules, scripts and `if __name__ == "__main__"`

Every `.py` file is a **module**. When you *run* it, Python sets its
`__name__` to `"__main__"`; when you *import* it, `__name__` is the module
name. So:

```python
if __name__ == "__main__":
    main()          # mood.py: only when run, not when test_mood.py imports analyze
```

The test does `from mood import analyze`. That works because
`python -m unittest discover -s python/mood` puts `python/mood` on
`sys.path` (the list of folders Python searches for imports).

## 2. Type hints and `from __future__ import annotations`

```python
def analyze(text: str) -> dict[str, float | str]: ...
LEXICON: dict[str, tuple[str, float]] = { ... }
```

- Hints are **not enforced** at runtime; they document intent and let
  editors and type checkers (mypy, pyright) find mistakes.
- `float | str` is a union (PEP 604); `dict[str, ...]` uses built-in generics (PEP 585).
- `from __future__ import annotations` (PEP 563) stores annotations as
  strings instead of evaluating them, so hints never cost anything at
  import time and can mention names defined later.

## 3. Data structures: dict, tuple, set, comprehensions

| Structure | Where | Why |
| --- | --- | --- |
| `dict` word → (emotion, weight) | `mood.py: LEXICON` | O(1) lookup per word |
| `tuple` `("happy", 1.0)` | lexicon values, `EMOTIONS` | fixed, immutable records |
| `set` | `NEGATIONS`, `SKIP_DIRS` | fast `in` checks; `&` = intersection (`check_links.py`) |
| `dict.fromkeys(EMOTIONS, 0.0)` | `analyze` | every emotion starts at 0 |
| list comprehension | `[json.loads(l) for l in out.stdout.splitlines()]` | build a list in one readable expression |
| generator expression | `"".join(f"<path .../>" for x, y, k in ...)` | lazily produce items for `join` |
| `dict.setdefault(url, []).append(...)` | `check_links.py` | group values by key in one line |

**Gotcha:** `max(scores, key=scores.__getitem__)` returns the *first* key
with the top score when there's a tie, so dict order (insertion order,
guaranteed since Python 3.7) decides ties.

## 4. Pure functions and the functional core

`analyze(text)` has no I/O, no globals that change, no randomness: same
input → same output. That makes it trivial to test (`AnalyzeTest`) and
lets `main()` be a thin I/O loop around it (**functional core,
imperative shell**). The same split exists in the generator: `build()`
returns a string; only `__main__` writes the file.

## 5. Regular expressions

```python
WORD = re.compile(r"[a-z0-9']+")    # compiled once at import
words = WORD.findall(text.lower())
URL = re.compile(r"https?://[^\s)<>\]`\"']+")   # check_links.py
```

- **Raw strings** `r"..."`: backslashes are kept literally, so `\s` reaches
  the regex engine instead of being a Python escape.
- `findall` returns all matches. The URL regex stops at characters that
  end a link in Markdown; the `<` was added after a false positive (found live).

## 6. Text I/O: stdin/stdout, buffering, encodings

- `for line in sys.stdin:` reads one line at a time until EOF (the Go brain
  closes the pipe).
- **Buffering:** when stdout is a pipe, Python buffers output in blocks;
  the reader would wait forever for a short reply. Fixes, both used:
  `python -u` (unbuffered) and `print(..., flush=True)`.
- **Encodings (found live):** a Windows console uses a legacy code page
  (`cp1252`) that can't encode `✨`. `sys.stdout.reconfigure(encoding="utf-8")`
  switches the stream (`smoke_brain.py`, `check_links.py`).
- `Path.read_text(encoding="utf-8")`: **always pass the encoding**; the
  default depends on the OS locale.
- Errors go to `sys.stderr` so they never corrupt the stdout protocol.

## 7. JSON lines as a protocol

One JSON object per line, one response per request. Two rules make it robust:

1. **Always answer**, even on bad input (`{"emotion": "neutral", ...}`), so
   the Go side, which holds a mutex while waiting, never hangs.
2. **Never print anything else to stdout.** Debug output goes to stderr.

## 8. Exceptions: catching narrowly

```python
except (json.JSONDecodeError, AttributeError) as exc:   # mood.py
```

Catch only what you expect (`"not json"` → `JSONDecodeError`, `[1,2]` has
no `.get` → `AttributeError`). A bare `except:` would also swallow
`KeyboardInterrupt` and real bugs. In `check_links.py`, `except Exception`
is deliberately broad because *any* network failure means "link dead".

## 9. f-strings and generating text (the SVG generator)

```python
f'<ellipse cx="0" cy="{h/2+3}" rx="{w}" fill="{HAIR}"/>'
```

- f-strings evaluate expressions inside `{}`.
- **Gotcha:** to output a literal `{` in an f-string you write `{{`.
- The generator builds the drills from **one function** called twice
  (`drill("L", ...)`, `drill("R", ...)` with `scale(-1,1)`): DRY, and the
  two sides can't drift apart.
- `"</g>" * len(DRILL_SEGMENTS)`: string repetition closes the nested groups.

## 10. pathlib and `__file__`

```python
root = Path(__file__).resolve().parents[2]   # python/skin_gen/gen_teto.py → repo root
target = root / "assets" / "skins" / "teto-chibi" / "teto.svg"   # `/` joins paths
```

`__file__` is the path of the current module, so scripts work no matter
which folder you run them from. `parents[n]` walks up n folders;
`rglob("*.md")` finds files recursively.

## 11. Concurrency: threads and thread pools

- `smoke_brain.py`: one `threading.Thread(daemon=True)` reads the SSE stream
  while the main thread POSTs; a `threading.Event` signals "done".
  `daemon=True` means the thread won't keep the program alive.
- `check_links.py`: `ThreadPoolExecutor(max_workers=8).map(check, urls)`
  checks 8 links at once. Threads suit **I/O-bound** work: while one waits
  for the network, others run. (CPU-bound work would need processes,
  because of the GIL, the lock that lets only one thread run Python
  bytecode at a time in standard CPython.)

## 12. HTTP with urllib

`urllib.request.Request(url, data=..., method="POST", headers=...)` +
`urlopen(..., timeout=...)`. The response is a file-like object, so
`for raw in stream:` reads a streaming SSE response line by line.
`HTTPError` carries the status code. (`requests` is nicer, but it's a
dependency; the standard library is enough here.)

## 13. argparse: command-line tools

`ap.add_argument("--allow", action="store_true")` makes a boolean flag;
`required=True` forces `--token`. `-h` prints generated help.

## 14. Dunder methods and attributes used

"Dunder" = double underscore. They're hooks Python calls for you.

| Dunder | Where | What it is |
| --- | --- | --- |
| `__name__` | all scripts | module name, `"__main__"` when run directly |
| `__file__` | generator, tools, tests | this module's file path |
| `__getitem__` | `mood.py` (`scores.__getitem__`) | the method behind `scores[key]`; passed as a function to `max(key=...)` |
| `__future__` | `from __future__ import annotations` | a special module that turns on future language behavior |

## 15. Testing with unittest and subprocess

- `unittest.TestCase` subclasses; methods starting with `test_` run.
- `assertEqual(a, b, msg)` with a message: the failing text shows *which* input broke.
- `ProtocolTest` runs `mood.py` as a **real child process** via
  `subprocess.run(input=..., capture_output=True, timeout=30, check=True)`,
  which is the same way Go uses it. `sys.executable` is the current Python,
  so the test uses the same interpreter as the test runner.
- Discovery: `python -m unittest discover -s python/mood` finds `test_*.py`.

## 16. Principles applied

| Principle | Where |
| --- | --- |
| **Functional core, imperative shell** | `analyze` vs `main`; `build` vs `__main__` |
| **Robustness (always reply)** | `mood.py: main` |
| **DRY** | one `drill()` function for both drills, one `eye()` for both eyes |
| **YAGNI** | a lexicon instead of an ML model until it's actually needed |
| **Explicit encodings** | every file read/write passes `encoding="utf-8"` |

## 17. Exercises

1. Add a `sleepy` emotion with a test (red → green).
2. Make `check_links.py` cache results in a JSON file for a day. Where does
   the impure part go?
3. Give the generator a `--color` flag that recolors the hair. Which
   constants need to become parameters?
4. Self-check: why does `ProtocolTest` send `"not json"` in the middle and
   still expect exactly three replies?

## References

**Official**
- Python tutorial, modules and `__main__` ✔: <https://docs.python.org/3/tutorial/modules.html>
- `__main__`: <https://docs.python.org/3/library/__main__.html>
- PEP 484 (type hints): <https://peps.python.org/pep-0484/>
- PEP 563 (postponed annotations): <https://peps.python.org/pep-0563/>
- PEP 604 (`X | Y`): <https://peps.python.org/pep-0604/>
- `-u` option ✔: <https://docs.python.org/3/using/cmdline.html#cmdoption-u>
- `io.TextIOWrapper.reconfigure`: <https://docs.python.org/3/library/io.html#io.TextIOWrapper.reconfigure>
- `re`: <https://docs.python.org/3/library/re.html>
- `pathlib`: <https://docs.python.org/3/library/pathlib.html>
- `concurrent.futures`: <https://docs.python.org/3/library/concurrent.futures.html>
- `unittest`: <https://docs.python.org/3/library/unittest.html>
- Glossary, GIL: <https://docs.python.org/3/glossary.html#term-global-interpreter-lock>

**Other**
- Real Python, *Python Type Checking*: <https://realpython.com/python-type-checking/>
- Real Python, *f-strings*: <https://realpython.com/python-f-strings/>
