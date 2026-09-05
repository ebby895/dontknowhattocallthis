"""Deal verification.

Confirms a captured deal is real before the account's name goes on it: live
price, availability, category, and - where a Keepa key is configured - the true
reference price from price history rather than an inflated list price.

This is also the module that distinguishes a promotion from a pricing error. A
glitch gets cancelled, which reverses the commission and costs followers, so
those are flagged rather than auto-posted.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import httpx

from .core import Deal

log = logging.getLogger(__name__)

TIMEOUT = 8.0
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# A discount this deep is far more likely to be a mispriced listing than a
# promotion, and mispriced listings get cancelled.
GLITCH_DISCOUNT_THRESHOLD = 90.0

TITLE_RE = re.compile(r'<span[^>]+id="productTitle"[^>]*>(.*?)</span>', re.S | re.I)
PRICE_RES = [
    re.compile(r'"priceAmount"\s*:\s*([0-9.]+)'),
    re.compile(r'class="a-offscreen"[^>]*>\s*\$([0-9,]+\.[0-9]{2})'),
    re.compile(r'id="priceblock_ourprice"[^>]*>\s*\$([0-9,]+\.[0-9]{2})'),
]
LIST_PRICE_RES = [
    re.compile(r'"strikePrice".*?\$([0-9,]+\.[0-9]{2})', re.S),
    re.compile(r'class="a-text-price"[^>]*>\s*<span[^>]*>\s*\$([0-9,]+\.[0-9]{2})', re.S),
]
UNAVAILABLE_RE = re.compile(
    r"currently unavailable|out of stock|we don'?t know when", re.I
)

# Amazon's browse-node names mapped to the commission categories in core.py.
CATEGORY_HINTS = [
    ("kitchen", "kitchen"), ("home & kitchen", "kitchen"),
    ("tools & home improvement", "tools"), ("home improvement", "home_improvement"),
    ("patio, lawn & garden", "lawn_garden"), ("garden", "lawn_garden"),
    ("pet supplies", "pets"), ("beauty", "beauty"), ("luxury beauty", "luxury_beauty"),
    ("books", "physical_books"), ("clothing", "apparel"), ("shoes", "apparel"),
    ("jewelry", "jewelry"), ("toys & games", "toys"), ("baby", "baby"),
    ("sports & outdoors", "sports"), ("outdoor", "outdoors"),
    ("musical instruments", "musical_instruments"),
    ("industrial & scientific", "business_industrial"),
    ("headphones", "headphones"), ("computers", "computers"),
    ("electronics", "electronics"), ("grocery", "grocery"),
    ("health & household", "health"), ("video games", "video_games"),
    ("furniture", "furniture"),
]


def _to_float(s: str) -> Optional[float]:
    try:
        return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _first_match(patterns, html: str) -> Optional[float]:
    for pat in patterns:
        m = pat.search(html)
        if m:
            v = _to_float(m.group(1))
            if v is not None:
                return v
    return None


def _detect_category(html: str) -> Optional[str]:
    lowered = html[:400_000].lower()
    for needle, category in CATEGORY_HINTS:
        if needle in lowered:
            return category
    return None


async def fetch_listing(asin: str) -> dict:
    """Scrape the live listing. Used below the Creators API sales threshold."""
    url = f"https://www.amazon.com/dp/{asin}"
    async with httpx.AsyncClient(
        timeout=TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    title_match = TITLE_RE.search(html)
    title = None
    if title_match:
        title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", title_match.group(1))).strip()

    return {
        "title": title,
        "current_price": _first_match(PRICE_RES, html),
        "reference_price": _first_match(LIST_PRICE_RES, html),
        "available": not bool(UNAVAILABLE_RE.search(html)),
        "category": _detect_category(html),
    }


async def fetch_keepa_reference(asin: str, api_key: str) -> Optional[float]:
    """The 90-day average from price history.

    Measuring a discount against this rather than a list price is what separates
    a real deal from a listing whose 'was' number is fiction.
    """
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                "https://api.keepa.com/product",
                params={"key": api_key, "domain": 1, "asin": asin, "stats": 90},
            )
            resp.raise_for_status()
            data = resp.json()

        products = data.get("products") or []
        if not products:
            return None

        stats = products[0].get("stats") or {}
        avg = stats.get("avg90") or stats.get("avg")
        if isinstance(avg, list) and avg:
            # Index 0 is Amazon's own price, in cents; -1 means no data.
            cents = avg[0]
            if isinstance(cents, (int, float)) and cents > 0:
                return round(cents / 100.0, 2)
    except Exception as exc:
        log.debug("Keepa lookup failed for %s: %s", asin, exc)
    return None


async def verify_deal(deal: Deal, keepa_key: Optional[str] = None) -> Deal:
    """Populate the deal's verified fields in place and return it."""
    try:
        listing = await fetch_listing(deal.asin)
    except Exception as exc:
        log.debug("Listing fetch failed for %s: %s", deal.asin, exc)
        return deal

    deal.title = listing.get("title") or deal.title
    deal.current_price = listing.get("current_price")
    deal.available = listing.get("available")
    deal.category = listing.get("category")

    reference = listing.get("reference_price")

    # Prefer real price history over the listing's own "was" number.
    if keepa_key:
        keepa_ref = await fetch_keepa_reference(deal.asin, keepa_key)
        if keepa_ref:
            reference = keepa_ref

    deal.reference_price = reference

    if deal.current_price and reference and reference > deal.current_price:
        pct = ((reference - deal.current_price) / reference) * 100
        deal.discount_pct = round(pct, 1)

        # Flag rather than post. A 95%-off listing is a pricing error, the order
        # gets cancelled, and the commission reverses.
        if pct >= GLITCH_DISCOUNT_THRESHOLD:
            deal.hold_reason = (
                f"looks like a pricing error ({pct:.0f}% off) - review before posting"
            )

    return deal
