﻿﻿// Invisible separator character (must match content_main.js)
var FFM_INVISIBLE_SELLING = "\u2063";

// Build invisible prefix: ffb-<listingId>
function ffmBuildInvisibleIdPrefix(listingId) {
  return `${FFM_INVISIBLE_SELLING}ffb-${listingId}${FFM_INVISIBLE_SELLING}`;
}

// Strip hidden ID from scraped FB titles
function ffmExtractInvisibleId(titleText) {
  if (!titleText) return null;
  const match = titleText.match(/ffb-([a-zA-Z0-9_]+)/);
  return match ? match[1] : null;
}
// Signal readiness quickly to the background service worker so it can ping us
console.log("[content_selling] initialized and listening for delete commands");

// Flag set when the current delete was initiated as a scheduled-delete (SDnR)
let __ffm_lastDeleteScheduled = false;

// Capture in-page Delete/Relist button clicks and persist a manual-action marker
try {
  document.addEventListener('click', (ev) => {
    try {
      const el = ev && ev.target && ev.target.closest ? ev.target.closest('.dnr-btn') : null;
      if (!el) return;
      const inventory = (el.getAttribute && el.getAttribute('data-inventory-name')) || (el.dataset && el.dataset.inventoryName) || null;
      try {
        chrome.storage && chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ ffm_manual_action: { ts: Date.now(), type: 'dnr', inventoryName: inventory } }, () => {
          try { console.log('[AutoList Pro content] ffm_manual_action written (in-page dnr click)', { inventory }); } catch (e) {}
        });
      } catch (e) {}
    } catch (e) {}
  }, true);
} catch (e) {}

