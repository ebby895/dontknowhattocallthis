// lib/deal_core.js
// Shared primitives for the NxtGen Deal Engine: Amazon domain gating, ASIN
// extraction, affiliate link construction, and promo-code parsing.
//
// Loaded in both the x.com content script and the extension popup, so it must
// stay dependency-free and side-effect-free apart from the globalThis export
// at the bottom (same pattern as config.js).

(function () {
  'use strict';

  // Hosts that count as "ends at Amazon". A redirect chain terminating on any
  // of these passes the gate; everything else (Walmart, Target, Best Buy, the
  // intermediate redirector itself) is dropped.
  const AMAZON_HOSTS = [
    'amazon.com',
    'www.amazon.com',
    'smile.amazon.com',
    'amzn.to',
    'amzn.com',
    'a.co'
  ];

  // Redirectors seen in deal-poster bios and posts. We follow them to find the
  // destination, but they never appear in anything we publish.
  const KNOWN_REDIRECTORS = [
    'hiddenclearances.com',
    'bit.ly',
    'tinyurl.com',
    'linktr.ee',
    'geni.us',
    'shrsl.com',
    'sovrn.co',
    'howl.link',
    't.co'
  ];

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  function isAmazonUrl(url) {
    const h = hostOf(url);
    if (!h) return false;
    return AMAZON_HOSTS.some((a) => {
      const base = a.replace(/^www\./, '');
      return h === base || h.endsWith('.' + base);
    });
  }

  function isKnownRedirector(url) {
    const h = hostOf(url);
    if (!h) return false;
    return KNOWN_REDIRECTORS.some((r) => h === r || h.endsWith('.' + r));
  }

  // ASIN is a 10-char alphanumeric product key. Pull it from any of the URL
  // shapes Amazon serves.
  const ASIN_PATTERNS = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/ASIN\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /[?&]asin=([A-Z0-9]{10})(?:&|$)/i
  ];

  function extractAsin(url) {
    if (!url) return null;
    for (const re of ASIN_PATTERNS) {
      const m = url.match(re);
      if (m && m[1]) return m[1].toUpperCase();
    }
    return null;
  }

  // Build the only link shape we publish: canonical /dp/ path, our tag, nothing
  // else. No shorteners, no redirect hops — Amazon's policies bar placements
  // that obscure the fact you're linking to Amazon, and a bare /dp/ URL is
  // unambiguous.
  function buildAffiliateUrl(asin, tag) {
    if (!asin || !tag) return null;
    return 'https://www.amazon.com/dp/' + asin + '?tag=' + encodeURIComponent(tag);
  }

  // Strip any foreign associate tag off a URL. Prevents us ever republishing a
  // link that still credits the account we sourced the deal from.
  function stripForeignTag(url) {
    try {
      const u = new URL(url);
      ['tag', 'ascsubtag', 'linkCode', 'linkId', 'ref_', 'creative', 'camp']
        .forEach((p) => u.searchParams.delete(p));
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  // Promo / clip codes as they appear in deal posts. Amazon codes are typically
  // 6-12 chars, uppercase alphanumeric, and usually introduced by a keyword.
  // The keyword is matched case-insensitively but the code itself is not: real
  // Amazon codes are uppercase, and matching the token case-insensitively turns
  // ordinary prose ("no code needed") into a fabricated code.
  const CODE_PATTERNS = [
    /(?:promo\s*code|PROMO\s*CODE|Promo\s*Code)[:\s]+([A-Z0-9]{5,15})\b/,
    /(?:code|CODE|Code)[:\s]+([A-Z0-9]{5,15})\b/,
    /(?:coupon|COUPON|Coupon)[:\s]+([A-Z0-9]{5,15})\b/,
    /(?:use|USE|Use)[:\s]+([A-Z0-9]{5,15})\s+(?:at\s+checkout|AT\s+CHECKOUT)\b/
  ];

  // Uppercase words that appear next to the keyword in deal posts and are not
  // codes. A token containing a digit is always treated as a code.
  const CODE_STOPWORDS = new Set([
    'CHECKOUT', 'TODAY', 'ONLY', 'NEEDED', 'REQUIRED', 'APPLIED', 'AUTO',
    'PRIME', 'STACK', 'STACKS', 'LIMITED', 'EXPIRES', 'COUPON', 'PROMO',
    'AMAZON', 'DEALS', 'SALE', 'OFFER', 'CLIP', 'CART', 'PRICE', 'FREE',
    'SHIPS', 'BELOW', 'ABOVE', 'AFTER', 'ORDER', 'ITEMS'
  ]);

  // Returning null is always safe - the copy falls back to "price is live on
  // the listing". Returning a word that is not a code is not: it puts a
  // fabricated instruction in front of buyers.
  function extractPromoCode(text) {
    if (!text) return null;
    for (const re of CODE_PATTERNS) {
      const m = text.match(re);
      if (!m || !m[1]) continue;
      const code = m[1].toUpperCase();
      if (CODE_STOPWORDS.has(code)) continue;
      if (!/\d/.test(code) && code.length < 6) continue;
      return code;
    }
    return null;
  }

  // Detect the discount mechanic so the generated copy tells the buyer what to
  // actually do. Order matters: a post can mention several, we take the most
  // specific.
  function detectMechanic(text) {
    if (!text) return 'deal';
    const t = text.toLowerCase();
    if (/\bclip\b.*\bcoupon\b|\bcoupon\b.*\bclip\b/.test(t)) return 'clip_coupon';
    if (/\bat checkout\b|\bapply code\b|\bpromo code\b|\bcode\b/.test(t)) return 'checkout_code';
    if (/\blightning deal\b/.test(t)) return 'lightning';
    if (/\bsubscribe\s*(&|and)\s*save\b/.test(t)) return 'subscribe_save';
    if (/\bprime\b.*\bexclusive\b/.test(t)) return 'prime_exclusive';
    if (/\bprice drop\b|\ball[- ]time low\b/.test(t)) return 'price_drop';
    return 'deal';
  }

  // Prices as written in deal posts: $211.05, $1,299.99
  function extractPrices(text) {
    if (!text) return [];
    const out = [];
    const re = /\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(v)) out.push(v);
    }
    return out;
  }

  // Post age drives the urgency line. Promo pricing gets corrected fast, so a
  // deal's freshness is the single most useful ranking signal we have.
  function ageMinutes(isoTimestamp) {
    try {
      const then = new Date(isoTimestamp).getTime();
      if (isNaN(then)) return null;
      return Math.max(0, Math.round((Date.now() - then) / 60000));
    } catch (e) {
      return null;
    }
  }

  function formatAge(mins) {
    if (mins === null || mins === undefined) return 'just now';
    if (mins < 1) return 'seconds ago';
    if (mins < 60) return mins + 'm ago';
    const h = Math.floor(mins / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  const DealCore = {
    AMAZON_HOSTS,
    KNOWN_REDIRECTORS,
    hostOf,
    isAmazonUrl,
    isKnownRedirector,
    extractAsin,
    buildAffiliateUrl,
    stripForeignTag,
    extractPromoCode,
    detectMechanic,
    extractPrices,
    ageMinutes,
    formatAge
  };

  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.DealCore = globalThis.DealCore || DealCore;
      if (typeof window !== 'undefined') window.DealCore = globalThis.DealCore;
    }
  } catch (e) { /* ignore */ }
})();
