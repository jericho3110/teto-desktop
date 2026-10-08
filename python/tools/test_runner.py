"""Tests for the runner's untrusted-zip extraction (the voicebank download).

Run: python -m unittest discover -s python/tools
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from runner import safe_extract


class SjisZipInfo(zipfile.ZipInfo):
    """Writes the name as raw Shift-JIS bytes WITHOUT the UTF-8 flag, like an
    old Japanese zip tool. (Python would otherwise switch to UTF-8 and set
    the flag; this overrides a private hook, acceptable in a test.)"""

    def _encodeFilenameFlags(self):
        return self.filename.encode("cp932"), self.flag_bits & ~0x800


def make_zip(path: Path, entries: dict[str, bytes], sjis: bool = False) -> None:
    with zipfile.ZipFile(path, "w") as z:
        for name, data in entries.items():
            z.writestr(SjisZipInfo(name) if sjis else zipfile.ZipInfo(name), data)


class SafeExtractTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.dest = self.dir / "voices"

    def tearDown(self):
        self.tmp.cleanup()

    def test_extracts_voicebank_files_with_shift_jis_names(self):
        z = self.dir / "ok.zip"
        make_zip(z, {"重音テト/oto.ini": b"_\x82\xa0.wav=a,0,0,0,0,0", "重音テト/_あ.wav": b"RIFF"}, sjis=True)
        self.assertEqual(safe_extract(z, self.dest), 2)
        self.assertTrue((self.dest / "重音テト" / "_あ.wav").exists(), "Shift-JIS name decoded")

    def test_refuses_zip_slip(self):
        z = self.dir / "evil.zip"
        make_zip(z, {"../../evil.txt": b"pwned"})
        with self.assertRaises(SystemExit):
            safe_extract(z, self.dest)
        self.assertFalse((self.dir.parent / "evil.txt").exists())

    def test_skips_unexpected_file_types(self):
        z = self.dir / "mixed.zip"
        make_zip(z, {"bank/run_me.exe": b"MZ", "bank/script.bat": b"del *", "bank/oto.ini": b""})
        self.assertEqual(safe_extract(z, self.dest), 1)
        self.assertFalse((self.dest / "bank" / "run_me.exe").exists())


class RealVoicebankZipTest(unittest.TestCase):
    """Only where the official zip has been downloaded (never in the repo)."""

    def test_real_zip_extracts_cleanly(self):
        import os
        z = Path(os.environ.get("LOCALAPPDATA", "")) / "Teto" / "voices" / "TETO-tandoku-100619.zip"
        if not z.exists():
            self.skipTest("official voicebank zip not downloaded")
        with tempfile.TemporaryDirectory() as tmp:
            n = safe_extract(z, Path(tmp))
            self.assertGreater(n, 300)
            self.assertTrue(list(Path(tmp).rglob("_か.wav")), "Japanese names decoded")


if __name__ == "__main__":
    unittest.main()
