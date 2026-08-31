// content/x_deal_scanner.js
// Watches the x.com timeline in your own logged-in session and captures posts
// whose outbound links resolve to Amazon.
//
// Runs entirely in your browser against the feed you already see — no X API
// tier, no scraping service, no credentials. The Following tab is the source:
// only accounts you follow are read.

(function () {
  'use strict';

  const LOG = '[NxtGen Scanner]';
  const STORE_KEY = 'nxg_deal_queue';
  const SEEN_KEY = 'nxg_seen_posts';
  const MSG_RESOLVE = 'nxg-resolve-links';

  const SCAN_DEBOUNCE_MS = 250;   // instant mode: minimise time from post to post
  const MAX_QUEUE = 300;

  let scanTimer = null;
  let seenPostIds = new Set();
  let running = false;

  function log() {
    try {
      if (globalThis.CONFIG && globalThis.CONFIG.enableDebug) {
        console.log.apply(console, [LOG].concat(Array.prototype.slice.call(arguments)));
      }
    } catch (e) { /* ignore */ }
  }

  // --- DOM extraction -------------------------------------------------------
  // X renders posts as <article role="article">. These selectors are the stable
  // testid hooks rather than class names, which are generated and churn.

  function postElements() {
    return Array.from(document.querySelectorAll('article[role="article"]'));
  }

  function postIdFrom(article) {
    // The permalink anchor carries /status/<id> — the only durable identifier.
    const a = article.querySelector('a[href*="/status/"]');
    if (!a) return null;
    const m = (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function authorFrom(article) {
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    const raw = nameEl ? nameEl.innerText : '';
    const parts = raw.split('\n').filter(Boolean);
    const handle = parts.find((p) => p.startsWith('@')) || '';
    return {
      displayName: parts[0] || '',
      handle: handle
    };
  }

  function textFrom(article) {
    const el = article.querySelector('[data-testid="tweetText"]');
    return el ? el.innerText : '';
  }

  function timestampFrom(article) {
    const t = article.querySelector('time');
    return t ? t.getAttribute('datetime') : null;
  }

  function imagesFrom(article) {
    // Captured for reference in the review queue so you can see what the source
    // post showed. Product imagery in published posts comes from the Amazon
    // listing, not from here.
    return Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img'))
      .map((img) => img.getAttribute('src'))
      .filter(Boolean);
  }

  function linksFrom(article) {
    const out = new Set();

    // Rendered link cards and inline links. X rewrites outbound URLs to t.co in
    // href but keeps the display target in the anchor text, so take both.
    article.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) && !/(^|\.)x\.com$/i.test(hostname(href))) {
        out.add(href);
      }
      const shown = (a.innerText || '').trim();
      if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(shown) && !shown.includes(' ')) {
        out.add('https://' + shown.replace(/…$/, ''));
      }
    });

    // Bare URLs written into the post body.
    const body = textFrom(article);
    const re = /https?:\/\/[^\s]+/gi;
    let m;
    while ((m = re.exec(body)) !== null) out.add(m[0].replace(/[).,]+$/, ''));

    return Array.from(out);
  }

  function hostname(u) {
    try { return new URL(u).hostname; } catch (e) { return ''; }
  }

  // --- Queue persistence ----------------------------------------------------

  function loadQueue() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORE_KEY], (r) => resolve((r && r[STORE_KEY]) || []));
      } catch (e) { resolve([]); }
    });
  }

  function saveQueue(items) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [STORE_KEY]: items.slice(0, MAX_QUEUE) }, () => resolve(true));
      } catch (e) { resolve(false); }
    });
  }

  function loadSeen() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([SEEN_KEY], (r) => resolve(new Set((r && r[SEEN_KEY]) || [])));
      } catch (e) { resolve(new Set()); }
    });
  }

  function saveSeen(set) {
    try {
      // Bound the set so storage doesn't grow without limit.
      const arr = Array.from(set).slice(-5000);
      chrome.storage.local.set({ [SEEN_KEY]: arr });
    } catch (e) { /* ignore */ }
  }

  // --- Resolution -----------------------------------------------------------

  function resolveLinks(urls) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: MSG_RESOLVE, urls: urls }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) return resolve([]);
          resolve(resp.results || []);
        });
      } catch (e) { resolve([]); }
    });
  }

  // --- Scan cycle -----------------------------------------------------------

  async function scan() {
    if (running) return;
    running = true;

    try {
      const DC = globalThis.DealCore;
      if (!DC) { log('DealCore not loaded'); return; }

      const articles = postElements();
      const candidates = [];

      for (const article of articles) {
        const postId = postIdFrom(article);
        if (!postId || seenPostIds.has(postId)) continue;

        const links = linksFrom(article);
        if (!links.length) continue;

        candidates.push({
          postId,
          author: authorFrom(article),
          text: textFrom(article),
          timestamp: timestampFrom(article),
          sourceImages: imagesFrom(article),
          links
        });
      }

      if (!candidates.length) return;
      log('candidates', candidates.length);

      // One batched resolve for every link across the new posts.
      const allLinks = [];
      candidates.forEach((c) => c.links.forEach((l) => allLinks.push(l)));
      const results = await resolveLinks(allLinks);

      const byUrl = new Map();
      results.forEach((r) => { if (r && r.sourceUrl) byUrl.set(r.sourceUrl, r); });

      const queue = await loadQueue();
      const existingAsins = new Set(queue.map((q) => q.asin));
      let added = 0;

      for (const c of candidates) {
        // Mark seen regardless of outcome — a post without an Amazon link is
        // never worth re-resolving.
        seenPostIds.add(c.postId);

        // THE GATE: keep only chains that land on Amazon. Walmart, Target,
        // Best Buy and everything else stop here.
        const hit = c.links
          .map((l) => byUrl.get(l))
          .find((r) => r && r.isAmazon && r.asin);

        if (!hit) continue;
        if (existingAsins.has(hit.asin)) continue;

        const mins = DC.ageMinutes(c.timestamp);
        const item = {
          asin: hit.asin,
          // The link we will actually publish: canonical, our tag, no hops.
          affiliateUrl: DC.buildAffiliateUrl(hit.asin, currentTag()),
          resolvedFrom: hit.sourceUrl,
          landedUrl: hit.finalUrl,
          sourcePostId: c.postId,
          sourceAuthor: c.author.handle,
          sourceText: c.text,
          sourceImages: c.sourceImages,
          postedAt: c.timestamp,
          ageMinutesAtCapture: mins,
          promoCode: DC.extractPromoCode(c.text),
          mechanic: DC.detectMechanic(c.text),
          pricesInPost: DC.extractPrices(c.text),
          capturedAt: new Date().toISOString(),
          status: 'new'
        };

        queue.unshift(item);
        existingAsins.add(hit.asin);
        added++;

        // Instant path: generate and attempt the post immediately rather than
        // waiting for you to open the queue. The autopilot gates decide whether
        // it actually goes out — anything they can't clear lands in the queue.
        if (instantEnabled()) {
          handleInstant(item, queue);
        }
      }

      if (added) {
        await saveQueue(queue);
        log('queued', added, 'new deals');
        try {
          chrome.runtime.sendMessage({ type: 'nxg-deals-added', count: added });
        } catch (e) { /* ignore */ }
      }

      saveSeen(seenPostIds);
    } catch (e) {
      log('scan error', e);
    } finally {
      running = false;
    }
  }

  // --- Instant generate + post ---------------------------------------------

  function instantEnabled() {
    try {
      return !!(globalThis.CONFIG && globalThis.CONFIG.instantScan);
    } catch (e) { return false; }
  }

  function generateCopy(deal) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'nxg-generate-copy', deal: deal }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            // Service worker unreachable — fall back to the local template
            // generator so the pipeline never stalls.
            try { return resolve(globalThis.DealCopy.generate(deal, {})); } catch (e) { return resolve(null); }
          }
          resolve(resp.draft);
        });
      } catch (e) {
        try { resolve(globalThis.DealCopy.generate(deal, {})); } catch (ee) { resolve(null); }
      }
    });
  }

  async function handleInstant(item, queue) {
    try {
      const DC = globalThis.DealCore;
      const forCopy = Object.assign({}, item, { ageMinutesNow: DC.ageMinutes(item.postedAt) });

      const draft = await generateCopy(forCopy);
      if (!draft) return;

      // Cache the draft so the queue shows exactly what autopilot considered.
      item.draft = draft;
      item.draftSource = draft.source || 'template';

      if (!globalThis.NxgAutopost) {
        item.status = 'ready';
        await saveQueue(queue);
        return;
      }

      const res = await globalThis.NxgAutopost.attempt(forCopy, draft);
      item.status = res.posted ? 'posted' : 'ready';
      item.holdReason = res.posted ? null : (res.reason || null);
      if (res.posted) item.postedTextAt = new Date().toISOString();

      await saveQueue(queue);
      log(res.posted ? 'auto-posted' : 'held', item.asin, res.reason || '');
    } catch (e) {
      log('instant path error', e);
    }
  }

  function currentTag() {
    try {
      return (globalThis.CONFIG && globalThis.CONFIG.associateTag) || 'nxtgenhotdeal-20';
    } catch (e) {
      return 'nxtgenhotdeal-20';
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  // --- Boot -----------------------------------------------------------------

  async function init() {
    seenPostIds = await loadSeen();
    log('init, seen posts:', seenPostIds.size);

    // The timeline is virtualised — posts mount and unmount as you scroll, so
    // watch the subtree rather than scanning once.
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });

    scheduleScan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
