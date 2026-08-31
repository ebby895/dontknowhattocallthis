"""Tests for the parts that decide what gets published.

Runs without Playwright, PyQt or network access - the modules under test are
pure logic plus SQLite, which is exactly the code path where a silent bug puts
a wrong link on a live feed.

    python -m pytest tests/ -q      (or: python tests/test_engine.py)
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nxtgen import copywriter, gates                       # noqa: E402
from nxtgen.config import Settings                          # noqa: E402
from nxtgen.core import (                                   # noqa: E402
    Deal, build_affiliate_url, category_rate, detect_mechanic, extract_asin,
    extract_prices, extract_promo_code, format_age, is_amazon_url,
    is_known_redirector, strip_foreign_tag,
)
from nxtgen.db import Store                                 # noqa: E402

TAG = "nxtgenhotdeal-20"


def _iso(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def _deal(**over) -> Deal:
    base = dict(
        asin="B0CJ1234XY",
        affiliate_url=build_affiliate_url("B0CJ1234XY", TAG),
        source_author="@dealposter",
        source_text="Use code SAVE25 at checkout",
        posted_at=_iso(10),
        promo_code="SAVE25",
        mechanic="checkout_code",
        prices_in_post=[579.10, 211.05],
        title="Milwaukee M18 FUEL Blower with Battery",
        current_price=211.05,
        reference_price=579.10,
        discount_pct=64.0,
        available=True,
        category="tools",
    )
    base.update(over)
    return Deal(**base)


class TestAmazonGate(unittest.TestCase):
    """Only chains landing on Amazon may become deals."""

    def test_amazon_hosts_pass(self):
        for url in (
            "https://www.amazon.com/dp/B0CJ1234XY",
            "https://amazon.com/gp/product/B08N5WRWNW",
            "https://amzn.to/3xYzAbc",
            "https://a.co/d/abc123",
            "https://smile.amazon.com/dp/B0CJ1234XY",
        ):
            self.assertTrue(is_amazon_url(url), url)

    def test_other_retailers_rejected(self):
        for url in (
            "https://www.walmart.com/ip/12345",
            "https://www.target.com/p/-/A-123",
            "https://www.bestbuy.com/site/x/123.p",
            "https://www.ebay.com/itm/123",
        ):
            self.assertFalse(is_amazon_url(url), url)

    def test_redirector_itself_is_not_amazon(self):
        self.assertFalse(is_amazon_url("https://hiddenclearances.com/r/up-to-55-off"))
        self.assertTrue(is_known_redirector("https://hiddenclearances.com/r/x"))

    def test_lookalike_domains_rejected(self):
        """The suffix check is dot-anchored, so these must not slip through."""
        for url in (
            "https://amazon.com.evil.co/dp/B0CJ1234XY",
            "https://notamazon.com/dp/B0CJ1234XY",
            "https://amazon.com.phish.net/dp/X",
            "https://fakeamzn.to/abc",
        ):
            self.assertFalse(is_amazon_url(url), url)


class TestAsinExtraction(unittest.TestCase):
    def test_url_shapes(self):
        cases = {
            "https://www.amazon.com/dp/B0CJ1234XY": "B0CJ1234XY",
            "https://www.amazon.com/dp/B0CJ1234XY?th=1&psc=1": "B0CJ1234XY",
            "https://www.amazon.com/gp/product/B08N5WRWNW": "B08N5WRWNW",
            "https://www.amazon.com/Milwaukee-Blower/dp/B07XYZ1234/ref=sr_1_1": "B07XYZ1234",
            "https://www.amazon.com/gp/aw/d/B01ABCDEFG": "B01ABCDEFG",
            "https://www.amazon.com/gp/aw/d?asin=B01ABCDEFG": "B01ABCDEFG",
        }
        for url, expected in cases.items():
            self.assertEqual(extract_asin(url), expected, url)

    def test_no_asin(self):
        self.assertIsNone(extract_asin("https://www.amazon.com/s?k=leaf+blower"))


class TestLinkConstruction(unittest.TestCase):
    def test_canonical_shape(self):
        self.assertEqual(
            build_affiliate_url("B0CJ1234XY", TAG),
            "https://www.amazon.com/dp/B0CJ1234XY?tag=nxtgenhotdeal-20",
        )

    def test_published_link_is_amazon_and_tagged(self):
        url = build_affiliate_url("B0CJ1234XY", TAG)
        self.assertTrue(is_amazon_url(url))
        self.assertIn(TAG, url)
        self.assertFalse(is_known_redirector(url))

    def test_foreign_attribution_stripped(self):
        dirty = ("https://www.amazon.com/dp/B0CJ1234XY"
                 "?tag=someoneelse-20&linkCode=ll1&ref_=abc&creative=9325")
        clean = strip_foreign_tag(dirty)
        for token in ("someoneelse-20", "linkCode", "creative"):
            self.assertNotIn(token, clean)


class TestParsing(unittest.TestCase):
    def test_promo_codes(self):
        self.assertEqual(extract_promo_code("Use code: SAVE25 at checkout"), "SAVE25")
        self.assertEqual(extract_promo_code("promo code 50OFFNOW today"), "50OFFNOW")
        self.assertIsNone(extract_promo_code("Price drop, no code needed"))

    def test_mechanics(self):
        self.assertEqual(detect_mechanic("Clip the 40% coupon"), "clip_coupon")
        self.assertEqual(detect_mechanic("Apply code SAVE25 at checkout"), "checkout_code")
        self.assertEqual(detect_mechanic("Lightning deal live"), "lightning")
        self.assertEqual(detect_mechanic("Subscribe & Save stacks"), "subscribe_save")

    def test_prices(self):
        self.assertEqual(extract_prices("Was $579.10 now $211.05"), [579.10, 211.05])
        self.assertEqual(extract_prices("Down to $1,299.99"), [1299.99])

    def test_age_formatting(self):
        self.assertEqual(format_age(12), "12m ago")
        self.assertEqual(format_age(150), "2h ago")
        self.assertEqual(format_age(3000), "2d ago")


class TestCopy(unittest.TestCase):
    def test_draft_is_publishable(self):
        draft = copywriter.generate(_deal(), TAG)
        self.assertIn(TAG, draft.text)
        self.assertIn("#ad", draft.text)
        self.assertIn("SAVE25", draft.text)
        self.assertIn("211.05", draft.text)
        self.assertLessEqual(draft.char_count, 280)

    def test_exactly_one_amazon_link(self):
        import re
        draft = copywriter.generate(_deal(), TAG)
        urls = re.findall(r"https?://\S+", draft.text)
        self.assertEqual(len(urls), 1)
        self.assertTrue(is_amazon_url(urls[0]))

    def test_never_leaks_the_redirector(self):
        deal = _deal(source_text="via hiddenclearances.com/r/abc code SAVE25")
        draft = copywriter.generate(deal, TAG)
        self.assertNotIn("hiddenclearances", draft.text)

    def test_unverified_deal_claims_no_numbers(self):
        deal = _deal(current_price=None, reference_price=None,
                     discount_pct=None, prices_in_post=[])
        line = copywriter.savings_line(deal)
        self.assertNotRegex(line, r"\$\d")
        draft = copywriter.generate(deal, TAG)
        self.assertIn("#ad", draft.text)
        self.assertIn(TAG, draft.text)

    def test_urgency_uses_real_age(self):
        self.assertIn("8 minutes", copywriter.urgency_line(8))
        self.assertIn("2 hours", copywriter.urgency_line(120))

    def test_long_titles_still_fit(self):
        deal = _deal(title="X" * 400)
        draft = copywriter.generate(deal, TAG)
        self.assertLessEqual(draft.char_count, 280)
        self.assertIn("#ad", draft.text)
        self.assertIn(TAG, draft.text)

    def test_variants_differ_but_all_comply(self):
        variants = copywriter.variants(_deal(), TAG, 3)
        self.assertGreater(len({v.text for v in variants}), 1)
        for v in variants:
            self.assertIn("#ad", v.text)
            self.assertIn(TAG, v.text)

    def test_url_counted_as_23_chars(self):
        text = "hi https://www.amazon.com/dp/B0CJ1234XY?tag=nxtgenhotdeal-20"
        self.assertEqual(copywriter.char_count(text), len("hi ") + 23)


class TestGates(unittest.TestCase):
    """The gates fail closed - this is the last check before a live post."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "test.db")
        self.settings = Settings(associate_tag=TAG, autopost_armed=True,
                                 min_gap_minutes=0)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def _draft_for(self, deal: Deal):
        return copywriter.generate(deal, TAG)

    def test_good_deal_passes(self):
        deal = _deal()
        self.assertTrue(gates.can_post(deal, self._draft_for(deal),
                                       self.settings, self.store).ok)

    def test_disarmed_blocks_everything(self):
        self.settings.autopost_armed = False
        deal = _deal()
        result = gates.can_post(deal, self._draft_for(deal), self.settings, self.store)
        self.assertFalse(result.ok)
        self.assertIn("disarmed", result.reason)

    def test_non_amazon_link_blocked(self):
        deal = _deal()
        draft = self._draft_for(deal)
        draft.text = draft.text.replace(
            "https://www.amazon.com/dp/B0CJ1234XY?tag=nxtgenhotdeal-20",
            "https://hiddenclearances.com/r/abc",
        )
        result = gates.check_link(draft, self.settings)
        self.assertFalse(result.ok)
        self.assertIn("not Amazon", result.reason)

    def test_missing_disclosure_blocked(self):
        deal = _deal()
        draft = self._draft_for(deal)
        draft.text = draft.text.replace("#ad", "")
        self.assertFalse(gates.check_disclosure(draft).ok)

    def test_missing_tag_blocked(self):
        deal = _deal()
        draft = self._draft_for(deal)
        draft.text = draft.text.replace(TAG, "someoneelse-20")
        self.assertFalse(gates.check_link(draft, self.settings).ok)

    def test_two_links_blocked(self):
        deal = _deal()
        draft = self._draft_for(deal)
        draft.text += "\nhttps://www.amazon.com/dp/B0OTHER123?tag=nxtgenhotdeal-20"
        result = gates.check_link(draft, self.settings)
        self.assertFalse(result.ok)
        self.assertIn("exactly one", result.reason)

    def test_stale_deal_blocked(self):
        deal = _deal(posted_at=_iso(600))
        result = gates.check_freshness(deal, self.settings)
        self.assertFalse(result.ok)
        self.assertIn("stale", result.reason)

    def test_unverified_and_uncoded_blocked(self):
        deal = _deal(discount_pct=None, promo_code=None)
        result = gates.check_substance(deal, self.settings)
        self.assertFalse(result.ok)

    def test_shallow_discount_with_code_still_allowed(self):
        deal = _deal(discount_pct=5.0, promo_code="SAVE25")
        self.assertTrue(gates.check_substance(deal, self.settings).ok)

    def test_out_of_stock_blocked(self):
        deal = _deal(available=False)
        self.assertFalse(gates.check_substance(deal, self.settings).ok)

    def test_duplicate_asin_blocked(self):
        deal = _deal()
        self.store.upsert_deal(deal)
        self.store.record_post(deal.asin, "text", deal.affiliate_url)
        result = gates.check_rate(deal, self.settings, self.store)
        self.assertFalse(result.ok)
        self.assertIn("already posted", result.reason)

    def test_hourly_cap_blocked(self):
        self.settings.max_posts_per_hour = 2
        for i in range(2):
            asin = f"B0TEST{i:04d}"
            self.store.upsert_deal(_deal(asin=asin,
                                         affiliate_url=build_affiliate_url(asin, TAG)))
            self.store.record_post(asin, "t", "u")
        result = gates.check_rate(_deal(), self.settings, self.store)
        self.assertFalse(result.ok)
        self.assertIn("hourly cap", result.reason)

    def test_min_gap_enforced(self):
        self.settings.min_gap_minutes = 30
        self.store.upsert_deal(_deal(asin="B0OTHER999",
                                     affiliate_url=build_affiliate_url("B0OTHER999", TAG)))
        self.store.record_post("B0OTHER999", "t", "u")
        result = gates.check_rate(_deal(), self.settings, self.store)
        self.assertFalse(result.ok)
        self.assertIn("rate limit", result.reason)


class TestStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "test.db")

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_deal_dedupe(self):
        self.assertTrue(self.store.upsert_deal(_deal()))
        self.assertFalse(self.store.upsert_deal(_deal()))

    def test_queue_excludes_posted(self):
        self.store.upsert_deal(_deal())
        self.assertEqual(len(self.store.queue()), 1)
        self.store.record_post("B0CJ1234XY", "t", "u")
        self.assertEqual(len(self.store.queue()), 0)

    def test_revenue_stats(self):
        today = datetime.now(timezone.utc).date().isoformat()
        self.store.import_earnings([{
            "date": today, "asin": "B0CJ1234XY", "clicks": 200,
            "ordered_items": 10, "revenue": 2000.0, "commission": 60.0,
        }])
        stats = self.store.revenue_stats(30)
        self.assertEqual(stats["clicks"], 200)
        self.assertEqual(stats["orders"], 10)
        self.assertEqual(stats["commission"], 60.0)
        self.assertEqual(stats["epc"], 30.0)          # $60 per 200 clicks, per 100
        self.assertEqual(stats["conversion_pct"], 5.0)

    def test_earnings_import_is_idempotent(self):
        today = datetime.now(timezone.utc).date().isoformat()
        row = {"date": today, "asin": "B0CJ1234XY", "clicks": 10, "commission": 5.0}
        self.store.import_earnings([row])
        self.store.import_earnings([row])
        self.assertEqual(self.store.revenue_stats(30)["clicks"], 10)

    def test_pipeline_funnel(self):
        self.store.event("scanned")
        self.store.event("resolved")
        self.store.event("amazon_hit", asin="B0CJ1234XY")
        self.store.event("rejected", host="walmart.com")
        self.store.event("held", detail="stale")
        stats = self.store.pipeline_stats(24)
        self.assertEqual(stats["amazon_hits"], 1)
        self.assertEqual(stats["rejected"], 1)
        self.assertEqual(("walmart.com", 1), stats["rejected_hosts"][0])
        self.assertEqual(("stale", 1), stats["hold_reasons"][0])

    def test_summary_runs_on_empty_db(self):
        s = self.store.summary()
        self.assertEqual(s["posts_24h"], 0)
        self.assertEqual(s["commission_30d"], 0.0)


