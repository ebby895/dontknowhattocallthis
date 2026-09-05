// lib/deal_copy.js
// Generates original post copy for a captured deal.
//
// The source post tells us WHICH product is discounted and HOW to claim it.
// The words we publish are our own — rotating templates so the feed doesn't
// read like a bot, and so we're not republishing another affiliate's creative.

(function () {
  'use strict';

  const DISCLOSURE_SHORT = '#ad';
  const DISCLOSURE_FULL = 'As an Amazon Associate I earn from qualifying purchases.';

  const X_LIMIT_STANDARD = 280;

  // --- Hooks: the first line, which is what stops the scroll ----------------

  const HOOKS = {
    clip_coupon: [
      'The coupon is sitting right there on the page and most people scroll past it.',
      'One checkbox on the listing knocks this down. Blink and it is gone.',
      'Clip the coupon before you add to cart — that is the whole trick.'
    ],
    checkout_code: [
      'The listing price is not the real price. The code does the work.',
      'Looks full price until the code lands at checkout.',
      'Add the code at checkout and watch the total drop.'
    ],
    lightning: [
      'Lightning deal — this one is on a clock, not a stock count.',
      'Timer is already running on this one.',
      'Lightning deals do not come back. This is the window.'
    ],
    price_drop: [
      'This just hit a price I have not seen it at before.',
      'Price dropped hard on this one overnight.',
      'Lowest this has been in months.'
    ],
    subscribe_save: [
      'Subscribe & Save stacks on top of this one. Cancel after the first order.',
      'The S&S discount stacks here — that is where the real number is.'
    ],
    prime_exclusive: [
      'Prime-exclusive pricing on this one.',
      'Prime members are seeing a very different number here.'
    ],
    deal: [
      'This price will not hold.',
      'Found this one while it is still live.',
      'Good price on this right now.'
    ]
  };

  // --- Instructions: tell the buyer exactly what to do ---------------------

  const INSTRUCTIONS = {
    clip_coupon: 'Tick the coupon box on the listing, then check out.',
    checkout_code: 'Apply code {CODE} at checkout.',
    lightning: 'Add to cart now — lightning deals release the cart if you stall.',
    price_drop: 'No code needed, the price is live on the listing.',
    subscribe_save: 'Choose Subscribe & Save at checkout, cancel any time after it ships.',
    prime_exclusive: 'Sign in with Prime to see the discounted price.',
    deal: 'Price is live on the listing.'
  };

  // --- Urgency: anchored to how long the deal has actually been out --------

  function urgencyLine(ageMinutes) {
    if (ageMinutes === null || ageMinutes === undefined) {
      return 'These get corrected fast — check the price before you commit.';
    }
    if (ageMinutes < 15) {
      return 'Live for ' + ageMinutes + ' minutes. This is as early as you get.';
    }
    if (ageMinutes < 60) {
      return 'Been live ' + ageMinutes + ' minutes. Amazon usually catches these same-day.';
    }
    if (ageMinutes < 180) {
      const h = Math.floor(ageMinutes / 60);
      return 'Running ' + h + (h === 1 ? ' hour' : ' hours') + ' now — the clock is against this one.';
    }
    const h = Math.floor(ageMinutes / 60);
    if (h < 24) {
      return h + ' hours in. Verify the price still holds before you buy.';
    }
    return 'Older deal — confirm the price is still live before you commit.';
  }

  // --- Savings math: only from numbers we actually have --------------------

  function savingsLine(deal) {
    const prices = (deal.pricesInPost || []).slice().sort((a, b) => a - b);
    const verified = deal.verified || {};

    // Prefer verified live pricing over anything claimed in the source post.
    const now = typeof verified.currentPrice === 'number' ? verified.currentPrice : null;
    const was = typeof verified.referencePrice === 'number' ? verified.referencePrice : null;

    if (now !== null && was !== null && was > now) {
      const pct = Math.round(((was - now) / was) * 100);
      return '$' + now.toFixed(2) + ' (was $' + was.toFixed(2) + ') — ' + pct + '% off.';
    }
    if (now !== null) {
      return '$' + now.toFixed(2) + ' right now.';
    }
    // Unverified: state nothing as fact. Amazon bars claiming discounts or
    // prices you haven't confirmed, and a wrong number costs you trust.
    if (prices.length >= 2) {
      return 'Big gap between list and checkout price — see the listing for the live number.';
    }
    return 'Live price is on the listing.';
  }

  function pick(arr, seed) {
    if (!arr || !arr.length) return '';
    const i = Math.abs(hash(seed || '')) % arr.length;
    return arr[i];
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return h;
  }

  // --- Composition ---------------------------------------------------------

  function generate(deal, opts) {
    opts = opts || {};
    const DC = globalThis.DealCore;
    const mechanic = deal.mechanic || 'deal';
    const longForm = !!opts.longForm; // X Premium allows >280

    const title = (deal.verified && deal.verified.title) || deal.productTitle || '';
    const hook = pick(HOOKS[mechanic] || HOOKS.deal, deal.asin + mechanic);

    let instruction = INSTRUCTIONS[mechanic] || INSTRUCTIONS.deal;
    if (deal.promoCode) {
      instruction = instruction.replace('{CODE}', deal.promoCode);
    } else if (instruction.includes('{CODE}')) {
      instruction = INSTRUCTIONS.deal;
    }

    const age = typeof deal.ageMinutesNow === 'number'
      ? deal.ageMinutesNow
      : deal.ageMinutesAtCapture;

    const link = deal.affiliateUrl ||
      (DC ? DC.buildAffiliateUrl(deal.asin, tag()) : '');

    const parts = [];
    parts.push(hook);
    if (title) parts.push(shorten(title, longForm ? 120 : 70));
    parts.push(savingsLine(deal));
    parts.push(instruction);
    parts.push(urgencyLine(age));
    parts.push(link);
    parts.push(longForm ? DISCLOSURE_SHORT + ' ' + DISCLOSURE_FULL : DISCLOSURE_SHORT);

    let body = parts.filter(Boolean).join('\n\n');

    // Trim to fit standard X limits without ever dropping the link or the
    // disclosure — those two are non-negotiable.
    if (!longForm && charCount(body) > X_LIMIT_STANDARD) {
      body = compact(hook, title, deal, instruction, age, link);
    }

    return {
      text: body,
      link: link,
      asin: deal.asin,
      mechanic: mechanic,
      promoCode: deal.promoCode || null,
      charCount: charCount(body),
      overLimit: charCount(body) > X_LIMIT_STANDARD,
      disclosureIncluded: body.includes(DISCLOSURE_SHORT)
    };
  }

  // Tight variant when the full layout overruns the character limit.
  function compact(hook, title, deal, instruction, age, link) {
    const bits = [];
    bits.push(hook);
    if (title) bits.push(shorten(title, 45));
    bits.push(savingsLine(deal));
    if (deal.promoCode) bits.push('Code: ' + deal.promoCode);
    const u = age !== null && age !== undefined && age < 180
      ? 'Live ' + (age < 60 ? age + 'm' : Math.floor(age / 60) + 'h') + ' — moves fast.'
      : 'Verify price before buying.';
    bits.push(u);
    bits.push(link);
    bits.push(DISCLOSURE_SHORT);
    return bits.filter(Boolean).join('\n');
  }

  function shorten(s, n) {
    if (!s) return '';
    s = s.trim().replace(/\s+/g, ' ');
    return s.length <= n ? s : s.slice(0, n - 1).trim() + '…';
  }

  // X counts a URL as a fixed 23 characters regardless of real length.
  function charCount(text) {
    if (!text) return 0;
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    let n = text.length;
    urls.forEach((u) => { n = n - u.length + 23; });
    return n;
  }

  function tag() {
    try {
      return (globalThis.CONFIG && globalThis.CONFIG.associateTag) || 'nxtgenhotdeal-20';
    } catch (e) { return 'nxtgenhotdeal-20'; }
  }

  // Produce several angles for the same deal so you can pick the strongest.
  function variants(deal, count) {
    count = count || 3;
    const out = [];
    const mech = deal.mechanic || 'deal';
    const hooks = HOOKS[mech] || HOOKS.deal;
    for (let i = 0; i < Math.min(count, hooks.length); i++) {
      const seeded = Object.assign({}, deal, { asin: deal.asin + '#' + i });
      const v = generate(seeded, {});
      v.asin = deal.asin;
      out.push(v);
    }
    return out;
  }

  const DealCopy = {
    generate,
    variants,
    charCount,
    urgencyLine,
    savingsLine,
    DISCLOSURE_SHORT,
    DISCLOSURE_FULL
  };

  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.DealCopy = globalThis.DealCopy || DealCopy;
      if (typeof window !== 'undefined') window.DealCopy = globalThis.DealCopy;
    }
  } catch (e) { /* ignore */ }
})();
