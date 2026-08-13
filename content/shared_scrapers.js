// shared_scrapers.js
// Unified ALO + background scraper logic
// === Delayed one-time runner ===
// Default debug flag (can be enabled from console: `window.FFM_DEBUG_MODE = true`)
// Keep debug disabled by default to avoid noisy console output in normal runs.
try { if (typeof window !== 'undefined' && typeof window.FFM_DEBUG_MODE === 'undefined') window.FFM_DEBUG_MODE = false; } catch (e) {}
// Centered AS overlay helpers (non-invasive, pointer-events:none)
function ffmInjectAsOverlay() {
  // Overlay injection disabled — keep function as no-op to avoid DOM injection.
  try {
    // Skip overlay on Active Sync helper tabs (those include `ffm_as` in the URL).
    try { if (String(location.href || '').includes('ffm_as')) return; } catch (e) {}

    // Avoid injecting overlay in SDnR helper tabs (these run headless delete/relist).
    // Heuristic: if URL contains title_search or a scheduled SDnR intent exists in storage,
    // do not inject — the background/content_selling pipeline manages SDnR UI itself.
    try {
      if (String(location.href || '').includes('title_search=')) return;
    } catch (e) {}
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['ffm_sdnr_intent'], (res) => {
          try {
            const intent = res && res.ffm_sdnr_intent;
            if (intent && intent.armedAt && (Date.now() - Number(intent.armedAt || 0) < (10 * 60 * 1000))) {
              // recent SDnR intent present — skip overlay
              return;
            }
          } catch (e) {}
        });
      }
    } catch (e) {}

    if (document.getElementById('ffm-as-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'ffm-as-overlay';
    overlay.innerHTML = `
      <div class="ffm-as-backdrop"></div>
      <div class="ffm-as-box">
        <div class="ffm-as-title">AutoList Pro</div>
        <div class="ffm-as-status">Active Sync in Progress…</div>
        <div class="ffm-as-sub">Finding Active Listings…</div>
        <div class="ffm-as-count"></div>
      </div>
    `;
    const style = document.createElement('style');
    style.id = 'ffm-as-overlay-style';
    style.textContent = `
      #ffm-as-overlay { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .ffm-as-backdrop { position: absolute; inset: 0; backdrop-filter: blur(4px); background: rgba(0,0,0,0.18); }
      .ffm-as-box { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(30,30,30,0.92); color: #fff; padding: 14px 18px; border-radius: 10px; width: 300px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.4); pointer-events: none; }
      .ffm-as-title { font-weight: 600; margin-bottom: 8px; }
      .ffm-as-status { font-size: 14px; margin-bottom: 6px; }
      .ffm-as-sub { font-size: 12px; opacity: 0.9; }
      .ffm-as-count { margin-top: 10px; font-size: 13px; }
    `;
    try { document.documentElement.appendChild(style); } catch (e) { document.head && document.head.appendChild(style); }
    try { document.documentElement.appendChild(overlay); } catch (e) { document.body && document.body.appendChild(overlay); }
    try { console.debug('[FFM AS] injected overlay into page (shared_scrapers)'); } catch (e) {}
  } catch (e) { try { console.warn('[FFM AS] inject overlay failed (shared_scrapers)', e); } catch(_){} }
}

function ffmUpdateAsOverlay(opts) {
  // Overlay updates disabled — no-op.
  try { return; } catch (e) {}
}

function ffmRemoveAsOverlay() {
  try {
    const el = document.getElementById('ffm-as-overlay'); if (el && el.parentNode) el.parentNode.removeChild(el);
    const st = document.getElementById('ffm-as-overlay-style'); if (st && st.parentNode) st.parentNode.removeChild(st);
  } catch (e) {}
}

// Self-test: attempt quick inject+remove shortly after script loads to surface any injection issues early in console
  // No auto self-test here — overlay will be injected only when an explicit
  // Active Sync message arrives (to avoid interfering with SDnR flows).
