"""Redirect chain resolution.

Deal posts point at a redirector; the product is wherever that chain lands. We
follow it to LEARN the destination and then discard it - a published link is
always a plain tagged Amazon URL, because the Associates policy bars placements
that obscure that you are linking to Amazon.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Optional

import httpx

from .core import extract_asin, is_amazon_url, host_of

MAX_HOPS = 8
TIMEOUT = 8.0
CONCURRENCY = 6

# Some redirectors bounce with an HTML meta-refresh or a JS location assignment,
# which httpx's follower will not chase.
META_REFRESH = re.compile(
    r"""<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"';]+)""",
    re.I,
)
JS_LOCATION = re.compile(r"""(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']""", re.I)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


@dataclass
class Resolution:
    source_url: str
    final_url: str
    is_amazon: bool
    asin: Optional[str]
    status: int = 0
    hops: int = 0
    error: Optional[str] = None
    latency_ms: int = 0

    @property
    def final_host(self) -> str:
        return host_of(self.final_url)


class Resolver:
    """Async redirect resolver with a session cache.

    Deal posters reuse the same short links across posts, so the cache saves a
    meaningful amount of latency on a busy timeline.
    """

    def __init__(self, concurrency: int = CONCURRENCY):
        self._cache: dict[str, Resolution] = {}
        self._sem = asyncio.Semaphore(concurrency)

    async def resolve(self, url: str) -> Resolution:
        if url in self._cache:
            return self._cache[url]
        async with self._sem:
            res = await self._resolve_uncached(url)
        self._cache[url] = res
        return res

    async def resolve_many(self, urls: list[str]) -> list[Resolution]:
        return list(await asyncio.gather(*(self.resolve(u) for u in urls)))

    async def _resolve_uncached(self, url: str) -> Resolution:
        loop = asyncio.get_event_loop()
        started = loop.time()
        current = url
        hops = 0
        status = 0
        error = None

        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=TIMEOUT,
                headers={"User-Agent": USER_AGENT},
            ) as client:
                while hops < MAX_HOPS:
                    resp = await client.get(current)
                    status = resp.status_code
                    current = str(resp.url)
                    hops += 1

                    # Landed on Amazon - done, no need to read the body.
                    if is_amazon_url(current):
                        break

                    ctype = resp.headers.get("content-type", "")
                    if "text/html" not in ctype.lower():
                        break

                    body = resp.text[:200_000]  # bounded; bounces sit near the top
                    m = META_REFRESH.search(body) or JS_LOCATION.search(body)
                    if not m:
                        break

                    nxt = m.group(1).strip()
                    try:
                        nxt = str(httpx.URL(current).join(nxt))
                    except Exception:
                        break
                    if nxt == current:
                        break
                    current = nxt
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"

        latency = int((loop.time() - started) * 1000)
        return Resolution(
            source_url=url,
            final_url=current,
            is_amazon=is_amazon_url(current),
            asin=extract_asin(current),
            status=status,
            hops=hops,
            error=error,
            latency_ms=latency,
        )

    def clear_cache(self) -> None:
        self._cache.clear()
