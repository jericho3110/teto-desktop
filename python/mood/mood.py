"""Teto's mood engine: turns a reply into an emotion for the animator.

Protocol (JSON lines over stdin/stdout, one request -> one response):
    in : {"text": "Done! All 12 tests pass."}
    out: {"emotion": "happy", "intensity": 0.67}

The Go brain starts this as a child process with `python -u mood.py`
(-u = unbuffered, so each reply is sent immediately).

Approach: a small weighted lexicon plus a few cues (exclamation marks,
"error"-ish words, question marks). Deliberately simple and explainable;
see docs/ARCHITECTURE.md for when a real sentiment model would be worth it.
"""

from __future__ import annotations

import json
import re
import sys

EMOTIONS = ("happy", "excited", "sad", "worried", "confused", "smug", "neutral")

# word -> (emotion, weight). Lowercase; matched on whole words.
LEXICON: dict[str, tuple[str, float]] = {
    # happy
    "done": ("happy", 1.0), "great": ("happy", 1.0), "nice": ("happy", 0.8),
    "thanks": ("happy", 0.8), "glad": ("happy", 1.0), "pass": ("happy", 0.8),
    "passed": ("happy", 1.0), "fixed": ("happy", 1.2), "success": ("happy", 1.2),
    "works": ("happy", 0.8), "working": ("happy", 0.6), "yay": ("happy", 1.5),
    "baguette": ("happy", 1.5), "bread": ("happy", 1.0),
    # excited
    "awesome": ("excited", 1.5), "amazing": ("excited", 1.5), "wow": ("excited", 1.5),
    "love": ("excited", 1.0), "excited": ("excited", 1.5), "perfect": ("excited", 1.2),
    # sad
    "sorry": ("sad", 1.2), "unfortunately": ("sad", 1.2), "can't": ("sad", 0.8),
    "cannot": ("sad", 0.8), "unable": ("sad", 1.0), "denied": ("sad", 1.2),
    # worried
    "error": ("worried", 1.2), "failed": ("worried", 1.2), "fail": ("worried", 1.0),
    "failing": ("worried", 1.2), "warning": ("worried", 1.0), "careful": ("worried", 0.8),
    "dangerous": ("worried", 1.5), "crash": ("worried", 1.2), "broken": ("worried", 1.2),
    "bug": ("worried", 0.8),
    # confused
    "unclear": ("confused", 1.2), "unsure": ("confused", 1.2), "hmm": ("confused", 1.2),
    "maybe": ("confused", 0.5), "which": ("confused", 0.4), "clarify": ("confused", 1.2),
    # smug (very Teto)
    "obviously": ("smug", 1.5), "of course": ("smug", 1.2), "easy": ("smug", 1.0),
    "31": ("smug", 1.0), "chimera": ("smug", 1.0),
}

NEGATIONS = {"not", "no", "never", "n't", "without"}
WORD = re.compile(r"[a-z0-9']+")


def analyze(text: str) -> dict[str, float | str]:
    """Return {"emotion", "intensity"}; intensity is in [0, 1]."""
    lowered = text.lower()
    scores = dict.fromkeys(EMOTIONS, 0.0)

    words = WORD.findall(lowered)
    for i, word in enumerate(words):
        hit = LEXICON.get(word)
        if not hit:
            continue
        emotion, weight = hit
        # "not working" should not count as happy
        if i > 0 and (words[i - 1] in NEGATIONS or words[i - 1].endswith("n't")):
            if emotion in ("happy", "excited"):
                emotion = "worried"
            else:
                continue
        scores[emotion] += weight

    # multi-word phrases
    for phrase, (emotion, weight) in LEXICON.items():
        if " " in phrase and phrase in lowered:
            scores[emotion] += weight

    # punctuation cues
    bangs = text.count("!")
    if bangs:
        top = max(("happy", "excited"), key=scores.__getitem__)
        scores["excited" if bangs >= 2 else top] += 0.4 * min(bangs, 3)
    if text.rstrip().endswith("?"):
        scores["confused"] += 0.6

    best = max(scores, key=scores.__getitem__)
    total = scores[best]
    if total < 0.75:  # weak evidence: stay calm rather than overreact
        return {"emotion": "neutral", "intensity": 0.0}
    # Saturating curve: 1 cue -> ~0.5, 3+ cues -> close to 1.
    intensity = round(total / (total + 1.0), 2)
    return {"emotion": best, "intensity": intensity}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            text = json.loads(line).get("text", "")
            reply = analyze(text)
        except (json.JSONDecodeError, AttributeError) as exc:
            print(f"mood: bad request: {exc}", file=sys.stderr)
            reply = {"emotion": "neutral", "intensity": 0.0}
        # One response per request, always: the Go side waits for it.
        print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    main()
