"""SQLite store and the analytics behind the stats view.

Four families of question, one schema:

* revenue      - clicks, orders, commission, EPC, conversion per post
* pipeline     - scanned, resolved, Amazon hits vs rejects, gate holds, latency
* performance  - which categories, discounts, mechanics and sources pay
* timing       - engagement by hour, post age at publish, how fast deals die
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

from .core import Deal, category_rate

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS deals (
    asin              TEXT PRIMARY KEY,
    affiliate_url     TEXT NOT NULL,
    source_post_id    TEXT,
    source_author     TEXT,
    source_text       TEXT,
    source_url        TEXT,
    landed_url        TEXT,
    posted_at         TEXT,
    promo_code        TEXT,
    mechanic          TEXT,
    prices_in_post    TEXT,
    source_images     TEXT,
    title             TEXT,
    current_price     REAL,
    reference_price   REAL,
    discount_pct      REAL,
    available         INTEGER,
    category          TEXT,
    captured_at       TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'new',
    hold_reason       TEXT,
    score             REAL
);
CREATE INDEX IF NOT EXISTS idx_deals_status   ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_captured ON deals(captured_at);

-- One row per published post. Engagement and revenue are joined back on asin.
CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asin            TEXT NOT NULL,
    account         TEXT NOT NULL DEFAULT 'default',
    text            TEXT NOT NULL,
    link            TEXT NOT NULL,
    copy_source     TEXT,             -- 'gemini' | 'template'
    posted_at       TEXT NOT NULL,
    deal_age_at_post INTEGER,         -- minutes; how fresh the deal was
    detect_to_post_ms INTEGER,        -- pipeline latency
    x_post_id       TEXT,
    impressions     INTEGER DEFAULT 0,
    likes           INTEGER DEFAULT 0,
    reposts         INTEGER DEFAULT 0,
    replies         INTEGER DEFAULT 0,
    FOREIGN KEY(asin) REFERENCES deals(asin)
);
CREATE INDEX IF NOT EXISTS idx_posts_posted ON posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_posts_asin   ON posts(asin);

-- Associates report rows, imported from the CSV export. Amazon does not expose
-- these over an API below the Creators API threshold.
CREATE TABLE IF NOT EXISTS earnings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    date          TEXT NOT NULL,
    asin          TEXT,
    product_title TEXT,
    category      TEXT,
    clicks        INTEGER DEFAULT 0,
    ordered_items INTEGER DEFAULT 0,
    shipped_items INTEGER DEFAULT 0,
    revenue       REAL DEFAULT 0,
    commission    REAL DEFAULT 0,
    imported_at   TEXT NOT NULL,
    UNIQUE(date, asin)
);
CREATE INDEX IF NOT EXISTS idx_earnings_date ON earnings(date);
CREATE INDEX IF NOT EXISTS idx_earnings_asin ON earnings(asin);

-- Every pipeline decision, so the funnel is measurable rather than guessed at.
CREATE TABLE IF NOT EXISTS pipeline_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    kind       TEXT NOT NULL,   -- scanned|resolved|amazon_hit|rejected|queued|held|posted|error
    detail     TEXT,
    asin       TEXT,
    host       TEXT,
    latency_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_at   ON pipeline_events(at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON pipeline_events(kind);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    """Thread-safe-enough SQLite wrapper. One connection, serialised writes."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self.conn.commit()
        self.set_meta("schema_version", str(SCHEMA_VERSION))

    # --- plumbing --------------------------------------------------------

    @contextmanager
    def _tx(self):
        try:
            yield self.conn
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def set_meta(self, key: str, value: str) -> None:
        with self._tx() as c:
            c.execute(
                "INSERT INTO meta(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    def get_meta(self, key: str, default: Optional[str] = None) -> Optional[str]:
        r = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return r["value"] if r else default

    # --- deals -----------------------------------------------------------

    def upsert_deal(self, deal: Deal) -> bool:
        """Insert a deal. Returns False if the ASIN was already known."""
        exists = self.conn.execute(
            "SELECT 1 FROM deals WHERE asin=?", (deal.asin,)
        ).fetchone()
        if exists:
            return False

        with self._tx() as c:
            c.execute(
                """INSERT INTO deals (
                     asin, affiliate_url, source_post_id, source_author, source_text,
                     source_url, landed_url, posted_at, promo_code, mechanic,
                     prices_in_post, source_images, title, current_price,
                     reference_price, discount_pct, available, category,
                     captured_at, status, hold_reason, score
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    deal.asin, deal.affiliate_url, deal.source_post_id,
                    deal.source_author, deal.source_text, deal.source_url,
                    deal.landed_url, deal.posted_at, deal.promo_code, deal.mechanic,
                    json.dumps(deal.prices_in_post), json.dumps(deal.source_images),
                    deal.title, deal.current_price, deal.reference_price,
                    deal.discount_pct,
                    None if deal.available is None else int(deal.available),
                    deal.category, deal.captured_at, deal.status, deal.hold_reason,
                    deal.score(),
                ),
            )
        return True

    def update_deal(self, asin: str, **fields: Any) -> None:
        if not fields:
            return
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._tx() as c:
            c.execute(f"UPDATE deals SET {cols} WHERE asin=?", (*fields.values(), asin))

    def deal_exists(self, asin: str) -> bool:
        return self.conn.execute(
            "SELECT 1 FROM deals WHERE asin=?", (asin,)
        ).fetchone() is not None

    def queue(self, limit: int = 200) -> list[sqlite3.Row]:
        return self.conn.execute(
            """SELECT * FROM deals
               WHERE status NOT IN ('posted','dismissed')
               ORDER BY score DESC, captured_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()

    # --- posts -----------------------------------------------------------

    def record_post(
        self, asin: str, text: str, link: str, *, account: str = "default",
        copy_source: str = "template", deal_age: Optional[int] = None,
        latency_ms: Optional[int] = None, x_post_id: Optional[str] = None,
    ) -> int:
        with self._tx() as c:
            cur = c.execute(
                """INSERT INTO posts (asin, account, text, link, copy_source,
                                      posted_at, deal_age_at_post, detect_to_post_ms,
                                      x_post_id)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (asin, account, text, link, copy_source, _now(), deal_age,
                 latency_ms, x_post_id),
            )
            c.execute("UPDATE deals SET status='posted' WHERE asin=?", (asin,))
            return int(cur.lastrowid)

    def posts_since(self, seconds: int) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
        r = self.conn.execute(
            "SELECT COUNT(*) n FROM posts WHERE posted_at > ?", (cutoff,)
        ).fetchone()
        return int(r["n"])

    def last_post_at(self) -> Optional[datetime]:
        r = self.conn.execute("SELECT MAX(posted_at) m FROM posts").fetchone()
        if not r or not r["m"]:
            return None
        try:
            return datetime.fromisoformat(r["m"])
        except ValueError:
            return None

    def already_posted(self, asin: str) -> bool:
        return self.conn.execute(
            "SELECT 1 FROM posts WHERE asin=?", (asin,)
        ).fetchone() is not None

    def update_engagement(self, post_id: int, **metrics: int) -> None:
        allowed = {"impressions", "likes", "reposts", "replies", "x_post_id"}
        fields = {k: v for k, v in metrics.items() if k in allowed}
        if not fields:
            return
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._tx() as c:
            c.execute(f"UPDATE posts SET {cols} WHERE id=?", (*fields.values(), post_id))

    # --- pipeline telemetry ----------------------------------------------

    def event(self, kind: str, *, detail: str = "", asin: Optional[str] = None,
              host: Optional[str] = None, latency_ms: Optional[int] = None) -> None:
        with self._tx() as c:
            c.execute(
                "INSERT INTO pipeline_events (at, kind, detail, asin, host, latency_ms) "
                "VALUES (?,?,?,?,?,?)",
                (_now(), kind, detail, asin, host, latency_ms),
            )

    # --- earnings import --------------------------------------------------

    def import_earnings(self, rows: Iterable[dict]) -> int:
        """Load rows from an Associates report export. Idempotent per date+ASIN."""
        n = 0
        with self._tx() as c:
            for r in rows:
                try:
                    c.execute(
                        """INSERT INTO earnings
                             (date, asin, product_title, category, clicks,
                              ordered_items, shipped_items, revenue, commission,
                              imported_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?)
                           ON CONFLICT(date, asin) DO UPDATE SET
                             clicks=excluded.clicks,
                             ordered_items=excluded.ordered_items,
                             shipped_items=excluded.shipped_items,
                             revenue=excluded.revenue,
                             commission=excluded.commission,
                             imported_at=excluded.imported_at""",
                        (
                            r.get("date"), r.get("asin"), r.get("product_title"),
                            r.get("category"), int(r.get("clicks") or 0),
                            int(r.get("ordered_items") or 0),
                            int(r.get("shipped_items") or 0),
                            float(r.get("revenue") or 0),
                            float(r.get("commission") or 0), _now(),
                        ),
                    )
                    n += 1
                except Exception:
                    continue
        return n

    # =====================================================================
    # Analytics
    # =====================================================================

    def revenue_stats(self, days: int = 30) -> dict:
        """Clicks, orders, commission, EPC, conversion. What is making money."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
        r = self.conn.execute(
            """SELECT COALESCE(SUM(clicks),0)        clicks,
                      COALESCE(SUM(ordered_items),0) orders,
                      COALESCE(SUM(shipped_items),0) shipped,
                      COALESCE(SUM(revenue),0)       revenue,
                      COALESCE(SUM(commission),0)    commission
               FROM earnings WHERE date >= ?""",
            (cutoff,),
        ).fetchone()

        clicks = int(r["clicks"])
        orders = int(r["orders"])
        commission = float(r["commission"])

        return {
            "days": days,
            "clicks": clicks,
            "orders": orders,
            "shipped": int(r["shipped"]),
            "revenue": round(float(r["revenue"]), 2),
            "commission": round(commission, 2),
            # Earnings per hundred clicks - the standard affiliate yardstick.
            "epc": round((commission / clicks) * 100, 2) if clicks else 0.0,
            "conversion_pct": round((orders / clicks) * 100, 2) if clicks else 0.0,
            "posts": self.posts_since(days * 86400),
            "commission_per_post": (
                round(commission / self.posts_since(days * 86400), 2)
                if self.posts_since(days * 86400) else 0.0
            ),
        }

    def revenue_by_day(self, days: int = 30) -> list[dict]:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
        rows = self.conn.execute(
            """SELECT date,
                      SUM(clicks) clicks,
                      SUM(ordered_items) orders,
                      SUM(commission) commission
               FROM earnings WHERE date >= ?
               GROUP BY date ORDER BY date""",
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]

    def pipeline_stats(self, hours: int = 24) -> dict:
        """Funnel health: is the engine actually finding and shipping deals."""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        rows = self.conn.execute(
            "SELECT kind, COUNT(*) n FROM pipeline_events WHERE at > ? GROUP BY kind",
            (cutoff,),
        ).fetchall()
        counts = {r["kind"]: int(r["n"]) for r in rows}

        scanned = counts.get("scanned", 0)
        resolved = counts.get("resolved", 0)
        hits = counts.get("amazon_hit", 0)

        lat = self.conn.execute(
            """SELECT AVG(detect_to_post_ms) avg_ms, MIN(detect_to_post_ms) min_ms,
                      MAX(detect_to_post_ms) max_ms
               FROM posts WHERE posted_at > ? AND detect_to_post_ms IS NOT NULL""",
            (cutoff,),
        ).fetchone()

        holds = self.conn.execute(
            """SELECT detail, COUNT(*) n FROM pipeline_events
               WHERE kind='held' AND at > ? GROUP BY detail ORDER BY n DESC LIMIT 10""",
            (cutoff,),
        ).fetchall()

        rejected_hosts = self.conn.execute(
            """SELECT host, COUNT(*) n FROM pipeline_events
               WHERE kind='rejected' AND at > ? AND host IS NOT NULL
               GROUP BY host ORDER BY n DESC LIMIT 10""",
            (cutoff,),
        ).fetchall()

        return {
            "hours": hours,
            "scanned": scanned,
            "resolved": resolved,
            "amazon_hits": hits,
            "rejected": counts.get("rejected", 0),
            "queued": counts.get("queued", 0),
            "held": counts.get("held", 0),
            "posted": counts.get("posted", 0),
            "errors": counts.get("error", 0),
            "hit_rate_pct": round((hits / resolved) * 100, 1) if resolved else 0.0,
            "post_rate_pct": round((counts.get("posted", 0) / hits) * 100, 1) if hits else 0.0,
            "latency_avg_ms": int(lat["avg_ms"]) if lat and lat["avg_ms"] else None,
            "latency_min_ms": int(lat["min_ms"]) if lat and lat["min_ms"] else None,
            "latency_max_ms": int(lat["max_ms"]) if lat and lat["max_ms"] else None,
            "hold_reasons": [(r["detail"], int(r["n"])) for r in holds],
            "rejected_hosts": [(r["host"], int(r["n"])) for r in rejected_hosts],
        }

    def performance_stats(self, days: int = 30) -> dict:
        """What to chase: category, discount band, mechanic, source account."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        by_category = self.conn.execute(
            """SELECT d.category,
                      COUNT(DISTINCT p.id) posts,
                      COALESCE(SUM(e.clicks),0) clicks,
                      COALESCE(SUM(e.commission),0) commission
               FROM deals d
               JOIN posts p ON p.asin = d.asin
               LEFT JOIN earnings e ON e.asin = d.asin
               WHERE p.posted_at > ?
               GROUP BY d.category ORDER BY commission DESC""",
            (cutoff,),
        ).fetchall()

        by_mechanic = self.conn.execute(
            """SELECT d.mechanic,
                      COUNT(DISTINCT p.id) posts,
                      COALESCE(SUM(e.clicks),0) clicks,
                      COALESCE(SUM(e.commission),0) commission,
                      AVG(p.likes + p.reposts) avg_engagement
               FROM deals d
               JOIN posts p ON p.asin = d.asin
               LEFT JOIN earnings e ON e.asin = d.asin
               WHERE p.posted_at > ?
               GROUP BY d.mechanic ORDER BY commission DESC""",
            (cutoff,),
        ).fetchall()

        by_source = self.conn.execute(
            """SELECT d.source_author,
                      COUNT(DISTINCT d.asin) deals,
                      COUNT(DISTINCT p.id) posted,
                      COALESCE(SUM(e.commission),0) commission
               FROM deals d
               LEFT JOIN posts p ON p.asin = d.asin
               LEFT JOIN earnings e ON e.asin = d.asin
               WHERE d.captured_at > ?
               GROUP BY d.source_author ORDER BY commission DESC, deals DESC LIMIT 20""",
            (cutoff,),
        ).fetchall()

        # Discount depth banded, to see where the conversion cliff is.
        by_discount = self.conn.execute(
            """SELECT CASE
                        WHEN d.discount_pct >= 70 THEN '70%+'
                        WHEN d.discount_pct >= 50 THEN '50-69%'
                        WHEN d.discount_pct >= 30 THEN '30-49%'
                        WHEN d.discount_pct >= 15 THEN '15-29%'
                        ELSE '<15%' END band,
                      COUNT(DISTINCT p.id) posts,
                      COALESCE(SUM(e.clicks),0) clicks,
                      COALESCE(SUM(e.ordered_items),0) orders
               FROM deals d
               JOIN posts p ON p.asin = d.asin
               LEFT JOIN earnings e ON e.asin = d.asin
               WHERE p.posted_at > ? AND d.discount_pct IS NOT NULL
               GROUP BY band""",
            (cutoff,),
        ).fetchall()

        return {
            "days": days,
            "by_category": [dict(r) for r in by_category],
            "by_mechanic": [dict(r) for r in by_mechanic],
            "by_source": [dict(r) for r in by_source],
            "by_discount": [dict(r) for r in by_discount],
        }

    def timing_stats(self, days: int = 30) -> dict:
        """When to fire, and how fast a deal dies."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        by_hour = self.conn.execute(
            """SELECT CAST(strftime('%H', posted_at) AS INTEGER) hour,
                      COUNT(*) posts,
                      AVG(likes + reposts + replies) avg_engagement,
                      AVG(impressions) avg_impressions
               FROM posts WHERE posted_at > ?
               GROUP BY hour ORDER BY hour""",
            (cutoff,),
        ).fetchall()

        # Does posting a fresher deal actually convert better? This is the band
        # that answers it.
        by_freshness = self.conn.execute(
            """SELECT CASE
                        WHEN p.deal_age_at_post < 15  THEN '<15m'
                        WHEN p.deal_age_at_post < 30  THEN '15-29m'
                        WHEN p.deal_age_at_post < 60  THEN '30-59m'
                        WHEN p.deal_age_at_post < 180 THEN '1-3h'
                        ELSE '3h+' END band,
                      COUNT(*) posts,
                      AVG(p.likes + p.reposts) avg_engagement,
                      COALESCE(SUM(e.clicks),0) clicks,
                      COALESCE(SUM(e.ordered_items),0) orders
               FROM posts p
               LEFT JOIN earnings e ON e.asin = p.asin
               WHERE p.posted_at > ? AND p.deal_age_at_post IS NOT NULL
               GROUP BY band""",
            (cutoff,),
        ).fetchall()

        copy_source = self.conn.execute(
            """SELECT copy_source, COUNT(*) posts,
                      AVG(likes + reposts + replies) avg_engagement
               FROM posts WHERE posted_at > ? GROUP BY copy_source""",
            (cutoff,),
        ).fetchall()

        return {
            "days": days,
            "by_hour": [dict(r) for r in by_hour],
            "by_freshness": [dict(r) for r in by_freshness],
            "by_copy_source": [dict(r) for r in copy_source],
        }

    def summary(self) -> dict:
        """Everything the header tiles need, in one call."""
        rev = self.revenue_stats(30)
        pipe = self.pipeline_stats(24)
        return {
            "commission_30d": rev["commission"],
            "clicks_30d": rev["clicks"],
            "orders_30d": rev["orders"],
            "epc": rev["epc"],
            "conversion_pct": rev["conversion_pct"],
            "posts_24h": self.posts_since(86400),
            "posts_1h": self.posts_since(3600),
            "queued": len(self.queue(1000)),
            "scanned_24h": pipe["scanned"],
            "hit_rate_pct": pipe["hit_rate_pct"],
            "latency_avg_ms": pipe["latency_avg_ms"],
        }

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass
