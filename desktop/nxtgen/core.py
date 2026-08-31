"""Link primitives for the deal engine.

The Amazon gate lives here: a captured post only becomes a deal if its outbound
link chain terminates on an Amazon host. Everything else - Walmart, Target, the
redirector itself, lookalike domains - stops at this file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

# Hosts that count as "ends at Amazon".
AMAZON_HOSTS = {
    "amazon.com",
    "smile.amazon.com",
    "amzn.to",
    "amzn.com",
    "a.co",
}

# Redirectors seen in deal posts. We follow them to learn the destination; they
# never appear in anything we publish.
KNOWN_REDIRECTORS = {
    "hiddenclearances.com",
    "bit.ly",
    "tinyurl.com",
    "linktr.ee",
    "geni.us",
    "shrsl.com",
    "sovrn.co",
    "howl.link",
    "t.co",
}

ASIN_PATTERNS = [
    re.compile(r"/dp/([A-Z0-9]{10})(?:[/?]|$)", re.I),
    re.compile(r"/gp/product/([A-Z0-9]{10})(?:[/?]|$)", re.I),
    re.compile(r"/gp/aw/d/([A-Z0-9]{10})(?:[/?]|$)", re.I),
    re.compile(r"/product/([A-Z0-9]{10})(?:[/?]|$)", re.I),
    re.compile(r"/ASIN/([A-Z0-9]{10})(?:[/?]|$)", re.I),
    re.compile(r"[?&]asin=([A-Z0-9]{10})(?:&|$)", re.I),
]

# The keyword is matched case-insensitively but the code itself is not: real
# Amazon codes are uppercase, and matching the token case-insensitively turns
# ordinary prose ("no code needed") into a fabricated code.
CODE_PATTERNS = [
    re.compile(r"(?i:\bpromo\s*code)[:\s]+([A-Z0-9]{5,15})\b"),
    re.compile(r"(?i:\bcode)[:\s]+([A-Z0-9]{5,15})\b"),
    re.compile(r"(?i:\bcoupon)[:\s]+([A-Z0-9]{5,15})\b"),
    re.compile(r"(?i:\buse)[:\s]+([A-Z0-9]{5,15})\s+(?i:at\s+checkout)\b"),
]

# Uppercase words that turn up next to the keyword in deal posts and are not
# codes. A token containing a digit is always treated as a code.
CODE_STOPWORDS = {
    "CHECKOUT", "TODAY", "ONLY", "NEEDED", "REQUIRED", "APPLIED", "AUTO",
    "PRIME", "STACK", "STACKS", "LIMITED", "EXPIRES", "COUPON", "PROMO",
    "AMAZON", "DEALS", "SALE", "OFFER", "CLIP", "CART", "PRICE", "FREE",
    "SHIPS", "BELOW", "ABOVE", "AFTER", "ORDER", "ITEMS",
}

PRICE_RE = re.compile(r"\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)")

# Query parameters that carry someone else's attribution.
FOREIGN_PARAMS = {"tag", "ascsubtag", "linkcode", "linkid", "ref_", "creative", "camp"}


def host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return ""


def is_amazon_url(url: str) -> bool:
    """True only if the URL's host is Amazon or a subdomain of it.

    Suffix matching is anchored on a dot so ``amazon.com.evil.co`` does not pass.
    """
    h = host_of(url)
    if not h:
        return False
    return any(h == a or h.endswith("." + a) for a in AMAZON_HOSTS)


def is_known_redirector(url: str) -> bool:
    h = host_of(url)
    return any(h == r or h.endswith("." + r) for r in KNOWN_REDIRECTORS)


def extract_asin(url: str) -> Optional[str]:
    if not url:
        return None
    for pat in ASIN_PATTERNS:
        m = pat.search(url)
        if m:
            return m.group(1).upper()
    return None


def build_affiliate_url(asin: str, tag: str) -> Optional[str]:
    """The only link shape we publish: canonical /dp/ path, our tag, nothing else.

    No shorteners and no redirect hops - the Associates policy bars placements
    that obscure that you are linking to Amazon.
    """
    if not asin or not tag:
        return None
    return f"https://www.amazon.com/dp/{asin}?tag={tag}"


def strip_foreign_tag(url: str) -> str:
    """Remove another affiliate's attribution from a URL."""
    try:
        p = urlparse(url)
        kept = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
                if k.lower() not in FOREIGN_PARAMS]
        return urlunparse(p._replace(query=urlencode(kept)))
    except Exception:
        return url


def extract_promo_code(text: str) -> Optional[str]:
    """Pull a promo code out of post text, or None.

    Returning None is always safe - the copy falls back to "price is live on
    the listing". Returning a word that is not a code is not: it puts a
    fabricated instruction in front of buyers.
    """
    if not text:
        return None
    for pat in CODE_PATTERNS:
        m = pat.search(text)
        if not m:
            continue
        code = m.group(1).upper()
        if code in CODE_STOPWORDS:
            continue
        # An all-letter token is only a code if it is not ordinary prose; a
        # digit is the reliable signal, so require one unless it is long and
        # clearly code-shaped.
        if not any(ch.isdigit() for ch in code) and len(code) < 6:
            continue
        return code
    return None


