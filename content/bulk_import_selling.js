// AutoList Pro — bulk-import enumeration
//
// PRIMARY PATH: the seller-management "Your listings" page
// (facebook.com/marketplace/you/selling). Each listing's real ID is only
// revealed by opening its "..." menu — but the menu is NEVER interacted
// with beyond that: the ID is read straight off the "View listing" link's
// href, and the SAME "..." button is clicked a SECOND time to close it (a
// plain toggle). No menu item (Mark as pending, Delete listing, Renew,
// Edit listing, etc.) is EVER clicked — only the trigger button, twice.
//
// SAFETY HISTORY, why this is built this specific way: an earlier version
// of this feature tried to close this same menu with a synthetic Escape
// keydown / a JS-dispatched click on the page background. Confirmed live
// (2026-07-31, via direct DOM testing) that BOTH of those genuinely do not
// close this menu — `document.body.click()` and a synthetic click via
// elementFromPoint both left the menu open. Only re-clicking the exact
// trigger button that opened it reliably closes it. When the earlier
// version's close attempt silently failed, the still-open menu absorbed
// the click meant for the NEXT listing's "..." button, landing on "Mark as
// pending" on multiple real listings. Two consequences of that history,
// both load-bearing:
//   1. Close is ALWAYS done by re-clicking the same button reference, never
//      a background/outside click.
//   2. If a menu ever fails to verifiably close, the WHOLE run stops
//      immediately (see enumerateViaMenus' 'menu-did-not-close' branch) —
//      it does not skip-and-continue, because continuing risks the exact
//      failure above.
//
// FALLBACK PATH: the seller's public PROFILE page
// (facebook.com/marketplace/profile/<id>/), where every listing is a plain
// <a href="/marketplace/item/<id>/">, no menu needed at all. Kept as a
// fallback / for direct profile-page use; the popup's orchestration
// currently drives the "Your listings" path above as primary.
(function () {
  if (!/\/marketplace\/(profile|you\/selling)/i.test(location.pathname)) return;

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function gauss(a, b) { let s = 0; for (let i = 0; i < 3; i++) s += Math.random(); return a + (s / 3) * (b - a); }

  function getScrollables() {
    const out = [];
    document.querySelectorAll('div').forEach((d) => {
      try { const s = getComputedStyle(d); if (/auto|scroll/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 200) out.push(d); } catch (e) {}
    });
    return out.sort((a, b) => b.scrollHeight - a.scrollHeight);
  }

  // ---------------------------------------------------------------------
  // "Your listings" (management page) — menu-based enumeration
  // ---------------------------------------------------------------------

  // Confirmed live: each listing's trigger carries its own title right on
  // the button (aria-label="More options for <title>") — no ancestor-
  // walking needed to associate a trigger with its listing. NOTE: this
  // button's own aria-haspopup is "dialog" (confirmed live), even though
  // clicking it actually opens a role="menu" — don't filter on
  // aria-haspopup here, match on the aria-label prefix alone.
  const MENU_BTN_SEL = 'div[role="button"][aria-label^="More options for"]';

  function findMenuButtons() {
    return Array.from(document.querySelectorAll(MENU_BTN_SEL));
  }

  async function scrollToLoadAllCards(maxIdleRounds = 4, maxRounds = 80) {
    let lastCount = -1, idle = 0;
    for (let i = 0; i < maxRounds && idle < maxIdleRounds; i++) {
      const count = findMenuButtons().length;
      if (count === lastCount) idle++; else idle = 0;
      lastCount = count;
      getScrollables().slice(0, 3).forEach((c) => { try { c.scrollTop = c.scrollHeight; } catch (e) {} });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(gauss(900, 1500));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(300);
  }

  // Chrome throttles JS timers heavily when the browser window isn't the
  // OS-focused window (confirmed live: document.hasFocus() false even with
  // the tab visible) — a content script has no API to force OS focus back,
  // so a short wall-clock timeout can burn its whole budget without ever
  // getting a fair look at the real DOM state, producing a false "didn't
  // close" abort even though the click worked fine. 15s tolerates realistic
  // backgrounding; the hard-stop-on-genuine-failure behavior is unchanged.
  async function waitForMenuOpen(timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const menu = document.querySelector('[role="menu"]');
      if (menu) return menu;
      await sleep(150);
    }
    return null;
  }

  async function waitForMenuClosed(timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!document.querySelector('[role="menu"]')) return true;
      await sleep(150);
    }
    return false;
  }

  // Reads the listing ID straight off a link's href inside the open menu —
  // never clicks anything in here. "View listing" is preferred (plain
  // /marketplace/item/<id>/ path); "Edit listing" (listing_id= query param)
  // is the fallback if that's ever missing.
  function readListingIdFromMenu(menu) {
    const links = Array.from(menu.querySelectorAll('a[href]'));
    const viewLink = links.find((a) => /\/marketplace\/item\//.test(a.getAttribute('href') || ''));
    if (viewLink) {
      const href = viewLink.getAttribute('href') || '';
      const m = href.match(/\/marketplace\/item\/(\d+)/);
      if (m) return { listingId: m[1], itemUrl: new URL(href, location.origin).href.split('?')[0] };
    }
    const editLink = links.find((a) => /\/marketplace\/edit\//.test(a.getAttribute('href') || ''));
    if (editLink) {
      const href = editLink.getAttribute('href') || '';
      const m = href.match(/listing_id=(\d+)/);
      if (m) return { listingId: m[1], itemUrl: `https://www.facebook.com/marketplace/item/${m[1]}/` };
    }
    return null;
  }

  // Opens exactly one listing's menu, reads its ID, closes it via the SAME
  // button (the only mechanism confirmed to reliably close this menu).
  // Never clicks anything else. Returns ok:false with a reason rather than
  // guessing when anything is uncertain.
  async function readOneListing(btn) {
    const title = (btn.getAttribute('aria-label') || '').replace(/^More options for\s*/i, '').trim();
    btn.click();
    const menu = await waitForMenuOpen();
    if (!menu) return { ok: false, reason: 'menu-did-not-open', title };

    const idInfo = readListingIdFromMenu(menu);

    btn.click(); // toggle-close — same element reference, nothing else touched
    const closed = await waitForMenuClosed();
    if (!closed) return { ok: false, reason: 'menu-did-not-close', title };

    if (!idInfo) return { ok: false, reason: 'no-id-found', title };
    return { ok: true, title, listingId: idInfo.listingId, itemUrl: idInfo.itemUrl };
  }

  async function enumerateViaMenus(onProgress) {
    await scrollToLoadAllCards();
    const buttons = findMenuButtons();
    const results = [];
    const seen = new Set();
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      // The page can re-render rows as it scrolls/loads, which would detach
      // earlier button references — skip anything no longer attached rather
      // than clicking a stale element.
      if (!document.body.contains(btn)) continue;

      const r = await readOneListing(btn);
      if (!r.ok) {
        if (r.reason === 'menu-did-not-close') {
          // The exact failure mode that caused a real incident before —
          // stop the whole run rather than risk the next button landing on
          // a menu that's still open.
          try { if (typeof onProgress === 'function') onProgress(results.length, buttons.length); } catch (e) {}
          return { listings: results, aborted: true, reason: r.reason };
        }
        continue; // menu never opened, or no ID found — nothing was left in an uncertain state, safe to move on
      }

      if (!seen.has(r.listingId)) {
        seen.add(r.listingId);
        results.push({ listingId: r.listingId, itemUrl: r.itemUrl, title: r.title });
      }
      try { if (typeof onProgress === 'function') onProgress(results.length, buttons.length); } catch (e) {}
      await sleep(gauss(500, 900));
    }
    return { listings: results, aborted: false };
  }

  // ---------------------------------------------------------------------
  // Public profile page — link-based enumeration (fallback path)
  // ---------------------------------------------------------------------

  const NOISE_HEADING_RE = /today'?s\s*picks?|suggested for you|more from marketplace|similar listings|related listings|discover marketplace|recommended for you|people also viewed/i;

  function findNoiseContainers() {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,span,div'))
      .filter((e) => {
        const t = (e.innerText || '').trim();
        return t.length < 60 && NOISE_HEADING_RE.test(t);
      });
    const containers = [];
    for (const heading of headings) {
      let node = heading, container = null;
      for (let hops = 0; hops < 10 && node.parentElement; hops++) {
        node = node.parentElement;
        const count = node.querySelectorAll('a[href*="/marketplace/item/"]').length;
        if (count >= 4 && count <= 30) { container = node; break; }
        if (count > 30) break;
      }
      if (container) containers.push(container);
    }
    return containers;
  }

  function collectItemLinks() {
    const out = new Map();
    const noiseContainers = findNoiseContainers();
    document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((a) => {
      try {
        if (noiseContainers.some((c) => c.contains(a))) return;
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/marketplace\/item\/(\d+)/);
        if (!m) return;
        const listingId = m[1];
        if (out.has(listingId)) return;
        let itemUrl;
        try { itemUrl = new URL(href, location.origin).href.split('?')[0]; } catch (e) { itemUrl = `https://www.facebook.com/marketplace/item/${listingId}/`; }
        const title = (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 200) || listingId;
        out.set(listingId, { listingId, itemUrl, title });
      } catch (e) {}
    });
    return out;
  }

  async function waitForListings(ms = 12000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (document.querySelectorAll('a[href*="/marketplace/item/"]').length > 0) return true; await sleep(400); }
    return false;
  }

  function findOwnProfileUrl() {
    const a = document.querySelector('a[href*="/marketplace/profile/"]');
    if (!a) return null;
    try { return new URL(a.getAttribute('href'), location.origin).href.split('?')[0]; } catch (e) { return null; }
  }

  async function enumerateViaProfileLinks(onProgress) {
    await waitForListings();
    await sleep(gauss(2500, 4000));

    const found = new Map();
    let lastCount = 0, stable = 0;
    for (let pass = 0; pass < 200 && stable < 6; pass++) {
      collectItemLinks().forEach((v, k) => { if (!found.has(k)) found.set(k, v); });
      try { if (typeof onProgress === 'function') onProgress(found.size, found.size); } catch (e) {}

      const anchors = document.querySelectorAll('a[href*="/marketplace/item/"]');
      if (anchors.length) { try { anchors[anchors.length - 1].scrollIntoView({ block: 'end' }); } catch (e) {} }
      getScrollables().slice(0, 3).forEach((c) => { try { c.scrollTop = c.scrollHeight; } catch (e) {} });
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(gauss(1500, 2400));

      collectItemLinks().forEach((v, k) => { if (!found.has(k)) found.set(k, v); });
      if (found.size === lastCount) stable++; else { stable = 0; lastCount = found.size; }
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(300);
    try { if (typeof onProgress === 'function') onProgress(found.size, found.size); } catch (e) {}
    return Array.from(found.values());
  }

  // ---------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'ffm_bulk_find_own_profile_url') {
      try { sendResponse({ ok: true, profileUrl: findOwnProfileUrl() }); } catch (e) { sendResponse({ ok: false }); }
      return true;
    }
    if (!msg || msg.action !== 'ffm_bulk_selling_enumerate') return;
    (async () => {
      try {
        if (/\/marketplace\/you\/selling/i.test(location.pathname)) {
          const out = await enumerateViaMenus((done, total) => {
            try { chrome.runtime.sendMessage({ action: 'ffm_bulk_selling_enumerate_progress', done, total }); } catch (e) {}
          });
          sendResponse({ ok: true, listings: out.listings, aborted: out.aborted, reason: out.reason });
        } else {
          const listings = await enumerateViaProfileLinks((done, total) => {
            try { chrome.runtime.sendMessage({ action: 'ffm_bulk_selling_enumerate_progress', done, total }); } catch (e) {}
          });
          sendResponse({ ok: true, listings });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
    })();
    return true; // async response
  });

  try { console.debug('[AutoList Pro] bulk_import_selling.js loaded'); } catch (e) {}
})();
