# Conventions

## Layout

- **One top-level folder per component**, named after its job, not its
  language: `brain/`, `mood/`, `physics/`, `app/`, `reminders/`.
- Language-neutral assets live at the top: `skins/`, `quirks/`. The app
  copies them in with `app/scripts/sync-assets.mjs`; `app/public/` is
  generated and git-ignored.
- Tests sit next to the code in each language's usual place:
  `*_test.go`, `test_*.py`, `*.test.ts`, `physics/test/`, `reminders/test/`.

## Naming

| Language | Style |
| --- | --- |
| Go | `MixedCaps`; exported = capitalized (`Claude.Prompt`), unexported = lower (`summarize`) |
| Python | `snake_case` functions, `UPPER_CASE` constants |
| TypeScript/JS | `camelCase`, `PascalCase` classes, one class per file named after it (`bubble.ts` → `Bubble`) |
| C++ | `snake_case` functions, `PascalCase` types, `kConstant`, trailing `_` for members |
| Java | `camelCase` methods, `PascalCase` classes, package `teto.reminders` |
| Protocol | event `type`s and JSON keys are `snake_case` (`text_delta`, `is_error`) |
| SVG ids | `kebab-case` with side suffix: `drill-L-3`, `arm-R`, `fx-sweat` |

## Rules

- **Standard library first.** A new dependency needs a row in
  [LIBRARIES_AND_BUILTINS.md](LIBRARIES_AND_BUILTINS.md) saying why.
- **Protocol changes update both sides and [PROTOCOL.md](PROTOCOL.md)** in the same commit.
- **Keep logic pure where possible** (no I/O, time passed in), so it can be unit-tested.
- **Model output is text, never HTML** (`textContent` only).
- **Fail closed** on anything permission-related.
- **Services are optional**: a missing helper must degrade, not crash.

## Checks before committing

```
cd brain;   gofmt -l .; go vet ./...; go test ./...
cd mood;    python -m unittest discover -s mood        (from the repo root)
cd physics; npm run build; npm test
cd app;     npm run typecheck; npm test
```

## Commits

- Summary: imperative, ≤ 72 chars, no `feat:` prefix. Prefix the
  component when it's about one: `brain: Add /cancel`.
- Body: *why*, related changes as `-` bullets, then how it was verified.
- One logical change per commit. Never commit secrets, tokens, `.env`,
  or real data from your machine.

## References

- Effective Go, names: https://go.dev/doc/effective_go#names
- PEP 8: https://peps.python.org/pep-0008/
- Google C++ Style Guide, naming: https://google.github.io/styleguide/cppguide.html#Naming
- Chris Beams, *How to Write a Git Commit Message*: https://cbea.ms/git-commit/
