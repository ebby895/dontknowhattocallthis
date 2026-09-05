"""The pipeline: capture -> resolve -> gate on Amazon -> verify -> generate -> post.

Runs as an asyncio loop on a background thread so the Qt UI stays responsive.
Emits callbacks the UI subscribes to; it never touches widgets itself.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from . import ai, copywriter, gates
from .capture import CapturedPost, TimelineCapture
from .config import Config
from .core import (
    Deal,
    build_affiliate_url,
    detect_mechanic,
    extract_prices,
    extract_promo_code,
    host_of,
)
from .copywriter import Draft
from .db import Store
from .poster import publish
from .resolver import Resolver
from .verify import verify_deal

log = logging.getLogger(__name__)


@dataclass
class EngineEvent:
    kind: str          # status|deal|posted|held|error|stats
    message: str = ""
    payload: Optional[dict] = None


class Engine:
    """Owns the capture loop. Thread-safe to start/stop from the UI."""

    def __init__(self, config: Config, store: Store,
                 on_event: Optional[Callable[[EngineEvent], None]] = None):
        self.config = config
        self.store = store
        self.on_event = on_event or (lambda e: None)

        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._stop = threading.Event()
        self._capture: Optional[TimelineCapture] = None
        self._resolver = Resolver()
        self.running = False

    # --- lifecycle -------------------------------------------------------

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="nxg-engine", daemon=True)
        self._thread.start()
        self.running = True

    def stop(self) -> None:
        self._stop.set()
        if self._loop:
            self._loop.call_soon_threadsafe(lambda: None)
        if self._thread:
            self._thread.join(timeout=12)
        self.running = False

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._main())
        except Exception as exc:
            log.exception("Engine crashed")
            self._emit("error", f"Engine stopped: {exc}")
        finally:
            try:
                self._loop.close()
            except Exception:
                pass
            self.running = False

    def _emit(self, kind: str, message: str = "", payload: Optional[dict] = None) -> None:
        try:
            self.on_event(EngineEvent(kind, message, payload))
        except Exception:
            log.exception("Event callback failed")

    # --- main loop -------------------------------------------------------

    async def _main(self) -> None:
        s = self.config.settings

        self._capture = TimelineCapture(
            s.profile_path,
            headless=s.headless,
            timeline_url=s.timeline_url,
            channel=s.browser_channel,
            cdp_endpoint=s.cdp_endpoint,
        )
        self._emit("status", "Launching browser…")
        await self._capture.start()

        if not await self._capture.is_logged_in():
            self._emit(
                "status",
                "Not signed in to X. Log in in the browser window - the profile "
                "remembers it from now on.",
            )
            # Wait for a manual login rather than failing the run outright.
            while not self._stop.is_set() and not await self._capture.is_logged_in():
                await asyncio.sleep(3)

        if s.following_tab_only:
            await self._capture.select_following_tab()

        self._emit("status", "Watching timeline")

        while not self._stop.is_set():
            try:
                await self._cycle()
            except Exception as exc:
                log.exception("Cycle failed")
                self.store.event("error", detail=str(exc))
                self._emit("error", str(exc))
            await asyncio.sleep(self.config.settings.scan_interval_seconds)

        await self._capture.stop()
        self._emit("status", "Stopped")

    async def _cycle(self) -> None:
        await self._capture.refresh()
        posts = await self._capture.poll()
        if not posts:
            return

        self.store.event("scanned", detail=f"{len(posts)} posts")

        for post in posts:
            if self._stop.is_set():
                return
            await self._handle_post(post)

    async def _handle_post(self, post: CapturedPost) -> None:
        detected_at = time.time()

        resolutions = await self._resolver.resolve_many(post.links)
        self.store.event("resolved", detail=f"{len(resolutions)} links")

        # THE GATE: keep only chains landing on Amazon with an extractable ASIN.
        hit = next((r for r in resolutions if r.is_amazon and r.asin), None)
        if hit is None:
            for r in resolutions:
                self.store.event("rejected", host=r.final_host, detail="not amazon")
            return

        if self.store.deal_exists(hit.asin):
            return

        self.store.event("amazon_hit", asin=hit.asin, host=hit.final_host,
                         latency_ms=hit.latency_ms)

        s = self.config.settings
        deal = Deal(
            asin=hit.asin,
            affiliate_url=build_affiliate_url(hit.asin, s.associate_tag) or "",
            source_post_id=post.post_id,
            source_author=post.handle,
            source_text=post.text,
            source_url=hit.source_url,
            landed_url=hit.final_url,
            posted_at=post.timestamp,
            promo_code=extract_promo_code(post.text),
            mechanic=detect_mechanic(post.text),
            prices_in_post=extract_prices(post.text),
            source_images=post.images,
        )

        # Confirm the deal is real before staking the account's name on it.
        try:
            await verify_deal(deal, keepa_key=self.config.keepa_key)
        except Exception as exc:
            log.debug("Verification failed for %s: %s", deal.asin, exc)

        self.store.upsert_deal(deal)
        self.store.event("queued", asin=deal.asin)
        self._emit("deal", f"{deal.asin} via {deal.source_author}",
                   {"asin": deal.asin})

        draft = await self._draft(deal)

        verdict = gates.can_post(deal, draft, s, self.store)
        if not verdict.ok:
            self.store.update_deal(deal.asin, status="ready", hold_reason=verdict.reason)
            self.store.event("held", asin=deal.asin, detail=verdict.reason)
            self._emit("held", f"{deal.asin}: {verdict.reason}", {"asin": deal.asin})
            return

        result = await publish(
            self._capture.page, draft.text,
            mode=s.input_mode, typing_delay_ms=s.typing_delay_ms,
        )

        if result.ok:
            latency_ms = int((time.time() - detected_at) * 1000)
            self.store.record_post(
                deal.asin, draft.text, draft.link,
                copy_source=draft.source,
                deal_age=deal.age_minutes,
                latency_ms=latency_ms,
            )
            self.store.event("posted", asin=deal.asin, latency_ms=latency_ms)
            self._emit("posted", f"Posted {deal.asin} ({latency_ms} ms end to end)",
                       {"asin": deal.asin, "latency_ms": latency_ms})
        else:
            self.store.update_deal(deal.asin, status="ready", hold_reason=result.reason)
            self.store.event("error", asin=deal.asin, detail=result.reason)
            self._emit("error", f"{deal.asin}: {result.reason}", {"asin": deal.asin})

    async def _draft(self, deal: Deal) -> Draft:
        s = self.config.settings
        if s.ai_enabled:
            return await ai.generate(
                deal, s.associate_tag, self.config.gemini_key,
                model=s.gemini_model, long_form=s.long_form_posts,
                temperature=s.ai_temperature,
            )
        return copywriter.generate(deal, s.associate_tag, long_form=s.long_form_posts)

    # --- manual posting from the UI --------------------------------------

    def post_now(self, deal: Deal, text: str,
                 on_done: Optional[Callable[[bool, str], None]] = None) -> None:
        """Publish an operator-approved draft, bypassing the autopilot gates.

        The compliance checks still run - a human clicking post is not a reason
        to publish a non-Amazon link or a draft with no disclosure.
        """
        if not self._loop:
            if on_done:
                on_done(False, "engine not running")
            return

        async def _do():
            s = self.config.settings
            draft = Draft(text=text, link=deal.affiliate_url, asin=deal.asin,
                          mechanic=deal.mechanic, promo_code=deal.promo_code,
                          source="manual")

            for check in (gates.check_link(draft, s), gates.check_disclosure(draft),
                          gates.check_length(draft, s)):
                if not check.ok:
                    if on_done:
                        on_done(False, check.reason)
                    return

            res = await publish(self._capture.page if self._capture else None,
                                text, mode=s.input_mode,
                                typing_delay_ms=s.typing_delay_ms)
            if res.ok:
                self.store.record_post(deal.asin, text, draft.link,
                                       copy_source="manual",
                                       deal_age=deal.age_minutes)
                self.store.event("posted", asin=deal.asin, detail="manual")
            if on_done:
                on_done(res.ok, res.reason)

        asyncio.run_coroutine_threadsafe(_do(), self._loop)