// =====================================================
// 🕓 Wait for shared_scrapers.js to attach before continuing
// =====================================================
async function ffmWaitForSharedScrapers(maxWait = 2000) {
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (
        typeof window.ffmScrapeActiveListingsOnce === "function" &&
        typeof window.ffmFindSellingCardByTitle === "function"
      ) {
        clearInterval(interval);
        const elapsed = (typeof performance !== 'undefined' && performance.now) ? (performance.now() - start).toFixed(0) : (Date.now() - start);
          try { console.log(`[content_selling] ✅ shared_scrapers ready after ${elapsed}ms`); } catch (e) {}
          resolve(true);
        } else if ((typeof performance !== 'undefined' && performance.now ? (performance.now() - start) : (Date.now() - start)) > maxWait) {
          clearInterval(interval);
          try { console.warn("[content_selling] ⚠️ shared_scrapers not ready after timeout"); } catch (e) {}
          resolve(false);
        }
      }, 100);
    });
  }

  // Extracted handler so other injection paths can reuse the delete/relist pipeline.
  function ffmProcessDeleteRelistMessage(msg, sendResponse) {
    try {
      __ffm_lastDeleteScheduled = !!msg.scheduled;
      try { console.log('[content_selling] delete init — scheduled =', __ffm_lastDeleteScheduled); } catch (e) { __ffm_lastDeleteScheduled = false; }
    } catch (e) { __ffm_lastDeleteScheduled = false; }

    const rawTitle = (msg && ((typeof msg.title === 'string' && msg.title.trim()) || (typeof msg.listingTitle === 'string' && msg.listingTitle.trim()) || (typeof msg.deleteTitle === 'string' && msg.deleteTitle.trim()))) || '';
    const wantTitle = (rawTitle || '').trim();

    if (!wantTitle) {
      try { console.warn('[content_selling] aborting delete — no usable title in msg', msg); } catch (e) {}
      try { sendResponse && sendResponse({ ok: false, reason: 'no-title' }); } catch (e) {}
      return false;
    }

    try { console.log('[content_selling] start delete for title:', wantTitle); } catch (e) {}

    let card = null;

    (async () => {
      try {
        await ffmWaitForSharedScrapers();
        try { console.log('[content_selling] shared_scrapers readiness check complete'); } catch (e) {}

        await waitFor(() => document.body && document.querySelector('div'), 15000);
        try { console.log('[content_selling] using AS-style ffmFindSellingCardByTitle'); } catch (e) {}

        await (async ms => new Promise(r => setTimeout(r, ms)))(400);
        if (typeof window.ffmAutoScrollSelling === 'function') { await window.ffmAutoScrollSelling(12); }
        try { console.log('[content_selling] initiating pre-scrape scroll for selling cards…'); } catch (e) {}

        const scraped = (typeof window.ffmScrapeActiveListingsOnce === 'function')
          ? await window.ffmScrapeActiveListingsOnce({ shallow: true, log: true })
          : [];

        for (const item of scraped) {
          if (item && typeof item.title === 'string') {
            const rt = item.title.trim();
            const detectedId = ffmExtractInvisibleId(rt);
            const cleanTitle = rt.replace(/\u2063?ffb-[a-zA-Z0-9_]+\u2063?/g, '').trim();
            item.listingId = detectedId || null;
            item.title = cleanTitle;
          }
        }
        try { window.__ffm_active_listings_cache = scraped; } catch (e) {}

        if (typeof window.ffmFindSellingCardByTitle !== 'function') {
          try { console.error('[AutoList Pro] ffmFindSellingCardByTitle not found in shared_scrapers'); } catch (e) {}
          try { sendResponse && sendResponse({ ok: false, reason: 'finder-missing' }); } catch (e) {}
          return;
        }

        const match = await window.ffmFindSellingCardByTitle(wantTitle, { log: true });
        if (!match) { try { console.warn('[AutoList Pro] ❌ No confident match — aborting delete for safety'); } catch (e) {} try { sendResponse && sendResponse({ ok:false, reason:'not-found' }); } catch (e) {} return; }
        if (!match.element) { try { console.warn('[AutoList Pro] ❌ Finder returned no DOM element for the best match'); } catch (e) {} try { sendResponse && sendResponse({ ok: false, reason: 'no-dom-match' }); } catch (e) {} return; }

        try { console.log('[AutoList Pro] ✅ Confident match found', match); } catch (e) {}
        card = match.element;

        // Delete flow
        let menuBtn = card.querySelector('div[aria-haspopup="menu"], div[role="button"][aria-label*="Menu"], div[role="button"][aria-label*="More"], div[role="button"][aria-label*="Options"]');
        if (!menuBtn) menuBtn = findMenuButton(card, wantTitle);
        if (!menuBtn) { try { console.warn('[content_selling] no menu button found for matched card'); } catch (e) {} try { sendResponse && sendResponse({ ok: false, reason: 'no-menu-button' }); } catch (e) {} return; }

        try { console.log('[content_selling] clicking listing menu button…'); } catch (e) {}
        clickElement(menuBtn);
        await sleep(700);

        let deleteOption = null;
        for (let i = 0; i < 10 && !deleteOption; i++) {
          deleteOption = findByText([
            "div[role='menuitem']",
            "div[role='button']",
            "span[role='menuitem']",
            "li[role='menuitem']"
          ], /delete/i);
          if (deleteOption) break;
          await sleep(400);
        }
        if (!deleteOption) { try { console.warn('[content_selling] could not find "Delete" option in menu'); } catch (e) {} try { sendResponse && sendResponse({ ok: false, reason: 'no-delete-menu-item' }); } catch (e) {} return; }

        try { console.log('[content_selling] clicking "Delete" menu option…'); } catch (e) {}
        clickElement(deleteOption);
        await sleep(600);

        const modalOk = await confirmDeleteModalUniversal(10);
        if (!modalOk) {
          try { console.warn('[content_selling] delete modal handler did not fully confirm delete'); } catch (e) {}
          // Attempt recovery: persist a reload-check marker so after a reload
          // the content script can re-scan the selling page and, if the
          // listing is gone, notify background and continue the publish flow.
          try {
            const pending = {
              title: wantTitle,
              listingId: (match && (match.id || match.listingId)) || msg.listingId || null,
              inventoryName: msg.inventoryName || null,
              scheduled: !!__ffm_lastDeleteScheduled,
              ts: Date.now()
            };
            try { chrome && chrome.storage && chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ ffm_delete_reload_check: pending }); } catch (e) {}
          } catch (e) {}
          // Reload the page to clear any stuck dialogs and allow a fresh DOM check
          try { location.reload(); } catch (e) { try { console.warn('[content_selling] reload failed', e); } catch (ee) {} }
          // Returning true here because we've initiated a reload/recovery path.
          try { sendResponse && sendResponse({ ok: true, recovery: 'reload-initiated' }); } catch (e) {}
          return true;
        }

        const removed = await waitFor(() => { try { return !card || !document.body.contains(card) || card.offsetParent === null; } catch (e) { return true; } }, 15000, 300);
        if (!removed) { try { console.warn('[content_selling] listing card still present after delete flow'); } catch (e) {} try { sendResponse && sendResponse({ ok: false, reason: 'card-not-removed' }); } catch (e) {} return; }

        try { console.log('[content_selling] delete confirmed — listing removed from selling view'); } catch (e) {}

        let resolvedListingId = match?.id || match?.listingId || match?.raw?.listingId || match?.raw?.id || msg.listingId || null;

        try {
          chrome.runtime.sendMessage({
            type: 'ffm_delete_complete',
            scheduled: __ffm_lastDeleteScheduled,
            listingId: resolvedListingId,
            title: wantTitle,
            inventoryName: msg.inventoryName || null,
            helperTabId: msg.helperTabId || null
          });
          try { console.log('[content_selling] 🔔 Sent ffm_delete_complete'); } catch (e) {}
          try { chrome.runtime.sendMessage({ type: 'ffm_close_this_tab_after_delete' }); } catch (e) { try { console.warn('[content_selling] failed to request tab closure', e); } catch (ee) {} }
        } catch (err) { try { console.error('[content_selling] Failed to send ffm_delete_complete:', err); } catch (e) {} }

      } catch (err) {
        try { console.error('[content_selling] error during scheduled delete flow', err); } catch (e) {}
        try { sendResponse && sendResponse({ ok: false, reason: 'exception', error: String(err) }); } catch (e) {}
      }
      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
    })();

    return true;
  }

  // chrome.runtime onMessage listener uses the shared processor
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg && msg.type === 'ffm_ping') {
        try { sendResponse && sendResponse({ type: 'ffm_pong' }); } catch (e) {}
        return false;
      }
    } catch (e) {}

    if (!msg || msg.type !== 'ffm_run_delete_relist') return false;
    return ffmProcessDeleteRelistMessage(msg, sendResponse);
  });

  // Also accept window.postMessage forwards (from other content scripts in same page)
  try {
    window.addEventListener('message', (ev) => {
      try {
        const msg = ev && ev.data ? ev.data : null;
        if (!msg || msg.type !== 'ffm_run_delete_relist') return;
        // Fire-and-forget: call the same processor without expecting a sendResponse
        try { ffmProcessDeleteRelistMessage(msg, null); } catch (e) {}
      } catch (e) {}
    });
  } catch (e) {}

  // If we previously set a reload-check marker because delete dialogs were
  // stuck, handle it now: re-scan for the listing and notify background if
  // the listing is gone. This helps recover when FB kept dialogs but delete
  // actually completed server-side.
  async function ffmHandlePendingReloadCheck() {
    try {
      try {
        chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get(['ffm_delete_reload_check'], async (res) => {
          const data = res && res.ffm_delete_reload_check;
          if (!data) return;
          try { console.log('[content_selling] pending reload-check found', data); } catch (e) {}
          await ffmWaitForSharedScrapers();
          try { await waitFor(() => document.body && document.querySelector('div'), 10000, 150); } catch (e) {}

          // Try a quick finder first
          let found = false;
          try {
            if (typeof window.ffmFindSellingCardByTitle === 'function') {
              const m = await window.ffmFindSellingCardByTitle(data.title, { log: true });
              if (m && m.element) found = true;
            }
          } catch (e) {}

          if (!found) {
            try {
              chrome.runtime.sendMessage({
                type: 'ffm_delete_complete',
                scheduled: !!data.scheduled,
                listingId: data.listingId || null,
                title: data.title,
                inventoryName: data.inventoryName || null,
                helperTabReloadRecovery: true
              });
              try { chrome.runtime.sendMessage({ type: 'ffm_close_this_tab_after_delete' }); } catch (e) {}
              try { console.log('[content_selling] reload-check: listing not found — signaled delete complete'); } catch (e) {}
            } catch (e) { try { console.warn('[content_selling] reload-check notify failed', e); } catch (ee) {} }
          } else {
            try { console.log('[content_selling] reload-check: listing still present after reload'); } catch (e) {}
          }

          // Clear the pending marker irrespective of outcome (best-effort)
          try { chrome.storage.local.remove && chrome.storage.local.remove('ffm_delete_reload_check'); } catch (e) {}
        });
      } catch (e) {}
    } catch (e) {}
  }

  // Run pending reload-check shortly after script initialization
  try { setTimeout(() => { try { ffmHandlePendingReloadCheck(); } catch (e) {} }, 600); } catch (e) {}

