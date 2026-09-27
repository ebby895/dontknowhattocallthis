// config.js - NxtGen Deal Engine settings.
//
// Committed defaults only. No API keys live here: the Gemini key is entered in
// the extension's settings page and kept in chrome.storage, because this file
// is tracked in git. Anything changed in the settings page overrides these at
// runtime (see lib/deal_settings_sync.js).

const CONFIG = {
  // 🛒 Amazon Associates
  associateTag: "nxtgenhotdeal-20",

  // 🔍 Capture
  // Only chains that terminate on an Amazon host are queued. Everything else
  // (Walmart, Target, Best Buy, the redirector itself) is dropped at the gate.
  dealScannerEnabled: true,
  instantScan: true,            // process each new post on arrival instead of batching
  dealMinDiscountPct: 15,       // below this, not worth a post
  dealMaxAgeMinutes: 720,       // ignore deals older than 12h - price likely dead
  keepaApiKey: "",              // optional: real price history for discount verification

  // ✍️ Copy
  geminiModel: "gemini-2.5-flash",
  dealLongFormPosts: false,     // true if the X account has Premium (>280 chars)

  // 🤖 Autopilot - unattended capture → generate → post
  autoPostArmed: false,         // master switch; leave false until you've watched the queue
  autoPostMaxAgeMinutes: 45,    // never auto-post a deal older than this
  autoPostMinGapMinutes: 12,    // spacing between posts, so the feed reads human
  autoPostMaxPerHour: 4,
  autoPostMaxPerDay: 25,

  // ⚙️ General
  enableDebug: true
};

try {
  if (typeof globalThis !== 'undefined') {
    globalThis.CONFIG = globalThis.CONFIG || CONFIG;
    try { if (typeof window !== 'undefined') window.CONFIG = globalThis.CONFIG; } catch (e) {}
  }
} catch (e) { /* ignore */ }
