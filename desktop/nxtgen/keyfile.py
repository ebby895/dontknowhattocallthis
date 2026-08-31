"""Reading an API key out of a file the user saved.

Typing a key into a field is where people get stuck, and pasting one into a chat
window is how keys get burned. So the app reads the file itself, locally, and
offers to shred it afterwards - a key sitting in a plaintext .txt is the thing
we are trying to get away from.

The parsing and validation live here, separate from the Qt dialog, so they can
be tested without a display.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Tolerate the shapes people actually save: a bare key, KEY=value, an .env line,
# a JSON-ish "key": "value", or a line with a label in front.
ASSIGNMENT_RE = re.compile(
    r"""^\s*
        (?:export\s+)?                       # shell-style export
        ["']?[A-Za-z_][A-Za-z0-9_ .-]*["']?  # name, possibly quoted or spaced
        \s*[:=]\s*                           # = or :
        ["']?(?P<value>[^"'\s,]+)["']?       # the value
        \s*,?\s*$""",
    re.X,
)

MAX_FILE_BYTES = 64 * 1024   # a key file is tiny; anything larger is the wrong file


@dataclass
class KeyReadResult:
    ok: bool
    key: Optional[str] = None
    reason: str = ""

    @property
    def masked(self) -> str:
        """Enough of the key to confirm the right one was picked up, no more."""
        if not self.key:
            return ""
        if len(self.key) <= 12:
            return self.key[:2] + "…" + self.key[-2:]
        return f"{self.key[:6]}…{self.key[-4:]}"


# Provider key shapes. Checking these means a file of unrelated text is rejected
# with a clear message instead of being stored as a key that will silently fail
# every request later.
KEY_SHAPES = {
    "gemini": (
        re.compile(r"^(?:AQ\.[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})$"),
        "a Gemini key starting with 'AQ.' or 'AIza'",
    ),
    "keepa": (
        re.compile(r"^[a-z0-9]{40,}$"),
        "a Keepa key: 40+ lowercase letters and digits",
    ),
}


def parse_key_text(text: str) -> Optional[str]:
    """Pull a key out of file contents, or None if there is nothing key-shaped."""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue

        m = ASSIGNMENT_RE.match(line)
        candidate = m.group("value") if m else line.strip("\"',")

        # A bare token with no whitespace is the only thing that can be a key;
        # a sentence is prose the user left in the file.
        if candidate and not re.search(r"\s", candidate) and len(candidate) >= 16:
            return candidate

    return None


def read_key_file(path: str | Path, kind: str = "gemini") -> KeyReadResult:
    """Read and validate a key from a file on disk."""
    p = Path(path)

    try:
        if not p.is_file():
            return KeyReadResult(False, reason="That path is not a file.")
        size = p.stat().st_size
        if size == 0:
            return KeyReadResult(False, reason="That file is empty.")
        if size > MAX_FILE_BYTES:
            return KeyReadResult(
                False,
                reason="That file is too large to be a key file — pick the .txt "
                       "with just the key in it.",
            )
        text = p.read_text(encoding="utf-8", errors="replace")
    except PermissionError:
        return KeyReadResult(False, reason="No permission to read that file.")
    except OSError as exc:
        return KeyReadResult(False, reason=f"Could not read that file: {exc}")

    key = parse_key_text(text)
    if not key:
        return KeyReadResult(
            False,
            reason="No key found in that file. It should contain the key on its "
                   "own line, or a line like GEMINI_API_KEY=…",
        )

    shape, description = KEY_SHAPES.get(kind, (None, ""))
    if shape and not shape.match(key):
        return KeyReadResult(
            False,
            reason=f"That does not look like {description}. Nothing was saved — "
                   "check you picked the right file.",
        )

    return KeyReadResult(True, key=key)


def shred(path: str | Path) -> tuple[bool, str]:
    """Overwrite then delete a file.

    Best effort: on a journalling or copy-on-write filesystem an overwrite is not
    a guarantee the old bytes are gone, so this is not presented as secure
    erasure. It does remove the obvious copy, which is the realistic risk for a
    key sitting in Documents.
    """
    p = Path(path)
    try:
        if not p.is_file():
            return False, "File is already gone."
        length = p.stat().st_size
        with open(p, "r+b", buffering=0) as fh:
            for _ in range(2):
                fh.seek(0)
                fh.write(os.urandom(max(length, 1)))
                fh.flush()
                os.fsync(fh.fileno())
        p.unlink()
        return True, ""
    except OSError as exc:
        return False, str(exc)