window.ffmScheduleActiveListingsCheck = async function ffmScheduleActiveListingsCheck() {
  try {
    console.log('[AutoList Pro content] Waiting for page to stabilize before first scrape...');
    
    // Wait 15 s or until we detect at least 1 card element
    let waited = 0;
    const maxWait = 15000;
    const interval = 500;
    while (waited < maxWait) {
      const card = document.querySelector('[role="article"], div[aria-label][tabindex="0"]');
      if (card) break;
      await new Promise(r => setTimeout(r, interval));
      waited += interval;
    }

    console.log('[AutoList Pro content] Starting first Active Listings scrape...');
    /* ====== AutoList Pro selling scraper (AS-style, minimal) ====== */

    // tiny sleep
    const _ffmSleep = (ms)=>new Promise(r=>setTimeout(r,ms));

    // keep your existing normalizer if present; fallback here
    function _ffmNorm(t){
      try{
        if (typeof _ffm_normalize_text === 'function') return _ffm_normalize_text(t);
      }catch(_) {}
      return (t||"").toString()
        .replace(/\u00A0/g,' ')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g,' ')
        .replace(/\s+/g,' ')
        .trim();
    }

    // Scroll enough that FB renders a good chunk of listings
    window.ffmAutoScrollSelling = async function ffmAutoScrollSelling(maxScrolls = 16) {
      let last = 0;
      for (let i = 0; i < maxScrolls; i++) {
        try { ffmUpdateAsOverlay && ffmUpdateAsOverlay({ sub: `Scanning… (${i+1}/${maxScrolls})` }); } catch(e){}
        try { window.scrollBy(0, window.innerHeight); } catch {}
        await _ffmSleep(800);
        const h = document.body?.scrollHeight || 0;
        if (h === last) break;
        try {
          let root = document.getElementById('ffm-as-overlay');
          if (!root) {
            // Do not auto-create overlay if this tab is running a scheduled delete (SDnR)
            try { if (String(location.href || '').includes('title_search=')) return; } catch (e) {}
            try { if (window && window.__ffm_lastDeleteScheduled) return; } catch (e) {}
            try { ffmInjectAsOverlay(); } catch (e) {}
            root = document.getElementById('ffm-as-overlay');
          }
          if (!root) { try { console.warn('[FFM AS] update overlay: root not found after inject (shared_scrapers)'); } catch(_){}; return; }
          if (opts.status) {
            const s = root.querySelector('.ffm-as-status'); if (s) s.textContent = opts.status;
          }
          if (opts.sub) {
            const ss = root.querySelector('.ffm-as-sub'); if (ss) ss.textContent = opts.sub;
          }
          if (typeof opts.count !== 'undefined') {
            const c = root.querySelector('.ffm-as-count'); if (c) c.textContent = (Number(opts.count) === 0 ? '' : (String(opts.count) + ' listings found'));
          }
        } catch (e) {}
      }
      if (!title) {
        for (const el of card.querySelectorAll('span, div, h2, h3, a[role="link"]')) {
          const txt = el.innerText?.trim(); if (!txt) continue;
          const weight = parseInt(getComputedStyle(el).fontWeight || '400', 10);
          if (weight >= 600 && !/^\$/.test(txt) && txt.length > 3) { title = txt; break; }
        }
      }
      if (!title) {
        title = rawLines.find(l =>
          l.length > 3 && !/^\$/.test(l) && !/Active|Listed|Sold|Out of stock|Pending|ago|today|yesterday/i.test(l)
        ) || rawLines[0] || "";
      }
      if (!title) return null;

      // Status / Active
      let status = "";
      for (const l of rawLines) {
        if (/Active|Listed|Sold|Out of stock|Pending|ago|today|yesterday/i.test(l)) {
          const idx = rawLines.indexOf(l);
          status = `${l} ${(rawLines[idx+1]||"")}`.replace(/\s+/g,' ').replace(/·/g,'').trim();
          break;
        }
      }
      const active = /(^|\s)(Active|In stock)(\s|$)/i.test(status) && !/Sold|Out of stock|Pending/i.test(status);

      // Price (closest “clean” $ after title)
      const cleanPriceLine = /^\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/;
      let price = "";
      let titleIdx = rawLines.indexOf(title);
      if (titleIdx < 0) {
        const chunk = title.slice(0,24);
        titleIdx = rawLines.findIndex(l => l.includes(chunk));
      }
      if (titleIdx >= 0) {
        const after = rawLines.slice(titleIdx + 1);
        const afterHit = after.find(l => cleanPriceLine.test(l));
        if (afterHit) price = afterHit.trim();
      }
      if (!price) {
        const anyLine = rawLines.find(l => cleanPriceLine.test(l));
        if (anyLine) price = anyLine.trim();
      }
      if (!price) {
        const m = (title.match(/\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/) || [])[0];
        if (m) {
          price = m.trim();
          title = title.replace(price, "").replace(/\s{2,}/g, " ").trim();
        }
      }
      if (!price) price = title; // last-resort so merges still work

      return { title, price, status, active, card };
    }

    // Token-overlap score (0..1)
    function _tokenScore(a, b){
      const A = new Set(_ffmNorm(a).split(' ').filter(Boolean));
      const B = new Set(_ffmNorm(b).split(' ').filter(Boolean));
      if (!A.size || !B.size) return 0;
      let inter = 0; for (const t of A) if (B.has(t)) inter++;
      return inter / Math.min(A.size, B.size);
    }

    /**
     * Scan the selling page for cards and return the best match for `targetTitle`.
     * Returns { card, score, listing } or null.
     */
    // ffmFindSellingCardByTitle moved to file bottom for reliable global attachment
    // (see below) - kept here previously inside schedule runner but now relocated.

    // Note: similarity helper moved later in the file (Jaccard-style). Use the top-level
    // ffmStringSimilarity implementation so there's a single canonical function.

    try {
      try {
        const u = new URL(location.href);
        if (u.searchParams.get('ffm_as') === '1') {
          console.log('[shared_scrapers] skipping auto-scrape in AS hidden tab');
        } else {
          await window.ffmScrapeActiveListingsOnce();
        }
      } catch (e) {
        // If URL parsing failed for any reason, fall back to running the auto-scrape
        await window.ffmScrapeActiveListingsOnce();
      }
    } catch (err2) {
      // swallow outer errors
    }
  } catch (err) {
    console.warn('[AutoList Pro content] Delayed scrape failed', err);
  }
};

