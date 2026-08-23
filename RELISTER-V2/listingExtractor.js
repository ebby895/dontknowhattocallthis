// Relistify V2 — Listing Extractor
//
// Three independent ways to answer "what is on this selling page, and how old
// is each item". They are independent on purpose: Facebook changes its JSON
// shapes constantly, and the GraphQL path needs session tokens that may not
// resolve. The visible-card reader needs neither, so the box can still be
// populated when the other two come back empty.
//
// Exposes window.__rlfExtract on the content script's isolated world.

(function () {
  "use strict";

  const DAY_MS = 86400000;

  // ---------------------------------------------------------------------------
  // Date parsing
  // ---------------------------------------------------------------------------

  const UNIT_MS = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: DAY_MS,
    week: 7 * DAY_MS,
    month: 30 * DAY_MS,
    year: 365 * DAY_MS
  };

  const MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
  };

  // "Listed 17 days ago", "3 weeks ago", "about an hour ago", "yesterday",
  // "Listed on 5 August", "Listed on August 5", "just now".
  function parseRelativeDate(text, now) {
    if (!text) return null;
    const t = String(text).toLowerCase().replace(/ /g, " ").trim();
    const ref = now == null ? Date.now() : now;

    if (/\b(just now|moments ago|seconds ago)\b/.test(t)) return ref;
    if (/\btoday\b/.test(t)) return ref;
    if (/\byesterday\b/.test(t)) return ref - DAY_MS;

    // "17 days ago" / "a day ago" / "an hour ago" / "about 3 weeks ago"
    const rel = t.match(
      /\b(?:about\s+)?(\d+|a|an)\s*(second|minute|hour|day|week|month|year)s?\s*(?:ago)?\b/
    );
    if (rel) {
      const rawN = rel[1];
      const n = rawN === "a" || rawN === "an" ? 1 : parseInt(rawN, 10);
      const unit = UNIT_MS[rel[2]];
      if (Number.isFinite(n) && unit) return ref - n * unit;
    }

    // Compact forms Facebook sometimes uses: "17d", "3w", "5h".
    const compact = t.match(/\b(\d+)\s*([smhdwy])\b/);
    if (compact) {
      const n = parseInt(compact[1], 10);
      const unit = { s: 1000, m: 60000, h: 3600000, d: DAY_MS, w: 7 * DAY_MS, y: 365 * DAY_MS }[compact[2]];
      if (Number.isFinite(n) && unit) return ref - n * unit;
    }

    // "5 august" / "august 5" / "5 august 2025"
    const monthNames = Object.keys(MONTHS).join("|");
    let abs = t.match(new RegExp("\\b(\\d{1,2})\\s+(" + monthNames + ")(?:\\s+(\\d{4}))?\\b"));
    if (!abs) {
      const m2 = t.match(new RegExp("\\b(" + monthNames + ")\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b"));
      if (m2) abs = [m2[0], m2[2], m2[1], m2[3]];
    }
    if (abs) {
      const day = parseInt(abs[1], 10);
      const month = MONTHS[abs[2]];
      const refDate = new Date(ref);
      const year = abs[3] ? parseInt(abs[3], 10) : refDate.getFullYear();
      const d = new Date(year, month, day);
      // No year given and the date is in the future — it belongs to last year.
      if (!abs[3] && d.getTime() > ref) d.setFullYear(year - 1);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    return null;
  }

  // Facebook hands out timestamps in seconds, milliseconds, and occasionally as
  // ISO strings. Normalise to ms, rejecting anything implausible.
  function normalizeTimestamp(value) {
    if (value == null) return null;
    if (typeof value === "string" && /\D/.test(value)) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    let n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1e11) n *= 1000; // seconds -> ms
    const now = Date.now();
    // Reject pre-2005 and more than a day into the future.
    if (n < 1104537600000 || n > now + DAY_MS) return null;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Strategy 1 — deep walk every JSON blob on the page
  // ---------------------------------------------------------------------------

  const TITLE_KEYS = ["marketplace_listing_title", "custom_title", "title"];
  const TIME_KEYS = [
    "creation_time", "created_time", "listing_creation_time", "create_time",
    "creationTime", "createdTime", "publish_time", "created_utime", "time_created"
  ];

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== "") return obj[k];
    }
    return null;
  }

  function readPrice(obj) {
    const p = obj.listing_price || obj.price || obj.current_price || {};
    const formatted =
      p.formatted_amount || p.formatted_amount_zeros_stripped || p.text ||
      obj.formatted_price || obj.formatted_amount || "";
    const rawAmount = p.amount != null ? p.amount : (p.amount_with_offset != null ? p.amount_with_offset / 100 : null);
    const numeric = parseFloat(String(rawAmount == null ? formatted : rawAmount).replace(/[^0-9.]/g, "")) || 0;
    return { formatted: String(formatted || ""), numeric };
  }

  // Does this object look like a marketplace listing in its own right?
  function asListing(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const id = obj.id || obj.listing_id || obj.story_id;
    if (id == null) return null;
    if (!/^\d{5,}$/.test(String(id))) return null;

    const title = pick(obj, TITLE_KEYS);
    if (!title || typeof title !== "string") return null;

    const price = readPrice(obj);
    const ts = normalizeTimestamp(pick(obj, TIME_KEYS));
    const photo =
      obj.primary_listing_photo?.image?.uri ||
      obj.listing_photos?.[0]?.image?.uri ||
      obj.primary_photo?.image?.uri ||
      obj.image?.uri || "";

    return {
      id: String(id),
      title: title.trim(),
      formattedPrice: price.formatted,
      numericPrice: price.numeric,
      creationTimeMs: ts,
      photoUrl: photo,
      source: "json"
    };
  }

  function fromJsonBlobs(doc) {
    const out = new Map();
    const scripts = Array.from(
      (doc || document).querySelectorAll('script[type="application/json"]')
    );

    for (const s of scripts) {
      let parsed;
      try {
        parsed = JSON.parse(s.textContent || "null");
      } catch (e) {
        continue;
      }

      // Iterative walk — these blobs are deep enough to blow a recursive stack.
      const stack = [parsed];
      let guard = 0;
      while (stack.length && guard++ < 300000) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;

        if (!Array.isArray(cur)) {
          const listing = asListing(cur);
          if (listing) {
            const prev = out.get(listing.id);
            // Prefer whichever copy actually carries a timestamp.
            if (!prev || (prev.creationTimeMs == null && listing.creationTimeMs != null)) {
              out.set(listing.id, Object.assign({}, prev || {}, listing));
            }
          }
          // for_sale_item wraps the real listing on the selling page.
          if (cur.for_sale_item) stack.push(cur.for_sale_item);
        }

        const values = Array.isArray(cur) ? cur : Object.values(cur);
        for (const v of values) {
          if (v && typeof v === "object") stack.push(v);
        }
      }
    }

    return Array.from(out.values());
  }

  // ---------------------------------------------------------------------------
  // Strategy 2 — read the cards the user can actually see
  // ---------------------------------------------------------------------------

  const DATE_HINT = /(listed|posted|created)\b|(\bago\b)|\byesterday\b|\btoday\b/i;

  function findCardRoot(anchor) {
    let el = anchor;
    for (let i = 0; i < 8 && el; i++) {
      const parent = el.parentElement;
      if (!parent) break;
      // Walk up until the subtree is big enough to hold the card's own text.
      if (parent.querySelectorAll('a[href*="/marketplace/item/"]').length > 1) break;
      el = parent;
    }
    return el;
  }

  function fromVisibleCards(doc) {
    const root = doc || document;
    const out = new Map();
    const anchors = Array.from(root.querySelectorAll('a[href*="/marketplace/item/"]'));
    const now = Date.now();

    for (const a of anchors) {
      const m = (a.getAttribute("href") || "").match(/\/marketplace\/item\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      if (out.has(id)) continue;

      const card = findCardRoot(a);
      if (!card) continue;

      const text = (card.innerText || "").replace(/ /g, " ");
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

      // Price: first line that looks like currency.
      const priceLine = lines.find(l => /^[^\w]{0,3}[\$£€₱]\s?[\d,.]+/.test(l) || /\bfree\b/i.test(l)) || "";

      // Title: longest line that is neither the price nor the date hint.
      const title = lines
        .filter(l => l !== priceLine && !DATE_HINT.test(l) && l.length > 2)
        .sort((x, y) => y.length - x.length)[0] || "";

      // Date: first line carrying a date hint that actually parses.
      let creationTimeMs = null;
      for (const l of lines) {
        if (!DATE_HINT.test(l)) continue;
        const parsed = parseRelativeDate(l, now);
        if (parsed != null) { creationTimeMs = parsed; break; }
      }
      // Some layouts put the date in a title/aria attribute instead.
      if (creationTimeMs == null) {
        const timed = card.querySelector("[title], abbr[data-utime], [data-utime]");
        if (timed) {
          creationTimeMs =
            normalizeTimestamp(timed.getAttribute("data-utime")) ||
            parseRelativeDate(timed.getAttribute("title"), now);
        }
      }

      const img = card.querySelector("img");
      out.set(id, {
        id,
        title: title.trim(),
        formattedPrice: priceLine.trim(),
        numericPrice: parseFloat(priceLine.replace(/[^0-9.]/g, "")) || 0,
        creationTimeMs,
        photoUrl: img?.getAttribute("src") || "",
        source: "dom"
      });
    }

    return Array.from(out.values());
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  // Later sources fill gaps in earlier ones; they never overwrite a good value
  // with a blank. A real timestamp always beats an inferred one.
  function merge(...groups) {
    const out = new Map();
    for (const group of groups) {
      for (const item of group || []) {
        if (!item || !item.id) continue;
        const prev = out.get(item.id);
        if (!prev) { out.set(item.id, Object.assign({}, item)); continue; }
        out.set(item.id, {
          id: prev.id,
          title: prev.title || item.title,
          formattedPrice: prev.formattedPrice || item.formattedPrice,
          numericPrice: prev.numericPrice || item.numericPrice,
          creationTimeMs: prev.creationTimeMs != null ? prev.creationTimeMs : item.creationTimeMs,
          photoUrl: prev.photoUrl || item.photoUrl,
          source: prev.source === item.source ? prev.source : `${prev.source}+${item.source}`
        });
      }
    }
    return Array.from(out.values());
  }

  function ageDays(timestampMs) {
    if (!timestampMs) return null;
    return Math.floor((Date.now() - timestampMs) / DAY_MS);
  }

  // Everything the page can tell us, with a report of where each part came from.
  function extractAll(doc) {
    const json = fromJsonBlobs(doc);
    const dom = fromVisibleCards(doc);
    const merged = merge(json, dom).map(l => Object.assign(l, { ageDays: ageDays(l.creationTimeMs) }));
    return {
      listings: merged,
      report: {
        jsonFound: json.length,
        domFound: dom.length,
        merged: merged.length,
        withDates: merged.filter(l => l.creationTimeMs != null).length,
        withoutDates: merged.filter(l => l.creationTimeMs == null).length
      }
    };
  }

  window.__rlfExtract = {
    extractAll,
    fromJsonBlobs,
    fromVisibleCards,
    parseRelativeDate,
    normalizeTimestamp,
    merge,
    ageDays
  };
})();
