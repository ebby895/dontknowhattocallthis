// AutoList Pro popup/popup_auto_runner.js
// Adds a "Start Auto Process" / "Cancel" pair to the Saved Listings view that
// walks the visible rows top to bottom and clicks each row's own action
// button — whatever it currently says, "Publish" or "Delete / Relist" —
// waiting for that action to genuinely finish before moving to the next row.
//
// Deliberately does NOT call any of popup_main.js's internal functions (it's
// loaded as an ES module, so its top-level functions aren't on `window`
// anyway). Instead it only: (a) reads/clicks real DOM elements that already
// have their real click handlers attached, and (b) listens for the same
// 'publish-complete' / 'dnr-complete' runtime broadcasts popup_main.js itself
// already reacts to elsewhere. This keeps it additive and low-risk against an
// already fragile, actively-relied-on codebase (see project_context.md:
// "Patches, not rewrites").
(function () {
  'use strict';
  if (window.__ffmAutoRunnerInstalled) return;
  window.__ffmAutoRunnerInstalled = true;

  const ROW_SELECTOR = 'li.saved-listing-item';
  // Initial flat wait after clicking (13s, user-specified) before the loop
  // even starts checking whether it's safe to move on. Still listens for the
  // real completion message as a bonus/early-exit during this window.
  const ACTION_WAIT_MS = 13 * 1000;
  const MEDIA_PROMPT_GRACE_MS = 4000;
  // After ACTION_WAIT_MS, the loop does NOT just move on — it actively
  // rechecks whether the listing's own create-listing tab is still sitting on
  // /marketplace/create/*. If it is, that's a specific, meaningful sign the
  // publish hasn't gone through yet (as opposed to the earlier, much coarser
  // "is ANY automation tab open" check, which falsely triggered mid-cycle
  // during the delete→relist transition). The next listing is NOT started
  // until this tab has moved on (or PUBLISH_VERIFY_MAX_MS is reached, so one
  // genuinely stuck listing can't freeze the whole batch forever).
  const PUBLISH_VERIFY_POLL_MS = 3000;
  const PUBLISH_VERIFY_MAX_MS = 3 * 60 * 1000;
  // "Publish Only (safe delete-check)" mode: AutoList Pro's own status can say
  // "Publish" (not live) when the listing is actually still live on FB — its
  // sync can lag or simply miss it (confirmed by the user). Before clicking
  // Publish in this mode, this checks Facebook directly and deletes a live
  // copy if one is genuinely found.
  //
  // This does NOT use AutoList Pro's own ffmDeleteListing/ffmBeginDNRFlow_TitleFirst
  // — that was tried twice (see startPublishSafe()'s history in comments
  // below) and caused two SEPARATE real incidents in one day: (1) a stale
  // ffm_staged_listing hijacking which title got searched, and (2) an
  // uncoordinated parallel fallback opening a second, unfiltered tab that
  // fuzzy-matched and deleted a different, similarly-named listing. Both bugs
  // trace back to reusing a shared mechanism this code doesn't control.
  //
  // Instead: exactly ONE dedicated tab (never a second/parallel one),
  // navigated to a title_search-filtered selling page, checked with a strict
  // near-exact match requirement before ever touching Delete — adapted from
  // the hardened, empirically-fixed card-matching pattern already proven in
  // the sibling Facebook-MP Listing Saver project's content/manage_listing.js
  // (findSellingCard/findCardContainer/overlap scoring), run via
  // chrome.scripting.executeScript so it needs no new content script or
  // manifest change.
  const SAFE_DELETE_MATCH_THRESHOLD = 0.92; // very strict — well above the 0.85 the sibling project uses, given today's "almost the same listing" incident
  const SAFE_DELETE_SEARCH_TIMEOUT_MS = 15000; // how long to look for a matching card after navigating
  const SAFE_DELETE_NAV_SETTLE_MS = 2000; // let FB's own client-side render catch up after navigation completes
  const SAFE_DELETE_OVERALL_CAP_MS = 45000; // outer safety cap on the whole check-and-delete attempt

  // Persistent, NON-expiring record of every listing this auto-runner has
  // ever clicked, keyed by the same identity used elsewhere
  // (data-inventory-name / data-listing-title). This is the fix for "cancel
  // and restart redoes work": once an identity has ANY entry here, it is
  // skipped on every future pass — including a fresh Start after a Cancel, a
  // crash, or reopening the panel entirely — until the user explicitly
  // clicks "Retry Unfinished". This matters especially for Delete/Relist: an
  // "Active" row's action button is ALWAYS clickable regardless of whether it
  // actually needs relisting, and AutoList Pro's own "is this live" status can lag
  // or never update in the UI at all (confirmed by the user) — so label
  // state alone can never be trusted to mean "needs (re)processing." Written
  // BEFORE the click so even a mid-action crash/close leaves a real record,
  // not silence. This is now the ONLY thing preventing a listing from being
  // clicked twice — with no per-row verification and no tab gate anymore,
  // this ledger is the entire safety net, not just one layer of it.
  const PROGRESS_KEY = 'ffm_autorun_progress';

  // AutoList Pro's own automation drives these three page types when running a
  // Delete/Relist or Publish. Used ONLY by manageTabCap() now — multiple of
  // these are expected to coexist while several rows are mid-flight, and are
  // never touched until the count actually exceeds TAB_CAP. Deliberately
  // scoped to just these URL shapes, not "any facebook.com tab", so a user's
  // own unrelated Facebook tabs (news feed, Messenger, etc.) are never
  // touched or counted.
  const AUTOMATION_TAB_PATTERNS = [
    '*://*.facebook.com/marketplace/you/selling*',
    '*://*.facebook.com/marketplace/create/*',
    '*://*.facebook.com/marketplace/edit/*'
  ];
  // Narrower than AUTOMATION_TAB_PATTERNS — used specifically to check "is
  // this listing still sitting on the create-item form," a much more precise
  // signal than "is any automation tab open at all."
  const CREATE_PAGE_PATTERN = ['*://*.facebook.com/marketplace/create/*'];
  // User-requested cap: let automation tabs pile up freely, but once there
  // are more than this many, close the 4 OLDEST before starting the next
  // listing, then refocus whichever tab is now the newest (AutoList Pro's own
  // click-handling likely targets the active tab, so re-activating the
  // newest one keeps the next action pointed at the right place). A prior
  // version tried to keep this down to a strict "never more than one" and
  // aggressively closed anything extra after every single row — that
  // (very plausibly) closed a tab that was still actively mid-relist,
  // deleting listings without ever republishing them. This cap-and-trim
  // approach only ever removes tabs that have been sitting around long
  // enough to be the OLDEST once there are already more than TAB_CAP of them,
  // which is far less likely to hit one still doing real work.
  const TAB_CAP = 10;
  const TABS_TO_CLOSE_WHEN_OVER_CAP = 4;

  let running = false;
  let cancelRequested = false;
  let debugHoldCount = 0; // reference-counted so a stray overlap can't leave the flag/checkbox stuck
  let originalDebugFlag = null;
  let originalDebugCheckbox = null;
  let savedAlert = null, savedConfirm = null; // restore native dialogs after the run
  let progress = {}; // in-memory mirror of chrome.storage.local[PROGRESS_KEY], identityKey -> {action, status, ts, title}

  function normName(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  function rowIdentity(row) {
    return {
      invName: normName(row.getAttribute('data-inventory-name')),
      title: normName(row.getAttribute('data-listing-title'))
    };
  }

  function idKey(id) {
    return id.invName || id.title;
  }

  function inSavedView() {
    try {
      const section = document.getElementById('saved-listings');
      if (!section || section.classList.contains('hidden-section')) return false;
      if (typeof window.savedListingsView !== 'undefined' && window.savedListingsView !== 'saved') return false;
      return true;
    } catch (e) { return false; }
  }

  function getRows() {
    if (!inSavedView()) return [];
    return Array.from(document.querySelectorAll(ROW_SELECTOR));
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Find this row's Publish / Delete-Relist control by its actual text
  // instead of a CSS class. popup_main.js's own render path (~line 17534)
  // REMOVES the .publish-btn class entirely once a listing goes active
  // (swapping in .dnr-btn instead, not alongside it) — a class-based lookup
  // silently finds nothing on those rows, which is why an earlier version of
  // this file only ever picked up "Publish" rows and ignored every
  // "Delete / Relist" row. Text matching works no matter which class AutoList Pro
  // currently has applied, and explicitly excludes the separate "Mark as
  // sold" button that sits next to it on active rows.
  function findActionButton(row) {
    const buttons = Array.from(row.querySelectorAll('button'));
    return buttons.find((b) => {
      const t = (b.textContent || '').trim().toLowerCase();
      return t === 'publish' || (/delete/.test(t) && /relist/.test(t));
    }) || null;
  }

  async function loadProgress() {
    try {
      const res = await new Promise((r) => chrome.storage.local.get([PROGRESS_KEY], r));
      progress = (res && res[PROGRESS_KEY]) || {};
    } catch (e) { progress = {}; }
  }
  async function persistProgress() {
    try { await new Promise((r) => chrome.storage.local.set({ [PROGRESS_KEY]: progress }, r)); } catch (e) {}
  }

  // Resolves 'done' | 'stuck' | 'cancelled' — never rejects, so the loop
  // always moves on instead of hanging on one bad row forever. Awaited by
  // runLoop() before it starts the next row. Two signals, checked together:
  //
  //  1) The 'publish-complete'/'dnr-complete' broadcast — if this arrives at
  //     any point, that's authoritative, resolve 'done' immediately.
  //  2) Whether the listing's own tab is still sitting on the create-listing
  //     form (/marketplace/create/*). This check does NOT start until
  //     ACTION_WAIT_MS has elapsed (a flat initial wait, per the user), and
  //     only counts "no longer there" as done once it's actually been SEEN
  //     there at least once for this row — a prior version tried "no
  //     automation tab of any kind" as the signal and got a false-positive
  //     during the delete→relist transition (a Delete/Relist cycle's tab
  //     closes and reopens BETWEEN those two phases), which caused the next
  //     row to start clicking while this one's tab was still doing the
  //     relist — and that in turn led to a real "listing deleted, never
  //     republished" outcome once tab cleanup closed the still-working tab.
  //     Scoping this specifically to the create-listing URL (not the wider
  //     selling/create/edit set) and requiring it to have been seen open
  //     first avoids repeating that mistake.
  //
  // Capped at PUBLISH_VERIFY_MAX_MS — if neither signal resolves this by
  // then, resolves 'stuck' rather than waiting forever, so one broken
  // listing (e.g. a required dropdown the form never got filled in) can't
  // freeze the whole batch.
  function waitForRealCompletion(kind, id, displayTitle) {
    return new Promise((resolve) => {
      let finished = false;
      let sawCreatePage = false;
      const startedAt = Date.now();
      const finish = (reason) => {
        if (finished) return;
        finished = true;
        try { chrome.runtime.onMessage.removeListener(listener); } catch (e) {}
        clearInterval(poller);
        clearInterval(cancelPoll);
        resolve(reason);
      };
      const listener = (msg) => {
        try {
          if (!msg) return;
          const action = kind === 'publish' ? 'publish-complete' : 'dnr-complete';
          if (msg.action !== action) return;
          const nm = normName(msg.inventoryName);
          if (nm && (nm === id.invName || nm === id.title)) finish('done');
        } catch (e) {}
      };
      try { chrome.runtime.onMessage.addListener(listener); } catch (e) {}
      const cancelPoll = setInterval(() => { if (cancelRequested) finish('cancelled'); }, 300);
      const poller = setInterval(async () => {
        if (finished) return;
        const elapsed = Date.now() - startedAt;
        if (elapsed < ACTION_WAIT_MS) return;
        let tabs;
        try { tabs = await new Promise((r) => chrome.tabs.query({ url: CREATE_PAGE_PATTERN }, r)); } catch (e) { tabs = []; }
        if (tabs && tabs.length > 0) {
          sawCreatePage = true;
          setStatus(`⏳ "${displayTitle}" is still on the create-listing form — waiting for it to actually publish before starting the next one.`);
        } else if (sawCreatePage) {
          finish('done');
          return;
        }
        if (elapsed >= PUBLISH_VERIFY_MAX_MS) finish('stuck');
      }, PUBLISH_VERIFY_POLL_MS);
    });
  }

  // One dedicated tab, reused across every listing in a "Publish Only (safe
  // delete-check)" run — never a second/parallel one. Created lazily on
  // first use, closed by closeSafeCheckTab() when the run ends.
  let safeCheckTabId = null;

  async function ensureSafeCheckTab() {
    if (safeCheckTabId) {
      try {
        const t = await new Promise((r) => chrome.tabs.get(safeCheckTabId, (tab) => r(tab || null)));
        if (t) return safeCheckTabId;
      } catch (e) {}
      safeCheckTabId = null;
    }
    const tab = await new Promise((r) => chrome.tabs.create({ url: 'about:blank', active: false }, (t) => r(t || null)));
    safeCheckTabId = tab && tab.id ? tab.id : null;
    return safeCheckTabId;
  }

  async function closeSafeCheckTab() {
    if (!safeCheckTabId) return;
    try { await new Promise((r) => chrome.tabs.remove(safeCheckTabId, r)); } catch (e) {}
    safeCheckTabId = null;
  }

  function navigateAndWaitComplete(tabId, url, timeoutMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      try { chrome.tabs.update(tabId, { url }); } catch (e) { resolve(false); return; }
      const poll = setInterval(async () => {
        if (Date.now() > deadline) { clearInterval(poll); resolve(false); return; }
        let tab;
        try { tab = await new Promise((r) => chrome.tabs.get(tabId, (t) => r(t || null))); } catch (e) { tab = null; }
        if (!tab) { clearInterval(poll); resolve(false); return; }
        if (tab.status === 'complete') { clearInterval(poll); resolve(true); }
      }, 300);
    });
  }

  // Runs INSIDE the target Facebook tab via chrome.scripting.executeScript —
  // must be fully self-contained (no closures over this file's variables).
  // Adapted from the sibling Facebook-MP Listing Saver project's
  // content/manage_listing.js (findSellingCard/findCardContainer/overlap),
  // which has been hardened through many real, empirically-confirmed fixes
  // on this exact page (decoy hidden buttons, ancestor-walk card detection,
  // the "Did you sell this item?" survey, etc.) — reused here rather than
  // re-guessed from scratch. Only ever acts on the SINGLE best-matching card
  // and only if its match score clears a strict threshold; ambiguous
  // (multiple candidates, or a container with more than one menu button)
  // situations bail out rather than risk touching the wrong listing.
  function ffmSafeCardMatchAndDelete(wantTitle, matchThreshold, searchTimeoutMs) {
    return new Promise(async (resolve) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const tokenize = (s) => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && t.length > 1);
      const overlap = (a, b) => {
        if (!a.length || !b.length) return 0;
        let hits = 0; a.forEach((t) => { if (b.includes(t)) hits++; });
        return hits / Math.max(a.length, b.length); // stricter than min(): penalizes partial/substring titles too
      };
      const MENU_SEL = 'div[aria-haspopup="menu"], div[role="button"][aria-label*="More" i], div[role="button"][aria-label*="Options" i], div[role="button"][aria-label*="Menu" i]';
      function isUsableButton(el) {
        let n = el;
        for (let i = 0; i < 8 && n && n.getAttribute; i++) {
          if (n.getAttribute('aria-disabled') === 'true') return false;
          if (n.getAttribute('aria-hidden') === 'true') return false;
          if (n.getAttribute('tabindex') === '-1') return false;
          n = n.parentElement;
        }
        return true;
      }
      function findCardContainer(titleBtn) {
        let node = titleBtn;
        for (let i = 0; i < 10 && node && node.parentElement; i++) {
          node = node.parentElement;
          const menuBtns = node.querySelectorAll(MENU_SEL);
          if (menuBtns.length === 1) return node;
          if (menuBtns.length > 1) return null; // ambiguous — overshot into a multi-listing container
        }
        return null;
      }
      function findByText(root, selectors, regex) {
        for (const sel of selectors) {
          const els = root.querySelectorAll(sel);
          for (const el of els) {
            if (!isUsableButton(el)) continue;
            if (regex.test((el.textContent || '').trim())) return el;
          }
        }
        return null;
      }
      function clickText(root, text) {
        const norm = (t) => (t || '').toLowerCase().trim();
        const buttons = Array.from(root.querySelectorAll('div[role="button"], button')).filter(isUsableButton);
        const spans = Array.from(root.querySelectorAll('span')).filter(isUsableButton);
        const pool = [...buttons, ...spans];
        const btn = pool.find((b) => norm(b.textContent) === text) || pool.find((b) => norm(b.textContent).includes(text));
        if (!btn) return false;
        try { btn.click(); } catch (e) { return false; }
        return true;
      }
      async function confirmDeleteModal(maxLoops) {
        for (let loop = 0; loop < maxLoops; loop++) {
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
          if (!dialogs.length) { await sleep(200); continue; }
          const modal = dialogs[dialogs.length - 1];
          await sleep(300);
          const text = (modal.textContent || '').toLowerCase();
          if (text.includes('did you sell this item')) {
            const decline = findByText(modal, ['span'], /^no[, ]?haven'?t sold/i) || findByText(modal, ['span'], /prefer not to/i);
            if (decline) { try { decline.click(); } catch (e) {} }
            else {
              const radio = modal.querySelector('input[type="radio"][value="DECLINE"]') || modal.querySelector('input[type="radio"]');
              if (radio) { try { radio.click(); } catch (e) {} }
            }
            await sleep(250);
            if (clickText(modal, 'next')) { await sleep(400); continue; }
          }
          if (clickText(modal, 'delete')) { await sleep(400); continue; }
          let clickedOther = false;
          for (const lbl of ['confirm', 'remove', 'yes, delete', 'delete item', 'continue']) {
            if (clickText(modal, lbl)) { clickedOther = true; break; }
          }
          if (clickedOther) { await sleep(400); continue; }
          await sleep(250);
        }
        return !document.querySelector('[role="dialog"]');
      }

      try {
        const wantTokens = tokenize(wantTitle);
        let bestBtn = null, bestScore = 0, ambiguous = false;
        const end = Date.now() + searchTimeoutMs;
        while (Date.now() < end) {
          const titleBtns = Array.from(document.querySelectorAll('div[role="button"][aria-label]'));
          let strongMatches = 0;
          for (const btn of titleBtns) {
            const label = btn.getAttribute('aria-label') || '';
            const score = overlap(wantTokens, tokenize(label));
            if (score >= matchThreshold) strongMatches++;
            if (score > bestScore) { bestScore = score; bestBtn = btn; }
          }
          ambiguous = strongMatches > 1;
          if (bestBtn && bestScore >= matchThreshold && !ambiguous) break;
          await sleep(300);
        }
        if (!bestBtn || bestScore < matchThreshold) { resolve({ found: false, deleted: false, reason: 'no-strict-match', bestScore }); return; }
        if (ambiguous) { resolve({ found: true, deleted: false, reason: 'ambiguous-multiple-strong-matches', bestScore }); return; }

        const card = findCardContainer(bestBtn);
        if (!card) { resolve({ found: true, deleted: false, reason: 'no-card-container', bestScore }); return; }

        const menuBtn = card.querySelector(MENU_SEL);
        if (!menuBtn) { resolve({ found: true, deleted: false, reason: 'no-menu-button', bestScore }); return; }
        try { menuBtn.click(); } catch (e) {}
        await sleep(500);

        let deleteOption = null;
        for (let i = 0; i < 10 && !deleteOption; i++) {
          deleteOption = findByText(document, ["div[role='menuitem']", "span[role='menuitem']", "li[role='menuitem']", "div[role='button']"], /delete/i);
          if (deleteOption) break;
          await sleep(250);
        }
        if (!deleteOption) { resolve({ found: true, deleted: false, reason: 'no-delete-menu-item', bestScore }); return; }
        try { deleteOption.click(); } catch (e) {}
        await sleep(300);

        const confirmed = await confirmDeleteModal(10);
        if (!confirmed) { resolve({ found: true, deleted: false, reason: 'modal-not-confirmed', bestScore }); return; }

        const removalDeadline = Date.now() + 15000;
        let removed = false;
        while (Date.now() < removalDeadline) {
          if (!document.body.contains(card) || card.offsetParent === null) { removed = true; break; }
          await sleep(300);
        }
        resolve({ found: true, deleted: removed, reason: removed ? 'ok' : 'card-not-removed', bestScore });
      } catch (e) {
        resolve({ found: false, deleted: false, reason: 'exception', error: String(e && e.message || e) });
      }
    });
  }

  // Checks Facebook directly for a live copy of this exact title and deletes
  // it if a strict, unambiguous match is found — before we click Publish.
  // Fully independent of AutoList Pro's own ffmDeleteListing/
  // ffmBeginDNRFlow_TitleFirst (see the big comment above
  // SAFE_DELETE_MATCH_THRESHOLD for why). Uses exactly ONE dedicated tab,
  // reused across the whole run.
  async function deleteFromFbIfPossiblyLive(displayTitle) {
    setStatus(`🔎 Checking Facebook for a live copy of "${displayTitle}" before publishing…`);
    try {
      const tabId = await ensureSafeCheckTab();
      if (!tabId) { setStatus(`⚠️ Could not open a tab to check "${displayTitle}" — proceeding to Publish without checking.`); return; }

      const url = 'https://www.facebook.com/marketplace/you/selling?title_search=' + encodeURIComponent(displayTitle);
      const loaded = await navigateAndWaitComplete(tabId, url, 25000);
      if (!loaded) { setStatus(`⚠️ Selling page didn't finish loading for "${displayTitle}" — proceeding to Publish without checking.`); return; }
      await sleep(SAFE_DELETE_NAV_SETTLE_MS);

      const capPromise = sleep(SAFE_DELETE_OVERALL_CAP_MS).then(() => ({ found: false, deleted: false, reason: 'overall-cap-reached' }));
      const execPromise = chrome.scripting.executeScript({
        target: { tabId },
        func: ffmSafeCardMatchAndDelete,
        args: [displayTitle, SAFE_DELETE_MATCH_THRESHOLD, SAFE_DELETE_SEARCH_TIMEOUT_MS]
      }).then((results) => (results && results[0] && results[0].result) || { found: false, deleted: false, reason: 'no-script-result' })
        .catch((e) => ({ found: false, deleted: false, reason: 'script-error', error: String(e && e.message || e) }));

      const result = await Promise.race([execPromise, capPromise]);

      if (result.deleted) {
        setStatus(`🗑️ Found and deleted a live copy of "${displayTitle}" on Facebook — proceeding to Publish.`);
      } else if (!result.found) {
        setStatus(`✅ No live copy of "${displayTitle}" found on Facebook (${result.reason}) — proceeding to Publish.`);
      } else {
        setStatus(`⚠️ Found a possible match for "${displayTitle}" but did not delete it (${result.reason}) — proceeding to Publish anyway. Check this one manually.`);
      }
    } catch (e) {
      try { console.error('[AutoList Pro AutoRun] deleteFromFbIfPossiblyLive failed', displayTitle, e); } catch (ee) {}
      setStatus(`⚠️ Facebook check for "${displayTitle}" failed unexpectedly — proceeding to Publish without checking.`);
    }
  }

  // AutoList Pro's own Publish flow can pop a "no local media, download & attach?"
  // prompt (#ffm-publish-media-prompt) mid-flow. Left alone it just waits
  // forever for a click that will never come during an unattended run, so
  // default to keeping the listing's real photos (Download & Attach) after a
  // short grace period.
  async function autoResolveMediaPromptIfNeeded() {
    await sleep(MEDIA_PROMPT_GRACE_MS);
    if (cancelRequested) return;
    const el = document.getElementById('ffm-publish-media-prompt');
    if (!el) return;
    const attachBtn = Array.from(el.querySelectorAll('button')).find((b) => /download.*attach/i.test(b.textContent || ''));
    if (attachBtn) { try { attachBtn.click(); } catch (e) {} }
  }

  // Called BEFORE every row's click. Lets automation tabs pile up freely —
  // does nothing at all until there are more than TAB_CAP of them — and only
  // then closes the OLDEST TABS_TO_CLOSE_WHEN_OVER_CAP, on the reasoning that
  // a tab still doing real work won't usually be among the very oldest ones
  // once a bunch have accumulated. Re-focuses the newest remaining tab
  // afterward so AutoList Pro's own next action still targets the right one.
  async function manageTabCap(displayTitle) {
    let tabs;
    try {
      tabs = await new Promise((r) => chrome.tabs.query({ url: AUTOMATION_TAB_PATTERNS }, r));
    } catch (e) { return; }
    if (!tabs || tabs.length <= TAB_CAP) return;

    setStatus(`🧹 More than ${TAB_CAP} tabs open — closing the oldest ${TABS_TO_CLOSE_WHEN_OVER_CAP} before starting "${displayTitle}".`);
    const oldestFirst = tabs.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
    const toClose = oldestFirst.slice(0, TABS_TO_CLOSE_WHEN_OVER_CAP).map((t) => t.id).filter((id) => typeof id === 'number');
    if (toClose.length) {
      try { await new Promise((r) => chrome.tabs.remove(toClose, r)); } catch (e) {}
    }

    try {
      const remaining = await new Promise((r) => chrome.tabs.query({ url: AUTOMATION_TAB_PATTERNS }, r));
      const newest = remaining && remaining.length ? remaining.slice().sort((a, b) => (b.id || 0) - (a.id || 0))[0] : null;
      if (newest && typeof newest.id === 'number') {
        await new Promise((r) => chrome.tabs.update(newest.id, { active: true }, r));
      }
    } catch (e) {}
  }

  // background.js only broadcasts 'dnr-complete' when the STORAGE flag
  // ffm_debuglog_enabled is true — without it the runner would never learn a
  // Delete/Relist finished. Flip just the storage flag on for the run and
  // restore it after.
  //
  // Popup_main.js's own 'dnr-complete' handlers (there are three call sites)
  // gate showing a "Report an Issue & Submit Debug Logs" modal
  // (ffmShowSupportModal) behind BOTH that storage flag AND the
  // #menu-debug-log-toggle checkbox's live DOM .checked state. An earlier
  // version of this file also checked that box to "keep it in sync" — that
  // was the actual bug: it satisfied both gates, so the modal popped up after
  // every single Delete/Relist during a run. Fixed by doing the opposite:
  // force the checkbox OFF for the whole run (regardless of the user's own
  // prior setting) so that modal never fires, while the storage flag alone
  // still lets the completion broadcast through.
  //
  // Reference-counted (not a plain save/restore pair) purely as a safety net
  // in case a second Start is ever clicked while a prior run is still
  // finishing up — harmless overkill now that the loop blocks per row, but
  // cheap insurance against that edge case.
  async function acquireDebugLogging() {
    debugHoldCount++;
    if (debugHoldCount > 1) {
      try { const chk = document.getElementById('menu-debug-log-toggle'); if (chk) chk.checked = false; } catch (e) {}
      return;
    }
    try {
      const cur = await new Promise((r) => chrome.storage.local.get(['ffm_debuglog_enabled'], r));
      originalDebugFlag = !!(cur && cur.ffm_debuglog_enabled);
      if (!originalDebugFlag) {
        await new Promise((r) => chrome.storage.local.set({ ffm_debuglog_enabled: true }, r));
      }
    } catch (e) {}
    try {
      const chk = document.getElementById('menu-debug-log-toggle');
      if (chk) { originalDebugCheckbox = chk.checked; chk.checked = false; }
    } catch (e) {}
  }
  async function releaseDebugLogging() {
    debugHoldCount = Math.max(0, debugHoldCount - 1);
    if (debugHoldCount > 0) return;
    try {
      if (originalDebugFlag === false) {
        await new Promise((r) => chrome.storage.local.set({ ffm_debuglog_enabled: false }, r));
      }
    } catch (e) {}
    try {
      if (originalDebugCheckbox !== null) {
        const chk = document.getElementById('menu-debug-log-toggle');
        if (chk) chk.checked = originalDebugCheckbox;
      }
    } catch (e) {}
    originalDebugFlag = null;
    originalDebugCheckbox = null;
  }

  // A caught exception somewhere in AutoList Pro's own click handlers can call the
  // native alert()/confirm() (e.g. "Delete failed. See console for details.").
  // Those are real blocking modal dialogs — while one is open, this whole
  // page's JS (our timers, our onMessage listener) is frozen, and dismissing
  // it manually is exactly the "error popup, then it never continues" symptom
  // reported. Suppress both for the duration of a run so an internal error
  // gets logged instead of freezing the batch; restore real dialogs after.
  function suppressBlockingDialogs() {
    savedAlert = window.alert;
    savedConfirm = window.confirm;
    window.alert = function (msg) { try { console.warn('[AutoList Pro AutoRun] suppressed alert() during run:', msg); } catch (e) {} };
    window.confirm = function (msg) { try { console.warn('[AutoList Pro AutoRun] suppressed confirm() during run, auto-declining:', msg); } catch (e) {} return false; };
  }
  function restoreBlockingDialogs() {
    if (savedAlert) window.alert = savedAlert;
    if (savedConfirm) window.confirm = savedConfirm;
    savedAlert = null; savedConfirm = null;
  }

  function setStatus(text) {
    const el = document.getElementById('ffmAutoRunStatus');
    if (el) el.textContent = text;
  }
  function setCounts(stats) {
    const el = document.getElementById('ffmAutoRunCount');
    if (!el) return;
    if (!stats.total) { el.textContent = ''; return; }
    el.textContent = `${stats.total} processed (${stats.done} confirmed published, ${stats.stuck} stuck/unconfirmed after ${PUBLISH_VERIFY_MAX_MS / 60000}min — check these, ${stats.skipped} already handled, ${stats.errored} errored)`;
  }

  // Walks rows top to bottom, clicking each one's action button and waiting
  // for waitForRealCompletion() to actually confirm it (or give up as
  // 'stuck') before moving to the next one. The permanent progress ledger
  // (PROGRESS_KEY) is the other half of the safety net: a given listing is
  // written into it BEFORE the click and is never clicked again this session
  // regardless of how that wait resolves.
  //
  // `mode` ('all' | 'publish' | 'dnr') restricts which rows are even eligible
  // to be picked as `next` below — a row whose current status doesn't match
  // is simply skipped over (not counted, not touched, not recorded), so
  // running in "Publish only" mode, say, leaves every Delete/Relist listing
  // completely untouched for a later pass.
  async function runLoop(mode, options) {
    const opts = options || {};
    const seenThisRun = new Set();
    const stats = { done: 0, stuck: 0, skipped: 0, errored: 0, total: 0 };

    while (!cancelRequested) {
      const rows = getRows();

      const next = rows.find((r) => {
        const key = idKey(rowIdentity(r));
        if (!key || seenThisRun.has(key)) return false;
        const btn = findActionButton(r);
        if (!btn || btn.disabled) return false;
        if (mode !== 'all') {
          const rowKind = /delete/i.test((btn.textContent || '').trim()) ? 'dnr' : 'publish';
          if (rowKind !== mode) return false;
        }
        return true;
      });
      if (!next) break;

      const id = rowIdentity(next);
      const key = idKey(id);
      const btn = findActionButton(next);
      const label = (btn.textContent || '').trim();
      const kind = /delete/i.test(label) ? 'dnr' : 'publish';
      const displayTitle = next.getAttribute('data-listing-title') || next.getAttribute('data-inventory-name') || key;

      seenThisRun.add(key);
      stats.total++;

      // Already touched by this auto-runner at some point (this run, an
      // earlier cancelled run, an earlier session — doesn't matter): never
      // act on it again on our own. This is the fix for "cancel then restart
      // redoes it" — no time window, no label-based guessing — and now that
      // there's no verification or tab gate either, this ledger is the WHOLE
      // safety net against ever clicking the same listing twice.
      if (progress[key]) {
        stats.skipped++;
        const prior = progress[key];
        setStatus(`⏭️ Skipping "${displayTitle}" — already ${prior.status === 'in-progress' ? 'attempted (interrupted last time)' : prior.status} by auto-run. Use "Retry Unfinished" if this needs another pass.`);
        setCounts(stats);
        await sleep(200);
        continue;
      }

      await manageTabCap(displayTitle);
      if (cancelRequested) break;

      // Record BEFORE clicking (and before the delete-check below, which
      // also touches this listing) — if anything throws or the panel closes
      // right after, the record already exists so nothing re-fires this row.
      progress[key] = { action: kind, status: 'in-progress', ts: Date.now(), title: displayTitle };
      await persistProgress();

      // Set only by startPublishSafe(). deleteFromFbIfPossiblyLive() now uses
      // a fully independent check (its own dedicated tab + strict matching),
      // not AutoList Pro's own delete mechanism — see its comment for why.
      if (kind === 'publish' && opts.preDeleteCheckForPublish) {
        await deleteFromFbIfPossiblyLive(displayTitle);
        if (cancelRequested) break;
      }

      setStatus(`${kind === 'dnr' ? '🔁 Deleting & relisting' : '📤 Publishing'}: ${displayTitle} — waiting at least ${ACTION_WAIT_MS / 1000}s`);

      try {
        const waitPromise = waitForRealCompletion(kind, id, displayTitle);
        btn.click();
        if (kind === 'publish') autoResolveMediaPromptIfNeeded();

        const result = await waitPromise;
        if (result === 'done') {
          stats.done++;
          progress[key] = { action: kind, status: 'done', ts: Date.now(), title: displayTitle };
        } else if (result === 'stuck') {
          stats.stuck++;
          progress[key] = { action: kind, status: 'stuck', ts: Date.now(), title: displayTitle };
        } else if (result === 'cancelled') {
          // Leave status as 'in-progress' — outcome genuinely unknown, so
          // "Retry Unfinished" surfaces it instead of guessing.
          await persistProgress();
          break;
        }
        await persistProgress();
      } catch (e) {
        stats.errored++;
        progress[key] = { action: kind, status: 'error', ts: Date.now(), title: displayTitle };
        await persistProgress();
        try { console.error('[AutoList Pro AutoRun] row failed, continuing to next listing', displayTitle, e); } catch (ee) {}
      }

      setCounts(stats);
      if (cancelRequested) break;
    }
    return stats;
  }

  // Shared setup/teardown for both entry points (the mode-dropdown Start
  // button, and the dedicated "Publish Only (safe delete-check)" button).
  // `label` is just what the initial status line says while starting.
  async function runBatch(mode, options, label) {
    if (running) return;
    if (!inSavedView()) { setStatus('Open "Saved Listings" first.'); return; }
    running = true;
    cancelRequested = false;
    const startBtn = document.getElementById('ffmAutoRunStart');
    const cancelBtn = document.getElementById('ffmAutoRunCancel');
    const modeSel = document.getElementById('ffmAutoRunMode');
    const retryBtn = document.getElementById('ffmAutoRunRetry');
    const publishSafeBtn = document.getElementById('ffmAutoRunPublishSafe');
    const dnrOnlyBtn = document.getElementById('ffmAutoRunDnrOnly');
    const resetAllBtn = document.getElementById('ffmAutoRunResetAll');
    if (startBtn) startBtn.disabled = true;
    if (modeSel) modeSel.disabled = true;
    if (retryBtn) retryBtn.disabled = true;
    if (publishSafeBtn) publishSafeBtn.disabled = true;
    if (dnrOnlyBtn) dnrOnlyBtn.disabled = true;
    if (resetAllBtn) resetAllBtn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = 'inline-block';
    setStatus(label);
    setCounts({ done: 0, stuck: 0, skipped: 0, errored: 0, total: 0 });

    await loadProgress();
    await acquireDebugLogging();
    suppressBlockingDialogs();
    let stats = null;
    try {
      stats = await runLoop(mode, options);
    } catch (e) {
      console.error('[AutoList Pro AutoRun] runLoop failed', e);
    } finally {
      restoreBlockingDialogs();
      await releaseDebugLogging();
      await closeSafeCheckTab();
      running = false;
      if (startBtn) startBtn.disabled = false;
      if (modeSel) modeSel.disabled = false;
      if (retryBtn) retryBtn.disabled = false;
      if (publishSafeBtn) publishSafeBtn.disabled = false;
      if (dnrOnlyBtn) dnrOnlyBtn.disabled = false;
      if (resetAllBtn) resetAllBtn.disabled = false;
      if (cancelBtn) cancelBtn.style.display = 'none';
    }

    if (stats) {
      const base = `${stats.done} confirmed published, ${stats.stuck} stuck/unconfirmed — check these, ${stats.skipped} already handled, ${stats.errored} errored (of ${stats.total} total)`;
      setStatus(cancelRequested ? `Cancelled — ${base}.` : `Finished — ${base}. Nothing left to process.`);
    } else {
      setStatus('Stopped (see console for error).');
    }
  }

  // Plain "Start Auto Process": whatever the mode dropdown says (defaults to
  // "all", i.e. every status) — no pre-delete-check.
  async function start() {
    const modeSel = document.getElementById('ffmAutoRunMode');
    const mode = modeSel ? modeSel.value : 'all';
    const label = mode === 'all' ? 'Starting…' : `Starting (${mode === 'publish' ? 'Publish' : 'Delete/Relist'} only)…`;
    await runBatch(mode, {}, label);
  }

  // Rebuilt 2026-07-17 as a fully independent implementation after AutoList Pro's
  // own shared ffmDeleteListing/ffmBeginDNRFlow_TitleFirst mechanism caused
  // two separate real incidents (stale staged-listing title hijack, then an
  // uncoordinated parallel fallback deleting a different, similarly-named
  // listing). See deleteFromFbIfPossiblyLive()'s comment for the new design.
  async function startPublishSafe() {
    await runBatch('publish', { preDeleteCheckForPublish: true }, 'Starting (Publish only, checking Facebook first)…');
  }

  // "Delete / Relist Only": the same underlying "dnr" mode already available
  // via the dropdown, exposed as its own button for parity with "Publish
  // Only" — every Publish-status listing is left completely untouched.
  async function startDnrOnly() {
    await runBatch('dnr', {}, 'Starting (Delete/Relist only)…');
  }

  function cancel() {
    if (!running) return;
    cancelRequested = true;
    setStatus('Cancelling…');
  }

  // Clears only the entries that never cleanly finished (timeout / error /
  // interrupted "in-progress"), leaving every confirmed 'done' listing alone
  // forever. This is the deliberate escape hatch — nothing here auto-retries
  // on its own.
  async function retryUnfinished() {
    await loadProgress();
    let cleared = 0;
    for (const key of Object.keys(progress)) {
      if (progress[key] && progress[key].status !== 'done') { delete progress[key]; cleared++; }
    }
    await persistProgress();
    setStatus(`Cleared ${cleared} unfinished record${cleared === 1 ? '' : 's'} — they'll be attempted again on the next Start.`);
  }

  // Full wipe, including entries marked 'done' — unlike Retry Unfinished,
  // this makes EVERY listing eligible to be clicked again on the next run.
  // Meant for "the ledger is full of noise from earlier testing, start
  // clean" — not something to reach for casually, since it also removes the
  // protection against re-clicking a listing that genuinely already
  // succeeded. Gated behind wireResetAllButton()'s two-click confirm.
  async function resetAllProgress() {
    progress = {};
    await persistProgress();
    setStatus('Cleared ALL progress records — every listing is eligible to be processed again on the next run.');
  }

  function wireButtons() {
    const startBtn = document.getElementById('ffmAutoRunStart');
    const cancelBtn = document.getElementById('ffmAutoRunCancel');
    const retryBtn = document.getElementById('ffmAutoRunRetry');
    const publishSafeBtn = document.getElementById('ffmAutoRunPublishSafe');
    const dnrOnlyBtn = document.getElementById('ffmAutoRunDnrOnly');
    if (startBtn && !startBtn._ffmWired) { startBtn._ffmWired = true; startBtn.addEventListener('click', start); }
    if (cancelBtn && !cancelBtn._ffmWired) { cancelBtn._ffmWired = true; cancelBtn.addEventListener('click', cancel); }
    if (retryBtn && !retryBtn._ffmWired) {
      retryBtn._ffmWired = true;
      retryBtn.addEventListener('click', () => {
        if (running) return;
        retryUnfinished();
      });
    }
    if (publishSafeBtn && !publishSafeBtn._ffmWired) {
      publishSafeBtn._ffmWired = true;
      publishSafeBtn.addEventListener('click', startPublishSafe);
    }
    if (dnrOnlyBtn && !dnrOnlyBtn._ffmWired) {
      dnrOnlyBtn._ffmWired = true;
      dnrOnlyBtn.addEventListener('click', startDnrOnly);
    }

    const resetAllBtn = document.getElementById('ffmAutoRunResetAll');
    if (resetAllBtn && !resetAllBtn._ffmWired) {
      resetAllBtn._ffmWired = true;
      // Deliberately does NOT change the button's own text — an earlier
      // version did, and the much longer "click again" text widened the
      // button enough to reflow every button after it in the row. A second
      // click at the same screen position then landed on whatever button had
      // shifted into that spot instead (confirmed by the user: it landed on
      // "Publish Only"). Uses a fixed-size highlight (outline) plus the
      // status line instead, so the button's own box never changes size.
      let armed = false;
      let armTimer = null;
      resetAllBtn.addEventListener('click', () => {
        if (running) return;
        if (!armed) {
          armed = true;
          resetAllBtn.style.outline = '3px solid #d9534f';
          setStatus('⚠️ Click "Reset All Progress" again within 5 seconds to confirm — this clears EVERYTHING, including listings already confirmed done.');
          armTimer = setTimeout(() => {
            armed = false;
            resetAllBtn.style.outline = '';
            setStatus('Reset All Progress cancelled (no click within 5 seconds).');
          }, 5000);
          return;
        }
        armed = false;
        clearTimeout(armTimer);
        resetAllBtn.style.outline = '';
        resetAllProgress();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }
})();
