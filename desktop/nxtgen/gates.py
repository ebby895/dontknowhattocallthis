"""The gates a draft must clear before it can publish unattended.

These fail closed. Anything that cannot be proven compliant and accurate is
held for review rather than posted - because an unattended pipeline has no
other check on it, and every post carries the operator's tag and name.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional

from .core import Deal, is_amazon_url
from .copywriter import Draft, X_LIMIT, DISCLOSURE_SHORT
from .config import Settings
from .db import Store


@dataclass
class GateResult:
    ok: bool
    reason: str = ""

    def __bool__(self) -> bool:
        return self.ok


PASS = GateResult(True)


def _fail(reason: str) -> GateResult:
    return GateResult(False, reason)


def check_link(draft: Draft, settings: Settings) -> GateResult:
    """Exactly one link, on Amazon, carrying our tag.

    This is what stops a redirector or a foreign affiliate's tag from surviving
    into a published post.
    """
    urls = re.findall(r"https?://\S+", draft.text)
    if len(urls) != 1:
        return _fail(f"expected exactly one link, found {len(urls)}")
    if not is_amazon_url(urls[0]):
        return _fail("link is not Amazon")
    if settings.associate_tag not in urls[0]:
        return _fail("missing associate tag")
    return PASS


def check_disclosure(draft: Draft) -> GateResult:
    """Missing disclosure is the top cause of Associates termination."""
    if DISCLOSURE_SHORT not in draft.text:
        return _fail("missing #ad disclosure")
    return PASS


def check_length(draft: Draft, settings: Settings) -> GateResult:
    if not settings.long_form_posts and draft.char_count > X_LIMIT:
        return _fail(f"over character limit ({draft.char_count})")
    return PASS


def check_freshness(deal: Deal, settings: Settings) -> GateResult:
    """An old capture is a price that has probably already been corrected."""
    age = deal.age_minutes
    if age is None:
        return PASS
    if age > settings.max_deal_age_minutes:
        return _fail(f"stale ({age}m old, cap {settings.max_deal_age_minutes}m)")
    return PASS


def check_substance(deal: Deal, settings: Settings) -> GateResult:
    """Only auto-post something we can stand behind.

    A verified discount or a captured code. Anything vaguer goes to the queue
    for a human to look at.
    """
    has_discount = (
        deal.discount_pct is not None and deal.discount_pct >= settings.min_discount_pct
    )
    if not has_discount and not deal.promo_code:
        return _fail("unverified discount and no code")
    if deal.available is False:
        return _fail("out of stock")
    return PASS


def check_rate(deal: Deal, settings: Settings, store: Store) -> GateResult:
    """Spacing and caps, so the feed reads human rather than automated."""
    if store.already_posted(deal.asin):
        return _fail("already posted this ASIN")

    last = store.last_post_at()
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        gap = datetime.now(timezone.utc) - last
        required = timedelta(minutes=settings.min_gap_minutes)
        if gap < required:
            remaining = int((required - gap).total_seconds() // 60) + 1
            return _fail(f"rate limit, {remaining}m to next slot")

    if store.posts_since(3600) >= settings.max_posts_per_hour:
        return _fail("hourly cap reached")
    if store.posts_since(86400) >= settings.max_posts_per_day:
        return _fail("daily cap reached")

    return PASS


def can_post(deal: Deal, draft: Draft, settings: Settings, store: Store) -> GateResult:
    """Run every gate in order. First failure wins and names the reason."""
    if not settings.autopost_armed:
        return _fail("autopilot disarmed")

    for result in (
        check_link(draft, settings),
        check_disclosure(draft),
        check_length(draft, settings),
        check_freshness(deal, settings),
        check_substance(deal, settings),
        check_rate(deal, settings, store),
    ):
        if not result.ok:
            return result

    return PASS


def explain(deal: Deal, draft: Draft, settings: Settings, store: Store) -> list[tuple[str, bool, str]]:
    """Every gate's verdict, for the UI - so a held deal shows why it is held."""
    checks = [
        ("armed", settings.autopost_armed,
         "" if settings.autopost_armed else "autopilot disarmed"),
    ]
    for name, res in (
        ("link", check_link(draft, settings)),
        ("disclosure", check_disclosure(draft)),
        ("length", check_length(draft, settings)),
        ("freshness", check_freshness(deal, settings)),
        ("substance", check_substance(deal, settings)),
        ("rate", check_rate(deal, settings, store)),
    ):
        checks.append((name, res.ok, res.reason))
    return checks
