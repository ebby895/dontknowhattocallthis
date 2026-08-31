"""Settings and secret storage.

Tunables live in a JSON file under the user's app data directory. Secrets - the
Gemini key, the Keepa key - go to the OS credential store via keyring, so they
are entered once and never land in a file that could be committed or synced.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Optional

APP_NAME = "NxtGenDealEngine"
KEYRING_SERVICE = "nxtgen-deal-engine"


def app_dir() -> Path:
    """Per-user application directory, following each platform's convention."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
    p = Path(base) / APP_NAME
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass
class Settings:
    # --- Amazon ---------------------------------------------------------
    associate_tag: str = "nxtgenhotdeal-20"

    # --- capture --------------------------------------------------------
    # Playwright drives a persistent Chrome profile so the x.com session is a
    # real logged-in session rather than a scraped one.
    browser_profile: str = ""            # blank -> app_dir()/chrome-profile
    headless: bool = False
    scan_interval_seconds: float = 3.0
    timeline_url: str = "https://x.com/home"
    following_tab_only: bool = True

    # --- gating ---------------------------------------------------------
    min_discount_pct: float = 15.0
    max_deal_age_minutes: int = 45       # never auto-post something staler
    max_queue_age_minutes: int = 720

    # --- posting --------------------------------------------------------
    autopost_armed: bool = False         # master switch, off by default
    min_gap_minutes: int = 12            # spacing, so the feed reads human
    max_posts_per_hour: int = 4
    max_posts_per_day: int = 25
    long_form_posts: bool = False        # X Premium allows >280
    input_mode: str = "playwright"       # 'playwright' | 'keyboard'
    typing_delay_ms: int = 18            # per-keystroke, for keyboard mode

    # --- AI -------------------------------------------------------------
    gemini_model: str = "gemini-2.5-flash"
    ai_enabled: bool = True
    ai_temperature: float = 0.9

    # --- accounts -------------------------------------------------------
    # Each entry is a named Chrome profile. Accounts must be registered in the
    # Associates profile before links are posted from them.
    accounts: list[dict] = field(default_factory=lambda: [
        {"name": "default", "profile": "", "enabled": True, "registered": False}
    ])

    # --- ui -------------------------------------------------------------
    theme: str = "dark"
    start_minimised: bool = False

    # ---------------------------------------------------------------

    @property
    def profile_path(self) -> Path:
        if self.browser_profile:
            return Path(self.browser_profile)
        return app_dir() / "chrome-profile"

    @property
    def db_path(self) -> Path:
        return app_dir() / "deals.db"


class Config:
    """Loads, saves and exposes settings plus keyring-backed secrets."""

    def __init__(self, path: Optional[Path] = None):
        self.path = path or (app_dir() / "settings.json")
        self.settings = self._load()

    def _load(self) -> Settings:
        if not self.path.exists():
            return Settings()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return Settings()
        known = {f for f in Settings().__dataclass_fields__}
        return Settings(**{k: v for k, v in data.items() if k in known})

    def save(self) -> None:
        self.path.write_text(
            json.dumps(asdict(self.settings), indent=2), encoding="utf-8"
        )

    def update(self, **fields: Any) -> None:
        for k, v in fields.items():
            if hasattr(self.settings, k):
                setattr(self.settings, k, v)
        self.save()

    # --- secrets ---------------------------------------------------------
    # keyring hits the Windows Credential Manager, macOS Keychain, or the
    # Secret Service on Linux. A plaintext fallback would defeat the point, so
    # if keyring is unavailable we say so rather than writing the key to disk.

    def _keyring(self):
        try:
            import keyring
            return keyring
        except ImportError:
            return None

    def get_secret(self, name: str) -> Optional[str]:
        kr = self._keyring()
        if kr is None:
            return None
        try:
            return kr.get_password(KEYRING_SERVICE, name)
        except Exception:
            return None

    def set_secret(self, name: str, value: str) -> bool:
        kr = self._keyring()
        if kr is None:
            return False
        try:
            if value:
                kr.set_password(KEYRING_SERVICE, name, value)
            else:
                kr.delete_password(KEYRING_SERVICE, name)
            return True
        except Exception:
            return False

    @property
    def gemini_key(self) -> Optional[str]:
        return self.get_secret("gemini_api_key")

    @property
    def keepa_key(self) -> Optional[str]:
        return self.get_secret("keepa_api_key")

    def keyring_available(self) -> bool:
        return self._keyring() is not None