class TestCommissionRates(unittest.TestCase):
    def test_known_and_default(self):
        self.assertEqual(category_rate("luxury_beauty"), 10.0)
        self.assertEqual(category_rate("electronics"), 1.0)
        self.assertEqual(category_rate("unknown-thing"), 3.0)

    def test_score_prefers_fresh(self):
        fresh = _deal(posted_at=_iso(5))
        stale = _deal(posted_at=_iso(600))
        self.assertGreater(fresh.score(), stale.score())

    def test_score_prefers_paying_category(self):
        rich = _deal(category="luxury_beauty")
        poor = _deal(category="electronics")
        self.assertGreater(rich.score(), poor.score())

    def test_estimated_commission(self):
        deal = _deal(current_price=100.0, category="tools")   # 3%
        self.assertEqual(deal.estimated_commission, 3.0)


class TestAiValidation(unittest.TestCase):
    """The model writes the body; it must not invent facts or links."""

    def setUp(self):
        from nxtgen import ai
        self.ai = ai

    def test_urls_stripped(self):
        out = self.ai.sanitize("Great deal https://evil.com/x right now")
        self.assertNotIn("http", out)

    def test_disclosure_stripped_then_reattached(self):
        self.assertNotIn("#ad", self.ai.sanitize("Deal here #ad"))
        text = copywriter.assemble("Deal here", _deal(), TAG)
        self.assertIn("#ad", text)
        self.assertIn(TAG, text)

    def test_rejects_unverified_price(self):
        ok, reason = self.ai.validate(
            "Grab it for $19.99 before it goes, seriously good price", _deal()
        )
        self.assertFalse(ok)
        self.assertIn("unverified price", reason)

    def test_accepts_verified_price(self):
        ok, _ = self.ai.validate(
            "Down to $211.05 from list, the code does the work at checkout", _deal()
        )
        self.assertTrue(ok)

    def test_rejects_invented_code(self):
        deal = _deal(promo_code=None)
        ok, reason = self.ai.validate(
            "Use FAKE99CODE at checkout for this one, good while it lasts", deal
        )
        self.assertFalse(ok)
        self.assertIn("promo code", reason)

    def test_rejects_embedded_url(self):
        ok, reason = self.ai.validate(
            "Check https://amazon.com/dp/X for this deal right now today", _deal()
        )
        self.assertFalse(ok)
        self.assertIn("url", reason)


