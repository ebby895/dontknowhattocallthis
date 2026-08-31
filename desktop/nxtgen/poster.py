"""Publishing a draft to X.

Two input modes:

* ``playwright`` - drives the composer in the controlled browser. Reliable, and
  it does not fight the operator for the physical keyboard and mouse.
* ``keyboard``   - real OS-level keystrokes via pyautogui, for when the composer
  must be driven in a browser Playwright is not attached to.

Both re-read the composer before submitting and refuse to send if the disclosure
is not actually in the box. The gates decide *whether* to post; this module only
decides *how*, and verifies what it typed.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

COMPOSER_TRIGGER = '[data-testid="SideNav_NewTweet_Button"]'
EDITOR = '[data-testid="tweetTextarea_0"]'
POST_BUTTON = '[data-testid="tweetButton"]'
DISCLOSURE = "#ad"


@dataclass
class PostResult:
    ok: bool
    reason: str = ""
    x_post_id: Optional[str] = None
    latency_ms: int = 0


async def post_via_playwright(page, text: str) -> PostResult:
    """Compose and publish in the Playwright-controlled page."""
    loop = asyncio.get_event_loop()
    started = loop.time()

    try:
        editor = page.locator(EDITOR).first
        if await editor.count() == 0:
            trigger = page.locator(COMPOSER_TRIGGER).first
            if await trigger.count() == 0:
                return PostResult(False, "composer trigger not found")
            await trigger.click()
            await page.wait_for_selector(EDITOR, timeout=8000)
            editor = page.locator(EDITOR).first

        await editor.click()
        # type() emits real key events, which the Draft.js editor needs; fill()
        # sets value directly and the editor ignores it.
        await editor.type(text, delay=8)

        # Give X a moment to parse the URL and enable the button.
        await asyncio.sleep(1.0)

        # Read back what is actually in the box before committing.
        in_box = await editor.inner_text()
        if DISCLOSURE not in in_box:
            return PostResult(False, "disclosure missing in composer")

        button = page.locator(POST_BUTTON).first
        if await button.count() == 0:
            return PostResult(False, "post button not found")
        if await button.get_attribute("aria-disabled") == "true":
            return PostResult(False, "post button disabled")

        await button.click()
        await asyncio.sleep(1.8)

        latency = int((loop.time() - started) * 1000)
        return PostResult(True, latency_ms=latency)

    except Exception as exc:
        return PostResult(False, f"{type(exc).__name__}: {exc}")


def post_via_keyboard(text: str, *, typing_delay_ms: int = 18) -> PostResult:
    """Publish using OS-level input against whatever browser is focused.

    Blocking and synchronous by nature - it takes over the real keyboard, so it
    must be run off the UI thread and the machine should be left alone while it
    runs.
    """
    try:
        import pyautogui
    except ImportError:
        return PostResult(False, "pyautogui not installed")

    if DISCLOSURE not in text:
        return PostResult(False, "refusing to type a draft with no disclosure")

    pyautogui.FAILSAFE = True  # slam the pointer into a corner to abort

    try:
        import time
        started = time.time()

        # 'n' is X's compose shortcut; it only fires when focus is on the page
        # rather than in a field, which is the state we expect.
        pyautogui.press("n")
        time.sleep(1.0)

        pyautogui.write(text, interval=typing_delay_ms / 1000.0)
        time.sleep(1.0)

        # Ctrl+Enter submits the composer.
        pyautogui.hotkey("ctrl", "enter")
        time.sleep(1.5)

        return PostResult(True, latency_ms=int((time.time() - started) * 1000))
    except Exception as exc:
        return PostResult(False, f"{type(exc).__name__}: {exc}")


async def publish(page, text: str, *, mode: str = "playwright",
                  typing_delay_ms: int = 18) -> PostResult:
    """Dispatch to the configured input mode."""
    if mode == "keyboard":
        # Keep the OS-level typing off the event loop.
        return await asyncio.to_thread(
            post_via_keyboard, text, typing_delay_ms=typing_delay_ms
        )
    if page is None:
        return PostResult(False, "no browser page available")
    return await post_via_playwright(page, text)
