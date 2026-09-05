"""Original post copy from verified deal facts.

This is the floor and the fallback: it always produces a valid, compliant post,
with no network call and no model. The AI path in ai.py upgrades the wording
but reuses this module's assembly rules, so the link and the disclosure are
constructed identically either way.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Optional

from .core import Deal, build_affiliate_url

DISCLOSURE_SHORT = "#ad"
DISCLOSURE_FULL = "As an Amazon Associate I earn from qualifying purchases."
X_LIMIT = 280
URL_WEIGHT = 23  # X counts any URL as 23 characters

HOOKS = {
    "clip_coupon": [
        "The coupon is sitting right there on the page and most people scroll past it.",
        "One checkbox on the listing knocks this down. Blink and it is gone.",
        "Clip the coupon before you add to cart - that is the whole trick.",
    ],
    "checkout_code": [
        "The listing price is not the real price. The code does the work.",
        "Looks full price until the code lands at checkout.",
        "Add the code at checkout and watch the total drop.",
    ],
    "lightning": [
        "Lightning deal - this one is on a clock, not a stock count.",
        "Timer is already running on this one.",
        "Lightning deals do not come back. This is the window.",
    ],
    "price_drop": [
        "This just hit a price I have not seen it at before.",
        "Price dropped hard on this one overnight.",
        "Lowest this has been in months.",
    ],
    "subscribe_save": [
        "Subscribe & Save stacks on top of this one. Cancel after the first order.",
        "The S&S discount stacks here - that is where the real number is.",
    ],
    "prime_exclusive": [
        "Prime-exclusive pricing on this one.",
        "Prime members are seeing a very different number here.",
    ],
    "deal": [
        "This price will not hold.",
        "Found this one while it is still live.",
        "Good price on this right now.",
    ],
}

INSTRUCTIONS = {
    "clip_coupon": "Tick the coupon box on the listing, then check out.",
    "checkout_code": "Apply code {code} at checkout.",
    "lightning": "Add to cart now - lightning deals release the cart if you stall.",
    "price_drop": "No code needed, the price is live on the listing.",
    "subscribe_save": "Choose Subscribe & Save at checkout, cancel any time after it ships.",
    "prime_exclusive": "Sign in with Prime to see the discounted price.",
    "deal": "Price is live on the listing.",
}


@dataclass
class Draft:
    text: str
    link: str
    asin: str
    mechanic: str
    promo_code: Optional[str] = None
    source: str = "template"

    @property
    def char_count(self) -> int:
        return char_count(self.text)

    @property
    def over_limit(self) -> bool:
        return self.char_count > X_LIMIT

    @property
    def has_disclosure(self) -> bool:
        return DISCLOSURE_SHORT in self.text


def char_count(text: str) -> int:
    """X's counting rules: every URL is 23 characters regardless of length."""
    if not text:
        return 0
    n = len(text)
    for url in re.findall(r"https?://\S+", text):
        n = n - len(url) + URL_WEIGHT
    return n


def _pick(options: list[str], seed: str) -> str:
    if not options:
        return ""
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    return options[h % len(options)]


def urgency_line(age_minutes: Optional[int]) -> str:
    """Urgency anchored to how long the deal has actually been live.

    Never invented - a fabricated countdown is the fastest way to lose an
    audience, and the real number is usually more compelling anyway.
    """
    if age_minutes is None:
        return "These get corrected fast - check the price before you commit."
    if age_minutes < 15:
        return f"Live for {age_minutes} minutes. This is as early as you get."
    if age_minutes < 60:
        return f"Been live {age_minutes} minutes. Amazon usually catches these same-day."
    hours = age_minutes // 60
    if age_minutes < 180:
        unit = "hour" if hours == 1 else "hours"
        return f"Running {hours} {unit} now - the clock is against this one."
    if hours < 24:
        return f"{hours} hours in. Verify the price still holds before you buy."
    return "Older deal - confirm the price is still live before you commit."


def savings_line(deal: Deal) -> str:
    """State only what has been verified.

    Amazon bars claiming a discount or price you have not confirmed, and a wrong
    number costs more in trust than the post earns.
    """
    now, was = deal.current_price, deal.reference_price
    if now is not None and was is not None and was > now:
        pct = round(((was - now) / was) * 100)
        return f"${now:.2f} (was ${was:.2f}) - {pct}% off."
    if now is not None:
        return f"${now:.2f} right now."
    if len(deal.prices_in_post) >= 2:
        return "Big gap between list and checkout price - see the listing for the live number."
    return "Live price is on the listing."


def _shorten(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", (s or "").strip())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def generate(deal: Deal, tag: str, *, long_form: bool = False, variant: int = 0) -> Draft:
    mechanic = deal.mechanic or "deal"
    hooks = HOOKS.get(mechanic, HOOKS["deal"])
    hook = _pick(hooks, f"{deal.asin}{mechanic}{variant}")

    instruction = INSTRUCTIONS.get(mechanic, INSTRUCTIONS["deal"])
    if "{code}" in instruction:
        instruction = (
            instruction.format(code=deal.promo_code)
            if deal.promo_code
            else INSTRUCTIONS["deal"]
        )

    link = deal.affiliate_url or build_affiliate_url(deal.asin, tag) or ""
    disclosure = f"{DISCLOSURE_SHORT} {DISCLOSURE_FULL}" if long_form else DISCLOSURE_SHORT

    parts = [
        hook,
        _shorten(deal.title, 120 if long_form else 70) if deal.title else "",
        savings_line(deal),
        instruction,
        urgency_line(deal.age_minutes),
        link,
        disclosure,
    ]
    text = "\n\n".join(p for p in parts if p)

    if not long_form and char_count(text) > X_LIMIT:
        text = _compact(hook, deal, link)

    return Draft(
        text=text, link=link, asin=deal.asin,
        mechanic=mechanic, promo_code=deal.promo_code, source="template",
    )


def _compact(hook: str, deal: Deal, link: str) -> str:
    """Tight layout for when the full one overruns.

    The link and the disclosure are never what gets dropped.
    """
    age = deal.age_minutes
    if age is not None and age < 180:
        stamp = f"{age}m" if age < 60 else f"{age // 60}h"
        urgency = f"Live {stamp} - moves fast."
    else:
        urgency = "Verify price before buying."

    bits = [
        hook,
        _shorten(deal.title, 45) if deal.title else "",
        savings_line(deal),
        f"Code: {deal.promo_code}" if deal.promo_code else "",
        urgency,
        link,
        DISCLOSURE_SHORT,
    ]
    return "\n".join(b for b in bits if b)


def variants(deal: Deal, tag: str, count: int = 3, *, long_form: bool = False) -> list[Draft]:
    """Several angles on the same deal so the feed does not read like a bot."""
    n = min(count, len(HOOKS.get(deal.mechanic or "deal", HOOKS["deal"])))
    return [generate(deal, tag, long_form=long_form, variant=i) for i in range(n)]


def assemble(body: str, deal: Deal, tag: str, *, long_form: bool = False) -> str:
    """Attach the link and disclosure to a model-written body.

    The parts carrying legal and financial weight are constructed here, never by
    the model, so a hallucinated URL cannot reach the feed.
    """
    link = deal.affiliate_url or build_affiliate_url(deal.asin, tag) or ""
    disclosure = f"{DISCLOSURE_SHORT} {DISCLOSURE_FULL}" if long_form else DISCLOSURE_SHORT
    return "\n\n".join(p for p in (body, link, disclosure) if p)
