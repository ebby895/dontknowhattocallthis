"""Timeline capture via a real logged-in Chrome profile.

Playwright drives a persistent profile, so x.com is read through an ordinary
signed-in session rather than an API or an anonymous scrape. You log in once by
hand; the profile keeps the session from then on.

Only the Following tab is read - the accounts the operator actually follows.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# Extraction runs in the page. testid hooks are stable; class names are
# generated and churn constantly.
EXTRACT_JS = r"""
() => {
  const out = [];
  const arts = document.querySelectorAll('article[role="article"]');
  for (const art of arts) {
    const permalink = art.querySelector('a[href*="/status/"]');
    if (!permalink) continue;
    const m = (permalink.getAttribute('href') || '').match(/\/status\/(\d+)/);
    if (!m) continue;

    const nameEl = art.querySelector('[data-testid="User-Name"]');
    const nameParts = nameEl ? nameEl.innerText.split('\n').filter(Boolean) : [];
    const textEl = art.querySelector('[data-testid="tweetText"]');
    const timeEl = art.querySelector('time');

    const links = new Set();
    art.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        try {
          const h = new URL(href).hostname;
          if (!/(^|\.)x\.com$/i.test(h) && !/(^|\.)twitter\.com$/i.test(h)) links.add(href);
        } catch (e) {}
      }
      const shown = (a.innerText || '').trim();
      if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(shown) && !shown.includes(' ')) {
        links.add('https://' + shown.replace(/…$/, ''));
      }
    });

    const body = textEl ? textEl.innerText : '';
    const re = /https?:\/\/[^\s]+/gi;
    let mm;
    while ((mm = re.exec(body)) !== null) links.add(mm[0].replace(/[).,]+$/, ''));

    if (!links.size) continue;

    out.push({
      post_id: m[1],
      display_name: nameParts[0] || '',
      handle: (nameParts.find((p) => p.startsWith('@')) || ''),
      text: body,
      timestamp: timeEl ? timeEl.getAttribute('datetime') : null,
      images: Array.from(art.querySelectorAll('[data-testid="tweetPhoto"] img'))
                   .map((i) => i.getAttribute('src')).filter(Boolean),
      links: Array.from(links)
    });
  }
  return out;
}
"""


@dataclass
class CapturedPost:
    post_id: str
    handle: str
    display_name: str
    text: str
    timestamp: Optional[str]
    links: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)


class TimelineCapture:
    """Owns the browser. Start once, poll, stop on shutdown."""

    def __init__(self, profile_dir: Path, *, headless: bool = False,
                 timeline_url: str = "https://x.com/home"):
        self.profile_dir = Path(profile_dir)
        self.headless = headless
        self.timeline_url = timeline_url
        self._pw = None
        self._context = None
        self._page = None
        self._seen: set[str] = set()

    async def start(self) -> None:
        from playwright.async_api import async_playwright

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._pw = await async_playwright().start()

        # A persistent context keeps cookies between runs, so the operator signs
        # in once rather than every launch.
        self._context = await self._pw.chromium.launch_persistent_context(
            str(self.profile_dir),
            headless=self.headless,
            viewport={"width": 1400, "height": 1000},
            args=["--disable-blink-features=AutomationControlled"],
        )
        self._page = (
            self._context.pages[0] if self._context.pages
            else await self._context.new_page()
        )
        await self._page.goto(self.timeline_url, wait_until="domcontentloaded")
        log.info("Timeline capture started on %s", self.timeline_url)

    async def is_logged_in(self) -> bool:
        if not self._page:
            return False
        try:
            await self._page.wait_for_selector(
                '[data-testid="SideNav_AccountSwitcher_Button"]', timeout=5000
            )
            return True
        except Exception:
            return False

    async def select_following_tab(self) -> bool:
        """Switch to Following so we read only accounts the operator follows."""
        if not self._page:
            return False
        try:
            tabs = self._page.locator('[role="tab"]')
            count = await tabs.count()
            for i in range(count):
                tab = tabs.nth(i)
                label = (await tab.inner_text()).strip()
                if label.lower() == "following":
                    if await tab.get_attribute("aria-selected") != "true":
                        await tab.click()
                        await asyncio.sleep(1.2)
                    return True
        except Exception as exc:
            log.debug("Could not select Following tab: %s", exc)
        return False

    async def poll(self) -> list[CapturedPost]:
        """Return posts with outbound links that have not been seen before."""
        if not self._page:
            return []
        try:
            raw = await self._page.evaluate(EXTRACT_JS)
        except Exception as exc:
            log.warning("Timeline extraction failed: %s", exc)
            return []

        fresh = []
        for r in raw:
            pid = r.get("post_id")
            if not pid or pid in self._seen:
                continue
            self._seen.add(pid)
            fresh.append(
                CapturedPost(
                    post_id=pid,
                    handle=r.get("handle", ""),
                    display_name=r.get("display_name", ""),
                    text=r.get("text", ""),
                    timestamp=r.get("timestamp"),
                    links=r.get("links", []) or [],
                    images=r.get("images", []) or [],
                )
            )

        # Bound the seen set; the timeline only ever moves forward.
        if len(self._seen) > 20_000:
            self._seen = set(list(self._seen)[-10_000:])

        return fresh

    async def refresh(self) -> None:
        """Pull new posts into view.

        Scrolling to the top is what makes X load newly arrived posts, which is
        the difference between catching a deal at 2 minutes and at 40.
        """
        if not self._page:
            return
        try:
            await self._page.evaluate("window.scrollTo({top: 0, behavior: 'instant'})")
            await self._page.keyboard.press(".")   # X's shortcut for "load new posts"
            await asyncio.sleep(0.4)
        except Exception:
            pass

    @property
    def page(self):
        return self._page

    async def stop(self) -> None:
        for closer in (
            getattr(self._context, "close", None),
            getattr(self._pw, "stop", None),
        ):
            if closer:
                try:
                    await closer()
                except Exception:
                    pass
        self._context = self._page = self._pw = None
