// lib/deal_resolver.js
// Background-side redirect chain resolver for the NxtGen Deal Engine.
//
// Content scripts can't reliably follow a cross-origin redirect chain, so the
// scanner hands raw outbound URLs to the service worker, which walks each chain
// to its destination and reports back only the final URL.
//
// We follow the redirector to LEARN the destination. The redirector itself is
// discarded and never appears in a published post — Amazon's Program Policies
// bar link placements that obscure that you're linking to Amazon.

(function () {
  'use strict';

  const MSG_RESOLVE = 'nxg-resolve-links';
  const MAX_HOPS = 8;
  const HOP_TIMEOUT_MS = 8000;
  const CONCURRENCY = 4;

  // Cache resolutions for the session. Deal posters reuse the same short links
  // across posts, and the timeline re-renders constantly as you scroll.
  const cache = new Map();

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); }
      );
    });
  }

  // Primary path: let fetch follow the chain and report where it landed.
  // response.url is the post-redirect URL, which is the whole point.
  async function resolveViaFetch(url) {
    const res = await withTimeout(
      fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' }),
      HOP_TIMEOUT_MS
    );
    return { finalUrl: res.url || url, status: res.status };
  }

  // Fallback: some redirectors bounce via an HTML meta-refresh or a JS location
  // assignment, which fetch's follower won't chase. Parse one level of those out
  // of the body, then recurse.
  const META_REFRESH = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"';]+)/i;
  const JS_LOCATION = /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i;

  async function resolveDeep(url, hops) {
    hops = hops || 0;
    if (hops >= MAX_HOPS) return { finalUrl: url, status: 0, note: 'max hops' };

    let res;
    try {
      res = await withTimeout(
        fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' }),
        HOP_TIMEOUT_MS
      );
    } catch (e) {
      return { finalUrl: url, status: 0, error: String(e && e.message || e) };
    }

    const landed = res.url || url;

    // Already home — stop.
    try {
      if (globalThis.DealCore && globalThis.DealCore.isAmazonUrl(landed)) {
        return { finalUrl: landed, status: res.status };
      }
    } catch (e) { /* ignore */ }

    // Look for a client-side bounce we can follow manually.
    let body = '';
    try {
      const ct = res.headers.get('content-type') || '';
      if (/text\/html/i.test(ct)) body = await res.text();
    } catch (e) { /* ignore */ }

    if (body) {
      const m = body.match(META_REFRESH) || body.match(JS_LOCATION);
      if (m && m[1]) {
        let next = m[1].trim();
        try { next = new URL(next, landed).toString(); } catch (e) { next = ''; }
        if (next && next !== landed) return resolveDeep(next, hops + 1);
      }
    }

    return { finalUrl: landed, status: res.status };
  }

  async function resolveOne(url) {
    if (cache.has(url)) return cache.get(url);

    let out;
    try {
      // Fast path first; only pay for the body read if we didn't land on Amazon.
      const quick = await resolveViaFetch(url);
      const isAmz = globalThis.DealCore && globalThis.DealCore.isAmazonUrl(quick.finalUrl);
      out = isAmz ? quick : await resolveDeep(url, 0);
    } catch (e) {
      out = { finalUrl: url, status: 0, error: String(e && e.message || e) };
    }

    const asin = globalThis.DealCore ? globalThis.DealCore.extractAsin(out.finalUrl) : null;
    const result = {
      sourceUrl: url,
      finalUrl: out.finalUrl,
      isAmazon: !!(globalThis.DealCore && globalThis.DealCore.isAmazonUrl(out.finalUrl)),
      asin: asin,
      status: out.status || 0,
      error: out.error || null
    };

    cache.set(url, result);
    return result;
  }

  // Resolve a batch with bounded concurrency so a timeline full of links doesn't
  // open 40 sockets at once.
  async function resolveMany(urls) {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    const results = [];
    let i = 0;

    async function worker() {
      while (i < list.length) {
        const idx = i++;
        try {
          results[idx] = await resolveOne(list[idx]);
        } catch (e) {
          results[idx] = {
            sourceUrl: list[idx],
            finalUrl: list[idx],
            isAmazon: false,
            asin: null,
            status: 0,
            error: String(e && e.message || e)
          };
        }
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, list.length); w++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  // Wire the message handler using the same guarded pattern as the existing
  // handlers in background.js.
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
          if (!msg || msg.type !== MSG_RESOLVE) return false;
          resolveMany(msg.urls || [])
            .then((results) => {
              try { sendResponse({ ok: true, results: results }); } catch (e) {}
            })
            .catch((e) => {
              try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch (ee) {}
            });
          return true; // async response
        } catch (e) {
          try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch (ee) {}
        }
        return false;
      });
    }
  } catch (e) { /* ignore */ }

  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.DealResolver = globalThis.DealResolver || { resolveOne, resolveMany, MSG_RESOLVE };
    }
  } catch (e) { /* ignore */ }
})();