window.ffmScrapeActiveListingsOnce = async function ffmScrapeActiveListingsOnce(opts = {}) {
  try {
    // scraper entry
    // -----------------------------------------------------------
    // FIX: Stop scraper from running inside iframe
    // If we're inside the sandboxed Selling iframe, FB prevents
    // storage access, which triggers "Access to storage not allowed"
    // -----------------------------------------------------------
    if (window.top !== window.self) {
      try {
        if (window.FFM_DEBUG_MODE) console.debug('[AutoList Pro Scraper] In iframe — skipping scrape.');
      } catch (e) {}
      return [];
    }
    const { shallow = false, log = false, forceFresh = false } = opts || {};
    // --- Keep the legacy small overlay for quick feedback ---
    let overlay = document.getElementById('ffm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ffm-overlay';
      overlay.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.8); color: #fff; font-size: 16px;
        padding: 10px 18px; border-radius: 12px; z-index: 999999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3); pointer-events: none;
      `;
      try { document.body.appendChild(overlay); } catch(e) { document.documentElement.appendChild(overlay); }
    }
    overlay.textContent = '🌀 Checking Active Listings...';

    // --- Scroll to bottom to reveal listings ---
    let totalScrolls = 0;
    const maxScrolls = shallow ? 4 : 15;
    for (let i = 0; i < maxScrolls; i++) {
      window.scrollBy(0, window.innerHeight);
      totalScrolls++;
      await new Promise(r => setTimeout(r, shallow ? 350 : 700));
    }

    // --- Scrape ---
    const cards = Array.from(document.querySelectorAll('[role="article"], div[aria-label][tabindex="0"]'));
    const listings = [];

    const ignoreWords = [
      'Manage listings','Clear','Sort by','Filters','Status',
      'Mark as sold','Mark out of stock','Mark as available','Mark as in stock',
      'Share','Renew listing','Delete & relist','Relist this item',
      'Tip: Renew your listing?'
    ];

    const cleanPriceLine = /^\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/;
    const cleanPriceAny  = /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g;

    for (const card of cards) {
      const rawLines = (card.innerText || "").split("\n").map(t => t.trim()).filter(Boolean);
      if (!rawLines.length) continue;
      if (ignoreWords.some(w => rawLines[0].startsWith(w))) continue;

      // TITLE
      let title = "";
      for (const el of card.querySelectorAll('span, div')) {
        const style = (el.getAttribute('style') || "").toLowerCase();
        const txt = el.innerText?.trim();
        if (!txt) continue;
        if (style.includes('-webkit-box') && txt.length > 3 && !/^\$/.test(txt)) { title = txt; break; }
      }
      if (!title) {
        for (const el of card.querySelectorAll('span, div')) {
          const txt = el.innerText?.trim();
          if (!txt) continue;
          const weight = parseInt(window.getComputedStyle(el).fontWeight, 10);
          if (weight >= 600 && !/^\$/.test(txt) && txt.length > 3) { title = txt; break; }
        }
      }
      if (!title) {
        title = rawLines.find(l => l.length > 3 && !/^\$/.test(l) && !/Active|Listed|Sold|Out of stock|Pending|ago|today|yesterday/i.test(l)) || rawLines[0] || "";
      }
      if (!title || ignoreWords.some(w => title.includes(w))) continue;

      // STATUS: try quick line-based detection, then fall back to DOM selectors that may contain "In Stock" etc.
      let statusFromLines = "";
      for (const l of rawLines) {
        if (/Active|Listed|Sold|Out of stock|Pending|ago|today|yesterday/i.test(l)) {
          const idx = rawLines.indexOf(l);
          const next = rawLines[idx + 1] || "";
          statusFromLines = `${l} ${next}`.replace(/\s+/g, " ").replace(/·/g, "").trim();
          break;
        }
      }

      // ---- Status Extraction ----
      let status = "";
      let isActive = false;

      // Try to find a status element via aria-label or inline spans/divs
      let statusEl = null;
      try {
        statusEl = card.querySelector('[aria-label*="Active" i], [aria-label*="Sold" i], [aria-label*="Out of Stock" i], [aria-label*="In Stock" i], [aria-label*="Listed" i]');
        if (!statusEl) {
          statusEl = Array.from(card.querySelectorAll('span,div')).find(el => {
            try {
              const t = (el.innerText || '').trim();
              return t && (/\bIn Stock\b/i.test(t) || /\bOut of Stock\b/i.test(t) || /Listed on/i.test(t) || /Active/i.test(t) || /Sold/i.test(t));
            } catch (e) { return false; }
          });
        }
      } catch (e) { /* non-fatal */ }

      // Determine rawStatus either from the found element or from the line-based heuristic
      let rawStatus = "";
      if (statusEl && (statusEl.textContent || statusEl.innerText)) {
        rawStatus = (statusEl.textContent || statusEl.innerText).toString().trim().replace(/\s+/g, ' ');
      } else {
        rawStatus = (statusFromLines || '').toString().trim();
      }

      if (rawStatus) {
        // Normalize known junk
        rawStatus = rawStatus.replace(/\s*on Marketplace.*$/i, "").trim();

        const hasActive = /active/i.test(rawStatus);
        const hasInStock = /in\s*stock/i.test(rawStatus);
        const hasOutOfStock = /out\s*of\s*stock/i.test(rawStatus);
        const hasSold = /sold/i.test(rawStatus);
        const hasListed = /listed/i.test(rawStatus);

        // Extract date part cleanly (e.g. "Listed on 11/9")
        const datePartMatch = rawStatus.match(/listed\s+on\s+\d{1,2}\/\d{1,2}/i);
        const datePart = datePartMatch ? datePartMatch[0] : "";

        if (hasActive) {
          status = `Active ${datePart}`.trim();
          isActive = true;
        } else if (hasInStock) {
          status = `In Stock ${datePart}`.trim();
          isActive = true;
        } else if (hasOutOfStock) {
          status = `Out of Stock ${datePart}`.trim();
          isActive = false;
        } else if (hasSold) {
          status = `Sold ${datePart}`.trim();
          isActive = false;
        } else if (hasListed) {
          status = datePart || "Listed"; // use date if present
          isActive = true;
        } else {
          console.warn('[AutoList Pro scraper] ⚠️ Unrecognized status text:', rawStatus);
          status = rawStatus;
        }

        status = status.replace(/\s+/g, ' ').trim();
      }

      // PRICE
      let price = "";
      let titleIdx = rawLines.indexOf(title);
      if (titleIdx < 0) {
        const chunk = title.slice(0, 24);
        titleIdx = rawLines.findIndex(l => l.includes(chunk));
      }
      if (titleIdx >= 0) {
        const after = rawLines.slice(titleIdx + 1);
        const afterHit = after.find(l => cleanPriceLine.test(l));
        if (afterHit) price = afterHit.trim();
      }
      if (!price) {
        const anyLine = rawLines.find(l => cleanPriceLine.test(l));
        if (anyLine) price = anyLine.trim();
      }
      if (!price) {
        const candidates = [];
        for (let i = 0; i < rawLines.length; i++) {
          const line = rawLines[i];
          const matches = line.match(cleanPriceAny) || [];
          for (const m of matches) {
            if (/[a-z]/i.test(m)) continue;
            candidates.push({ val: m.trim(), idx: i });
          }
        }
        if (candidates.length) {
          let chosen = null;
          if (titleIdx >= 0) chosen = candidates.find(c => c.idx > titleIdx) || candidates[0]; else chosen = candidates[0];
          price = chosen.val;
        }
      }
      if (!price) {
        const tMatch = (title.match(cleanPriceAny) || []).find(m => !/[a-z]/i.test(m));
        if (tMatch) {
          price = tMatch.trim();
          title = title.replace(price, "").replace(/\s{2,}/g, " ").trim();
        }
      }
      if (!price) price = title;

      listings.push({ title, price, status, active: isActive });
    }
    // Update centered AS overlay (if present)
    try { ffmUpdateAsOverlay && ffmUpdateAsOverlay({ status: 'Active Sync complete', sub: 'Scroll finished — finalizing…', count: cards.length }); } catch(e){}
    try { chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffm_as_scroll_complete' }); } catch(e){}
    try { await new Promise(r => setTimeout(r, 200)); } catch(e){}
    try { ffmRemoveAsOverlay && ffmRemoveAsOverlay(); } catch(e){}

    // De-duplicate
    const unique = [];
    for (const l of listings) if (!unique.some(u => u.title === l.title && u.price === l.price)) unique.push(l);

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Overlay update + timed removal
    overlay.textContent = `✅ Found ${unique.length} Active Listings`;
    setTimeout(() => overlay.remove(), 2500);

    if (window.FFM_DEBUG_MODE) console.log(`[AutoList Pro] ffmScrapeActiveListingsOnce found ${unique.length} listings`);

    // --- Detailed log of scraped listings (for validation like ALO) ---
    if (window.FFM_DEBUG_MODE) {
      if (Array.isArray(unique) && unique.length > 0) {
        console.log(`[AutoList Pro] Scraped ${unique.length} listings`);
        console.log(unique);
        unique.forEach((item, i) => {
          try {
            console.log(i, {
              title: item.title,
              price: item.price,
              status: item.status,
              active: item.active,
            });
          } catch (e) { /* ignore per-item logging errors */ }
        });
      } else {
        console.warn('[AutoList Pro] ⚠️ No listings scraped or invalid format:', unique);
      }
    }

    // Return scraped listings; optionally surface a log when requested.
    if (log && window.FFM_DEBUG_MODE) console.log(`[AutoList Pro] ffmScrapeActiveListingsOnce returning ${unique.length} listings`);

    // --- Broadcast to popup for AS compatibility ---
    try {
      chrome.runtime.sendMessage({
        type: "ffmActiveListingsUpdate",
        data: unique
      });
      if (window.FFM_DEBUG_MODE) console.log(`[AutoList Pro bg] 🛰️ Sent Active listings update to popup (${unique.length} items)`);
    } catch (e) {
      if (window.FFM_DEBUG_MODE) console.warn("[AutoList Pro bg] Popup broadcast skipped — likely no listener yet", e);
    }

    return unique;
  } catch (e) {
    console.warn('[AutoList Pro] ffmScrapeActiveListingsOnce failed', e);
    return [];
  }
};

// Invalidate any in-memory or storage-backed scrape caches
window.ffmInvalidateScrapeCache = async function ffmInvalidateScrapeCache(reason) {
  try {
    try { console.debug('[AutoList Pro] ffmInvalidateScrapeCache called', reason); } catch (e) {}
    try { if (window.__ffm_active_listings_cache) delete window.__ffm_active_listings_cache; } catch (e) {}
    try { if (window.__ffm_last_scrape) delete window.__ffm_last_scrape; } catch (e) {}
    try { if (window.__ffm_scraped_listing) delete window.__ffm_scraped_listing; } catch (e) {}
    // Also attempt to remove persisted snapshots from chrome.storage.local if available
    try {
      if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.remove === 'function') {
        const keys = ['__ffm_last_scrape','__ffm_active_listing_cache','__ffm_scraped_listing','__ffm_cfst_scrape','__ffm_last_listing_snapshot','ffm_last_generate_scrape'];
        chrome.storage.local.remove(keys, () => { try { console.debug('[AutoList Pro] ffmInvalidateScrapeCache removed keys', keys); } catch(e){} });
      }
    } catch (e) {}
    try { if (window.__ffm_last_generate_scrape) delete window.__ffm_last_generate_scrape; } catch (e) {}
  } catch (e) {}
};


// ================================
// Move this function HERE ↓↓↓↓↓
// ================================
// =====================================================
// 🧮 Simple fuzzy title similarity (AS-compatible)
// =====================================================
function ffmStringSimilarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  b = b.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!a || !b) return 0;

  const aWords = new Set(a.split(" "));
  const bWords = new Set(b.split(" "));
  const intersection = [...aWords].filter(w => bWords.has(w)).length;
  const union = new Set([...aWords, ...bWords]).size;

  return intersection / union; // simple Jaccard similarity
}

window.ffmFindSellingCardByTitle = async function ffmFindSellingCardByTitle(targetTitle, opts = {}) {
  // NOTE: minScore was previously accepted but never enforced — the highest-scoring
  // DOM card was always returned even when its title barely overlapped with
  // targetTitle (e.g. two words shared out of ten). Since this result drives an
  // irreversible Delete on Facebook, a weak "best available" match could pick a
  // completely different listing than the one intended. minScore is now a real
  // floor: below it, we report no confident match instead of guessing.
  const { log = true, minScore = 0.5, forceFresh = false } = opts || {};

  // Prefer cached scrape results when available, unless forceFresh requested.
  const listings = (typeof window.ffmScrapeActiveListingsOnce === 'function')
    ? await window.ffmScrapeActiveListingsOnce({ shallow: true, log: false, forceFresh: !!forceFresh })
    : (Array.isArray(window.__ffm_active_listings_cache) ? window.__ffm_active_listings_cache : []);

  if (!Array.isArray(listings) || listings.length === 0) {
    if (log) console.warn('[AutoList Pro-debug] ❌ No listings available for matching');
    return null;
  }

  const results = [];

  const cards = Array.from(document.querySelectorAll('[role="article"], div[aria-label][tabindex="0"]'));
  for (const cardEl of cards) {
    try {
      const text = (cardEl.innerText || "");
      const match = listings.find(l => (l.title || '').length && text.includes((l.title || '').slice(0, 25)));
      if (match) {
        const score = typeof ffmStringSimilarity === 'function' ? ffmStringSimilarity(targetTitle, match.title) : 0;
        results.push({ score, match, element: cardEl });
      }
    } catch (e) { /* ignore individual card parse errors */ }
  }

  if (!results.length) {
    if (log) console.warn('[AutoList Pro-debug] ❌ no cards matched text fragments.');
    return null;
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];

  if (best.score < minScore) {
    if (log) console.warn(`[AutoList Pro-debug] ❌ Best DOM match for "${targetTitle}" was "${best.match.title}" but score=${best.score.toFixed(2)} is below minScore=${minScore} — refusing to guess.`);
    return null;
  }

  if (log) console.log(`[AutoList Pro-debug] 🧩 Returning DOM-bound match for "${best.match.title}" score=${best.score.toFixed(2)}`);
  return best;
};


// =====================================================
// 🔧 AutoList Pro Global Attach (for content_selling / DnR)
// =====================================================
try {
  if (typeof window !== "undefined") {
    if (typeof ffmScrapeActiveListingsOnce === "function") {
      window.ffmScrapeActiveListingsOnce = ffmScrapeActiveListingsOnce;
      console.log("[AutoList Pro shared_scrapers] attached ffmScrapeActiveListingsOnce");
    }
    if (typeof ffmFindSellingCardByTitle === "function") {
      window.ffmFindSellingCardByTitle = ffmFindSellingCardByTitle;
      console.log("[AutoList Pro shared_scrapers] attached ffmFindSellingCardByTitle");
    }
  }
} catch (err) {
  console.warn("[AutoList Pro shared_scrapers] failed to attach globals", err);
}
