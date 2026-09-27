# NxtGen Deal Engine — Chrome extension

Watches your x.com Following feed, keeps only posts whose link chain ends on
Amazon, rebuilds the link with your associate tag, and drafts original copy.

**Self-contained.** It shares no code with AutoList Pro / Fast4MP in the repo
root and loads only on `x.com`. The two extensions never interact.

## Install

1. Chrome → `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this `nxtgen-extension` folder

It appears as its own extension, separate from Fast4MP.

## Setup

1. Click the extension icon → **Settings**
2. **Gemini key** — paste it, or use **From file…** to load the `.txt` you saved.
   It goes to `chrome.storage`, never into `config.js` (which is tracked in git).
3. Confirm the associate tag (`nxtgenhotdeal-20`)
4. Open `x.com` and scroll your Following feed — captures land in the queue

Leave **Armed** off until you've watched the queue for a day. Off, it drafts and
queues; on, it publishes anything clearing every gate.

## How it works

```
x.com Following feed (your own logged-in session)
        │
        ▼  content/x_deal_scanner.js — reads posts with outbound links
        ▼  lib/deal_resolver.js — follows each redirect chain in the service
        │                          worker (content scripts can't do cross-origin)
        ▼  lib/deal_core.js — THE GATE: Amazon-terminating chains only
   Walmart, Target, the redirector itself and lookalike domains stop here
        ▼  ASIN extracted, foreign tags stripped, link rebuilt with your tag
        ▼  lib/deal_ai.js / deal_copy.js — original copy from verified facts
        ▼  content/x_autopost.js — gates, then the composer
   post ──► your feed        or held ──► queue, with the reason shown
```

The redirector is followed to *learn* the destination, then discarded. Published
links are always plain `amazon.com/dp/<ASIN>?tag=…`.

## The gates

A draft publishes unattended only if all of these pass. Anything else queues.

| Gate | Requires |
|---|---|
| link | exactly one URL, on Amazon, carrying your tag |
| disclosure | `#ad` present |
| length | within 280 characters (or Premium enabled) |
| freshness | deal younger than the age cap — default 45 min |
| substance | verified discount or captured promo code |
| rate | per-ASIN dedupe, minimum gap, hourly and daily caps |

## Files

| File | Role |
|---|---|
| `manifest.json` | its own manifest — x.com only |
| `background.js` | service worker; loads the libs, resolves redirects |
| `config.js` | committed defaults, no secrets |
| `lib/deal_core.js` | Amazon gate, ASIN, promo codes, link construction |
| `lib/deal_resolver.js` | redirect chains, incl. meta-refresh bounces |
| `lib/deal_copy.js` | template copy — the floor and the fallback |
| `lib/deal_ai.js` | Gemini generation with output validation |
| `lib/deal_settings_sync.js` | runtime settings, MV3 keep-alive |
| `content/x_deal_scanner.js` | timeline capture |
| `content/x_autopost.js` | gates and the X composer |
| `popup/deal_queue.*` | review queue |
| `popup/deal_settings.*` | settings and key entry |

## Tests

```
node test_deal_engine.js
```

50 assertions over the Amazon gate (including lookalikes like
`amazon.com.evil.co`), ASIN extraction, foreign-tag stripping, promo-code
parsing and copy generation. No browser needed.

## Related

`desktop/` in the repo root is the Python Command Center — the same pipeline as
a desktop app with full stats. The two are independent; use either or both.
