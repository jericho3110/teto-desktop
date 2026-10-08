# Python components: architecture

## Mood engine (`mood/mood.py`)

```text
stdin line ─► json.loads ─► analyze(text) ─► json.dumps ─► stdout line
                              │
                              ├─ lowercase, split into words (regex)
                              ├─ look up each word in LEXICON → add weight to its emotion
                              │    (a negation just before flips happy/excited → worried)
                              ├─ add multi-word phrases ("of course")
                              ├─ punctuation: "!" → happy/excited, trailing "?" → confused
                              └─ best emotion; below 0.75 → neutral; intensity = s/(s+1)
```

| Decision | Alternatives | Why | Cost |
| --- | --- | --- | --- |
| weighted lexicon | a sentiment model (e.g. a small transformer), asking Claude to tag its own mood | instant, explainable, no dependencies, no extra API usage | misses sarcasm and context |
| `s/(s+1)` intensity | linear, clamped | any positive score maps into 0..1, saturating smoothly | – |
| threshold 0.75 | always pick the max | one weak word shouldn't make her emotional | some mild replies look neutral |

**Upgrade path:** replace `analyze()` and keep the JSON-lines protocol;
the Go brain and the UI won't notice.

## Skin generator (`skin_gen/gen_teto.py`)

`build()` returns the whole SVG as a string, built from small functions
(`drill`, `eye`) and palette constants. Painting order matters (later =
on top): back hair → drills → body → arms → head (face, blush, eyes,
mouth, side locks, bangs, ahoge) → effect overlays. Element ids are the
contract with `assets/skins/teto-chibi/manifest.json`.

## Tools

`smoke_brain.py` and `check_links.py` are dev tools, not part of the app.
`check_links.py` treats 403/429 as "blocked" (some sites refuse scripts)
rather than dead, so they're reported but don't fail the run.

## References

- Bing Liu, *Sentiment Analysis and Opinion Mining* (lexicon methods): <https://www.cs.uic.edu/~liub/FBS/SentimentAnalysis-and-OpinionMining.pdf>
- MDN, SVG painting order: <https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Basic_Shapes>

### Further learning

- NLTK book, chapter 6 (classifying text): <https://www.nltk.org/book/ch06.html>
