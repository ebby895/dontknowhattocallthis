// background.js - NxtGen Deal Engine service worker.
//
// Loads the shared link primitives, the copy generators, and the redirect-chain
// resolver the x.com scanner calls into. Resolution has to happen here because
// a content script cannot follow a cross-origin redirect chain.
//
// This extension is self-contained: it shares no code with anything else in the
// repository and loads only on x.com.

try {
  importScripts(
    'config.js',
    'lib/deal_core.js',
    'lib/deal_settings_sync.js',
    'lib/deal_copy.js',
    'lib/deal_ai.js',
    'lib/deal_resolver.js'
  );
  console.log('[NxtGen] deal engine loaded');
} catch (e) {
  console.error('[NxtGen] failed to load:', e);
}

// Open the review queue in a full tab rather than the cramped popup when the
// user asks for it from the queue page itself.
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || msg.type !== 'nxg-open-page' || !msg.page) return false;
      chrome.tabs.create({ url: chrome.runtime.getURL(msg.page), active: true });
      try { sendResponse({ ok: true }); } catch (e) {}
      return true;
    } catch (e) {}
    return false;
  });
} catch (e) { /* ignore */ }
