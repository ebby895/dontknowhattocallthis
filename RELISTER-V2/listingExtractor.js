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

  const SKIP_TAGS = new Set([
    "BASE", "HEAD", "LINK", "META", "STYLE", "TITLE", "CANVAS", "NOSCRIPT", "SCRIPT"
  ]);

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
    return true;
  }

  // Visual reading order, not DOM order — a grid's DOM can be shuffled.
  function sortGeometrically(els) {
    return els.slice().sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const rowA = Math.round(ra.top / 20), rowB = Math.round(rb.top / 20);
      return rowA !== rowB ? rowA - rowB : ra.left - rb.left;
    });
  }

  // Only text this element owns, not the concatenation of every descendant.
  // Without this a wrapping <div> swallows the whole card into one "title".
  function directTextOnly(el) {
    if (!el) return "";
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) out += node.nodeValue;
    }
    return out.trim();
  }

  // Every element that owns text, in reading order — the raw material for
  // picking out title / price / date without knowing Facebook's class names.
  function ownTextNodes(root) {
    const out = [];
    const walker = root.ownerDocument.createTreeWalker(root, 1 /* ELEMENT */);
    let el = root;
    while (el) {
      const t = directTextOnly(el);
      if (t && isVisible(el)) out.push({ el, text: t });
      el = walker.nextNode();
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Repeating-group detection
  //
  // Borrowed from how general-purpose scrapers find a list without being told:
  // an element is a list container when enough of its children are structurally
  // alike. Fingerprints are tried in order and the one matching the most
  // children wins. This is why the reader survives Facebook renaming classes —
  // it never needs to know a class name.
  // ---------------------------------------------------------------------------

  const MIN_ITEMS = 2;

  function fingerprintByLinkOffset(child) {
    const a = child.querySelector('a[href*="/marketplace/item/"]') || child.querySelector("a");
    if (!a) return null;
    const rc = child.getBoundingClientRect(), ra = a.getBoundingClientRect();
    // Link offset alone is too weak: a promo tile and a real listing card both
    // put their anchor at (0,0). Pair it with a coarse card size, rounded
    // loosely enough that a two-line title does not split the bucket.
    return `link:${Math.round((ra.left - rc.left) / 10)},${Math.round((ra.top - rc.top) / 10)}` +
           `:${Math.round(rc.width / 40)}x${Math.round(rc.height / 60)}`;
  }

  function fingerprintByClass(child) {
    const c = (child.getAttribute("class") || "").trim();
    return c ? `class:${c.split(/\s+/).sort().join(" ")}` : null;
  }

  function fingerprintByShape(child) {
    const r = child.getBoundingClientRect();
    return `shape:${Math.round(r.width / 10)}x${Math.round(r.height / 10)}:${child.tagName}`;
  }

  function largestSimilarGroup(children) {
    for (const fp of [fingerprintByLinkOffset, fingerprintByClass, fingerprintByShape]) {
      const buckets = new Map();
      for (const c of children) {
        const key = fp(c);
        if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(c);
      }
      let best = [];
      for (const group of buckets.values()) {
        if (group.length > best.length) best = group;
      }
      if (best.length >= MIN_ITEMS) return best;
    }
    return [];
  }

  // The card root for a listing link: the highest ancestor that still contains
  // exactly this one listing link. Going higher would merge two cards.
  function cardRootFor(anchor, root) {
    let el = anchor;
    while (el && el.parentElement && el.parentElement !== root) {
      const parent = el.parentElement;
      if (parent.querySelectorAll('a[href*="/marketplace/item/"]').length !== 1) break;
      el = parent;
    }
    return el;
  }

  function fromVisibleCards(doc) {
    const root = doc || document;
    const out = new Map();
    const now = Date.now();

    const anchors = Array.from(root.querySelectorAll('a[href*="/marketplace/item/"]'))
      .filter(a => /\/marketplace\/item\/(\d+)/.test(a.getAttribute("href") || ""));
    if (anchors.length === 0) return [];

    // Card roots, then keep only the structurally similar majority — this drops
    // "related items" rails and single promo tiles that are not your listings.
    const cards = [];
    const seenCards = new Set();
    for (const a of anchors) {
      const card = cardRootFor(a, root.body || root);
      if (!card || seenCards.has(card)) continue;
      seenCards.add(card);
      cards.push(card);
    }

    let chosen = cards;
    if (cards.length >= MIN_ITEMS) {
      const similar = largestSimilarGroup(cards);
      // Only trust the filter if it kept a real majority; otherwise keep all.
      if (similar.length >= Math.max(MIN_ITEMS, Math.floor(cards.length * 0.5))) {
        chosen = similar;
      }
    }

    for (const card of sortGeometrically(chosen)) {
      const a = card.querySelector('a[href*="/marketplace/item/"]');
      const m = (a?.getAttribute("href") || "").match(/\/marketplace\/item\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      if (out.has(id)) continue;

      const texts = ownTextNodes(card).map(t => t.text);

      const priceLine = texts.find(t => /^[^\w]{0,3}[\$£€₱]\s?[\d,.]+/.test(t) || /^free$/i.test(t)) || "";

      let creationTimeMs = null;
      for (const t of texts) {
        if (!DATE_HINT.test(t)) continue;
        const parsed = parseRelativeDate(t, now);
        if (parsed != null) { creationTimeMs = parsed; break; }
      }
      if (creationTimeMs == null) {
        const timed = card.querySelector("[data-utime], abbr[title], [title]");
        if (timed) {
          creationTimeMs =
            normalizeTimestamp(timed.getAttribute("data-utime")) ||
            parseRelativeDate(timed.getAttribute("title"), now);
        }
      }

      // Title: the longest own-text line that is not the price and not the date.
      const title = texts
        .filter(t => t !== priceLine && !DATE_HINT.test(t) && t.length > 2)
        .sort((x, y) => y.length - x.length)[0] || "";

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
    sortGeometrically,
    directTextOnly,
    largestSimilarGroup,
    fromJsonBlobs,
    fromVisibleCards,
    parseRelativeDate,
    normalizeTimestamp,
    merge,
    ageDays
  };
})();