class TestKeyFile(unittest.TestCase):
    """Reading a key out of a file the user saved, without them typing it."""

    def setUp(self):
        from nxtgen import keyfile
        self.kf = keyfile
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        # Shape-valid but fabricated, so nothing real appears in the repo.
        self.gemini = "AQ.Ab8RN6" + "X" * 30
        self.keepa = "a1b2c3d4" * 6

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, name: str, content: str) -> Path:
        p = self.dir / name
        p.write_text(content, encoding="utf-8")
        return p

    def test_bare_key_on_its_own_line(self):
        p = self._write("key.txt", self.gemini + "\n")
        r = self.kf.read_key_file(p, "gemini")
        self.assertTrue(r.ok, r.reason)
        self.assertEqual(r.key, self.gemini)

    def test_env_style_assignment(self):
        p = self._write("key.txt", f"GEMINI_API_KEY={self.gemini}\n")
        self.assertEqual(self.kf.read_key_file(p, "gemini").key, self.gemini)

    def test_export_and_quotes(self):
        p = self._write("key.env", f'export GEMINI_API_KEY="{self.gemini}"\n')
        self.assertEqual(self.kf.read_key_file(p, "gemini").key, self.gemini)

    def test_json_style_line(self):
        p = self._write("key.txt", f'  "api_key": "{self.gemini}",\n')
        self.assertEqual(self.kf.read_key_file(p, "gemini").key, self.gemini)

    def test_label_with_spaces(self):
        p = self._write("key.txt", f"API Key: {self.gemini}\n")
        self.assertEqual(self.kf.read_key_file(p, "gemini").key, self.gemini)

    def test_comments_and_blank_lines_skipped(self):
        p = self._write("key.txt", f"# my gemini key\n\n{self.gemini}\n")
        self.assertEqual(self.kf.read_key_file(p, "gemini").key, self.gemini)

    def test_prose_is_rejected(self):
        """A file of notes must not be stored as a key that fails every call."""
        p = self._write("notes.txt", "remember to get the key from google later")
        r = self.kf.read_key_file(p, "gemini")
        self.assertFalse(r.ok)
        self.assertIn("No key found", r.reason)

    def test_wrong_shape_rejected(self):
        p = self._write("key.txt", "sk-proj-thisisanopenaikeynotgemini123456")
        r = self.kf.read_key_file(p, "gemini")
        self.assertFalse(r.ok)
        self.assertIn("AQ.", r.reason)
        self.assertIsNone(r.key)

    def test_aiza_form_accepted(self):
        aiza = "AIza" + "B" * 35
        p = self._write("key.txt", aiza)
        self.assertTrue(self.kf.read_key_file(p, "gemini").ok)

    def test_keepa_shape(self):
        p = self._write("keepa.txt", self.keepa)
        self.assertTrue(self.kf.read_key_file(p, "keepa").ok)
        p2 = self._write("bad.txt", self.gemini)
        self.assertFalse(self.kf.read_key_file(p2, "keepa").ok)

    def test_empty_and_missing_files(self):
        empty = self._write("empty.txt", "")
        self.assertIn("empty", self.kf.read_key_file(empty, "gemini").reason)
        missing = self.dir / "nope.txt"
        self.assertFalse(self.kf.read_key_file(missing, "gemini").ok)

    def test_oversized_file_rejected(self):
        p = self._write("huge.txt", "x" * (65 * 1024))
        r = self.kf.read_key_file(p, "gemini")
        self.assertFalse(r.ok)
        self.assertIn("too large", r.reason)

    def test_masked_shows_ends_only(self):
        p = self._write("key.txt", self.gemini)
        masked = self.kf.read_key_file(p, "gemini").masked
        self.assertTrue(masked.startswith("AQ.Ab8"))
        self.assertTrue(masked.endswith(self.gemini[-4:]))
        self.assertNotIn(self.gemini, masked)

    def test_shred_removes_the_file(self):
        p = self._write("key.txt", self.gemini)
        ok, reason = self.kf.shred(p)
        self.assertTrue(ok, reason)
        self.assertFalse(p.exists())

    def test_shred_missing_file_is_not_an_error_crash(self):
        ok, reason = self.kf.shred(self.dir / "gone.txt")
        self.assertFalse(ok)
        self.assertIn("already gone", reason)


if __name__ == "__main__":
    unittest.main(verbosity=2)
