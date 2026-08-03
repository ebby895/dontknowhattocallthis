// ========================================================
// HARD EXIT FOR IFRAMES — MUST BE FIRST
// ========================================================
(function() {
  if (window.top !== window) {
    console.log("🎯 SDNR DEBUG — content_main running inside an iframe; exiting before listeners", {
      href: location.href
    });
    return; // <-- NOTHING below this runs for iframes
  }

  console.log("🎯 SDNR DEBUG — content_main running in TOP frame", {
    href: location.href
  });

  // ========================================================
  // EVERYTHING ELSE IN THE FILE STARTS BELOW THIS LINE
  // ========================================================

  // =========================
  // GLOBAL DUPLICATE-LOAD LOCK
  // =========================
  // Avoid top-level `return` (illegal in some injection contexts).
  // If already loaded, do nothing. Otherwise set the flag and run
  // the remainder of the file inside an IIFE so we can early-exit
  // future injections without using a top-level return.
  if (typeof window !== 'undefined' && window.__FFM_CONTENT_MAIN_ALREADY_LOADED__) {
    try { console.log("[Fast4MP content] Duplicate content_main.js load blocked."); } catch (e) {}
  } else {
    try { if (typeof window !== 'undefined') window.__FFM_CONTENT_MAIN_ALREADY_LOADED__ = true; } catch (e) {}
    (function(){

    // --------------------------------------------------------
    // Find React Fiber node on an element
    // --------------------------------------------------------
    function ffmGetReactFiber(el) {
      for (const key in el) {
        if (key.startsWith("__reactFiber$")) {
          return el[key];
        }
      }
      return null;
    }

    // (Removed) React Fiber-based description injector — deprecated
// Invisible-ID title helpers removed (legacy invisible markers cleared)

// Helper: convert Data URL (base64) -> Blob
// Helper: convert Data URL (base64) -> Blob (preserve MIME from dataUrl when present)
function ffmDataUrlToBlob(dataUrl, type) {
  try {
    const parts = String(dataUrl || '').split(',');
    if (parts.length < 2) return null;
    const header = parts[0] || '';
    const base64 = parts[1] || '';

    // Extract MIME from dataURL if available
    const mimeMatch = header.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : type || 'application/octet-stream';

    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);

    return new Blob([ab], { type: mime });
  } catch (e) {
    try { console.warn('[Fast4MP content] ffmDataUrlToBlob failed', e); } catch (err) {}
    return null;
  }
}

// Helper: convert Blob -> File
function ffmBlobToFile(blob, name = 'image.jpg', type) {
  try {
    return new File([blob], name, { type: (blob && blob.type) || type || 'application/octet-stream' });
  } catch (e) {
    try { blob.name = name; } catch (er) {}
    return blob;
  }
}

// Helper: convert File -> dataUrl (for cross-frame forwarding)
function ffmFileToDataUrl(file) {
  return new Promise((resolve) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    } catch (e) { resolve(null); }
  });
}

// Detect if this frame appears to be the FB Create Listing frame (has multiple file input)
function ffmIsThisCreateFrame() {
  try {
    return !!document.querySelector('input[type="file"][multiple]');
  } catch (e) {
    return false;
  }
}

// Lightweight probe so we know where content_main ran
(function ffmContentProbe() {
  try {
    const href = (typeof location !== 'undefined' && location.href) ? location.href : '(no location)';
    const hasFileInput = !!document.querySelector(
      'input[type="file"][accept*="image"], input[type="file"][multiple]'
    );

    console.log('[Fast4MP content] content_main.js loaded', {
      href,
      hasFileInput
    });
  } catch (e) {
    console.log('[Fast4MP content] content_main.js loaded (no DOM access)', String(e));
  }
})();

// ---------------------
// SDNR / DnR iframe guard
// ---------------------
(function() {
  const isTop = (window === window.top);

  if (!isTop) {
    try {
      console.log("🎯 SDNR DEBUG — content_main running inside an iframe; exiting before listeners", {
        href: window.location.href
      });
    } catch (e) {}
    // 🚫 IMPORTANT: absolutely nothing below this runs in iframes.
    return;
  }

  try {
    console.log("🎯 SDNR DEBUG — content_main running in TOP frame", {
      href: window.location.href
    });
  } catch (e) {}

  // 🔽 All existing content_main code continues below this line (listeners, bridges, DnR handlers, etc.).
})();

// Load persistent auto-publish setting so content honors user's persistent choice
try {
  if (chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
    try {
      chrome.storage.local.get(['ffm_auto_publish_enabled','auto_publish_enabled'], (res) => {
        try {
          const persistent = (res && typeof res.ffm_auto_publish_enabled !== 'undefined') ? res.ffm_auto_publish_enabled : (res && typeof res.auto_publish_enabled !== 'undefined' ? res.auto_publish_enabled : false);
          window.ffm_allow_auto_publish = !!persistent;
          console.log('[Fast4MP content] persistent auto-publish loaded =', window.ffm_allow_auto_publish);
        } catch (e) {}
      });
    } catch (e) {}
  }
} catch (e) {}

// Listen for forwarded attach events (background -> correct create iframe will dispatch this)
window.addEventListener('ffmAttachNow', async () => {
  try {
    // Disable attach behavior when running inside an iframe to avoid duplicate work
    try { if (window.self !== window.top) return; } catch (e) {}

    // Global attach-in-progress guard to prevent duplicate attach runs
    try {
      if (window.__ffm_attach_in_progress) {
        console.debug && console.debug('[Fast4MP content] ffmAttachNow: attach already in progress, skipping');
        return;
      }
      window.__ffm_attach_in_progress = true;
    } catch (e) {}

    try {
      if (!window.ffmIncomingFiles) return;
      console.log('[Fast4MP content] attach forwarded to correct frame');

      // If incoming items are serialized { name, type, dataUrl }, convert to File
      let files = window.ffmIncomingFiles;
      if (Array.isArray(files) && files.length && files[0] && files[0].dataUrl) {
        const conv = [];
        for (const it of files) {
          try {
            const blob = ffmDataUrlToBlob(it.dataUrl, it.type);
            if (!blob) continue;
            conv.push(ffmBlobToFile(blob, it.name || ('file_' + Date.now()), it.type));
          } catch (e) {}
        }
        files = conv;
      }

      try {
        // Attempt to find proper FB uploader input and attach
        const input = (typeof ffmFindProperUploaderInput === 'function') ? ffmFindProperUploaderInput() : null;
        if (!input) {
          console.warn('[Fast4MP content] ffmAttachNow: no file input found in this frame');
        } else {
          try {
            await ffmAttachMediaToFileInput(input, files);
          } catch (e) {
            console.warn('[Fast4MP content] ffmAttachNow attach failed', e);
          }
        }
      } catch (e) {
        console.warn('[Fast4MP content] ffmAttachNow attach failed', e);
      }

    } finally {
      try { window.ffmIncomingFiles = null; } catch (e) {}
      try { window.__ffm_attach_in_progress = false; } catch (e) {}
    }
  } catch (e) { console.warn('[Fast4MP content] ffmAttachNow handler error', e); }
});
// Early defensive cleanup for Facebook pages: remove any injected panel/iframe/styles
// and reset any inline layout changes that may have forced Facebook into a small boxed layout.

// Announce content script loaded for debugging
try { console.debug && console.debug('[Fast4MP content] content_main loaded, registering listeners'); } catch (e) {}

// Phase 1 seller-page card scanner removed: IID-era logging and phase-1
// detection are deprecated. Active scan (AAS) and safer flows are used instead.

// Patch6: Marketplace Create no longer uses iframes — remove Patch12 behavior
// (New FB UI is single-root React; attach logic handles everything now.)
// Announce content script readiness so background can forward popup-initiated actions reliably
try {
  if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    try { chrome.runtime.sendMessage({ action: 'ffm_content_ready', isTop: (window && window.self === window.top) }, () => {}); } catch (e) {}
  }
} catch (e) {}

// Lightweight ping responder so background can poll for content readiness (ffm_ping -> 'pong')
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (msg && msg.type === 'ffm_ping') {
          try { sendResponse && sendResponse('pong'); } catch (e) {}
        }
      } catch (e) {}
      // synchronous reply only; do not return true
    });
  }
} catch (e) {}

// If a listing was staged by background (ffm_incoming_listing), run the publish flow once
(async function ffmCheckForStagedListing() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) return;
    const snap = await new Promise((res) => { try { chrome.storage.local.get(['ffm_incoming_listing'], (r) => res(r || {})); } catch (e) { res({}); } });
    const incoming = snap && snap.ffm_incoming_listing ? snap.ffm_incoming_listing : null;
    if (!incoming) return;
    try { console.log('[Fast4MP] Detected staged listing', incoming); } catch (e) {}
    // ------------------------------------------------------
    // SCHEDULED PUBLISH BOOTSTRAP (drop-in)
    // When a staged listing is detected from scheduler, we must
    // explicitly kick the same pipeline as manual publish.
    // This does NOT auto-publish; it only starts populate + attach.
    // ------------------------------------------------------
    (async () => {
      try {
        const staged = incoming?.ffm_incoming_listing || window.ffmIncomingListing || null;
        if (!staged || !staged.listingId) return;

        const listingId = staged.listingId;
        console.log("[SP] Bootstrap: staged listing detected → starting pipeline", staged);

        // IMPORTANT: scheduled runs should not force auto publish
        const allowAutoPublish = false;

        if (typeof window.ffmStartPublishFromListingId === "function") {
          console.log("[SP] Using ffmStartPublishFromListingId()");
          await window.ffmStartPublishFromListingId(listingId, { allowAutoPublish });
          return;
        }

        if (typeof window.ffmPublishListingFromSaved === "function") {
          console.log("[SP] Using ffmPublishListingFromSaved()");
          await window.ffmPublishListingFromSaved(listingId, { allowAutoPublish });
          return;
        }

        if (typeof window.ffmRunPublishFlow === "function") {
          console.log("[SP] Using ffmRunPublishFlow()");
          await window.ffmRunPublishFlow({ listingId, allowAutoPublish, source: "scheduled" });
          return;
        }

        console.warn("[SP] No known publish entry function found — requesting start from background");
        try {
          chrome.runtime.sendMessage({
            action: "ffm_scheduled_publish_start",
            listingId,
            taskId: staged.taskId,
            source: "scheduled",
            allowAutoPublish
          }, (resp) => {
            console.log("[SP] Background start response", resp);
          });
        } catch (e) { console.debug('[SP] sendMessage to background failed', e); }

      } catch (e) {
        console.error("[SP] Bootstrap failed", e);
      }
    })();
    try { if (typeof ffmRunPublishFlow === 'function') ffmRunPublishFlow(incoming); } catch (e) { console.debug('[Fast4MP] ffmRunPublishFlow missing or errored', e); }
  } catch (e) { console.debug('[Fast4MP] ffmCheckForStagedListing error', e); }
})();


// Minimal scheduled-task message handlers (headless trigger)
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || !msg.action) return;

        if (msg.action === 'ffm_run_scheduled_publish') {
          try { console.log('[SP] Scheduled publish received', msg.task); } catch (e) {}
          try { if (typeof ffmRunPublishFlow === 'function') ffmRunPublishFlow(msg.task); } catch (e) { console.debug('[SP] ffmRunPublishFlow missing or threw', e); }
        }

        if (msg.action === 'ffm_run_scheduled_dnr') {
          try { console.log('[SDNR] Scheduled DnR received', msg.task); } catch (e) {}

          try {
            const {
              listingId,
              dnrTitle,
              taskId,
              source,
              listingTitle
            } = (msg && msg.task) ? msg.task : (msg || {});

            // Build payload for canonical consumer
            const payload = {
              type: 'ffm_run_delete_relist',
              scheduled: true,
              title: dnrTitle || listingTitle || '',
              listingTitle: listingTitle || dnrTitle || '',
              deleteTitle: dnrTitle || listingTitle || '',
              listingId,
              taskId,
              source: 'scheduled'
            };

            // Deduplicate: avoid re-processing the same scheduled task/title repeatedly
            try {
              if (!window.__ffm_processed_sdnr__) window.__ffm_processed_sdnr__ = {};
              const key = taskId ? ('task:' + String(taskId)) : ('title:' + String((payload.deleteTitle || '').trim()));
              const last = window.__ffm_processed_sdnr__[key] || 0;
              const now = Date.now();
              const DEDUPE_MS = 30 * 1000; // ignore duplicates within 30 seconds
              if (last && (now - last) < DEDUPE_MS) {
                try { console.log('[SDNR] duplicate scheduled DnR ignored', { key, since: now - last }); } catch (e) {}
                return;
              }
              // Mark as processed now
              window.__ffm_processed_sdnr__[key] = now;
            } catch (e) {}

            try {
              // Fire-and-forget: do not wait for a response to avoid noisy
              // `no-response-timeout` logs when the consumer responds async.
              // Also post to window so content_selling (same-tab) receives it
              // directly via the new window.postMessage shim.
              try { window.postMessage(payload, '*'); } catch (e) {}
              chrome.runtime.sendMessage(payload);
              try { console.log('[SDNR] forwarded scheduled DnR to content_selling (sent) ', { listingId, taskId }); } catch (e) {}
            } catch (e) {
              console.error('[SDNR] Failed to forward scheduled DnR', e);
            }
          } catch (e) {}

          return;
        }
      } catch (e) {}
      // synchronous handler only
    });
  }
} catch (e) {}

// Receive actual File objects directly from background.js
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (msg && msg.action === 'ffm-deliver-files') {
          window.ffm_staged_publish_files = {
            images: msg.imageFiles || [],
            videos: msg.videoFiles || []
          };
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
          return;
        }
      } catch (e) {}
    });
  }
} catch (e) {}

// Ensure manual publish entry point is available for scheduled publishes.
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (msg && msg.action === 'publish-listing') {
          try { console.log('[Fast4MP] publish-listing received', msg); } catch (e) {}
          try {
            if (typeof ffmHandlePublishRequest === 'function') {
              ffmHandlePublishRequest(msg);
            } else {
              console.warn('[Fast4MP] ffmHandlePublishRequest not found');
            }
          } catch (e) { console.error('[Fast4MP] ffmHandlePublishRequest threw', e); }
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
          return true;
        }
      } catch (e) {}
      // synchronous-only handler for other messages
    });
  }
} catch (e) {}

// ╔═══════════════════════════════════════════════╗
// ║ Patch 15 — page → extension message bridge     ║
// ╚═══════════════════════════════════════════════╝
try {
  window.addEventListener('message', async (evt) => {
    if (!evt.data || evt.data.source !== 'ffm-page') return;

    try {
      const payload = evt.data.payload;

      // Forward request to background
      chrome.runtime.sendMessage(
        payload,
        (response) => {
          try {
            window.postMessage({
              source: 'ffm-ext',
              respTo: evt.data.id,
              resp: response
            }, '*');
          } catch (e) { console.warn('[Patch15] postMessage response failed', e); }
        }
      );
    } catch (e) {
      console.error('[Patch15] page→extension bridge error:', e);
    }
  });
} catch (e) {}

// Inject small page bridge script into the page context so pages can call window.ffmPageBridge
try {
  (function injectFFMBridge() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('content/bridge_page.js');
      s.onload = () => s.remove();
      document.documentElement.appendChild(s);
      console.log('[FFM bridge] page-bridge injected');
    } catch (e) {
      console.warn('[FFM bridge] inject failed:', e);
    }
  })();
} catch (e) {}

// Top-level lightweight perform-generate-scrape listener.
// Some heavier scrape/install code in this file registers a listener conditionally; add
// a compact, always-present handler so the background can reliably message the tab.
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (!message || message.action !== 'perform-generate-scrape') return;
        try { console.debug && console.debug('[Fast4MP content] perform-generate-scrape (top-level) received from', sender && sender.tab ? sender.tab.id : sender); } catch (e) {}
        (async () => {
          try {
            // Minimal, defensive scrape: prefer Sharetown-specific selectors then fall back to headings and dollar detection
            const visible = (el) => !!el && el.offsetParent !== null;
            const textOf = (el) => (el && (el.innerText || el.textContent) || '').toString().trim();
            const moneyRe = /\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/;

            let inventoryName = '';
            try { const el = document.querySelector('h3.inventory-details__title'); if (el && visible(el)) inventoryName = textOf(el); } catch (e) {}
            if (!inventoryName) {
              try { const el = document.querySelector('p.inventory-details__link-lbl'); if (el && visible(el)) inventoryName = textOf(el); } catch (e) {}
            }
            if (!inventoryName) {
              try { const heads = Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible); if (heads.length) inventoryName = textOf(heads[0]); } catch (e) {}
            }

            // Find candidate money values and pick the smallest reasonable value
            let price = '';
            try {
              const candidates = Array.from(document.querySelectorAll('div,span,p')).filter(visible).map(n => ({ t: textOf(n), m: (textOf(n).match(moneyRe) || [])[0] })).filter(x => x.m).map(x => x.m);
              if (candidates && candidates.length) {
                // choose the smallest numeric candidate
                const nums = candidates.map(s => { const m = s.match(moneyRe); return m ? parseFloat(m[1].replace(/,/g,'')) : NaN; }).filter(n => isFinite(n));
                if (nums && nums.length) {
                  const small = Math.min.apply(null, nums);
                  price = String(small);
                }
              }
            } catch (e) { price = ''; }

            const result = { inventoryName: inventoryName || '', title: inventoryName || '', price: price || '', retailPrice: '', debug: { source: 'top-level-mini-scrape' } };
            try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: Object.assign({}, result, { timestamp: Date.now() }) }); } catch (e) {}
            // Also actively notify the background in case it injected this script and expects a message
            try { if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') { chrome.runtime.sendMessage({ action: 'scrape-result', data: result }); } } catch (e) {}
            try { console.debug && console.debug('[Fast4MP content] perform-generate-scrape (top-level) result', result); } catch (e) {}
            try { sendResponse && sendResponse(result); } catch (e) { try { console.debug && console.debug('[Fast4MP content] perform-generate-scrape (top-level) sendResponse failed', e); } catch (er) {} }
          } catch (e) { try { console.debug && console.debug('[Fast4MP content] perform-generate-scrape (top-level) error', e); } catch (er) {} try { sendResponse && sendResponse(null); } catch (er) {} }
        })();
        return true;
      } catch (e) {}
    });
  }
} catch (e) {}

// Listen for relist payload injection request from the background (ffm_inject_relist_payload)
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.action !== 'ffm_inject_relist_payload') return;
        // If the background provided a slim payload and staged media flag, use it and attach staged media
        try {
          if (msg.payload) {
            const data = Object.assign({}, msg.payload);
            if (msg.hasStagedMedia) {
              try {
                chrome.storage.local.get(['ffm_staged_relist_media'], async (res) => {
                  try {
                    const media = res && res.ffm_staged_relist_media ? res.ffm_staged_relist_media : null;
                    if (media) {
                      try { data.images = media.images || []; } catch (e) {}
                      try { data.videos = media.videos || []; } catch (e) {}
                    }
                  } catch (e) {}
                  // proceed to populate using the assembled data
                  try {
                    console.log('[Fast4MP content] Injecting staged relist payload (from message + staged media)', data.title || data.inventoryName);
                    // re-use the same injection logic below by placing data into storage so legacy helpers still find it,
                    // but also directly apply fields to the form.
                    try { chrome.storage.local.set({ ffm_relist_payload: data }); } catch (e) {}
                    try {
                      const titleEl = document.querySelector('input[name="title"], input[aria-label*="title" i], input[placeholder*="title" i]');
                      if (titleEl) try {
                        titleEl.value = (data.title || data.inventoryName || '').trim();
                      } catch (e) {}
                      const descEl = document.querySelector('textarea[name="description"], textarea[aria-label*="description" i], textarea[placeholder*="description" i]');
                      if (descEl) try { descEl.value = data.description || data.body || ''; } catch (e) {}
                      const priceEl = document.querySelector('input[name="price"], input[aria-label*="price" i], input[placeholder*="price" i]');
                      if (priceEl && (data.price !== undefined && data.price !== null)) try { priceEl.value = String(data.price); } catch (e) {}
                      if (data.category) {
                        try {
                          const sel = Array.from(document.querySelectorAll('select, input')).find(el => (el && (el.name||'').toLowerCase().includes('category')) || (el && (el.getAttribute && el.getAttribute('aria-label')||'').toLowerCase().includes('category')));
                          if (sel) { try { sel.value = data.category; } catch (e) {} }
                        } catch (e) {}
                      }

                      // Images: attempt known upload helpers
                      try {
                        const imgs = data.images || data.s3ImageKeys || [];
                        if (imgs && imgs.length) {
                          const uploadFns = [ 'ffmUploadImageToFacebook', 'uploadImageToFacebook', 'ffm_upload_image', 'uploadImage' ];
                          let used = false;
                          for (const fnName of uploadFns) {
                            try {
                              const fn = window[fnName];
                              if (typeof fn === 'function') {
                                for (const img of imgs) {
                                  try { await fn(img); } catch (e) { console.warn('[Fast4MP content] image upload helper failed', fnName, e); }
                                }
                                used = true;
                                break;
                              }
                            } catch (e) {}
                          }
                          if (!used) {
                            console.log('[Fast4MP content] relist payload contains images but no upload helper found; images are preserved in storage under ffm_relist_payload', imgs.length);
                          }
                        }
                      } catch (e) { console.warn('[Fast4MP content] image injection error', e); }

                      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
                    } catch (e) { console.warn('[Fast4MP content] Failed to inject relist payload', e); try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
                  } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
                });
                return true; // keep channel open while storage read completes
              } catch (e) {
                console.warn('[Fast4MP content] failed to read staged media', e);
                // fall through to treat message.payload as-is
              }
            }
            // No staged media, but have a payload — apply directly
            try {
              console.log('[Fast4MP content] Injecting relist payload (from message)', data.title || data.inventoryName);
              try { chrome.storage.local.set({ ffm_relist_payload: data }); } catch (e) {}
              const titleEl = document.querySelector('input[name="title"], input[aria-label*="title" i], input[placeholder*="title" i]');
              if (titleEl) try {
                titleEl.value = (data.title || data.inventoryName || '').trim();
              } catch (e) {}
              const descEl = document.querySelector('textarea[name="description"], textarea[aria-label*="description" i], textarea[placeholder*="description" i]');
              if (descEl) try { descEl.value = data.description || data.body || ''; } catch (e) {}
              const priceEl = document.querySelector('input[name="price"], input[aria-label*="price" i], input[placeholder*="price" i]');
              if (priceEl && (data.price !== undefined && data.price !== null)) try { priceEl.value = String(data.price); } catch (e) {}
              // images handled below
              try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
            return true;
          }

          // Best-effort: read saved payload from storage and populate common form fields on the create page
          try {
            chrome.storage.local.get(['ffm_relist_payload', 'ffm_staged_listing'], async (res) => {
              try {
                // Prefer the legacy ffm_relist_payload but fall back to ffm_staged_listing (unified DnR flow)
                let data = (res && (res.ffm_relist_payload || res.ffm_staged_listing));
                if (!data) {
                  // Try fallback: background may have staged under ffm_publish_<publishRequestId>
                  try {
                    let publishId = null;
                    try { publishId = window.__ffm_publishRequestId || null; } catch (e) {}
                    if (publishId) {
                      try {
                        chrome.storage.local.get(['ffm_publish_' + publishId], async (pubRes) => {
                          try {
                            const full = pubRes && pubRes['ffm_publish_' + publishId] ? pubRes['ffm_publish_' + publishId] : null;
                            if (!full) {
                              try { console.warn('[Fast4MP content] no relist/staged payload found in storage'); } catch (e) {}
                              try { sendResponse && sendResponse({ ok: false, reason: 'no-payload' }); } catch (e) {}
                              return;
                            }
                            data = full;
                            try { console.log('[Fast4MP content] Injecting saved listing data for relist (from ffm_publish)', data.title || data.inventoryName); } catch (e) {}
                            // Populate fields (title/desc/price/category/images)
                            try {
                              const titleEl = document.querySelector('input[name="title"], input[aria-label*="title" i], input[placeholder*="title" i]');
                              if (titleEl) try { titleEl.value = data.title || data.inventoryName || ''; } catch (e) {}
                              const descEl = document.querySelector('textarea[name="description"], textarea[aria-label*="description" i], textarea[placeholder*="description" i]');
                              if (descEl) try { descEl.value = data.description || data.body || ''; } catch (e) {}
                              const priceEl = document.querySelector('input[name="price"], input[aria-label*="price" i], input[placeholder*="price" i]');
                              if (priceEl && (data.price !== undefined && data.price !== null)) try { priceEl.value = String(data.price); } catch (e) {}
                              if (data.category) {
                                try {
                                  const mapCat = (v) => { try { return /mattress/i.test((v||'').toString()) ? 'Furniture' : v; } catch (e) { return v; } };
                                  const sel = Array.from(document.querySelectorAll('select, input')).find(el => (el && (el.name||'').toLowerCase().includes('category')) || (el && (el.getAttribute && el.getAttribute('aria-label')||'').toLowerCase().includes('category')));
                                  if (sel) { try { sel.value = mapCat(data.category); } catch (e) {} }
                                } catch (e) {}
                              }
                              // Images: if images present, preserve under ffm_relist_payload for manual attach or upload helper
                              try {
                                const imgs = data.images || data.s3ImageKeys || [];
                                if (imgs && imgs.length) {
                                  try { chrome.storage.local.set({ ffm_relist_payload: data }); } catch (e) {}
                                  try { console.log('[Fast4MP content] relist payload contains images; preserved under ffm_relist_payload', imgs.length); } catch (e) {}
                                }
                              } catch (e) {}
                            } catch (e) {}
                            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
                          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
                        });
                        return;
                      } catch (e) {}
                    }
                  } catch (e) {}
                  // No payload found anywhere
                  try { console.warn('[Fast4MP content] no relist/staged payload found in storage'); } catch (e) {}
                  try { sendResponse && sendResponse({ ok: false, reason: 'no-payload' }); } catch (e) {}
                  return;
                }
                console.log('[Fast4MP content] Injecting saved listing data for relist', data.title || data.inventoryName);
                try {
                  // Title
                  const titleEl = document.querySelector('input[name="title"], input[aria-label*="title" i], input[placeholder*="title" i]');
                  if (titleEl) try { titleEl.value = data.title || data.inventoryName || ''; } catch (e) {}
                  // Description
                  const descEl = document.querySelector('textarea[name="description"], textarea[aria-label*="description" i], textarea[placeholder*="description" i]');
                  if (descEl) try { descEl.value = data.description || data.body || ''; } catch (e) {}
                  // Price
                  const priceEl = document.querySelector('input[name="price"], input[aria-label*="price" i], input[placeholder*="price" i]');
                  if (priceEl && (data.price !== undefined && data.price !== null)) try { priceEl.value = String(data.price); } catch (e) {}
                  // Category hint (if present)
                  if (data.category) {
                    try {
                      const mapCat = (v) => { try { return /mattress/i.test((v||'').toString()) ? 'Furniture' : v; } catch (e) { return v; } };
                      const sel = Array.from(document.querySelectorAll('select, input')).find(el => (el && (el.name||'').toLowerCase().includes('category')) || (el && (el.getAttribute && el.getAttribute('aria-label')||'').toLowerCase().includes('category')));
                      if (sel) { try { sel.value = mapCat(data.category); } catch (e) {} }
                    } catch (e) {}
                  }

                  // Images: attempt to call any site-specific upload helper if available; otherwise log images for manual attach
                  try {
                    const imgs = data.images || data.s3ImageKeys || [];
                    if (imgs && imgs.length) {
                      // Try known upload helper names
                      const uploadFns = [ 'ffmUploadImageToFacebook', 'uploadImageToFacebook', 'ffm_upload_image', 'uploadImage' ];
                      let used = false;
                      for (const fnName of uploadFns) {
                        try {
                          const fn = window[fnName];
                          if (typeof fn === 'function') {
                            for (const img of imgs) {
                              try { await fn(img); } catch (e) { console.warn('[Fast4MP content] image upload helper failed', fnName, e); }
                            }
                            used = true;
                            break;
                          }
                        } catch (e) {}
                      }
                      if (!used) {
                        console.log('[Fast4MP content] relist payload contains images but no upload helper found; images are preserved in storage under ffm_relist_payload', imgs.length);
                      }
                    }
                  } catch (e) { console.warn('[Fast4MP content] image injection error', e); }

                  try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
                } catch (e) { console.warn('[Fast4MP content] Failed to inject relist payload', e); try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
              } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
            });
          } catch (e) { console.warn('[Fast4MP content] ffm_inject_relist_payload handler failed', e); }
          return true; // keep channel open while storage read completes
        } catch (e) {}
      } catch (e) {}
    });
  }
} catch (e) { console.debug('[Fast4MP content] install ffm_inject_relist_payload listener failed', e); }

      // Listen for select-mode start: popup -> background -> content
      try {
        if (chrome && chrome.runtime && chrome.runtime.onMessage) {
          chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            try {
              if (!msg || !msg.action) return;
              if (msg.action === "ffm-start-select-images") {
                try { console.debug && console.debug('[Fast4MP content] Received ffm-start-select-images → activating picker'); } catch (e) {}
                try { startSharetownSelectMode(); } catch (e) { console.error('[Fast4MP content] startSharetownSelectMode failed', e); }
                try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
                return true;
              }
            } catch (e) {}
          });
        }
      } catch (e) {}

          // SDNR: bypass title_search entirely and hand off to background selling-scraper
          try {
            if (chrome && chrome.runtime && chrome.runtime.onMessage) {
              chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
                try {
                  if (!msg || (msg.type !== 'ffm_dnr_try_title_search' && msg.action !== 'ffm_dnr_try_title_search')) return;

                  const payload = msg.payload || msg || {};
                  try { console.log('[DnR Scheduled] SDNR start → SKIPPING title_search completely. Using selling scraper only.', payload); } catch (e) {}

                  // Immediately hand off to background fallback and mark as scheduled
                  try {
                    chrome.runtime.sendMessage({
                      type: 'ffm_sdnr_fallback',
                      taskId: payload.taskId,
                      listingTitle: payload.dnrTitle || payload.listingTitle || '',
                      inventoryName: payload.inventoryName || '',
                      scheduled: true
                    });
                  } catch (e) {
                    console.warn('[DnR Scheduled] failed to send SDNR fallback message', e);
                  }

                  return;
                } catch (e) {}
                return false;
              });
            }
          } catch (e) { console.debug('[Fast4MP content] install ffm_dnr_try_title_search listener failed', e); }

// Helper: wrapper to run the title-search fast-path (keeps API stable for callers)
async function ffmRunTitleSearchFastPath(listing, scheduledMode) {
  try {
    return await ffmTryDeleteViaTitleSearch(listing || {}, !!scheduledMode);
  } catch (e) {
    return { success: false, fallback: true, reason: 'exception', error: String(e) };
  }
}

          // --- NEW: Fast-path delete using title_search URL ------------------------
          // Helper: preload scroll for scheduled DnR so FB lazy-loading populates cards
          async function ffmScrollTitleSearchForScheduledDNR() {
            try {
              console.log("[DnR] Scheduled: Starting scroll preload for title_search...");
              let lastHeight = 0;
              let sameCount = 0;
              const maxSame = 3;
              const step = 500;
              const pause = 300;
              // Attempt up to a reasonable number of iterations to avoid infinite loops
              const maxIters = 40;
              let iters = 0;
              while (sameCount < maxSame && iters < maxIters) {
                iters++;
                try { window.scrollBy(0, step); } catch (e) {}
                await new Promise(res => setTimeout(res, pause));
                try {
                  const newHeight = document.body ? document.body.scrollHeight : document.documentElement.scrollHeight;
                  if (newHeight === lastHeight) {
                    sameCount++;
                  } else {
                    sameCount = 0;
                    lastHeight = newHeight;
                  }
                } catch (e) { sameCount = 0; }
              }
              console.log("[DnR] Scheduled: Scroll preload complete.");
            } catch (e) {
              console.warn("[DnR] Scheduled: scroll preload failed", e);
            }
          }
          // --- NEW: Fast-path delete using title_search URL ----------------------------------
          async function ffmTryDeleteViaTitleSearch(fbDnrParams, scheduledMode) {
            // Short-circuit for scheduled Delete+Relist (SDnR): hand off to
            // the selling-page fallback so we avoid the fragile title_search fast-path.
            try {
              const payload = fbDnrParams || {};
              const {
                scheduledMode: payloadScheduled,
                taskId,
                tabId,
                inventoryName,
                dnrTitle,
                targetTitle: payloadTargetTitle,
                listingTitle
              } = payload;

              const isScheduled = !!(payloadScheduled || scheduledMode);
              if (isScheduled) {
                const fallbackTitle = dnrTitle || payloadTargetTitle || listingTitle || '';
                try { console.log('[DnR Scheduled] Skipping title_search fast-path; handoff to selling scraper fallback', { taskId, tabId, inventoryName, fallbackTitle }); } catch (e) {}
                try {
                  chrome.runtime.sendMessage({
                    type: 'ffm_sdnr_fallback',
                    taskId,
                    tabId,
                    listingTitle: fallbackTitle,
                    inventoryName
                  });
                } catch (e) {
                  console.warn('[DnR Scheduled] failed to send SDNR fallback message', e);
                }

                // Important: bail so the old title_search logic never runs for scheduled flows
                return;
              }

              // Non-scheduled flow continues into the original title_search implementation
              const targetTitle = (fbDnrParams && (fbDnrParams.listingTitle || fbDnrParams.title || fbDnrParams.inventoryName || fbDnrParams.listing && fbDnrParams.listing.title) || "").toString().trim();
              try { console.log('🎯 SDNR DEBUG — ffmTryDeleteViaTitleSearch start', { href: location.href, scheduledMode: !!scheduledMode, targetTitle: targetTitle && targetTitle.slice(0,200) }); } catch (e) {}
              const targetLower = (targetTitle || "").toLowerCase();

              const MAX_WAIT_MS = 10000; // 10 seconds
              const INTERVAL_MS = 1000; // 1 second
              const deadline = Date.now() + MAX_WAIT_MS;
              const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

              let cards = [];
              let attempt = 0;
              try { console.log('🎯 SDNR DEBUG — BEGIN CARD SCAN', { href: location.href }); } catch (e) {}
              while (Date.now() < deadline) {
                attempt++;
                cards = (typeof window._ffm_debug_cards === 'function') ? (Array.from(window._ffm_debug_cards() || [])) : (Array.from(document.querySelectorAll('div[role="article"]')) || []);
                try { console.log('[DnR] Content: Checking title_search results (fuzzy-match)…', { attempt, cardCount: cards.length, href: window.location && window.location.href }); } catch (e) {}
                if (cards.length > 0) break;
                await sleep(INTERVAL_MS);
              }

              const count = (cards && cards.length) || 0;
              try { console.log("[DnR] Content: Title_search results after wait:", { count }); } catch (e) {}

              if (count === 0) {
                if (scheduledMode) {
                  try { console.log('🎯 SDNR DEBUG — switching to shared_scrapers fallback immediately'); } catch (e) {}
                  try {
                    const payload = fbDnrParams || {};
                    console.log("🎯 SDNR DEBUG — switching to shared_scrapers fallback immediately");
                    chrome.runtime.sendMessage({
                      action: "ffm_sdnr_fallback_delete",
                      payload: {
                        inventoryName: payload.inventoryName,
                        listingTitle: payload.listingTitle,
                        title: payload.title || payload.listingTitle || payload.inventoryName || null,
                        originalPayload: payload
                      }
                    });
                  } catch (e) {}
                  // Indicate we forwarded to fallback
                  return { success: false, fallback: true, scheduled: true, reason: 'fallback_forwarded' };
                }

                try { console.log('[DnR] No title_search cards found after retry window — requesting fallback.'); } catch (e) {}
                return { success: false, fallback: true, reason: 'none' };
              }

              const getCardTitle = (card) => {
                try {
                  const candidates = Array.from(card.querySelectorAll('h1,h2,h3,span,div')).map(n => (n.textContent || '').trim()).filter(Boolean);
                  if (!candidates.length) return (card.innerText || '').trim();
                  candidates.sort((a,b) => b.length - a.length);
                  return candidates[0];
                } catch (e) { return (card.innerText || '').trim(); }
              };

              let bestCard = null; let bestScore = 0; let bestTitle = '';
              for (const card of cards) {
                try {
                  const title = (getCardTitle(card) || '').toString().trim();
                  const titleLower = title.toLowerCase();
                  let score = 0;
                  if (!targetLower) score = 0;
                  else if (titleLower === targetLower) score = 1.0;
                  else if (titleLower.includes(targetLower)) score = 0.9;
                  else if (targetLower.includes(titleLower) && titleLower.length > 0) score = 0.8;
                  else {
                    const targetTokens = targetLower.split(/\s+/).filter(Boolean);
                    const titleTokens = titleLower.split(/\s+/).filter(Boolean);
                    if (targetTokens.length && titleTokens.length) {
                      const tset = new Set(targetTokens);
                      let overlap = 0;
                      for (const t of titleTokens) if (tset.has(t)) overlap++;
                      const frac = overlap / Math.max(targetTokens.length, titleTokens.length);
                      if (!isNaN(frac)) score = frac * 0.7;
                    }
                  }
                  if (score > bestScore) { bestScore = score; bestCard = card; bestTitle = title; }
                } catch (e) {}
              }

              try { console.log('[DnR] Content: best title_search candidate', { bestScore, bestTitle, targetTitle }); } catch (e) {}

              const MIN_SCORE = 0.40;
              if (!bestCard || bestScore < MIN_SCORE) {
                try { console.log('[DnR] Weak or no title_search match — requesting fallback to selling.', { bestScore, minScore: MIN_SCORE }); } catch (e) {}
                return { success: false, fallback: true, reason: 'none' };
              }

              const seqRes = await ffmRunDeleteSequenceOnCard(bestCard);
              // Only report success when the content actually started a real delete action.
              // The delete sequence sets `window.__ffm_real_delete_started__` right before
              // dispatching the first real UI click; this prevents false-positive success
              // reports when no real actions were initiated.
              if (seqRes) {
                const realStarted = !!(window && window.__ffm_real_delete_started__);
                if (!realStarted) {
                  try { console.log('[DnR] Content: delete sequence reported success but no real delete actions started; treating as no-delete-actions'); } catch (e) {}
                  if (scheduledMode) {
                    return { success: false, fallback: false, scheduled: true, reason: 'no-delete-actions' };
                  }
                  return { success: false, fallback: true, reason: 'no-delete-actions' };
                }
                try { console.log('[DnR] Content: title_search fast-path delete succeeded.'); } catch (e) {}
                return { success: true, fallback: false, reason: 'matched' };
              }

            } catch (err) {
              console.error('[DnR] Content: ffmTryDeleteViaTitleSearch error', err);
              return { success: false, fallback: true, reason: 'error' };
            }
          }

          // --- NEW WRAPPER: Use existing delete functions on selected card ---------
          async function ffmRunDeleteSequenceOnCard(cardNode) {
            try {
              // If the page exposes helpers, prefer them
              if (typeof ffmClickCardMenu === 'function' && typeof ffmClickDeleteListingOption === 'function') {
                try {
                  try { window.__ffm_real_delete_started__ = true; } catch (e) {}
                  await ffmClickCardMenu(cardNode);
                  await ffmClickDeleteListingOption();
                  if (typeof ffmHandleDeletePopups === 'function') await ffmHandleDeletePopups();
                  if (typeof ffmConfirmDelete === 'function') await ffmConfirmDelete();
                  if (typeof ffmVerifyDeleted === 'function') await ffmVerifyDeleted();
                  return true;
                } catch (e) {
                  console.error('[DnR] Existing helper delete sequence failed, falling back', e);
                  // fall through to inline fallback below
                }
              }

              // Inline fallback: replicate robust delete sequence on the located card
              const sleep = (ms) => new Promise(r => setTimeout(r, ms));

              try {
                cardNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } catch (e) {}

              // Try find More/Options button inside card
              let moreBtn = null;
              try {
                const candidates = Array.from((cardNode.querySelectorAll('div[role="button"], button, a, span')) || []);
                moreBtn = candidates.find(el => {
                  try {
                    const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
                    const txt = (el.innerText || '').toString().toLowerCase();
                    const probe = (aria + '|' + txt).toLowerCase();
                    if (probe.includes('more options') || probe.includes('more actions') || probe.includes('options') || probe.includes('actions')) return true;
                    if (/\.{3}|•••|⋯/.test(el.textContent || '')) return true;
                    try { if (el.querySelector && el.querySelector('svg')) return true; } catch (e) {}
                  } catch (e) {}
                  return false;
                });
              } catch (e) {}

              if (!moreBtn) {
                // global fallback search for nearby More button
                try {
                  moreBtn = Array.from(document.querySelectorAll('div[aria-label][role="button"]'))
                    .find(el => {
                      try {
                        const a = (el.getAttribute && el.getAttribute('aria-label')) || '';
                        const an = a.toString().toLowerCase();
                        return an.includes('more options') || an.includes('more actions') || an.includes('options') || an.includes('actions');
                      } catch (e) { return false; }
                    });
                } catch (e) {}
              }

              if (!moreBtn) return false;

              try { moreBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
              try { try { window.__ffm_real_delete_started__ = true; } catch (e) {} moreBtn.click(); } catch (e) {}

              // Wait for menu + find Delete option
              let deleteOption = null;
              for (let i = 0; i < 20; i++) {
                try {
                  deleteOption = Array.from(document.querySelectorAll('div[role="menuitem"], span[dir="auto"], div[role="button"]'))
                    .find(el => /delete/i.test((el.innerText || '').toString()));
                } catch (e) {}
                if (deleteOption) break;
                await sleep(300);
              }

              if (!deleteOption) return false;
              try { deleteOption.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
              try { deleteOption.click(); } catch (e) {}

              // Wait for confirmation modal and click confirm
              for (let i = 0; i < 25; i++) {
                try {
                  const modalHeader = Array.from(document.querySelectorAll('span, h2, div'))
                    .find(el => (el.textContent || '').trim().toLowerCase() === 'delete listing');
                  if (modalHeader && modalHeader.offsetParent !== null) break;
                } catch (e) {}
                await sleep(300);
              }

              // Click confirm button
              let confirmBtn = Array.from(document.querySelectorAll("div[role='button'], button, span"))
                .find(el => {
                  try {
                    const aria = (el.getAttribute && el.getAttribute('aria-label'))?.toLowerCase() || '';
                    const text = (el.innerText || '').trim().toLowerCase();
                    return el.offsetParent !== null && (aria === 'delete' || text === 'delete' || text.includes('delete'));
                  } catch (e) { return false; }
                });

              if (confirmBtn) {
                try { confirmBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
                try { ['mouseover','mousedown','mouseup','click'].forEach(t => confirmBtn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); } catch (e) {}
              } else {
                const fallback = document.querySelector("div[aria-label='Delete'][role='button']");
                if (fallback) { try { fallback.click(); } catch (e) {} }
              }

              // Verify modal closed
              for (let i = 0; i < 20; i++) {
                const stillThere = Array.from(document.querySelectorAll('span, h2')).some(el => (el.textContent || '').trim().toLowerCase() === 'delete listing');
                if (!stillThere) return true;
                await sleep(300);
              }

              return false;
            } catch (err) {
              console.error('[DnR] Delete sequence failed:', err);
              return false;
            }
          }

      // Basic implementation: highlight inventory items and send selection back to background/popup
      function startSharetownSelectMode() {
        try {
          const items = document.querySelectorAll('[data-testid="inventory-item"], .inventory-item');
          items.forEach(el => {
            try {
              el.style.outline = '2px solid #00c4ff';
              el.style.cursor = 'pointer';
              const handler = (e) => {
                try {
                  e.preventDefault();
                  e.stopPropagation();
                  const name = el.innerText || (el.querySelector && el.querySelector('h3') && el.querySelector('h3').innerText) || 'Unknown Item';
                  try { console.debug && console.debug('[Fast4MP content] Item selected:', name); } catch (er) {}
                  try { chrome.runtime.sendMessage({ action: 'sharetown_item_selected', data: { name } }); } catch (er) {}
                } catch (err) { console.error('[Fast4MP content] select handler failed', err); }
              };
              el.addEventListener('click', handler, { once: true });
            } catch (e) {}
          });
        } catch (err) {
          console.error('[Fast4MP content] startSharetownSelectMode failed', err);
        }
      }

      (function ffmCleanupFacebookLayout() {
  try {
    const href = (window && window.location && window.location.href) ? window.location.href : '';
    if (!/facebook\.com/.test(href)) return;
  try { if (window && window.ffm_debug) console.debug('ffm: running Facebook layout cleanup to remove injected extension UI'); } catch (_) {}

    // Remove well-known injected IDs
    const ids = ['extension-pin-panel', 'ffm-pin-iframe', 'ffm-debug-overlay', 'ffm-hide-confirm-overlay'];
    ids.forEach(id => {
      try { const el = document.getElementById(id); if (el && el.parentElement) el.parentElement.removeChild(el); } catch (e) {}
    });

    // Remove elements whose id starts with ffm- or class contains ffm-
    try {
      const q = Array.from(document.querySelectorAll('[id^="ffm-"], [class*="ffm-"]'));
      q.forEach(el => { try { if (el && el.parentElement) el.parentElement.removeChild(el); } catch (e) {} });
    } catch (e) {}

    // Remove iframes pointing to our extension popup (best-effort)
    try {
      const popupUrl = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('popup.html') : null;
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const f of iframes) {
        try {
          if (f && f.src && popupUrl && f.src.indexOf(popupUrl) !== -1) { f.parentElement && f.parentElement.removeChild(f); }
        } catch (e) {}
      }
    } catch (e) {}

    // Remove style tags that look like they were injected by the extension
    try {
      const styles = Array.from(document.querySelectorAll('style'));
      for (const s of styles) {
        try { 
          if (s && s.innerText) {
            const css = s.innerText.toLowerCase();
            // Remove styles containing extension markers OR problematic popup CSS
            if (/ffm|ffm-|extension-pin|extension-pin-panel|420px|720px|#extension-sidebar/.test(css)) {
              s.parentElement && s.parentElement.removeChild(s);
              try { if (window && window.ffm_debug) console.debug('Removed extension-injected style tag'); } catch (_) {}
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Remove any link tags that might reference the extension's CSS
    try {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      for (const link of links) {
        try {
          if (link && link.href && link.href.includes('styles.css') && link.href.includes('chrome-extension://')) {
            link.parentElement && link.parentElement.removeChild(link);
            try { if (window && window.ffm_debug) console.debug('Removed extension CSS link tag'); } catch (_) {}
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Clear inline layout styles that could constrain Facebook's layout
    try {
      const props = ['width','maxWidth','minWidth','height','maxHeight','minHeight','marginLeft','marginRight','marginTop','marginBottom','transform','position','left','right','top','bottom','overflow','padding'];
      props.forEach(p => {
        try { if (document.documentElement && document.documentElement.style) document.documentElement.style[p] = ''; } catch (e) {}
        try { if (document.body && document.body.style) document.body.style[p] = ''; } catch (e) {}
      });
      
      // Force reset critical layout properties that the extension might have modified
      try {
        if (document.documentElement) {
          document.documentElement.style.cssText = '';
        }
        if (document.body) {
          document.body.style.cssText = '';
        }
      } catch (e) {}
    } catch (e) {}

    // As a last resort, remove obvious very-high-z-index overlays created by the extension
    try {
      const candidates = Array.from(document.querySelectorAll('div, section, aside'));
      for (const c of candidates) {
        try {
          const z = window.getComputedStyle(c).zIndex;
          if (z && !isNaN(parseInt(z)) && parseInt(z) > 1000000) {
            // only remove if it looks extension-ish (id/class contains extension/ffm)
            const idc = (c.id || '').toLowerCase();
            const cls = (c.className || '').toString().toLowerCase();
            if (idc.includes('extension') || idc.includes('ffm') || cls.includes('extension') || cls.includes('ffm')) {
              c.parentElement && c.parentElement.removeChild(c);
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Prevent further panel injection on this page session
    try { window.ffm_panel_disabled = true; } catch (e) {}

  try { if (window && window.ffm_debug) console.debug('ffm: Facebook cleanup complete — UI elements removed and layout restored'); } catch (_) {}
  } catch (err) {
    try { console.debug('ffmCleanupFacebookLayout error', err); } catch (e) {}
  }
})();

// If the user prefers the Side Panel or we've set a per-tab block flag, install a
// persistent blocker that removes any bubble/hint elements immediately and on future inserts.
(function persistentBubbleBlocker() {
  try {
    // Async helper to get our tab id from background
    const getMyTabId = async () => {
      try {
        return await new Promise((res) => { try { chrome.runtime.sendMessage({ action: 'whoami_tab' }, (r) => res(r && r.tabId ? r.tabId : null)); } catch (e) { res(null); } });
      } catch (e) { return null; }
    };

    const ensureBlocker = async () => {
      try {
        const tabId = await getMyTabId();
        const keys = ['ffm_use_sidepanel'];
        if (tabId) keys.push('ffm_block_bubble_tab_' + tabId);
        const vals = await new Promise((res) => { try { chrome.storage && chrome.storage.local && chrome.storage.local.get(keys, (r) => res(r || {})); } catch (e) { res({}); } });
        const usePanel = !!(vals && vals.ffm_use_sidepanel);
        const tabBlocked = tabId ? !!(vals && vals['ffm_block_bubble_tab_' + tabId]) : false;
        if (!usePanel && !tabBlocked) return;

        function removeAny() {
          try { const a = document.querySelectorAll('#ffm-fb-select-hint, #sharetown-hint-bubble, #embedded-hint'); for (const n of a) { try { n.parentNode && n.parentNode.removeChild(n); } catch(e){} } } catch (e) {}
        }
        removeAny();

        try {
          const mo = new MutationObserver((records) => {
            try {
              for (const r of records) {
                for (const n of r.addedNodes) {
                  try {
                    if (!n) continue;
                    if (n.id && (n.id === 'ffm-fb-select-hint' || n.id === 'sharetown-hint-bubble' || n.id === 'embedded-hint')) {
                      n.parentNode && n.parentNode.removeChild(n);
                      continue;
                    }
                    if (n.querySelector) {
                      const found = n.querySelector('#ffm-fb-select-hint, #sharetown-hint-bubble, #embedded-hint');
                      if (found && found.parentNode) found.parentNode.removeChild(found);
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {}
          });
          mo.observe(document.documentElement || document, { childList: true, subtree: true });
          // Keep this observer running for the session to block any bubble creation.
        } catch (e) {}
      } catch (e) {}
    };

    // Run async (fire-and-forget)
    try { ensureBlocker(); } catch (e) {}
  } catch (e) {}
})();

// ===== Fast4MP: Auto Active Listings refresh (robust + debug) =====
(function() {
  if (window.__ffmAutoRefreshWired) return;
  window.__ffmAutoRefreshWired = true;

  // Unified onMessage listener for legacy and hidden-tab Active Sync
  try {
    let FFM_AS_HIDDEN = false;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || !msg.action) return;

        // Legacy / popup-triggered AS
        if (msg.action === 'ffmActiveListingsAuto') {
          try { console.log('[Fast4MP content] Received ffmActiveListingsAuto'); } catch (e) {}
          if (typeof window.ffmScrapeActiveListingsOnce === 'function') {
            window.ffmScrapeActiveListingsOnce()
              .then(() => sendResponse && sendResponse({ ok: true }))
              .catch(err => sendResponse && sendResponse({ ok: false, error: String(err) }));
            return true;
          }
        }

        // Hidden-tab handshake
        if (msg.action === 'ffm_as_prepare_hidden') {
          FFM_AS_HIDDEN = true;
          try { console.log('[Fast4MP AS] Hidden mode enabled'); } catch (e) {}
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
          return; // respond immediately to avoid port-closed issues
        }

        // Hidden-tab AS execution — ensure deterministic readiness before scraping
        if (msg.action === 'ffm_run_active_sync_hidden') {
          (async () => {
            if (window && window.__ffm_as_running) {
              try { console.warn('[AS] Duplicate AS run blocked'); } catch (e) {}
              return;
            }
            try { window.__ffm_as_running = true; } catch (e) {}

            try { console.log('[Fast4MP AS] Starting hidden scrape (handshake)'); } catch (e) {}

            // 1) Wait for marketplace readiness (route, initial cards, container init, stability)
            try {
              if (typeof window.ffmAsWaitForMarketplaceReady === 'function') {
                try { await window.ffmAsWaitForMarketplaceReady(); } catch (e) {}
              } else {
                // Fallback to the local implementation used by URL autorun
                try {
                  async function ffmAsWaitForMarketplaceReady({ timeoutMs = 15000, stableMs = 800 } = {}) {
                    const start = Date.now();
                    let lastCount = 0;
                    let lastChange = Date.now();

                    while (Date.now() - start < timeoutMs) {
                      try {
                        if (!location || !location.pathname || !String(location.pathname).includes('/marketplace/you/selling')) {
                          await new Promise(r => setTimeout(r, 300));
                          continue;
                        }

                        const count = document.querySelectorAll('a[href*="/marketplace/item/"]').length || document.querySelectorAll('div[aria-label]').length;

                        if (count !== lastCount) {
                          lastCount = count;
                          lastChange = Date.now();
                        }

                        if (count > 0 && (Date.now() - lastChange) >= stableMs) {
                          try { console.log('[AS] Marketplace ready (hidden run):', { count }); } catch (e) {}
                          return true;
                        }
                      } catch (e) {}
                      await new Promise(r => setTimeout(r, 250));
                    }
                    try { console.warn('[AS] Marketplace readiness timeout (hidden run)'); } catch (e) {}
                    return false;
                  }
                  await ffmAsWaitForMarketplaceReady();
                } catch (e) {}
              }
            } catch (e) {}

            // New: wait for DOM to settle before attempting expansion/scroll
            try { await ffmWaitForRenderSettle(); } catch (e) {}

            // 2) Try container expansion first, else fall back to scroll-stabilizer
            try {
              const scroller = (typeof window.ffmFindAnyLargeScroller === 'function') ? window.ffmFindAnyLargeScroller() : ffmFindAnyLargeScroller();
              if (scroller) {
                try { (typeof window.ffmForceRenderAllListings === 'function' ? window.ffmForceRenderAllListings(scroller) : ffmForceRenderAllListings(scroller)); } catch (e) {}
                await new Promise(r => setTimeout(r, 1200));
              } else {
                try { await (typeof window.ffmAsScrollSellingUntilStable === 'function' ? window.ffmAsScrollSellingUntilStable() : ffmAsScrollSellingUntilStable()); } catch (e) { try { console.warn('[Fast4MP AS] ffmAsScrollSellingUntilStable failed', e); } catch (er) {} }
              }
            } catch (e) {}

            // 3) Run the existing scraper (prefer ffmAsScrapeCards if present)
            try {
              const scraper = (typeof window.ffmAsScrapeCards === 'function') ? window.ffmAsScrapeCards : (typeof window.ffmScrapeActiveListingsOnce === 'function' ? window.ffmScrapeActiveListingsOnce : null);
              const results = scraper ? await scraper() : null;
              try { await ffmAsDebugHold(15000); } catch (e) {}
              try { chrome.runtime.sendMessage({ action: 'ffm_as_results', results }); } catch (e) {}
            } catch (e) {
              try { console.warn('[Fast4MP AS] ffmScrapeActiveListingsOnce error (hidden run)', e); } catch (er) {}
              try { await ffmAsDebugHold(15000); } catch (e) {}
              try { chrome.runtime.sendMessage({ action: 'ffm_as_results', error: String(e) }); } catch (err) {}
            }
          })();

          try { window.__ffm_as_running = false; } catch (e) {}
          return;
        }
      } catch (e) { try { console.warn('[Fast4MP AS] onMessage error', e); } catch (er) {} }
    });
  } catch (e) {}

  // URL-driven hidden-tab autorun: when the page is opened with ?ffm_as=1&ffm_as_req=<id>
  // Behavior-based scroller detection (AS-only). Returns candidates to probe.
  function ffmFindSellingScrollerByBehavior() {
    try {
      const candidates = Array.from(document.querySelectorAll('div'))
        .filter(el => {
          let style = null;
          try { style = getComputedStyle(el); } catch (e) { return false; }
          if (!style) return false;
          try { if (!(el.scrollHeight > el.clientHeight + 300)) return false; } catch (e) { return false; }
          if (!(style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay')) return false;
          return true;
        });

      return candidates;
    } catch (e) { return []; }
  }

  // Probe which candidate actually causes cards to load when scrolled.
  async function ffmDetectActiveSellingScroller() {
    try {
      const candidates = ffmFindSellingScrollerByBehavior();
      if (!candidates || !candidates.length) return null;

      const baselineCount = document.querySelectorAll('a[href*="/marketplace/item/"], div[aria-label]').length;

      for (const el of candidates) {
        let prevScrollTop = 0;
        try { prevScrollTop = el.scrollTop; } catch (e) {}

        try { el.scrollTop = el.scrollHeight; } catch (e) {}
        await new Promise(r => setTimeout(r, 800));

        const newCount = document.querySelectorAll('a[href*="/marketplace/item/"], div[aria-label]').length;

        try { el.scrollTop = prevScrollTop; } catch (e) {}

        if (newCount > baselineCount) {
          try { console.log('[AS hidden] Detected active selling scroller', el); } catch (e) {}
          return el;
        }
      }

      try { console.warn('[AS hidden] No active selling scroller detected'); } catch (e) {}
      return null;
    } catch (e) { return null; }
  }

  // Final production-ready AS scroll loop: probes scrollers and scrolls until card count stabilizes.
  async function ffmAsScrollSellingUntilStable({
    maxRounds = 20,
    stableRounds = 3,
    delay = 900,
  } = {}) {
    try {
      const scroller = await ffmDetectActiveSellingScroller();
      if (!scroller) return 0;

      let lastCount = 0;
      let stable = 0;

      for (let i = 0; i < maxRounds; i++) {
        try { scroller.scrollTop = scroller.scrollHeight; } catch (e) {}

        await new Promise(r => setTimeout(r, delay));

        let count = 0;
        try { count = document.querySelectorAll('a[href*="/marketplace/item/"]').length; } catch (e) { count = 0; }

        try { console.log(`[AS hidden] scroll ${i + 1}, cards=${count}`); } catch (e) {}

        if (count > lastCount) {
          lastCount = count;
          stable = 0;
        } else {
          stable++;
          if (stable >= stableRounds) {
            try { console.log('[AS hidden] card count stabilized'); } catch (e) {}
            break;
          }
        }
      }

      return lastCount;
    } catch (e) { return 0; }
  }

  // AS-only: find any large scroller (simple version)
  function ffmFindAnyLargeScroller() {
    try {
      return Array.from(document.querySelectorAll('div')).find(el => {
        let style = null;
        try { style = getComputedStyle(el); } catch (e) { return false; }
        if (!style) return false;
        try { if (!(el.scrollHeight > el.clientHeight + 200)) return false; } catch (e) { return false; }
        if (!(style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay')) return false;
        return true;
      }) || null;
    } catch (e) { return null; }
  }

  // Force the container to expand so all React-rendered children mount
  function ffmForceRenderAllListings(scroller) {
    if (!scroller) return;
    try { console.log('[AS hidden] Forcing container expansion'); } catch (e) {}
    try { scroller.__ffm_origHeight = scroller.style.height; } catch (e) {}
    try { scroller.__ffm_origMaxHeight = scroller.style.maxHeight; } catch (e) {}
    try { scroller.style.height = '100000px'; scroller.style.maxHeight = '100000px'; } catch (e) {}
  }

  // Optional: restore scroller styles
  function ffmRestoreScroller(scroller) {
    if (!scroller) return;
    try { scroller.style.height = scroller.__ffm_origHeight || ''; } catch (e) {}
    try { scroller.style.maxHeight = scroller.__ffm_origMaxHeight || ''; } catch (e) {}
  }

  // AS-only: reliable card-count metric and nudger
  function ffmAsCountSellingCards() {
    try {
      return document.querySelectorAll('[aria-label*="Mark as sold"]').length;
    } catch (e) { return 0; }
  }

  function ffmAsNudgeSellingList() {
    try { window.scrollBy(0, 1200); } catch (e) {}
    try {
      const se = document.scrollingElement;
      if (se) se.scrollTop = se.scrollHeight;
    } catch (e) {}
  }

  // Force viewport/layout signals FB listens to (resize + layout read + tiny scroll jitter)
  function ffmAsForceViewportRefresh() {
    try {
      // Trigger resize listeners
      window.dispatchEvent(new Event('resize'));

      // Force layout read
      document.body && document.body.getBoundingClientRect();

      // Small scroll jitter (even if no scroller)
      try { window.scrollBy(0, 1); } catch (e) {}
      try { window.scrollBy(0, -1); } catch (e) {}
    } catch (e) {}
  }

  // Robust read of FB's authoritative active listings count (matches "<number> active listings")
  function ffmAsReadActiveListingCount() {
    try {
      const spans = Array.from(document.querySelectorAll('span'));
      for (const el of spans) {
        try {
          const text = (el.textContent || '').trim();
          if (!text) continue;
          const m = text.match(/^(\d+)\s+active listings$/i);
          if (m) return Number(m[1]);
        } catch (e) { /* ignore per-span errors */ }
      }
    } catch (e) {}
    return null;
  }

  // Wait until FB's authoritative count is rendered and at least that many cards are present
  async function ffmAsWaitUntilAllActiveListingsPresent({
    timeoutMs = 25000,
    tickMs = 700,
  } = {}) {
    const start = Date.now();
    let expected = null;

    while (Date.now() - start < timeoutMs) {
      try {
        if (expected == null) {
          expected = ffmAsReadActiveListingCount();
          if (expected != null) {
            try { console.log('[AS] FB active listings count:', expected); } catch (e) {}
          }
        }

        // NEW: force viewport/resize signals that FB listens to (no focus required)
        try { ffmAsForceViewportRefresh(); } catch (e) {}
        // Also nudge the list to trigger lazy-load
        try { ffmAsNudgeSellingList(); } catch (e) {}

        await new Promise(r => setTimeout(r, tickMs));

        const rendered = ffmAsCountSellingCards();
        try { console.log('[AS] card probe', { rendered, expected }); } catch (e) {}

        if (expected != null && rendered >= expected) {
          try { console.log('[AS] all active listings rendered'); } catch (e) {}
          return rendered;
        }
      } catch (e) {}
    }

    try { console.warn('[AS] timed out waiting for all active listings', { expected, rendered: ffmAsCountSellingCards() }); } catch (e) {}
    return ffmAsCountSellingCards();
  }

  async function ffmAsWaitForCardsStabilized({
    timeoutMs = 20000,
    tickMs = 800,
    stableRounds = 3,
    minCards = 1,
  } = {}) {
    const start = Date.now();
    let last = -1;
    let stable = 0;

    while (Date.now() - start < timeoutMs) {
      try { ffmAsNudgeSellingList(); } catch (e) {}
      await new Promise(r => setTimeout(r, tickMs));

      const n = ffmAsCountSellingCards();
      try { console.log('[AS] card probe', { n, stable }); } catch (e) {}

      if (n < minCards) {
        stable = 0;
        last = n;
        continue;
      }

      if (n === last) {
        stable++;
        if (stable >= stableRounds) {
          try { console.log('[AS] cards stabilized', { n }); } catch (e) {}
          return n;
        }
      } else {
        stable = 0;
        last = n;
      }
    }

    try { console.warn('[AS] card stabilization timeout', { last }); } catch (e) {}
    return ffmAsCountSellingCards();
  }

  // Ensure all cards are loaded: prefer container expansion, else use scroll-stabilizer
  async function ffmAsEnsureAllCardsLoaded() {
    try {
      const scroller = (typeof window.ffmFindAnyLargeScroller === 'function') ? window.ffmFindAnyLargeScroller() : ffmFindAnyLargeScroller();
      if (scroller) {
        try { ffmForceRenderAllListings(scroller); } catch (e) {}
        // Give React / virtualization time to mount children
        await new Promise(r => setTimeout(r, 1200));
        try { ffmRestoreScroller(scroller); } catch (e) {}
        return true;
      }

      // Fallback: run the scroll-until-stable loop and await completion
      try { await (typeof window.ffmAsScrollSellingUntilStable === 'function' ? window.ffmAsScrollSellingUntilStable() : ffmAsScrollSellingUntilStable()); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }

  // DEBUG hold (temporary) — forces tab to stay open for inspection
  const FFM_AS_DEBUG_HOLD = true; // TEMPORARY
  function ffmAsDebugHold(ms = 10000) {
    if (!FFM_AS_DEBUG_HOLD) return Promise.resolve();
    try { console.warn(`[AS DEBUG] Holding tab open for ${ms}ms`); } catch (e) {}
    return new Promise(r => setTimeout(r, ms));
  }

  // Render settle helper — ensures DOM stops mutating for a short window
  async function ffmWaitForRenderSettle({ settleMs = 1200, timeoutMs = 8000 } = {}) {
    try {
      let lastHtmlSize = 0;
      let stableFor = 0;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        let size = 0;
        try { size = document.body && document.body.innerHTML ? document.body.innerHTML.length : 0; } catch (e) { size = 0; }

        if (size === lastHtmlSize) {
          stableFor += 250;
          if (stableFor >= settleMs) {
            try { console.log('[AS] DOM settled'); } catch (e) {}
            return;
          }
        } else {
          stableFor = 0;
          lastHtmlSize = size;
        }

        await new Promise(r => setTimeout(r, 250));
      }
      // DOM did not settle within timeout — proceed quietly to avoid noisy logs
    } catch (e) { }
  }

  (async function ffmAutorunHiddenASFromUrl(){
    try {
      const params = (typeof location !== 'undefined' && location.search) ? new URLSearchParams(location.search) : null;
      if (!params) return;
      if (params.get('ffm_as') !== '1') return;
      const reqId = params.get('ffm_as_req') || (String(Date.now()) + '-' + Math.floor(Math.random()*100000));
      try { console.log('[Fast4MP AS] URL-driven hidden AS detected, reqId=', reqId); } catch (e) {}

      // Prevent duplicate AS runs in the same tab
      if (window && window.__ffm_as_running) {
        try { console.warn('[AS] Duplicate AS run blocked (autorun)'); } catch (e) {}
        return;
      }
      try { window.__ffm_as_running = true; } catch (e) {}

      try {
        // Inject unobtrusive overlay for debugging/visibility
        try { ffmInjectAsOverlay(); } catch (e) {}

        // 1) Wait for Marketplace readiness (route, initial cards, container init, stability)
        try {
          if (typeof window.ffmAsWaitForMarketplaceReady === 'function') {
            try { await window.ffmAsWaitForMarketplaceReady(); } catch (e) {}
          } else {
            // fallback local impl
            try {
              async function ffmAsWaitForMarketplaceReady({ timeoutMs = 15000, stableMs = 800 } = {}) {
                const start = Date.now();
                let lastCount = 0;
                let lastChange = Date.now();

                while (Date.now() - start < timeoutMs) {
                  try {
                    if (!location || !location.pathname || !String(location.pathname).includes('/marketplace/you/selling')) {
                      await new Promise(r => setTimeout(r, 300));
                      continue;
                    }

                    const count = document.querySelectorAll('a[href*="/marketplace/item/"]').length || document.querySelectorAll('div[aria-label]').length;

                    if (count !== lastCount) {
                      lastCount = count;
                      lastChange = Date.now();
                    }

                    if (count > 0 && (Date.now() - lastChange) >= stableMs) {
                      try { console.log('[AS] Marketplace ready:', { count }); } catch (e) {}
                      return true;
                    }
                  } catch (e) {}
                  await new Promise(r => setTimeout(r, 250));
                }
                try { console.warn('[AS] Marketplace readiness timeout'); } catch (e) {}
                return false;
              }
              await ffmAsWaitForMarketplaceReady();
            } catch (e) {}
          }
        } catch (e) {}

        // 2) Wait for DOM to settle briefly
        try { await ffmWaitForRenderSettle(); } catch (e) {}

        // 3) Ensure DOM settled (already done). Next: authoritative gate — wait until FB's active listings count is rendered and that many cards are present
        try {
          const params = (typeof location !== 'undefined' && location.search) ? new URLSearchParams(location.search) : null;
          const isHiddenAS = params ? params.has('ffm_as') : false;
          if (isHiddenAS) {
            try { console.log('[AS] hidden mode — skipping wait-for-all'); } catch (e) {}
          } else {
            try { await ffmAsWaitUntilAllActiveListingsPresent(); } catch (e) { try { console.warn('[Fast4MP AS] ffmAsWaitUntilAllActiveListingsPresent failed', e); } catch (er) {} }
          }
        } catch (e) {}

        // 4) Run scraper (explicit source tag for AS flows)
        let results = null;
        try {
          if (typeof ffmScrapeActiveListingsOnce === 'function') {
            results = await ffmScrapeActiveListingsOnce({ source: 'AS' });
          } else if (typeof window.ffmAsScrapeCards === 'function') {
            results = await window.ffmAsScrapeCards();
          } else if (typeof window.ffmScrapeActiveListingsOnce === 'function') {
            results = await window.ffmScrapeActiveListingsOnce({ source: 'AS' });
          }
        } catch (e) {
          try { console.warn('[Fast4MP AS] scraper invocation failed', e); } catch (er) {}
          results = null;
        }

        // 5) Send result to background — background will handle closing the tab
        try {
          const expected = (typeof ffmAsReadActiveListingCount === 'function') ? ffmAsReadActiveListingCount() : null;
          let listingsToSend = results;
          try {
            if (Array.isArray(listingsToSend)) {
              const bad = /see previous notifications/i;
              listingsToSend = listingsToSend.filter(x => x && x.title && !bad.test(x.title));
            }
          } catch (e) {}
          chrome.runtime.sendMessage({ action: 'ffm_as_hidden_result', reqId, listings: listingsToSend, meta: { href: location.href, expected } });
        } catch (e) {}
        try { window.__ffm_as_running = false; } catch (e) {}
      } catch (e) {
        try { chrome.runtime.sendMessage({ action: 'ffm_as_hidden_result', reqId, error: String(e), meta: { href: location.href } }); } catch (er) {}
        try { window.__ffm_as_running = false; } catch (e) {}
      }
    } catch (e) {}
  })();

  // Listen so bg can trigger an auto/forced run
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.action === 'ffmActiveListingsAuto') {
      try { console.log('[Fast4MP content] Received ffmActiveListingsAuto — running auto-refresh'); } catch (e) {}
      // If a direct one-shot scrape implementation exists, prefer it (faster, more deterministic)
      try {
        if (typeof window.ffmScrapeActiveListingsOnce === 'function') {
          try {
            window.ffmScrapeActiveListingsOnce().then(() => {
              try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            }).catch((err) => {
              try { console.warn('[Fast4MP content] ffmScrapeActiveListingsOnce threw', err); } catch (e) {}
              try { sendResponse && sendResponse({ ok: false, error: String(err) }); } catch (e) {}
            });
            return true; // keep port open for async response
          } catch (e) {
            try { console.warn('[Fast4MP content] error invoking ffmScrapeActiveListingsOnce', e); } catch (er) {}
          }
        }
      } catch (e) { /* ignore and fall back */ }
      

      // Fallback: run the higher-level auto-refresh flow
      (async () => {
        // Content-script watchdog: ensure Auto Active Scan can't run indefinitely
        const AAS_MAX_RUNTIME = 15 * 60 * 1000; // 15 minutes
        const aasFailSafe = setTimeout(() => {
          try { console.warn('[AAS] Max runtime reached — closing tab'); } catch (e) {}
          try { chrome.runtime.sendMessage({ action: 'AAS_TIMEOUT', ts: Date.now() }); } catch (e) {}
          try { window.close(); } catch (e) {}
        }, AAS_MAX_RUNTIME);

        let res;
        try {
          res = await ffmAutoActiveListingsRefresh(!!msg.forced);
        } catch (err) {
          res = { ok: false, error: String(err) };
        }

        try { sendResponse(res); } catch (e) {}

        try {
          // Primary completion message background expects
          chrome.runtime.sendMessage({ action: 'ffm_AAS_auto_complete', summary: { mode: 'auto', ts: Date.now(), result: res } });
        } catch (e) {}

        // Clear watchdog and signal success, then close the helper tab.
        try { clearTimeout(aasFailSafe); } catch (e) {}
        try { chrome.runtime.sendMessage({ action: 'AAS_DONE', ts: Date.now(), result: res }); } catch (e) {}
        try { window.close(); } catch (e) {}
      })();
      return true; // async
    }
  });

  // Lightweight warm-up scroll endpoint used by the hybrid AS window flow.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      try {
        if (!msg || msg.action !== 'ffm_as_warmup') return;
        // Perform a single large scroll and report whether scroll position changed.
        try {
          const before = (window.scrollY || window.pageYOffset || 0);
          try { window.scrollBy(0, Math.floor(window.innerHeight * 0.9)); } catch (e) {}
          // Give browser a short moment to apply scroll
          setTimeout(() => {
            try {
              const after = (window.scrollY || window.pageYOffset || 0);
              const did = (after > before);
              try { sendResponse && sendResponse({ didScroll: !!did }); } catch (e) {}
            } catch (e) { try { sendResponse && sendResponse({ didScroll: false }); } catch(_){} }
          }, 250);
          return true; // async response
        } catch (e) { try { sendResponse && sendResponse({ didScroll: false }); } catch(_){} }
      } catch (e) {}
    });
  } catch (e) {}

  // Public helper (and used by message handler)
  async function ffmAutoActiveListingsRefresh(forced = false) {
    const t0 = performance.now();
    console.log(`[Fast4MP content] Performing auto Active Listings refresh…${forced ? " (forced)" : ""}`);

    // debug logs removed

    try {
      // Guard: if already finalized, ignore auto-refresh
      try {
        if (window.__ffm_as_finalized) {
          try { console.log('[Fast4MP content] Auto-refresh ignored — already finalized'); } catch (e) {}
          return { ok: false, reason: 'already_finalized' };
        }
      } catch (e) {}

      // 1) Stage 1: initial settle
      await sleep(800); // give React a tiny beat

      // 2) Stage 2: progressive scroll & probe for cards
      //    We scroll multiple screens, probing for card counts, until stable or timeout.
      const wantMin = 8;            // "enough" cards to trust scraping
      const maxScrolls = 18;        // safety cap
      const perScrollWait = 700;    // ms between scrolls
      let bestSeen = 0;

      for (let i = 0; i < maxScrolls; i++) {
        window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
        await sleep(perScrollWait);

        const count = countCandidateCards();
        if (count > bestSeen) bestSeen = count;
        console.log(`[Fast4MP content][auto] probe ${i+1}/${maxScrolls}: candidateCards=${count} (best=${bestSeen})`);

        // Break early once we have a "healthy" count
        if (count >= wantMin) break;
      }

      // 3) Stage 3: retry scraping loop (real work happens here)
      const maxRetryMs = 30000;    // total retry budget
      const retryEvery = 1500;     // ms
      let scraped = [];
      let attempts = 0;
      const start = Date.now();

      while (Date.now() - start < maxRetryMs) {
        attempts++;
        scraped = scrapeActiveListingsFromDOM();
        console.log(`[Fast4MP content][auto] attempt ${attempts}: scraped=${scraped.length}`);

        if (scraped.length >= 1) break;
        await sleep(retryEvery);

        // keep the page “alive” while waiting
        window.scrollBy(0, Math.floor(window.innerHeight * 0.3));
      }

      const elapsed = Math.round(performance.now() - t0);
      console.log(`[Fast4MP content] Active Listings refreshed — ${scraped.length} (attempts=${attempts}, ${elapsed}ms)`);

      // Finalize and return to bg and also post result event (keeps current integration intact)
      try { ffmFinalizeActiveListings && typeof ffmFinalizeActiveListings === 'function' && ffmFinalizeActiveListings(scraped); } catch (e) {}
      try {
        chrome.storage.local.get(['ffm_as_hidden_active'], (r) => {
          if (r && r.ffm_as_hidden_active) {
            try { console.debug('[AS:hidden] suppressed ffmActiveListingsResult'); } catch (e) {}
            return;
          }
          try { chrome.runtime.sendMessage({ action: 'ffmActiveListingsResult', scraped, meta: { forced, attempts, elapsed } }); } catch (e) {}
        });
      } catch (e) {}

      return { ok: true, count: scraped.length, attempts, elapsed };
    } catch (err) {
      console.error('[Fast4MP content] Auto refresh error:', err);
      return { ok: false, error: String(err) };
    }
  }

  // Counts the obvious “card” containers (matches our manual flow selectors)
  function countCandidateCards() {
    return document.querySelectorAll('[role="article"], div[aria-label][tabindex="0"]').length;
  }

  // Terminal finalize event for Active Sync/AAS — must be called once at the
  // true end of scraping (after all scrolling, extraction, dedupe, etc.)
  function ffmFinalizeActiveListings(collectedListings) {
    try {
      if (window.__ffm_as_finalized) return;
      window.__ffm_as_finalized = true;
    } catch (e) {}

    try {
      const count = Array.isArray(collectedListings) ? collectedListings.length : 0;
      try { console.log('[FFM AS] Finalizing — listings:', count); } catch (e) {}
      chrome.runtime.sendMessage({ action: 'FFM_ACTIVE_LISTINGS_COMPLETE', listings: collectedListings });
    } catch (e) {
      try { console.warn('[FFM AS] Failed to send completion message', e); } catch (er) {}
    }
  }

  // Mirrors your proven manual DOM scrape (innerText based + status parsing + price fixups)
  function scrapeActiveListingsFromDOM() {
    const cards = Array.from(document.querySelectorAll('[role="article"], div[aria-label][tabindex="0"]'));
    const listings = [];

    for (const card of cards) {
      const text = (card.innerText || '').trim();
      if (!text) continue;

      // lines & quick finds
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

      // title: prefer bold-like block (FB renders titles in the main text block). Fallback to first non-$/non-status line.
      let title = '';
      const titleEl = card.querySelector('span[style*="-webkit-box"]') || card.querySelector('strong, b');
      if (titleEl && titleEl.textContent) {
        title = titleEl.textContent.trim();
      }
      if (!title) {
        title = lines.find(l => l.length > 3 && !/^\$/.test(l) && !/Active|Listed|Sold|Out of Stock|ago|today|yesterday/i.test(l)) || lines[0] || '';
      }

      // status/date line
      const status = lines.find(l => /Active|Listed|Sold|Out of Stock|ago|today|yesterday/i.test(l)) || '';

      // price: first $… token OR fallback by scanning rest of block for the nearest dollar figure
      let price = lines.find(l => /^\$?\d/.test(l)) || '';
      if (!/^\$[\d,.]+/.test(price)) {
        const dollars = (text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) || []);
        price = dollars[0] || '';
      }

      // active flag from status
      const active = /\b(Active|Listed)\b/i.test(status) && !/\b(Sold|Out of Stock)\b/i.test(status);

      if (title && (price || active)) {
        listings.push({ title, price, status, active });
      }
    }

    // De-dup very noisy non-listing UI items (e.g., “Share”, “Manage listings”, etc.)
    return listings.filter(l =>
      l.title && !/^(Manage listings|Share|Status|Filters|Sort by|Mark as sold|Relist|Mark out of stock|Renew listing|Mark as available)$/i.test(l.title)
    );
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Expose for console testing
  window.ffmAutoActiveListingsRefresh = ffmAutoActiveListingsRefresh;
})();

  // Content-script endpoint: fetch media in-page (bypass CORS/auth issues) and return data URLs/blobs
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
          if (!message || message.action !== 'ffm_fetch_media_inpage' || !Array.isArray(message.urls)) return;
          (async () => {
            const timeoutMs = Number(message.timeoutMs) || 20000;
            const results = [];
            for (const url of message.urls) {
              const item = { origUrl: url, success: false };
              try {
                // Per-item timeout
                const controller = new AbortController();
                const id = setTimeout(() => { try { controller.abort(); } catch (e) {} }, timeoutMs);
                let resp = null;
                try {
                  resp = await fetch(url, { credentials: 'include', signal: controller.signal });
                } catch (e) { resp = null; }
                clearTimeout(id);
                if (!resp || !resp.ok) {
                  item.error = 'fetch-failed';
                  results.push(item);
                  continue;
                }
                let blob = null;
                try { blob = await resp.blob(); } catch (e) { blob = null; }
                if (!blob) { item.error = 'no-blob'; results.push(item); continue; }
                // Convert to data URL
                const dataUrl = await new Promise((resolve) => {
                  try {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result);
                    fr.onerror = () => resolve(null);
                    fr.readAsDataURL(blob);
                  } catch (e) { resolve(null); }
                });
                if (!dataUrl) { item.error = 'dataurl-failed'; results.push(item); continue; }
                item.success = true;
                item.dataUrl = dataUrl;
                try { item.blobType = blob.type; item.size = blob.size; } catch (e) {}
              } catch (e) { try { item.error = e && e.message ? e.message : String(e); } catch (_) { item.error = 'unknown'; } }
              results.push(item);
            }
            try { sendResponse({ results }); } catch (e) { }
          })();
          return true; // indicate async sendResponse
        } catch (e) {}
      });
    }
  } catch (e) {}


    // Listen for exitSelectMode messages to re-enable panel behavior after selection flows
    try {
      if (chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          try {
            if (msg && msg.action === 'exitSelectMode') {
              try { window.ffm_panel_disabled = false; console.debug && console.debug('[Fast4MP content] Panel re-enabled after exitSelectMode'); } catch (e) {}
              try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
              return true;
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
// Remove the legacy or stray blue hint bubble that may be left on Sharetown pages and
// prevent it from briefly reappearing while the popup/panel handshake completes.
(function removeTransientHintBubble() {
  try {
    function removeBubbles() {
      try {
        ['ffm-fb-select-hint', 'sharetown-hint-bubble', 'embedded-hint'].forEach(id => {
          try {
            const el = document.getElementById(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
          } catch (e) {}
        });
      } catch (e) {}
    }
    // initial removal
    removeBubbles();

    // Watch for future inserts and remove matching elements quickly for the next 30s
    try {
      const mo = new MutationObserver((records) => {
        try {
          for (const r of records) {
            for (const n of r.addedNodes) {
              try {
                if (!n) continue;
                if (n.id && (n.id === 'ffm-fb-select-hint' || n.id === 'sharetown-hint-bubble' || n.id === 'embedded-hint')) {
                  n.parentNode && n.parentNode.removeChild(n);
                  continue;
                }
                if (n.querySelector) {
                  const found = n.querySelector('#ffm-fb-select-hint, #sharetown-hint-bubble, #embedded-hint');
                  if (found && found.parentNode) found.parentNode.removeChild(found);
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      });
  mo.observe(document.documentElement || document, { childList: true, subtree: true });
  // Keep the observer active for 30 minutes (was 30s) to handle delayed SPA inserts
  setTimeout(() => { try { mo.disconnect(); } catch (e) {} }, 1800000);
    } catch (e) {}
  } catch (e) {}
})();

// (Removed global console filters — reverted to default behavior)

// Listener: lightweight Active Listings auto-refresh when Selling page becomes visible
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.action !== 'ffmCheckActiveListings') return;
        (async () => {
          try {
            const force = !!(msg && msg.force);
            const got = await new Promise(res => { try { chrome.storage.local.get({ ffmLastActiveCheck: 0 }, r => res(r || {})); } catch (e) { res({ ffmLastActiveCheck: 0 }); } });
            const last = Number(got.ffmLastActiveCheck) || 0;
            const now = Date.now();
            const hoursSince = (now - last) / 1000 / 60 / 60;
            // For testing with short alarms, shorten the throttle to ~1.2 minutes (0.02 hours).
            // Restore to 3 (hours) for production.
            if (!force && hoursSince < 0.02) {
              try { console.log(`[Fast4MP content] Active check skipped — last check ${hoursSince.toFixed(2)} hours ago (throttle active)`); } catch (e) {}
              return;
            }
            try { console.debug('[Fast4MP content] Performing auto Active Listings refresh…', force ? '(forced)' : ''); } catch (e) {}
            // prefer the auto-refresh flow which in turn will call title+price matcher
            const updated = await ffmAutoRefreshActiveListings();
            try { await new Promise(res => { try { chrome.storage.local.set({ ffmLastActiveCheck: now }, () => res()); } catch (e) { res(); } }); } catch (e) {}
            try { console.debug('[Fast4MP content] Active Listings refreshed —', (Array.isArray(updated) ? updated.length : 0)); } catch (e) {}
            try { sendResponse && sendResponse({ ok: true, updated: updated || [] }); } catch (e) {}
          } catch (err) {
            try { console.warn('[Fast4MP content] Auto Active refresh failed:', err); } catch (e) {}
            try { sendResponse && sendResponse({ ok: false, error: String(err) }); } catch (e) {}
          }
        })();
        return true; // indicate async sendResponse
      } catch (e) {}
    });
  }
} catch (e) { console.debug('[Fast4MP content] failed to install ffmCheckActiveListings handler', e); }

// Lightweight refresh implementation — updates local stored listings silently
async function ffmAutoRefreshActiveListings() {
  try {
    // Delegate to the central ffmCheckActiveListings workflow (non-forced)
    try {
      const res = await ffmCheckActiveListings(false);
      return res || [];
    } catch (e) { return []; }
  } catch (e) { console.debug('[Fast4MP content] ffmAutoRefreshActiveListings error', e); return []; }
}

// Title + Price based active-check. Matches visible Marketplace "Your listings" cards
// against stored listings by normalized title and a small price tolerance.
async function ffmCheckActiveListingsByTitleAndPrice(force = false) {
  try {
    console.debug('[Fast4MP content] ffmCheckActiveListingsByTitleAndPrice: starting');

    // Honor manual override via `force` to bypass the 3-hour guard.
    try {
      const last = await new Promise(res => { try { chrome.storage.local.get({ ffmLastActiveCheck: 0 }, r => res(Number((r && r.ffmLastActiveCheck) || 0))); } catch (e) { res(0); } });
      const hoursSince = (Date.now() - Number(last || 0)) / 3600000;
      // Testing: allow re-run every ~1.2 minutes (0.02 hours). Use 3 for production.
      if (!force && hoursSince < 0.02) {
        try { console.log(`[Fast4MP content] Active check skipped — last check ${hoursSince.toFixed(2)} hours ago (throttle active)`); } catch (e) {}
        return;
      }
    } catch (e) {}

    // 1) Load stored listings (use key 'listings' for compatibility with popup)
    const store = await new Promise(res => { try { chrome.storage.local.get({ listings: [] }, r => res(r || {})); } catch (e) { res({ listings: [] }); } });
    const listings = Array.isArray(store.listings) ? store.listings.slice() : [];

    // 2) Reset active flags on all stored listings first
    try {
      listings.forEach(l => {
        try {
          if (typeof l._ffm_active !== 'undefined') l._ffm_active = false;
          l.isActive = false;
          if (l.status && String(l.status).toLowerCase() === 'active') l.status = '';
        } catch (e) {}
      });
    } catch (e) {}

    // 3) Scrape visible listing cards on the page and parse with extractor
    const cards = Array.from(document.querySelectorAll('[role="article"], article'));
    const scraped = [];
    for (const card of cards) {
      try {
        // Build a rawItem object that mirrors the shape the extractor expects when possible
        const raw = { t: (card && card.innerText) ? card.innerText : '', ts: Date.now() };
        const info = ffmExtractListingInfo(raw);
        if (info && info.title && typeof info.price === 'number' && !isNaN(info.price)) {
          scraped.push(info);
        }
      } catch (e) {}
    }

    console.debug('[Fast4MP content] ffmCheckActiveListingsByTitleAndPrice: scraped', scraped.length, 'cards');

    // 4) Match scraped items to saved listings (title-includes + tolerance)
    const norm = s => (s || '').toString().trim().toLowerCase();
    const TOLERANCE = 2.0;
    const nowIso = new Date().toISOString();
    for (const listing of listings) {
      try {
        const listingTitle = (listing.title || listing.inventoryName || '').toString();
        const match = scraped.find(s => {
          try {
            if (!s || !s.title) return false;
            const sTitle = s.title.toString();
            const priceA = Number(s.price || 0);
            const priceB = Number(listing.price || listing.listingPrice || 0);
            if (!sTitle || !listingTitle) return false;
            // Title inclusion (case-insensitive) and price within tolerance
            return sTitle.toLowerCase().includes(listingTitle.toLowerCase()) && Math.abs(priceA - priceB) < TOLERANCE;
          } catch (e) { return false; }
        });
        if (match) {
          listing.isActive = true;
          listing._ffm_active = true;
          listing.status = 'Active';
          listing.lastChecked = nowIso;
          // Use the scraped date if available (match.date), else now
          listing.lastSeenActive = match.date || nowIso;
        } else {
          listing.isActive = false;
          if (listing.status && String(listing.status).toLowerCase() === 'active') listing.status = '';
        }
      } catch (e) {}
    }

    // 5) Persist changes and update last-check timestamp
    try { await new Promise(res => { try { chrome.storage.local.set({ listings, ffmLastActiveCheck: Date.now() }, () => res()); } catch (e) { res(); } }); } catch (e) {}

    // notify popup/background that active listings updated (best-effort)
    try {
      chrome.storage.local.get(['ffm_as_hidden_active'], (r) => {
        if (r && r.ffm_as_hidden_active) {
          try { console.debug('[AS:hidden] suppressed ffmActiveListingsUpdated'); } catch (e) {}
          return;
        }
        try { chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffmActiveListingsUpdated', data: listings }); } catch (e) {}
      });
    } catch (e) {}

    try { if (typeof ffmUpdateLastCheckedDisplay === 'function') ffmUpdateLastCheckedDisplay(); } catch (e) {}

    const activeCount = listings.filter(l => l.isActive).length;
    console.debug('[Fast4MP content] ffmCheckActiveListingsByTitleAndPrice: done —', activeCount, 'active');
    return listings.filter(l => l.isActive).map(l => ({ id: l.id || null, title: l.title || l.inventoryName || '', lastChecked: l.lastChecked }));
  } catch (e) {
    console.debug('[Fast4MP content] ffmCheckActiveListingsByTitleAndPrice error', e);
    return [];
  }
}

// Robust extractor: parse a raw scrape block (rawItem) into { title, price, date }
function ffmExtractListingInfo(rawItem) {
  try {
    if (!rawItem) return null;
    // If caller passed a DOM node, coerce to text shape
    let t = null;
    if (typeof rawItem === 'string') t = rawItem;
    else if (rawItem && typeof rawItem.t === 'string') t = rawItem.t;
    else if (rawItem && rawItem.innerText) t = rawItem.innerText;
    if (!t) return null;

    const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
    const title = lines[0] || '';

    // Price: find a line that starts with $ or contains digits
    const priceLine = lines.find(l => /^\$?\d/.test(l)) || '';
    const priceMatch = (priceLine && priceLine.match(/\$?([\d,]+(?:\.\d+)?)/));
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

    // Date: prefer rawItem.d if it contains 'Listed on', else use ts if available
    let dateStr = '';
    try {
      if (rawItem.d && typeof rawItem.d === 'string' && rawItem.d.toLowerCase().includes('listed on')) {
        const m = rawItem.d.match(/listed on\s+(\d{1,2}\/\d{1,2})/i);
        if (m && m[1]) {
          const year = new Date().getFullYear();
          dateStr = `${m[1]}/${year}`;
        }
      } else if (rawItem.ts) {
        const dateObj = new Date(rawItem.ts);
        if (!isNaN(dateObj.getTime())) dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
      }
    } catch (e) {}

    return { title: title, price: (typeof price === 'number' && !isNaN(price)) ? price : null, date: dateStr };
  } catch (e) { return null; }
}

// Global-safe computeCssLocal helper: used to create a short CSS-ish selector for caching
// Some code paths previously defined local computeCssLocal functions in nested scopes; expose
// a single robust implementation on window/globalThis to avoid ReferenceErrors when called.
function computeCssLocalSafe(el) {
  try {
    if (!el) return null;
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
      let part = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        const cls = node.className.trim().split(/\s+/).filter(Boolean);
        if (cls.length) part += '.' + cls.slice(0,3).join('.');
      }
      try {
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(node) + 1;
            part += `:nth-child(${idx})`;
          }
        }
      } catch (e) {}
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  } catch (e) { return null; }
}
try { if (typeof window !== 'undefined') window.computeCssLocalSafe = computeCssLocalSafe; } catch (e) {}
try { if (typeof globalThis !== 'undefined') globalThis.computeCssLocalSafe = computeCssLocalSafe; } catch (e) {}

// Lightweight computeCssLocal: simple deterministic CSS-ish path generator for an element
// This is intentionally small and self-contained so callers can cache selectors without
// relying on platform computeCss helpers.
function computeCssLocal(el) {
  if (!el) return '';
  try {
    const path = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += `#${el.id}`;
        path.unshift(selector);
        break;
      } else {
        let sib = el, nth = 1;
        while (sib.previousElementSibling) {
          sib = sib.previousElementSibling;
          nth++;
        }
        selector += `:nth-child(${nth})`;
      }
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ');
  } catch (err) {
    console.warn('[Fast4MP] computeCssLocal failed', err);
    return '';
  }
}

// Helper: normalize auto-publish-like flags that may be wrapped or typed by the
// background service worker (examples: {val: false, type: 'boolean'}). Returns
// a boolean safe to use for decision making.
function normalizeAutoFlag(raw) {
  try {
    if (raw === null || typeof raw === 'undefined') return false;
    // unwrap common wrapper shapes
    if (typeof raw === 'object') {
      if ('val' in raw) return !!raw.val;
      if ('value' in raw) return !!raw.value;
      // If object is truthy but not a wrapper, fall through and treat as true
      return true;
    }
    if (typeof raw === 'string') {
      const v = raw.trim().toLowerCase();
      if (v === 'true') return true;
      if (v === 'false') return false;
      // non-empty string -> truthy
      return v.length > 0;
    }
    // boolean or number
    return !!raw;
  } catch (e) { return false; }
}

// Universal polling click helper for Facebook controls (Next/Publish)
async function clickFacebookButton(label = 'Next') {
  try {
    const MAX_RETRIES = 10;
    const RETRY_DELAY = 400;

    function isClickable(el) {
      try {
        return el && el.offsetParent !== null && !el.closest('[aria-disabled="true"], [aria-hidden="true"]') && getComputedStyle(el).pointerEvents !== 'none';
      } catch (e) { return false; }
    }

    function getButton(lbl) {
      try {
        const lower = (lbl || '').toString().toLowerCase();
        return Array.from(document.querySelectorAll('button, [role="button"], [aria-label]'))
          .find(el => {
            try {
              const t = ((el.textContent || '') + ' ' + (el.value || '') + ' ' + (el.getAttribute && el.getAttribute('aria-label') || '')).toLowerCase();
              return t.includes(lower);
            } catch (e) { return false; }
          });
      } catch (e) { return null; }
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const el = getButton(label);
      if (isClickable(el)) {
        try {
          const rect = el.getBoundingClientRect();
          const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + 3, clientY: rect.y + 3 };
          ['mouseover','mousedown','mouseup','click'].forEach(type => el.dispatchEvent(new MouseEvent(type, opts)));
          console.debug && console.debug(`clickFacebookButton: ✅ Clicked "${label}" on attempt ${attempt+1}`, el);
          return true;
        } catch (e) { console.debug('clickFacebookButton: dispatch error', e); }
      }
      // If the element exists but isn't clickable because of aria-hidden/disabled ancestors,
      // try temporarily un-hiding ancestors and re-dispatching, then as a last-resort clone-and-click.
      try {
        if (el) {
          // temporary unhide
          const unhid = await (async function tempUnhideAndTry(elToTry) {
            try {
              const ancestors = [];
              let node = elToTry.parentElement;
              while (node && node !== document.documentElement) {
                try { const ah = node.getAttribute && node.getAttribute('aria-hidden'); const ad = node.getAttribute && node.getAttribute('aria-disabled'); if (ah === 'true' || ad === 'true') ancestors.push({ node, ah, ad }); } catch (e) {}
                node = node.parentElement;
              }
              // remove attributes
              for (const a of ancestors) {
                try { a.node.setAttribute('data-ffm-old-aria-hidden', a.ah || ''); a.node.setAttribute('data-ffm-old-aria-disabled', a.ad || ''); a.node.removeAttribute('aria-hidden'); a.node.removeAttribute('aria-disabled'); } catch (e) {}
              }
              // try click
              try {
                const rect = elToTry.getBoundingClientRect();
                const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + 3, clientY: rect.y + 3 };
                ['mouseover','mousedown','mouseup','click'].forEach(type => elToTry.dispatchEvent(new MouseEvent(type, opts)));
                return true;
              } catch (e) { /* continue to clone fallback */ }
              finally {
                // restore attributes
                for (const a of ancestors) {
                  try { if (a.ah) a.node.setAttribute('aria-hidden', a.ah); else a.node.removeAttribute('aria-hidden'); if (a.ad) a.node.setAttribute('aria-disabled', a.ad); else a.node.removeAttribute('aria-disabled'); a.node.removeAttribute('data-ffm-old-aria-hidden'); a.node.removeAttribute('data-ffm-old-aria-disabled'); } catch (e) {}
                }
              }
            } catch (e) { return false; }
            return false;
          })(el);
          if (unhid) { console.debug('clickFacebookButton: temporary unhide succeeded for', el); return true; }

          // clone-and-click fallback
          const cloneAndClick = (orig) => {
            try {
              const rect = orig.getBoundingClientRect();
              const clone = orig.cloneNode(true);
              clone.style.position = 'fixed';
              clone.style.left = (Math.max(2, Math.round(rect.left))) + 'px';
              clone.style.top = (Math.max(2, Math.round(rect.top))) + 'px';
              clone.style.zIndex = '2147483647';
              clone.style.pointerEvents = 'auto';
              clone.style.opacity = '0.99';
              document.documentElement.appendChild(clone);
              const opts = { bubbles: true, cancelable: true, view: window, clientX: Math.round(rect.left + 3), clientY: Math.round(rect.top + 3) };
              ['mouseover','mousedown','mouseup','click'].forEach(type => clone.dispatchEvent(new MouseEvent(type, opts)));
              setTimeout(() => { try { clone.parentElement && clone.parentElement.removeChild(clone); } catch (e) {} }, 400);
              return true;
            } catch (e) { return false; }
          };
          try { if (cloneAndClick(el)) { console.debug('clickFacebookButton: clone-and-click fallback succeeded for', el); return true; } } catch (e) {}
        }
      } catch (e) { console.debug('clickFacebookButton: fallback error', e); }
      console.debug && console.debug(`clickFacebookButton: ⏳ Waiting for ${label} to become clickable... attempt ${attempt+1}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
    console.debug && console.debug(`clickFacebookButton: ❌ "${label}" never became clickable.`);
    return false;
  } catch (e) { console.debug('clickFacebookButton error', e); return false; }
}

/*
  Resilient ffmCallAttemptPublishClickSafe (moved near top of file)
  - Ensures the safe wrapper exists early so callers won't ReferenceError
  - Progressive backoff up to maxWait (configurable via opts.waitMs or window.__ffm_safe_wait_ms)
  - Accepts optional first-arg function reference to call directly
  - Exposes itself on window and globalThis for visibility
*/
async function ffmCallAttemptPublishClickSafe(/* [fnRef], publishRequestId, inventoryName, [opts] */) {
  try {
    const rawArgs = Array.prototype.slice.call(arguments || []);
    let opts = null;
    if (rawArgs.length && rawArgs[rawArgs.length - 1] && typeof rawArgs[rawArgs.length - 1] === 'object' && !Array.isArray(rawArgs[rawArgs.length - 1])) {
      opts = rawArgs.pop();
    }
    let fnCandidate = null;
    if (rawArgs.length && typeof rawArgs[0] === 'function') fnCandidate = rawArgs.shift();
    const args = rawArgs;
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    const defaultWait = 5000;
    const globalWaitRaw = (typeof window !== 'undefined' && window.__ffm_safe_wait_ms);
    const globalWait = (typeof globalWaitRaw === 'number' || (typeof globalWaitRaw === 'string' && globalWaitRaw !== '')) ? Number(globalWaitRaw) : null;
    const optWaitRaw = (opts && opts.waitMs);
    const optWait = (typeof optWaitRaw === 'number' || (typeof optWaitRaw === 'string' && optWaitRaw !== '')) ? Number(optWaitRaw) : null;
    const maxWait = (typeof optWait === 'number' && isFinite(optWait) && optWait >= 0) ? optWait : (typeof globalWait === 'number' && isFinite(globalWait) && globalWait >= 0) ? globalWait : defaultWait;

    // Progressive polling with exponential backoff (cap at 1s per step)
    let waited = 0;
    let step = 50;
    const resolveFn = () => {
      try {
        if (typeof fnCandidate === 'function') return fnCandidate;
        if (typeof ffmAttemptPublishClick === 'function') return ffmAttemptPublishClick;
        if (typeof window !== 'undefined' && typeof window.ffmAttemptPublishClick === 'function') return window.ffmAttemptPublishClick;
        if (typeof globalThis !== 'undefined' && typeof globalThis.ffmAttemptPublishClick === 'function') return globalThis.ffmAttemptPublishClick;
        return null;
      } catch (e) { return null; }
    };

    let fn = resolveFn();
    while (!fn && waited < maxWait) {
      await sleep(step);
      waited += step;
      step = Math.min(1000, Math.round(step * 1.6));
      fn = resolveFn();
    }

    if (fn) {
      try { return await fn.apply(null, args); } catch (e) { throw e; }
    }

    if (typeof window !== 'undefined' && window.ffm_debug) console.debug && console.debug('ffmCallAttemptPublishClickSafe: ffmAttemptPublishClick unavailable after wait', { waited, maxWait });
    throw new Error('ffmAttemptPublishClick not defined');
  } catch (e) { throw e; }
}

try { if (typeof window !== 'undefined') window.ffmCallAttemptPublishClickSafe = ffmCallAttemptPublishClickSafe; } catch (e) {}
try { if (typeof globalThis !== 'undefined') globalThis.ffmCallAttemptPublishClickSafe = ffmCallAttemptPublishClickSafe; } catch (e) {}

// Sharetown overlays: show helpful right-side hints on inventory pages
(function ffmSharetownOverlays(){
  try {
    const href0 = (window && window.location && window.location.href) ? window.location.href : '';
    if (!/https:\/\/app\.sharetown\.io\//.test(href0)) return; // only run on Sharetown

    const ensureRightHint = (id, text, opts) => {
      try {
        const existing = document.getElementById(id);
        if (existing) { try { const t = existing.querySelector('[data-ffm-hint-text]'); if (t) t.textContent = text; } catch (e) {} return existing; }
        const wrap = document.createElement('div');
        wrap.id = id; wrap.setAttribute('role','status');
        wrap.style.position = 'fixed';
  // Move hint inward from the right edge; allow runtime override via window.ffm_st_hint_right_offset_px
  try { var __ffmRight = (window && window.ffm_st_hint_right_offset_px) || 200; } catch(e) { var __ffmRight = 200; }
  wrap.style.right = __ffmRight + 'px';
        wrap.style.top = '20vh';
        wrap.style.zIndex = '2147483647';
        wrap.style.background = '#E7F3FF';
        wrap.style.color = '#1877F2';
  // Larger padding and softer, larger radius for modern look
  wrap.style.padding = '14px 16px';
  wrap.style.borderRadius = '14px';
        wrap.style.boxShadow = '0 6px 22px rgba(24,119,242,0.20)';
        wrap.style.border = '1px solid rgba(24,119,242,0.35)';
        wrap.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  // Slightly larger base font for readability
  wrap.style.fontSize = '16px';
        wrap.style.lineHeight = '1.35';
  wrap.style.maxWidth = '360px';
        wrap.style.pointerEvents = 'auto';
        wrap.style.userSelect = 'none';

        const textEl = document.createElement('div');
        textEl.setAttribute('data-ffm-hint-text','');
        textEl.textContent = text;
        wrap.appendChild(textEl);

        if (opts && opts.buttonText) {
          const btn = document.createElement('button');
          btn.textContent = opts.buttonText;
          btn.style.marginTop = '12px';
          btn.style.background = '#1877F2';
          btn.style.color = '#fff';
          btn.style.border = 'none';
          // Make the button bigger and more prominent
          btn.style.padding = '10px 14px';
          btn.style.fontSize = '15px';
          btn.style.borderRadius = '10px';
          btn.style.cursor = 'pointer';
          btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
          btn.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); opts.onClick && opts.onClick(); } catch (e) {} });
          wrap.appendChild(btn);
        }

        document.documentElement.appendChild(wrap);
        // Nudge the panel right by 1/2 of the button width (or a fallback if no button);
        // run once immediately and again after a short delay to account for layout.
        try {
          const nudge = () => {
            try {
              const btnEl = wrap.querySelector('button');
              const factor = (window && window.ffm_st_hint_right_btn_factor) || 0.5; // default half
              const fallback = (window && window.ffm_st_hint_right_min_shift_px) || 60; // when no button
              const rect = btnEl && btnEl.getBoundingClientRect ? btnEl.getBoundingClientRect() : null;
              const shift = rect && rect.width ? Math.round(rect.width * factor) : fallback;
              let baseRight = (typeof __ffmRight === 'number') ? __ffmRight : parseInt(__ffmRight, 10);
              if (!isFinite(baseRight)) baseRight = 200;
              const finalRight = Math.max(8, baseRight - shift);
              wrap.style.right = finalRight + 'px';
            } catch (e) { /* ignore */ }
          };
          nudge();
          setTimeout(nudge, 220);
        } catch (e) { /* non-fatal */ }
        return wrap;
      } catch (e) { return null; }
    };

    const removeEl = (id) => { try { const el = document.getElementById(id); if (el) el.remove(); } catch (e) {} };

    // Remove any right-hint elements or embedded hints by id, attribute, or matching text
    const removeRightHints = () => {
      try {
        // well-known ids
        ['ffm-st-hint-list','ffm-st-hint-details','ffm-fb-select-hint','sharetown-hint-bubble','embedded-hint'].forEach(id => {
          try { const e = document.getElementById(id); if (e && e.parentNode) e.parentNode.removeChild(e); } catch (err) {}
        });
        // any element carrying the data attribute
        try { const q = Array.from(document.querySelectorAll('[data-ffm-hint-text]')); q.forEach(el => { try { el && el.parentNode && el.parentNode.removeChild(el); } catch(e){} }); } catch (e) {}
        // fallback: any element whose visible text contains the selection hint
        try {
          const candidates = Array.from(document.querySelectorAll('div,section,aside,span'));
          for (const c of candidates) {
            try {
              if (!c || !c.textContent) continue;
              const t = c.textContent.trim();
              if (!t) continue;
              const lowered = t.toLowerCase();
              if (lowered.includes('please select a item') || lowered.includes('please select an item') || lowered.includes('please select')) {
                // only remove small hint-like nodes (avoid stripping large content accidentally)
                const len = t.length;
                if (len < 240) { try { c.parentNode && c.parentNode.removeChild(c); } catch(e) {} }
              }
            } catch (e) {}
          }
        } catch (e) {}
      } catch (e) {}
    };

    // Run initial removal now
    try { removeRightHints(); } catch (e) {}

    // Install a lightweight observer to remove any such hints when inserted later
    try {
      const rightHintObserver = new MutationObserver((records) => {
        try {
          for (const r of records) {
            for (const n of r.addedNodes) {
              try {
                if (!n) continue;
                if (n.nodeType !== 1) continue;
                // direct id match
                try { const nid = n.id; if (nid && (nid === 'ffm-st-hint-list' || nid === 'ffm-st-hint-details' || nid === 'ffm-fb-select-hint' || nid === 'sharetown-hint-bubble' || nid === 'embedded-hint')) { n.parentNode && n.parentNode.removeChild(n); continue; } } catch(e) {}
                // attribute match
                try { if (n.querySelector && n.querySelector('[data-ffm-hint-text]')) { const f = n.querySelector('[data-ffm-hint-text]'); f && f.parentNode && f.parentNode.removeChild(f); } } catch(e) {}
                // text match
                try {
                  const txt = (n.textContent || '').trim().toLowerCase();
                  if (txt && (txt.includes('please select a item') || txt.includes('please select an item') || txt.includes('please select'))) {
                    if (txt.length < 240) { n.parentNode && n.parentNode.removeChild(n); continue; }
                  }
                } catch(e) {}
              } catch (e) {}
            }
          }
        } catch (e) {}
      });
      rightHintObserver.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}

    // Testing badge removed for cleanliness. Previously inserted a visual TESTING badge here.

    const LIST_ID = 'ffm-st-hint-list';
    const DETAILS_ID = 'ffm-st-hint-details';

    const handleRoute = () => {
      try {
        const href = location.href || '';
        // remove any existing helper hints
        removeEl(LIST_ID); removeEl(DETAILS_ID);

        if (/\/inventory\/inventory-list/.test(href)) {
          ensureRightHint(LIST_ID, 'Please Select a Item...');
          return;
        }

        if (/\/inventory\/inventory-details/.test(href)) {
          // If user prefers Side Panel, signal background to show the Generate UI there.
          try {
            if (chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
              chrome.storage.local.get(['ffm_use_sidepanel'], (res) => {
                try {
                  const usePanel = !!(res && res.ffm_use_sidepanel);
                  if (usePanel) {
                    try { chrome.runtime.sendMessage({ action: 'show-generate-listing' }); } catch (e) {}
                    return;
                  }
                } catch (e) {}
                // Fallback: create an in-page Generate hint that performs a small, safe scrape when clicked
                try {
                  ensureRightHint(DETAILS_ID, 'Generate Listing?', {
                    buttonText: 'Generate',
                    onClick: () => {
                      try {
                        const visible = (el) => !!el && el.offsetParent !== null;
                        const textOf = (el) => (el && (el.innerText || el.textContent) || '').toString().trim();
                        const getHeadings = () => Array.from(document.querySelectorAll('h1, h2, h3')).filter(visible);
                        const moneyRe = /\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/;

                        let inventoryName = '';
                        try {
                          // Prefer Sharetown-specific title elements
                          const shSelectors = ['.inventory-details__link-lbl', '.inventory-details__title', '.nunitosans-regular.inventory-details__link-lbl'];
                          let found = null;
                          for (const s of shSelectors) {
                            try { const el = document.querySelector(s); if (el && visible(el)) { found = el; break; } } catch (e) {}
                          }
                          if (found) {
                            inventoryName = textOf(found);
                          } else {
                            const hs = getHeadings();
                            if (hs && hs.length >= 2 && visible(hs[1])) inventoryName = textOf(hs[1]);
                            else if (hs && hs.length >= 1 && visible(hs[0])) inventoryName = textOf(hs[0]);
                            else {
                              const alt = document.querySelector('[data-testid*="title" i], .listing-title, [aria-label*="Title" i]');
                              if (alt) inventoryName = textOf(alt);
                            }
                          }
                        } catch (e) {}

                        let title = inventoryName || (document.title || '').toString().trim() || '';
                        let price = '';
                        try {
                          const text = Array.from(document.querySelectorAll('body *')).map(n => (n && n.textContent || '')).filter(Boolean).join(' ');
                          const m = text.match(moneyRe);
                          if (m) price = (m[1] || '').replace(/,/g,'');
                        } catch (e) {}
                        let description = '';
                        try { const meta = document.querySelector('meta[name="description"]'); if (meta) description = meta.content || ''; } catch (e) {}

                        // Normalize whitespace
                        try { inventoryName = inventoryName ? inventoryName.replace(/\s+/g, ' ').trim() : ''; } catch (e) {}
                        try { title = title ? title.replace(/\s+/g, ' ').trim() : ''; } catch (e) {}

                        try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: { inventoryName, title, price, retailPrice: '', description, timestamp: Date.now() } }); } catch (e) {}
                        try { chrome.runtime.sendMessage({ action: 'generate-scrape-ready' }); } catch (e) {}
                      } catch (e) {}
                    }
                  });
                } catch (e) {}
              });
            } else {
              // no storage API available; just create the in-page hint
              try {
                ensureRightHint(DETAILS_ID, 'Generate Listing?', { buttonText: 'Generate', onClick: () => { try { chrome.runtime.sendMessage({ action: 'generate-scrape-ready' }); } catch (e) {} } });
              } catch (e) {}
            }
          } catch (e) {}
        }
      } catch (e) {}
    };

    // Watch for SPA navigation (URL changes without full reload)
    let lastHref = location.href;
    handleRoute();
    setInterval(() => { try { const cur = location.href; if (cur !== lastHref) { lastHref = cur; handleRoute(); } } catch (e) {} }, 500);
  } catch (e) {}
})();

// Safe sendMessage wrapper for content scripts to avoid unchecked runtime.lastError noise
function ffmSendMessage(msg, cb) {
  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      chrome.runtime.sendMessage(msg, function(res) {
        try {
          if (chrome.runtime && chrome.runtime.lastError) {
            try { if (window && window.ffm_debug) console.debug('ffmSendMessage lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
            try { if (typeof cb === 'function') cb(null); } catch (e) {}
            return;
          }
          try { if (typeof cb === 'function') cb(res); } catch (e) {}
        } catch (e) {}
      });
    } catch (e) { try { if (typeof cb === 'function') cb(null); } catch (_) {} }
  } catch (e) {}
}

// Monkey-patch chrome.runtime.sendMessage in content context to ensure callbacks always
// read chrome.runtime.lastError (prevents DevTools "Unchecked runtime.lastError" noisy warnings).
try {
  if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    const __origCSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function(message, callback) {
      try {
        if (typeof callback === 'function') {
          __origCSend(message, function(res) {
            try {
              // read lastError if present to clear DevTools unchecked warning
              if (chrome.runtime && chrome.runtime.lastError) {
                try { if (window && window.ffm_debug) console.debug('ffm content sendMessage lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                try { callback && callback(null); } catch (e) {}
                return;
              }
              try { callback && callback(res); } catch (e) {}
            } catch (e) {}
          });
        } else {
          __origCSend(message);
        }
      } catch (e) { try { if (window && window.ffm_debug) console.debug('ffm sendMessage override failed', e); } catch (er) {} }
    };
  }
} catch (e) {}

try { if (window && window.ffm_debug) console.log('Fast4MP content script loaded on page'); } catch (_) {}
// Lightweight load trace preserved under debug flag
try { if (window && window.ffm_debug) console.debug && console.debug('FFM-TRACE: content_main.js loaded'); } catch (e) {}
// Debug overlay flags and stubs were removed during cleanup; provide harmless no-op
// declarations here so any remaining calls are harmless and don't break the file.
// Debug overlays removed completely.
// Controlled injection: create or remove the panel on demand
// Simplified always-on-top handling: toggle class and z-index only (no global listeners)
// Guard these as window-scoped properties so re-injecting the content script doesn't
// throw 'Identifier ... has already been declared' when the script is injected twice.
if (typeof window.ffm_originalBodyMarginRight === 'undefined') window.ffm_originalBodyMarginRight = '';
if (typeof window.ffm_originalHtmlMarginRight === 'undefined') window.ffm_originalHtmlMarginRight = '';

// Helper: fetch staged publish payload from storage with retries.
// This helps when the background writes the staging key and the content script
// receives the message before storage has the value available in the new tab.
function ffmFetchStagedListingWithRetries(publishRequestId, attempts = 6, delayMs = 500, callback) {
  try {
    const key = 'ffm_publish_' + publishRequestId;
    let tries = 0;
    const attempt = () => {
      try {
        chrome.storage && chrome.storage.local && chrome.storage.local.get([key], (res) => {
          try {
            const listing = res && res[key];
            if (listing) {
              // remove the staged key now that we've consumed it
              try { chrome.storage.local.remove([key]); } catch (e) {}
              return callback(null, listing);
            }
            tries++;
            if (tries >= attempts) return callback(new Error('not_found'));
            setTimeout(attempt, delayMs);
          } catch (e) { tries++; if (tries >= attempts) return callback(e); setTimeout(attempt, delayMs); }
        });
      } catch (e) {
        tries++;
        if (tries >= attempts) return callback(e);
        setTimeout(attempt, delayMs);
      }
    };
    attempt();
  } catch (e) { try { callback(e); } catch (_) {} }
}

// --- Lightweight scraper for Facebook image search results ---
(function ffmScrapeFacebookSearchImages(){
  try {
    const href = (location && location.href) || '';
    if (!/https?:\/\/(www\.|m\.)?facebook\.com\/search\//.test(href)) return;
    if (window.__ffm_fb_img_scraped) return; // run once per page
    window.__ffm_fb_img_scraped = true;

    // Disabled: do not auto-send scraped images. Selection will be done by the user via overlay markers.
    // You can re-enable by setting window.ffm_enable_auto_image_scrape = true before load.
    if (!window.ffm_enable_auto_image_scrape) return;

    const collect = () => {
      try {
        const urls = new Set();
        // New: locate the visible "Seller information" heading and compute a vertical cutoff.
        // Images appearing below that cutoff are likely part of seller details / related listings and
        // should be excluded. This is more stable than dynamic class names because the visible text
        // "Seller information" remains constant in English UI.
        let cutoff = Infinity;
        try {
          const sellerInfoEl = Array.from(document.querySelectorAll('*')).find(el => {
            try { return (el && (el.textContent || '').toString().trim() === 'Seller information'); } catch (e) { return false; }
          });
            if (sellerInfoEl) {
            try { cutoff = sellerInfoEl.getBoundingClientRect().top + window.scrollY; } catch (e) { cutoff = Infinity; }
            try { if ((typeof window !== 'undefined') && (window.FFM_DEBUG || window.ffm_debug)) console.debug('[Fast4MP FB-Images] Seller information cutoff Y:', cutoff); } catch (e) {}
          }
        } catch (e) { cutoff = Infinity; }

        const imgs = Array.from(document.images || []);
        for (const img of imgs) {
          try {
            const w = img.naturalWidth || img.width || 0;
            const h = img.naturalHeight || img.height || 0;
            if (w < 90 || h < 90) continue; // skip tiny icons
            const src = img.currentSrc || img.src || '';
            if (!src) continue;
            // Skip sprites, data URIs, and avatar placeholders
            if (/data:/.test(src)) continue;
            if (/sprite|emoji|transparent|pixel/i.test(src)) continue;
            // Filter by vertical position relative to Seller information cutoff (if found)
            try {
              const rect = img.getBoundingClientRect();
              const absoluteY = (rect && (rect.top + window.scrollY)) || Infinity;
              if (absoluteY >= cutoff) {
                try { if ((typeof window !== 'undefined') && (window.FFM_DEBUG || window.ffm_debug)) console.debug('[Fast4MP FB-Images] Skipped image below Seller info cutoff', src); } catch (e) {}
                continue;
              }
            } catch (e) {}
            urls.add(src);
          } catch (e) {}
        }
        // Prefer larger image variants when Facebook uses 'p' vs 's' sizes or similar query params
        const tuned = Array.from(urls);
        return tuned.slice(0, 120); // cap to a reasonable number
      } catch (e) { return []; }
    };

    const convertUrlsToDataUrls = async (list) => {
      try {
        const out = [];
        const MAX = 80;
        const toProcess = Array.isArray(list) ? list.slice(0, MAX) : [];
        for (const src of toProcess) {
          try {
            try { console.debug && console.debug('ffm: content convert fetch start', (src||'').slice(0,200)); } catch(_){}
            const r = await fetch(src, { mode: 'cors' });
            if (!r || !r.ok) { try { console.debug && console.debug('ffm: content convert fetch non-ok', src, r && r.status); } catch(_){}; out.push(src); continue; }
            const blob = await r.blob();
            const dataUrl = await new Promise((res) => {
              try {
                const fr = new FileReader(); fr.onload = () => { try { console.debug && console.debug('ffm: content convert FileReader.onload', (src||'').slice(0,100)); } catch(_){}; res(fr.result); }; fr.onerror = (err) => { try { console.debug && console.debug('ffm: content convert FileReader.onerror', (src||'').slice(0,100), err); } catch(_){}; res(src); }; fr.readAsDataURL(blob);
              } catch (e) { try { console.debug && console.debug('ffm: content convert FileReader threw', (src||'').slice(0,100), e && (e.message||String(e))); } catch(_){}; res(src); }
            });
            out.push(dataUrl || src);
          } catch (e) { try { console.debug && console.debug('ffm: content convert fetch error', (src||'').slice(0,200), e && (e.message||String(e))); } catch(_){}; out.push(src); }
        }
        // Append remaining originals if any
        if (Array.isArray(list) && list.length > toProcess.length) {
          for (let i = toProcess.length; i < list.length; i++) out.push(list[i]);
        }
        return out;
      } catch (e) { return list || []; }
    };

    const sendOnce = () => {
      try {
        const items = collect();
        // Best-effort conversion in-page to reduce CORS failures for popup fetch
        convertUrlsToDataUrls(items).then((converted) => {
          try { chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffm-fb-image-results', images: converted }); } catch (e) {}
        }).catch(() => {
          try { chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffm-fb-image-results', images: items }); } catch (e) {}
        });
      } catch (e) {}
    };
    setTimeout(sendOnce, 1800);
    setTimeout(sendOnce, 3500);
  } catch (e) {}
})();

// --- Overlay selection UI for FB search results (source) ---
(function ffmInstallSelectOverlayHandler(){
  try {
    try { if (window && window.ffm_debug) console.debug('ffm: select overlay handler attached'); } catch (e) {}
    async function startOverlay(query) {
      try {
  // Guard: single overlay instance per page
  if (window.__ffmOverlayActive) return;
  // Transient suppression (requested by popup when using side panel)
  try {
    // First, check per-tab suppression persisted in storage (best-effort synchronous check via callback)
    try {
      const tabId = (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.lastError === undefined) ? null : null;
      // We can't obtain the tab id from content script synchronously; instead, read any suppression keys for this session by
      // scanning storage for keys prefixed with ffm_suppress_overlay_tab_. If any exists, treat as suppressed.
      if (chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
        try {
          chrome.storage.local.get(null, (all) => {
            try {
              if (all) {
                for (const k in all) {
                  try {
                    if (k && k.indexOf && k.indexOf('ffm_suppress_overlay_tab_') === 0) {
                      // If a flag exists and is recent (<30s), suppress overlay
                      const obj = all[k];
                      // Treat suppression flags as recent for 30 minutes (was 30s)
                      if (obj && obj.ts && (Date.now() - obj.ts) < 1800000) {
                        window.__ffmOverlayActive = false; return;
                      }
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {}
          });
        } catch (e) {}
      }
    } catch (er) {}
    // Fallback: check transient in-page flag
    try { if (window.__ffmSuppressOverlay) { window.__ffmOverlayActive = false; return; } } catch (e) {}
  } catch (e) {}

  // Persistent per-tab block: request our tab id from background and check for a persistent block flag
  try {
    let myTabId = null;
    try {
      const who = await new Promise((res) => { try { chrome.runtime.sendMessage({ action: 'whoami_tab' }, (r) => res(r || null)); } catch (e) { res(null); } });
      myTabId = who && (typeof who.tabId !== 'undefined') ? who.tabId : null;
    } catch (e) { myTabId = null; }
    if (myTabId) {
      try {
        const key = 'ffm_block_bubble_tab_' + myTabId;
        const st = await new Promise((res2) => { try { chrome.storage && chrome.storage.local && chrome.storage.local.get([key], (r) => res2(r || {})); } catch (e) { res2({}); } });
        if (st && st[key]) {
          // Remove any visible bubble and skip overlay creation permanently for this tab
          try { const el = document.getElementById('sharetown-hint-bubble'); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
          window.__ffmOverlayActive = false; return;
        }
      } catch (e) {}
    }
  } catch (e) {}

        window.__ffmOverlayActive = true;
        try { if (window && window.ffm_debug) console.debug('ffm: starting select overlay', { query }); } catch (e) {}
        // Remove previous markers/hints
        try { document.querySelectorAll('.ffm-select-marker').forEach(m=>m.remove()); } catch(e){}
        try { const ex = document.getElementById('ffm-fb-select-hint'); if (ex) ex.remove(); } catch(e){}

        const isMarketplace = /https?:\/\/(www\.|m\.)?facebook\.com\/marketplace\//.test((location && location.href) || '');
        let hint = null;
        // Check user preference and bail out early when Side Panel is used
        try {
          let useSidepanel = false;
          try {
            useSidepanel = await new Promise((res) => {
              try { chrome.storage && chrome.storage.local && chrome.storage.local.get(['ffm_use_sidepanel'], (r) => res(!!(r && r.ffm_use_sidepanel))); } catch (er) { res(false); }
            });
          } catch (er) { useSidepanel = false; }
          if (useSidepanel) { window.__ffmOverlayActive = false; return; }
        } catch (e) {}

        // Create the in-page hint overlay
        hint = document.createElement('div');
        hint.id = 'ffm-fb-select-hint';
        hint.setAttribute('role','status');
        hint.style.position = 'fixed';
        hint.style.right = '4px';
        hint.style.top = '16px';
        hint.style.zIndex = '2147483648';
        hint.style.background = '#E7F3FF';
        hint.style.color = '#1877F2';
        hint.style.padding = '10px 12px';
        hint.style.borderRadius = '10px';
        hint.style.boxShadow = '0 6px 22px rgba(24,119,242,0.20)';
        hint.style.border = '1px solid rgba(24,119,242,0.35)';
        hint.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        hint.style.fontSize = '13px';
        hint.style.lineHeight = '1.35';
        hint.style.maxWidth = '280px';
        hint.style.userSelect = 'none';
        hint.style.pointerEvents = 'auto';
        hint.innerHTML = `<div style="font-weight:700;text-shadow:0 1px 2px rgba(24,119,242,0.16)">Select images <span style='font-weight:400'>(Click into listings to select more images)</span></div>
            <div id="ffm-select-counter" style="margin-top:6px;font-weight:600;color:#0b3b57">0/10 images · 0/1 videos</div>
            <div style="margin-top:6px">Click the small + on each thumbnail to add. When done, click Send.</div>
            <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
              <button id="ffm-send-selected" style="background:#1877F2;color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;">Send</button>
              <button id="ffm-select-cancel" style="background:#f0f0f0;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;">Close</button>
            </div>`;
        document.documentElement.appendChild(hint);
        try { requestAnimationFrame(()=>{ try { const baseTop=parseInt(hint.style.top||'0',10)||0; const rect=hint.getBoundingClientRect(); const extra=(window && window.ffm_select_hint_offsetY)||rect.height; hint.style.top = Math.max(8, baseTop + Math.round(extra) + 8) + 'px'; } catch(_){ } }); } catch(_){ }
        try { updateSelectionCounter(); } catch(e) {}
  // Selection state and tracking maps
  // Selection tracking: maintain stable keys (cleaned) and original URLs for sending
  const selectedKeys = new Set(); // stable keys
  const selectedOrder = []; // preserve insertion order of keys
  const keyToOriginal = new Map(); // key -> latest original full src
  const markerMap = new Map(); // img => { marker, chk }

  // Helper: update the selection counter UI (images/videos). Use defaults unless overridden
  const updateSelectionCounter = () => {
    try {
      const counterEl = document.getElementById('ffm-select-counter');
      if (!counterEl) return;
      // Count by inspecting original URLs for video-like extensions
      let imgCount = 0, vidCount = 0;
      for (const k of selectedOrder) {
        try {
          const orig = keyToOriginal.get(k) || k || '';
          const low = (orig || '').toLowerCase();
          if (/\.(mp4|mov|webm|m4v)(?:\?|$)/i.test(low)) vidCount++; else imgCount++;
        } catch (e) { imgCount++; }
      }
      // Allow page to override defaults via window.ffm_fb_max_images / ffm_fb_max_videos
  // Force a minimum of 10 images allowed. Some pages may set a lower
  // window.ffm_fb_max_images which would unexpectedly restrict imports.
  const maxImagesRaw = (window && window.ffm_fb_max_images) ? Number(window.ffm_fb_max_images) : 10;
  const maxImages = (typeof maxImagesRaw === 'number' && isFinite(maxImagesRaw)) ? Math.max(10, maxImagesRaw) : 10;
      // Default maxVideos is 1 per new policy
  const maxVideos = (window && window.ffm_fb_max_videos) ? Number(window.ffm_fb_max_videos) : 1;
  counterEl.textContent = `${imgCount}/${isFinite(maxImages)?maxImages:10} images · ${vidCount}/${isFinite(maxVideos)?maxVideos:1} videos`;
    } catch (e) { /* best effort */ }
  };

  // Helper: show a small overlay inline notice (non-blocking) near the hint
  const showInlineNotice = (msg, ttl = 3000) => {
    try {
      const existing = document.getElementById('ffm-select-inline-notice');
      if (existing) { try { existing.remove(); } catch(_){} }
      const n = document.createElement('div'); n.id = 'ffm-select-inline-notice';
      n.style.position = 'absolute'; n.style.right = '8px'; n.style.top = '54px'; n.style.zIndex = '2147483650';
      n.style.background = 'rgba(0,0,0,0.8)'; n.style.color = '#fff'; n.style.padding = '6px 10px'; n.style.borderRadius = '8px';
      n.style.fontSize = '12px'; n.style.boxShadow = '0 6px 18px rgba(0,0,0,0.36)'; n.textContent = msg;
      document.documentElement.appendChild(n);
      setTimeout(()=>{ try { n.remove(); } catch(_){} }, ttl);
    } catch (e) {}
  };

        // Simplified marketplace mode: single main + all visible thumbnails (prevents stacked markers)
        if (isMarketplace) {
          try {
            // Core helpers
            const isVis = (el) => { try { if (!el) return false; const cs = getComputedStyle(el); if (cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity||'1')===0) return false; const r=el.getBoundingClientRect(); if (!r||r.width<20||r.height<20) return false; if (r.bottom<0||r.right<0||r.top>(window.innerHeight||0)||r.left>(window.innerWidth||0)) return false; return true; } catch(_) { return false; } };
            const currentMain = () => {
              const imgs = Array.from(document.querySelectorAll('img')).filter(isVis);
              if (!imgs.length) return null;
              imgs.sort((a,b)=> (b.getBoundingClientRect().width*b.getBoundingClientRect().height) - (a.getBoundingClientRect().width*a.getBoundingClientRect().height));
              return imgs[0];
            };
            const collectThumbs = () => Array.from(document.querySelectorAll('img')).filter(im => {
              if (!isVis(im)) return false; const r = im.getBoundingClientRect(); return r.width < 300 && r.height < 300; });

            const clearMarkers = () => { markerMap.forEach((v, img)=>{ try { v.marker.remove(); } catch(_){} }); markerMap.clear(); };
            const createSimpleMarker = (img) => {
              if (markerMap.has(img)) return;
              const r = img.getBoundingClientRect();
              const marker = document.createElement('div');
              marker.className='ffm-select-marker';
              Object.assign(marker.style,{position:'absolute',left:(r.left+window.scrollX)+'px',top:(r.top+window.scrollY)+'px',width:r.width+'px',height:r.height+'px',boxSizing:'border-box',pointerEvents:'none',border:'2px solid rgba(24,119,242,0.12)',zIndex:2147483646});
              const chk = document.createElement('div');
              chk.className='ffm-plus-btn';
              Object.assign(chk.style,{position:'absolute',right:'6px',top:'6px',width:'26px',height:'26px',borderRadius:'50%',background:'rgba(0,0,0,0.45)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',cursor:'pointer',pointerEvents:'auto'});
              chk.textContent='+';
              chk.addEventListener('click', (ev)=>{ ev.stopPropagation(); ev.preventDefault(); (async ()=>{
                try {
                  const raw = img.currentSrc || img.src; const key = makeStableKey(raw); if (!key) return;
                  const isVideo = /\.(mp4|mov|webm|m4v)(?:\?|$)/i.test((raw||'').toLowerCase());
                  // If video, check current video count and duration <= 60s
                  if (isVideo) {
                    const currentVidCount = Array.from(selectedOrder).filter(k => /\.(mp4|mov|webm|m4v)(?:\?|$)/i.test((keyToOriginal.get(k)||k||'').toLowerCase())).length;
                    const maxVideos = (window && window.ffm_fb_max_videos) ? Number(window.ffm_fb_max_videos) : 1;
                    if (currentVidCount >= maxVideos && !selectedKeys.has(key)) {
                      showInlineNotice(`Only ${maxVideos} video allowed`);
                      try { updateSelectionCounter(); } catch(e){}
                      return;
                    }
                    // Attempt to read duration via a temporary video element
                    try {
                      const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.src = raw;
                      await new Promise((res, rej) => { let done = false; const onLoaded = () => { if (done) return; done = true; res(); }; const onErr = () => { if (done) return; done = true; rej(); }; v.addEventListener('loadedmetadata', onLoaded); v.addEventListener('error', onErr); // timeout 4s
                        setTimeout(()=>{ if (!done) { done=true; rej(); } }, 4000);
                      });
                      const dur = isFinite(v.duration) ? Number(v.duration) : 0;
                      if (dur > 60) { showInlineNotice('Video longer than 60s — not allowed'); try { updateSelectionCounter(); } catch(e){}; return; }
                    } catch (e) { /* if metadata fetch fails, allow but proceed — playback metadata not available */ }
                  }
                  // Toggle selection
                  if (selectedKeys.has(key)) { selectedKeys.delete(key); const idx=selectedOrder.indexOf(key); if (idx>-1) selectedOrder.splice(idx,1); chk.textContent='+'; chk.style.background='rgba(0,0,0,0.45)'; }
                  else { selectedKeys.add(key); selectedOrder.push(key); keyToOriginal.set(key, raw); chk.textContent='✓'; chk.style.background='rgba(24,119,242,0.95)'; }
                } catch(_){}
                finally { try { updateSelectionCounter(); } catch(e){} }
              })(); });
              marker.appendChild(chk); document.documentElement.appendChild(marker); markerMap.set(img,{marker,chk});
            };
            const repositionAll = () => { markerMap.forEach((v,img)=>{ try { const r=img.getBoundingClientRect(); v.marker.style.left=(r.left+window.scrollX)+'px'; v.marker.style.top=(r.top+window.scrollY)+'px'; v.marker.style.width=r.width+'px'; v.marker.style.height=r.height+'px'; } catch(_){ } }); };
            const refreshSimple = () => {
              try {
                const main = currentMain();
                const thumbs = collectThumbs();
                // Build desired set
                const desired = new Set(); if (main) desired.add(main); thumbs.forEach(t=>desired.add(t));
                // Remove obsolete
                markerMap.forEach((v,img)=>{ if (!desired.has(img)) { try { v.marker.remove(); } catch(_){} markerMap.delete(img);} });
                // Add new
                desired.forEach(img=> createSimpleMarker(img));
                repositionAll();
                // Ensure only one marker for main (largest). Remove any other large overlapping images mistakenly added.
                if (main) {
                  markerMap.forEach((v, img) => {
                    if (img === main) return;
                    try {
                      const r = img.getBoundingClientRect();
                      const rm = main.getBoundingClientRect();
                      if (r.width > 220 || r.height > 220) {
                        const L = Math.max(r.left, rm.left);
                        const T = Math.max(r.top, rm.top);
                        const R = Math.min(r.right, rm.right);
                        const B = Math.min(r.bottom, rm.bottom);
                        const inter = Math.max(0, R - L) * Math.max(0, B - T);
                        const a1 = r.width * r.height;
                        const a2 = rm.width * rm.height;
                        const iou = inter ? (inter / (a1 + a2 - inter)) : 0;
                        if (iou > 0.2) {
                          try { v.marker.remove(); } catch(_){}
                          markerMap.delete(img);
                        }
                      }
                    } catch(_) { }
                  });
                }
              } catch(_){ }
            };
            // Hook observers
            const mo = new MutationObserver(()=>{ refreshSimple(); });
            try { mo.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','style','class','aria-hidden']}); } catch(_){ }
            window.addEventListener('scroll', ()=>{ refreshSimple(); }, { passive:true });
            window.addEventListener('resize', ()=>{ refreshSimple(); });
            setInterval(refreshSimple, 1200);
            refreshSimple();
            // Wire Send/Close buttons for this mode
            document.getElementById('ffm-send-selected').addEventListener('click', () => {
              try {
                const list = selectedOrder.map(k => keyToOriginal.get(k) || k).filter(Boolean);
                // Convert selected thumbnails to data URLs if possible before sending
                (async () => {
                  try {
                    const converted = await convertUrlsToDataUrls(list);
                    chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffm-fb-image-results', images: converted });
                  } catch (e) {
                    try { chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffm-fb-image-results', images: list }); } catch(_){}
                  }
                })();
              } catch(_){}
              try { hint && hint.remove(); } catch(_){ }
              markerMap.forEach((v)=>{ try { v.marker.remove(); } catch(_){ } });
              try { selectedKeys.clear(); selectedOrder.length = 0; keyToOriginal.clear(); updateSelectionCounter(); } catch(e){}
              window.__ffmOverlayActive = false;
            });
            document.getElementById('ffm-select-cancel').addEventListener('click', () => {
              try { hint && hint.remove(); } catch(_){ }
              markerMap.forEach((v)=>{ try { v.marker.remove(); } catch(_){ } });
              window.__ffmOverlayActive = false;
            });
            return; // Skip the complex legacy system for marketplace
          } catch(_){ }
        }

        // Normalize a src so dynamic query params (e.g., size, hash) changing after viewer navigation don't drop selection
        const makeStableKey = (src) => {
          try {
            if (!src) return '';
            const u = new URL(src, location.origin);
            const transient = new Set(['oh','oe','_nc_cat','_nc_ohc','_nc_ht','_nc_gid','_nc_oc','_nc_sid','_nc_zt','ccb']);
            const kept = Array.from(u.searchParams.entries())
              .filter(([k]) => !transient.has(k.toLowerCase()))
              .sort((a,b)=>a[0].localeCompare(b[0]));
            const qs = kept.map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
            return u.origin + u.pathname + (qs?('?'+qs):'');
          } catch(_) { return src || ''; }
        };

        const cleanup = () => {
          try { hint.remove(); } catch(e){}
          try { markerMap.forEach(v => { try { v.marker.remove(); } catch(_){} }); markerMap.clear(); } catch(e){}
          try { selectedKeys.clear(); selectedOrder.length = 0; keyToOriginal.clear(); updateSelectionCounter(); } catch(e){}
          try { if (window.__ffmIo) { window.__ffmIo.disconnect(); window.__ffmIo = null; } } catch(_){}
          try { if (window.__ffmMut) { window.__ffmMut.disconnect(); window.__ffmMut = null; } } catch(_){}
          try { if (window.__ffmRepositionTimer) { clearInterval(window.__ffmRepositionTimer); window.__ffmRepositionTimer = null; } } catch(_){}
          try { window.removeEventListener('scroll', repositionAll); window.removeEventListener('resize', repositionAll); } catch(_){}
          try { window.__ffmOverlayActive = false; } catch(_){}
        };

        const detectThumbs = () => {
          try {
            const ariaThumbImgs = Array.from(document.querySelectorAll('[aria-label^="Thumbnail" i] img, img[alt^="Thumbnail" i]'));
            const sizeThumbs = Array.from(document.images || []).filter(im => {
              try {
                const r = im.getBoundingClientRect();
                return r.width >= 45 && r.width <= 260 && r.height >= 45 && r.height <= 260 && r.bottom > 0 && r.top < (window.innerHeight||0);
              } catch (_) { return false; }
            });
            const merged = new Set();
            [...ariaThumbImgs, ...sizeThumbs].forEach(i => merged.add(i));
            return Array.from(merged);
          } catch (_) { return []; }
        };

        const detectMainProductImages = () => {
          try {
            return Array.from(document.images || []).filter(im => {
              try { return /^product photo of /i.test((im.getAttribute('alt')||'').trim()); } catch(_) { return false; }
            });
          } catch(_) { return []; }
        };

        // Compute a bounding rect for the thumbnail strip (union of small thumbs)
        const computeThumbsStripRect = (thumbs) => {
          try {
            if (!thumbs || thumbs.length < 3) return null;
            let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
            for (const im of thumbs) {
              try {
                const rect = im.getBoundingClientRect();
                if (!rect || rect.width < 1 || rect.height < 1) continue;
                l = Math.min(l, rect.left);
                t = Math.min(t, rect.top);
                r = Math.max(r, rect.right);
                b = Math.max(b, rect.bottom);
              } catch (_) {}
            }
            if (!isFinite(l) || !isFinite(t) || !isFinite(r) || !isFinite(b)) return null;
            const width = Math.max(0, r - l);
            const height = Math.max(0, b - t);
            // Heuristics: strip should be relatively short in height and near bottom half
            const vh = (window.innerHeight || 0);
            if (height > 240) return null;
            if (t > vh) return null;
            return { left: l, top: t, right: r, bottom: b, width, height };
          } catch (_) { return null; }
        };

        // Largest-image exclusion heuristic cache
        let lastLargestCheckTs = 0; let cachedLargestImg = null; let cachedHasThumbAlternatives = false;
        const computeLargestImage = () => {
          const now = Date.now();
          if (now - lastLargestCheckTs < 500) return { largest: cachedLargestImg, hasAlts: cachedHasThumbAlternatives };
            lastLargestCheckTs = now; cachedLargestImg = null; cachedHasThumbAlternatives = false;
            try {
              const imgs = Array.from(document.images || []).filter(im => {
                try { const r = im.getBoundingClientRect(); return r && r.width >= 60 && r.height >= 60; } catch(_) { return false; }
              });
              let largest = null; let largestArea = 0; const areas = new Map();
              imgs.forEach(im => { try { const r = im.getBoundingClientRect(); const area = r.width * r.height; areas.set(im, area); if (area > largestArea) { largestArea = area; largest = im; } } catch(_){} });
              if (largest) {
                // Count alternative smaller images (potential thumbs) significantly smaller than largest
                const altCount = imgs.filter(im => im !== largest && (areas.get(im) || 0) < largestArea * 0.75).length;
                cachedLargestImg = largest; cachedHasThumbAlternatives = altCount >= 2; // require at least 2 smaller images
              }
            } catch(_){}
          return { largest: cachedLargestImg, hasAlts: cachedHasThumbAlternatives };
        };

        const shouldConsiderImage = (img) => {
          try {
            const src = img.currentSrc || img.src || ''; if (!src) return false;
            const w = img.naturalWidth || img.width || 0; const h = img.naturalHeight || img.height || 0; if (w < 48 || h < 48) return false;
            // On Marketplace pages, only allow thumbnail-sized images (avoid the large preview)
            if (isMarketplace) {
              const thumbsList = detectThumbs();
              const thumbsPresent = thumbsList.length >= 2; // treat 2+ as a strip (some listings have only 2 extra)
              const alt = (img.getAttribute('alt') || '').trim();
              const isMainProduct = /^product photo of /i.test(alt);
              // Heuristic for large display (main) image even if alt not yet populated or pattern changes (lower threshold)
              const looksMainDisplay = (()=>{ try { const r = img.getBoundingClientRect(); return !!(r && (r.width > 220 || r.height > 220)); } catch(_) { return false; } })();
              // Dynamic largest exclusion if we have alternative smaller images
              let largestInfo = null; let isLargestDynamic = false;
              try { largestInfo = computeLargestImage(); isLargestDynamic = (largestInfo.largest === img) && largestInfo.hasAlts; } catch(_){}
              // NEW: allow main image selection. Filter rules:
              // - Thumbnails still governed by size / aria
              // - Large viewer images allowed but only the active visible one (opacity > 0.4 & highest area)
              const cs = window.getComputedStyle(img);
              const opacity = parseFloat(cs.opacity || '1');
              const rNow = img.getBoundingClientRect();
              if (looksMainDisplay) {
                if (opacity < 0.4 || rNow.width < 80 || rNow.height < 80) return false; // hidden stacked frame
              } else {
                // Thumbnail path
                const inAriaThumb = !!img.closest('[aria-label^="Thumbnail" i]');
                if (!inAriaThumb) {
                  try {
                    if (!rNow || rNow.width < 45 || rNow.height < 45 || rNow.width > 260 || rNow.height > 260) return false;
                  } catch(_) { return false; }
                }
              }
            }
            // Prefer marketplace/media contexts but keep broad; main filter is visibility
            let score = 0; let el = img;
            for (let i=0;i<6 && el;i++) {
              try {
                if (el.href && el.href.indexOf('/marketplace/') !== -1) score += 10;
                if (el.getAttribute && /thumb|photo|media|picture|image/i.test((el.getAttribute('class')||''))) score += 2;
                el = el.parentElement;
              } catch(_) { break; }
            }
            return score >= 0;
          } catch(_) { return false; }
        };

        const updateMarkerPosition = (img, marker) => {
          try {
            const r = img.getBoundingClientRect();
            marker.style.left = (r.left + window.scrollX) + 'px';
            marker.style.top = (r.top + window.scrollY) + 'px';
            marker.style.width = r.width + 'px';
            marker.style.height = r.height + 'px';
            const btn = marker.querySelector('.ffm-plus-btn');
            if (btn) {
              if (isMarketplace) {
                // Marketplace: keep clamped logic (left may shift for visibility)
                const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                const visLeft = Math.max(0, 0 - r.left);
                const visTop = Math.max(0, 0 - r.top);
                const visRightPad = Math.max(0, (r.right - vw));
                const visBottomPad = Math.max(0, (r.bottom - vh));
                const padding = 6, btnSize = 26;
                const maxX = r.width - btnSize - padding - visRightPad;
                const maxY = r.height - btnSize - padding - visBottomPad;
                const x = Math.min(Math.max(padding + visLeft, 0), Math.max(0, maxX));
                const y = Math.min(Math.max(padding + visTop, 0), Math.max(0, maxY));
                btn.style.left = x + 'px';
                btn.style.top = y + 'px';
                btn.style.right = 'auto';
              } else {
                // Non-marketplace: always top-right
                btn.style.left = '';
                btn.style.right = '6px';
                btn.style.top = '6px';
              }
            }
          } catch(_){ }
        };

        const createMarkerFor = (img) => {
          try {
            if (markerMap.has(img)) return;
            const r = img.getBoundingClientRect();
            const marker = document.createElement('div');
            marker.className = 'ffm-select-marker';
            marker.style.position = 'absolute';
            marker.style.left = (r.left + window.scrollX) + 'px';
            marker.style.top = (r.top + window.scrollY) + 'px';
            marker.style.width = r.width + 'px';
            marker.style.height = r.height + 'px';
            marker.style.boxSizing = 'border-box';
            // Ensure the marker never blocks page interactions; only the + button is interactive
            marker.style.pointerEvents = 'none';
            marker.style.zIndex = '2147483640';
            marker.style.border = '2px solid rgba(24,119,242,0.12)';
            const chk = document.createElement('div');
            chk.className = 'ffm-plus-btn';
            chk.style.position='absolute'; chk.style.left=''; chk.style.right='6px'; chk.style.top='6px'; chk.style.width='26px'; chk.style.height='26px';
            chk.style.borderRadius='50%'; chk.style.background='rgba(0,0,0,0.45)'; chk.style.color='#fff'; chk.style.display='flex';
            chk.style.alignItems='center'; chk.style.justifyContent='center'; chk.style.fontSize='14px'; chk.style.cursor='pointer';
            chk.textContent='+'; chk.style.pointerEvents='auto';
            chk.addEventListener('click', (ev) => {
              ev.stopPropagation(); ev.preventDefault();
              try {
                const raw = img.currentSrc || img.src;
                const key = makeStableKey(raw);
                if (!key) return;
                const already = selectedKeys.has(key);
                if (already) {
                  selectedKeys.delete(key);
                  const idx = selectedOrder.indexOf(key); if (idx > -1) selectedOrder.splice(idx,1);
                  chk.textContent = '+'; chk.style.background='rgba(0,0,0,0.45)';
                } else {
                  selectedKeys.add(key);
                  selectedOrder.push(key);
                  keyToOriginal.set(key, raw);
                  chk.textContent='✓'; chk.style.background='rgba(24,119,242,0.95)';
                }
                try { updateSelectionCounter(); } catch(e){}
              } catch(_){}
            });
            marker.appendChild(chk);
            document.documentElement.appendChild(marker);
            markerMap.set(img, { marker, chk });
          } catch(_){}
        };

        const removeMarkerFor = (img) => {
          try { const ent = markerMap.get(img); if (ent) { try { ent.marker.remove(); } catch(_){} markerMap.delete(img); } } catch(_){}
        };

        // Only highlight visible images via IntersectionObserver
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            const img = entry.target;
            if (!shouldConsiderImage(img)) return;
            if (entry.isIntersecting) {
              createMarkerFor(img);
              const ent = markerMap.get(img); if (ent) updateMarkerPosition(img, ent.marker);
            } else {
              removeMarkerFor(img);
            }
          });
        }, { root: null, threshold: 0.2 });
        window.__ffmIo = io;
        // Observe current images
        Array.from(document.images || []).forEach((img) => { try { io.observe(img); } catch(_){} });
        // Watch for new images added/removed
        const mut = new MutationObserver((records) => {
          try {
            for (const r of records) {
              r.addedNodes && r.addedNodes.forEach((n) => {
                try {
                  if (n && n.tagName === 'IMG') { io.observe(n); }
                  else if (n && n.querySelectorAll) { n.querySelectorAll('img').forEach(im => { try { io.observe(im); } catch(_){} }); }
                } catch(_){}
              });
              r.removedNodes && r.removedNodes.forEach((n) => {
                try {
                  if (n && n.tagName === 'IMG') { removeMarkerFor(n); try { io.unobserve(n); } catch(_){} }
                  else if (n && n.querySelectorAll) { n.querySelectorAll('img').forEach(im => { try { removeMarkerFor(im); io.unobserve(im); } catch(_){} }); }
                } catch(_){}
              });
            }
          } catch(_){}
        });
        mut.observe(document.documentElement || document.body, { childList: true, subtree: true });
        window.__ffmMut = mut;

        // Lightweight reflow: just reposition existing visible markers on scroll/resize
        let rafPending = false;
        const repositionAll = () => {
          if (rafPending) return; rafPending = true;
          requestAnimationFrame(() => {
            try { markerMap.forEach((v, img) => updateMarkerPosition(img, v.marker)); } finally { rafPending = false; }
          });
        };
        window.addEventListener('scroll', repositionAll, { passive: true });
        window.addEventListener('resize', repositionAll);

        // Robust: continuously re-evaluate positions/visibility so the big image stays selectable while arrowing
        try {
          const reallyVisible = (el) => {
            try {
              if (!el || !el.getBoundingClientRect) return false;
              const cs = window.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return false;
              const r = el.getBoundingClientRect();
              if (r.width < 32 || r.height < 32) return false;
              // Basic viewport intersection check
              const vw = (window.innerWidth || 0), vh = (window.innerHeight || 0);
              if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
              const ix = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
              const iy = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
              const inter = ix * iy; const area = Math.max(1, r.width * r.height);
              const ratio = inter / area;
              if (ratio >= 0.2) return true; // visible enough regardless of center occlusion
              // Fallback to center-point test as a tie-breaker
              const cx = Math.min(Math.max(r.left + r.width/2, 0), vw);
              const cy = Math.min(Math.max(r.top + r.height/2, 0), vh);
              const elAtPt = document.elementFromPoint(cx, cy);
              return !!(elAtPt && (elAtPt === el || (elAtPt.closest && elAtPt.closest('img') === el)));
            } catch(_) { return false; }
          };

          const ensureMarkersForVisibleImages = () => {
            try {
              const imgs = Array.from(document.images || []);
              for (const im of imgs) {
                try {
                  if (!shouldConsiderImage(im)) continue;
                  if (reallyVisible(im)) {
                    if (!markerMap.has(im)) createMarkerFor(im);
                  }
                } catch(_){}
              }
            } catch(_){}
          };

          window.__ffmRepositionTimer = setInterval(() => {
            try {
              // Update positions and drop hidden or disallowed ones
              // Identify active main image (largest visible & opacity > 0.4)
              let activeMain = null; let activeArea = 0;
              if (isMarketplace) {
                try {
                  const candidates = Array.from(document.images || []).filter(im => {
                    try { const r = im.getBoundingClientRect(); if (!r || r.width < 120 || r.height < 120) return false; const cs = window.getComputedStyle(im); if (parseFloat(cs.opacity || '1') < 0.4) return false; return r.width > 220 || r.height > 220; } catch(_) { return false; }
                  });
                  candidates.forEach(im => { try { const r = im.getBoundingClientRect(); const area = r.width * r.height; if (area > activeArea) { activeArea = area; activeMain = im; } } catch(_){} });
                } catch(_){}
              }
              markerMap.forEach((v, im) => {
                try {
                  // If on Marketplace and thumbs exist, remove markers for large/main images
                  if (isMarketplace) {
                    try {
                      const r0 = im.getBoundingClientRect();
                      const looksMainDisplay = r0 && (r0.width > 220 || r0.height > 220);
                      if (looksMainDisplay) {
                        // Keep only the active main image marker
                        if (activeMain && im !== activeMain) { removeMarkerFor(im); return; }
                        const cs = window.getComputedStyle(im); if (parseFloat(cs.opacity || '1') < 0.4) { removeMarkerFor(im); return; }
                      } else {
                        // Thumbnail validation (size or aria)
                        const inAriaThumb = !!im.closest('[aria-label^="Thumbnail" i]');
                        const sizeOk = r0 && r0.width >= 45 && r0.height >= 45 && r0.width <= 260 && r0.height <= 260;
                        if (!inAriaThumb && !sizeOk) { removeMarkerFor(im); return; }
                      }
                    } catch(_){ }
                  }
                  if (!document.contains(im) || !reallyVisible(im)) {
                    removeMarkerFor(im);
                  } else {
                    updateMarkerPosition(im, v.marker);
                  }
                } catch(_){}
              });
              ensureMarkersForVisibleImages();

              // Additional stacked large-image pruning: sometimes FB keeps multiple overlapping <img> layers for the main viewer.
              // Keep only one per near-identical bounding box cluster (choose highest opacity, then largest area).
              try {
                const largeWithMarkers = [];
                markerMap.forEach((v, im) => {
                  try {
                    const r = im.getBoundingClientRect();
                    if (!r || r.width < 200 || r.height < 180) return;
                    const cs = window.getComputedStyle(im);
                    const opacity = parseFloat(cs.opacity || '1');
                    largeWithMarkers.push({ im, r, opacity, area: r.width * r.height });
                  } catch(_){ }
                });
                // Compare pairs, group by high overlap (IoU > 0.85)
                for (let i=0;i<largeWithMarkers.length;i++) {
                  const a = largeWithMarkers[i]; if (!a) continue;
                  for (let j=i+1;j<largeWithMarkers.length;j++) {
                    const b = largeWithMarkers[j]; if (!b) continue;
                    const left = Math.max(a.r.left, b.r.left);
                    const top = Math.max(a.r.top, b.r.top);
                    const right = Math.min(a.r.right, b.r.right);
                    const bottom = Math.min(a.r.bottom, b.r.bottom);
                    const w = Math.max(0, right - left), h = Math.max(0, bottom - top);
                    const inter = w * h;
                    if (!inter) continue;
                    const union = a.area + b.area - inter;
                    const iou = union ? (inter / union) : 0;
                    if (iou > 0.85) {
                      // Decide which to keep
                      const keep = (a.opacity > b.opacity + 0.02) ? a : (b.opacity > a.opacity + 0.02 ? b : (a.area >= b.area ? a : b));
                      const drop = (keep === a) ? b : a;
                      removeMarkerFor(drop.im);
                      // Mark dropped entry null so we don't process further
                      if (keep === a) { largeWithMarkers[j] = null; } else { largeWithMarkers[i] = null; break; }
                    }
                  }
                }
              } catch(_){ }

              // Dedupe stacked markers (same bounding box & same underlying key)
              try {
                const seen = new Map(); // key -> {area, img}
                markerMap.forEach((v, im) => {
                  try {
                    const r = im.getBoundingClientRect();
                    const raw = im.currentSrc || im.src;
                    const key = makeStableKey(raw);
                    const id = key + '|' + Math.round(r.left) + '|' + Math.round(r.top) + '|' + Math.round(r.width) + '|' + Math.round(r.height);
                    if (seen.has(id)) {
                      // remove duplicate marker
                      removeMarkerFor(im);
                    } else {
                      seen.set(id, { im });
                    }
                  } catch(_){}
                });
              } catch(_){}

              // Bring the current active main (if any) to the front so its + is clickable
              try {
                let best = null; let bestArea = 0;
                markerMap.forEach((v, im) => {
                  try {
                    const r = im.getBoundingClientRect();
                    const area = Math.max(0, r.width) * Math.max(0, r.height);
                    if (reallyVisible(im) && area > bestArea) { bestArea = area; best = v; }
                  } catch(_){}
                });
                markerMap.forEach((v) => { try { v.marker.style.zIndex = '2147483640'; } catch(_){} });
                if (best) {
                  try {
                    best.marker.style.zIndex = '2147483649';
                    const rBest = best.marker.getBoundingClientRect();
                    const bestArea = Math.max(0, rBest.width) * Math.max(0, rBest.height);
                    // Remove other large markers that significantly overlap with the largest one
                    markerMap.forEach((v2, img2) => {
                      if (v2 === best) return;
                      try {
                        const r2 = v2.marker.getBoundingClientRect();
                        const area2 = Math.max(0, r2.width) * Math.max(0, r2.height);
                        if (area2 < 20000) return; // ignore small thumbnails
                        const L = Math.max(rBest.left, r2.left), T = Math.max(rBest.top, r2.top), R = Math.min(rBest.right, r2.right), B = Math.min(rBest.bottom, r2.bottom);
                        const w = Math.max(0, R-L), h = Math.max(0, B-T); const inter = w*h; if (!inter) return;
                        const union = bestArea + area2 - inter; const iou = union ? inter/union : 0;
                        if (iou > 0.3 || (area2 > bestArea * 0.5 && inter/Math.min(bestArea, area2) > 0.4)) {
                          removeMarkerFor(img2);
                        }
                      } catch(_){}
                    });
                  } catch(_){}
                }
              } catch(_){}

              // If a thumbnail strip is present, anchor a hint next to it (near the strip at the bottom)
              try {
                const thumbs = detectThumbs();
                const bottomHintId = 'ffm-fb-thumb-hint';
                const existing = document.getElementById(bottomHintId);
                if (thumbs && thumbs.length >= 3) {
                  const strip = computeThumbsStripRect(thumbs);
                  if (strip) {
                    let tip = existing;
                    if (!tip) {
                      tip = document.createElement('div');
                      tip.id = bottomHintId;
                      tip.setAttribute('role','status');
                      tip.style.position = 'absolute';
                      tip.style.zIndex = '2147483649';
                      tip.style.background = '#E7F3FF';
                      tip.style.color = '#1877F2';
                      tip.style.padding = '8px 10px';
                      tip.style.border = '1px solid rgba(24,119,242,0.35)';
                      tip.style.borderRadius = '10px';
                      tip.style.boxShadow = '0 4px 16px rgba(24,119,242,0.18)';
                      tip.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
                      tip.style.fontSize = '12px';
                      tip.style.lineHeight = '1.3';
                      tip.style.pointerEvents = 'auto';
                      tip.style.userSelect = 'none';
                      tip.textContent = 'Hint: Select thumbnail images below (not the main preview image).';
                      document.documentElement.appendChild(tip);
                    }
                    // Position: above the strip, aligned near the right edge of the strip
                    try {
                      // Measure after layout
                      const tipRect = tip.getBoundingClientRect();
                      const tipW = Math.max(140, tipRect.width || 0);
                      const tipH = Math.max(26, tipRect.height || 0);
                      const left = Math.max(8, Math.min(window.scrollX + strip.right - tipW, window.scrollX + strip.left));
                      const top = Math.max(8, window.scrollY + strip.top - tipH - 6);
                      tip.style.left = left + 'px';
                      tip.style.top = top + 'px';
                    } catch (_posErr) {}
                  } else {
                    if (existing) { try { existing.remove(); } catch(_){} }
                  }
                } else if (existing) {
                  try { existing.remove(); } catch(_){}
                }
                // Remove any old inline tip that was inside the top-right hint box to avoid duplication
                try { const oldInline = document.getElementById('ffm-fb-select-tip'); if (oldInline) oldInline.remove(); } catch(_){}
              } catch(_){ }
            } catch(_){}
          }, 400);
        } catch(_){}

        // Notify background once that overlay is ready so it can stop retrying injections
        try { chrome.runtime.sendMessage({ action: 'ffm-select-overlay-ready' }); } catch (_) {}

        document.getElementById('ffm-send-selected').addEventListener('click', () => {
          try {
            let keys = selectedOrder.slice();
            // Rebuild if somehow empty but markers show selections
            if (!keys.length) {
              try { markerMap.forEach((val, img) => { try { if (val && val.chk && val.chk.textContent === '✓') { const k = makeStableKey(img.currentSrc || img.src); if (k && keys.indexOf(k) === -1) keys.push(k); keyToOriginal.set(k, img.currentSrc || img.src); } } catch(_){} }); } catch(_){}
            }
            const originals = keys.map(k => keyToOriginal.get(k) || k);
            // Attempt to fetch each selected image in-page and convert to a data URL so
            // the popup (extension context) doesn't need to fetch remote FB URLs
            // (which can fail due to CORS). If conversion fails for an item, fall
            // back to sending the original URL so caller may attempt alternate fetch.
            (async () => {
              try {
                const MAX_CONVERT = 20; // limit work done in-page to keep UI responsive
                const toProcess = originals.slice(0, MAX_CONVERT);
                const converted = [];
                for (const src of toProcess) {
                  try {
                    // Use fetch in page context; Facebook-hosted images are usually fetchable
                    const r = await fetch(src, { mode: 'cors' });
                    if (!r || !r.ok) { converted.push(src); continue; }
                    const blob = await r.blob();
                    const dataUrl = await new Promise((res) => {
                      try {
                        const fr = new FileReader();
                        fr.onload = () => res(fr.result);
                        fr.onerror = () => res(src);
                        fr.readAsDataURL(blob);
                      } catch (e) { res(src); }
                    });
                    converted.push(dataUrl || src);
                  } catch (e) {
                    // On any failure, push the original URL as a fallback
                    try { converted.push(src); } catch (_) { converted.push(src); }
                  }
                }
                // If there were more originals than we converted, append the remaining URLs
                if (originals.length > toProcess.length) {
                  for (let i = toProcess.length; i < originals.length; i++) converted.push(originals[i]);
                }
                try { chrome.runtime.sendMessage({ action: 'ffm-fb-image-results', images: converted }); } catch (e) { try { chrome.runtime.sendMessage({ action: 'ffm-fb-image-results', images: originals }); } catch(_){} }
              } catch (e) {
                try { chrome.runtime.sendMessage({ action: 'ffm-fb-image-results', images: originals }); } catch(_){}
              } finally {
                try { chrome.runtime.sendMessage({ action: 'ffm-close-and-return' }); } catch(_){}
                try { cleanup(); } catch(_){}
              }
            })();
          } catch (e) { cleanup(); }
        });

        // Attach listeners to FB viewer next/prev buttons to force refresh after navigation
        try {
          const hookNavButtons = () => {
            try {
              const navBtns = Array.from(document.querySelectorAll('[aria-label="View next image" i], [aria-label="View previous image" i]'));
              navBtns.forEach(btn => {
                if (btn.__ffmNavHooked) return; btn.__ffmNavHooked = true;
                btn.addEventListener('click', () => { setTimeout(() => {
                  try {
                    // Force pruning & re-add of thumbnails only
                    markerMap.forEach((v, im) => { try { if (!shouldConsiderImage(im)) removeMarkerFor(im); } catch(_){} });
                    ensureMarkersForVisibleImages();
                  } catch(_){}
                }, 180); });
              });
            } catch(_){}
          };
          hookNavButtons();
          // Re-scan occasionally because viewer buttons can re-render
          setInterval(hookNavButtons, 1200);
        } catch(_){ }

        const closeBtn = document.getElementById('ffm-select-cancel');
        if (closeBtn) closeBtn.addEventListener('click', (ev) => { try { ev.preventDefault(); ev.stopPropagation(); cleanup(); } catch(_){} });

        // no separate close button in hint; Close in hint handles it
      } catch (e) {}
    }

    try { window.__ffmStartSelectOverlay = startOverlay; } catch (e) {}

    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        try {
          if (!msg || msg.action !== 'ffm-start-select-images') return;
          startOverlay((msg.query || '').toString());
        } catch (e) {}
      });
    }

    // Allow external callers (popup) to request suppression of the in-page overlay when using side panel.
    // Support per-tab suppression by persisting a short-lived key in chrome.storage.local keyed by tabId.
    try {
      if (chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg, sender) => {
          try {
            if (!msg) return;
            if (msg.action === 'suppress-overlay-for-panel') {
              // Remove any existing blue overlay hint immediately (best-effort)
              try {
                const oldHint = document.getElementById('ffm-fb-select-hint');
                if (oldHint && oldHint.parentElement) {
                  try { oldHint.parentElement.removeChild(oldHint); } catch (e) { try { oldHint.remove(); } catch (er) {} }
                }
              } catch (e) {}
              // If caller provided a tabId, persist a per-tab suppression flag; otherwise fall back to page-global transient.
              const tabId = (msg.tabId || (sender && sender.tab && sender.tab.id)) || null;
              if (tabId) {
                try {
                  const key = 'ffm_suppress_overlay_tab_' + tabId;
                  const payload = {};
                  payload[key] = { ts: Date.now() };
                  try { chrome.storage && chrome.storage.local && chrome.storage.local.set(payload); } catch (e) {}
                  // Clear after 30 minutes (was 30s)
                  setTimeout(() => { try { chrome.storage && chrome.storage.local && chrome.storage.local.remove(key); } catch (e) {} }, 1800000);
                } catch (e) {}
              } else {
                try { window.__ffmSuppressOverlay = true; } catch (e) {}
                // reset after a short delay so suppression is transient
                setTimeout(() => { try { window.__ffmSuppressOverlay = false; } catch (e) {} }, 5000);
              }
            }
          } catch (e) {}
        });
      }
    } catch (e) {}

    // Respond to scheduled relist scan requests (non-destructive)
    try {
      chrome.runtime.onMessage.addListener((msg, sender) => {
        try {
          if (!msg || msg.action !== 'start-scheduled-relist') return;
          // Scan the seller listings on the page and build candidate metadata
          (async function doScheduledRelistScan() {
            try {
              const selectorsTried = [];
              const collectCandidatesOnce = (sel) => {
                try {
                  selectorsTried.push(sel);
                  const nodes = Array.from(document.querySelectorAll(sel || 'a[href*="/marketplace/item/"]'));
                  const candidates = [];
                  for (const a of nodes) {
                    try {
                      const href = a.href || '';
                      // title can be in several places
                      let title = '';
                      try {
                        const maybe = a.querySelector('div[role="article"] h3') || a.querySelector('h3') || a.querySelector('span') || a.querySelector('[role="link"]');
                        title = maybe ? (maybe.innerText || maybe.textContent || '').trim() : '';
                      } catch (e) { title = (a.textContent||'').trim().split('\n')[0] || ''; }
                      // price heuristics
                      let priceText = '';
                      try {
                        const p = a.querySelector('[aria-label*="Price"]') || a.querySelector('.price') || a.querySelector('[data-testid*="price"]') || a.querySelector('div');
                        priceText = p ? (p.innerText || p.textContent || '').trim() : '';
                      } catch (e) {}
                      const img = a.querySelector('img');
                      const imgSrc = img && img.src ? img.src : null;
                      let listingId = null;
                      try { const m = href.match(/\/marketplace\/item\/(\d+)/); if (m && m[1]) listingId = m[1]; } catch (e) {}
                      candidates.push({ listingId, title, priceText, preview: imgSrc, href });
                    } catch (e) {}
                  }
                  return candidates;
                } catch (e) { return []; }
              };

              const trySelectors = [
                'a[href*="/marketplace/item/"]',
                'div[role="article"] a[href*="/marketplace/item/"]',
                'a[role="link"][href*="/marketplace/item/"]',
                'div[data-testid*="marketplace_feed_item"] a[href*="/marketplace/item/"]',
                // final fallback: any anchor containing the pattern
                'a[href*="/marketplace/item/"]'
              ];

              let attempts = 0;
              const maxAttempts = 3;
              let candidates = [];
              for (; attempts < maxAttempts; attempts++) {
                try {
                  // Try each selector pass
                  for (const sel of trySelectors) {
                    try {
                      const c = collectCandidatesOnce(sel);
                      if (Array.isArray(c) && c.length > 0) { candidates = c; break; }
                    } catch (e) {}
                  }
                  if (candidates.length) break;
                  // If none found, attempt a gentle scroll to load more items and wait
                  try {
                    const scrollY = Math.max(window.innerHeight * 0.6, 400);
                    window.scrollBy({ top: scrollY, left: 0, behavior: 'smooth' });
                  } catch (e) {}
                  // wait a bit for FB to hydrate lazy items
                  await new Promise(r => setTimeout(r, 700 + attempts * 350));
                } catch (e) {}
              }

              // Build diagnostic snapshot (truncate any large HTML)
              const sampleHtml = (function(){ try { const el = document.querySelector('a[href*="/marketplace/item/"]'); if (!el) return ''; const html = el.outerHTML || el.innerHTML || ''; return html.length > 1200 ? html.slice(0,1200) + '...': html; } catch(e){ return ''; } })();
              const diag = { pageUrl: location.href, viewport: { w: window.innerWidth, h: window.innerHeight }, attempts: attempts + 1, selectorsTried: selectorsTried, sampleHtml };

              const key = 'ffm_schedule_result_' + (msg.taskId || '');
              const payload = { candidates: candidates || [], ts: Date.now(), diag };
              try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ [key]: payload }); } catch (e) {}
              // Best-effort: also try to notify background via runtime message with diagnostics
              try { chrome.runtime.sendMessage({ action: 'scheduled-relist-candidates', taskId: msg.taskId, candidates: candidates || [], diag }); } catch (e) {}
            } catch (e) {}
          })();
        } catch (e) {}
      });
    } catch (e) {}

    try {
      const href = (location && location.href) || '';
      if (/https?:\/\/(www\.|m\.)?facebook\.com\/search\//.test(href)) {
        // Storage-flag auto start (manual starter button removed per user request)
        chrome.storage && chrome.storage.local && chrome.storage.local.get(['ffm_select_overlay_query'], (res) => {
          try {
            const q = res && res.ffm_select_overlay_query;
            if (q) { if (!window.__ffmOverlayActive && !document.getElementById('ffm-fb-select-hint')) startOverlay(String(q)); }
            else {
              // Time-based fallback auto-start
              setTimeout(() => { try { if (!window.__ffmOverlayActive && !document.getElementById('ffm-fb-select-hint')) startOverlay(''); } catch (e) {} }, 1400);
            }
          } catch (e) {}
        });
      }
    } catch (e) {}

    // SPA route watcher: if navigation lands on a search page later, start overlay
    try {
      let lastHref = location.href;
      setInterval(() => {
        try {
          const cur = location.href;
          if (cur !== lastHref) {
            lastHref = cur;
            if (/https?:\/\/(www\.|m\.)?facebook\.com\/search\//.test(cur)) {
              setTimeout(() => { try { if (!window.__ffmOverlayActive && !document.getElementById('ffm-fb-select-hint')) startOverlay(''); } catch (e) {} }, 800);
            }
          }
        } catch (_) {}
      }, 600);
    } catch (e) {}
  } catch (e) {}
})();


// Allow overlays on facebook.com; no host-based removal or disabling

function createPanel() {
  // compact pinned top-right panel (minimizable). Keep only one instance.
  // Allow panel on Facebook as well (user requested consistent overlay everywhere)
  // Respect global disable flag (set during initial load on some pages)
  try { if (window && window.ffm_panel_disabled) return; } catch (e) {}
  try { if (window && window.__ffm_create_injected) return; window.__ffm_create_injected = true; } catch (e) {}
  if (document.getElementById('extension-pin-panel')) return;
  try { if (typeof ffmCloseAllPopups === 'function') ffmCloseAllPopups(); } catch (e) {}

  const panel = document.createElement('div');
  panel.id = 'extension-pin-panel';
  panel.className = 'ffm-pin-panel';

  // header with title, minimize and close
  const header = document.createElement('div');
  header.className = 'ffm-pin-header';
  const title = document.createElement('div');
  title.className = 'ffm-pin-title';
  title.textContent = 'FAST for Marketplace';
  const actions = document.createElement('div');
  actions.className = 'ffm-pin-actions';

  const minBtn = document.createElement('button');
  minBtn.type = 'button';
  minBtn.id = 'ffm-pin-minimize';
  minBtn.title = 'Minimize';
  minBtn.textContent = '–';
  minBtn.className = 'ffm-pin-btn';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'ffm-pin-close';
  closeBtn.title = 'Close';
  closeBtn.textContent = '✕';
  closeBtn.className = 'ffm-pin-btn';

  // pin button to lock position / disable dragging
  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.id = 'ffm-pin-lock';
  pinBtn.title = 'Pin position (toggle)';
  pinBtn.textContent = '📌';
  pinBtn.className = 'ffm-pin-btn';

  actions.appendChild(pinBtn);
  actions.appendChild(minBtn);
  actions.appendChild(closeBtn);
  header.appendChild(title);
  header.appendChild(actions);

  // iframe hosting popup UI
  const frameWrap = document.createElement('div');
  frameWrap.className = 'ffm-pin-framewrap';
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('popup.html');
  iframe.id = 'ffm-pin-iframe';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  iframe.setAttribute('aria-label', 'FAST for Marketplace pinned panel');
  frameWrap.appendChild(iframe);

  panel.appendChild(header);
  panel.appendChild(frameWrap);

  document.body.appendChild(panel);
  try { panel.classList.add('ffm-pin-always-on-top'); panel.style.zIndex = '2147483648'; } catch (e) {}
  // Apply persisted "always on top", locked and minimized state if set
  try {
    chrome.storage.local.get({ ffm_pin_always_on_top: false, ffm_pin_locked: false, ffm_pin_minimized: false }, (res) => {
      try {
        const topVal = !!(res && res.ffm_pin_always_on_top);
        const lockedVal = !!(res && res.ffm_pin_locked);
        const miniVal = !!(res && res.ffm_pin_minimized);
        if (topVal) {
          try { panel.classList.add('ffm-pin-always-on-top'); panel.style.zIndex = '2147483648'; } catch (e) { /* best-effort */ }
        }
        if (lockedVal) {
          panel.classList.add('ffm-pin-locked');
          try { const pb = document.getElementById('ffm-pin-lock'); if (pb) pb.title = 'Unpin (unlock position)'; } catch (e) {}
        }
        if (miniVal) {
          panel.classList.add('ffm-pin-minimized');
          try { const mb = document.getElementById('ffm-pin-minimize'); if (mb) mb.textContent = '+'; } catch (e) {}
        }
      } catch (e) {}
    });
  } catch (e) {}

  // Minimize behavior: collapse to header only
  minBtn.addEventListener('click', () => {
    try {
      panel.classList.toggle('ffm-pin-minimized');
      minBtn.textContent = panel.classList.contains('ffm-pin-minimized') ? '+' : '–';
      // persist minimized state
      try { chrome.storage.local.set({ ffm_pin_minimized: !!panel.classList.contains('ffm-pin-minimized') }); } catch (e) {}
    } catch (e) {}
  });

  // Close behavior
  closeBtn.addEventListener('click', removePanel);

  // pin toggle: lock/unlock dragging
  pinBtn.addEventListener('click', () => {
    try {
      panel.classList.toggle('ffm-pin-locked');
      pinBtn.title = panel.classList.contains('ffm-pin-locked') ? 'Unpin (unlock position)' : 'Pin position (toggle)';
      // persist locked state
      try { chrome.storage.local.set({ ffm_pin_locked: !!panel.classList.contains('ffm-pin-locked') }); } catch (e) {}
    } catch (e) {}
  });

  // allow drag by header to reposition (small, optional UX)
  try {
    let dragging = false; let startX = 0; let startY = 0; let startLeft = 0; let startTop = 0;
    header.style.cursor = 'move';
    header.addEventListener('mousedown', (ev) => { try {
      if (panel.classList.contains('ffm-pin-locked')) return; // locked: do not start dragging
      dragging = true; startX = ev.clientX; startY = ev.clientY; const r = panel.getBoundingClientRect(); startLeft = r.left; startTop = r.top; ev.preventDefault();
    } catch (e) {} });
    window.addEventListener('mousemove', (ev) => { try { if (!dragging) return; const dx = ev.clientX - startX; const dy = ev.clientY - startY; panel.style.right = 'auto'; panel.style.left = Math.max(6, startLeft + dx) + 'px'; panel.style.top = Math.max(6, startTop + dy) + 'px'; panel.style.bottom = 'auto'; } catch (e) {} });
    window.addEventListener('mouseup', () => { try { if (dragging) { dragging = false; ffmSavePinPosition(panel); } } catch (e) {} });
  } catch (e) {}
  // restore any previously saved position
  try { ffmRestorePinPosition(panel); } catch (e) {}
}

// restore saved position when the panel exists
async function ffmRestorePinPosition(panel) {
  try {
    const pos = await new Promise((res) => chrome.storage.local.get(['ffm_pin_pos'], (r) => res(r.ffm_pin_pos || null)));
    if (pos && panel) {
      try {
        if (pos.left !== undefined) panel.style.left = pos.left + 'px';
        if (pos.top !== undefined) panel.style.top = pos.top + 'px';
        // ensure we unset right/bottom so absolute left/top work
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      } catch (e) {}
    }
  } catch (e) { console.debug('ffmRestorePinPosition error', e); }
}

// Save position helper used after dragging stops
function ffmSavePinPosition(panel) {
  try {
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const pos = { left: Math.max(0, Math.round(r.left)), top: Math.max(0, Math.round(r.top)) };
    try { chrome.storage.local.set({ ffm_pin_pos: pos }); } catch (e) { console.debug('ffmSavePinPosition storage error', e); }
  } catch (e) { console.debug('ffmSavePinPosition error', e); }
}

// Listen for postMessage from the embedded iframe (popup.html) to know when it's ready or to receive actions
window.addEventListener('message', (ev) => {
  try {
    const data = ev && ev.data;
    if (!data) return;
    if (data.ffm_iframe_ready) {
      // Persist that iframe is ready for potential handshakes
      try { chrome.storage.local.set({ ffm_iframe_ready: true }); } catch (e) {}
      // Forward readiness to extension runtime so popup/background can react immediately
  try { ffmSendMessage({ action: 'ffm_iframe_ready', tabId: (window && window.location && window.location.href) || '' }); } catch (e) {}
      // Optionally forward to other parts of the extension; nothing else to do here
    }
    if (data.ffm_save_position && document.getElementById('extension-pin-panel')) {
      // allow iframe to request saving current panel position
      ffmSavePinPosition(document.getElementById('extension-pin-panel'));
    }
  } catch (e) {}
});

// Listen for runtime messages querying panel state
chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    // Quick ping responder used by background to detect when the content script is listening.
    if (message && message.action === 'ffm_probe_ping') {
      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      return true; // indicate async-response handled
    }
    if (!message) return;
    // Toggle Next-overlay/debug helper
    // (ffm_toggle_next_overlay listener removed)

    // (ffm_dump_inline_jsons debug listener removed)
    if (message.action === 'spawn-pin-panel') {
      try { createPanel(); sendResponse && sendResponse({ ok: true }); } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (e2) {} }
      return true;
    }
    // spawn-create-overlay handler removed: runtime-triggered in-page overlay is disabled
    if (message.action === 'query-panel') {
      const panel = document.getElementById('extension-pin-panel') || document.querySelector('.ffm-pin-panel');
      const exists = !!panel;
      const state = { exists, alwaysOnTop: false, locked: false, minimized: false };
      try {
        if (panel) {
          state.alwaysOnTop = panel.classList.contains('ffm-pin-always-on-top');
          state.locked = panel.classList.contains('ffm-pin-locked');
          state.minimized = panel.classList.contains('ffm-pin-minimized');
        }
      } catch (e) {}
      sendResponse && sendResponse({ ok: true, state });
      return true;
    }
  } catch (e) {}
});

// Overlay/debug helpers removed per user request


function removePanel() {
  const pin = document.getElementById('extension-pin-panel');
  if (pin) pin.remove();
}

// Clear the create-panel injected flag when panel is removed so future injections can occur
try {
  const __origRemovePanel = removePanel;
  removePanel = function() {
    try { __origRemovePanel(); } catch (e) {}
    try { window.__ffm_create_injected = false; } catch (e) {}
  };
} catch (e) {}

// Debug overlays and interactive debug helpers removed to clean relist/debug tooling.
// If you need them again later we can reintroduce lightweight versions behind flags.

// Storage helpers using chrome.storage.local so selectors persist across sessions
async function ffmGetSelectorMap() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get('ffm_selector_map', (res) => {
        try { resolve((res && res.ffm_selector_map) ? res.ffm_selector_map : {}); } catch (e) { resolve({}); }
      });
    } catch (e) { resolve({}); }
  });
}

async function ffmSetSelectorMap(map) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ ffm_selector_map: map }, () => { resolve(); });
    } catch (e) { resolve(); }
  });
}

// Helper: synthesize pointer and mouse events at window level and on element
function ffmSynthesizePointerClickAt(clientX, clientY) {
  try {
    const pageX = Math.round(clientX + (window.scrollX || window.pageXOffset || 0));
    const pageY = Math.round(clientY + (window.scrollY || window.pageYOffset || 0));
    const screenX = (typeof window.screenX === 'number' ? window.screenX : 0) + clientX;
    const screenY = (typeof window.screenY === 'number' ? window.screenY : 0) + clientY;
    const common = { bubbles: true, cancelable: true, composed: true, clientX, clientY, pageX, pageY, screenX, screenY, view: window, detail: 1 };
    const pointerOpts = Object.assign({}, common, { pointerId: 9999, isPrimary: true, pressure: 0.5, button: 0, buttons: 1, pointerType: 'mouse' });
    const pointerMove = Object.assign({}, pointerOpts, { pressure: 0, buttons: 0 });
    try { window.dispatchEvent && window.dispatchEvent(new PointerEvent('pointermove', pointerMove)); } catch (e) {}
    try { window.dispatchEvent && window.dispatchEvent(new PointerEvent('pointerdown', pointerOpts)); } catch (e) {}
    try { window.dispatchEvent && window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, pointerOpts, { pressure: 0, buttons: 0 }))); } catch (e) {}
    try { window.dispatchEvent && window.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, common, { button: 0, buttons: 1 }))); } catch (e) {}
    try { window.dispatchEvent && window.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, { button: 0, buttons: 0 }))); } catch (e) {}
    try { window.dispatchEvent && window.dispatchEvent(new MouseEvent('click', Object.assign({}, common, { button: 0, buttons: 0 }))); } catch (e) {}
  } catch (e) { /* best effort */ }
}

// Rich activation: synthesize pointer sequence at element center and also send Enter key
async function ffmTryRichActivation(el) {
  try {
    if (!el) return false;
    const r = el.getBoundingClientRect && el.getBoundingClientRect();
    const cx = r ? Math.round(r.left + r.width/2) : 0;
    const cy = r ? Math.round(r.top + r.height/2) : 0;
    // pointerover/move with richer properties
    const screenX = (typeof window.screenX === 'number' ? window.screenX : 0) + cx;
    const screenY = (typeof window.screenY === 'number' ? window.screenY : 0) + cy;
    const common = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, pageX: Math.round(cx + (window.scrollX || window.pageXOffset || 0)), pageY: Math.round(cy + (window.scrollY || window.pageYOffset || 0)), screenX, screenY, view: window, detail: 1 };
    try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointerover', Object.assign({}, common, { pointerId: 9999, isPrimary: true, pointerType: 'mouse', buttons: 0 }))); } catch (e) {}
    try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, common, { pointerId: 9999, isPrimary: true, pointerType: 'mouse', buttons: 0 }))); } catch (e) {}
    // pointerdown/up and mouse events with buttons/detail
    try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, common, { pointerId: 9999, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1, pressure: 0.5 }))); } catch (e) {}
    try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, common, { button: 0, buttons: 1 }))); } catch (e) {}
    await sleep(30);
    try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, common, { pointerId: 9999, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0, pressure: 0 }))); } catch (e) {}
    try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, { button: 0, buttons: 0 }))); } catch (e) {}
    try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('click', Object.assign({}, common, { button: 0, buttons: 0 }))); } catch (e) {}
    // additionally try page-level synthesized events
    try { ffmSynthesizePointerClickAt(cx, cy); } catch (e) {}
    await sleep(60);
    // focus and send Enter key events
    try { el.focus && el.focus(); } catch (e) {}
    try { el.dispatchEvent && el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles:true })); } catch (e) {}
    try { el.dispatchEvent && el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles:true })); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

// Fallback: focus a target (or nearest focusable ancestor) and send Enter keystrokes
async function ffmFocusAndEnter(target) {
  try {
    if (!target) return false;
    // find nearest focusable element: input, textarea, button, [tabindex]
    function isFocusable(el) {
      try {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'button' || tag === 'select' || el.hasAttribute('contenteditable')) return true;
        const ti = el.getAttribute && el.getAttribute('tabindex');
        if (ti !== null && !isNaN(parseInt(ti,10))) return true;
        return false;
      } catch (e) { return false; }
    }

    let el = target;
    if (el && !isFocusable(el)) {
      el = el.querySelector && (el.querySelector('input, textarea, button, [tabindex]')) || el;
    }
    // walk up to find focusable ancestor
    let steps = 0;
    while (el && !isFocusable(el) && steps < 6) { el = el.parentElement; steps++; }
    if (!el) el = target;

    try { el.focus && el.focus(); } catch (e) {}
    // send a couple of Enter key presses
    for (let i = 0; i < 3; i++) {
      try {
        const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        el.dispatchEvent && el.dispatchEvent(kd);
        await new Promise(r => setTimeout(r, 20));
        el.dispatchEvent && el.dispatchEvent(ku);
      } catch (e) {}
      await new Promise(r => setTimeout(r, 80));
    }
    return true;
  } catch (e) { return false; }
}

// Press Enter on a target element programmatically (no user interaction)
// Returns true if events were dispatched.
async function ffmPressEnter(target) {
  // Try preferred title+price matcher first
  try {
    const res = await ffmCheckActiveListingsByTitleAndPrice();
    if (Array.isArray(res) && res.length) return res;
  } catch (e) { /* ignore and fallthrough */ }

  // Try to use a page-exposed richer scraper next if available.
  try {
    if (typeof window.ffmScrapeSavedListings === 'function') {
      const res = await window.ffmScrapeSavedListings();
      if (Array.isArray(res) && res.length) {
        // assume it merged/persisted itself — still return
        return res;
      }
    }
  } catch (e) { /* ignore */ }

  // fallback: simple DOM scan by ids/links
  const articles = Array.from(document.querySelectorAll('article'));
  const found = [];
  for (const a of articles) {
    try {
      const link = a.querySelector('a[href*="/marketplace/item/"]');
      if (!link) continue;
      const href = link.getAttribute('href');
      const m = href.match(/item\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      const titleEl = a.querySelector('h2');
      const title = titleEl && titleEl.innerText ? titleEl.innerText.trim() : '';
      found.push({ id, title });
    } catch (e) { }
  }

  if (!found.length) return [];

  // merge with storage
  const store = await new Promise(res => { try { chrome.storage.local.get({ listings: [] }, r => res(r || {})); } catch (e) { res({ listings: [] }); } });
  const listings = Array.isArray(store.listings) ? store.listings.slice() : [];

  // clear previous active markers
  listings.forEach(l => {
    try { l._ffm_active = false; l.isActive = false; if (l.status && String(l.status).toLowerCase() === 'active') l.status = ''; } catch (e) { }
  });

  const nowIso = new Date().toISOString();
  for (const f of found) {
    const match = listings.find(l => String(l.id) === String(f.id) || (l.title && l.title.trim() === f.title.trim()));
    if (match) {
      match._ffm_active = true;
      match.isActive = true;
      match.status = 'Active';
      match.lastChecked = nowIso;
      match.lastSeenActive = nowIso;
    }
  }

  await new Promise(res => { try { chrome.storage.local.set({ listings, ffmLastActiveCheck: Date.now() }, () => res()); } catch (e) { res(); } });
  try {
    chrome.storage.local.get(['ffm_as_hidden_active'], (r) => {
      if (r && r.ffm_as_hidden_active) {
        try { console.debug('[AS:hidden] suppressed ffmActiveListingsUpdated (post-store)'); } catch (e) {}
        return;
      }
      try { chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffmActiveListingsUpdated', data: listings }); } catch (e) {}
    });
  } catch (e) {}
  return listings.filter(l => l.isActive).map(l => ({ id: l.id || null, title: l.title || '', lastChecked: l.lastChecked }));
  try {
    if (!el) return false;

    // Helper: small async pause
    const pause = (ms) => new Promise(r => setTimeout(r, ms));

    // Strategy 1: realClick chain (mousedown, mouseup, click)
    try {
      try {
        const rect = (el.getBoundingClientRect && el.getBoundingClientRect()) || { left: 0, top: 0 };
        const clientX = Math.round(rect.left + (rect.width || 0) / 2);
        const clientY = Math.round(rect.top + (rect.height || 0) / 2);
        const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
        el.dispatchEvent && el.dispatchEvent(new MouseEvent('mousedown', opts));
      } catch (e) {}
      await pause(12);
      try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, view:window })); } catch (e) {}
      await pause(8);
      try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window })); } catch (e) {}
      console.debug('ffmTryHardClick: tried real click chain on', el);
      // allow the page a moment to react
      await pause(40);
    } catch (e) { console.debug('ffmTryHardClick: realClick error', e); }

    // Quickly check for visible changes via focus or attribute change is unreliable; continue to strategy 2

    // Strategy 2: trigger internal React handler if present
    try {
      const reactKey = Object.keys(el).find(k => k && (k.indexOf('__react') === 0 || k.indexOf('__reactProps') === 0 || k.indexOf('__reactEventHandlers') === 0));
      if (reactKey) {
        try {
          const fiber = el[reactKey];
          const props = (fiber && (fiber.return && (fiber.return.pendingProps || fiber.return.memoizedProps))) || (fiber && (fiber.memoizedProps || fiber.pendingProps)) || null;
          const handler = props && (props.onClick || props.onClickCapture || props.onclick);
          if (typeof handler === 'function') {
            try {
              handler.call(el, { isTrusted: true });
              console.debug('ffmTryHardClick: invoked React onClick on', el);
              await pause(40);
              return true;
            } catch (e) { console.debug('ffmTryHardClick: react handler threw', e); }
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { console.debug('ffmTryHardClick: react probe error', e); }

    // Strategy 3: programmatic Enter keypress (no user interaction)
    try {
      if (typeof ffmPressEnter === 'function') {
        const ok = await ffmPressEnter(el);
        console.debug('ffmTryHardClick: ffmPressEnter result ->', ok, el);
        if (ok) return true;
      }
    } catch (e) { console.debug('ffmTryHardClick: ffmPressEnter error', e); }

    return true; // best-effort: we've attempted all strategies
  } catch (e) { console.debug('ffmTryHardClick error', e); return false; }
}

// Lightweight visual marker (disabled): previously showed a red circle where we were about to click
function ffmShowMarkerAt(el, opts) {
  // Disabled per user request; keep the function as a no-op for safety
  return;
}

// ffmCallAttemptPublishClickSafe moved earlier in this file (top-level) to reduce
// injection/ordering races. See the top-of-file definition for the resilient
// implementation.

// Global helper: ensure a bottom-left blue hint is visible (25% up from bottom)
function ffmEnsurePublishHint(message) {
  try {
    const id = 'ffm-publish-hint';
    // If it already exists, just update the text
    const existing = document.getElementById(id);
    if (existing) {
      try { const t = existing.querySelector('[data-ffm-hint-text]'); if (t) t.textContent = message || ' inspect the results and click Publish when ready. Enable Auto Publishing to automate this step.'; } catch (e) {}
      return;
    }
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.setAttribute('role', 'status');
    wrap.style.position = 'fixed';
    wrap.style.left = '12px';
  wrap.style.bottom = '20vh';
    wrap.style.zIndex = '2147483647';
  wrap.style.background = '#E7F3FF';
  wrap.style.color = '#1877F2';
  wrap.style.padding = '12px 14px 12px 14px';
  wrap.style.borderRadius = '12px';
  wrap.style.boxShadow = '0 6px 22px rgba(24,119,242,0.20)';
  wrap.style.border = '1px solid rgba(24,119,242,0.35)';
    wrap.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  wrap.style.fontSize = '14px';
    wrap.style.lineHeight = '1.35';
    wrap.style.maxWidth = '360px';
    wrap.style.pointerEvents = 'auto';
    wrap.style.userSelect = 'none';
  const text = document.createElement('div');
    text.setAttribute('data-ffm-hint-text', '');
    text.textContent = message || 'You can now inspect the results and click Publish when ready.';
  text.style.fontWeight = '700';
  text.style.textShadow = '0 1px 2px rgba(24,119,242,0.16)';
    wrap.appendChild(text);

  // speech-bubble tail
  const tail = document.createElement('div');
  tail.style.position = 'absolute';
  tail.style.left = '18px';
  tail.style.bottom = '-8px';
  tail.style.width = '0';
  tail.style.height = '0';
  tail.style.borderLeft = '8px solid transparent';
  tail.style.borderRight = '8px solid transparent';
  tail.style.borderTop = '8px solid #E7F3FF';
  wrap.appendChild(tail);
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = 'Dismiss';
    close.style.position = 'absolute';
    close.style.right = '6px';
    close.style.top = '2px';
    close.style.background = 'transparent';
    close.style.border = 'none';
  close.style.color = '#1877F2';
    close.style.fontSize = '16px';
    close.style.cursor = 'pointer';
    close.addEventListener('click', () => { try { wrap.remove(); } catch (e) {} });
    wrap.appendChild(close);
    // transition: slide/fade in
    wrap.style.opacity = '0';
    wrap.style.transform = 'translateY(10px)';
    wrap.style.transition = 'opacity 220ms ease, transform 220ms ease';
    (document.body || document.documentElement).appendChild(wrap);
    try { requestAnimationFrame(() => { try { wrap.style.opacity = '1'; wrap.style.transform = 'translateY(0)'; } catch (e) {} }); } catch (e) {}
  } catch (e) { /* non-fatal */ }
}

// Audience watcher (clean, minimal replacement). Original debug banners removed during cleanup.
(function initFfmAudienceWatcher() {
  try {
    let lastIsAudience = false;
    function isAudience() {
      try {
        const url = location.href || '';
        if (url.indexOf('step=audience') >= 0) return true;
        const sp = (new URL(url)).searchParams.get('step');
        return sp === 'audience';
      } catch (e) { return false; }
    }

    const check = () => {
      try {
        const now = isAudience();
        // Show hint immediately when we enter the audience step, remove when leaving
        if (now && !lastIsAudience) {
          lastIsAudience = true;
          try { ffmEnsurePublishHint('You can now inspect the results and click Publish when ready. \n*Enable Auto Publishing to automate this step.'); } catch (e) {}
        } else if (!now && lastIsAudience) {
          lastIsAudience = false;
          try { const ex = document.getElementById('ffm-publish-hint'); if (ex) ex.remove(); } catch (e) {}
        }
      } catch (e) {}
    };

    try {
      const _push = history.pushState; history.pushState = function() { _push.apply(this, arguments); check(); };
      const _replace = history.replaceState; history.replaceState = function() { _replace.apply(this, arguments); check(); };
      window.addEventListener('popstate', check);
    } catch (e) {}

    try {
      const mo = new MutationObserver(() => { check(); });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) {}

    setTimeout(check, 600);
  } catch (e) { console.debug('initFfmAudienceWatcher error', e); }
})();

// Debug UI removed.

// Top-level helper to click the Next/Continue/Publish button. Simplified polling-based
// implementation that waits until the FB control becomes truly clickable.
async function clickNextButton(label = "Next") {
  try {
    const MAX_RETRIES = 10;
    const RETRY_DELAY = 400;

    function isClickable(el) {
      try {
        return el && el.offsetParent !== null && !el.closest('[aria-disabled="true"], [aria-hidden="true"]') && getComputedStyle(el).pointerEvents !== 'none';
      } catch (e) { return false; }
    }

    function getButton(label) {
      try {
        const lower = (label || '').toString().toLowerCase();
        return Array.from(document.querySelectorAll('button, [role="button"], [aria-label]'))
          .find(el => {
            try {
              const t = (el.textContent || el.value || el.getAttribute('aria-label') || '').toString().toLowerCase();
              return t.includes(lower);
            } catch (e) { return false; }
          });
      } catch (e) { return null; }
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const el = getButton(label);
        if (isClickable(el)) {
          try {
            const rect = el.getBoundingClientRect();
            const evtOpts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + 3, clientY: rect.y + 3 };
            ["mouseover", "mousedown", "mouseup", "click"].forEach(ev => el.dispatchEvent(new MouseEvent(ev, evtOpts)));
            console.debug(`clickNextButton: ✅ Clicked "${label}" on attempt ${attempt + 1}`, el);
            return true;
          } catch (e) { console.debug('clickNextButton: dispatch click failed', e); }
        } else {
          console.debug(`clickNextButton: ⏳ Waiting for ${label} button to become clickable... attempt ${attempt + 1}`);
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
      } catch (e) { /* ignore per-attempt errors */ }
    }

    console.debug(`clickNextButton: ❌ "${label}" never became clickable.`);
    return false;
  } catch (err) { console.debug('clickNextButton error', err); return false; }
}

// Debug overlay: visualize Next-button candidates and allow user to click markers to test
try {
  window.ffm_current_next_overlay = null;
  window.ffm_clear_next_overlay = function() {
    try {
      if (window.ffm_current_next_overlay) {
        window.ffm_current_next_overlay.remove();
        window.ffm_current_next_overlay = null;
      }
    } catch (e) { console.debug('ffm_clear_next_overlay error', e); }
  };

  window.ffm_show_next_overlay = async function() {
    try {
      window.ffm_clear_next_overlay();
      const overlay = document.createElement('div');
      overlay.id = 'ffm-next-overlay';
      overlay.style.position = 'absolute';
      overlay.style.left = '0px'; overlay.style.top = '0px'; overlay.style.width = '100%'; overlay.style.height = '100%';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '2147483647';

  const allCandidates = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], span, div')).filter(n => n && ((n.textContent || n.value || '') || (n.getAttribute && n.getAttribute('aria-label') || '')));
  const candidates = allCandidates.filter(n => n.offsetParent !== null);
  const hiddenCandidates = allCandidates.filter(n => n.offsetParent === null);
      let idx = 0;
      for (const c of candidates) {
        try {
          const txt = ((c.textContent || '') + ' ' + (c.value || '') + ' ' + (c.getAttribute && c.getAttribute('aria-label') || '')).toString().toLowerCase().trim();
          if (!txt) continue;
          // candidate if it looks like a Next/Continue/Publish control
          if (!(/\b(next|continue|publish|post|done|save & continue|save and continue)\b/.test(txt))) continue;
          const r = c.getBoundingClientRect();
          if (!r || r.width === 0 || r.height === 0) continue;
          idx++;
          const marker = document.createElement('div');
          marker.className = 'ffm-next-marker';
          marker.style.position = 'absolute';
          marker.style.left = (window.scrollX + r.left) + 'px';
          marker.style.top = (window.scrollY + r.top) + 'px';
          marker.style.width = Math.max(30, r.width) + 'px';
          marker.style.height = Math.max(24, r.height) + 'px';
          marker.style.border = '3px dashed rgba(255,80,0,0.95)';
          marker.style.background = 'rgba(255,120,60,0.08)';
          marker.style.boxSizing = 'border-box';
          marker.style.pointerEvents = 'auto';
          marker.style.zIndex = '2147483648';
          marker.style.cursor = 'pointer';

          const label = document.createElement('div');
          label.textContent = String(idx);
          label.style.position = 'absolute';
          label.style.right = '4px';
          label.style.top = '4px';
          label.style.fontSize = '12px';
          label.style.background = 'rgba(255,80,0,0.95)';
          label.style.color = '#fff';
          label.style.padding = '2px 6px';
          label.style.borderRadius = '12px';
          label.style.zIndex = '2147483649';

          marker.appendChild(label);

          // show short tooltip text on hover
          marker.title = (c.getAttribute && c.getAttribute('aria-label')) || (c.textContent || '').toString().trim().slice(0,200);

          // click handler: attempt to activate the underlying candidate and log
          marker.addEventListener('click', async (ev) => {
            try {
              ev.stopPropagation(); ev.preventDefault();
              try { c.scrollIntoView({ block: 'center' }); } catch (e) {}
              // try the robust click helper if available
              try { try { ffmShowMarkerAt(c); } catch (e) {} await ffmTryHardClick(c); } catch (e) { try { c.click(); } catch (e2) { try { c.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e3) {} } }
              console.debug('ffm: overlay clicked marker for candidate', idx, c, { text: (c.textContent||'').toString().slice(0,200), aria: c.getAttribute && c.getAttribute('aria-label') });
            } catch (e) { console.debug('ffm: overlay marker click error', e); }
          }, true);

          overlay.appendChild(marker);
        } catch (e) { /* continue */ }
      }

      if (!idx) {
        // If no visible markers found, also show counts of hidden candidates for guidance
        if (hiddenCandidates && hiddenCandidates.length) {
          const noteHidden = document.createElement('div');
          noteHidden.textContent = `FFM: ${hiddenCandidates.length} hidden candidates found (inspect DOM)`;
          noteHidden.style.position = 'fixed'; noteHidden.style.left = '8px'; noteHidden.style.bottom = '36px'; noteHidden.style.zIndex = '2147483648'; noteHidden.style.background = 'rgba(0,0,0,0.6)'; noteHidden.style.color = '#fff'; noteHidden.style.padding = '6px 10px'; noteHidden.style.borderRadius = '6px';
          overlay.appendChild(noteHidden);
        }
        const note = document.createElement('div');
        note.textContent = 'FFM: No visible Next candidates found';
        note.style.position = 'fixed'; note.style.left = '8px'; note.style.bottom = '8px'; note.style.zIndex = '2147483648'; note.style.background = 'rgba(0,0,0,0.6)'; note.style.color = '#fff'; note.style.padding = '6px 10px'; note.style.borderRadius = '6px';
        overlay.appendChild(note);
      }

      // Render markers for hidden candidates as semi-transparent outlines near the top, clickable to reveal
      if (hiddenCandidates && hiddenCandidates.length) {
        let hIdx = 0;
        for (const hc of hiddenCandidates.slice(0,30)) {
          try {
            hIdx++;
            const marker = document.createElement('div');
            marker.className = 'ffm-next-marker-hidden';
            marker.style.position = 'fixed';
            marker.style.right = '12px';
            marker.style.top = (12 + (hIdx-1) * 28) + 'px';
            marker.style.width = '220px';
            marker.style.height = '22px';
            marker.style.border = '2px dashed rgba(200,200,0,0.9)';
            marker.style.background = 'rgba(200,200,0,0.06)';
            marker.style.boxSizing = 'border-box';
            marker.style.pointerEvents = 'auto';
            marker.style.zIndex = '2147483648';
            marker.style.cursor = 'pointer';
            const label = document.createElement('div'); label.textContent = `hidden ${hIdx}`; label.style.fontSize='12px'; label.style.padding='2px 6px'; label.style.color='#222'; marker.appendChild(label);
            marker.title = (hc.getAttribute && hc.getAttribute('aria-label')) || (hc.textContent || '').toString().trim().slice(0,200);
            marker.addEventListener('click', async (ev) => {
              try { ev.preventDefault(); ev.stopPropagation(); try { hc.scrollIntoView({ block:'center' }); } catch(e){}; await sleep(120); try { try { ffmShowMarkerAt(hc); } catch (e) {} await ffmTryHardClick(hc); } catch(e) { try { hc.click(); } catch(e2){} } console.debug('ffm: clicked hidden candidate', hc); } catch(e) { console.debug('ffm hidden click failed', e); }
            }, true);
            overlay.appendChild(marker);
          } catch (e) {}
        }
      }

      document.documentElement.appendChild(overlay);
      window.ffm_current_next_overlay = overlay;
      console.debug('ffm: next overlay placed; markers:', idx);
      return true;
    } catch (e) { console.debug('ffm_show_next_overlay error', e); return false; }
  };

  window.ffm_toggle_next_overlay = function() { try { if (window.ffm_current_next_overlay) { window.ffm_clear_next_overlay(); return false; } else { window.ffm_show_next_overlay(); return true; } } catch (e) { console.debug('ffm_toggle_next_overlay error', e); return false; } };

  // Allow popup/background to toggle overlay via message
  try {
    chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((m,s,sendResponse) => {
      try {
        if (!m || !m.action) return;
        if (m.action === 'ffm_toggle_next_overlay') {
          try { const on = window.ffm_toggle_next_overlay(); try { sendResponse && sendResponse({ ok: true, on }); } catch(e){} }
          catch(e){ try{ sendResponse && sendResponse({ ok:false }); }catch(e2){} }
          return true;
        }
      } catch (e) {}
    });
  } catch (e) {}
} catch (e) { console.debug('ffm overlay init error', e); }

// (Removed) forceToggleElement: Hide-From-Friends control toggling was brittle across FB UIs and
// frequently targeted Boost/Promote buttons. That code was removed in favor of a deterministic
// keyboard-based flow (Tab × N then Space) invoked after Comfort Level selection.

// Early listener: cache incoming populate payloads so we always have a
// last-known listing object available (window.ffmCurrentListing).
try {
  chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (!msg || !msg.action) return;
      if (msg.action === 'populate-fb' && (msg.payload && msg.payload.listing || msg.listing)) {
        const listing = (msg.payload && msg.payload.listing) ? msg.payload.listing : msg.listing;
        try { window.ffmCurrentListing = listing; } catch (e) {}
        try { window.ffmPublishId = (msg.payload && msg.payload.publishRequestId) ? msg.payload.publishRequestId : (msg.publishRequestId || window.ffmPublishId || window.ffm_staged_publish_request_id || null); } catch (e) {}
        // Cached current listing log removed (cleanup)
      }
    } catch (e) {}
  });
} catch (e) {}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try { if (window && window.ffm_debug) console.debug && console.debug('FFM-TRACE: runtime.onMessage received', message && message.action); } catch (e) {}
  if (!message || !message.action) return;
  // Capture staged media buffers delivered by background (images as ArrayBuffers, videos as passthrough descriptors)
  if (message.action === 'ffm-media-buffers') {
    try {
      window.ffm_staged_media_buffers = {
        images: Array.isArray(message.images) ? message.images : [],
        videos: Array.isArray(message.videos) ? message.videos : [],
      };
    } catch (e) {
      console.warn('[content] failed to cache staged media buffers', e);
    }
    try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
    return true;
  }
  // If we get a small trigger, rewrite the message to the normal populate form and fall through
  if (message.action === 'populate-fb-trigger') {
    try {
      const listing = (window && window.ffm_staged_publish_listing) ? window.ffm_staged_publish_listing : null;
      if (!listing) { console.warn('populate-fb-trigger received but no staged listing found'); return; }
        // Reset staged listing
        try { window.ffm_staged_publish_listing = null; } catch (e) {}
        message.action = 'populate-fb';
        message.listing = listing;

        // ----- Fast4MP: Option A (Scheduler Detected - NO AUTO-PUBLISH) -----
        try {
          if (message.scheduleTaskId || window.ffm_is_scheduled_publish === true) {
            try { console.log('[Fast4MP content] Scheduler detected → not forcing auto-publish'); } catch (e) {}
            // Preserve an identifier that this populate originated from a schedule
            try { if (!window.ffmCurrentPopulate) window.ffmCurrentPopulate = {}; } catch (e) {}
            try { window.ffmCurrentPopulate.scheduleTaskId = message.scheduleTaskId || window.ffmCurrentPopulate.scheduleTaskId || true; } catch (e) {}
          }
        } catch (err) { console.debug('[Fast4MP content] scheduler detection noop failed', err); }
      // do not return; let execution continue into the populate-fb block below
    } catch (e) { console.debug('populate-fb-trigger handler error', e); }
  }
  // New: resolve publish payloads sent by id to avoid message size limits
  if (message.action === 'populate-fb' && message.publishRequestId && !message.listing) {
    try {
      // Record the autoPublish flag early so the page automation knows the intent
      try {
        // Accept multiple possible key names for auto-publish (background may send autoPublish, auto, or menuAuto)
        try {
          // Precedence: persistent menu hint -> menu hint -> explicit autoPublish/auto
          const rawMenuPersist = (typeof message.menuAutoPersistent !== 'undefined') ? message.menuAutoPersistent : undefined;
          const rawMenu = (typeof message.menuAuto !== 'undefined') ? message.menuAuto : undefined;
          const rawAuto = (typeof message.autoPublish !== 'undefined') ? message.autoPublish : (typeof message.auto !== 'undefined') ? message.auto : undefined;
          const inferredMenuPersist = (typeof rawMenuPersist !== 'undefined') ? normalizeAutoFlag(rawMenuPersist) : false;
          const inferredMenu = (typeof rawMenu !== 'undefined') ? normalizeAutoFlag(rawMenu) : false;
          const inferredAuto = (typeof rawAuto !== 'undefined') ? normalizeAutoFlag(rawAuto) : false;
          // Only set allow->true when any message indicates permission. Do not clear an existing true flag.
          const computedAllow = !!(inferredMenuPersist || inferredMenu || inferredAuto);
          if (computedAllow) window.ffm_allow_auto_publish = true;
          try { console.debug('populate-fb (id-only): autoPublish inferred', { publishRequestId: message.publishRequestId || null, autoPublish: !!window.ffm_allow_auto_publish, computedAllow, raw: { menuAutoPersistent: rawMenuPersist, menuAuto: rawMenu, autoPublish: rawAuto } }); } catch(e){}
          // ================================================================
          // FAST4MP PATCH: SCHEDULED PUBLISH DETECTED (id-only branch) — NO AUTO-PUBLISH
          // ================================================================
          try {
            if ((message && message.scheduleTaskId) || (window && window.ffmCurrentPopulate && window.ffmCurrentPopulate.scheduleTaskId) || (window && window.ffm_staged_publish_request_id)) {
              try { console.log('[Fast4MP] Scheduled Publish detected (id-only) — not forcing auto-publish'); } catch (e) {}
              try { if (!window.ffmCurrentPopulate) window.ffmCurrentPopulate = {}; } catch (e) {}
              try { window.ffmCurrentPopulate.scheduleTaskId = message.scheduleTaskId || window.ffmCurrentPopulate.scheduleTaskId || true; } catch (e) {}
            }
          } catch (e) { console.debug('[Fast4MP] scheduled id-only detection noop failed', e); }
        } catch (e) { /* leave existing flag as-is */ }
      } catch (e) {}
      // Only the top-level frame should consume the staged publish payload.
      // FB pages often contain multiple frames; if every frame attempts to read
      // and remove the staged storage key, the first will succeed and others
      // will warn with 'staged listing not found'. Skip subframes to avoid that race.
      try { if (window && window.top && window !== window.top) { console.debug('populate-fb: skipping subframe consumption'); return; } } catch (e) {}
      const key = 'ffm_publish_' + message.publishRequestId;
      // Try a few times with small backoff to avoid transient races between staging and tab messaging
      const attempts = 6;
      const delayMs = 300;
      let tried = 0;
      const tryFetch = () => {
        try {
          chrome.storage.local.get([key], (res) => {
            try {
              tried++;
              const listing = res && res[key];
                if (listing) {
                try { chrome.storage.local.remove([key]); } catch (e) {}
                try { window.ffm_staged_publish_listing = listing; } catch (e) {}
                try { window.ffm_staged_publish_request_id = message.publishRequestId; } catch (e) {}
                try {
                  // Publish-trace: inform background that content successfully read the staged listing
                  try { ffmSendMessage({ action: 'publish-trace', publishRequestId: message.publishRequestId, event: 'content-read-staged' }); } catch (e) {}
                } catch (e) {}
                try { ffmSendMessage({ action: 'populate-fb-ready' }); } catch (e) { console.debug('populate-fb ready notify failed', e); }
                // If the stored listing indicates large data was stripped, request transient media attach
                try {
                  if (listing && listing.__ffm_stripped) {
                    try { ffmSendMessage({ action: 'fetch-transient-media', publishRequestId: message.publishRequestId, inventoryName: listing.inventoryName, maxImages: 10, videos: false }); } catch (e) {}
                  }
                } catch (e) {}
                // If background included an ack token, write it so background knows content received the populate message
                try {
                  if (message._ackToken) {
                    const ackKey = 'ffm_populate_ack_' + message._ackToken;
                    try { chrome.storage.local.set({ [ackKey]: true }, () => {}); } catch (e) {}
                    // Clean up ack shortly after so storage doesn't grow
                    setTimeout(() => { try { chrome.storage.local.remove([ackKey]); } catch (e) {} }, 5000);
                  }
                } catch (e) {}
                return;
              }
              if (tried < attempts) {
                setTimeout(tryFetch, delayMs);
                return;
              }
              // Final attempt failed — warn once per publishRequestId to avoid noisy repeats
              try {
                if (!window.__ffm_warned_missing_ids) window.__ffm_warned_missing_ids = new Set();
                if (!window.__ffm_warned_missing_ids.has(message.publishRequestId)) {
                  window.__ffm_warned_missing_ids.add(message.publishRequestId);
                  // Downgrade to debug to avoid visible warning spam; background still receives a diagnostic message
                  console.debug('populate-fb: staged listing not found for id (muted)', message.publishRequestId);
                  try { ffmSendMessage({ action: 'populate-missing', publishRequestId: message.publishRequestId }); } catch (e) {}
                } else {
                  // already warned for this id; suppress duplicate warning
                  if (window && window.ffm_debug) console.debug('populate-fb: suppressed duplicate missing warning for id', message.publishRequestId);
                }
              } catch (e) { console.warn('populate-fb: staged listing not found for id', message.publishRequestId); }
            } catch (e) { console.debug('populate-fb staged fetch error', e); }
          });
        } catch (e) { console.debug('populate-fb id handler error', e); }
      };
      tryFetch();
    } catch (e) { console.debug('populate-fb id outer error', e); }
    return true;
  }
  // Panel/pin functionality has been removed. Ignore toggle-panel and pin messages.
  if (message.action === 'toggle-panel') {
    // no-op: panel feature removed
    try { sendResponse && sendResponse({ toggled: false, reason: 'panel-removed' }); } catch (e) {}
    return;
  }
  if (message.action === 'set-pin-top') {
    // no-op: pin feature removed
    try { sendResponse && sendResponse({ ok: false, reason: 'pin-removed' }); } catch (e) {}
    return;
  }
  // Populate Facebook Marketplace create page with listing data
  if (message.action === 'populate-fb' && message.listing) {
  try { if (window && window.ffm_debug) console.debug && console.debug('FFM-TRACE: populate-fb handler entry, publishRequestId=' + (message.publishRequestId || 'null')); } catch (e) {}
    // Temporary emergency kill-switch: if set, do not run the populate/publish automation.
    // You can toggle this at runtime from the page console: window.ffm_disable_publish = false/true
    try {
      if (window && window.ffm_disable_publish) {
        console.warn('populate-fb received but ffm_disable_publish is set; skipping automated populate/publish');
        try { sendResponse && sendResponse({ disabled: true }); } catch (e) {}
        return true; // indicate we'll respond asynchronously (we already sent a sync response)
      }
    } catch (e) { console.debug('ffm_disable_publish check failed', e); }
  const listing = message.listing;

    // NEW: cache any mediaBuffers that background attached to the populate message
    try {
      if (message.mediaBuffers) {
        window.ffm_staged_media_buffers = {
          images: Array.isArray(message.mediaBuffers.images) ? message.mediaBuffers.images : [],
          videos: Array.isArray(message.mediaBuffers.videos) ? message.mediaBuffers.videos : [],
        };
      }
    } catch (e) {
      console.warn('[content] failed to cache mediaBuffers from populate-fb', e);
    }
  // Cache delivery prefs in-memory early so later steps can read them without storage access/races
  try {
    window.ffmCachedDeliveryPrefs = {
      publicMeetup: !!listing.publicMeetup,
      doorPickup:   !!listing.doorPickup,
      doorDropoff:  !!listing.doorDropoff
    };
    try { console.debug('populate-fb: cached delivery prefs on window.ffmCachedDeliveryPrefs', window.ffmCachedDeliveryPrefs); } catch (e) {}
  } catch (e) { console.debug('populate-fb: failed to cache delivery prefs', e); }
  // Honor autoPublish flag for this populate action. Default false (manual publish required).
  try {
    try {
      // Precedence: persistent menu hint -> menu hint -> explicit autoPublish/auto
      const rawMenuPersist2 = (typeof message.menuAutoPersistent !== 'undefined') ? message.menuAutoPersistent : undefined;
      const rawMenu2 = (typeof message.menuAuto !== 'undefined') ? message.menuAuto : undefined;
      const rawAuto2 = (typeof message.autoPublish !== 'undefined') ? message.autoPublish : (typeof message.auto !== 'undefined') ? message.auto : undefined;
      const inferredMenuPersist2 = (typeof rawMenuPersist2 !== 'undefined') ? normalizeAutoFlag(rawMenuPersist2) : false;
      const inferredMenu2 = (typeof rawMenu2 !== 'undefined') ? normalizeAutoFlag(rawMenu2) : false;
      const inferredAuto2 = (typeof rawAuto2 !== 'undefined') ? normalizeAutoFlag(rawAuto2) : false;
      const computedAllow2 = !!(inferredMenuPersist2 || inferredMenu2 || inferredAuto2);
      if (computedAllow2) window.ffm_allow_auto_publish = true;
      try { console.debug('populate-fb: autoPublish inferred', { publishRequestId: message.publishRequestId || null, autoPublish: !!window.ffm_allow_auto_publish, computedAllow: computedAllow2, raw: { menuAutoPersistent: rawMenuPersist2, menuAuto: rawMenu2, autoPublish: rawAuto2 } }); } catch (e) {}
    } catch (e) { /* leave existing flag as-is */ }
  } catch (e) {}
  // --- FAST4MP PATCH: Scheduled tasks ALWAYS auto-publish ---
  try {
    // If this populate request came from a scheduled background task, force auto-publish on.
    if ((message && message.scheduleTaskId) || (window && window.ffmCurrentPopulate && window.ffmCurrentPopulate.scheduleTaskId) || (window && window.ffm_staged_publish_request_id)) {
      try { console.log("[Fast4MP] Scheduled publish detected — forcing autoPublish = true (main branch)"); } catch (e) {}
      try { window.ffm_allow_auto_publish = true; } catch (e) {}
      // Also attempt to override any local variable named `allowAutoPublish` if the populate logic created one earlier.
      try { allowAutoPublish = true; } catch (e) {}
    }
  } catch (e) {}
  // If background included an ack token, write it so background knows content received the populate message
  try {
    if (message._ackToken) {
      const ackKey = 'ffm_populate_ack_' + message._ackToken;
      try { chrome.storage.local.set({ [ackKey]: true }, () => {}); } catch (e) {}
      // Clean up ack shortly after so storage doesn't grow
      setTimeout(() => { try { chrome.storage.local.remove([ackKey]); } catch (e) {} }, 5000);
    }
  } catch (e) {}
    // Additional defensive cleanup right before automation starts.
    // This ensures any leftover injected panel/iframe/styles are removed and
    // the panel-injection flag is set so we don't re-insert UI that can
    // shrink or reflow Facebook's layout when populating the form.
    try {
      const href = (window && window.location && window.location.href) ? window.location.href : '';
      if (/facebook\.com/.test(href)) {
        try {
          const ids = ['extension-pin-panel', 'ffm-pin-iframe', 'ffm-debug-overlay', 'ffm-hide-confirm-overlay'];
          ids.forEach(id => { try { const el = document.getElementById(id); if (el && el.parentElement) el.parentElement.removeChild(el); } catch (e) {} });
        } catch (e) {}

        try {
          const q = Array.from(document.querySelectorAll('[id^="ffm-"], [class*="ffm-"]'));
          q.forEach(el => { try { if (el && el.parentElement) el.parentElement.removeChild(el); } catch (e) {} });
        } catch (e) {}

        try {
          const popupUrl = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('popup.html') : null;
          const iframes = Array.from(document.querySelectorAll('iframe'));
          for (const f of iframes) {
            try { if (f && f.src && popupUrl && f.src.indexOf(popupUrl) !== -1) { f.parentElement && f.parentElement.removeChild(f); } } catch (e) {}
          }
        } catch (e) {}

        try {
          const styles = Array.from(document.querySelectorAll('style'));
          for (const s of styles) {
            try { if (s && s.innerText && /ffm|ffm-|extension-pin|extension-pin-panel/.test(s.innerText)) { s.parentElement && s.parentElement.removeChild(s); } } catch (e) {}
          }
        } catch (e) {}

        try {
          const props = ['width','maxWidth','minWidth','marginLeft','marginRight','transform','position','left','right','top','bottom'];
          props.forEach(p => {
            try { if (document.documentElement && document.documentElement.style) document.documentElement.style[p] = ''; } catch (e) {}
            try { if (document.body && document.body.style) document.body.style[p] = ''; } catch (e) {}
          });
        } catch (e) {}

        try { window.ffm_panel_disabled = true; } catch (e) {}
      }
    } catch (e) { console.debug('populate-fb defensive cleanup failed', e); }
    try {
      const url = window.location.href;
      if (!/facebook\.com\/marketplace\/create\/item/.test(url)) return;

      // small helper to pause
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

      // humanized click helper to avoid rapid-fire synthetic clicks that trigger bot detection.
      // Usage: await humanClick(element)
      const ffm_randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

      // Note: humanClick was removed per full revert (Option A). Replaced usages perform a best-effort direct click
      // and fall back to dispatching a MouseEvent or Event where appropriate. ffm_randInt is retained for timing uses.

  // Attempt to set the title in likely inputs
  const setTitle = (text) => {
        const norm = (s) => (s || '').toString().trim().toLowerCase();

        // 1) Try label-based lookup: find elements containing the word 'title' and search nearby for inputs
        const labelCandidates = Array.from(document.querySelectorAll('span, label, div')).filter(el => {
          try { return norm(el.textContent) === 'title' || /\btitle\b/.test(norm(el.textContent)); } catch (e) { return false; }
        });
        for (const labelEl of labelCandidates) {
          // Search up to a few ancestor levels for a container with an input/textarea
          let node = labelEl;
          for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
            const input = node.querySelector('input, textarea');
            if (input) { input.focus(); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); return true; }
          }
          // search siblings
          const siblingInput = labelEl.parentElement && labelEl.parentElement.querySelector('input, textarea');
          if (siblingInput) { siblingInput.focus(); siblingInput.value = text; siblingInput.dispatchEvent(new Event('input', { bubbles: true })); return true; }
        }

        // Attempt to click a 'Next' / 'Continue' / 'Done' button to advance the publish flow
        async function clickNextButton() {
          try { if (window && window.ffm_debug) console.debug && console.debug('FFM-TRACE: clickNextButton start'); } catch (e) {}
          try {
            const key = 'ffm_next_button';
            // Try cached selector first
            try {
              const map = await ffmGetSelectorMap();
              const cached = map && map[key];
              if (cached) {
                const el = document.querySelector(cached);
                if (el && el.offsetParent !== null) { try { el.click(); return true; } catch (e) { try { el.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} } }
              }
            } catch (e) { console.debug('clickNextButton: selector cache read error', e); }

            // Strong fallback: if an element with aria-label="Publish" exists and auto-publish is allowed, click it directly
            try {
              if (window.ffm_allow_auto_publish) {
                const pub = document.querySelector('[aria-label="Publish"]');
                try { console.debug('clickNextButton: direct Publish check', { exists: !!pub, visible: !!(pub && pub.offsetParent !== null) }); } catch (e) {}
                if (pub && pub.offsetParent !== null) {
                  try {
                    if ((window.ffm_is_scheduled_publish === true) || (window.ffmForceSchedulerAutoPublish === true)) {
                      try { console.log('[Fast4MP content] Scheduler override: clicking Publish button now'); } catch (e) {}
                    }
                    pub.click(); console.debug('clickNextButton: clicked direct aria-label Publish'); return true;
                  } catch (e) {
                    try { pub.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) { console.debug('clickNextButton: failed to dispatch to Publish', e2); }
                  }
                }
              }
            } catch (e) {}

            // Search heuristics: visible buttons with common next texts
            const texts = ['next', 'continue', 'done', 'publish', 'post', 'save & continue', 'save and continue', 'next step', 'continue to checkout'];
            const isBad = (txt) => { try { const t = (txt||'').toLowerCase(); return t.includes('boost') || t.includes('promote') || t.includes('ad') || t.includes('sponsored'); } catch (e) { return false; } };

            // collect candidate buttons/controls
            const candidates = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], [aria-label]')).filter(n => n && n.offsetParent !== null && (n.textContent || n.value || n.getAttribute('aria-label')));
            // debug overlay call removed

            // quick pass: find elements whose aria-label exactly equals 'Next' (case-insensitive)
            try {
              const ariaNext = Array.from(document.querySelectorAll('[aria-label]')).find(el => (el.getAttribute('aria-label')||'').trim().toLowerCase() === 'next' && el.offsetParent !== null && !isBad(el.textContent || el.getAttribute('aria-label')));
              if (ariaNext) { try { ariaNext.click(); console.debug('clickNextButton: clicked aria-label Next'); const sel = computeCss && computeCss(ariaNext) || (ariaNext.id ? `#${ariaNext.id}` : null); if (sel) { const map = await ffmGetSelectorMap(); map[key] = sel; await ffmSetSelectorMap(map); } return true; } catch (e) { try { ariaNext.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} } }
            } catch (e) {}

            // computeCss helper (local) in case global isn't available
            const computeCssLocal = (el) => {
              try {
                if (!el) return null;
                if (el.id) return `#${el.id}`;
                const parts = [];
                let node = el;
                while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
                  let part = node.tagName.toLowerCase();
                  if (node.className && typeof node.className === 'string') {
                    const cls = node.className.trim().split(/\s+/).filter(Boolean);
                    if (cls.length) part += '.' + cls.slice(0,3).join('.');
                  }
                  try {
                    const parent = node.parentElement;
                    if (parent) {
                      const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
                      if (siblings.length > 1) {
                        const idx = siblings.indexOf(node) + 1;
                        part += `:nth-child(${idx})`;
                      }
                    }
                  } catch (e) {}
                  parts.unshift(part);
                  node = node.parentElement;
                }
                return parts.join(' > ');
              } catch (e) { return null; }
            };
            for (const c of candidates) {
              try {
                const txt = ((c.textContent || '') + ' ' + (c.value || '') + ' ' + (c.getAttribute && c.getAttribute('aria-label') || '')).toLowerCase().trim();
                if (!txt) continue;
                if (isBad(txt)) continue;
                for (const t of texts) {
                  // Do not auto-press final publish/post unless allowed by the autoPublish flag
                  try {
                    const lowt = (t||'').toLowerCase();
                    if ((lowt === 'publish' || lowt === 'post') && !window.ffm_allow_auto_publish) {
                      // skip publish/post candidates when auto-publish is not enabled for this flow
                      continue;
                    }
                  } catch (e) {}
                    if (txt.includes(t)) {
                    try { 
                      c.click(); 
                      console.debug('clickNextButton: clicked candidate by text', t, c);
                      // cache selector for future runs
                      try { const sel = (typeof computeCss === 'function' ? computeCss(c) : computeCssLocal(c)) || (c.id ? `#${c.id}` : null); if (sel) { const map = await ffmGetSelectorMap(); map[key] = sel; await ffmSetSelectorMap(map); } } catch (e) {}
                      // If we clicked a Publish/Post button and auto-publish is allowed, start publish-complete watcher
                      try {
                        const lowt = (t||'').toLowerCase();
                        if ((lowt === 'publish' || lowt === 'post') && window.ffm_allow_auto_publish) {
                          const pubId = window.ffm_staged_publish_request_id || null;
                          const inv = (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) ? window.ffm_staged_publish_listing.inventoryName : null;
                          (async function watchPublishComplete(publishRequestId, inventoryName) {
                            try {
                              const max = 20; let attempt = 0;
                              const startUrl = window.location.href || '';
                              while (attempt < max) {
                                await new Promise(r=>setTimeout(r, 1000));
                                attempt++;
                                try {
                                  const url = window.location.href || '';
                                  const body = (document && document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
                                  // Heuristics: URL changed away from create page, or we detect a success message
                                  if (!/facebook\.com\/marketplace\/create\/item/.test(url) || body.indexOf('your listing has been posted') >= 0 || body.indexOf('your listing is live') >= 0 || body.indexOf('your listing has been published') >= 0) {
                                    try {
                                      // Guarantee publishRequestId included for SDNR
                                      if (!publishRequestId) {
                                        try { publishRequestId = window.__ffm_publishRequestId || null; } catch (e) {}
                                      }
                                      ffmSendMessage({ action: 'publish-complete', publishRequestId: publishRequestId, inventoryName: inventoryName, ok: true, when: Date.now() });
                                    } catch (e) {}
                                    break;
                                  }
                                } catch (e) {}
                              }
                            } catch (e) {}
                          })(pubId, inv);
                        }
                      } catch (e) {}
                      return true;
                    } catch (e) { try { c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} }
                  }
                }
              } catch (e) {}
            }

            // Last resort: try the last visible button in a footer-like area
              try {
              const foot = Array.from(document.querySelectorAll('footer, div')).filter(d => d && d.offsetParent !== null && /footer|actions|controls|buttons|modal|dialog/i.test(d.className || d.id || '') ).slice(-1)[0];
              if (foot) {
                const btn = Array.from(foot.querySelectorAll('button, [role="button"]')).find(b => b && b.offsetParent !== null);
                if (btn) { try { btn.click(); return true; } catch (e) { try { btn.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} } }
              }
            } catch (e) {}

            console.debug('clickNextButton: no candidate found');
            return false;
          } catch (err) { console.debug('clickNextButton error', err); return false; }
        }

        // 2) Try common selectors (placeholders, aria-labels)
        const selectors = [
          'input[placeholder*="Title"]',
          'input[aria-label*="Title"]',
          'input[name="title"]',
          'textarea[placeholder*="Title"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }
        }

        // 3) Fallback: use first input/textarea on the page
        const inputs = document.querySelectorAll('input, textarea');
        if (inputs && inputs.length > 0) {
          inputs[0].focus(); inputs[0].value = text; inputs[0].dispatchEvent(new Event('input', { bubbles: true })); return true;
        }
        return false;
      };

        // Attempt to set the description/long description in likely textareas
        const setDescription = (text) => {
          const norm = (s) => (s || '').toString().trim().toLowerCase();
          // 1) Try label-based lookup: find elements containing the word 'description' and search nearby for a textarea
          const labelCandidates = Array.from(document.querySelectorAll('span, label, div')).filter(el => {
            try { return norm(el.textContent).includes('description') || norm(el.textContent).includes('details') || norm(el.textContent).includes('big description'); } catch (e) { return false; }
          });
          for (const labelEl of labelCandidates) {
            // Search up to a few ancestor levels for a container with a textarea
            let node = labelEl;
            for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
              const ta = node.querySelector('textarea');
              if (ta) { ta.focus(); ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; }
            }
            // search siblings
            const siblingTA = labelEl.parentElement && labelEl.parentElement.querySelector('textarea');
            if (siblingTA) { siblingTA.focus(); siblingTA.value = text; siblingTA.dispatchEvent(new Event('input', { bubbles: true })); return true; }
          }

          // 2) Try common selectors
          const selectors = [
            'textarea[placeholder*="Description"]',
            'textarea[aria-label*="Description"]',
            'textarea[name="description"]',
            'textarea'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }
          }

          // 3) Fallback: nothing found
          return false;
        };

      // Attempt to set the price in likely inputs
      const setPrice = (val) => {
        const norm = (s) => (s || '').toString().trim().toLowerCase();
        // Look for labels containing 'price'
        const labelCandidates = Array.from(document.querySelectorAll('span, label, div')).filter(el => {
          try { return norm(el.textContent) === 'price' || /\bprice\b/.test(norm(el.textContent)); } catch (e) { return false; }
        });
        for (const labelEl of labelCandidates) {
          let node = labelEl;
          for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
            const input = node.querySelector('input, textarea');
            if (input) { input.focus(); input.value = val; input.dispatchEvent(new Event('input', { bubbles: true })); return true; }
          }
          const siblingInput = labelEl.parentElement && labelEl.parentElement.querySelector('input, textarea');
          if (siblingInput) { siblingInput.focus(); siblingInput.value = val; siblingInput.dispatchEvent(new Event('input', { bubbles: true })); return true; }
        }

        // Common selectors
        const selectors = [
          'input[placeholder*="Price"]',
          'input[aria-label*="Price"]',
          'input[name="price"]',
          'input[type="number"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { el.focus(); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }
        }

        // Fallback: first number input
        const numberInputs = Array.from(document.querySelectorAll('input')).filter(i => i.type === 'number' || /\d/.test(i.value));
        if (numberInputs.length > 0) { numberInputs[0].focus(); numberInputs[0].value = val; numberInputs[0].dispatchEvent(new Event('input', { bubbles: true })); return true; }
        return false;
      };

      // make setPriceWithRetry return a Promise that resolves when price set or timeout
      const setPriceWithRetry = (value) => {
        return new Promise((resolve) => {
          let attempts = 0;
          const maxAttempts = 16; // ~5 seconds at 300ms interval
          const trySet = () => {
            const ok = setPrice(value);
            if (ok) { resolve(true); return; }
            attempts++;
            if (attempts >= maxAttempts) { resolve(false); return; }
            setTimeout(trySet, 300);
          };
          trySet();
        });
      };

      // If the background attached a persistent menu hint, honor it immediately
      try {
        if (typeof message.menuAutoPersistent !== 'undefined') {
          if (message.menuAutoPersistent) {
            try { console.debug('populate-fb: granting auto-publish due to inline message.menuAutoPersistent'); } catch (e) {}
            window.ffm_allow_auto_publish = true;
          } else {
          // message.menuAutoPersistent debug logs removed
          }
        }
      } catch (e) {}

      (async () => {
        try {
        /////////////////////////////////////////
        // NEW — FB MEDIA ATTACH PIPELINE (final)
        /////////////////////////////////////////

        async function ffmGetRealFilesFromDB(listing) {
          try {
            const db =
              (typeof ffmMediaDB !== "undefined" && ffmMediaDB) ||
              window.ffmMediaDB ||
              null;

            if (!db) {
              console.warn("[content] MediaDB not available in frame");
              return [];
            }

            const listingKey = listing.listingId || listing.id;
            if (!listingKey) {
              console.warn("[content] No listingId/id found");
              return [];
            }

            // The only API your mediaDB exposes for lookup
            const media = await db.getBlobsForListing(listingKey);

            if (!media || !Array.isArray(media.images) || media.images.length === 0) {
              console.warn("[content] MediaDB: no images for", listingKey, media);
              return [];
            }

            const realFiles = [];

            for (let i = 0; i < media.images.length; i++) {
              const rec = media.images[i];
              if (!rec || !rec.blob) continue;

              const name =
                rec.name ||
                (rec.key ? rec.key.split("/").pop() : `image_${i}.jpg`);
              const mime =
                rec.mimeType ||
                (rec.blob && rec.blob.type) ||
                "image/jpeg";

              const file = new File([rec.blob], name, { type: mime });
              realFiles.push(file);
            }

            console.log(
              `[content] Reconstructed ${realFiles.length} FILE(s) from MediaDB for ${listingKey}`
            );

            return realFiles;

          } catch (e) {
            console.error("[content] ffmGetRealFilesFromDB error", e);
            return [];
          }
        }

        async function ffmAttachRealFilesToFacebookInput(listing) {
          try {
            // Wait for FB uploader input to appear
            let input = null;
            for (let t = 0; t < 20; t++) {
              input = (typeof ffmFindProperUploaderInput === 'function') ? ffmFindProperUploaderInput() : document.querySelector('input[type="file"]');
              if (input) break;
              await new Promise(res => setTimeout(res, 200));
            }
            if (!input) {
              console.error("[content] No file input found on FB create page");
              return;
            }

            // Get real Files from DB
            const files = await ffmGetRealFilesFromDB(listing);
            if (!files.length) {
              console.warn("[content] No real files returned from DB");
              return;
            }

            // Attach using DataTransfer (this ALWAYS works)
            const dt = new DataTransfer();
            for (const f of files) dt.items.add(f);

            await sleep(150);
            try {
              visibleInputFilesSetter(input, dt.files);
            } catch (e) {
              console.warn('[content] ffmAttachRealFilesToFacebookInput: visibleInputFilesSetter failed', e);
            }

            try {
              input.dispatchEvent(new Event("change", { bubbles: true }));
            } catch (e) {
              console.warn('[content] ffmAttachRealFilesToFacebookInput: dispatch change failed', e);
            }

            console.log("[content] Attached", files.length, "image(s) to FB uploader");

            // Give Facebook time to render thumbnails
            await new Promise(res => setTimeout(res, 1500));

          } catch (e) {
            console.error("[content] ffmAttachRealFilesToFacebookInput error", e);
          }
        }

        // --- Attach media: always rebuild from MediaDB (stable, separate image + video) ---
        try {
          // -----------------------------------------------------------
          // Correct ID lookup for MediaDB + Background Patch13
          // -----------------------------------------------------------
          const listingId =
            listing.listingId ||   // preferred ID (ffm_123...)
            listing.id ||          // fallback
            listing.inventoryName; // last fallback

          console.log("[Patch10] requesting media blobs from background for", listingId);

          const stagedFiles = await ffmGetStagedOrDBMedia(listingId);

          console.log('[content] Patch10: ffmGetStagedOrDBMedia ->', (stagedFiles && stagedFiles.length) || 0, 'items');

          // Small preload wait for FB hydration (replaces removed ffmWaitForFBPreload)
          await new Promise((resolve) => setTimeout(resolve, 400));

          // Stable attach helper: attach images to image input, videos to video input, no button clicks
          async function ffmAttachStagedMedia(stagedFiles) {
            console.log('[Fast4MP] ATTACH START — files:', stagedFiles.length);

            // Split into images vs videos
            const imageFiles = stagedFiles.filter(f => f && f.type && f.type.startsWith('image/'));
            const videoFiles = stagedFiles.filter(f => f && f.type && f.type.startsWith('video/'));

            // Grab all file inputs on the page
            const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            const imageInput = inputs.find(i => (i.accept || '').includes('image')) || null;
            const videoInput = inputs.find(i => (i.accept || '').includes('video')) || null;

            console.log('[Fast4MP] Inputs:', {
              count: inputs.length,
              imageInput: !!imageInput,
              videoInput: !!videoInput,
              imageAccept: imageInput && imageInput.accept,
              videoAccept: videoInput && videoInput.accept
            });

            if (!imageInput && !videoInput) {
              console.warn('[Fast4MP] ERROR — no uploader inputs found at all');
              return false;
            }

            // ---- IMAGES ----
            if (imageFiles.length && imageInput) {
              const dtImg = new DataTransfer();
              imageFiles.forEach(f => dtImg.items.add(f));
              console.log('[Fast4MP] Attaching IMAGES:', imageFiles.length);
              try { imageInput.files = dtImg.files; } catch (e) { try { await ffmInjectFilesIntoFacebookInput(imageInput, imageFiles); } catch (ie) { console.warn('[Fast4MP] injector errored', ie); } }
              try { imageInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
              console.log('[Fast4MP] IMAGE attach complete');
            } else if (imageFiles.length && !imageInput) {
              console.warn('[Fast4MP] WARNING — have images but no IMAGE uploader input');
            } else {
              console.log('[Fast4MP] No images in stagedFiles.');
            }

            // ---- VIDEO ----
            let hasVideo = false;
            if (videoFiles.length && videoInput) {
              const dtVid = new DataTransfer();
              videoFiles.forEach(f => dtVid.items.add(f));
              console.log('[Fast4MP] Attaching VIDEO files:', videoFiles.length);
              try { videoInput.files = dtVid.files; } catch (e) { try { await ffmInjectFilesIntoFacebookInput(videoInput, videoFiles); } catch (ie) { console.warn('[Fast4MP] injector errored', ie); } }
              try { videoInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
              hasVideo = true;
              console.log('[Fast4MP] VIDEO attach complete');
            } else if (videoFiles.length && !videoInput) {
              console.warn('[Fast4MP] WARNING — have videos but no VIDEO uploader input');
            } else {
              console.log('[Fast4MP] No videos in stagedFiles.');
            }

            return hasVideo;
          }

          // Do the attach, then wait for video preview *only if* we actually attached a video
          const hasVideo = await ffmAttachStagedMedia(stagedFiles || []);

          if (hasVideo) {
            console.log('[Fast4MP] Video detected → waiting for preview');
            // Pass the stagedFiles through so ffmWaitForVideoUpload can infer presence reliably
            await ffmWaitForVideoUpload(null, stagedFiles || []);
          } else {
            console.log('[Fast4MP] No video → skipping preview wait');
          }

        } catch (e) {
          console.warn('[content] populate-fb: staged media attach block failed', e);
        }

        // Build File objects from mediaBuffers (images only)
        // ------------------------------------------------------------
        // Patch Set 13 — Reliable video upload wait (up to 90s)
        async function ffmWaitForVideoUpload(uploaderInput, files) {
          console.log("[Fast4MP] ffmWaitForVideoUpload start");

          // ✅ If no videos exist, try to infer from passed `files`; if none passed,
          // inspect the DOM and any visible video inputs/preview to determine whether
          // we should wait. This covers callers that don't pass `files`.
          let hasVideo = false;
          try {
            if (Array.isArray(files)) {
              hasVideo = files.some(f => f && f.type && f.type.startsWith && f.type.startsWith("video/"));
            } else {
              // No files array provided — infer from DOM or uploader inputs
              try {
                const vidInput = (typeof ffmFindRealVideoInput === 'function') ? ffmFindRealVideoInput() : document.querySelector('input[type=file][accept*="video"]');
                if (vidInput && vidInput.files && vidInput.files.length > 0) hasVideo = true;
              } catch (e) {}
              // Also treat presence of a <video> element on page as indication of a video preview
              try {
                if (!hasVideo && document.querySelector('video')) hasVideo = true;
              } catch (e) {}
              // As a last resort, check window-staged media object if present
              try {
                if (!hasVideo && window && window.ffmStagedMedia) {
                  const keys = Object.keys(window.ffmStagedMedia || {});
                  for (const k of keys) {
                    const arr = window.ffmStagedMedia[k] || [];
                    if (Array.isArray(arr) && arr.some(x => x && x.type && (x.type||'').toString().startsWith('video/'))) { hasVideo = true; break; }
                  }
                }
              } catch (e) {}
            }
          } catch (e) { console.debug('[Fast4MP] ffmWaitForVideoUpload: hasVideo infer error', e); }

          if (!hasVideo) {
            console.log("[Fast4MP] ffmWaitForVideoUpload: no video files detected → skipping wait");
            return true;
          }

          // -------- Normal video-wait logic below --------
          // Wait up to 90s for video preview / uploader to indicate completion
          const maxWait = 90000; // 90s max
          const poll = 500;
          const start = Date.now();

          // Helper: look for progress-like indicators that suggest upload still in-flight
          const uploadInProgressSelectorCandidates = [
            '[aria-label*="Uploading"]',
            '[aria-label*="Processing"]',
            'div[role="progressbar"]',
            '.uploading',
            '.progress',
            '[data-testid*="upload"]'
          ];

          while (Date.now() - start < maxWait) {
            try {
              // 1) Look for a visible video preview element
              const preview = document.querySelector('[aria-label="Add video"] video, video');
              if (preview) {
                try {
                  // If the preview has a blob URL source, or duration/readyState indicates it's ready,
                  // consider the upload/processing complete enough to continue.
                  const src = (preview.currentSrc || preview.src || '').toString();
                  const ready = Number(preview.readyState || 0);
                  const dur = Number(preview.duration || 0) || 0;
                  if (src.indexOf('blob:') === 0 || src.indexOf('data:') === 0 || ready >= 3 || (dur > 0 && !isNaN(dur))) {
                    console.log("[Fast4MP] ffmWaitForVideoUpload: preview ready (src/readyState/duration)", { srcPresent: !!src, readyState: ready, duration: dur });
                    return true;
                  }
                  // Otherwise, there is a preview element but it isn't ready yet — continue waiting
                  console.log('[Fast4MP] ffmWaitForVideoUpload: preview present but not ready', { readyState: ready, duration: dur });
                } catch (e) { /* ignore per-iteration errors */ }
              }

              // 2) If a visible file input exists and contains files, assume FB accepted the files
              try {
                const vidInput = (typeof ffmFindRealVideoInput === 'function') ? ffmFindRealVideoInput() : document.querySelector('input[type=file][accept*="video"]');
                if (vidInput && vidInput.files && vidInput.files.length > 0) {
                  console.log('[Fast4MP] ffmWaitForVideoUpload: video input has file(s) attached', { count: vidInput.files.length });
                  // If preview is not present yet, give a short extra moment for FB to render it
                  await new Promise(r => setTimeout(r, 600));
                  // Re-check for preview quickly
                  const preview2 = document.querySelector('[aria-label="Add video"] video, video');
                  if (preview2) { console.log('[Fast4MP] ffmWaitForVideoUpload: preview appeared after input attach'); return true; }
                }
              } catch (e) { /* ignore */ }

              // 3) If there are obvious upload/progress indicators present, keep waiting
              try {
                const prog = uploadInProgressSelectorCandidates.some(sel => {
                  try {
                    const el = document.querySelector(sel);
                    return !!(el && el.offsetParent !== null);
                  } catch (e) { return false; }
                });
                if (prog) {
                  // still uploading/processing
                  // console.log('[Fast4MP] ffmWaitForVideoUpload: upload in progress indicator present');
                  await new Promise(r => setTimeout(r, poll));
                  continue;
                }
              } catch (e) { /* ignore */ }

            } catch (e) {
              // swallow per-iteration errors and continue polling until timeout
              console.debug('[Fast4MP] ffmWaitForVideoUpload: iteration error', e);
            }

            await new Promise(r => setTimeout(r, poll));
          }

          console.warn("[Fast4MP] ffmWaitForVideoUpload: TIMEOUT — continuing after", (Date.now() - start), "ms");
          return false;
        }
        async function ffmBuildFilesFromMediaBuffers(buffers) {
          try {
            if (!buffers) return [];
            const files = [];
            if (Array.isArray(buffers.images)) {
              for (const img of buffers.images) {
                try {
                  const raw = img.buffer || img.arrayBuffer || img.data || null;
                  if (!raw) continue;
                  const view = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
                  const name = img.name || 'image.jpg';
                  const mime = img.mimeType || img.type || 'image/jpeg';
                  const file = new File([view], name, { type: mime });
                  files.push(file);
                } catch (e) {
                  console.warn('[content] failed to rebuild image File from mediaBuffers', e);
                }
              }
            }
            return files;
          } catch (e) { console.warn('[content] ffmBuildFilesFromMediaBuffers error', e); return []; }
        }

        // Provide a lightweight hydration wait helper so Patch11C can wait for uploader inputs
        async function ffmWaitForFBHydration(maxMs = 8000) {
          try {
            console.log('[Fast4MP] ffmWaitForFBHydration: waiting for uploader input to appear');
            const start = Date.now();
            const interval = 300;
            while (Date.now() - start < maxMs) {
              try {
                if (document.querySelector('input[type="file"]')) return true;
              } catch (e) {}
              await new Promise(r => setTimeout(r, interval));
            }
            console.warn('[Fast4MP] ffmWaitForFBHydration: timed out after', maxMs, 'ms');
            return false;
          } catch (e) { console.warn('[Fast4MP] ffmWaitForFBHydration error', e); return false; }
        }

        // (Removed) Legacy invisible ID injectors: ffmInjectIntoDescription and
        // ffmInjectInvisibleListingId were deleted during cleanup because the
        // extension now uses a clean `data-ffm-id` stamping approach on selling
        // cards via `ffmInjectSellingCardIdsFromSavedListings()`.

        // Find the real Facebook image input: prefer visible multiple inputs that accept images
        function ffmFindFacebookImageInput() {
          try {
            // 1) Visible multiple inputs that explicitly accept images
            const candidates = Array.from(document.querySelectorAll('input[type="file"][multiple]')).filter(el => {
              try {
                if (!el || el.offsetParent === null) return false; // not visible
                const acc = (el.getAttribute && el.getAttribute('accept')) || '';
                return acc.toLowerCase().includes('image');
              } catch (e) { return false; }
            });
            if (candidates.length) return candidates[0];

            // 2) Any visible multiple input (no explicit accept)
            const visMulti = Array.from(document.querySelectorAll('input[type="file"][multiple]')).filter(el => el && el.offsetParent !== null);
            if (visMulti.length) return visMulti[0];

            // 3) Fallback: last multiple input on the page
            const anyMulti = document.querySelectorAll('input[type="file"][multiple]');
            if (anyMulti && anyMulti.length) return anyMulti[anyMulti.length - 1];

            console.warn("[content] Could not find FB real file input");
          } catch (e) {
            console.warn('[content] ffmFindFacebookImageInput error', e);
          }
          return null;
        }

        // Consolidated FB inputs finder (images + videos)
        function ffmFindFBInputs() {
          try {
            return {
              imageInput: document.querySelector('input[type="file"][accept*="image"]'),
              videoInput: document.querySelector('input[type="file"][accept*="video"]')
            };
          } catch (e) { return { imageInput: null, videoInput: null }; }
        }

        // Universal uploader input finder: prefers video uploader when present,
        // otherwise finds a combined uploader accepting images or video.
        function ffmFindProperUploaderInput() {
          try {
            // Prefer video input if present
            const videoInput = document.querySelector('input[type="file"][accept*="video"]');
            if (videoInput) {
              console.log("[Fast4MP] Using VIDEO uploader input:", videoInput);
              return videoInput;
            }

            // Fallback to the combined uploader (old layout)
            const anyInput = Array.from(document.querySelectorAll('input[type="file"]'))
              .find(i => {
                try {
                  const acc = (i.getAttribute && i.getAttribute('accept')) || '';
                  return acc.toLowerCase().includes('image') || acc.toLowerCase().includes('video');
                } catch (e) {
                  return false;
                }
              });

            if (anyInput) {
              console.log("[Fast4MP] Using fallback uploader input:", anyInput);
              return anyInput;
            }

            console.warn("[Fast4MP] No suitable uploader input found (video or image).");
            return null;
          } catch (e) {
            console.error('[Fast4MP] ffmFindProperUploaderInput error', e);
            return null;
          }
        }

// New: more robust real uploader finder (preferred by user)
function ffmFindRealUploaderInput() {
    // Pattern A — live/photo uploader under Add Photos
    let input = document.querySelector('div[aria-label="Add photos"] input[type="file"]');
    if (input) return input;

    // Pattern B — Marketplace: image uploader
    input = document.querySelector('input[type="file"][accept*="image"]');
    if (input) return input;

    // Pattern C — Marketplace: combined uploader
    input = document.querySelector('div[role="button"][aria-label*="Add"] input[type="file"]');
    if (input) return input;

    // Pattern D — FB weird nested element
    input = document.querySelector('input.x1s85apg[type="file"]');
    if (input) return input;

    console.warn("[Fast4MP] REAL uploader input NOT found");
    return null;
}

  // Find the real video input (visible, accepts video, not aria-hidden)
  function ffmFindRealVideoInput() {
    try {
      const allInputs = Array.from(document.querySelectorAll('input[type=file]'));
      const real = allInputs.find(inp => {
        try {
          const acc = inp.accept || '';
          if (!/video/i.test(acc)) return false;
          if (inp.getAttribute && inp.getAttribute('aria-hidden') === 'true') return false;
          if (inp.offsetParent === null) return false; // not visible
          return true;
        } catch (e) { return false; }
      });
      console.log('[Fast4MP] REAL video uploader:', real);
      return real || null;
    } catch (e) { console.debug('[Fast4MP] ffmFindRealVideoInput error', e); return null; }
  }

    // ffmWaitForReactVideoUploader: removed (experimental). Use direct input detection instead.
    async function ffmWaitForReactVideoUploader(timeout = 12000) {
      // stubbed out to avoid interfering with the stable attach flow
      return null;
    }

// ------------------------------------------------------
// CLEAN LISTING ID INJECTION ON /you/selling
// ------------------------------------------------------
// Normalize titles so FB aria-label text and our stored title match better
function ffmNormalizeTitleForMatch(raw) {
  if (!raw) return "";
  return raw
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Read ffm_saved_listings and stamp data-ffm-id onto /you/selling cards
async function ffmInjectSellingCardIdsFromSavedListings() {
  try {
    if (!location.pathname.includes("/marketplace/you/selling")) {
      return;
    }

    const storage = await new Promise(resolve =>
      chrome.storage.local.get(["ffm_saved_listings"], resolve)
    );
    const saved = storage.ffm_saved_listings || {};

    // Build normalizedTitle -> listingId map
    const titleToId = new Map();

    Object.values(saved).forEach(listing => {
      if (!listing) return;

      const id = listing.id || listing.listingId || listing.inventoryName;
      const title = listing.title || listing.fbTitle || listing.inventoryName;
      if (!id || !title) return;

      const key = ffmNormalizeTitleForMatch(title);
      if (!key) return;
      if (!titleToId.has(key)) titleToId.set(key, id);
    });

    if (!titleToId.size) {
      console.log('[Fast4MP] ffmInjectSellingCardIdsFromSavedListings: no listing map built');
      return;
    }

    const cards = Array.from(document.querySelectorAll("div[role='button'][aria-label]"));
    let injectedCount = 0;
    for (const card of cards) {
      const label = card.getAttribute('aria-label') || '';
      const key = ffmNormalizeTitleForMatch(label);
      const id = titleToId.get(key);
      if (!id) continue;
      // No dataset injection performed (IID removed). Keep counts for debug.
      injectedCount++;
    }
    console.log('[Fast4MP] Injected ffmId on selling cards:', injectedCount);
  } catch (e) {
    try { console.warn('[Fast4MP] ffmInjectSellingCardIdsFromSavedListings failed', e); } catch (_) {}
  }
}

  // Ensure the Photo (Add photos) tab is opened so the image uploader is active
  function ffmEnsurePhotoTabOpen() {
    try {
      const addPhotosBtn = document.querySelector('div[role="button"] span[dir="auto"]');
      if (addPhotosBtn && /Add photos/i.test(addPhotosBtn.textContent)) {
        const btn = addPhotosBtn.closest('div[role="button"]');
        if (btn) { btn.click(); console.log("[Fast4MP] CLICKED Add Photos tab to activate uploader"); return true; }
      }
    } catch (e) { console.debug('[Fast4MP] ffmEnsurePhotoTabOpen error', e); }
    console.warn("[Fast4MP] Add Photos button not found");
    return false;
  }

  // Ensure the Video (Add video) tab is opened so the video uploader is active
  function ffmEnsureVideoTabOpen() {
    try {
      const videoTab = Array.from(document.querySelectorAll('span[dir="auto"]')).find(el => /Add video/i.test(el.textContent));
      if (videoTab) {
        const btn = videoTab.closest('div[role="button"]');
        if (btn) { btn.click(); console.log("[Fast4MP] CLICKED Add Video tab to activate uploader"); return true; }
      }
    } catch (e) { console.debug('[Fast4MP] ffmEnsureVideoTabOpen error', e); }
    console.warn("[Fast4MP] Add Video button not found");
    return false;
  }

// Force a React-like click sequence (pointerdown -> mousedown -> mouseup -> click)
function ffmForceReactClick(el) {
  try {
    const evtOpts = { bubbles: true, cancelable: true };
    ["pointerdown", "mousedown", "mouseup", "click"].forEach(type => {
      try {
        const evt = new MouseEvent(type, evtOpts);
        el.dispatchEvent(evt);
      } catch (e) {}
    });
  } catch (e) { console.debug('[Fast4MP] ffmForceReactClick error', e); }
}

// Force-open the Video tab via React-friendly events and wait for the real uploader input
// ffmOpenVideoTabAndWait: removed (experimental). Use direct input detection instead.
async function ffmOpenVideoTabAndWait(timeout = 8000) {
  return null;
}

// STEP 1: Find the hidden real FB video input (accept contains video/)
function ffmFindHiddenVideoInput() {
  try {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find(i => (i.accept || '').toString().toLowerCase().includes('video/')) || null;
  } catch (e) { console.debug('[Fast4MP] ffmFindHiddenVideoInput error', e); return null; }
}

// STEP 2: Assign provided video File objects to the real FB input
async function ffmAttachVideoToRealInput(files) {
  try {
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.warn('[Fast4MP] ffmAttachVideoToRealInput: no files provided');
      return false;
    }

    const input = ffmFindHiddenVideoInput();
    if (!input) {
      console.warn('[Fast4MP] No REAL video input found.');
      return false;
    }

    console.log('[Fast4MP] REAL video input found:', input);

    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);

    try { input.files = dt.files; } catch (e) { console.warn('[Fast4MP] assignment to real input.files failed', e); }

    try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { try { input.dispatchEvent && input.dispatchEvent(new CustomEvent('change', { bubbles: true })); } catch (e2) {} }

    console.log('[Fast4MP] Video assigned to REAL uploader:', input.files);
    return true;
  } catch (e) { console.debug('[Fast4MP] ffmAttachVideoToRealInput error', e); return false; }
}

// Create an injected, hidden <input type=file accept="video/*"> we control
function ffmCreateInjectedVideoInput() {
  try {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'video/*';
    inp.multiple = false;
    inp.style.position = 'fixed';
    inp.style.top = '-9999px';
    inp.style.left = '-9999px';
    document.body.appendChild(inp);
    return inp;
  } catch (e) { console.debug('[Fast4MP] ffmCreateInjectedVideoInput error', e); return null; }
}

// Attach video files by injecting our own hidden input and dispatching change
async function ffmAttachVideoDirect(files) {
  try {
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.warn('[Fast4MP] ffmAttachVideoDirect: no files provided');
      return false;
    }

    // console.log('[Fast4MP] Injecting our own video uploader…');

    const input = ffmCreateInjectedVideoInput();
    if (!input) {
      console.warn('[Fast4MP] ffmAttachVideoDirect: failed to create injected input');
      return false;
    }

    // Build DataTransfer list
    try {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      try { input.files = dt.files; } catch (e) { console.warn('[Fast4MP] direct assignment to injected input.files failed', e); }
    } catch (e) {
      console.warn('[Fast4MP] ffmAttachVideoDirect: DataTransfer build failed', e);
    }

    console.log('[Fast4MP] Injected uploader filelist:', input.files);

    // Now fire the change event that FB listens for
    try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { try { input.dispatchEvent && input.dispatchEvent(new CustomEvent('change', { bubbles: true })); } catch (e2) {} }

    console.log('[Fast4MP] Video attached via injected uploader.');
    return true;
  } catch (e) { console.debug('[Fast4MP] ffmAttachVideoDirect error', e); return false; }
}

          // Patch11D: Choose correct uploader based on stagedFiles (photos prefer image input)
          function ffmChooseCorrectUploader(stagedFiles) {
            try {
              const photos = Array.isArray(stagedFiles) && stagedFiles.some(f => f && f.type && f.type.startsWith && f.type.startsWith("image/"));
              const videos = Array.isArray(stagedFiles) && stagedFiles.some(f => f && f.type && f.type.startsWith && f.type.startsWith("video/"));

              const imageInput = document.querySelector('input[type="file"][accept*="image"]') || document.querySelector('input[type="file"][multiple]');
              const videoInput = document.querySelector('input[type="file"][accept*="video"]');

              // PRIORITY RULES:
              // 1. Only photos → use image input
              if (photos && !videos) {
                console.log('[Fast4MP] Using IMAGE uploader (photos only)');
                return imageInput;
              }

              // 2. Only videos → use video input
              if (videos && !photos) {
                console.log('[Fast4MP] Using VIDEO uploader (videos only)');
                return videoInput;
              }

              // 3. Both exist → use IMAGE first (Facebook often expects a photo)
              if (photos && videos) {
                console.log('[Fast4MP] Using IMAGE uploader (both exist)');
                return imageInput;
              }

              console.warn('[Fast4MP] No media found in stagedFiles');
              return imageInput || videoInput || null;
            } catch (e) { console.warn('[Fast4MP] ffmChooseCorrectUploader error', e); return null; }
          }

        // Override input.files via the element prototype descriptor setter
        function visibleInputFilesSetter(input, files) {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(input.__proto__, 'files');
            if (!descriptor || !descriptor.set) {
              console.warn("[content] Cannot override input.files");
              return;
            }

            descriptor.set.call(input, files);
          } catch (e) {
            console.warn('[content] visibleInputFilesSetter error', e);
          }
        }

        // Convert a DB-style record (with .blob/_data) into a File object
        async function ffmBlobRecordToFile(rec) {
          try {
            if (!rec) return null;
            if (rec instanceof File) return rec;
            const maybeBlob = rec.blob || rec.data || rec.buffer || null;
            if (!maybeBlob) return null;

            // If it's already an ArrayBuffer
            if (maybeBlob instanceof ArrayBuffer) {
              const uint = new Uint8Array(maybeBlob);
              const name = rec.name || rec.filename || 'file';
              const mime = rec.mimeType || rec.type || '';
              return new File([uint], name, { type: mime });
            }

            // If it's a Blob-like object
            if (typeof maybeBlob.arrayBuffer === 'function') {
              const ab = await maybeBlob.arrayBuffer();
              const uint = new Uint8Array(ab);
              const name = rec.name || rec.filename || 'file';
              const mime = rec.mimeType || rec.type || '';
              return new File([uint], name, { type: mime });
            }

            // unknown shape
            return null;
          } catch (e) {
            console.warn('[content] ffmBlobRecordToFile error', e);
            return null;
          }
        }

        // =========================================================
        // PATCH #6 — Guaranteed FB Injection (Universal File Injector)
        // =========================================================
        async function ffmInjectFilesIntoFacebookInput(inputEl, filesArray) {
          console.log("[content] Patch6Injector: begin with", filesArray.length, "files");

          try {
            // ---- STEP 1: Normalize blobs → Real File objects ----
            const realFiles = [];
            for (const f of filesArray) {
              const name = f.name || `file_${Math.random().toString(36).slice(2)}.jpg`;
              const type = f.type || f.mimeType || "image/jpeg";
              const blob = f.blob || f;

              const realFile = new File([blob], name, { type });
              realFiles.push(realFile);
            }

            console.log("[content] Patch6Injector: realFiles built:", realFiles);

            // ---- STEP 2: Create universal DataTransfer (Chrome / FB-proof) ----
            const dt = new DataTransfer();
            for (const realFile of realFiles) dt.items.add(realFile);

            console.log("[content] Patch6Injector: dt.files count =", dt.files.length);

            // ---- STEP 3: Try to assign files robustly. Facebook can overwrite direct assignment,
            // so first attempt to set the property descriptor, then try prototype setter, then fallback.
            let assigned = false;
            try {
              Object.defineProperty(inputEl, 'files', { value: dt.files, writable: false });
              assigned = true;
              console.log('[content] Patch6Injector: Object.defineProperty assigned input.files');
            } catch (e) {
              console.warn('[content] Patch6Injector: defineProperty failed', e);
            }

            if (!assigned) {
              try {
                visibleInputFilesSetter(inputEl, dt.files);
                assigned = true;
                console.log('[content] Patch6Injector: prototype setter assigned input.files');
              } catch (e) {
                console.warn('[content] Patch6Injector: prototype setter failed', e);
              }
            }

            if (!assigned) {
              try {
                inputEl.files = dt.files;
                assigned = true;
                console.warn('[content] Patch6Injector: used direct assignment fallback for input.files');
              } catch (e) {
                console.error('[content] Patch6Injector: final fallback assignment failed', e);
              }
            }

            // ---- STEP 4: Fire all events FB listens for ----
            const fire = (type) =>
              inputEl.dispatchEvent(
                new Event(type, { bubbles: true, cancelable: true })
              );

            fire("input");
            fire("change");
            fire("blur");
            fire("focus");

            // ---- STEP 5: Log after-injection state ----
            console.log("[content] Patch6Injector: assigned input.files =", inputEl.files);

            return dt.files.length;
          } catch (err) {
            console.error("[content] Patch6Injector ERROR:", err);
            return 0;
          }
        }

        // =========================================================
        // PATCH #7 — Normalize + sort staged media (images first, then videos)
        // =========================================================
        function ffmNormalizeAndSortStagedFiles(rawFiles) {
          if (!Array.isArray(rawFiles)) return [];

          const normalized = rawFiles.map((f, idx) => {
            const name = f.name || f.fileName || `file_${idx}`;
            const lowerName = (name || "").toLowerCase();
            const mime = (f.type || f.mimeType || "").toLowerCase();

            // Infer kind: image vs video
            let kind = "image";
            if (
              lowerName.includes("video_") ||
              mime.startsWith("video/") ||
              lowerName.endsWith(".mp4") ||
              lowerName.endsWith(".mov")
            ) {
              kind = "video";
            }

            // Try to extract index from filename like image_3.jpg or video_0.mp4
            let mediaIndex =
              typeof f.index === "number"
                ? f.index
                : 0;

            const m = lowerName.match(/(?:image|video)_(\d+)/);
            if (m) {
              const parsed = parseInt(m[1], 10);
              if (!Number.isNaN(parsed)) mediaIndex = parsed;
            }

            return {
              original: f,
              name,
              kind,
              mediaIndex,
              // images first (0), videos later (1), then by index, finally by original position
              sortKey: `${kind === "image" ? "0" : "1"}_${String(mediaIndex).padStart(3, "0")}_${String(idx).padStart(3, "0")}`
            };
          });

          // De-dupe by (kind, index, name)
          const seen = new Set();
          const deduped = [];
          for (const item of normalized) {
            const key = `${item.kind}|${item.mediaIndex}|${item.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
          }

          deduped.sort((a, b) => {
            if (a.sortKey < b.sortKey) return -1;
            if (a.sortKey > b.sortKey) return 1;
            return 0;
          });

          console.log(
            "[content] Patch7: normalized+sorted media order:",
            deduped.map(d => ({
              name: d.name,
              kind: d.kind,
              index: d.mediaIndex
            }))
          );

          return deduped.map(d => d.original);
        }

        // Patch10: unified staged-or-DB loader — content reconstructs File objects
        async function ffmGetStagedOrDBMedia(listingId) {
          try {
            try { if (window.__ffm_attach_in_progress) { console.debug && console.debug('[Patch10] ffmGetStagedOrDBMedia: attach in progress — skipping media rebuild'); return []; } } catch (e) {}
            if (!listingId) {
              console.warn('[Patch10] ffmGetStagedOrDBMedia called without listingId');
              return [];
            }

            // 1) If page has staged media for this listing, prefer it
            try {
              const staged = window.ffmStagedMedia && window.ffmStagedMedia[listingId];
              if (Array.isArray(staged) && staged.length > 0) {
                console.log('[Patch10] Using staged media for', listingId, 'count:', staged.length);
                const out = [];
                for (const s of staged) {
                  try {
                    if (!s) continue;
                    // If it's already a real File, just forward
                    if (s instanceof File) { out.push(s); continue; }
                    // If the staged descriptor contains an ArrayBuffer or a blob, rebuild
                    const buf = s.buffer ? s.buffer : (s.blob ? await s.blob.arrayBuffer() : null);
                    if (!buf) {
                      // Might already be a lightweight passthrough file-like object
                      if (s && s.name && typeof s.size === 'number') { out.push(s); }
                      continue;
                    }
                    const mime = s.mimeType || (s.blob && s.blob.type) || 'application/octet-stream';
                    const fname = (s.key || s.name || `file_${Date.now()}`).toString().split('/').pop();
                    const blob = new Blob([buf], { type: mime });
                    const file = new File([blob], fname, { type: mime, lastModified: Date.now() });
                    // remove legacy passthrough flag
                    try { delete file._fast4mp_passthrough; delete file.passthrough; } catch (e) {}
                    file._dbRecord = s._dbRecord || null;
                    out.push(file);
                  } catch (e) {
                    console.warn('[Patch10] staged record build failed', e);
                  }
                }
                return out;
              }
            } catch (e) { console.debug('[Patch10] staged check failed', e); }

            // 2) Ask the background to return ArrayBuffers for DB records (structured-clone-safe)
            if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
              console.warn('[Patch10] runtime.sendMessage not available');
              return [];
            }

            console.log('[Patch10] requesting media blobs from background for', listingId);
            // Include active user id (uid) so background can find user-scoped keys
            const uid = await new Promise((r) => {
              try {
                chrome.storage.local.get('ffm_active_user_id', (v) => { try { r(v && v.ffm_active_user_id ? v.ffm_active_user_id : (window.ffmActiveUserId || null)); } catch (e) { r(null); } });
              } catch (e) { r(window.ffmActiveUserId || null); }
            });

            const bgResp = await new Promise((res) => {
              try { chrome.runtime.sendMessage({ action: 'ffm_get_media_blobs_for_listing', listingId, uid }, (r) => { res(r); }); }
              catch (e) { res({ ok: false, error: String(e) }); }
            });

            if (!bgResp || !bgResp.ok || !Array.isArray(bgResp.records) || bgResp.records.length === 0) {
              console.warn('[Patch10] background returned no records or error', bgResp && bgResp.error);
              return [];
            }

            const files = [];
            for (const rec of bgResp.records) {
              try {
                if (!rec || !rec.dataUrl) continue;

                // Raw record from background (helps determine where the type is lost)
                try { console.log('[Fast4MP content][DEBUG-RAW-RECORD]', rec); } catch (e) {}

                const mime = rec.mimeType || rec.type || 'application/octet-stream';
                const filename = (rec.name || rec.key || `file_${rec.index || Date.now()}`).toString().split('/').pop();
                const blob = ffmDataUrlToBlob(rec.dataUrl, mime);

                // Log the Blob conversion result
                try {
                  console.log('[Fast4MP content][DEBUG-BLOB]', {
                    blobType: blob && blob.type,
                    blobSize: blob && typeof blob.size === 'number' ? blob.size : 0,
                    recType: rec.type,
                    recName: rec.name
                  });
                } catch (e) {}

                if (!blob) continue;
                const file = ffmBlobToFile(blob, filename, mime);

                // Log the final File object details
                try {
                  console.log('[Fast4MP content][DEBUG-FILE]', {
                    name: file && file.name,
                    type: file && file.type,
                    size: file && (typeof file.size === 'number' ? file.size : (file && file.length) || 0)
                  });
                } catch (e) {}

                try { console.log('[Fast4MP content][Patch10-video] built file:', { name: file.name, type: file.type, size: file.size }); } catch (e) {}
                try { delete file.passthrough; delete file._fast4mp_passthrough; } catch (e) {}
                file._dbRecord = rec;
                files.push(file);
              } catch (e) { console.warn('[Patch10] failed to rebuild record', e); }
            }

            console.log('[Patch10] Background returned', files.length, 'files for', listingId);
            return files;

          } catch (err) {
            console.error('[Patch10] ffmGetStagedOrDBMedia error:', err);
            return [];
          }
        }

// ----------------------------------------------------
// GUARANTEED WORKING ATTACH CODE (Images + Video)
// ----------------------------------------------------
function ffmAttachMediaToFileInput(uploaderInput, files) {
  try {
    if (!uploaderInput) {
      console.warn("[Fast4MP] ffmAttachMediaToFileInput: uploaderInput is null");
      return false;
    }
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.warn("[Fast4MP] ffmAttachMediaToFileInput: no files to attach");
      return false;
    }

    console.log("[Fast4MP] ATTACH START — files:", files.length);

    const dt = new DataTransfer();

    for (const f of files) {
      console.log("[Fast4MP] ATTACH — adding:", f.name, f.type, f.size);
      dt.items.add(f);
    }

    uploaderInput.files = dt.files;

    // Fire input event so FB reacts
    uploaderInput.dispatchEvent(new Event("change", { bubbles: true }));

    console.log("[Fast4MP] ATTACH COMPLETE");
    return true;

  } catch (err) {
    console.error("[Fast4MP] ffmAttachMediaToFileInput ERROR:", err);
    return false;
  }
}

        // 2) Set Title
        try {
          // OPTIONAL: embed listing id into the plain title input as a data attribute
          try {
            // Invisible ID embedding removed for cleanup — no data attributes written.
          } catch (e) { /* non-fatal */ }

          // Prefer inventoryName when available so Title is populated from the original source
          setTitle((listing.title && String(listing.title).trim()) || (listing.inventoryName && String(listing.inventoryName).trim()) || '');
        } catch (e) { console.warn('setTitle error', e); }
        try {
          //------------------------------------------------------
          // Invisible Listing ID Embed
          //------------------------------------------------------
          try {
            const listingId =
              listing.listingId ||
              listing.id ||
              listing.inventoryName || null;

            if (listingId) {
              // Invisible ID embedding removed — skipping title span dataset writes.
            }
          } catch (err) {
            console.warn("[Fast4MP] ID embed error:", err);
          }
        } catch (e) {}
        await sleep(800);

        // 3) Set Price (with retries)
        await setPriceWithRetry(listing.price || '');
        await sleep(800);

        // 4) Category selection and then condition
        // Try to set Category using combobox-like input (mimic Selenium approach)
        async function selectCategory(category) {
          if (!category) return;
          // Facebook removed explicit 'Mattress' category; treat mattress inputs as Furniture
          let desired = category;
          try {
            if (/mattress/i.test((desired || '').toString())) desired = 'Furniture';
          } catch (e) { /* ignore */ }

          // Generic approach: focus the Category control, wait 2s, then tab-scan for the desired option
          try {
            // prefer the saved listing category unless it explicitly references 'mattress'
            const requested = (desired || '').toString().trim();

            // Try to locate a Category control (combobox/button/select) using common patterns
            const selCandidates = [
              'input[aria-label="Category"][role="combobox"]',
              'input[role="combobox"][aria-label*="Category"]',
              'input[placeholder*="Category"]',
              'input[aria-label*="Category"]',
              'select[aria-label*="Category"]',
              '[role="combobox"][aria-label*="Category"]',
              'button[aria-label*="Category"]'
            ];
            let categoryControl = null;
            for (const s of selCandidates) {
              try { const el = document.querySelector(s); if (el) { categoryControl = el; break; } } catch (e) {}
            }

            // If not found, try to locate a label/span with text 'Category' and find a nearby control
            if (!categoryControl) {
              const label = Array.from(document.querySelectorAll('span, label, div')).find(n => { try { return (n.textContent || '').toString().trim().toLowerCase() === 'category'; } catch (e) { return false; } });
              if (label) {
                // search siblings and descendants for an interactive control
                try {
                  const cand = label.querySelector && label.querySelector('select, [role="combobox"], button, input');
                  if (cand) categoryControl = cand;
                } catch (e) {}
                if (!categoryControl) {
                  let sib = label.nextElementSibling; let steps = 0;
                  while (sib && steps < 8) { try { if (sib.matches && sib.matches('select, [role="combobox"], button, input')) { categoryControl = sib; break; } const inside = sib.querySelector && sib.querySelector('select, [role="combobox"], button, input'); if (inside) { categoryControl = inside; break; } } catch (e) {} sib = sib.nextElementSibling; steps++; }
                }
              }
            }

            if (categoryControl) {
              try { categoryControl.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
              try { categoryControl.focus(); } catch (e) {}
              try { categoryControl.click && categoryControl.click(); } catch (e) { try { categoryControl.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }

              // Wait 2 seconds for FB to render options
              await sleep(2000);

              // Tab-scan: up to 20 tabs to find the matching option text
              const maxTabs = 20;
              for (let t = 0; t < maxTabs; t++) {
                try {
                  const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', code: 'Tab' });
                  const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Tab', code: 'Tab' });
                  (document.activeElement || document.body).dispatchEvent(down);
                  (document.activeElement || document.body).dispatchEvent(up);
                } catch (e) {}
                await sleep(180 + ffm_randInt(10,30));
                const f = document.activeElement;
                let txt = '';
                try { txt = (f && (f.textContent || f.innerText || (f.getAttribute && (f.getAttribute('aria-label') || f.value)) || '')).toString().trim(); } catch (e) { txt = ''; }
                console.debug('[Fast4MP] tab-match-scan', t+1, txt);

                if (txt && requested && new RegExp(requested.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&'), 'i').test(txt)) {
                  try { f.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
                  try { f.click && f.click(); } catch (e) { try { f.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
                  await sleep(120 + ffm_randInt(20,60));
                  try { const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }); const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }); f.dispatchEvent(down); f.dispatchEvent(up); } catch (e) {}
                  await sleep(400 + ffm_randInt(40,120));
                  return;
                }
              }
              console.debug('[Fast4MP] did not find matching category via tab-scan for', requested);
            }
          } catch (e) { /* ignore */ }

          // Try to find and click a span matching the desired text and known class fragments.
          try {
            const clsCandidates = ['x193iq5w', 'xeuugli', 'xzsf02u'];
            const spans = Array.from(document.querySelectorAll('span')).filter(s => s.textContent && s.textContent.trim() === desired);
            const spanBtn = spans.find(s => clsCandidates.some(c => (s.className || '').indexOf(c) !== -1));
            if (spanBtn) {
              spanBtn.scrollIntoView({ block: 'center', inline: 'center' });
              try { spanBtn.click(); } catch (e) { try { spanBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
              await sleep(500 + ffm_randInt(40, 120));
              return;
            }
          } catch (e) { /* ignore */ }
          try {
            // Try common combobox input selectors
            const selCandidates = [
              'input[aria-label="Category"][role="combobox"]',
              'input[role="combobox"][aria-label*="Category"]',
              'input[placeholder*="Category"]',
              'input[aria-label*="Category"]'
            ];
            let catInput = null;
            for (const s of selCandidates) {
              const el = document.querySelector(s);
              if (el) { catInput = el; break; }
            }

            // If not found, try to find an element with aria-label containing Category
            if (!catInput) catInput = document.querySelector('input[aria-label*="Category"]');

            if (catInput) {
              catInput.focus();
              catInput.click();
              // Press Enter first (to open or activate the control)
              const enterDown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' });
              const enterUp = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' });
              try { catInput.dispatchEvent(enterDown); catInput.dispatchEvent(enterUp); } catch (e) { /* ignore */ }
              await sleep(200);
              // Now send the category text and dispatch input event
              try { catInput.value = desired; } catch (e) { /* ignore */ }
              catInput.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(200);
              // Press Tab twice then Enter to move to the correct option and select it
              const sendKey = (key) => {
                const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code: key });
                const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key, code: key });
                catInput.dispatchEvent(down);
                catInput.dispatchEvent(up);
              };
              // move selection down twice, wait for rendering, then press Enter
              sendKey('ArrowDown');
              await sleep(120);
              sendKey('ArrowDown');
              // give FB time to highlight the option
              await sleep(1000);
              sendKey('Enter');
              // give FB extra time to process the typed category and selection
              await sleep(2000);
            }

            // Try to click the category option by text (in case the above didn't select it)
            const optionXpathText = desired;
            // find span elements with exact text
            const spans = Array.from(document.querySelectorAll('span')).filter(s => s.textContent && s.textContent.trim() === optionXpathText);
            if (spans.length > 0) {
              spans[0].scrollIntoView({ block: 'center', inline: 'center' });
              try { spans[0].click(); } catch (e) { try { spans[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
              await sleep(500 + ffm_randInt(40,120));
              return;
            }

            // fallback: try clicking element containing the text
            const contains = Array.from(document.querySelectorAll('span')).find(s => s.textContent && s.textContent.trim().includes(category));
            if (contains) { try { contains.click(); } catch (e) { try { contains.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} } await sleep(500 + ffm_randInt(40,120)); return; }
          } catch (err) {
            console.warn('selectCategory failed', err);
          }
        }

        // Attempt selection (default to 'Furniture' if nothing provided)
        await selectCategory(listing.category || 'Furniture');

        // After category, attempt to set Condition before the description
        console.debug('populate-fb: about to selectCondition', listing.condition);
        await selectCondition(listing.condition || '');
        console.debug('populate-fb: after selectCondition');

        // Now set the description (after condition)
        try {
          setDescription(listing.description || '');
          console.debug('populate-fb: description set');
        } catch (e) { console.warn('setDescription error', e); }
        // Legacy invisible-injection call removed (now using selling-card dataset stamping)
        await sleep(500);

        // small pause then attempt to set Condition using a dropdown click + option click
        async function selectCondition(condition) {
          if (!condition) return;
          try {
            const norm = s => (s || '').toString().trim().toLowerCase();

            // normalize requested condition and synonyms
            const requested = norm(condition);
            const synonyms = {
              new: ['new', 'brand new'],
              'like new': ['like new', 'like-new', 'excellent'],
              used: ['used', 'preowned', 'pre-owned'],
              refurbished: ['refurbished'],
              'for parts': ['for parts', 'parts']
            };

            const matchText = (text) => {
              if (!text) return false;
              const t = norm(text);
              if (t === requested) return true;
              if (t.includes(requested)) return true;
              // check synonyms
              for (const key in synonyms) {
                if (synonyms[key].some(x => x === requested)) {
                  if (synonyms[key].some(x => t === x || t.includes(x))) return true;
                }
              }
              return false;
            };

            // aggressive click helper (preserve previous behavior), but skip obvious destructive controls
            const tryClick = (node) => {
              if (!node) return false;
              try {
                try {
                  const aria = (node.getAttribute && node.getAttribute('aria-label')) || '';
                  const txt = (node.textContent || '').toString().trim().toLowerCase();
                  if ((aria && aria.toLowerCase().includes('remove')) || txt === 'remove' || txt.includes('remove')) {
                    console.debug('selectCondition: skipping click on remove-like element');
                    return false;
                  }
                } catch (e) {}

                node.scrollIntoView({ block: 'center' });
                try { node.click(); console.debug('selectCondition: element.click() succeeded', node); return true; } catch (e) { /* continue */ }
                const rect = node.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const props = { bubbles: true, cancelable: true, view: window };
                try {
                  node.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: cx, clientY: cy }, props)));
                  node.dispatchEvent(new MouseEvent('mousedown', Object.assign({ clientX: cx, clientY: cy }, props)));
                  node.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: cx, clientY: cy }, props)));
                  node.dispatchEvent(new MouseEvent('mouseup', Object.assign({ clientX: cx, clientY: cy }, props)));
                  node.dispatchEvent(new MouseEvent('click', Object.assign({ clientX: cx, clientY: cy }, props)));
                  console.debug('selectCondition: dispatched synthetic events to', node);
                  return true;
                } catch (e) { console.debug('selectCondition: synthetic events failed', e); }
                try {
                  const elAt = document.elementFromPoint(cx, cy);
                  if (elAt) { elAt.scrollIntoView({ block: 'center' }); try { elAt.click(); console.debug('selectCondition: elementFromPoint click succeeded', elAt); return true; } catch (e) {} }
                } catch (e) {}
                return false;
              } catch (err) { console.warn('selectCondition: tryClick unexpected error', err); return false; }
            };

            // Wait for an element that likely labels the Condition control
            const targetText = 'condition';
            const start = Date.now();
            let condLabel = null;
            const waitTimeout = 7000;
            while (!condLabel && Date.now() - start < waitTimeout) {
              condLabel = Array.from(document.querySelectorAll('span, label, div')).find(s => s.textContent && s.textContent.trim().toLowerCase() === targetText);
              if (condLabel) break;
              await sleep(250);
            }

            // find a clickable control associated with the label
            let control = null;
            const findControlForLabel = (labelEl) => {
              if (!labelEl) return null;
              try {
                console.debug('selectCondition: found condition label', labelEl);
                // If label has an id, prefer elements that reference it via aria-labelledby/aria-describedby
                const lid = labelEl.id;
                if (lid) {
                  try {
                    // exact attribute contains match
                    const refCandidates = Array.from(document.querySelectorAll('[role="combobox"], [role="button"], [role="listbox"], [role="textbox"], select, button')).filter(el => {
                      try {
                        const al = el.getAttribute && el.getAttribute('aria-labelledby');
                        const ad = el.getAttribute && el.getAttribute('aria-describedby');
                        if ((al && al.split(/\s+/).includes(lid)) || (ad && ad.split(/\s+/).includes(lid))) return true;
                        // some elements may include the id in the attribute string
                        if ((al && al.indexOf(lid) !== -1) || (ad && ad.indexOf(lid) !== -1)) return true;
                      } catch (e) {}
                      return false;
                    });
                    if (refCandidates.length) return refCandidates[0];
                  } catch (e) {}
                }

                // 2) check inside the label element itself
                try { if (labelEl.querySelector) { const inside = labelEl.querySelector('select, [role="combobox"], [role="button"], button, input[type="radio"]'); if (inside) return inside; } } catch (e) {}

                // 3) siblings: next and previous
                try {
                  let sib = labelEl.nextElementSibling; let steps = 0;
                  while (sib && steps < 8) {
                    try { if (sib.matches && sib.matches('select, [role="combobox"], [role="button"], button, [role="listbox"]')) return sib; const inside = sib.querySelector && sib.querySelector('select, [role="combobox"], [role="button"], button, [role="listbox"]'); if (inside) return inside; } catch (e) {}
                    sib = sib.nextElementSibling; steps++;
                  }
                  sib = labelEl.previousElementSibling; steps = 0;
                  while (sib && steps < 8) {
                    try { if (sib.matches && sib.matches('select, [role="combobox"], [role="button"], button, [role="listbox"]')) return sib; const inside = sib.querySelector && sib.querySelector('select, [role="combobox"], [role="button"], button, [role="listbox"]'); if (inside) return inside; } catch (e) {}
                    sib = sib.previousElementSibling; steps++;
                  }
                } catch (e) {}

                // 4) ancestors: look up a few levels for interactive descendants
                try {
                  let node = labelEl.parentElement;
                  for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                    try { if (node.matches && node.matches('select, [role="combobox"], [role="button"], button, [role="listbox"]')) return node; const inside = node.querySelector && node.querySelector('select, [role="combobox"], [role="button"], button, [role="listbox"]'); if (inside) return inside; } catch (e) {}
                  }
                } catch (e) {}

                // 5) last resort: any nearby interactive with matching visible text 'Condition' in ancestor
                try {
                  const near = Array.from(document.querySelectorAll('select, [role="combobox"], [role="button"], button, [role="listbox"]')).filter(n => n && n.offsetParent !== null);
                  if (near.length) {
                    // pick the nearest by center distance
                    const aRect = labelEl.getBoundingClientRect();
                    let best = null; let bd = Infinity;
                    for (const n of near) {
                      try {
                        const r = n.getBoundingClientRect();
                        const d = Math.hypot((r.left + r.width/2) - (aRect.left + aRect.width/2), (r.top + r.height/2) - (aRect.top + aRect.height/2));
                        if (d < bd) { bd = d; best = n; }
                      } catch (e) {}
                    }
                    return best;
                  }
                } catch (e) {}
              } catch (e) {}
              return null;
            };

            if (condLabel) control = findControlForLabel(condLabel);

            // broad fallback: find any element containing the word 'condition'
            if (!control) {
              control = Array.from(document.querySelectorAll('div[role="button"], button, [role="combobox"], select')).find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('condition') || (b.textContent || '').toLowerCase().includes('condition'));
            }

            if (!control) {
              // final fallback: try to find by nearby text nodes
              const fallback = Array.from(document.querySelectorAll('span, label, div')).find(el => (el.textContent || '').toLowerCase().includes('condition'));
              if (fallback) control = fallback;
            }

            if (!control) { console.warn('selectCondition: could not locate condition control'); return; }

            // Map a requested condition to the number of ArrowDown presses needed
            const arrowMap = {
              'new': 1,
              'like new': 2,
              'used - like new': 2,
              'used like new': 2,
              'used - good': 3,
              'used good': 3,
              'used - fair': 4,
              'used fair': 4,
              'used': 2,
              'refurbished': 1,
              'for parts': 5
            };

            const sendKey = (key, el) => {
              try {
                const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code: key });
                const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key, code: key });
                if (el && el.dispatchEvent) { el.dispatchEvent(down); el.dispatchEvent(up); } else { document.dispatchEvent(down); document.dispatchEvent(up); }
              } catch (e) { try { document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code: key })); } catch (e) {} }
            };

            // If native select element exists inside or near control, use it
            const selectEl = (control.tagName && control.tagName.toLowerCase() === 'select') ? control : (control.querySelector ? control.querySelector('select') : null);
            if (selectEl) {
              // try to pick option by matching text/value
              const opts = Array.from(selectEl.options || []);
              const opt = opts.find(o => matchText(o.text) || matchText(o.value));
              if (opt) {
                try { selectEl.value = opt.value; selectEl.dispatchEvent(new Event('change', { bubbles: true })); console.debug('selectCondition: set native select to', opt.text); return; } catch (e) { console.debug('selectCondition: failed to set native select', e); }
              }
            }

            // Try to open control (click) and then use arrow navigation if a mapping exists
            let controlOpened = false;
            try {
              controlOpened = !!tryClick(control);
            } catch (e) { controlOpened = false; }
            await sleep(400);
            try {
              const focusEl = (control && control.focus) ? control : (control.querySelector && control.querySelector('input, select, [role="combobox"]')) || control;
              try { focusEl.focus && focusEl.focus(); } catch (e) {}
              // compute how many arrows to send for the requested value
              const arrowCount = arrowMap[requested] || arrowMap[requested.toLowerCase()] || null;
              if (arrowCount !== null && arrowCount !== undefined) {
                for (let i = 0; i < arrowCount; i++) { sendKey('ArrowDown', focusEl); await sleep(180); }
                await sleep(220);
                sendKey('Enter', focusEl);
                await sleep(400);
                // check if selection happened by observing aria-selected or control text
                const postOptions = findVisibleOptionsNear(control || condLabel);
                const postMatch = postOptions.find(o => matchText(o.textContent) || matchText(o.getAttribute && o.getAttribute('aria-label')));
                if (postMatch) { tryClick(postMatch); await sleep(200); console.debug('selectCondition: matched option after arrow navigation', postMatch.textContent); return; }
                console.debug('selectCondition: arrow navigation attempted, no direct option click match found');
              }
            } catch (e) { console.debug('selectCondition: arrow navigation failed', e); }

            // If radio inputs exist in the area, attempt to match their labels/values
            const radios = control.querySelector ? Array.from(control.querySelectorAll('input[type="radio"]')) : [];
            if (radios.length) {
              for (const r of radios) {
                // try associated label
                let lab = null;
                try { lab = document.querySelector(`label[for="${r.id}"]`) || r.closest('label'); } catch (e) {}
                const txt = (lab && lab.textContent) || r.value || r.getAttribute('aria-label') || '';
                if (matchText(txt)) { tryClick(r); console.debug('selectCondition: clicked radio matching', txt); return; }
              }
            }

            // Try to open control (click) only if we didn't already open it, then look for options
            if (!controlOpened) {
              tryClick(control);
            }
            await sleep(600);

            // helper: debug overlay to show candidate options for live inspection
            function removeDebugOverlay() {
              try {
                const ex = document.getElementById('ffm-debug-overlay');
                if (ex) ex.remove();
              } catch (e) {}
            }

            function computeCssSelector(el) {
              try {
                if (!el) return null;
                if (el.id) return `#${el.id}`;
                const parts = [];
                let node = el;
                while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
                  let part = node.tagName.toLowerCase();
                  if (node.className && typeof node.className === 'string') {
                    const cls = node.className.trim().split(/\s+/).filter(Boolean);
                    if (cls.length) part += '.' + cls.slice(0,3).join('.');
                  }
                  // check siblings for uniqueness
                  try {
                    const parent = node.parentElement;
                    if (parent) {
                      const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
                      if (siblings.length > 1) {
                        const idx = siblings.indexOf(node) + 1;
                        part += `:nth-child(${idx})`;
                      }
                    }
                  } catch (e) {}
                  parts.unshift(part);
                  node = node.parentElement;
                }
                return parts.join(' > ');
              } catch (e) { return null; }
            }

            // Debug overlays removed during cleanup.
            // collect possible option nodes, preferring an explicit listbox (aria-controls/owns) tied to the control
            const optionSelectors = ['[role="option"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', 'li[role="option"]', 'div[role="option"]', 'ul[role="listbox"] li', 'div[role="listbox"] div'];

            const findListboxForControl = (ctl) => {
              try {
                if (!ctl) return null;
                // 1) aria-controls -> id
                const ac = ctl.getAttribute && ctl.getAttribute('aria-controls');
                if (ac) {
                  const byId = document.getElementById(ac);
                  if (byId) return byId;
                }
                // 2) aria-owns
                const owns = ctl.getAttribute && ctl.getAttribute('aria-owns');
                if (owns) {
                  const byOwns = document.getElementById(owns);
                  if (byOwns) return byOwns;
                }
                // 3) if control references a labelled id (aria-labelledby) try to find a listbox with matching labelling
                const labelled = ctl.getAttribute && ctl.getAttribute('aria-labelledby');
                if (labelled) {
                  const labelledId = labelled.split(' ')[0];
                  const candidates = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"], [role="presentation"]'));
                  for (const c of candidates) {
                    try {
                      const lbLabelled = c.getAttribute && (c.getAttribute('aria-labelledby') || c.getAttribute('aria-describedby'));
                      if (lbLabelled && lbLabelled.split(' ').includes(labelledId)) return c;
                    } catch (e) {}
                  }
                }
                // 4) fallback: nearest element with role=listbox that contains options and is near the control
                const anchorRect = (ctl && ctl.getBoundingClientRect && ctl.getBoundingClientRect()) || null;
                const listboxes = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]')).filter(n => n && n.offsetParent !== null);
                if (listboxes.length) {
                  // pick the closest by center distance
                  let best = null; let bestDist = Infinity;
                  for (const lb of listboxes) {
                    try {
                      const r = lb.getBoundingClientRect();
                      const cx = r.left + r.width/2; const cy = r.top + r.height/2;
                      const ax = anchorRect ? (anchorRect.left + anchorRect.width/2) : cx;
                      const ay = anchorRect ? (anchorRect.top + anchorRect.height/2) : cy;
                      const d = Math.hypot(cx-ax, cy-ay);
                      if (d < bestDist) { bestDist = d; best = lb; }
                    } catch (e) {}
                  }
                  if (best) return best;
                }
              } catch (e) {}
              return null;
            };

            function findVisibleOptionsNear(anchor, containerOverride) {
              const anchorRect = (anchor && anchor.getBoundingClientRect && anchor.getBoundingClientRect()) || null;
              const maxDistance = 450; // px
              let candidates = [];
              try {
                if (containerOverride) {
                  const nodes = Array.from(containerOverride.querySelectorAll(optionSelectors.join(','))).filter(n => n && n.textContent && n.offsetParent !== null);
                  candidates.push(...nodes);
                } else {
                  for (const sel of optionSelectors) {
                    try {
                      const nodes = Array.from(document.querySelectorAll(sel)).filter(n => n && n.textContent && n.offsetParent !== null);
                      if (nodes.length) candidates.push(...nodes);
                    } catch (e) {}
                  }
                }
                if (!candidates.length) candidates = Array.from(document.querySelectorAll('span, div, button')).filter(n => n && n.textContent && n.offsetParent !== null);
              } catch (e) { candidates = []; }

              const filtered = candidates.filter(n => {
                try {
                  const txt = (n.textContent || '').toString().trim();
                  if (!txt) return false;
                  if (txt.length > 350) return false; // exclude huge blocks
                  if (!anchorRect) return true;
                  const r = n.getBoundingClientRect();
                  const cx = r.left + r.width/2;
                  const cy = r.top + r.height/2;
                  const ax = anchorRect.left + anchorRect.width/2;
                  const ay = anchorRect.top + anchorRect.height/2;
                  const dist = Math.hypot(cx-ax, cy-ay);
                  return dist <= maxDistance;
                } catch (e) { return false; }
              });
              return filtered;
            }

            // try cached selector first
            try {
              const map = await ffmGetSelectorMap();
              const cached = map && map['condition'];
              if (cached) {
                try {
                  const el = document.querySelector(cached);
                  if (el) { tryClick(el); console.debug('selectCondition: used cached selector', cached); return; }
                } catch (e) { console.debug('selectCondition: cached selector query failed', e); }
              }
            } catch (e) { console.debug('selectCondition: selector cache read error', e); }
            // if a listbox is explicitly associated with the control, use it
            let options = [];
            try {
              const listbox = findListboxForControl(control || condLabel);
              if (listbox) {
                options = findVisibleOptionsNear(control || condLabel, listbox);
                console.debug('selectCondition: found explicit listbox for control, options:', options.map(o => (o.textContent || '').toString().trim()));
              }
            } catch (e) { console.debug('selectCondition: listbox lookup error', e); }

            // if no listbox or options are suspiciously large, fall back to proximity search
            if (!options || options.length === 0 || options.length > 80) {
              options = findVisibleOptionsNear(control || condLabel);
              console.debug('selectCondition: visible options (initial, near anchor - fallback):', options.map(o => (o.textContent || '').toString().trim()));
            }
            // debug overlay call removed

            // 1) exact or synonym match
            let matched = options.find(o => matchText(o.textContent) || matchText(o.getAttribute && o.getAttribute('aria-label')));
            if (matched) { tryClick(matched); await sleep(300); console.debug('selectCondition: matched option (initial)', matched.textContent); return; }

            // 2) try keyboard navigation fallback
            try { if (control && control.focus) control.focus(); } catch (e) {}
            const maxDown = 8;
            for (let i = 0; i < maxDown; i++) {
              const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown', code: 'ArrowDown' });
              try { (control || document).dispatchEvent(ev); } catch (e) {}
              await sleep(250);
              options = findVisibleOptionsNear(control || condLabel);
              console.debug('selectCondition: visible options after down (near anchor)', i + 1, options.map(o => (o.textContent || '').toString().trim()));
              // debug overlay call removed
              matched = options.find(o => matchText(o.textContent) || matchText(o.getAttribute && o.getAttribute('aria-label')));
              if (matched) { tryClick(matched); await sleep(300); console.debug('selectCondition: matched option after down', matched.textContent); return; }
            }

            // 3) contains match (narrowed)
            options = findVisibleOptionsNear(control || condLabel);
            matched = options.find(o => (o.textContent || '').toLowerCase().includes(requested));
            if (matched) { tryClick(matched); await sleep(300); console.debug('selectCondition: contains-match selected', matched.textContent); return; }

            console.warn('selectCondition: option not found for', condition, 'candidates:', options.map(o => (o.textContent||'').trim()));
          } catch (err) {
            console.warn('selectCondition failed', err);
          }
        }

  console.debug('populate-fb: setting additional attributes');

        // --- Additional attribute fields (Bed Size, Core Construction, Mattress Type, Brand, Color, Material) ---
        // Generic attribute setter: looks for a nearby label with the given name, then tries native select, radio, or option click fallbacks.
        async function setAttributeField(labelNames, value) {
          if (!value) return;
          try {
            // derive a consistent key for this attribute (used for caching selectors)
            const attrKey = (Array.isArray(labelNames) ? labelNames[0] : labelNames || '').toString().trim().toLowerCase().replace(/\s+/g, '_');

            // try cached selector first for this attribute
            try {
              const map = await ffmGetSelectorMap();
              const cached = map && map[`attr_${attrKey}`];
              if (cached) {
                try {
                  const q = document.querySelector(cached);
                  if (q) {
                    try { q.click(); console.debug('setAttributeField: used cached selector for', attrKey, cached); } catch (e) { try { q.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
                    await sleep(400 + Math.floor(Math.random() * 180));
                    return;
                  }
                } catch (e) { console.debug('setAttributeField: cached selector query failed', e); }
              }
            } catch (e) { console.debug('setAttributeField: selector cache read error', e); }

            // small debug overlay helpers scoped to this function (mirror of selectCondition overlay)
            // createDebugOverlayAttr and helpers removed
            const norm = s => (s || '').toString().trim().toLowerCase();
            const matchText = (text, requested) => {
              if (!text) return false;
              const t = norm(text);
              const req = norm(requested);
              return t === req || t.includes(req) || req.includes(t);
            };

            const labels = Array.isArray(labelNames) ? labelNames : [labelNames];
            // find label element by exact or contains
            let labelEl = null;
            for (const ln of labels) {
              const req = ln.toString().trim().toLowerCase();
              labelEl = Array.from(document.querySelectorAll('label, span, div')).find(el => el.textContent && el.textContent.trim().toLowerCase() === req);
              if (labelEl) break;
            }
            // broader contains fallback
            if (!labelEl) {
              for (const ln of labels) {
                const req = ln.toString().trim().toLowerCase();
                labelEl = Array.from(document.querySelectorAll('label, span, div')).find(el => el.textContent && el.textContent.trim().toLowerCase().includes(req));
                if (labelEl) break;
              }
            }

            // candidate control search
            let control = null;
            if (labelEl) {
              // prefer an interactive control near the label: look inside the label, then siblings, then ancestors
              const interactiveSel = 'select, [role="combobox"], div[role="button"], button, [role="button"], input[type="radio"], input[type="text"], input[type="file"]';
              const findInteractiveNear = (el) => {
                if (!el) return null;
                try {
                  // 1) check inside the label element itself
                  if (el.querySelector) {
                    const inside = el.querySelector(interactiveSel);
                    if (inside) return inside;
                  }
                } catch (e) {}

                try {
                  // 2) check immediate siblings (next and previous) for interactive elements or matches
                  let sib = el.nextElementSibling;
                  let steps = 0;
                  while (sib && steps < 8) {
                    try {
                      if (sib.matches && sib.matches(interactiveSel)) return sib;
                      if (sib.querySelector) {
                        const inside = sib.querySelector(interactiveSel);
                        if (inside) return inside;
                      }
                    } catch (e) {}
                    sib = sib.nextElementSibling; steps++;
                  }
                  sib = el.previousElementSibling; steps = 0;
                  while (sib && steps < 8) {
                    try {
                      if (sib.matches && sib.matches(interactiveSel)) return sib;
                      if (sib.querySelector) {
                        const inside = sib.querySelector(interactiveSel);
                        if (inside) return inside;
                      }
                    } catch (e) {}
                    sib = sib.previousElementSibling; steps++;
                  }
                } catch (e) {}

                try {
                  // 3) walk up ancestors and prefer the first ancestor that contains an interactive descendant
                  let node = el.parentElement;
                  for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                    try {
                      if (node.matches && node.matches(interactiveSel)) return node;
                      if (node.querySelector) {
                        const inside = node.querySelector(interactiveSel);
                        if (inside) return inside;
                      }
                    } catch (e) {}
                  }
                } catch (e) {}

                return null;
              };

              control = findInteractiveNear(labelEl) || labelEl.closest('label') || labelEl.parentElement || labelEl;
              console.debug('setAttributeField: located control for label', labelEl && labelEl.textContent && labelEl.textContent.trim(), control);
            }

            // fallback: try to find control by aria-label or nearby text
            if (!control) {
              control = Array.from(document.querySelectorAll('select, [role="combobox"], div[role="button"], button')).find(el => (el.getAttribute('aria-label') || '').toLowerCase().includes(labels[0].toLowerCase()) || (el.textContent || '').toLowerCase().includes(labels[0].toLowerCase()));
            }

            if (!control) {
              console.debug('setAttributeField: could not locate control for', labels);
              return;
            }

            // try native select
            const selectEl = (control.tagName && control.tagName.toLowerCase() === 'select') ? control : (control.querySelector ? control.querySelector('select') : null);
            if (selectEl) {
              const opts = Array.from(selectEl.options || []);
              const opt = opts.find(o => matchText(o.text, value) || matchText(o.value, value));
              if (opt) {
                try { selectEl.value = opt.value; selectEl.dispatchEvent(new Event('change', { bubbles: true })); console.debug('setAttributeField: set native select', labels, opt.text); return; } catch (e) { console.debug('setAttributeField: failed to set select', e); }
              }
            }

            // try radio inputs
            const radios = control.querySelector ? Array.from(control.querySelectorAll('input[type="radio"]')) : [];
            if (radios.length) {
              for (const r of radios) {
                let lab = null;
                try { lab = document.querySelector(`label[for="${r.id}"]`) || r.closest('label'); } catch (e) {}
                const txt = (lab && lab.textContent) || r.value || r.getAttribute('aria-label') || '';
                if (matchText(txt, value)) { try { r.click(); console.debug('setAttributeField: clicked radio for', labels, txt); } catch (e) { try { r.dispatchEvent(new Event('change', { bubbles: true })); } catch {} } return; }
              }
            }

            // try opening control and choosing from visible options
            try {
              // attempt to click to open
              try { control.scrollIntoView({ block: 'center' }); try { control.click(); } catch (e) { control.dispatchEvent(new MouseEvent('click', { bubbles: true })); } } catch (e) {}
            } catch (e) {}
            await sleep(500);

            const optionSelectors = ['[role="option"]', '[role="menuitem"]', 'li[role="option"]', 'div[role="option"]', 'ul[role="listbox"] li'];
            let options = [];
            for (const sel of optionSelectors) {
              const nodes = Array.from(document.querySelectorAll(sel)).filter(n => n && n.textContent && n.offsetParent !== null);
              if (nodes.length) { options = nodes; break; }
            }
            if (!options.length) options = Array.from(document.querySelectorAll('span, div, button')).filter(n => n && n.textContent && n.offsetParent !== null);

            // createDebugOverlayAttr call removed

            // Scored matching to prefer exact token matches (so 'Firm' beats 'Extra Firm')
            try {
              const reqRaw = (value || '').toString();
              const req = (reqRaw || '').toString().trim().toLowerCase();
              const scoreFor = (optText) => {
                try {
                  if (!optText || !req) return 0;
                  const t = optText.toString().trim().toLowerCase();
                  if (t === req) return 100; // exact
                  const tTokens = t.split(/\W+/).filter(Boolean);
                  const rTokens = req.split(/\W+/).filter(Boolean);
                  // all requested tokens must be present as separate tokens in option text
                  if (rTokens.length && rTokens.every(rt => tTokens.includes(rt))) return 90;
                  // option contains requested token as a standalone token (e.g., 'firm' in 'extra firm')
                  if (tTokens.includes(req)) return 70;
                  // substring matches (less specific)
                  if (t.indexOf(req) >= 0 || req.indexOf(t) >= 0) return 40;
                  return 0;
                } catch (e) { return 0; }
              };

              let best = null;
              for (const o of options) {
                try {
                  const txt = (o.textContent || (o.getAttribute && o.getAttribute('aria-label')) || '').toString();
                  const s = scoreFor(txt);
                  if (!best || s > best.score) best = { node: o, score: s, text: txt };
                } catch (e) {}
              }
              if (best && best.score > 0) {
                try { best.node.click(); console.debug('setAttributeField: clicked option (scored)', labels, best.text, best.score); } catch (e) { try { best.node.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch {} }
                return;
              }
            } catch (e) { console.debug('setAttributeField: scoring match error', e); }

            console.debug('setAttributeField: no matching option found for', labels, 'value', value);
          } catch (err) {
            console.warn('setAttributeField error for', labelNames, err);
          }
        }

        // Attempt to set a 'Hide From Friends' toggle/switch on the page (if present).
        async function setHideFromFriends(flag) {
          if (flag === undefined || flag === null) return;
          try {
            const key = 'attr_hide_from_friends';
            // small css selector helper (prefer id, then tag.class:nth-child)
            const computeCss = (el) => {
              try {
                if (!el) return null;
                if (el.id) return `#${el.id}`;
                const parts = [];
                let node = el;
                while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
                  let part = node.tagName.toLowerCase();
                  if (node.className && typeof node.className === 'string') {
                    const cls = node.className.trim().split(/\s+/).filter(Boolean);
                    if (cls.length) part += '.' + cls.slice(0,3).join('.');
                  }
                  try {
                    const parent = node.parentElement;
                    if (parent) {
                      const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
                      if (siblings.length > 1) {
                        const idx = siblings.indexOf(node) + 1;
                        part += `:nth-child(${idx})`;
                      }
                    }
                  } catch (e) {}
                  parts.unshift(part);
                  node = node.parentElement;
                }
                return parts.join(' > ');
              } catch (e) { return null; }
            };

            // try cached selector first
            try {
              const map = await ffmGetSelectorMap();
              const cached = map && map[key];
              if (cached) {
                try {
                  let el = null;
                  if (typeof cached === 'string' && cached.indexOf('xpath:') === 0) {
                    try {
                      const xp = cached.replace(/^xpath:/, '');
                      const res = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                      el = res && res.singleNodeValue ? res.singleNodeValue : null;
                    } catch (xe) { el = null; }
                  } else {
                    el = document.querySelector(cached);
                  }
                  if (el) {
                    // Try forcing the toggle on the exact cached element
                    const ok = await forceToggleElement(el, flag);
                    console.debug('setHideFromFriends: forceToggleElement result', ok, cached);
                    if (ok) return;
                    // if forceToggleElement didn't succeed, fall through to other heuristics
                  }
                } catch (e) { /* continue */ }
              }
            } catch (e) { console.debug('setHideFromFriends: selector cache read error', e); }

            // search for a descriptive node that matches the snippet you provided
            const norm = s => (s || '').toString().trim().toLowerCase();
            // exact textual cues we prefer (from the pasted element)
            const preferredPhrases = [
              'this listing is still public',
              'if you hide this listing from friends',
              'hide this listing from friends'
            ];

            // Find a node that contains one of the preferred phrases
            let labelEl = null;
            try {
              const nodes = Array.from(document.querySelectorAll('span, div, p, label'));
              for (const n of nodes) {
                try {
                  const t = norm(n.textContent || '');
                  if (!t) continue;
                  for (const ph of preferredPhrases) {
                    if (t.includes(ph)) { labelEl = n; break; }
                  }
                  if (labelEl) break;
                } catch (e) {}
              }
            } catch (e) {}

            // fallback: generic search for hide + friend wording (existing behavior)
            if (!labelEl) {
              try {
                labelEl = Array.from(document.querySelectorAll('label, span, div')).find(el => {
                  try { const t = norm(el.textContent); return (t.includes('hide') && (t.includes('friend') || t.includes('friends'))); } catch (e) { return false; }
                });
              } catch (e) { labelEl = null; }
            }

            // fallback: aria-label / inputs with hint text
            let control = null;
            const interactiveSel = 'input[type="checkbox"], [role="switch"], input[type="radio"], button';

            // If we have the preferred label element, search its subtree and immediate vicinity first
            if (labelEl) {
              // Special-case: if the label contains the long explanatory sentence, try clicking the container
              try {
                const longPhrase = (labelEl.textContent || '').toString().trim().toLowerCase();
                if (longPhrase.includes('this listing is still public') || longPhrase.includes('hide this listing from friends') || longPhrase.includes('if you hide this listing from friends')) {
                  try {
                        // Try to find the clickable container near the label and click its center (synthesized mouse events)
                        try {
                          labelEl.scrollIntoView({ block: 'center' });
                        } catch (e) {}
                        try {
                          const findClickableContainer = () => {
                            // 1) look for an ancestor that contains the switch input
                            let node = labelEl;
                            for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                              try {
                                if (node.querySelector && node.querySelector('[role="switch"], input[role="switch"], input[type="checkbox"]')) return node;
                              } catch (e) {}
                            }
                            // 2) look for a sibling or nearby node with role=button
                            try {
                              const sibBtn = (labelEl.parentElement && labelEl.parentElement.querySelector('[role="button"]')) || document.querySelector('[role="button"][aria-label*="next"]');
                              if (sibBtn) return sibBtn;
                            } catch (e) {}
                            // 3) fallback to closest div with many children (the container you pasted)
                            try { return labelEl.closest('div') || labelEl.parentElement; } catch (e) { return null; }
                          };

                          const container = findClickableContainer();
                          if (container) {
                            try {
                              // Ensure the container is visible: scroll into view and, if needed, to page bottom
                              try { container.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
                              await sleep(120);
                              // Recompute rect after scroll
                              let rect = container.getBoundingClientRect();
                              // If container is still off-screen (below fold), try scrolling to bottom then re-center
                              if (rect.top > window.innerHeight || rect.bottom < 0) {
                                try { window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: 'auto' }); } catch (e) {}
                                await sleep(160);
                                try { container.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
                                await sleep(120);
                                rect = container.getBoundingClientRect();
                              }

                              const cx = Math.round(rect.left + rect.width/2);
                              const cy = Math.round(rect.top + rect.height/2);
                              // synthesize mousemove/mousedown/mouseup/click at the container center
                              const dispatchMouseAt = (type) => {
                                const ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy });
                                try { container.dispatchEvent(ev); } catch (e) { /* best effort */ }
                              };
                              dispatchMouseAt('mousemove'); dispatchMouseAt('mousedown'); dispatchMouseAt('mouseup'); dispatchMouseAt('click');
                            } catch (e) { try { container.click(); } catch (e2) {} }
                            await sleep(200);
                            // New FB UI: sometimes the hide-from-friends control is a pick-overlay
                            // with numbered markers (e.g., '1' and '2'). Try to click the nearest numeric
                            // marker: choose the first marker for 'hide' (flag=true), second for not-hide.
                            try {
                              const searchRoot = container || labelEl || document;
                              const numericMarkers = Array.from(searchRoot.querySelectorAll('span, button, div, a')).filter(el => {
                                try { return el && el.offsetParent !== null && /^\s*\d+\s*$/.test((el.textContent || '').toString().trim()); } catch (e) { return false; }
                              });
                              if (numericMarkers && numericMarkers.length) {
                                const byDist = (a, b) => {
                                  try {
                                    if (!labelEl) return 0;
                                    const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
                                    const la = labelEl.getBoundingClientRect();
                                    const da = Math.hypot((ra.left+ra.width/2)-(la.left+la.width/2), (ra.top+ra.height/2)-(la.top+la.height/2));
                                    const db = Math.hypot((rb.left+rb.width/2)-(la.left+la.width/2), (rb.top+rb.height/2)-(la.top+la.height/2));
                                    return da - db;
                                  } catch (e) { return 0; }
                                };
                                numericMarkers.sort(byDist);
                                const pickIndex = (!!flag) ? 0 : (numericMarkers.length > 1 ? 1 : 0);
                                const pick = numericMarkers[pickIndex];
                                try { pick.scrollIntoView({ block: 'center' }); } catch (e) {}
                                try { pick.click(); } catch (e) { try { pick.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e2) {} }
                                await sleep(240);
                                try {
                                  const sel = (typeof computeCss === 'function' ? computeCss(pick) : null) || computeCss(labelEl) || null;
                                  if (sel) { const map = await ffmGetSelectorMap(); map['attr_hide_from_friends'] = sel; await ffmSetSelectorMap(map); console.debug('setHideFromFriends: cached numeric marker selector', sel); }
                                } catch (e) {}
                                return; // done
                              }
                            } catch (e) { /* continue to other heuristics */ }
                          }
                        } catch (e) {}
                  } catch (e) {}

                    // Try to find a nearby switch and send SPACE key events (keyboard interaction works in some FB UIs)
                  try {
                    const findSwitch = () => {
                      return labelEl.querySelector('[role="switch"], input[role="switch"], input[type="checkbox"], div[role="switch"]') ||
                        (labelEl.parentElement && labelEl.parentElement.querySelector('[role="switch"], input[role="switch"], input[type="checkbox"], div[role="switch"]')) ||
                        document.querySelector('[role="switch"], input[role="switch"], input[type="checkbox"], div[role="switch"]');
                    };
                    const switchEl = findSwitch();
                    if (switchEl) {
                      try {
                        // focus then send browser-like key events on the focused element
                        try { switchEl.focus && switchEl.focus(); } catch (e) {}
                        const evDown = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
                        const evUp = new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
                        // Some FB UIs react to keydown/keyup on document as well
                        try { switchEl.dispatchEvent(evDown); switchEl.dispatchEvent(evUp); } catch (e) { document.dispatchEvent(evDown); document.dispatchEvent(evUp); }
                        await sleep(200);
                      } catch (e) {}

                      // Check if the switch state now matches desired flag
                      try {
                        const isOn = (switchEl.getAttribute && switchEl.getAttribute('aria-checked') === 'true') || !!switchEl.checked;
                        if ((!!isOn) === !!flag) {
                          // persist selector for the switch
                          try {
                            const sel = (typeof computeCss === 'function' ? computeCss(switchEl) : null) || computeCss(labelEl) || null;
                            if (sel) {
                              const map = await ffmGetSelectorMap(); map['attr_hide_from_friends'] = sel; await ffmSetSelectorMap(map);
                              console.debug('setHideFromFriends: cached selector (container flow)', sel);
                            }
                          } catch (e) {}
                          return; // done
                        }
                      } catch (e) {}
                    }
                  } catch (e) {}
                }
              } catch (e) {}
              try {
                // 1) Prefer actual input/switch controls within the label or its ancestor chain
                const preferSel = 'input[type="checkbox"], input[role="switch"], [role="switch"], input[type="radio"]';
                // search inside label
                try {
                  const inside = labelEl.querySelector && labelEl.querySelector(preferSel);
                  if (inside) control = inside;
                } catch (e) {}

                // search ancestors for a direct input/switch control (closest first)
                if (!control) {
                  let node = labelEl;
                  for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                    try {
                      const found = node.querySelector && node.querySelector(preferSel);
                      if (found && found.offsetParent !== null) { control = found; break; }
                      // also check if node itself is a control
                      if (node.matches && node.matches(preferSel) && node.offsetParent !== null) { control = node; break; }
                    } catch (e) {}
                  }
                }

                // 2) If still not found, look in immediate siblings but prefer inputs/switches and avoid boost/promote buttons
                if (!control) {
                  const isBad = (txt) => { try { const t = norm(txt || ''); return /(boost|promote|sponsored|\bad\b)/i.test(t); } catch (e) { return false; } };
                  let sib = labelEl.nextElementSibling; let steps = 0;
                  while (sib && steps < 10 && !control) {
                    try {
                      // if it's an input/switch/radio prefer it
                      if (sib.matches && sib.matches(preferSel) && !isBad(sib.textContent)) { control = sib; break; }
                      const inside = sib.querySelector && sib.querySelector(preferSel);
                      if (inside && !isBad(inside.textContent)) { control = inside; break; }
                    } catch (e) {}
                    sib = sib.nextElementSibling; steps++;
                  }

                  // previous siblings
                  sib = labelEl.previousElementSibling; steps = 0;
                  while (sib && steps < 10 && !control) {
                    try {
                      if (sib.matches && sib.matches(preferSel) && !isBad(sib.textContent)) { control = sib; break; }
                      const inside = sib.querySelector && sib.querySelector(preferSel);
                      if (inside && !isBad(inside.textContent)) { control = inside; break; }
                    } catch (e) {}
                    sib = sib.previousElementSibling; steps++;
                  }
                }

                // 3) final attempt: find any nearby control but avoid clicking boost-like controls (prefer real inputs/switches)
                if (!control) {
                  try {
                    const vicinity = Array.from((labelEl.parentElement || document).querySelectorAll(preferSel)).filter(n => n && n.offsetParent !== null);
                    if (vicinity.length) control = vicinity[0];
                  } catch (e) {}
                }

                // 4) Debug log the chosen control for visibility
                try {
                  if (control) {
                    console.debug('setHideFromFriends: chosen control', { tag: control.tagName, role: control.getAttribute && control.getAttribute('role'), ariaLabel: control.getAttribute && control.getAttribute('aria-label'), ariaChecked: control.getAttribute && control.getAttribute('aria-checked'), outer: control.outerHTML && control.outerHTML.slice(0,300) });
                  }
                } catch (e) {}
              } catch (e) { console.debug('setHideFromFriends: label vicinity search error', e); }
            }

            // If still not found, search page-wide for candidates whose aria-label/text directly references hide+friend but avoid boost/promote
            if (!control) {
              try {
                // collect visible candidate controls
                const allCandidates = Array.from(document.querySelectorAll('input[type="checkbox"], [role="switch"], input[type="radio"], button, [role="button"]')).filter(el => el && el.offsetParent !== null);

                // helper to normalize text from element and nearby label
                const textOf = (el) => {
                  try {
                    const al = (el.getAttribute && el.getAttribute('aria-label')) || '';
                    const txt = (el.textContent || '') || al || '';
                    return norm(txt);
                  } catch (e) { return ''; }
                };

                // prefer checkbox/switch/radio controls that have hide/friend in text, then fallback to buttons
                let candidates = allCandidates.filter(el => {
                  try {
                    const t = textOf(el);
                    if (!t) return false;
                    if (/(boost|promote|sponsored|\bad\b)/i.test(t)) return false;
                    return (t.includes('hide') && (t.includes('friend') || t.includes('friends')));
                  } catch (e) { return false; }
                });

                // If no direct textual match, try to find controls near the labelEl or with suitable roles
                if (!candidates.length) {
                  // prefer structural control types nearby
                  const structural = allCandidates.filter(el => ['INPUT','BUTTON'].includes(el.tagName));
                  if (labelEl && structural.length) {
                    try {
                      const aRect = labelEl.getBoundingClientRect();
                      let best = null; let bestDist = Infinity;
                      for (const c of structural) {
                        try {
                          const r = c.getBoundingClientRect();
                          const cx = r.left + r.width/2; const cy = r.top + r.height/2;
                          const ax = aRect.left + aRect.width/2; const ay = aRect.top + aRect.height/2;
                          const d = Math.hypot(cx-ax, cy-ay);
                          if (d < bestDist) { bestDist = d; best = c; }
                        } catch (e) {}
                      }
                      if (best) candidates = [best];
                    } catch (e) {}
                  }
                }

                // final fallback: any candidate that doesn't look like a boost control
                if (!candidates.length) candidates = allCandidates.filter(el => { try { const t = textOf(el); return !/(boost|promote|sponsored|\bad\b)/i.test(t); } catch (e) { return true; } });

                if (candidates.length) {
                  // if we had a labelEl choose the closest candidate by distance, else take first
                  if (labelEl) {
                    try {
                      const aRect = labelEl.getBoundingClientRect();
                      let best = null; let bestDist = Infinity;
                      for (const c of candidates) {
                        try {
                          const r = c.getBoundingClientRect();
                          const cx = r.left + r.width/2; const cy = r.top + r.height/2;
                          const ax = aRect.left + aRect.width/2; const ay = aRect.top + aRect.height/2;
                          const d = Math.hypot(cx-ax, cy-ay);
                          if (d < bestDist) { bestDist = d; best = c; }
                        } catch (e) {}
                      }
                      control = best || candidates[0];
                    } catch (e) { control = candidates[0]; }
                  } else {
                    control = candidates[0];
                  }
                }
              } catch (e) {}
            }

            // ffm_temp_attr_overlay pick-overlay removed

            if (!control) {
              console.debug('setHideFromFriends: no control found for hide-from-friends');
              return;
            }

            // attempt to set the control
            try {
              const tryClick = (el) => {
                try { el.click(); return true; } catch (e) { try { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; } catch (e2) { return false; } }
              };

              if (control.tagName && control.tagName.toLowerCase() === 'input' && (control.type === 'checkbox' || control.type === 'radio')) {
                // prefer clicking a nearby clickable container (label, parent div) if simple click doesn't change checked state
                const before = !!control.checked;
                tryClick(control);
                await new Promise(r => setTimeout(r, 200));
                const after = !!control.checked;
                if (after === before) {
                  // try clicking parent clickable elements
                  let p = control.parentElement; let tried = false;
                  for (let i=0;i<6 && p;i++,p=p.parentElement) {
                    if (p && (p.matches && (p.matches('button') || p.getAttribute && p.getAttribute('role') === 'button'))) { tried = tryClick(p); break; }
                  }
                  if (!tried) {
                    // fallback to setting property and firing events
                    try { control.checked = !!flag; control.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
                  }
                }
              } else if (control.getAttribute && control.getAttribute('role') === 'switch') {
                const isOn = (control.getAttribute('aria-checked') === 'true') || !!control.classList.contains('on');
                if ((!!isOn) !== !!flag) {
                  // try clicking the control itself first
                  let acted = tryClick(control);
                  if (!acted) {
                    // try clickable ancestors
                    let p = control.parentElement;
                    for (let i=0;i<6 && p;i++,p=p.parentElement) {
                      if (p && (p.matches && (p.matches('button') || (p.getAttribute && p.getAttribute('role') === 'button')))) { if (tryClick(p)) { acted = true; break; } }
                    }
                  }
                  if (!acted) {
                    // programmatically toggle aria-checked and dispatch events
                    try { control.setAttribute('aria-checked', !!flag ? 'true' : 'false'); control.dispatchEvent(new Event('change', { bubbles: true })); control.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
                  }
                }
              } else {
                // generic button/toggle — prefer clicking a non-boost candidate
                try {
                  if (flag) {
                    if (!tryClick(control)) {
                      // try ancestor clickable
                      let p = control.parentElement;
                      for (let i=0;i<6 && p;i++,p=p.parentElement) {
                        if (p && (p.matches && (p.matches('button') || (p.getAttribute && p.getAttribute('role') === 'button')))) { if (tryClick(p)) break; }
                      }
                    }
                  }
                } catch (e) {}
              }
            } catch (e) { console.debug('setHideFromFriends: control interaction failed', e); }

            // persist a selector for future runs
            try {
              const sel = computeCss(control) || computeCss(labelEl) || null;
              if (sel) {
                try {
                  const map = await ffmGetSelectorMap();
                  map[key] = sel;
                  await ffmSetSelectorMap(map);
                  console.debug('setHideFromFriends: cached selector', sel);
                } catch (e) { console.debug('setHideFromFriends: failed to save selector', e); }
              }
            } catch (e) {}
          } catch (err) {
            console.warn('setHideFromFriends error', err);
          }
        }

        // Map listing fields to UI labels and try to set them
        const attributeMap = {
          bedSize: ['Bed size', 'Bed Size', 'Size'],
          coreConstruction: ['Core construction', 'Core Construction'],
          comfortLevel: ['Comfort level', 'Comfort Level', 'Comfort'],
          mattressType: ['Mattress type', 'Mattress Type'],
          brand: ['Brand'],
          color: ['Color'],
          material: ['Material']
        };

        const getListingValue = (keys) => {
          for (const k of keys) {
            if (!k) continue;
            if (listing[k] !== undefined && listing[k] !== null && listing[k] !== '') return listing[k];
            const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (listing[snake] !== undefined && listing[snake] !== null && listing[snake] !== '') return listing[snake];
          }
          return null;
        };

  await setAttributeField(attributeMap.bedSize, getListingValue(['bedSize','bed_size','size','bedSizeText']));
  // Try more keys for core construction (sometimes named differently in listings)
  const coreVal = getListingValue(['coreConstruction','core_construction','construction','core','core_construction_text']);
  console.debug('populate-fb: coreConstruction resolved value ->', coreVal);
  await setAttributeField(attributeMap.coreConstruction, coreVal);
        await setAttributeField(attributeMap.comfortLevel, getListingValue(['comfortLevel','comfort_level','comfort','comfortLevelText']));

        // Helper: return a short description of the currently focused element for tuning Tab count
        function ffmDescribeActiveElement() {
          try {
            const af = document.activeElement;
            if (!af) return 'none';
            const tag = af.tagName || '';
            const id = af.id ? `#${af.id}` : '';
            const cls = (af.className && typeof af.className === 'string') ? '.' + af.className.trim().split(/\s+/).slice(0,3).join('.') : '';
            const aria = (af.getAttribute && (af.getAttribute('aria-label') || af.getAttribute('role') || af.getAttribute('aria-checked'))) || '';
            const txt = (af.textContent || '').toString().trim().replace(/\s+/g, ' ').slice(0, 120);
            return `${tag}${id}${cls} aria="${aria}" text="${txt}"`;
          } catch (e) { return 'describe-error'; }
        }

        // After selecting Comfort Level, optionally advance focus by sending Tab keys then Space
        async function sendTabsThenSpace(count) {
          try {
            // debug tab-focus logging removed
            // Slightly longer delay between tabs to accommodate FB's dynamic UI focus handling
            const perTabDelay = 140;
            for (let i = 0; i < count; i++) {
              const kd = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true });
              const ku = new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true });
              try {
                // Dispatch to document and also to activeElement (best-effort)
                try { document.dispatchEvent(kd); document.dispatchEvent(ku); } catch (e) {}
                const af = document.activeElement; if (af && af !== document) { try { af.dispatchEvent(kd); af.dispatchEvent(ku); } catch (e) {} }
              } catch (e) { /* best effort */ }
              await sleep(perTabDelay);
            }
            // small pause before sending Space
            await sleep(220);
            // send Space to activate the focused control
            const sd = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
            const su = new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
            try {
              const af = document.activeElement;
              if (af && af !== document) { af.dispatchEvent(sd); af.dispatchEvent(su); }
              else { document.dispatchEvent(sd); document.dispatchEvent(su); }
            } catch (e) { /* best effort */ }
            await sleep(160);
            // debug tab-focus logging removed
          } catch (e) { console.debug('sendTabsThenSpace error', e); }
        }

        // Try a targeted toggle for the Hide-From-Friends control first (more reliable when present)
        async function setHideFromFriendsSimple(flag) {
          try {
            if (flag === undefined || flag === null) return false;
            const norm = s => (s || '').toString().trim().toLowerCase();
            const phrases = ['hide from friends', 'this listing is still public', "hide this listing from friends"];
            // search for elements containing those phrases
            const nodes = Array.from(document.querySelectorAll('span, div, label, p'));
            let labelEl = null;
            for (const n of nodes) {
              try {
                const t = norm(n.textContent || '');
                if (!t) continue;
                for (const ph of phrases) { if (t.includes(ph)) { labelEl = n; break; } }
                if (labelEl) break;
              } catch (e) {}
            }

            if (!labelEl) return false;

            // look nearby for switch/checkbox inputs
            const preferSel = 'input[type="checkbox"], input[role="switch"], [role="switch"], input[type="radio"]';
            // search within labelEl, ancestors, siblings
            const tryFind = () => {
              try {
                if (labelEl.querySelector) {
                  const inside = labelEl.querySelector(preferSel);
                  if (inside && inside.offsetParent !== null) return inside;
                }
              } catch (e) {}
              // ancestors
              let node = labelEl;
              for (let i=0;i<6 && node;i++,node=node.parentElement) {
                try {
                  if (node.matches && node.matches(preferSel) && node.offsetParent !== null) return node;
                  const found = node.querySelector && node.querySelector(preferSel);
                  if (found && found.offsetParent !== null) return found;
                } catch (e) {}
              }
              // siblings
              try {
                let sib = labelEl.nextElementSibling; let steps=0;
                while (sib && steps<8) {
                  try { if (sib.matches && sib.matches(preferSel) && sib.offsetParent !== null) return sib; const f = sib.querySelector && sib.querySelector(preferSel); if (f && f.offsetParent !== null) return f; } catch (e) {}
                  sib = sib.nextElementSibling; steps++;
                }
              } catch (e) {}
              // page-wide fallback: try to find a switch with aria-label 'Enabled' near label text
              try {
                const candidates = Array.from(document.querySelectorAll(preferSel)).filter(el => el && el.offsetParent !== null);
                if (candidates.length) {
                  // pick nearest by bounding rect distance
                  try {
                    const aRect = labelEl.getBoundingClientRect(); let best=null; let bestD=Infinity;
                    for (const c of candidates) {
                      try { const r = c.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2; const ax=aRect.left+aRect.width/2, ay=aRect.top+aRect.height/2; const d = Math.hypot(cx-ax, cy-ay); if (d<bestD) { bestD=d; best=c; } } catch (e) {}
                    }
                    if (best) return best;
                  } catch (e) {}
                }
              } catch (e) {}
              return null;
            };

            let control = tryFind();
            if (!control) {
              console.debug('setHideFromFriendsSimple: no control near label');
              return false;
            }

            // If the initially found control seems far from the label, prefer a visible switch/checkbox
            // that is vertically nearest and (preferably) below the label. This avoids picking the
            // Boost/Promote control that can appear above the explanatory text.
            try {
              const labelRect = labelEl.getBoundingClientRect();
              const ctrlRect = control.getBoundingClientRect();
              const vertDist = Math.abs((ctrlRect.top + ctrlRect.height/2) - (labelRect.top + labelRect.height/2));
              // If the chosen control is more than ~160px away, try to find a closer candidate below the label
              if (vertDist > 160) {
                const candidates = Array.from(document.querySelectorAll(preferSel)).filter(el => el && el.offsetParent !== null);
                let best = null; let bestScore = Infinity;
                const labelCenterY = labelRect.top + labelRect.height/2;
                for (const c of candidates) {
                  try {
                    const r = c.getBoundingClientRect();
                    const cCenterY = r.top + r.height/2;
                    // prefer elements below the label; penalize ones above
                    const penalty = (cCenterY < labelCenterY) ? 2000 : 0;
                    const score = penalty + Math.abs(cCenterY - labelCenterY);
                    if (score < bestScore) { bestScore = score; best = c; }
                  } catch (e) {}
                }
                if (best) {
                  console.debug('setHideFromFriendsSimple: switching to nearer control candidate', { oldDist: vertDist, new: best.tagName });
                  control = best;
                }
              }
            } catch (e) { /* best effort */ }

            console.debug('setHideFromFriendsSimple: found control', { tag: control.tagName, role: control.getAttribute && control.getAttribute('role'), aria: control.getAttribute && control.getAttribute('aria-label'), checked: control.checked, ariaChecked: control.getAttribute && control.getAttribute('aria-checked') });

            // Present numbered clickable markers for multiple nearby candidate controls so the user
            // can explicitly pick the correct switch (helps avoid Boost/Promote controls).
            const overlayId = 'ffm-hide-confirm-overlay';
            const removeOverlayIfExists = () => { try { const ex = document.getElementById(overlayId); if (ex) ex.remove(); const existing = document.querySelectorAll('[id^="ffm-hide-marker-"]'); if (existing) existing.forEach(n=>n.remove()); const marker = document.getElementById('ffm-hide-marker'); if (marker) marker.remove(); } catch (e) {} };
            removeOverlayIfExists();
            try {
              // ensure control is visible and centered in viewport before measuring
              try { control.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }); } catch (e) {}
              // small delay to allow layout to settle
              try { await sleep(220); } catch (e) {}

              // gather candidate controls near the label (include current control)
              const allCandidates = Array.from(document.querySelectorAll(preferSel)).filter(el => el && el.offsetParent !== null);
              const labelRect = labelEl.getBoundingClientRect();
              const labelCenterY = labelRect.top + labelRect.height/2;
              const distance = (r) => Math.abs((r.top + r.height/2) - labelCenterY);
              // score penalizes candidates above the label to prefer ones below
              const scoreFor = (r) => ((r.top + r.height/2) < labelCenterY ? 2000 : 0) + distance(r);
              // build unique list keeping current control first
              const uniq = [];
              const pushIfUnique = (el) => { if (!uniq.includes(el)) uniq.push(el); };
              pushIfUnique(control);
              allCandidates.forEach(c => pushIfUnique(c));
              // sort by score and take top N
              let ranked = uniq.map(c => ({ el: c, rect: c.getBoundingClientRect(), score: scoreFor(c.getBoundingClientRect()) })).sort((a,b)=>a.score-b.score).slice(0,6);

              // Heuristic: if any candidate's visible text or aria-label mentions 'disable', prefer it
              try {
                const lower = s => (s || '').toString().trim().toLowerCase();
                const disableIdx = ranked.findIndex(item => {
                  try {
                    const txt = lower((item.el && (item.el.textContent || item.el.getAttribute && item.el.getAttribute('aria-label'))) || '');
                    return txt.includes('disable') || txt.includes('disabled');
                  } catch (e) { return false; }
                });
                if (disableIdx > 0) {
                  // move preferred candidate to front
                  const pref = ranked.splice(disableIdx, 1)[0];
                  ranked.unshift(pref);
                  console.debug('setHideFromFriendsSimple: prioritized candidate containing "disable" text');
                }
              } catch (e) { /* non-fatal */ }

              // Auto-pick heuristic: if any candidate explicitly mentions 'enable'/'enabled', auto-select it
              let autoChosen = null;
              try {
                const lower = s => (s || '').toString().trim().toLowerCase();
                const enableIdx = ranked.findIndex(item => {
                  try {
                    const txt = lower((item.el && (item.el.textContent || item.el.getAttribute && item.el.getAttribute('aria-label'))) || '');
                    return txt.includes('enable') || txt.includes('enabled');
                  } catch (e) { return false; }
                });
                if (enableIdx >= 0) {
                  autoChosen = ranked[enableIdx].el;
                  console.debug('setHideFromFriendsSimple: auto-chosen candidate containing "enable" text');
                }
              } catch (e) { /* non-fatal */ }

              // small helper to compute a CSS-ish selector for caching
              function computeCssLocal(el) {
                try {
                  if (!el) return null;
                  if (el.id) return `#${el.id}`;
                  const parts = [];
                  let node = el;
                  while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
                    let part = node.tagName.toLowerCase();
                    if (node.className && typeof node.className === 'string') {
                      const cls = node.className.trim().split(/\s+/).filter(Boolean);
                      if (cls.length) part += '.' + cls[0];
                    }
                    try {
                      const parent = node.parentElement;
                      if (parent) {
                        const siblings = Array.from(parent.children).filter(ch => ch.tagName === node.tagName);
                        if (siblings.length > 1) part += `:nth-child(${Array.from(parent.children).indexOf(node) + 1})`;
                      }
                    } catch (e) {}
                    parts.unshift(part);
                    node = node.parentElement;
                  }
                  return parts.join(' > ');
                } catch (e) { return null; }
              }

              // if autoChosen was detected, use it immediately (cache selector) and skip the markers overlay
              if (typeof autoChosen !== 'undefined' && autoChosen) {
                try {
                  // persist selector for future runs
                  try { const sel = computeCssLocal(autoChosen) || null; if (sel) { const map = await ffmGetSelectorMap(); map['attr_hide_from_friends'] = sel; await ffmSetSelectorMap(map); console.debug('setHideFromFriendsSimple: cached selector (auto)', sel); } } catch (e) { console.debug('setHideFromFriendsSimple: failed to cache selector (auto)', e); }
                  control = autoChosen;
                } catch (e) { console.debug('setHideFromFriendsSimple: applying autoChosen failed', e); }
              }

              if (autoChosen) {
                // autoChosen was already set as control above; skip interactive overlay
                console.debug('setHideFromFriendsSimple: skipping overlay because autoChosen was selected');
              } else {
                // create numbered markers and a small overlay list panel
                const wrap = document.createElement('div'); wrap.id = overlayId;
                wrap.style.position = 'fixed'; wrap.style.zIndex = 2147483647; wrap.style.width = '360px'; wrap.style.maxHeight = '60vh'; wrap.style.overflow = 'auto'; wrap.style.background = 'white'; wrap.style.border = '1px solid rgba(0,0,0,0.12)'; wrap.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)'; wrap.style.padding = '10px'; wrap.style.fontSize = '13px'; wrap.style.fontFamily = 'Arial, sans-serif';
                // position panel to the right if space, otherwise top-right
                try {
                  const padding = 12;
                  const rect = ranked[0] && ranked[0].rect ? ranked[0].rect : labelRect;
                  const rightSpace = window.innerWidth - rect.right;
                  if (rightSpace > 380) { wrap.style.left = (Math.max(8, rect.right + padding)) + 'px'; wrap.style.top = Math.max(8, rect.top) + 'px'; }
                  else { wrap.style.right = '12px'; wrap.style.top = Math.min(Math.max(8, rect.top), window.innerHeight - 120) + 'px'; }
                } catch (e) { wrap.style.right = '12px'; wrap.style.top = '12px'; }

                const title = document.createElement('div'); title.style.fontWeight = '600'; title.style.marginBottom = '6px'; title.textContent = 'Pick the Hide-From-Friends control (click a marker)'; wrap.appendChild(title);
                const list = document.createElement('div'); list.style.display = 'flex'; list.style.flexDirection = 'column'; list.style.gap = '6px';

                // build marker elements on-page for each candidate
                const markerEls = [];
                for (let i=0;i<ranked.length;i++) {
                  try {
                    const item = ranked[i];
                    const r = item.rect;
                    const num = i+1;
                    const m = document.createElement('div');
                    m.id = `ffm-hide-marker-${num}`;
                    m.style.position = 'fixed';
                    m.style.left = Math.max(0, r.left) + 'px';
                    m.style.top = Math.max(0, r.top) + 'px';
                    m.style.zIndex = 2147483646;
                    m.style.pointerEvents = 'auto';
                    m.style.background = '#ff9800';
                    m.style.color = '#fff';
                    m.style.width = '28px';
                    m.style.height = '28px';
                    m.style.display = 'flex'; m.style.alignItems = 'center'; m.style.justifyContent = 'center';
                    m.style.borderRadius = '50%';
                    m.style.fontWeight = '700'; m.style.cursor = 'pointer'; m.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)';
                    m.title = (item.el && (item.el.textContent || item.el.getAttribute && (item.el.getAttribute('aria-label') || item.el.getAttribute('role')))) || '';
                    m.textContent = String(num);
                    // click handler resolves with selected element
                    ((el) => {
                      m.addEventListener('click', async (ev) => {
                        ev.stopPropagation(); ev.preventDefault();
                        try { removeOverlayIfExists(); } catch (e) {}
                        try {
                          // persist selector for future runs
                          const sel = computeCssLocal(el) || null;
                          if (sel) {
                            try { const map = await ffmGetSelectorMap(); map['attr_hide_from_friends'] = sel; await ffmSetSelectorMap(map); console.debug('setHideFromFriendsSimple: cached selector (marker)', sel); } catch (e) { console.debug('setHideFromFriendsSimple: failed to cache selector', e); }
                          }
                          // set control to chosen element and continue
                          control = el;
                          // trigger toggle immediately and continue flow by resolving the choice promise
                          try { chosenResolver && chosenResolver(el); } catch (e) {}
                        } catch (e) { console.debug('marker click error', e); }
                      });
                    })(item.el);
                    document.documentElement.appendChild(m);
                    markerEls.push(m);

                    // add to side list
                    const li = document.createElement('div'); li.style.cursor = 'pointer'; li.style.padding = '6px'; li.style.border = '1px solid rgba(0,0,0,0.06)'; li.style.borderRadius = '4px'; li.style.background = '#fff';
                    const txt = (item.el && (item.el.textContent || item.el.getAttribute && (item.el.getAttribute('aria-label') || item.el.getAttribute('role')))) ? (item.el.textContent || item.el.getAttribute('aria-label') || item.el.getAttribute('role')) : '';
                    li.textContent = `${num}. ${txt.toString().trim().replace(/\s+/g,' ').slice(0,140)}`;
                    li.addEventListener('click', (ev) => { ev.stopPropagation(); try { markerEls[num-1] && markerEls[num-1].click(); } catch (e) {} });
                    list.appendChild(li);
                  } catch (e) { /* ignore individual candidate errors */ }
                }

                const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.style.background = '#eee'; cancel.style.border = 'none'; cancel.style.padding = '8px 10px'; cancel.style.borderRadius = '4px'; cancel.style.cursor = 'pointer'; cancel.style.marginTop = '8px';
                cancel.addEventListener('click', () => { try { removeOverlayIfExists(); } catch (e) {} try { chosenResolver && chosenResolver(null); } catch (e) {} });

                wrap.appendChild(list); wrap.appendChild(cancel);
                document.documentElement.appendChild(wrap);

                // If caller requested a specific flag, attempt to auto-pick the correct marker
                let autoPicked = false;
                try {
                  if (typeof flag !== 'undefined' && flag !== null && ranked && ranked.length) {
                    const lower = s => (s || '').toString().trim().toLowerCase();
                    let pickIdx = -1;
                    if (flag) {
                      pickIdx = ranked.findIndex(item => { try { return lower(item.el && (item.el.textContent || item.el.getAttribute && item.el.getAttribute('aria-label'))) .includes('hide'); } catch (e) { return false; } });
                    } else {
                      pickIdx = ranked.findIndex(item => { try { const t = lower(item.el && (item.el.textContent || item.el.getAttribute && item.el.getAttribute('aria-label'))); return t.includes('boost') || t.includes('promote'); } catch (e) { return false; } });
                    }
                    if (pickIdx < 0) {
                      pickIdx = flag ? 0 : (ranked.length > 1 ? 1 : 0);
                    }
                    const picked = ranked[pickIdx];
                    if (picked && picked.el) {
                      try { removeOverlayIfExists(); } catch (e) {}
                      control = picked.el;
                      try { const sel = computeCssLocal(picked.el) || null; if (sel) { const map = await ffmGetSelectorMap(); map['attr_hide_from_friends'] = sel; await ffmSetSelectorMap(map); console.debug('setHideFromFriendsSimple: cached selector (auto-marker)', sel); } } catch (e) {}
                      autoPicked = true;
                    }
                  }
                } catch (e) { /* ignore auto-pick errors */ }

                // await user choice from markers (resolve with element or null) if not auto-picked
                let chosen = null;
                if (!autoPicked) {
                  let chosenResolver = null;
                  chosen = await new Promise((resolve) => { chosenResolver = resolve; });
                  // cleanup any remaining UI
                  try { removeOverlayIfExists(); } catch (e) {}
                  if (!chosen) {
                    console.debug('setHideFromFriendsSimple: user cancelled marker selection');
                    return false;
                  }
                  // control variable now points to chosen element
                  control = chosen;
                }
              }
            } catch (e) { console.debug('setHideFromFriendsSimple: marker overlay failed', e); }


            const tryClick = (el) => { try { el.click(); return true; } catch (e) { try { el.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) { return false; } } };

            // If it's an input checkbox/radio
            if (control.tagName && control.tagName.toLowerCase() === 'input') {
              const before = !!control.checked || control.getAttribute && control.getAttribute('aria-checked') === 'true';
              if ((!!before) !== !!flag) {
                // prefer clicking label or control
                if (!tryClick(control)) {
                  // try programmatic set
                  try { control.checked = !!flag; control.setAttribute && control.setAttribute('aria-checked', !!flag ? 'true' : 'false'); control.dispatchEvent(new Event('change',{bubbles:true})); } catch (e) {}
                }
                await new Promise(r=>setTimeout(r,160));
              }
              const after = !!control.checked || control.getAttribute && control.getAttribute('aria-checked') === 'true';
              return (!!after) === !!flag;
            }

            // Otherwise try role=switch elements (divs etc.)
            try {
              const isOn = control.getAttribute && control.getAttribute('aria-checked') === 'true';
              if ((!!isOn) !== !!flag) {
                if (!tryClick(control)) {
                  try { control.setAttribute && control.setAttribute('aria-checked', !!flag ? 'true' : 'false'); control.dispatchEvent(new Event('change',{bubbles:true})); control.dispatchEvent(new Event('input',{bubbles:true})); } catch (e) {}
                }
                await new Promise(r=>setTimeout(r,160));
              }
              const isNow = control.getAttribute && control.getAttribute('aria-checked') === 'true';
              return (!!isNow) === !!flag;
            } catch (e) { console.debug('setHideFromFriendsSimple: toggle error', e); return false; }
          } catch (err) { console.debug('setHideFromFriendsSimple error', err); return false; }
        }

        // If targeted toggle fails, fall back to deterministic keyboard focus sequence
        let hideToggled = false;
        try { hideToggled = await setHideFromFriendsSimple(listing.hideFromFriends); console.debug('populate-fb: setHideFromFriendsSimple result ->', hideToggled); } catch (e) { console.debug('populate-fb: setHideFromFriendsSimple threw', e); }
        if (!hideToggled) {
          // send 5 tabs then space to move focus past comfort-level controls (deterministic keyboard flow)
          await sendTabsThenSpace(5);
        }
        await setAttributeField(attributeMap.mattressType, getListingValue(['mattressType','mattress_type','type']));
        await setAttributeField(attributeMap.brand, getListingValue(['brand']));
        await setAttributeField(attributeMap.color, getListingValue(['color']));
        await setAttributeField(attributeMap.material, getListingValue(['material']));

  // ✅ Universal fallback "Next" clicker (copied from the working 2927 logic)
  async function clickNextButton_Fast4MP(label = 'Next') {
    // Collect all visible "Next" buttons
    const nexts = Array.from(document.querySelectorAll(`div[aria-label="${label}"]`));
    if (!nexts.length) {
      console.warn('[Fast4MP] No Next buttons found on page');
      return false;
    }

    // Pick the last visible candidate (bottom-most one)
    let best = null;
    for (const el of nexts) {
      try {
        const r = el.getBoundingClientRect();
        if (r.width > 40 && r.height > 15 && r.top >= 0 && r.bottom <= window.innerHeight) {
          best = el; // keep overwriting so we end up with the last visible
        }
      } catch (e) { /* ignore */ }
    }
    if (!best) best = nexts[nexts.length - 1];

    // Scroll into view and click
    try { best.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    await new Promise(r => setTimeout(r, 400));
    try { best.click(); } catch (e) { try { best.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e2) {} }

    console.log('[Fast4MP] ✅ Clicked "Next" on attempt (HFF stage)', best);
    return true;
  }

  // ---- Inside populate-fb sequence right after Hide From Friends (HFF) success ----
  // Try the universal fallback once and allow downstream delivery-detection to continue.
  const loaded = await (async () => { try { return await clickNextButton_Fast4MP(); } catch (e) { return false; } })();
  if (!loaded) console.debug('populate-fb: delivery step did not load within timeout after clicking Next');
  try { console.log(`[Fast4MP] Detected Marketplace layout variant: ${loaded ? 'A (Shipping)' : 'B (Local Only)'}`); } catch (e) {}
  // Helper: click Next nearest to a given anchor element (prefer nodes after anchor in DOM)
  async function clickNextNear(anchor) {
    try {
      if (!anchor) return await clickNextButton();
      // collect candidate Next nodes (buttons, spans, divs with text 'Next')
      const candidates = Array.from(document.querySelectorAll('button,[role="button"],span,div')).filter(el => {
        try { const t = (el.textContent||'').toString().trim().toLowerCase(); return !!t && t === 'next' && el.offsetParent !== null; } catch (e) { return false; }
      });
      if (!candidates || candidates.length === 0) return await clickNextButton();
      // find the candidate that appears after the anchor in DOM order (compare position)
      let best = null; let bestIdx = Infinity;
      const all = Array.from(document.querySelectorAll('*'));
      const anchorIdx = all.indexOf(anchor);
      if (anchorIdx < 0) return await clickNextButton();
      for (const c of candidates) {
        const idx = all.indexOf(c);
        if (idx >= 0 && idx > anchorIdx && idx < bestIdx) { bestIdx = idx; best = c; }
      }
      const target = best || candidates[0];
      try { try { ffmShowMarkerAt(target); } catch (e) {} await ffmTryHardClick(target); } catch (e) { try { target.click && target.click(); } catch (e2) {} }
      // If a simple click didn't activate, attempt a richer activation on an inner span or the element itself
      try {
        const inner = (target.querySelector && target.querySelector('span')) || target;
        try { await ffmTryRichActivation(inner); } catch (e) { try { await ffmTryRichActivation(target); } catch (e2) {} }
      } catch (e) {}
      return true;
    } catch (e) { try { return await clickNextButton(); } catch (e2) { return false; } }
  }
  // Helper: repeatedly attempt to click Next until the delivery step is detected or timeout
  async function clickNextUntilDelivery(timeoutMs = 35000) {
    const start = Date.now();
    let attempt = 0;
    const quickTexts = [/\bdelivery\b/i, /\bpickup\b/i, /\blocal pickup\b/i, /\bshipping\b/i, /\bdelivery method\b/i];
    const ariaCheck = (n) => { try { const a = (n.getAttribute && n.getAttribute('aria-label')) || ''; return !!a && /(local pickup|local delivery|pickup|delivery|shipping)/i.test(a); } catch (e) { return false; } };

    while (Date.now() - start < timeoutMs) {
      attempt++;
      try {
        // Prefer clicking the Next nearest the Hide From Friends control if we cached one
        let anchor = null;
        try { const map = await ffmGetSelectorMap(); if (map && map['attr_hide_from_friends']) anchor = document.querySelector(map['attr_hide_from_friends']); } catch (e) {}
        if (anchor) { await clickNextNear(anchor); } else { await clickNextButton(); }
        console.debug('populate-fb: clickNext attempt', attempt);
      } catch (e) { console.debug('populate-fb: clickNext attempt threw', e); }

      // Give FB some time to react (increasing backoff)
      await sleep(700 + Math.min(800, attempt * 120));

      // 1) URL-based detection
      try {
        const href = (window.location && window.location.href) ? window.location.href.toString() : '';
        if (href.indexOf('/marketplace/create/item') !== -1 && href.indexOf('step=delivery') !== -1) return true;
      } catch (e) {}

      // 2) Look for obvious delivery/pickup text anywhere (including out-of-flow nodes)
      try {
        const candidates = Array.from(document.querySelectorAll('[aria-label], span, div, label, button'));
        for (const n of candidates) {
          try {
            const txt = ((n.getAttribute && n.getAttribute('aria-label')) || n.textContent || '').toString().toLowerCase();
            if (!txt) continue;
            if (quickTexts.some(rx => rx.test(txt))) return true;
          } catch (e) {}
        }
      } catch (e) {}

      // 3) Look for headings/titles that often label the step
      try {
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,div[role="heading"]')).filter(h => h && h.textContent);
        if (headings.some(h => /(delivery|pickup|shipping|delivery method)/i.test(h.textContent || ''))) return true;
      } catch (e) {}

      // 4) Occasionally try a keyboard Enter in case FB listens to keyboard activation
      if (attempt % 3 === 0) {
        try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })); } catch (e) {}
      }

      // small backoff before next attempt
      await sleep(200);
    }

    // Final aggressive scan before giving up: try to detect any 'local'/'pickup' text anywhere (including attributes) and return that as success
    try {
      const all = Array.from(document.querySelectorAll('*'));
      for (const n of all) {
        try {
          const txt = ((n.getAttribute && n.getAttribute('aria-label')) || n.textContent || '').toString().toLowerCase();
          if (!txt) continue;
          if (/(local pickup|local delivery|pickup|delivery|shipping)/i.test(txt)) return true;
        } catch (e) {}
      }
    } catch (e) {}

    return false;
  }
    async function clickNextWithRetries(retries = 3) {
  try { if (window && window.ffm_debug) console.debug && console.debug('FFM-TRACE: clickNextWithRetries start, retries=' + retries); } catch (e) {}
      for (let i = 0; i < retries; i++) {
  try { await clickNextButton(); console.debug('populate-fb: clickNextWithRetries attempt', i+1); } catch (e) { console.debug('populate-fb: clickNextWithRetries error', e); }
        await sleep(400 + i * 200);
      }
    }

    // Detect whether current URL is the audience step
    function ffmIsAudienceUrl() {
      try {
        const url = (window && window.location && window.location.href) ? window.location.href : '';
        if (url.indexOf('step=audience') >= 0) return true;
        try { const sp = (new URL(url)).searchParams.get('step'); if (sp === 'audience') return true; } catch (e) {}
      } catch (e) {}
      return false;
    }

    // Heuristic: look for a visible review-before-publishing message on the page
    function ffmPageShowsReviewBeforePublish() {
      try {
        const bodyText = (document && document.body && document.body.innerText) ? document.body.innerText.toString().toLowerCase() : '';
        // common phrasing variants
        if (/to review before (publishing|publish)/i.test(bodyText)) return true;
        if (bodyText.indexOf('review') !== -1 && bodyText.indexOf('publish') !== -1) return true;

        // Specific toast/notice variants seen in FB flows (e.g. "Listing completed. You can now inspect the results and Click Publish...")
        const toastPhrases = [/(listing completed)/i, /(you can now inspect)/i, /(inspect the result)/i, /(click publish)/i, /(click to publish)/i];
        // scan nodes for toast-like messages and prefer ones that are visible and located in the lower-left quadrant
        const nodes = Array.from(document.querySelectorAll('div, span, p, label'));
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        for (const n of nodes) {
          try {
            const t = (n.textContent || '').toString().trim();
            if (!t) continue;
            const tl = t.toLowerCase();
            // quick body-level check first
            for (const re of toastPhrases) {
              if (re.test(tl)) {
                // ensure node is visible and roughly in lower-left area (heuristic)
                try {
                  const r = n.getBoundingClientRect && n.getBoundingClientRect();
                  if (!r) return true; // if no rect, assume visible
                  const isVisible = (r.width > 8 && r.height > 8) && (r.top + r.height > vh * 0.2) && (r.left < vw * 0.6);
                  if (isVisible) return true;
                } catch (e) { return true; }
              }
            }
            // fallback: combined 'review' + 'publish' in same node
            if (tl.indexOf('review') !== -1 && tl.indexOf('publish') !== -1) {
              try {
                const r = n.getBoundingClientRect && n.getBoundingClientRect();
                if (!r) return true;
                const isVisible = (r.width > 8 && r.height > 8);
                if (isVisible) return true;
              } catch (e) { return true; }
            }
          } catch (e) {}
        }
      } catch (e) {}
      return false;
    }

    // Kick off clicking Next until delivery step appears
      try {
        // Try to find the Marketplace-specific Next button using a more robust heuristic
        try {
          function findMarketplaceNext() {
            try {
              const candidates = Array.from(document.querySelectorAll('div[aria-label="Next"]'));
              for (const el of candidates) {
                try {
                  const rect = el.getBoundingClientRect();
                  const visible = rect.width > 50 && rect.height > 20 && rect.bottom < window.innerHeight && rect.top > 0;
                  if (!visible) continue;
                  const containerText = (el.closest('form, [role="main"], [aria-label]')?.innerText || '').toLowerCase();
                  if (containerText.includes('save draft')) continue;
                  if (containerText.includes('hide from friends') && !containerText.includes('marketplace')) continue;
                  return el;
                } catch (e) { /* ignore candidate errors */ }
              }
            } catch (e) { /* ignore */ }
            return null;
          }

          async function clickMarketplaceNextButton() {
            const nextBtn = findMarketplaceNext();
            if (!nextBtn) {
              console.warn('[Fast4MP] ⚠️ No correct Next button found in composer');
              return false;
            }
            try { nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            await new Promise(r => setTimeout(r, 300));
            try { nextBtn.click(); console.log('[Fast4MP] ✅ Clicked Marketplace Next button'); return true; } catch (e) { return false; }
          }

          // If we found a reliable Next, persist its clickable ancestor selector for future runs
          const candidate = findMarketplaceNext();
          if (candidate) {
            try {
              let toPersist = candidate;
              try { const anc = candidate.closest && (candidate.closest('button, [role="button"]')); if (anc) toPersist = anc; } catch (e) {}
              const sel = computeCssLocal(toPersist) || (toPersist.id ? `#${toPersist.id}` : null) || null;
              if (sel) {
                try { const map = await ffmGetSelectorMap(); map['ffm_next_button'] = sel; await ffmSetSelectorMap(map); console.debug('persisted ffm_next_button selector for Next:', sel); } catch (e) { console.debug('persist next selector error', e); }
              }
            } catch (e) { console.debug('compute/persist candidate selector failed', e); }
          }
        } catch (e) {}
    } catch (e) {}

    // Try to select the delivery method option
    async function selectDeliveryMethod(optionText) {
      try {
        // give delivery UI a bit more time to render interactive controls
        await sleep(800);
        const norm = s => (s || '').toString().trim().toLowerCase();
        const requested = norm(optionText || 'Local Pickup');

  // helper: persist a CSS-ish selector for the given element to ffm_selector_map
        async function persistDeliverySelector(el) {
          try {
            if (!el) return;
            // compute selector (prefer id)
            if (el.id) {
              const sel = `#${el.id}`;
              const map = await ffmGetSelectorMap();
              map['attr_delivery_method'] = sel;
              await ffmSetSelectorMap(map);
              // debug log removed
              return;
            }
            const parts = [];
            let node = el;
            while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
              let part = node.tagName.toLowerCase();
              if (node.className && typeof node.className === 'string') {
                const cls = node.className.trim().split(/\s+/).filter(Boolean);
                if (cls.length) part += '.' + cls.slice(0,2).join('.');
              }
              try {
                const parent = node.parentElement;
                if (parent) {
                  const idx = Array.from(parent.children || []).filter(n => n.tagName === node.tagName).indexOf(node) + 1;
                  if (idx > 1) part += `:nth-child(${idx})`;
                }
              } catch (e) {}
              parts.unshift(part);
              node = node.parentElement;
            }
            const sel = parts.join(' > ');
            if (sel) {
              const map = await ffmGetSelectorMap();
              map['attr_delivery_method'] = sel;
              await ffmSetSelectorMap(map);
              // debug log removed
            }
          } catch (e) { console.debug('persistDeliverySelector error', e); }
        }

        // helper: click an element, verify the selection applied, and persist selector
        async function tryClickAndConfirm(clickEl, controlEl) {
          try {
            if (!clickEl) return false;
            const tryClickOnce = async (el) => {
              try { el.click(); return true; } catch (e) { try { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; } catch (e2) { return false; } }
            };

            // attempt click(s)
            let acted = await tryClickOnce(clickEl);
            await sleep(220);

            // if not acted, try focus+keyboard
            if (!acted) {
              try { clickEl.focus && clickEl.focus(); } catch (e) {}
              try { clickEl.dispatchEvent && clickEl.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); clickEl.dispatchEvent && clickEl.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true })); } catch (e) {}
              await sleep(180);
            }

            // best-effort: dispatch pointer/mouseup events and trigger change/input on control to coax FB handlers
            try {
              try { clickEl.dispatchEvent && clickEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) {}
              try { clickEl.dispatchEvent && clickEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); } catch (e) {}
              try { clickEl.dispatchEvent && clickEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
              // also click the control element to ensure the widget registers the selection
              try { (controlEl || clickEl).click && (controlEl || clickEl).click(); } catch (e) {}
              try { (controlEl || clickEl).dispatchEvent && (controlEl || clickEl).dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
              try { (controlEl || clickEl).dispatchEvent && (controlEl || clickEl).dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}

              // Extra fallback: synthesize pointer/mouse events at the element's center coordinates
              try {
                if (typeof ffmSynthesizePointerClickAt === 'function') {
                  const r = clickEl.getBoundingClientRect && clickEl.getBoundingClientRect();
                  if (r && r.width > 0 && r.height > 0) {
                    const cx = Math.round(r.left + r.width / 2);
                    const cy = Math.round(r.top + r.height / 2);
                    try { ffmSynthesizePointerClickAt(cx, cy); } catch (e) {}
                    // try a couple of tiny offsets as some overlays only forward near-edge events
                    const offs = [[3,0],[-3,0],[0,3],[0,-3],[4,4],[-4,-4]];
                    for (const o of offs) {
                      try { ffmSynthesizePointerClickAt(cx + o[0], cy + o[1]); } catch (e) {}
                    }
                  }
                }
              } catch (e) {}
            } catch (e) {}

            // verify: look for multiple signals that the choice applied
            const requestedLower = requested;
            let ok = false;
            try {
              // 1) native select value
              if (controlEl && controlEl.tagName && controlEl.tagName.toLowerCase() === 'select') {
                const val = (controlEl.value || '').toString().toLowerCase();
                ok = val.includes(requestedLower) || val.includes('local');
                if (!ok) {
                  // also check visible selected option text
                  const opts = Array.from(controlEl.options || []);
                  ok = opts.some(o => ((o.selected || o.defaultSelected) && ((o.text || o.label || o.value) || '').toString().toLowerCase().includes(requestedLower)));
                }
              }

              // 2) aria-selected on options anywhere
              if (!ok) {
                const ariaMatch = Array.from(document.querySelectorAll('[role="option"], [aria-selected]')).find(n => {
                  try { const t = (n.textContent || n.getAttribute && n.getAttribute('aria-label') || '').toString().toLowerCase(); return (n.getAttribute && n.getAttribute('aria-selected') === 'true') && (t.includes(requestedLower) || t.includes('local')); } catch (e) { return false; }
                });
                if (ariaMatch) ok = true;
              }

              // 3) check control text content or nearby display that typically shows the chosen label
              if (!ok) {
                const checkContainer = (controlEl && controlEl.closest && controlEl.closest('div')) || controlEl || clickEl;
                const txt = (checkContainer && (checkContainer.textContent || '') || '').toString().toLowerCase();
                if (txt) ok = txt.includes(requestedLower) || txt.includes('local') || txt.includes('pickup') || txt.includes('pick up');
              }
            } catch (e) { ok = false; }

            // if not ok, try one more keyboard attempt and click on clickable ancestor(s) then re-check
            if (!ok) {
              try { (controlEl || clickEl).dispatchEvent && (controlEl || clickEl).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); (controlEl || clickEl).dispatchEvent && (controlEl || clickEl).dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })); } catch (e) {}
              await sleep(220);

              // if clickEl is nested, try its nearest clickable ancestor such as li/button
              try {
                const ancestor = clickEl.closest && (clickEl.closest('li') || clickEl.closest('button') || clickEl.closest('[role="option"]'));
                if (ancestor && ancestor !== clickEl) {
                  await tryClickOnce(ancestor);
                  await sleep(180);
                }
              } catch (e) {}

              try {
                const checkContainer = (controlEl && controlEl.closest && controlEl.closest('div')) || controlEl || clickEl;
                const txt = (checkContainer && (checkContainer.textContent || '') || '').toString().toLowerCase();
                if (txt) ok = txt.includes(requestedLower) || txt.includes('local') || txt.includes('pickup') || txt.includes('pick up');

                if (!ok) {
                  const ariaMatch2 = Array.from(document.querySelectorAll('[role="option"], [aria-selected]')).find(n => {
                    try { const t = (n.textContent || n.getAttribute && n.getAttribute('aria-label') || '').toString().toLowerCase(); return (n.getAttribute && n.getAttribute('aria-selected') === 'true') && (t.includes(requestedLower) || t.includes('local')); } catch (e) { return false; }
                  });
                  if (ariaMatch2) ok = true;
                }
              } catch (e) { ok = false; }
            }

            if (ok) {
              // After a successful selection, try to proactively choose a more specific
              // "Local" delivery checkbox/menuitem (FB sometimes opens a second list
              // of menuitemcheckbox elements for delivery options). We'll look for
              // menuitemcheckbox/menuitem/option nodes whose aria-label or text
              // contains 'local' or 'pickup' and try to click/verify them.
              try {
                const tryLocalCandidates = async () => {
                  try {
                    const candSel = '[role="menuitemcheckbox"], [role="menuitem"], [role="option"]';
                    const nodes = Array.from(document.querySelectorAll(candSel)).filter(n => n && n.offsetParent !== null && (n.getAttribute && (n.getAttribute('aria-label') || '') || n.textContent || '').toString().trim() !== '');
                    if (!nodes || !nodes.length) return false;
                    // prioritize ones that explicitly mention 'local delivery' or 'local pickup'
                    const prefer = nodes.filter(n => {
                      try { const txt = ((n.getAttribute && n.getAttribute('aria-label')) || n.textContent || '').toString().toLowerCase(); return txt.includes('local delivery') || txt.includes('local pickup') || txt.includes('local pickup'); } catch (e) { return false; }
                    });
                    const pool = (prefer.length ? prefer : nodes).filter(n => {
                      try { const t = ((n.getAttribute && n.getAttribute('aria-label')) || n.textContent || '').toString().toLowerCase(); return t.includes('local') || t.includes('pickup') || t.includes('delivery'); } catch (e) { return false; }
                    });

                    for (const n of pool) {
                      try {
                        // if already checked, we're done
                        try { if (n.getAttribute && n.getAttribute('aria-checked') === 'true') { return true; } } catch (e) {}
                        // try clicking the candidate
                        let actedLocal = false;
                        try { actedLocal = await tryClickOnce(n); } catch (e) { actedLocal = false; }
                        await sleep(800);
                        // verify via aria-checked or nearby text change
                        try {
                          const now = (n.getAttribute && n.getAttribute('aria-checked')) || '';
                          if (now === 'true') {
                            try { await persistDeliverySelector(n); } catch (e) {}
                            return true;
                          }
                        } catch (e) {}
                        // fallback: if clicking ancestor changed its state
                        try {
                          const ancChecked = n.closest && n.closest('[aria-checked="true"]');
                          if (ancChecked) {
                            try { await persistDeliverySelector(n); } catch (e) {}
                            return true;
                          }
                        } catch (e) {}
                      } catch (e) { /* ignore candidate error and continue */ }
                    }
                  } catch (e) { /* ignore */ }
                  return false;
                };

                try {
                  const localOk = await tryLocalCandidates();
                  if (localOk) {
                    console.debug('selectDeliveryMethod: ensured specific Local delivery option was selected');
                  }
                } catch (e) { /* non-fatal */ }
              } catch (e) {}

              // After successful selection, press ArrowDown then Enter to confirm
              try {
                const keyTarget = (controlEl || clickEl) || document;
                try { keyTarget.dispatchEvent && keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })); } catch (e) {}
                try { keyTarget.dispatchEvent && keyTarget.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })); } catch (e) {}
                await sleep(120);
                try { keyTarget.dispatchEvent && keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); } catch (e) {}
                try { keyTarget.dispatchEvent && keyTarget.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })); } catch (e) {}
                await sleep(180);
              } catch (e) { /* non-fatal */ }

              try { await persistDeliverySelector(controlEl || clickEl); } catch (e) {}
              return true;
            }

            return false;
          } catch (e) { console.debug('tryClickAndConfirm error', e); return false; }
        }

        // Robust pointer/key click sequence that mimics a real user interaction
        async function ffmTryHardClick(el) {
          if (!el) return false;
          try {
            try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
            // dispatch a sequence of pointer and mouse events
            try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); } catch (e) {}
            try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true })); } catch (e) {}
            try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) {}
            try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
            try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
            try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {}
            try { el.dispatchEvent && el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); } catch (e) {}
            // small pause for React/FB to process
            await new Promise(r => setTimeout(r, 30));
            // Fallback: keyboard Enter if aria-checked didn't flip
            try {
              if (el.getAttribute && el.getAttribute('aria-checked') === 'false') {
                try { el.focus && el.focus(); } catch (e) {}
                try { el.dispatchEvent && el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } catch (e) {}
                try { el.dispatchEvent && el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {}
                await new Promise(r => setTimeout(r, 30));
              }
            } catch (e) {}
            return true;
          } catch (err) {
            try { console.warn('[Fast4MP] ffmTryHardClick failed:', err); } catch (e) {}
            return false;
          }
        }

        // FAST PATH: try cached selector first to avoid re-detection
        try {
          const map = await ffmGetSelectorMap();
          const cached = map && map['attr_delivery_method'];
          if (cached && typeof cached === 'string') {
            try {
              let cachedEl = null;
              if (cached.indexOf('xpath:') === 0) {
                // xpath not used currently, skip
              } else {
                try { cachedEl = document.querySelector(cached); } catch (e) { cachedEl = null; }
              }
              if (cachedEl) {
                console.debug('selectDeliveryMethod: trying cached selector', cached, cachedEl);
                // If native select, set value directly
                if (cachedEl.tagName && cachedEl.tagName.toLowerCase() === 'select') {
                  try {
                    const opts = Array.from(cachedEl.options || []);
                    const matchOpt = opts.find(o => (o.text || o.label || o.value || '').toString().toLowerCase().includes(requested) || (o.text || o.label || o.value || '').toString().toLowerCase().includes('local'));
                    if (matchOpt) {
                      cachedEl.value = matchOpt.value;
                      cachedEl.dispatchEvent(new Event('change', { bubbles: true }));
                      console.debug('selectDeliveryMethod: set native select via cached selector ->', matchOpt.text);
                      return true;
                    }
                  } catch (e) { console.debug('selectDeliveryMethod: cached select set failed', e); }
                }

                // Try to open cached element and pick an option from visible options nearby
                try { cachedEl.scrollIntoView({ block: 'center' }); } catch (e) {}
                try { cachedEl.click(); } catch (e) { try { cachedEl.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
                await sleep(600);

                const optionSelectorsFast = ['[role="option"]', '[role="menuitem"]', 'li', 'div[role="option"]', 'button'];
                let optionsFast = [];
                for (const sel of optionSelectorsFast) {
                  const nodes = Array.from(document.querySelectorAll(sel)).filter(n => n && n.offsetParent !== null && (n.textContent || '').trim() !== '');
                  if (nodes.length) { optionsFast = nodes; break; }
                }
                // narrow by proximity to cachedEl
                try {
                  if (optionsFast.length && cachedEl.getBoundingClientRect) {
                    const aRect = cachedEl.getBoundingClientRect();
                    optionsFast = optionsFast.filter(o => { try { const r = o.getBoundingClientRect(); return Math.abs(r.top - aRect.top) < 800; } catch (e) { return true; } });
                  }
                } catch (e) {}

                const matchFast = optionsFast.find(o => (o.textContent || '').toString().toLowerCase().includes(requested) || ((o.getAttribute && (o.getAttribute('aria-label') || '')).toLowerCase().includes(requested)));
                if (matchFast) {
                  try {
                    const ok = await tryClickAndConfirm(matchFast, cachedEl);
                    if (ok) { console.debug('selectDeliveryMethod: clicked option via cached selector', matchFast.textContent); return true; }
                  } catch (e) { console.debug('selectDeliveryMethod: matchFast click failed', e); }
                }

                const fallbackFast = optionsFast.find(o => (o.textContent || '').toString().toLowerCase().includes('local'));
                if (fallbackFast) {
                  try {
                    const ok = await tryClickAndConfirm(fallbackFast, cachedEl);
                    if (ok) { console.debug('selectDeliveryMethod: clicked fallback local via cached selector', fallbackFast.textContent); return true; }
                  } catch (e) { console.debug('selectDeliveryMethod: fallbackFast click failed', e); }
                }
              }
            } catch (e) { console.debug('selectDeliveryMethod: cached selector attempt threw', e); }
          }
        } catch (e) { console.debug('selectDeliveryMethod: selector cache read failed', e); }

        // try to find a label-like anchor by exact text or known id
        const start = Date.now();
        const timeout = 10000;
        let anchor = null;
        while (!anchor && Date.now() - start < timeout) {
          anchor = Array.from(document.querySelectorAll('label, span, div')).find(n => {
            try {
              const id = n.id || '';
              const t = (n.textContent || '').toString().trim().toLowerCase();
              if (id === '_r_4r_') return true;
              if (!t) return false;
              return t === 'delivery method' || t.includes('delivery method') || t === 'delivery' || t.includes('delivery');
            } catch (e) { return false; }
          });
          if (anchor) break;
          await sleep(250);
        }

        // fallback: look for any element with id _r_4r_ directly
        if (!anchor) anchor = document.getElementById('_r_4r_') || null;

        if (!anchor) {
          // as a last resort find any element containing the words 'delivery' nearby
          anchor = Array.from(document.querySelectorAll('span,div,label')).find(el => { try { return (el.textContent || '').toLowerCase().includes('delivery'); } catch (e) { return false; } });
        }

        if (!anchor) {
          console.debug('selectDeliveryMethod: no delivery anchor found');
          return false;
        }

        // find a control near the anchor (select/combobox/button)
        let control = null;
        try {
          const preferSel = 'select, [role="combobox"], div[role="button"], button, [role="button"]';
          if (anchor.nextElementSibling && anchor.nextElementSibling.matches && anchor.nextElementSibling.matches(preferSel) && anchor.nextElementSibling.offsetParent !== null) {
            control = anchor.nextElementSibling;
          }
          if (!control) {
            let node = anchor;
            for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
              try { const found = node.querySelector && node.querySelector(preferSel); if (found && found.offsetParent !== null) { control = found; break; } } catch (e) {}
            }
          }
          if (!control) {
            const vicinity = Array.from((anchor.parentElement || document).querySelectorAll(preferSel)).filter(n => n && n.offsetParent !== null);
            if (vicinity.length) control = vicinity[0];
          }
        } catch (e) {}

        if (!control) {
          control = document.querySelector('select[name*="delivery"], [aria-label*="Delivery"], [role="combobox"], div[role="button"], button');
        }

        if (!control) {
          console.debug('selectDeliveryMethod: could not locate control for delivery');
          return false;
        }

        // If it's a native select element, try setting the option
        if (control.tagName && control.tagName.toLowerCase() === 'select') {
          const opts = Array.from(control.options || []);
          const matchOpt = opts.find(o => norm(o.text || o.label || o.value).includes(requested) || norm(o.text || o.label || o.value).includes('local'));
          if (matchOpt) {
            try {
              control.value = matchOpt.value;
              control.dispatchEvent(new Event('change', { bubbles: true }));
              try { await persistDeliverySelector(control); } catch (e) {}
              console.debug('selectDeliveryMethod: set native select to', matchOpt.text);
              return true;
            } catch (e) { console.debug('selectDeliveryMethod: failed to set native select', e); }
          }
        }

  // Diagnostic DOM dump helper: accepts a single element or an array and logs detailed attributes
  function ffmDiagnosticDump(nodes, label) {
    try {
      const arr = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : []);
      const dump = arr.slice(0,200).map(n => {
        try {
          const rect = (n && n.getBoundingClientRect) ? n.getBoundingClientRect() : null;
          const style = (n && window.getComputedStyle) ? window.getComputedStyle(n) : null;
          const at = (typeof n.getAttribute === 'function') ? (attr => { try { return n.getAttribute(attr); } catch(e){ return null; } }) : (() => null);
          const fromPoint = rect && document.elementFromPoint ? document.elementFromPoint(Math.round(rect.left + 2), Math.round(rect.top + 2)) : null;
          return {
            tag: n.tagName,
            id: n.id || null,
            role: at('role') || null,
            ariaLabel: at('aria-label') || null,
            ariaHidden: at('aria-hidden') || null,
            ariaDisabled: at('aria-disabled') || null,
            ariaChecked: at('aria-checked') || null,
            ariaSelected: at('aria-selected') || null,
            tabindex: at('tabindex') || null,
            class: (n.className || '').toString().slice(0,200),
            text: (n.textContent || '').toString().trim().slice(0,200),
            visible: n.offsetParent !== null,
            rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
            pointerEvents: style ? style.pointerEvents : null,
            computedDisplay: style ? style.display : null,
            elementFromPoint: fromPoint ? (fromPoint.tagName + (fromPoint.id ? ('#' + fromPoint.id) : '')) : null
          };
        } catch (e) { return { error: String(e) }; }
      });
      try { console.debug('ffmDiagnosticDump: ' + (label||'nodes') + ' (first ' + dump.length + ') ->', dump); } catch (e) {}
      return dump;
    } catch (e) { try { console.debug('ffmDiagnosticDump failed', e); } catch (e) {} return null; }
  }

  // Wait until a Facebook button with matching aria-label becomes truly clickable, then dispatch realistic mouse events
  async function waitAndClickFBButton(label = 'Next', timeout = 8000) {
    try {
      const start = Date.now();
      const normLabel = (label || '').toString().trim().toLowerCase();
      while (Date.now() - start < (timeout || 8000)) {
        try {
          const btn = Array.from(document.querySelectorAll('div[aria-label], button[aria-label], [role="button"][aria-label]'))
            .find(el => (el.getAttribute && (el.getAttribute('aria-label') || '').toString().toLowerCase().includes(normLabel)));
          if (btn) {
            const style = window.getComputedStyle && window.getComputedStyle(btn);
            const blockedAncestor = btn.closest && (btn.closest('[aria-hidden="true"], [aria-disabled="true"]'));
            if (style && style.pointerEvents !== 'none' && !blockedAncestor && btn.offsetParent !== null) {
              try { if (document.activeElement && document.activeElement.closest && document.activeElement.closest('[aria-hidden="true"]')) document.activeElement.blur(); } catch (e) {}
              try {
                const rect = btn.getBoundingClientRect && btn.getBoundingClientRect();
                const clientX = rect ? Math.round(rect.left + (rect.width || 0) / 2) : 2;
                const clientY = rect ? Math.round(rect.top + (rect.height || 0) / 2) : 2;
                const evOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
                ['mouseover','mousedown','mouseup','click'].forEach(t => { try { btn.dispatchEvent(new MouseEvent(t, evOpts)); } catch (e) {} });
                try { console.debug('waitAndClickFBButton: ✅ FB button clicked:', btn); } catch (e) {}
                return true;
              } catch (e) { try { console.debug('waitAndClickFBButton: click dispatch failed', e); } catch (e) {} }
            }
          }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 250));
      }
      try { console.warn('waitAndClickFBButton: Button never became clickable for label=' + label); } catch (e) {}
      return false;
    } catch (e) { try { console.debug('waitAndClickFBButton: helper error', e); } catch (e) {} return false; }
  }

        // Otherwise open the control and look for visible options
        try { control.scrollIntoView({ block: 'center' }); } catch (e) {}
        try { control.click(); } catch (e) { try { control.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
        await sleep(600);

        const optionSelectors = ['[role="option"]', '[role="menuitem"]', 'li', 'div[role="option"]', 'button'];
        let options = [];
        for (const sel of optionSelectors) {
          const nodes = Array.from(document.querySelectorAll(sel)).filter(n => n && n.offsetParent !== null && (n.textContent || '').trim() !== '');
          if (nodes.length) { options = nodes; break; }
        }

        // If no options found, try a more aggressive open sequence (keyboard + mouse) and broaden the option search
        if ((!options || options.length === 0)) {
          try {
            if (control.focus) try { control.focus(); } catch (e) {}
            // try a few times: mousedown/mouseup/click, Space, ArrowDown to coax custom dropdowns
            for (let attempt = 0; attempt < 3 && (!options || options.length === 0); attempt++) {
              try {
                try { control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); control.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
                try { control.click(); } catch (e) { try { control.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
                await sleep(250 + attempt * 150);

                // send Space then ArrowDown
                try { control.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); control.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true })); } catch (e) {}
                await sleep(200);
                try { control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })); control.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })); } catch (e) {}
                await sleep(300 + attempt * 150);

                // broaden search: include spans/divs/buttons with text
                const broad = Array.from(document.querySelectorAll('div, span, li, button')).filter(n => n && n.offsetParent !== null && (n.textContent || '').trim() !== '');
                // prefer ones near the control by vertical distance
                if (broad.length && control.getBoundingClientRect) {
                  try {
                    const aRect = control.getBoundingClientRect();
                    broad.sort((a,b) => { try { return Math.abs(a.getBoundingClientRect().top - aRect.top) - Math.abs(b.getBoundingClientRect().top - aRect.top); } catch (e) { return 0; } });
                  } catch (e) {}
                }
                options = broad.filter(n => {
                  try {
                    const txt = (n.textContent || '').toString().toLowerCase();
                    return txt.includes('local') || txt.includes('pickup') || txt.includes('delivery') || txt.includes('pick up');
                  } catch (e) { return false; }
                });
              } catch (e) {}
            }
          } catch (e) { console.debug('selectDeliveryMethod: aggressive open failed', e); }
        }

        // prefer exact/contains match against requested, then any 'local' option
        let matched = options.find(o => (o.textContent || '').toLowerCase().includes(requested) || ((o.getAttribute && (o.getAttribute('aria-label') || '')).toLowerCase().includes(requested)));
        if (matched) {
          try {
            const ok = await tryClickAndConfirm(matched, control);
            if (ok) { console.debug('selectDeliveryMethod: clicked option', matched.textContent); return true; }
          } catch (e) { console.debug('selectDeliveryMethod: matched click failed', e); }
        }

        matched = options.find(o => (o.textContent || '').toLowerCase().includes('local'));
        if (matched) {
          try {
            const ok = await tryClickAndConfirm(matched, control);
            if (ok) { console.debug('selectDeliveryMethod: clicked fallback local option', matched.textContent); return true; }
          } catch (e) { console.debug('selectDeliveryMethod: fallback matched click failed', e); }
        }

        console.debug('selectDeliveryMethod: no matching delivery option found', options.slice(0, 8).map(o => (o.textContent || '').trim()));

          // Before falling back to the overlay, aggressively try to find and
          // click specific 'Local pickup' / 'Local delivery' menu items. FB often
          // renders these as menuitemcheckbox/menuitem nodes; we'll try several
          // click strategies (descendant click, pointer events, keyboard) and
          // verify aria-checked after each attempt.
          try {
            // First: try a visibility-agnostic search for elements whose aria-label
            // explicitly says 'Local pickup' or 'Local delivery'. FB sometimes
            // renders these out of flow so offsetParent may be null; don't filter.
            try {
              const ariaCandidates = Array.from(document.querySelectorAll('[role="menuitemcheckbox"][aria-label], [role="menuitem"][aria-label], [role="option"][aria-label]'));
              for (const ac of ariaCandidates) {
                try {
                  const al = (ac.getAttribute && ac.getAttribute('aria-label') || '').toString().toLowerCase().trim();
                  if (!al) continue;
                  if (al === 'local pickup' || al === 'local delivery' || al.includes('local pickup') || al.includes('local delivery')) {
                    // try clicking its inner cover (data-visualcompletion/role=none/inset), then inner span/div, then itself
                    const cover = (ac.querySelector && (ac.querySelector('[data-visualcompletion]') || ac.querySelector('[role="none"]') || ac.querySelector('[data-visualcompletion="ignore"]') || Array.from(ac.querySelectorAll('*')).find(x=>{ try { return (x.getAttribute && (x.getAttribute('style')||'')).includes('inset:'); } catch(e){ return false; } }))) || null;
                    const inner = (ac.querySelector && (ac.querySelector('span') || ac.querySelector('div') || ac.querySelector('button'))) || null;
                    const targets = cover ? [cover, inner, ac].filter(Boolean) : (inner ? [inner, ac] : [ac]);
                    for (const t of targets) {
                      try {
                        try { t.scrollIntoView({ block: 'center' }); } catch (e) {}
                        try { t.dispatchEvent && t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) {}
                        try { t.dispatchEvent && t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); } catch (e) {}
                        try { t.click && t.click(); } catch (e) { try { t.dispatchEvent && t.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e2) {} }
                        await sleep(220);
                        // verify aria-checked on the item
                        try { if (ac.getAttribute && ac.getAttribute('aria-checked') === 'true') { try { await persistDeliverySelector(ac); } catch (e) {} console.debug('selectDeliveryMethod: clicked aria-labelled Local candidate', al); return true; } } catch (e) {}
                        try { const anc = ac.closest && ac.closest('[aria-checked="true"]'); if (anc) { try { await persistDeliverySelector(ac); } catch (e) {} console.debug('selectDeliveryMethod: clicked aria-labelled Local candidate (ancestor checked)', al); return true; } } catch (e) {}
                      } catch (e) { /* ignore and continue with other targets */ }
                    }
                    // If direct dispatch/clicks didn't work, try clicking at the candidate's
                    // center using elementFromPoint which often triggers FB handlers when
                    // dispatchEvent alone doesn't. Also try ancestor chain clicks.
                    try {
                      try {
                        const r = ac.getBoundingClientRect && ac.getBoundingClientRect();
                        if (r && r.width > 0 && r.height > 0) {
                          const cx = r.left + r.width / 2;
                          const cy = r.top + r.height / 2;
                          const at = document.elementFromPoint(cx, cy) || ac;
                          if (at) {
                            // try clicking the element at point and its ancestors up to ac
                            let curr = at;
                            for (let depth = 0; depth < 8 && curr; depth++, curr = curr.parentElement) {
                              try {
                                try { curr.dispatchEvent && curr.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy })); } catch (e) {}
                                try { curr.dispatchEvent && curr.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy })); } catch (e) {}
                                try { curr.dispatchEvent && curr.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy })); } catch (e) {}
                                try { curr.dispatchEvent && curr.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy })); } catch (e) {}
                                try { curr.dispatchEvent && curr.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy })); } catch (e) {}
                                await sleep(180);
                                try { if (ac.getAttribute && ac.getAttribute('aria-checked') === 'true') { try { await persistDeliverySelector(ac); } catch (e) {} console.debug('selectDeliveryMethod: clicked via elementFromPoint and ancestor', al); return true; } } catch (e) {}
                                try { const anc2 = ac.closest && ac.closest('[aria-checked="true"]'); if (anc2) { try { await persistDeliverySelector(ac); } catch (e) {} console.debug('selectDeliveryMethod: clicked via elementFromPoint (ancestor checked)', al); return true; } } catch (e) {}
                              } catch (e) {}
                            }
                          }
                        }
                      } catch (e) {}
                    } catch (e) {}
                  }
                } catch (e) {}
              }
            } catch (e) {}

            const exactSel = '[role="menuitemcheckbox"], [role="menuitem"], [role="option"]';
            const exactNodesAll = Array.from(document.querySelectorAll(exactSel));
            const exactNodes = exactNodesAll.filter(n => n && n.offsetParent !== null);
            if (exactNodes.length) {
              for (const n of exactNodes) {
                try {
                  const aria = (n.getAttribute && n.getAttribute('aria-label')) || '';
                  const txt = ((aria) || n.textContent || '').toString().toLowerCase().trim();
                  if (!txt) continue;
                  // match close variants
                  if (!(txt.includes('local') && (txt.includes('pickup') || txt.includes('delivery')) || txt === 'local pickup' || txt === 'local delivery' || txt.includes('local pickup') || txt.includes('local delivery'))) continue;

                  // If already selected, persist and return
                  try { if (n.getAttribute && n.getAttribute('aria-checked') === 'true') { try { await persistDeliverySelector(n); } catch (e) {} console.debug('selectDeliveryMethod: Local candidate already selected ->', txt); return true; } } catch (e) {}

                  // Try a few click strategies for this node
                  const tryStrategies = async (el) => {
                    try {
                      // 1) Prefer any inner overlay/cover element FB uses (role=none, data-visualcompletion, or inset cover),
                      // then try inner span/div/button, then the node itself.
                      const cover = (el.querySelector && (el.querySelector('[data-visualcompletion]') || el.querySelector('[data-visualcompletion="ignore"]') || el.querySelector('[role="none"]') || Array.from(el.querySelectorAll('*')).find(x=>{ try { return (x.getAttribute && x.getAttribute('style') || '').includes('inset:'); } catch(e){ return false; } }))) || null;
                      const inner = (el.querySelector && (el.querySelector('span') || el.querySelector('div') || el.querySelector('button'))) || null;
                      const targets = cover ? [cover].concat(inner ? [inner, el] : [el]) : (inner ? [inner, el] : [el]);
                      for (const t of targets) {
                        try {
                          try { t.scrollIntoView({ block: 'center' }); } catch (e) {}
                          // dispatch pointerdown/up + click
                          try { t.dispatchEvent && t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) {}
                          try { t.dispatchEvent && t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); } catch (e) {}
                          try { t.dispatchEvent && t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
                          try { t.dispatchEvent && t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
                          try { t.click && t.click(); } catch (e) { try { t.dispatchEvent && t.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e2) {} }
                          // send Space/Enter as keyboard fallback
                          try { t.dispatchEvent && t.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); t.dispatchEvent && t.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true })); } catch (e) {}
                          try { t.dispatchEvent && t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); t.dispatchEvent && t.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })); } catch (e) {}
                          await sleep(220);
                          // verify
                          try { if (n.getAttribute && n.getAttribute('aria-checked') === 'true') return true; } catch (e) {}
                          try { const anc = n.closest && n.closest('[aria-checked="true"]'); if (anc) return true; } catch (e) {}
                        } catch (e) {}
                      }
                      // final attempt: pass to generic tryClickAndConfirm as last resort
                      try {
                        const res = await tryClickAndConfirm(n, control);
                        if (res) return true;
                      } catch (e) {}
                    } catch (e) {}
                    return false;
                  };

                  const ok = await tryStrategies(n);
                  if (ok) {
                    try { await persistDeliverySelector(n); } catch (e) {}
                    console.debug('selectDeliveryMethod: direct Local candidate click succeeded ->', txt.slice(0,120));
                    return true;
                  }
                } catch (e) { /* ignore node errors */ }
              }
            }
          } catch (e) { console.debug('selectDeliveryMethod: direct Local candidate search failed', e); }

          // Targeted combobox search: prefer clicking a combobox label control
          // (e.g. <label role="combobox">) whose accessible name references
          // the delivery field. This avoids clicking unrelated elements.
          try {
            const comboCandidates = Array.from(document.querySelectorAll('label[role="combobox"], [role="combobox"]'));
            for (const cb of comboCandidates) {
              try {
                const nameFromAria = (cb.getAttribute && (cb.getAttribute('aria-label') || '')) || '';
                const labelledBy = (cb.getAttribute && cb.getAttribute('aria-labelledby')) || '';
                let labelledText = '';
                try {
                  if (labelledBy) {
                    const ids = labelledBy.split(/\s+/).filter(Boolean);
                    labelledText = ids.map(id => { try { const el = document.getElementById(id); return el ? (el.textContent || '') : ''; } catch (e) { return ''; } }).join(' ');
                  }
                } catch (e) {}
                const visibleText = ((cb.textContent || '') + ' ' + nameFromAria + ' ' + labelledText).toString().toLowerCase();
                if (!visibleText.includes('delivery') && !visibleText.includes('delivery method') && !visibleText.includes('delivery options') && !visibleText.includes('local')) continue;

                // Click the combobox to open its menu
                try { cb.scrollIntoView({ block: 'center' }); } catch (e) {}
                try { cb.dispatchEvent && cb.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); } catch (e) {}
                try { cb.click && cb.click(); } catch (e) { try { cb.dispatchEvent && cb.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
                await sleep(260);

                // After opening, first try exact text matches (visible first), e.g. span text === 'Local pickup'.
                const wanted = ['local pickup', 'local delivery', 'local pick up', 'local'];
                const gatherNodes = () => Array.from(document.querySelectorAll('span, div, li, button, [role="option"], [role="menuitem"], [role="menuitemcheckbox"]'));
                let exactNodes = gatherNodes().filter(n => {
                  try { const t = (n.textContent || '').toString().trim().toLowerCase(); return wanted.includes(t); } catch (e) { return false; }
                });
                // prefer visible exact nodes first
                let visibleExact = exactNodes.filter(n => n && n.offsetParent !== null);
                if (visibleExact.length === 0) visibleExact = exactNodes; // fall back to out-of-flow exact nodes
                for (const exn of visibleExact) {
                  try {
                    const ok = await tryClickAndConfirm(exn, cb);
                    if (ok) {
                      try { await persistDeliverySelector(exn); } catch (e) {}
                      console.debug('selectDeliveryMethod: clicked exact Local option ->', (exn.textContent || exn.getAttribute && exn.getAttribute('aria-label') || '').toString().slice(0,120));
                      return true;
                    }
                  } catch (e) {}
                }

                // If no exact match, fall back to regex-filtered local options but reject shipping-like options
                const postOptionsSel = '[role="option"],[role="menuitem"],[role="menuitemcheckbox"], li, div, span, button';
                const postOptions = Array.from(document.querySelectorAll(postOptionsSel));
                const localRe = /\b(local|pickup|pick up|delivery)\b/;
                const shipRe = /\b(ship|shipping|shipper|shipped|shipment|ship to)\b/;
                const localOptions = postOptions.filter(n => {
                  try {
                    const a = (n.getAttribute && (n.getAttribute('aria-label') || '')) || '';
                    const t = (n.textContent || '');
                    const j = (a + ' ' + t).toLowerCase();
                    return localRe.test(j) && !shipRe.test(j);
                  } catch (e) { return false; }
                });
                for (const lo of localOptions) {
                  try {
                    const ok = await tryClickAndConfirm(lo, cb);
                    try {
                      const finalText = ((lo.getAttribute && lo.getAttribute('aria-label')) || lo.textContent || '').toString().toLowerCase();
                      if (ok && localRe.test(finalText) && !shipRe.test(finalText)) {
                        try { await persistDeliverySelector(lo); } catch (e) {}
                        console.debug('selectDeliveryMethod: clicked Local via combobox target ->', finalText.slice(0,120));
                        return true;
                      }
                    } catch (e) {
                      if (ok) {
                        try { await persistDeliverySelector(lo); } catch (e) {}

                
                        console.debug('selectDeliveryMethod: clicked Local via combobox target (unverified text)');
                        return true;
                      }
                    }
                  } catch (e) {}
                }
              } catch (e) {}
            }
          } catch (e) { console.debug('selectDeliveryMethod: combobox targeted search errored', e); }

          // Final aggressive global search: simpler, low-nesting implementation.
          try {
            const nodes = Array.from(document.querySelectorAll('[aria-label], [role="option"], [role="menuitem"], [role="menuitemcheckbox"], span, div, li, button'));
            for (const gc of nodes) {
              try {
                const combined = (((gc.getAttribute && gc.getAttribute('aria-label')) || '') + ' ' + (gc.textContent || '')).toString().toLowerCase();
                if (!combined) continue;
                if (!(combined.includes('local') && (combined.includes('pickup') || combined.includes('pick up') || combined.includes('delivery')))) continue;

                // Try robust click via tryClickAndConfirm when available
                try {
                  const ok = await tryClickAndConfirm(gc, gc);
                  if (ok) { try { await persistDeliverySelector(gc); } catch (e) {} console.debug('selectDeliveryMethod: clicked global candidate via tryClickAndConfirm ->', combined); return true; }
                } catch (e) {}

                // Fallback: elementFromPoint center click and small synthesized pointer clicks
                try {
                  const r = gc.getBoundingClientRect && gc.getBoundingClientRect();
                  if (r && r.width > 0 && r.height > 0) {
                    const cx = Math.round(r.left + r.width / 2);
                    const cy = Math.round(r.top + r.height / 2);
                    const at = document.elementFromPoint(cx, cy) || gc;
                    if (at) {
                      try { at.click && at.click(); } catch (e) {}
                      try { at.dispatchEvent && at.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy })); } catch (e) {}
                      await sleep(220);
                      if ((gc.getAttribute && gc.getAttribute('aria-checked') === 'true') || (gc.getAttribute && gc.getAttribute('aria-selected') === 'true') || (gc.textContent || '').toLowerCase().includes('local')) {
                        try { await persistDeliverySelector(gc); } catch (e) {}
                        console.debug('selectDeliveryMethod: clicked global elementFromPoint candidate ->', combined);
                        return true;
                      }
                      // try synthesized pointer at a few offsets
                      if (typeof ffmSynthesizePointerClickAt === 'function') {
                        try { ffmSynthesizePointerClickAt(cx, cy); } catch (e) {}
                        const offs = [[3,0],[-3,0],[0,3],[0,-3]];
                        for (const o of offs) { try { ffmSynthesizePointerClickAt(cx + o[0], cy + o[1]); } catch (e) {} }
                        await sleep(200);
                        if ((gc.getAttribute && gc.getAttribute('aria-checked') === 'true') || (gc.getAttribute && gc.getAttribute('aria-selected') === 'true') || (gc.textContent || '').toLowerCase().includes('local')) {
                          try { await persistDeliverySelector(gc); } catch (e) {}
                          console.debug('selectDeliveryMethod: clicked global synthesized pointer candidate ->', combined);
                          return true;
                        }
                      }
                    }
                  }
                } catch (e) {}
              } catch (e) {}
            }
          } catch (e) { console.debug('selectDeliveryMethod: global Local candidate search errored', e); }

          // Overlay fallback removed — not needed. If we reach here, no reliable
          // automatic delivery option was found.
          try {
            if (window && window.ffm_debug) {
              try {
                const cand = Array.from(document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="option"], [aria-label], span, div, button')).slice(0,60);
                const dump = cand.map(n => ({ tag: n.tagName, aria: n.getAttribute && n.getAttribute('aria-label'), text: (n.textContent||'').toString().trim().slice(0,120) }));
                console.debug('selectDeliveryMethod: diagnostic dump of candidate nodes (first 60):', dump);
              } catch (e) { console.debug('selectDeliveryMethod: diagnostic dump failed', e); }
            }
          } catch (e) {}
          console.debug('selectDeliveryMethod: no automatic delivery option found (overlay removed)');
          return false;
      } catch (err) { console.debug('selectDeliveryMethod error', err); return false; }
    }

    // Show a blue in-page hint in the bottom-left corner (1/4 of the way up)
    function ffmShowPublishHint(message) {
      try {
        const id = 'ffm-publish-hint';
        // remove existing
        try { const ex = document.getElementById(id); if (ex) ex.remove(); } catch (e) {}
        const wrap = document.createElement('div');
        wrap.id = id;
        wrap.setAttribute('role', 'status');
        wrap.style.position = 'fixed';
        wrap.style.left = '12px';
        wrap.style.bottom = '25vh';
        wrap.style.zIndex = '2147483647';
        wrap.style.background = 'rgba(24,119,242,0.95)'; // FB blue
        wrap.style.color = '#fff';
        wrap.style.padding = '10px 12px';
        wrap.style.borderRadius = '8px';
        wrap.style.boxShadow = '0 6px 22px rgba(0,0,0,0.25)';
        wrap.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        wrap.style.fontSize = '14px';
        wrap.style.lineHeight = '1.35';
        wrap.style.maxWidth = '360px';
        wrap.style.pointerEvents = 'auto';
        wrap.style.userSelect = 'none';

  const text = document.createElement('div');
  let msg = message || 'You can now inspect the results and click Publish when ready. Enabling auto-publish will let the extension press the final Publish button without review.';
  try {
    // Always include a short pointer to the Settings option so users can enable auto-publish
  msg += '\n\nEnable Auto Publishing in Settings.';
  if (!window.ffm_allow_auto_publish) msg += '\n\nTip: To allow automatic final Publish, enable "Auto Publishing" in the extension Menu Settings.';
  } catch (e) {}
  text.textContent = msg;
        wrap.appendChild(text);

        const close = document.createElement('button');
        close.textContent = '×';
        close.title = 'Dismiss';
        close.style.position = 'absolute';
        close.style.right = '6px';
        close.style.top = '2px';
        close.style.background = 'transparent';
        close.style.border = 'none';
        close.style.color = '#fff';
        close.style.fontSize = '16px';
        close.style.cursor = 'pointer';
        close.addEventListener('click', () => { try { wrap.remove(); } catch (e) {} });
        wrap.appendChild(close);

        document.documentElement.appendChild(wrap);
        // auto-fade slightly after a few seconds but keep visible
        try { setTimeout(() => { try { wrap.style.opacity = '0.92'; } catch (e) {} }, 3500); } catch (e) {}
      } catch (e) { /* non-fatal */ }
    }

    // Try to locate and click the final Publish button using multiple strategies
    async function ffmAttemptPublishClick(publishRequestId, inventoryName) {
      try {
        try { console.debug('ffmAttemptPublishClick: start publishRequestId=' + (publishRequestId || 'null') + ', inventoryName=' + (inventoryName || '') + ', allow=' + (!!window.ffm_allow_auto_publish)); } catch (e) {}
        // HARD OVERRIDE: If this is a scheduler-run, ensure allow is true here too
        try {
          if (window.ffm_is_scheduled_publish === true) {
            try { console.log('[Fast4MP content] HARD OVERRIDE: ffmAttemptPublishClick forcing allow=true (scheduler)'); } catch (e) {}
            try { window.ffm_allow_auto_publish = true; } catch (e) {}
          }
        } catch (e) {}
        // Always allow auto-publish for SL or Scheduled
        try {
          if (window.ffm_is_scheduled_publish === true || window.ffmIsSLPublish === true || window.ffmIsSLPublish === true) {
            try { window.ffm_allow_auto_publish = true; } catch (e) {}
          }
        } catch (e) {}
        // Quick attempt: use the polling-based helper to click a visible Publish control reliably
        try {
          // safety delay to allow React/FB validation to finish before final click
          await new Promise(r => setTimeout(r, 400));
          if (await clickFacebookButton('Publish')) {
            console.debug('ffmAttemptPublishClick: clickFacebookButton succeeded for Publish');
            // start watcher to detect completion (same as below)
            (async function watchPublishComplete(publishRequestId, inventoryName) {
              try {
                const max = 20; let attempt = 0;
                const startUrl = window.location.href || '';
                while (attempt < max) {
                  await new Promise(r=>setTimeout(r, 1000));
                  attempt++;
                  try {
                    const url = window.location.href || '';
                    const body = (document && document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
                      if (!/facebook\.com\/marketplace\/create\/item/.test(url) || body.indexOf('your listing has been posted') >= 0 || body.indexOf('your listing is live') >= 0 || body.indexOf('your listing has been published') >= 0) {
                      try {
                        // Guarantee publishRequestId included for SDNR
                        if (!publishRequestId) {
                          try { publishRequestId = window.__ffm_publishRequestId || null; } catch (e) {}
                        }
                        chrome.runtime.sendMessage({ action: 'publish-complete', publishRequestId: publishRequestId, inventoryName: inventoryName, ok: true, when: Date.now() });
                      } catch (e) {}
                      try { console.log(`[Fast4MP] ✅ Listing published successfully at ${new Date().toLocaleTimeString()}`); } catch (e) {}
                      try {
                        // Ensure scheduled listingId (if present) is carried into the populate context
                        if ((!window.ffmCurrentPopulate || !window.ffmCurrentPopulate.listingId) && window.ffm_scheduled_listingId) {
                          try { window.ffmCurrentPopulate = window.ffmCurrentPopulate || {}; window.ffmCurrentPopulate.listingId = window.ffm_scheduled_listingId; } catch (e) {}
                        }
                        // Notify popup to refresh Saved Listings; include listingId when available
                        try { chrome.runtime.sendMessage({ action: 'ffm_post_publish_update_sl', listingId: (window.ffmCurrentPopulate && window.ffmCurrentPopulate.listingId) || window.ffm_scheduled_listingId || (window.ffmCurrentListing && (window.ffmCurrentListing.listingId || window.ffmCurrentListing.id)) || null }); } catch (e) {}
                      } catch (e) {}
                      break;
                    }
                  } catch (e) {}
                }
              } catch (e) {}
            })(publishRequestId || (window.ffm_staged_publish_request_id || null), inventoryName || (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) || null);
            return true;
          }
        } catch (e) { console.debug('ffmAttemptPublishClick: quick clickFacebookButton attempt failed', e); }
        const isBad = (txt) => { try { const t = (txt||'').toLowerCase(); return t.includes('boost') || t.includes('promote') || t.includes('ad') || t.includes('sponsored'); } catch (e) { return false; } };
        const candidateQuery = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], [aria-label]'))
          .filter(n => n && n.offsetParent !== null && (n.textContent || n.value || n.getAttribute && n.getAttribute('aria-label')));

        // Prefer direct aria-label match first
        const direct = document.querySelector('[aria-label="Publish"]') || document.querySelector('[aria-label="Post"]');
        const tried = new Set();
        const tryElement = async (el) => {
          try {
            if (!el || tried.has(el)) return false;
            tried.add(el);
            console.debug('ffmAttemptPublishClick: attempting candidate', { tag: el.tagName, text: (el.textContent||el.value||el.getAttribute('aria-label')||'').trim().slice(0,60) });
            // Use robust click helper if available
            let ok = false;
            try { if (typeof ffmTryHardClick === 'function') { ok = await ffmTryHardClick(el); } } catch (e) { console.debug('ffmAttemptPublishClick: ffmTryHardClick error', e); }
            if (!ok) {
              try { el.click(); ok = true; } catch (e) { try { el.dispatchEvent(new MouseEvent('click',{bubbles:true})); ok = true; } catch (e2) { console.debug('ffmAttemptPublishClick: direct click failed', e2); ok = false; } }
            }
            if (ok) {
              console.debug('ffmAttemptPublishClick: clicked candidate, starting publish watcher');
              // start watcher to detect completion
              (async function watchPublishComplete(publishRequestId, inventoryName) {
                try {
                  const max = 20; let attempt = 0;
                  const startUrl = window.location.href || '';
                  while (attempt < max) {
                    await new Promise(r=>setTimeout(r, 1000));
                    attempt++;
                    try {
                      const url = window.location.href || '';
                      const body = (document && document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : '';
                      if (!/facebook\.com\/marketplace\/create\/item/.test(url) || body.indexOf('your listing has been posted') >= 0 || body.indexOf('your listing is live') >= 0 || body.indexOf('your listing has been published') >= 0) {
                        try {
                          // Guarantee publishRequestId included for SDNR
                          if (!publishRequestId) {
                            try { publishRequestId = window.__ffm_publishRequestId || null; } catch (e) {}
                          }
                          chrome.runtime.sendMessage({ action: 'publish-complete', publishRequestId: publishRequestId, inventoryName: inventoryName, ok: true, when: Date.now() });
                        } catch (e) {}
                        try { console.log(`[Fast4MP] ✅ Listing published successfully at ${new Date().toLocaleTimeString()}`); } catch (e) {}
                        try {
                          // Ensure scheduled listingId (if present) is carried into the populate context
                          if ((!window.ffmCurrentPopulate || !window.ffmCurrentPopulate.listingId) && window.ffm_scheduled_listingId) {
                            try { window.ffmCurrentPopulate = window.ffmCurrentPopulate || {}; window.ffmCurrentPopulate.listingId = window.ffm_scheduled_listingId; } catch (e) {}
                          }
                          // Notify popup to refresh Saved Listings; include listingId when available
                          try { chrome.runtime.sendMessage({ action: 'ffm_post_publish_update_sl', listingId: (window.ffmCurrentPopulate && window.ffmCurrentPopulate.listingId) || window.ffm_scheduled_listingId || (window.ffmCurrentListing && (window.ffmCurrentListing.listingId || window.ffmCurrentListing.id)) || null }); } catch (e) {}
                        } catch (e) {}
                        break;
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
              })(publishRequestId || (window.ffm_staged_publish_request_id || null), inventoryName || (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) || null);
              return true;
            }
          } catch (e) { console.debug('ffmAttemptPublishClick tryElement error', e); }
          return false;
        };

        // Exact visible-text match (strong): look for a visible button whose trimmed innerText === 'Publish' (case-insensitive)
        try {
          const visibleButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => b && b.offsetParent !== null);
          for (const b of visibleButtons) {
            try {
              const txt = (b.innerText || b.textContent || b.value || '').toString().trim();
              if (txt && txt.toLowerCase() === 'publish') {
                const r = await tryElement(b);
                if (r) return true;
              }
            } catch (e) {}
          }
        } catch (e) {}

        // Sibling-of-Previous strategy: find a visible control labeled 'Previous' then try its following sibling(s) for Publish
        try {
          const prev = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => el && el.offsetParent !== null && ((el.innerText||el.textContent||'').toString().trim().toLowerCase() === 'previous' || (el.getAttribute && (el.getAttribute('aria-label')||'').toLowerCase() === 'previous')));
          if (prev) {
            try {
              // Prefer nextElementSibling, then parent.children scan
              const cand = prev.nextElementSibling || (prev.parentElement && Array.from(prev.parentElement.children).find(e => e !== prev && e.offsetParent !== null));
              if (cand) {
                const r = await tryElement(cand);
                if (r) return true;
              }
            } catch (e) {}
          }
        } catch (e) {}

        // Try direct first
        if (direct && direct.offsetParent !== null) {
          const r = await tryElement(direct);
          if (r) return true;
        }

        // Try candidates by text matching (prioritize 'publish' and 'post')
        const textPriority = ['publish','post'];
        for (const t of textPriority) {
          for (const c of candidateQuery) {
            try {
              const txt = ((c.textContent||'') + ' ' + (c.value||'') + ' ' + (c.getAttribute && c.getAttribute('aria-label') || '')).toLowerCase();
              if (!txt || isBad(txt)) continue;
              if (txt.indexOf(t) >= 0) {
                const r = await tryElement(c);
                if (r) return true;
              }
            } catch (e) { continue; }
          }
        }

        // As a last resort, try any candidate with role=button that looks clickable
        for (const c of candidateQuery) {
          try {
            const r = await tryElement(c);
            if (r) return true;
          } catch (e) {}
        }

        console.debug('ffmAttemptPublishClick: no publish candidate clicked');
        try {
          // Diagnostic dump: top few visible candidates to help debug selector mismatches
          try {
            const visibleCandidates = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], [aria-label]'))
              .filter(n => n && n.offsetParent !== null)
              .slice(0, 12)
              .map(n => {
                try {
                  const r = n.getBoundingClientRect();
                  return { tag: n.tagName, text: (n.textContent||n.value||'').toString().trim().slice(0,120), aria: (n.getAttribute && n.getAttribute('aria-label')) || null, rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
                } catch (e) { return { tag: n.tagName, text: (n.textContent||'').toString().slice(0,40) }; }
              });
            console.debug('ffmAttemptPublishClick: visible candidate dump', visibleCandidates);
          } catch (e) {}
          // ----- Fast4MP HARD OVERRIDE: Always click Publish for scheduler -----
          try {
            if (window.ffm_is_scheduled_publish === true) {
              try {
                const pubBtn = document.querySelector('[aria-label="Publish"]');
                if (pubBtn) {
                  console.log('[Fast4MP content] HARD OVERRIDE: Scheduler clicking Publish NOW');
                  try { pubBtn.click(); return true; } catch (e) { try { pubBtn.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (er) {} }
                }
              } catch (e) {}
            }
          } catch (e) {}
        } catch (e) {}
      } catch (e) { console.debug('ffmAttemptPublishClick error', e); }
      return false;
    }

    // Expose the publish function to the global scope to avoid block-scoped
    // declaration races where other async code can't resolve the identifier.
    // Attach to both window and globalThis where available (best-effort).
    try {
      if (typeof window !== 'undefined' && typeof window.ffmAttemptPublishClick !== 'function') {
        window.ffmAttemptPublishClick = ffmAttemptPublishClick;
      }
    } catch (e) {}
    try {
      if (typeof globalThis !== 'undefined' && typeof globalThis.ffmAttemptPublishClick !== 'function') {
        globalThis.ffmAttemptPublishClick = ffmAttemptPublishClick;
      }
    } catch (e) {}

    // After the delivery step appears (or we gave up waiting), attempt selection and advance
      try {
      // utility: wait for a predicate to become true with timeout
      async function ffmWaitFor(predicate, timeout = 3000, interval = 100) {
        try {
          const start = performance.now();
          while (performance.now() - start < (timeout || 3000)) {
            try { if (predicate()) return true; } catch (e) {}
            await new Promise(r => setTimeout(r, interval || 100));
          }
          try { console.warn('[Fast4MP] ffmWaitFor timeout after', timeout); } catch (e) {}
          return false;
        } catch (e) { try { console.warn('[Fast4MP] ffmWaitFor error', e); } catch (e2) {} return false; }
      }

      // fast, lightweight click sequence for simple FB checkboxes
      async function ffmTryHardClickQuick(el) {
        try {
          if (!el) return false;
          try { el.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
          try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } catch (e) {}
          try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch (e) {}
          try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (e) {}
          try { el.dispatchEvent && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {}
          return true;
        } catch (err) { try { console.warn('[Fast4MP] ffmTryHardClickQuick failed', err); } catch (e) {} return false; }
      }

      let picked = await selectDeliveryMethod('Local Pickup');
      console.debug('populate-fb: selectDeliveryMethod result ->', picked);

      // Check cached prefs and skip the delivery checkbox phase entirely when
      // all three saved prefs are false (fast-path for empty runs).
      try {
        const cachedPrefs = (window && window.ffmCachedDeliveryPrefs) || null;
        if (cachedPrefs && typeof cachedPrefs === 'object') {
          const hasAnySelected = !!(cachedPrefs.publicMeetup || cachedPrefs.doorPickup || cachedPrefs.doorDropoff);
          if (!hasAnySelected) {
            console.log('[Fast4MP] Skipping delivery checkbox phase — no delivery prefs selected.');
            // set a short-lived flag so setFbDeliveryOptionsFromListing can also early-exit
            try { window.__ffm_skip_delivery_phase = true; } catch (e) {}
          } else {
            try { window.__ffm_skip_delivery_phase = false; } catch (e) {}
            console.log("[Fast4MP] Waiting for delivery checkboxes to mount...");
            await ffmWaitFor(() => document.querySelectorAll('div[role="checkbox"]').length >= 3, 2000);
            await new Promise(r => setTimeout(r, 150)); // small post-mount buffer
          }
        } else {
          // no cached prefs available; fall back to waiting for mount before reading staged listing
          console.log("[Fast4MP] Waiting for delivery checkboxes to mount...");
          await ffmWaitFor(() => document.querySelectorAll('div[role="checkbox"]').length >= 3, 2000);
          await new Promise(r => setTimeout(r, 150)); // small post-mount buffer
        }
      } catch (e) { console.debug('post-select mount wait failed', e); }

      // After selecting the delivery method, set FB delivery-method checkboxes
      // to match the staged listing's delivery flags (publicMeetup / doorPickup / doorDropoff).
      // We'll load the staged listing from storage (with retries) and then apply options
      // once the delivery section is visible. This reduces timing races.
      async function ffmApplyDeliveryOptions(options = {}) {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        // Wait for delivery options to appear (15 * 500ms = 7.5s max)
        for (let i = 0; i < 15; i++) {
          // Heuristic: multiple checkbox-like elements present near delivery section
          const boxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="menuitemcheckbox"]');
          if (boxes && boxes.length > 3) break;
          await delay(300);
        }

        // Tighter, label-safe matching: find the actual div[role="checkbox"] nodes
        // and map them explicitly to the three known delivery options. This avoids
        // false positives where a generic .closest() walks up to the page mount node.
        const candidates = Array.from(document.querySelectorAll('div[role="checkbox"]'));

        function findCheckbox(type) {
          try {
            for (const box of candidates) {
              try {
                const text = (box.innerText || box.textContent || '').toString().trim().toLowerCase();
                if (type === 'publicMeetup' && text.includes('public meetup')) return box;
                if (type === 'doorPickup' && text.includes('door pickup')) return box;
                if (type === 'doorDropoff' && text.includes('door dropoff')) return box;
              } catch (e) { /* ignore per-box errors */ }
            }
          } catch (e) { /* ignore */ }
          return null;
        }

        const prefs = options || {};

        for (const [label, want] of Object.entries({
          publicMeetup: prefs.publicMeetup,
          doorPickup: prefs.doorPickup,
          doorDropoff: prefs.doorDropoff,
        })) {
          try {
            const el = findCheckbox(label);
            if (!el) {
              console.warn(`[Fast4MP] ffmApplyDeliveryOptions: no checkbox found for ${label}`);
              continue;
            }

            const before = el.getAttribute && el.getAttribute('aria-checked') === 'true';
            console.log(`[Fast4MP] ffmApplyDeliveryOptions: ${label} before=${before} want=${!!want}`);

            // Skip if already correct
            if (before === !!want) {
              console.log(`[Fast4MP] ${label}: already in desired state`);
              continue;
            }

            // Single, faster toggle using quick click helper
            try {
              await ffmTryHardClickQuick(el);
              await new Promise(r => setTimeout(r, 100));
            } catch (clickErr) { console.debug('ffmApplyDeliveryOptions: quick click attempt failed', clickErr); }

            const after = el.getAttribute && el.getAttribute('aria-checked') === 'true';
            if (after !== !!want) {
              // Only run fallback if first click failed
              try {
                if (typeof el.focus === 'function') el.focus();
                el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
                await new Promise(r => setTimeout(r, 120));
                const after2 = el.getAttribute && el.getAttribute('aria-checked') === 'true';
                console.log(`[Fast4MP] ${label}: after fallback=${after2}`);
              } catch (kf) { console.debug('ffmApplyDeliveryOptions: keyboard fallback failed', kf); }
            } else {
              console.log(`[Fast4MP] ${label}: after click=${after}`);
            }
          } catch (innerE) { console.debug('ffmApplyDeliveryOptions: option error', innerE); }
        }
      }

      async function setFbDeliveryOptionsFromListing(listingOrId) {
        try {
          console.debug('setFbDeliveryOptionsFromListing: start', !!listingOrId, !!(window && window.ffm_staged_publish_request_id));
          // If a prior fast-path decided to skip delivery, honor it here immediately
          try { if (window && window.__ffm_skip_delivery_phase) { console.log('[Fast4MP] setFbDeliveryOptionsFromListing: skipping — fast-path flagged'); return true; } } catch (e) {}
          // Prefer in-memory cached prefs populated at the start of the populate flow
          try {
            const cached = window && window.ffmCachedDeliveryPrefs;
            if (cached && typeof cached === 'object' && Object.keys(cached).length) {
              try { console.debug('setFbDeliveryOptionsFromListing: using window.ffmCachedDeliveryPrefs', cached); } catch (e) {}
              try { await ffmApplyDeliveryOptions(cached); } catch (e) { console.debug('setFbDeliveryOptionsFromListing: ffmApplyDeliveryOptions(cached) failed', e); }
              // consume cached prefs so we don't re-apply later
              try { delete window.ffmCachedDeliveryPrefs; } catch (e) { window.ffmCachedDeliveryPrefs = null; }
              return;
            }
          } catch (e) { console.debug('setFbDeliveryOptionsFromListing: cached-pref check failed', e); }
          let listing = null;
          let publishId = null;

          if (typeof listingOrId === 'string') publishId = listingOrId;
          else if (listingOrId && typeof listingOrId === 'object') listing = listingOrId;
          else {
            listing = (window && window.ffm_staged_publish_listing) ? window.ffm_staged_publish_listing : null;
            publishId = window && window.ffm_staged_publish_request_id ? window.ffm_staged_publish_request_id : null;
          }

          // If we don't yet have a listing object, first attempt to read ephemeral session delivery flags
          if (!listing && publishId) {
            const sessionKey = 'ffm_pub_delivery_' + publishId;
            try {
              // Try session storage first (fast, per-tab ephemeral storage)
              const sess = await new Promise((resolve) => {
                try { chrome.storage.session.get([sessionKey], (res) => { resolve(res || {}); }); } catch (e) { resolve({}); }
              });
              if (sess && sess[sessionKey]) {
                const prefs = sess[sessionKey];
                try { console.debug('setFbDeliveryOptionsFromListing: found session delivery prefs', sessionKey, prefs); } catch (e) {}
                // Apply delivery prefs directly and remove the session key
                try { await ffmApplyDeliveryOptions(prefs); } catch (e) { console.debug('setFbDeliveryOptionsFromListing: ffmApplyDeliveryOptions(session) failed', e); }
                try { await new Promise((resolve) => { try { chrome.storage.session.remove(sessionKey, () => resolve()); } catch (e) { resolve(); } }); } catch (e) {}
                return;
              }
            } catch (e) { console.debug('setFbDeliveryOptionsFromListing: session read failed', e); }

            // Fallback: read the full staged listing from chrome.storage.local (existing behavior)
            const key = 'ffm_publish_' + publishId;
            const maxAttempts = 10;
            for (let i = 0; i < maxAttempts && !listing; i++) {
              try {
                listing = await new Promise((resolve) => {
                  try { chrome.storage.local.get([key], (res) => { resolve((res && res[key]) ? res[key] : null); }); } catch (e) { resolve(null); }
                });
              } catch (e) { listing = null; }
              if (listing) break;
              console.debug('setFbDeliveryOptionsFromListing: storage read attempt', i + 1, 'result->', !!listing);
              await sleep(500);
            }
          }

          if (!listing) {
            console.warn('setFbDeliveryOptionsFromListing: no listing available after retries, scheduling retry');
            // Queue a retry after navigation; non-blocking
            try { const retryId = (window && window.ffm_staged_publish_request_id) || listingOrId; setTimeout(() => { try { setFbDeliveryOptionsFromListing(retryId); } catch (e) {} }, 2000); } catch (e) {}
            return;
          }

          console.debug('setFbDeliveryOptionsFromListing: listing loaded', !!listing);
          // Early exit when all three delivery prefs are explicitly false
          try {
            const prefs = (listing && typeof listing === 'object') ? { publicMeetup: !!listing.publicMeetup, doorPickup: !!listing.doorPickup, doorDropoff: !!listing.doorDropoff } : {};
            console.debug('setFbDeliveryOptionsFromListing: start', prefs);
            const hasAnySelected = !!(prefs.publicMeetup || prefs.doorPickup || prefs.doorDropoff);
            if (!hasAnySelected) {
              console.log('[Fast4MP] Skipping delivery checkbox phase — all unchecked.');
              return true;
            }
          } catch (e) {}

          await ffmApplyDeliveryOptions(listing);
        } catch (err) { console.debug('setFbDeliveryOptionsFromListing error', err); }
      }

      // Use the staged listing placed on window by the populate handshake, if available (or publish id)
      try { await setFbDeliveryOptionsFromListing(window.ffm_staged_publish_request_id || window.ffm_staged_publish_listing || null); } catch (e) { console.debug('populate-fb: setFbDeliveryOptionsFromListing failed', e); }
  // If we successfully picked Local Pickup, advance by clicking Next on the delivery page
  try { if (window && window.ffm_debug) console.debug && console.debug('FFM-TRACE: after selectDeliveryMethod, picked=' + !!picked); } catch (e) {}
      if (picked) {
        try {
          // If we're on the audience step and the page shows a review-before-publishing message,
          // do not auto-advance (avoid auto-publishing).
          if (ffmIsAudienceUrl() && ffmPageShowsReviewBeforePublish()) {
            console.debug('populate-fb: audience/review detected -> pausing auto-advance to allow manual review');
            try {
              // If this scheduled run was explicitly allowed to auto-publish, advance one more time to reveal the Publish button
              if (window.ffm_allow_auto_publish) {
                try { console.debug('populate-fb: audience/review detected but auto-publish allowed -> performing one final Next'); } catch (e) {}
                try { await sleep(400); await clickNextWithRetries(1); console.debug('populate-fb: auto-advanced from audience to reveal Publish'); } catch (e) { console.debug('populate-fb: auto-advance failed', e); }
                try { await sleep(300); await ffmCallAttemptPublishClickSafe((typeof ffmAttemptPublishClick === 'function' ? ffmAttemptPublishClick : null), window.ffm_staged_publish_request_id || null, (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) || null); } catch (e) { console.debug('populate-fb: ffmAttemptPublishClick after auto-advance failed', e); }
              }
              // Show an improved hint overlay
              try { ffmShowPublishHint('You can now inspect the results. If auto-publish is enabled, the extension will press Publish automatically. Otherwise, press Publish when ready.'); } catch (e) {}
              // If auto-publish allowed but auto-advance wasn't performed, still attempt to click Publish proactively
              try { if (window.ffm_allow_auto_publish) { await sleep(300); await ffmCallAttemptPublishClickSafe((typeof ffmAttemptPublishClick === 'function' ? ffmAttemptPublishClick : null), window.ffm_staged_publish_request_id || null, (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) || null); } } catch (e) { console.debug('populate-fb: ffmAttemptPublishClick from hint branch failed', e); }
            } catch (e) {}
          } else {
            // longer pause before attempting Next to give FB UI time to settle and avoid double-advancing
            await sleep(800);
            await clickNextWithRetries(1);
            console.debug('populate-fb: clicked Next after delivery selection (single attempt)');
            // Temporary TEST checkpoint removed. Use `window.ffm_debug = true` to enable trace logs.
            // Post-delivery: attempt to honor a per-publish force flag (set by scheduler) and try Publish now.
            (async () => {
              try {
                const publishId = window.ffm_staged_publish_request_id || null;
                if (!publishId) { try { console.debug('populate-fb: post-delivery - no publishId available'); } catch (e) {} 
                  try { console.debug('populate-fb: entering final-safety flow with no publishId (possible Variant B)'); } catch (e) {}
                  return; }
                // prevent repeated attempts for same publishId
                try { if (!window.__ffm_publish_attempted_ids) window.__ffm_publish_attempted_ids = new Set(); } catch (e) { window.__ffm_publish_attempted_ids = new Set(); }
                if (window.__ffm_publish_attempted_ids.has(publishId)) { try { console.debug('populate-fb: post-delivery - publish already attempted for', publishId); } catch (e) {} return; }

                // check storage for one-off force flag and consume it if present
                const key = 'ffm_force_auto_publish_' + publishId;
                // Poll storage briefly to handle races where the background may write the flag just before/after we run
                const forced = await (async () => {
                  try {
                    const getKeyOnce = (k) => new Promise((res) => {
                      try { chrome.storage.local.get([k], (r) => res(r || {})); } catch (e) { res({}); }
                    });
                    const maxTries = 6; let t = 0;
                    while (t < maxTries) {
                      try {
                        const obj = await getKeyOnce(key);
                        const v = obj && obj[key];
                        if (v) {
                          try { chrome.storage.local.remove([key]); } catch (e) {}
                          return true;
                        }
                      } catch (e) {}
                      // short backoff
                      await new Promise(r => setTimeout(r, 250));
                      t++;
                    }
                    return false;
                  } catch (e) { return false; }
                })();
                if (forced) {
                  try { console.debug('populate-fb: post-delivery - force-auto flag found for', publishId); } catch (e) {}
                  // Only set allow if no explicit inline message.menuAutoPersistent denied it.
                  if (typeof message.menuAutoPersistent === 'undefined' || message.menuAutoPersistent) {
                    window.ffm_allow_auto_publish = true;
                    try { console.debug('populate-fb: granting auto-publish due to force flag (and no inline deny) for', publishId); } catch (e) {}
                  } else {
                    try { console.debug('populate-fb: force flag present but inline message.menuAutoPersistent denied auto-publish; skipping'); } catch (e) {}
                  }
                }

                if (window.ffm_allow_auto_publish) {
                  try {
                    // mark attempted to avoid repeats
                    try { window.__ffm_publish_attempted_ids.add(publishId); } catch (e) {}
                    // If we're on the audience step, allow extra time for FB to render the Publish control
                    const isAudience = (typeof ffmIsAudienceUrl === 'function') ? ffmIsAudienceUrl() : false;
                    if (isAudience) {
                      try { console.debug('populate-fb: post-delivery - audience step detected, waiting before Publish attempts'); } catch (e) {}
                      // wait a moment for the review UI to settle, then retry ffmAttemptPublishClick a few times
                      const maxRetries = 4;
                      for (let r = 0; r < maxRetries; r++) {
                        try { await new Promise(res => setTimeout(res, 700 + r * 300)); } catch (e) {}
                        try {
                          const ok = await ffmCallAttemptPublishClickSafe((typeof ffmAttemptPublishClick === 'function' ? ffmAttemptPublishClick : null), publishId, (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) || null);
                          try { console.debug('populate-fb: ffmAttemptPublishClick post-delivery (audience) attempt', r+1, '->', ok); } catch (e) {}
                          if (ok) break;
                        } catch (e) { console.debug('populate-fb: ffmAttemptPublishClick post-delivery (audience) error', e); }
                      }
                    } else {
                      const ok = await ffmCallAttemptPublishClickSafe((typeof ffmAttemptPublishClick === 'function' ? ffmAttemptPublishClick : null), publishId, (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) || null);
                      try { console.debug('populate-fb: ffmAttemptPublishClick post-delivery ->', ok); } catch (e) {}
                    }
                  } catch (e) { console.debug('populate-fb: ffmAttemptPublishClick post-delivery error', e); }
                } else {
                  try { console.debug('populate-fb: post-delivery - not allowed to auto-publish (allow flag false)'); } catch (e) {}
                }
              } catch (e) { /* non-fatal */ }
            })();

            // Mark listing active when publish flow finishes (best-effort).
            // Persist to 'ffm_saved_listings' and broadcast lightweight
            // refresh messages for popup and sidepanel consumers.
            try {
              try {
                const ffmListing = (window && window.ffm_staged_publish_listing) ? window.ffm_staged_publish_listing : (window && window.ffmCurrentListing) ? window.ffmCurrentListing : null;
                if (ffmListing && ffmListing.inventoryName) {
                  try { ffmListing.active = true; } catch (e) {}
                  try { ffmListing.lastPublished = Date.now(); } catch (e) {}
                  try { ffmListing.status = 'active'; } catch (e) {}

                  // Best-effort: upsert into ffm_saved_listings so popup can show it immediately
                  try {
                    chrome.storage.local.get(['ffm_saved_listings'], (data) => {
                      try {
                        const arr = Array.isArray(data && data.ffm_saved_listings) ? data.ffm_saved_listings : [];
                        const idx = arr.findIndex(x => x && x.inventoryName === ffmListing.inventoryName);
                        if (idx >= 0) {
                          arr[idx] = Object.assign({}, arr[idx], ffmListing);
                        } else {
                          // append as a fallback so popup/sidepanel can show it
                          arr.push(ffmListing);
                        }
                        chrome.storage.local.set({ ffm_saved_listings: arr }, () => {
                          try { console.log('[Fast4MP] 🟢 Listing marked active & saved to ffm_saved_listings for', ffmListing.inventoryName); } catch (e) {}
                          try {
                            // Short delay to allow storage propagation before popup/sidepanel attempt to read
                            setTimeout(() => {
                              try { chrome.runtime.sendMessage({ action: 'ffm_refresh_popup' }); } catch (e) {}
                              try { chrome.runtime.sendMessage({ action: 'ffm_refresh_sidepanel' }); } catch (e) {}
                            }, 1000);
                          } catch (e) { console.debug('[Fast4MP] failed scheduling refresh messages', e); }
                        });
                      } catch (e) { console.debug('[Fast4MP] failed to persist active flag to ffm_saved_listings', e); }
                    });
                  } catch (e) { console.debug('[Fast4MP] error reading/writing ffm_saved_listings storage', e); }
                } else {
                  try { console.warn('[Fast4MP] ⚠️ No staged listing found to mark active'); } catch (e) {}
                }
              } catch (err) { console.error('[Fast4MP] Failed to update active badge:', err); }
            } catch (e) { /* non-fatal */ }

          }
        } catch (e) { console.debug('populate-fb: clicking Next after delivery failed', e); }
      } else {
        // Fallback: sometimes FB variants or timing mean the Delivery UI isn't found immediately.
        // Attempt a short wait, then click Next again and re-try selectDeliveryMethod once.
        try {
          console.debug('populate-fb: delivery not found — running fallback: wait, click Next, re-scan');
          await sleep(600);
          try {
            // guard fallback clicking similarly
            if (ffmIsAudienceUrl() && ffmPageShowsReviewBeforePublish()) {
              console.debug('populate-fb: audience/review detected during fallback -> skipping clickNext fallback');
              try { ffmShowPublishHint('You can now inspect the results and click Publish when ready. \nEnable Auto Publishing to automate this step. 5'); } catch (e) {}
            } else {
              // single cautious Next attempt during fallback (allow UI to settle)
              await sleep(800);
              await clickNextWithRetries(1);
            }
          } catch (e) { console.debug('populate-fb fallback: clickNextWithRetries failed', e); }
          await sleep(600);
          try {
            picked = await selectDeliveryMethod('Local Pickup');
            console.debug('populate-fb: fallback re-check selectDeliveryMethod result ->', picked);
      if (picked) {
        try { await sleep(800); await clickNextWithRetries(1); console.debug('populate-fb: clicked Next after fallback delivery selection (single attempt)'); } catch (e) { console.debug('populate-fb: clicking Next after fallback select failed', e); }
            }
          } catch (e) { console.debug('populate-fb: fallback selectDeliveryMethod threw', e); }
        } catch (e) { console.debug('populate-fb: delivery fallback flow error', e); }
      }
    } catch (e) { console.debug('populate-fb: selectDeliveryMethod threw', e); }
  } catch (e) { console.debug('populate-fb: post-toggle delivery flow failed', e); }

  console.debug('populate-fb: attributes set, finished populate sequence');

  // Wait until the tab returns to the user's listings page before marking
  // the listing active. FB sometimes stays on the create flow; updating the
  // listings state there can fail. Poll the URL and perform the merge once
  // we detect /marketplace/you/selling.
  // --- FAST4MP PATCH #2: Guaranteed Publish Click for Scheduled Tasks ---
  try {
    if ((message && message.scheduleTaskId) || (window && window.ffmCurrentPopulate && window.ffmCurrentPopulate.scheduleTaskId) || (window && window.ffm_staged_publish_request_id)) {
      try {
        // --- Scheduled Publish: Guaranteed Publish Click ---
        if (window.ffmCurrentPopulate && window.ffmCurrentPopulate.scheduleTaskId) {
            console.log("[Fast4MP] Scheduled publish: looking for final Publish button…");

            // Wait for review page to mount
            await sleep(1500); // give FB time to render the review page

            let publishBtn = null;

            // Try up to 15 times (15 seconds total)
            for (let i = 0; i < 15; i++) {

                publishBtn = document.querySelector('[aria-label="Publish"]');

                if (publishBtn) {
                    console.log("[Fast4MP] Scheduled publish: Publish button found → clicking.");
                    try { publishBtn.click(); } catch (e) { try { publishBtn.dispatchEvent(new MouseEvent('click',{bubbles:true})); } catch(_) {} }
                    break;
                }

                console.log("[Fast4MP] Scheduled publish: Publish button not ready, retrying (" + i + "/15)…");
                await sleep(1000);
            }

            if (!publishBtn) {
                console.warn("[Fast4MP] Scheduled publish: Publish button NEVER appeared.");
            }
        }
      } catch (e) { try { console.debug('[Fast4MP] scheduled publish final-click patch error', e); } catch (er) {} }
    }
  } catch (e) {}
  try {
    const updateWhenOnSellingPage = () => {
      try {
        if (!location.href.includes('/marketplace/you/selling')) {
          try { console.log('[Fast4MP content] Waiting for /you/selling before badge update...'); } catch (e) {}
          setTimeout(updateWhenOnSellingPage, 2000);
          return;
        }

        try { console.log('[Fast4MP content] Detected /you/selling — performing badge merge'); } catch (e) {}

        const now = new Date();
        const normalize = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const publishedName = window.ffmCurrentListing?.inventoryName || '';
        const publishedTitle = window.ffmCurrentListing?.title || '';
        const publishId = window.ffmPublishId || window.ffm_staged_publish_request_id || null;

        chrome.storage.local.get('listings', (data) => {
          try {
            const saved = Array.isArray(data && data.listings) ? data.listings : [];
            // Prefer exact match by publishRequestId when available
            let match = null;
            try {
              if (publishId) {
                match = saved.find((l) => l && l.publishRequestId && String(l.publishRequestId) === String(publishId));
                if (match) try { console.debug('[Fast4MP content] Matched by publishRequestId', publishId); } catch (e) {}
              }
            } catch (e) {}

            if (!match) {
              match = saved.find((l) => normalize(l.inventoryName) === normalize(publishedName))
                || saved.find((l) => normalize(l.title).includes(normalize(publishedTitle.slice(0, 20))));
            }

            if (!match) {
              try { console.warn('[Fast4MP content] No direct match found — will retry after 3s'); } catch (e) {}
              setTimeout(updateWhenOnSellingPage, 3000);
              return;
            }

            try { match.isActive = true; } catch (e) {}
            try { match.active = true; } catch (e) {}
            try { match.activeBadge = '🟢 Active'; } catch (e) {}
            try { match.activeStatus = `Listed on ${now.toLocaleDateString()}`; } catch (e) {}
            try { match.lastActive = now.toISOString(); } catch (e) {}
            try { match.listedDaysAgo = 0; } catch (e) {}

            // Bump a listings_version token so popup will notice even if it
            // missed the runtime message. Then broadcast both message names
            // used across the codebase and optionally show a small toast.
            try {
              chrome.storage.local.get('listings_version', (d) => {
                try {
                  const version = (d && d.listings_version ? d.listings_version : 0) + 1;
                  chrome.storage.local.set({ listings: saved, listings_version: version }, () => {
                    try { console.log('[Fast4MP content] 🟢 Badge merge complete → bump version + broadcast'); } catch (e) {}
                    try { chrome.runtime.sendMessage({ action: 'ffmRefreshSavedListings' }); } catch (_) {}
                    try { chrome.runtime.sendMessage({ action: 'ffm_refresh_popup' }); } catch (_) {}
                    try { chrome.runtime.sendMessage({ action: 'ffm_toast', text: 'Marked Active ✅' }); } catch (_) {}
                  });
                } catch (e) { console.debug('[Fast4MP content] failed to bump listings_version', e); }
              });
            } catch (e) { console.debug('[Fast4MP content] listings_version flow failed', e); }
          } catch (err) { console.error('[Fast4MP content] ❌ Badge merge failed', err); }
        });
      } catch (e) { console.debug('updateWhenOnSellingPage error', e); }
    };

    updateWhenOnSellingPage();
  } catch (err) { console.error('[Fast4MP content] ❌ Failed to schedule badge merge', err); }
  // Helper: detect Variant B delivery UI where the Delivery control exists but is disabled/greyed
  function detectVersionBDeliveryDisabled() {
    try {
      // Fast explicit pattern matches from user-provided samples
      try {
        // Version B: exact span that reads "Local pickup only" with compact class set
        const vb = document.querySelector('span.x6ikm8r.x10wlt62.xlyipyv.xuxw1ft');
        if (vb && (vb.textContent || '').toString().trim().toLowerCase().includes('local pickup')) {
          try { console.debug('detectVersionBDeliveryDisabled: matched explicit Version B span'); } catch (e) {}
          return true;
        }
      } catch (e) {}

      try {
        // Version A: anchor span with id _r_6t_
        const va = document.getElementById('_r_6t_');
        if (va && (va.textContent || '').toString().toLowerCase().includes('delivery')) {
          // Not Version B (disabled) by default; return false here to let normal flow handle
          try { console.debug('detectVersionBDeliveryDisabled: matched explicit Version A anchor'); } catch (e) {}
          return false;
        }
      } catch (e) {}

      // Look for delivery anchor text
      const anchor = Array.from(document.querySelectorAll('label, span, div')).find(n => {
        try {
          const t = (n.textContent || '').toString().trim().toLowerCase();
          return t === 'delivery method' || t.includes('delivery method') || t === 'delivery' || t.includes('delivery');
        } catch (e) { return false; }
      });
      if (!anchor) return false;
      // Find nearest control
      const preferSel = 'select, [role="combobox"], div[role="button"], button, [role="button"]';
      let control = null;
      if (anchor.nextElementSibling && anchor.nextElementSibling.matches && anchor.nextElementSibling.matches(preferSel)) control = anchor.nextElementSibling;
      if (!control) {
        let node = anchor;
        for (let i=0;i<6 && node;i++, node = node.parentElement) {
          try { const found = node.querySelector && node.querySelector(preferSel); if (found) { control = found; break; } } catch (e) {}
        }
      }
      if (!control) return false;
      // Heuristics to detect non-interactive / greyed control
      try {
        if (control.hasAttribute && (control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true')) return true;
        const style = window.getComputedStyle && window.getComputedStyle(control);
        if (style) {
          const op = parseFloat(style.opacity || '1');
          if (!isNaN(op) && op < 0.7) return true;
          const pe = style.pointerEvents || '';
          if (pe === 'none') return true;
        }
        // If the control text explicitly says 'Local pickup only' or similar and there are no selectable options nearby
        const txt = (control.textContent || '').toString().toLowerCase();
        if (txt.includes('local pickup only') || txt.includes('local pickup') && (txt.includes('only') || txt.includes('disabled'))) return true;
      } catch (e) {}
      return false;
    } catch (e) { return false; }
  }
  try {
    // Final safety: if auto-publish is allowed or a per-publish force flag exists in storage,
    // attempt to click Publish as a last resort. This helps scheduled runs that set a one-off
    // force flag in storage (ffm_force_auto_publish_<id>) to succeed even if the initial
    // populate message didn't include autoPublish due to messaging races.
    const checkForceFlag = (id) => new Promise((resolve) => {
      try {
        if (!id) return resolve(false);
        const key = 'ffm_force_auto_publish_' + id;
        try {
          chrome.storage.local.get([key], (res) => {
            try {
              const v = res && res[key];
              if (v) {
                // consume the one-off flag so repeated attempts won't auto-publish again
                try { chrome.storage.local.remove([key]); } catch (e) {}
              }
              resolve(!!v);
            } catch (e) { resolve(false); }
          });
        } catch (e) { resolve(false); }
      } catch (e) { try { resolve(false); } catch (_) {} }
    });

    // Ensure we honor either the in-message allowance or the per-publish force flag
  // publishId is used across multiple subsequent blocks (including Variant B detection),
  // declare it in this outer scope so it's available everywhere in the final-safety region.
  const publishId = window.ffm_staged_publish_request_id || null;
  try { console.debug('populate-fb: final-safety state: allow=' + (!!window.ffm_allow_auto_publish) + ', publishId=' + (publishId || 'null')); } catch (e) {}
  // final-safety auto-publish decision (FAST4MP OVERRIDE)
  // We ALWAYS allow auto-publish for SL / Scheduled publishes.
  // Only CLFP remains blocked.
  try {
    window.ffm_allow_auto_publish = true;
  } catch (e) {}
  try {
      if (!window.ffm_allow_auto_publish && publishId) {
        try {
          const forced = await checkForceFlag(publishId);
          if (forced) {
            try { console.debug('populate-fb: force-auto flag found for', publishId); } catch (e) {}
            window.ffm_allow_auto_publish = true;
          }
        } catch (e) { console.debug('populate-fb: checkForceFlag error', e); }
      }

    } catch (e) { console.debug('populate-fb: force-flag check outer error', e); }

  // Final safety: if auto-publish is allowed, attempt to click Publish as a last resort
  try { if (window && window.ffm_debug) console.debug && console.debug('FFM-TRACE: entering final-safety block, allow=' + (!!window.ffm_allow_auto_publish)); } catch (e) {}

  // Special-case: Variant B where delivery control is present but disabled/greyed and FB doesn't return a publishId.
  // In that case, consult persistent `auto_publish_enabled` so the global menu opt-in still triggers auto-publish.
  try {
    if (!window.ffm_allow_auto_publish && !publishId && typeof detectVersionBDeliveryDisabled === 'function') {
      let vbDetected = false;
      try {
        vbDetected = !!detectVersionBDeliveryDisabled();
        console.debug('populate-fb: detectVersionBDeliveryDisabled ->', vbDetected);
      } catch (e) { console.debug('populate-fb: detectVersionBDeliveryDisabled threw', e); }

      if (vbDetected) {
        try {
          // Prefer an inlined persistent hint from the message (if present) to avoid
          // a storage read and survive MV3 timing races. If not present, fall back
          // to reading storage as before.
          if (typeof message.menuAutoPersistent !== 'undefined') {
            if (message.menuAutoPersistent) {
              window.ffm_allow_auto_publish = true;
              console.debug('populate-fb: Version B detected and message.menuAutoPersistent is true; enabling auto-publish');
            } else {
              console.debug('populate-fb: Version B detected but message.menuAutoPersistent is false');
            }
          } else {
            // chrome.storage.local.get is callback-based; wrap in a Promise and await so
            // the final-safety logic reliably sees the persistent setting before deciding.
            const getStorage = (defaults) => new Promise((resolve) => {
              try { chrome.storage.local.get(defaults, (res) => resolve(res || {})); } catch (e) { resolve(defaults || {}); }
            });
            const res = await getStorage({ auto_publish_enabled: false });
            if (res && res.auto_publish_enabled) {
              window.ffm_allow_auto_publish = true;
              console.debug('populate-fb: Version B detected and persistent auto_publish_enabled is true; enabling auto-publish');
            } else {
              console.debug('populate-fb: Version B detected but persistent auto_publish_enabled is false');
            }
          }
        } catch (e) { console.debug('populate-fb: Version B detection storage block error', e); }
      } else {
        try { console.debug('populate-fb: Version B not detected, skipping persistent opt-in read'); } catch (e) {}
      }
    }
  } catch (e) { console.debug('populate-fb: Version B detection outer error', e); }

  if (window.ffm_allow_auto_publish) {
      try { console.debug('populate-fb: final auto-publish attempt starting'); } catch (e) {}
      // Try a few times with short delays (FB may render the Publish button a tick later)
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const ok = await ffmCallAttemptPublishClickSafe((typeof ffmAttemptPublishClick === 'function' ? ffmAttemptPublishClick : null), window.ffm_staged_publish_request_id || null, (window.ffm_staged_publish_listing && window.ffm_staged_publish_listing.inventoryName) || null);
          if (ok) { try { console.debug('populate-fb: final auto-publish succeeded on attempt', attempt+1); } catch (e) {} break; }
        } catch (e) { console.debug('populate-fb: final auto-publish attempt error', e); }
        await new Promise(r => setTimeout(r, 450));
      }
    }
  } catch (e) { console.debug('populate-fb: final auto-publish safety failed', e); }
      })();

      // Convert dataURLs to Files and set to a visible file input
      async function dataUrlToFile(dataUrl, filename) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], filename || 'image.jpg', { type: blob.type });
      }

      // images are handled sequentially in the async function above
    } catch (err) {
      console.debug('populate-fb handler error', err);
    }
  }
  // Handle toggling "always on top" pin state from background or popup
  if (message && message.action === 'set-pin-top') {
    (async () => {
      try {
        const val = !!message.value;
        await new Promise(r => chrome.storage.local.set({ ffm_pin_always_on_top: val }, r));
        // Apply to existing panel if present
        try {
          const panel = document.getElementById('extension-pin-panel') || document.querySelector('.ffm-pin-panel');
          if (panel) {
            try {
              if (val) { panel.classList.add('ffm-pin-always-on-top'); panel.style.zIndex = '2147483648'; }
              else { panel.classList.remove('ffm-pin-always-on-top'); panel.style.zIndex = ''; }
            } catch (e) { /* best-effort */ }
          }
        } catch (e) {}
        sendResponse && sendResponse({ ok: true, value: val });
      } catch (e) { sendResponse && sendResponse({ ok: false, error: (e && e.message) || e }); }
    })();
    return true;
  }

  // No asynchronous response will be sent here
});

// --- Auto-fill Description from Title/Price (rich in-page UI, mirrors Python features) ---
(function() {
  try {
    // Default templates similar to your Python UI
    const DEFAULTS = {
      Title: "{Inventory_Name} Mattress - Like New!",
      Description_1: "Beautiful {Inventory_Name} Mattress!\nTop of the line!\n\nUsed only a few days, Excellent condition!\n\nCleaned, sanitized, wrapped and ready for pick up or local delivery.\n\nAny Questions? Please ask!\n\nRetails for ${Retail_Price}+tax, only ${Price}!\n\nFREE local delivery - Venmo, Paypal, and Cash accepted.\n\n***Frame Not Included*Warranty does not transfer***",
      Description_2: "{Inventory_Name} Mattress! Flawless!\nMust see in person!\n\nUsed only a few weeks, Excellent condition!\n\nCleaned, sanitized, wrapped and ready for pick up or local delivery.\n\nRetails for ${Retail_Price}+tax, only ${Price}!\n\nFREE local delivery - Venmo, Paypal, and Cash accepted.\n\n***Frame Not Included*Warranty does not transfer***",
      Description_3: "{Inventory_Name} Mattress! Like New!\n\nLightly used during trial period, Excellent condition!\n\nMattress has been cleaned, sanitized, wrapped and ready for pick up or free local delivery.\n\nRetails for ${Retail_Price}+tax, only ${Price}!\n\nFREE local delivery - Venmo, Paypal, and Cash accepted.\n\n***Frame Not Included***\n***Warranty does not transfer***",
      Description_4: "Selling a {Inventory_Name} Mattress! Like New! Flawless!\n\nLightly used during trial period, Excellent condition!\n\nSelling Price = ${Price}!\n\nRetails Price = ${Retail_Price}+tax\n\nMattress has been cleaned, sanitized, wrapped and ready for pick up or free local delivery.\n\nFREE local delivery - Venmo, Paypal, and Cash accepted.\n\n***Frame Not Included***\n***Warranty does not transfer***"
    };

    let templates = Object.assign({}, DEFAULTS);

    // Storage key
    const STORAGE_KEY = 'ffm_description_templates';

    const titleSelectors = ['input[aria-label*="Title" i]','input[placeholder*="Title" i]','input[name*="title" i]','input[id*="title" i]','input[type="text"]'];
    const priceSelectors = ['input[aria-label*="Price" i]','input[placeholder*="Price" i]','input[name*="price" i]','input[type="number"]','input[type="text"]'];
    const retailSelectors = ['input[aria-label*="Retail" i]','input[placeholder*="Retail" i]','input[name*="retail" i]','input[id*="retail" i]'];
    const conditionSelectors = ['select[aria-label*="Condition" i]','[aria-label*="Condition" i]','select[name*="condition" i]'];
    const sizeSelectors = ['select[aria-label*="Size" i]','[aria-label*="Bed size" i]','select[name*="size" i]'];
    const coreSelectors = ['select[aria-label*="Core" i]','[aria-label*="Core" i]','select[name*="core" i]'];
    const comfortSelectors = ['select[aria-label*="Comfort" i]','[aria-label*="Comfort level" i]','select[name*="comfort" i]'];

    function safeGetStorage(cb) {
      try { chrome.storage.local.get([STORAGE_KEY], cb); } catch (e) { cb({}); }
    }
    function safeSetStorage(obj, cb) {
      try { chrome.storage.local.set(obj, cb || (()=>{})); } catch (e) { if (cb) cb(); }
    }

    // Load stored templates or seed defaults + migrate if needed
    const OLD_DEFAULTS = {
      Description_1: '{Inventory_Name} - {Condition}\nPrice: {Price} (Retail: {Retail_Price})\nSize: {Size} | Core: {Core} | Comfort: {Comfort}\n\nContact to arrange pickup.',
      Description_2: 'Selling {Inventory_Name} - {Condition}. Asking {Price}. In great condition. Local pickup only.',
      Description_3: '{Inventory_Name} - {Price}. Retail was {Retail_Price}. {Size} - {Core} - {Comfort}. Message me for details.',
      Description_4: '{Inventory_Name} - {Condition}. Clean, smoke-free home. {Price} or best offer. Pickup in person.',
      __popup_old_1: 'Like new {Size} mattress. Price: ${Price}. Retail: ${Retail_Price}. Condition: {Condition}.',
      __popup_old_2: 'Selling a {Core} {Size} mattress. {Comfort} feel. Asking ${Price}.',
      __popup_old_3: '',
      __popup_old_4: ''
    };

    safeGetStorage((res) => {
      try {
        const stored = (res && res[STORAGE_KEY]) ? res[STORAGE_KEY] : null;
        if (stored) {
          templates = Object.assign({}, DEFAULTS, stored);
          // migrate if stored equals one of the known old defaults (user likely never edited)
          const candidates = {
            Description_1: [OLD_DEFAULTS.Description_1, OLD_DEFAULTS.__popup_old_1],
            Description_2: [OLD_DEFAULTS.Description_2, OLD_DEFAULTS.__popup_old_2],
            Description_3: [OLD_DEFAULTS.Description_3, OLD_DEFAULTS.__popup_old_3],
            Description_4: [OLD_DEFAULTS.Description_4, OLD_DEFAULTS.__popup_old_4]
          };
          let changed = false;
          Object.keys(candidates).forEach((k) => {
            const val = stored[k];
            if (typeof val === 'string' && candidates[k].some(oldVal => oldVal === val)) {
              templates[k] = DEFAULTS[k];
              changed = true;
            }
          });
          if (changed) safeSetStorage({ [STORAGE_KEY]: templates });
        } else {
          // seed
          safeSetStorage({ [STORAGE_KEY]: templates });
        }
      } catch (e) {}
    });

    function formatTemplate(tpl, ctx) {
      tpl = tpl || '';
      const canonical = {
        inventory_name: 'Inventory_Name',
        price: 'Price',
        retail_price: 'Retail_Price',
        condition: 'Condition',
        size: 'Size',
        core: 'Core',
        comfort: 'Comfort'
      };
      tpl = tpl.replace(/(?:\$\{|\{)\s*([A-Za-z0-9_]+)\s*[\)\]\}]?/gi, (m, k) => {
        const key = (k || '').toString().trim();
        const low = key.toLowerCase();
        if (canonical[low]) {
          if (key === key.toUpperCase()) return '{' + canonical[low] + ':UPPER}';
          return '{' + canonical[low] + '}';
        }
        return m;
      });
      return tpl.replace(/\{(Inventory_Name|Price|Retail_Price|Condition|Size|Core|Comfort)(:UPPER)?\}/g, (m, k, up) => {
        const val = (ctx[k] !== undefined && ctx[k] !== null) ? ctx[k] : '';
        return up ? ('' + val).toString().toUpperCase() : val;
      });
    }

    // Reuse helper from prior implementation
    function getFieldValueBySelectors(selList) {
      for (const s of selList) {
        try {
          const el = document.querySelector(s);
          if (!el) continue;
          let v = '';
          const tag = el.tagName && el.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || el.value !== undefined) v = el.value || el.textContent || '';
          else v = el.textContent || '';
          if (v && v.toString().trim()) return v.toString().trim();
        } catch (e) {}
      }
      return '';
    }

    function setDescriptionText(text) {
      try {
        // Prefer a textarea labelled Description
        let desc = document.querySelector('textarea[aria-label*="Description" i], textarea[placeholder*="Description" i], textarea');
        if (!desc) {
          desc = Array.from(document.querySelectorAll('[role="textbox"], [contenteditable="true"]')).find(n => {
            try {
              const a = (n.getAttribute && (n.getAttribute('aria-label') || '')).toString().toLowerCase();
              const p = (n.placeholder || '').toString().toLowerCase();
              const txt = (n.textContent || '').toString().toLowerCase();
              return a.includes('description') || p.includes('description') || txt.length < 2000;
            } catch (e) { return false; }
          });
        }
        if (!desc) return false;
        if (desc.tagName && desc.tagName.toLowerCase() === 'textarea') {
          desc.value = text;
          desc.dispatchEvent(new Event('input', { bubbles: true }));
          desc.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          try { desc.focus && desc.focus(); } catch (e) {}
          desc.innerText = text;
          desc.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
        return true;
      } catch (e) { return false; }
    }

    function setTitleText(text) {
      try {
        const t = getFieldElement(titleSelectors);
        if (!t) return false;
        if (t.tagName && t.tagName.toLowerCase() === 'input') {
          t.value = text;
          t.dispatchEvent(new Event('input', { bubbles: true }));
          t.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          try { t.focus && t.focus(); } catch (e) {}
          if (t.isContentEditable) { t.innerText = text; t.dispatchEvent(new InputEvent('input', { bubbles: true })); }
        }
        return true;
      } catch (e) { return false; }
    }

    function getFieldElement(selList) {
      for (const s of selList) {
        try { const el = document.querySelector(s); if (el) return el; } catch (e) {}
      }
      return null;
    }

    function buildContext() {
      return {
        // Prefer the listing's inventoryName/title if we're populating from a listing to avoid
        // recursive/template re-expansion (reading the live title field would cause the
        // title template to keep embedding the prior title on each re-apply).
        Inventory_Name: (typeof listing !== 'undefined' && (listing.inventoryName || listing.title)) ? (listing.inventoryName || listing.title) : (getFieldValueBySelectors(titleSelectors) || ''),
        Price: getFieldValueBySelectors(priceSelectors) || '',
        Retail_Price: getFieldValueBySelectors(retailSelectors) || '',
        Condition: getFieldValueBySelectors(conditionSelectors) || '',
        Size: getFieldValueBySelectors(sizeSelectors) || '',
        Core: getFieldValueBySelectors(coreSelectors) || '',
        Comfort: getFieldValueBySelectors(comfortSelectors) || ''
      };
    }

    // In-page description panel removed per user request (migrated to popup app UI).

  } catch (e) { console.debug('ffm: rich description autofill failed', e); }
})();

// Respond to explicit debug dump requests by returning inline JSONs directly
try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || message.action !== 'ffm_dump_inline_jsons') return;
      (async () => {
        try {
          const inline_jsons = [];
          const scripts = Array.from(document.getElementsByTagName('script'));
          for (const s of scripts) {
            try {
              const txt = (s.textContent || '').trim();
              if (!txt) continue;
              // If script is explicit application/json, try to parse whole text
              if (s.type && s.type.toLowerCase() === 'application/json') {
                try { inline_jsons.push(JSON.parse(txt)); continue; } catch (e) { inline_jsons.push({ __raw: txt.slice(0, 2000) }); continue; }
              }

              // Heuristic: look for top-level JSON-like assignments such as window.X = {...};
              try {
                const firstBrace = txt.indexOf('{');
                const lastBrace = txt.lastIndexOf('}');
                if (firstBrace >= 0 && lastBrace > firstBrace) {
                  const candidate = txt.substring(firstBrace, lastBrace + 1);
                  try { inline_jsons.push(JSON.parse(candidate)); continue; } catch (e) { /* not valid JSON */ }
                }
              } catch (e) { /* ignore */ }
            } catch (e) { /* ignore per-script errors */ }
          }

          // Also attempt to extract any globals that look like page JSON containers
          try {
            const names = Object.getOwnPropertyNames(window || {}).slice(0, 1200);
            for (const n of names) {
              try {
                const v = window[n];
                if (!v || typeof v !== 'object') continue;
                if (v === window || v instanceof Node) continue;
                try {
                  const sval = JSON.stringify(v);
                  if (sval && sval.length > 20 && sval.length < 200000) {
                    inline_jsons.push(v);
                  }
                } catch (e) { /* skip non-serializable */ }
              } catch (e) {}

              // Expose a content-side scraper so background can message this tab directly.
              try {
                async function contentScrape() {
                  try {
                    // Wait helper: resolves when selector appears or timeout
                    const once = (selector, timeout = 1200) => new Promise((res) => {
                      try {
                        const el = document.querySelector(selector);
                        if (el) return res(el);
                        const obs = new MutationObserver(() => {
                          try {
                            const e2 = document.querySelector(selector);
                            if (e2) { try { obs.disconnect(); } catch(_){}; res(e2); }
                          } catch(_){}
                        });
                        try { obs.observe(document.documentElement || document, { childList: true, subtree: true }); } catch(_){}
                        setTimeout(() => { try { obs.disconnect(); } catch(_){}; res(null); }, timeout);
                      } catch (e) { res(null); }
                    });

                    try { await once('p.inventory-details__link-lbl, .inventory-details__tooltip-text, h1, h2, h3', 1500); } catch (e) {}
                    const visible = (el) => !!el && el.offsetParent !== null;
                    const textOf = (el) => (el && (el.innerText || el.textContent) || '').toString().trim();
                    const getHeadings = () => Array.from(document.querySelectorAll('h1, h2, h3')).filter(visible);
                    const moneyRe = /\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/;
                    const norm = (s) => (s||'').toString().trim().replace(/\s+/g,' ').toLowerCase();
                    const stripUnwantedPreserveCase = (s) => {
                      try {
                        let out = (s||'').toString();
                        out = out.replace(/\(\s*\d+(?:\.\d+)?/g, '(');
                        out = out.replace(/[()]/g,' ');
                        out = out.replace(/\bthe\b/ig, ' ');
                        out = out.replace(/\bmattress\b/ig, ' ');
                        out = out.replace(/,/g, ' ');
                        out = out.replace(/\s+/g,' ').trim();
                        return out;
                      } catch (e) { return (s||'').toString().trim(); }
                    };
                    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                    const findMoneyNear = (labelList) => {
                      try {
                        const els = Array.from(document.querySelectorAll('*')).filter(e => {
                          try { return e.children && e.children.length >= 0 && textOf(e) && labelList.some(l => norm(textOf(e)).includes(l)); } catch (_) { return false; }
                        });
                        for (const el of els) {
                          try {
                            const m = textOf(el).match(moneyRe);
                            if (m && m[0]) return m[0];
                          } catch(e){}
                          try {
                            const sibs = [el.nextElementSibling, el.parentElement && el.parentElement.nextElementSibling].filter(Boolean);
                            for (const s of sibs) { const m = textOf(s).match(moneyRe); if (m && m[0]) return m[0]; }
                          } catch(e){}
                          try {
                            const p = el.parentElement; if (p) {
                              const cand = Array.from(p.querySelectorAll('*')).find(n => moneyRe.test(textOf(n)));
                              if (cand) { const m = textOf(cand).match(moneyRe); if (m && m[0]) return m[0]; }
                            }
                          } catch(e){}
                        }
                      } catch(e){}
                      return null;
                    };

                    const findValueAfterLabel = (labelText) => {
                      try {
                        const labels = Array.from(document.querySelectorAll('.inventory-details__tooltip-text, span, div, label'))
                          .filter(el => visible(el) && norm(textOf(el)).includes(norm(labelText)));
                        const isWithinRetail = (el) => {
                          try {
                            let n = el; let steps = 0;
                            while (n && steps < 6) {
                              if (/\b(retail|msrp)\b/i.test((n.textContent||''))) return true;
                              n = n.parentElement; steps++;
                            }
                          } catch (e) {}
                          return false;
                        };
                        for (const lab of labels) {
                          let sib = lab.nextElementSibling; let hop = 0;
                          while (sib && hop < 4) {
                            const t = textOf(sib);
                            const m = t.match(moneyRe);
                            if (m && m[0] && !isWithinRetail(sib)) return m[0];
                            sib = sib.nextElementSibling; hop++;
                          }
                          const container = lab.parentElement;
                          if (container) {
                            const candidates = Array.from(container.querySelectorAll('.large.grey.nunitosans-bold, .nunitosans-bold, div, span, p'))
                              .filter(e => visible(e) && /\$/.test(textOf(e)) && !isWithinRetail(e));
                            for (const c of candidates) {
                              const m = textOf(c).match(moneyRe);
                              if (m && m[0]) return m[0];
                            }
                          }
                        }
                      } catch (e) {}
                      return null;
                    };

                    const scanDollarCandidates = () => {
                      try {
                        const candNodes = Array.from(document.querySelectorAll('div.large.grey.nunitosans-bold, .nunitosans-bold, div, span, p'))
                          .filter(e => visible(e) && /\$/.test(textOf(e)) && !isWithinRetail(e));
                        const amounts = candNodes.map(e => {
                          const t = textOf(e); const m = t.match(moneyRe); const raw = m && m[0];
                          if (!raw) return null; const num = parseFloat((m[1]||'').replace(/,/g,''));
                          return (isFinite(num) ? { el: e, raw, num } : null);
                        }).filter(Boolean);
                        amounts.sort((a,b)=>a.num-b.num);
                        return amounts;
                      } catch (e) { return []; }
                    };

                    // Title: try Sharetown-specific element, then fall back to headings
                    let title = '';
                    try { const stTitleEl = document.querySelector('p.inventory-details__link-lbl'); if (stTitleEl) title = textOf(stTitleEl).replace(/\s+/g,' ').trim(); } catch (e) {}
                    if (!title) {
                      const heads = getHeadings();
                      if (heads.length >= 2) {
                        title = textOf(heads[1]) || '';
                        if (!title || title.length < 6) title = (textOf(heads[0]) + ' ' + textOf(heads[1])).trim();
                      } else if (heads.length === 1) {
                        title = textOf(heads[0]);
                      } else {
                        title = document.title.replace(/\s+-\s+Sharetown.*/i, '').trim();
                      }
                    }

                    // Listing Name
                    let listingName = '';
                    try { const nameEl = document.querySelector('h3.inventory-details__title'); if (nameEl) listingName = textOf(nameEl); } catch (e) {}

                    const cleanedBase = stripUnwantedPreserveCase(listingName);
                    const cleanedTitle = stripUnwantedPreserveCase(title);
                    let combinedName = '';
                    if (cleanedTitle && cleanedBase && new RegExp('\\b' + escapeRe(cleanedBase) + '\\b', 'i').test(cleanedTitle)) {
                      combinedName = cleanedTitle;
                    } else if (cleanedTitle) {
                      combinedName = [cleanedBase, cleanedTitle].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
                    } else {
                      combinedName = cleanedBase || '';
                    }
                    combinedName = combinedName.replace(/\b(\w+)(\s+\1\b)+/gi, '$1').replace(/\s+/g,' ').trim();

                    const retail = findValueAfterLabel('retail price') || findValueAfterLabel('msrp') || findMoneyNear(['retail price','msrp']) || '';
                      let pricePref = '';
                      let priceSource = null;
                      try {
                        // Broaden label checks to catch variations like "min ad" / "minimum ad price"
                        const labelChecks = ['min ad price','min ad','minimum ad price','minimum ad','min price','minimum price'];
                        for (const lbl of labelChecks) {
                          try {
                            const pv = findValueAfterLabel(lbl);
                            if (pv) { pricePref = pv; priceSource = 'label-' + lbl.replace(/\s+/g,'-'); break; }
                          } catch (e) {}
                        }
                        // If not found via label, try near-label heuristic
                        if (!pricePref) {
                          const p3 = findMoneyNear(['min ad price','min price','min ad','minimum ad']);
                          if (p3) { pricePref = p3; priceSource = 'near-min-label'; }
                        }
                      } catch (e) {}

                      // Collect scan candidates and include them in debug so we can triage mis-selections
                      const amounts = (() => { try { return scanDollarCandidates(); } catch (e) { return []; } })();
                      const debugCandidates = (amounts || []).map(a => ({ raw: a.raw, num: a.num, text: (a.el && (a.el.innerText||a.el.textContent) || '').toString().trim().slice(0,120) }));

                      // If still no price pref, fall back to the smallest non-retail candidate
                      if (!pricePref && amounts && amounts.length) {
                        pricePref = amounts[0].raw; priceSource = 'scan-smallest';
                      }

                      const retailClean = (()=>{ const m = (retail||'').match(moneyRe); return m ? m[1].replace(/,/g,'') : ''; })();
                      let priceCleanTmp = (()=>{ const m = (pricePref||'').match(moneyRe); return m ? m[1].replace(/,/g,'') : ''; })();
                      if (retailClean && priceCleanTmp && retailClean === priceCleanTmp) {
                        // Prefer the smallest amount that is not equal to retail
                        const alt = (amounts || []).find(a => String(a.num) !== retailClean);
                        if (alt) { pricePref = alt.raw; priceSource = 'scan-alt-non-retail'; }
                      }

                      const cleanMoney = (s) => {
                        if (!s) return '';
                        const m = s.match(moneyRe); const v = m ? m[1] : s.replace(/[^0-9.]/g,'');
                        return v ? (v.replace(/,/g,'')) : '';
                      };
                      return { inventoryName: combinedName, title: combinedName, retailPrice: cleanMoney(retail), price: cleanMoney(pricePref), debug: { priceSource, candidates: debugCandidates } };
                  } catch (e) { return null; }
                }

                // Listen for background requests to perform generate scrape
                try {
                  chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                    try {
                        if (!message || message.action !== 'perform-generate-scrape') return;
                        try { console.debug && console.debug('[Fast4MP content] perform-generate-scrape received from', sender && sender.tab ? sender.tab.id : sender); } catch (e) {}
                        (async () => {
                          try {
                            const res = await contentScrape();
                            try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: Object.assign({}, res, { timestamp: Date.now() }) }); } catch (e) {}
                            try { console.debug && console.debug('[Fast4MP content] perform-generate-scrape result', res); } catch (e) {}
                            try { sendResponse && sendResponse(res); } catch (e) { try { console.debug && console.debug('[Fast4MP content] sendResponse failed', e); } catch (er) {} }
                          } catch (e) { try { console.debug && console.debug('[Fast4MP content] perform-generate-scrape error', e); } catch (er) {} try { sendResponse && sendResponse(null); } catch (er) {} }
                        })();
                        // Indicate async response
                        return true;
                    } catch (e) {}
                  });
                } catch (e) {}
              } catch (e) {}
            }
          } catch (e) {}

          // Deduplicate simple by JSON string
          try {
            const seen = new Set();
            const uniq = [];
            for (const j of inline_jsons) {
              try {
                const key = typeof j === 'string' ? j : JSON.stringify(j);
                if (!key) continue;
                if (seen.has(key)) continue;
                seen.add(key);
                uniq.push(j);
              } catch (e) { /* skip */ }
            }
            // persist a lightweight snapshot for compatibility with existing UI
            // debug inline JSONs storage write removed
            sendResponse && sendResponse({ ok: true, count: uniq.length, inline_jsons: uniq.slice(0, 120) });
          } catch (e) { sendResponse && sendResponse({ ok: true, count: inline_jsons.length, inline_jsons }); }
        } catch (err) {
          sendResponse && sendResponse({ ok: false, reason: 'error', err: String(err) });
        }
      })();
      return true;
    } catch (e) {}
  });
} catch (e) { console.debug('ffm_dump_inline_jsons listener install failed', e); }

// Seller page IID injection removed: Invisible-ID (IID) engine deprecated.
// The hourly Auto Active Scan (AAS) workflow is authoritative now.
          })();

          // Respond immediately so the background sender doesn't see "port closed"
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
          return true; // keep channel open for async work if caller expects it
    }
})();

