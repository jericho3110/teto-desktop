"""Live smoke test: send one prompt to a running brain and print its events.

Unlike the Go unit tests (which use a fake Claude), this talks to the
real Claude Code through the real brain, so it costs a tiny bit of usage.

    python tools/smoke_brain.py --token devtoken "Say hi in five words."

Exits 0 when a reply_done arrives, 1 on timeout or error.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import urllib.request


def main() -> int:
    # Windows consoles default to a legacy code page (cp1252) that can't print
    # emoji; force UTF-8 so Teto's sparkles don't crash the script.
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt")
    ap.add_argument("--url", default="http://127.0.0.1:47800")
    ap.add_argument("--token", required=True)
    ap.add_argument("--timeout", type=float, default=120)
    ap.add_argument("--allow", action="store_true", help="answer permission requests with Allow (default: Deny)")
    args = ap.parse_args()

    done = threading.Event()
    ok = {"value": False}

    def post(path: str, body: dict) -> int:
        req = urllib.request.Request(
            args.url + path, data=json.dumps(body).encode(), method="POST",
            headers={"Authorization": f"Bearer {args.token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status

    def listen() -> None:
        with urllib.request.urlopen(f"{args.url}/events?token={args.token}", timeout=args.timeout) as stream:
            for raw in stream:  # SSE: "data: {...}" lines separated by blank lines
                line = raw.decode("utf-8").rstrip("\n")
                if not line.startswith("data: "):
                    continue
                ev = json.loads(line[6:])
                print(json.dumps(ev, ensure_ascii=False))
                if ev["type"] == "permission_request":
                    post("/permission", {"id": ev["id"], "allow": args.allow})
                if ev["type"] == "mood":  # mood arrives right after reply_done
                    ok["value"] = True
                    done.set()
                    return

    t = threading.Thread(target=listen, daemon=True)
    t.start()
    threading.Event().wait(0.5)  # let the subscription register first
    print("POST /prompt ->", post("/prompt", {"text": args.prompt}))
    done.wait(args.timeout)
    return 0 if ok["value"] else 1


if __name__ == "__main__":
    sys.exit(main())