def detect_mechanic(text: str) -> str:
    """Identify how the discount is claimed, so the copy can say what to do."""
    if not text:
        return "deal"
    t = text.lower()
    if re.search(r"\bclip\b.*\bcoupon\b|\bcoupon\b.*\bclip\b", t):
        return "clip_coupon"
    if re.search(r"\bat checkout\b|\bapply code\b|\bpromo code\b|\bcode\b", t):
        return "checkout_code"
    if "lightning deal" in t:
        return "lightning"
    if re.search(r"\bsubscribe\s*(?:&|and)\s*save\b", t):
        return "subscribe_save"
    if re.search(r"\bprime\b.*\bexclusive\b", t):
        return "prime_exclusive"
    if re.search(r"\bprice drop\b|\ball[- ]time low\b", t):
        return "price_drop"
    return "deal"


def extract_prices(text: str) -> list[float]:
    if not text:
        return []
    out = []
    for m in PRICE_RE.finditer(text):
        try:
            out.append(float(m.group(1).replace(",", "")))
        except ValueError:
            pass
    return out


def age_minutes(iso_ts: Optional[str]) -> Optional[int]:
    """Minutes since a post went up. Drives both urgency copy and ranking."""
    if not iso_ts:
        return None
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return max(0, int(delta.total_seconds() // 60))
    except Exception:
        return None


def format_age(mins: Optional[int]) -> str:
    if mins is None:
        return "just now"
    if mins < 1:
        return "seconds ago"
    if mins < 60:
        return f"{mins}m ago"
    hours = mins // 60
    if hours < 24:
        return f"{hours}h ago"
    return f"{hours // 24}d ago"


# Amazon fixed commission rates by category. Same click volume, very different
# payout - this is what makes one deal worth a feed slot over another.
CATEGORY_RATES = {
    "digital_video_games": 20.0,
    "luxury_beauty": 10.0,
    "physical_books": 4.5,
    "kitchen": 4.5,
    "apparel": 4.0,
    "jewelry": 4.0,
    "amazon_devices": 4.0,
    "beauty": 3.0,
    "home": 3.0,
    "home_improvement": 3.0,
    "furniture": 3.0,
    "lawn_garden": 3.0,
    "pets": 3.0,
    "headphones": 3.0,
    "musical_instruments": 3.0,
    "business_industrial": 3.0,
    "outdoors": 3.0,
    "tools": 3.0,
    "sports": 3.0,
    "baby": 3.0,
    "toys": 3.0,
    "computers": 2.5,
    "tv": 2.0,
    "electronics": 1.0,
    "grocery": 1.0,
    "health": 1.0,
    "video_games": 1.0,
}
DEFAULT_RATE = 3.0


def category_rate(category: Optional[str]) -> float:
    return CATEGORY_RATES.get(category or "", DEFAULT_RATE)


@dataclass
class Deal:
    """A captured post that resolved to an Amazon product."""

    asin: str
    affiliate_url: str
    source_post_id: str = ""
    source_author: str = ""
    source_text: str = ""
    source_url: str = ""
    landed_url: str = ""
    posted_at: Optional[str] = None
    promo_code: Optional[str] = None
    mechanic: str = "deal"
    prices_in_post: list[float] = field(default_factory=list)
    source_images: list[str] = field(default_factory=list)

    # Filled by the verifier
    title: Optional[str] = None
    current_price: Optional[float] = None
    reference_price: Optional[float] = None
    discount_pct: Optional[float] = None
    available: Optional[bool] = None
    category: Optional[str] = None

    captured_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    status: str = "new"
    hold_reason: Optional[str] = None

    @property
    def age_minutes(self) -> Optional[int]:
        return age_minutes(self.posted_at)

    @property
    def commission_rate(self) -> float:
        return category_rate(self.category)

    @property
    def estimated_commission(self) -> Optional[float]:
        if self.current_price is None:
            return None
        return round(self.current_price * self.commission_rate / 100.0, 2)

    def score(self, max_age_minutes: int = 720) -> float:
        """Rank deals for the queue.

        Freshness dominates because promo pricing gets corrected; then discount
        depth, then how much the category actually pays.
        """
        age = self.age_minutes
        freshness = 0.5 if age is None else max(0.0, 1.0 - (age / max_age_minutes))
        discount = 0.3 if self.discount_pct is None else min(1.0, self.discount_pct / 60.0)
        payout = min(1.0, self.commission_rate / 10.0)
        return (freshness * 0.5) + (discount * 0.3) + (payout * 0.2)
