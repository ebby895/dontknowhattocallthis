"""Gemini copy generation.

The model writes the body only. The link, the associate tag and the disclosure
are appended afterwards by copywriter.assemble, so a hallucinated URL or a
dropped disclosure cannot reach the feed.

Every generation is validated before it can be used: no URLs, no invented
prices, no invented promo codes. Anything that fails falls back to the template
generator, so a Gemini outage never stalls the pipeline.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

import httpx

from .core import Deal, extract_prices
from . import copywriter
from .copywriter import Draft

log = logging.getLogger(__name__)

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT = 6.0  # must fit inside the "post within seconds" budget

MECHANIC_TEXT = {
    "clip_coupon": "tick the coupon box on the listing before checkout",
    "checkout_code": "enter the promo code at checkout",
    "lightning": "lightning deal, on a timer",
    "price_drop": "price is already dropped, no code needed",
    "subscribe_save": "choose Subscribe & Save at checkout",
    "prime_exclusive": "Prime members only",
}

PROMPT = """Write a single X (Twitter) post promoting this Amazon deal.

VERIFIED FACTS (use only these - do not invent anything):
{facts}

RULES:
1. Maximum 180 characters. A link and disclosure get appended after you, so leave room.
2. Do NOT include any URL, link, hashtag, or the text "#ad". Those are added separately.
3. Do NOT invent a price, percentage, code, or stock level that is not in the facts above.
4. Lead with the benefit or the catch - why this specific price is worth acting on.
5. State plainly how to claim the discount.
6. Convey time pressure ONLY from the "live" duration given, never invented.
7. Sound like a person who found a good deal, not an ad. No emoji spam, max one emoji.
8. No ALL CAPS words except a promo code.

Return ONLY the post text. No quotes, no preamble, no explanation."""


def build_facts(deal: Deal) -> str:
    facts = []
    if deal.title:
        facts.append(f"Product: {deal.title}")
    if deal.current_price is not None:
        facts.append(f"Current price: ${deal.current_price:.2f}")
    if deal.reference_price is not None:
        facts.append(f"Was: ${deal.reference_price:.2f}")
    if deal.discount_pct is not None:
        facts.append(f"Discount: {deal.discount_pct:.0f}%")
    if deal.promo_code:
        facts.append(f"Promo code: {deal.promo_code}")
    facts.append(
        "How to claim: "
        + MECHANIC_TEXT.get(deal.mechanic, "price is live on the listing")
    )
    if deal.age_minutes is not None:
        facts.append(f"Deal has been live: {deal.age_minutes} minutes")
    return "\n".join(f"- {f}" for f in facts)


def sanitize(text: str) -> str:
    """Strip anything the model should not have produced.

    Rule 2 tells it not to emit links; this guarantees none survive regardless.
    """
    text = (text or "").strip().strip("\"'`")
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\bwww\.\S+", "", text)
    text = re.sub(r"#ad\b", "", text, flags=re.I)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def validate(body: str, deal: Deal) -> tuple[bool, str]:
    """A generation is usable only if it says something and invents nothing."""
    if not body or len(body) < 20:
        return False, "too short"
    if len(body) > 240:
        return False, "too long"
    if re.search(r"https?://", body):
        return False, "contains url"

    quoted = extract_prices(body)
    if quoted:
        known = [p for p in (deal.current_price, deal.reference_price) if p is not None]
        if not known:
            return False, "quoted a price with nothing verified"
        if not all(any(abs(k - q) < 0.01 for k in known) for q in quoted):
            return False, "quoted an unverified price"

    # A code-shaped token is only allowed if it is the code we captured.
    tokens = re.findall(r"\b[A-Z0-9]{5,15}\b", body)
    codelike = [t for t in tokens if re.search(r"\d", t) and re.search(r"[A-Z]", t)]
    if codelike:
        if not deal.promo_code:
            return False, "invented a promo code"
        if any(t != deal.promo_code for t in codelike):
            return False, "quoted a code we did not capture"

    return True, ""


async def generate(
    deal: Deal,
    tag: str,
    api_key: Optional[str],
    *,
    model: str = "gemini-2.5-flash",
    long_form: bool = False,
    temperature: float = 0.9,
) -> Draft:
    """Return a usable Draft, always. Falls back to the template on any failure."""
    fallback = lambda: copywriter.generate(deal, tag, long_form=long_form)

    if not api_key:
        return fallback()

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(
                ENDPOINT.format(model=model),
                params={"key": api_key},
                json={
                    "contents": [{"parts": [{"text": PROMPT.format(facts=build_facts(deal))}]}],
                    "generationConfig": {
                        "temperature": temperature,
                        "maxOutputTokens": 200,
                        "topP": 0.95,
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()

        raw = data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as exc:
        log.warning("Gemini generation failed (%s), using template", exc)
        return fallback()

    body = sanitize(raw)
    ok, reason = validate(body, deal)
    if not ok:
        log.warning("Rejected Gemini output: %s", reason)
        return fallback()

    text = copywriter.assemble(body, deal, tag, long_form=long_form)
    if not long_form and copywriter.char_count(text) > copywriter.X_LIMIT:
        return fallback()

    return Draft(
        text=text,
        link=deal.affiliate_url,
        asin=deal.asin,
        mechanic=deal.mechanic,
        promo_code=deal.promo_code,
        source="gemini",
    )
