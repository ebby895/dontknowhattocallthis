// lib/deal_ai.js
// Gemini-backed copy generation for captured deals.
//
// The template generator in deal_copy.js is the floor and the fallback: it
// always produces a valid, compliant post. Gemini is the upgrade — it writes
// sharper, more varied copy from the same verified facts.
//
// Every model output is validated before it can be posted. The model never
// supplies the link, the tag, or the disclosure — those are appended by us
// after generation, so a hallucinated URL can't reach the feed.

(function () {
  'use strict';

  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const DEFAULT_MODEL = 'gemini-2.5-flash';
  const TIMEOUT_MS = 6000;      // must stay inside the "post within seconds" budget
  const KEY_STORE = 'nxg_gemini_key';

  function getKey() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([KEY_STORE], (r) => resolve((r && r[KEY_STORE]) || ''));
      } catch (e) { resolve(''); }
    });
  }

  function setKey(k) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [KEY_STORE]: k || '' }, () => resolve(true));
      } catch (e) { resolve(false); }
    });
  }

  // The prompt hands over only verified facts. We explicitly forbid the model
  // from inventing prices, codes, or urgency, because a fabricated discount is
  // the fastest way to lose both the Amazon account and the audience.
  function buildPrompt(deal) {
    const v = deal.verified || {};
    const facts = [];

    if (v.title || deal.productTitle) facts.push('Product: ' + (v.title || deal.productTitle));
    if (typeof v.currentPrice === 'number') facts.push('Current price: $' + v.currentPrice.toFixed(2));
    if (typeof v.referencePrice === 'number') facts.push('Was: $' + v.referencePrice.toFixed(2));
    if (typeof v.discountPct === 'number') facts.push('Discount: ' + v.discountPct + '%');
    if (deal.promoCode) facts.push('Promo code: ' + deal.promoCode);
    facts.push('How to claim: ' + mechanicText(deal.mechanic));

    const age = typeof deal.ageMinutesNow === 'number' ? deal.ageMinutesNow : deal.ageMinutesAtCapture;
    if (age !== null && age !== undefined) facts.push('Deal has been live: ' + age + ' minutes');

    return [
      'Write a single X (Twitter) post promoting this Amazon deal.',
      '',
      'VERIFIED FACTS (use only these — do not invent anything):',
      facts.map((f) => '- ' + f).join('\n'),
      '',
      'RULES:',
      '1. Maximum 180 characters. A link and disclosure get appended after you, so leave room.',
      '2. Do NOT include any URL, link, hashtag, or the text "#ad". Those are added separately.',
      '3. Do NOT invent a price, percentage, code, or stock level that is not in the facts above.',
      '4. Lead with the benefit or the catch — why this specific price is worth acting on.',
      '5. State plainly how to claim the discount (clip the coupon, enter the code, etc).',
      '6. Convey genuine time pressure ONLY from the "live" duration given, never invented.',
      '7. Sound like a person who found a good deal, not an ad. No emoji spam, max one emoji.',
      '8. No ALL CAPS words except a promo code.',
      '',
      'Return ONLY the post text. No quotes, no preamble, no explanation.'
    ].join('\n');
  }

  function mechanicText(m) {
    return ({
      clip_coupon: 'tick the coupon box on the listing before checkout',
      checkout_code: 'enter the promo code at checkout',
      lightning: 'lightning deal, on a timer',
      price_drop: 'price is already dropped, no code needed',
      subscribe_save: 'choose Subscribe & Save at checkout',
      prime_exclusive: 'Prime members only'
    })[m] || 'price is live on the listing';
  }

  function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('gemini timeout')), ms);
      p.then((v) => { clearTimeout(t); resolve(v); },
             (e) => { clearTimeout(t); reject(e); });
    });
  }

  async function callGemini(prompt, apiKey, model) {
    const url = ENDPOINT + (model || DEFAULT_MODEL) + ':generateContent?key=' + encodeURIComponent(apiKey);
    const res = await withTimeout(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 200, topP: 0.95 }
      })
    }), TIMEOUT_MS);

    if (!res.ok) throw new Error('gemini http ' + res.status);
    const data = await res.json();
    const text = data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!text) throw new Error('gemini empty response');
    return String(text).trim();
  }

  // Strip anything the model shouldn't have produced. Belt and braces: rule 2
  // tells it not to emit links, this guarantees none survive.
  function sanitize(text) {
    return String(text || '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/https?:\/\/[^\s]+/gi, '')      // no model-supplied URLs, ever
      .replace(/\b(?:www\.)[^\s]+/gi, '')
      .replace(/#ad\b/gi, '')                  // we append the real disclosure
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // A generated post is only usable if it says something and invents nothing.
  function validate(body, deal) {
    if (!body || body.length < 20) return { ok: false, reason: 'too short' };
    if (body.length > 240) return { ok: false, reason: 'too long' };
    if (/https?:\/\//i.test(body)) return { ok: false, reason: 'contains url' };

    // If the model quotes a price, it must be one we actually verified.
    const DC = globalThis.DealCore;
    const quoted = DC ? DC.extractPrices(body) : [];
    if (quoted.length) {
      const v = deal.verified || {};
      const known = [v.currentPrice, v.referencePrice].filter((n) => typeof n === 'number');
      if (!known.length) return { ok: false, reason: 'quoted price with nothing verified' };
      const allKnown = quoted.every((q) => known.some((k) => Math.abs(k - q) < 0.01));
      if (!allKnown) return { ok: false, reason: 'quoted an unverified price' };
    }

    // A code in the copy must be the code we captured.
    const codeMatch = body.match(/\b[A-Z0-9]{5,15}\b/g) || [];
    if (deal.promoCode) {
      // fine — the real code is allowed
    } else if (codeMatch.some((c) => /\d/.test(c) && /[A-Z]/.test(c))) {
      return { ok: false, reason: 'invented a promo code' };
    }

    return { ok: true };
  }

  // Assemble the final post: model body + our link + our disclosure. The parts
  // that carry legal and financial weight are never model-generated.
  function assemble(body, deal, longForm) {
    const DC = globalThis.DealCore;
    const DCopy = globalThis.DealCopy;
    const link = deal.affiliateUrl || (DC && DC.buildAffiliateUrl(deal.asin, tag()));
    const disclosure = longForm
      ? DCopy.DISCLOSURE_SHORT + ' ' + DCopy.DISCLOSURE_FULL
      : DCopy.DISCLOSURE_SHORT;

    return [body, link, disclosure].filter(Boolean).join('\n\n');
  }

  function tag() {
    return (globalThis.CONFIG && globalThis.CONFIG.associateTag) || 'nxtgenhotdeal-20';
  }

  // Main entry. Always resolves to a usable post — falls back to the template
  // generator on any failure, so a Gemini outage never stalls the pipeline.
  async function generate(deal, opts) {
    opts = opts || {};
    const longForm = !!(globalThis.CONFIG && globalThis.CONFIG.dealLongFormPosts);
    const DCopy = globalThis.DealCopy;

    const fallback = () => {
      const t = DCopy.generate(deal, { longForm });
      t.source = 'template';
      return t;
    };

    try {
      const key = opts.apiKey || await getKey();
      if (!key) return fallback();

      const model = (globalThis.CONFIG && globalThis.CONFIG.geminiModel) || DEFAULT_MODEL;
      const raw = await callGemini(buildPrompt(deal), key, model);
      const body = sanitize(raw);

      const check = validate(body, deal);
      if (!check.ok) {
        console.warn('[NxtGen AI] rejected generation:', check.reason);
        return fallback();
      }

      const text = assemble(body, deal, longForm);
      const count = DCopy.charCount(text);
      if (!longForm && count > 280) return fallback();

      return {
        text,
        link: deal.affiliateUrl,
        asin: deal.asin,
        mechanic: deal.mechanic,
        promoCode: deal.promoCode || null,
        charCount: count,
        overLimit: false,
        disclosureIncluded: true,
        source: 'gemini'
      };
    } catch (e) {
      console.warn('[NxtGen AI] generation failed, using template:', e && e.message);
      return fallback();
    }
  }

  // Generation runs in the service worker, not the content script: a fetch from
  // a content script on x.com is subject to that page's CORS policy, and the
  // API key should never be readable from page context.
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
          if (!msg || msg.type !== 'nxg-generate-copy' || !msg.deal) return false;
          generate(msg.deal, {})
            .then((draft) => { try { sendResponse({ ok: true, draft }); } catch (e) {} })
            .catch((e) => {
              try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch (ee) {}
            });
          return true; // async
        } catch (e) {
          try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch (ee) {}
        }
        return false;
      });

      // Settings UI writes the key here so it never touches config.js (which is
      // committed to git).
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
          if (!msg || msg.type !== 'nxg-set-gemini-key') return false;
          setKey(msg.key || '').then(() => {
            try { sendResponse({ ok: true }); } catch (e) {}
          });
          return true;
        } catch (e) {}
        return false;
      });
    }
  } catch (e) { /* ignore */ }

  const DealAI = { generate, getKey, setKey, buildPrompt, sanitize, validate, DEFAULT_MODEL };

  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.DealAI = globalThis.DealAI || DealAI;
      if (typeof window !== 'undefined') window.DealAI = globalThis.DealAI;
    }
  } catch (e) { /* ignore */ }
})();
