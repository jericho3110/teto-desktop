"""Tests for the mood engine. Run: python -m unittest discover -s mood"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

from mood import analyze

HERE = Path(__file__).resolve().parent


class AnalyzeTest(unittest.TestCase):
    def assertMood(self, text, emotion):
        self.assertEqual(analyze(text)["emotion"], emotion, text)

    def test_basic_emotions(self):
        self.assertMood("Done! All 12 tests passed.", "happy")
        self.assertMood("Wow, that's amazing!!", "excited")
        self.assertMood("Sorry, I'm unable to open that file.", "sad")
        self.assertMood("The build failed with an error.", "worried")
        self.assertMood("Hmm, which folder did you mean?", "confused")
        self.assertMood("Obviously. That was easy.", "smug")

    def test_negation_flips_happy(self):
        self.assertMood("It's not working yet.", "neutral")  # weak: one flipped cue
        self.assertMood("It's still not working, the tests failed.", "worried")

    def test_weak_evidence_is_neutral(self):
        self.assertEqual(analyze("Here is the file list."), {"emotion": "neutral", "intensity": 0.0})

    def test_intensity_in_range(self):
        for text in ["", "yay " * 50, "error!!!!!!"]:
            self.assertTrue(0.0 <= analyze(text)["intensity"] <= 1.0)


class ProtocolTest(unittest.TestCase):
    """Run mood.py the way the Go brain does: a child process with pipes."""

    def test_json_lines_round_trip(self):
        requests = [{"text": "Fixed it, everything works!"}, "not json", {"text": "error"}]
        stdin = "\n".join(r if isinstance(r, str) else json.dumps(r) for r in requests) + "\n"
        out = subprocess.run(
            [sys.executable, "-u", str(HERE / "mood.py")],
            input=stdin, capture_output=True, text=True, timeout=30, check=True,
        )
        replies = [json.loads(line) for line in out.stdout.splitlines()]
        self.assertEqual(len(replies), 3, "exactly one reply per request, even for bad input")
        self.assertEqual(replies[0]["emotion"], "happy")
        self.assertEqual(replies[1]["emotion"], "neutral")
        self.assertIn("bad request", out.stderr)


if __name__ == "__main__":
    unittest.main()
