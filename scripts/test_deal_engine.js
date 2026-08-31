// scripts/test_deal_engine.js
// Node harness for the pure-logic modules of the deal engine. No Chrome APIs
// involved — exercises link gating, ASIN extraction, code parsing and copy
// generation, which is where a silent bug would put a wrong link on the feed.
//
//   node scripts/test_deal_engine.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

// Minimal chrome shim so the modules' guarded API calls no-op cleanly.
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  URL,          // the modules parse hosts with URL; vm contexts don't get it free
  URLSearchParams,
  fetch: () => Promise.reject(new Error('offline in tests')),
  chrome: undefined,
  CONFIG: { associateTag: 'nxtgenhotdeal-20', dealLongFormPosts: false, enableDebug: false }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['lib/deal_core.js', 'lib/deal_copy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}

const DC = sandbox.DealCore;
const DCopy = sandbox.DealCopy;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got:      ' + a + '\n         expected: ' + e); }
}
function assert(name, cond, note) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); }
}

console.log('\nAmazon gate — only Amazon-terminating chains pass');
check('amazon.com product', DC.isAmazonUrl('https://www.amazon.com/dp/B0CJ1234XY'), true);
check('amzn.to short', DC.isAmazonUrl('https://amzn.to/3xYzAbc'), true);
check('a.co short', DC.isAmazonUrl('https://a.co/d/abc123'), true);
check('walmart rejected', DC.isAmazonUrl('https://www.walmart.com/ip/12345'), false);
check('target rejected', DC.isAmazonUrl('https://www.target.com/p/-/A-123'), false);
check('redirector itself rejected', DC.isAmazonUrl('https://hiddenclearances.com/r/up-to-55-off'), false);
check('lookalike domain rejected', DC.isAmazonUrl('https://amazon.com.evil.co/dp/B0CJ1234XY'), false);
check('redirector recognised', DC.isKnownRedirector('https://hiddenclearances.com/r/x'), true);

console.log('\nASIN extraction across URL shapes');
check('/dp/', DC.extractAsin('https://www.amazon.com/dp/B0CJ1234XY'), 'B0CJ1234XY');
check('/dp/ with query', DC.extractAsin('https://www.amazon.com/dp/B0CJ1234XY?th=1'), 'B0CJ1234XY');
check('/gp/product/', DC.extractAsin('https://www.amazon.com/gp/product/B08N5WRWNW'), 'B08N5WRWNW');
check('slug + /dp/', DC.extractAsin('https://www.amazon.com/Milwaukee-Blower/dp/B07XYZ1234/ref=sr_1_1'), 'B07XYZ1234');
check('?asin=', DC.extractAsin('https://www.amazon.com/gp/aw/d?asin=B01ABCDEFG'), 'B01ABCDEFG');
check('no asin present', DC.extractAsin('https://www.amazon.com/s?k=blower'), null);

console.log('\nLink construction — what actually gets published');
check('canonical tagged link',
  DC.buildAffiliateUrl('B0CJ1234XY', 'nxtgenhotdeal-20'),
  'https://www.amazon.com/dp/B0CJ1234XY?tag=nxtgenhotdeal-20');
assert('published link is Amazon',
  DC.isAmazonUrl(DC.buildAffiliateUrl('B0CJ1234XY', 'nxtgenhotdeal-20')));
assert('published link carries our tag',
  DC.buildAffiliateUrl('B0CJ1234XY', 'nxtgenhotdeal-20').includes('nxtgenhotdeal-20'));

console.log('\nForeign tag stripping — never credit the source account');
const foreign = 'https://www.amazon.com/dp/B0CJ1234XY?tag=someoneelse-20&linkCode=ll1&ref_=abc';
assert('foreign tag removed', !DC.stripForeignTag(foreign).includes('someoneelse-20'));
assert('linkCode removed', !DC.stripForeignTag(foreign).includes('linkCode'));

console.log('\nPromo code + mechanic parsing');
check('code with colon', DC.extractPromoCode('Use code: SAVE25 at checkout'), 'SAVE25');
check('promo code phrasing', DC.extractPromoCode('promo code 50OFFNOW today only'), '50OFFNOW');
check('no code present', DC.extractPromoCode('Just a price drop, no code'), null);
check('clip coupon detected', DC.detectMechanic('Clip the 40% coupon on the listing'), 'clip_coupon');
check('checkout code detected', DC.detectMechanic('Apply code SAVE25 at checkout'), 'checkout_code');
check('lightning detected', DC.detectMechanic('Lightning deal live now'), 'lightning');

console.log('\nPrice parsing');
check('two prices', DC.extractPrices('Was $579.10 now $211.05'), [579.10, 211.05]);
check('comma thousands', DC.extractPrices('Down to $1,299.99'), [1299.99]);

console.log('\nCopy generation');
const deal = {
  asin: 'B0CJ1234XY',
  affiliateUrl: DC.buildAffiliateUrl('B0CJ1234XY', 'nxtgenhotdeal-20'),
  mechanic: 'checkout_code',
  promoCode: 'SAVE25',
  pricesInPost: [579.10, 211.05],
  ageMinutesAtCapture: 12,
  verified: { title: 'Milwaukee M18 FUEL Blower with Battery', currentPrice: 211.05, referencePrice: 579.10, discountPct: 64, available: true }
};
const draft = DCopy.generate(deal, {});
assert('draft contains the tagged link', draft.text.includes('nxtgenhotdeal-20'));
assert('draft contains #ad disclosure', draft.text.includes('#ad'));
assert('draft contains the promo code', draft.text.includes('SAVE25'));
assert('draft cites verified price', draft.text.includes('211.05'));
assert('draft mentions how long it has been live', /12 minutes/.test(draft.text));
assert('draft has no redirector', !draft.text.includes('hiddenclearances'));
const draftUrls = draft.text.match(/https?:\/\/[^\s]+/g) || [];
check('exactly one link in draft', draftUrls.length, 1);
assert('that link is Amazon', DC.isAmazonUrl(draftUrls[0]));
assert('within X limit (' + draft.charCount + ')', draft.charCount <= 280, draft.charCount + ' chars');

console.log('\nUnverified deals must not claim numbers');
const vague = Object.assign({}, deal, { verified: {}, pricesInPost: [] });
const vagueDraft = DCopy.generate(vague, {});
assert('no invented price', !/\$\d/.test(DCopy.savingsLine(vague)));
assert('still discloses', vagueDraft.text.includes('#ad'));
assert('still links with tag', vagueDraft.text.includes('nxtgenhotdeal-20'));

console.log('\nVariants differ');
const vs = DCopy.variants(deal, 3);
assert('three variants produced', vs.length === 3);
assert('variants are not identical', new Set(vs.map((v) => v.text)).size > 1);
assert('every variant discloses', vs.every((v) => v.text.includes('#ad')));
assert('every variant carries the tag', vs.every((v) => v.text.includes('nxtgenhotdeal-20')));

console.log('\nAge formatting');
check('minutes', DC.formatAge(12), '12m ago');
check('hours', DC.formatAge(150), '2h ago');
check('days', DC.formatAge(3000), '2d ago');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
