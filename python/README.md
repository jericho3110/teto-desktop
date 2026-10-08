# python/: mood engine, art generator, dev tools

| Component | What it is |
| --- | --- |
| [`mood/`](mood/) | reads Teto's reply and decides an emotion; a child process of the Go brain, speaking JSON lines over stdin/stdout |
| [`skin_gen/`](skin_gen/) | generates the chibi Teto SVG (`assets/skins/teto-chibi/teto.svg`) |
| [`tools/smoke_brain.py`](tools/smoke_brain.py) | live test: one real prompt through a running brain |
| [`tools/check_links.py`](tools/check_links.py) | checks every link in every Markdown doc |

**Why Python:** text processing and quick scripts are pleasant in Python,
and the mood engine is the natural place to plug in an ML model later.
Standard library only: nothing to `pip install`.

## Commands

| Command (from the repo root) | What it does |
| --- | --- |
| `python -m unittest discover -s python/mood` | run the mood tests; `-m` runs a module as a script, `discover -s DIR` finds `test_*.py` in DIR |
| `python -u python/mood/mood.py` | run the engine by hand; type `{"text": "yay"}` + Enter. `-u` = unbuffered output |
| `python python/skin_gen/gen_teto.py` | regenerate the SVG |
| `python python/tools/smoke_brain.py --token devtoken "Say hi"` | send a real prompt to a running brain; add `--allow` to approve tool requests (default: deny) |
| `python python/tools/check_links.py` | exit code 1 if any doc link is dead |

## Docs

- [docs/CONCEPTS.md](docs/CONCEPTS.md): every Python concept used
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the mood engine and generator work
- [CHANGELOG.md](CHANGELOG.md)

## References

- Python documentation: <https://docs.python.org/3/>