/* ---------- helpers ---------- */

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, maxMs=10000, step=150){
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

// Robust fallback: find and click delete confirmation variants with retries and limited recursion.
async function waitForDeletePopup(tries = 0) {
  const variants = [
    'Delete', 'Confirm', 'Delete item', 'Yes, delete',
    'Next', 'Submit', 'Continue', 'Renew listing', 'Relist this item'
  ];

  for (let i = 0; i < 20; i++) {
    const btn = Array.from(document.querySelectorAll('div[role="button"], button, span'))
      .find(el => variants.some(v => (el.innerText || '').trim().toLowerCase() === v.toLowerCase()));
    if (btn) {
      try {
        btn.click();
        console.log('[AutoList Pro content] Clicked popup button', (btn.innerText || '').trim());
        return true;
      } catch (e) {
        try { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (er) {}
        return true;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (tries < 3) {
    console.warn('[AutoList Pro content] Popup not found, retrying...');
    await new Promise(r => setTimeout(r, 2000));
    return waitForDeletePopup(tries + 1);
  } else {
    console.error('[AutoList Pro content] Gave up waiting for delete confirmation popup');
    return false;
  }
}

// DevTest helper: expose a function to manually exercise the delete modal flow
// from the DevTools console. This will attempt to answer the "Did you sell this item?"
// modal (radio or button variants) and click Next.
window.ffmTestDeleteModalFlow = async function ffmTestDeleteModalFlow() {
  try {
    console.log('[AutoList Pro][DevTest] ffmTestDeleteModalFlow starting');
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    if (!dialogs.length) {
      console.warn('[AutoList Pro][DevTest] no dialogs found');
      return false;
    }
    const modal = dialogs[dialogs.length - 1];

    // Try visible-text matches first
    let answered = await ffmClickByVisibleText([/^No[, ]?haven'?t sold/i, /prefer not to answer/i], { timeout: 2000 });
    if (!answered && typeof ffmSelectSafeDeleteAnswer === 'function') {
      try {
        answered = !!ffmSelectSafeDeleteAnswer(modal);
        console.log('[AutoList Pro][DevTest] fallback ffmSelectSafeDeleteAnswer ->', answered);
      } catch (e) { console.warn('[AutoList Pro][DevTest] ffmSelectSafeDeleteAnswer error', e); }
    }

    // If still not answered, attempt radio-only variant (explicit span + radio inputs)
    if (!answered) {
      try {
        const sellSpan = Array.from(modal.querySelectorAll('span')).find(s => /did you sell this item/i.test((s.textContent || '').trim()));
        if (sellSpan) {
          console.log('[AutoList Pro][DevTest] detected sale-question span');
          let radio = modal.querySelector('input[type="radio"][value="DECLINE"]') || modal.querySelector('input[type="radio"][name="responseRadioList"]') || modal.querySelector('input[type="radio"]');
          if (radio) {
            try { radio.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            try { if (!radio.checked) radio.click(); } catch (e) { try { radio.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (er) {} }
            await new Promise(r => setTimeout(r, 250));
            answered = true;
            console.log('[AutoList Pro][DevTest] clicked radio input');
          } else {
            console.warn('[AutoList Pro][DevTest] no radio input found in modal');
          }
        } else {
          console.warn('[AutoList Pro][DevTest] sale-question span not found in modal');
        }
      } catch (e) { console.warn('[AutoList Pro][DevTest] radio variant error', e); }
    }

    if (answered) {
      const nextClicked = await ffmClickByVisibleText(['Next'], { timeout: 2000 });
      console.log('[AutoList Pro][DevTest] nextClicked ->', !!nextClicked);
      return !!nextClicked;
    }

    console.warn('[AutoList Pro][DevTest] could not answer sale question');
    return false;
  } catch (e) {
    console.error('[AutoList Pro][DevTest] ffmTestDeleteModalFlow failed', e);
    return false;
  }
};

// Reuse popup_main's normalization for consistent matching
function _ffm_normalize_text(s) {
  try {
    if (!s) return '';
    let t = s.toString();
    t = t.replace(/\u00A0/g, ' ');
    t = t.replace(/listed on\s+[^\s]{3,20}/ig, ' ');
    t = t.replace(/marketplace/ig, ' ');
    t = t.replace(/mark as sold/ig, ' ');
    t = t.replace(/\b(sold|removed|inactive|archived)\b/ig, ' ');
    t = t.replace(/\bin stock\b/ig, ' ');
    t = t.replace(/\bview details\b/ig, ' ');
    t = t.replace(/\bsee more\b/ig, ' ');
    t = t.replace(/\bshare\b/ig, ' ');
    t = t.replace(/\bsave\b/ig, ' ');
    t = t.replace(/\$\s?\d+[\d,\.]*/g, ' ');
    t = t.replace(/\b\d+[\d,\.]*\s?(usd|dollars)\b/ig, ' ');
    t = t.replace(/\([^\)]{0,60}\)/g, ' ');
    t = t.replace(/[\u2022\|>]/g, ' ');
    t = t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return t;
  } catch (e) { return ''; }
}

// simple token-overlap fuzzy score: 0..1 (uses normalized tokens)
function tokenScore(a, b){
  const A = new Set(_ffm_normalize_text(a).split(' ').filter(Boolean));
  const B = new Set(_ffm_normalize_text(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

function isCard(el){
  // FB changes a lot  treat common containers as "cards"
  return el && (
    el.getAttribute("role") === "article" ||
    el.getAttribute("role") === "row" ||
    el.tagName === "LI" ||
    el.closest?.('[role="article"],[role="row"],li')
  );
}

function getCardTitle(el){
  // Heuristic: prefer visible headings/links/text blocks inside the card
  const card = isCard(el) ? el : el.closest('[role="article"],[role="row"],li') || el;
  const candidates = [
    ...card.querySelectorAll('a[role="link"], span, div[dir="auto"], h1, h2, h3')
  ];
  // choose the longest reasonable text snippet
  let best = "";
  for (const c of candidates){
    const t = (c.innerText || "").trim();
    if (t && t.length > best.length) best = t;
  }
  return best;
}

async function findCardByTitle(wantTitle, { maxMs = 20000, scrollStep = 800 } = {}) {
  // Hybrid DnR-strengthened finder: scans [role="article"] cards, uses tokenScore
  // for fuzzy matching, progressively scrolls to load more, and returns best partial
  // match if no strong match appears within the timeout.
  const normalize = _ffm_normalize_text;
  const normTitle = normalize(wantTitle || '');
  const t0 = Date.now();
  let best = null, bestScore = 0;

  console.log('[AutoList Pro-debug] 🕵️ scanning active listings for:', normTitle);

  while (Date.now() - t0 < maxMs) {
    const cards = Array.from(document.querySelectorAll('[role="article"]'));
    try { console.log(`[AutoList Pro-debug] found ${cards.length} [role=article] cards`); } catch (e) {}

    for (const article of cards) {
      try {
        const titleEl = article.querySelector('h2, h3, span, a[role="link"]');
        const titleText = titleEl ? (titleEl.innerText || '') : getCardTitle(article) || '';
        const title = normalize(titleText || '');
        if (!title) continue;
        const score = tokenScore(title, wantTitle);

        if (score > bestScore) {
          bestScore = score;
          best = article;
        }

        if (score >= 0.6) {
          try { article.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
          try { console.log('[AutoList Pro-debug] ✅ matched:', titleText, `(score=${score.toFixed(2)})`); } catch (e) {}
          return article;
        }
      } catch (e) {
        // ignore individual card errors
      }
    }

    // scroll to load more if nothing matched strongly
    try { window.scrollBy(0, scrollStep); } catch (e) {}
    await sleep(600);
  }

  if (best) {
    try { console.log('[AutoList Pro-debug] ⚠️ returning best partial match:', bestScore.toFixed(2)); } catch (e) {}
    try { best.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
  } else {
    try { console.warn('[AutoList Pro-debug] ❌ no matching card found for', normTitle); } catch (e) {}
  }
  return best;
}

function findMenuButton(card, wantTitle){
  // Robust global search: score aria-labeled buttons by how well their aria-label matches the listing
  try {
    const normTitle = wantTitle ? _ffm_normalize_text(wantTitle) : '';
    const cardRect = (card && card.getBoundingClientRect) ? card.getBoundingClientRect() : null;

    const candidates = Array.from(document.querySelectorAll('div[role="button"][aria-label], button[aria-label], a[role="button"][aria-label], [aria-haspopup]'));
    const scored = [];
    const cardCenterX = cardRect ? (cardRect.left + cardRect.right) / 2 : null;
    const cardCenterY = cardRect ? (cardRect.top + cardRect.bottom) / 2 : null;

    for (const c of candidates) {
      try {
        const aria = (c.getAttribute && c.getAttribute('aria-label')) || '';
        const aNorm = _ffm_normalize_text(aria || '');
        const titleMatch = normTitle ? (aNorm.includes(normTitle) ? 1 : tokenScore(aNorm, normTitle)) : 0;
        const isMore = /more options|more actions|more options for/i.test(aria) ? 1 : 0;
        let proximity = 0.01;
        try {
          const b = c.getBoundingClientRect();
          const cx = (b.left + b.right) / 2;
          const cy = (b.top + b.bottom) / 2;
          if (cardCenterX !== null && cardCenterY !== null) {
            const dx = Math.abs(cx - cardCenterX);
            const dy = Math.abs(cy - cardCenterY);
            const dist = Math.sqrt(dx*dx + dy*dy);
            proximity = 1 / (1 + dist);
          }
        } catch (e) { /* ignore bbox errors */ }

        const score = (titleMatch * 3) + (isMore * 1) + (proximity * 1);
        scored.push({ el: c, aria, aNorm, score, titleMatch, isMore, proximity });
      } catch (e) {}
    }

    scored.sort((a,b) => b.score - a.score);
    if (scored.length) {
      try {
        console.log('[AutoList Pro-debug] menu candidates (top 6):', scored.slice(0,6).map(s => ({ aria: s.aria, score: Number(s.score.toFixed(3)), titleMatch: Number(s.titleMatch.toFixed ? s.titleMatch.toFixed(3) : s.titleMatch), proximity: Number((s.proximity||0).toFixed(4)) })));
      } catch (e) {}
      // choose top candidate if it has some meaningful score
      if (scored[0].score > 0.05) return scored[0].el;
    }
    return null;
  } catch (e) { return null; }
}

// Helper: robust click that dispatches mouse events to mimic a real user click
function clickElement(el) {
  try {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    try { el.focus && el.focus(); } catch (e) {}
    ['mouseover','mousedown','mouseup','click'].forEach(type => {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
    });
  } catch (e) {}
}

// Try to detect and click a negative answer for "Did you sell this item?" dialogs.
// Scans the topmost dialog for options that look like "No / I didn't sell / still have" and clicks the first match.
function clickDidYouSellAnswer(root) {
  try {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const modal = root || (dialogs.length ? dialogs[dialogs.length - 1] : null);
    if (!modal) return false;
    const candidates = Array.from(modal.querySelectorAll('div[role="button"], button, span, label'));
    const negativeRe = /\b(no|not|still have|haven'?t sold|haven'?t|i did not|i didn'?t|not sold|keep|keeping)\b/i;
    for (const c of candidates) {
      try {
        const txt = (c.innerText || '').trim();
        if (!txt) continue;
        if (negativeRe.test(txt)) {
          try { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
          try { c.click(); } catch (e) { try { c.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (er) {} }
          try { console.log('[AutoList Pro-debug] clicked did-you-sell negative answer:', txt); } catch (e) {}
          return true;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return false;
}

// Click a visible "Next" control inside delete-related dialogs to advance multi-step surveys
function clickDeleteNextButton() {
  try {
    const nextSpan = [...document.querySelectorAll('span')]
      .find(s => s.textContent?.trim().toLowerCase() === 'next');

    if (!nextSpan) return false;

    const clickable =
      nextSpan.closest('div[role], div[tabindex], div.html-div');

    if (!clickable) return false;

    try { clickable.scrollIntoView({ block: 'center' }); } catch (e) {}

    clickable.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    clickable.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    try { clickable.click(); } catch (e) {}

    try { console.debug('[AutoList Pro-debug] ✔ Delete modal: clicked Next'); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

// General helper: click a visible span by exact text or regex match within a timeout
function ffmClickByVisibleText(textMatchers, options = {}) {
  const timeout = options.timeout || 2000;
  const start = Date.now();

  return new Promise(resolve => {
    const tick = () => {
      const spans = [...document.querySelectorAll('span')];

      for (const span of spans) {
        const txt = span.textContent?.trim();
        if (!txt) continue;

        if (textMatchers.some(m =>
          typeof m === 'string'
            ? txt === m
            : m.test(txt)
        )) {
          const btn =
            span.closest('div[role="button"], div[tabindex], div.html-div');

          if (!btn) continue;

          try { btn.scrollIntoView({ block: 'center' }); } catch (e) {}

          try { btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) {}
          try { btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); } catch (e) {}
          try { btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
          try { btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
          try { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {}

          return resolve(true);
        }
      }

      if (Date.now() - start > timeout) {
        return resolve(false);
      }

      requestAnimationFrame(tick);
    };

    tick();
  });
}

function findByText(selectors, regex){
  for (const sel of selectors){
    const els = document.querySelectorAll(sel);
    for (const el of els){
      if (regex.test((el.innerText || "").trim())) return el;
    }
  }
  return null;
}

// Universal delete-confirm modal handler (handles survey, preview, and simple variants)
async function confirmDeleteModalUniversal(maxLoops = 10) {
  console.log("[AutoList Pro-debug] 🔎 Monitoring for any delete-related modal sequence...");
  const normalize = t => (t || "").toLowerCase().trim();
  // helper to click a button by text within a given root
  const clickByText = async (root, text) => {
    const els = Array.from(root.querySelectorAll("div[role='button'], button, span"));
    // Prefer exact normalized match first
    let btn = els.find(b => normalize(b.innerText) === text);
    // Fallback: contains match (handles extra whitespace/children)
    if (!btn) btn = els.find(b => (normalize(b.innerText) || '').indexOf(text) !== -1);
    // Fallback: aria-label contains
    if (!btn) {
      btn = Array.from(root.querySelectorAll("[role='button'], button, [aria-label]")).find(b => {
        try {
          const al = (b.getAttribute && b.getAttribute('aria-label')) || (b.getAttribute && b.getAttribute('title')) || '';
          return (al || '').toLowerCase().indexOf(text) !== -1;
        } catch (e) { return false; }
      });
    }
    if (btn) {
      try { btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      await sleep(350);
      try { btn.click(); } catch (e) { try { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
      console.log(`[AutoList Pro-debug] 🖱️ Clicked "${text}"`);
      return true;
    }
    return false;
  };

  // broader pattern to consider a dialog related to delete flow
  const isLikelyDeleteDialog = (root) => {
    try {
      const t = normalize(root.innerText || '');
      if (!t) return false;
      // match explicit phrases or common confirm verbs
      if (t.includes('delete listing') || t.includes('delete this listing') || t.includes('did you sell') || t.includes('are you sure') ) return true;
      if (t.includes('delete') || t.includes('remove') || t.includes('confirm') || t.includes('sell') ) return true;
      return false;
    } catch (e) { return false; }
  };

  for (let loop = 0; loop < maxLoops; loop++) {
    let progressMade = false;

    const allDialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    // prefer dialogs that look related to delete flow; if none match, fall back to any dialog
    let dialogs = allDialogs.filter(d => isLikelyDeleteDialog(d));
    if (!dialogs.length && allDialogs.length) dialogs = allDialogs;

    if (!dialogs.length) {
      await sleep(500);
      continue;
    }

    const modal = dialogs[dialogs.length - 1]; // topmost
    const text = normalize(modal.innerText || '');

    try {
      // --- Handle "Did you sell this item?" dialog using robust visible-text matcher ---
      try {
        let answered = await ffmClickByVisibleText([
          /^No[, ]?haven'?t sold/i,
          /i'd rather not answer/i
        ]);

        // Fallback: if the visible-text matcher didn't find a candidate,
        // try the legacy exact-selection helper (robust radio/label clicker).
        if (!answered) {
          try {
            if (typeof ffmSelectSafeDeleteAnswer === 'function') {
              answered = !!ffmSelectSafeDeleteAnswer(modal);
              if (answered) {
                try { console.debug('[AutoList Pro] ✅ Sale question answered (fallback)'); } catch (e) {}
                await new Promise(r => setTimeout(r, 400));
              }
            }
          } catch (e) {}
        }

        if (answered) {
          const nextClicked = await ffmClickByVisibleText(['Next']);
          if (nextClicked) {
            try { console.debug('[AutoList Pro] ✅ Next clicked after sale question'); } catch (e) {}
            await new Promise(r => setTimeout(r, 500));
          } else {
            try { console.warn('[AutoList Pro] ⚠️ Next button not found after sale question'); } catch (e) {}
          }

          progressMade = true;
          continue;
        }
        // If we didn't answer via visible text or legacy helper, detect the
        // explicit 'Did you sell this item?' span variant and try clicking
        // the DECLINE/No radio input then Next. This handles radio-only UIs.
        try {
          const sellSpan = Array.from(modal.querySelectorAll('span'))
            .find(s => /did you sell this item/i.test((s.textContent || '').trim()));
          if (sellSpan) {
            // prefer explicit DECLINE radio if present, else fall back to any radio
            let radio = modal.querySelector('input[type="radio"][value="DECLINE"]') || modal.querySelector('input[type="radio"][name="responseRadioList"]') || modal.querySelector('input[type="radio"]');
            if (radio) {
              try { radio.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
              try { if (!radio.checked) radio.click(); } catch (e) { try { radio.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (er) {} }
              await new Promise(r => setTimeout(r, 250));
              const nextClicked2 = await ffmClickByVisibleText(['Next']);
              if (nextClicked2) {
                try { console.debug('[AutoList Pro] ✅ Selected DECLINE radio and clicked Next for sale question'); } catch (e) {}
                progressMade = true;
                await sleep(500);
                continue;
              } else {
                try { console.warn('[AutoList Pro] ⚠️ Could not click Next after selecting DECLINE radio'); } catch (e) {}
              }
            }
          }
        } catch (e) {}
      } catch (e) {}

      // Step 2: Click Next if a multi-step survey uses it
      try {
        if (clickDeleteNextButton()) { progressMade = true; await sleep(600); continue; }
      } catch (e) {}

      // Step 3: Existing confirm / delete buttons
      if (await clickByText(modal, 'delete')) { progressMade = true; await sleep(800); continue; }

      const otherLabels = ['confirm', 'remove', 'yes, delete', 'delete item', 'submit', 'ok', 'continue'];
      let clickedOther = false;
      for (const lbl of otherLabels) {
        try {
          if (await clickByText(modal, lbl)) { clickedOther = true; progressMade = true; break; }
        } catch (e) {}
      }
      if (clickedOther) { await sleep(800); continue; }

      // as a last-ditch effort try clicking a 'Close' or 'Cancel' control to clear stuck dialogs
      const lastResortLabels = ['close', 'cancel', 'x'];
      let closed = false;
      for (const lbl of lastResortLabels) {
        try {
          if (await clickByText(modal, lbl)) { closed = true; progressMade = true; break; }
        } catch (e) {}
      }
      if (closed) { await sleep(600); continue; }

      if (!progressMade) {
        console.warn('[AutoList Pro-debug] ❌ Delete modal loop ended but no progress made this iteration');
        return false;
      }
    } catch (e) {
      // swallow and allow retry
      await sleep(300);
      continue;
    }
  }

  // final sweep: wait for dialogs to clear and attempt a last pass on any remaining dialogs
  for (let i = 0; i < 10; i++) {
    const remaining = Array.from(document.querySelectorAll('[role="dialog"]'));
    if (!remaining.length) {
      console.log("[AutoList Pro-debug] ✅ All delete modals cleared");
      return true;
    }
    // try one last pass to click obvious confirm/delete buttons in remaining dialogs
    try {
      for (const modal of remaining) {
        try {
          if (await clickByText(modal, 'delete')) { /* continue trying */ }
          for (const lbl of ['confirm','remove','yes, delete','ok']) {
            try { await clickByText(modal, lbl); } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
    await sleep(400);
  }

  console.warn("[AutoList Pro-debug] ❌ Delete modal loop ended but dialogs remain");
  return false;
}