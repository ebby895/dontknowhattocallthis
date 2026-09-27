// popup/deal_queue.js
// Review queue for captured Amazon deals. Ranks by freshness × discount ×
// category rate, shows the generated draft, and posts to X through your own
// logged-in session.
//
// Human-in-the-loop by design: you see the draft and the exact link before
// anything goes out.

(function () {
  'use strict';

  const STORE_KEY = 'nxg_deal_queue';
  const listEl = document.getElementById('list');

  // Amazon fixed commission rates by category, used to rank which deals are
  // worth your feed slot. Same click volume, very different payout.
  const CATEGORY_RATES = {
    luxury_beauty: 10, beauty: 3, physical_books: 4.5, kitchen: 4.5,
    home: 3, home_improvement: 3, furniture: 3, lawn_garden: 3,
    pets: 3, headphones: 3, musical_instruments: 3, business_industrial: 3,
    outdoors: 3, tools: 3, sports: 3, baby: 3, apparel: 4, jewelry: 4,
    toys: 3, digital_video_games: 20, amazon_devices: 4,
    electronics: 1, computers: 2.5, tv: 2, grocery: 1, health: 1,
    video_games: 1, default: 3
  };

  function tag() {
    return (globalThis.CONFIG && globalThis.CONFIG.associateTag) || 'nxtgenhotdeal-20';
  }

  function load() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORE_KEY], (r) => resolve((r && r[STORE_KEY]) || []));
    });
  }

  function save(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORE_KEY]: items }, () => resolve(true));
    });
  }

  // Ranking: freshness dominates because promo pricing gets corrected, then
  // discount depth, then how much the category actually pays.
  function score(deal) {
    const DC = globalThis.DealCore;
    const age = DC.ageMinutes(deal.postedAt);
    const maxAge = (globalThis.CONFIG && globalThis.CONFIG.dealMaxAgeMinutes) || 720;

    // Decays to 0 across the configured window.
    const freshness = age === null ? 0.5 : Math.max(0, 1 - (age / maxAge));

    const v = deal.verified || {};
    let discount = 0.3;
    if (typeof v.discountPct === 'number') discount = Math.min(1, v.discountPct / 60);

    const rate = CATEGORY_RATES[deal.category] || CATEGORY_RATES.default;
    const payout = Math.min(1, rate / 10);

    // Weighted so a 5-minute-old deal outranks a deeper but stale one.
    return (freshness * 0.5) + (discount * 0.3) + (payout * 0.2);
  }

  function ageClass(mins) {
    if (mins === null) return '';
    if (mins < 60) return 'hot';
    if (mins > 360) return 'cold';
    return '';
  }

  function mechanicLabel(m) {
    return ({
      clip_coupon: 'clip coupon',
      checkout_code: 'checkout code',
      lightning: 'lightning deal',
      price_drop: 'price drop',
      subscribe_save: 'subscribe & save',
      prime_exclusive: 'prime exclusive',
      deal: 'deal'
    })[m] || m;
  }

  function render(deals) {
    listEl.innerHTML = '';
    document.getElementById('tagLabel').textContent = tag();

    const live = deals.filter((d) => d.status !== 'posted' && d.status !== 'dismissed');

    if (!live.length) {
      listEl.innerHTML =
        '<div class="empty">Nothing queued yet.<br><br>' +
        'Open <strong>x.com</strong> and scroll your Following feed —<br>' +
        'posts whose links land on Amazon get captured here.</div>';
      return;
    }

    live.sort((a, b) => score(b) - score(a));
    live.forEach((deal) => listEl.appendChild(renderDeal(deal, deals)));
  }

  function renderDeal(deal, allDeals) {
    const DC = globalThis.DealCore;
    const mins = DC.ageMinutes(deal.postedAt);

    // Regenerate against current age so the urgency line is true at post time,
    // not at capture time.
    const forCopy = Object.assign({}, deal, { ageMinutesNow: mins });
    const variants = globalThis.DealCopy.variants(forCopy, 3);
    let activeIdx = 0;

    const el = document.createElement('div');
    el.className = 'deal';

    el.innerHTML =
      '<div class="deal-head">' +
        '<span class="asin">' + esc(deal.asin) + '</span>' +
        '<span class="src">via ' + esc(deal.sourceAuthor || 'feed') + '</span>' +
        '<span class="age ' + ageClass(mins) + '">' + esc(DC.formatAge(mins)) + '</span>' +
      '</div>' +
      '<div class="badges">' +
        '<span class="badge">' + esc(mechanicLabel(deal.mechanic)) + '</span>' +
        (deal.promoCode ? '<span class="badge code">code ' + esc(deal.promoCode) + '</span>' : '') +
        '<span class="badge">score ' + score(deal).toFixed(2) + '</span>' +
      '</div>' +
      '<textarea spellcheck="false"></textarea>' +
      '<div class="meta">' +
        '<span class="count"></span>' +
        '<span class="disc"></span>' +
        '<span class="cloak"></span>' +
      '</div>' +
      '<div class="link">' + esc(deal.affiliateUrl || '') + '</div>' +
      '<div class="variants"></div>' +
      '<div class="actions">' +
        '<button class="primary act-post">Post to X</button>' +
        '<button class="act-copy">Copy</button>' +
        '<button class="act-open">Open listing</button>' +
        '<span class="spacer"></span>' +
        '<button class="ghost act-dismiss">Dismiss</button>' +
      '</div>';

    const ta = el.querySelector('textarea');
    const countEl = el.querySelector('.count');
    const discEl = el.querySelector('.disc');
    const cloakEl = el.querySelector('.cloak');
    const variantsEl = el.querySelector('.variants');

    function refreshMeta() {
      const n = globalThis.DealCopy.charCount(ta.value);
      countEl.textContent = n + '/280';
      countEl.className = 'count' + (n > 280 ? ' over' : '');

      const hasDisc = ta.value.includes('#ad');
      discEl.textContent = hasDisc ? '✓ disclosed' : '✗ no #ad';
      discEl.className = hasDisc ? 'ok' : 'warn';

      // Guard against a redirector ever surviving into a published post.
      const urls = ta.value.match(/https?:\/\/[^\s]+/g) || [];
      const bad = urls.filter((u) => !DC.isAmazonUrl(u));
      cloakEl.textContent = bad.length ? '✗ non-Amazon link' : '✓ clean link';
      cloakEl.className = bad.length ? 'warn' : 'ok';
    }

    function setVariant(i) {
      activeIdx = i;
      ta.value = variants[i].text;
      refreshMeta();
      Array.from(variantsEl.children).forEach((b, j) => {
        b.classList.toggle('active', j === i);
      });
    }

    variants.forEach((v, i) => {
      const b = document.createElement('button');
      b.textContent = 'v' + (i + 1);
      b.addEventListener('click', () => setVariant(i));
      variantsEl.appendChild(b);
    });

    ta.addEventListener('input', refreshMeta);
    setVariant(0);

    el.querySelector('.act-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(ta.value);
      const b = el.querySelector('.act-copy');
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1200);
    });

    el.querySelector('.act-open').addEventListener('click', () => {
      chrome.tabs.create({ url: deal.affiliateUrl, active: true });
    });

    el.querySelector('.act-dismiss').addEventListener('click', async () => {
      deal.status = 'dismissed';
      await save(allDeals);
      render(allDeals);
    });

    el.querySelector('.act-post').addEventListener('click', async () => {
      const text = ta.value;
      const urls = text.match(/https?:\/\/[^\s]+/g) || [];

      if (urls.some((u) => !DC.isAmazonUrl(u))) {
        alert('This draft contains a non-Amazon link. Remove it before posting — ' +
              'redirector links breach the Associates policy on obscured links.');
        return;
      }
      if (!text.includes('#ad')) {
        alert('Missing the #ad disclosure. Add it before posting.');
        return;
      }
      if (!text.includes(tag())) {
        alert('This draft does not carry your associate tag (' + tag() + ').');
        return;
      }

      // Hand off to the X composer in your own session. No API tier needed.
      chrome.tabs.create({
        url: 'https://x.com/intent/post?text=' + encodeURIComponent(text),
        active: true
      });

      deal.status = 'posted';
      deal.postedTextAt = new Date().toISOString();
      await save(allDeals);
      render(allDeals);
    });

    return el;
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function refresh() {
    render(await load());
  }

  document.getElementById('refreshBtn').addEventListener('click', refresh);
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear the entire deal queue?')) return;
    await save([]);
    refresh();
  });

  // Live update while you scroll x.com in another tab.
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'nxg-deals-added') refresh();
      return false;
    });
  } catch (e) { /* ignore */ }

  refresh();
})();
