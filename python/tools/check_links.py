"""Check that every http(s) link in the Markdown docs resolves.

    python python/tools/check_links.py            # exit 1 if any link is dead

Some sites block scripts (403/429) even though the page exists; those are
reported as "blocked" and don't fail the run. Check them by hand.
"""

from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # python/tools/ → repo root
URL = re.compile(r"https?://[^\s)<>\]`\"']+")  # "<" so "http://<scheme>.localhost" prose isn't a link
FENCE = re.compile(r"^```.*?^```", re.MULTILINE | re.DOTALL)
INLINE_CODE = re.compile(r"`[^`\n]*`")
SKIP_DIRS ={"node_modules", "dist", "public", "target", ".git"}
HEADERS = {"User-Agent": "Mozilla/5.0 (link checker for teto-desktop docs)"}


def find_links() -> dict[str, list[str]]:
    links: dict[str, list[str]] = {}
    for md in ROOT.rglob("*.md"):
        if SKIP_DIRS & set(md.relative_to(ROOT).parts):
            continue
        text = md.read_text(encoding="utf-8")
        text = FENCE.sub("", text)        # code examples aren't links...
        text = INLINE_CODE.sub("", text)  # ...neither is `http://...` in backticks
        for url in URL.findall(text):
            url = url.rstrip(".,;:")
            if "localhost" in url or "127.0.0.1" in url:
                continue  # examples, not links
            links.setdefault(url, []).append(str(md.relative_to(ROOT)))
    return links


def check(url: str) -> tuple[str, str]:
    for method in ("HEAD", "GET"):  # some servers reject HEAD
        try:
            req = urllib.request.Request(url, method=method, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as r:
                return url, f"ok {r.status}"
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and method == "GET":
                return url, f"blocked {e.code}"
            if method == "GET":
                return url, f"DEAD {e.code}"
        except Exception as e:  # DNS, TLS, timeout
            if method == "GET":
                return url, f"DEAD {type(e).__name__}"
    return url, "DEAD"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    links = find_links()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = sorted(pool.map(check, links))
    dead = 0
    for url, status in results:
        if not status.startswith("ok"):
            print(f"{status:12} {url}  ({', '.join(sorted(set(links[url])))})")
            dead += status.startswith("DEAD")
    print(f"{len(results)} links checked, {dead} dead")
    return 1 if dead else 0


if __name__ == "__main__":
    sys.exit(main())
