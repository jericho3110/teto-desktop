"""Teto Desktop: the one command to set up, build, run, test and package everything.

    python main.py doctor     check which tools are installed
    python main.py build      build every helper
    python main.py run        build, then start Teto
    python main.py test       run all checks (incl. security)
    python main.py voice      download Teto's voicebank (asks first)
    python main.py package    build the Windows installer into dist/

The logic lives in python/tools/runner.py; this file is just the front door.
"""

import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).parent / "python" / "tools" / "runner.py"), run_name="__main__")
