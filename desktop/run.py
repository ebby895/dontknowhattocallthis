#!/usr/bin/env python3
"""Launch the NxtGen Deal Engine desktop app.

    python run.py

First run: a Chrome window opens on x.com. Sign in once - the profile keeps the
session from then on.
"""

import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)


def main() -> int:
    try:
        from nxtgen.ui.app import run
    except ImportError as exc:
        print(f"Missing dependency: {exc}\n\nInstall with:\n"
              "    pip install -r requirements.txt\n\n"
              "The app drives the Google Chrome already installed on this "
              "machine, so there is no browser to download.\n", file=sys.stderr)
        return 1
    return run()


if __name__ == "__main__":
    sys.exit(main())
