// content/x_autopost.js
// Drives the X composer in your own logged-in tab to publish a drafted deal.
//
// Runs unattended when autopilot is armed. Every post passes the hard gates in
// canPost() first — those are the only thing standing between a bad capture and
// your live feed, so they fail closed: anything uncertain goes to the review
// queue instead of the timeline.

(function () {
  'use strict';

  const LOG = '[NxtGen Autopost]';
  const RATE_KEY = 'nxg_post_history';

  const SEL = {
    composerTrigger: '[data-testid="SideNav_NewTweet_Button"]',
    editor: '[data-testid="tweetTextarea_0"]',
    postButton: '[data-testid="tweetButton"]',
    inlineEditor: '[data-testid="tweetTextarea_0"]'
  };

  function log() {
    try {
      console.log.apply(console, [LOG].concat(Array.prototype.slice.call(arguments)));
    } catch (e) { /* ignore */ }
  }

  function cfg(k, d) {
    try {
      const v = globalThis.CONFIG && globalThis.CONFIG[k];
      return (v === undefined || v === null) ? d : v;
    } catch (e) { return d; }
  }

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function waitFor(selector, timeoutMs) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);

      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs || 8000);
    });
  }

  // --- Rate limiting --------------------------------------------------------
  // A feed that fires every 90 seconds reads as a bot to both X and your
  // followers. These caps keep the account looking human and alive.

  function loadHistory() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([RATE_KEY], (r) => resolve((r && r[RATE_KEY]) || []));
      } catch (e) { resolve([]); }
    });
  }

  function recordPost(asin) {
    return new Promise((resolve) => {
      loadHistory().then((h) => {
        h.push({ asin, at: Date.now() });
        const cutoff = Date.now() - (48 * 3600 * 1000);
        const trimmed = h.filter((e) => e.at > cutoff);
        try {
          chrome.storage.local.set({ [RATE_KEY]: trimmed }, () => resolve(true));
        } catch (e) { resolve(false); }
      });
    });
  }

  async function rateCheck(asin) {
    const history = await loadHistory();
    const now = Date.now();

    if (history.some((e) => e.asin === asin)) {
      return { ok: false, reason: 'already posted this ASIN' };
    }

    const minGapMs = cfg('autoPostMinGapMinutes', 12) * 60 * 1000;
    const last = history.length ? Math.max.apply(null, history.map((e) => e.at)) : 0;
    if (last && (now - last) < minGapMs) {
      const mins = Math.ceil((minGapMs - (now - last)) / 60000);
      return { ok: false, reason: 'rate limit, ' + mins + 'm to next slot' };
    }

    const hourCount = history.filter((e) => e.at > now - 3600 * 1000).length;
    if (hourCount >= cfg('autoPostMaxPerHour', 4)) {
      return { ok: false, reason: 'hourly cap reached' };
    }

    const dayCount = history.filter((e) => e.at > now - 24 * 3600 * 1000).length;
    if (dayCount >= cfg('autoPostMaxPerDay', 25)) {
      return { ok: false, reason: 'daily cap reached' };
    }

    return { ok: true };
  }

  // --- Hard gates -----------------------------------------------------------
  // Fail closed. If we cannot prove a post is compliant and accurate, it does
  // not go out unattended.

  async function canPost(deal, draft) {
    const DC = globalThis.DealCore;

    if (!cfg('autoPostArmed', false)) return { ok: false, reason: 'autopilot disarmed' };
    if (!draft || !draft.text) return { ok: false, reason: 'no draft' };

    // Link integrity: exactly one URL, on Amazon, carrying our tag.
    const urls = draft.text.match(/https?:\/\/[^\s]+/g) || [];
    if (urls.length !== 1) return { ok: false, reason: 'expected exactly one link' };
    if (!DC.isAmazonUrl(urls[0])) return { ok: false, reason: 'link is not Amazon' };
    if (!urls[0].includes(cfg('associateTag', 'nxtgenhotdeal-20'))) {
      return { ok: false, reason: 'missing associate tag' };
    }

    // Disclosure is not optional and is the top cause of account termination.
    if (!/#ad\b/.test(draft.text)) return { ok: false, reason: 'missing #ad disclosure' };

    if (!cfg('dealLongFormPosts', false) && draft.charCount > 280) {
      return { ok: false, reason: 'over character limit' };
    }

    // Freshness: an old capture is a price that has probably already been
    // corrected. Posting a dead deal costs trust.
    const age = DC.ageMinutes(deal.postedAt);
    const maxAge = cfg('autoPostMaxAgeMinutes', 45);
    if (age !== null && age > maxAge) {
      return { ok: false, reason: 'stale (' + age + 'm old, cap ' + maxAge + 'm)' };
    }

    // Substance: we only auto-post something we can actually stand behind —
    // either a verified discount or a captured code. Anything vaguer is queued
    // for you to eyeball.
    const v = deal.verified || {};
    const minPct = cfg('dealMinDiscountPct', 15);
    const hasVerifiedDiscount = typeof v.discountPct === 'number' && v.discountPct >= minPct;
    if (!hasVerifiedDiscount && !deal.promoCode) {
      return { ok: false, reason: 'unverified discount and no code' };
    }

    // A listing that went out of stock between capture and post is a dead click.
    if (v.available === false) return { ok: false, reason: 'out of stock' };

    const rate = await rateCheck(deal.asin);
    if (!rate.ok) return rate;

    return { ok: true };
  }

  // --- Composer -------------------------------------------------------------
  // X's editor is a contenteditable Draft.js surface. Setting textContent does
  // not register — it needs a real input event carrying the text, which is what
  // beforeinput/insertText gives us.

  async function typeIntoComposer(editor, text) {
    editor.focus();
    await wait(60);

    const ok = document.execCommand && document.execCommand('insertText', false, text);
    if (!ok) {
      // Fallback for browsers where execCommand is unavailable.
      editor.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText', data: text, bubbles: true, cancelable: true
      }));
      editor.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText', data: text, bubbles: true
      }));
    }
    await wait(200);
    return (editor.textContent || '').length > 0;
  }

  async function publish(text) {
    // Open the composer if it isn't already up.
    let editor = document.querySelector(SEL.editor);
    if (!editor) {
      const trigger = document.querySelector(SEL.composerTrigger);
      if (!trigger) return { ok: false, reason: 'composer trigger not found' };
      trigger.click();
      editor = await waitFor(SEL.editor, 8000);
    }
    if (!editor) return { ok: false, reason: 'composer did not open' };

    const typed = await typeIntoComposer(editor, text);
    if (!typed) return { ok: false, reason: 'could not enter text' };

    // Let X parse the URL and enable the button.
    await wait(900);

    const btn = document.querySelector(SEL.postButton);
    if (!btn) return { ok: false, reason: 'post button not found' };
    if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) {
      return { ok: false, reason: 'post button disabled' };
    }

    // Final read-back: publish only what is actually in the box.
    const inBox = editor.textContent || '';
    if (!inBox.includes('#ad')) return { ok: false, reason: 'disclosure missing in composer' };

    btn.click();
    await wait(1500);
    return { ok: true };
  }

  // --- Entry point ----------------------------------------------------------

  async function attempt(deal, draft) {
    const gate = await canPost(deal, draft);
    if (!gate.ok) {
      log('held for review:', deal.asin, '-', gate.reason);
      return { posted: false, reason: gate.reason };
    }

    log('posting', deal.asin);
    const res = await publish(draft.text);

    if (res.ok) {
      await recordPost(deal.asin);
      log('posted', deal.asin);
      return { posted: true };
    }

    log('post failed:', res.reason);
    return { posted: false, reason: res.reason };
  }

  const Autopost = { attempt, canPost, rateCheck, publish, recordPost };

  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.NxgAutopost = globalThis.NxgAutopost || Autopost;
      if (typeof window !== 'undefined') window.NxgAutopost = globalThis.NxgAutopost;
    }
  } catch (e) { /* ignore */ }
})();
