importScripts('mediaDB.js');

// Keyboard-shortcut reload (Ctrl+Shift+Space, "global": true in manifest.json
// "commands" so it fires even when Chrome isn't the focused window). Stamps a
// timestamp flag before reloading; once the fresh service worker boots back
// up (see ffmShowReloadNotificationIfPending below), it fires a real Windows
// notification (bottom-right, by the clock) confirming the reload completed.
// This doesn't depend on the side panel being open, unlike an in-page toast.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'reload-extension') {
    try {
      chrome.storage.local.set({ ffm_reload_toast_pending: Date.now() }, () => {
        try { chrome.runtime.reload(); } catch (e) {}
      });
    } catch (e) {
      try { chrome.runtime.reload(); } catch (e2) {}
    }
  }
});

// Runs every time this service worker starts (including right after the
// reload above). If the reload flag is set and fresh, fire a real Windows
// notification confirming the reload finished, then clear the flag so it
// doesn't fire again on a later, unrelated startup. No forced auto-dismiss —
// it behaves like any other Windows notification (Chrome/Windows own timing).
function ffmShowReloadNotificationIfPending() {
  try {
    chrome.storage.local.get({ ffm_reload_toast_pending: 0 }, (r) => {
      try {
        const ts = r && r.ffm_reload_toast_pending;
        console.log('[BG reload-notif] flag check', { ts, ageMs: ts ? (Date.now() - ts) : null });
        if (!ts || (Date.now() - ts) >= 10000) return;
        chrome.storage.local.remove('ffm_reload_toast_pending');
        chrome.notifications.create('ffm-reload-' + Date.now(), {
          type: 'basic',
          iconUrl: 'images/icon128.png',
          title: 'AutoList Pro',
          message: 'Extension reloaded'
        }, (notifId) => {
          if (chrome.runtime.lastError) {
            console.error('[BG reload-notif] notifications.create failed', chrome.runtime.lastError.message);
          } else {
            console.log('[BG reload-notif] notification created', notifId);
          }
        });
      } catch (e) { console.error('[BG reload-notif] inner error', e); }
    });
  } catch (e) { console.error('[BG reload-notif] outer error', e); }
}
ffmShowReloadNotificationIfPending();

// Load central config for background (must run before auth init)
try {
  importScripts('config.js');
  try { console.log('[BG] Imported config.js'); } catch (e) {}
} catch (e) {
  try { console.warn('[BG] Failed to import config.js', e); } catch (e) {}
}

// -------------------------
// Debug Log Collector (BG)
// -------------------------
// Stores recent background + content logs in memory (ring buffer) and can upload to S3 on demand.
// Enable/disable is persisted in chrome.storage.local under: ffm_debuglog_enabled
const FFM_DEBUGLOG = {
  enabled: false,
  buf: [],
  max: 2000,
  page: new Map()
};

function ffmDbgNowIso() {
  try { return new Date().toISOString(); } catch (e) { return String(Date.now()); }
}

function ffmDbgPush(scope, level, lines) {
  try {
    if (!FFM_DEBUGLOG.enabled) return;
    const entry = { at: ffmDbgNowIso(), scope: scope || 'bg', level: level || 'info', lines: Array.isArray(lines) ? lines.slice() : [String(lines)] };
    FFM_DEBUGLOG.buf.push(entry);
    if (FFM_DEBUGLOG.buf.length > FFM_DEBUGLOG.max) FFM_DEBUGLOG.buf = FFM_DEBUGLOG.buf.slice(-FFM_DEBUGLOG.max);
  } catch (e) {}
}

async function ffmDbgSetEnabled(val) {
  try {
    FFM_DEBUGLOG.enabled = !!val;
    await new Promise((res) => { try { chrome.storage.local.set({ ffm_debuglog_enabled: FFM_DEBUGLOG.enabled }, res); } catch (e) { res(true); } });
  } catch (e) {}
}

function ffmDbgLoadEnabledFlag() {
  try {
    try { chrome.storage.local.get(['ffm_debuglog_enabled'], (res) => { FFM_DEBUGLOG.enabled = !!(res && res.ffm_debuglog_enabled); }); } catch (e) { FFM_DEBUGLOG.enabled = false; }
  } catch (e) {}
}

function ffmDbgSnapshot() {
  try {
    return {
      at: ffmDbgNowIso(),
      scope: 'bg',
      enabled: FFM_DEBUGLOG.enabled,
      logs: FFM_DEBUGLOG.buf.slice(-FFM_DEBUGLOG.max),
      pages: Array.from(FFM_DEBUGLOG.page.entries()).map(([tabId, v]) => ({ tabId, ...v }))
    };
  } catch (e) {
    return { at: ffmDbgNowIso(), scope: 'bg', enabled: FFM_DEBUGLOG.enabled, logs: [], pages: [] };
  }
}

// Uses backend signer to upload JSON to S3 under users/<userId>/debug_logs/
async function ffmDbgUploadToS3(userId, payload) {
  // Cloud sync removed — AutoList Pro is local-only now.
  throw new Error('Cloud debug-log upload removed (local-only build)');
  // eslint-disable-next-line no-unreachable
  let apiBase = (globalThis.AutoListProConfig && globalThis.AutoListProConfig.apiBase) ? globalThis.AutoListProConfig.apiBase : '';
  // Fallback: try stored ffm_aws_api_base in chrome.storage.local (user-configured)
  if (!apiBase) {
    try {
      const out = await new Promise(res => { try { chrome.storage.local.get(['ffm_aws_api_base'], res); } catch (e) { res({}); } });
      if (out && out.ffm_aws_api_base) apiBase = String(out.ffm_aws_api_base).trim();
    } catch (e) {}
  }
  // Final fallback: use known default API base used in popup if available
  if (!apiBase) {
    try {
      apiBase = 'https://9roa2qwu7e.execute-api.us-west-1.amazonaws.com/prod';
      console.warn('[DebugLog] No apiBase configured; falling back to default API base', apiBase);
    } catch (e) {}
  }
  if (!apiBase) throw new Error('Missing apiBase (AutoListProConfig.apiBase or ffm_aws_api_base)');
  if (!userId) throw new Error('Missing userId');

  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const key = `users/${userId}/debug_logs/${stamp}_${rand}_debuglog.json`;

  const signResp = await fetch(apiBase + '/sign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, contentType: 'application/json' })
  });
  if (!signResp.ok) throw new Error('sign-upload failed: ' + signResp.status);
  const signJson = await signResp.json();
  if (!signJson || !signJson.url) throw new Error('sign-upload missing url');

  const putResp = await fetch(signJson.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!putResp.ok) throw new Error('S3 PUT failed: ' + putResp.status);

  return { key };
}

// bootstrap
ffmDbgLoadEnabledFlag();

// Sanity: log supabaseAnonKey length (do not log the key itself)

// Register a canonical background ping listener and mark the BG ready.
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.type !== 'ffm_bg_ping') return false;
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
      } catch (e) {}
      return false;
    });
  }
} catch (e) {}

// Open URL on behalf of popup (reliable from background)
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.type !== 'ffm-open-url' || !msg.url) return false;
        try {
          chrome.tabs.create({ url: msg.url, active: true }, (tab) => {
            try { sendResponse({ ok: true }); } catch (e) {}
          });
        } catch (e) {
          try {
            chrome.windows.create({ url: msg.url, type: 'popup' });
            try { sendResponse({ ok: true }); } catch (e) {}
          } catch (ee) {
            try { sendResponse({ ok: false, error: String(ee) }); } catch (e) {}
          }
        }
        return true;
      } catch (e) {}
      return false;
    });
  }
} catch (e) {}

try { ffmMarkBgReady(); } catch (e) {}
// Listen for a debug message to trigger ADS rebuild from DevTools.
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
          if (!msg) return false;
        const action = msg.action || msg.type || null;
          // Bring a content tab/window to the foreground when requested by content
          if (action === 'ffm_bring_tab_foreground') {
            try {
              const tabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : (msg.tabId || null);
              const windowId = (sender && sender.tab && sender.tab.windowId) ? sender.tab.windowId : (msg.windowId || null);
              if (windowId) {
                try {
                  chrome.windows.update(windowId, { focused: true, state: 'normal' }, () => {
                    try {
                      if (tabId) {
                        try { chrome.tabs.update(tabId, { active: true }, () => { try { sendResponse && sendResponse({ ok: true }); } catch(e){} }); } catch(e){ try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch(_){} }
                      } else {
                        try { sendResponse && sendResponse({ ok: true }); } catch(e){}
                      }
                    } catch (ee) { try { sendResponse && sendResponse({ ok: false, error: String(ee) }); } catch(_){} }
                  });
                } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch(_){} }
              } else if (tabId) {
                try { chrome.tabs.update(tabId, { active: true }, () => { try { sendResponse && sendResponse({ ok: true }); } catch(e){} }); } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch(_){} }
              } else {
                try { sendResponse && sendResponse({ ok: false, error: 'no tab/window info' }); } catch(_){}
              }
            } catch (err) { try { sendResponse && sendResponse({ ok: false, error: String(err) }); } catch(_){} }
            return true;
          }
        if (action !== 'ffm_rebuild_ads') return false;
        // Wait up to 5s for ffmAdsRebuildAllAlarms to become available (SW boot race)
        const waitForRebuild = async () => {
          const start = Date.now();
          while ((Date.now() - start) < 5000) {
            if (typeof ffmAdsRebuildAllAlarms === 'function') break;
            await new Promise(r => setTimeout(r, 200));
          }
          if (typeof ffmAdsRebuildAllAlarms === 'function') {
            try {
              const summary = await ffmAdsRebuildAllAlarms('message-triggered');
              try { sendResponse({ ok: true, summary }); } catch (e) {}
            } catch (err) {
              try { sendResponse({ ok: false, error: String(err) }); } catch (e) {}
            }
          } else if (typeof ffmAdsRebuildPerListingAlarms === 'function') {
            // Full rebuild unavailable; run per-listing rebuild fallback and
            // return a normalized summary object so callers get useful data.
            try {
              const res = await ffmAdsRebuildPerListingAlarms();
              const summary = res && typeof res === 'object' ? res : { totalRules: 0, jobsCreated: 0, jobsRescheduled: 0, jobsSkipped: 0, alarmsActive: 0 };
              try { sendResponse({ ok: true, summary, fallback: true }); } catch (e) {}
            } catch (err) {
              try { sendResponse({ ok: false, error: String(err) }); } catch (e) {}
            }
          } else {
            try { sendResponse({ ok: false, error: 'rebuild_not_available' }); } catch (e) {}
          }
        };
        waitForRebuild();
        return true; // will respond asynchronously
      } catch (e) { return false; }
    });
  }
} catch (e) {}
try {
  try { console.log('[BG] FFM_CONFIG key length:', globalThis.FFM_CONFIG?.supabaseAnonKey?.length); } catch (e) {}
} catch (e) {}

// Install early, defensive ADS-attention render/restore stubs so tooling can
// call them even before the full ADS helper set is loaded. These are safe
// no-ops that write badges/notifications directly and tolerate missing APIs.
try {
  if (typeof globalThis !== 'undefined') {
    if (typeof globalThis.renderAdsAttention !== 'function') {
      globalThis.renderAdsAttention = function(data) {
        try {
          if (!data) return;
          const count = Number(data.count || 0) || 0;
          try { chrome.action.setBadgeText({ text: String(count) }); } catch (e) {}
          try { chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' }); } catch (e) {}
          const list = Array.isArray(data.events)
            ? data.events.slice(-5).map(ev => {
                const when = ev && ev.at ? new Date(ev.at).toLocaleString() : '';
                const title = ev && ev.title ? ev.title : '';
                return `• ${when}${when && title ? ' — ' : ''}${title}`;
              }).join('\n')
            : '';
          const titleText = `Advanced Scheduler completed ${ (Array.isArray(data.events) ? data.events.length : count) } task(s)\n\n${list}\n\nClick to reopen AutoList Pro`;
          try { chrome.action.setTitle({ title: titleText }); } catch (e) {}
          try { chrome.notifications.create('FFM_ADS_COMPLETE', { type: 'basic', iconUrl: 'images/icon128.png', title: `🎉 ADS Complete (${count})`, message: list + `\n\nTap "Open AutoList Pro" to review.`, priority: 2, requireInteraction: true, buttons: [{ title: 'Open AutoList Pro' }, { title: 'Dismiss' }] }, () => {}); } catch (e) {}
        } catch (e) {}
      };
      try { console.log('[AutoList Pro bg] installed early renderAdsAttention stub'); } catch (e) {}
    }

    if (typeof globalThis.ffmRestoreAdsAttentionAfterBoot !== 'function') {
      globalThis.ffmRestoreAdsAttentionAfterBoot = async function() {
        try {
          const snap = await new Promise(r => { try { chrome.storage.local.get(['ffm_ads_attention'], r); } catch (e) { r({}); } });
          const data = snap && snap.ffm_ads_attention ? snap.ffm_ads_attention : null;
          if (!data) return;
          try { globalThis.renderAdsAttention && globalThis.renderAdsAttention(data); } catch (e) {}
        } catch (e) {}
      };
      try { console.log('[AutoList Pro bg] installed early ffmRestoreAdsAttentionAfterBoot stub'); } catch (e) {}
    }
  }
} catch (e) {}

// ==============================
// Load AutoList Pro config into background (MV3)
// ==============================
try {
  console.log('[AutoList Pro bg] mediaDB.js loaded');
} catch (e) {
  console.warn('[AutoList Pro bg] Failed to load config.js', e);
}

// Await an ffm_as_hidden_result message with a matching reqId (sent by content autorun)
function awaitHiddenAsResult(reqId, timeoutMs = 45000, tabId = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { chrome.runtime.onMessage.removeListener(onMsg); } catch (e) {}
        try { console.warn('[bg] awaitHiddenAsResult timeout for reqId', reqId, 'tabId', tabId); } catch (e) {}
        resolve(null);
      }
    }, timeoutMs);

    function onMsg(msg, sender) {
      try {
        if (!msg || msg.action !== 'ffm_as_hidden_result') return;

        // Accept when reqId matches OR when the message originates from the helper tab (fallback)
        const fromTabMatch = tabId && sender && sender.tab && (sender.tab.id === tabId);
        const reqMatch = reqId && msg.reqId && String(msg.reqId) === String(reqId);

        if (fromTabMatch || reqMatch) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            try { chrome.runtime.onMessage.removeListener(onMsg); } catch (e) {}
            const out = { listings: msg.listings || [], meta: msg.meta || {}, count: Array.isArray(msg.listings) ? msg.listings.length : 0 };
            resolve(out);
          }
        }
      } catch (e) {}
    }

      // -------------------------
      // Side panel restore handshake (gesture-safe)
      // -------------------------
      (function installSidePanelRestoreHandshake() {
        try {
          // Call this BEFORE you do your controlled reload
          globalThis.ffmMarkSidePanelRestoreWanted = function ffmMarkSidePanelRestoreWanted(reason) {
            try {
              chrome.storage.local.set({
                ffm_sidepanel_restore_wanted: true,
                ffm_sidepanel_restore_reason: String(reason || ''),
                ffm_sidepanel_restore_ts: Date.now()
              }, () => {});
            } catch (e) {}
          };

          // Call this on startup to notify UI "please reopen when possible"
          async function ffmRequestSidePanelRestoreOnBoot() {
            try {
              chrome.storage.local.get(['ffm_sidepanel_restore_wanted'], (res) => {
                try {
                  if (!res || !res.ffm_sidepanel_restore_wanted) return;

                  console.warn('[AutoList Pro] 🔁 Side panel restore requested (gesture required)');

                  // Notify any UI (popup/sidepanel) that next user gesture should open SP
                  try {
                    chrome.runtime.sendMessage({ action: 'ffm_sidepanel_restore_request' });
                  } catch (e) {}
                } catch (e) {}
              });
            } catch (e) {}
          }

          // run shortly after boot
          setTimeout(() => { try { ffmRequestSidePanelRestoreOnBoot(); } catch (e) {} }, 1500);

          console.warn('[AutoList Pro] Side panel restore handshake installed');
        } catch (e) {
          console.warn('[AutoList Pro] Side panel restore handshake failed to install', e);
        }
      })();

    try { chrome.runtime.onMessage.addListener(onMsg); } catch (e) {}
  });
}

// Simple price parser: "$1,234" -> 1234
function parsePrice(p) {
  try {
    if (typeof p === 'number') return Number(p);
    if (!p) return NaN;
    const s = String(p).replace(/[^0-9\.\-]/g, '');
    if (!s) return NaN;
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  } catch (e) { return NaN; }
}

// Ensure a window (or a tab's window) is not minimized before opening a new tab there.
// Restores minimized windows to normal state without stealing focus and waits briefly
// so React/FB can accept commits. Returns true if a restore occurred.
async function ensureWindowNotMinimizedByWindow(windowId) {
  return new Promise((resolve) => {
    try {
      if (!windowId) return resolve(false);
      try {
        chrome.windows.get(windowId, (win) => {
          try {
            if (!win) return resolve(false);
            if (win.state === 'minimized') {
              try {
                chrome.windows.update(win.id, { state: 'normal', focused: false }, () => {
                  // give FB/React a small moment to accept commits
                  setTimeout(() => resolve(true), 150);
                });
              } catch (e) {
                return resolve(false);
              }
            } else {
              return resolve(false);
            }
          } catch (e) { return resolve(false); }
        });
      } catch (e) { return resolve(false); }
    } catch (e) { return resolve(false); }
  });
}

// Backwards-compatible helper: accept a tabId, look up its window, and ensure not minimized.
async function ensureWindowNotMinimized(tabId) {
  try {
    if (!tabId) return false;
    const tab = await new Promise(res => { try { chrome.tabs.get(tabId, res); } catch (e) { res(null); } });
    if (!tab || !tab.windowId) return false;
    return await ensureWindowNotMinimizedByWindow(tab.windowId);
  } catch (e) { return false; }
}

// Token Jaccard similarity (0..1)
function stringSimilarity(a, b) {
  try {
    if (!a || !b) return 0;
    const na = String(a).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const nb = String(b).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const A = new Set(na.split(' ').filter(Boolean));
    const B = new Set(nb.split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const t of A) if (B.has(t)) inter++;
    const union = new Set([...A, ...B]).size;
    return union === 0 ? 0 : (inter / union);
  } catch (e) { return 0; }
}

// Merge secondary into primary using title grade + price anchor
function mergeScrapeSets(primary, secondary) {
  try {
    const STRONG_MATCH = 0.7;
    const merged = Array.isArray(primary) ? [...primary] : [];

    for (const cand of (secondary || [])) {
      try {
        const candPrice = parsePrice(cand.price);
        const match = merged.find(existing => {
          const sim = stringSimilarity(existing.title, cand.title);
          if (sim < STRONG_MATCH) return false;
          const existingPrice = parsePrice(existing.price);
          if (!isNaN(existingPrice) && !isNaN(candPrice)) {
            return Math.abs(existingPrice - candPrice) <= 5;
          }
          // If we can't parse prices, fall back to similarity only
          return sim >= STRONG_MATCH;
        });

        if (!match) merged.push(cand);
      } catch (e) { /* ignore per-candidate errors */ }
    }
    return merged;
  } catch (e) { return Array.isArray(primary) ? primary : []; }
}

// Wrap top-level async work in an IIFE to avoid top-level `await` (not allowed
// in MV3 service worker non-module contexts). This preserves the previous
// behavior but keeps the file syntactically valid.
(async () => {
  try {
    // Many blocks below reference a `task` variable when executing scheduled
    // flows. On service-worker startup there is no `task` in scope; guard all
    // of the initial task-enrichment logic so the background doesn't throw
    // a ReferenceError at load time.
    if (typeof task !== 'undefined' && task) {
      // Start with any explicit title provided by the task (title > listingTitle > inventoryName)
      let searchTitle =
        (task && task.title) ||
        (task && task.listingTitle) ||
        (task && task.inventoryName) || '';

    // Prefer the saved listing's canonical title when possible. If the task carries an
    // inventoryName or listingId we can look up the saved listing and use its richer
    // `title`/`listingTitle`/`fbTitle` if present. Do this even when `searchTitle` is
    // currently set to the inventoryName to avoid searching on the short name.
    try {
      if (task && (task.inventoryName || task.listingId)) {
        const snap = await new Promise(res => { try { chrome.storage.local.get(['listings'], res); } catch (e) { res({}); } });
        const listings = (snap && Array.isArray(snap.listings)) ? snap.listings : [];
        let found = null;
        try {
          if (task.listingId) {
            found = listings.find(l => l && (String(l.listingId) === String(task.listingId) || String(l.id) === String(task.listingId)));
          }
        } catch (e) {}
        try {
          if (!found && task.inventoryName) {
            found = listings.find(l => l && l.inventoryName && String(l.inventoryName) === String(task.inventoryName));
          }
        } catch (e) {}

        if (found) {
          const prefer = (found.title || found.listingTitle || found.fbTitle || '').trim();
          if (prefer) searchTitle = prefer;
        }
      }
    } catch (e) {
      // ignore enrichment failures
    }
    }
    if (chrome && chrome.alarms && typeof chrome.alarms.getAll === 'function') {
      try {
        chrome.alarms.getAll((alarms) => {
          try {
            const keep = new Set([
              'ffm_schedule_ASA_AUTO',
              'ffm_schedule_PUB_AUTO',
              'ffm_schedule_DNR_AUTO'
            ]);

            const legacy = (alarms || []).filter(a => !keep.has(a && a.name));

            if (legacy.length) {
              console.warn('[bg:ALARM] Cleaning stray alarms:', legacy.map(a => a.name));
              legacy.forEach(a => { try { chrome.alarms.clear(a.name); } catch (e) {} });
            } else {
              console.log('[bg:ALARM] No stray alarms found');
            }
          } catch (e) {}
        });
      } catch (e) {}
    }

      const FFM_STORAGE_CLEANUP = {
  ENABLED: true,

  // TTLs (days)
  TTL_PUBLISH_TIMING_DAYS: 14,
  TTL_PUBLISH_TRACE_DAYS: 3,
  TTL_DEBUG_RUN_DAYS: 2,

  LOG_PREFIX: '[AutoList Pro] 🧹 Storage cleanup',
};

// Keys/prefixes that must never be removed by cleanup
const FFM_STORAGE_CLEANUP_PROTECTED_EXACT = [
  'ffmActiveUser', 'ffmUserContext', 'ffmAuthState',
  'ffm_active_user_id', 'ffm_supabase_session',
  'ffmSavedListings', '__ffm_saved_listings_cache', 'listings', 'ffmCanonicalListings'
];
const FFM_STORAGE_CLEANUP_PROTECTED_PREFIXES = [
  'sb-', // Supabase tokens
  'supabase.auth' // supabase.auth.* keys
];

// Age thresholds for safe cleanup
const MAX_PUBLISH_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SCHEDULE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function ffmExtractTimestampFromKey(key) {
  // Matches trailing numbers like: ffm_publish_trace_1765933557364_x
  const match = key && key.match ? key.match(/_(\d{13})/) : null;
  return match ? Number(match[1]) : null;
}

function ffmRunStorageCleanup() {
  try {
    if (!FFM_STORAGE_CLEANUP.ENABLED) return;
    if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== 'function') return;

    chrome.storage.local.get(null, (items) => {
      try {
        const now = Date.now();
        const removeKeys = [];

        for (const [key, value] of Object.entries(items || {})) {

          // Protect sensitive / authoritative keys and known Supabase keys
          try {
            if (typeof key === 'string') {
              if (FFM_STORAGE_CLEANUP_PROTECTED_EXACT.includes(key)) continue;
              if (FFM_STORAGE_CLEANUP_PROTECTED_PREFIXES.some(p => key.startsWith(p))) continue;
            }
          } catch (e) {}

          // --------------------------------------------------
          // Publish / SDnR timing (debug only)
          // --------------------------------------------------
          if (typeof key === 'string' && key.startsWith('ffm_publish_timing_')) {
            const start = value && value.start;
            if (typeof start === 'number') {
              const ageDays = (now - start) / 86400000;
              if (ageDays > FFM_STORAGE_CLEANUP.TTL_PUBLISH_TIMING_DAYS) removeKeys.push(key);
            }
            continue;
          }

          // --------------------------------------------------
          // ffm_publish_* cleanup: delete older than 24h or completed
          // value expected shape: { createdAt: <ms>, status: 'complete' | ... }
          if (typeof key === 'string' && key.startsWith('ffm_publish_')) {
            try {
              const created = (value && (value.createdAt || value.start)) ? Number(value.createdAt || value.start) : null;
              const status = value && value.status ? String(value.status).toLowerCase() : null;
              if (status === 'complete') { removeKeys.push(key); continue; }
              if (created && (now - created) > MAX_PUBLISH_AGE_MS) { removeKeys.push(key); continue; }
            } catch (e) {}
            continue;
          }

          // ffm_schedule_* cleanup: keep active/scheduled jobs; delete completed/canceled or old completed
          // value expected shape: { status: 'pending'|'scheduled'|'queued'|'completed'|'canceled', nextRunAt, lastRun }
          if (typeof key === 'string' && key.startsWith('ffm_schedule_')) {
            try {
              const status = value && value.status ? String(value.status).toLowerCase() : null;
              const nextRun = value && (value.nextRunAt || value.nextRun) ? Number(value.nextRunAt || value.nextRun) : null;
              const lastRun = value && (value.lastRun || value.lastRunAt) ? Number(value.lastRun || value.lastRunAt) : null;

              // Keep if actively scheduled
              if (status === 'pending' || status === 'scheduled' || status === 'queued') { continue; }
              if (nextRun && nextRun > now) { continue; }

              // Delete completed or canceled immediately
              if (status === 'completed' || status === 'canceled') { removeKeys.push(key); continue; }

              // Otherwise, delete if lastRun is older than threshold
              if (lastRun && (now - lastRun) > MAX_SCHEDULE_AGE_MS) { removeKeys.push(key); continue; }
            } catch (e) {}
            continue;
          }

          // Publish trace logs (very noisy)
          // --------------------------------------------------
          if (typeof key === 'string' && key.startsWith('ffm_publish_trace_')) {
            const ts = ffmExtractTimestampFromKey(key);
            if (ts && (now - ts) > FFM_STORAGE_CLEANUP.TTL_PUBLISH_TRACE_DAYS * 86400000) removeKeys.push(key);
            continue;
          }

          // --------------------------------------------------
          // Generic debug / run traces
          // --------------------------------------------------
          if (typeof key === 'string' && (key.startsWith('ffm_task_trace_') || key.startsWith('ffm_run_debug_'))) {
            const ts = ffmExtractTimestampFromKey(key);
            if (ts && (now - ts) > FFM_STORAGE_CLEANUP.TTL_DEBUG_RUN_DAYS * 86400000) removeKeys.push(key);
            continue;
          }
        }

        if (removeKeys.length) {
          try {
            const filtered = removeKeys.filter(k => k !== '__ffm_persist');
            if (filtered.length) {
              chrome.storage.local.remove(filtered, () => {
                try { console.log(`${FFM_STORAGE_CLEANUP.LOG_PREFIX} removed ${filtered.length} keys`); } catch (e) {}
              });
            } else {
              try { console.log(`${FFM_STORAGE_CLEANUP.LOG_PREFIX} nothing to remove after protecting persist key`); } catch (e) {}
            }
          } catch (e) {
            try { console.warn(`${FFM_STORAGE_CLEANUP.LOG_PREFIX} remove failed`, e); } catch (ee) {}
          }
        } else {
          try { console.log(`${FFM_STORAGE_CLEANUP.LOG_PREFIX} nothing to remove`); } catch (e) {}
        }
      } catch (err) {
        try { console.warn(`${FFM_STORAGE_CLEANUP.LOG_PREFIX} failed`, err); } catch (e) {}
      }
    });
  } catch (e) {
    try { console.warn(`${FFM_STORAGE_CLEANUP.LOG_PREFIX} top-level failed`, e); } catch (ee) {}
  }
}



// Run once on startup and on install/update. Not called from alarms or message handlers.
try {
  if (chrome && chrome.runtime && typeof chrome.runtime.onStartup !== 'undefined' && chrome.runtime.onStartup && chrome.runtime.onStartup.addListener) {
    try { chrome.runtime.onStartup.addListener(() => { try { ffmRunStorageCleanup(); } catch (e) {} }); } catch (e) {}
  }
} catch (e) {}
try {
  if (chrome && chrome.runtime && typeof chrome.runtime.onInstalled !== 'undefined' && chrome.runtime.onInstalled && chrome.runtime.onInstalled.addListener) {
    try { chrome.runtime.onInstalled.addListener(() => { try { ffmRunStorageCleanup(); } catch (e) {} }); } catch (e) {}
  }
} catch (e) {}

// Message handler: run user-initiated cleanup for old traces (invoked from popup)
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === 'function') {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.action !== 'ffm_clean_old_traces') return;

        chrome.storage.local.get(null, (items) => {
          try {
            const now = Date.now();
            const toRemove = [];

            for (const [key, value] of Object.entries(items || {})) {
              try {
                if (typeof key !== 'string') continue;

                // Protect exact and prefix keys
                if (FFM_STORAGE_CLEANUP_PROTECTED_EXACT.includes(key)) continue;
                if (FFM_STORAGE_CLEANUP_PROTECTED_PREFIXES.some(p => key.startsWith(p))) continue;

                // ffm_publish_*: delete if status === 'complete' OR older than MAX_PUBLISH_AGE_MS
                if (key.startsWith('ffm_publish_')) {
                  try {
                    const status = value && value.status ? String(value.status).toLowerCase() : null;
                    const created = (value && (value.createdAt || value.start)) ? Number(value.createdAt || value.start) : null;
                    if (status === 'complete') { toRemove.push(key); continue; }
                    if (created && (now - created) > MAX_PUBLISH_AGE_MS) { toRemove.push(key); continue; }
                  } catch (e) {}
                  continue;
                }

                // ffm_publish_trace_*: older than TTL_PUBLISH_TRACE_DAYS
                if (key.startsWith('ffm_publish_trace_')) {
                  const match = key.match(/_(\d{13})/);
                  const ts = match ? Number(match[1]) : null;
                  if (ts && (now - ts) > FFM_STORAGE_CLEANUP.TTL_PUBLISH_TRACE_DAYS * 86400000) toRemove.push(key);
                  continue;
                }

                // ffm_debug_* or ffm_task_trace_*: older than TTL_DEBUG_RUN_DAYS
                if (key.startsWith('ffm_debug_') || key.startsWith('ffm_task_trace_') || key.startsWith('ffm_run_debug_')) {
                  const match = key.match(/_(\d{13})/);
                  const ts = match ? Number(match[1]) : null;
                  if (ts && (now - ts) > FFM_STORAGE_CLEANUP.TTL_DEBUG_RUN_DAYS * 86400000) toRemove.push(key);
                  continue;
                }

                // ffm_schedule_*: delete if completed or canceled
                if (key.startsWith('ffm_schedule_')) {
                  try {
                    const status = value && value.status ? String(value.status).toLowerCase() : null;
                    if (status === 'completed' || status === 'canceled') { toRemove.push(key); continue; }
                  } catch (e) {}
                  continue;
                }
              } catch (e) {}
            }

            if (!toRemove.length) {
              try { sendResponse({ removed: 0, keys: [] }); } catch (e) {}
              return;
            }

            try {
              chrome.storage.local.remove(toRemove, () => {
                try { sendResponse({ removed: toRemove.length, keys: toRemove }); } catch (e) { sendResponse({ removed: 0, keys: [] }); }
              });
            } catch (e) { try { sendResponse({ removed: 0, keys: [] }); } catch (ee) {} }
          } catch (err) { try { sendResponse({ removed: 0, keys: [] }); } catch (e) {} }
        });

        return true; // indicate async response
      } catch (e) {}
    });
  }
} catch (e) {}

// ==========================================================
// Prevent duplicate background initialization (MV3 SW reloads)
// ==========================================================
try {
  if (globalThis && globalThis.__FFM_BG_INIT__) {
    try { console.warn('[AutoList Pro bg] Duplicate background init suppressed.'); } catch (e) {}
    // DO NOT return — continue loading but rely on listener de-duping below
  } else if (globalThis) {
    try { globalThis.__FFM_BG_INIT__ = true; } catch (e) {}
  }
} catch (e) {}

// Canonical listings map used by the Advanced Scheduler (ADS).
// Populated from popup/content/background Active Listings broadcasts so the
// scheduler can lookup listings by `listingId` when running rules.
let ffmCanonicalListings = {};

// Lightweight runtime tracing (low-overhead counters + ring buffer)
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.__ffmTrace = globalThis.__ffmTrace || {
      counters: {
        canonicalUpdates: 0,
        storageSets: 0,
        alarmsCreated: 0,
        adsEnqueued: 0,
        adsProcessed: 0,
        rebuilds: 0,
        adsQueueRuns: 0,
        focusSkips: 0
      },
      events: new Array(128).fill(null),
      evIdx: 0
    };
  }
} catch (e) {}

function ffmTraceEvent(tag, meta) {
  try {
    const t = (globalThis && globalThis.__ffmTrace);
    if (!t) return;
    try { t.counters = t.counters || {}; } catch (e) {}
    try { t.events[t.evIdx] = { time: Date.now(), tag: tag, meta: meta || null }; } catch (e) {}
    try { t.evIdx = (t.evIdx + 1) % t.events.length; } catch (e) {}
  } catch (e) {}
}

// Universal in-memory guard: ensure a DnR task executes only once per invocation
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.__ffmExecutingDnR = globalThis.__ffmExecutingDnR || new Set();
  }
} catch (e) {}

// Scheduler logging helpers — group noisy messages for readability
function ffmSchedLog() {
  try {
    if (console && typeof console.log === 'function') {
      console.log.apply(console, ['[FFM Scheduler]'].concat(Array.from(arguments)));
    }
  } catch (e) {}
}

// (outer IIFE closure intentionally placed at file end)

function ffmSchedWarn() {
  try { if (console && typeof console.warn === 'function') console.warn.apply(console, ['[FFM Scheduler]'].concat(Array.from(arguments))); } catch (e) {}
}

function ffmSchedGroupCollapsed(label, payload) {
  try {
    if (console && typeof console.groupCollapsed === 'function') {
      console.groupCollapsed('[FFM Scheduler] ' + label);
      try { console.log(payload); } catch (e) { console.log('[FFM Scheduler] (payload logging failed)'); }
      try { console.groupEnd(); } catch (e) {}
    } else {
      ffmSchedLog(label, payload);
    }
  } catch (e) {}
}

// Focus-stealing guard: only allow focus changes when a user gesture is active.
function canStealFocus() {
  try {
    return !!(globalThis && globalThis.ffmUserGestureActive);
  } catch (e) { return false; }
}

// Safe wrappers for focus-changing APIs — call callbacks even when skipped.
function safeWindowsUpdate(windowId, props, cb) {
  try {
    if (canStealFocus()) {
      if (typeof cb === 'function') return chrome.windows.update(windowId, props, cb);
      return chrome.windows.update(windowId, props);
    }
    // Debug: record and notify when a focus attempt is skipped so we can trace offending call sites
    try {
      try {
        if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.focusSkips = (globalThis.__ffmTrace.counters.focusSkips||0) + 1;
        try { ffmTraceEvent('focus-skip', { api: 'windows.update', windowId: windowId, props: props }); } catch (e) {}
        try {
          const stack = (new Error()).stack || null;
          try { globalThis.__ffmTrace.lastFocusSkip = { time: Date.now(), api: 'windows.update', windowId: windowId, props: props || null, stack: stack }; } catch (e) {}
          try { if (chrome && chrome.storage && chrome.storage.local) chrome.storage.local.set({ ffm_last_focus_skip: globalThis.__ffmTrace.lastFocusSkip }, () => {}); } catch (e) {}
        } catch (e) {}
      } catch (e) {}
      if (ffmGlobal && ffmGlobal.FFM_DEBUG && ffmGlobal.FFM_DEBUG.BG) {
        try {
          const note = {
            id: ffmNotifyGenerateId(),
            title: 'FFM_DEBUG: skipped focus',
            body: 'safeWindowsUpdate skipped (no user gesture): windowId=' + String(windowId) + ' props=' + (props ? JSON.stringify(props) : '{}') + (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.lastFocusSkip && globalThis.__ffmTrace.lastFocusSkip.stack ? '\nstack:' + String(globalThis.__ffmTrace.lastFocusSkip.stack).split('\n').slice(0,6).join('\n') : ''),
            ts: Date.now(),
            level: 'debug'
          };
          try { ffmNotifyAppend(note); } catch (e) {}
        } catch (e) {}
      }
    } catch (e) {}
    if (typeof cb === 'function') {
      try { cb(); } catch (e) {}
    }
  } catch (e) {}
}

function safeTabsUpdate(tabId, props, cb) {
  try {
    if (canStealFocus()) {
      if (typeof cb === 'function') return chrome.tabs.update(tabId, props, cb);
      return chrome.tabs.update(tabId, props);
    }
    // Debug: record and notify when a focus attempt is skipped so we can trace offending call sites
    try {
      try {
        if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.focusSkips = (globalThis.__ffmTrace.counters.focusSkips||0) + 1;
        try { ffmTraceEvent('focus-skip', { api: 'tabs.update', tabId: tabId, props: props }); } catch (e) {}
        try {
          const stack = (new Error()).stack || null;
          try { globalThis.__ffmTrace.lastFocusSkip = { time: Date.now(), api: 'tabs.update', tabId: tabId, props: props || null, stack: stack }; } catch (e) {}
          try { if (chrome && chrome.storage && chrome.storage.local) chrome.storage.local.set({ ffm_last_focus_skip: globalThis.__ffmTrace.lastFocusSkip }, () => {}); } catch (e) {}
        } catch (e) {}
      } catch (e) {}
      if (ffmGlobal && ffmGlobal.FFM_DEBUG && ffmGlobal.FFM_DEBUG.BG) {
        try {
          const note = {
            id: ffmNotifyGenerateId(),
            title: 'FFM_DEBUG: skipped focus',
            body: 'safeTabsUpdate skipped (no user gesture): tabId=' + String(tabId) + ' props=' + (props ? JSON.stringify(props) : '{}') + (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.lastFocusSkip && globalThis.__ffmTrace.lastFocusSkip.stack ? '\nstack:' + String(globalThis.__ffmTrace.lastFocusSkip.stack).split('\n').slice(0,6).join('\n') : ''),
            ts: Date.now(),
            level: 'debug'
          };
          try { ffmNotifyAppend(note); } catch (e) {}
        } catch (e) {}
      }
    } catch (e) {}
    if (typeof cb === 'function') {
      try { cb(); } catch (e) {}
    }
  } catch (e) {}
}

// (safeSidePanelOpen implemented later in file; prefer that canonical helper)
// ================================
// Scheduled SP / SDnR Guardrails
// ================================
const FFM_SCHEDULED_TASKS_KEY = "scheduled_tasks";
const FFM_MISSED_TASKS_KEY = "ffm_missed_scheduled_tasks";

const FFM_SCHED_ALARM_PREFIX = "ffm_schedule_";
const FFM_MISSED_GRACE_MS = 3 * 60 * 1000; // 3 minutes late = MISSED

function ffmNow() { return Date.now(); }

async function ffmGetScheduledTasks() {
  try {
    const res = await new Promise((resolve) => { try { chrome.storage.local.get({ [FFM_SCHEDULED_TASKS_KEY]: [] }, resolve); } catch (e) { resolve({ [FFM_SCHEDULED_TASKS_KEY]: [] }); } });
    return Array.isArray(res && res[FFM_SCHEDULED_TASKS_KEY]) ? res[FFM_SCHEDULED_TASKS_KEY] : [];
  } catch (e) { return []; }
}

async function ffmSetScheduledTasks(tasks) {
  try {
    await new Promise((resolve) => { try { chrome.storage.local.set({ [FFM_SCHEDULED_TASKS_KEY]: tasks }, resolve); } catch (e) { resolve(); } });
  } catch (e) {}
}

function ffmAlarmNameForTask(taskId) {
  return FFM_SCHED_ALARM_PREFIX + String(taskId);
}

// ===========================
// SDNR / Scheduled Task Locks
// ===========================
globalThis.__ffm_taskLocks = globalThis.__ffm_taskLocks || new Map();

/**
 * Returns true if lock acquired, false if already locked.
 * TTL prevents permanent lock if a run crashes.
 */
function ffmTryLockTask(taskId, ttlMs = 3 * 60 * 1000) {
  try {
    if (!taskId) return true; // if no id, don't block
    const now = Date.now();
    const rec = globalThis.__ffm_taskLocks.get(String(taskId));
    if (rec && (now - rec.ts) < (rec.ttl || ttlMs)) return false;
    globalThis.__ffm_taskLocks.set(String(taskId), { ts: now, ttl: ttlMs });
    return true;
  } catch (e) {
    return true; // fail open
  }
}

function ffmUnlockTask(taskId) {
  try {
    if (!taskId) return;
    globalThis.__ffm_taskLocks.delete(String(taskId));
  } catch (e) {}
}

// Active DnR execution set to prevent duplicate parallel runs
globalThis.__ffm_activeDnRTasks = globalThis.__ffm_activeDnRTasks || new Set();

// ===========================
// Global run locks (anti-dup)
// ===========================
globalThis.__ffm_runLocks = globalThis.__ffm_runLocks || new Map();

/**
 * Acquire a short-lived lock. Returns true if acquired, false if already locked.
 */
function ffmAcquireRunLock(key, ttlMs = 2 * 60 * 1000) {
  try {
    const now = Date.now();
    const rec = globalThis.__ffm_runLocks.get(key);
    if (rec && (now - rec.ts) < rec.ttl) return false;
    globalThis.__ffm_runLocks.set(key, { ts: now, ttl: ttlMs });
    return true;
  } catch (e) {
    return true; // fail-open
  }
}

function ffmReleaseRunLock(key) {
  try { globalThis.__ffm_runLocks.delete(key); } catch (e) {}
}

// Detect missed scheduled tasks and mark them 'missed'. This does NOT run them.
async function ffmDetectMissedScheduledTasks(reason = "startup") {
  try {
    const tasks = await ffmGetScheduledTasks();
    const now = ffmNow();
    const missed = []; // Initialize missed tasks array
    let changed = false;

    for (const task of tasks) {
      try {
        if (!task || task.state !== 'queued') continue;
        if (!task.when) continue;
        if (now > task.when + FFM_MISSED_GRACE_MS) {
          task.state = 'missed';
          task.missedAt = now;
          missed.push({ id: task.id, listingId: task.listingId, action: task.action, when: task.when });
          changed = true;
        }
      } catch (e) { /* non-fatal per-task */ }
    }

    if (!changed) return;

    await ffmSetScheduledTasks(tasks);

    try { await new Promise((resolve) => { chrome.storage.local.set({ [FFM_MISSED_TASKS_KEY]: missed }, resolve); }); } catch (e) {}

    try {
      chrome.action?.setBadgeText({ text: "!" });
      chrome.action?.setBadgeBackgroundColor({ color: "#d93025" });
    } catch (e) {}

    console.warn('[SCHED] Missed scheduled tasks detected', reason, missed);
  } catch (e) {
    console.debug('[SCHED] ffmDetectMissedScheduledTasks error', e);
  }
}

// -----------------------------
// SP / SDnR Alarm Wiring Helpers
// -----------------------------

function ffmCreateScheduledTaskAlarm(task) {
  try {
    if (!task || !task.id) {
      try { console.warn('[SP/SDNR] Invalid task — cannot create alarm', task); } catch (e) {}
      return;
    }

    const alarmName = 'ffm_task_' + String(task.id);
    const when = (typeof task.runAt === 'number') ? Number(task.runAt) : (typeof task.when === 'number' ? Number(task.when) : (task.timeISO ? new Date(String(task.timeISO)).getTime() : NaN));

    if (!Number.isFinite(when)) {
      try { console.error('[SP/SDNR] Invalid runAt timestamp', task.runAt || task.when || task.timeISO); } catch (e) {}
      return;
    }

    try { chrome.alarms.create(alarmName, { when }); } catch (e) { try { console.warn('[SP/SDNR] chrome.alarms.create failed', e); } catch (ee) {} }

    try { console.log('[SP/SDNR] Alarm created', { alarmName, when: new Date(when).toISOString(), taskType: task.type || task.action || null }); } catch (e) {}
  } catch (e) { console.debug('[SP/SDNR] ffmCreateScheduledTaskAlarm failed', e); }
}

function ffmClearScheduledTaskAlarm(taskId) {
  try {
    if (!taskId) return;
    const alarmName = 'ffm_task_' + String(taskId);
    try { chrome.alarms.clear(alarmName); } catch (e) {}
    try { console.log('[SP/SDNR] Alarm cleared', alarmName); } catch (e) {}
  } catch (e) { console.debug('[SP/SDNR] ffmClearScheduledTaskAlarm failed', e); }
}

// Guard-only handler invoked when ffm_task_<id> alarm fires. Does NOT auto-run missed tasks.
async function ffmHandleScheduledTask(taskId) {
  try {
    if (!taskId) return;
    const tasks = await ffmGetScheduledTasks();
    if (!Array.isArray(tasks)) return;
    const ix = tasks.findIndex(t => t && String(t.id) === String(taskId));
    if (ix < 0) {
      try { console.warn('[SP/SDNR] Task missing for alarm', taskId); } catch (e) {}
      return;
    }
    const task = tasks[ix];

    // Determine run timestamp (support runAt, when, timeISO)
    const runTs = (typeof task.runAt === 'number') ? Number(task.runAt) : (typeof task.when === 'number' ? Number(task.when) : (task.timeISO ? new Date(String(task.timeISO)).getTime() : NaN));
    const now = ffmNow();
    const deltaMs = Number.isFinite(runTs) ? (now - runTs) : 0;

    // Missed threshold: 60s per spec
    if (Number.isFinite(runTs) && deltaMs > 60000) {
      try {
        tasks[ix] = Object.assign({}, tasks[ix], { state: 'missed', missedAt: now });
        await ffmSetScheduledTasks(tasks);
        const missedRec = [{ id: task.id, listingId: task.listingId, action: task.action, when: runTs }];
        try { await new Promise((resolve) => chrome.storage.local.set({ [FFM_MISSED_TASKS_KEY]: missedRec }, resolve)); } catch (e) {}
        try { chrome.action?.setBadgeText({ text: '!' }); chrome.action?.setBadgeBackgroundColor({ color: '#d93025' }); } catch (e) {}
        try { console.warn('[SP/SDNR] Task MISSED', { taskId, deltaMs }); } catch (e) {}
        try { chrome.runtime.sendMessage({ action: 'ffm-scheduled-task-missed', taskId, task }); } catch (e) {}
        return;
      } catch (e) { console.debug('[SP/SDNR] mark-missed failed', e); return; }
    }

    // On-time → mark running and call existing executor
    try {
      try { console.log('[SP/SDNR] Task executing', taskId); } catch (e) {}
      // mark running in storage for UI visibility
      try {
        tasks[ix] = Object.assign({}, tasks[ix], { state: 'running', lastRunAt: now });
        await ffmSetScheduledTasks(tasks);
        try { chrome.runtime.sendMessage({ action: 'ffm-scheduled-tasks-updated' }); } catch (e) {}
      } catch (e) {}

      // Use new headless executor — do not duplicate complex logic here
      try {
        if (typeof ffmExecuteScheduledTask === 'function') {
          await ffmExecuteScheduledTask(task);
        } else if (typeof executeScheduledTask === 'function') {
          // Fallback for older environments
          await executeScheduledTask(task);
        } else {
          try { console.warn('[SP/SDNR] No executor available for scheduled task'); } catch (e) {}
        }
      } catch (e) { console.debug('[SP/SDNR] scheduled executor threw', e); }
    } catch (e) { console.debug('[SP/SDNR] ffmHandleScheduledTask error', e); }
  } catch (e) { console.debug('[SP/SDNR] ffmHandleScheduledTask outer error', e); }
}

// -----------------------------
// Headless scheduled task executors
// -----------------------------

async function ffmExecuteScheduledTask(task) {
  try {
    if (!task || !task.action) {
      try { console.warn('[SP/SDNR] Missing task/action', task); } catch (e) {}
      return;
    }

    const action = String(task.action || '').toLowerCase();

    // ---- Scheduled Publish ----
    if (action === 'publish' || action === 'sp' || action === 'scheduled_publish') {
      try { await ffmRunScheduledPublish(task); } catch (e) { console.warn('[SP] ffmRunScheduledPublish threw', e); }
      return { ok: true };
    }

    // ---- Scheduled Delete & Relist ----
    // Normalize all the common aliases to ONE path.
    if (
      action === 'relist' ||
      action === 'dnr' ||
      action === 'sdnr' ||
      action === 'delete_relist' ||
      action === 'delete-and-relist' ||
      action === 'delete_and_relist'
    ) {
      try { await ffmRunScheduledDnR(task); } catch (e) { console.warn('[SDNR] ffmRunScheduledDnR threw', e); }
      return { ok: true };
    }

    try { console.warn('[SP/SDNR] Unknown task action', task.action); } catch (e) {}
  } catch (e) {
    try { console.debug('[SP/SDNR] ffmExecuteScheduledTask error', e); } catch (_) {}
  }
}

async function ffmRunScheduledPublish(task) {
  try {
    if (!task || !task.listingId) {
      try { console.error('[SP] Missing listingId in scheduled task', task); } catch (e) {}
      try { notifyTaskMissed(task, 'Missing listing context'); } catch (e) {}
      return;
    }

    // Execute scheduled publish via the same manual pipeline: send the canonical
    // `publish-listing` message so content's `ffmHandlePublishRequest` handles it.
    try {
      try { console.log('[SP] Executing scheduled publish via manual pipeline', { taskId: task.id, listingId: task.listingId }); } catch (e) {}
      try {
        const listingId = task.listingId;
        const taskId = task.id;
        try { console.log('[SP] Invoking publish-listing handler directly', { listingId, taskId }); } catch (e) {}

        await handlePublishListing({ action: 'publish-listing', listingId, source: 'scheduled', taskId, autoPublish: false }, { id: 'scheduler' });

      } catch (err) {
        console.error('[SP] Scheduled publish failed', err);
      }
    } catch (e) { console.debug('[SP] ffmRunScheduledPublish outer sendMessage failed', e); }
  } catch (e) { console.debug('[SP] ffmRunScheduledPublish outer error', e); }
}

async function ffmRunScheduledDnR(task) {
  // Minimal DnR execution lock to prevent duplicate parallel runs
  // Exec-key: universal choke point to ensure a DnR invocation runs only once
  const execKey = (task && (task.id || task.taskId || task.ruleId || task.listingId)) ? String(task.id || task.taskId || task.ruleId || task.listingId) : JSON.stringify(task || {});
  try {
    if (globalThis.__ffmExecutingDnR && globalThis.__ffmExecutingDnR.has(execKey)) {
      try { console.warn('[DnR] Duplicate execution blocked (execKey)', execKey); } catch (e) {}
      return;
    }
    try { globalThis.__ffmExecutingDnR && globalThis.__ffmExecutingDnR.add(execKey); } catch (e) {}
  } catch (e) {}

  const dnrKey = (task && (task.id || task.taskId)) ? String(task.id || task.taskId) : JSON.stringify(task || {});
  try {
    if (globalThis.__ffm_activeDnRTasks && globalThis.__ffm_activeDnRTasks.has(dnrKey)) {
      try { console.warn('[DnR] Duplicate execution blocked', dnrKey); } catch (e) {}
      try { globalThis.__ffmExecutingDnR && globalThis.__ffmExecutingDnR.delete(execKey); } catch (e) {}
      return;
    }
    try { globalThis.__ffm_activeDnRTasks && globalThis.__ffm_activeDnRTasks.add(dnrKey); } catch (e) {}
  } catch (e) {}

  // Acquire task lock to prevent duplicate runs
  const taskId = task && task.id ? String(task.id) : null;
  if (!ffmTryLockTask(taskId)) {
    try { console.warn('[SDNR] Duplicate run blocked by task lock', { taskId }); } catch (e) {}
    try { globalThis.__ffm_activeDnRTasks && globalThis.__ffm_activeDnRTasks.delete(dnrKey); } catch (e) {}
    try { globalThis.__ffmExecutingDnR && globalThis.__ffmExecutingDnR.delete(execKey); } catch (e) {}
    return;
  }

  try {
    const listingId =
      (task && (task.listingId || (task.payload && task.payload.listingId))) ?
        (task.listingId || (task.payload && task.payload.listingId)) :
        null;

    // Prefer explicit task title; fallback to canonical listings map if available
    let listingTitle = (task && (task.listingTitle || task.title)) ? String(task.listingTitle || task.title) : '';
    let inventoryName = (task && task.inventoryName) ? String(task.inventoryName) : '';

    try {
      if ((!listingTitle || !inventoryName) && typeof ffmCanonicalListings !== 'undefined' && ffmCanonicalListings && listingId) {
        const l = ffmCanonicalListings[listingId];
        if (l) {
          if (!listingTitle && (l.listingTitle || l.title)) listingTitle = String(l.listingTitle || l.title);
          if (!inventoryName && l.inventoryName) inventoryName = String(l.inventoryName);
        }
      }
    } catch (e) {}

    const deleteTitle = (listingTitle || inventoryName || '').trim();
    if (!deleteTitle) {
      try { console.warn('[SDNR] Missing deleteTitle; cannot run scheduled DnR', { listingId, taskId }); } catch (e) {}
      try { notifyTaskMissed(task, 'Missing title context for SDnR'); } catch (e) {}
      return;
    }

    const encoded = encodeURIComponent(deleteTitle);
    const url = `https://www.facebook.com/marketplace/you/selling?title_search=${encoded}`;

    try { console.log('[SDNR] Opening selling tab with title_search', url); } catch (e) {}

    // -----------------------------
    // SDNR phase-aware duplicate guard
    // -----------------------------
    // Allowed phases: "delete", "publish"
    let phase = 'delete';
    try { if (task && task.phase) phase = String(task.phase); } catch (e) { phase = 'delete'; }

    let guardTaskId = null;
    try {
      guardTaskId = (task && (task.id || task.taskId)) ? String(task.id || task.taskId) : (listingId ? String(listingId) : JSON.stringify(task || {}));
    } catch (e) { guardTaskId = JSON.stringify(task || {}); }

    const guardKey = `${guardTaskId}:${phase}`;

    try {
      if (!globalThis.__ffmActiveSDNRPhases) globalThis.__ffmActiveSDNRPhases = new Set();
      if (globalThis.__ffmActiveSDNRPhases.has(guardKey)) {
        try { console.warn('[SDNR] Duplicate phase blocked', { taskId: guardTaskId, phase }); } catch (e) {}
        return;
      }
      try { globalThis.__ffmActiveSDNRPhases.add(guardKey); } catch (e) {}
      try { console.log('[SDNR] Phase entered', { taskId: guardTaskId, phase }); } catch (e) {}
    } catch (e) {}

    // IMPORTANT: use chrome.tabs.create (safeTabsCreate has logged "called for undefined" in your runs)
    chrome.tabs.create({ url, active: true }, async (tab) => {
      try {
        const tabId = tab && tab.id;
        if (!tabId) {
          try { console.warn('[SDNR] tabs.create returned no tabId; cannot start SDNR', { listingId, taskId }); } catch (e) {}
          return;
        }

        // Persist intent (debug + recovery)
        try {
          chrome.storage.local.set({
            ffm_sdnr_intent: { listingId, taskId, title: deleteTitle, source: 'scheduled', armedAt: Date.now() }
          }, () => {});
        } catch (e) {}

        // Wait for load complete, then wait for content script readiness, then dispatch CANONICAL message.
        const onUpdated = async (updatedTabId, info) => {
          try {
            if (updatedTabId !== tabId) return;
            if (!info || info.status !== 'complete') return;
            try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (e) {}

            // Ensure content scripts are responsive (ping loop)
            const ready = await ffmPingTabUntilReady(tabId, 12000);
            if (!ready) {
              try { console.warn('[SDNR] content did not become ready in time', { tabId, listingId, taskId }); } catch (e) {}
              return;
            }

            // CANONICAL DnR dispatch: content_selling.js listens for msg.type === 'ffm_run_delete_relist'
            try {
              await sendDeleteMessage(tabId, deleteTitle, {
                scheduled: true,
                taskId,
                inventoryName,
                listingId,
                helperTabId: tabId
              });
              try { console.log('[SDNR] Dispatched ffm_run_delete_relist to selling tab', { tabId, listingId, taskId }); } catch (e) {}
            } catch (err) {
              try { console.warn('[SDNR] sendDeleteMessage failed', err); } catch (e) {}
            }
          } catch (e) {}
        };

        try { chrome.tabs.onUpdated.addListener(onUpdated); } catch (e) {}

      } catch (e) {
        try { console.warn('[SDNR] scheduled DnR open handler failed', e); } catch (ee) {}
      }
    });

    } catch (e) {
    try { console.debug('[SDNR] ffmRunScheduledDnR failed', e); } catch (_) {}
  } finally {
    try { ffmUnlockTask(taskId); } catch (e) {}
    try { globalThis.__ffm_activeDnRTasks && globalThis.__ffm_activeDnRTasks.delete(dnrKey); } catch (e) {}
    try { globalThis.__ffmExecutingDnR && globalThis.__ffmExecutingDnR.delete(execKey); } catch (e) {}
  }
}

// ----------------------------
// helper: ping until content responds
// ----------------------------
async function ffmPingTabUntilReady(tabId, timeoutMs = 10000) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    const ok = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'ffm_ping' }, (res) => {
          try {
            if (chrome.runtime && chrome.runtime.lastError) return resolve(false);
            // content_main responds "pong" in some places; content_selling responds {type:'ffm_pong'}
            if (res === 'pong') return resolve(true);
            if (res && (res.type === 'ffm_pong')) return resolve(true);
            return resolve(true); // any response = injected
          } catch (e) { resolve(false); }
        });
      } catch (e) { resolve(false); }
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 350));
  }
  return false;
}

// Minimal helpers to open tabs for headless flows
async function ffmOpenMarketplaceCreateTab(task) {
  try {
    // Prefer an existing fresh Selling tab or open the create page
    try {
      const tab = await ffmGetFreshSellingTab();
      if (tab && tab.id) return tab;
    } catch (e) {}
    // Fallback to create URL
    return await safeTabsCreate({ url: 'https://www.facebook.com/marketplace/create', active: true });
  } catch (e) { console.debug('[SP] ffmOpenMarketplaceCreateTab failed', e); return null; }
}

async function ffmOpenListingTab(task) {
  try {
    // If task.listingId or task.payload.url present, try to open that exact listing
    const urlCandidates = [];
    try {
      if (task && task.listingId) urlCandidates.push('https://www.facebook.com/marketplace/item/' + String(task.listingId));
      if (task && task.payload && task.payload.url) urlCandidates.push(String(task.payload.url));
    } catch (e) {}

    for (const u of urlCandidates) {
      try {
        const tab = await safeTabsCreate({ url: u, active: true });
        if (tab && tab.id) return tab;
      } catch (e) {}
    }

    // Fallback: open selling page
    return await safeTabsCreate({ url: 'https://www.facebook.com/marketplace/you/selling', active: true });
  } catch (e) { console.debug('[SDNR] ffmOpenListingTab failed', e); return null; }
}

function notifyTaskMissed(task, reason) {
  try {
    try { console.warn('[SCHED] notifyTaskMissed', reason, task && task.id); } catch (e) {}
    try { chrome.runtime.sendMessage({ action: 'ffm-scheduled-task-missed', taskId: task && task.id, reason, task }); } catch (e) {}
    // also persist a short missed record
    try { const rec = [{ id: task && task.id, listingId: task && task.listingId, action: task && task.action, when: task && (task.runAt || task.when || task.timeISO) }]; chrome.storage.local.set({ [FFM_MISSED_TASKS_KEY]: rec }); } catch (e) {}
  } catch (e) { console.debug('[SCHED] notifyTaskMissed failed', e); }
}

// Watch scheduled_tasks changes and create/clear ffm_task_<id> alarms accordingly
try {
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      try {
        if (area !== 'local') return;
        if (!changes || !changes.scheduled_tasks) return;
        const oldVal = Array.isArray(changes.scheduled_tasks.oldValue) ? changes.scheduled_tasks.oldValue : [];
        const newVal = Array.isArray(changes.scheduled_tasks.newValue) ? changes.scheduled_tasks.newValue : [];

        const oldIds = new Set((oldVal || []).map(t => t && t.id).filter(Boolean).map(String));
        const newIds = new Set((newVal || []).map(t => t && t.id).filter(Boolean).map(String));

        // Create alarms for newly added or updated queued tasks
        (newVal || []).forEach(t => {
          try {
            const id = t && t.id ? String(t.id) : null;
            if (!id) return;
            // Only create alarms for queued tasks
            if (t.state && t.state !== 'queued') {
              // clear any existing alarm for non-queued tasks
              ffmClearScheduledTaskAlarm(id);
              return;
            }
            // If not present before, or run time changed, create alarm
            if (!oldIds.has(id) || String((oldVal || []).find(o => o && String(o.id) === id)?.when || '') !== String(t.when || '')) {
              ffmCreateScheduledTaskAlarm(t);
            }
          } catch (e) {}
        });

        // Clear alarms for removed tasks
        (oldVal || []).forEach(t => {
          try {
            const id = t && t.id ? String(t.id) : null;
            if (!id) return;
            if (!newIds.has(id)) {
              ffmClearScheduledTaskAlarm(id);
            }
          } catch (e) {}
        });
      } catch (e) {}
    });
  }
} catch (e) {}

// Route ffm_task_<id> alarms to our guard handler
try {
  if (chrome && chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      try {
        if (!alarm || !alarm.name) return;
        if (!alarm.name.startsWith('ffm_task_')) return;
        const taskId = alarm.name.replace('ffm_task_', '');
        try { console.log('[SP/SDNR] Alarm fired', alarm.name); } catch (e) {}
        try { ffmHandleScheduledTask(taskId); } catch (e) { console.debug('[SP/SDNR] ffmHandleScheduledTask schedule call failed', e); }
      } catch (e) {}
    });
  }
} catch (e) {}

// === ADS Execution Queue (silent, internal-only) ===
try {
  if (typeof globalThis !== 'undefined') {
    globalThis.ffmAdsQueue = globalThis.ffmAdsQueue || [];
    globalThis.ffmAdsQueueRunning = !!globalThis.ffmAdsQueueRunning;
  }
} catch (e) {}

// --- ADS Rebuild Suppression ---
let ffm_ads_rebuild_has_run_this_startup = false;

// Listener: allow popup to request Active Sync protected-tab closure on demand
try {
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.type !== 'ffm_close_active_sync_tab') return;

        // Close any tracked helper tab (prefer explicit sender.tab, then pending id)
        try {
          const tabIdToClose = (sender && sender.tab && sender.tab.id) ? sender.tab.id : ffmPendingAasTabId;
          if (tabIdToClose) {
            try { safeTabsRemove(tabIdToClose).then((ok) => { if (ok) console.log('[AutoList Pro AS] Closed AS tab on popup request:', tabIdToClose); }); } catch (e) { console.warn('[AutoList Pro AS] Error removing AS tab (safe remove failed):', e); }
            try { cleanupASState('popup_close'); } catch (e) {}
          } else {
            console.warn('[AutoList Pro AS] No AS tab tracked when popup requested close.');
          }
        } catch (e) {
          console.warn('[AutoList Pro AS] Error handling popup close request', e);
        }

        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      } catch (e) {
        console.warn('[AutoList Pro AS] Error in ffm_close_active_sync_tab handler:', e);
      }

      // === Forward attach to create frame ===
      if (msg && msg.action === 'ffm_forward_attach_to_create_frame') {
        (async () => {
          try {
            const tabId = (sender && sender.tab && typeof sender.tab.id === 'number') ? sender.tab.id : msg.tabId;
            if (typeof tabId !== 'number') {
              try { sendResponse && sendResponse({ ok: false, error: 'missing-tabId' }); } catch (e) {}
              return;
            }

            // Ensure we have candidate create frames injected (best-effort)
            try { await ffmEnsureCreateFrameInjected(tabId); } catch (e) {}

            // Scan for create frames and build frameId list
            const scanMatches = await ffmScanForCreateFrame(tabId);
            const frames = (scanMatches || []).map(r => r.frameId).filter(f => typeof f === 'number');
            if (!frames || !frames.length) {
              try { sendResponse && sendResponse({ ok: false, error: 'no-create-frames' }); } catch (e) {}
              return;
            }

            // Execute in target frames: set window.ffmIncomingFiles and dispatch event
            try {
              await chrome.scripting.executeScript({
                target: { tabId, frameIds: frames },
                func: (files) => {
                  try {
                    const conv = [];
                    for (const f of files || []) {
                      if (!f || !f.dataUrl) continue;
                      const parts = f.dataUrl.split(',');
                      const b64 = parts[1] || '';
                      const byteString = atob(b64);
                      const ab = new ArrayBuffer(byteString.length);
                      const ia = new Uint8Array(ab);
                      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                      const mime = f.type || (parts[0] && parts[0].split(':')[1] && parts[0].split(';')[0]) || 'application/octet-stream';
                      const blob = new Blob([ab], { type: mime });
                      try { conv.push(new File([blob], f.name || ('file_' + Date.now()), { type: mime })); } catch (e) { blob.name = f.name || ('file_' + Date.now()); conv.push(blob); }
                    }
                    window.ffmIncomingFiles = conv;
                    window.dispatchEvent(new CustomEvent('ffmAttachNow'));
                  } catch (e) {}
                },
                args: [msg.files || []]
              });
              sendResponse && sendResponse({ ok: true, frames });
            } catch (e) {
              sendResponse && sendResponse({ ok: false, error: String(e) });
            }
          } catch (err) {
            sendResponse && sendResponse({ ok: false, error: String(err) });
          }

        })();

        return true;
      }
    });
  }
} catch (e) {}

// === Force logout handler: close all UI popups when user logs out ===
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      try {
        if (!request || request.action !== 'ffmForceLogout') return;

        // Close ALL extension popups
        try {
          const views = chrome && chrome.extension && chrome.extension.getViews ? chrome.extension.getViews({ type: 'popup' }) : [];
          (views || []).forEach(view => { try { view.close(); } catch (e) {} });
        } catch (e) {}

        // Optional: close side panels too (best-effort).
        // Avoid passing WINDOW_ID_CURRENT (-2) from a service worker context
        // which can cause "No window with id: -2". Call without args and
        // gracefully handle promise rejections if the API returns a promise.
        try {
          if (chrome && chrome.sidePanel && typeof chrome.sidePanel.close === 'function') {
            try {
              const maybe = chrome.sidePanel.close();
              try { if (maybe && typeof maybe.then === 'function') maybe.catch(() => {}); } catch (e) {}
            } catch (e) {}
          }
        } catch (e) {}

        try { console.log('[AutoList Pro] Forced logout completed.'); } catch (e) {}
      } catch (e) {}
    });
  }
} catch (e) {}

// (Removed: content-initiated SDnR helper tab close listener)
// Handling is now routed through the main async onMessage router below.

// === AutoList Pro DEBUG MODE ===
try { globalThis.FFM_DEBUG = true; } catch (e) { globalThis.FFM_DEBUG = false; }
try { globalThis.FFM_DEBUG_MODE = true; } catch (e) { /* ignore */ }

function ffmDebugBG(msg, data) {
  if (!globalThis.FFM_DEBUG) return;
  if (data !== undefined) console.log(msg, data);
  else console.log(msg);
}

// Log current debug state on background load
try { console.log(`[AutoList Pro bg] DEBUG mode: ${globalThis.FFM_DEBUG}`); } catch (e) {}
// Safe tab remover: checks existence before removing to avoid unchecked runtime.lastError
function safeTabsRemove(tabId) {
  return new Promise((resolve) => {
    try {
      if (typeof tabId === 'undefined' || tabId === null) return resolve(false);
      try {
        chrome.tabs.get(Number(tabId), (t) => {
          try {
            if (chrome.runtime && chrome.runtime.lastError) {
              // Tab not found
              return resolve(false);
            }
            try {
              // Before removing, check session flag to avoid closing an AS helper mid-run.
              const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
              try {
                storage && storage.get && storage.get('ffm_as_in_progress', (res) => {
                  try {
                    const inProgress = res && res.ffm_as_in_progress;
                    if (inProgress && t && t.url && String(t.url).includes('ffm_as=1')) {
                      try { console.warn('[bg] AS in progress — not closing hidden AS tab', tabId); } catch (e) {}
                      return resolve(false);
                    }

                    // If not protected by session flag, proceed with existing AS helper detection/delayed removal.
                    let isASHelper = false;
                    try {
                      const idnum = Number(tabId);
                      // protected-tab marker removed — do not use FFM_AS_PROTECTED_TAB
                      if (!isASHelper && typeof __ffmASTabId !== 'undefined' && Number(__ffmASTabId) === idnum) isASHelper = true;
                      if (!isASHelper && typeof ffmPendingAasTabId !== 'undefined' && Number(ffmPendingAasTabId) === idnum) isASHelper = true;
                      if (!isASHelper && typeof ffmAsWindowId !== 'undefined' && Number(ffmAsWindowId) === idnum) isASHelper = true;
                      if (!isASHelper && typeof ffmActiveTabId !== 'undefined' && Number(ffmActiveTabId) === idnum) isASHelper = true;
                    } catch (e) {}

                    const doRemove = () => {
                      try {
                        chrome.tabs.remove(Number(tabId), () => {
                          try {
                            if (chrome.runtime && chrome.runtime.lastError) {
                              return resolve(false);
                            }
                            return resolve(true);
                          } catch (e) { return resolve(true); }
                        });
                      } catch (e) { return resolve(false); }
                    };

                    if (isASHelper) {
                      try {
                        // Delay to allow log collection (5s)
                        setTimeout(() => { try { doRemove(); } catch (e) {} }, 5000);
                      } catch (e) { doRemove(); }
                    } else {
                      doRemove();
                    }
                  } catch (e) { return resolve(false); }
                });
              } catch (e) {
                // If storage check fails, fall back to immediate removal behavior
                try { chrome.tabs.remove(Number(tabId), () => { try { if (chrome.runtime && chrome.runtime.lastError) return resolve(false); return resolve(true); } catch (e) { return resolve(true); } }); } catch (er) { return resolve(false); }
              }
            } catch (e) { return resolve(false); }
          } catch (e) { return resolve(false); }
        });
      } catch (e) { return resolve(false); }
    } catch (e) { return resolve(false); }
  });
}

// ==========================================================
// 🔇 AutoList Pro Silent Async Listener Guard (background.js)
// Completely hides Chrome's "message port closed" / async listener warnings in the SW.
// ==========================================================
(function ffmSilentAsyncGuardBG() {
  try {
    // In MV3 service workers, `self` is the global
    const root = (typeof self !== 'undefined') ? self : (typeof window !== 'undefined' ? window : globalThis);

    root.addEventListener('unhandledrejection', (event) => {
      try {
        const err = event.reason;
        const msg = err && err.message ? err.message : String(err || '');

        const isChannelClosed =
          msg.includes('A listener indicated an asynchronous response by returning true') ||
          msg.includes('The message port closed before a response was received') ||
          msg.includes('Could not establish connection. Receiving end does not exist');

        if (isChannelClosed) {
          // Stop Chrome from surfacing ANY error or warning for these.
          event.preventDefault();
          return;
        }
      } catch (e) {
        // If our guard fails, we don't want to break other errors.
      }
      // Let all other real errors surface normally.
    });
  } catch (e) {
    // Never break background initialization over this.
  }
})();


// ==========================================================
// 🔇 Filter background console.error noise for known benign messages
// ==========================================================
(function ffmFilterBgConsoleError() {
  try {
    if (!console || !console.error) return;
    const origError = console.error.bind(console);

    console.error = function (...args) {
      try {
        const text = args && args.length ? String(args[0] || '') : '';

        if (
          text.includes('A listener indicated an asynchronous response by returning true') ||
          text.includes('The message port closed before a response was received') ||
          text.includes('Could not establish connection. Receiving end does not exist') ||
          text.includes('Unchecked runtime.lastError') ||
          text.includes('The message port closed before a response') ||
          text.includes('Could not establish connection. Receiving end does not exist')
        ) {
          // Totally ignore these — they're just extension noise.
          return;
        }
      } catch (e) {
        // If our filter has issues, fall through to original error
      }

      try { origError(...args); } catch (e) {}
    };
  } catch (e) {
    // If patching fails, don't break anything.
  }
})();


// ==========================================================
// 🛡 Safe onMessage wrapper (background.js)
// Ensures handlers that return `true` eventually respond, preventing channel-closed warnings.
// ==========================================================
(function ffmPatchBgOnMessage() {
  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage || typeof chrome.runtime.onMessage.addListener !== 'function') {
      return;
    }

    const origAdd = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);

    chrome.runtime.onMessage.addListener = function (handler) {
      return origAdd(function (message, sender, sendResponse) {
        let responded = false;
        const safeSend = (...args) => {
          if (responded) return;
          responded = true;
          try { sendResponse && sendResponse(...args); } catch (e) {}
        };

        let rv;
        try {
          rv = handler(message, sender, safeSend);
        } catch (err) {
          try { safeSend({ ok: false, error: String(err) }); } catch (_) {}
          return false;
        }

        // If the handler signaled async with `true`, put a timeout safety net on it.
        if (rv === true) {
          setTimeout(() => {
            try {
              if (!responded) {
                safeSend({ ok: false, error: 'no-response-timeout' });
              }
            } catch (e) {}
          }, 12000);
          return true;
        }

        // For non-async handlers, never return true -> no async-port warning possible.
        return false;
      });
    };
  } catch (e) {
    // Non-fatal: background still works even if this wrapper fails.
  }
})();

// Media DB implementation is provided by shared `mediaDB.js` loaded via importScripts at the top.
// Use the global `ffmMediaDB` API from that file (single source-of-truth).

// ------------------------------------------------------------------
// GLOBAL GUARD: prevent duplicate background initialization (service worker)
// ------------------------------------------------------------------
try {
  if (globalThis && globalThis.FFM_BG_INITIALIZED) {
    try { console.warn('[AutoList Pro bg] Duplicate background initialization prevented.'); } catch (e) {}
  } else if (globalThis) {
    try { globalThis.FFM_BG_INITIALIZED = true; } catch (e) {}
  }
} catch (e) {}

// Helper to change debug at runtime from service worker DevTools
try {
  globalThis.ffmSetDebug = function(state) {
    try { globalThis.FFM_DEBUG = !!state; } catch (e) {}
    try { console.log(`[AutoList Pro bg] DEBUG mode updated → ${state}`); } catch (e) {}
  };
} catch (e) {}

console.log('AutoList Pro background loaded (service worker)');
// GLOBAL DEBUG SYSTEM (PHASE 3)
// Use a safe global reference (service worker has no `window`)
const ffmGlobal = (typeof globalThis !== 'undefined') ? globalThis : (typeof self !== 'undefined') ? self : (typeof window !== 'undefined' ? window : {});
ffmGlobal.FFM_DEBUG = ffmGlobal.FFM_DEBUG || {
  ENABLED: false,
  MATCH: false,
  POPUP: true,
  BG: true,
  ERROR: true
};

// Show a one-time Update notice when the extension version changes
// (disabled per owner request — no more "What's New" popup on startup)
try {
  if (false) {
  try {
    const manifest = (chrome && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest() : null;
    const curVer = (manifest && manifest.version) ? String(manifest.version) : null;
    if (curVer) {
      try {
        chrome.storage.local.get(['ffm_last_seen_version'], (res) => {
              try {
                const last = res && res.ffm_last_seen_version ? res.ffm_last_seen_version : null;
                if (last !== curVer) {
                  (async () => {
                    try {
                      const url = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('update.txt') : 'update.txt';
                      let message = 'Update ' + curVer;
                      try {
                        const resp = await fetch(url);
                        if (resp && resp.ok) {
                          const txt = await resp.text();
                          if (txt && String(txt).trim()) message = String(txt).trim();
                        }
                      } catch (e) {
                        // ignore fetch errors and fall back to default message
                      }
                      try { chrome.storage.local.set({ ffm_pending_update: { version: curVer, message }, ffm_last_seen_version: curVer }, () => {}); } catch (e) {}
                    } catch (e) {}
                  })();
                }
              } catch (e) {}
            });
      } catch (e) {}
    }
  } catch (e) {}
  }
} catch (e) {}

// Intercept reads/writes to `ffmUserGestureActive` to trace unexpected lifecycle changes.
try {
  if (typeof globalThis !== 'undefined') {
    (function(){
      let _ffmUserGestureActive = !!globalThis.ffmUserGestureActive;
      try {
        Object.defineProperty(globalThis, 'ffmUserGestureActive', {
          configurable: true,
          enumerable: true,
          get: function() { try { return _ffmUserGestureActive; } catch (e) { return !!_ffmUserGestureActive; } },
          set: function(val) {
            try {
              const prev = !!_ffmUserGestureActive;
              _ffmUserGestureActive = !!val;
              try { ffmTraceEvent('ffmUserGestureActive', { from: prev, to: _ffmUserGestureActive }); } catch (e) {}
              try {
                if (ffmGlobal && ffmGlobal.FFM_DEBUG && ffmGlobal.FFM_DEBUG.BG) {
                  const note = { id: ffmNotifyGenerateId(), title: 'FFM_DEBUG: userGesture change', body: 'ffmUserGestureActive: ' + String(prev) + ' -> ' + String(_ffmUserGestureActive), ts: Date.now(), level: 'debug' };
                  try { ffmNotifyAppend(note); } catch (e) {}
                }
              } catch (e) {}
            } catch (e) {}
          }
        });
      } catch (e) {}
    })();
  }
} catch (e) {}

// Background ready marker (canonical MV3 pattern)
let ffmBgReady = false;
function ffmMarkBgReady() {
  try { ffmBgReady = true; } catch (e) {}
  try { console.log('[AutoList Pro bg] Ready for messages'); } catch (e) {}
}

// -----------------------------
// Phase 2: Background Auth Service
// - Loads local UMD `lib/supabase.js` via importScripts
// - Exposes message handlers: ffm-auth:get-state, ffm-auth:login, ffm-auth:logout, ffm-auth:set-session
// - Persists session to `chrome.storage.local.ffm_supabase_session`
// -----------------------------
try {
  // Try loading the bundled UMD supabase into the SW scope (best-effort)
  try {
    importScripts('lib/supabase.js');
    console.log('[AutoList Pro bg] lib/supabase.js loaded');
  } catch (e) {
    console.warn('[AutoList Pro bg] lib/supabase.js not available in background:', e);
  }

  // Internal client holder
  let ffmSupabaseClient = null;

  async function ensureSupabaseClient() {
    // Cloud auth removed — AutoList Pro is local-only now. All ffm-auth:*
    // handlers below already treat a null client as "not signed in" / no-op,
    // which is exactly the desired behavior with no backend.
    return null;
    // eslint-disable-next-line no-unreachable
    if (ffmSupabaseClient) return ffmSupabaseClient;

    // Debug snapshot before attempting client creation
    try {
      console.log('[AutoList Pro auth-bg] FFM_CONFIG snapshot', {
        hasConfig: !!FFM_CONFIG,
        url: FFM_CONFIG?.supabaseUrl,
        anonKeyPresent: !!FFM_CONFIG?.supabaseAnonKey,
        anonKeyLength: FFM_CONFIG?.supabaseAnonKey?.length,
        hasSupabaseUMD: !!globalThis.supabase,
        hasCreateClient: !!globalThis.supabase?.createClient
      });
    } catch (e) {}

    try {
      // Prefer global config (set by config.js) but fall back to storage for flexibility
      const cfgGlobal = FFM_CONFIG || {};
      const storageCfg = await new Promise((res) => { try { chrome.storage.local.get(['ffm_supabase_url','ffm_supabase_key','ffm_supabase_session'], res); } catch (e) { res({}); } });

      const url = cfgGlobal.supabaseUrl || (storageCfg && storageCfg.ffm_supabase_url);
      const key = cfgGlobal.supabaseAnonKey || (storageCfg && storageCfg.ffm_supabase_key);

      if (!url || !key) {
        console.warn('[AutoList Pro auth-bg] Supabase config missing', { urlPresent: !!url, anonKeyPresent: !!key });
        throw new Error('Supabase not configured');
      }

      if (!globalThis.supabase || typeof globalThis.supabase.createClient !== 'function') {
        console.warn('[AutoList Pro auth-bg] Supabase UMD not available');
        throw new Error('Supabase UMD not available');
      }

      try {
        ffmSupabaseClient = globalThis.supabase.createClient(url, key, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false
          }
        });

        // If a session exists in storage, attempt to set it on the client (best-effort)
        try {
          const raw = storageCfg && storageCfg.ffm_supabase_session;
          if (raw && raw.access_token && ffmSupabaseClient.auth && typeof ffmSupabaseClient.auth.setSession === 'function') {
            try { ffmSupabaseClient.auth.setSession(raw); } catch (e) {}
          }
        } catch (e) {}

        console.log('[AutoList Pro auth-bg] Supabase client ready');
        return ffmSupabaseClient;
      } catch (e) {
        console.error('[AutoList Pro auth-bg] createClient failed', e);
        throw e;
      }
    } catch (e) {
      throw e;
    }
  }

  // ----------------------------
  // Trial helpers (Supabase + storage)
  // ----------------------------
  let __ffmTrialInitAttempted = false;

  async function ffmGetUserTrialFromDB(userId) {
    try {
      if (!userId) return null;
      const client = await ensureSupabaseClient();
      if (!client) return null;
      try {
        // Use canonical user_profiles table and query by user_id
        const { data, error } = await client.from('user_profiles').select('user_id,email,trial_started_at,trial_expires_at,is_paid,status').eq('user_id', userId).single();
        if (error) {
          // No row is expected on first login; return null to trigger creation
          try { console.debug('[Trial] DB select returned no profile or error', error && error.message ? error.message : error); } catch (e) {}
          return null;
        }
        return data || null;
      } catch (e) { console.warn('[Trial] select failed', e); return null; }
    } catch (e) { return null; }
  }

  async function ffmUpdateUserTrialInDB(userId, trial) {
    try {
      if (!userId || !trial) return false;
      const client = await ensureSupabaseClient();
      if (!client) return false;
      const payload = {
        trial_started_at: (trial.trial_started_at || trial.trialStartedAt) ? new Date(trial.trial_started_at || trial.trialStartedAt).toISOString() : null,
        trial_expires_at: (trial.trial_expires_at || trial.trialExpiresAt) ? new Date(trial.trial_expires_at || trial.trialExpiresAt).toISOString() : null,
        is_paid: typeof trial.is_paid === 'boolean' ? trial.is_paid : (typeof trial.isPaid === 'boolean' ? trial.isPaid : false)
      };
      try {
        const { data, error } = await client.from('user_profiles').update(payload).eq('user_id', userId).select().maybeSingle();
        if (error) {
          console.warn('[Trial] DB update error', error);
          return false;
        }
        return true;
      } catch (e) { console.warn('[Trial] update failed', e); return false; }
    } catch (e) { return false; }
  }

  // Compute device fingerprint from persistent client-side ID
  async function ffmComputePersistFingerprint() {
    try {
      const stored = await new Promise((res) => { try { chrome.storage.local.get(['__ffm_persist'], res); } catch (e) { res({}); } });
      const id = stored && stored.__ffm_persist ? stored.__ffm_persist : null;
      if (!id) return null;
      const data = new TextEncoder().encode(id + '::ffm');
      const hash = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      try { console.warn('[Trial] compute fingerprint failed', e); } catch (_) {}
      return null;
    }
  }

  // Record that a device has used its trial (idempotent upsert)
  async function ffmMarkTrialUsed({ client, userId, device_fingerprint }) {
    try {
      if (!client || !device_fingerprint) return false;
      const payload = {
        device_fingerprint,
        trial_used: true,
        last_user_id: userId || null,
        first_seen_at: new Date().toISOString()
      };
      try {
        const { data, error } = await client.from('trial_eligibility').upsert(payload, { onConflict: 'device_fingerprint' });
        if (error) {
          try { console.warn('[Trial] markTrialUsed error', error); } catch (_) {}
          return false;
        }
        return true;
      } catch (e) {
        try { console.warn('[Trial] markTrialUsed failed', e); } catch (_) {}
        return false;
      }
    } catch (e) { return false; }
  }

  async function ffmEnsureTrialState(user) {
    try {
      if (!user || !user.id) return null;
      if (__ffmTrialInitAttempted) return null;
      __ffmTrialInitAttempted = true;
      const now = Date.now();
      const TRIAL_DAYS = 14;
      const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

      const existing = await ffmGetUserTrialFromDB(user.id);

      if (!existing || !existing.trial_started_at) {
        // First login: create profile with ISO timestamps
        const startedIso = new Date(now).toISOString();
        const expiresIso = new Date(now + TRIAL_MS).toISOString();
        try {
          const client = await ensureSupabaseClient();
          if (client) {
            try {
              await client.from('user_profiles').insert({ user_id: user.id, email: user.email || null, trial_started_at: startedIso, trial_expires_at: expiresIso, status: 'trial', is_paid: false });
            } catch (e) { try { console.warn('[Trial] insert failed', e); } catch (_) {} }
          }
        } catch (e) {}
        const trial = { trialStartedAt: startedIso, trialExpiresAt: expiresIso, isPaid: false };
        try { await new Promise((res) => chrome.storage.local.set({ ffm_trial: trial }, () => res(true))); } catch (e) {}
        try { globalThis.__ffmTrialState = trial; } catch (e) {}
        try { console.log('[Trial] Initialized new trial', trial); } catch (e) {}
        try {
          const client = await ensureSupabaseClient().catch(() => null);
          const fingerprint = await ffmComputePersistFingerprint();
          if (client && fingerprint) {
            try { await ffmMarkTrialUsed({ client, userId: user.id, device_fingerprint: fingerprint }); } catch (e) {}
          }
        } catch (e) {}
        return trial;
      }

      const trial = { trialStartedAt: existing.trial_started_at, trialExpiresAt: existing.trial_expires_at, isPaid: !!existing.is_paid };
      try { await new Promise((res) => chrome.storage.local.set({ ffm_trial: trial }, () => res(true))); } catch (e) {}
      try { globalThis.__ffmTrialState = trial; } catch (e) {}
      return trial;
    } catch (e) { console.warn('[Trial] ensure failed', e); return null; }
  }

  // Handle trial consume intent when Saved Listings is opened in the popup
  async function handleTrialOnSavedListingsOpen() {
    try {
      // Background migration: normalize legacy `fast4mp_last_user` (plain email) -> hashed value
      try {
        const migrate = await new Promise((res) => { try { chrome.storage.local.get(['fast4mp_last_user','fast4mp_last_user_hash'], res); } catch (e) { res({}); } });
        const legacy = migrate && migrate.fast4mp_last_user ? migrate.fast4mp_last_user : null;
        const canon = migrate && migrate.fast4mp_last_user_hash ? migrate.fast4mp_last_user_hash : null;
        if (!canon && legacy && typeof legacy === 'string') {
          if (legacy.includes('@')) {
            try {
              const enc = new TextEncoder().encode(String(legacy).toLowerCase().trim());
              const buf = await crypto.subtle.digest('SHA-256', enc);
              const hashed = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
              if (hashed) {
                try { await new Promise((r) => { try { chrome.storage.local.set({ 'fast4mp_last_user': hashed, 'fast4mp_last_user_hash': hashed }, () => r(true)); } catch (e) { r(true); } }); } catch (e) {}
                try { console.log('[FFM] Migrated legacy fast4mp_last_user (bg)'); } catch (e) {}
              }
            } catch (e) { /* ignore migration errors */ }
          } else {
            try { await new Promise((r) => { try { chrome.storage.local.set({ 'fast4mp_last_user_hash': legacy }, () => r(true)); } catch (e) { r(true); } }); } catch (e) {}
          }
        }
      } catch (e) {}

      const stored = await new Promise((res) => { try { chrome.storage.local.get(['activeUserId','__ffm_persist'], res); } catch (e) { res({}); } });
      const activeUserId = stored && stored.activeUserId ? stored.activeUserId : null;
      const persist = stored && stored.__ffm_persist ? stored.__ffm_persist : null;
      if (!activeUserId) return;
      if (!persist || !persist.device_fingerprint) return;

      // Prevent duplicate calls for same device
      if (persist.trial_consumed === true) return;

      try { console.log('[TrialGuard] Saved Listings opened — attempting trial consume'); } catch (_) {}

      // Local-only: compute email hash and store `fast4mp_last_user_hash` locally.
      try {
        // attempt to find a stored email in common keys
        const keys = ['ffm_current_user_email','ffmCurrentUserEmail','ffmActiveUserEmail','ffm_supabase_session','ffm_supabase_user'];
        const s = await new Promise((res) => { try { chrome.storage.local.get(keys, res); } catch (e) { res({}); } });
        let email = null;
        if (s) {
          email = s.ffm_current_user_email || s.ffmCurrentUserEmail || s.ffmActiveUserEmail || null;
          if (!email && s.ffm_supabase_session) {
            try { const sess = typeof s.ffm_supabase_session === 'string' ? JSON.parse(s.ffm_supabase_session) : s.ffm_supabase_session; email = sess?.user?.email || null; } catch (e) {}
          }
          if (!email && s.ffm_supabase_user) {
            try { const u = typeof s.ffm_supabase_user === 'string' ? JSON.parse(s.ffm_supabase_user) : s.ffm_supabase_user; email = u?.email || null; } catch (e) {}
          }
        }

        // Fallback: use activeUserId as surrogate if email unavailable
        const identityForHash = email || activeUserId;
        if (!identityForHash) return;

        // compute sha256 locally
        let emailHash = null;
        try {
          const enc = new TextEncoder().encode(String(identityForHash).toLowerCase().trim());
          const buf = await crypto.subtle.digest('SHA-256', enc);
          emailHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
        } catch (e) { emailHash = null; }

        if (!emailHash) return;

        // write last-user hash and mark persist as consumed using safe semantics
        try {
          const canonicalKey = 'fast4mp_last_user_hash';
          const legacyKey = 'fast4mp_last_user';
          const cur = await new Promise((res) => { try { chrome.storage.local.get([canonicalKey, 'ffm_multi_user_locked'], res); } catch (e) { res({}); } });
          const existing = cur && cur[canonicalKey] ? cur[canonicalKey] : null;
          if (existing && existing !== emailHash) {
            try { await new Promise((r) => { try { chrome.storage.local.set({ ffm_multi_user_locked: true }, () => r(true)); } catch (e) { r(true); } }); } catch (e) {}
          } else {
            try { await new Promise((r) => { try { chrome.storage.local.set({ [canonicalKey]: emailHash, [legacyKey]: emailHash, ffm_multi_user_locked: false }, () => r(true)); } catch (e) { r(true); } }); } catch (e) {}
            try { if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem(legacyKey, emailHash); } catch (e) {}
          }
        } catch (e) {}

        try {
          const newPersist = Object.assign({}, persist, { trial_consumed: true });
          await new Promise((res) => { try { chrome.storage.local.set({ '__ffm_persist': newPersist }, () => res(true)); } catch (e) { res(true); } });
        } catch (e) {}
      } catch (e) { try { console.warn('[TrialGuard] local mark failed', e); } catch(_){} }
    } catch (err) {
      try { console.error('[TrialGuard] Failed to mark trial used', err); } catch (_) {}
    }
  }

  // Helper: persist session object to chrome.storage.local
  async function persistSession(session) {
    try {
      await new Promise((res) => { try { chrome.storage.local.set({ ffm_supabase_session: session }, () => res(true)); } catch (e) { res(false); } });
    } catch (e) {}
  }

  // ---- Auth: signup ----
  async function signupWithEmail(email, password) {
    try {
      const ok = await ensureSupabaseClient().then(c => !!c).catch(() => false);
      if (!ok || !ffmSupabaseClient) return { ok: false, error: 'client_unavailable' };
      try {
        const { data, error } = await ffmSupabaseClient.auth.signUp({ email, password });
        if (error) return { ok: false, error: error.message || 'signup_failed' };

        // If a session was returned, persist it
        const session = data && data.session ? data.session : null;
        if (session) {
          try { await persistSession(session); } catch (e) {}
        }

        // Return current state snapshot so UI can update (user may require email confirm)
        try {
          const stored = await new Promise((res) => { try { chrome.storage.local.get(['ffm_supabase_session'], res); } catch (e) { res({}); } });
          const sess = stored && stored.ffm_supabase_session ? stored.ffm_supabase_session : session;
          // Try to fetch user if possible
          let user = null;
          try {
            if (ffmSupabaseClient && ffmSupabaseClient.auth && typeof ffmSupabaseClient.auth.getUser === 'function') {
              const r = await ffmSupabaseClient.auth.getUser();
              user = (r && r.data && r.data.user) ? r.data.user : null;
            }
          } catch (e) {}
          try {
            // Persist active user id/email for popup sync
            try {
              const activeUserId = user && user.id ? user.id : null;
              await new Promise((res) => { try { chrome.storage.local.set({ ffm_active_user_id: activeUserId, ffm_active_user_email: user && user.email ? user.email : null }, () => res(true)); } catch (e) { res(true); } });
            } catch (e) {}
          } catch (e) {}

          try {
            // Try to include stripeCustomerId from user_profiles for popup convenience
            let stripeCustomerId = null;
            try {
              if (user && user.id) {
                const client = await ensureSupabaseClient();
                if (client) {
                  try {
                    const prof = await client.from('user_profiles').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
                    if (prof && prof.data && prof.data.stripe_customer_id) stripeCustomerId = prof.data.stripe_customer_id;
                  } catch (e) {}
                }
              }
            } catch (e) {}
            try { chrome.runtime.sendMessage({ action: 'ffm-auth:state-changed', session: sess, user, stripeCustomerId }); } catch (e) {}
            return { ok: true, state: { session: sess, user: user ? { email: user.email, id: user.id } : null, stripeCustomerId } };
          } catch (e) {
            return { ok: true };
          }
        } catch (e) {
          return { ok: true };
        }
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // ---- Auth: password reset ----
  async function resetPassword(email) {
    try {
      const ok = await ensureSupabaseClient().then(c => !!c).catch(() => false);
      if (!ok || !ffmSupabaseClient) return { ok: false, error: 'client_unavailable' };
      try {
        const { error } = await ffmSupabaseClient.auth.resetPasswordForEmail(email);
        if (error) return { ok: false, error: error.message || 'reset_failed' };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
      }
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  // Message handlers
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.type) return false;

      if (msg.type === 'ffm-auth:get-state') {
        try {
          // Prefer stored session
          const stored = await new Promise((res) => { try { chrome.storage.local.get(['ffm_supabase_session'], res); } catch (e) { res({}); } });
          const session = stored && stored.ffm_supabase_session ? stored.ffm_supabase_session : null;
          let user = null;
          try {
            const client = await ensureSupabaseClient();
            if (client && client.auth && typeof client.auth.getUser === 'function') {
              const r = await client.auth.getUser();
              user = (r && r.data && r.data.user) ? r.data.user : null;
            }
          } catch (e) {
            // ignore
          }
          // Persist active user id/email for popup sync
          try {
            const activeUserId = user && user.id ? user.id : null;
            await new Promise((res) => { try { chrome.storage.local.set({ ffm_active_user_id: activeUserId, ffm_active_user_email: user && user.email ? user.email : null }, () => res(true)); } catch (e) { res(true); } });
          } catch (e) {}

          const minimalUser = user ? { email: user.email, id: user.id } : null;
          // Ensure trial state is initialized for this user (best-effort)
          try { if (minimalUser && minimalUser.id) await ffmEnsureTrialState(minimalUser); } catch (e) {}

          try {
            let stripeCustomerId = null;
            try {
              if (minimalUser && minimalUser.id) {
                const client2 = await ensureSupabaseClient();
                if (client2) {
                  try {
                    const prof = await client2.from('user_profiles').select('stripe_customer_id').eq('user_id', minimalUser.id).maybeSingle();
                    if (prof && prof.data && prof.data.stripe_customer_id) stripeCustomerId = prof.data.stripe_customer_id;
                  } catch (e) {}
                }
              }
            } catch (e) {}
            try {
              if (stripeCustomerId) {
                try { await new Promise((res) => { chrome.storage.local.set({ ffm_stripe_customer_id: stripeCustomerId }, () => res(true)); }); } catch (e) {}
              }
            } catch (e) {}
            sendResponse({ ok: true, signedIn: !!minimalUser, user: minimalUser, session, stripeCustomerId });
          } catch (e) { sendResponse({ ok: true, signedIn: !!minimalUser, user: minimalUser, session }); }
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return true;
      }

      // Accept pushed debug snapshots from popup/content and merge into collector
      if (msg.type === 'ffm_debuglog_push') {
        try {
          if (!FFM_DEBUGLOG.enabled) {
            try { sendResponse && sendResponse({ ok: false, error: 'debug-disabled' }); } catch (e) {}
            return true;
          }
          const src = msg.source || 'popup';
          const payload = msg.payload || {};
          try {
            const key = String(src || 'popup');
            FFM_DEBUGLOG.page.set(key, Object.assign({ at: ffmDbgNowIso(), source: src }, payload));
            ffmDbgPush('bg', 'info', [`received debug push from ${key}`]);
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        return true;
      }

      // Trigger an upload of the collected debug snapshot to S3 via signer
      if (msg.type === 'ffm_debuglog_upload') {
        try {
          if (!FFM_DEBUGLOG.enabled) {
            try { sendResponse && sendResponse({ ok: false, error: 'debug-disabled' }); } catch (e) {}
            return true;
          }
          const userId = msg.userId || null;
          const note = msg.note || '';
          try {
            const snap = ffmDbgSnapshot();
            const payload = { meta: { when: ffmDbgNowIso(), note }, snapshot: snap };
            let uid = userId;
            if (!uid) {
              try {
                const out = await new Promise(res => { try { chrome.storage.local.get(['ffm_user_context','ffm_current_user_id','ffm_current_user'], res); } catch (e) { res({}); } });
                if (out) {
                  if (out.ffm_current_user_id) uid = out.ffm_current_user_id;
                  else if (out.ffm_user_context && out.ffm_user_context.userId) uid = out.ffm_user_context.userId;
                  else if (out.ffm_current_user && out.ffm_current_user.id) uid = out.ffm_current_user.id;
                }
              } catch (e) {}
            }
            if (!uid) {
              try { console.warn('[DebugLog] Missing userId; using fallback "anonymous" id for upload'); } catch (e) {}
              uid = 'anonymous';
              payload.meta.fallbackUserId = true;
            }
            const resp = await ffmDbgUploadToS3(uid, payload);
            // On successful upload, clear in-memory buffers and related local storage debug keys
            try {
              try { FFM_DEBUGLOG.buf = []; } catch (e) {}
              try { FFM_DEBUGLOG.page.clear(); } catch (e) {}
              // Remove stored debug snapshot / debug trace keys so next run starts fresh
              try {
                chrome.storage.local.get(null, (items) => {
                  try {
                    const toRemove = [];
                    for (const k of Object.keys(items || {})) {
                      try {
                        if (!k || typeof k !== 'string') continue;
                        if (k.startsWith('ffm_debug_') || k.startsWith('ffm_task_trace_') || k.startsWith('ffm_run_debug_') || k.startsWith('ffm_debug_snapshot_')) {
                          toRemove.push(k);
                        }
                      } catch (e) {}
                    }
                    if (toRemove.length) {
                      try { chrome.storage.local.remove(toRemove, () => {}); } catch (e) {}
                    }
                  } catch (e) {}
                });
              } catch (e) {}
            } catch (e) {}
            try { sendResponse && sendResponse(Object.assign({ ok: true }, resp)); } catch (e) {}
          } catch (e) {
            try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
          }
        } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        return true;
      }

      // Popup acknowledgement that it received the DnR completion message
      if (msg.type === 'ffm_dnr_received') {
        try {
          const lid = msg.listingId || msg.inventoryName || msg.inventoryName || '';
          if (lid) {
            try { FFMPendingDnrAcks.add(String(lid)); } catch (e) {}
            try { ffmDbgPush('bg','info',['ffm_dnr_received ack', String(lid)]); } catch (e) {}
          }
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        return true;
      }

      if (msg.type === 'ffm-auth:set-session') {
        try {
          const s = msg.session || null;
          await persistSession(s);
          sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return true;
      }

      if (msg.type === 'ffm-auth:login') {
        try {
          const { email, password } = msg || {};
          if (!email || !password) return sendResponse({ ok: false, error: 'missing-credentials' });
          const client = await ensureSupabaseClient();
          if (!client || !client.auth || typeof client.auth.signInWithPassword !== 'function') throw new Error('Supabase auth unavailable');
          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if (error) {
            sendResponse({ ok: false, error: (error && error.message) ? error.message : String(error) });
          } else {
            const session = data && data.session ? data.session : null;
            const user = data && data.user ? data.user : null;
            await persistSession(session);
            try {
              // Persist active user id/email for popup sync
              const activeUserId = user && user.id ? user.id : null;
              await new Promise((res) => { try { chrome.storage.local.set({ ffm_active_user_id: activeUserId, ffm_active_user_email: user && user.email ? user.email : null }, () => res(true)); } catch (e) { res(true); } });
            } catch (e) {}
            // Notify any popup UI to close/populate as necessary, include stripeCustomerId when available
            try {
              let stripeCustomerId = null;
              try {
                const client = await ensureSupabaseClient();
                if (client && user && user.id) {
                  try {
                    const prof = await client.from('user_profiles').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
                    if (prof && prof.data && prof.data.stripe_customer_id) stripeCustomerId = prof.data.stripe_customer_id;
                  } catch (e) {}
                }
              } catch (e) {}
              try {
                if (stripeCustomerId) {
                  try { await new Promise((res) => { chrome.storage.local.set({ ffm_stripe_customer_id: stripeCustomerId }, () => res(true)); }); } catch (e) {}
                }
              } catch (e) {}
              try { chrome.runtime.sendMessage({ action: 'ffm-auth:state-changed', session, user, stripeCustomerId }); } catch (e) {}
            } catch (e) {}
            sendResponse({ ok: true, session, user });
          }
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return true;
      }

      if (msg.type === 'ffm-auth:signup') {
        try {
          const { email, password } = msg || {};
          if (!email || !password) return sendResponse({ ok: false, error: 'missing-credentials' });
          signupWithEmail(email, password).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return true;
      }

      if (msg.type === 'ffm-auth:reset-password') {
        try {
          const { email } = msg || {};
          if (!email) return sendResponse({ ok: false, error: 'missing-email' });
          resetPassword(email).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return true;
      }

      if (msg.type === 'ffm-auth:logout') {
        try {
          try {
            const client = await ensureSupabaseClient();
            if (client && client.auth && typeof client.auth.signOut === 'function') {
              await client.auth.signOut();
            }
          } catch (e) {}
          // Clear session storage
          try { chrome.storage.local.remove(['ffm_supabase_session']); } catch (e) {}
          try { chrome.storage.local.remove(['ffm_active_user_id','ffm_active_user_email']); } catch (e) {}
          // Force-close popups via existing handler
          try { chrome.runtime.sendMessage({ action: 'ffmForceLogout' }); } catch (e) {}
          sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
        return true;
      }
    } catch (e) {
      try { sendResponse({ ok: false, error: String(e) }); } catch (e) {}
      return false;
    }
  });
} catch (e) { console.warn('[AutoList Pro bg] Auth service install failed', e); }

// Simple responder for popup to fetch trial status (minimal, authoritative)
let ffmTrialState = null;
// Keep ffmTrialState in sync with __ffmTrialState when available
// Helper: compute integer days left from an ISO timestamp or numeric ms
function ffmComputeDaysLeft(expiresAt) {
  try {
    if (!expiresAt) return 0;
    const ts = (typeof expiresAt === 'number') ? expiresAt : Date.parse(String(expiresAt));
    if (!Number.isFinite(ts)) return 0;
    const msLeft = ts - Date.now();
    const days = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    return days;
  } catch (e) { return 0; }
}
try {
  // Diagnostic ping for trial plumbing. Use this from the popup console to
  // verify message plumbing and listener registration quickly:
  //   chrome.runtime.sendMessage({ type: 'ffm_trial_ping' }, r => console.log(r));
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.type !== 'ffm_trial_ping') return false;
        try { console.log('[Trial][bg] ping received'); } catch (e) {}
        sendResponse({ ok: true });
        return true;
      } catch (e) {}
      return false;
    });
  } catch (e) {}

  // URL-driven hidden-tab result receiver (one-way)
  try {
    chrome.runtime.onMessage.addListener((msg, sender) => {
      try {
        if (!msg || msg.action !== 'ffm_as_hidden_result') return;
        try { console.log('[AutoList Pro bg:AS] Received hidden AS result', msg && msg.reqId); } catch (e) {}

        // If we are in hidden AS mode, buffer ANY incoming content-sourced hidden results
        // unless the message is explicitly marked as a merged final result or originates from the background.
        const isFinalMarked = msg && msg.meta && msg.meta.merged === true;
        const fromBackground = !sender || (!sender.tab && sender.id === chrome.runtime.id);
        if (ffmAsMode === 'hidden' && !isFinalMarked && !fromBackground) {
          try {
            ffmAsPassBuffer = ffmAsPassBuffer || { passes: {} };
            const key = (msg && msg.reqId) ? String(msg.reqId) : (sender && sender.tab && sender.tab.id) ? String(sender.tab.id) : ('r' + Date.now());
            ffmAsPassBuffer.passes[key] = { listings: msg.listings || [], meta: msg.meta || {}, tabId: sender && sender.tab && sender.tab.id ? sender.tab.id : null };
            try { console.log('[AutoList Pro bg:AS] Buffered hidden AS pass (suppressed interim)', key, 'items=', (msg.listings || []).length); } catch (e) {}
          } catch (e) {}
          // Do not forward or close the helper tab yet — orchestrator will handle merging and cleanup
          return;
        }

        // Persist last result for diagnostics/UI
        try {
          chrome.storage.local.set({ ffm_as_lastResult: msg }, () => {});
        } catch (e) {}

        // Notify any listeners (popup or other background consumers) — route through safe sender
        try { bgSafeSendMessage({ action: 'ffm_as_updated', result: msg }); } catch (e) {}

        // Clear the AS in-progress flag so close paths may proceed.
        try {
          const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
          try { storage && storage.remove && storage.remove('ffm_as_in_progress', () => {}); } catch (e) {}
        } catch (e) {}

        // Close the sender tab if possible (background owns final close)
        try {
          const tabId = sender && sender.tab && sender.tab.id ? sender.tab.id : null;
          if (tabId) {
            try { safeTabsRemove(tabId).catch(()=>{}); } catch (e) {}
            // If this final result is the merged authoritative result, also clear any
            // protected marker and ensure the helper tab is closed (best-effort).
            try {
              const isFinalMerged = msg && msg.meta && msg.meta.merged === true;
              if (isFinalMerged) {
                try { safeTabsRemove(tabId).catch(()=>{}); } catch (e) {}
                try { console.log('[AutoList Pro bg:AS] Closed helper tab after merged merged result', tabId); } catch(e) {}
              }
            } catch (e) {}
          }
        } catch (e) {}
      } catch (e) {}
    });
  } catch (e) {}

  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || (msg.action !== 'ffm_get_trial_status' && msg.action !== 'ffm_get_trial_state')) return;

        (async () => {
          try {
            // Prefer in-memory cache
            let t = null;
            try { t = globalThis.__ffmTrialState || null; } catch (e) { t = null; }
            if (!t) {
              const s = await new Promise((res) => { try { chrome.storage.local.get(['ffm_trial'], res); } catch (e) { res({}); } });
              t = (s && s.ffm_trial) ? s.ffm_trial : null;
            }
            if (!t) return sendResponse(null);
            const expiresAt = t.trialExpiresAt || t.trial_expires_at || null;
            const isPaid = !!(t.isPaid || t.is_paid);
            const daysLeft = isPaid ? null : ffmComputeDaysLeft(expiresAt);
            // maintain the simple ffmTrialState shape
            ffmTrialState = { isTrial: !isPaid && !!expiresAt, expiresAt, daysLeft, isPaid };
            // Persist a lightweight snapshot back to storage so popup/settings that
            // read `ffm_trial` from storage will observe the same canonical values.
            try {
              chrome.storage.local.set({ ffm_trial: { trialStartedAt: t.trialStartedAt || t.trial_started_at || null, trialExpiresAt: expiresAt, isPaid: isPaid } }, () => {});
            } catch (e) {}
            sendResponse(ffmTrialState);
          } catch (e) { sendResponse(null); }
        })();

        return true;
      } catch (e) {}
    });
  }
} catch (e) {}

// Canonical listing handler moved into main scheduler router (see below).

// Lightweight listener to handle Saved Listings trial intent from popup
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender) => {
      try {
        if (msg && msg.action === 'ffm_trial_saved_listings_opened') {
          try { handleTrialOnSavedListingsOpen(); } catch (e) {}
        }
      } catch (e) {}
    });
  }
} catch (e) {}


// IID handlers removed — Invisible-ID (IID) message merging was removed per cleanup.
// Auto Active Scan (AAS) now performs hourly checks when enabled via popup.


// Global protection handle for Active Sync helper tab — when set, cleanup routines
// should skip closing the protected tab until the merge-complete flow clears it.
// FFM_AS_PROTECTED_TAB removed — protected-tab feature deprecated and disabled
// Buffer and context for multi-pass hidden AS runs
let ffmAsPassBuffer = null;
let ffmAsTwoPassContext = null;

// ------------------------------------------------------------------
// De-duplicate chrome event listener registration by wrapping addListener
// so duplicate function registrations are ignored. This prevents multiple
// listener bindings when the service worker is reloaded.
// ------------------------------------------------------------------
try {
  const wrap = (ev) => {
    try {
      if (!ev || typeof ev.addListener !== 'function') return;
      if (ev.addListener.__ffm_wrapped) return;
      const origAdd = ev.addListener.bind(ev);
      ev.addListener = function (fn) {
        try {
          if (typeof fn !== 'function') return;
          if (fn.__ffm_wrapped) return;
          fn.__ffm_wrapped = true;
          return origAdd(fn);
        } catch (e) {}
      };
      ev.addListener.__ffm_wrapped = true;
    } catch (e) {}
  };

  // Wrap a few common chrome event targets (best-effort)
  try { wrap(chrome && chrome.alarms && chrome.alarms.onAlarm ? chrome.alarms.onAlarm : chrome.alarms); } catch (e) {}
  try { wrap(chrome && chrome.runtime && chrome.runtime.onMessage ? chrome.runtime.onMessage : chrome.runtime); } catch (e) {}
  try { wrap(chrome && chrome.tabs && chrome.tabs.onUpdated ? chrome.tabs.onUpdated : chrome.tabs); } catch (e) {}

  function ffmCleanupLegacyAlarms() {
    try {
      if (!chrome || !chrome.alarms || typeof chrome.alarms.getAll !== 'function') return;
      chrome.alarms.getAll((alarms) => {
        try {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn('[bg:ALARM] getAll error:', chrome.runtime.lastError);
            return;
          }

          const keep = new Set([
            'ffm_schedule_ASA_AUTO',
            'ffm_schedule_PUB_AUTO',
            'ffm_schedule_DNR_AUTO'
          ]);

          const legacy = (alarms || []).filter((a) => {
            try { return a && a.name && !keep.has(a.name); } catch (e) { return false; }
          });

          if (legacy && legacy.length) {
            console.log('[bg:ALARM] Cleaning up legacy alarms:', legacy.map(a => a.name));
            legacy.forEach((a) => {
              try { chrome.alarms.clear(a.name); } catch (e) {}
            });
          }
        } catch (e) { console.warn('[bg:ALARM] ffmCleanupLegacyAlarms inner error', e); }
      });
    } catch (e) { console.warn('[bg:ALARM] ffmCleanupLegacyAlarms error', e); }
  }

} catch (e) { console.warn('[bg:ALARM] install failed', e); }

// Call cleanup now that helpers/constants are defined
try { ffmCleanupLegacyAlarms(); } catch (e) {}

// ------------------------------------------------------------------
// Auto Active Scan (AAS) hourly alarm + hidden-tab runner
// ------------------------------------------------------------------
const FFM_AAS_AUTO_ALARM = 'ffm_schedule_AAS_AUTO_HOURLY';

let ffmPendingAasTabId = null;

// Guard: only run AAS when Chrome window is focused
function ffmCanRunAASNow() {
  if (!chrome || !chrome.windows) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      chrome.windows.getLastFocused({ populate: false }, (win) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        if (!win) { resolve(false); return; }
        resolve(win.focused === true);
      });
    } catch (e) { resolve(false); }
  });
}

// Slightly different helper that follows the original recommended shape
function ffmCanLaunchAAS() {
  return new Promise(resolve => {
    try {
      chrome.windows.getLastFocused({}, (win) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        if (!win) { resolve(false); return; }
        resolve(win.focused === true);
      });
    } catch (e) { resolve(false); }
  });
}

function ffmEnsureAasAutoAlarm() {
  try {
    if (!chrome || !chrome.alarms) return;
    chrome.alarms.get(FFM_AAS_AUTO_ALARM, (existing) => {
      try {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[AutoList Pro bg:AAS] chrome.alarms.get error', chrome.runtime.lastError);
          return;
        }
        if (existing) {
          console.log('[AutoList Pro bg:AAS] Auto alarm already exists:', existing);
          return;
        }
        chrome.alarms.create(FFM_AAS_AUTO_ALARM, { periodInMinutes: 60 });
        console.log('[AutoList Pro bg:AAS] Created hourly AAS auto alarm');
      } catch (e) { console.warn('[AutoList Pro bg:AAS] ffmEnsureAasAutoAlarm inner error', e); }
    });
  } catch (e) { console.warn('[AutoList Pro bg:AAS] ffmEnsureAasAutoAlarm error', e); }
}

function ffmRunAutoAasScan() {
  try {
    console.log("[AutoList Pro bg:AAS] 🚫 Legacy hidden-tab AAS disabled. Using new window-based AAS.");
  } catch (e) {}
  return; // fully disabled
}

// Ensure this alarm exists on startup
try { ffmEnsureAasAutoAlarm(); } catch (e) { console.warn('[AutoList Pro bg:AAS] ensure alarm call failed', e); }

// Listen for our new hourly alarm and trigger the hidden-tab scan
try {
  if (chrome && chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      try {
        if (!alarm || !alarm.name) return;
        if (alarm.name === FFM_AAS_AUTO_ALARM) {
          console.log('[AutoList Pro bg:AAS] Auto alarm fired — running hourly scan…');
          // If a scheduled UI-driven task is in progress, block Auto AAS
          try {
            if ((typeof window !== 'undefined' && window.__ffm_block_as) || (typeof globalThis !== 'undefined' && globalThis.__ffm_block_as)) {
              try { console.log('[AutoList Pro AAS] Blocked due to SDnR/SP active.'); } catch (e) {}
              return;
            }
          } catch (e) {}
          // Only run when browser is focused; check focus first, then firewall/hardguards
          ffmCanLaunchAAS().then((canRun) => {
            try {
              if (!canRun) {
                try { console.log('[AutoList Pro bg:AAS] Skipped — browser not focused'); } catch (e) {}
                return;
              }
            } catch (e) { return; }

            // Respect hourly firewall check before running
            ffmShouldRunHourlySync().then((ok) => {
              try {
                if (ok) {
                  try { console.log('[AutoList Pro bg:AAS] Focus OK — scheduling NEW AAS (window mode) from hourly alarm'); } catch (e) {}
                  // Small delay to avoid firing immediately when Chrome is just opened
                  try {
                    setTimeout(() => {
                      try { ffmRunActiveSyncBackground({ jitterMs: 0 }); } catch (e) { console.warn('[AutoList Pro bg:AAS] ffmRunActiveSyncBackground failed', e); }
                    }, 30000);
                  } catch (e) { try { ffmRunActiveSyncBackground({ jitterMs: 0 }); } catch (er) { console.warn('[AutoList Pro bg:AAS] ffmRunActiveSyncBackground failed', er); } }
                } else console.log('[AutoList Pro bg:AAS] Hourly sync skipped by firewall');
              } catch (e) {}
            }).catch((e) => { console.warn('[AutoList Pro bg:AAS] ffmShouldRunHourlySync error', e); });
          }).catch((e) => { try { console.warn('[AutoList Pro bg:AAS] ffmCanLaunchAAS error', e); } catch (_) {} });
        }
      } catch (e) { console.warn('[AutoList Pro bg:AAS] onAlarm handler error', e); }
    });
  }
} catch (e) { console.warn('[AutoList Pro bg:AAS] failed to register onAlarm handler', e); }

// Listen for completion message from content script for auto AAS and close the helper tab
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg) return;

      // Existing auto-complete hook
      if (msg.action === 'ffm_AAS_auto_complete') {
        try { console.log('[AutoList Pro bg:AAS] Auto AAS scan complete:', msg.summary || {}); } catch (e) {}
      }

      // Terminal finalize message from content script — treat as authoritative
      if (msg.action === 'FFM_ACTIVE_LISTINGS_COMPLETE') {
        try { console.log('[AutoList Pro bg] Active listings complete (finalize):', Array.isArray(msg.listings) ? msg.listings.length : 0); } catch (e) {}
        try {
          // Clear AS in-progress flag (finalize path) so background close paths may proceed
          try {
            const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
            try { storage && storage.remove && storage.remove('ffm_as_in_progress', () => {}); } catch (e) {}
          } catch (e) {}

          // Forward into the existing active-listings merge flow by emitting the
          // same action that the legacy flow uses. Use callback to close tab
          // after merge handler responds (if sender tab exists).
          bgSafeSendMessage({ action: 'ffmActiveListingsResult', scraped: Array.isArray(msg.listings) ? msg.listings : [] }, (resp) => {
            try {
              if (sender && sender.tab && typeof sender.tab.id !== 'undefined') {
                try { safeTabsRemove(sender.tab.id).catch((_)=>{}); } catch (e) { console.warn('[AutoList Pro bg] Failed to close helper tab', e); }
              }
            } catch (e) { console.warn('[AutoList Pro bg] finalize close tab error', e); }
          });
        } catch (e) { console.warn('[AutoList Pro bg] Failed to forward finalized listings', e); }
        return;
      }

      // Persist last-checked timestamps (same keys used by ffmRunActiveSyncBackground)
      try {
        const nowTs = Date.now();
        chrome.storage && chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ fast4mp_lastActiveCheck: nowTs, ffmLastActiveCheck: nowTs, ffm_lastActiveCheck: nowTs }, () => {
          try { console.log('[AutoList Pro bg:AAS] Updated lastActiveCheck timestamps on auto-complete'); } catch (e) {}
        });
      } catch (e) { console.warn('[AutoList Pro bg:AAS] Failed to persist lastActiveCheck on auto-complete', e); }

      // Try to close the helper tab. Prefer the tracked pending id; if missing,
      // attempt to find a non-active Selling tab and close that (best-effort).
      // Protect tabs launched for URL-driven hidden AS (contain ffm_as=1)
      function ffmIsProtectedASTab(tab) {
        try {
          return !!(tab && tab.url && String(tab.url).includes('ffm_as=1'));
        } catch (e) {
          return false;
        }
      }
      (async () => {
        try {
          if (ffmPendingAasTabId !== null) {
            const tabIdToClose = ffmPendingAasTabId;
            ffmPendingAasTabId = null;
            // deprecated protected-tab clearing removed
            try {
                try { safeTabsRemove(tabIdToClose).then((ok) => { if (!ok) { const lastErr = chrome.runtime && chrome.runtime.lastError; if (lastErr) console.warn('[AutoList Pro bg:AAS] Failed to close hidden Selling tab:', lastErr && lastErr.message); } else { console.log('[AutoList Pro bg:AAS] Hidden Selling tab closed'); } }); } catch (e) { console.warn('[AutoList Pro bg:AAS] Error closing helper tab (pending id)', e); }
              return;
            } catch (e) {
              console.warn('[AutoList Pro bg:AAS] Error closing helper tab (pending id)', e);
            }
          }

          // Fallback: close any non-active Selling tab (avoid closing protected tab)
          try {
            // Only close tabs that look like AS helper tabs (contain ffm_as markers).
            chrome.tabs.query({}, (tabs) => {
              try {
                const candidates = (tabs || []).filter(t => t && t.url && (String(t.url).includes('ffm_as=1') || String(t.url).includes('ffm_as_req=')) && !t.active);
                if (candidates && candidates.length) {
                  // Close the newest/non-active AS helper candidate
                  const toClose = candidates.sort((a, b) => (b.id || 0) - (a.id || 0))[0];
                  try {
                    safeTabsRemove(toClose.id).then((ok) => {
                      if (!ok) {
                        const lastErr = chrome.runtime && chrome.runtime.lastError;
                        if (lastErr) console.warn('[AutoList Pro bg:AAS] Fallback AS helper close failed', lastErr && lastErr.message);
                      } else {
                        console.log('[AutoList Pro bg:AAS] Fallback hidden AS helper tab closed', toClose.id);
                      }
                    }).catch(()=>{});
                  } catch (e) { console.warn('[AutoList Pro bg:AAS] Fallback chrome.tabs.remove error', e); }
                } else {
                  // No AS helper tab to close — do not close arbitrary Selling tabs
                  // Log once per boot to reduce noise, unless debug mode enabled.
                  try {
                    if (FAST4MP_DEBUG || !globalThis.__ffm_logged_no_as_helper) {
                      console.log('[AutoList Pro bg:AAS] No AS helper tab found to close (fallback)');
                      try { globalThis.__ffm_logged_no_as_helper = true; } catch (e) {}
                    }
                  } catch (e) { /* best-effort logging only */ }
                }
              } catch (e) { console.warn('[AutoList Pro bg:AAS] tabs.query callback error', e); }
            });
          } catch (e) { console.warn('[AutoList Pro bg:AAS] tabs.query failed while attempting fallback close', e); }
        } catch (e) { console.warn('[AutoList Pro bg:AAS] Async close helper failed', e); }
      })();
    } catch (e) {}
    // no async response
    return false;
  });
} catch (e) { console.warn('[AutoList Pro bg:AAS] install onMessage completion listener failed', e); }

// Fallback: If the content script sends a standard Active Listings result/update
// (rather than the dedicated `ffm_AAS_auto_complete` action), detect when the
// sender tab matches the pending AAS helper tab and persist timestamps + close it.
try {
  chrome.runtime.onMessage.addListener((msg, sender) => {
    try {
      if (!msg) return;

      const candidateNames = new Set([
        'ffmActiveListingsResult',
        'ffmActiveListingsUpdated',
        'ffmActiveListingsUpdate',
        'ffmActiveListingsResult',
        'ffmActiveListingsUpdated'
      ]);

      const name = (msg.action || msg.type || msg.cmd || '').toString();
      if (!candidateNames.has(name)) return;

      const tabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
      if (tabId == null) return;

      // If this message came from the helper tab we created for AAS, treat it
      // as completion: persist last-check timestamps and close the helper tab.
      if (ffmPendingAasTabId !== null && tabId === ffmPendingAasTabId) {
        try {
          const nowTs = Date.now();
          chrome.storage && chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ fast4mp_lastActiveCheck: nowTs, ffmLastActiveCheck: nowTs, ffm_lastActiveCheck: nowTs }, () => {
            try { console.log('[AutoList Pro bg:AAS] Updated lastActiveCheck timestamps on forwarded result'); } catch (e) {}
          });
        } catch (e) { console.warn('[AutoList Pro bg:AAS] Failed to persist lastActiveCheck on forwarded result', e); }

        // Clear pending id and attempt to close the helper tab
          try {
            const toClose = ffmPendingAasTabId;
            ffmPendingAasTabId = null;
            try {
              try {
                safeTabsRemove(toClose).then((ok) => {
                  if (!ok) {
                    const lastErr = chrome.runtime && chrome.runtime.lastError;
                    console.warn('[AutoList Pro bg:AAS] Failed to close forwarded helper tab', lastErr && lastErr.message);
                  } else {
                    console.log('[AutoList Pro bg:AAS] Hidden Selling tab closed (forwarded result)', toClose);
                  }
                }).catch((e) => { console.warn('[AutoList Pro bg:AAS] Error closing forwarded helper tab', e); });
              } catch (e) { console.warn('[AutoList Pro bg:AAS] Error in safeTabsRemove fallback', e); }
            } catch (e) { console.warn('[AutoList Pro bg:AAS] Error closing forwarded helper tab', e); }
          } catch (e) {}
      }
    } catch (e) {}
    return false;
  });
} catch (e) { console.warn('[AutoList Pro bg:AAS] install fallback onMessage listener failed', e); }

function ffmLog(type = "BG", ...args) {
  try {
    const rules = (ffmGlobal && ffmGlobal.FFM_DEBUG) ? ffmGlobal.FFM_DEBUG : {};
    if (!rules.ENABLED && type !== "ERROR") return;
    if (!rules[type]) return;
    console.log(`[FFM:${type}]`, ...args);
  } catch (e) {
    console.warn('ffmLog exception', e);
    console.log(...args);
  }
}

// Enforce default debug toggles to the requested safe state
try { if (ffmGlobal && ffmGlobal.FFM_DEBUG) { ffmGlobal.FFM_DEBUG.ENABLED = false; ffmGlobal.FFM_DEBUG.MATCH = false; } } catch (e) {}
// Toggle to disable the frequent heartbeat alarm (useful during development).
// Set to `false` to re-enable the heartbeat.
const FFM_DISABLE_HEARTBEAT = true;

// ======================================================================
// AutoList Pro: Utility to always get the NEWEST Selling tab
// Also closes older Selling tabs to avoid stale DOM or duplicate scripts
// ======================================================================
async function ffmGetFreshSellingTab() {
  // New behavior: do NOT reuse existing Selling tabs. Close any that exist
  // and return null so callers will create a fresh tab instead.
  return new Promise((resolve) => {
    try {
      // Determine the currently active tab in the current window so we avoid
      // closing the user's active tab (prevents FB tabs being closed unexpectedly).
      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
        const activeTabId = (activeTabs && activeTabs.length) ? activeTabs[0].id : null;
        chrome.tabs.query({}, (tabs) => {
          try {
            const sellingTabs = (tabs || []).filter(t => t && t.url && t.url.includes('/marketplace/you/selling')) || [];
            for (const t of sellingTabs) {
              try {
                // Skip closing the active (focused) tab to preserve user focus.
                if (t && t.id && activeTabId && t.id === activeTabId) continue;
                if (t && t.id) { safeTabsRemove(t.id).catch(()=>{}); }
              } catch (e) {}
            }
          } catch (e) {}
          // Always resolve null to force callers to create a new fresh tab
          resolve(null);
        });
      });
    } catch (e) { resolve(null); }
  });
}
// Quick diagnostic: register a simple onAlarm reporter so we can confirm alarms dispatch.
// When heartbeat is disabled we filter-out logging for that specific alarm to reduce noise.
// When true the background will NOT auto-run the active-listings check when a
// Selling tab loads. Keep false only if you want the old behavior (not recommended).
const FFM_AUTO_RUN_ON_TAB_LOAD = false;
try {
  try {
    chrome.alarms.onAlarm.addListener((a) => { try { if (!(FFM_DISABLE_HEARTBEAT && a && a.name === 'ffm_heartbeat')) console.debug('[bg:ALARM] 🔔 onAlarm triggered →', a); } catch (e) {} });
    console.debug('[bg:ALARM] onAlarm listener registered');
  } catch (e) { console.debug('[bg:ALARM] failed to register lightweight onAlarm listener', e); }
} catch (e) { /* ignore */ }
// Drop-in media blob responder: return ArrayBuffers for DB-backed media records
try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || message.action !== 'ffm_get_media_for_listing') return;
      (async () => {
        try {
          // Ensure MediaDB is available in the background
          if (!globalThis.ffmMediaDB || typeof globalThis.ffmMediaDB.getBlobsForListing !== 'function') {
            // Try to lazily load mediaDB.js in the background, if not already loaded
            try {
              if (typeof importScripts === 'function') {
                importScripts('mediaDB.js');
              }
            } catch (e) {
              console.error('[AutoList Pro bg] Patch13: importScripts(mediaDB.js) failed', e);
            }
          }

          if (!globalThis.ffmMediaDB || typeof globalThis.ffmMediaDB.getBlobsForListing !== 'function') {
            throw new Error('MediaDB not available or missing getBlobsForListing');
          }

          const listingId = message.listingId;
          const { images = [], videos = [] } = (await globalThis.ffmMediaDB.getBlobsForListing(listingId)) || {};

          console.log('[AutoList Pro bg] Patch13: getBlobsForListing ->', listingId, 'images:', images.length, 'videos:', videos.length);

          sendResponse({ ok: true, images, videos });
        } catch (e) {
          console.error('[AutoList Pro bg] Patch13: failed to fetch media blobs for listing', message && message.listingId, e);
          sendResponse({ ok: false, error: String(e) });
        }
      })();

      // Keep the message channel open for async sendResponse
      return true;
    } catch (e) { /* best-effort */ }
  });
} catch (e) { /* ignore */ }

// Short-circuit noisy ffm_pong heartbeats early to reduce message-port spam.
try {
  chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg && msg.type === 'ffm_pong') {
        // Ignore pongs at the background level; return true to keep senders satisfied.
        // No async response will be sent from background here — return false.
        return false;
      }
    } catch (e) {}
  });
} catch (e) {}

// Filter and mute a small set of noisy console errors caused by user-gesture API
// restrictions or message-channel timing issues. This prevents the extension
// from spamming DevTools with benign runtime.lastError messages.
try {
  const _bgConsoleError = console.error && console.error.bind(console);
  console.error = function(...args) {
    try {
      const text = args && args.length ? String(args[0] || '') : '';
      if (text && (text.indexOf('This function must be called during a user gesture') >= 0 || text.indexOf('A listener indicated an asynchronous response') >= 0 || text.indexOf('Unchecked runtime.lastError') >= 0)) {
        return; // swallow known non-actionable noise
      }
    } catch (e) {}
    try { _bgConsoleError && _bgConsoleError(...args); } catch (e) {}
  };
} catch (e) {}

// Helper: safe chrome.tabs.create wrapper that consumes runtime.lastError and
// returns a Promise resolving to the created tab or null on failure.
function safeTabsCreate(createOpts) {
  return new Promise((resolve) => {
    try {
      try { console.debug('[bg] safeTabsCreate called for', createOpts && createOpts.url); } catch (e) {}
      // If a target windowId was not supplied, ensure we create the tab in the
      // currently focused window and open it as active to avoid background/hidden windows.
      if (!createOpts || typeof createOpts !== 'object') createOpts = { url: String(createOpts || '') };
      const hasWindowId = typeof createOpts.windowId !== 'undefined' && createOpts.windowId !== null;

      const createInWindow = (opts) => {
        try {
          chrome.tabs.create(opts, (tab) => {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { console.debug('[bg] safeTabsCreate lastError ->', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                return resolve(null);
              }
              resolve(tab || null);
            } catch (e) { resolve(null); }
          });
        } catch (e) { resolve(null); }
      };

      if (hasWindowId) {
        // Caller requested a specific window — respect it
        createInWindow(createOpts);
      } else {
        try {
          chrome.windows.getLastFocused({}, (win) => {
            try {
              const opts = Object.assign({}, createOpts, { windowId: (win && win.id) ? win.id : undefined, active: (typeof createOpts.active !== 'undefined' ? createOpts.active : true) });
              createInWindow(opts);
            } catch (e) { resolve(null); }
          });
        } catch (e) {
          // Fallback to direct create
          createInWindow(Object.assign({}, createOpts, { active: (typeof createOpts.active !== 'undefined' ? createOpts.active : true) }));
        }
      }
    } catch (e) { resolve(null); }
  });
}

// Helper: safe chrome.windows.create wrapper that respects user-gesture requirements.
function safeWindowsCreate(createOpts) {
  return new Promise((resolve) => {
    try {
      if (!createOpts || typeof createOpts !== 'object') createOpts = { url: String(createOpts || '') };
      const opts = Object.assign({}, createOpts);
      // If no user gesture active, ensure the window is not focused/active to avoid gesture errors
      try {
        if (!canStealFocus()) {
          if (typeof opts.focused !== 'undefined') opts.focused = false;
          if (typeof opts.active !== 'undefined') opts.active = false;
        }
      } catch (e) {}

      try {
        chrome.windows.create(opts, (win) => {
          try {
            if (chrome.runtime && chrome.runtime.lastError) {
              try { console.debug('[bg] safeWindowsCreate lastError ->', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
              return resolve(null);
            }
            resolve(win || null);
          } catch (e) { resolve(null); }
        });
      } catch (e) { resolve(null); }
    } catch (e) { resolve(null); }
  });
}
 
// Authoritative SDnR finalizer: ensure scheduled DnR/SDnR state self-terminates
function ffmFinalizeSDNR(reason) {
  try {
    try { console.warn('[AutoList Pro] SDnR finalized:', reason); } catch (e) {}
    try { globalThis.ffmSDNRActive = false; } catch (e) {}
    try { globalThis.ffmSPActive = false; } catch (e) {}
    try { globalThis.__ffm_block_as = false; } catch (e) {}
    try { globalThis.ffmActiveDnRTaskId = null; } catch (e) {}
    try { globalThis.ffmActiveSDNRTaskId = null; } catch (e) {}
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ ffm_last_sdnr_cleanup: Date.now(), ffm_sdnr_cleanup_reason: reason }, () => {});
      }
    } catch (e) {}
  } catch (e) {}
}

// --- SDnR publish-start waiter utilities ---
const sdNrPublishWaiters = new Map();

function waitForPublishStart(taskId, timeoutMs = 15000) {
  return new Promise(resolve => {
    if (!taskId) return resolve(false);
    const timer = setTimeout(() => {
      sdNrPublishWaiters.delete(taskId);
      resolve(false);
    }, timeoutMs);

    sdNrPublishWaiters.set(taskId, {
      resolve: () => {
        clearTimeout(timer);
        sdNrPublishWaiters.delete(taskId);
        resolve(true);
      }
    });
  });
}

function ffmNotifyDnRPublishStarted({ taskId, listingId }) {
  try {
    if (!taskId) return;
    try { console.log('[SDNR] Publish STARTED', { taskId, listingId }); } catch (e) {}
    const waiter = sdNrPublishWaiters.get(taskId);
    if (waiter && waiter.resolve) {
      try { waiter.resolve(true); } catch (e) {}
      try { sdNrPublishWaiters.delete(taskId); } catch (e) {}
    }
  } catch (e) {}
}

async function ffmAfterDeleteAndBeforeFinalize(context) {
  try {
    const { taskId } = context || {};
    try { console.log('[SDNR] Delete complete — waiting for publish start', taskId); } catch (e) {}
    const started = await waitForPublishStart(taskId, 15000);
    if (!started) {
      try { console.warn('[SDNR] Publish did not start in time — retrying handoff', taskId); } catch (e) {}
      return false;
    }
    try { console.log('[SDNR] Publish start confirmed', taskId); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

function markDnRStalled(context) {
  try {
    const tid = context && context.taskId ? context.taskId : (`stalled_${Date.now()}`);
    try { console.error('[SDNR] Marking DnR stalled', tid); } catch (e) {}
    try { chrome && chrome.storage && chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ ['ffm_sdnr_stalled_' + String(tid)]: { context: context || null, ts: Date.now() } }); } catch (e) {}
  } catch (e) {}
}

// Watchdog: bail out stuck SDnR runs after 3 minutes (check every 60s)
try {
  setInterval(() => {
    try {
      if (globalThis.ffmSDNRActive) {
        const age = Date.now() - (globalThis.ffmSDNRStartedAt || 0);
        if (age > 3 * 60 * 1000) {
          try { ffmFinalizeSDNR('watchdog-timeout'); } catch (e) {}
        }
      }
    } catch (e) {}
  }, 60000);
} catch (e) {}

// =========================================
// Auto-DnR Scheduler — Storage Helpers
// =========================================

/**
 * Shape of a rule (for reference):
 * {
 *   enabled: true,
 *   daysActive: 5,
 *   preferredTime: "07:00",           // "HH:MM" 24h
 *   repeat: "forever" | "until-sold" | "until-deleted" | number,
 *   nextRun: null | timestamp,        // will be computed in step 2
 *   lastRun: null | timestamp,
 *   lastPublishedAt: null | timestamp,
 *   listingTitle: string | null       // for nicer display in UI
 * }
 */

// NOTE: Wire legacy scheduler helpers to the new ADS storage keys
// so both the old evaluation engine and the new Advanced Scheduler
// see the same rule + prefs data.
const FFM_SCHED_RULES_KEY   = "ffm_advanced_scheduler_rules";
const FFM_SCHED_MISSED_KEY  = "ffm_missed_auto_dnr_tasks";
const FFM_SCHED_PREFS_KEY   = "ffm_advanced_scheduler_prefs";
const FFM_SCHED_TEST_MODE   = "ffm_advanced_scheduler_test_mode";

// (debug wrapper for chrome.storage.local.set removed)

function ffmSchedulerLoadRules() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(
        [FFM_SCHED_RULES_KEY],
        (res) => {
          const rules = res && res[FFM_SCHED_RULES_KEY];
          resolve(rules && typeof rules === "object" ? rules : {});
        }
      );
    } catch (e) {
      console.warn("[FFM Scheduler] loadRules error", e);
      resolve({});
    }
  });
}

function ffmSchedulerSaveRulesLegacy(rules) {
  return new Promise((resolve) => {
    try {
      const safe = rules && typeof rules === "object" ? rules : {};

      // Merge preserved runtime/stats fields from existing rules to avoid wiping history
      try {
        chrome.storage.local.get([FFM_SCHED_RULES_KEY], (res) => {
          try {
            const existing = (res && res[FFM_SCHED_RULES_KEY]) ? res[FFM_SCHED_RULES_KEY] : {};
            const PRESERVE_KEYS = ['history','lastRun','lastPublishedAt','lastRunStatus','runCount','stats','lastSuccessAt','lastFailureAt'];
            try {
              for (const id of Object.keys(safe || {})) {
                try {
                  const incoming = safe[id] || {};
                  const prior = existing[id] || {};
                  // Deep-merge for legacy path as well: preserve prior fields when incoming
                  // values are null/undefined and merge nested objects/arrays.
                  function mergeRuleLegacy(priorObj, incomingObj) {
                    const out = Object.assign({}, priorObj || {});
                    try {
                      for (const key of Object.keys(incomingObj || {})) {
                        const val = incomingObj[key];
                        if (typeof val === 'undefined' || val === null) {
                          continue;
                        }
                        if (Array.isArray(val)) {
                          out[key] = val.slice();
                          continue;
                        }
                        if (typeof val === 'object') {
                          out[key] = mergeRuleLegacy(priorObj && priorObj[key] ? priorObj[key] : {}, val);
                          continue;
                        }
                        out[key] = val;
                      }
                    } catch (e) {}
                    return out;
                  }

                  const merged = mergeRuleLegacy(prior || {}, incoming || {});
                  safe[id] = merged;
                } catch (e) {}
              }
            } catch (e) {}

            chrome.storage.local.set({ [FFM_SCHED_RULES_KEY]: safe }, () => {
              try { chrome.runtime.sendMessage({ action: 'ffm-ads-rules-updated' }); } catch (e) {}
              resolve(true);
            });
          } catch (e) {
            // If merge failed for any reason, fall back to writing as-is
            try { chrome.storage.local.set({ [FFM_SCHED_RULES_KEY]: safe }, () => { try { chrome.runtime.sendMessage({ action: 'ffm-ads-rules-updated' }); } catch (e) {}; resolve(true); }); } catch (er) { resolve(false); }
          }
        });
      } catch (e) {
        // Storage get failed — write as-is
        try { chrome.storage.local.set({ [FFM_SCHED_RULES_KEY]: safe }, () => { try { chrome.runtime.sendMessage({ action: 'ffm-ads-rules-updated' }); } catch (e) {}; resolve(true); }); } catch (er) { resolve(false); }
      }
    } catch (e) {
      console.warn("[FFM Scheduler] saveRules error", e);
      resolve(false);
    }
  });
}

function ffmSchedulerLoadMissedTasks() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(
        [FFM_SCHED_MISSED_KEY],
        (res) => {
          const list = res && res[FFM_SCHED_MISSED_KEY];
          resolve(Array.isArray(list) ? list : []);
        }
      );
    } catch (e) {
      console.warn("[FFM Scheduler] loadMissedTasks error", e);
      resolve([]);
    }
  });
}

function ffmSchedulerSaveMissedTasks(tasks) {
  return new Promise((resolve) => {
    try {
      const safe = Array.isArray(tasks) ? tasks : [];
      chrome.storage.local.set(
        { [FFM_SCHED_MISSED_KEY]: safe },
        () => resolve(true)
      );
    } catch (e) {
      console.warn("[FFM Scheduler] saveMissedTasks error", e);
      resolve(false);
    }
  });
}

function ffmSchedulerLoadPrefs() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(
        [FFM_SCHED_PREFS_KEY, FFM_SCHED_TEST_MODE],
        (res) => {
          const p = res && res[FFM_SCHED_PREFS_KEY] ? res[FFM_SCHED_PREFS_KEY] : {};
          resolve({
            suppressMissedWarning: !!(p && p.suppressMissedWarning),
            testMode: typeof res[FFM_SCHED_TEST_MODE] !== 'undefined' ? !!res[FFM_SCHED_TEST_MODE] : false
          });
        }
      );
    } catch (e) {
      console.warn("[FFM Scheduler] loadPrefs error", e);
      resolve({ suppressMissedWarning: false, testMode: false });
    }
  });
}

function ffmSchedulerSavePrefsLegacy(prefs) {
  return new Promise((resolve) => {
    try {
      const safe = prefs && typeof prefs === "object" ? prefs : {};
      chrome.storage.local.set(
        {
          [FFM_SCHED_PREFS_KEY]: { suppressMissedWarning: !!safe.suppressMissedWarning },
          [FFM_SCHED_TEST_MODE]: !!safe.testMode
        },
        () => resolve(true)
      );
    } catch (e) {
      console.warn("[FFM Scheduler] savePrefs error", e);
      resolve(false);
    }
  });
}

// =========================================
// Auto-DnR Scheduler — Message API
// =========================================

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;

    // ========================
    // CANONICAL LISTINGS SYNC
    // ========================
    if (msg.action === "ffmActiveListingsUpdate") {
      ffmSchedGroupCollapsed('Updating canonical listings', msg.listings);

      // Reset and repopulate
      // Defensive: avoid noisy repeated updates — skip if identical
      try {
        const incomingMap = {};
        for (const listing of (msg.listings || [])) {
          if (listing && (listing.listingId || listing.id)) incomingMap[String(listing.listingId || listing.id)] = listing;
        }
        const prevSerialized = (globalThis.__ffmCanonicalListingsSerialized || '');
        const keys = Object.keys(incomingMap || {}).map(String);
        keys.sort();
        const nextSerialized = `${keys.length}::${keys.join(',')}`;
        if (prevSerialized === nextSerialized) {
          try { console.debug('[FFM Scheduler] ffmActiveListingsUpdate skipped — payload identical'); } catch (e) {}
        } else {
          ffmCanonicalListings = incomingMap;
          globalThis.__ffmCanonicalListingsSerialized = nextSerialized;
          ffmSchedGroupCollapsed('Canonical listings now', ffmCanonicalListings);
          try { chrome.storage.local.set({ ffmCanonicalListings }, () => {}); } catch (e) { console.warn('[FFM Scheduler] Failed to persist ffmCanonicalListings', e); }
          try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) { globalThis.__ffmTrace.counters.canonicalUpdates = (globalThis.__ffmTrace.counters.canonicalUpdates||0)+1; globalThis.__ffmTrace.counters.storageSets = (globalThis.__ffmTrace.counters.storageSets||0)+1; } } catch (e) {}
          try { ffmTraceEvent('canonical-updated', { count: keys.length }); } catch (e) {}
          // Rebuild per-listing ADS alarms after canonical listing update (first-run suppressed if already executed)
          try { (async () => { if (typeof ffmAdsRebuildAllAlarms === 'function') await ffmAdsRebuildAllAlarms("canonical-update"); })(); } catch (e) {}
        }
      } catch (e) {
        console.warn('[FFM Scheduler] ffmActiveListingsUpdate handler error', e);
      }
      return;
    }

    // Alternate sync channel from popup (direct background sync)
    if (msg.action === "ffm_ads_sync_listings") {
      try {
        ffmSchedGroupCollapsed('Background received listings', msg.listings);
        // Defensive: avoid noisy updates and rebuild storms — skip if identical
        const incomingMap = {};
        for (const listing of (msg.listings || [])) {
          const id = listing && (listing.listingId || listing.id);
          if (id) incomingMap[String(id)] = listing;
        }
        const keys = Object.keys(incomingMap || {}).map(String);
        keys.sort();
        const nextSerialized = `${keys.length}::${keys.join(',')}`;
        const prevSerialized = (globalThis.__ffmCanonicalListingsSerialized || '');
        if (prevSerialized === nextSerialized) {
          try { console.debug('[FFM Scheduler] ffm_ads_sync_listings skipped — payload identical'); } catch (e) {}
        } else {
          ffmCanonicalListings = incomingMap;
          globalThis.__ffmCanonicalListingsSerialized = nextSerialized;
          ffmSchedGroupCollapsed('Updated ffmCanonicalListings', ffmCanonicalListings);
          try { chrome.storage.local.set({ ffmCanonicalListings }, () => {}); } catch (e) { console.warn('[FFM Scheduler] Failed to persist ffmCanonicalListings', e); }
          try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) { globalThis.__ffmTrace.counters.canonicalUpdates = (globalThis.__ffmTrace.counters.canonicalUpdates||0)+1; globalThis.__ffmTrace.counters.storageSets = (globalThis.__ffmTrace.counters.storageSets||0)+1; } } catch (e) {}
          try { ffmTraceEvent('canonical-updated-sync', { count: keys.length }); } catch (e) {}
        }
      } catch (e) { console.warn('[FFM Scheduler] ffm_ads_sync_listings handler failed', e); }
      return;
    }

    // Special-case: allow external Run-Now action for ADS (not ffm_scheduler_*)
    if (msg.action === "ffm_ads_run_rule_now") {
      console.log("[FFM Scheduler] Run-Now request received →", msg);
      (async () => {
        try {
          // Reuse per-listing alarm handler for Run-Now so behavior matches scheduled runs
          await ffmAdsHandleAlarmForListing(msg.listingId, { name: ffmAdsAlarmNameFor(msg.listingId), scheduledTime: Date.now() });
          try { sendResponse({ ok: true }); } catch (e) {}
        } catch (err) {
          console.error("[FFM Scheduler] Run-Now error", err);
          try { sendResponse({ ok: false, error: String(err) }); } catch (e) {}
        }
      })();
      return true; // keep message channel open
    }

    // Manual evaluation trigger (external callers)
    if (msg.action === "ffm_ads_run_manual_eval") {
      try {
        console.log("[Scheduler] Manual evaluation triggered via message");
        try { ffmSchedulerRunManualEvaluation(); } catch (e) { console.warn('[Scheduler] ffmSchedulerRunManualEvaluation not available', e); }
        try { sendResponse({ ok: true }); } catch (e) {}
      } catch (e) {
        try { sendResponse({ ok: false, error: String(e) }); } catch (er) {}
      }
      return true;
    }

    // We only handle ffm_scheduler_* actions here
    if (!String(msg.action).startsWith("ffm_scheduler_")) return;

    (async () => {
      try {
        switch (msg.action) {
          case "ffm_scheduler_get_state": {
            const [rules, missed, prefs] = await Promise.all([
              ffmSchedulerLoadRules(),
              ffmSchedulerLoadMissedTasks(),
              ffmSchedulerLoadPrefs()
            ]);

            sendResponse({ ok: true, rules, missedTasks: missed, prefs });
            break;
          }

          case "ffm_scheduler_upsert_rule": {
            const listingId = msg.listingId;
            const rule = msg.rule;

            if (!listingId || !rule || typeof rule !== "object") {
              sendResponse({ ok: false, error: "invalid-args" });
              break;
            }

            const rules = await ffmSchedulerLoadRules();
            rules[listingId] = {
              enabled: true,
              daysActive: Number(rule.daysActive) || 1,
              preferredTime: String(rule.preferredTime || "07:00"),
              repeat: rule.repeat != null ? rule.repeat : "forever",
              nextRun: rule.nextRun || null,
              lastRun: rule.lastRun || null,
              lastPublishedAt: rule.lastPublishedAt || null,
              listingTitle: rule.listingTitle || null
            };

            await ffmSchedulerSaveRulesLegacy(rules);
                  try { ffmAdsRebuildAllAlarms && ffmAdsRebuildAllAlarms("rules-changed"); } catch (e) {}
            sendResponse({ ok: true, rules });
            break;
          }

          case "ffm_scheduler_delete_rule": {
            const listingId = msg.listingId;
            if (!listingId) {
              sendResponse({ ok: false, error: "invalid-args" });
              break;
            }
            const rules = await ffmSchedulerLoadRules();
            if (rules && rules[listingId]) {
              delete rules[listingId];
              await ffmSchedulerSaveRulesLegacy(rules);
            }
            sendResponse({ ok: true, rules });
            break;
          }

          case "ffm_scheduler_toggle_rule": {
            const listingId = msg.listingId;
            const enabled = !!msg.enabled;
            if (!listingId) {
              sendResponse({ ok: false, error: "invalid-args" });
              break;
            }
            const rules = await ffmSchedulerLoadRules();
            if (rules && rules[listingId]) {
              rules[listingId].enabled = enabled;
              await ffmSchedulerSaveRulesLegacy(rules);
            }
            sendResponse({ ok: true, rules });
            break;
          }

          case "ffm_scheduler_update_prefs": {
            const prefs = msg.prefs && typeof msg.prefs === "object" ? msg.prefs : {};
            const existing = await ffmSchedulerLoadPrefs();
            const merged = Object.assign({}, existing, prefs);
            await ffmSchedulerSavePrefsLegacy(merged);
            sendResponse({ ok: true, prefs: merged });
            break;
          }

          case "ffm_scheduler_clear_missed": {
            await ffmSchedulerSaveMissedTasks([]);
            sendResponse({ ok: true });
            break;
          }

          case "ffm_scheduler_check_missed": {
            const missed = await ffmSchedulerLoadMissedTasks();
            sendResponse({ ok: true, missed });
            break;
          }

          case "ffm_scheduler_run_missed": {
            (async () => {
              try {
                const missed = await ffmSchedulerLoadMissedTasks();
                for (const t of missed || []) {
                  try {
                    // t.ruleSnapshot expected shape
                    const ruleSnapshot = t.ruleSnapshot || t.rule || {};
                    await ffmSchedulerExecuteAutoDnR({ listingId: t.listingId, rule: ruleSnapshot });
                    await ffmSchedulerUpdateRuleAfterRun(t.listingId, ruleSnapshot, true);
                  } catch (e) { console.warn('[FFM Scheduler] run_missed item failed', e); }
                }
                await ffmSchedulerSaveMissedTasks([]);
                sendResponse({ ok: true });
              } catch (e) {
                console.warn('[FFM Scheduler] run_missed error', e);
                sendResponse({ ok: false, error: String(e) });
              }
            })();
            return true; // async
          }

          case "ffm_scheduler_skip_missed": {
            await ffmSchedulerSaveMissedTasks([]);
            sendResponse({ ok: true });
            break;
          }

          case "ffm_scheduler_run_one": {
            (async () => {
              try {
                const listingId = msg.listingId;
                if (!listingId) { sendResponse({ ok: false, error: 'missing-listingId' }); return; }
                const rules = await ffmSchedulerLoadRules();
                const rule = rules && rules[listingId] ? rules[listingId] : null;
                if (!rule) { sendResponse({ ok: false, error: 'no-rule' }); return; }
                const ok = await ffmSchedulerExecuteAutoDnR({ listingId, rule });
                await ffmSchedulerUpdateRuleAfterRun(listingId, rule, !!ok);
                sendResponse({ ok: true, success: !!ok });
              } catch (e) {
                console.warn('[FFM Scheduler] run_one error', e);
                sendResponse({ ok: false, error: String(e) });
              }
            })();
            return true;
          }

          case "ffm_notifications_get": {
            ffmNotifyLoadAll()
              .then(list => {
                const unread = list.filter(n => !n.read).length;
                sendResponse({ ok: true, notifications: list, unread });
              })
              .catch(e => sendResponse({ ok: false, error: String(e) }));
            return true;
          }

          case "ffm_notifications_mark_read": {
            ffmNotifyMarkRead(msg.ids || [])
              .then(list => {
                const unread = list.filter(n => !n.read).length;
                sendResponse({ ok: true, notifications: list, unread });
              })
              .catch(e => sendResponse({ ok: false, error: String(e) }));
            return true;
          }

          case "ffm_notifications_clear": {
            ffmNotifyClearAll()
              .then(() => sendResponse({ ok: true, notifications: [], unread: 0 }))
              .catch(e => sendResponse({ ok: false, error: String(e) }));
            return true;
          }

          default: {
            sendResponse({ ok: false, error: "unknown-action" });
            break;
          }
        }
      } catch (e) {
        console.warn("[FFM Scheduler] message handler error", e);
        try { sendResponse({ ok: false, error: String(e) }); } catch (_) {}
      }
    })();

    // Indicate async response
    return true;
  });

  console.log("[FFM Scheduler] Message API listener registered");

// Listen for debug enable/disable messages from popup
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.type !== 'ffm_debuglog_set_enabled') return false;
        try {
          ffmDbgSetEnabled(!!msg.enabled).then(() => { try { sendResponse && sendResponse({ ok: true }); } catch (e) {} }).catch((err) => { try { sendResponse && sendResponse({ ok: false, error: String(err) }); } catch (e) {} });
        } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        return true;
      } catch (e) { return false; }
    });
  }
} catch (e) {}
} catch (e) {
  console.warn("[FFM Scheduler] Failed to register message API", e);
}

// =========================================
// Auto-DnR Scheduler — Daily Alarm Setup
// =========================================

const FFM_SCHED_DAILY_ALARM = "ffm_auto_dnr_daily";

// Notifications
const FFM_NOTIFICATIONS_KEY = "ffm_notifications_v1";

// Simple unique id for notifications
function ffmNotifyGenerateId() {
  return "ntf_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// Load all notifications (array)
async function ffmNotifyLoadAll() {
  try {
    const res = await new Promise((r) => { try { chrome.storage.local.get(FFM_NOTIFICATIONS_KEY, r); } catch (e) { r({}); } });
    return Array.isArray(res[FFM_NOTIFICATIONS_KEY]) ? res[FFM_NOTIFICATIONS_KEY] : [];
  } catch (e) {
    return [];
  }
}

// Append a new notification
async function ffmNotifyAppend(notification) {
  try {
    const list = await ffmNotifyLoadAll();
    list.unshift(notification); // newest first
    const trimmed = list.slice(0, 200);
    await new Promise((r) => { try { chrome.storage.local.set({ [FFM_NOTIFICATIONS_KEY]: trimmed }, r); } catch (e) { r(); } });
    // Push notification to any open popup or listeners so UI updates immediately
    try {
      if (typeof chrome !== 'undefined' && chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        try { chrome.runtime.sendMessage({ action: 'ffm_notifications_pushed', notification: notification }); } catch (e) {}
      }
    } catch (e) {}
    return trimmed;
  } catch (e) {
    return [];
  }
}

async function ffmNotifyMarkRead(ids) {
  try {
    const set = new Set(ids || []);
    const list = await ffmNotifyLoadAll();
    let changed = false;
    for (const n of list) {
      if (set.has(n.id) && !n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) {
      await new Promise((r) => { try { chrome.storage.local.set({ [FFM_NOTIFICATIONS_KEY]: list }, r); } catch (e) { r(); } });
    }
    return list;
  } catch (e) {
    return [];
  }
}

async function ffmNotifyClearAll() {
  try {
    await new Promise((r) => { try { chrome.storage.local.remove(FFM_NOTIFICATIONS_KEY, r); } catch (e) { r(); } });
    return [];
  } catch (e) {
    return [];
  }
}

// Check for missed ADS runs when the extension (bg) starts
async function ffmAdsCheckForMissedRunsOnStartup() {
  try {
    const now = Date.now();
    const res = await new Promise((r) => { try { chrome.storage.local.get('ffm_advanced_scheduler_rules', r); } catch (e) { r({}); } });
    const rulesMap = res && res.ffm_advanced_scheduler_rules ? res.ffm_advanced_scheduler_rules : {};
    const rules = Object.values(rulesMap || {});
    if (!rules.length) return;

    const MISSED_GRACE_MS = 15 * 1000; // 15 second grace window

    for (const rule of rules) {
      if (!rule || rule.enabled === false) continue;

      const listingId = rule.listingId;
      const title = rule.listingTitle || rule.inventoryName || `Listing ${listingId || 'unknown'}`;

      const nextRunAt = Number(rule.nextRunAt || rule.nextRun || 0);
      const lastRun = Number(rule.lastRun || 0);

      if (!nextRunAt) continue;

      const scheduled = nextRunAt;
      const delivered = nextRunAt;
      const nowTs = now;

      // Alarm is missed ONLY if delivered >15s late AND lastRun indicates it didn't run
      const isMissedRun =
        delivered + MISSED_GRACE_MS < nowTs &&
        (lastRun < scheduled - MISSED_GRACE_MS);

      if (!isMissedRun) continue;

      const scheduledDate = new Date(nextRunAt).toLocaleString();
      const notif = {
        id: ffmNotifyGenerateId(),
        type: 'ads-missed-run',
        level: 'warning',
        createdAt: now,
        listingId,
        ruleId: rule.id,
        title: `Missed ADS run — ${title}`,
        message: `A scheduled Auto DnR was missed (scheduled for ${scheduledDate}). Chrome or the extension may have been inactive at that time.\n\nYou can use \"Run Now\" on this rule, or let ADS handle it on the next cycle.`,
        meta: { scheduledFor: nextRunAt },
        read: false
      };

      await ffmNotifyAppend(notif);

      //------------------------------------------------------
      // AUTO-RESCHEDULE MISSED RUN
      //------------------------------------------------------
      try {
        const intervalDays = Number(rule.daysActive || rule.repeatEvery || 1);
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const intervalMs = intervalDays * ONE_DAY_MS;

        const newNextRun = nextRunAt + intervalMs;

        console.warn(`[ADS] Rescheduling missed run for ${title} →`, new Date(newNextRun));

        // Update rule fields
        rule.lastRun = 0;          // keeps the history clean
        rule.nextRunAt = newNextRun;

        // Save rules back
        rulesMap[listingId] = rule;

        await chrome.storage.local.set({
          ffm_advanced_scheduler_rules: rulesMap
        });

        // Rebuild ONLY this rule’s alarm
        if (typeof ffmAdsEnsureAlarmForRule === "function") {
          await ffmAdsEnsureAlarmForRule(rule, "rescheduled-missed");
        } else {
          // fallback: full rebuild
          await ffmAdsRebuildAllAlarms("missed-run-reschedule");
        }

      } catch (err) {
        console.warn("[ADS] Failed auto-rescheduling missed rule", err);
      }
    }
  } catch (e) {
    console.warn('[FFM Scheduler] Error in ffmAdsCheckForMissedRunsOnStartup', e);
  }
}

// Auto-delete rule after 3 consecutive failures
async function ffmAdsEvaluateAutoDeleteForRule(rule) {
  try {
    if (!rule || !rule.history || !Array.isArray(rule.history)) return;

    const listingId = rule.listingId;
    const title = rule.listingTitle || rule.inventoryName || `Listing ${listingId || 'unknown'}`;

    const lastThree = rule.history.slice(0, 3).filter(Boolean);
    if (lastThree.length < 3) return;

    const allFailed = lastThree.every(h => (h && (h.status === 'failed' || h.success === false)));
    if (!allFailed) return;

    const res = await new Promise((r) => { try { chrome.storage.local.get('ffm_advanced_scheduler_rules', r); } catch (e) { r({}); } });
    const rulesMap = res && res.ffm_advanced_scheduler_rules ? res.ffm_advanced_scheduler_rules : {};
    if (!rulesMap || !rulesMap[listingId]) return;

    delete rulesMap[listingId];
    await new Promise((r) => { try { chrome.storage.local.set({ ffm_advanced_scheduler_rules: rulesMap }, r); } catch (e) { r(); } });

    if (typeof ffmAdsAlarmNameFor === 'function') {
      try { chrome.alarms.clear(ffmAdsAlarmNameFor(listingId)); } catch (e) { console.warn('[FFM Scheduler] Failed to clear alarm for auto-deleted rule', e); }
    }

    const now = Date.now();
    const notif = {
      id: ffmNotifyGenerateId(),
      type: 'ads-rule-auto-delete',
      level: 'info',
      createdAt: now,
      listingId,
      ruleId: rule.id,
      title: `ADS rule auto-deleted — ${title}`,
      message: "This ADS rule failed 3 consecutive Auto DnR attempts.\n\nThis usually means the listing was sold or removed. If you still need an Auto DnR schedule for this listing, please recreate the rule from the Advanced Scheduler.",
      meta: { failures: lastThree.map(h => ({ at: h.at || h.time || null, message: h.note || h.message || h.error || '' })) },
      read: false
    };

    await ffmNotifyAppend(notif);
  } catch (e) {
    console.warn('[FFM Scheduler] Error in ffmAdsEvaluateAutoDeleteForRule', e);
  }
}

/**
 * Ensures the daily Auto-DnR alarm exists (4:30am).
 */
async function ffmSchedulerEnsureDailyAlarm() {
  try {
    const existing = await new Promise(res => { try { chrome.alarms.get(FFM_SCHED_DAILY_ALARM, res); } catch(e){ res(null); } });
    if (existing) {
      try { console.log("[FFM Scheduler] Daily alarm already exists:", existing); } catch (e) {}
      return;
    }
    // Determine preferred daily time (try user prefs, fall back to 04:30)
    let preferred = '04:30';
    try {
      const p = await new Promise(r => { try { chrome.storage.local.get([FFM_SCHED_PREFS_KEY], r); } catch (e) { r({}); } });
      const prefsObj = p && p[FFM_SCHED_PREFS_KEY] ? p[FFM_SCHED_PREFS_KEY] : {};
      if (prefsObj && prefsObj.preferredTime) preferred = String(prefsObj.preferredTime);
    } catch (e) {
      // ignore, use default
    }

    // Parse preferred time and compute next occurrence. If the preferred time
    // is within the next 5 minutes (user saved it slightly late), schedule it
    // for ~10s from now so it runs today instead of being pushed to tomorrow.
    const now = new Date();
    const next = new Date();
    try {
      const [hour, minute] = (String(preferred || '04:30')).split(':').map(n => parseInt(n, 10));
      if (!isNaN(hour) && !isNaN(minute)) {
        next.setHours(hour, minute, 0, 0);
        const nowTs = Date.now();
        const nextTs = next.getTime();
        if (nextTs <= nowTs) {
          // If we're past today's time but within 5 minutes, run today (short delay)
          if ((nowTs - nextTs) < 5 * 60 * 1000) {
            next.setTime(nowTs + 10 * 1000); // run in ~10s
          } else {
            // Otherwise schedule for tomorrow
            next.setDate(next.getDate() + 1);
          }
        }
      } else {
        // fallback to default 04:30 logic
        next.setHours(4, 30, 0, 0);
        if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      }
    } catch (e) {
      next.setHours(4, 30, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    }

    try { chrome.alarms.create(FFM_SCHED_DAILY_ALARM, { when: next.getTime(), periodInMinutes: 24 * 60 }); } catch (e) { console.warn('[FFM Scheduler] alarm create failed', e); }

    try { console.log("[FFM Scheduler] Daily alarm created →", next.toString(), "preferred:", preferred); } catch (e) {}
  } catch (e) {
    try { console.warn("[FFM Scheduler] Error ensuring daily alarm", e); } catch (er) {}
  }
}

// initialize daily alarm on startup
try {
  // Ensure the daily 04:30 ADS evaluation alarm exists
  try { ffmSchedulerEnsureDailyAlarm(); } catch (e) {}

  // 1️⃣ Run missed-run boot check *before* we rebuild per-listing ADS alarms.
  //    This way we see the original nextRunAt values that may be in the past.
  try {
    if (typeof ffmAdsCheckForMissedRunsOnStartup === 'function') {
      ffmAdsCheckForMissedRunsOnStartup()
        .catch((e) => {
          try { console.warn('[FFM Scheduler] Missed-run boot check failed', e); } catch (_) {}
        });
    }
  } catch (e) {
    try { console.warn('[FFM Scheduler] Missed-run boot check threw', e); } catch (_) {}
  }

  // 2️⃣ Now rebuild per-listing ADS alarms using the (possibly updated)
  //     rule.nextRunAt values from the missed-run check.
  try {
    if (typeof ffmAdsRebuildAllAlarms === 'function') {
      // Ensure a safe invoker exists to call/queue the restore helper
      try {
        globalThis.__ffm_boot_restore_callbacks = globalThis.__ffm_boot_restore_callbacks || [];
        globalThis.ffmInvokeRestoreAfterReady = globalThis.ffmInvokeRestoreAfterReady || function() {
          try {
            if (typeof globalThis.ffmRestoreAdsAttentionAfterBoot === 'function') {
              try { console.log('[FFM Scheduler] invoking ffmRestoreAdsAttentionAfterBoot() after rebuild'); } catch (e) {}
              try { globalThis.ffmRestoreAdsAttentionAfterBoot(); } catch (e) { try { console.warn('[FFM Scheduler] ffmRestoreAdsAttentionAfterBoot failed', e); } catch (er) {} }
            } else {
              try { console.warn('[FFM Scheduler] ffmRestoreAdsAttentionAfterBoot not yet defined; queuing callback'); } catch (e) {}
              globalThis.__ffm_boot_restore_callbacks.push(() => { try { globalThis.ffmRestoreAdsAttentionAfterBoot && globalThis.ffmRestoreAdsAttentionAfterBoot(); } catch (e) { try { console.warn('[FFM Scheduler] queued ffmRestoreAdsAttentionAfterBoot failed', e); } catch (er) {} } });
            }
          } catch (e) {}
        };
      } catch (e) {}

      ffmAdsRebuildAllAlarms("startup")
        .then(() => { try { globalThis.ffmInvokeRestoreAfterReady && globalThis.ffmInvokeRestoreAfterReady(); } catch (e) {} })
        .catch((e) => { try { console.warn('[FFM Scheduler] Failed rebuilding ADS alarms on startup', e); } catch (_) {} });
    }
  } catch (e) {
    try { console.warn('[FFM Scheduler] ADS rebuild on startup threw', e); } catch (_) {}
  }
  // Detect any missed scheduled tasks on boot (mark as missed; do NOT run)
  try { ffmDetectMissedScheduledTasks("boot").catch(() => {}); } catch (e) {}
} catch (e) {
  console.warn("[FFM Scheduler] Error ensuring daily alarm", e);
}

// =========================================
// Auto-DnR Scheduler — Alarm Listener
// =========================================

try {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
      if (!alarm || !alarm.name) return;

      // ------------------- STALE ALARM SUPPRESSION -------------------
      try {
        const { name, scheduledTime } = alarm;

        try { console.warn('[ADS] Fired alarm:', name, 'scheduled:', new Date(scheduledTime).toLocaleString()); } catch (e) {}
        try { ffmTraceEvent('alarm-fired', { name: name, scheduledTime: scheduledTime }); } catch (e) {}

        // Skip if not ADS alarm
        if (!name || !name.startsWith(FFM_ADS_ALARM_PREFIX)) {
          // not an ADS alarm → ignore suppression
        } else {
          const listingId = name.replace(FFM_ADS_ALARM_PREFIX, '');
          const now = Date.now();
          const MISSED_GRACE = 5 * 60 * 1000;

          // If Chrome is firing the alarm LATE → this is a MISSED RUN
          if (scheduledTime + MISSED_GRACE < now) {
            try { console.warn('[ADS] Missed alarm detected →', name); } catch (e) {}

            // Attempt to load the rule and mark the missed run + reschedule
            try {
              const snap = await new Promise((r) => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], r); } catch (e) { r({}); } });
              const rulesMap = snap && snap[FFM_ADS_RULES_KEY] ? snap[FFM_ADS_RULES_KEY] : {};
              const rule = rulesMap[listingId];

              if (rule) {
                try {
                  await ffmAdsMarkMissedRun(rule, `Alarm fired late (scheduled ${new Date(scheduledTime).toLocaleString()})`);
                } catch (e) {
                  try { console.warn('[ADS] ffmAdsMarkMissedRun failed for', listingId, e); } catch (er) {}
                }
              } else {
                try { console.warn('[ADS] Missed alarm for unknown rule', listingId); } catch (e) {}
              }
            } catch (e) {
              try { console.warn('[ADS] Error while handling missed alarm for', listingId, e); } catch (er) {}
            }

            // IMPORTANT: Stop here — do NOT execute DnR for missed alarms
            return;
          }
        }
      } catch (e) {
        try { console.warn('[ADS] Stale alarm check error', e); } catch (er) {}
      }

      // Per-listing ADS alarm handling
      try {
        const adsListingId = ffmAdsListingIdFromAlarmName(alarm.name);
        if (adsListingId) {
          try { ffmAdsEnqueue(adsListingId, alarm); } catch (e) { console.error('[FFM Scheduler] Error enqueuing ADS alarm for', adsListingId, e); }
          return;
        }
      } catch (e) {}

      if (alarm.name !== FFM_SCHED_DAILY_ALARM) return;

      try { console.log("[FFM Scheduler] Daily alarm fired:", new Date().toString()); } catch (e) {}

      // 🔄 Always reload prefs (popup may have changed testMode)
      try {
        const _p = await new Promise((r) => { try { chrome.storage.local.get("ffm_advanced_scheduler_prefs", r); } catch (e) { r({}); } });
        const ffm_advanced_scheduler_prefs = _p && _p.ffm_advanced_scheduler_prefs ? _p.ffm_advanced_scheduler_prefs : null;
        if (ffm_advanced_scheduler_prefs) {
          try { ffmSchedulerPrefs = ffm_advanced_scheduler_prefs; console.log("[Scheduler] Reloaded prefs:", ffmSchedulerPrefs); } catch (e) {}
        }
      } catch (e) { console.warn('[Scheduler] Failed to reload prefs on alarm', e); }

      // Run evaluation engine and collect runnable tasks
      try {
        const runnable = await ffmSchedulerEvaluateAllRules();
        if (Array.isArray(runnable) && runnable.length) {
          try { console.log('[FFM Scheduler] Executing runnable tasks count:', runnable.length); } catch (e) {}
          for (const t of runnable) {
            try {
              const ok = await ffmSchedulerExecuteAutoDnR(t);
              try { await ffmSchedulerUpdateRuleAfterRun(t.listingId, t.rule, !!ok); } catch (e) {}
              try { incrementDnrStat(ok ? 'success' : 'fail'); } catch (e) {}
            } catch (e) { try { console.warn('[FFM Scheduler] execute task error', e); } catch(_){} }
          }
        } else {
          try { console.log('[FFM Scheduler] No runnable tasks at this time'); } catch (e) {}
        }
      } catch (e) { try { console.warn('[FFM Scheduler] evaluate/execute error', e); } catch(_){} }

    } catch (e) {
      try { console.warn("[FFM Scheduler] alarm error", e); } catch (er) {}
    }
  });
} catch (e) {
  console.warn('[FFM Scheduler] failed to register daily alarm listener', e);
}

// =========================================
// Auto-DnR Scheduler — Evaluation Engine
// =========================================

async function ffmSchedulerEvaluateAllRules() {
  try {
    const rules = await ffmSchedulerLoadRules();
    if (!rules || Object.keys(rules).length === 0) {
      try { console.log("[FFM Scheduler] No rules to evaluate."); } catch (e) {}
      return [];
    }

    const missedTasks = await ffmSchedulerLoadMissedTasks();
    const now = Date.now();
    const runnableTasks = [];

    try { console.log("[FFM Scheduler] Evaluating rules… count:", Object.keys(rules).length); } catch (e) {}

    // Helper: set nextRun only if no newer nextRun is already present
    function safeSetNextRun(ruleObj, ts) {
      try {
        const existing = Number(ruleObj.nextRun || 0);
        const last = Number(ruleObj.lastRun || 0);
        if (existing && existing > Date.now() + 1000 && existing > last) {
          // preserve newer scheduled nextRun (likely set after a run)
          return;
        }
      } catch (e) {}
      ruleObj.nextRun = ts;
    }

    for (const listingId of Object.keys(rules)) {
      try {
        const rule = rules[listingId];
        if (!rule || !rule.enabled) continue;

        const lastPub = Number(rule.lastPublishedAt || 0);
        if (!lastPub) {
          try { console.log(`[FFM Scheduler] Missing lastPublishedAt for ${listingId}, skipping.`); } catch (e) {}
          continue;
        }

        // Determine days active
        const daysActive = Math.floor((now - lastPub) / 86400000);

        // Check daysActive threshold
        if (daysActive < rule.daysActive) {
          // Not ready yet
          continue;
        }

        // Compute today's preferred run time
        const preferredTs = ffmSchedulerComputePreferredTime(rule.preferredTime);

        if (preferredTs === null) {
          try { console.warn("[FFM Scheduler] Invalid preferredTime for rule", listingId); } catch (e) {}
          continue;
        }

        const alreadyPastPreferred = now >= preferredTs;

        // case 1: Chrome was closed past the run time  → missed task
        if (alreadyPastPreferred && ffmSchedulerMissed(rule)) {
          missedTasks.push({
            listingId,
            expectedTime: preferredTs,
            ruleSnapshot: { ...rule },
            reason: "chrome_closed",
            recordedAt: now
          });
          try { console.log("[FFM Scheduler] Missed task added:", listingId); } catch (e) {}

          // Compute next run (tomorrow)
          safeSetNextRun(rule, ffmSchedulerComputeNextRun(rule.preferredTime, 1));

          // No execution yet — missed tasks are shown to user on popup open
          continue;
        }

        // case 2: It's not time yet → skip until preferred time today
        if (!alreadyPastPreferred) {
          // Set nextRun = today @ preferredTime
          safeSetNextRun(rule, preferredTs);
          continue;
        }

        // case 3: It's time to run today and was NOT missed → schedule for execution
        if (alreadyPastPreferred && daysActive >= rule.daysActive) {
          runnableTasks.push({ listingId, rule: { ...rule } });
          safeSetNextRun(rule, now); // flagged as ready
        }
      } catch (e) { try { console.warn('[FFM Scheduler] rule eval error', e); } catch(_){} }
    }

    await ffmSchedulerSaveRulesLegacy(rules);

    // Ensure alarms reflect the updated rule and nudge the UI to refresh
    try {
      if (typeof ffmAdsEnsureAlarmForRule === 'function') {
        try { await ffmAdsEnsureAlarmForRule(stored, 'post-publish'); } catch (e) { /* non-fatal */ }
      } else if (typeof ffmAdsRebuildAllAlarms === 'function') {
        try { await ffmAdsRebuildAllAlarms('post-publish-update'); } catch (e) { /* non-fatal */ }
      }
    } catch (e) {}

    try { chrome && chrome.storage && chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ ffm_scheduler_refresh_req: Date.now() }); } catch (e) {}
    await ffmSchedulerSaveMissedTasks(missedTasks);

    try { console.log("[FFM Scheduler] Evaluation complete. Missed events:", missedTasks.length, 'Runnable:', runnableTasks.length); } catch (e) {}

    // -------------------------------------
    // SAVE MISSED EVENTS FOR POPUP RECOVERY
    // -------------------------------------
    if (missedTasks && missedTasks.length > 0) {
      try {
        await chrome.storage.local.set({
          ffm_advanced_scheduler_missed: missedTasks
        });
        console.debug("[FFM Scheduler] Saved missed events →", missedTasks);
      } catch (e) {
        console.warn("[FFM Scheduler] Failed to persist missed events", e);
      }
    } else {
      // Clear if no missed tasks remain
      try {
        await chrome.storage.local.remove("ffm_advanced_scheduler_missed");
      } catch (e) {}
    }

    // Return runnable tasks for the execution engine
    return runnableTasks;
  } catch (e) {
    try { console.warn('[FFM Scheduler] evaluateAllRules failure', e); } catch(_){}
  }
}

// Convert "HH:MM" → timestamp for today
function ffmSchedulerComputePreferredTime(hhmm) {
  try {
    const [hh, mm] = hhmm.split(":").map(n => Number(n));
    if (isNaN(hh) || isNaN(mm)) return null;

    const now = new Date();
    const t = new Date();
    t.setHours(hh, mm, 0, 0);
    return t.getTime();
  } catch (e) {
    return null;
  }
}

// Compute next run X days ahead at same time
function ffmSchedulerComputeNextRun(hhmm, addDays = 1) {
  try {
    const [hh, mm] = hhmm.split(":").map(n => Number(n));
    const t = new Date();
    t.setDate(t.getDate() + addDays);
    t.setHours(hh, mm, 0, 0);
    return t.getTime();
  } catch (e) {
    return null;
  }
}

// Detect if Chrome was closed (preferredTime passed with no run)
function ffmSchedulerMissed(rule) {
  try {
    if (!rule.nextRun) return true;
    return Date.now() > rule.nextRun + 60_000; // consider missed after 1 minute
  } catch (e) { return true; }
}

// Lightweight DnR telemetry incrementer
function incrementDnrStat(field) {
  try {
    chrome.storage.local.get(['ffm_stats_dnrs'], (r) => {
      try {
        const stats = (r && r.ffm_stats_dnrs) ? r.ffm_stats_dnrs : { success: 0, fail: 0 };
        stats[field] = (stats[field] || 0) + 1;
        try { chrome.storage.local.set({ ffm_stats_dnrs: stats }); } catch (e) {}
      } catch (e) {}
    });
  } catch (e) {}
}

// Execute one Auto-DnR task by leveraging the existing SDnR/SendDelete flow.
async function ffmSchedulerExecuteAutoDnR(task) {
  try {
    const { listingId, rule } = task || {};

    // Optional runRecord passed from scheduler for enriched telemetry
    const runRecord = (task && task.runRecord) ? task.runRecord : null;

    console.log("[Scheduler] Execute Auto-DnR →", listingId, rule);

    // v1: Scheduler runs real Auto-DnR always.
    // Test mode is disabled here so alarms actually perform DnR.
    const isTest = false;

    if (isTest) {
      try { console.log('[Auto-DnR TEST MODE] Would run DnR for:', listingId, rule); } catch (e) {}
      return true;
    }

    // Resolve a friendly delete title: prefer rule.listingTitle then saved listings
    let deleteTitle = (rule && rule.listingTitle) ? rule.listingTitle : null;

    if (!deleteTitle && listingId) {
      try {
        const snap = await new Promise(res => { try { chrome.storage.local.get(['listings'], res); } catch (e) { res({}); } });
        const listings = (snap && Array.isArray(snap.listings)) ? snap.listings : [];
        const found = listings.find(l => l && (String(l.listingId) === String(listingId) || String(l.id) === String(listingId)));
        if (found) deleteTitle = found.title || found.listingTitle || found.inventoryName || deleteTitle;
      } catch (e) { /* best-effort */ }
    }

    if (!deleteTitle) deleteTitle = (rule && rule.inventoryName) ? rule.inventoryName : ('listing-' + String(listingId));

    // 🔥 ALWAYS open a fresh Selling tab for SDnR – do not reuse existing ones
    let tabId = null;
    const encoded = encodeURIComponent(
      (rule && rule.listingTitle) ? rule.listingTitle : (deleteTitle || '')
    );
    const url = `https://www.facebook.com/marketplace/you/selling?title_search=${encoded}`;

    try {
      // Open as an active (visible) tab so FB applies title_search correctly
      const created = await safeTabsCreate({ url, active: true });
      tabId = created && created.id ? created.id : null;
    } catch (e) {
      console.warn('[Auto-DnR] Failed to create Selling tab', e);
    }

    if (!tabId) {
      console.warn('[Auto-DnR] No Selling tab available for automated DnR');
      try { await ffmAdsMarkMissedRun(rule, 'Chrome blocked tab creation — likely closed or prevented from opening windows.'); } catch (e) { /* ignore */ }
      return false;
    }

    // Wait for content readiness, then trigger delete message to content script
    try { await ffmWaitForContentReady(tabId, 15000); } catch (e) {}

    const opts = { scheduled: true, listingId: listingId || null, helperTabId: tabId };
    try {
      // Tag delete start for enriched runRecord if present
      try { if (runRecord) { runRecord.deleteStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); runRecord.stage = 'delete'; } } catch (e) {}

      // ✅ REQUIRED: register SDnR execution context for ADS so delete-complete
      // can be associated back to this scheduled run without relying on
      // ephemeral globals set elsewhere.
      try {
        globalThis.__ffm_active_sdnr_run = {
          taskId: (task && task.id) ? task.id : null,
          listingId: listingId || null,
          inventoryName: (rule && rule.inventoryName) ? rule.inventoryName : null,
          listingTitle: (rule && rule.listingTitle) ? rule.listingTitle : (deleteTitle || null),
          scheduled: true,
          source: 'ADS',
          startedAt: Date.now()
        };
        try { console.log('[SDNR] Active run registered from ADS', globalThis.__ffm_active_sdnr_run); } catch (e) {}
      } catch (e) {}

      const res = await sendDeleteMessage(tabId, String(deleteTitle || ''), opts);
      const ok = !!(res && res.ok);
      try { console.log('[Auto-DnR] Delete message result for', listingId, ok); } catch (e) {}

      // Tag delete end / duration
      try { if (runRecord) { runRecord.deleteEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); runRecord.deleteDurationMs = runRecord.deleteEnd - runRecord.deleteStart; } } catch (e) {}

      if (!ok) {
        try { if (runRecord) { runRecord.errorStage = 'delete'; runRecord.errorMessage = 'Delete process never completed — Chrome may have closed.'; runRecord.stage = 'error'; runRecord.success = false; } } catch (e) {}
        try { await ffmAdsMarkMissedRun(rule, 'Delete process never completed — Chrome may have closed.'); } catch (e) {}
        return false;
      }

      // Successful delete — leave publish staging to SDNR flow. Mark success here for delete.
      try { if (runRecord) { runRecord.stage = 'delete-complete'; } } catch (e) {}

      return ok;
    } catch (e) {
      console.warn('[Auto-DnR] Execution error', e);
      try { if (runRecord) { runRecord.errorStage = 'delete'; runRecord.errorMessage = String(e || 'execution error'); runRecord.stage = 'error'; runRecord.success = false; } } catch (er) {}
      return false;
    }
  } catch (e) {
    console.warn('[Auto-DnR] Outer execution error', e);
    return false;
  }
}

// Update rule metadata after a run (lastRun, decrement repeat, compute nextRun)
async function ffmSchedulerUpdateRuleAfterRun(listingId, rule, success) {
  try {
    const rules = await ffmSchedulerLoadRules();
    if (!rules || !rules[listingId]) return;

    const now = Date.now();
    const stored = rules[listingId];

    stored.lastRun = now;
    if (typeof stored.repeat === 'number') {
      stored.repeat = stored.repeat - 1;
      if (stored.repeat <= 0) {
        stored.enabled = false;
        console.log('[Auto-DnR] Rule disabled (repeat completed).', listingId);
      }
    }

    // Compute next run relative to the actual last run (preferred behavior)
    try {
      const preferred = (stored.preferredTime || '07:00');
      const parts = (''+preferred).split(':').map(n=>Number(n));
      const hh = (parts && parts.length>0 && !isNaN(parts[0])) ? parts[0] : 7;
      const mm = (parts && parts.length>1 && !isNaN(parts[1])) ? parts[1] : 0;
      const days = (Number(stored.daysActive) || 1);
      const base = stored.lastRun ? new Date(Number(stored.lastRun)) : new Date();
      const nextDt = new Date(base.getTime());
      nextDt.setDate(nextDt.getDate() + days);
      nextDt.setHours(hh, mm, 0, 0);
      const nextTs = nextDt.getTime();
      stored.nextRun = nextTs;
      // Persist numeric timestamp for machine use and a human string for debug/UI
      stored.nextRunAt = nextTs;
      stored.nextRunStr = nextDt.toString();
    } catch (e) { stored.nextRun = null; }

    await ffmSchedulerSaveRulesLegacy(rules);
  } catch (e) {
    console.warn('[Auto-DnR] updateRuleAfterRun error', e);
  }
}

// Wait for publish-inflight persistent flag to appear (publishListingById writes it)
function waitForPublishInflight(publishRequestId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    try {
      const inflKey = 'ffm_publish_inflight_' + publishRequestId;
      const start = Date.now();
      const tick = () => {
        try {
          chrome.storage.local.get([inflKey], (r) => {
            try {
              if (r && r[inflKey]) return resolve(true);
              if (Date.now() - start >= timeoutMs) return resolve(false);
              setTimeout(tick, 200);
            } catch (e) { return resolve(false); }
          });
        } catch (e) { return resolve(false); }
      };
      tick();
    } catch (e) { resolve(false); }
  });
}


// ----------------------------
//  NEW: Hourly timing firewall
// ----------------------------
async function ffmShouldRunHourlySync() {
  const THRESHOLD_MINUTES = 55; // require at least 55 min

  const now = Date.now();
  let lastCandidates = { fast4mp: 0, ffmLast: 0, ffm_last: 0, local: 0 };
  try {
    // Prefer chrome.storage.local values (async)
    if (chrome && chrome.storage && chrome.storage.local) {
      const r = await new Promise(res => { try { chrome.storage.local.get(['fast4mp_lastActiveCheck','ffmLastActiveCheck','ffm_lastActiveCheck'], res); } catch(e){ res({}); } });
      lastCandidates.fast4mp = Number(r && r.fast4mp_lastActiveCheck ? r.fast4mp_lastActiveCheck : 0) || 0;
      lastCandidates.ffmLast = Number(r && r.ffmLastActiveCheck ? r.ffmLastActiveCheck : 0) || 0;
      lastCandidates.ffm_last = Number(r && r.ffm_lastActiveCheck ? r.ffm_lastActiveCheck : 0) || 0;
    }

    // Also check localStorage for legacy key (best-effort, sync)
    if (typeof localStorage !== 'undefined' && localStorage && localStorage.ffm_lastActiveCheck) {
      lastCandidates.local = Number(localStorage.ffm_lastActiveCheck || 0) || 0;
    }
  } catch (e) {
    try { console.warn('[AutoList Pro bg] ffmShouldRunHourlySync storage read error', e); } catch(_){}
  }

  // Pick the newest timestamp among candidates
  const last = Math.max(lastCandidates.fast4mp || 0, lastCandidates.ffmLast || 0, lastCandidates.ffm_last || 0, lastCandidates.local || 0);

  if (!last) {
    try { console.warn('[AutoList Pro bg] No lastActiveCheck found (all keys empty) → allow sync'); } catch (e) {}
    return true;
  }

  const diffMinutes = (now - last) / 1000 / 60;

  try {
    console.log('[AutoList Pro bg] HourlySync check — minutes since newest lastActiveCheck:', diffMinutes.toFixed(1), 'candidates:', lastCandidates);
  } catch(e){}

  return diffMinutes >= THRESHOLD_MINUTES;
}


// Helper: safe chrome.tabs.sendMessage wrapper with timeout and unified response shape.
// Resolves with an object: { ok: true/false, response?, error?, timeout?, exception? }
function ffmSafeSendMessage(tabId, msg, opts = {}) {
  const timeoutMs = (opts && typeof opts.timeoutMs === 'number') ? opts.timeoutMs : 800;
  return new Promise((resolve) => {
    try {
      let done = false;
      const tid = setTimeout(() => {
        try {
          if (done) return;
          done = true;
          resolve({ ok: false, timeout: true, error: 'timeout' });
        } catch (e) { resolve({ ok: false, timeout: true, exception: String(e) }); }
      }, timeoutMs);

      try {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
          try {
            if (done) return;
            done = true;
            clearTimeout(tid);
            if (chrome.runtime && chrome.runtime.lastError) {
              return resolve({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
            }
            resolve({ ok: true, response: resp });
          } catch (e) { try { clearTimeout(tid); } catch(_){} resolve({ ok: false, exception: String(e) }); }
        });
      } catch (e) { try { clearTimeout(tid); } catch(_){} if (!done) { done = true; resolve({ ok: false, exception: String(e) }); } }
    } catch (e) { resolve({ ok: false, exception: String(e) }); }
  });
}

// ===============================================================
// Robust send helper for content readiness
// Retries `chrome.tabs.sendMessage` until the content script accepts the message
function sendMessageWhenReady(tabId, message, opts = {}) {
  const {
    retries = 10,
    delayMs = 500,
    label = 'sendMessageWhenReady'
  } = opts;

  let attempt = 0;

  function trySend() {
    attempt++;
    try {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        const err = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError : null;
        if (!err) {
          try { console.log(`[SDNR] Message delivered on attempt ${attempt}`, message && message.action, label); } catch (e) {}
          return;
        }

        if (attempt >= retries) {
          try { console.error(`[SDNR] Failed after ${attempt} attempts`, String(err), label); } catch (e) {}
          return;
        }

        try { console.warn(`[SDNR] Retry ${attempt}/${retries} – content not ready yet`, label); } catch (e) {}
        setTimeout(trySend, delayMs);
      });
    } catch (e) {
      if (attempt >= retries) {
        try { console.error(`[SDNR] Exception sending after ${attempt} attempts`, String(e), label); } catch (e) {}
        return;
      }
      try { console.warn(`[SDNR] Exception on send attempt ${attempt}, retrying`, String(e), label); } catch (e) {}
      setTimeout(trySend, delayMs);
    }
  }

  trySend();
}

// ===============================================================
// FAST4MP SMART MEDIA LOADER (FIX FOR VIDEO PUBLISHING)
// ===============================================================

// --- Load an image blob from S3 (unchanged behavior) ---
async function ffmLoadImageBlobFromS3(s3Key) {
  // Cloud sync removed — AutoList Pro is local-only now.
  return null;
}

// --- NEW: Return a PASSTHROUGH video object (no Blob load) ---
function ffmLoadVideoPassthrough(s3Key) {
  try {
    const filename = (s3Key || '').split('/').pop();
    return {
      _fast4mp_passthrough: true,
      url: `https://fast4mp-media-us-west-1-a15.s3.us-west-1.amazonaws.com/${s3Key}`,
      name: filename || ('video_' + Date.now()),
      type: 'video/mp4'
    };
  } catch (e) { return null; }
}

// Helper: load transient media for populate-fb (images Files + passthrough video)
async function ffmLoadTransientMedia(listing) {
  const files = [];
  if (!listing) return files;

  const listingKey =
    (listing && (listing.listingId || listing.id)) ? (listing.listingId || listing.id) : (listing && (listing.inventoryName || listing.title) ? (listing.inventoryName || listing.title) : 'unknown');

  // -------------------------------
  // 1) IMAGES: Prefer local Media DB
  // -------------------------------
  let usedDBImages = false;

  try {
    const hasDB = await ffmMediaDB.hasMediaForListing(listingKey);
    if (hasDB) {
      const media = await ffmMediaDB.getBlobsForListing(listingKey);
      const images = media && Array.isArray(media.images) ? media.images : [];

      for (const rec of images) {
        try {
          if (!rec || !rec.blob) continue;
          const name =
            rec.name ||
            (rec.key ? rec.key.split('/').pop() : `image_${rec.index || 0}.jpg`);
          const mime =
            rec.mimeType ||
            rec.blob.type ||
            'image/jpeg';

          const file = new File([rec.blob], name, { type: mime });
          files.push(file);
        } catch (e) {
          console.warn('[bg] ffmLoadTransientMedia: failed to convert DB image to File', {
            listingKey,
            rec,
            error: e,
          });
        }
      }

      if (files.length > 0) {
        usedDBImages = true;
        try {
          console.debug(
            '[bg] ffmLoadTransientMedia: used Media DB images',
            { listingKey, count: files.length }
          );
        } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('[bg] ffmLoadTransientMedia: Media DB image load failed, will try S3', {
      listingKey,
      error: e,
    });
  }

  // NOTE: S3-based transient fallback disabled — we now expect media to be in the
  // local Media DB (`ffmMediaDB`). Keeping the old S3 logic commented out so it
  // can be re-enabled if needed in future. This avoids relying on transient S3
  // fetches during publish.

  /*
  if (!usedDBImages && Array.isArray(listing.s3ImageKeys) && listing.s3ImageKeys.length) {
    try {
      const maxImages = 10; // keep it sane
      for (let i = 0; i < listing.s3ImageKeys.length && i < maxImages; i++) {
        const key = listing.s3ImageKeys[i];
        if (!key) continue;
        const imgFile = await ffmLoadImageBlobFromS3(key);
        if (imgFile) files.push(imgFile);
      }
    } catch (e) {
      console.warn('[bg] ffmLoadTransientMedia: S3 image load failed', { inventoryName, error: e });
    }
  }

  // Video passthrough via S3 (disabled)
  try {
    if (listing.s3VideoKey) {
      const vid = ffmLoadVideoPassthrough(listing.s3VideoKey);
      if (vid) files.push(vid);
    }
  } catch (e) {
    console.warn('[bg] ffmLoadTransientMedia: video passthrough error', { inventoryName, error: e });
  }
  */

  return files;
}

// ===============================================================
// END SMART MEDIA LOADER
// ===============================================================

// ---------------------------------------------------------------------------
// Correct binary-safe reconstruction based on MediaDB blob records
// ---------------------------------------------------------------------------
// This guarantees:
//   - No more 0-byte file issues
//   - Correct mime types
//   - Correct sizes
//   - Fully compatible Files for FB uploads
//
async function ffmReconstructMediaFilesFromDB(listingName) {
  try {
    if (!listingName) {
      console.warn("[bg] ffmReconstructMediaFilesFromDB: no listingName");
      return { imageFiles: [], videoFiles: [] };
    }

    const media = await ffmMediaDB.getBlobsForListing(listingName);
    if (!media) {
      console.warn("[bg] ffmReconstructMediaFilesFromDB: no media for", listingName);
      return { imageFiles: [], videoFiles: [] };
    }

    const images = Array.isArray(media.images) ? media.images : [];
    const videos = Array.isArray(media.videos) ? media.videos : [];

    const imageFiles = [];
    const videoFiles = [];

    // ----- IMAGES -----
    for (let i = 0; i < images.length; i++) {
      try {
        const rec = images[i];
        if (!rec || !rec.blob) continue;

        // Ensure proper ArrayBuffer extraction
        const ab = await rec.blob.arrayBuffer();
        const uint = new Uint8Array(ab);

        const filename =
          rec.name ||
          rec.blob?.name ||
          `image_${i}.jpg`;

        const mime =
          rec.mimeType ||
          rec.blob?.type ||
          "image/jpeg";

        const realFile = new File([uint], filename, { type: mime });

        if (realFile.size === 0) {
          console.warn("[bg] EMPTY IMAGE FILE AFTER REBUILD:", filename, rec);
        }

        imageFiles.push(realFile);
      } catch (e) {
        console.warn("[bg] reconstruct image failed", i, e);
      }
    }

    // ----- VIDEOS -----
    for (let i = 0; i < videos.length; i++) {
      try {
        const rec = videos[i];
        if (!rec || !rec.blob) continue;

        const ab = await rec.blob.arrayBuffer();
        const uint = new Uint8Array(ab);

        const filename =
          rec.name ||
          rec.blob?.name ||
          `video_${i}.mp4`;

        const mime =
          rec.mimeType ||
          rec.blob?.type ||
          "video/mp4";

        const realFile = new File([uint], filename, { type: mime });

        if (realFile.size === 0) {
          console.warn("[bg] EMPTY VIDEO FILE AFTER REBUILD:", filename, rec);
        }

        videoFiles.push(realFile);
      } catch (e) {
        console.warn("[bg] reconstruct video failed", i, e);
      }
    }

    return { imageFiles, videoFiles };
  } catch (e) {
    console.warn("[bg] ffmReconstructMediaFilesFromDB FAILED", listingName, e);
    return { imageFiles: [], videoFiles: [] };
  }
}


// Poll the content script for readiness by sending a lightweight ping until pong or maxWait.
async function ffmWaitForContentReady(tabId, maxWait = 4000) {
  try {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const r = await ffmSafeSendMessage(tabId, { type: 'ffm_ping' }, { timeoutMs: 800 });
        if (r && r.ok && (r.response === 'pong' || r.response === 'PONG')) return true;
      } catch (e) {}
      // small backoff between pings
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (e) {}
  return false;
}


// Handler: delete a user's Marketplace listing by title, then trigger publish
async function sendDeleteMessage(tabId, title, opts) {
  try {
    if (!tabId || !title) {
      try {
        console.warn('[bg] sendDeleteMessage called without tabId/title', {
          tabId,
          title
        });
      } catch (e) {}
      return;
    }

    const payload = {
      type: 'ffm_run_delete_relist',
      scheduled: !!(opts && opts.scheduled) === true,
      deleteTitle: String(title || ''),
      listingId: opts && opts.listingId ? opts.listingId : null,
      taskId: opts && opts.taskId ? opts.taskId : null,
      inventoryName: opts && opts.inventoryName ? opts.inventoryName : null,
      helperTabId: opts && opts.helperTabId ? opts.helperTabId : null
    };

    // Send the message to the content script and do not trigger any publish from here.
    const resWrap = await ffmSafeSendMessage(tabId, payload, { timeoutMs: 25000 });
    if (!resWrap || !resWrap.ok) {
      try { console.warn('[bg] sendDeleteMessage failed or timed out', resWrap && (resWrap.timeout ? 'timeout' : resWrap.error)); } catch (e) {}
      return resWrap;
    }

    try { console.log(`[AutoList Pro bg] ✅ Delete message delivered for ${String(title)} — awaiting ffm_delete_complete`); } catch (e) {}
    return resWrap;
  } catch (e) {
    console.debug('[bg] sendDeleteMessage wrapper error', e);
  }
}

// Background merge handler: perform merge against authoritative storage when requested by popup
try {
  chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== 'mergeActiveListings') return;

    try {
      chrome.storage.local.get(['ffmSavedListings', '__ffm_saved_listings_cache', 'listings'], r => {
        const saved =
          (Array.isArray(r.ffmSavedListings) && r.ffmSavedListings.length
            ? r.ffmSavedListings
            : Array.isArray(r.__ffm_saved_listings_cache) && r.__ffm_saved_listings_cache.length
            ? r.__ffm_saved_listings_cache
            : Array.isArray(r.listings) && r.listings.length
            ? r.listings
            : []);

  const scraped = msg.scraped || [];

  try { console.log('[bg] scraped listings preview:', (scraped || []).slice(0,3)); } catch (e) {}
  console.log(`[bg] mergeActiveListings: ${scraped.length} scraped, ${saved.length} saved`);

        if (!saved.length) {
          console.warn('[bg] No saved listings found — aborting merge to prevent data loss.');
          sendResponse({ ok: false, active: 0, reason: 'no_saved' });
          return;
        }

        // ---- FAST4MP FIX: wipe all active states before applying AAS/AS results ----
        if (saved && Array.isArray(saved)) {
          for (const l of saved) {
            try {
              l.isActive = false;
              l.active = false;
              l.activeBadge = '';
              l.activeTooltip = '';
              l.fbListedDays = null;
              l.fbListedText = '';
            } catch (e) {}
          }
        }

  // Normalize and fuzzy-match scraped vs saved
  const normalize = t => (t ? t.replace(/[^\w\s]/g, '').trim().toLowerCase() : '');

        for (const scrapedItem of scraped) {
          try {
            const stitle = normalize(scrapedItem.title);
            const sprice = scrapedItem.price || null;

            const match = saved.find(savedItem => {
              try {
                const ltitle = normalize(savedItem.title);
                const lprice = savedItem.price || null;

                // Fuzzy logic: allow substring or similarity match
                return (
                  (ltitle && stitle && (ltitle.includes(stitle) || stitle.includes(ltitle))) ||
                  (lprice && lprice === sprice)
                );
              } catch (e) { return false; }
            });

            if (match) {
              try {
                // Unified: prefer explicit `active` flag from the scrape
                try {
                  if (scrapedItem.active != null) {
                    match.isActive = !!scrapedItem.active;
                    match.active = !!scrapedItem.active; // keep for backward-compat
                  }
                } catch (e) {}

                // Carry over dateText -> unified fbListedText + auto-convert MM/DD -> fbListedDays
                try {
                  if (scrapedItem.dateText) {
                    match.fbListedText = scrapedItem.dateText;
                    const m = String(scrapedItem.dateText).match(/(\d{1,2})\/(\d{1,2})/);
                    if (m) {
                      const mm = Number(m[1]);
                      const dd = Number(m[2]);
                      const now = new Date();
                      const d = new Date(now.getFullYear(), mm - 1, dd);
                      const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
                      match.fbListedDays = diff >= 0 ? diff : 0;
                    }
                  }
                } catch (e) {}

                // Update last-checked timestamp for this merged entry
                try { match.lastCheckedTs = Date.now(); } catch (e) {}

                // carry over legacy date + timestamp fields if present (non-destructive)
                try { match.date = scrapedItem.date || match.date || ''; } catch (e) {}
                try { match.date_ts = (scrapedItem.date_ts !== undefined && scrapedItem.date_ts !== null) ? scrapedItem.date_ts : (match.date_ts || null); } catch (e) {}
                try { match.lastActive = new Date().toISOString(); } catch (e) {}
              } catch (e) {}
            }
          } catch (e) {}
        }

        // Save back safely
        chrome.storage.local.set({ listings: saved }, () => {
          const activeCount = saved.filter(x => x.isActive).length;
          console.log(`[bg] mergeActiveListings complete: ${activeCount} active`);
          try {
            chrome.runtime.sendMessage({ action: 'ffm-saved-listings-updated' });
            console.log('[AutoList Pro AS] pushed ffm-saved-listings-updated');
          } catch (e) {
            console.warn('[AutoList Pro AS] notify popup failed', e);
          }
          sendResponse({ ok: true, active: activeCount });
        });
      });
    } catch (e) {
      try { console.error('[bg] mergeActiveListings error', e); } catch (ee) {}
      try { sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }); } catch (ee) {}
    }

    return true; // keep sendResponse open
  });
} catch (e) {}

// Listener: sync scraped active listings into saved `listings` storage
try {
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    if (!msg || msg.action !== 'ffmActiveListingsResult') return;
    try {
      const scraped = Array.isArray(msg.scraped) ? msg.scraped : [];
        if (!scraped.length) {
          console.log('[bg] No scraped listings received — treating as full scan (will clear active flags)');
          // continue: treat empty scrape as a full scan so we clear active flags
        }

      console.log(`[bg] Merging ${scraped.length} scraped listings into storage...`);

      // Load existing listings
      const r = await new Promise(res => {
        try { chrome.storage.local.get('listings', res); } catch { res({}); }
      });
      const saved = Array.isArray(r.listings) ? r.listings : [];

      // Helper: normalize for fuzzy match
      const normalize = t => (t || '').toLowerCase().replace(/[^\w\s]/g, '').trim();

      // ---- FAST4MP: Decide whether this scrape is a full scan or a partial update ----
      // Historically we wiped all active flags before applying results which
      // caused partial scrapes (common in scheduled flows) to clear legitimate
      // active badges. To avoid that, only clear all active flags when the
      // scrape appears to be a full scan. For small/partial scrapes we will
      // preserve existing active flags and only mark/refresh matches.
      let treatAsFullScan = true;
      try {
        // If the scrape returned zero results, treat it as an explicit full-scan
        if (!Array.isArray(scraped) || scraped.length === 0) {
          treatAsFullScan = true;
        } else {
          const savedCount = saved && Array.isArray(saved) ? saved.length : 0;
          // Require at least 50% coverage (or at least 2 items) to consider this a full scan
          const minFull = Math.max(2, Math.floor(savedCount * 0.5));
          if ((Array.isArray(scraped) ? scraped.length : 0) < minFull) {
            treatAsFullScan = false;
          }
        }
      } catch (e) {
        treatAsFullScan = true;
      }

      if (treatAsFullScan) {
        try { console.log('[bg] Active Sync appears to be a full scan — clearing previous active flags before merge'); } catch (e) {}
        if (saved && Array.isArray(saved)) {
          for (const l of saved) {
            try {
              l.isActive = false;
              l.active = false;
              l.activeBadge = '';
              l.activeTooltip = '';
              l.activeStatus = '';
              l.listedDaysAgo = null;
              l.fbListedDays = null;
              l.fbListedText = '';
            } catch (e) {}
          }
        }
      } else {
        try { console.log('[bg] Active Sync appears to be a partial scrape — preserving existing active flags (scraped:', (Array.isArray(scraped) ? scraped.length : 0), 'saved:', (saved && saved.length) || 0, ')'); } catch (e) {}
      }

      // 2️⃣ Merge scraped results into saved listings
      for (const scrapedItem of scraped) {
        const st = normalize(scrapedItem.title);
        const sprice = scrapedItem.price?.trim() || '';
        const sstatus = scrapedItem.status?.trim() || '';
        const isActive = !!scrapedItem.active;

        if (!st) continue;

        // Prefer listingId match, fallback to title
        const match = saved.find(sav =>
          scrapedItem.listingId && sav.listingId && scrapedItem.listingId === sav.listingId
        ) || saved.find(sav => {
          const lt = normalize(sav.title);
          const lp = sav.price?.trim() || '';
          return (lp && sprice && lp === sprice) ||
                 (lt && st && (lt.includes(st) || st.includes(lt)));
        });

        if (!match) continue;

        // Update active info (unified naming)
        try {
          match.isActive = isActive;
          match.active = isActive; // keep for backward-compat
        } catch (e) {}

        try { match.activeStatus = sstatus || ''; } catch (e) {}
        try { match.lastActive = new Date().toISOString(); } catch (e) {}

        // Unified: prefer explicit `dateText` if available, otherwise fall back to status
        try {
          const srcDateText = scrapedItem.dateText || sstatus || '';
          if (srcDateText) {
            match.fbListedText = srcDateText;
            const m = String(srcDateText).match(/(\d{1,2})\/(\d{1,2})/);
            if (m) {
              const mm = Number(m[1]);
              const dd = Number(m[2]);
              const now = new Date();
              const d = new Date(now.getFullYear(), mm - 1, dd);
              const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
              match.fbListedDays = diff >= 0 ? diff : 0;
            }
          }
        } catch (e) {}

        // Update lastCheckedTs for UI/diagnostics
        try { match.lastCheckedTs = Date.now(); } catch (e) {}

        // Assign color-coded badge if your popup expects it (non-destructive)
        try {
          if (isActive) match.activeBadge = '🟢 Active';
          else match.activeBadge = '⚫ Inactive';
        } catch (e) {}
      }

      // 3️⃣ Save results back to storage
      await chrome.storage.local.set({ listings: saved });

      // Notify popup to perform a full saved-listings refresh
      try {
        chrome.runtime.sendMessage({ action: 'ffm-saved-listings-updated' });
        console.log('[AutoList Pro AS] pushed ffm-saved-listings-updated');
      } catch (e) {
        console.warn('[AutoList Pro AS] notify popup failed', e);
      }

  // 4️⃣ Notify popup UI to refresh (your color codes & badges update here)
  try { if (ffmThrottleRefresh()) chrome.runtime.sendMessage({ action: 'ffmRefreshSavedListings' }); } catch (e) {}

      console.log(`[bg] Merge complete → ${saved.filter(x => x.isActive).length} active out of ${saved.length}`);
      // Notify popup with canonical update and wait for popup acknowledgement before closing the originating tab
      try {
        const tabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : null;
        const scrapedToSend = Array.isArray(scraped) ? scraped : [];
        try {
          bgSafeSendMessage({ type: 'ffmActiveListingsUpdate', data: scrapedToSend, source: 'ActiveSync' }, (resp) => {
                // ⏳ Wait a short delay after popup ack to ensure merge completes
            setTimeout(() => {
              try {
                // Ensure we clear protection for this tab and perform the final close here.
                if (tabId) {
                  try {
                    // Perform AS cleanup and close the tab
                    try { cleanupASState('merge_complete'); } catch (e) {}
                    // protected-tab handling removed; always attempt close
                    try {
                      safeTabsRemove(tabId).then((ok) => { if (ok) console.log('[AutoList Pro AS] Selling tab closed after popup merge ack.', tabId); });
                    } catch (e) { /* ignore */ }
                  } catch (e) { console.warn('[AutoList Pro AS] Error closing tab (inner):', e); }
                } else {
                  console.warn('[AutoList Pro AS] No originating tabId to close after merge.');
                }
              } catch (e) { console.warn('[AutoList Pro AS] Error in delayed close:', e); }
            }, 5000);
          });
        } catch (e) { console.warn('[bg] error sending Active Sync update (outer):', e); }
      } catch (e) { console.warn('[bg] error preparing Active Sync update:', e); }

      sendResponse({ ok: true });
    } catch (err) {
      console.error('[bg] mergeActiveListings error', err);
      sendResponse({ ok: false, error: err.message });
    }
    return true; // keep sendResponse channel open
  });
} catch (e) {}

// Helper: wait until a tab is fully loaded and the content script responds to a ping.
async function waitForContentReady(tabId, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const tab = await new Promise(res => { try { chrome.tabs.get(tabId, res); } catch (e) { res(null); } });
      if (tab && tab.status === 'complete') {
        // quick ping to confirm content script is alive
        const pingRes = await new Promise(res => {
          try {
            chrome.tabs.sendMessage(tabId, { type: 'ffm_ping' }, (r) => {
              const le = (chrome.runtime && chrome.runtime.lastError) ? chrome.runtime.lastError : null;
              res({ resp: r, lastError: le });
            });
          } catch (e) { res({ resp: null, lastError: e }); }
        });
        if (!pingRes.lastError) return true;
      }
    } catch (e) {
      // ignore and retry until timeout
    }
    await new Promise(r => setTimeout(r, 500));
  }
  try { console.warn('[bg] waitForContentReady timeout for tab', tabId); } catch (e) {}
  return false;
}

// Helper: clear failed/incomplete/draft listings from the Selling page
async function clearFailedListings(tabId) {
  console.log("[AutoList Pro bg] 🔍 Checking for failed or draft listings...");
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const normalize = t => (t || "").toLowerCase();
        let removed = 0;

        const cards = Array.from(document.querySelectorAll('article, div[role="button"], div[aria-label]'));
        for (const el of cards) {
          try {
            const txt = normalize(el.innerText || "");
            if (txt.includes("failed") || txt.includes("incomplete") || txt.includes("draft")) {
              const deleteBtn = Array.from(el.querySelectorAll("div[role='button'], span, button"))
                .find(b => normalize(b.innerText).includes("delete"));
              if (deleteBtn) {
                try { deleteBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
                try { deleteBtn.click(); } catch (e) {}
                removed++;
              }
            }
          } catch (e) {}
        }
        return removed;
      }
    });

    const count = (results && results[0] && results[0].result) || 0;
    console.log(`[AutoList Pro bg] 🧹 Cleared ${count} failed/draft listings`);
    return count;
  } catch (err) {
    console.error("[AutoList Pro bg] ⚠️ Cleanup step failed", err);
    return 0;
  }
}

// Running guard for scheduled/on-demand background active-sync runs
if (typeof ffmActiveSyncRunning === 'undefined') var ffmActiveSyncRunning = false;
// Track the AS window id so we can unfocus/background it when scrolling completes
let ffmAsWindowId = null;
// Mode for Active Sync: null | 'hidden' | 'visible'
let ffmAsMode = null;

function bgShouldSuppressListingBroadcasts() {
  try {
    return !!(ffmActiveSyncRunning && ffmAsMode === 'hidden');
  } catch (e) { return false; }
}

function bgSafeSendMessage(msg, cb) {
  try {
    // Allow the final hidden result to pass through
    const allowHiddenFinal = (msg && (msg.action === 'ffm_as_hidden_result' || msg.type === 'ffm_as_hidden_result'));

    // Messages considered "listing broadcasts" that should be suppressed during hidden AS
    const listingTypes = new Set(['ffmActiveListingsUpdate','ffmUpdateActiveListings','ffmActiveListingsResult','ffmActiveListingsUpdated','ffmUpdateActiveListings']);
    const name = (msg && (msg.type || msg.action || msg.cmd || msg.name)) ? String(msg.type || msg.action || msg.cmd || msg.name) : '';
    if (!allowHiddenFinal && bgShouldSuppressListingBroadcasts() && listingTypes.has(name)) {
      try { console.log('[AS] suppressing interim listing broadcast for', name); } catch (e) {}
      return; // silently drop
    }

    try { chrome.runtime.sendMessage(msg, cb); } catch (e) { try { chrome.runtime.sendMessage(msg); } catch (ee) {} }
  } catch (e) {}
}
// Active Sync (AS) watchdog state
let __ffmASWatchdog = null;
let __ffmASTabId = null;

function startASWatchdog(tabId) {
  try {
    // clear any previous watchdog
    if (__ffmASWatchdog) {
      try { clearTimeout(__ffmASWatchdog); } catch (e) {}
      __ffmASWatchdog = null;
    }
    __ffmASTabId = tabId;
      try { console.log('[AutoList Pro AS] ⏱ Watchdog added and started for tab', tabId, '(timeout=120000ms)'); } catch (e) {}
    __ffmASWatchdog = setTimeout(() => {
      try { console.warn('[AutoList Pro AS] ⏱ Force-closing AS after 2 minutes'); } catch (e) {}
      try {
        if (__ffmASTabId) {
          try {
            try { safeTabsRemove(__ffmASTabId).catch(()=>{}); } catch (e) { try { console.warn('[AutoList Pro AS] Tab already closed or unavailable'); } catch (er) {} }
          } catch (e) { try { console.warn('[AutoList Pro AS] Error removing AS tab in watchdog', e); } catch (ee) {} }
        }
      } catch (e) {}
      try { cleanupASState('timeout'); } catch (e) {}
    }, 2 * 60 * 1000);
  } catch (e) {}
}

function clearASWatchdog() {
  try {
    if (__ffmASWatchdog) {
      try { clearTimeout(__ffmASWatchdog); } catch (e) {}
      __ffmASWatchdog = null;
    }
  } catch (e) {}
  try { __ffmASTabId = null; } catch (e) {}
}

function cleanupASState(reason) {
  try { console.log('[AutoList Pro AS] Cleanup AS state, reason:', reason); } catch (e) {}
  try { clearASWatchdog(); } catch (e) {}
  try { ffmActiveSyncRunning = false; } catch (e) {}
  try { ffmAsMode = null; } catch (e) {}
  // FFM_AS_PROTECTED_TAB deprecated — no-op
  try { ffmAsWindowId = null; } catch (e) {}
}

// Deterministic AS window placement — docked to the right beside the side panel
async function ffmOpenASWindow() {
  try {
    const AS_WINDOW_WIDTH = 420;
    // Make AS window height half of the previously computed size for a more compact view
    const AS_WINDOW_HEIGHT = Math.floor(Math.min(900,  (typeof screen !== 'undefined' && screen.availHeight) ? screen.availHeight - 120 : 900) / 2);
    const SIDE_PANEL_WIDTH = 360; // approximate side panel width

    // If chrome.system.display is available, use its workArea for better placement
    let area = null;
    try {
      if (chrome && chrome.system && chrome.system.display && typeof chrome.system.display.getInfo === 'function') {
        const screenInfo = await chrome.system.display.getInfo();
        const primary = screenInfo.find(d => d.isPrimary) || screenInfo[0];
        area = primary && primary.workArea ? primary.workArea : primary;
      }
    } catch (e) { area = null; }

    // Prefer the last-focused Chrome window bounds so the AS window opens on the
    // same display and docks to the right side of that window. Fall back to
    // global screen bounds when unavailable.
    const screenW = (typeof screen !== 'undefined' && screen.availWidth) ? screen.availWidth : ((area && area.width) ? area.width : 1024);
    const screenH = (typeof screen !== 'undefined' && screen.availHeight) ? screen.availHeight : ((area && area.height) ? area.height : 800);

    let left, top;
    try {
      const lastWin = await new Promise((res) => {
        try { chrome.windows.getLastFocused(res); } catch (e) { res(null); }
      });
      if (lastWin && typeof lastWin.left === 'number' && typeof lastWin.width === 'number') {
        const winLeft = lastWin.left || 0;
        const winTop = (typeof lastWin.top === 'number') ? lastWin.top : 0;
        const winWidth = lastWin.width || screenW;
        const winHeight = lastWin.height || screenH;
        left = Math.max(20, Math.floor(winLeft + winWidth - AS_WINDOW_WIDTH - SIDE_PANEL_WIDTH - 10));
        top = Math.max(60, Math.floor(winTop + (winHeight - AS_WINDOW_HEIGHT) / 2));
      } else {
        left = Math.max(20, Math.floor(screenW - AS_WINDOW_WIDTH - SIDE_PANEL_WIDTH - 10));
        top = Math.max(60, Math.floor((screenH - AS_WINDOW_HEIGHT) / 2));
      }
    } catch (e) {
      left = Math.max(20, Math.floor(screenW - AS_WINDOW_WIDTH - SIDE_PANEL_WIDTH - 10));
      top = Math.max(60, Math.floor((screenH - AS_WINDOW_HEIGHT) / 2));
    }

    return new Promise((resolve) => {
      try {
        safeWindowsCreate({ url: 'https://www.facebook.com/marketplace/you/selling', type: 'popup', width: AS_WINDOW_WIDTH, height: AS_WINDOW_HEIGHT, left, top, focused: true }).then((win) => {
          if (!win) {
            console.warn('[AutoList Pro] AS window create failed or was suppressed');
            resolve(null);
          } else {
            try { ffmAsWindowId = win && win.id ? win.id : ffmAsWindowId; } catch (e) {}
            resolve(win);
          }
        }).catch(() => resolve(null));
      } catch (e) { resolve(null); }
    });
  } catch (e) {
    try { console.warn('[AutoList Pro] ffmOpenASWindow error', e); } catch (er) {}
    return null;
  }
}

// Build an AS URL for hidden-tab usage
function ffmAsBuildUrl(opts = {}) {
  try {
    const reqId =
      opts.reqId
        ? String(opts.reqId)
        : String(Date.now()) + '-' + Math.floor(Math.random() * 100000);

    const order =
      opts.order === 'CREATION_TIMESTAMP'
        ? 'CREATION_TIMESTAMP'
        : 'CREATION_TIMESTAMP_DESC';

    const url =
      'https://www.facebook.com/marketplace/you/selling' +
      '?ffm_as=1' +
      '&ffm_as_req=' + encodeURIComponent(reqId) +
      '&order=' + encodeURIComponent(order);

    return { reqId, url, order };
  } catch (e) {
    return null;
  }
}

// Launch a hidden (inactive) tab that contains URL query flags instructing
// the content script to autorun Active Sync. Returns { reqId, tabId, url }
async function ffmLaunchASHiddenTabUrlDriven(opts = {}) {
  try {
    const built = ffmAsBuildUrl(opts || {});
    if (!built || !built.url) return null;
    const createObj = { url: built.url, active: false };
    // Remember the previously active tab so we can return focus after warm-up
    let prevTab = null;
    try {
      const prev = await new Promise((res) => { try { chrome.tabs.query({ active: true, currentWindow: true }, res); } catch (e) { res([]); } });
      prevTab = (prev && prev.length) ? prev[0] : null;
    } catch (e) { prevTab = null; }

    // Create the tab active briefly so FB fully materializes cards, then return focus
    const createActive = Object.assign({}, createObj, { active: true });
    const tab = await new Promise((res) => { try { chrome.tabs.create(createActive, res); } catch (e) { res(null); } });
    const tabId = tab && tab.id ? tab.id : null;
    try {
      const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
      // Mark AS in-progress and protect this tab during warm-up
      try { storage && storage.set && storage.set({ ffm_as_hidden_last: { reqId: built.reqId, tabId, url: built.url, ts: Date.now() }, ffm_as_in_progress: true, ffm_as_protected_tab: tabId }, () => {}); } catch (e) {}
      // After warm-up, restore focus to the previous tab so the AS tab becomes background
      try {
        setTimeout(() => {
          try {
            if (prevTab && prevTab.id != null) {
              safeTabsUpdate(prevTab.id, { active: true }, () => {
                try { console.log('[AS] Returned focus to original tab'); } catch (e) {}
              });
            } else if (tabId != null) {
              // Fallback: demote AS tab if no previous tab found
              safeTabsUpdate(tabId, { active: false }, () => {
                try { console.log('[AS] Tab demoted to inactive after warm-up'); } catch (e) {}
              });
            }
          } catch (e) { try { console.warn('[AS] Failed to restore focus/demote tab', e); } catch (_) {} }
        }, 6000);
      } catch (e) {}
    } catch (e) {}
    return { reqId: built.reqId, tabId, url: built.url };
  } catch (e) { return null; }
}

// Run Active Listings sync entirely in the background (hidden tab + merge).
async function ffmRunActiveSyncBackground(opts = {}) {
  if (ffmActiveSyncRunning) {
    try { console.debug('[bg] ffmRunActiveSyncBackground: already running, skipping'); } catch (e) {}
    return { ok: false, reason: 'already-running' };
  }
  ffmActiveSyncRunning = true;
  try {
    // Optional small jitter to avoid thundering herd if many machines schedule at the same minute
    const jitterMs = (opts.jitterMs !== undefined) ? Number(opts.jitterMs) : Math.floor(Math.random() * 20000);
    if (jitterMs > 0) await new Promise(r => setTimeout(r, jitterMs));

  try { console.log('[bg] ffmRunActiveSyncBackground: starting (jitter=' + jitterMs + 'ms)'); } catch (e) {}

    // Try URL-driven hidden-tab Active Sync first (non-handshake, content auto-runs)
  try {
    if (typeof ffmLaunchASHiddenTabUrlDriven === 'function') {
      try {
        // Two-pass orchestration: Pass 1 = Newest (DESC), Pass 2 = Oldest (ASC) only if needed
        // Pre-build pass1 URL so we can set buffering context before the helper tab can post results.
        try {
          const built1 = ffmAsBuildUrl(Object.assign({}, opts, { order: 'CREATION_TIMESTAMP_DESC' }));
            if (built1 && built1.url) {
            // Declare two-pass context and buffer so incoming pass messages are held until merge
            ffmAsMode = 'hidden';
            try { const storage = (chrome && chrome.storage && chrome.storage.local) ? chrome.storage.local : null; storage && storage.set && storage.set({ ffm_as_hidden_active: true }, () => {}); } catch (e) {}
            ffmAsTwoPassContext = { mode: 'hidden-two-pass', reqId: built1.reqId, startedAt: Date.now() };
            ffmAsPassBuffer = { passes: {} };

            // Remember previous active tab so we can return focus after warm-up
            let prevTab = null;
            try {
              const prev = await new Promise((res) => { try { chrome.tabs.query({ active: true, currentWindow: true }, res); } catch (e) { res([]); } });
              prevTab = (prev && prev.length) ? prev[0] : null;
            } catch (e) { prevTab = null; }

            // Create helper tab ACTIVE for warm-up and protect it
            const created = await safeTabsCreate({ url: built1.url, active: true });
            const pass1 = { reqId: built1.reqId, tabId: created && created.id ? created.id : null, url: built1.url };
            try {
              const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
              storage && storage.set && storage.set({ ffm_as_hidden_last: { reqId: built1.reqId, tabId: pass1.tabId, url: built1.url, ts: Date.now() }, ffm_as_in_progress: true, ffm_as_protected_tab: pass1.tabId }, () => {});
              try {
                setTimeout(() => {
                  try {
                    if (prevTab && prevTab.id != null) {
                      safeTabsUpdate(prevTab.id, { active: true }, () => {
                        try { console.log('[AS] Returned focus to original tab'); } catch (e) {}
                      });
                    } else if (pass1 && pass1.tabId != null) {
                      // Fallback: demote AS tab if no previous tab found
                      safeTabsUpdate(pass1.tabId, { active: false }, () => {
                        try { console.log('[AS] Tab demoted to inactive after warm-up'); } catch (e) {}
                      });
                    }
                  } catch (e) { try { console.warn('[AS] Failed to restore focus/demote pass1 tab', e); } catch (_) {} }
                }, 2000);
              } catch (e) {}
            } catch (e) {}

            if (pass1 && pass1.tabId) {
              try { console.log('[bg] ffmRunActiveSyncBackground: launched hidden AS tab (pass1)', pass1); } catch (e) {}

              // Await pass1 result (use tabId fallback)
              const res1 = await awaitHiddenAsResult(pass1.reqId, 45000, pass1.tabId);
              try { console.log('[bg] ffmRunActiveSyncBackground: pass1 result', res1 && res1.count); } catch (e) {}

              // Buffer pass1 result (ensure buffer holds it)
              try { ffmAsPassBuffer = ffmAsPassBuffer || { passes: {} }; ffmAsPassBuffer.passes[pass1.reqId] = res1 || { listings: [], meta: {} }; } catch (e) {}

              let finalListings = (res1 && res1.listings) ? res1.listings : [];
              try { console.log('[bg] pass1 meta', res1 && res1.meta); } catch (e) {}

              // Anchor logs for diagnostics: report pass1 completion and decision to run pass2
              try {
                const pass1Found = Array.isArray(finalListings) ? finalListings.length : 0;
                const expected = 6; // threshold used by background for deciding pass2
                try { console.log('[AS] pass1 done', { found: pass1Found, expected }); } catch (e) {}
                if (pass1Found < expected) {
                  try { console.log('[AS] pass1 incomplete -> launching pass2'); } catch (e) {}
                } else {
                  try { console.log('[AS] pass1 complete -> skipping pass2'); } catch (e) {}
                   // If pass1 found enough listings, treat it as the final merged result
                   try {
                     const merged = Array.isArray(finalListings) ? finalListings : (finalListings && finalListings.listings) ? finalListings.listings : [];
                     // Persist merged result for diagnostics
                     try { chrome.storage.local.set({ ffm_as_lastResult: { merged: true, pass1: (merged && merged.length) ? merged.length : 0, pass2: 0, listings: merged } }, () => {}); } catch (e) {}
                     // Emit telemetry: merged summary
                     try {
                       const titlesM = Array.isArray(merged) ? merged.map(l => (l && (l.title || l.inventoryName)) ? (l.title || l.inventoryName) : '') : [];
                       try { chrome.runtime.sendMessage({ action: 'ffm_as_progress', phase: 'merged', found: merged.length, expected: null, listings: titlesM }); } catch (e) {}
                     } catch (e) {}
                     // Clear protected flag and close helper tab
                     try { const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local; storage && storage.set && storage.set({ ffm_as_in_progress: false, ffm_as_protected_tab: null }, () => {}); } catch (e) {}
                     try { if (pass1 && pass1.tabId) safeTabsRemove(pass1.tabId).catch(()=>{}); } catch (e) {}
                     // Clear buffer/context
                     ffmAsPassBuffer = null; ffmAsTwoPassContext = null;
                     // Send ONE final merged result (meta.merged === true triggers popup matching)
                     try {
                       try { console.log('[AS] sending merged result (pass1-only)', { mergedCount: Array.isArray(merged) ? merged.length : 0 }); } catch (e) {}
                       chrome.runtime.sendMessage({ action: 'ffm_as_hidden_result', reqId: pass1.reqId, listings: merged, meta: { merged: true, count: merged.length } });
                       try { console.log('[AS] FINAL merged listings sent (pass1-only):', merged.length); } catch (e) {}
                     } catch (e) {}
                   } catch (e) {}
                }
              } catch (e) {}

                // Emit telemetry: pass1 progress (telemetry-only, don't trigger matching)
              try {
                const titles1 = (res1 && Array.isArray(res1.listings)) ? res1.listings.map(l => (l && (l.title || l.inventoryName)) ? (l.title || l.inventoryName) : '') : [];
                try { chrome.runtime.sendMessage({ action: 'ffm_as_progress', phase: 'pass1', found: (res1 && res1.listings) ? res1.listings.length : 0, expected: null, listings: titles1 }); } catch (e) {}
              } catch (e) {}

              if (finalListings.length < 6) {
                try { console.log('[bg] ffmRunActiveSyncBackground: pass1 incomplete, launching pass2'); } catch (e) {}
                const built2 = ffmAsBuildUrl(Object.assign({}, opts, { order: 'CREATION_TIMESTAMP' }));
                if (built2 && built2.url) {
                  // Reuse the pass1 tab for pass2 by navigating it to the pass2 URL
                  try {
                    await new Promise((res) => {
                      try { safeTabsUpdate(pass1.tabId, { url: built2.url, active: false }, res); } catch (e) { res(null); }
                    });
                  } catch (e) {}
                  const pass2 = { reqId: built2.reqId, tabId: pass1.tabId, url: built2.url };
                  try { const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local; storage && storage.set && storage.set({ ffm_as_hidden_last: { reqId: built2.reqId, tabId: pass2.tabId, url: built2.url, ts: Date.now() }, ffm_as_in_progress: true }, () => {}); } catch (e) {}

                  if (pass2 && pass2.tabId) {
                    const res2 = await awaitHiddenAsResult(pass2.reqId, 45000, pass2.tabId);
                    const listings2 = (res2 && res2.listings) ? res2.listings : [];
                    try { console.log('[bg] ffmRunActiveSyncBackground: pass2 result', listings2.length); } catch (e) {}

                    // Emit telemetry: pass2 progress
                    try {
                      const titles2 = Array.isArray(listings2) ? listings2.map(l => (l && (l.title || l.inventoryName)) ? (l.title || l.inventoryName) : '') : [];
                      try { chrome.runtime.sendMessage({ action: 'ffm_as_progress', phase: 'pass2', found: listings2.length, expected: null, listings: titles2 }); } catch (e) {}
                    } catch (e) {}

                    // Merge buffered pass1 ∪ pass2
                    const pass1Data = (ffmAsPassBuffer && ffmAsPassBuffer.passes && ffmAsPassBuffer.passes[pass1.reqId]) ? ffmAsPassBuffer.passes[pass1.reqId] : (res1 || { listings: [] });
                    const merged = mergeScrapeSets((pass1Data && pass1Data.listings) ? pass1Data.listings : [], listings2);

                    // Persist merged result for diagnostics
                    try { chrome.storage.local.set({ ffm_as_lastResult: { merged: true, pass1: (pass1Data && pass1Data.listings) ? pass1Data.listings.length : 0, pass2: listings2.length, listings: merged } }, () => {}); } catch (e) {}

                    // Emit telemetry: merged summary (pre-commit)
                    try {
                      const titlesM = Array.isArray(merged) ? merged.map(l => (l && (l.title || l.inventoryName)) ? (l.title || l.inventoryName) : '') : [];
                      try { chrome.runtime.sendMessage({ action: 'ffm_as_progress', phase: 'merged', found: merged.length, expected: null, listings: titlesM }); } catch (e) {}
                    } catch (e) {}
                    // Clear protected flag and close helper tabs
                    try { const storage = (chrome && chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local; storage && storage.set && storage.set({ ffm_as_in_progress: false, ffm_as_protected_tab: null }, () => {}); } catch (e) {}
                    try { safeTabsRemove(pass2.tabId).catch(()=>{}); } catch (e) {}
                    try { safeTabsRemove(pass1.tabId).catch(()=>{}); } catch (e) {}

                    // Clear buffer/context
                    ffmAsPassBuffer = null; ffmAsTwoPassContext = null;

                    // Send ONE final merged result
                    try {
                      try { console.log('[AS] sending merged result', { mergedCount: Array.isArray(merged) ? merged.length : 0 }); } catch (e) {}
                      chrome.runtime.sendMessage({ action: 'ffm_as_hidden_result', reqId: pass1.reqId, listings: merged, meta: { merged: true, count: merged.length } });
                      try { console.log('[AS] FINAL merged listings sent:', merged.length); } catch (e) {}

                      // Best-effort: close any lingering helper tabs launched with ffm_as markers
                      try {
                        setTimeout(() => {
                          try {
                            chrome.tabs.query({}, (tabs) => {
                              try {
                                for (const t of (tabs || [])) {
                                  try {
                                    if (!t || !t.url) continue;
                                    const u = String(t.url);
                                    if (u.includes('ffm_as=') || u.includes('ffm_as_req=')) {
                                      try { safeTabsRemove(t.id).catch(()=>{}); } catch (e) {}
                                    }
                                  } catch (e) {}
                                }
                              } catch (e) {}
                            });
                          } catch (e) {}
                        }, 2000);
                      } catch (e) {}
                    } catch (e) {}

                    // Clear hidden mode, storage flag, and running flag after final send
                    try { ffmAsMode = null; } catch (e) {}
                    try { const storage = (chrome && chrome.storage && chrome.storage.local) ? chrome.storage.local : null; storage && storage.set && storage.set({ ffm_as_hidden_active: false }, () => {}); } catch (e) {}
                    ffmActiveSyncRunning = false;
                    return { ok: true, triggered: 'hidden-two-pass', count: merged.length };
                  }
                }
              } else {
                // Pass1 already complete; close tab and clear buffer/context
                try { safeTabsRemove(pass1.tabId).catch(()=>{}); } catch (e) {}
                ffmAsPassBuffer = null; ffmAsTwoPassContext = null;

                // Send single pass1 result as final
                try { chrome.runtime.sendMessage({ action: 'ffm_as_hidden_result', reqId: pass1.reqId, listings: finalListings, meta: { merged: false, count: finalListings.length } }); } catch (e) {}

                try { ffmAsMode = null; } catch (e) {}
                try { const storage = (chrome && chrome.storage && chrome.storage.local) ? chrome.storage.local : null; storage && storage.set && storage.set({ ffm_as_hidden_active: false }, () => {}); } catch (e) {}
                ffmActiveSyncRunning = false;
                return { ok: true, triggered: 'hidden-one-pass', count: finalListings.length };
              }
            }
          }
        } catch (e) { try { console.warn('[bg] ffmRunActiveSyncBackground: hidden launch failed', e); } catch (er) {} }
      } catch (e) { try { console.warn('[bg] ffmRunActiveSyncBackground: hidden launch failed', e); } catch (er) {} }
    }
  } catch (e) {}

  // ------------------------------------------------------------------
  // DEBUG PATCH: Keep the Active Sync helper tab open for debugging
  // Set to true to prevent background from closing the created helper tab
  // Set to false for normal behavior (auto-close helper tab)
  // ------------------------------------------------------------------
  const DEBUG_KEEP_AS_TAB = false;

  // Open a small, unfocused popup window and ask the content script in its
  // active tab to run the one-shot active-listings scraper. This avoids
  // creating a visible focused tab that steals attention while still providing
  // a real tab context for content scripts to run.
  let createdTab = null;
  try {
    const win = await ffmOpenASWindow();
    try { ffmAsWindowId = win && win.id ? win.id : ffmAsWindowId; } catch (e) {}
    if (!win || !win.id) {
      try { console.warn('[AutoList Pro] AS window failed — aborting.'); } catch (e) {}
      try { if (typeof ffmFinishActiveSync === 'function') ffmFinishActiveSync(false); } catch (e) {}
      return { ok: false, reason: 'window-create-failed' };
    }

    // derive the helper tab id from the created window's first tab
    const tabId = (win.tabs && win.tabs[0] && win.tabs[0].id) ? win.tabs[0].id : null;
    if (!tabId) {
      try { console.warn('[bg] ffmRunActiveSyncBackground: failed to find tab inside popup window'); } catch (e) {}
      return { ok: false, reason: 'tab-inside-window-not-found' };
    }
    createdTab = { id: tabId };
    try { await new Promise(res => chrome.storage.local.set({ ffmActiveTabId: tabId }, res)); } catch (e) {}
    try { console.debug('[AutoList Pro AS] Protecting AS tab disabled — not setting protected marker for tab', tabId); } catch (e) {}
    try { startASWatchdog(tabId); } catch (e) {}

    // Wait for content script readiness inside the helper tab before triggering
    try { await ffmWaitForContentReady(tabId); } catch (e) {}
    // Hybrid warm-up: bring AS window to foreground, perform small warm-up scrolls
    // until content confirms scrolling works, then push window to background.
    try {
      const asWindowId = (win && win.id) ? win.id : null;
      // Attempt to focus the AS window to enable lazy-load scrolling
      try { if (asWindowId) safeWindowsUpdate(asWindowId, { focused: true }); } catch (e) {}

      let hasScrolledOnce = false;
      const warmupAttempts = (opts && opts.warmupAttempts) ? Number(opts.warmupAttempts) : 6;
      const warmupDelay = (opts && opts.warmupDelayMs) ? Number(opts.warmupDelayMs) : 400; // ms

      for (let wi = 0; wi < warmupAttempts; wi++) {
        try {
          // Send a lightweight warmup scroll request to content; content will reply { didScroll: true }
          const resp = await ffmSafeSendMessage(createdTab.id, { action: 'ffm_as_warmup', step: wi }, { timeoutMs: 2000 }).catch(() => null);
          if (resp && resp.didScroll) {
            hasScrolledOnce = true;
            try { console.log('[AutoList Pro bg:AS] Warm-up scroll confirmed by content (step=' + wi + ')'); } catch (e) {}
            // Warm-up confirmed — keep AS window focused until full scroll completes.
            // The content script will send 'ffm_as_scroll_complete' when done; that message
            // is handled by the background to move the window to the background.
            break;
          }
        } catch (e) {}
        // small wait between attempts so DOM can settle
        await new Promise(r => setTimeout(r, warmupDelay));
      }

      // If warm-up never succeeded, log and proceed without minimizing so the regular AS flow can complete.
      if (!hasScrolledOnce) {
        try { console.log('[AutoList Pro bg:AS] Warm-up scroll not confirmed; continuing without minimizing AS window'); } catch (e) {}
      }
    } catch (e) { console.warn('[AutoList Pro bg:AS] warm-up loop error', e); }

    try { chrome.tabs.sendMessage(tabId, { action: 'ffm_run_as' }); } catch (e) {}

    // Ask the content script in that tab to perform the one-shot scrape.
    try {
      try { console.log('[bg] ffmRunActiveSyncBackground: attempting scrape trigger…'); } catch (e) {}
      const resp = await ffmSafeSendMessage(createdTab.id, { action: 'ffmActiveListingsAuto', origin: 'background', forced: true });
      try {
        if (!resp) {
          console.warn('[bg] Active Sync could not reach content script or no response');
          // ------------------------------------------------------------------
          // DEBUG PATCH: Prevent Active Sync tab from closing automatically
          // If we're in debug mode, stop the cleanup routine so the tab stays open
          // ------------------------------------------------------------------
          if (DEBUG_KEEP_AS_TAB) {
            console.warn('[AutoList Pro AS DEBUG] Prevented background auto-close.');
            return { ok: false, reason: 'no-response-debug' };
          }
        }
      } catch (e) {}
      try { console.log('[bg] Active Sync content script responded:', resp); } catch (e) {}
      try { console.log('[bg] ffmRunActiveSyncBackground: scrape message sent'); } catch (e) {}
    } catch (err) {
      try { console.warn('[bg] ffmRunActiveSyncBackground: sendMessage error', err); } catch (e) {}
    }

    // Give the content script a short grace period to finish and post results
    await new Promise(r => setTimeout(r, 5000));

    // Close the helper tab (delayed to ensure messages complete)
    // NOTE: For the protected AS tab we intentionally do NOTHING here so the
    // merge-complete handler is the single owner of the final close action.
    try {
      const tabId = createdTab && createdTab.id;
      setTimeout(() => {
        try {
          if (tabId) {
            try {
              safeTabsRemove(tabId).then((ok) => { if (ok) console.log('[AutoList Pro AS] Helper tab closed (delayed cleanup).'); });
            } catch (e) {
              console.warn('[AutoList Pro AS] Error closing tab (inner):', e);
            }
          }
        } catch (e) { console.warn('[AutoList Pro AS] Error closing tab:', e); }
      }, 5000); // delay increased to allow log collection
    } catch (e) {}

    // Update last-checked timestamp for UI (best-effort)
    // Persist under multiple keys to remain compatible with popup/content variants
    try {
      const nowTs = Date.now();
      await new Promise(res => chrome.storage.local.set({ fast4mp_lastActiveCheck: nowTs, ffmLastActiveCheck: nowTs, ffm_lastActiveCheck: nowTs }, res));
    } catch (e) {}

    return { ok: true, note: 'triggered' };
    } catch (err) {
    try { console.error('[bg] ffmRunActiveSyncBackground error', err); } catch (e) {}
    try {
      const tabId = createdTab && createdTab.id;
      try {
        setTimeout(() => {
          try {
            if (!DEBUG_KEEP_AS_TAB && tabId) {
              try { safeTabsRemove(tabId).then((ok) => { if (ok) console.log('[AutoList Pro AS] Selling tab closed (delayed cleanup)'); }); } catch (e) { console.warn('[AutoList Pro AS] Error closing tab (error handler):', e); }
            } else {
              try { if (DEBUG_KEEP_AS_TAB) console.warn('[AutoList Pro AS DEBUG] Skipped delayed chrome.tabs.remove (error handler)'); } catch (e) {}
            }
          } catch (e) { console.warn('[AutoList Pro AS] Error in delayed close (error handler):', e); }
        }, 5000);
      } catch (e) { console.warn('[AutoList Pro AS] Scheduling delayed close failed', e); }
    } catch (e) {}
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
  } catch (err) {
    try { console.error('[bg] ffmRunActiveSyncBackground error', err); } catch (e) {}
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    try { ffmAsMode = null; } catch (e) {}
    try { const storage = (chrome && chrome.storage && chrome.storage.local) ? chrome.storage.local : null; storage && storage.set && storage.set({ ffm_as_hidden_active: false }, () => {}); } catch (e) {}
    ffmActiveSyncRunning = false;
  }
}

// When active listings are reported back (from content script or internal scraper),
// cache the tab id so Delete/Relist can reuse the same DOM context.
try {
  // Listen for AS scroll-complete signal and background the AS window
  try {
    chrome.runtime.onMessage.addListener((msg, sender) => {
      try {
        if (!msg) return;
        if (msg.action === 'ffm_as_scroll_complete' && ffmAsWindowId) {
          try { console.log('[AS] Scroll complete — minimizing AS window'); } catch (e) {}
          try {
            safeWindowsUpdate(ffmAsWindowId, { focused: false, state: 'minimized' }, () => {
              try {
                if (chrome.runtime && chrome.runtime.lastError) {
                  // Minimize failed; fall back to unfocus only
                  try { safeWindowsUpdate(ffmAsWindowId, { focused: false }); } catch (e) {}
                } else {
                  // Successfully minimized; clear tracked id
                  try { ffmAsWindowId = null; } catch (e) {}
                }
              } catch (e) {}
            });
          } catch (e) {
            try { safeWindowsUpdate(ffmAsWindowId, { focused: false }); } catch (er) {}
          }
        }
      } catch (e) {}
    });
  } catch (e) {}

  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    try {
      if (!msg) return;

      // =================================================================
      // SDNR FALLBACK HANDLER — ALWAYS USE SELLING-SCRAPER (NO TITLE SEARCH)
      // =================================================================
      if (msg.type === 'ffm_sdnr_fallback' || msg.action === 'ffm_sdnr_fallback') {
        console.log("[SDNR] Received fallback request from content_main:", msg);

        try {
          const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
          if (!tabId) {
            console.warn("[SDNR] No tabId provided for fallback — aborting");
            return true;
          }

          // Attach helper tab ID to this task so publish-complete can close it safely
          try {
            msg.helperTabId = tabId;
            msg.isScheduledDNR = true;
            console.log("[SDNR] Helper tab registered:", tabId);
          } catch (e) {}

          // Inject shared scraper logic (selling script is injected by manifest)
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: [
              "content/shared_scrapers.js"
            ]
          });

          // ---------- FIX SDNR TITLE RESOLUTION ----------
          // Ensure we have a persisted per-tab context available
          let ctx = null;
          try { ctx = (globalThis.__ffm_sdnrStateByTab && globalThis.__ffm_sdnrStateByTab[tabId]) ? globalThis.__ffm_sdnrStateByTab[tabId] : (typeof __ffm_sdnrStateByTab !== 'undefined' ? __ffm_sdnrStateByTab[tabId] : null); } catch (e) { ctx = null; }

          // We always guarantee a valid title now.
          // Priority:
          // 1. ctx.title            (enrichedTitle from saved listing)
          // 2. msg.deleteTitle      (if explicitly passed)
          // 3. msg.listingTitle     (may be empty for SDNR)
          // 4. msg.title            (manual DnR path)
          // 5. ctx.inventoryName    (safe fallback)
          // 6. msg.inventoryName
          let deleteTitle =
            (ctx && ctx.title) ||
            msg.deleteTitle ||
            msg.listingTitle ||
            msg.title ||
            (ctx && ctx.inventoryName) ||
            (msg && msg.payload && msg.payload && msg.payload.inventoryName) ||
            msg.inventoryName ||
            "";

          // If absolutely nothing found, abort safely
          if (!deleteTitle || !deleteTitle.trim()) {
            console.warn("[SDNR] ❌ No valid deleteTitle found (even after fallback). Aborting delete.", {
              ctx,
              msg
            });
            return false;
          }

          deleteTitle = deleteTitle.trim();
          console.log("[SDNR] Using deleteTitle:", deleteTitle);

          const opts = {
            scheduled: true,
            helperTabId: tabId,
            taskId: (msg && msg.payload && msg.payload.taskId) ? msg.payload.taskId : (ctx && ctx.taskId) ? ctx.taskId : null,
            inventoryName: (ctx && ctx.inventoryName) || (msg && msg.payload && msg.payload.inventoryName) || msg.inventoryName || null,
            listingId: (ctx && ctx.listingId) || (msg && msg.payload && msg.payload.listingId) || msg.listingId || null,
            publishRequestId: (msg && msg.payload && msg.payload.publishRequestId) || null
          };

          try {
            await sendDeleteMessage(tabId, String(deleteTitle || (ctx && ctx.title) || (msg && msg.title) || ''), opts);
            console.log('[SDNR] Sent ffm_run_delete_relist via sendDeleteMessage to tab', tabId);
          } catch (e) {
            console.error('[SDNR] sendDeleteMessage failed', e);
          }

        } catch (e) {
          console.error("[SDNR] ERROR triggering selling fallback:", e);
        }

        return true;
      }

      // 🔹 SDNR helper: close the selling/search tab when content_selling asks
      if (msg.action === 'ffm_sdnr_close_me') {
        try {
          const tabId = sender && sender.tab && sender.tab.id;
          if (tabId != null) {
            console.log('[SDNR] close request received for tab', tabId);
            try { safeTabsRemove(tabId).then((ok) => { if (!ok) { const err = chrome.runtime && chrome.runtime.lastError; if (err) console.debug('[SDNR] helper tab close ignored', err); } else { console.log('[SDNR] Closed SDNR helper tab', tabId); } }); } catch (e) { console.warn('[SDNR] helper tab safe remove failed', e); }
          }
        } catch (e) {
          console.warn('[SDNR] close-tab handler error', e);
        }

        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        return true; // stop here, we handled this message
      }
      // New: accept overlay-style payloads with explicit 'type' and save+forward for popup merging
      if (msg && msg.type === 'ffmActiveListingsResult') {
        try {
          if (sender && sender.tab && sender.tab.id) {
            try { await new Promise(res => chrome.storage.local.set({ ffmActiveTabId: sender.tab.id }, res)); } catch (e) {}
          }
        } catch (e) {}

        // Save the raw scrape for diagnostics and fallback; also keep last active listings array
        try {
          const raw = msg.listings || msg.data || [];
          await new Promise(res => { try { chrome.storage.local.set({ ffmLastActiveScrape: raw, ffmLastActiveListings: raw }, () => res()); } catch (e) { res(); } });
          try { console.log('[AutoList Pro bg] Saved ffmLastActiveScrape & ffmLastActiveListings:', (raw && raw.length) ? raw.length : 0); } catch (e) {}
        } catch (e) { try { console.warn('[AutoList Pro bg] Failed to save ffmLastActiveScrape/ffmLastActiveListings', e); } catch (er) {} }

        // Forward to popup(s) using well-known types so popup listener merges into storage
        try { bgSafeSendMessage({ type: 'ffmUpdateActiveListings', listings: msg.listings || msg.data || [], _origin: 'bg', _timestamp: Date.now() }); } catch (e) {}
        try {
          const scraped = Array.isArray(msg && msg.scraped) ? msg.scraped : (Array.isArray(msg && msg.listings) ? msg.listings : (Array.isArray(msg && msg.data) ? msg.data : []));
          bgSafeSendMessage({ type: 'ffmActiveListingsUpdate', data: scraped, source: 'ActiveSync', _origin: 'bg', _timestamp: Date.now() });
          // If we forwarded an Active Listings update coming directly from a content tab,
          // ensure any previously-protected AS helper tab is cleared and closed after a short delay.
          try {
            const tabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : null;
            setTimeout(() => {
              try {
                try { console.debug('[AutoList Pro AS] Forwarded update cleanup for tab', tabId); } catch (e) {}
                if (!FAST4MP_DEBUG && tabId) {
                  try { safeTabsRemove(tabId).then((ok) => { if (ok) console.log('[AutoList Pro AS] Selling tab closed (forwarded update cleanup)'); }); } catch (e) { console.warn('[AutoList Pro AS] Error closing tab (forwarded update):', e); }
                }
              } catch (e) { console.warn('[AutoList Pro AS] Error in forwarded-update delayed close:', e); }
            }, 5000);
          } catch (e) {}
        } catch (e) {}

  try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      }
  // Accept both legacy action and explicit cmd from content scripts
  // Support multiple possible action/cmd names sent by overlay or scrapers
  if (msg && (msg.cmd === 'ffmActiveListingsResult' || msg.action === 'ffmActiveListingsResult' || msg.action === 'ffmCheckActiveListingsResult' || msg.action === 'ffmActiveListingsUpdated' || msg.type === 'ffmActiveListingsResult')) {
        try {
          if (sender && sender.tab && sender.tab.id) {
            await new Promise(res => { try { chrome.storage.local.set({ ffmActiveTabId: sender.tab.id }, res); } catch (e) { res(); } });
            try { console.log('[AutoList Pro bg] Cached active listings tabId ->', sender.tab.id); } catch (e) {}
          }
        } catch (e) { console.debug('[AutoList Pro bg] failed to cache active tab', e); }

        // Forward the message along for existing handlers and acknowledge
        try {
          // Clone and tag as originating from background to help listeners dedupe
          const out = Object.assign({}, msg, { _origin: 'bg', _timestamp: (msg && msg._timestamp) ? msg._timestamp : Date.now() });
          bgSafeSendMessage(out);
        } catch (e) {}
        try {
          const scraped = Array.isArray(msg && msg.scraped) ? msg.scraped : (Array.isArray(msg && msg.listings) ? msg.listings : (Array.isArray(msg && msg.data) ? msg.data : []));
          bgSafeSendMessage({ type: 'ffmActiveListingsUpdate', data: scraped, source: 'ActiveSync', _origin: 'bg', _timestamp: Date.now() });
          // Also schedule a delayed clear+close for the originating tab to handle the
          // case where popup merged the results (background didn't run the merge path).
          try {
            const tabId = (sender && sender.tab && sender.tab.id) ? sender.tab.id : null;
            setTimeout(() => {
              try {
                try { console.debug('[AutoList Pro AS] Legacy forwarded update cleanup for tab', tabId); } catch (e) {}
                if (!FAST4MP_DEBUG && tabId) {
                  try { safeTabsRemove(tabId).then((ok) => { if (ok) console.log('[AutoList Pro AS] Selling tab closed (legacy forwarded cleanup)'); }); } catch (e) { console.warn('[AutoList Pro AS] Error closing tab (legacy forward):', e); }
                }
              } catch (e) { console.warn('[AutoList Pro AS] Error in legacy-forward delayed close:', e); }
            }, 5000);
          } catch (e) {}
        } catch (e) {}
  try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      }
    } catch (e) {}
  });
} catch (e) { console.debug('[AutoList Pro bg] install cache-listener failed', e); }

// Lightweight relay: if content/sidepanel asks popup to refresh, broadcast a single
// ffmRefreshSavedListings signal. Never echo ffmRefreshSavedListings back again.
try {
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender) => {
      try {
        if (!msg || !msg.action) return;

        if (msg.action === 'ffm_refresh_popup') {
          try {
            // Ignore ffm_refresh_popup fully — popup only listens for the canonical
            // ffmRefreshSavedListings events. Background will not relay or rebroadcast
            // ffm_refresh_popup to avoid refresh storms originating from content.
            console.debug('[bg] ignoring ffm_refresh_popup (popup will refresh from canonical events only)');
            return;
          } catch (e) {
            console.debug('[bg] refresh-relay ignore error', e);
          }
        }

        // If we get ffmRefreshSavedListings directly, just log and DO NOT re-broadcast.
        if (msg.action === 'ffmRefreshSavedListings') {
          console.debug('[bg] refresh-relay: ignoring incoming ffmRefreshSavedListings (no re-broadcast)');
        }
      } catch (e) {
        console.debug('[bg] refresh-relay listener error', e);
      }
    });
  }
} catch (e) {
  console.debug('[bg] failed to install refresh-relay listener', e);
}

// Relay: content requests popup to export media for a listing -> background -> popup -> background -> content
try {
  chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || msg.action !== 'ffm_request_popup_media_for_listing') return;
      const listingId = msg.listingId || msg.id || msg.listingName;
      if (!listingId) {
        try { sendResponse && sendResponse({ ok: false, error: 'missing_listingId' }); } catch (e) {}
        return;
      }

      try {
        chrome.runtime.sendMessage({ type: 'ffm_popup_export_media', listingId }, (resp) => {
          try {
            // If popup didn't respond, resp may be undefined
            sendResponse && sendResponse(resp || { ok: false, error: 'no-popup-response' });
          } catch (e) {
            try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
          }
        });
      } catch (e) {
        try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
      }

      return true; // keep channel open while awaiting popup
    } catch (e) {}
  });
} catch (e) { console.debug('[bg] install ffm_request_popup_media_for_listing listener failed', e); }

// Handler: Open the Marketplace Selling page and request active-listings check (invoked from popup)
try {
  chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || msg.action !== 'openActiveListingsPage') return;

      try { console.log('[AutoList Pro bg] Opening new Marketplace tab for Active Listings check'); } catch (e) {}

      chrome.tabs.create(
        { url: 'https://www.facebook.com/marketplace/you/selling', active: true },
        (tab) => {
          try { console.log(`[AutoList Pro bg] ✅ Created tab ${tab && tab.id} for Active Listings`); } catch (e) {}
          setTimeout(() => {
            try {
              if (!tab || !tab.id) return;
              (async () => {
                try {
                  const resp = await ffmSafeSendMessage(tab.id, { action: 'ffmActiveListingsAuto' });
                  try { if (!resp) console.warn('[AutoList Pro bg] Could not reach content script on new tab'); } catch (e) {}
                  try { console.log('[AutoList Pro bg] 🔁 Sent ffmActiveListingsAuto to new tab', resp); } catch (e) {}
                } catch (e) { try { console.warn('[AutoList Pro bg] Could not send ffmCheckActiveListings', e); } catch(_){} }
              })();
            } catch (err) { try { console.warn('[AutoList Pro bg] Could not send ffmCheckActiveListings', err); } catch (_) {} }
          }, 6000);
        }
      );

      try { sendResponse({ ok: true }); } catch (e) {}
    } catch (e) {}
  });
} catch (e) { console.debug('[AutoList Pro bg] failed to install openActiveListingsPage listener', e); }

// Message: trigger on-demand background Active Sync (from popup)
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
  if (!msg || !(msg.action === 'ffm_trigger_active_sync_now' || msg.type === 'ffm_trigger_active_sync_now')) return;
  try { console.log('[bg] ffm_trigger_active_sync_now received — starting background sync'); } catch (e) {}
      // Gate Active Sync if a scheduled DnR/SP/UI-driven operation is in progress
      try {
        if ((typeof window !== 'undefined' && window.__ffm_block_as) || (typeof globalThis !== 'undefined' && globalThis.__ffm_block_as)) {
          try { console.log('[AutoList Pro AS] Blocked due to SDnR/SP active.'); } catch (e) {}
          return;
        }
      } catch (e) {}
      (async () => {
        try {
          const res = await ffmRunActiveSyncBackground({ jitterMs: 0 });
          try { sendResponse && sendResponse(res); } catch (e) {}
        } catch (err) { try { sendResponse && sendResponse({ ok: false, error: String(err) }); } catch (e) {} }
      })();
      return true; // keep sendResponse open for async
    } catch (e) {}
  });
} catch (e) { console.debug('[bg] failed to install ffm_trigger_active_sync_now listener', e); }

// Ensure hourly AAS alarm only when user has enabled it in settings.
try {
  if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ ffmEnableAutoActiveScan: false }, (res) => {
      try {
        if (res && res.ffmEnableAutoActiveScan) {
              try { ffmEnsureAasAutoAlarm(); } catch (e) { console.warn('[AutoList Pro bg:AAS] ensure alarm call failed', e); }

              // NEW: On startup, if the feature is enabled and our stored last-checked
              // timestamp is older than the firewall threshold, trigger an immediate
              // Auto Active Scan rather than waiting ~60 minutes for the first alarm.
              try {
                ffmShouldRunHourlySync().then((ok) => {
                  try {
                    if (ok) {
                          console.log('[AutoList Pro bg:AAS] Startup immediate run → launching NEW window-based AAS');
                          try { ffmRunActiveSyncBackground({ jitterMs: 0 }); } catch (e) { console.warn('[AutoList Pro bg:AAS] ffmRunActiveSyncBackground failed', e); }
                        } else {
                      console.log('[AutoList Pro bg:AAS] Startup immediate run: lastActive recent — skipping');
                    }
                  } catch (e) { console.warn('[AutoList Pro bg:AAS] Startup ffmShouldRunHourlySync handler error', e); }
                }).catch((e) => { console.warn('[AutoList Pro bg:AAS] ffmShouldRunHourlySync failed on startup', e); });
              } catch (e) { console.warn('[AutoList Pro bg:AAS] Startup immediate-run check failed', e); }

            } else {
          // Make sure the alarm is not left running when the feature is disabled
          try { chrome.alarms && chrome.alarms.clear && chrome.alarms.clear(FFM_AAS_AUTO_ALARM); } catch (e) {}
        }
      } catch (e) { console.warn('[AutoList Pro bg:AAS] storage read failed', e); }
    });
  }
} catch (e) { console.warn('[AutoList Pro bg:AAS] failed to init AAS alarm from config', e); }

// Listen for popup toggles to enable/disable Auto Active Scan
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || msg.action !== 'ffm_set_auto_active_scan_enabled') return;
      const enabled = !!msg.enabled;
      try {
        chrome.storage.local.set({ ffmEnableAutoActiveScan: enabled }, () => {
          try {
            if (enabled) ffmEnsureAasAutoAlarm();
            else chrome.alarms && chrome.alarms.clear && chrome.alarms.clear(FFM_AAS_AUTO_ALARM);
          } catch (e) {}
        });
        try { sendResponse && sendResponse({ ok: true, enabled }); } catch (e) {}
      } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
      return true;
    } catch (e) {}
  });
} catch (e) { console.warn('[AutoList Pro bg:AAS] install toggle listener failed', e); }

// --- DNR: Try Title Search First -----------------------------------------
// Small sleep helper for background async waits (mirror of content script `sleep`)
function ffmSleep(ms) {
  return new Promise((res) => setTimeout(res, Number(ms) || 0));
}

async function ffmOpenTitleSearchTab(listing) {
  try {
    const encodedTitle = encodeURIComponent(listing.title || listing.listingTitle || listing.inventoryName || "");
    const url = `https://www.facebook.com/marketplace/you/selling?title_search=${encodedTitle}`;

    // Create an active tab (some FB query parameters only apply when the tab is focused)
    // Block Active Sync/AAS before opening the title_search tab so the opener
    // doesn't accidentally trigger an Active Sync on tab create.
    try { try { window.__ffm_block_as = true; } catch (e) { try { globalThis.__ffm_block_as = true; } catch (e) {} } } catch (e) {}

    // Try to find an existing title_search tab for the same encoded title and reuse it
    let tab = null;
    try {
      const tabs = await new Promise((r) => { try { chrome.tabs.query({ url: '*://*.facebook.com/marketplace/you/selling*' }, r); } catch (e) { r([]); } });
      if (tabs && tabs.length) {
        for (const t of tabs) {
          try {
            if (t && t.url && t.url.indexOf('title_search=' + encodedTitle) !== -1) { tab = t; break; }
          } catch (e) {}
        }
      }
    } catch (e) { tab = null; }

    if (!tab) {
      tab = await new Promise((res) => {
        try {
          chrome.tabs.create({ url, active: true }, (t) => {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { console.debug('[DnR] chrome.tabs.create lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                return res(null);
              }
              res(t || null);
            } catch (e) { res(null); }
          });
        } catch (e) { res(null); }
      });
    } else {
      // Bring existing tab to front to ensure FB applies query parameters
      try { safeTabsUpdate(tab.id, { active: true }); } catch (e) {}
    }

    if (!tab || !tab.id) {
      console.warn("[DnR] Failed to open title_search tab");
      return null;
    }

    // Wait for the tab content script to be ready so the title_search filter can run
    try {
      await ffmWaitForContentReady(tab.id, 8000);
    } catch (e) {}

    // Give FB an extra short moment to apply the filter and render results
    await ffmSleep(1200);

    // Persist a pointer on the task object (if provided) so caller can close the tab later
    try { if (listing && typeof listing === 'object') listing.__ffm_search_tab = tab.id; } catch (e) {}

    return tab.id;
  } catch (err) {
    console.error("[DnR] Error opening title_search tab:", err);
    return null;
  }
}

// Helper: ask the extension popup to run the saved-listing Delete/Relist (DnR) button
async function ffmRunPopupDnr(listing, opts = {}) {
  try {
    const title = listing && (listing.title || listing.inventoryName || '') ? (listing.title || listing.inventoryName) : '';
    const taskId = opts && opts.taskId ? String(opts.taskId) : null;
    const ackToken = opts && opts.ackToken ? opts.ackToken : (taskId ? (taskId + ':' + Math.random().toString(36).slice(2) + Date.now().toString(36)) : null);

    // Persist a request token so popup can observe we intended to schedule this task
    try { if (taskId && ackToken) chrome.storage.local.set({ ['ffm_schedule_ack_req_' + taskId]: { token: ackToken, ts: Date.now() } }); } catch (e) {}

    // Try sending the popup message repeatedly until timeout (do NOT open a new window)
    const start = Date.now();
    const maxWait = (opts && typeof opts.timeoutMs === 'number') ? opts.timeoutMs : 12000;
    const interval = 400;
    while (Date.now() - start < maxWait) {
      try {
        const resp = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ type: 'ffm_run_popup_dnr', title, scheduleTaskId: taskId, ackToken }, (r) => {
              try { resolve(r); } catch (e) { resolve(null); }
            });
          } catch (e) { resolve(null); }
        });

        if (resp && resp.ok) return { ok: true, resp };
        // If popup explicitly reports not-found, bail early
        if (resp && resp.reason === 'not-found') {
          try { if (win && win.id) chrome.windows.remove(win.id); } catch (e) {}
          return { ok: false, reason: 'not-found' };
        }
      } catch (e) { /* ignore and retry */ }
      await new Promise(r => setTimeout(r, interval));
    }

    // Timeout — close popup window if we created it
    try { if (win && win.id) chrome.windows.remove(win.id); } catch (e) {}
    return { ok: false, reason: 'timeout' };
  } catch (e) { return { ok: false, reason: 'exception', error: String(e) }; }
}

// --- NEW: DNR Entry (Title Search First) ---------------------------------
async function ffmBeginDNRFlow_TitleFirst(listing) {
  console.log("[DnR] Fast-path: Trying title_search match first…");

  // Open the title-search tab and message it. Return a structured result so callers
  // can decide whether to run the fallback flow (which may open the selling page).
  const tabId = await ffmOpenTitleSearchTab(listing);
  if (!tabId) {
    console.warn("[DnR] Could not open title search tab");
    return { success: false, fallback: true, reason: 'open-failed' };
  }

  // Use safe messaging (avoids runtime.lastError throwing) and await response
  // Allow a longer timeout because the content script may perform the delete sequence
  const response = await ffmSafeSendMessage(tabId, { action: 'ffm_dnr_try_title_search', listing }, { timeoutMs: 12000 });

  if (response && response.success) {
    console.log("[DnR] Fast-path delete succeeded");
    return { success: true, tabId };
  }

  if (response && response.fallback) {
    console.warn('[DnR] Fast-path asked for fallback', response.reason || null);
    return { success: false, fallback: true, tabId, reason: response.reason || null };
  }

  // Unexpected result — treat as fallback
  console.warn('[DnR] Fast-path returned unexpected result — requesting fallback');
  return { success: false, fallback: true, tabId, reason: 'unexpected' };
}

// --- scheduled title-search fast-path (IDENTICAL opener to manual DnR) ----
async function ffmScheduledTitleSearchFlow(task) {
  try {
    let searchTitle =
      (task && task.title) ||
      (task && task.listingTitle) ||
      (task && task.inventoryName) ||
      '';

    // Try to enrich the search title from saved listings when we have an inventoryName/listingId.
    // Prefer the explicitly-provided task.title/listingTitle if present and different.
    try {
      if (task && (task.inventoryName || task.listingId)) {
        const snap = await new Promise(res => { try { chrome.storage.local.get(['listings'], res); } catch (e) { res({}); } });
        const listings = (snap && Array.isArray(snap.listings)) ? snap.listings : [];
        let found = null;
        try {
          if (task.listingId) {
            found = listings.find(l => l && (String(l.listingId) === String(task.listingId) || String(l.id) === String(task.listingId)));
          }
        } catch (e) {}
        try {
          if (!found && task.inventoryName) {
            found = listings.find(l => l && l.inventoryName && String(l.inventoryName) === String(task.inventoryName));
          }
        } catch (e) {}

        if (found) {
          const prefer = (found.title || found.listingTitle || found.fbTitle || '').trim();
          // Only override when we either lack an explicit title/listingTitle, or
          // when the current searchTitle is just the short inventoryName (we want
          // to prefer the richer FB title in that case).
          const isShortName = searchTitle && task && task.inventoryName && searchTitle === String(task.inventoryName);
          if (prefer && (!task.title && !task.listingTitle || isShortName)) {
            try { console.log('[DnR Scheduled] Enriched title for title_search from saved listing', { inventoryName: task.inventoryName, enrichedTitle: prefer }); } catch (e) {}
            searchTitle = prefer;
          }
        }
      }
    } catch (e) {
      // ignore enrichment failures
    }
    const url =
      `https://www.facebook.com/marketplace/you/selling` +
      `?title_search=${encodeURIComponent(searchTitle)}` +
      `&ref=bookmarks&sk=you_selling`;
    // Block Active Sync/AAS before creating scheduled title_search tab
    try { try { window.__ffm_block_as = true; } catch (e) { try { globalThis.__ffm_block_as = true; } catch (e) {} } } catch (e) {}
    // Try to reuse an existing matching title_search tab first
    let tab = null;
    try {
      const tabs = await new Promise(r => { try { chrome.tabs.query({ url: '*://*.facebook.com/marketplace/you/selling*' }, r); } catch (e) { r([]); } });
      if (tabs && tabs.length) {
        for (const t of tabs) {
          try { if (t && t.url && t.url.indexOf('title_search=' + encodeURIComponent(searchTitle)) !== -1) { tab = t; break; } } catch (e) {}
        }
      }
    } catch (e) { tab = null; }

    if (!tab) {
      tab = await new Promise((res) => {
        try {
          chrome.tabs.create({ url, active: true }, (t) => {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { console.debug('[DnR Scheduled] chrome.tabs.create lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                return res(null);
              }
              res(t || null);
            } catch (e) { res(null); }
          });
        } catch (e) { res(null); }
      });
    }
    if (!tab || !tab.id) return { success: false, fallback: true, reason: 'open-failed' };
    const tabId = tab.id;
    try { console.log('[DnR Scheduled] Opened title_search tab', tabId); } catch (e) {}
    // Persist SDNR context for this helper tab so fallback handlers can look it up
    try {
      try { globalThis.__ffm_sdnrStateByTab = globalThis.__ffm_sdnrStateByTab || {}; } catch (e) { if (typeof __ffm_sdnrStateByTab === 'undefined') __ffm_sdnrStateByTab = {}; }
      try {
        // Find the saved listing object when available (prefer listingId or task.id)
        const savedListings = listings || [];
        const savedListing = savedListings.find(x =>
          (x && x.listingId && task && task.listingId && String(x.listingId) === String(task.listingId)) ||
          (x && x.id && task && task.listingId && String(x.id) === String(task.listingId)) ||
          (x && x.listingId && task && task.id && String(x.listingId) === String(task.id)) ||
          (x && x.id && task && task.id && String(x.id) === String(task.id))
        );

        const enrichedTitle = (savedListing && (savedListing.title || savedListing.listingTitle)) || task.listingTitle || task.inventoryName || searchTitle || '';

        // Determine canonical listingId
        const canonicalListingId = (savedListing && (savedListing.listingId || savedListing.id)) || task.listingId || task.id || null;

        // Save full SDNR context for this tab
        __ffm_sdnrStateByTab[tabId] = {
          title: enrichedTitle,
          inventoryName: (savedListing && savedListing.inventoryName) || task.inventoryName || null,
          listingId: canonicalListingId,
          taskId: task && task.id,
          scheduled: true,
          tabId
        };

        try {
          __ffm_lastScheduledDnRContext = {
            taskId: task && task.id,
            listingId: canonicalListingId,
            inventoryName: (savedListing && savedListing.inventoryName) || task.inventoryName || null,
            title: (savedListing && (savedListing.title || savedListing.listingTitle)) || enrichedTitle || null,
            scheduled: true
          };
          try { console.log('[SDNR] Stored last scheduled DnR context:', __ffm_lastScheduledDnRContext); } catch (e) {}
        } catch (e) {}

        try { console.log('[DnR Scheduled] Stored SDNR context:', __ffm_sdnrStateByTab[tabId]); } catch (e) {}
      } catch (e) {}
    } catch (e) {}
    // Debug: enumerate frames in the newly-created tab to help diagnose injection/frame context
    try {
      if (chrome && chrome.webNavigation && typeof chrome.webNavigation.getAllFrames === 'function') {
        try {
          chrome.webNavigation.getAllFrames({ tabId: tabId }, (frames) => {
            try { console.log('🧩 SDNR DEBUG — FRAMES IN TAB', { tabId, frames }); } catch (e) {}
          });
        } catch (e) { try { console.warn('🧩 SDNR DEBUG — getAllFrames threw', e); } catch (er) {} }
      } else {
        try { console.log('🧩 SDNR DEBUG — webNavigation.getAllFrames not available'); } catch (e) {}
      }
    } catch (e) {}

    // Attach tabId to task so callers can close it if needed
    try { if (task && typeof task === 'object') task.__ffm_search_tab = tabId; } catch (e) {}

    return new Promise((resolve) => {
      try {
        // Mark this waiter as a scheduled SDNR waiter so content_ready handlers
        // can avoid sending the legacy title_search fast-path message for scheduled runs.
        state.waitingForScheduledDnr = {
          tabId,
          task,
          resolve,
          scheduled: true,
          timeout: setTimeout(() => {
            try { console.warn('[DnR Scheduled] content_ready timeout → fallback'); } catch (e) {}
            try { state.waitingForScheduledDnr = null; } catch (e) {}
            resolve({ success: false, fallback: true, reason: 'timeout' });
          }, 8000)
        };
      } catch (e) { resolve({ success: false, fallback: true, reason: 'exception' }); }
    });
  } catch (e) { return { success: false, fallback: true, reason: 'exception' }; }
}

// Open or focus the extension popup and send a UI-triggered DnR message to it.
async function ffmTriggerPopupDnr(task) {
  try {
    const listingObj = { inventoryName: task.inventoryName, listingTitle: task.listingTitle, title: task.title || task.listingTitle || task.inventoryName };
    const popupUrl = chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('popup.html') : 'popup.html';
    // Create an ack token so popup can persist an ack and inflight marker
    const ackToken = task && task.id ? (String(task.id) + ':' + Math.random().toString(36).slice(2) + Date.now().toString(36)) : (Math.random().toString(36).slice(2) + Date.now().toString(36));
    try { if (task && task.id) chrome.storage.local.set({ ['ffm_schedule_ack_req_' + task.id]: { token: ackToken, ts: Date.now() } }); } catch (e) {}

    // Try to find an existing popup tab for our popup UI
    const tabs = await new Promise(res => { try { chrome.tabs.query({}, res); } catch (e) { res([]); } });
    const existing = (tabs || []).find(t => t && t.url && (t.url === popupUrl || t.url.indexOf(popupUrl) === 0));
    if (existing && existing.id) {
      try { safeTabsUpdate(existing.id, { active: true }); } catch (e) {}
      try {
        chrome.runtime.sendMessage({ action: 'ffm_trigger_ui_dnr', listing: listingObj, scheduleTaskId: task.id, ackToken }, (resp) => {});
      } catch (e) {}
      return { ok: true, method: 'existing', tabId: existing.id };
    }

    // Not found: do NOT open a new popup window. Attempt to send message anyway and return.
    try {
      chrome.runtime.sendMessage({ action: 'ffm_trigger_ui_dnr', listing: listingObj, scheduleTaskId: task.id, ackToken }, (resp) => {});
    } catch (e) {}
    return { ok: false, reason: 'no-popup-opened' };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// Listen for popup notifying that a scheduled DnR completed and clear the scheduled task/alarm
try {
  addSafeListener((message, sender, sendResponse) => {
    try {
      if (!message || message.action !== 'ffm_sdnr_complete' || !message.taskId) return;
      const taskId = message.taskId;
      try { console.log('[bg:SDNR] UI-DnR complete → clearing scheduled task', taskId); } catch (e) {}
      try { chrome.alarms.clear('ffm_schedule_' + taskId); } catch (e) {}
      // Unblock Active Sync/AAS now that the scheduled UI DnR completed
      try { try { window.__ffm_block_as = false; } catch (e) { try { globalThis.__ffm_block_as = false; } catch (e) {} } } catch (e) {}
      try {
        chrome.storage.local.get({ scheduled_tasks: [] }, (res) => {
          try {
            const arr = res.scheduled_tasks || [];
            const newArr = arr.filter(t => !(t && String(t.id) === String(taskId)));
            chrome.storage.local.set({ scheduled_tasks: newArr }, () => { try { sendResponse && sendResponse({ ok: true }); } catch (e) {} });
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        });
      } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
    } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
    return true;
  });
} catch (e) { console.debug('[bg] install ffm_sdnr_complete listener failed', e); }

// SDNR fallback: single, simple handler that reconstructs a string deleteTitle
try {
  // Global helper: normalize scheduled tasks for use by SDNR handler (top-level)
  async function normalizeTasksFromStorage() {
    try {
      const snap = await new Promise(res => chrome.storage.local.get({ scheduled_tasks: [] }, res));
      const arr = Array.isArray(snap && snap.scheduled_tasks) ? snap.scheduled_tasks : [];
      return (arr || []).map(t => ({
        id: t.id || t.taskId || (t.payload && t.payload.id) || null,
        taskId: t.taskId || t.id || (t.payload && t.payload.id) || null,
        listingId: t.listingId || (t.payload && t.payload.listingId) || null,
        inventoryName: t.inventoryName || (t.payload && t.payload.inventoryName) || null,
        listingTitle: t.listingTitle || (t.payload && t.payload.listingTitle) || null,
        action: t.action || (t.payload && t.payload.action) || 'relist',
        timeISO: t.timeISO || (t.payload && t.payload.timeISO) || null,
        when: t.when || (t.payload && t.payload.when) || null,
        payload: t.payload || null
      }));
    } catch (e) {
      console.warn('[bg] global normalizeTasksFromStorage failed', e);
      return [];
    }
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || msg.type !== 'ffm_sdnr_fallback') return;
      const tabId = (sender && sender.tab && typeof sender.tab.id === 'number') ? sender.tab.id : (msg && msg.tabId != null ? msg.tabId : null);
      if (!tabId) {
        try { console.warn('[SDNR] ffm_sdnr_fallback received without sender.tab'); } catch (e) {}
        return;
      }

      const ctx = (globalThis.__ffm_sdnrStateByTab && globalThis.__ffm_sdnrStateByTab[tabId]) ? globalThis.__ffm_sdnrStateByTab[tabId] : {};

      const deleteTitle =
        (msg.deleteTitle && String(msg.deleteTitle)) ||
        (msg.title && String(msg.title)) ||
        (ctx.title && String(ctx.title)) ||
        (msg.listingTitle && String(msg.listingTitle)) ||
        (msg.inventoryName && String(msg.inventoryName)) ||
        '';

      console.log('[SDNR] Fallback → Running selling scraper for:', deleteTitle);

      sendDeleteMessage(tabId, String(deleteTitle || ''), {
        type: 'ffm_run_delete_relist',
        scheduled: true,
        listingId: ctx.listingId || msg.listingId,
        inventoryName: ctx.inventoryName || msg.inventoryName,
        taskId: ctx.taskId,
        helperTabId: tabId
      });

      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      return true;
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.debug('[bg] install ffm_sdnr_fallback handler failed', e); }
// ------------------------------------------------------------------
// SDNR: Listen for explicit delete-complete from content_selling
// ------------------------------------------------------------------
try {
  chrome.runtime.onMessage.addListener(async (message, sender) => {
    try {
      const name = message && (message.type || message.action || message.cmd) ? (message.type || message.action || message.cmd) : null;
      if (name !== 'ffm_delete_complete') return;

      // 🧩 Scheduled Delete & Relist (SDNR) path
      if (message && message.scheduled) {
        console.log('[SDNR] Received delete-complete for scheduled DnR:', message);

        // Prefer per-tab SDNR state (if helperTabId is known)
        let ctx = null;
        try {
          if (message.helperTabId && typeof __ffm_sdnrStateByTab !== 'undefined' && __ffm_sdnrStateByTab) {
            ctx = __ffm_sdnrStateByTab[message.helperTabId] || null;
          }
        } catch (e) { ctx = null; }

        // Fall back to the last scheduled DnR context when appropriate
        try {
          if ((!ctx || !ctx.taskId) && typeof __ffm_lastScheduledDnRContext !== 'undefined' && __ffm_lastScheduledDnRContext) {
            if (!message.taskId || __ffm_lastScheduledDnRContext.taskId === message.taskId) {
              console.log('[SDNR] Using last scheduled DnR context for delete-complete');
              ctx = __ffm_lastScheduledDnRContext;
            }
          }
        } catch (e) {}

        // Synthesize context from the message if we still lack one
        if (!ctx) {
          ctx = {
            taskId: message.taskId || null,
            listingId: message.listingId || null,
            inventoryName: message.inventoryName || null,
            listingTitle: message.title || message.listingTitle || null,
            scheduled: true
          };
          try { console.log('[SDNR] Synthesized SDNR context from delete-complete msg:', ctx); } catch (e) {}
        }

        // If we still don't have a listingId, try to resolve it from saved listings
        if (!ctx.listingId) {
          try {
            const snap = await new Promise(res => { try { chrome.storage.local.get(['listings','ffmSavedListings','__ffm_saved_listings_cache'], res); } catch (e) { res({}); } });
            const candidates = [];
            if (Array.isArray(snap.listings)) candidates.push(...snap.listings);
            if (Array.isArray(snap.ffmSavedListings)) candidates.push(...snap.ffmSavedListings);
            if (Array.isArray(snap.__ffm_saved_listings_cache)) candidates.push(...snap.__ffm_saved_listings_cache);

            const match = (candidates || []).find(l => {
              try {
                if (!l) return false;
                if (ctx.inventoryName && (String(l.listingId) === String(ctx.inventoryName) || String(l.inventoryName) === String(ctx.inventoryName))) return true;
                if (ctx.listingTitle && l.title && String((l.title||'').trim()) === String((ctx.listingTitle||'').trim())) return true;
                return false;
              } catch (e) { return false; }
            });
            if (match) {
              ctx.listingId = match.listingId || match.id || null;
              try { console.log('[SDNR] Resolved listingId from saved listings:', ctx.listingId); } catch (e) {}
            }
          } catch (e) {
            console.warn('[SDNR] Error resolving listingId from saved listings:', e);
          }
        }

        if (!ctx.listingId) {
          console.debug('[SDNR] Missing listingId in SDNR context after delete-complete. Aborting publish.', ctx);
          return true;
        }

        // At this point we have a listingId and can safely publish
        console.log('[SDNR] Proceeding to publish after delete for listingId', ctx.listingId, 'taskId', ctx.taskId);

        // Release the delete phase guard so a subsequent publish phase may run.
        try {
          if (typeof self !== 'undefined' && self.__ffmActiveSDNRPhases && ctx.taskId) {
            try {
              self.__ffmActiveSDNRPhases.delete(`${ctx.taskId}:delete`);
              console.log('[SDNR] Released delete phase for', ctx.taskId);
              console.log('[SDNR] Phase transition', { taskId: ctx.taskId, from: 'delete', to: 'publish' });
            } catch (e) {}
          }
        } catch (e) {}

        // --- SDNR: delete-complete gating fix (ADS/Auto-DnR compatibility) ---
        // If no active run exists, but this delete-complete came from a scheduled
        // pipeline (ADS/Auto-DnR) and includes a listingId, adopt the incoming
        // context so the pipeline can continue to publishing. Otherwise ignore.
        try {
          const hasActiveRun = !!(globalThis.__ffmActiveSDnR && (globalThis.__ffmActiveSDnR.listingId || globalThis.__ffmActiveSDnR.taskId));

          if (!hasActiveRun) {
            // If this came from a scheduled pipeline (ADS / Scheduled DnR),
            // we MUST allow it to continue by adopting the context.
            if (message && message.scheduled && message.listingId) {
              const adopted = {
                taskId: message.taskId || null,
                listingId: message.listingId,
                inventoryName: message.inventoryName || null,
                listingTitle: message.title || message.listingTitle || null,
                scheduled: true,
                adoptedFromDeleteComplete: true,
                adoptedAt: Date.now()
              };

              // Set the active SDNR run context so subsequent logic proceeds
              // as if the run had been registered at kickoff.
              try { globalThis.__ffmActiveSDnR = adopted; } catch (e) {}

              try { console.warn('[SDNR] No active SDnR run — adopting scheduled delete-complete context:', adopted); } catch (e) {}
              // continue (do NOT return)
            } else {
              try { console.warn('[SDNR] Ignoring delete-complete: no active SDnR run'); } catch (e) {}
              return true;
            }
          }

          // mark progression to publishing stage
          try { if (globalThis.__ffmActiveSDnR) globalThis.__ffmActiveSDnR.stage = 'publishing'; } catch (e) {}
        } catch (e) {}

        try {
          // Stage the canonical saved listing under a unique publishRequestId then call publishListingById
          const listingIdToPublish = ctx.listingId;
          const taskId = ctx.taskId || null;
          if (!listingIdToPublish) {
            console.warn('[SDNR] delete-complete scheduled: missing listingId, cannot stage/publish', { message, ctx });
            return true;
          }

          const publishRequestId = `sdnr_${Date.now()}_${String(listingIdToPublish)}`;
          const stagedKey = `ffm_publish_${publishRequestId}`;

          try {
            // Load saved listings from storage and attempt to find the target listing
            const snap = await new Promise(res => { try { chrome.storage.local.get(['ffmSavedListings','__ffm_saved_listings_cache','listings'], res); } catch (e) { res({}); } });
            const pool = [];
            if (Array.isArray(snap.ffmSavedListings)) pool.push(...snap.ffmSavedListings);
            if (Array.isArray(snap.__ffm_saved_listings_cache)) pool.push(...snap.__ffm_saved_listings_cache);
            if (Array.isArray(snap.listings)) pool.push(...snap.listings);

            const target = (pool || []).find(l => {
              try {
                if (!l) return false;
                if (String(l.listingId) === String(listingIdToPublish)) return true;
                if (String(l.id) === String(listingIdToPublish)) return true;
                if (ctx.inventoryName && l.inventoryName && String(l.inventoryName) === String(ctx.inventoryName)) return true;
                return false;
              } catch (e) { return false; }
            });

            if (!target) {
              console.warn('[SDNR] Delete complete — could not find listing in saved listings to stage for publish', listingIdToPublish, { poolCount: (pool || []).length });
              return true;
            }

            // Stage under ffm_publish_<publishRequestId>
            await new Promise(res => { try { chrome.storage.local.set({ [stagedKey]: target }, () => res(true)); } catch (e) { res(true); } });
            try {
              // Also persist a tiny meta object to ensure publish-complete can reliably
              // enrich and match the saved listing even if the full staged payload is removed.
              const metaKey = 'ffm_publish_meta_' + publishRequestId;
                const meta = { inventoryName: target && (target.inventoryName || target.title || null), listingId: target && (target.listingId || target.id || null), taskId: taskId || null, ts: Date.now() };
                try { chrome.storage.local.set({ [metaKey]: meta }, () => {}); } catch (e) {}
            } catch (e) {}
            try { console.log('[SDNR] Delete complete — staged listing and launching publishListingById', { stagedKey, listingId: listingIdToPublish, taskId, publishRequestId }); } catch (e) {}

            // Trigger publish by the publishRequestId so publishListingById will read the staged key
            try { await publishListingById(publishRequestId); } catch (e) { console.error('[SDNR] publishListingById failed after staging', e); }

            // Wait for the publish phase to start before finalizing SDnR. If publish
            // does not start in time, retry once; then mark the task as stalled.
            try {
              const ok = await ffmAfterDeleteAndBeforeFinalize(ctx);
              if (!ok) {
                if (!ctx.__publishRetry) {
                  try { ctx.__publishRetry = true; console.log('[SDNR] Retrying publish handoff', ctx.taskId); } catch (e) {}
                  try { await publishListingById(publishRequestId); } catch (e) { console.error('[SDNR] publish retry failed', e); }
                  return;
                }

                try { console.error('[SDNR] Publish failed to start after retry — marking stalled', ctx.taskId); } catch (e) {}
                try { markDnRStalled(ctx); } catch (e) {}
                return;
              }
            } catch (e) { console.error('[SDNR] ffmAfterDeleteAndBeforeFinalize error', e); }
          } catch (e) {
            console.error('[SDNR] Error while staging listing for scheduled publish', e);
          }

        } catch (e) {
          console.error('[SDNR] Error during publish after delete:', e);
        }

        // Cleanup per-tab state and last-scheduled context when appropriate
        try {
          if (message.helperTabId && typeof __ffm_sdnrStateByTab !== 'undefined' && __ffm_sdnrStateByTab) {
            try { delete __ffm_sdnrStateByTab[message.helperTabId]; } catch (e) {}
          }
          if (typeof __ffm_lastScheduledDnRContext !== 'undefined' && __ffm_lastScheduledDnRContext && __ffm_lastScheduledDnRContext.taskId && ctx && __ffm_lastScheduledDnRContext.taskId === ctx.taskId) {
            __ffm_lastScheduledDnRContext = null;
          }
        } catch (e) {}

        // Notify popup that a scheduled DnR finished (so Support modal can show when debug enabled)
        (async () => {
          try {
            const invName = message && (message.title || message.inventoryName || message.listingTitle) ? (message.title || message.inventoryName || message.listingTitle) : null;
            const listingId = message && message.listingId ? message.listingId : null;
            let enabled = false;
            try {
              const out = await new Promise(res => { try { chrome.storage.local.get(['ffm_debuglog_enabled'], res); } catch (e) { res({}); } });
              enabled = !!(out && out.ffm_debuglog_enabled);
            } catch (e) { enabled = false; }

            const payload = { action: 'dnr-complete', inventoryName: invName, listingId: listingId, scheduled: true };
            if (!enabled) {
              try { console.log('[bg] debug disabled (sdnr) — not sending dnr-complete popup trigger', payload); } catch (e) {}
              return;
            }

            const popupUrl = chrome.runtime.getURL('popup.html') + '?full=1';
            try {
              const tabs = await new Promise(res => { try { chrome.tabs.query({ url: popupUrl }, res); } catch (e) { res([]); } });
              if (tabs && tabs.length) {
                console.log('[bg] found popup tabs -> will send sdnr dnr-complete with retries', { tabsCount: tabs.length, payload });
                for (let i=0;i<6;i++) {
                  try {
                    if (listingId && FFMPendingDnrAcks.has(String(listingId))) { console.log('[bg] ack seen for sdnr listing, breaking retries', listingId); break; }
                  } catch (e) {}
                  try { console.log('[bg] sdnr send attempt', i+1); chrome.runtime.sendMessage(payload); } catch (e) { console.debug('[bg] sdnr send attempt failed', e); }
                  await new Promise(r => setTimeout(r, 300));
                }
                return;
              }
            } catch (e) {}

            try {
              // Do NOT create a new popup window. Instead, retry sending the dnr-complete
              // message multiple times so an already-open popup (if present) can handle it.
              console.log('[bg] not creating popup for sdnr dnr-complete; will retry sends', { payload });
              for (let i=0;i<8;i++) {
                try {
                  if (listingId && FFMPendingDnrAcks.has(String(listingId))) { console.log('[bg] ack seen for sdnr listing during retry, breaking retries', listingId); break; }
                } catch (e) {}
                try { console.log('[bg] sdnr send retry', i+1); chrome.runtime.sendMessage(payload); } catch (e) { console.debug('[bg] sdnr send retry failed', e); }
                await new Promise(r => setTimeout(r, 400));
              }
            } catch (e) { try { chrome.runtime.sendMessage(payload); } catch (er) {} }
          } catch (e) {}
        })();

        return true;
      }

      // Non-scheduled delete-complete handling falls back to legacy behavior (ignored here)
      try {
        // Relay non-scheduled DnR completion to popup so UI can prompt for support upload
        (async () => {
          try {
            const invName = message && (message.title || message.inventoryName || message.listingTitle) ? (message.title || message.inventoryName || message.listingTitle) : null;
            const listingId = message && message.listingId ? message.listingId : null;
            // Check if debug collection is enabled; if so, open (or reuse) the popup and send the message so it will display the modal
            let enabled = false;
            try {
              const out = await new Promise(res => { try { chrome.storage.local.get(['ffm_debuglog_enabled'], res); } catch (e) { res({}); } });
              enabled = !!(out && out.ffm_debuglog_enabled);
            } catch (e) { enabled = false; }

            const payload = { action: 'dnr-complete', inventoryName: invName, listingId: listingId, scheduled: false };
            if (!enabled) {
              try { console.log('[bg] debug disabled — not sending dnr-complete popup trigger', payload); } catch (e) {}
              return;
            }

            const popupUrl = chrome.runtime.getURL('popup/popup.html') + '?full=1';
              try {
              // Try to find an existing popup tab with the popup URL
              const tabs = await new Promise(res => { try { chrome.tabs.query({ url: popupUrl }, res); } catch (e) { res([]); } });
              if (tabs && tabs.length) {
                console.log('[bg] found popup tabs -> will send dnr-complete with retries', { tabsCount: tabs.length, payload });
                // Send message (popup should be listening) with retries in case popup isn't initialized yet
                try {
                  for (let i=0;i<6;i++) {
                    try {
                      if (listingId && FFMPendingDnrAcks.has(String(listingId))) { console.log('[bg] ack seen for listing, breaking retries', listingId); break; }
                    } catch (e) {}
                    try { console.log('[bg] send attempt', i+1); chrome.runtime.sendMessage(payload); } catch (e) { console.debug('[bg] send attempt failed', e); }
                    await new Promise(r => setTimeout(r, 300));
                  }
                } catch (e) {}
                return;
              }
            } catch (e) {}

            // No existing popup tab: create one (non-focused) and send the message after a short delay
            try {
              // Do NOT create a new popup window. Retry sending the message several
              // times so an already-open popup (if present) can handle it.
              console.log('[bg] not creating popup for dnr-complete; will retry sends', { payload });
              for (let i=0;i<8;i++) {
                try {
                  if (listingId && FFMPendingDnrAcks.has(String(listingId))) { console.log('[bg] ack seen for listing during retry, breaking retries', listingId); break; }
                } catch (e) {}
                try { console.log('[bg] send retry after no-popup', i+1); chrome.runtime.sendMessage(payload); } catch (e) { console.debug('[bg] send retry failed', e); }
                await new Promise(r => setTimeout(r, 400));
              }
            } catch (e) {
              // Fallback: still try to send the message (may be ignored if popup not open)
              try { console.debug('[bg] popup create failed; attempting send anyway'); chrome.runtime.sendMessage(payload); } catch (er) {}
            }
          } catch (e) {}
        })();
      } catch (e) {}
      return;
    } catch (e) {
      console.debug('[bg] ffm_delete_complete handler error', e);
    }
    return false;
  });
} catch (e) { console.debug('[bg] install ffm_delete_complete listener failed', e); }

// ------------------------------------------------------------------
// SDNR: Close helper tab after publish-complete for scheduled publishes
// ------------------------------------------------------------------
// Helper: close the SDNR helper selling tab if tracked by scheduled or last SDNR contexts
async function closeSDNRHelperTab() {
  try {
    // Try a few known context variables (safe checks)
    const ctx =
      (typeof __ffm_lastScheduledDnRContext !== 'undefined' && __ffm_lastScheduledDnRContext) ? __ffm_lastScheduledDnRContext
      : (typeof lastScheduledSDNR !== 'undefined' && lastScheduledSDNR) ? lastScheduledSDNR
      : (typeof lastSDNR !== 'undefined' && lastSDNR) ? lastSDNR
      : null;

    if (!ctx || !ctx.tabId) {
      console.log("[SDNR] No helper tab to close.");
      return;
    }

    console.log("[SDNR] Closing helper selling tab:", ctx.tabId);
    try { await safeTabsRemove(Number(ctx.tabId)); } catch (e) { console.warn("[SDNR] chrome.tabs.remove error", e); }

    // Clear helper tab refs if present
    try { if (typeof __ffm_lastScheduledDnRContext !== 'undefined' && __ffm_lastScheduledDnRContext) __ffm_lastScheduledDnRContext.tabId = null; } catch (e) {}
    try { if (typeof lastScheduledSDNR !== 'undefined' && lastScheduledSDNR) lastScheduledSDNR.tabId = null; } catch (e) {}
    try { if (typeof lastSDNR !== 'undefined' && lastSDNR) lastSDNR.tabId = null; } catch (e) {}
  } catch (err) {
    console.warn("[SDNR] Failed to close helper tab:", err);
  }
}

// ------------------------------------------------------------------
// SDNR + ADS: handle ffm_publish_complete
//  - close SDNR helper tab
//  - enrich ADS rule history with publishDurationMs / totalDurationMs
// ------------------------------------------------------------------
try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      const name = message && (message.type || message.action || message.cmd)
        ? (message.type || message.action || message.cmd)
        : null;
      if (name !== 'ffm_publish_complete') return;

      // Always log + close SDNR helper tab
      try {
        console.log('[SDNR] ffm_publish_complete received', message);
        closeSDNRHelperTab();
      } catch (e) {}

      // Clear any synthetic SDnR active context for this listing (if present)
      try {
        const listingId = message && (message.listingId || message.inventoryName) ? (message.listingId || message.inventoryName) : null;
        if (listingId && globalThis.__ffmActiveSDnR && globalThis.__ffmActiveSDnR[String(listingId)]) {
          try { delete globalThis.__ffmActiveSDnR[String(listingId)]; console.log('[SDNR] Cleared synthetic active SDnR context for', listingId); } catch (e) {}
        }
        // Cleanup phase guard for publish phase if present
        try {
          const tId = message && message.taskId ? String(message.taskId) : null;
          if (tId && globalThis.__ffmActiveSDNRPhases) {
            try { globalThis.__ffmActiveSDNRPhases.delete(`${tId}:publish`); console.log('[SDNR] Finalized', tId); } catch (e) {}
          }
        } catch (e) {}
      } catch (e) {}

      // Only scheduled (ADS) publishes participate in history timing
      if (!message || !message.scheduled) return;

      (async () => {
        try {
          const publishRequestId =
            message.publishRequestId ||
            message.requestId ||
            message.publishId ||
            null;

          const listingId =
            message.listingId ||
            message.inventoryName ||
            null;

          const now = Date.now();

          // ---- 1) Load timing marker from storage (if any) ----
          let publishStart = null;
          if (publishRequestId) {
            const timingKey = 'ffm_publish_timing_' + String(publishRequestId);
            try {
              const res = await new Promise(r => {
                try { chrome.storage.local.get([timingKey], r); }
                catch (e) { r({}); }
              });
              const info = res && res[timingKey] ? res[timingKey] : null;
              if (info && typeof info.start === 'number') {
                publishStart = info.start;
              }
            } catch (e) {}
            // best-effort cleanup
            try { chrome.storage.local.remove([timingKey]); } catch (e) {}
          }

          const publishDurationMs = publishStart
            ? Math.max(0, now - publishStart)
            : 0;

          // ---- 2) Load ADS rules and find matching rule ----
          const snap = await new Promise(r => {
            try { chrome.storage.local.get([FFM_ADS_RULES_KEY], r); }
            catch (e) { r({}); }
          });
          const rulesMap = snap && snap[FFM_ADS_RULES_KEY]
            ? snap[FFM_ADS_RULES_KEY]
            : {};
          const keys = Object.keys(rulesMap || {});
          if (!keys.length) return;

          let rule = null;

          // Prefer direct key match by listingId
          if (listingId && rulesMap[listingId]) {
            rule = rulesMap[listingId];
          }

          // Fallback: scan rules for matching listingId/inventoryName
          if (!rule) {
            for (const k of keys) {
              const r = rulesMap[k];
              if (!r) continue;
              try {
                if (listingId &&
                  (String(r.listingId) === String(listingId) ||
                   String(r.inventoryName) === String(listingId))) {
                  rule = r;
                  break;
                }
              } catch (e) {}
            }
          }

          if (!rule) return;

          // ---- 3) Update the last history entry for this rule ----
          rule.history = Array.isArray(rule.history) ? rule.history : [];
          if (!rule.history.length) return;

          // Grab the most recent entry that *doesn't* already have publishDurationMs
          let rec = null;
          for (let i = rule.history.length - 1; i >= 0; i--) {
            const h = rule.history[i];
            if (!h) continue;
            // skip if already has publish timing
            if (typeof h.publishDurationMs === 'number' && h.publishDurationMs > 0) {
              continue;
            }
            // Optional safety window: ignore very old entries (> 1hr ago)
            const baseTs =
              h.createdAt ||
              h.deleteEndWallTimeMs ||
              h.time ||
              h.timestamp ||
              null;
            if (baseTs && (now - baseTs) > 60 * 60 * 1000) {
              continue;
            }
            rec = h;
            break;
          }

          if (!rec) return;

          // Attach publish + total timings
          rec.publishDurationMs = publishDurationMs;
          rec.publishStartWallTime = publishStart || null;
          rec.publishEndWallTime = now;

          const delMs = typeof rec.deleteDurationMs === 'number'
            ? rec.deleteDurationMs
            : 0;
          rec.totalDurationMs = delMs + publishDurationMs;

          // Persist back
          const keyForRule =
            rule.listingId ||
            rule.id ||
            listingId ||
            keys.find(k => rulesMap[k] === rule);

          if (keyForRule) {
            rulesMap[keyForRule] = rule;
            await new Promise(r => {
              try { chrome.storage.local.set({ [FFM_ADS_RULES_KEY]: rulesMap }, r); }
              catch (e) { r(); }
            });
          }

          try {
            console.log('[ADS History] Enriched publish timing for',
              listingId, 'durationMs =', publishDurationMs);
          } catch (e) {}
        } catch (err) {
          try { console.warn('[ADS History] Failed to enrich publish timing', err); } catch (e) {}
        }
      })();
    } catch (e) {
      console.debug('[bg] ffm_publish_complete handler error', e);
    }
  });
} catch (e) {
  console.debug('[bg] install ffm_publish_complete listener failed', e);
}

// Tiny listener: close the sending selling/helper tab after content reports delete-complete
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || msg.type !== 'ffm_close_this_tab_after_delete') return;
      const tabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
      if (!tabId) return;
      try { console.log('[SDNR] Closing helper selling tab →', tabId); } catch (e) {}

      // Prefer safeTabsRemove helper; just call it and ignore errors.
      try {
        try { safeTabsRemove(tabId).catch(()=>{}); } catch (e) {}
      } catch (e) {}

      return true;
    } catch (e) {}
  });
} catch (e) { console.debug('[bg] install ffm_close_this_tab_after_delete listener failed', e); }
// ------------------------------------------------------------------
// Background: authoritative permanent media delete
// ------------------------------------------------------------------
try {
  async function deleteMediaFromS3(key, opts) {
    return; // Cloud sync removed — AutoList Pro is local-only now.
    // eslint-disable-next-line no-unreachable
    const DEFAULT_AWS_API_BASE = 'https://9roa2qwu7e.execute-api.us-west-1.amazonaws.com/prod';
    if (!key) return;
    let k = String(key || '');
    try {
      if (/^[a-zA-Z]+:\/\//.test(k)) {
        try {
          const m = k.match(/(mobile\/|listings\/|metadata\/|users\/).*/);
          if (m && m[0]) k = m[0]; else {
            const u = new URL(k);
            k = (u.pathname || '') + (u.search || '') + (u.hash || '');
            if (k.startsWith('/')) k = k.slice(1);
          }
        } catch (e) {}
      }
    } catch (e) {}
    if (k.startsWith('/')) k = k.slice(1);
    const allowedPrefixes = ['mobile/', 'listings/', 'metadata/', 'users/'];
    if (!allowedPrefixes.some(p => k.startsWith(p))) {
      console.warn('[Media] deleteMediaFromS3: key not allowed, skipping cloud delete ->', key);
      return;
    }

    const base = await new Promise((res) => {
      try { chrome.storage.local.get(['ffm_aws_api_base'], (r) => res((r && r.ffm_aws_api_base) ? r.ffm_aws_api_base : DEFAULT_AWS_API_BASE)); } catch (e) { res(DEFAULT_AWS_API_BASE); }
    });

    try {
      // Try to include admin token / minAgeDays /apiKey and pass-through intent flags when available (mirror popup behaviour)
      let adminToken = null;
      let minAgeDaysVal = null;
      try {
        const stored = await new Promise((res) => {
          try { chrome.storage.local.get(['ffm_admin_delete_token','ffm_min_age_days','ffm_aws_api_base','ffm_aws_api_key'], (r) => res(r || {})); } catch (e) { res({}); }
        });
        if (stored && stored.ffm_admin_delete_token) adminToken = String(stored.ffm_admin_delete_token);
        if (stored && (typeof stored.ffm_min_age_days !== 'undefined')) minAgeDaysVal = Number(stored.ffm_min_age_days || 0);
      } catch (e) {}

      try {
        if (!adminToken) {
          if (typeof config !== 'undefined' && config.adminToken) adminToken = config.adminToken;
          else if (typeof CONFIG !== 'undefined' && CONFIG.adminToken) adminToken = CONFIG.adminToken;
          else if (typeof this !== 'undefined' && this.AutoListProConfig && this.AutoListProConfig.adminToken) adminToken = this.AutoListProConfig.adminToken;
        }
        if (minAgeDaysVal === null) {
          if (typeof config !== 'undefined' && typeof config.minAgeDays !== 'undefined') minAgeDaysVal = Number(config.minAgeDays || 0);
          else if (typeof CONFIG !== 'undefined' && typeof CONFIG.minAgeDays !== 'undefined') minAgeDaysVal = Number(CONFIG.minAgeDays || 0);
          else minAgeDaysVal = 0;
        }
      } catch (e) {}

      const url = base.replace(/\/$/, '') + '/delete-objects';
      const bodyObj = { keys: [k] };
      // Forward intent/confirmation from caller when present
      try {
        if (opts && typeof opts === 'object') {
          if (typeof opts.source !== 'undefined') bodyObj.source = opts.source;
          if (typeof opts.confirmed !== 'undefined') bodyObj.confirmed = opts.confirmed;
          if (typeof opts.listingId !== 'undefined') bodyObj.listingId = opts.listingId;
        }
      } catch (e) {}
      if (typeof minAgeDaysVal === 'number') bodyObj.minAgeDays = minAgeDaysVal;
      if (adminToken) bodyObj.adminToken = adminToken;

      // Attach API key header when available
      let apiKey = null;
      try {
        if (typeof config !== 'undefined' && config.apiKey) apiKey = config.apiKey;
        else if (typeof CONFIG !== 'undefined' && CONFIG.apiKey) apiKey = CONFIG.apiKey;
        else {
          // storage-backed key already fetched into `stored` above if present
          try { const stored2 = await new Promise((res) => { try { chrome.storage.local.get(['ffm_aws_api_key'], (r) => res(r || {})); } catch (e) { res({}); } }); if (stored2 && stored2.ffm_aws_api_key) apiKey = String(stored2.ffm_aws_api_key); } catch (e) {}
        }
      } catch (e) {}

      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj)
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => null);
        console.warn('[Media] delete-objects failed', resp.status, text);
      }
      return resp.ok;
    } catch (e) {
      console.warn('[Media] deleteMediaFromS3 failed', e);
      return false;
    }
  }

  // Single authoritative cloud delete helper (no local DB assumptions)
  async function deleteMediaPermanently({ mediaKey, listingId, source, confirmed } = {}) {
    const DEFAULT_AWS_API_BASE = 'https://9roa2qwu7e.execute-api.us-west-1.amazonaws.com/prod';
    if (!mediaKey) throw new Error('mediaKey required');

    const base = await new Promise((res) => {
      try { chrome.storage.local.get(['ffm_aws_api_base'], (r) => res((r && r.ffm_aws_api_base) ? r.ffm_aws_api_base : DEFAULT_AWS_API_BASE)); } catch (e) { res(DEFAULT_AWS_API_BASE); }
    });

    const url = base.replace(/\/$/, '') + '/delete-objects';
    const body = { paths: [String(mediaKey)] };
    if (typeof source !== 'undefined') body.source = source;
    if (typeof confirmed !== 'undefined') body.confirmed = confirmed;
    if (typeof listingId !== 'undefined') body.listingId = listingId;

    // Attach API key header when available
    let apiKey = null;
    try { const stored = await new Promise((res) => { try { chrome.storage.local.get(['ffm_aws_api_key'], (r) => res(r || {})); } catch (e) { res({}); } }); if (stored && stored.ffm_aws_api_key) apiKey = String(stored.ffm_aws_api_key); } catch (e) {}
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;

    // Try to delete DB record first (resolve by id or key), then delete cloud object.
    try {
      const db = (typeof globalThis !== 'undefined' && globalThis.ffmMediaDB) ? globalThis.ffmMediaDB : ((typeof self !== 'undefined' && self.ffmMediaDB) ? self.ffmMediaDB : (typeof ffmMediaDB !== 'undefined' ? ffmMediaDB : null));
      let resolvedRecord = null;
      if (db) {
        try {
          // Prefer a direct lookup if available
          if (typeof db.getByKey === 'function') {
            const rec = await db.getByKey(String(mediaKey)).catch(() => null);
            if (rec) resolvedRecord = rec;
          }

          // If not found, try scanning all records
          if (!resolvedRecord && typeof db.getAll === 'function') {
            const all = await db.getAll().catch(() => []);
            if (Array.isArray(all) && all.length) {
              resolvedRecord = all.find(r => {
                try {
                  if (!r) return false;
                  if (r.id && String(r.id) === String(mediaKey)) return true;
                  if (r.s3Key && String(r.s3Key) === String(mediaKey)) return true;
                  if (r.key && String(r.key) === String(mediaKey)) return true;
                  // match by listingId + filename
                  if (listingId && (r.listingId === listingId || r.listingName === listingId)) {
                    const fname = String(mediaKey).split('/').pop();
                    if (r.filename && String(r.filename) === fname) return true;
                    if (r.key && String(r.key).split('/').pop() === fname) return true;
                  }
                } catch (e) {}
                return false;
              }) || null;
            }
          }

          if (resolvedRecord) {
            try {
              if (resolvedRecord.id && typeof db.deleteMediaById === 'function') {
                await db.deleteMediaById(resolvedRecord.id).catch(() => {});
                try { console.log('[Media] Deleted from local DB (byId):', resolvedRecord.id, resolvedRecord); } catch (e) {}
              } else if (resolvedRecord.key && typeof db.deleteMediaByKey === 'function') {
                await db.deleteMediaByKey(resolvedRecord.key).catch(() => {});
                try { console.log('[Media] Deleted from local DB (byKey):', resolvedRecord.key); } catch (e) {}
              } else if (resolvedRecord.key && typeof db.deleteMedia === 'function') {
                await db.deleteMedia(resolvedRecord.key).catch(() => {});
                try { console.log('[Media] Deleted from local DB (deleteMedia):', resolvedRecord.key); } catch (e) {}
              } else {
                console.warn('[Media] No suitable DB delete method found; resolvedRecord present but cannot delete', resolvedRecord);
              }
            } catch (e) {
              console.warn('[Media] DB delete attempt failed', e);
            }
          } else {
            try { console.log('[Media] No MediaDB record found for key:', mediaKey); } catch (e) {}
          }
        } catch (e) {
          console.warn('[Media] MediaDB resolve error', e);
        }
      } else {
        try { console.warn('[Media] MediaDB not available in background; skipping DB resolve'); } catch (e) {}
      }
    } catch (e) {
      console.warn('[Media] pre-delete DB cleanup error', e);
    }

    // Cloud deletion removed — AutoList Pro is local-only now; the local DB
    // record above has already been deleted, which is all that's needed.

    // Notify popup/UI that media was deleted so it can refresh
    try {
      chrome.runtime.sendMessage({ type: 'ffm_media_deleted', s3Key: String(mediaKey), listingId });
    } catch (e) {}

    return true;
  }

  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
      try {
        if (!msg || msg.action !== 'ffm_delete_media_permanent') return false;
        const { mediaKey, listingId, source, confirmed } = msg || {};
        try { console.log('[Media] Permanently deleting media (authoritative):', mediaKey, { source, confirmed, listingId }); } catch (e) {}

        try {
          await deleteMediaPermanently({ mediaKey, listingId, source, confirmed });
          try { console.log('[Media] Permanent delete complete:', mediaKey); } catch (e) {}
        } catch (e) {
          console.error('[Media] Permanent delete failed for', mediaKey, e && String(e));
        }
      } catch (e) {
        console.warn('[Media] ffm_delete_media_permanent handler error', e);
      }
      return false;
    });
  }
} catch (e) { console.warn('[Media] install delete handler failed', e); }
// Handler: delete a user's Marketplace listing by title (used for Delete/Relist flow)
try {
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    try {
      if (!msg || msg.cmd !== 'ffmDeleteListing') return;
      const title = msg.title || '';
      try {
        // --- SINGLE REPLACEMENT: Try Title-Search fast-path first ---
        try {
          // Build a best-effort listing object (popup stages full payload under ffm_staged_listing)
          const stored = await new Promise(res => { try { chrome.storage.local.get(['ffm_staged_listing'], r => res(r || {})); } catch (e) { res({}); } });
          const staged = stored && stored.ffm_staged_listing ? stored.ffm_staged_listing : null;
          // FIX (2026-07-17): only trust `staged` if it's actually ABOUT the
          // title we were asked to delete. The previous version blindly did
          // `Object.assign({}, staged, {title: staged.title || title})` —
          // any leftover ffm_staged_listing from a DIFFERENT listing (left
          // over from other activity, or another caller) would silently win
          // over the title actually requested here, causing this handler to
          // search-and-delete an unrelated listing instead. Confirmed to have
          // happened in production. A stale/mismatched staged listing is now
          // ignored entirely rather than partially trusted.
          const normTitleForMatch = (s) => (s || '').toString().trim().toLowerCase();
          const stagedMatchesRequestedTitle = !!(staged && typeof staged === 'object' && staged.title &&
            normTitleForMatch(staged.title) === normTitleForMatch(title));
          const listingObj = stagedMatchesRequestedTitle ? staged : { title };

            try {
              const fastResp = await ffmBeginDNRFlow_TitleFirst(listingObj);
              if (fastResp && fastResp.success) {
                try { sendResponse && sendResponse({ ok: true, fastPath: true }); } catch (e) {}
                return true;
              }
              // If fastResp indicates fallback, continue to the fallback path below.
              // If fastResp is nullish, also continue to fallback.
            } catch (e) {
              try { console.warn('[bg] ffmBeginDNRFlow_TitleFirst threw, falling back', e); } catch (er) {}
            }

          // Try to use the newest selling tab (and close older ones). Fallback to creating a new tab.
          const existing = await ffmGetFreshSellingTab();
          if (existing && existing.id) {
            try { console.debug('[bg] reusing selling tab', existing.id); } catch (e) {}
            try {
              // Ensure the window containing the tab is not minimized so clicks
              // and modals are interactable even when the extension cannot steal focus.
              try { await ensureWindowNotMinimized(existing.id); } catch (e) {}
              // Force-activate the tab so programmatic clicks in the delete flow work
              // even when the extension has no user gesture active. Prefer direct
              // chrome.tabs.update, falling back to safeTabsUpdate if unavailable.
              try {
                await new Promise(res => { try { chrome.tabs.update(existing.id, { active: true }, res); } catch (e) { res(null); } });
              } catch (e) {
                try { safeTabsUpdate(existing.id, { active: true }); } catch (ee) {}
              }
            } catch (e) {}
            try { sendDeleteMessage(existing.id, String(title || '')); } catch (e) {}
          } else {
            try {
              const tab = await new Promise(res => { try { chrome.tabs.create({ url: 'https://www.facebook.com/marketplace/you/selling', active: true }, (t) => res(t)); } catch (e) { res(null); } });
              try { if (tab && tab.id) { console.log('[bg] opened selling page for', title, 'tab:', tab && tab.id); setTimeout(() => { try { sendDeleteMessage(tab.id, String(title || '')); } catch (e) {} }, 5000); } } catch (e) {}
            } catch (e) {}
          }
        } catch (e) {}
        return;
      } catch (e) { try { console.debug('[bg] ffmDeleteListing open tab failed', e); } catch (er) {} }

      // If we couldn't message a content script, run the helper as a fallback
      try {
        const res = await deleteListingByTitle(title);
        try { sendResponse(res); } catch (e) {}
      } catch (e) { try { sendResponse({ success: false, error: String(e) }); } catch(_){} }

      return true;
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.debug('[bg] install ffmDeleteListing handler failed', e); }

// Notify content script on Facebook Selling page when the tab finishes loading
try {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    try {
      if (!changeInfo || changeInfo.status !== 'complete') return;
      const url = tab && tab.url ? String(tab.url) : '';
      if (!url) return;
      if (url.indexOf('/marketplace/you/selling') !== -1) {
        try {
          // Respect global toggle to avoid auto-running scrapers on tab load.
          if (!FFM_AUTO_RUN_ON_TAB_LOAD) return;
          // Use safe wrapper to avoid runtime.lastError noise and to avoid accidental async listener claims.
          try {
            ffmSafeSendMessage(tabId, { action: 'ffmActiveListingsAuto' }).then((resp) => {
              try {
                if (!resp) {
                  try { console.warn('[bg] could not reach content script on tab', tabId); } catch (e) {}
                } else {
                  try { console.debug('[bg] ffmActiveListingsAuto message sent to tab', tabId); } catch (e) {}
                }
              } catch (e) {}
            }).catch(() => {});
          } catch (e) {}
        } catch (e) {}
      }
    } catch (e) {}
  });
} catch (e) { console.debug('[bg] failed to install tabs.onUpdated listener for active listings', e); }

// Retry queued media delivery when an edit tab finishes loading
try {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    try {
      if (!changeInfo || changeInfo.status !== 'complete') return;
      try {
        if (!globalThis.__ffm_pending_media_for_tab) return;
        const pending = globalThis.__ffm_pending_media_for_tab[String(tabId)];
        if (!pending) return;
        try { console.log('[AutoList Pro bg] onUpdated: tab completed, attempting queued media delivery for tab', tabId); } catch (e) {}

        // Prefer registered port
        try {
          const port = (globalThis.__ffm_content_ports_by_tab && typeof globalThis.__ffm_content_ports_by_tab.get === 'function') ? globalThis.__ffm_content_ports_by_tab.get(tabId) : ((typeof __ffm_content_ports_by_tab !== 'undefined' && __ffm_content_ports_by_tab[String(tabId)]) ? __ffm_content_ports_by_tab[String(tabId)] : null);
          if (port) {
            try {
              port.postMessage({ action: 'ffm_from_published_media_result', data: pending });
              try { console.log('[AutoList Pro bg] onUpdated: delivered queued media via port to tab', tabId); } catch (e) {}
              return;
            } catch (e) { try { console.warn('[AutoList Pro bg] onUpdated: port.postMessage failed', tabId, e && (e.message||e)); } catch(_){} }
          }
        } catch (e) {}

        // Try sendMessage
        try {
          chrome.tabs.sendMessage(tabId, { action: 'ffm_from_published_media_result', data: pending }, (resp) => {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { console.warn('[AutoList Pro bg] onUpdated: sendMessage failed for queued media', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                // Try a temporary port connect
                try {
                  const tmpPort = chrome.tabs.connect && chrome.tabs.connect(tabId, { name: 'ffm_content_port' });
                  if (tmpPort) {
                    try { tmpPort.postMessage({ action: 'ffm_from_published_media_result', data: pending }); } catch (e) {}
                    try { console.log('[AutoList Pro bg] onUpdated: delivered queued media via tmp port to tab', tabId); } catch (e) {}
                    try { delete globalThis.__ffm_pending_media_for_tab[String(tabId)]; } catch (e) {}
                    setTimeout(() => { try { tmpPort.disconnect(); } catch (e) {} }, 2000);
                  }
                } catch (e) {}
              } else {
                try { console.log('[AutoList Pro bg] onUpdated: queued media delivered to tab', tabId); } catch (e) {}
                try { delete globalThis.__ffm_pending_media_for_tab[String(tabId)]; } catch (e) {}
              }
            } catch (e) {}
          });
        } catch (e) { try { console.warn('[AutoList Pro bg] onUpdated: sendMessage threw', e); } catch(_){} }
      } catch (e) {}
    } catch (e) {}
  });
} catch (e) { try { console.debug('[AutoList Pro bg] failed to install onUpdated retry listener', e); } catch(_){} }


// Helper: perform delete automation for a given listing title. Returns a result object.
async function deleteListingByTitle(titleToMatch) {
  try {
    const title = titleToMatch || '';
    console.log(`[AutoList Pro] Deleting listing: ${title}`);
    let tab = null;
    let createdTab = false;
    try {
      // Prefer the cached active listings tab id if present
      try {
        const stored = await new Promise(res => { try { chrome.storage.local.get(['ffmActiveTabId'], r => res(r || {})); } catch (e) { res({}); } });
        const ffmActiveTabId = stored && stored.ffmActiveTabId;
        if (ffmActiveTabId) {
          try {
            const maybeTab = await new Promise(res => { try { chrome.tabs.get(ffmActiveTabId, res); } catch (e) { res(null); } });
            if (maybeTab && maybeTab.id) {
              tab = maybeTab;
              try { console.debug('[AutoList Pro bg] Reusing cached active listings tab ->', tab.id); } catch (e) {}
            }
          } catch (e) { /* ignore missing cached tab */ }
        }
      } catch (e) { /* ignore storage read errors */ }

      // If no cached tab, query for any matching selling tab and prefer ready ones
      if (!tab || !tab.id) {
        const tabs = await new Promise((res) => { try { chrome.tabs.query({ url: '*://*.facebook.com/marketplace/you/selling*' }, (r) => res(r || [])); } catch (e) { res([]); } });
        if (tabs && tabs.length) {
          const readyMatch = tabs.find(t => t && typeof t.id === 'number' && readyTabs && readyTabs.has(t.id));
          tab = readyMatch || tabs[0];
          try { console.debug('[AutoList Pro bg] Reusing existing selling tab ->', tab && tab.id); } catch (e) {}
        }
      }
    } catch (e) { console.debug('[AutoList Pro bg] error querying tabs for selling', e); }

    if (!tab || !tab.id) {
      // no reusable tab found — open a new one
      tab = await safeTabsCreate({ url: 'https://www.facebook.com/marketplace/you/selling', active: true });
      createdTab = true;
    }
    if (!tab || !tab.id) { return { success: false, error: 'tab-open-failed' }; }
    await new Promise(r => setTimeout(r, createdTab ? 7000 : 2500));
    try { await ensureWindowNotMinimized(tab.id); } catch (e) {}

    // Ensure content script is ready in the tab before injecting delete logic
    try {
      const ready = await waitForContentReady(tab.id);
      if (!ready) {
        console.error('[AutoList Pro bg] Content script not ready, aborting delete for', title);
            try {
              if (createdTab && tab && tab.id) {
                try { await safeTabsRemove(tab.id); } catch (e) { /* ignore */ }
              }
            } catch (e) {}
        return { success: false, error: 'content-not-ready' };
      }
      try { console.debug('[AutoList Pro bg] Content ready, executing delete script in tab', tab.id); } catch (e) {}
    } catch (e) { /* continue to attempt executeScript as fallback */ }

    // Inject deleter script and run
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (titleToMatchInner) => {
          const sleep = ms => new Promise(res => setTimeout(res, ms));
          const normalize = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const titleNorm = normalize(titleToMatchInner);
          const debug = [];
          const log = msg => { debug.push(msg); console.log("[AutoList Pro-debug]", msg); };

          try {
            log(`Starting delete automation for "${titleNorm}"`);
            for (let i = 0; i < 20; i++) {
              const header = Array.from(document.querySelectorAll("h1"))
                .find(h => normalize(h.innerText).includes("your listings"));
              if (header) { log("✅ Found 'Your listings' header"); break; }
              await sleep(500);
            }
            let cards = [];
            for (let i = 0; i < 40; i++) {
              cards = Array.from(document.querySelectorAll('div[aria-label][role="button"][tabindex="0"]'))
                .filter(el => normalize(el.getAttribute("aria-label")).length > 5);
              if (cards.length > 0) break;
              await sleep(500);
            }

            // Debug: dump candidate card aria-labels so maintainers can see how FB renders each listing
            if (cards.length) {
              console.log("[AutoList Pro-debug] Found", cards.length, "candidate cards:");
              cards.slice(0, 15).forEach((el, i) => {
                try {
                  console.log(`   #${i+1}:`, el.getAttribute("aria-label"));
                } catch (e) { /* ignore logging errors for weird nodes */ }
              });
            } else {
              console.log("[AutoList Pro-debug] No candidate cards found yet.");
            }

            if (!cards.length) return { status: "no-cards", debug };
            const targetCard = cards.find(el => normalize(el.getAttribute("aria-label")).includes(titleNorm));
            if (!targetCard) return { status: "no-match", debug };
            log(`✅ Found listing card for "${titleNorm}"`);
            targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
            let moreBtn = null;
            // First try finding a button inside the card itself (more robust across markup changes)
            for (let i = 0; i < 15; i++) {
              try {
                const candidates = Array.from((targetCard.querySelectorAll('div[role="button"], button, a, span')) || []);
                moreBtn = candidates.find(el => {
                  try {
                    const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
                    const titleAttr = (el.getAttribute && el.getAttribute('title')) || '';
                    const txt = (el.innerText || '').toString().toLowerCase();
                    const probe = (aria + '|' + titleAttr + '|' + txt).toLowerCase();
                    if (probe.includes('more options') || probe.includes('more actions') || probe.includes('options') || probe.includes('actions')) return true;
                    // symbol-only buttons (three dots) — check textContent for common ellipsis markers
                    const sym = (el.textContent || '') + '';
                    if (/\.{3}|•••|⋯/.test(sym)) return true;
                    // fallback: svg kebab/ellipsis icon present
                    try { if (el.querySelector && el.querySelector('svg')) { return true; } } catch (e) {}
                  } catch (e) {}
                  return false;
                });
              } catch (e) {}
              if (moreBtn) break;
              await sleep(500);
            }
            // If no button found inside the card, try a looser global aria-label search
            if (!moreBtn) {
              for (let i = 0; i < 10; i++) {
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
                if (moreBtn) break; await sleep(400);
              }
            }
            if (!moreBtn) return { status: "no-more-btn", debug };
            log("✅ Found 'More options' button, clicking...");
            try { moreBtn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
            try { moreBtn.click(); } catch (e) {}
            let deleteOption = null;
            for (let i = 0; i < 30; i++) {
              deleteOption = Array.from(document.querySelectorAll('div[role="menuitem"], span[dir="auto"], div[role="button"]'))
                .find(el => /delete/i.test(normalize(el.innerText)));
              if (deleteOption) break; await sleep(400);
            }
            if (!deleteOption) return { status: "no-delete-option", debug };
            log("✅ Found 'Delete Listing' option, clicking...");
            deleteOption.scrollIntoView({ behavior: "smooth", block: "center" }); deleteOption.click();
            try { ffmToast && ffmToast("🕓 Deleting listing — please wait...", "info"); } catch (e) {}
            debug.push("⏳ Waiting for 'Delete listing' modal...");
            for (let i = 0; i < 40; i++) {
              const modalHeader = Array.from(document.querySelectorAll("span, h2, div"))
                .find(el => (el.textContent || '').trim().toLowerCase() === 'delete listing');
              if (modalHeader && modalHeader.offsetParent !== null) {
                debug.push("✅ 'Delete listing' modal detected.");
                try { ffmToast && ffmToast("🖱️ Confirming deletion...", "info"); } catch (e) {}
                await sleep(600);
                break;
              }
              await sleep(300);
            }

            // --- DELETE CONFIRMATION MODAL HANDLER ---
            debug.push("⏳ Waiting for 'Delete listing' modal...");
            for (let i = 0; i < 40; i++) {
              const modalHeader = Array.from(document.querySelectorAll("span, h2, div"))
                .find(el => (el.textContent || '').trim().toLowerCase() === 'delete listing');
              if (modalHeader && modalHeader.offsetParent !== null) {
                debug.push("✅ 'Delete listing' modal detected.");
                try { ffmToast && ffmToast("🖱️ Confirming deletion...", "info"); } catch (e) {}
                await sleep(600);
                break;
              }
              await sleep(300);
            }

            // Try both aria-label and visible span matches for Delete button
            let confirmBtn = Array.from(document.querySelectorAll("div[role='button'], button, span"))
              .find(el => {
                try {
                  const aria = (el.getAttribute && el.getAttribute('aria-label'))?.toLowerCase() || '';
                  const text = (el.innerText || '').trim().toLowerCase();
                  return el.offsetParent !== null && (
                    aria === 'delete' ||
                    text === 'delete' ||
                    text.includes('delete')
                  );
                } catch (e) { return false; }
              });

            if (confirmBtn) {
              debug.push("🖱️ Clicking confirm Delete button...");
              try { confirmBtn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
              await sleep(200);
              // robust click sequence
              ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
                try { confirmBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
              });
              await sleep(1000);
            } else {
              debug.push("⚠️ Confirm Delete button not found — searching aria-label fallback...");
              const fallback = document.querySelector("div[aria-label='Delete'][role='button']");
              if (fallback) {
                debug.push("🖱️ Fallback: clicking aria-labeled Delete button");
                try { fallback.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
                await sleep(200);
                ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
                  try { fallback.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
                });
                await sleep(1000);
              } else {
                debug.push("❌ No Delete button detected.");
              }
            }

            // Verify modal closed
              // Additional handling: some flows show a follow-up "Did you sell this item?" modal.
              // If present, choose "I'd rather not answer" and proceed, otherwise fall back to closing the modal.
              try {
                // short wait for any follow-up modal to appear
                await sleep(600);
                for (let j = 0; j < 6; j++) {
                  // Detect the follow-up prompt
                  const prompt = Array.from(document.querySelectorAll('div, span, h2, p'))
                    .find(el => (el.textContent || '').trim().toLowerCase().includes('did you sell this item'));
                  if (prompt) {
                    debug.push("ℹ️ Detected 'Did you sell this item?' follow-up modal.");
                    // Look for option labels matching "i'd rather not answer" (sometimes variations exist)
                    const optTextCandidates = ["i'd rather not answer", "i’d rather not answer", "i'd rather not say", "prefer not to answer", "i'd rather not answer."];
                    let chosen = null;
                    try {
                      // Try label or span matches
                      const opts = Array.from(document.querySelectorAll('label, span, div'));
                      for (const o of opts) {
                        const t = (o.textContent || '').trim().toLowerCase();
                        if (!t) continue;
                        for (const cand of optTextCandidates) {
                          if (t === cand || t.includes(cand)) {
                            // find clickable parent
                            let el = o;
                            // if associated input exists, click that
                            try {
                              const forAttr = o.getAttribute && o.getAttribute('for');
                              if (forAttr) {
                                const input = document.getElementById(forAttr);
                                if (input) { input.click(); chosen = o; break; }
                              }
                            } catch (e) {}
                            try { o.click(); chosen = o; break; } catch (e) {}
                          }
                        }
                        if (chosen) break;
                      }
                      // If not found, try radio inputs + nearby labels
                      if (!chosen) {
                        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                        for (const r of radios) {
                          try {
                            const parentText = (r.closest('label') && (r.closest('label').textContent || '')) || (r.parentElement && r.parentElement.textContent) || '';
                            const pt = parentText.trim().toLowerCase();
                            for (const cand of optTextCandidates) {
                              if (pt === cand || pt.includes(cand)) {
                                try { r.click(); chosen = r; break; } catch (e) {}
                              }
                            }
                          } catch (e) {}
                          if (chosen) break;
                        }
                      }
                    } catch (e) { debug.push('⚠️ follow-up option selection error: ' + String(e)); }

                    if (chosen) {
                      debug.push("✅ Selected 'I'd rather not answer' option.");
                      // Try to click Next/Continue/Done
                      const nextBtn = Array.from(document.querySelectorAll('div[role="button"], button, span'))
                        .find(el => {
                          try {
                            const txt = (el.innerText || '').trim().toLowerCase();
                            return el.offsetParent !== null && (txt === 'next' || txt === 'continue' || txt === 'done' || txt === 'submit' || txt === 'finish');
                          } catch (e) { return false; }
                        });
                      if (nextBtn) {
                        try { nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
                        try { nextBtn.click(); debug.push('🖱️ Clicked Next on follow-up modal'); } catch (e) { debug.push('⚠️ Next click failed: ' + String(e)); }
                        await sleep(600);
                      }
                    } else {
                      debug.push("⚠️ Couldn't auto-select 'I'd rather not answer' option.");
                      // fallback: click Close (X) button if available
                      try {
                        const closeBtn = Array.from(document.querySelectorAll('div[aria-label], div[role="button"]'))
                          .find(el => {
                            try { const a = (el.getAttribute && el.getAttribute('aria-label')) || ''; return a.toString().toLowerCase().includes('close') || a.toString().toLowerCase().includes('dismiss'); } catch (e) { return false; }
                          });
                        if (closeBtn) {
                          try { closeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
                          try { closeBtn.click(); debug.push('🖱️ Clicked Close (fallback) on follow-up modal'); } catch (e) { debug.push('⚠️ Close click failed: ' + String(e)); }
                          await sleep(400);
                        }
                      } catch (e) { debug.push('⚠️ close fallback error: ' + String(e)); }
                    }
                    break;
                  }
                  await sleep(250);
                }
              } catch (e) { debug.push('⚠️ follow-up modal handling error: ' + String(e)); }

            for (let i = 0; i < 25; i++) {
              const stillThere = Array.from(document.querySelectorAll('span, h2'))
                .some(el => (el.textContent || '').trim().toLowerCase() === 'delete listing');
              if (!stillThere) {
                debug.push("✅ Modal closed — listing deleted successfully.");
                try { ffmToast && ffmToast("✅ Listing deleted successfully!", "success"); } catch (e) {}
                return { status: "delete-complete", debug, title: titleToMatchInner };
              }
              await sleep(300);
            }
            debug.push("⚠️ Modal still visible after attempt — delete may have failed.");
            return { status: "delete-stuck", debug, title: titleToMatchInner };
          } catch (err) { log("❌ Exception: " + err.toString()); return { status: "error", debug, message: err.toString() }; }
        },
        args: [title]
      });
      const result = results && results[0] && (results[0].result || results[0]);
      console.log('[AutoList Pro bg] delete pageResult ->', result);
      await new Promise(r => setTimeout(r, 1200));
            try {
              if (createdTab && tab && tab.id) {
                try { safeTabsRemove(tab.id).catch(()=>{}); } catch (e) { /* fallback ignored */ }
              }
            } catch (e) {}
      if (result && (result.status === 'deleted' || result.status === 'delete-success' || result.status === 'delete-complete')) return { success: true, detail: result };
      return { success: false, detail: result };
    } catch (e) { console.debug('[bg] executeScript delete failed', e); return { success: false, error: String(e) }; }
  } catch (err) { console.error('[AutoList Pro] Delete failed', err); return { success: false, error: String(err) }; }
}

// Listen for popup-initiated request to start CFST select mode.
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.action) return;
      if (msg.action === 'ffm_start_select_mode_popup') {
        try { console.log('[AutoList Pro bg] CFST triggered from popup'); } catch (e) {}

        // If the popup explicitly asked to open a NEW tab, do so unconditionally
        if (msg && msg.openNew) {
          try {
            // Check if popup recently set a create marker in local storage to avoid duplicate opens
            try {
              chrome.storage.local.get(['ffm_recent_create_sharetown_tab'], (res) => {
                try {
                  const ts = res && (res.ffm_recent_create_sharetown_tab || 0);
                  const age = ts ? (Date.now() - Number(ts || 0)) : null;
                  if (age != null && age >= 0 && age < 5000) {
                    try { console.log('[AutoList Pro bg] skipping openNew — recent popup create marker present (age ms)', age); } catch (e) {}
                    try { sendResponse && sendResponse({ ok: true, skipped: true, reason: 'recent-popup' }); } catch (e) {}
                    return;
                  }

                  const url = 'https://app.sharetown.io/inventory/inventory-list?status=for_sale&hasSearchOpened=false';
                  chrome.tabs.create({ url: url, active: true }, (tab) => {
                    try {
                      if (!tab || !tab.id) { try { sendResponse && sendResponse({ ok: false, error: 'tab-open-failed' }); } catch (e) {} return; }
                      const tabId = tab.id;
                      try { setTimeout(() => { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }, () => {}); }, 800); } catch (e) {}
                      try { sendResponse && sendResponse({ ok: true, opened: true }); } catch (e) {}
                    } catch (e) { try { console.error('[AutoList Pro bg] openNew handler error', e); } catch (er) {} }
                  });
                } catch (e) { try { console.error('[AutoList Pro bg] openNew storage check failed', e); } catch (er) {} }
              });
            } catch (e) { try { console.error('[AutoList Pro bg] openNew storage get failed', e); } catch (er) {} }
          } catch (e) { try { console.error('[AutoList Pro bg] openNew create tab failed', e); } catch (er) {} }
          return true;
        }

        // Open or focus Sharetown tab (use helper so behavior is consistent)
        try {
          // Check session-scoped flag to avoid duplicate openers (popup may already be launching)
          try {
            if (chrome && chrome.storage && chrome.storage.session && typeof chrome.storage.session.get === 'function') {
              chrome.storage.session.get(['CFST_ACTIVE'], (res) => {
                try {
                  const active = res && res.CFST_ACTIVE;
                  if (active) {
                    try { console.log('[AutoList Pro bg] CFST_ACTIVE set — background will skip opening Sharetown tab'); } catch (e) {}
                    try { sendResponse && sendResponse({ ok: true, skipped: true }); } catch (e) {}
                    return;
                  }

                  // Mark session so other contexts know background is launching
                  try { chrome.storage.session.set({ CFST_ACTIVE: true }, () => { try { console.log('[AutoList Pro bg] session flag CFST_ACTIVE set by background opener'); } catch (e) {} }); } catch (e) {}

                  // Perform the open/focus
                  openSharetownInventory({ active: true }).then((tab) => {
                    try {
                      if (!tab || !tab.id) { try { sendResponse && sendResponse({ ok: false, error: 'tab-open-failed' }); } catch (e) {} return; }
                      const tabId = tab.id;
                      if (readyTabs.has(tabId)) {
                        try { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }); } catch (e) {}
                      } else {
                        try { pendingStartTabs.add(tabId); } catch (e) {}
                        setTimeout(() => { try { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }); } catch (e) {} }, 2500);
                      }
                    } catch (e) {}
                    finally {
                      // Clear the session marker after a short window so it doesn't block future launches
                      try { setTimeout(() => { try { chrome.storage.session.remove('CFST_ACTIVE'); try { console.log('[AutoList Pro bg] session flag CFST_ACTIVE cleared by background opener'); } catch (e) {} } catch (e) {} }, 3000); } catch (e) {}
                    }
                  }).catch(() => {
                    try { chrome.storage.session.remove('CFST_ACTIVE'); } catch (e) {}
                  });
                } catch (e) { try { console.error('[AutoList Pro bg] ffm_start_select_mode handler error', e); } catch (er) {} }
              });
            } else {
              // Fallback: no session storage available — just open
              openSharetownInventory({ active: true }).then((tab) => {
                try {
                  if (!tab || !tab.id) { try { sendResponse && sendResponse({ ok: false, error: 'tab-open-failed' }); } catch (e) {} return; }
                  const tabId = tab.id;
                  if (readyTabs.has(tabId)) {
                    try { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }); } catch (e) {}
                  } else {
                    try { pendingStartTabs.add(tabId); } catch (e) {}
                    setTimeout(() => { try { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }); } catch (e) {} }, 2500);
                  }
                } catch (e) {}
              }).catch(() => {});
            }
          } catch (e) {}
        } catch (e) {}

        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      }
        // Handle Generate requests coming from the From-Published content script.
        // Open the edit page (marketplace/edit/?listing_id=...) if possible and run a targeted edit-form scraper.
        if (message.action === 'ffm_from_published_url') {
          try {
            (async () => {
              try {
                const url = message && message.url ? String(message.url) : null;
                try { console.log('[AutoList Pro bg] ffm_from_published_url received message', message); } catch (e) {}
                if (!url) { try { sendResponse && sendResponse({ ok: false, error: 'no-url' }); } catch (e) {} return; }

                // Prefer editUrl/listingId supplied by the content script (more reliable)
                let editUrl = (message && message.editUrl) ? String(message.editUrl) : null;
                try {
                  if (!editUrl && message && message.listingId) {
                    editUrl = 'https://www.facebook.com/marketplace/edit/?listing_id=' + String(message.listingId);
                  }
                } catch (e) {}
                // Fallback: derive listing_id when possible from the provided URL
                if (!editUrl) {
                  try {
                    const m1 = String(url).match(/[?&]listing_id=(\d{6,})/);
                    const m2 = String(url).match(/\/item\/(\d{6,})/);
                    const m3 = String(url).match(/\/(\d{6,})[\/?]*/);
                    const foundId = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]);
                    if (foundId) editUrl = 'https://www.facebook.com/marketplace/edit/?listing_id=' + foundId;
                  } catch (e) {}
                }

                try { console.debug('[AutoList Pro bg] ffm_from_published_url: target editUrl=', editUrl, ' original url=', url, ' msg.listingId=', message && message.listingId, 'pubUrl=', message && message.pubUrl); } catch (e) {}

                // Store mapping from listingId -> public URL so edit tabs can request media helper
                try {
                  globalThis.__ffm_pub_map = globalThis.__ffm_pub_map || {};
                  let mapKey = null;
                  try { if (message && message.listingId) mapKey = String(message.listingId); } catch (e) {}
                  try { if (!mapKey) {
                    const m1 = String(url || '').match(/[?&]listing_id=(\d{6,})/);
                    const m2 = String(url || '').match(/\/item\/(\d{6,})/);
                    mapKey = (m1 && m1[1]) || (m2 && m2[1]) || null;
                  } } catch (e) {}
                  if (mapKey) {
                    try { globalThis.__ffm_pub_map[mapKey] = String((message && message.pubUrl) ? message.pubUrl : url || ''); } catch (e) {}
                  }
                } catch (e) {}

                // Always open a NEW tab for the edit page to ensure content scripts
                // and injection run fresh; do NOT reuse existing tabs which may
                // not have freshly injected helpers.
                let tab = null;
                try {
                  const target = editUrl || url;
                  try { console.log('[AutoList Pro bg] creating NEW tab for target', target); } catch (e) {}
                  tab = await new Promise((res) => chrome.tabs.create({ url: target, active: true }, res));
                  try { console.log('[AutoList Pro bg] chrome.tabs.create returned', tab && tab.id); } catch (e) {}
                } catch (e) { tab = null; try { console.error('[AutoList Pro bg] tabs.create failed', e); } catch (er) {} }

                if (!tab || typeof tab.id !== 'number') { try { sendResponse && sendResponse({ ok: false, error: 'no-tab' }); } catch (e) {} return; }

                  // If we have a public URL, open a media-helper tab for it so media scraping
                  // can run in parallel. Open helper active to avoid throttling, then restore
                  // focus to the edit tab so the user (and edit-page scripts) remain foreground.
                  try {
                    const tryPub = (message && message.pubUrl) ? String(message.pubUrl) : (message && message.listingId && globalThis.__ffm_pub_map && globalThis.__ffm_pub_map[String(message.listingId)] ? String(globalThis.__ffm_pub_map[String(message.listingId)]) : null);
                    if (tryPub) {
                      try {
                        const pub = tryPub;
                        const helperUrl = pub + (pub.indexOf('?') !== -1 ? '&' : '?') + '__ffm_media=1';
                        try { console.log('[AutoList Pro bg] opening helper pub tab for', pub); } catch(e){}
                        chrome.tabs.create({ url: helperUrl, active: true }, (helperTab) => {
                          try {
                            if (helperTab && helperTab.id) {
                              try { globalThis.__ffm_media_waiting = globalThis.__ffm_media_waiting || {}; globalThis.__ffm_media_waiting[helperTab.id] = { editTabId: tab.id, ts: Date.now(), pubUrl: pub }; } catch(e){}
                              try { console.log('[AutoList Pro bg] helper tab created id=', helperTab.id, 'for pubUrl=', pub); } catch(e){}
                              // Restore focus to the edit tab after a short delay so both tabs load
                              setTimeout(() => { try { chrome.tabs.update(tab.id, { active: true }); } catch(e){} }, 300);
                            }
                          } catch(e){}
                        });
                      } catch(e) { try { console.error('[AutoList Pro bg] failed to create helper tab', e); } catch(_){} }
                    }
                  } catch(e) {}

                  // Wait for the tab to finish loading (or timeout)
                try {
                  await new Promise((res) => {
                    let done = false;
                    const onUpd = (tabId, info) => {
                      try {
                        if (tabId === tab.id && info && info.status === 'complete') {
                          done = true;
                          try { chrome.tabs.onUpdated.removeListener(onUpd); } catch (e) {}
                          return res(true);
                        }
                      } catch (e) {}
                    };
                    try { chrome.tabs.onUpdated.addListener(onUpd); } catch (e) {}
                    setTimeout(() => { if (!done) { try { chrome.tabs.onUpdated.removeListener(onUpd); } catch (e) {} res(false); } }, 3500);
                  });
                } catch (e) {}

                // Execute the edit-page scraper in the tab
                try {
                  const arr = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function() {
                      try {
                        const out = { url: location.href, title: '', inventoryName: '', price: null, retailPrice: null, description: '', fields: {}, hideFromFriends: false, images: [], videos: [], timestamp: Date.now() };
                        const q = (sel) => document.querySelector(sel);
                        const qAll = (sel) => Array.from(document.querySelectorAll(sel));

                        try {
                          const titleInput = q('input[name*="title"], input[id*="title"], input[aria-label*="Title"], textarea[name*="title"]') || q('input[placeholder*="Title"], textarea[placeholder*="Title"]');
                          if (titleInput && ('value' in titleInput)) out.title = (titleInput.value || '').trim();
                          else {
                            const h1 = q('h1'); if (h1) out.title = (h1.innerText || '').trim();
                            else out.title = document.title || '';
                          }
                          out.inventoryName = out.title;
                        } catch (e) {}

                        try {
                          const priceInput = q('input[name*="price"], input[id*="price"], input[aria-label*="Price"]');
                          if (priceInput && ('value' in priceInput)) out.price = Number(String(priceInput.value).replace(/[^0-9\.]/g, '')) || null;
                          else {
                            const priceTxt = qAll('label, span, div').map(n => n.innerText || '').find(t => /price/i.test(t) && /\$/.test(t));
                            if (priceTxt) { const m = priceTxt.match(/\$\s*([0-9,\.]+)/); if (m && m[1]) out.price = Number(m[1].replace(/,/g, '')) || null; }
                          }
                        } catch (e) {}

                        try {
                          const desc = q('textarea[name*="description"], textarea[id*="description"], [aria-label*="Description"]');
                          if (desc && ('value' in desc)) out.description = (desc.value || '').trim();
                          else { const d = q('[data-testid="marketplace_listing_description"]') || q('[data-testid="marketplace_listing_details"]'); if (d) out.description = (d.innerText || '').trim(); }
                        } catch (e) {}

                        try {
                          let cat = '';
                          const catSel = q('select[name*="category"], select[id*="category"], [aria-label*="Category"]');
                          if (catSel && catSel.options) {
                            cat = (catSel.value && String(catSel.value).trim()) || ((catSel.selectedOptions && catSel.selectedOptions[0] && catSel.selectedOptions[0].text) || '');
                          } else {
                            const catLabel = qAll('label, div, span').find(n => (n.innerText || '').toLowerCase().includes('category'));
                            if (catLabel && catLabel.nextElementSibling) cat = (catLabel.nextElementSibling.innerText || '').trim();
                          }
                          out.fields.category = cat || '';
                        } catch (e) {}

                        try {
                          const details = {};
                          const labels = qAll('label');
                          for (const lbl of labels) {
                            try {
                              const key = (lbl.innerText || '').trim(); if (!key) continue; let val = '';
                              try { if (lbl.htmlFor) { const inp = document.getElementById(lbl.htmlFor); if (inp) val = ('value' in inp) ? inp.value : (inp.innerText || ''); } } catch (e) {}
                              if (!val) { const s = lbl.nextElementSibling; if (s) val = (s.innerText || '').trim(); }
                              if (!val) { const p = lbl.parentElement; if (p) { const other = Array.from(p.children).find(c => c !== lbl && (c.innerText || '').trim()); if (other) val = (other.innerText || '').trim(); } }
                              if (val) details[key] = val;
                            } catch (e) {}
                          }
                          const norm = (k) => k ? k.toLowerCase().replace(/[:\s\-]+/g, ' ').trim() : '';
                          for (const k of Object.keys(details)) {
                            const lk = norm(k); const v = details[k] || '';
                            if (lk.includes('condition')) out.fields.condition = v;
                            else if (lk.includes('bed') && lk.includes('size')) out.fields.bedSize = v;
                            else if (lk.includes('core')) out.fields.coreConstruction = v;
                            else if (lk.includes('comfort')) out.fields.comfortLevel = v;
                          }
                        } catch (e) {}

                        try {
                          let hide = false;
                          try {
                            const candidates = qAll('input[type=checkbox], [role="switch"]');
                            for (const c of candidates) {
                              try {
                                const lbl = Array.from(document.querySelectorAll('label')).find(l => l.htmlFor === c.id || (l.contains && l.contains(c)) || (l.nextElementSibling === c) || (l.previousElementSibling === c));
                                const txt = (lbl && lbl.innerText) ? lbl.innerText.toLowerCase() : '';
                                if (txt.includes('hide') && txt.includes('friend')) {
                                  if ('checked' in c) hide = !!c.checked; else hide = (c.getAttribute && c.getAttribute('aria-checked') === 'true');
                                  break;
                                }
                              } catch (e) {}
                            }
                          } catch (e) {}
                          out.hideFromFriends = !!hide;
                        } catch (e) {}

                        try { const imgs = qAll('img').map(i => i && i.src).filter(Boolean).filter(u => u.indexOf('http') === 0); out.images = Array.from(new Set(imgs)).slice(0, 40); } catch (e) {}
                        try { const vids = qAll('video').map(v => v.currentSrc || (v.querySelector && v.querySelector('source') && v.querySelector('source').src)).filter(Boolean); out.videos = vids; } catch (e) {}

                        out.fields.condition = out.fields.condition || '';
                        out.fields.bedSize = out.fields.bedSize || '';
                        out.fields.coreConstruction = out.fields.coreConstruction || '';
                        out.fields.comfortLevel = out.fields.comfortLevel || '';

                        return out;
                      } catch (e) { return { error: String(e) }; }
                    } });

                  const execRes = (arr && arr[0] && arr[0].result) ? arr[0].result : null;
                  try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: execRes }); } catch (e) {}
                  try { chrome.runtime.sendMessage({ action: 'generate-scrape-result', data: execRes, origin: 'from_published' }); } catch (e) {}
                  try { sendResponse && sendResponse({ ok: true, data: execRes }); } catch (e) {}
                  return;
                } catch (e) {
                  // fall through to fallback behavior
                }

                // If the edit scrape failed, fallback to opening the original page and doing a lightweight scrape
                try {
                  const arr2 = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function() {
                    try {
                      const out = { url: location.href, title: null, inventoryName: null, price: null, retailPrice: null, description: null, fields: { condition: '', bedSize: '', coreConstruction: '', comfortLevel: '', category: '' }, images: [], videos: [], timestamp: Date.now() };
                      try { out.title = (document.querySelector('meta[property="og:title"]') && document.querySelector('meta[property="og:title"]').content) || (document.querySelector('h1') && document.querySelector('h1').innerText) || document.title || null; } catch (e) {}
                      try { out.description = (document.querySelector('meta[property="og:description"]') && document.querySelector('meta[property="og:description"]').content) || (document.querySelector('meta[name="description"]') && document.querySelector('meta[name="description"]').content) || null; } catch (e) {}
                      function extractDollarNumbersFromText(txt) { try { if (!txt) return []; const m = txt.match(/\$\s*[0-9\,]+(?:\.[0-9]{1,2})?/g); if (!m) return []; return m.map(s => { const n = Number(s.replace(/[^0-9\.]/g, '')); return isFinite(n) ? n : null; }).filter(n => n !== null); } catch (e) { return []; } }
                      let allDollarValues = [];
                      try { const textEls = Array.from(document.querySelectorAll('span,div,p,li')); for (const el of textEls) { try { const txt = el.innerText || ''; const vals = extractDollarNumbersFromText(txt); if (vals && vals.length) allDollarValues = allDollarValues.concat(vals); } catch (e) {} } } catch (e) {}
                      try { if (allDollarValues.length) out.price = Math.min.apply(null, allDollarValues); } catch (e) {}
                      try { let descVals = []; try { descVals = extractDollarNumbersFromText(out.description || ''); } catch (e) {} if (descVals && descVals.length) out.retailPrice = Math.max.apply(null, descVals); else if (allDollarValues.length) out.retailPrice = Math.max.apply(null, allDollarValues); } catch (e) {}
                      try { const imgs = Array.from(document.querySelectorAll('img')).filter(i => i && i.src && i.src.indexOf('http') === 0); const uniq = []; for (const i of imgs) { try { if (i.src && uniq.indexOf(i.src) === -1) uniq.push(i.src); } catch (e) {} } out.images = uniq.slice(0,40); } catch (e) {}
                      try { const vids = Array.from(document.querySelectorAll('video')).map(v => { try { if (v.currentSrc) return v.currentSrc; const s = v.querySelector('source'); return s && s.src ? s.src : null; } catch (e) { return null; } }).filter(Boolean); out.videos = vids; } catch (e) {}
                      out.fields.condition = out.fields.condition || ''; out.fields.bedSize = out.fields.bedSize || ''; out.fields.coreConstruction = out.fields.coreConstruction || ''; out.fields.comfortLevel = out.fields.comfortLevel || '';
                      return out;
                    } catch (e) { return { error: String(e) }; }
                  } });
                  const execRes = (arr2 && arr2[0] && arr2[0].result) ? arr2[0].result : null;
                  try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: execRes }); } catch (e) {}
                  try { chrome.runtime.sendMessage({ action: 'generate-scrape-result', data: execRes, origin: 'from_published' }); } catch (e) {}
                  try { sendResponse && sendResponse({ ok: true, data: execRes }); } catch (e) {}
                } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
              } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
            })();
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
          return true;
        }
    } catch (e) {}
  });
} catch (e) {}

// Safety flag: disable all automated Delete/Relist actions added in the Scheduler sprint.
// When true, relist/delete flows will be no-ops to avoid breaking the extension while we
// redesign a safer approach.
const DISABLE_RELIST = true;

// Debug flag (toggle via storage.fast4mp_debug if needed)
const FAST4MP_DEBUG = false;

// Track tabs that have announced they have a content listener (handshake)
if (typeof readyTabs === 'undefined') var readyTabs = new Set();
// Tabs we are awaiting a content-ready announcement from after opening/injecting
if (typeof pendingStartTabs === 'undefined') var pendingStartTabs = new Set();
// Pending populate messages queued until a tab announces content-ready. Keys: tabId -> [{ publishRequestId, overrideAuto, cb }]
if (typeof __ffm_pendingPopulates === 'undefined') var __ffm_pendingPopulates = {};
// lightweight state bag for ad-hoc waiters (scheduled DnR waits)
if (typeof state === 'undefined') var state = {};
state.waitingForScheduledDnr = state.waitingForScheduledDnr || null;
// Per-tab SDNR (scheduled delete+relist) state map. Keys: tabId -> { title, inventoryName, taskId, scheduled }
if (typeof __ffm_sdnrStateByTab === 'undefined') var __ffm_sdnrStateByTab = {};
// Tracks the last scheduled DnR run so we can finish publish if per-tab state is missing
if (typeof __ffm_lastScheduledDnRContext === 'undefined') var __ffm_lastScheduledDnRContext = null;

// Listen for content scripts announcing they're ready. When a tab signals readiness,
// mark it and trigger any pending select-mode starts for that tab.
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.action) return;
      if (msg.action === 'ffm_content_ready') {
        try {
          const tabId = sender && sender.tab && sender.tab.id;
          const isTop = msg && (msg.isTop === true);
          const frameId = (typeof sender.frameId === 'number') ? sender.frameId : null;
          // If the message came from a non-top frame according to the runtime sender, ignore
          // it for scheduled DnR triggers. This is more robust than relying solely on
          // a content-sent `isTop` flag (content may be running in iframe contexts).
          if (frameId !== null && frameId !== 0) {
            try { console.log('[AutoList Pro bg] content_ready from non-top frame (ignored for scheduled DnR)', tabId, 'frameId', frameId); } catch (e) {}
            // still allow pendingStartTabs to be triggered by any frame for select-mode
            if (pendingStartTabs.has(tabId)) {
              try { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }); } catch (e) {}
              try { pendingStartTabs.delete(tabId); } catch (e) {}
            }
            try { sendResponse && sendResponse({ ok: true, isTop: false }); } catch (e) {}
            return true;
          }
          if (tabId) {
            try {
              if (!isTop) {
                try { console.log('[AutoList Pro bg] content_ready from iframe (ignored for scheduled DnR)', tabId); } catch (e) {}
                // still allow pendingStartTabs to be triggered by any frame for select-mode
                if (pendingStartTabs.has(tabId)) {
                  try { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }); } catch (e) {}
                  try { pendingStartTabs.delete(tabId); } catch (e) {}
                }
                try { sendResponse && sendResponse({ ok: true, isTop: false }); } catch (e) {}
                return true;
              }

              // Top-frame readiness: mark tab as ready and handle scheduled DnR waiter
              try { readyTabs.add(tabId); } catch (e) {}
              try { console.log('[AutoList Pro bg] content ready announced from TOP frame, tab', tabId); } catch (e) {}

              // Drain any queued populate messages for this tab now that content is ready
              try {
                const queued = (__ffm_pendingPopulates && __ffm_pendingPopulates[tabId]) ? (__ffm_pendingPopulates[tabId].slice()) : [];
                if (queued && queued.length) {
                  try { console.debug('[bg] draining queued populate messages for tab', tabId, { count: queued.length }); } catch (e) {}
                  try { delete __ffm_pendingPopulates[tabId]; } catch (e) {}
                  queued.forEach(q => {
                    try { sendPopulateMessageToTab(tabId, q.publishRequestId, q.overrideAuto, q.cb); } catch (e) {}
                  });
                }
              } catch (e) {}

              // If any media was queued for this edit tab because a previous forward
              // attempt failed while content wasn't ready, send it now.
              try {
                if (globalThis.__ffm_pending_media_for_tab && globalThis.__ffm_pending_media_for_tab[String(tabId)]) {
                  try {
                    const pending = globalThis.__ffm_pending_media_for_tab[String(tabId)];
                    try { console.debug('[AutoList Pro bg] delivering queued media for tab', tabId); } catch(e) {}
                    try {
                      // Prefer registered port if present
                      const port = (globalThis.__ffm_content_ports_by_tab && typeof globalThis.__ffm_content_ports_by_tab.get === 'function') ? globalThis.__ffm_content_ports_by_tab.get(tabId) : ((typeof __ffm_content_ports_by_tab !== 'undefined' && __ffm_content_ports_by_tab[String(tabId)]) ? __ffm_content_ports_by_tab[String(tabId)] : null);
                      if (port) {
                        try {
                          port.postMessage({ action: 'ffm_from_published_media_result', data: pending });
                          try { console.log('[AutoList Pro bg] delivered queued media to tab via port', tabId); } catch (e) {}
                          try { /* keep queued copy until ack */ } catch (e) {}
                        } catch (e) {
                          try { console.warn('[AutoList Pro bg] port.postMessage for queued media failed, falling back to sendMessage', tabId, e && (e.message||e)); } catch (er) {}
                          // fall through to sendMessage below
                        }
                      }

                      chrome.tabs.sendMessage(tabId, { action: 'ffm_from_published_media_result', data: pending }, (resp) => {
                        try {
                          if (chrome.runtime && chrome.runtime.lastError) {
                            console.warn('[AutoList Pro bg] queued media delivery failed for tab', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message);
                            // Attempt a temporary port connect fallback
                            try {
                              const tmpPort = chrome.tabs.connect && chrome.tabs.connect(tabId, { name: 'ffm_content_port' });
                              if (tmpPort) {
                                try { console.log('[AutoList Pro bg] opened tmp port to tab', tabId, 'for queued delivery'); } catch (e) {}
                                try {
                                  tmpPort.postMessage({ action: 'ffm_from_published_media_result', data: pending });
                                  try { console.log('[AutoList Pro bg] queued media delivered via tmp port to tab', tabId); } catch (e) {}
                                  try { delete globalThis.__ffm_pending_media_for_tab[String(tabId)]; } catch(e) {}
                                  setTimeout(() => { try { tmpPort.disconnect(); } catch (e) {} }, 3000);
                                } catch (e) {
                                  try { console.warn('[AutoList Pro bg] tmpPort.postMessage failed for tab', tabId, e && (e.message||e)); } catch (_) {}
                                }
                              }
                            } catch (ee) { try { console.warn('[AutoList Pro bg] tmp connect fallback failed', ee && (ee.message||ee)); } catch(_){} }
                          } else {
                            try { console.log('[AutoList Pro bg] queued media delivered to tab', tabId); } catch(e) {}
                            try { delete globalThis.__ffm_pending_media_for_tab[String(tabId)]; } catch(e) {}
                          }
                        } catch (e) {}
                      });
                    } catch (e) { try { console.warn('[AutoList Pro bg] queued delivery path failed', e && (e.message||e)); } catch(_){} }
                  } catch (e) {}
                }
              } catch (e) {}

              try {
                const waiter = state && state.waitingForScheduledDnr;
                if (waiter && waiter.tabId === tabId) {
                  try { clearTimeout(waiter.timeout); } catch (e) {}
                  state.waitingForScheduledDnr = null;

                  // If this waiter was created for a scheduled SDNR run, do NOT
                  // send the legacy title_search fast-path message. Instead, force
                  // the scheduled flow to take the fallback path which uses the
                  // canonical sendDeleteMessage pipeline (ensures title/inventoryName
                  // metadata is present and avoids fragile title_search behavior).
                  if (waiter && waiter.scheduled) {
                    (async () => {
                      try {
                        // Prefer explicit title fields but fall back to inventoryName when needed
                        let dnrTitle = (waiter.task && (waiter.task.title || waiter.task.listingTitle)) || (waiter.task && waiter.task.inventoryName) || '';
                        const msg = {
                          action: 'ffm_dnr_try_title_search',
                          scheduledMode: true,
                          scheduleTaskId: waiter.task && waiter.task.id,
                          inventoryName: waiter.task && waiter.task.inventoryName,
                          listing: { title: dnrTitle }
                        };
                        try {
                          const res = await ffmSafeSendMessage(tabId, msg);
                          if (res && res.ok) {
                            try { waiter.resolve(Object.assign({}, res.response || res, { tabId })); } catch (e) { try { waiter.resolve({ success: false, fallback: true, scheduled: true, tabId }); } catch (er) {} }
                          } else {
                            try { waiter.resolve({ success: false, fallback: true, scheduled: true, tabId }); } catch (er) {}
                          }
                        } catch (e) {
                          try { waiter.resolve({ success: false, fallback: true, scheduled: true, tabId }); } catch (er) {}
                        }
                      } catch (e) {
                        try { waiter.resolve({ success: false, fallback: true, scheduled: true, tabId }); } catch (er) {}
                      }
                    })();
                    return;
                  }

                  (async () => {
                    try {
                      // Build dnrTitle, preferring explicit task.title/listingTitle,
                      // but enriching from saved listings when we only have inventoryName.
                      let dnrTitle = (waiter.task && waiter.task.title) || (waiter.task && waiter.task.listingTitle) || (waiter.task && waiter.task.inventoryName) || '';
                      try {
                        const t = waiter.task || {};
                        if ((!t.title && !t.listingTitle) && (t.inventoryName || t.listingId)) {
                          const snap = await new Promise(res => { try { chrome.storage.local.get(['listings'], res); } catch (e) { res({}); } });
                          const listings = (snap && Array.isArray(snap.listings)) ? snap.listings : [];
                          let found = null;
                          try { if (t.listingId) found = listings.find(l => l && (String(l.listingId) === String(t.listingId) || String(l.id) === String(t.listingId))); } catch (e) {}
                          try { if (!found && t.inventoryName) found = listings.find(l => l && l.inventoryName && String(l.inventoryName) === String(t.inventoryName)); } catch (e) {}
                          if (found) {
                            const prefer = (found.title || found.listingTitle || found.fbTitle || '').trim();
                            if (prefer) {
                              try { console.log('[DnR] Scheduled: enriching dnrTitle from saved listing', { inventoryName: t.inventoryName, enrichedTitle: prefer }); } catch (e) {}
                              dnrTitle = prefer;
                            }
                          }
                        }
                      } catch (e) {}

                      const msg2 = {
                        action: 'ffm_dnr_try_title_search',
                        listing: { title: dnrTitle },
                        scheduleTaskId: waiter.task && waiter.task.id
                      };
                      const resWrap = await ffmSafeSendMessage(tabId, msg2, { timeoutMs: 12000 });
                      if (resWrap && resWrap.ok) {
                        try { waiter.resolve(Object.assign({}, resWrap.response || {}, { tabId })); } catch (e) { try { waiter.resolve({ success: false, fallback: true, reason: 'resolve-ex', tabId }); } catch (er) {} }
                      } else {
                        try { waiter.resolve({ success: false, fallback: true, reason: resWrap && resWrap.error ? resWrap.error : 'send-failed', tabId }); } catch (er) {}
                      }
                    } catch (e) {
                      try { waiter.resolve({ success: false, fallback: true, reason: 'send-ex', tabId }); } catch (er) {}
                    }
                  })();
                }
              } catch (e) {}

              if (pendingStartTabs.has(tabId)) {
                try { chrome.tabs.sendMessage(tabId, { action: 'ffm-start-select-images', query: '' }); } catch (e) {}
                try { pendingStartTabs.delete(tabId); } catch (e) {}
              }
            } catch (e) {}
          }
        } catch (e) {}
        try { sendResponse && sendResponse({ ok: true, isTop: !!isTop }); } catch (e) {}
        return true;
      }
    } catch (e) {}
  });
} catch (e) {}

// Relay storage for latest publish result (used to update popup UI)
let latestPublishStatus = null;
// Cache for side panel preference to allow synchronous checks during onClicked
let _ffm_use_sidepanel_cached = false;
// In-memory flag for whether we opened the side panel (best-effort)
let ffmPanelOpen = false;

// Read persisted panel-open flag (best-effort) so we don't attempt to re-open repeatedly after SW restarts
try {
  if (chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
    try { chrome.storage.local.get(['ffm_panel_open'], (res) => { try { ffmPanelOpen = !!(res && res.ffm_panel_open); if (FAST4MP_DEBUG) console.log('[AutoList Pro bg] ffmPanelOpen loaded from storage ->', ffmPanelOpen); } catch(e){} }); } catch(e){}
  }
} catch (e) {}

// Initialize cached preference from storage on startup (best-effort)
try {
  chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get(['ffm_use_sidepanel'], (res) => {
    try {
      // Default to sidepanel when no explicit preference is stored
      if (res && Object.prototype.hasOwnProperty.call(res, 'ffm_use_sidepanel')) {
        _ffm_use_sidepanel_cached = !!res.ffm_use_sidepanel;
      } else {
        _ffm_use_sidepanel_cached = true; // default: sidepanel
      }
      try {
        if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
          try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: _ffm_use_sidepanel_cached }); } catch (e) {}
          console.log('[AutoList Pro bg] sidePanel open-on-action set ->', _ffm_use_sidepanel_cached);
        }
      } catch (e) {}
    } catch (e) {}
  });
} catch (e) {}

// Defensive wrapper for chrome.scripting.executeScript: sanitize target and consume rejections
try {
  if (chrome && chrome.scripting && typeof chrome.scripting.executeScript === 'function') {
    const __origScriptingExecute = chrome.scripting.executeScript.bind(chrome.scripting);
    chrome.scripting.executeScript = function(opts, cb) {
      try {
        // create a sanitized shallow copy for logging
        const sanitized = opts && JSON.parse(JSON.stringify(opts));
        if (sanitized && sanitized.target) {
          if (sanitized.target.tabId === undefined && sanitized.target.windowId !== undefined) delete sanitized.target.tabId;
          if (sanitized.target.windowId === undefined && sanitized.target.tabId !== undefined) delete sanitized.target.windowId;
        }
        if (FAST4MP_DEBUG) try { console.debug('[AutoList Pro bg] scripting.executeScript called', { sanitizedTarget: sanitized && sanitized.target, details: (sanitized && (sanitized.files || sanitized.func)) }); } catch (e) {}

        if (typeof cb === 'function') {
          // callback form
          __origScriptingExecute(opts, function() {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { if (FAST4MP_DEBUG) console.debug('[bg] scripting.executeScript lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                try { cb && cb(null); } catch (e) {}
                return;
              }
              try { cb && cb.apply(this, arguments); } catch (e) {}
            } catch (e) {}
          });
          return;
        } else {
          // promise form
          try {
            const p = __origScriptingExecute(opts);
            try { Promise.resolve(p).catch(err => { if (FAST4MP_DEBUG) console.debug('[AutoList Pro] scripting.executeScript rejected', err); }); } catch (e) {}
            return p;
          } catch (e) { if (FAST4MP_DEBUG) console.debug('[bg] scripting.executeScript call failed', e); }
        }
      } catch (e) { if (FAST4MP_DEBUG) console.debug('[bg] scripting.executeScript wrapper failed', e); }
    };
  }
} catch (e) {}

// Keep cache updated when storage changes so onClicked can rely on the value synchronously
try {
  if (chrome && chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      try {
        if (areaName === 'local' && changes && Object.prototype.hasOwnProperty.call(changes, 'ffm_use_sidepanel')) {
          try { 
            _ffm_use_sidepanel_cached = !!changes.ffm_use_sidepanel.newValue; 
            console.log('[AutoList Pro bg] ffm_use_sidepanel cache updated ->', _ffm_use_sidepanel_cached);
            // Mirror the preference into the sidePanel open-on-action behavior when possible
            try {
              if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
                try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: _ffm_use_sidepanel_cached }); } catch (e) {}
                console.log('[AutoList Pro bg] sidePanel open-on-action set ->', _ffm_use_sidepanel_cached);
              }
            } catch (e) {}
          } catch (e) {}
        }
      } catch (e) {}
    });
  }
} catch (e) {}

// Defensive sendMessage wrapper to avoid Unchecked runtime.lastError noise
try {
  if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    const __origSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function(message, callback) {
      try {
        if (typeof callback === 'function') {
          __origSendMessage(message, function(res) {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { if (FAST4MP_DEBUG) console.debug('[bg] sendMessage lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                try { callback && callback(null); } catch (e) {}
                return;
              }
              try { callback && callback(res); } catch (e) {}
            } catch (e) {}
          });
        } else {
          __origSendMessage(message);
        }
      } catch (e) { try { if (FAST4MP_DEBUG) console.debug('[bg] sendMessage wrapper failed', e); } catch (er) {} }
    };
  }
} catch (e) {}

// Defensive wrapper for chrome.tabs.sendMessage to consume lastError in callbacks
try {
  if (chrome && chrome.tabs && typeof chrome.tabs.sendMessage === 'function') {
    const __origTabsSend = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = function(tabId, message, callback) {
      try {
        if (FAST4MP_DEBUG) try { console.debug('[AutoList Pro bg] tabs.sendMessage called', { tabId, message }); } catch (e) {}
        if (typeof callback === 'function') {
          __origTabsSend(tabId, message, function(res) {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { if (FAST4MP_DEBUG) console.debug('[bg] tabs.sendMessage lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                try { callback && callback(null); } catch (e) {}
                return;
              }
              try { callback && callback(res); } catch (e) {}
            } catch (e) {}
          });
        } else {
          __origTabsSend(tabId, message);
        }
      } catch (e) { try { if (FAST4MP_DEBUG) console.debug('[bg] tabs.sendMessage wrapper failed', e); } catch (er) {} }
    };
  }
} catch (e) {}

// Receive scrape-result from injected content scripts, persist and broadcast to any open popup
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || !msg.action) return;

      if (msg.action === 'ffm_start_select_mode') {
        try { console.log('[AutoList Pro bg] ffm_start_select_mode (legacy) received — open/focus Sharetown tab'); } catch (e) {}
        try {
          // Centralized: open or focus the inventory-list tab and message it
          openSharetownInventory({ active: true }).then((tab) => {
            try {
              if (tab && tab.id) {
                setTimeout(() => { try { chrome.tabs.sendMessage(tab.id, { action: 'ffm-start-select-images', query: '' }); } catch (e) {} }, 800);
              }
            } catch (e) {}
          }).catch(() => {});
        } catch (e) {}
        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        return true;
      }

      if (msg.action === 'sharetown_item_selected') {
        try { console.log('[AutoList Pro bg] Item chosen from Sharetown:', msg.data); } catch (e) {}
        try { chrome.runtime.sendMessage({ action: 'generate-scrape-result', data: msg.data }); } catch (e) {}
        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        return true;
      }

  if (msg.action !== 'scrape-result') return;
  try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: msg.data }); } catch (e) {}
  try { chrome.runtime.sendMessage({ action: 'generate-scrape-result', data: msg.data, origin: msg.origin }); } catch (e) {}
  try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
  // Do not return true — we don't need to keep the message channel open here. Returning
  // true caused the sender to sometimes see a console warning when the service worker
  // lifecycle ended before an async response was delivered.
  return;
    } catch (e) {}
  });
} catch (e) {}

// Listener: kick off publish flow when content signals a successful delete
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || msg.type !== 'ffm_trigger_publish') return;
      try { console.log('[AutoList Pro bg] 🔄 Publish triggered for', msg.title); } catch (e) {}
      try {
        // If a full publish was already requested by the content tab, skip the popup/fallback flow
        if (globalThis._ffm_fullPublishInProgress) {
          try { console.log('[AutoList Pro bg] 🟢 Full publish already in progress for', msg.title, '- skipping fallback.'); } catch (e) {}
          return;
        }
      } catch (e) {}
          try {
        const title = msg && msg.title ? String(msg.title) : null;

        // Helper: fallback to stage minimal payload or prefer an existing rich staged listing
        function doStageOrUseExisting(titleVal) {
          // Local normalizer (same rules as popup.normalizeInventoryName)
          function normalizeInventoryNameLocal(name) {
            try {
              if (!name && name !== 0) return '';
              let s = String(name || '').trim();
              try { s = s.normalize('NFKD').replace(/\p{Diacritic}/gu, ''); } catch (e) {}
              s = s.toLowerCase();
              s = s.replace(/\b(the|a|an|mattress|new|used)\b/g, ' ');
              s = s.replace(/[^a-z0-9\s]/g, ' ');
              s = s.replace(/\s+/g, ' ').trim();
              return s;
            } catch (e) { try { return String(name || '').toLowerCase(); } catch (_) { return ''; } }
          }

          const wantNorm = normalizeInventoryNameLocal(titleVal || '');
          try {
            chrome.storage.local.get(null, (items) => {
              try {
                // Find the best matching staged listing (prefer entries with richer data).
                let bestId = null;
                let bestScore = -1;
                if (items) {
                  for (const k of Object.keys(items)) {
                    if (!k || typeof k !== 'string') continue;
                    if (!k.startsWith('ffm_publish_')) continue;
                    const val = items[k];
                    try {
                      if (val && val.inventoryName) {
                        const vnorm = normalizeInventoryNameLocal(val.inventoryName);
                        if (vnorm && wantNorm && vnorm === wantNorm) {
                          let score = 0;
                          try { if (Array.isArray(val.images) && val.images.length) score += 5; } catch (e) {}
                          try { if (Array.isArray(val.s3ImageKeys) && val.s3ImageKeys.length) score += 4; } catch (e) {}
                          try { if (val.price || val.price === 0) score += 3; } catch (e) {}
                          try { if (val.description && String(val.description).trim()) score += 2; } catch (e) {}
                          try { if (val.category) score += 1; } catch (e) {}
                          try { if (!val.__ffm_stripped) score += 1; } catch (e) {}
                          if (score > bestScore) {
                            bestScore = score;
                            bestId = k.slice('ffm_publish_'.length);
                          }
                        }
                      }
                    } catch (e) {}
                  }
                }

                if (bestId) {
                  try { console.debug('[AutoList Pro bg] found staged publish matching inventoryName (best candidate)', { publishRequestId: bestId, score: bestScore, inventoryName: titleVal }); } catch (e) {}
                  try { chrome.storage.local.set({ ['ffm_force_auto_publish_' + bestId]: true }, () => {}); } catch (e) {}
                  try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: titleVal || null, publishRequestId: bestId }); } catch (e) {}
                  try { publishListingById(bestId); } catch (e) { console.error('[AutoList Pro bg] publishListingById failed', e); }
                  return;
                }

                // No good staged candidate — create minimal staged payload
                const publishRequestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
                const stagedKey = 'ffm_publish_' + publishRequestId;
                (async () => {
                  try {
                    // Build base payload
                    const stagedListing = { inventoryName: titleVal };
                    // Attempt to reconstruct media from DB and attach File[] and local keys
                    try {
                      const listingKey = titleVal || null;
                      const { imageFiles, videoFiles } = await ffmReconstructMediaFilesFromDB(listingKey);
                      if ((imageFiles && imageFiles.length) || (videoFiles && videoFiles.length)) {
                        // Use canonical names `imageFiles` / `videoFiles` to avoid persisting large
                        // inline blobs under legacy `images`/`videos` keys. Keep `files` as a
                        // convenience concat for existing consumers.
                        stagedListing.imageFiles = imageFiles;
                        stagedListing.videoFiles = videoFiles;
                        stagedListing.files = [].concat(imageFiles || [], videoFiles || []);
                        if (listingKey) {
                          stagedListing.localImageKeys = (imageFiles || []).map((_, idx) => ffmMakeS3MediaKey(listingKey, idx, 'image', 'jpg'));
                          stagedListing.localVideoKeys = (videoFiles || []).map((_, idx) => ffmMakeS3MediaKey(listingKey, idx, 'video', 'mp4'));
                        }
                      }
                    } catch (e) {
                      console.warn('[bg] doStageOrUseExisting: media reconstruction failed, staging minimal payload', e);
                    }

                    // Persist staged listing then kick off publish
                    try {
                      chrome.storage.local.set({ [stagedKey]: stagedListing }, () => {
                        try { console.debug('[AutoList Pro bg] staged publish payload (fallback)', { publishRequestId, stagedKey, inventoryName: titleVal }); } catch (e) {}
                        try { chrome.storage.local.set({ ['ffm_force_auto_publish_' + publishRequestId]: true }, () => {}); } catch (e) {}
                        try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: titleVal || null, publishRequestId }); } catch (e) {}
                        try { publishListingById(publishRequestId); } catch (e) { console.error('[AutoList Pro bg] publishListingById failed', e); }
                      });
                    } catch (e) { console.error('[AutoList Pro bg] failed staging publish payload', e); }
                  } catch (e) { console.error('[AutoList Pro bg] doStageOrUseExisting internal error', e); }
                })();
              } catch (e) { console.error('[AutoList Pro bg] ffm_trigger_publish storage scan error', e); }
            });
          } catch (e) { console.error('[AutoList Pro bg] ffm_trigger_publish storage read failed', e); }
        }

        // First try to relay the publish request to the popup so it can reuse
        // the saved-listing publish pipeline (btn._ffm_handlePublish or startPublishFlow).
        let popupResponded = false;
        let popupHandled = false;

        const fallbackAfterNoPopup = () => {
          try { console.debug('[AutoList Pro bg] popup did not respond after wait, falling back to background staging/publish'); } catch (e) {}
          // As a helpful diagnostic, capture a snapshot of available staged publish entries
          try {
            const snapKey = 'ffm_debug_snapshot_' + (Math.floor(Date.now()/1000));
            chrome.storage.local.get(null, (items) => {
              try {
                const out = { ts: Date.now(), title: title, reason: 'popup-no-response', candidates: {} };
                for (const k of Object.keys(items || {})) {
                  try {
                    if (!k.startsWith('ffm_publish_')) continue;
                    const v = items[k];
                    out.candidates[k] = {
                      inventoryName: v && v.inventoryName ? v.inventoryName : null,
                      images: Array.isArray(v && v.images) ? v.images.length : 0,
                      s3ImageKeys: Array.isArray(v && v.s3ImageKeys) ? v.s3ImageKeys.length : 0,
                      hasDescription: !!(v && v.description && String(v.description).trim()),
                      hasPrice: typeof (v && v.price) !== 'undefined' && v.price !== null,
                      stripped: !!(v && v.__ffm_stripped)
                    };
                  } catch (e) {}
                }
                try { chrome.storage.local.set({ [snapKey]: out }); } catch (e) {}
              } catch (e) {}
            });
          } catch (e) {}

          doStageOrUseExisting(title);
        };

        try {
          // Attempt to notify popup directly first
          chrome.runtime.sendMessage({ type: 'ffm_invoke_full_publish', listingTitle: title }, (resp) => {
            popupResponded = true;
            try {
              if (resp && resp.ok) {
                popupHandled = true;
                try { console.debug('[AutoList Pro bg] popup handled full publish for', title); } catch (e) {}
                return;
              }
            } catch (e) {}
            // Popup responded but didn't handle — fallback
            fallbackAfterNoPopup();
          });
        } catch (e) {
          // sendMessage threw synchronously — try to open popup and retry
          try { console.debug('[AutoList Pro bg] sendMessage to popup threw, will attempt to open popup window', e); } catch (er) {}
          // continue to retry path below
        }

        // If popup doesn't respond within a short time, attempt to open popup and retry once
        setTimeout(() => {
          try {
            if (popupResponded) return; // either handled or responded-not-handled
            // try to find an existing popup window/tab
            try {
              chrome.windows.getAll({ populate: true }, (wins) => {
                try {
                  const popupUrl = chrome.runtime.getURL('popup.html');
                  let found = null;
                  for (const w of wins || []) {
                    try {
                      if (!w || !w.tabs) continue;
                      for (const t of w.tabs) {
                        try {
                          if (t && t.url && String(t.url).startsWith(popupUrl)) { found = t; break; }
                        } catch (e) {}
                      }
                      if (found) break;
                    } catch (e) {}
                  }
                  const trySendToPopup = () => {
                    try {
                      chrome.runtime.sendMessage({ type: 'ffm_invoke_full_publish', listingTitle: title }, (resp2) => {
                        popupResponded = true;
                        try {
                          if (resp2 && resp2.ok) { popupHandled = true; try { console.debug('[AutoList Pro bg] popup handled full publish on retry for', title); } catch (e) {} return; }
                        } catch (e) {}
                        fallbackAfterNoPopup();
                      });
                    } catch (e) { fallbackAfterNoPopup(); }
                  };

                  if (found) {
                    // popup exists — try sending again
                    trySendToPopup();
                    return;
                  }

                  // No popup found — open one and retry after short delay
                  try {
                    chrome.windows.create({ url: popupUrl + '#autopublish', type: 'popup', width: 420, height: 720 }, (w) => {
                      try {
                        // give the popup a moment to load
                        setTimeout(() => trySendToPopup(), 700);
                      } catch (e) { fallbackAfterNoPopup(); }
                    });
                  } catch (e) {
                    fallbackAfterNoPopup();
                  }
                } catch (e) { fallbackAfterNoPopup(); }
              });
            } catch (e) { fallbackAfterNoPopup(); }
          } catch (e) { fallbackAfterNoPopup(); }
        }, 900);
      } catch (e) { console.error('Publish trigger handler error:', e); }
    } catch (e) {}
  });
} catch (e) {}

// (Removed global console filters — reverted to default behavior)

// Helper: find a staged publish by inventory name and invoke publishListingById.
// Used by content-side relist flow which requests a full publish after delete.
async function publishListingByName(title, opts = {}) {
  // Before staging/publish, attempt to clear any Failed/Incomplete/Draft listings
  try {
    let sellingTab = null;
    let createdSellingTab = false;
    try {
      const stored = await new Promise(res => { try { chrome.storage.local.get(['ffmActiveTabId'], r => res(r || {})); } catch (e) { res({}); } });
      const ffmActiveTabId = stored && stored.ffmActiveTabId;
      if (ffmActiveTabId) {
        try { sellingTab = await new Promise(res => { try { chrome.tabs.get(ffmActiveTabId, res); } catch (e) { res(null); } }); } catch (e) { sellingTab = null; }
      }
    } catch (e) {}

    if (!sellingTab || !sellingTab.id) {
      try {
        const fresh = await ffmGetFreshSellingTab();
        if (fresh && fresh.id) sellingTab = fresh;
      } catch (e) {}
    }

    if (!sellingTab || !sellingTab.id) {
      // open silently to run cleanup
      try { sellingTab = await safeTabsCreate({ url: 'https://www.facebook.com/marketplace/you/selling', active: false }); createdSellingTab = true; } catch (e) { sellingTab = null; }
    }

    if (sellingTab && sellingTab.id) {
      try { await waitForContentReady(sellingTab.id); } catch (e) {}
      try { await clearFailedListings(sellingTab.id); } catch (e) {}
      try { await new Promise(r => setTimeout(r, 1500)); } catch (e) {}
      if (createdSellingTab) {
            try {
              try { safeTabsRemove(sellingTab.id).catch(()=>{}); } catch (e) {}
            } catch (e) {}
      }
    }
  } catch (e) {}
  const want = (title || '') + '';
  try {
    // normalize helper exists elsewhere in this file
    const wantNorm = (typeof normalizeInventoryNameLocal === 'function') ? normalizeInventoryNameLocal(want) : (want || '').toLowerCase().trim();
    const items = await new Promise(res => { try { chrome.storage.local.get(null, res); } catch (e) { res({}); } });
    let bestId = null, bestScore = -1;
    for (const k of Object.keys(items || {})) {
      try {
        if (!k || !k.startsWith('ffm_publish_')) continue;
        const val = items[k];
        const vnorm = (val && typeof normalizeInventoryNameLocal === 'function') ? normalizeInventoryNameLocal(val.inventoryName) : ((val && val.inventoryName) || '').toString().toLowerCase().trim();
        let score = 0;
        if (vnorm && wantNorm && vnorm === wantNorm) score += 10;
        try { if (Array.isArray(val && val.images) && val.images.length) score += 5; } catch (e) {}
        try { if (Array.isArray(val && val.s3ImageKeys) && val.s3ImageKeys.length) score += 4; } catch (e) {}
        try { if (val && (val.price || val.price === 0)) score += 3; } catch (e) {}
        try { if (val && val.description && String(val.description).trim()) score += 2; } catch (e) {}
        try { if (val && val.category) score += 1; } catch (e) {}
        try { if (val && !val.__ffm_stripped) score += 1; } catch (e) {}
        if (score > bestScore) { bestScore = score; bestId = k.slice('ffm_publish_'.length); }
      } catch (e) {}
    }

    if (bestId) {
      try { chrome.storage.local.set({ ['ffm_force_auto_publish_' + bestId]: true }, () => {}); } catch (e) {}
      try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: want || null, publishRequestId: bestId }); } catch (e) {}
      try { publishListingById(bestId); } catch (e) { throw e; }
      return;
    }

    // No staged candidate — check if DnR saved a staged listing usable for publish
    try {
      const stagedSaved = (items && items.ffm_staged_listing) ? items.ffm_staged_listing : null;
      if (stagedSaved && typeof stagedSaved === 'object' && ((stagedSaved.inventoryName && stagedSaved.inventoryName.toString().toLowerCase().trim() === wantNorm) || (!stagedSaved.inventoryName && stagedSaved.title && stagedSaved.title.toString().toLowerCase().trim() === wantNorm))) {
        // Use the stagedSaved payload as the staged publish
        const publishRequestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const stagedKey = 'ffm_publish_' + publishRequestId;
        try { await new Promise(res => { chrome.storage.local.set({ [stagedKey]: stagedSaved }, res); }); } catch (e) { /* non-fatal */ }
        try { chrome.storage.local.set({ ['ffm_force_auto_publish_' + publishRequestId]: true }, () => {}); } catch (e) {}
        try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: want || null, publishRequestId }); } catch (e) {}
        try {
          publishListingById(publishRequestId);
          // Wait for publish-inflight ack before removing staged payload; if ack not seen
          // within timeout, remove staged payload to avoid stale data.
          try {
            waitForPublishInflight(publishRequestId, 15000).then((ack) => {
              try {
                chrome.storage.local.remove && chrome.storage.local.remove('ffm_staged_listing');
                if (ack) console.log('[AutoList Pro bg] ✅ DnR staged payload cleared after publish start', publishRequestId);
                else console.warn('[AutoList Pro bg] ⚠️ DnR staged payload cleared after timeout (no publish ack)', publishRequestId);
              } catch (e) { /* ignore */ }
            }).catch(() => {
              try { chrome.storage.local.remove && chrome.storage.local.remove('ffm_staged_listing'); } catch (e) {}
            });
          } catch (e) { try { chrome.storage.local.remove && chrome.storage.local.remove('ffm_staged_listing'); } catch (er) {} }
        } catch (e) { throw e; }
        return;
      }
    } catch (e) {}

    // No DnR-staged listing found — create minimal staged payload and publish it
    const publishRequestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const stagedKey = 'ffm_publish_' + publishRequestId;
    // Build minimal staged listing and attempt to enrich from DB before persisting
    try {
      const stagedListing = { inventoryName: want };
        try {
          const listingKey = want || null;
          const { imageFiles, videoFiles } = await ffmReconstructMediaFilesFromDB(listingKey);
          if ((imageFiles && imageFiles.length) || (videoFiles && videoFiles.length)) {
            stagedListing.imageFiles = imageFiles;
            stagedListing.videoFiles = videoFiles;
            stagedListing.files = [].concat(imageFiles || [], videoFiles || []);
            if (listingKey) {
              stagedListing.localImageKeys = (imageFiles || []).map((_, idx) => ffmMakeS3MediaKey(listingKey, idx, 'image', 'jpg'));
              stagedListing.localVideoKeys = (videoFiles || []).map((_, idx) => ffmMakeS3MediaKey(listingKey, idx, 'video', 'mp4'));
            }
          }
        } catch (e) {
        console.warn('[bg] publishListingByName: media reconstruction failed, staging minimal payload', e);
      }

      await new Promise(res => { try { chrome.storage.local.set({ [stagedKey]: stagedListing }, res); } catch (e) { res(); } });
        try {
        const metaKey = 'ffm_publish_meta_' + publishRequestId;
        const meta = { inventoryName: stagedListing && (stagedListing.inventoryName || stagedListing.title || null), ts: Date.now() };
        try { chrome.storage.local.set({ [metaKey]: meta }, () => {}); } catch (e) {}
      } catch (e) {}
      try { chrome.storage.local.set({ ['ffm_force_auto_publish_' + publishRequestId]: true }, () => {}); } catch (e) {}
      try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: want || null, publishRequestId }); } catch (e) {}
      try { publishListingById(publishRequestId); } catch (e) { throw e; }
    } catch (e) {
      // persist minimal staged listing as fallback
      try { await new Promise(res => { try { chrome.storage.local.set({ [stagedKey]: { inventoryName: want } }, res); } catch (er) { res(); } }); } catch (_) {}
      try {
        const metaKey = 'ffm_publish_meta_' + publishRequestId;
        const meta = { inventoryName: (want || null), ts: Date.now() };
        try { chrome.storage.local.set({ [metaKey]: meta }, () => {}); } catch (e) {}
      } catch (e) {}
      try { chrome.storage.local.set({ ['ffm_force_auto_publish_' + publishRequestId]: true }, () => {}); } catch (e) {}
      try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: want || null, publishRequestId }); } catch (e) {}
      try { publishListingById(publishRequestId); } catch (e) { throw e; }
    }
  } catch (err) {
    throw err;
  }
}

// Listener for legacy 'ffm_trigger_full_publish_after_relist' has been removed.
// The background now uses a single, authoritative DnR -> publish handoff (triggered
// directly from the delete flow) to avoid duplicate publishes. Content scripts may
// still send the legacy message but it will be ignored. If you need to re-enable
// this for debugging, reintroduce a listener that calls publishListingByName(msg.title).

// Note: the unified DnR-triggered publish relay (ffm_run_publish_after_dnr)
// was intentionally removed to ensure the background directly handles publish
// handoff after delete success. This avoids relaying via additional messages
// and keeps the publish flow deterministic.

// Simple URL support check (used by query-panel)
function isSupportedUrl(url) {
  return /^https?:\/\/(www\.)?facebook\.com\//i.test(url || '');
}

// addSafeListener: convenient wrapper used across the file to add runtime listeners safely.
// It registers a chrome.runtime.onMessage listener that wraps the handler and ensures
// an async sendResponse is handled with a timeout to avoid silent message-port closures.
function addSafeListener(handler) {
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        let responded = false;
        const origSend = sendResponse;
        sendResponse = function(...args) { responded = true; try { origSend && origSend(...args); } catch (e) {} };
        const rv = handler(message, sender, sendResponse);
        // If handler intends to respond asynchronously, keep a safety timeout to auto-respond
        if (rv === true) {
          setTimeout(() => {
            if (!responded) {
              try { origSend && origSend({ ok: false, error: 'no-response-timeout' }); } catch (e) {}
              if (FAST4MP_DEBUG) console.warn('[AutoList Pro] async onMessage did not call sendResponse within 5s for', message && (message.action || message.prompt));
            }
          }, 5000);
        }
        // Return true to keep the message channel open for async handlers.
        return true;
      } catch (e) {
        try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (_) {}
      }
    });

      
  } catch (e) { if (FAST4MP_DEBUG) console.debug('[AutoList Pro] addSafeListener install failed', e); }
}

try {
  addSafeListener((message, sender, sendResponse) => {
    try {
      if (!message || message.action !== 'publish-complete') return;

      // Tolerant handling: accept non-staged/manual publishes that don't
      // include a publishRequestId. Treat them as manual publishes and
      // relay to the popup. Downgrade noisy warnings to debug to avoid
      // spurious error badges for benign manual publishes.
      if (!message.publishRequestId) {
        try { console.debug && console.debug('[AutoList Pro bg] Received publish-complete without publishRequestId — treating as manual publish', { inventoryName: message.inventoryName || null }); } catch (e) {}
        try { sendResponse && sendResponse({ acceptedAsManual: true }); } catch (e) {}
        // fall through: we will still relay a canonical publish-complete
        // message below (with a null publishRequestId) so popup/UI can
        // update state consistently.
      }

      // Basic background log (canonical message)
      try {
        console.debug('[AutoList Pro bg] publish-complete relay (bg) received', {
          publishRequestId: message.publishRequestId,
          inventoryName: message.inventoryName || null
        });
      } catch (e) {}

      // Clear transient manual-action marker on any publish-complete so popup/content
      // won't treat subsequent flows as manual by mistake.
      try {
        try { chrome.storage && chrome.storage.local && chrome.storage.local.remove(['ffm_manual_action'], () => { try { console.log('[AutoList Pro bg] ffm_manual_action cleared on publish-complete'); } catch (e) {} }); } catch (e) {}
      } catch (e) {}

      // Relay the canonical publish-complete to popup
      try {
        chrome.runtime.sendMessage({
          action: 'publish-complete',
          publishRequestId: message.publishRequestId,
          inventoryName: message.inventoryName,
          when: message.when || Date.now()
        });
      } catch (e) {}

      // Trigger standard soft-refresh path used by scheduled flows
      try {
        if (ffmThrottleRefresh()) {
          chrome.runtime.sendMessage({ action: 'ffmRefreshSavedListings' });
        }
      } catch (e) {}

      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      try { if (typeof ffmFinalizeSDNR === 'function') ffmFinalizeSDNR('publish-complete'); } catch (e) {}
    } catch (e) {}

    return true;
  });
} catch (e) {
  console.debug('[AutoList Pro bg] publish-complete relay install failed', e);
}


// Helper: read/consume chrome.runtime.lastError when we're inside arbitrary callbacks so
// DevTools doesn't print noisy "Unchecked runtime.lastError" messages. Call this at the
// start of any callback handed to chrome.* APIs when the body doesn't already check
// chrome.runtime.lastError.
function consumeLastError() {
  try {
    if (chrome && chrome.runtime && chrome.runtime.lastError) {
      try { if (FAST4MP_DEBUG) console.debug('[bg] consumeLastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
      // reading the property is sufficient to mark it as observed
      /* eslint-disable no-unused-expressions */
      chrome.runtime.lastError;
      /* eslint-enable no-unused-expressions */
    }
  } catch (e) {}
}

// ================================
// ADS POST-RUN CONTROLLED REBOOT
// ================================

globalThis.__ffm_ads_reboot_scheduled = false;

function ffmSoftReset(reason = 'unknown') {
  try {
    console.warn('[AutoList Pro] 🧹 Soft reset starting:', reason);

    // Clear transient runtime flags
    globalThis.ffmSDNRActive = false;
    globalThis.ffmSPActive = false;
    globalThis.ffmUserGestureActive = false;
    globalThis.__ffm_block_as = false;

    // Clear task identity
    globalThis.ffmActiveDnRTaskId = null;
    globalThis.ffmActiveSDNRTaskId = null;

    // Defensive: clear any throttles / temp state if present
    try { ffmResetThrottles?.(); } catch (e) {}
    try { ffmDetachTempListeners?.(); } catch (e) {}

    // Persist reset marker
    try {
      chrome.storage.local.set({
        ffm_last_soft_reset: Date.now(),
        ffm_last_soft_reset_reason: reason
      });
    } catch {}
  } catch (e) {
    console.error('[AutoList Pro] Soft reset error', e);
  }
}

function ffmIsSafeToReload() {
  try {
    return (
      !globalThis.ffmSDNRActive &&
      !globalThis.ffmSPActive &&
      !globalThis.ffmActiveDnRTaskId &&
      !globalThis.ffmActiveSDNRTaskId
    );
  } catch (e) { return false; }
}

function ffmScheduleHardReload(delayMs = 15000) {
  if (globalThis.__ffm_ads_reboot_scheduled) {
    console.warn('[AutoList Pro] Reload already scheduled — skipping');
    return;
  }

  globalThis.__ffm_ads_reboot_scheduled = true;

  const alarmPrefix = 'ffm_controlled_reload::';
  const alarmName = alarmPrefix + Date.now() + '::' + Math.random().toString(36).slice(2);
  const when = Date.now() + Number(delayMs || 15000);

  try {
    try { chrome.storage.local.set({ ffm_scheduled_reload: { name: alarmName, when } }); } catch (e) {}
    chrome.alarms.create(alarmName, { when });
    console.warn('[AutoList Pro] 🔁 Scheduling controlled reload alarm', alarmName, 'in', delayMs, 'ms');
  } catch (e) {
    console.warn('[AutoList Pro] alarms.create failed, falling back to setTimeout', e);
    setTimeout(() => {
      try {
        if (!ffmIsSafeToReload()) {
          console.warn('[AutoList Pro] Reload deferred — activity still detected');
          globalThis.__ffm_ads_reboot_scheduled = false;
          return;
        }
        console.warn('[AutoList Pro] 🔄 Performing controlled background reload');
        try {
          try { if (globalThis.ffmMarkSidePanelRestoreWanted) ffmMarkSidePanelRestoreWanted('controlled-reboot'); } catch (e) {}
          chrome.storage.local.set({
            ffm_restore_sidepanel_after_reload: true,
            ffm_restore_sidepanel_ts: Date.now()
          });
        } catch (e) {}
        chrome.runtime.reload();
      } catch (e2) {
        console.error('[AutoList Pro] Reload failed', e2);
        globalThis.__ffm_ads_reboot_scheduled = false;
      }
    }, delayMs);
  }
}

// Alarm handler for controlled reloads — performs or defers reloads
try {
  if (chrome && chrome.alarms && chrome.alarms.onAlarm && typeof chrome.alarms.onAlarm.addListener === 'function') {
    chrome.alarms.onAlarm.addListener((alarm) => {
      try {
        if (!alarm || !alarm.name || String(alarm.name).indexOf('ffm_controlled_reload::') !== 0) return;

        (async () => {
          try {
            // Best-effort read of scheduled marker
            try {
              chrome.storage.local.get(['ffm_scheduled_reload'], (res) => {
                try { /* noop - marker is informational */ } catch (e) {}
              });
            } catch (e) {}

            if (!ffmIsSafeToReload()) {
              console.warn('[AutoList Pro] Reload deferred by alarm — activity detected, will retry in 5s');
              const retryName = 'ffm_controlled_reload_retry::' + Date.now() + '::' + Math.random().toString(36).slice(2);
              const retryWhen = Date.now() + 5000;
              try { chrome.storage.local.set({ ffm_scheduled_reload: { name: retryName, when: retryWhen } }); } catch (e) {}
              try { chrome.alarms.create(retryName, { when: retryWhen }); } catch (e) {}
              globalThis.__ffm_ads_reboot_scheduled = false;
              return;
            }

            try {
              console.warn('[AutoList Pro] 🔄 Performing controlled background reload (alarm)', alarm.name);
              try { chrome.storage.local.remove && chrome.storage.local.remove('ffm_scheduled_reload'); } catch (e) {}
              try {
                try { if (globalThis.ffmMarkSidePanelRestoreWanted) ffmMarkSidePanelRestoreWanted('controlled-reboot'); } catch (e) {}
                chrome.storage.local.set({
                  ffm_restore_sidepanel_after_reload: true,
                  ffm_restore_sidepanel_ts: Date.now()
                });
              } catch (e) {}
              chrome.runtime.reload();
            } catch (e) {
              console.error('[AutoList Pro] Reload failed in alarm handler', e);
              globalThis.__ffm_ads_reboot_scheduled = false;
            }
          } catch (e) {}
        })();
      } catch (e) {}
    });
  }
} catch (e) {}

// Note: `ffmSafeSendMessage` is defined earlier with a richer response shape
// (timeout support and {ok:..., response:...}) near the top of this file.
// The earlier implementation is canonical; do not redeclare it here.

// Helper: open sidePanel safely with defensive checks and promise rejection handling.
function safeSidePanelOpen(opts) {
  try {
    if (!chrome.sidePanel || typeof chrome.sidePanel.open !== 'function') return false;
    if (!canStealFocus()) {
      try {
        try {
          if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.focusSkips = (globalThis.__ffmTrace.counters.focusSkips||0) + 1;
          try { ffmTraceEvent('focus-skip', { api: 'sidePanel.open', opts: opts }); } catch (e) {}
          try {
            const stack = (new Error()).stack || null;
            try { globalThis.__ffmTrace.lastFocusSkip = { time: Date.now(), api: 'sidePanel.open', opts: opts || null, stack: stack }; } catch (e) {}
            try { if (chrome && chrome.storage && chrome.storage.local) chrome.storage.local.set({ ffm_last_focus_skip: globalThis.__ffmTrace.lastFocusSkip }, () => {}); } catch (e) {}
          } catch (e) {}
        } catch (e) {}
        if (ffmGlobal && ffmGlobal.FFM_DEBUG && ffmGlobal.FFM_DEBUG.BG) {
          try {
            const note = {
              id: ffmNotifyGenerateId(),
              title: 'FFM_DEBUG: skipped focus',
              body: 'safeSidePanelOpen skipped (no user gesture): opts=' + (opts ? JSON.stringify(opts) : '{}') + (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.lastFocusSkip && globalThis.__ffmTrace.lastFocusSkip.stack ? '\nstack:' + String(globalThis.__ffmTrace.lastFocusSkip.stack).split('\n').slice(0,6).join('\n') : ''),
              ts: Date.now(),
              level: 'debug'
            };
            try { ffmNotifyAppend(note); } catch (e) {}
          } catch (e) {}
        }
      } catch (e) {}
      return false;
    }
    const tryInvoke = (arg) => {
      try {
        // sanitize arg: if it's an object, remove undefined properties to avoid API signature errors
        let callArg = arg;
        try {
          if (callArg && typeof callArg === 'object') {
            const clean = {};
            for (const k of Object.keys(callArg)) {
              if (typeof callArg[k] !== 'undefined') clean[k] = callArg[k];
            }
            if (Object.keys(clean).length === 0) callArg = undefined;
            else callArg = clean;
          }
        } catch (e) { /* ignore sanitization errors */ }

  if (FAST4MP_DEBUG) try { console.debug('[AutoList Pro] safeSidePanelOpen calling sidePanel.open with', callArg); } catch (e) {}
  const maybe = (typeof callArg !== 'undefined') ? chrome.sidePanel.open(callArg) : chrome.sidePanel.open();
        try { Promise.resolve(maybe).catch(err => { console.debug && console.debug('[AutoList Pro] sidePanel.open rejected', err); }); } catch (e) {}
        try {
          setTimeout(() => {
            try {
              if (chrome && chrome.runtime && chrome.runtime.lastError) {
                try { console.debug('[AutoList Pro] safeSidePanelOpen lastError ->', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
              }
            } catch (e) {}
          }, 0);
        } catch (e) {}
        return true;
      } catch (e) {
        // ignore and continue
        return false;
      }
    };
    // Try options first, then no-arg fallback
    if (opts) {
      if (tryInvoke(opts)) return true;
    }
    if (tryInvoke()) return true;
    return false;
  } catch (e) {
    console.debug && console.debug('[AutoList Pro] safeSidePanelOpen failed', e);
    return false;
  }
}
      // Bridge: respond to CLFP status requests from content scripts in a safe
      // background context so content scripts don't need to read storage directly.
      // Implement as its own onMessage listener so msg/sendResponse are in-scope.
      try {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          try {
            if (msg && msg.type === 'ffm_get_clfp_status') {
              try {
                if (chrome && chrome.storage && chrome.storage.session && typeof chrome.storage.session.get === 'function') {
                  chrome.storage.session.get('CLFP_ACTIVE', (res) => {
                    try { sendResponse && sendResponse({ active: !!(res && res.CLFP_ACTIVE) }); } catch (err) { try { sendResponse && sendResponse({ active: false }); } catch(_){} }
                  });
                } else {
                  try {
                    // Fallback: if chrome.storage.session is unavailable (newer Chrome contexts),
                    // consult an in-memory flag set by the popup (via runtime message).
                    const activeFallback = !!(globalThis && globalThis.__ffm_clfp_active);
                    try { sendResponse && sendResponse({ active: activeFallback }); } catch (e) { try { sendResponse && sendResponse({ active: false }); } catch(_){} }
                  } catch (e) { try { sendResponse && sendResponse({ active: false }); } catch(_){} }
                }
              } catch (e) { try { sendResponse && sendResponse({ active: false }); } catch(_){} }
              return true; // async
            }
          } catch (e) {}
        });
      } catch (e) {}

// Configure side panel behavior on install: respect the user's persisted preference
try {
  chrome.runtime.onInstalled.addListener(() => {
    try {
      if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
        try {
          const enable = !!_ffm_use_sidepanel_cached;
          try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: enable }); } catch (e) {}
          console.log('[AutoList Pro] Side panel behavior set on install ->', enable);
        } catch (e) {}
      } else {
        console.log('[AutoList Pro] sidePanel API not available in this Chrome build');
      }
    } catch (e) { console.debug && console.debug('[AutoList Pro] onInstalled sidePanel setup failed', e); }
  });
} catch (e) { /* best-effort */ }

// Allow runtime messages to open the Side Panel manually
try {
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    try {
        // Reply with sender tab id for callers that need to persist per-tab flags from background
        if (msg && msg.action === 'whoami_tab') {
          try { sendResponse && sendResponse({ tabId: sender && sender.tab ? sender.tab.id : null }); } catch (e) {}
          return true;
        }
      // ===================================================================
      // NEW: Convert DnR button click → SDNR scheduled 5 seconds out
      // ===================================================================
      if (msg && msg.action === "ffm_schedule_dnr_as_sdnr") {
        try {
          const { listingId, inventoryName, listingTitle } = msg || {};

          console.log("[AutoList Pro bg][DNR→SDNR] Received request", msg);

          const taskId = 'dnr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          const task = {
            id: taskId,
            listingId: listingId || null,
            inventoryName: inventoryName || null,
            listingTitle: listingTitle || null,
            action: 'relist'
          };

          // Queue this task and let ffmPumpDnrQueue() run it in turn. Previously every
          // queued Delete/Relist scheduled its own alarm ~1s out, so a bulk relist of
          // many listings fired them all at (almost) the same time. The queue processes
          // exactly one task at a time, awaiting full completion before starting the next.
          try {
            const qRes = await new Promise(r => chrome.storage.local.get({ ffm_dnr_queue: [] }, r));
            const q = Array.isArray(qRes.ffm_dnr_queue) ? qRes.ffm_dnr_queue : [];
            q.push(Object.assign({}, task, { queuedAt: Date.now() }));
            await new Promise(r => chrome.storage.local.set({ ffm_dnr_queue: q }, r));

            // Keep a lightweight entry in scheduled_tasks so existing "already scheduled"
            // per-listing UI badges keep working while this sits in the queue.
            try {
              chrome.storage.local.get({ scheduled_tasks: [] }, (res) => {
                try {
                  const arr = Array.isArray(res.scheduled_tasks) ? res.scheduled_tasks : [];
                  const cleaned = arr.filter(t => !(t && String(t.id) === String(task.id)));
                  cleaned.push({
                    id: String(task.id),
                    taskId: String(task.id),
                    listingId: task.listingId || null,
                    when: Date.now(),
                    timeISO: new Date().toISOString(),
                    action: 'relist',
                    inventoryName: task.inventoryName || null,
                    payload: null
                  });
                  chrome.storage.local.set({ scheduled_tasks: cleaned }, () => {
                    try { console.debug('[AutoList Pro bg] schedule-task persisted (dnr)', { id: task.id }); } catch (e) {}
                  });
                } catch (e) { console.debug('[AutoList Pro bg] schedule-task persist error (dnr)', e); }
              });
            } catch (e) { console.debug('[AutoList Pro bg] schedule-task outer persist error (dnr)', e); }

            console.log('[AutoList Pro bg][DNR→SDNR] Queued', taskId, '— queue length', q.length);
            try { ffmPumpDnrQueue(); } catch (e) { console.debug('[AutoList Pro bg] ffmPumpDnrQueue kick failed', e); }
          } catch (e) { console.error('[AutoList Pro bg] Failed to queue DNR task', e); }

          // Respond immediately to caller — the task itself runs when its turn comes.
          sendResponse({ ok: true, scheduled: true, taskId });
          return true;
        } catch (err) {
          console.error("[AutoList Pro bg][DNR→SDNR] Failed to schedule", err);
          sendResponse({ ok: false, error: err?.message || "exception" });
          return false;
        }
      }
      if (!msg || !msg.action) return;
      if (msg.action === 'openSidePanel') {
        try {
          // Best-effort: only open once per session. Some Chrome builds require a tabId/windowId.
          if (!ffmPanelOpen) {
            try {
              // Try to find an active tab and pass its id to the API when available
              const tabs = await new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, res));
              const tab = tabs && tabs[0];
              if (tab && typeof tab.id === 'number') {
                try {
                  safeSidePanelOpen({ tabId: tab.id });
                  ffmPanelOpen = true;
                  try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_panel_open: true }); } catch (e) {}
                  console.log('[AutoList Pro bg] Side panel opened');
                } catch (errOpen) {
                  console.warn('[AutoList Pro bg] openSidePanel failed to open with tabId', errOpen);
                }
              } else {
                // fallback: call safe open without tabId
                try {
                  safeSidePanelOpen();
                  ffmPanelOpen = true;
                  try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_panel_open: true }); } catch (e) {}
                  console.log('[AutoList Pro bg] Side panel opened (no tabId)');
                } catch (errOpen2) {
                  console.warn('[AutoList Pro bg] openSidePanel fallback failed', errOpen2);
                }
              }
            } catch (e) { console.debug && console.debug('[AutoList Pro] openSidePanel outer failed', e); }
          } else {
            console.log('[AutoList Pro bg] Side panel already open, skipping reopen');
          }
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        } catch (e) { console.debug && console.debug('[AutoList Pro] openSidePanel handler error', e); }
        return true;
      }
      if (msg.action === 'closeSidePanel') {
        try { ffmPanelOpen = false; try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_panel_open: false }); } catch (e) {} console.log('[AutoList Pro bg] Side panel closed flag set'); } catch (e) {}
        return true;
      }
      // -----------------------------------------------------------
      // PATCH 12 — Reinject mediaDB/content_main into the real MP iframe
      // -----------------------------------------------------------
      if (msg.action === "fast4mp-inject-into-iframe") {
        try {
          // Re-inject mediaDB and content_main into the target frame (allFrames ensures frame coverage)
          chrome.scripting.executeScript({
            target: { tabId: sender && sender.tab ? sender.tab.id : null, allFrames: true },
            files: [
              "mediaDB.js",
              "content/content_main.js"
            ]
          });
          console.log('[Patch12] Reinjected scripts into Marketplace iframe');
        } catch (e) {
          console.error('[Patch12] Injection failed:', e);
        }
        return true;
      }
    } catch (e) {}
  });
} catch (e) {}

// Lightweight background onMessage relay for simple result storage and popup refresh.
try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !message.action) return;
      // (openPopup handler removed) legacy toggle code cleaned up
      // External code can update the latest result (e.g., content script after publish)
      if (message.action === 'updateResult') {
        try { latestPublishStatus = message.data || null; } catch (e) {}
        // If popup is open/listening, forward immediately
        try { chrome.runtime.sendMessage({ action: 'refreshPopup', data: latestPublishStatus }); } catch (e) {}
        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        return true;
      }
      if (message.action === 'getResult') {
        try { sendResponse && sendResponse({ data: latestPublishStatus }); } catch (e) {}
        return true;
      }
      if (message.action === 'exitSelectMode') {
        try {
          ffmPanelOpen = false;
          try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_panel_open: false, ffm_panel_disabled: false, ffm_generate_mode: false }); } catch (e) {}
          console.log('[AutoList Pro bg] Side panel re-enabled after exitSelectMode');
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        } catch (e) { console.debug('exitSelectMode handler error', e); }
        return true;
      }
      // Popup requests background to perform a generate scrape in the Sharetown tab.
      if (message.action === 'perform-generate-scrape') {
        try {
          (async () => {
            try {
              // Find a Sharetown tab (prefer active tabs first)
              const tabs = await new Promise((res) => chrome.tabs.query({ url: 'https://app.sharetown.io/*' }, res));
              const tab = (tabs && tabs.find(t => t.active) ) || (tabs && tabs[0]);
              if (!tab || typeof tab.id !== 'number') { try { sendResponse && sendResponse(null); } catch (e) {} return; }

              if (FAST4MP_DEBUG) try { console.debug('[bg] perform-generate-scrape (simple): target tab', { id: tab.id, url: tab.url }); } catch (e) {}

              // Run the in-page scraper directly via scripting.executeScript and return the full result
              try {
                chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeSharetownDetailsInPage })
                  .then((arr) => {
                    try {
                      const execRes = arr && arr[0] && arr[0].result ? arr[0].result : null;
                      if (FAST4MP_DEBUG) try { console.debug('[bg] perform-generate-scrape (simple) result', execRes); } catch (e) {}
                      // Persist the fields portion as a fallback cache if present
                      try {
                        const cache = execRes && execRes.fields ? Object.assign({}, execRes.fields, { timestamp: Date.now() }) : Object.assign({}, execRes || {}, { timestamp: Date.now() });
                        chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: cache });
                      } catch (e) {}
                      // Broadcast the full result so popups can consume either shape
                      try { chrome.runtime.sendMessage({ action: 'generate-scrape-result', data: execRes }); } catch (e) {}
                      try { sendResponse && sendResponse(execRes); } catch (e) {}
                    } catch (e) {
                      if (FAST4MP_DEBUG) try { console.debug('[bg] perform-generate-scrape then-cb failed', e); } catch (er) {}
                      try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
                    }
                  })
                  .catch((err) => {
                    if (FAST4MP_DEBUG) try { console.debug('[bg] perform-generate-scrape executeScript rejected', err); } catch (er) {}
                    try { sendResponse && sendResponse({ ok: false, error: String(err) }); } catch (e) {}
                  });
                return;
              } catch (e) {
                if (FAST4MP_DEBUG) try { console.debug('[bg] perform-generate-scrape outer executeScript failed', e); } catch (er) {}
                try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
                return;
              }
            } catch (e) { try { sendResponse && sendResponse(null); } catch (er) {} }
          })();
        } catch (e) { try { sendResponse && sendResponse(null); } catch (er) {} }
        return true;
      }
      // When content asks to surface the Generate UI in the side panel, forward to popup
      if (message.action === 'show-generate-listing') {
        try {
          try { chrome.runtime.sendMessage({ action: 'show-generate-listing-inline' }); } catch (e) {}
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        } catch (e) {}
        return true;
      }
          // Lightweight notification trigger from content (simple, tiny message)
          if (message.action === 'publish-complete') {
            try {
              // Mirror into the latestPublishStatus so popup shows recent state
              const ts = Date.now();
              latestPublishStatus = { text: `✅ ${message.inventoryName || 'Listing'} published`, ok: true, when: ts, inventoryName: message.inventoryName || null, publishRequestId: message.publishRequestId || null };
  try { chrome.runtime.sendMessage({ action: 'refreshPopup', data: latestPublishStatus }); } catch (e) {}
  try { if (ffmThrottleRefresh()) chrome.runtime.sendMessage({ action: 'ffmRefreshSavedListings' }); } catch (e) {}
              // Create a desktop notification if available (with fallback to request permission)
              try {
                const nid = 'ffm_publish_' + (message.publishRequestId || ts);
                const opts = { type: 'basic', iconUrl: chrome.runtime.getURL('images/Green_Alarm.png'), title: 'Listing published', message: message.inventoryName ? `${message.inventoryName} published` : 'A listing was published', priority: 0 };
                try { createNotificationWithFallback(nid, opts); } catch (e) { /* ignore */ }
              } catch (e) { /* ignore notification failures */ }
              // Also set extension badge to nudge the user
              try {
                if (chrome && chrome.action && typeof chrome.action.setBadgeText === 'function') {
                  try { chrome.action.setBadgeText({ text: '' }); } catch (e) {}
                }
              } catch (e) {}
              try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
            // Persist a lightweight trace snapshot for post-mortem debugging
            try {
              try { ffmTraceEvent && ffmTraceEvent('publish-complete-received', { publishRequestId: message.publishRequestId || null }); } catch (e) {}
              try { if (globalThis && globalThis.__ffmTrace && chrome && chrome.storage && chrome.storage.local) chrome.storage.local.set({ ffm_trace_snapshot: globalThis.__ffmTrace, ffm_last_focus_skip: globalThis.__ffmTrace.lastFocusSkip || null }, () => {}); } catch (e) {}
              try { appendPublishTrace && appendPublishTrace(message.publishRequestId, { event: 'bg-publish-complete-snapshot' }); } catch (e) {}
            } catch (e) {}
            return true;
          }
      // When content reports publish-complete, store a human-friendly status and forward to popup
      if (message.action === 'publish-complete') {
        try {
          // Defensive: clear transient manual-action marker here as well
          try { chrome.storage && chrome.storage.local && chrome.storage.local.remove(['ffm_manual_action'], () => { try { console.log('[AutoList Pro bg] ffm_manual_action cleared on publish-complete (secondary)'); } catch (e) {} }); } catch (e) {}
          const ts = message.when ? new Date(message.when) : new Date();
          const pretty = `✅ ${message.inventoryName || 'Listing'} published at ${ts.toLocaleString()}`;
          latestPublishStatus = { text: pretty, ok: !!message.ok, when: ts.getTime(), inventoryName: message.inventoryName || null, publishRequestId: message.publishRequestId || null };
          try { appendPublishTrace(message.publishRequestId, { event: 'bg-received-publish-complete', status: latestPublishStatus }); } catch (e) {}
          try { chrome.runtime.sendMessage({ action: 'refreshPopup', data: latestPublishStatus }); } catch (e) {}
          try { if (ffmThrottleRefresh()) chrome.runtime.sendMessage({ action: 'ffmRefreshSavedListings' }); } catch (e) {}
          // Also surface a desktop notification when available (with fallback)
          try {
            const nid = 'ffm_publish_' + (message.publishRequestId || ts.getTime());
            const opts = { type: 'basic', iconUrl: chrome.runtime.getURL('images/Green_Alarm.png'), title: 'Listing published', message: message.inventoryName ? `${message.inventoryName} published` : 'A listing was published', priority: 0 };
            try { createNotificationWithFallback(nid, opts); } catch (e) { /* ignore */ }
          // Also set extension badge to nudge the user
          try {
            if (chrome && chrome.action && typeof chrome.action.setBadgeText === 'function') {
              try { chrome.action.setBadgeText({ text: '' }); } catch (e) {}
            }
          } catch (e) {}
          } catch (e) { /* ignore notification failures */ }
          try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        return true;
      }
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }

// waitForContentListener(tabId, timeoutMs): resolves if a content script has signaled readiness
// for the given tab (via readyTabs or storage key). Rejects on timeout.
function waitForContentListener(tabId, timeoutMs) {
  timeoutMs = typeof timeoutMs === 'number' ? timeoutMs : 5000;
  return new Promise((resolve, reject) => {
    try {
      if (!tabId) return reject('no-tab');
      if (readyTabs && readyTabs.has(tabId)) return resolve();
      const key = 'ffm_iframe_ready_' + tabId;
      const interval = 250;
      const max = Math.max(1, Math.ceil(timeoutMs / interval));
      let attempts = 0;
      const iv = setInterval(() => {
        attempts++;
        try {
          if (readyTabs && readyTabs.has(tabId)) { clearInterval(iv); return resolve(); }
          chrome.storage.local.get([key], (res) => {
            try {
              if (res && res[key]) {
                try { readyTabs.add(tabId); } catch (e) {}
                clearInterval(iv);
                return resolve();
              }
              if (attempts >= max) {
                clearInterval(iv);
                return reject('timeout');
              }
            } catch (e) { /* ignore per best-effort */ }
          });
        } catch (e) { /* ignore per best-effort */ }
      }, interval);
    } catch (e) { try { reject(e); } catch (er) {} }
  });
}
  // === Sharetown Generate: helpers ===
  async function ffmGetActiveTab() {
    try {
      const tabs = await new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, res));
      const tab = tabs && tabs[0];
      return tab || null;
    } catch (e) { return null; }
  }

  function ffmIsSharetownDetails(url = "") {
    try { return /https:\/\/app\.sharetown\.io\/inventory\/inventory-details/i.test(url || ''); } catch (e) { return false; }
  }

  // This runs IN the Sharetown page via chrome.scripting.executeScript
  // === Scrape Sharetown details (runs in the page) ===
  async function scrapeSharetownDetailsInPage() {
      // helper for label-based scraping — more robust: exact match fallback, then contains-match search
      const getValueByLabel = (labelText) => {
        try {
          const pickMoneyFromNode = (node) => {
            try {
              if (!node) return "";
              // search node and nearby descendants for $ pattern
              const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
              while (walker.nextNode()) {
                const t = walker.currentNode && walker.currentNode.textContent && walker.currentNode.textContent.trim();
                if (t && /\$\s?[\d,.]+/.test(t)) {
                  const m = t.match(/\$\s?([\d,\.]+)/);
                  if (m && m[1]) return m[1].replace(/,/g, '');
                }
              }
            } catch (e) {}
            return "";
          };

          // 1) exact-equal label nodes (previous behavior)
          const labelsExact = Array.from(document.querySelectorAll('div, span, p, label, strong'))
            .filter(el => el.textContent && el.textContent.trim().toLowerCase() === labelText.toLowerCase());
          for (const lbl of labelsExact) {
            let node = lbl.parentElement;
            for (let i = 0; i < 4 && node; i++) {
              const found = pickMoneyFromNode(node);
              if (found) return found;
              node = node.parentElement;
            }
          }

          // 2) contains-match (case-insensitive) — find nodes that include the label phrase
          const labelsContains = Array.from(document.querySelectorAll('div, span, p, label, li'))
            .filter(el => el.textContent && el.textContent.toLowerCase().includes(labelText.toLowerCase()));
          for (const lbl of labelsContains) {
            // check siblings and parent areas for a money token
            try {
              // sibling search
              let sib = lbl.nextElementSibling;
              for (let i = 0; i < 6 && sib; i++) {
                const f = pickMoneyFromNode(sib);
                if (f) return f;
                sib = sib.nextElementSibling;
              }
              // parent/ancestor search
              let node = lbl.parentElement;
              for (let i = 0; i < 4 && node; i++) {
                const found = pickMoneyFromNode(node);
                if (found) return found;
                node = node.parentElement;
              }
            } catch (e) {}
          }

          // 3) fallback — any text node in the document with a $ value (prefer within inventory container)
          try {
            const candidate = Array.from(document.querySelectorAll('div, span, p, li'))
              .map(n => n.textContent && n.textContent.trim())
              .filter(Boolean)
              .find(t => /\$\s?[\d,.]+/.test(t));
            if (candidate) {
              const m = candidate.match(/\$\s?([\d,\.]+)/);
              if (m && m[1]) return m[1].replace(/,/g, '');
            }
          } catch (e) {}
        } catch (e) {}
        return "";
      };

    // --- A: Brand name ---
    const nameA = document.querySelector("h3.inventory-details__title")?.textContent.trim() || "";

    // --- B: Model line ---
    const nameB = document.querySelector("p.inventory-details__link-lbl")?.textContent.trim() || "";

    // --- Normalize and combine: remove 'the', convert parenthetical size like '(1 King)' -> 'King',
    // dedupe repeated words (case-insensitive) while preserving first-seen casing.
    const normalizeAndCombineNames = (a, b) => {
      try {
        const extractParenSize = (s) => {
          try {
            const m = s.match(/\(([^)]+)\)/);
            if (!m) return { cleaned: s.replace(/\(|\)/g, '').trim(), size: '', firmness: '' };
            const inner = m[1] || '';
            // split inner by commas to separate size and descriptors like 'Firmness: Medium'
            const parts = inner.split(',').map(p => p.trim()).filter(Boolean);
            const sizeParts = [];
            let firmness = '';
            for (const p of parts) {
              try {
                if (/firmness\s*[:\-]/i.test(p)) {
                  // extract descriptor after 'Firmness:' or 'Firmness -'
                  const desc = p.replace(/.*firmness\s*[:\-]?\s*/i, '').trim();
                  if (desc) firmness = desc;
                  continue;
                }
                // If part contains a known size keyword or a numeric+word like '1 King', treat as size
                if (/\b(king|queen|twin|full|double|california|cal|short|long)\b/i.test(p) || /\d+\s*\w+/i.test(p) || /\b(king|queen)-?size\b/i.test(p)) {
                  // remove numeric prefixes
                  const cleanedPart = p.replace(/^[\d\s]+/g, '').replace(/[,()]/g, '').trim();
                  if (cleanedPart) sizeParts.push(cleanedPart);
                  continue;
                }
                // Otherwise, if short token, assume it's part of size (e.g., 'Premier')
                if (p.split(/\s+/).length <= 3) sizeParts.push(p);
              } catch (e) {}
            }
            const size = sizeParts.join(' ').trim();
            const cleaned = s.replace(/\([^)]*\)/g, '').trim();
            return { cleaned, size, firmness };
          } catch (e) { return { cleaned: s.replace(/\(|\)/g, '').trim(), size: '', firmness: '' }; }
        };

        const stripThe = (s) => (s || '').replace(/\bthe\b/gi, '').replace(/[,]/g, '').trim();

        // remove common filler words like 'Mattress' and handle 'Firmness: ...' tokens
        const preprocess = (s) => {
          try {
            if (!s) return '';
            return s.replace(/\bMattress\b/gi, '').trim();
          } catch (e) { return s; }
        };

        const pieces = [];
        const seen = new Set();

        const pushTokens = (src) => {
          if (!src) return;
          const pre = preprocess(src || '');
          let { cleaned, size, firmness } = extractParenSize(pre);
          // split cleaned by whitespace
          const toks = (cleaned || '').split(/\s+/).filter(Boolean);
          for (const t of toks) {
            const key = t.toLowerCase();
            if (!seen.has(key)) { seen.add(key); pieces.push(t); }
          }
          if (size) {
            // append size tokens (e.g., 'King') if not already present
            const stoks = size.split(/\s+/).filter(Boolean);
            for (const sT of stoks) {
              const k2 = sT.toLowerCase();
              if (!seen.has(k2)) { seen.add(k2); pieces.push(sT); }
            }
          }
          if (firmness) {
            // Omit 'Medium' as it's the default and not needed
            if (!/^(medium)$/i.test(firmness.trim())) {
              const fToks = firmness.split(/\s+/).filter(Boolean);
              for (const fTok of fToks) {
                const kf = fTok.toLowerCase();
                if (!seen.has(kf)) { seen.add(kf); pieces.push(fTok); }
              }
            }
          }
        };

        pushTokens(stripThe(a));
        pushTokens(stripThe(b));

        // Join with single spaces, preserve original token casing as in pieces
        return pieces.join(' ').replace(/\s+/g, ' ').trim();
      } catch (e) { return ((a || '') + ' ' + (b || '')).trim(); }
    };

    const combined = normalizeAndCombineNames(nameA, nameB);

  // --- Correct values ---
  const retail = getValueByLabel("Retail Price") || getValueByLabel('Retail');
  const minAd = getValueByLabel("Min Ad Price") || getValueByLabel('Min Ad') || getValueByLabel('Min Ad Price (auto)') || getValueByLabel('Min Ad Price');

    // --- Derived defaults and helpers ---
    try {
      // Condition default
      var condition = 'Used-Like New';

      // Size detection (bed sizes) — default King
      const searchText = (combined + ' ' + nameA + ' ' + nameB).toLowerCase();
      let size = 'King';
      try {
        if (/twin\s*xl|twinxl/i.test(searchText)) size = 'Twin XL';
        else if (/california\s*king|cal\s*king|cal-?king/i.test(searchText)) size = 'Cal King';
        else if (/\bking\b/i.test(searchText)) size = 'King';
        else if (/\bqueen\b/i.test(searchText)) size = 'Queen';
        else if (/\b(full|double)\b/i.test(searchText)) size = 'Full';
        else if (/\btwin\b/i.test(searchText)) size = 'Twin';
      } catch (e) {}

      // Core detection — default Hybrid
      let core = 'Hybrid';
      try {
        if (/hybrid/i.test(searchText)) core = 'Hybrid';
        else if (/memory\s*foam|memoryfoam|memory/i.test(searchText)) core = 'Memory Foam';
        else if (/foam\b/i.test(searchText)) core = 'Foam';
        else if (/innerspring|innerspring\b/i.test(searchText)) core = 'Innerspring';
        else if (/latex/i.test(searchText)) core = 'Latex';
      } catch (e) {}

      // Comfort detection — default Medium
      let comfort = 'Medium';
      try {
        if (/\bfirm\b|\bfirmness[:\-]?\s*firm\b/i.test(searchText)) comfort = 'Firm';
        else if (/\bplush\b|\bsoft\b/i.test(searchText)) comfort = 'Plush';
        else if (/\bsoft\b/i.test(searchText)) comfort = 'Soft';
      } catch (e) {}

      // Compose default description (Default_1) with values
      let desc = '';
      try {
        const fmtPrice = (p) => { try { if (!p && p !== 0) return ''; return '$' + String(p); } catch (e) { return String(p || ''); } };
        desc = `Default_1\n\nInventory Name: ${combined || ''}\nPrice: ${fmtPrice(minAd)}\nRetail Price: ${fmtPrice(retail)}\nCondition: ${condition}\nSize: ${size}\nCore: ${core}\nComfort: ${comfort}`;
      } catch (e) { desc = 'Default_1'; }

      return {
        ok: true,
        fields: {
          Inventory_Name: combined,
          Title: combined,
          // expose raw scraped fragments so callers (popup) can recover parenthetical size/firmness
          Raw_NameA: nameA,
          Raw_NameB: nameB,
          Price: minAd,
          Retail_Price: retail,
          Condition: condition,
          Size: size,
          Core: core,
          Comfort: comfort,
          Description: desc,
          // legacy keys for backwards compatibility
          inventoryName: combined,
          title: combined,
          price: minAd,
          retailPrice: retail
        }
      };
    } catch (e) {
      return { ok: true, fields: { Inventory_Name: combined, Title: combined, Price: minAd, Retail_Price: retail, inventoryName: combined, title: combined, price: minAd, retailPrice: retail } };
    }
  }

  // Helper: attempt to create a notification, and if it fails, try requesting optional permission
async function createNotificationWithFallback(nid, opts) {
  try {
    if (chrome && chrome.notifications && typeof chrome.notifications.create === 'function') {
      // Try to create notification; catch synchronous errors
      try {
        chrome.notifications.create(nid, opts, () => {});
        return { ok: true };
      } catch (e) {
        // fall through to permission request
      }
    }
  } catch (e) {}
  // As a fallback, attempt to request optional permission if available
  try {
    if (chrome && chrome.permissions && typeof chrome.permissions.request === 'function') {
      return new Promise((resolve) => {
        try {
          chrome.permissions.request({ permissions: ['notifications'] }, (granted) => {
            try {
              if (granted) {
                try { chrome.notifications.create(nid, opts, () => {}); } catch (e) {}
                resolve({ ok: true, granted: true });
              } else {
                // Store rationale in latestPublishStatus so popup can surface it
                try { latestPublishStatus = latestPublishStatus || {}; latestPublishStatus.notificationsAllowed = false; } catch (e) {}
                resolve({ ok: false, granted: false });
              }
            } catch (e) { resolve({ ok: false, error: String(e) }); }
          });
        } catch (e) { resolve({ ok: false, error: String(e) }); }
      });
    }
  } catch (e) {}
  return { ok: false, error: 'no-notifications-api' };
}

// Minimal diagnostic push stub used by the fb image scan flow; keep lightweight to avoid errors.
function __AutoListPro_pushMessageDiag(msg) {
  try {
    if (FAST4MP_DEBUG) console.debug('[AutoList Pro diag]', msg);
  } catch (e) {}
}

// Serial queue for Delete/Relist (DnR) tasks queued via 'ffm_schedule_dnr_as_sdnr'
// (single manual Delete/Relist clicks, ADS "Run Now", and bulk "Relist Multiple…").
// Processes exactly one task at a time — awaits full completion before starting
// the next — instead of every queued item scheduling its own ~1s alarm and all
// firing together. `ffm_dnr_active_task` is persisted so a killed/restarted MV3
// service worker can tell "something is running" from "queue just needs a kick".
// Blocks until the currently-running Delete/Relist for `task` has actually
// finished on Facebook, or until maxWaitMs elapses as a safety fallback (so one
// stuck/failed listing can't freeze the rest of the queue forever).
//
// IMPORTANT: globalThis.__ffmActiveSDnR is used as a SINGLE active-run object
// (root-level .taskId/.listingId/.stage) by the app's own delete->publish
// handoff logic (see the 'delete-complete' handler's hasActiveRun check, and
// publishListingById's finally block which does `__ffmActiveSDnR = null`).
// It is NOT a map keyed by listingId. Reading/writing it as a map here caused
// the handoff logic to see "no active run" almost immediately after each task
// started (it would then adopt its own single-object context), which made
// this settle-check see "not active" within milliseconds and blow through the
// whole queue — this is what actually caused every listing to fire at once.
async function ffmWaitForDnrTaskSettle(task, maxWaitMs = 5 * 60 * 1000) {
  const myTaskId = task && task.id ? String(task.id) : null;
  const myListingId = task && task.listingId ? String(task.listingId) : null;
  if (!myTaskId && !myListingId) {
    // Nothing to match against — fall back to a fixed pause so items still
    // get real spacing instead of firing back-to-back with zero wait.
    await new Promise(r => setTimeout(r, 30000));
    return true;
  }
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const ctx = globalThis.__ffmActiveSDnR;
      const stillActive = !!(ctx && typeof ctx === 'object' && (
        (myTaskId && String(ctx.taskId || '') === myTaskId) ||
        (myListingId && String(ctx.listingId || '') === myListingId)
      ));
      if (!stillActive) return true;
    } catch (e) { return true; }
    await new Promise(r => setTimeout(r, 2000));
  }
  try { console.warn('[DNR queue] Timed out waiting for task to settle — moving on to next queued item', task && task.id); } catch (e) {}
  try {
    // Safety net: force-clear a stuck context that still matches this task so
    // it doesn't block the next queued item forever after a timeout.
    const ctx = globalThis.__ffmActiveSDnR;
    if (ctx && typeof ctx === 'object' && ((myTaskId && String(ctx.taskId || '') === myTaskId) || (myListingId && String(ctx.listingId || '') === myListingId))) {
      globalThis.__ffmActiveSDnR = null;
    }
  } catch (e) {}
  return false;
}

var __ffmDnrPumping = false;
async function ffmPumpDnrQueue() {
  if (__ffmDnrPumping) return;
  __ffmDnrPumping = true;
  try {
    for (;;) {
      const activeRes = await new Promise(r => chrome.storage.local.get({ ffm_dnr_active_task: null }, r));
      const active = activeRes.ffm_dnr_active_task;
      if (active && active.startedAt && (Date.now() - active.startedAt) < 15 * 60 * 1000) {
        // Something is already running (possibly claimed just before an SW restart) —
        // stop here. It will call ffmPumpDnrQueue() again when it finishes.
        break;
      }

      const qRes = await new Promise(r => chrome.storage.local.get({ ffm_dnr_queue: [] }, r));
      const q = Array.isArray(qRes.ffm_dnr_queue) ? qRes.ffm_dnr_queue : [];
      if (!q.length) {
        try { await new Promise(r => chrome.storage.local.set({ ffm_dnr_active_task: null }, r)); } catch (e) {}
        break;
      }

      const task = q.shift();
      await new Promise(r => chrome.storage.local.set({ ffm_dnr_queue: q, ffm_dnr_active_task: { id: task.id, startedAt: Date.now(), inventoryName: task.inventoryName } }, r));

      // Register the SDnR active-run context (single object — matches the shape
      // the app's own delete->publish handoff logic reads/writes) so that logic
      // sees a real "run in progress" for this task instead of falling back to
      // adopting its own ad-hoc context.
      try {
        globalThis.__ffmActiveSDnR = {
          source: 'dnr-queue',
          taskId: String(task.id),
          listingId: task.listingId ? String(task.listingId) : null,
          inventoryName: task.inventoryName || null,
          startedAt: Date.now(),
          stage: 'scheduled'
        };
      } catch (e) {}

      try { console.log('[DNR queue] Starting', task.id, task.inventoryName || task.listingTitle || task.listingId, '— queue remaining:', q.length); } catch (e) {}
      try {
        // executeScheduledTask() just opens the Facebook tab and dispatches the
        // delete step — it resolves almost immediately, long before the actual
        // delete+republish cycle in that tab finishes. Awaiting it alone let every
        // queued item fire back-to-back with no real spacing. ffmWaitForDnrTaskSettle()
        // blocks until the app's own "a DnR is actively running" flag clears (or a
        // safety timeout), so this task's Facebook automation genuinely finishes
        // before the next one starts.
        if (typeof executeScheduledTask === 'function') await executeScheduledTask(task);
        await ffmWaitForDnrTaskSettle(task);
      } catch (e) { try { console.warn('[DNR queue] task failed', task.id, e); } catch (_) {} }
      try { console.log('[DNR queue] Finished', task.id); } catch (e) {}

      try {
        const ctx = globalThis.__ffmActiveSDnR;
        if (ctx && typeof ctx === 'object' && String(ctx.taskId || '') === String(task.id)) globalThis.__ffmActiveSDnR = null;
      } catch (e) {}
      try { await new Promise(r => chrome.storage.local.set({ ffm_dnr_active_task: null }, r)); } catch (e) {}

      // Remove its scheduled_tasks UI entry now that it's done running.
      try {
        chrome.storage.local.get({ scheduled_tasks: [] }, (res) => {
          try {
            const arr = Array.isArray(res.scheduled_tasks) ? res.scheduled_tasks : [];
            const kept = arr.filter(t => !(t && String(t.id) === String(task.id)));
            if (kept.length !== arr.length) chrome.storage.local.set({ scheduled_tasks: kept });
          } catch (e) {}
        });
      } catch (e) {}
    }
  } finally {
    __ffmDnrPumping = false;
  }
}
// Resume any queue left over from a killed/restarted service worker.
try { ffmPumpDnrQueue(); } catch (e) {}

// Lightweight alias for executeScheduledTask; the real implementation is assigned later
// Add a short in-memory run-once guard to avoid duplicate execution when the SW
// receives the same alarm twice (common when multiple handlers / restore flows run).
var _ffm_recentlyExecuted = new Set();
var executeScheduledTask = async function(task) {
  try {
    if (!task || !task.id) return false;
    const idKey = String(task.id);
    if (_ffm_recentlyExecuted.has(idKey)) {
      try { console.warn('[bg] skipping duplicate task', idKey); } catch (e) {}
      return false;
    }
    _ffm_recentlyExecuted.add(idKey);
    // Remove the guard after 10s to allow future legitimate runs
    try { setTimeout(() => { try { _ffm_recentlyExecuted.delete(idKey); } catch (e) {} }, 10000); } catch (e) {}

    if (typeof __ffm_executeScheduledTask_impl === 'function') return await __ffm_executeScheduledTask_impl(task);
    return false;
  } catch (e) { console.debug('[bg] executeScheduledTask wrapper error', e); return false; }
};

// Close any previously opened extension popup windows (those that load popup.html).
// This helps prevent multiple popup windows from accumulating when the user repeatedly
// opens the extension. Returns a Promise that resolves once close attempts complete.
async function closeExistingExtensionPopups() {
  return new Promise((resolve) => {
    try {
      chrome.windows.getAll({ populate: true }, (wins) => {
        try {
          if (!wins || !wins.length) return resolve();
          const toClose = [];
          const popupUrl = chrome.runtime.getURL('popup.html');
          for (const w of wins) {
            try {
              if (!w || !w.tabs) continue;
              for (const t of w.tabs) {
                try {
                  if (!t || !t.url) continue;
                  // If the tab's URL starts with the extension popup URL, mark window for close
                  if (String(t.url).startsWith(popupUrl)) { toClose.push(w.id); break; }
                } catch (e) {}
              }
            } catch (e) {}
          }
          if (!toClose.length) return resolve();
          const unique = Array.from(new Set(toClose));
          let remaining = unique.length;
          unique.forEach((id) => {
            try {
              chrome.windows.remove(id, () => { try { remaining--; if (remaining <= 0) resolve(); } catch (e) { remaining--; if (remaining <= 0) resolve(); } });
            } catch (e) { remaining--; if (remaining <= 0) resolve(); }
          });
        } catch (e) { resolve(); }
      });
    } catch (e) { resolve(); }
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;

  const url = tab.url || '';
  const isHttpLike = /^https?:/.test(url) || /^file:/.test(url);

  function openPopupFallback(windowId) {
    try {
      if (!chrome || !chrome.action || typeof chrome.action.openPopup !== 'function') return false;

      // If no user gesture is active, do NOT call openPopup (it will set lastError).
      if (!globalThis || !globalThis.ffmUserGestureActive) {
        try {
          const stack = (new Error('[gesture-guard] openPopupFallback called without gesture')).stack;
          globalThis.__ffmTrace = globalThis.__ffmTrace || { counters: {}, events: [], evIdx: 0 };
          globalThis.__ffmTrace.lastGestureError = { api: 'chrome.action.openPopup', when: Date.now(), windowId: windowId || null, stack };
        } catch (e) {}
        return false;
      }

      const opts = windowId ? { windowId } : {};

      // IMPORTANT: always provide a callback and consume lastError
      chrome.action.openPopup(opts, () => {
        try {
          if (chrome && chrome.runtime && chrome.runtime.lastError) {
            // consume + optionally record
            const msg = chrome.runtime.lastError.message || 'unknown lastError';
            try {
              const stack = (new Error('[gesture-guard] openPopup lastError')).stack;
              globalThis.__ffmTrace = globalThis.__ffmTrace || { counters: {}, events: [], evIdx: 0 };
              globalThis.__ffmTrace.lastGestureError = { api: 'chrome.action.openPopup', when: Date.now(), windowId: windowId || null, msg, stack };
            } catch (e) {}
            // consume
            void chrome.runtime.lastError;
          }
        } catch (e) {}
      });

      return true;
    } catch (e) {
      return false;
    }
  }

  const openSidebarLike = (windowId) => {
    try {
      const url = chrome.runtime.getURL('popup.html');
      if (chrome.sidePanel && chrome.sidePanel.setOptions) {
        chrome.sidePanel.setOptions({ path: url }, () => { /* ignore */ });
        return;
      }
    } catch (e) { console.debug('sidePanel API not available', e); }

    try {
      if (windowId) {
        chrome.windows.get(windowId, (win) => {
          try {
            const width = 420;
            const height = Math.min(screen.height - 120, 900);
            const left = (win.left || 0) + (win.width || 0) - (width + 20);
            (async () => { try { await closeExistingExtensionPopups(); } catch (e) {} finally { chrome.windows.create({ url: 'popup.html', type: 'popup', width, height, top: (win.top || 100), left }); } })();
          } catch (e) { openPopupFallback(windowId); }
        });
      } else {
        (async () => { try { await closeExistingExtensionPopups(); } catch (e) {} finally { chrome.windows.create({ url: 'popup.html', type: 'popup', width: 420, height: Math.min(screen.height - 120, 900), top: 100, left: Math.max(0, screen.width - 440) }); } })();
      }
    } catch (e) { console.debug('openSidebarLike failed', e); openPopupFallback(windowId); }
  };

  // When a desktop notification is clicked, open the popup window for quick access
  try {
    if (chrome && chrome.notifications && typeof chrome.notifications.onClicked === 'object') {
      chrome.notifications.onClicked.addListener((notifId) => {
        try {
          // Optionally close the notification
          try { chrome.notifications.clear(notifId, () => {}); } catch (e) {}
          // Attempt to open the popup in a sidebar-like window
          try { openSidebarLike(); } catch (e) { try { openPopupFallback(); } catch (er) {} }
        } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* ignore */ }

  try {
    // Check user preference (synchronous cached value). The cache is kept up-to-date
    // via chrome.storage.onChanged so we can reliably make a decision inside the user gesture.
    try {
      const usePanel = !!_ffm_use_sidepanel_cached;
      if (usePanel) {
            try {
              if (chrome.sidePanel && typeof chrome.sidePanel.setOptions === 'function') {
                try { chrome.sidePanel.setOptions({ path: chrome.runtime.getURL('popup.html') }); } catch (e) {}
              }
            } catch (e) {}
            try {
              if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
                try {
                  if (!ffmPanelOpen) {
                    const winId = (tab && tab.windowId) ? tab.windowId : undefined;
                    try { if (!safeSidePanelOpen({ windowId: winId })) { console.debug && console.debug('[AutoList Pro bg] sidePanel.open failed (safeOpen)'); openPopupFallback(tab.windowId); } else { ffmPanelOpen = true; } } catch (e) { console.debug && console.debug('[AutoList Pro bg] sidePanel.open failed', e); openPopupFallback(tab.windowId); }
                  } else {
                    // If our in-memory flag says the panel is open, verify a popup actually exists.
                    // Sometimes the flag can be stale (e.g., SW restart or crash) so check windows and
                    // if none found, clear the flag and reopen.
                    try {
                      chrome.windows.getAll({ populate: true }, (wins) => {
                        try {
                          const hasPopup = Array.isArray(wins) && wins.some(w => {
                            try {
                              if (!w || !w.tabs) return false;
                              return w.tabs.some(t => t && (t.url || '').endsWith('popup.html'));
                            } catch (e) { return false; }
                          });
                          if (!hasPopup) {
                            try { console.log('[AutoList Pro bg] onClicked: stale ffmPanelOpen cleared, reopening'); } catch (e) {}
                            ffmPanelOpen = false;
                            // Try to reopen now (mirror the same open logic used above)
                            try {
                              const winId = (tab && tab.windowId) ? tab.windowId : undefined;
                              if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && !!_ffm_use_sidepanel_cached) {
                                try {
                                  if (!safeSidePanelOpen({ windowId: winId })) { console.debug && console.debug('[AutoList Pro bg] sidePanel.open failed (safeOpen)'); openPopupFallback(tab.windowId); } else { ffmPanelOpen = true; }
                                } catch (e) { console.debug && console.debug('[AutoList Pro bg] sidePanel.open failed', e); openPopupFallback(tab.windowId); }
                              } else {
                                openPopupFallback(tab.windowId);
                              }
                            } catch (e) { try { openPopupFallback(tab.windowId); } catch (er) {} }
                          } else {
                            console.log('[AutoList Pro bg] onClicked: side panel already open, skipping reopen');
                          }
                        } catch (e) { console.debug && console.debug('[AutoList Pro bg] popup check failed', e); }
                      });
                    } catch (e) {
                      console.log('[AutoList Pro bg] onClicked: side panel already open, skipping reopen (window check failed)');
                    }
                  }
                } catch (e) { console.debug && console.debug('[AutoList Pro bg] sidePanel open check failed', e); }
                return;
              }
            } catch (e) {}
            // If sidePanel API missing or open failed, fallback to popup
            openPopupFallback(tab.windowId);
            return;
      }
      // Default behavior: attempt content toggle, otherwise popup fallback
      try {
        if (!isHttpLike) { openPopupFallback(tab.windowId); return; }
        chrome.tabs.sendMessage(tab.id, { action: 'toggle-panel' }, (resp) => {
          try {
            if (chrome.runtime.lastError) { openPopupFallback(tab.windowId); return; }
            if (!resp || resp.ok === false || resp.toggled === false) { openPopupFallback(tab.windowId); }
          } catch (e) { openPopupFallback(tab.windowId); }
        });
      } catch (e) { openPopupFallback(tab.windowId); }
    } catch (e) { openPopupFallback(tab.windowId); }
  } catch (e) { console.debug('onClicked: error', e); }
});

// Use the known-good patched baseline for background behavior (kept intentionally minimal and stable).
// The original service worker had complex safe-wrapping and diagnostics; to avoid reintroducing
// syntax problems while we iterate, we restore this concise baseline and reapply small hardening
// changes in separate commits.

// The rest of the file below is the restored, validated background implementation.
// The rest of the file below is the restored, validated background implementation.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ------------------------------------------------------
  // PATCH10B — Media DB → Return Blobs for Listing
  // ------------------------------------------------------
  if (message && message.action === "ffm_get_media_blobs_for_listing") {
    (async () => {
      try {
        // Validate DB
        if (!ffmMediaDB || !ffmMediaDB.getBlobsForUserListing) {
          console.warn("[bg:media] DB not ready or missing user-scoped method");
          sendResponse && sendResponse({ ok: false, error: "mediaDB-unavailable" });
          return;
        }

        // Normalize listing ID
        const listingName =
          message.listingName ||
          message.inventoryName ||
          message.listingId ||
          message.id;

        const uid = message.uid || message.userId || null;
        if (!uid) {
          console.warn("[bg:media] Missing uid for media fetch", message);
          sendResponse && sendResponse({ ok: false, error: "missing-uid" });
          return;
        }

        if (!listingName) {
          console.warn("[bg:media] Missing listingName", message);
          sendResponse && sendResponse({ ok: false, error: "missing-listingName" });
          return;
        }

        // Delegate to ffmBgGetMediaRecordsForListing (which opens DB and returns records array)
        const records = await ffmBgGetMediaRecordsForListing(uid, listingName);
        console.log('[bg:media] returning records count', (records && records.length) || 0, 'for', listingName, uid);
        sendResponse && sendResponse({ ok: true, records });
      } catch (err) {
        console.error("[bg:media] fatal error", err);
        sendResponse && sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true; // MUST KEEP CHANNEL OPEN
  }

  try {
    if (!message || !message.action) return;
    if (message.action === 'open-popup') {
      try { sendResponse && sendResponse({ opened: true }); } catch (e) {}
      return true;
    }
    if (message.action === 'start-relist') {
      // Disabled by default. Keep message for UI compatibility.
      try { sendResponse && sendResponse({ ok: false, error: 'relist-disabled' }); } catch (e) {}
      return true;
    }
    if (message.action === 'publish-listing') {
      // Diagnostic snapshot: log incoming message and current stored menu flags
      try {
        try { console.debug('[bg] publish-listing received', message); } catch (e) {}
        try {
          chrome.storage.local.get(['ffm_menu_auto_last', 'auto_publish_enabled'], (snap) => {
            try {
              console.debug('[bg] publish-listing storage snapshot', {
                ffm_menu_auto_last: snap && snap.ffm_menu_auto_last,
                auto_publish_enabled: !!(snap && snap.auto_publish_enabled),
                message_menuAuto: typeof message.menuAuto !== 'undefined' ? !!message.menuAuto : undefined
              });
            } catch (e) {}
          });
        } catch (e) {}
      } catch (e) {}
      // Quick legacy path removed: background should perform controlled publish flow
      try { sendResponse && sendResponse({ acknowledged: true }); } catch (e) {}
      // return true to allow async handling if caller expects it
      return true;
    }
    
    if (message.action === 'register-publish-cleanup' && message.publishRequestId) {
      try {
        const id = message.publishRequestId;
        const ttl = typeof message.ttlSeconds === 'number' ? Math.max(10, message.ttlSeconds) : 120;
        const alarmName = 'ffm_publish_cleanup_' + id;
        try {
          const when = Date.now() + (ttl * 1000);
            if (chrome && chrome.alarms && typeof chrome.alarms.create === 'function') {
            chrome.alarms.create(alarmName, { when });
            try { chrome.alarms.getAll((all)=>{ try{ console.debug('[bg:ALARM] active after publish-cleanup create →', (all||[]).map(a=>a && a.name)); }catch(e){} }); } catch(e) {}
            try { appendPublishTrace(id, { event: 'cleanup-registered', ttl }); } catch (e) {}
            sendResponse && sendResponse({ ok: true });
            return true;
          }
        } catch (e) { console.debug('register-publish-cleanup alarm create failed', e); }
        sendResponse && sendResponse({ ok: false, error: 'alarms-unavailable' });
      } catch (e) { sendResponse && sendResponse({ ok: false, error: String(e) }); }
      return true;
    }
    if (message.action === 'populate-missing' && message.publishRequestId) {
      try { appendPublishTrace(message.publishRequestId, { event: 'populate-missing', senderTab: sender && sender.tab ? sender.tab.id : null }); } catch (e) {}
      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      return true;
    }
    if (message.action === 'menu-auto-updated') {
      try {
        const val = !!message.auto_publish_enabled;
        // Persist a short-lived global hint with timestamp so sendPopulateMessageToTab can read it
        try { chrome.storage.local.set({ ffm_menu_auto_last: { val: val, ts: Date.now() } }, () => { try { console.debug('[bg] menu-auto-updated persisted ->', val); } catch (e) {} }); } catch (e) { console.debug('[bg] menu-auto-updated persist failed', e); }
        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
      } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (e2) {} }
      return true;
    }
  } catch (e) { }
});

// Publish in-flight guard to prevent duplicate tab creation for same publishRequestId
const publishInFlight = new Set();
// (no additional in-memory running guard)

// Lightweight persistent trace helper for publish events
async function appendPublishTrace(publishRequestId, entry) {
  try {
    if (!publishRequestId) return;
    const key = 'ffm_publish_trace_' + publishRequestId;
    const existing = await new Promise(res => chrome.storage.local.get([key], res));
    const arr = (existing && existing[key]) || [];
    arr.push({ ts: Date.now(), entry });
    await new Promise(r => chrome.storage.local.set({ [key]: arr }, r));
  } catch (e) { try { console.debug('[bg] appendPublishTrace error', e); } catch (er) {} }
}

// ✅ Add support for popup "Pin GUI Always On Top"
// togglePinPanel/pin behavior removed
// lightweight no-op listener (kept for compatibility) installed via safe wrapper
addSafeListener((message, sender, sendResponse) => {});

// Relay iframe-ready and support query-panel
addSafeListener((message, sender, sendResponse) => {
    try {
      // Diagnostic wrapper: intercept sendResponse so we can detect async handlers that never respond
    if (FAST4MP_DEBUG) console.debug('[bg] onMessage received', message && (message.action || message.prompt || message));
    let __diagResponded = false;
    const __origSend = sendResponse;
    // override sendResponse locally so all internal calls mark responded
    sendResponse = function(...args) { __diagResponded = true; try { __origSend && __origSend(...args); } catch (e) {} };

    const rv = (function actualHandler() {
      try {
        if (!message) return;
        // debug dump-inline-jsons removed - respond with not-implemented for callers
        if (message && message.action === 'dump-inline-jsons') {
          try { sendResponse && sendResponse({ ok: false, reason: 'debug-disabled' }); } catch (e) {}
          return;
        }
        // get-inline-jsons removed - return no data
        if (message && message.action === 'get-inline-jsons') {
          try { sendResponse && sendResponse({ ok: true, inline_jsons: null }); } catch (e) {}
          return;
        }
        // (check-content-script helper removed - restore minimal behavior)
        if (message.action === 'ffm_iframe_ready') {
          try {
            // If sender.tab is present, mark that tab as ready so the background can message it safely
            try {
              if (sender && sender.tab && typeof sender.tab.id === 'number') {
                try { readyTabs.add(sender.tab.id); } catch (e) {}
                try { chrome.storage.local.set({ ['ffm_iframe_ready_' + sender.tab.id]: true }); } catch (e) {}
              }
            } catch (e) {}
            // Also broadcast a lightweight notification for any UI listeners
            try { chrome.runtime.sendMessage({ action: 'ffm_iframe_ready', tabId: sender && sender.tab ? sender.tab.id : null }); } catch (e) {}
          } catch (e) {}
          return;
        }
        // If a popup asks to show the select-listing hint, don't try to re-open the side panel here.
        if (message && message.action === 'show-select-listing') {
          try {
            // No-op: popup will render the hint itself when embedded. Keep a short-lived storage flag as fallback.
            const k = 'ffm_pending_select_listing';
            const payload = { ts: Date.now(), msg: 'select-listing' };
            try { chrome.storage.local.set({ [k]: payload }); } catch (e) {}
            // Also notify any open popup (side panel) to show the inline hint
            try { chrome.runtime.sendMessage({ action: 'show-select-listing-inline' }); } catch (e) {}
            setTimeout(() => { try { chrome.storage.local.remove(k); } catch (e) {} }, 3000);
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
          } catch (e) {}
          return;
        }
        // --- lightweight publish tracing requested by content script ---
        if (message.action === 'publish-trace') {
          try {
            try { appendPublishTrace(message.publishRequestId, message.event || { event: 'publish-trace', meta: message }); } catch (e) {}
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
          return;
        }
        // Content requests a transient media fetch (e.g., listing had stripped inline blobs).
        // Replace: load images (blobs) and passthrough video descriptors then persist into staged publish
        if (message.action === 'fetch-transient-media') {
          try {
            try { appendPublishTrace(message.publishRequestId, { event: 'fetch-transient-media-requested', inventoryName: message.inventoryName, opts: { maxImages: message.maxImages, videos: !!message.videos } }); } catch (e) {}

            const publishRequestId = message.publishRequestId;
            try {
              chrome.storage.local.get(['ffm_publish_' + publishRequestId], async (stored) => {
                try {
                  const listing = stored && stored['ffm_publish_' + publishRequestId];
                  if (!listing) {
                      console.log('[bg:ALARM] Creating alarm', name);
                    return;
                  }

                  // Reconstruct images/videos from the media DB first (ID-first lookup)
                  try {
                    const listingKey =
                      (listing && (listing.listingId || listing.id || listing.inventoryName || listing.title))
                        ? (listing.listingId || listing.id || listing.inventoryName || listing.title)
                        : null;
                    const { imageFiles, videoFiles } = await ffmReconstructMediaFilesFromDB(listingKey);

                    if ((imageFiles && imageFiles.length) || (videoFiles && videoFiles.length)) {
                      try {
                        // Deliver Files directly to the content script — do NOT store them in chrome.storage
                        try {
                          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                          if (tabs && tabs[0] && typeof tabs[0].id === 'number') {
                            try {
                              chrome.tabs.sendMessage(tabs[0].id, {
                                action: 'ffm-deliver-files',
                                publishRequestId,
                                imageFiles,
                                videoFiles,
                              });
                            } catch (e) {
                              console.warn('[bg] failed to chrome.tabs.sendMessage ffm-deliver-files', e);
                            }
                          }
                        } catch (e) {
                          console.warn('[bg] failed to query tabs for ffm-deliver-files', e);
                        }

                        // Still update listing metadata stored in chrome.storage (WITHOUT File objects)
                        listing.imageFiles = [];
                        listing.videoFiles = [];
                        listing.files = [];

                        if (listingKey) {
                          listing.localImageKeys = (imageFiles || []).map((_, idx) => ffmMakeS3MediaKey(listingKey, idx, 'image', 'jpg'));
                          listing.localVideoKeys = (videoFiles || []).map((_, idx) => ffmMakeS3MediaKey(listingKey, idx, 'video', 'mp4'));
                        }
                      } catch (e) {
                        console.warn('[bg] failed to deliver file objects directly to content', e);
                        // Fallback: preserve existing transient behavior
                        const media = await ffmLoadTransientMedia(listing);
                        try { listing.files = media; } catch (er) { listing.files = []; }
                      }
                    } else {
                      // Legacy fallback: no DB media found
                      const media = await ffmLoadTransientMedia(listing);
                      listing.files = media;
                    }
                  } catch (e) {
                    console.warn('[bg] reconstruct media from DB failed, falling back', e);
                    try { const media = await ffmLoadTransientMedia(listing); listing.files = media; } catch (er) { listing.files = []; }
                  }

                  try {
                    chrome.storage.local.set({ ['ffm_publish_' + publishRequestId]: listing }, () => {
                      try { sendResponse && sendResponse({ ok: true, note: 'media-staged', count: (listing.files && listing.files.length) || 0 }); } catch (e) {}
                    });
                  } catch (e) {
                    try { sendResponse && sendResponse({ ok: false, error: 'storage-set-failed' }); } catch (er) {}
                  }
                } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
              });
            } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
          return true; // async response while we fetch
        }
        // Relay relist UI visible notifications from content script to any open popup/UI
        if (message.action === 'relist-ui-visible') {
          try { chrome.runtime.sendMessage({ action: 'relist-ui-visible', total_listings: message.total_listings || 0 }); } catch (e) { if (FAST4MP_DEBUG) console.debug('forward relist-ui-visible failed', e); }
          return;
        }
        if (message.action === 'relist-error') {
          try { chrome.runtime.sendMessage({ action: 'relist-error', error: message.error || 'unknown', pageData: message.pageData || null }); } catch (e) { if (FAST4MP_DEBUG) console.debug('forward relist-error failed', e); }
          return;
        }

        if (message.action === 'query-panel') {
          (async () => {
            try {
              const tabs = await new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, res));
              const tab = tabs && tabs[0];
              if (!tab || !tab.id) { sendResponse && sendResponse({ ok: false, reason: 'no-tab' }); return; }
              if (!isSupportedUrl(tab.url)) { sendResponse && sendResponse({ ok: false, reason: 'unsupported-url' }); return; }

              const sendPanelQuery = async () => {
                try {
                  const resp = await new Promise((res, rej) => {
                    chrome.tabs.sendMessage(tab.id, { action: 'query-panel' }, (r) => {
                      if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message || 'runtime-error'));
                      res(r);
                    });
                  });
                  return resp;
                } catch (err) {
                  const msg = err && err.message || '';
                  if (msg.includes('Receiving end does not exist')) return null;
                  throw err;
                }
              };

              // If we've seen the content script handshake, try once
              if (readyTabs.has(tab.id)) {
                try {
                  const r = await sendPanelQuery();
                  if (r) { sendResponse && sendResponse({ ok: true, panel: r.panel || null }); return; }
                } catch (e) { /* fallthrough to injection attempt */ }
              }

              // Not ready: one-time best-effort injection and retry
              try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/content_main.js'] }); } catch (e) {}
              await new Promise(r => setTimeout(r, 150));

              try {
                const r2 = await sendPanelQuery();
                if (r2) { try { readyTabs.add(tab.id); } catch (e) {} sendResponse && sendResponse({ ok: true, panel: r2.panel || null }); return; }
              } catch (e) {}

              sendResponse && sendResponse({ ok: false, error: 'no-content-listener' });
            } catch (err) {
              if (FAST4MP_DEBUG) console.warn('[AutoList Pro] query-panel failed', err);
              sendResponse && sendResponse({ ok: false, error: err && err.message ? err.message : 'error' });
            }
          })();
          return; // indicate async response (handled via wrapped sendResponse)
        }
      } catch (e) {}

        // Schedule a task: persist alarm and create chrome.alarms entry
        if (message.action === 'schedule-task' && message.task) {
          try {
            const msgTask = message.task || {};
            const task = {
              id: msgTask.id,
              taskId: msgTask.id,
              listingId: msgTask.listingId || null,
              inventoryName: msgTask.inventoryName || null,
              listingTitle: msgTask.listingTitle || null,
              action: msgTask.action,
              timeISO: msgTask.timeISO,
              when: msgTask.when,
              scheduled: true
            };
            try { console.debug('[bg:TEST] schedule-task received →', task); } catch (e) {}
            // prefer numeric epoch 'when' if provided (ms since epoch), otherwise parse timeISO
            let when = (typeof task.when === 'number' && !isNaN(task.when)) ? task.when : NaN;
            if (isNaN(when) && task.timeISO) when = new Date(task.timeISO).getTime();
            try { console.debug('[bg] schedule-task received', { id: task.id, inventoryName: task.inventoryName, action: task.action, timeISO: task.timeISO, when, now: Date.now() }); } catch (e) {}
            if (isNaN(when) || when <= Date.now()) {
              sendResponse && sendResponse({ ok: false, error: 'invalid-time' });
              return;
            }

            // Persist/Upsert into scheduled_tasks so restore/alarms can find it later
            try {
              chrome.storage.local.get({ scheduled_tasks: [] }, (res) => {
                try {
                  const arr = Array.isArray(res.scheduled_tasks) ? res.scheduled_tasks : [];
                  const cleaned = arr.filter(t => !(t && String(t.id) === String(task.id)));
                  cleaned.push({
                    id: String(task.id),
                    taskId: task.taskId || String(task.id),
                    listingId: task.listingId || task.listingID || task.listing_id || null,
                    when, // numeric epoch ms
                    timeISO: task.timeISO || null,
                    action: task.action || 'publish',
                    publishRequestId: task.publishRequestId || null,
                    inventoryName: task.inventoryName || null,
                    payload: task.payload || null,
                    // Mark persisted tasks as scheduler-origin so runtime guards can distinguish
                    fromScheduler: true
                  });
                  chrome.storage.local.set({ scheduled_tasks: cleaned }, () => {
                    try { console.debug('[bg] schedule-task persisted', { id: task.id, when }); } catch (e) {}
                  });
                } catch (e) { console.debug('schedule-task persist error', e); }
              });
            } catch (e) { console.debug('schedule-task outer persist error', e); }
            const alarmName = 'ffm_schedule_' + task.id;
            const delayMinutes = Math.max(0, Math.ceil((when - Date.now()) / 60000));
            // Some runtime environments / tests may not provide chrome.alarms (or it may be absent due to manifest)
            // Guard against that and fall back to relying on the startup scan to pick up due tasks.
            try {
              if (chrome && chrome.alarms && typeof chrome.alarms.create === 'function') {
                try {
                  chrome.alarms.create(alarmName, { when });
                  try { chrome.storage.local.set({ ['ffm_schedule_created_' + task.id]: { when: when, createdAt: Date.now() } }); } catch (e) {}
                  try { chrome.alarms.getAll((all) => { try { console.debug('[bg:ALARM] active after create →', (all||[]).map(a=>a && a.name)); } catch(e){} }); } catch(e){}
                } catch (e) {
                  try {
                    // fallback by delay
          chrome.alarms.create(alarmName, { delayInMinutes: Math.max(0.1, delayMinutes) });
            try { chrome.storage.local.set({ ['ffm_schedule_created_' + task.id]: { when: Date.now() + Math.max(0, delayMinutes) * 60000, createdAt: Date.now(), note: 'delay-fallback' } }); } catch (e) {}
            try { chrome.alarms.getAll((all) => { try { console.debug('[bg:ALARM] active after delay-fallback create →', (all||[]).map(a=>a && a.name)); } catch(e){} }); } catch(e){}
                  } catch (e2) {
                    console.debug('alarms.create fallback failed', e2);
                    // Respond with a note, but don't error out — the task is persisted and startup scan will handle it
                        try { chrome.storage.local.set({ ['ffm_schedule_create_error_' + task.id]: String(e2) }); } catch (ee) {}
                        sendResponse && sendResponse({ ok: true, scheduled: true, note: 'alarms.create_failed' });
                    return;
                  }
                }
                sendResponse && sendResponse({ ok: true, scheduled: true });
                return;
              } else {
                console.debug('[bg] alarms API not available; persisting task only and relying on startup scan');
                sendResponse && sendResponse({ ok: true, scheduled: true, note: 'alarms_unavailable' });
                return;
              }
            } catch (e) {
              console.debug('schedule-task alarms guard error', e);
              sendResponse && sendResponse({ ok: true, scheduled: true, note: 'alarms_guard_error' });
              return;
            }
            return;
          } catch (e) { console.debug('schedule-task handler error', e); sendResponse && sendResponse({ ok: false, error: String(e) }); return; }
        }

        // Cancel a specific scheduled alarm (requested by popup)
        if (message.action === 'cancel-schedule' && message.taskId) {
          try {
            const alarmName = 'ffm_schedule_' + message.taskId;
            try { chrome.alarms.clear(alarmName); } catch (e) {}
            // Also remove from storage for safety
            chrome.storage.local.get({ scheduled_tasks: [] }, (res) => {
              try {
                const arr = res.scheduled_tasks || [];
                const newArr = arr.filter(t => !(t && t.id === message.taskId));
                chrome.storage.local.set({ scheduled_tasks: newArr });
              } catch (e) {}
            });
            sendResponse && sendResponse({ ok: true });
          } catch (e) { sendResponse && sendResponse({ ok: false, error: String(e) }); }
          return;
        }

        // Cancel all scheduled alarms and clear storage (requested by popup)
        if (message.action === 'cancel-all-schedules') {
          try {
            try { chrome.alarms.clearAll(); } catch (e) {}
            chrome.storage.local.set({ scheduled_tasks: [] }, () => {});
            sendResponse && sendResponse({ ok: true });
          } catch (e) { sendResponse && sendResponse({ ok: false, error: String(e) }); }
          return;
        }
    })();

    // If the handler indicated an async response (returned true) but we never observed sendResponse being called,
    // warn after a short delay to help locate the offending action during debugging.
    if (rv === true) {
          setTimeout(() => {
      if (!__diagResponded) {
        try { __origSend && __origSend({ ok: false, error: 'no-response-timeout' }); } catch (e) {}
        __diagResponded = true;
        if (FAST4MP_DEBUG) console.warn('[AutoList Pro] async onMessage did not call sendResponse within 5s for', message && (message.action || message.prompt));
      }
    }, 5000);
    }

    return rv;
  } catch (e) {}
});

// Listener: trigger media DB cleanup/auto-vacuum from popup or other callers
try {
  addSafeListener((message, sender, sendResponse) => {
    try {
      if (!message || message.action !== 'ffm_media_cleanup') return;

      // Allow caller to pass an explicit list of active listing names
      const explicit = Array.isArray(message.activeIds) ? message.activeIds.filter(Boolean) : null;

      // Helper to run the cleanup and respond
      const runCleanup = async (activeIds) => {
        try {
          if (typeof ffmMediaDB === 'undefined' || !ffmMediaDB || typeof ffmMediaDB.autoClean !== 'function') {
            sendResponse && sendResponse({ ok: false, error: 'ffmMediaDB.autoClean unavailable' });
            return;
          }
          const result = await ffmMediaDB.autoClean(activeIds || []);
          sendResponse && sendResponse({ ok: true, result });
        } catch (e) {
          try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
        }
      };

      if (explicit) {
        // run directly
        (async () => { await runCleanup(explicit); })();
        return true; // indicate async
      }

      // Otherwise compute active listing names from stored `listings` array
      try {
        chrome.storage.local.get({ listings: [] }, (res) => {
          try {
            const listings = res && Array.isArray(res.listings) ? res.listings : [];
            const ids = listings.map(l => (l && (l.inventoryName || l.listingName || l.name)) ? (l.inventoryName || l.listingName || l.name) : null).filter(Boolean);
            (async () => { await runCleanup(ids); })();
          } catch (e) {
            try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
          }
        });
      } catch (e) {
        try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
      }

      return true;
    } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch(_) {} }
  });
} catch (e) { console.debug('[bg] install ffm_media_cleanup listener failed', e); }

// Pin/sidebar context menu, commands and badge sync removed

// Handle in-page variable and simple user lookup requests from content script (jr())
addSafeListener((message, sender, sendResponse) => {
  try {
    if (!message) return;
    // Content script asks the background to read a page variable from the tab's page context
    if (message.prompt === 'REQUIRE_PAGE_VARIABLE') {
      const key = message.args && message.args.key;
      const tabId = sender && sender.tab && sender.tab.id;
  if (!tabId) { sendResponse && sendResponse(null); return; }
      try {
        chrome.scripting.executeScript(
          { target: { tabId }, func: (keyName) => {
              try {
                // Prefer direct globals
                if (keyName && window[keyName]) return window[keyName];
                // Look for application/json script tags
                const scripts = Array.from(document.getElementsByTagName('script')).filter(s => s.type === 'application/json');
                for (const s of scripts) {
                  try { const j = JSON.parse(s.textContent || '{}'); if (j && Object.prototype.hasOwnProperty.call(j, keyName)) return j[keyName]; } catch (e) {}
                }
                // Search top-level window properties for the key
                const names = Object.getOwnPropertyNames(window);
                for (const n of names) {
                  try {
                    const v = window[n];
                    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, keyName)) return v[keyName];
                  } catch (e) {}
                }
                return null;
              } catch (err) { return { __error: String(err) }; }
            }, args: [key] }, (results) => {
            try { sendResponse && sendResponse(results && results[0] ? results[0].result : null); } catch (e) { sendResponse && sendResponse(null); }
          }
        );
      } catch (e) { sendResponse && sendResponse(null); }
  return;
    }

    // Simple GET_USER request: return stored USER_ID or a minimal anonymous object
    if (message.prompt === 'GET_USER') {
      try {
        chrome.storage.sync.get(['USER_ID'], (res) => {
          const id = res && res.USER_ID ? res.USER_ID : 'anonymous';
          sendResponse && sendResponse({ id });
        });
      } catch (e) { sendResponse && sendResponse({ id: 'anonymous' }); }
  return;
    }
  } catch (e) {}
});

// Handle popup open requests
addSafeListener((message, sender, sendResponse) => {
  if (message && message.action === 'open-popup') {
    const section = message.section || '';
    const width = 400;
    const height = 600;
    const url = `popup.html#${encodeURIComponent(section)}`;
    const winId = sender && sender.tab ? sender.tab.windowId : undefined;
    // Close any previously opened extension popups first
    (async () => {
      try { await closeExistingExtensionPopups(); } catch (e) {}
      if (winId) {
        chrome.windows.get(winId, (win) => {
          try {
            const margin = 20;
            const left = (win.left || 0) + (win.width || 0) - width - margin;
            const top = (win.top || 0) + Math.max(0, Math.round(((win.height || 0) - height) / 2));
            chrome.windows.create({ url, type: 'popup', width, height, top, left });
          } catch (err) {
            chrome.windows.create({ url, type: 'popup', width, height, top: 100, left: 100 });
          }
        });
      } else {
        chrome.windows.create({ url, type: 'popup', width, height, top: 100, left: 100 });
      }
    })();
    sendResponse({ opened: true });
  return;
  }

  // Open the Settings window (small account/settings popup)
  if (message && message.action === 'openSettingsWindow') {
    try {
      const width = 420;
      const height = 600;
      const url = 'settings.html';
      (async () => {
        try { await closeExistingExtensionPopups(); } catch (e) {}
        try {
          // Position near right side of screen similar to other popups
          chrome.windows.create({ url, type: 'popup', width, height, top: 100, left: Math.max(0, screen.width - width - 20) });
        } catch (e) {
          chrome.windows.create({ url, type: 'popup', width, height, top: 100, left: 100 });
        }
      })();
      sendResponse({ opened: true });
    } catch (e) {
      try { sendResponse({ opened: false, error: String(e) }); } catch (err) {}
    }
  return;
  }

  // Open the Create section in a dedicated window similar to "Open in Window" sizing
  if (message && message.action === 'open-create-window') {
    try {
      const section = message.section || 'create';
      const url = `popup.html#${encodeURIComponent(section)}`;
  const width = 574;
  const height = 875;
      const winId = sender && sender.tab ? sender.tab.windowId : undefined;
      // Only use side panel if explicitly requested
      try {
        if (message.useSidePanel && chrome.sidePanel && chrome.sidePanel.setOptions) {
          const path = chrome.runtime.getURL(url);
          chrome.sidePanel.setOptions({ path }, () => {
            try { if (!safeSidePanelOpen({ windowId: winId })) { /* ignore failure */ } } catch (e) {}
            sendResponse && sendResponse({ opened: true, mode: 'sidePanel' });
          });
          return;
        }
      } catch (e) { /* fall back to window */ }
      // Close any previously opened extension popups first
      (async () => {
        try { await closeExistingExtensionPopups(); } catch (e) {}
        if (winId) {
          chrome.windows.get(winId, (win) => {
            try {
              const margin = 20;
              const left = (win.left || 0) + (win.width || 0) - width - margin;
              const top = (win.top || 0) + margin;
              // Open as a popup (no tabs/omnibox)
              chrome.windows.create({ url, type: 'popup', width, height, top, left, focused: true });
            } catch (err) {
              chrome.windows.create({ url, type: 'popup', width, height, top: 100, left: 100, focused: true });
            }
          });
        } else {
          chrome.windows.create({ url, type: 'popup', width, height, top: 100, left: 100, focused: true });
        }
      })();
      sendResponse({ opened: true });
    } catch (e) { sendResponse && sendResponse({ opened: false, error: String(e) }); }
  return;
  }

  // Start Delete & Relist flow: open/activate Marketplace 'you/selling' (minimal safe behavior)
  if (message && message.action === 'start-relist') {
    try {
      if (DISABLE_RELIST) { try { sendResponse && sendResponse({ ok: false, error: 'relist-disabled' }); } catch (e) {} return; }
      const targetUrl = 'https://www.facebook.com/marketplace/you/selling';
      // Always open a fresh tab to avoid FB state issues with existing Selling tabs
      try {
        try {
          chrome.tabs.create({ url: targetUrl, active: true }, (newTab) => {
            if (!newTab || !newTab.id) { sendResponse && sendResponse({ ok: false }); return; }
            try { if (newTab.windowId) safeWindowsUpdate(newTab.windowId, { focused: true }); } catch (e) {}
            sendResponse && sendResponse({ ok: true, ack: false, reason: 'opened-new-tab' });
          });
        } catch (err) {
          sendResponse && sendResponse({ ok: false });
        }
      } catch (e) { try { console.debug('start-relist outer safe create error', e); } catch (er) {} sendResponse && sendResponse({ ok: false }); }
    } catch (e) { console.debug('start-relist outer error', e); sendResponse && sendResponse({ ok: false }); }
  return;
  }

    if (message && message.action === 'publish-listing') {
      const publishRequestId = message.publishRequestId;
      try {
        // Persist publish source (when provided) so downstream populate can honor origin
        const src = message && (message.publishSource || message.source);
        if (publishRequestId && typeof src !== 'undefined') {
          try { chrome.storage.local.set({ ['ffm_publish_source_' + publishRequestId]: src }); } catch (e) { /* non-fatal */ }
        }
      } catch (e) {}
    const fbUrl = 'https://www.facebook.com/marketplace/create/item';
    // Send an immediate ack so the caller isn't left waiting (MV3 service workers may suspend)
    try { sendResponse && sendResponse({ acknowledged: true }); } catch (e) {}

    try { console.debug('[bg] publish-listing received', { publishRequestId }); } catch (e) {}
    try { console.debug('[bg] publish-listing message.autoPublish', { val: message && message.autoPublish, type: (message && typeof message.autoPublish) }); } catch (e) {}

  // If the popup provided the persistent menu value inline, capture it as a hint.
  const menuAutoHint = (message && typeof message.menuAuto === 'boolean') ? !!message.menuAuto : undefined;
  try { if (typeof menuAutoHint !== 'undefined') console.debug('[bg] publish-listing menuAuto hint', { publishRequestId, menuAutoHint }); } catch (e) {}

    // If the popup explicitly requested auto-publish for this manual publish,
    // write a one-off force flag to storage so the content script's final-safety
    // can detect it even if the runtime message is lost or races occur.
    try {
      // If the caller explicitly requested per-action auto-publish, persist the one-off force flag.
      if (message && message.autoPublish) {
        try {
          const forceKey = 'ffm_force_auto_publish_' + publishRequestId;
          try { chrome.storage.local.set({ [forceKey]: true }, () => { try { console.debug('[bg] publish-listing: wrote per-publish force flag', { publishRequestId, forceKey }); } catch(e){} }); } catch(e) { console.debug('[bg] publish-listing: failed to write force flag', e); }
        } catch (e) { console.debug('[bg] publish-listing: prepare-force-flag error', e); }
      }
      // If the popup appended the menuAuto hint and it's true, persist a short-lived override for robustness.
      if (typeof menuAutoHint !== 'undefined' && menuAutoHint === true) {
        try { chrome.storage.local.set({ ['ffm_menu_auto_hint_' + publishRequestId]: true }, () => { try { console.debug('[bg] publish-listing: persisted menuAuto hint for', publishRequestId); } catch (e) {} }); } catch (e) { console.debug('[bg] publish-listing: failed to persist menuAuto hint', e); }
      }
    } catch (e) { console.debug('publish-listing autoPublish write guard error', e); }

    // Fire-and-forget navigation / populate logic
    (async () => {
      try {
        // --- Pre-publish: attempt to mark saved listing active early and persist a tiny meta
        try {
          (function() {
            const metaKey = 'ffm_publish_meta_' + publishRequestId;
            try {
              chrome.storage.local.get(['ffm_publish_' + publishRequestId, 'ffm_staged_listing'], (res) => {
                try {
                  const stagedKey = 'ffm_publish_' + publishRequestId;
                  const staged = (res && res[stagedKey]) ? res[stagedKey] : (res && res.ffm_staged_listing ? res.ffm_staged_listing : null);
                  const maybeName = (staged && (staged.inventoryName || staged.title)) ? (staged.inventoryName || staged.title) : (message && message.inventoryName ? message.inventoryName : null);
                  if (!maybeName) return;
                  const inventoryName = ('' + maybeName).toLowerCase().trim();
                  // Persist a tiny meta record so publish-complete relay can find it later
                  try { chrome.storage.local.set({ [metaKey]: { inventoryName: inventoryName, ts: Date.now() } }, () => {}); } catch (e) {}

                  // Mark saved listings active across known storage keys (non-blocking)
                  try {
                    chrome.storage.local.get(['listings','ffmSavedListings','__ffm_saved_listings_cache'], (lists) => {
                      try {
                        const writeBack = {};
                        const keys = ['listings','ffmSavedListings','__ffm_saved_listings_cache'];
                        for (const k of keys) {
                          try {
                            const arr = (lists && Array.isArray(lists[k])) ? lists[k] : null;
                            if (!arr) continue;
                            let changed = false;
                            const out = arr.map(item => {
                              try {
                                if (!item) return item;
                                const name = ((item.inventoryName || item.title || '') + '').toLowerCase().trim();
                                if (name && inventoryName && name === inventoryName) {
                                  // set common active flags used by popup
                                  try { item.active = true; } catch (e) {}
                                  try { item.isActive = true; } catch (e) {}
                                  changed = true;
                                }
                              } catch (e) {}
                              return item;
                            });
                            if (changed) writeBack[k] = out;
                          } catch (e) {}
                        }
                        if (Object.keys(writeBack).length) {
                          try {
                            chrome.storage.local.set(writeBack, () => {
                              try { console.debug('[bg] pre-publish: marked saved listings active for', inventoryName); } catch(e){}
                              try {
                                // Also ensure the canonical `listings` array contains the active flags
                                try {
                                  chrome.storage.local.get(['listings'], (res) => {
                                    try {
                                      const cur = (res && Array.isArray(res.listings)) ? res.listings : null;
                                      if (cur && Array.isArray(cur)) {
                                        let changed = false;
                                        const updated = cur.map(item => {
                                          try {
                                            if (!item) return item;
                                            const name = ((item.inventoryName || item.title || '') + '').toLowerCase().trim();
                                            if (name && inventoryName && name === inventoryName) {
                                              try { item.active = true; } catch (e) {}
                                              try { item.isActive = true; } catch (e) {}
                                              changed = true;
                                            }
                                          } catch (e) {}
                                          return item;
                                        });
                                        if (changed) {
                                          try { chrome.storage.local.set({ listings: updated }, () => { try { console.debug('[bg] updated canonical listings with active flag for', inventoryName); } catch(e){} }); } catch (e) {}
                                        }
                                      }
                                    } catch (e) {}
                                  });
                                } catch (e) {}
                              } catch (ee) { /* non-fatal */ }

                              try {
                                // Notify popup to refresh saved listings so UI can pick up the active flag
                                chrome.runtime.sendMessage({ action: 'ffmRefreshSavedListings', reason: 'pre-publish-active-mark', publishRequestId: publishRequestId || null, inventoryName: inventoryName || null });
                              } catch (ee) { /* non-fatal */ }
                            });
                          } catch (e) {}
                        }
                      } catch (e) {}
                    });
                  } catch (e) {}
                } catch (e) {}
              });
            } catch (e) {}
          })();
        } catch (e) {}
        chrome.windows.getAll({ populate: false }, (wins) => {
          try {
            const normalWins = (wins || []).filter(w => w && w.type === 'normal');
            let chosen = normalWins.find(w => w && w.focused && w.id) || normalWins[0];
            try { console.debug('[bg] publish-listing windows.getAll result', { normalWinsCount: normalWins.length, chosen: chosen && chosen.id }); } catch (e) {}
            const openInWindow = (windowId) => {
              safeTabsCreate({ windowId, url: fbUrl }).then((tab) => {
                if (!tab || !tab.id) { console.debug('[bg] publish-listing tab create failed', { tab }); return; }
                const tabId = tab.id;
                try { console.debug('[bg] publish-listing tab created', { tabId, windowId }); } catch (e) {}

                const onUpdated = (tid, changeInfo) => {
                  if (tid !== tabId) return;
                  if (changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    try {
                      console.debug('[bg] publish-listing tab loaded; attempting populate-fb', { tabId, publishRequestId });

                      // capture explicit override from the incoming runtime message (if any)
                      const explicitAuto = (typeof message.autoPublish === 'boolean' && message.autoPublish === true) ? true : undefined;

                      const attemptSend = (triesLeft) => {
                        try {
                          const handleResponse = (err, resp) => {
                            try {
                              if (err) {
                                const msg = err && err.message ? err.message : String(err);
                                const benign = msg.includes('returned true but channel closed') || msg.includes('Receiving end does not exist');
                                if (benign && !FAST4MP_DEBUG) {
                                  try { appendPublishTrace(publishRequestId, { event: 'sendMessage-lastError-suppressed', tabId, msg, triesLeft }); } catch (e) {}
                                } else {
                                  console.debug('[bg] publish-listing sendMessage lastError', { tabId, msg, triesLeft });
                                }
                                if (triesLeft > 0) {
                                  try {
                                    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/content_main.js'] }, () => {
                                      try { consumeLastError(); } catch (e) {}
                                      try { console.debug('[bg] publish-listing injected content script', { tabId }); } catch (e) {}
                                      setTimeout(() => attemptSend(triesLeft - 1), 400);
                                    });
                                  } catch (e) {
                                    console.debug('[bg] publish-listing executeScript failed', e);
                                    setTimeout(() => attemptSend(triesLeft - 1), 400);
                                  }
                                } else {
                                  console.debug('[bg] publish-listing final sendMessage failure', { tabId });
                                }
                                // Fallback: if popup didn't provide menuAuto inline, check persistent setting now
                                try {
                                  if (typeof menuAutoHint === 'undefined') {
                                    chrome.storage.local.get({ auto_publish_enabled: false }, (res) => {
                                      try {
                                        if (res && res.auto_publish_enabled) {
                                          try { chrome.storage.local.set({ ['ffm_menu_auto_hint_' + publishRequestId]: true }, () => { try { console.debug('[bg] publish-listing: persisted menuAuto from storage for', publishRequestId); } catch (e) {} }); } catch (e) { console.debug('[bg] publish-listing: failed to persist menuAuto from storage', e); }
                                        }
                                      } catch (e) { console.debug('[bg] publish-listing: menuAuto storage read callback error', e); }
                                    });
                                  }
                                } catch (e) { console.debug('[bg] publish-listing: menuAuto fallback read error', e); }
                              } else {
                                console.debug('[bg] publish-listing sendMessage response', resp);
                              }
                            } catch (e) { console.debug('[bg] publish-listing sendMessage callback error', e); }
                          };

                          if (typeof explicitAuto === 'boolean') {
                            // caller provided explicit override — send both legacy and explicit fields
                            sendPopulateMessageToTab(tabId, publishRequestId, { auto: explicitAuto, autoPublish: explicitAuto, menuAuto: menuAutoHint, menuAutoPersistent: menuAutoHint }, handleResponse);
                          } else {
                            // default: read persistent setting and allow helper to honor force flag
                            chrome.storage.local.get({ auto_publish_enabled: false }, (res) => {
                              try {
                                const auto = !!res.auto_publish_enabled;
                                sendPopulateMessageToTab(tabId, publishRequestId, { auto: auto, autoPublish: auto, menuAuto: menuAutoHint, menuAutoPersistent: menuAutoHint }, handleResponse);
                              } catch (e) { console.debug('publish-listing storage read callback error', e); }
                            });
                          }
                        } catch (e) { console.debug('[bg] publish-listing attemptSend outer error', e); }
                      };

                      // Wait for a content listener handshake first (reduces MV3 channel-race errors),
                      // then try up to 4 attempts (initial + 3 retries). If handshake times out, fall back to attemptSend.
                      try {
                        try {
                          waitForContentListener(tabId, 5000).then(() => attemptSend(3)).catch(() => attemptSend(3));
                        } catch (e) { attemptSend(3); }
                      } catch (e) { attemptSend(3); }
                    } catch (e) { console.debug('[bg] publish-listing sendMessage failed', e); }
                  }
                };
                chrome.tabs.onUpdated.addListener(onUpdated);
              }).catch((err) => { try { console.debug('[bg] openInWindow safeTabsCreate error', err); } catch(e){} });
            };

            if (chosen && chosen.id) {
              openInWindow(chosen.id);
            } else {
              chrome.windows.create({ url: fbUrl, type: 'normal' }, (w) => {
                try {
                  const tab = w && w.tabs && w.tabs[0];
                  if (!tab || !tab.id) return;
                  const tabId = tab.id;
                  const onUpdated = (tid, changeInfo) => {
                    if (tid !== tabId) return;
                      if (changeInfo.status === 'complete') {
                        try { sendPopulateMessageToTab(tabId, publishRequestId, { menuAuto: menuAutoHint, menuAutoPersistent: menuAutoHint, autoPublish: !!menuAutoHint, auto: !!menuAutoHint }); } catch (e) { try { chrome.tabs.sendMessage(tabId, { action: 'populate-fb', publishRequestId }); } catch (ee) {} }

                        // Also nudge the create page to pull any saved relist payload (if present)
                        try {
                          // Attempt to avoid sending large media inside the message by staging media in storage
                          try {
                            chrome.storage.local.get(['ffm_staged_listing', 'ffm_relist_payload'], (items) => {
                              try {
                                const full = items && (items.ffm_relist_payload || items.ffm_staged_listing) ? (items.ffm_relist_payload || items.ffm_staged_listing) : null;
                                if (full && (Array.isArray(full.images) || Array.isArray(full.videos))) {
                                  const slim = Object.assign({}, full);
                                  // remove large media blobs from the in-message payload
                                  try { delete slim.images; } catch (e) {}
                                  try { delete slim.videos; } catch (e) {}
                                  // Stage media separately under a dedicated key
                                  try { chrome.storage.local.set({ ffm_staged_relist_media: { images: full.images || [], videos: full.videos || [] } }, () => {}); } catch (e) {}
                                  try {
                                    chrome.tabs.sendMessage(tabId, { action: 'ffm_inject_relist_payload', payload: slim, hasStagedMedia: true }, { frameId: 0 }, (r) => {
                                      try {
                                        if (chrome.runtime && chrome.runtime.lastError) {
                                          console.warn('[bg] ffm_inject_relist_payload (windows.create): could not reach tab', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message);
                                        } else {
                                          console.debug('[bg] ffm_inject_relist_payload (windows.create) sent to tab (slim payload)', tabId, r);
                                        }
                                      } catch (e) {}
                                    });
                                  } catch (e) { console.debug('[bg] ffm_inject_relist_payload (windows.create) send failed', e); }
                                  return;
                                }
                              } catch (e) {}
                              // Fallback: send a simple ping if no staged payload found
                              try {
                                chrome.tabs.sendMessage(tabId, { action: 'ffm_inject_relist_payload' }, { frameId: 0 }, (r) => {
                                  try {
                                    if (chrome.runtime && chrome.runtime.lastError) {
                                      console.warn('[bg] ffm_inject_relist_payload (windows.create): could not reach tab', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message);
                                    } else {
                                      console.debug('[bg] ffm_inject_relist_payload (windows.create) sent to tab', tabId, r);
                                    }
                                  } catch (e) {}
                                });
                              } catch (e) { console.debug('[bg] ffm_inject_relist_payload (windows.create) send failed', e); }
                            });
                          } catch (e) {
                            // If storage read failed, fall back to simple send
                            chrome.tabs.sendMessage(tabId, { action: 'ffm_inject_relist_payload' }, { frameId: 0 }, (r) => {
                              try {
                                if (chrome.runtime && chrome.runtime.lastError) {
                                  console.warn('[bg] ffm_inject_relist_payload (windows.create): could not reach tab', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message);
                                } else {
                                  console.debug('[bg] ffm_inject_relist_payload (windows.create) sent to tab', tabId, r);
                                }
                              } catch (e) {}
                            });
                          }
                        } catch (e) { console.debug('[bg] ffm_inject_relist_payload (windows.create) send failed', e); }

                        chrome.tabs.onUpdated.removeListener(onUpdated);
                      }
                  };
                  chrome.tabs.onUpdated.addListener(onUpdated);
                } catch (e) { console.debug('publish-listing windows.create handler error', e); }
              });
            }
          } catch (e) { console.debug('publish-listing getAll inner error', e); }
        });
      } catch (e) { console.debug('publish-listing getAll error', e); }
    })();

    // Return immediately after acking; no further sendResponse will be performed.
    return;
  }

  // FB Image Search: prefer existing FB tab and extract visible image URLs via scripting.executeScript
  if (message && message.action === 'fb-image-search') {
    try {
      // Run async work in an IIFE so the onMessage listener can return true synchronously
      (async () => {
        try {
          const q = (message.query || '').toString().trim();
          if (!q) { try { chrome.runtime.sendMessage({ action: 'fb-image-search-result', images: [] }); } catch (e) {} return; }
          // Immediately acknowledge the popup so ephemeral senders don't time out.
          try { sendResponse && sendResponse({ ok: true, started: true }); } catch (e) {}

          // Prefer using the active Facebook tab when the popup pressed "Refresh"
          // (avoid opening a new search tab unnecessarily). If `message.forceNew`
          // is true we'll still open a fresh search tab.
          let target = null;

          const openAndTarget = async () => {
            const url = 'https://www.facebook.com/search/top/?q=' + encodeURIComponent(q);
            try {
              const tab = await safeTabsCreate({ url, active: true });
              if (tab && tab.id) return tab;
              try { console.debug('[bg:fb-image-search] safeTabsCreate returned null, falling back to windows.create', url); } catch(e){}
            } catch (e) { try { console.debug('[bg:fb-image-search] safeTabsCreate threw', e); } catch(_){} }

            // Fallback: try chrome.windows.create (more permissive in some contexts)
            try {
              return await new Promise((res) => {
                try {
                  chrome.windows.create({ url, type: 'normal' }, (w) => {
                    try {
                      const tab = w && w.tabs && w.tabs[0];
                      res(tab || null);
                    } catch (e) { res(null); }
                  });
                } catch (e) { res(null); }
              });
            } catch (e) { return null; }
          };

          // If the caller didn't explicitly request a fresh search tab, try to
          // use the active tab in the current window when it appears to be a
          // Facebook page. This enables the popup's Refresh button to harvest
          // images from the listing page the user is viewing.
          try {
            if (!message || !message.forceNew) {
              try {
                const activeTabs = await new Promise((res) => {
                  try { chrome.tabs.query({ active: true, currentWindow: true }, res); } catch (e) { res([]); }
                });
                const at = (activeTabs && activeTabs[0]) ? activeTabs[0] : null;
                if (at && at.url && typeof at.url === 'string' && at.url.indexOf('facebook.com') !== -1) {
                  target = at;
                }
              } catch (e) { /* ignore and fall back to opening new tab */ }
            }
          } catch (e) {}

          // Open a fresh tab if no suitable active FB tab was found
          if (!target) target = await openAndTarget();
          if (!target || !target.id) { try { chrome.runtime.sendMessage({ action: 'fb-image-search-result', images: [] }); } catch (e) {} return; }

          const tabId = target.id;
          try { if (target.windowId) safeWindowsUpdate(target.windowId, { focused: true }); } catch (_) {}

          // Execute a page extractor in MAIN world to harvest visible image src/href candidates
          const extractor = () => {
            try {
              const seen = new Set();
              const images = [];

              const addSrc = (src) => {
                try {
                  if (!src) return;
                  if (typeof src !== 'string') return;
                  src = src.trim();
                  if (!src) return;
                  if (src.indexOf('data:') === 0) return; // skip inline data URIs
                  if (seen.has(src)) return;
                  seen.add(src);
                  images.push(src);
                } catch (e) {}
              };

              // Additional heuristic: prefer a 'Seller information' cutoff and fall back to 'Sponsored'.
              // We will collect images only while they appear before the cutoff element in document order.
              let cutoffEl = null;
              try {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                while (walker.nextNode()) {
                  try {
                    const nv = walker.currentNode && walker.currentNode.nodeValue;
                    if (!nv) continue;
                    const clean = nv.toString().trim().toLowerCase();

                    // PRIORITY: exact 'Seller information' header typically appears under images
                    if (clean === 'seller information') {
                      cutoffEl = walker.currentNode && walker.currentNode.parentElement;
                      break;
                    }

                    // Secondary fallback: stop at sponsored markers to avoid ads/related sections
                    if (/\bsponsored\b/i.test(clean)) {
                      cutoffEl = walker.currentNode && walker.currentNode.parentElement;
                      break;
                    }
                  } catch (e) { /* continue scanning */ }
                }
              } catch (e) {}

              /* Collect IMG tags but stop once passing cutoff element */
              const imgs = Array.from(document.querySelectorAll('img'));
              for (const img of imgs) {
                try {
                  const src = img.currentSrc || img.src || (img.getAttribute && img.getAttribute('src'));
                  if (!src) continue;

                  const rect = (img.getBoundingClientRect && img.getBoundingClientRect()) || null;
                  if (rect && rect.width < 20 && rect.height < 20) continue; // tiny icons

                  if (cutoffEl) {
                    try {
                      if (typeof img.compareDocumentPosition === 'function') {
                        const mask = img.compareDocumentPosition(cutoffEl);
                        const isBefore = Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
                        if (!isBefore) continue; // skip any images after Seller information
                      }
                    } catch (e) {}
                  }

                  addSrc(src);
                } catch (e) {}
              }

              // Also look for meta og:image (place it first) but only include if it's before picks (meta is usually in head)
              try {
                const m = document.querySelector('meta[property="og:image"]');
                if (m && m.content) {
                  if (!firstSponsoredEl) addSrc(m.content);
                  else {
                    try {
                      // meta is typically in head, so include if it appears before the sponsored element
                      if (typeof m.compareDocumentPosition === 'function' && firstSponsoredEl) {
                        const mask = m.compareDocumentPosition(firstSponsoredEl);
                        const isBefore = Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
                        if (isBefore) addSrc(m.content);
                      } else {
                        addSrc(m.content);
                      }
                    } catch (e) { addSrc(m.content); }
                  }
                }
              } catch (e) {}

              return Array.from(images);
            } catch (e) { return []; }
          };

          try {
            const runExtractorOnTab = async (tab) => {
              const tabIdLocal = tab.id;
              const doExec = async () => {
                const execRes = await chrome.scripting.executeScript({ target: { tabId: tabIdLocal }, func: extractor, world: 'MAIN' });
                const imgs = Array.isArray(execRes) && execRes[0] && Array.isArray(execRes[0].result) ? execRes[0].result : [];
                const unique = Array.from(new Set((imgs || []).filter(Boolean)));
                try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_fb_images: { images: unique, timestamp: Date.now(), query: q } }); } catch (e) {}
                try { chrome.runtime.sendMessage({ action: 'fb-image-search-result', images: unique }); } catch (e) {}
              };

              // Try immediate exec first (fast-path). If it fails (e.g. tab not ready),
              // wait for the tab to reach 'complete' status then try again with a timeout fallback.
              try {
                await doExec();
                return;
              } catch (e) { /* fall through to waiting */ }

              await new Promise((res) => {
                let done = false;
                const onUpdated = (tid, changeInfo) => {
                  if (tid !== tabIdLocal) return;
                  if (changeInfo && changeInfo.status === 'complete') {
                    try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch(_){}
                    if (!done) { done = true; res(); }
                  }
                };
                try { chrome.tabs.onUpdated.addListener(onUpdated); } catch (e) {}
                // Timeout fallback after 7s
                setTimeout(() => { try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch(_){} if (!done) { done = true; res(); } }, 7000);
              });

              try { await doExec(); } catch (e) { try { chrome.runtime.sendMessage({ action: 'fb-image-search-result', images: [] }); } catch(_){} }
            };

            await runExtractorOnTab(target);
          } catch (e) {
            try { chrome.runtime.sendMessage({ action: 'fb-image-search-result', images: [] }); } catch (er) {}
          }
        } catch (e) { try { chrome.runtime.sendMessage({ action: 'fb-image-search-result', images: [] }); } catch (_) {} }
      })();
    } catch (e) { try { chrome.runtime.sendMessage({ action: 'fb-image-search-result', images: [] }); } catch (_) {} }
    return true;
  }

  // Allow content script to request that the FB tab be closed and return control
  if (message && message.action === 'ffm-close-and-return') {
    try {
      const tabId = sender && sender.tab && sender.tab.id;
      if (tabId) {
        try {
          if (tabId) {
            try { safeTabsRemove(tabId).catch(()=>{}); } catch (e) {}
          }
        } catch (e) {}
      }
      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
    } catch (e) { try { sendResponse && sendResponse({ ok: false }); } catch (e) {} }
  return;
  }

  // Resume populate after content script resolves the staged listing id
  if (message && (message.action === 'populate-fb-resume' || message.action === 'populate-fb-ready')) {
    try {
      // Send a small trigger back; content will read the listing from window.ffm_staged_publish_listing
      const sendToTab = (tabId) => {
        try { chrome.tabs.sendMessage(tabId, { action: 'populate-fb-trigger' }); } catch (e) { console.debug('populate-fb trigger sendMessage failed', e); }
      };
      if (sender && sender.tab && sender.tab.id) {
        sendToTab(sender.tab.id);
      } else {
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const t = (tabs || [])[0];
            if (t && t.id) sendToTab(t.id);
          });
        } catch (e) {}
      }
      try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
    } catch (e) { console.debug('populate-fb-resume handler error', e); }
    // We responded synchronously above; do not return true (no async sendResponse pending)
    return;
  }
});



// ===== AutoList Pro added helpers: logging and click injector =====
const AutoListPro = (function(){
  async function _getLogs(){
    const items = await chrome.storage.local.get(['fast4mp_logs','fast4mp_debug']);
    return { logs: items.fast4mp_logs||[], debug: !!items.fast4mp_debug };
  }
  async function log(level, msg, meta){
    try {
      const t = new Date().toISOString();
      const entry = { ts: t, level, msg, meta: meta||null };
      const cur = await chrome.storage.local.get('fast4mp_logs');
      const arr = cur.fast4mp_logs || [];
      arr.push(entry);
      // truncate to last 1000 entries to avoid bloat
      if (arr.length > 1000) arr.splice(0, arr.length-1000);
      await chrome.storage.local.set({ fast4mp_logs: arr });
      const dbg = (await chrome.storage.local.get('fast4mp_debug')).fast4mp_debug;
      if (dbg) console.log('[AutoList Pro]', entry);
    } catch(e){ console.error('AutoList Pro logging error', e); }
  }
  async function clearLogs(){ await chrome.storage.local.set({ fast4mp_logs: [] }); }
  async function setDebug(v){ await chrome.storage.local.set({ fast4mp_debug: !!v }); }

  // Inject helper into page and call it
  async function clickMarketplaceNext(tabId, selector){
    try {
      await log('info', 'clickMarketplaceNext called', { tabId, selector });
      // First inject helper file (pageClickHelper.js) if not already present
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['pageClickHelper.js'],
        world: 'MAIN'
      });
      await log('info','injected pageClickHelper.js');
      // Now call the helper in the page context
      const results = await new Promise((resolve) => {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (sel) => {
            // eslint-disable-next-line no-undef
            return window.__AutoListPro_pageClickHelper && window.__AutoListPro_pageClickHelper.clickWhenReady
              ? window.__AutoListPro_pageClickHelper.clickWhenReady(sel, { timeout: 7000, retry: 3 })
              : { success: false, method: 'no-helper' };
          },
          args: [selector],
          world: 'MAIN'
        }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res && res[0] ? res[0].result : { success: false, method: 'no-result' });
          }
        });
      });
      await log('info','click helper result', results);
      return results;
    } catch(e){
      await log('error','clickMarketplaceNext failed',{error: e && e.message});
      return { success: false, error: e && e.message };
    }
  }

  return { log, clickMarketplaceNext };
})();

// Expose to global so other scripts can call AutoListPro.* if needed
try {
  if (typeof window !== 'undefined' && window) {
    window.AutoListPro = AutoListPro;
  } else if (typeof self !== 'undefined' && self) {
    // service worker / background script global
    self.AutoListPro = AutoListPro;
  } else if (typeof globalThis !== 'undefined' && globalThis) {
    globalThis.AutoListPro = AutoListPro;
  }
} catch (e) { console.debug('AutoList Pro global export failed', e); }

// Allow other contexts (popup/content) to invoke a small, allowed set of AutoList Pro helpers
addSafeListener((message, sender, sendResponse) => {
  try {
    if (!message || message.action !== 'fast4mp_invoke') return;
    console.debug && console.debug('[bg] fast4mp_invoke received', message.method);
    // Diagnostic wrapper for this listener
    let __diagResponded = false;
    const __origSend = sendResponse;
    sendResponse = function(...args) { __diagResponded = true; try { __origSend && __origSend(...args); } catch (e) {} };

    const method = message.method;
    const args = Array.isArray(message.args) ? message.args : [];
    // restrict methods that can be invoked remotely for safety
    const allowed = ['log', 'clickMarketplaceNext'];
  if (!allowed.includes(method)) { sendResponse && sendResponse({ ok: false, error: 'method-not-allowed' }); return; }
    (async () => {
      try {
        const res = await AutoListPro[method](...args);
        sendResponse && sendResponse({ ok: true, result: res });
      } catch (err) {
        sendResponse && sendResponse({ ok: false, error: String(err) });
      }
    })();

    // If we return true (async) but never observed a sendResponse within 5s, warn and auto-respond
    setTimeout(() => {
      if (!__diagResponded) {
        try { __origSend && __origSend({ ok: false, error: 'fast4mp_invoke-no-response-timeout' }); } catch (e) {}
        __diagResponded = true;
  if (FAST4MP_DEBUG) console.warn('[AutoList Pro] fast4mp_invoke did not call sendResponse within 5s for', method);
      }
    }, 5000);

  return; // indicate async response
  } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
});

// Quick smoke test to confirm AutoList Pro is usable from the background
(async () => {
  try { await AutoListPro.log('info', 'background-ready', { ts: new Date().toISOString() }); } catch (e) { console.debug('AutoList Pro smoke log failed', e); }
})();
// Alarm handler for scheduled tasks

// Preload media records for a listing from ffmMediaDB and return staged descriptors
async function ffmPreloadMediaForListing(listingId) {
  try {
    if (typeof ffmMediaDB === 'undefined' || !ffmMediaDB) return [];
    const media = await ffmMediaDB.getBlobsForListing(listingId);
    const images = Array.isArray(media && media.images) ? media.images : [];
    const staged = images.map((rec, i) => {
      try {
        return {
          key: rec && rec.key ? rec.key : null,
          name: rec && rec.name ? rec.name : (rec && rec.filename) ? rec.filename : `image_${typeof rec.index === 'number' ? rec.index : i}.jpg`,
          mimeType: rec && (rec.mimeType || (rec.blob && rec.blob.type)) ? (rec.mimeType || (rec.blob && rec.blob.type)) : 'image/jpeg',
          size: rec && rec.blob && typeof rec.blob.size === 'number' ? rec.blob.size : (rec && rec.size) || 0,
          index: typeof rec.index === 'number' ? rec.index : i,
          type: rec && rec.type ? rec.type : 'image',
          _dbRecord: rec
        };
      } catch (e) { return { index: i, _dbRecord: rec }; }
    });
    staged.sort((a,b) => (a.index||0) - (b.index||0));
    return staged;
  } catch (e) {
    console.warn('[bg] ffmPreloadMediaForListing failed', e);
    return [];
  }
}

// Helper to send populate-fb including autoPublish flag read from storage
function sendPopulateMessageToTab(tabId, publishRequestId, overrideAuto, cb) {
  try {
    // normalize args: if overrideAuto is actually the callback
    if (typeof overrideAuto === 'function') { cb = overrideAuto; overrideAuto = undefined; }
    // If the tab hasn't announced its content-ready handshake, queue the populate
    try {
      if (!readyTabs.has(tabId)) {
        __ffm_pendingPopulates[tabId] = __ffm_pendingPopulates[tabId] || [];
        __ffm_pendingPopulates[tabId].push({ publishRequestId, overrideAuto, cb });
        try { console.debug('[bg] sendPopulateMessageToTab: tab not ready, queued populate', { tabId, publishRequestId }); } catch (e) {}
        return;
      }
    } catch (e) {}
    const doSend = (payload) => {
          try {
            // Attach a short ack token so the content script can persistently acknowledge receipt
            try {
              const ackToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
              payload._ackToken = ackToken;
              const ackKey = 'ffm_populate_ack_' + ackToken;
              // Ensure any previous ackKey cleared
              try { chrome.storage.local.remove([ackKey]); } catch (e) {}

              // Attempt to enrich the payload with the staged listing when available so content
              // has a direct in-message reference (best-effort; content still reads staged key).
              try {
                const stagedKey = 'ffm_publish_' + publishRequestId;
                const publishSourceKey = 'ffm_publish_source_' + publishRequestId;
                chrome.storage.local.get([stagedKey, 'ffm_last_publish', publishSourceKey], (res) => {
                  try {
                    const publishSourceKey = 'ffm_publish_source_' + publishRequestId;
                    const staged = res && res[stagedKey];
                    const last = res && res.ffm_last_publish;
                    const sourceHint = res && res[publishSourceKey];
                    const enriched = Object.assign({}, payload);
                    try {
                      if (staged) enriched.payload = { listing: staged, publishRequestId };
                      else if (last && last.publishRequestId === publishRequestId) enriched.payload = { listing: last, publishRequestId };
                      if (typeof sourceHint !== 'undefined') enriched.publishSource = sourceHint;
                    } catch (e) {}

                    chrome.tabs.sendMessage(tabId, enriched, { frameId: 0 }, (resp) => {
                      try {
                        // sendMessage callback may often close due to MV3 lifecycle; read lastError to
                        // consume it and avoid DevTools "Unchecked runtime.lastError" spam.
                        try {
                          if (chrome && chrome.runtime && chrome.runtime.lastError) {
                            const _leMsg = chrome.runtime.lastError && chrome.runtime.lastError.message;
                            if (FAST4MP_DEBUG) try { console.debug('[bg] tabs.sendMessage lastError', { tabId, _leMsg }); } catch(e){}
                          } else {
                            // nothing further to do here; ack poll will call cb
                          }
                        } catch (e) { /* swallow */ }
                      } catch (e) {}
                    });
                    } catch (e) {
                    // Fallback: send without enrichment (target top frame)
                    try { chrome.tabs.sendMessage(tabId, payload, { frameId: 0 }); } catch (e2) {}
                  }
                });
              } catch (e) {
                // If storage read fails, fall back to sending minimal payload
                try { chrome.tabs.sendMessage(tabId, payload, { frameId: 0 }); } catch (e2) {}
              }

              // Poll storage for content ack up to 4s (unchanged)
              const maxWait = 4000;
              const interval = 250;
              const maxTries = Math.max(1, Math.ceil(maxWait / interval));
              let tryCount = 0;
              const poll = () => {
                try {
                  chrome.storage.local.get([ackKey], (res) => {
                    try {
                      tryCount++;
                      if (res && res[ackKey]) {
                        try { console.debug('[bg] doSend: content ack received', { publishRequestId, tabId, ackToken }); } catch(e){}
                        try { chrome.storage.local.remove([ackKey]); } catch (e) {}
                        if (cb) try { cb(null, { ack: true }); } catch (e) {}
                        return;
                      }
                      if (tryCount < maxTries) {
                        setTimeout(poll, interval);
                        return;
                      }
                      try { console.debug('[bg] doSend: ack timeout, treating send as best-effort', { publishRequestId, tabId, ackToken }); } catch(e){}
                      if (cb) try { cb(null, { ack: false }); } catch (e) {}
                    } catch (e) { if (cb) try { cb(e); } catch (_) {} }
                  });
                } catch (e) { if (cb) try { cb(e); } catch (_) {} }
              };
              poll();
            } catch (e) { if (cb) try { cb(e); } catch (_) {} }
          } catch (e) { if (cb) try { cb(e); } catch (_) {} else console.debug('sendPopulateMessageToTab sendMessage failed', e); }
    };

    // Helper: ensure the staged publish payload exists in storage before sending.
    // This avoids races where the popup staged the listing but the new tab's
    // content script reads storage before it's visible, causing 'staged listing not found'.
    const ensureStagedThenSend = (payload, cb) => {
      try {
        const key = 'ffm_publish_' + publishRequestId;
        const maxAttempts = 6;
        const delayMs = 300;
        let tries = 0;

        const ping = () => {
          try {
            chrome.storage.local.get([key], (res) => {
              try {
                const listing = res && res[key];
                if (listing) {
                  // We found the staged listing for this publishRequestId.
                  // Attach media from MediaDB *here* (background context),
                  // then send everything to the FB tab.
                  (async () => {
                    let mediaBuffers = { images: [] };

                    try {
                      const lookupKey =
                        listing.listingId ||
                        listing.inventoryName ||
                        listing.title ||
                        listing.id ||
                        'unknown';

                      // Preload staged descriptors (include _dbRecord) so content can reconstruct Files
                      try {
                        const staged = await ffmPreloadMediaForListing(lookupKey);
                        if (staged && staged.length) {
                          try { listing.stagedMedia = staged; } catch (e) {}
                        }
                      } catch (e) {
                        console.warn('[bg] ensureStagedThenSend: preload staged media failed', e);
                      }

                      if (typeof ffmMediaDB !== 'undefined' && ffmMediaDB) {
                        const media = await ffmMediaDB.getBlobsForListing(lookupKey);
                        const images = Array.isArray(media && media.images) ? media.images : [];

                        const maxImages = 10;
                        for (let i = 0; i < images.length && i < maxImages; i++) {
                          const rec = images[i];
                          try {
                            if (!rec || !rec.blob) continue;
                            const filename =
                              (rec.key && String(rec.key).split('/').pop()) ||
                              rec.name ||
                              `image_${typeof rec.index === 'number' ? rec.index : i}.jpg`;
                            const mime =
                              rec.mimeType ||
                              (rec.blob && rec.blob.type) ||
                              'image/jpeg';

                            const buf = await rec.blob.arrayBuffer();
                            mediaBuffers.images.push({ name: filename, mimeType: mime, buffer: buf });
                          } catch (e) {
                            console.warn('[bg] ensureStagedThenSend: failed converting DB image to buffer', e);
                          }
                        }
                      }
                    } catch (e) {
                      console.warn('[bg] ensureStagedThenSend: MediaDB image load failed', e);
                    }

                    try {
                      const enriched = Object.assign({}, payload, {
                        listing,
                        publishRequestId,
                        mediaBuffers,
                      });
                      doSend(enriched);
                      if (cb) cb(null);
                    } catch (e) {
                      if (cb) cb(e);
                    }
                  })();

                  return;
                }

                // no staged listing yet, keep polling a few times
                tries++;
                try {
                  console.debug('[bg] ensureStagedThenSend: staged listing not yet present', { publishRequestId, tries, maxAttempts });
                } catch (e) {}
                if (tries < maxAttempts) {
                  setTimeout(ping, delayMs);
                  return;
                }

                // Give up after retries — send original payload without mediaBuffers
                try {
                  console.debug('[bg] ensureStagedThenSend: giving up without staged listing', { publishRequestId, tabId });
                } catch (e) {}
                doSend(payload);
                if (cb) cb(null);
              } catch (e) {
                if (cb) cb(e);
              }
            });
          } catch (e) {
            if (cb) cb(e);
          }
        };

        ping();
      } catch (e) {
        if (cb) cb(e);
      }
    };

    // Compute the final autoPublish value: explicit override > inline hint > force flag > persistent setting
    try {
      // Support an override object { auto: boolean?, menuAuto: boolean? } passed by callers
      let inlineMenuAutoHint = undefined;
      if (overrideAuto && typeof overrideAuto === 'object') {
        try {
          if (typeof overrideAuto.menuAuto !== 'undefined') inlineMenuAutoHint = !!overrideAuto.menuAuto;
        } catch (e) {}
        // If explicit auto true requested, honor immediately and attach menuAutoPersistent when available
        try {
          if (typeof overrideAuto.auto === 'boolean' && overrideAuto.auto === true) {
            const payload = { action: 'populate-fb', publishRequestId, autoPublish: true };
            if (typeof inlineMenuAutoHint !== 'undefined') payload.menuAutoPersistent = !!inlineMenuAutoHint;
            if (overrideAuto && overrideAuto.publishSource) payload.publishSource = overrideAuto.publishSource;
            try { console.debug('[bg] sendPopulateMessageToTab: explicit override autoPublish=true (inline object)', { publishRequestId }); } catch(e){}
            return ensureStagedThenSend(payload, cb);
          }
        } catch (e) {}
        // Treat explicit false as no-op and fall through so force-flag or persistent setting can still enable auto-publish
      }

      // First, prefer a short-lived global hint written by the popup when the
      // user toggles the menu setting (avoids races when toggling and immediately publishing).
      try {
        chrome.storage.local.get(['ffm_menu_auto_last'], (lastRes) => {
          try {
            const last = lastRes && lastRes.ffm_menu_auto_last;
            const now = Date.now();
            if (last && typeof last.val !== 'undefined' && (now - (last.ts || 0) < 15000)) {
              // If the hint is recent (15s), use it immediately
              const payload = { action: 'populate-fb', publishRequestId, autoPublish: !!last.val, menuAutoPersistent: !!last.val };
              // If caller passed an inline hint, prefer it (it was passed directly from popup)
              if (typeof inlineMenuAutoHint !== 'undefined') payload.menuAutoPersistent = !!inlineMenuAutoHint;
              try { console.debug('[bg] sendPopulateMessageToTab: using recent ffm_menu_auto_last hint ->', { publishRequestId, autoPublish: !!last.val }); } catch (e) {}
              return ensureStagedThenSend(payload, cb);
            }
          } catch (e) { console.debug('sendPopulateMessageToTab ffm_menu_auto_last read error', e); }

          // Check for a short-lived per-publish menu hint written by the popup (helps survive races)
          const menuHintKey = 'ffm_menu_auto_hint_' + publishRequestId;
          try {
            chrome.storage.local.get([menuHintKey], (mhRes) => {
              try {
                if (mhRes && mhRes[menuHintKey]) {
                  // Use the hint and remove it
                  try { chrome.storage.local.remove([menuHintKey]); } catch (e) {}
                  const payload = { action: 'populate-fb', publishRequestId, autoPublish: true };
                  if (typeof inlineMenuAutoHint !== 'undefined') payload.menuAutoPersistent = !!inlineMenuAutoHint;
                  try { console.debug('[bg] sendPopulateMessageToTab: using menuAuto hint', { publishRequestId, tabId }); } catch (e) {}
                  return ensureStagedThenSend(payload, cb);
                }
              } catch (e) { console.debug('sendPopulateMessageToTab menuHint read callback error', e); }

              // fallback: check force flag
              const forceKey = 'ffm_force_auto_publish_' + publishRequestId;
              try {
                chrome.storage.local.get([forceKey], (r) => {
                  try {
                    if (r && r[forceKey]) {
                      const payload = { action: 'populate-fb', publishRequestId, autoPublish: true };
                      if (typeof inlineMenuAutoHint !== 'undefined') payload.menuAutoPersistent = !!inlineMenuAutoHint;
                      try { console.debug('[bg] sendPopulateMessageToTab: force-auto detected and used (flag left for content)', { publishRequestId, tabId }); } catch (e) {}
                      return ensureStagedThenSend(payload, cb);
                    }
                  } catch (e) { console.debug('sendPopulateMessageToTab forceKey read callback error', e); }
                  // fallback to persistent user setting
                  try {
                    // Read persistent menu opt-in and attach it explicitly to the payload
                    chrome.storage.local.get({ auto_publish_enabled: false }, (res) => {
                      try {
                        const auto = !!res.auto_publish_enabled;
                        // Attach both autoPublish and menuAutoPersistent so the content
                        // script can consult an immediately-available persistent hint
                        const payload = { action: 'populate-fb', publishRequestId, autoPublish: auto, menuAutoPersistent: auto };
                        // If inline hint present, prefer it instead of storage
                        if (typeof inlineMenuAutoHint !== 'undefined') payload.menuAutoPersistent = !!inlineMenuAutoHint;
                        try { console.debug('[bg] sendPopulateMessageToTab: read persistent auto_publish_enabled ->', { publishRequestId, autoPublish: auto }); } catch (e) {}
                        return ensureStagedThenSend(payload, cb);
                      } catch (e) { console.debug('sendPopulateMessageToTab storage callback error', e); if (cb) try { cb(e); } catch(_) {} }
                    });
                  } catch (e) { console.debug('sendPopulateMessageToTab fallback storage error', e); if (cb) try { cb(e); } catch(_) {} }
                });
              } catch (e) { console.debug('sendPopulateMessageToTab force key read error', e); if (cb) try { cb(e); } catch(_) {} }
            });
          } catch (e) { console.debug('sendPopulateMessageToTab menuHint block error', e); if (cb) try { cb(e); } catch(_) {} }
        });
      } catch (e) { console.debug('sendPopulateMessageToTab ffm_menu_auto_last outer error', e); if (cb) try { cb(e); } catch(_) {} }
    } catch (e) { console.debug('sendPopulateMessageToTab compute-auto error', e); if (cb) try { cb(e); } catch(_) {} }
  } catch (e) { console.debug('sendPopulateMessageToTab error', e); }
}

// Helper: open FB create page and send populate message for a staged publish id
async function publishListingById(publishRequestId) {
  try { console.debug('[bg] publishListingById', { publishRequestId }); } catch (e) {}
  try { appendPublishTrace(publishRequestId, 'publishListingById-called'); } catch (e) {}
  // --------------------------------------------------------
  // ADS timing: mark publish start so ffm_publish_complete
  // can compute publishDurationMs for history.
  // --------------------------------------------------------
  try {
    const timingKey = 'ffm_publish_timing_' + String(publishRequestId || '');
    chrome.storage.local.set(
      { [timingKey]: { start: Date.now() } },
      () => {}
    );
  } catch (e) {
    try { console.warn('[ADS History] failed to persist publish start time', e); } catch (er) {}
  }
  // Quick in-memory running guard: prevent concurrent publishListingById invocations
  // no-op: rely on persistent/storage-based inflight guard and publishInFlight set

  // ------------------------------
  // PUBLISH LOCK: START
  // ------------------------------
  // Notify any SDnR waiter that publish is starting by reading the persisted meta
  try {
    const metaKey = 'ffm_publish_meta_' + publishRequestId;
    try {
      const metaRes = await new Promise(res => { try { chrome.storage.local.get([metaKey], res); } catch (e) { res({}); } });
      const meta = metaRes && metaRes[metaKey];
      if (meta) {
        try { ffmNotifyDnRPublishStarted({ taskId: meta.taskId || null, listingId: meta.listingId || null }); } catch (e) {}
      }
    } catch (e) {}
  } catch (e) {}
  let cleanupTimer;
  const inflKey = 'ffm_publish_inflight_' + publishRequestId;
  try {
    try { await chrome.storage.session.set({ ffm_publish_in_progress: true }); console.warn('[AutoList Pro bg] 🔒 Publish lock enabled'); } catch (e) { console.debug('[AutoList Pro bg] publish lock set failed', e); }
    // De-dup: if a publish for this requestId is already in-flight, skip creating another tab
    try {
      // check persistent flag first (survives service worker restarts)
      const inflKey = 'ffm_publish_inflight_' + publishRequestId;
      const inflRes = await new Promise(res => chrome.storage.local.get([inflKey], res));
      const inflVal = inflRes && inflRes[inflKey];
      if (inflVal && (Date.now() - (inflVal.ts || 0) < 60000)) {
        try { appendPublishTrace(publishRequestId, 'skipped-persistent-inflight'); } catch (e) {}
        try { console.debug('[bg] publishListingById: skipped duplicate persistent in-flight publish', { publishRequestId }); } catch (e) {}
        return { ok: false, reason: 'inflight-persistent' };
      }
      // mark persistent in-flight
      try { await new Promise(r => chrome.storage.local.set({ [inflKey]: { ts: Date.now() } }, r)); } catch (e) {}
      // mark in-memory guard
      if (publishInFlight.has(publishRequestId)) {
        try { appendPublishTrace(publishRequestId, 'skipped-duplicate-inflight-memory'); } catch (e) {}
        try { console.debug('[bg] publishListingById: skipped duplicate in-flight publish (memory)', { publishRequestId }); } catch (e) {}
        return { ok: false, reason: 'inflight-memory' };
      }
      publishInFlight.add(publishRequestId);
      // Failsafe cleanup after 60s to avoid stuck entries
      cleanupTimer = setTimeout(async () => { try { publishInFlight.delete(publishRequestId); appendPublishTrace(publishRequestId, 'inflight-cleanup-timeout'); await new Promise(r => chrome.storage.local.remove(inflKey, r)); } catch (e) {} }, 60000);
    } catch (e) { console.debug('[bg] publishListingById inflight guard error', e); }
  const fbUrl = 'https://www.facebook.com/marketplace/create/item';
  try {
    chrome.windows.getAll({ populate: false }, async (wins) => {
      try {
        const normalWins = (wins || []).filter(w => w && w.type === 'normal');
        let chosen = normalWins.find(w => w && w.focused && w.id) || normalWins[0];
        try { console.debug('[bg] publishListingById windows.getAll', { normalWinsCount: normalWins.length, chosen: chosen && chosen.id }); } catch (e) {}
        const openInWindow = (windowId) => {
          safeTabsCreate({ windowId, url: fbUrl }).then((tab) => {
            try {
              if (!tab || !tab.id) { console.debug('[bg] publishListingById tab create failed', { tab }); return; }
              const tabId = tab.id;
              try { console.debug('[bg] publishListingById tab created', { tabId, windowId }); } catch (e) {}
              try { appendPublishTrace(publishRequestId, { event: 'tab-created', tabId, windowId }); } catch (e) {}
              const onUpdated = (tid, changeInfo) => {
                if (tid !== tabId) return;
                if (changeInfo.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(onUpdated);
                  try {
                    console.debug('[bg] publishListingById tab loaded; attempting populate-fb', { tabId, publishRequestId });
                    // Store publishRequestId in the page context so content scripts can read it
                    try {
                      if (chrome && chrome.scripting && typeof chrome.scripting.executeScript === 'function') {
                        try {
                          chrome.scripting.executeScript({ target: { tabId: tabId }, func: (id) => { try { window.__ffm_publishRequestId = id; } catch (e) {} }, args: [publishRequestId] });
                        } catch (e) { try { console.debug('[bg] failed to executeScript to set __ffm_publishRequestId', e); } catch (er) {} }
                      }
                    } catch (e) {}
                    // Before sending the populate message, confirm the staged payload exists in storage to avoid
                    // transient races where the content script reads before storage is visible in the new tab.
                    const ensureStagedThenSend = () => {
                      try {
                        const key = 'ffm_publish_' + publishRequestId;
                        const maxAttempts = 6;
                        const delayMs = 300;
                        let tries = 0;
                        const ping = () => {
                          try {
                            chrome.storage.local.get([key], (res) => {
                              try {
                                const listing = res && res[key];
                                if (listing) {
                                  // staged payload present — proceed to send the message
                                  try {
                                    sendPopulateMessageToTab(tabId, publishRequestId, (err, resp) => {
                                      try {
                                        if (err) {
                                          const msg = err && err.message ? err.message : String(err);
                                          try { appendPublishTrace(publishRequestId, { event: 'sendMessage-lastError', tabId, msg }); } catch (e) {}
                                          const benign = msg.includes('returned true but channel closed') || msg.includes('Receiving end does not exist');
                                          if (benign && !FAST4MP_DEBUG) {
                                            try { console.debug('[bg] publishListingById sendMessage lastError suppressed', { tabId }); } catch (e) {}
                                          } else {
                                            console.debug('[bg] publishListingById sendMessage lastError', { tabId, msg });
                                          }
                                        } else {
                                          try { appendPublishTrace(publishRequestId, { event: 'sendMessage-response', tabId, resp }); } catch (e) {}
                                          console.debug('[bg] publishListingById sendMessage response', resp);
                                          try { publishInFlight.delete(publishRequestId); } catch (e) {}
                                          try { clearTimeout(cleanupTimer); } catch (e) {}
                                        }
                                      } catch (e) { console.debug('[bg] publishListingById sendMessage callback error', e); }
                                    });
                                  } catch (e) { console.debug('[bg] publishListingById sendMessage outer error', e); }
                                  return;
                                }
                                tries++;
                                if (tries < maxAttempts) {
                                  setTimeout(ping, delayMs);
                                  return;
                                }
                                // Give up after retries — fall back to attempting send once (may still fail)
                                try {
                                  sendPopulateMessageToTab(tabId, publishRequestId, (err, resp) => {
                                    try {
                                      if (err) {
                                        const msg = err && err.message ? err.message : String(err);
                                        try { appendPublishTrace(publishRequestId, { event: 'final-sendMessage', tabId, msg }); } catch (e) {}
                                        console.debug('[bg] publishListingById final sendMessage lastError', { tabId, msg });
                                      } else {
                                        try { appendPublishTrace(publishRequestId, { event: 'final-sendMessage-response', tabId, resp }); } catch (e) {}
                                        console.debug('[bg] publishListingById final sendMessage response', resp);
                                        try { publishInFlight.delete(publishRequestId); } catch (e) {}
                                        try { clearTimeout(cleanupTimer); } catch (e) {}
                                      }
                                    } catch (e) {}
                                  });
                                } catch (e) { console.debug('[bg] publishListingById final sendMessage outer error', e); }
                              } catch (e) { console.debug('[bg] publishListingById storage.get callback error', e); }
                            });
                          } catch (e) { console.debug('[bg] publishListingById ensure ping error', e); }
                        };
                        ping();
                      } catch (e) { console.debug('publishListingById ensureStagedThenSend outer error', e); }
                    };
                    ensureStagedThenSend();

                    // Also signal the create-item page to pull any previously-saved relist payload (ffm_relist_payload)
                    try {
                      // Stage media and send slim payload when possible to avoid sending large blobs in the message
                      try {
                        chrome.storage.local.get(['ffm_staged_listing','ffm_relist_payload'], (items) => {
                          try {
                            const full = items && (items.ffm_relist_payload || items.ffm_staged_listing) ? (items.ffm_relist_payload || items.ffm_staged_listing) : null;
                            if (full && (Array.isArray(full.images) || Array.isArray(full.videos))) {
                              const slim = Object.assign({}, full);
                              try { delete slim.images; } catch (e) {}
                              try { delete slim.videos; } catch (e) {}
                              try {
                                // Convert any video entries into lightweight passthrough descriptors
                                const stagedImages = Array.isArray(full.images) ? full.images.slice() : [];
                                const stagedVideos = [];
                                if (Array.isArray(full.videos) && full.videos.length) {
                                  for (const v of full.videos) {
                                    try {
                                      if (!v) continue;
                                      // If v already looks like a passthrough descriptor, keep it
                                      if (typeof v === 'object' && v.passthrough && v.url) {
                                        stagedVideos.push(v);
                                        continue;
                                      }
                                      // If v is a string (dataURL or key), prefer using ffmLoadVideoPassthrough
                                      if (typeof v === 'string' || typeof v === 'object') {
                                        const pp = ffmLoadVideoPassthrough(v);
                                        if (pp) stagedVideos.push(pp);
                                        else stagedVideos.push(v);
                                      } else {
                                        stagedVideos.push(v);
                                      }
                                    } catch (e) { stagedVideos.push(v); }
                                  }
                                }
                                chrome.storage.local.set({ ffm_staged_relist_media: { images: stagedImages, videos: stagedVideos } }, () => {});
                              } catch (e) {
                                try { chrome.storage.local.set({ ffm_staged_relist_media: { images: full.images || [], videos: full.videos || [] } }, () => {}); } catch (er) {}
                              }
                              try {
                                chrome.tabs.sendMessage(tabId, { action: 'ffm_inject_relist_payload', payload: slim, hasStagedMedia: true }, { frameId: 0 }, (r) => {
                                  try {
                                    if (chrome.runtime && chrome.runtime.lastError) {
                                      console.warn('[bg] ffm_inject_relist_payload: could not reach tab', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message);
                                    } else {
                                      console.debug('[bg] ffm_inject_relist_payload message sent to tab (slim)', tabId, r);
                                    }
                                  } catch (e) {}
                                });
                              } catch (e) { console.debug('[bg] ffm_inject_relist_payload send failed', e); }
                              return;
                            }
                          } catch (e) {}
                          // fallback: simple ping
                          try {
                            chrome.tabs.sendMessage(tabId, { action: 'ffm_inject_relist_payload' }, { frameId: 0 }, (r) => {
                              try {
                                if (chrome.runtime && chrome.runtime.lastError) {
                                  console.warn('[bg] ffm_inject_relist_payload: could not reach tab', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message);
                                } else {
                                  console.debug('[bg] ffm_inject_relist_payload message sent to tab', tabId, r);
                                }
                              } catch (e) {}
                            });
                          } catch (e) { console.debug('[bg] ffm_inject_relist_payload send failed', e); }
                        });
                      } catch (e) {
                        // storage read failed: fall back
                        chrome.tabs.sendMessage(tabId, { action: 'ffm_inject_relist_payload' }, { frameId: 0 }, (r) => {
                          try {
                            if (chrome.runtime && chrome.runtime.lastError) {
                              console.warn('[bg] ffm_inject_relist_payload: could not reach tab', tabId, chrome.runtime.lastError && chrome.runtime.lastError.message);
                            } else {
                              console.debug('[bg] ffm_inject_relist_payload message sent to tab', tabId, r);
                            }
                          } catch (e) {}
                        });
                      }
                    } catch (e) { console.debug('[bg] ffm_inject_relist_payload send failed', e); }
                  } catch (e) { console.debug('[bg] publishListingById sendMessage failed', e); }
                }
              };
              chrome.tabs.onUpdated.addListener(onUpdated);
            } catch (e) { console.debug('[bg] publishListingById tab create inner error', e); }
          });
        };
        if (chosen && chosen.id) {
          try { await ensureWindowNotMinimizedByWindow(chosen.id); } catch (e) { }
          openInWindow(chosen.id);
        } else {
          chrome.windows.create({ url: fbUrl, type: 'normal' }, (w) => {
            try {
              const tab = w && w.tabs && w.tabs[0];
                  if (!tab || !tab.id) return;
                  const tabId = tab.id;
                  const onUpdated = (tid, changeInfo) => {
                    if (tid !== tabId) return;
                    if (changeInfo.status === 'complete') {
                      try { sendPopulateMessageToTab(tabId, publishRequestId, { menuAuto: menuAutoHint, menuAutoPersistent: menuAutoHint, autoPublish: !!menuAutoHint, auto: !!menuAutoHint }); } catch (e) { try { chrome.tabs.sendMessage(tabId, { action: 'populate-fb', publishRequestId }); } catch (ee) {} }
                      chrome.tabs.onUpdated.removeListener(onUpdated);
                    }
                  };
              chrome.tabs.onUpdated.addListener(onUpdated);
            } catch (e) { console.debug('publish-listing windows.create inner error', e); }
          });
        }
      } catch (e) { console.debug('publishListingById windows.getAll inner error', e); }
    });
  } catch (e) { console.debug('publishListingById outer error', e); }
  // ------------------------------
  // PUBLISH LOCK: END
  // ------------------------------
  } finally {
    try { publishInFlight.delete(publishRequestId); } catch (e) {}
    try { if (cleanupTimer) clearTimeout(cleanupTimer); } catch (e) {}
    try {
      await chrome.storage.session.remove('ffm_publish_in_progress');
      console.warn('[AutoList Pro bg] 🔓 Publish lock released');
    } catch (e) {
      console.debug('[AutoList Pro bg] publish lock release failed', e);
    }
    // Notify popup (or any listener) that a publish completed so UI can refresh softly
    try {
      // legacy signal (kept for compatibility)
      chrome.runtime.sendMessage({
        action: 'ffm_publish_complete',
        listingId: publishRequestId
      });
      console.log('[AutoList Pro bg] ▶ publish complete → popup refresh requested');
      try {
        // End any active SDnR run now that publish completed. We clear the
        // global active state so subsequent manual/ADS runs can start anew.
        try { globalThis.__ffmActiveSDnR = null; } catch (e) {}
      } catch (e) {}
    } catch (e) {
      console.warn('[AutoList Pro bg] publish-complete message failed', e);
    }

    // Build canonical publish-complete relay and attempt to enrich with staged inventoryName
    try {
      const pubMsg = { action: 'publish-complete', publishRequestId, inventoryName: null };
      try {
        const stagedKey = 'ffm_publish_' + publishRequestId;
        // Read staged payload (if present) and include inventoryName for popup to match cards
        chrome.storage.local.get([stagedKey], (res) => {
          try {
            const staged = res && res[stagedKey];
            if (staged && staged.inventoryName) pubMsg.inventoryName = staged.inventoryName;
            // If no staged payload or it lacks an inventoryName, try the lightweight meta key.
            if ((!pubMsg.inventoryName || pubMsg.inventoryName === null) && staged && !staged.inventoryName) {
              try {
                const metaKey = 'ffm_publish_meta_' + publishRequestId;
                chrome.storage.local.get([metaKey], (mres) => {
                  try {
                    const meta = mres && mres[metaKey];
                    if (meta && meta.inventoryName) pubMsg.inventoryName = meta.inventoryName;
                  } catch (e) {}
                });
              } catch (e) {}
            }
          } catch (e) {}

          try {
            // If we have an inventoryName (from staged payload), mark the saved listing as active
            try {
              const invName = pubMsg.inventoryName || (staged && (staged.inventoryName || staged.title)) || null;
                  if (invName) {
                try {
                  chrome.storage.local.get(['listings','ffmSavedListings','__ffm_saved_listings_cache'], (r) => {
                    try {
                      const storedLists = {
                        listings: Array.isArray(r && r.listings) ? r.listings.slice() : null,
                        ffmSavedListings: Array.isArray(r && r.ffmSavedListings) ? r.ffmSavedListings.slice() : null,
                        __ffm_saved_listings_cache: Array.isArray(r && r.__ffm_saved_listings_cache) ? r.__ffm_saved_listings_cache.slice() : null
                      };
                      const norm = String(invName).toLowerCase().trim();
                      let anyChanged = false;

                      const updateArray = (arr) => {
                        if (!Array.isArray(arr)) return { arr: null, changed: false };
                        let changed = false;
                        for (let i = 0; i < arr.length; i++) {
                          try {
                            const li = arr[i] || {};
                            const cand = String(li.inventoryName || li.title || li.name || li.listingId || li.id || '').toLowerCase().trim();
                            if (cand && cand === norm) {
                              try { li.active = true; } catch (e) {}
                              try { li.isActive = true; } catch (e) {}
                              try { li.ffm_flag_active = true; } catch (e) {}
                              try { li.lastPublishedAt = Date.now(); } catch (e) {}
                              arr[i] = li;
                              changed = true;
                            }
                          } catch (e) {}
                        }
                        return { arr, changed };
                      };

                      const toWrite = {};
                      for (const key of Object.keys(storedLists)) {
                        try {
                          const res = updateArray(storedLists[key]);
                          if (res.changed && Array.isArray(res.arr)) {
                            toWrite[key] = res.arr;
                            anyChanged = true;
                          }
                        } catch (e) {}
                      }

                      if (anyChanged) {
                        try {
                          chrome.storage.local.set(toWrite, () => {
                            try { console.debug('[AutoList Pro bg] Marked listing active after publish (multi-key)', invName, Object.keys(toWrite)); } catch (e) {}
                            try {
                              // Also update any existing ADS rule for this listing so
                              // days-active scheduling uses the authoritative publish time.
                              (async () => {
                                try {
                                  const snap = await new Promise(r => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], r); } catch (e) { r({}); } });
                                  const rulesMap = snap && snap[FFM_ADS_RULES_KEY] ? snap[FFM_ADS_RULES_KEY] : {};
                                  // Find a matching rule by inventoryName or listing id
                                  const normInv = invName ? String(invName).toLowerCase().trim() : null;
                                  let matchedKey = null;
                                  for (const k of Object.keys(rulesMap || {})) {
                                    try {
                                      const r = rulesMap[k] || {};
                                      const cand = String(r.inventoryName || r.listingTitle || r.listingId || k || '').toLowerCase().trim();
                                      if (normInv && cand && cand === normInv) { matchedKey = k; break; }
                                      if (String(k).includes(normInv)) { matchedKey = k; break; }
                                    } catch (e) {}
                                  }
                                  if (matchedKey) {
                                    const now = Date.now();
                                    try {
                                      // Update rule with authoritative publish time and compute next run
                                      const existingRule = Object.assign({}, rulesMap[matchedKey] || {});
                                      existingRule.lastRun = now;
                                      existingRule.activeSinceMs = now;
                                      // Ensure helper sync field matches configured daysActive
                                      try { existingRule._ffm_daysActive = existingRule.daysActive; } catch (e) {}
                                      // Compute next run using scheduler helper (prefer lastRun as base)
                                      try {
                                        const nextWhen = (typeof ffmAdsComputeNextRunForRule === 'function') ? ffmAdsComputeNextRunForRule(existingRule, now) : null;
                                        if (nextWhen) existingRule.nextRunAt = nextWhen;
                                      } catch (e) {}
                                      rulesMap[matchedKey] = existingRule;
                                      // Persist updated rule and ensure its alarm
                                      try {
                                        chrome.storage.local.set({ [FFM_ADS_RULES_KEY]: rulesMap }, async () => {
                                          try { console.debug('[FFM Scheduler] Updated ADS rule after publish for', matchedKey); } catch (e) {}
                                          try { chrome.runtime.sendMessage({ action: 'ffm_scheduler_refresh' }); } catch (e) {}
                                          try {
                                            if (typeof ffmAdsEnsureAlarmForRule === 'function') {
                                              try { await ffmAdsEnsureAlarmForRule(existingRule, 'post-publish'); } catch (e) { try { await ffmAdsRebuildAllAlarms('post-publish-ensure-fallback'); } catch(_){} }
                                            } else {
                                              // Fallback: create alarm directly
                                              try {
                                                const alarmName = ffmAdsAlarmNameFor(matchedKey);
                                                const when = existingRule.nextRunAt ? Number(existingRule.nextRunAt) : null;
                                                if (when) chrome.alarms.create(alarmName, { when, periodInMinutes: 1440 });
                                              } catch (e) {}
                                            }
                                          } catch (e) {}
                                        });
                                      } catch (e) {}
                                    } catch (e) {}
                                  }
                                } catch (e) {}
                              })();
                            } catch (e) {}
                          });
                        } catch (e) {}
                      } else {
                        try { console.debug('[AutoList Pro bg] publish-complete: no saved listing matched inventoryName', invName); } catch (e) {}
                      }
                    } catch (e) {}
                  });
                } catch (e) {}
              }
            } catch (e) {}

            chrome.runtime.sendMessage(pubMsg);
            console.log('[AutoList Pro bg] Sent publish-complete to popup', publishRequestId);
          } catch (e) {
            console.warn('[AutoList Pro bg] Failed to send publish-complete', e);
          }

          // Force popup soft refresh (forward compatibility)
          try { chrome.runtime.sendMessage({ action: 'ffm_refresh_popup' }); } catch (e) {}
          // Persist a lightweight trace snapshot for post-mortem debugging
          try {
            try { ffmTraceEvent && ffmTraceEvent('publish-complete-dispatch', { publishRequestId: publishRequestId || null }); } catch (e) {}
            try { if (globalThis && globalThis.__ffmTrace && chrome && chrome.storage && chrome.storage.local) chrome.storage.local.set({ ffm_trace_snapshot: globalThis.__ffmTrace, ffm_last_focus_skip: globalThis.__ffmTrace.lastFocusSkip || null }, () => {}); } catch (e) {}
            try { appendPublishTrace && appendPublishTrace(publishRequestId, { event: 'bg-publish-dispatch-snapshot' }); } catch (e) {}
          } catch (e) {}
        });
      } catch (e) { console.warn('[AutoList Pro bg] publish-complete relay enrichment failed', e); }
    } catch (e) { console.warn('[AutoList Pro bg] publish-complete dispatch error', e); }
  }
}

try {
  // Helper to execute a scheduled task (hoisted so startup scan can call it regardless of alarms API availability)
  __ffm_executeScheduledTask_impl = async function(task) {
    try {
      if (!task || !task.action) return false;
      try { console.debug('[bg] executeScheduledTask', { id: task.id, action: task.action, inventoryName: task.inventoryName, timeISO: task.timeISO, now: Date.now() }); } catch (e) {}
      // Block Active Sync/AAS while a scheduled task (SDnR/SP/UI-DnR) is executing
      try {
        try { window.__ffm_block_as = true; } catch (e) { try { globalThis.__ffm_block_as = true; } catch (e) {} }
      } catch (e) {}
      if (task.action === 'publish') {
        try {
          // Quickly attempt to have the popup execute the full saved-listing publish flow
          // so it can reuse the existing pipeline (images, s3 keys, description, price, etc.).
          try { console.log('[bg] executing scheduled PUBLISH for', task.listingTitle || task.inventoryName); } catch (e) {}
          try {
            // Create a short-lived storage-based ack handshake so MV3 message-port races
            // won't silently drop scheduled publishes. Background writes a request token
            // and the popup should write back an ack key when it starts handling the publish.
            try {
              const ackToken = String(task.id) + ':' + Math.random().toString(36).slice(2) + Date.now().toString(36);
              const reqKey = 'ffm_schedule_ack_req_' + task.id;
              const ackKey = 'ffm_schedule_ack_ack_' + task.id;
              try { chrome.storage.local.set({ [reqKey]: { token: ackToken, ts: Date.now() } }); } catch (e) {}

              // Fire the popup request with task id + token
              try {
                // Honor runtime guard: if popup-based scheduled executes are disabled
                // and this task is a scheduler-origin task, skip sending the popup message.
                const disablePopupExec = (typeof globalThis !== 'undefined' && !!globalThis.__FFM_DISABLE_POPUP_SCHEDULED_EXEC);
                if (disablePopupExec && task && task.fromScheduler) {
                  try { console.debug('[bg] popup scheduled execute disabled; skipping ffm_run_popup_publish for task', task.id); } catch (e) {}
                } else {
                  chrome.runtime.sendMessage({
                    type: 'ffm_run_popup_publish',
                    title: task.listingTitle || task.inventoryName,
                    scheduleTaskId: task.id,
                    ackToken,
                    task // include task so popup can detect scheduler-origin
                  });
                  try { console.log('[bg] sent ffm_run_popup_publish message for', task.listingTitle || task.inventoryName); } catch (e) {}
                }
              } catch (e) {
                try { console.error('[bg] failed to trigger popup publish', e); } catch (er) {}
              }

              // Wait (up to a short timeout) for the popup ack so we don't race and double-run
              // the publish flow. Use a Promise-based poll so we actually await the result.
              const maxWait = 4000;
              const interval = 250;
              const acknowledged = await new Promise((resolve) => {
                let tries = 0;
                const maxTries = Math.max(1, Math.ceil(maxWait / interval));
                const check = () => {
                  try {
                    chrome.storage.local.get([ackKey], (res) => {
                      try {
                        tries++;
                        if (res && res[ackKey] && res[ackKey] === ackToken) {
                          // clean up keys and resolve
                          try { chrome.storage.local.remove([reqKey, ackKey]); } catch (e) {}
                          try { console.debug('[bg] schedule publish: popup ack received', { taskId: task.id }); } catch (e) {}
                          resolve(true);
                          return;
                        }
                        if (tries < maxTries) return setTimeout(check, interval);
                        try { console.debug('[bg] schedule publish: popup ack timed out', { taskId: task.id }); } catch (e) {}
                        resolve(false);
                      } catch (e) { resolve(false); }
                    });
                  } catch (e) { resolve(false); }
                };
                check();
              });

              // If popup acknowledged and claimed the task, stop — popup will handle the publish.
              if (acknowledged) {
                return;
              }

              // If no ack arrived, check whether the popup set a persistent inflight marker
              // using the task id (to claim the scheduled task). If present, assume popup
              // is handling and skip background publish to avoid double work.
              try {
                const taskInflKey = 'ffm_publish_inflight_' + task.id;
                const snap = await new Promise(r => chrome.storage.local.get([taskInflKey], r));
                const inflVal = snap && snap[taskInflKey];
                if (inflVal && (Date.now() - (inflVal.ts || 0) < 60000)) {
                  try { console.debug('[bg] scheduled task already claimed (task-level inflight) — skipping background publish', { taskId: task.id }); } catch (e) {}
                  return;
                }
              } catch (e) { /* ignore and continue to attempt background publish */ }
            } catch (e) { console.debug('[bg] schedule ack handshake failed', e); }

            return;
          } catch (e) {
            try { console.error('[bg] failed to trigger popup publish', e); } catch (er) {}
          }

          // If popup relay didn't succeed synchronously, continue with existing background publish logic.
          try { console.debug('[bg] executeScheduledTask: publish: checking pre-staged payload', { publishRequestId: task.publishRequestId, inventoryName: task.inventoryName }); } catch (e) {}
          if (task.publishRequestId) {
            const preKey = 'ffm_publish_' + task.publishRequestId;
            try {
              chrome.storage.local.get([preKey], (preRes) => {
                try {
                    if (preRes && Object.prototype.hasOwnProperty.call(preRes, preKey) && preRes[preKey]) {
                    try { console.debug('[bg] executeScheduledTask: using pre-staged publish payload', { publishRequestId: task.publishRequestId }); } catch (e) {}
                    try {
                      const forceKey = 'ffm_force_auto_publish_' + task.publishRequestId;
                      const allowForce = (typeof globalThis !== 'undefined' && !!globalThis.__FFM_SCHEDULED_FORCE_AUTOPUBLISH);
                      if (!task.fromScheduler || allowForce) {
                        chrome.storage.local.set({ [forceKey]: true }, () => { try { console.debug('[bg] force-auto flag set (pre-staged)', { key: forceKey, publishRequestId: task.publishRequestId }); } catch(e){} });
                      } else {
                        try { console.debug('[bg] skipping force-auto flag for scheduler-origin pre-staged publish', { publishRequestId: task.publishRequestId }); } catch(e){}
                      }
                    } catch (e) {}
                    try {
                      // Notify popup to pre-clear timestamp for this listing before publish starts
                      try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: task.inventoryName || null, publishRequestId: task.publishRequestId || null }); } catch (e) {}
                      (async () => {
                        try {
                          const res = await publishListingById(task.publishRequestId);
                          try {
                            if (res && (res.reason === 'inflight-persistent' || res.reason === 'inflight-memory')) {
                              const ackKey = 'ffm_schedule_ack_ack_' + task.id;
                              const snap = await new Promise(r => chrome.storage.local.get([ackKey], r));
                              const ackVal = snap && snap[ackKey];
                              if (!ackVal) {
                                try { console.debug('[bg] publish blocked by inflight; no popup ack — clearing persistent inflight and retrying', { publishRequestId: task.publishRequestId }); } catch(e){}
                                const inflKey = 'ffm_publish_inflight_' + task.publishRequestId;
                                try { await new Promise(r => chrome.storage.local.remove([inflKey], r)); } catch (e) {}
                                try { await publishListingById(task.publishRequestId); } catch (e) { console.debug('publishListingById retry error', e); }
                              }
                            }
                          } catch(e) {}
                        } catch (e) { console.debug('publishListingById error', e); }
                      })();
                    } catch (e) { console.debug('publishListingById error', e); }
                    return;
                  }
                } catch (e) {}
                // Pre-staged payload missing or empty — fallthrough to attempt lookup by inventoryName
                try { console.debug('[bg] executeScheduledTask: pre-staged payload not found; falling back to listings lookup', { inventoryName: task.inventoryName }); } catch (e) {}
                // Continue to lookup listings by inventoryName below
                try {
                  chrome.storage.local.get({ listings: [] }, (lstRes) => {
                    try {
                      const listings = lstRes.listings || [];
                      try { console.debug('[bg] executeScheduledTask: listings length', { count: listings.length }); } catch (e) {}
                      const listing = listings.find(l => l && l.inventoryName === task.inventoryName);
                      if (!listing) {
                        try { console.debug('[bg] executeScheduledTask: listing not found', { inventoryName: task.inventoryName }); } catch (e) {}
                        return;
                      }
                      try { console.debug('[bg] executeScheduledTask: listing found', { inventoryName: listing.inventoryName }); } catch (e) {}
                      const publishRequestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
                      try {
                        const stagedKey = 'ffm_publish_' + publishRequestId;
                        chrome.storage.local.set({ [stagedKey]: listing }, () => {
                          try { console.debug('[bg] staged publish (from scheduled task)', { publishRequestId, listingExists: !!listing }); } catch(e){}
                          // Mark a one-off force-auto flag so sendPopulateMessageToTab will allow auto-publish for this id
                          try {
                            const forceKey = 'ffm_force_auto_publish_' + publishRequestId;
                            const allowForce = (typeof globalThis !== 'undefined' && !!globalThis.__FFM_SCHEDULED_FORCE_AUTOPUBLISH);
                            if (!task.fromScheduler || allowForce) {
                              chrome.storage.local.set({ [forceKey]: true }, () => { try { console.debug('[bg] force-auto flag set', { key: forceKey, publishRequestId }); } catch(e){} });
                            } else {
                              try { console.debug('[bg] skipping force-auto flag for scheduler-origin staged publish', { publishRequestId }); } catch(e){}
                            }
                          } catch (e) {}
                          // If the popup previously claimed the scheduled task (task-level inflight),
                          // transfer that claim to the publishRequestId so publishListingById sees it
                          // and avoids double-running the publish.
                          try {
                            const taskInflKey = 'ffm_publish_inflight_' + task.id;
                            try {
                              chrome.storage.local.get([taskInflKey], (snap) => {
                                try {
                                  const val = snap && snap[taskInflKey];
                                  if (val && (Date.now() - (val.ts || 0) < 60000)) {
                                    const inflKeyForPublish = 'ffm_publish_inflight_' + publishRequestId;
                                    chrome.storage.local.set({ [inflKeyForPublish]: { ts: Date.now(), token: val.token || val } }, () => {
                                      try { console.debug('[bg] transferred task-level inflight to publishRequestId', { taskId: task.id, publishRequestId }); } catch (e) {}
                                    });
                                  }
                                } catch (e) {}
                              });
                            } catch (e) {}
                          } catch (e) {}
                          // Read-back verification: ensure storage actually contains the key before sending
                          const maxAttempts = 6; let tries = 0; const delayMs = 300;
                          const verifyAndSend = () => {
                            try {
                              chrome.storage.local.get([stagedKey], (chk) => {
                                try {
                                  if (chk && Object.prototype.hasOwnProperty.call(chk, stagedKey) && chk[stagedKey]) {
                                      try {
                                        // Notify popup to pre-clear timestamp for this listing before publish starts
                                        try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: listing && listing.inventoryName ? listing.inventoryName : null, publishRequestId }); } catch (e) {}
                                        (async () => {
                                          try {
                                            const res = await publishListingById(publishRequestId);
                                            try {
                                              if (res && (res.reason === 'inflight-persistent' || res.reason === 'inflight-memory')) {
                                                const ackKey = 'ffm_schedule_ack_ack_' + task.id;
                                                const snap = await new Promise(r => chrome.storage.local.get([ackKey], r));
                                                const ackVal = snap && snap[ackKey];
                                                if (!ackVal) {
                                                  try { console.debug('[bg] publish blocked by inflight; no popup ack — clearing persistent inflight and retrying', { publishRequestId }); } catch(e){}
                                                  const inflKey = 'ffm_publish_inflight_' + publishRequestId;
                                                  try { await new Promise(r => chrome.storage.local.remove([inflKey], r)); } catch (e) {}
                                                  try { await publishListingById(publishRequestId); } catch (e) { console.debug('publishListingById retry error', e); }
                                                }
                                              }
                                            } catch(e) {}
                                          } catch (e) { console.debug('publishListingById error', e); }
                                        })();
                                      } catch (e) { console.debug('publishListingById error', e); }
                                      return;
                                    }
                                  tries++;
                                  if (tries < maxAttempts) return setTimeout(verifyAndSend, delayMs);
                                  // fallback: call publish anyway
                                  (async () => {
                                    try {
                                      const res = await publishListingById(publishRequestId);
                                      try {
                                        if (res && (res.reason === 'inflight-persistent' || res.reason === 'inflight-memory')) {
                                          const ackKey = 'ffm_schedule_ack_ack_' + task.id;
                                          const snap = await new Promise(r => chrome.storage.local.get([ackKey], r));
                                          const ackVal = snap && snap[ackKey];
                                          if (!ackVal) {
                                            try { console.debug('[bg] publish blocked by inflight; no popup ack — clearing persistent inflight and retrying', { publishRequestId }); } catch(e){}
                                            const inflKey = 'ffm_publish_inflight_' + publishRequestId;
                                            try { await new Promise(r => chrome.storage.local.remove([inflKey], r)); } catch (e) {}
                                            try { await publishListingById(publishRequestId); } catch (e) { console.debug('publishListingById retry error', e); }
                                          }
                                        }
                                      } catch(e) {}
                                    } catch (e) { console.debug('publishListingById error', e); }
                                  })();
                                } catch (e) { console.debug('staged publish read-back callback error', e); }
                              });
                            } catch (e) { console.debug('staged publish read-back error', e); }
                          };
                          verifyAndSend();
                        });
                      } catch (e) { console.debug('schedule publish staging failed', e); }
                    } catch (e) { console.debug('schedule publish get listings error', e); }
                  });
                } catch (e) { console.debug('schedule publish listings lookup failed', e); }
              });
            } catch (e) { console.debug('pre-staged payload check failed', e); }
            return;
          }

          // No pre-staged payload referenced by the task: lookup the listing by inventoryName and stage it
          try { console.debug('[bg] executeScheduledTask: loading listings for', { inventoryName: task.inventoryName }); } catch (e) {}
          chrome.storage.local.get({ listings: [] }, (lstRes) => {
            try {
              const listings = lstRes.listings || [];
              try { console.debug('[bg] executeScheduledTask: listings length', { count: listings.length }); } catch (e) {}
              const listing = listings.find(l => l && l.inventoryName === task.inventoryName);
              if (!listing) {
                try { console.debug('[bg] executeScheduledTask: listing not found', { inventoryName: task.inventoryName }); } catch (e) {}
                return;
              }
              try { console.debug('[bg] executeScheduledTask: listing found', { inventoryName: listing.inventoryName }); } catch (e) {}
              const publishRequestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
              try {
                const stagedKey = 'ffm_publish_' + publishRequestId;
                chrome.storage.local.set({ [stagedKey]: listing }, () => {
                  try { console.debug('[bg] staged publish (from scheduled task)', { publishRequestId, listingExists: !!listing }); } catch(e){}
                  try {
                    const forceKey = 'ffm_force_auto_publish_' + publishRequestId;
                    const allowForce = (typeof globalThis !== 'undefined' && !!globalThis.__FFM_SCHEDULED_FORCE_AUTOPUBLISH);
                    if (!task.fromScheduler || allowForce) {
                      chrome.storage.local.set({ [forceKey]: true }, () => { try { console.debug('[bg] force-auto flag set', { key: forceKey, publishRequestId }); } catch(e){} });
                    } else {
                      try { console.debug('[bg] skipping force-auto flag for scheduler-origin staged publish', { publishRequestId }); } catch(e){}
                    }
                  } catch (e) {}
                  // Transfer any task-level inflight claim (if popup claimed the task) to the publish id.
                  try {
                    const taskInflKey = 'ffm_publish_inflight_' + task.id;
                    try {
                      chrome.storage.local.get([taskInflKey], (snap) => {
                        try {
                          const val = snap && snap[taskInflKey];
                          if (val && (Date.now() - (val.ts || 0) < 60000)) {
                            const inflKeyForPublish = 'ffm_publish_inflight_' + publishRequestId;
                            chrome.storage.local.set({ [inflKeyForPublish]: { ts: Date.now(), token: val.token || val } }, () => {
                              try { console.debug('[bg] transferred task-level inflight to publishRequestId', { taskId: task.id, publishRequestId }); } catch (e) {}
                            });
                          }
                        } catch(e){}
                      });
                    } catch(e){}
                  } catch(e){}
                  // Read-back verification before sending
                  const maxAttempts = 6; let tries = 0; const delayMs = 300;
                  const verifyAndSend = () => {
                    try {
                      chrome.storage.local.get([stagedKey], (chk) => {
                        try {
                          if (chk && Object.prototype.hasOwnProperty.call(chk, stagedKey) && chk[stagedKey]) {
                            try {
                              // Notify popup to pre-clear timestamp for this listing before publish starts
                              try { chrome.runtime.sendMessage({ action: 'pre-publish', inventoryName: listing && listing.inventoryName ? listing.inventoryName : null, publishRequestId }); } catch (e) {}
                              publishListingById(publishRequestId);
                            } catch (e) { console.debug('publishListingById error', e); }
                            return;
                          }
                          tries++;
                          if (tries < maxAttempts) return setTimeout(verifyAndSend, delayMs);
                          // fallback: call publish anyway
                          (async () => {
                            try {
                              const res = await publishListingById(publishRequestId);
                              try {
                                if (res && (res.reason === 'inflight-persistent' || res.reason === 'inflight-memory')) {
                                  const ackKey = 'ffm_schedule_ack_ack_' + task.id;
                                  const snap = await new Promise(r => chrome.storage.local.get([ackKey], r));
                                  const ackVal = snap && snap[ackKey];
                                  if (!ackVal) {
                                    try { console.debug('[bg] publish blocked by inflight; no popup ack — clearing persistent inflight and retrying', { publishRequestId }); } catch(e){}
                                    const inflKey = 'ffm_publish_inflight_' + publishRequestId;
                                    try { await new Promise(r => chrome.storage.local.remove([inflKey], r)); } catch (e) {}
                                    try { await publishListingById(publishRequestId); } catch (e) { console.debug('publishListingById retry error', e); }
                                  }
                                }
                              } catch(e) {}
                            } catch (e) { console.debug('publishListingById error', e); }
                          })();
                        } catch (e) { console.debug('staged publish read-back callback error', e); }
                      });
                    } catch (e) { console.debug('staged publish read-back error', e); }
                  };
                  verifyAndSend();
                });
              } catch (e) { console.debug('schedule publish staging failed', e); }
            } catch (e) { console.debug('schedule publish get listings error', e); }
          });
        } catch (e) { console.debug('schedule publish failed', e); }
      } else if (task.action === 'relist') {
        try {
          // Delegate to the canonical scheduled DnR executor to avoid duplicate flows
          try { await ffmRunScheduledDnR(task); } catch (e) { console.debug('[bg:SDNR] delegated ffmRunScheduledDnR failed', e); }
        } catch (e) { console.debug('relist branch error', e); }
      }
      return true;
    } catch (e) { console.debug('executeScheduledTask error', e); return false; }
  }
  if (chrome && chrome.alarms && chrome.alarms.onAlarm) {

  

    chrome.alarms.onAlarm.addListener(async (alarm) => {
      try {
        try { console.debug('[bg] onAlarm fired', { name: alarm && alarm.name, scheduledTime: alarm && alarm.scheduledTime, now: Date.now() }); } catch (e) {}

          // --------------------
          // ADS PREWARM: handle pre-warm alarm (fires shortly before ADS run)
          // --------------------
          try {
            if (alarm && alarm.name && alarm.name.startsWith(FFM_ADS_PREWARM_PREFIX)) {
              const listingId = alarm.name.replace(FFM_ADS_PREWARM_PREFIX, "");
              try { console.log('[ADS PREWARM] Starting pre-warm for', listingId); } catch (e) {}
              try { ffmTraceEvent('prewarm-fired', { listingId: listingId }); } catch (e) {}

              // 1) Restore canonical listings if needed
              try {
                if (!globalThis.ffmCanonicalListings || Object.keys(globalThis.ffmCanonicalListings || {}).length === 0) {
                  try {
                    const stored = await new Promise((res) => { try { chrome.storage.local.get('ffmCanonicalListings', res); } catch (err) { res({}); } });
                    globalThis.ffmCanonicalListings = (stored && stored.ffmCanonicalListings) ? stored.ffmCanonicalListings : {};
                    try { console.log('[ADS PREWARM] Canonical listings restored', Object.keys(globalThis.ffmCanonicalListings || {}).length); } catch (e) {}
                  } catch (e) {}
                }
              } catch (e) {}

              // 1.5) Alarm sanity check: ensure the actual fire alarm still exists
              try {
                try {
                  const alarms = await new Promise((r) => { try { chrome.alarms.getAll(r); } catch (err) { r([]); } });
                  const hasFireAlarm = Array.isArray(alarms) && alarms.some(a => a && a.name === ffmAdsAlarmNameFor(listingId));
                  if (!hasFireAlarm) {
                    try { console.warn('[ADS PREWARM] Fire alarm missing — rebuilding'); } catch (e) {}
                    try { await ffmAdsRebuildAllAlarms('prewarm-repair'); } catch (e) { try { console.warn('[ADS PREWARM] rebuild failed', e); } catch (_) {} }
                  }
                } catch (e) {}
              } catch (e) {}

              // 2) Touch IndexedDB to force open
              try { indexedDB.open('AutoListProMediaDB'); } catch (e) {}

              // 3) Set warm flag for telemetry and short-lived warm state
              try { globalThis.ffmAdsWarm = true; } catch (e) {}
              try { setTimeout(() => { try { globalThis.ffmAdsWarm = false; } catch (e) {} }, 90_000); } catch (e) {}

              try { console.log('[ADS PREWARM] Ready for scheduled fire', listingId); } catch (e) {}
              return;
            }
          } catch (e) {}

        // ###############################
        // 🔥 NEW: detect DnR→SDNR alarms (alarm names like dnr_<ts>)
        // ###############################
        try {
          if (alarm && alarm.name && alarm.name.startsWith('dnr_')) {
            try {
              if (FAST4MP_DEBUG) try { console.debug('[DNR→SDNR] Alarm fired:', alarm); } catch (e) {}
              const store = await chrome.storage.local.get('ffm_scheduled_tasks');
              const map = (store && store.ffm_scheduled_tasks) ? store.ffm_scheduled_tasks : {};
              // map may be an object keyed by alarmName, or an array-like structure
              let task = map[alarm.name];
              // If not directly present, try scanning values for an element with matching id
              if (!task) {
                try {
                  const vals = Array.isArray(map) ? map : Object.values(map || {});
                  for (const v of vals || []) {
                    try {
                      if (v && (v.id === alarm.name || String(v.id) === String(alarm.name))) { task = v; break; }
                    } catch (e) {}
                  }
                } catch (e) { if (FAST4MP_DEBUG) console.debug('[DNR→SDNR] scanning ffm_scheduled_tasks failed', e); }
              }
              if (!task) {
                // Fallback #1: check the internal compatibility map key
                try {
                  const alt = await chrome.storage.local.get(['__ffm_scheduled_tasks_map', 'scheduled_tasks']);
                  const altMap = alt && alt.__ffm_scheduled_tasks_map ? alt.__ffm_scheduled_tasks_map : null;
                  if (altMap && altMap[alarm.name]) {
                    task = altMap[alarm.name];
                  } else {
                    // Fallback #2: scan scheduled_tasks array for an entry with matching id
                    const arr = alt && alt.scheduled_tasks ? alt.scheduled_tasks : [];
                    const found = (arr || []).find(t => t && String(t.id) === String(alarm.name));
                    if (found) {
                      task = found;
                    }
                  }
                } catch (e) { if (FAST4MP_DEBUG) console.debug('[DNR→SDNR] fallback storage lookup failed', e); }

                if (!task) {
                  if (FAST4MP_DEBUG) try { console.warn('[DNR→SDNR] No task record found for', alarm.name); } catch (e) {}
                  return;
                }
              }
              console.log('[DNR→SDNR] Using task:', task);

              // Execute via existing scheduled-task executor so behavior is consistent
              try {
                if (typeof executeScheduledTask === 'function') {
                  await executeScheduledTask(task);
                } else {
                  // Fallback: attempt to call any SDNR-specific helper
                  try { if (typeof ffmRunSDNRFlow === 'function') await ffmRunSDNRFlow(task.listingId, task.inventoryName, task.listingTitle); } catch (e) {}
                }
              } catch (e) { console.debug('[DNR→SDNR] executeScheduledTask threw', e); }

              // Remove task from map to avoid duplicates
              try {
                delete map[alarm.name];
                // Also persist into the internal scheduler map key for the scheduler subsystem
                try { await chrome.storage.local.set({ ffm_scheduled_tasks: map, '__ffm_scheduled_tasks_map': map }); } catch (e) { try { await chrome.storage.local.set({ ffm_scheduled_tasks: map }); } catch (_) {} }
              } catch (e) { console.debug('[DNR→SDNR] failed to remove task record', e); }

              return;
            } catch (e) { console.debug('[DNR→SDNR] handler error', e); }
          }
        } catch (e) { /* continue to other alarm handlers */ }

        if (!alarm || !alarm.name || !alarm.name.startsWith('ffm_schedule_')) return;
        const taskId = alarm.name.slice('ffm_schedule_'.length);
        // Persist a small marker so we can reliably see that the alarm fired even if SW logs
        try { chrome.storage.local.set({ ['ffm_last_alarm_' + taskId]: Date.now() }); } catch (e) { try { console.debug('ffm last alarm write failed', e); } catch (er) {} }
        // Read scheduled_tasks and find the task (robust id string comparison)
        chrome.storage.local.get({ scheduled_tasks: [] }, async (res) => {
          try {
            const tasks = res.scheduled_tasks || [];
            const ix = tasks.findIndex(t => t && String(t.id) === String(taskId));
            if (ix < 0) return;
            const task = tasks[ix];

            // Only queued tasks are eligible here
            if (!task || (task.state && task.state !== 'queued')) return;

            const now = ffmNow();

            // If this alarm fired too late, mark as MISSED and do NOT run it
            if (typeof task.when === 'number' && now > (Number(task.when) + FFM_MISSED_GRACE_MS)) {
              try {
                tasks[ix] = Object.assign({}, tasks[ix], { state: 'missed', missedAt: now });
                await ffmSetScheduledTasks(tasks);
                const missedRec = [{ id: task.id, listingId: task.listingId, action: task.action, when: task.when }];
                try { await new Promise((resolve) => chrome.storage.local.set({ [FFM_MISSED_TASKS_KEY]: missedRec }, resolve)); } catch (e) {}
                try { chrome.action?.setBadgeText({ text: '!' }); chrome.action?.setBadgeBackgroundColor({ color: '#d93025' }); } catch (e) {}
                try {
                  const nowTs = ffmNow();
                  // Push a notification similar to ADS missed-run notifications
                  try { await ffmNotifyAppend({
                    id: ffmNotifyGenerateId(),
                    type: 'scheduled-missed',
                    level: 'warning',
                    createdAt: nowTs,
                    taskId: task.id,
                    title: `Missed scheduled task — ${task.inventoryName || task.listingTitle || task.id}`,
                    message: `A scheduled task for ${task.inventoryName || task.listingTitle || task.id} scheduled at ${new Date(Number(task.when)).toLocaleString()} was missed because the alarm fired after the grace period.`,
                    read: false
                  }); } catch (e) {}
                } catch (e) {}
                console.warn('[SCHED] Missed scheduled task marked missed:', taskId);
                return; // Do not auto-run missed tasks
              } catch (e) { console.debug('[SCHED] failed to mark missed task', e); return; }
            }

            // On-time → execute as before
            try {
              const result = await (typeof executeScheduledTask === 'function' ? executeScheduledTask(task) : Promise.resolve(null));
              try {
                // Default behavior: keep the scheduled task unless the executor explicitly
                // indicates it should be removed (result.keep === false).
                const explicitRemove = (result && result.keep === false);
                if (explicitRemove) {
                  const newTasks = tasks.filter((t, i) => i !== ix);
                  chrome.storage.local.set({ scheduled_tasks: newTasks }, () => {
                    try { chrome.runtime.sendMessage({ action: 'ffm-scheduled-tasks-updated' }); console.log('[AutoList Pro schedule] pushed ffm-scheduled-tasks-updated (removed)'); } catch (e) { console.warn('[AutoList Pro schedule] notify popup failed (removed)', e); }
                  });
                } else {
                  try {
                    // If executor provided task updates, apply them; otherwise leave the task as-is.
                    if (result && result.taskUpdates) {
                      const updated = tasks.slice();
                      updated[ix] = Object.assign({}, updated[ix], result.taskUpdates || {});
                      chrome.storage.local.set({ scheduled_tasks: updated }, () => {
                        try { chrome.runtime.sendMessage({ action: 'ffm-scheduled-tasks-updated' }); console.log('[AutoList Pro schedule] pushed ffm-scheduled-tasks-updated (updated)'); } catch (e) { console.warn('[AutoList Pro schedule] notify popup failed (updated)', e); }
                      });
                    }
                  } catch (e) {}
                }
              } catch (e) { console.debug('schedule cleanup/update failed', e); }
            } catch (e) {
              console.debug('executeScheduledTask threw', e);
              try {
                if (task && task.publishRequestId) {
                  try { console.debug('[bg] onAlarm: fallback publish attempt', { taskId: task.id, publishRequestId: task.publishRequestId }); } catch (ee) {}
                  try { chrome.runtime.sendMessage({ action: 'publish-listing', publishRequestId: task.publishRequestId, autoPublish: true, menuAuto: true, publishSource: 'scheduled' }, () => { try { chrome.runtime.lastError; } catch(_){} }); } catch (ee) { console.debug('fallback publish message failed', ee); }
                }
              } catch (ee) { console.debug('onAlarm fallback publish outer failed', ee); }
            }
          } catch (e) { console.debug('alarm processing inner error', e); }
        });
      } catch (e) { console.debug('alarm handler error', e); }
    });
  }
} catch (e) { console.debug('alarms.onAlarm install failed', e); }

// Additional alarm handler: cleanup stale staged publish payloads
try {
  if (chrome && chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      try {
        if (!alarm || !alarm.name) return;
        if (!alarm.name.startsWith('ffm_publish_cleanup_')) return;
        const id = alarm.name.slice('ffm_publish_cleanup_'.length);
        const stagedKey = 'ffm_publish_' + id;
        const inflKey = 'ffm_publish_inflight_' + id;
        try {
          chrome.storage.local.get([stagedKey, inflKey], (res) => {
            try {
              const present = res && res[stagedKey];
              if (present) {
                chrome.storage.local.remove([stagedKey], () => {
                  try { appendPublishTrace(id, 'cleanup-removed-staged'); } catch (e) {}
                });
              }
              // Also remove any lingering persistent inflight marker
              chrome.storage.local.remove([inflKey], () => {
                try { appendPublishTrace(id, 'cleanup-removed-inflight'); } catch (e) {}
              });
            } catch (e) { console.debug('publish cleanup storage get callback error', e); }
          });
        } catch (e) { console.debug('publish cleanup error', e); }
      } catch (e) {}
    });
    // Lightweight runtime setter: popup may notify background when it fails to set session storage.
    try {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
          if (msg && msg.type === 'ffm_set_clfp_active') {
            try {
              globalThis.__ffm_clfp_active = !!msg.active;
              try { console.debug && console.debug('[AutoList Pro bg] CLFP fallback flag set =', !!msg.active); } catch(e) {}
            } catch(e){}
            try { sendResponse && sendResponse({ ok: true }); } catch(e){}
            return true;
          }
        } catch (e) {}
      });
    } catch (e) {}
  }
} catch (e) { console.debug('publish cleanup alarm install failed', e); }

// On startup, scan for any scheduled tasks that are due (in case an alarm was missed)
try {
  (async () => {
    try {
      chrome.storage.local.get({ scheduled_tasks: [] }, async (res) => {
        const tasks = res.scheduled_tasks || [];
        const now = Date.now();

        for (const t of tasks) {
          try {
            if (t && t.state && t.state !== 'queued') continue; // already handled (missed/done/cancelled) — don't re-notify on every restart
            const when = (typeof t.when === 'number' && !isNaN(t.when))
              ? t.when
              : (t.timeISO ? new Date(t.timeISO).getTime() : NaN);
            if (!when || isNaN(when)) continue;

            if (typeof when === 'number' && now > (when + FFM_MISSED_GRACE_MS)) {
              // Missed while SW was asleep beyond grace period — mark missed and do NOT auto-run
              try {
                try {
                  const updated = (tasks || []).map(x => (x && String(x.id) === String(t.id)) ? Object.assign({}, x, { state: 'missed', missedAt: now }) : x);
                  await new Promise((res) => chrome.storage.local.set({ scheduled_tasks: updated }, res));
                } catch (e) {}
                const missedRec = [{ id: t.id, listingId: t.listingId, action: t.action, when: t.when }];
                try { await new Promise((resolve) => chrome.storage.local.set({ [FFM_MISSED_TASKS_KEY]: missedRec }, resolve)); } catch (e) {}
                try { chrome.action?.setBadgeText({ text: '!' }); chrome.action?.setBadgeBackgroundColor({ color: '#d93025' }); } catch (e) {}
                try {
                  const nowTs = Date.now();
                  try { await ffmNotifyAppend({
                    id: ffmNotifyGenerateId(),
                    type: 'scheduled-missed',
                    level: 'warning',
                    createdAt: nowTs,
                    taskId: t.id,
                    title: `Missed scheduled task — ${t.inventoryName || t.listingTitle || t.id}`,
                    message: `A scheduled task for ${t.inventoryName || t.listingTitle || t.id} scheduled at ${new Date(Number(t.when)).toLocaleString()} was missed while the extension was inactive.`,
                    read: false
                  }); } catch (e) {}
                } catch (e) {}
                try { console.warn('[SCHED] Startup: marked missed scheduled task', t.id); } catch (e) {}
              } catch (e) { console.debug('startup mark-missed failed', e); }
            } else {
              // Recreate the alarm so it will fire later
              const alarmName = 'ffm_schedule_' + t.id;
              try { chrome.alarms.create(alarmName, { when }); try { chrome.alarms.getAll((all)=>{ try{ console.debug('[bg:ALARM] active after startup recreate →', (all||[]).map(a=>a && a.name)); }catch(e){} }); }catch(e){} } catch (e) {}
            }
          } catch (e) { console.debug('startup scan loop error', e); }
        }
      });
    } catch (e) { console.debug('startup scheduled tasks scan failed', e); }
  })();
} catch (e) { console.debug('startup due tasks installer failed', e); }

// --- Debug: dump active alarms on startup/activate for verification ---
try {
  const dumpAlarms = async () => {
    try {
      if (chrome && chrome.alarms && typeof chrome.alarms.getAll === 'function') {
        chrome.alarms.getAll((all) => {
          try { console.debug('[bg] active alarms', (all || []).map(a => ({ name: a && a.name, when: a && a.scheduledTime }))); } catch (e) {}
        });
      }
    } catch (e) { console.debug('dumpAlarms failed', e); }
  };
  try { chrome.runtime.onStartup.addListener(dumpAlarms); } catch (e) {}
  try { chrome.runtime.onInstalled.addListener(dumpAlarms); } catch (e) {}
  try { self.addEventListener('activate', dumpAlarms); } catch (e) {}
} catch (e) { /* ignore */ }

// Listen for candidate results from content script and for execute-now requests
try {
  addSafeListener((message, sender, sendResponse) => {
    try {
      if (!message || !message.action) return;
      // Persist candidate scan results from content script
      if (message.action === 'scheduled-relist-candidates' && message.taskId) {
        try {
          const key = 'ffm_schedule_result_' + message.taskId;
          const payload = { candidates: Array.isArray(message.candidates) ? message.candidates : [], ts: Date.now() };
          chrome.storage.local.set({ [key]: payload }, () => {
            try {
              // Mark the associated scheduled task as ready and attach a candidatesCount
              chrome.storage.local.get({ scheduled_tasks: [] }, (res) => {
                try {
                  const tasks = res.scheduled_tasks || [];
                  const ix = tasks.findIndex(t => t && t.id === message.taskId);
                  if (ix >= 0) {
                    tasks[ix] = Object.assign({}, tasks[ix], { status: 'ready', candidatesCount: payload.candidates.length, lastScanAt: payload.ts });
                    chrome.storage.local.set({ scheduled_tasks: tasks });
                  }
                } catch (e) {}
              });
            } catch (e) {}
          });
        } catch (e) {}
        sendResponse && sendResponse({ ok: true });
        return;
      }

      // Execute a scheduled task on demand (manual confirm)
      if (message.action === 'execute-schedule-now' && message.taskId) {
        (async () => {
          try {
            chrome.storage.local.get({ scheduled_tasks: [] }, async (res) => {
              try {
                const tasks = res.scheduled_tasks || [];
                const ix = tasks.findIndex(t => t && t.id === message.taskId);
                if (ix < 0) { try { sendResponse && sendResponse({ ok: false, error: 'not-found' }); } catch (e) {} return; }
                const task = tasks[ix];
                try { console.debug('[bg] execute-schedule-now starting', { taskId: task.id }); } catch (e) {}
                // If the caller provided a chosen candidate, persist it and attach to task
                if (message.candidate) {
                  try {
                    const selKey = 'ffm_schedule_selected_' + task.id;
                    chrome.storage.local.set({ [selKey]: message.candidate }, () => {
                      try { console.debug('[bg] execute-schedule-now: selected candidate persisted', { taskId: task.id, title: (message.candidate && message.candidate.title) ? message.candidate.title.slice(0,80) : null }); } catch (e) {}
                    });
                    // attach selection to task object passed to executor
                    task.__selectedCandidate = message.candidate;
                  } catch (e) { console.debug('[bg] failed to persist selected candidate', e); }
                }
                // If there is no selected candidate on the task, try to load any persisted selection
                try {
                  if (!task.__selectedCandidate) {
                    const selKey = 'ffm_schedule_selected_' + task.id;
                    try {
                      const sel = await new Promise((res) => {
                        try { chrome.storage.local.get([selKey], (r) => res(r && r[selKey] ? r[selKey] : null)); } catch (e) { res(null); }
                      });
                      if (sel) {
                        task.__selectedCandidate = sel;
                        try { console.debug('[bg] executeScheduledTask: loaded persisted selected candidate', { taskId: task.id, title: (sel && sel.title) ? (sel.title||'').slice(0,80) : null, href: sel && sel.href ? sel.href : null }); } catch (e) {}
                      }
                    } catch (e) { console.debug('[bg] failed to read persisted selected candidate', e); }
                  }
                } catch (e) { console.debug('[bg] executeScheduledTask selected candidate load error', e); }
                const result = await executeScheduledTask(task);
                // Default: keep the scheduled task unless executor explicitly requests removal
                try {
                  const explicitRemove = (result && result.keep === false);
                  if (explicitRemove) {
                    const newTasks = tasks.filter((t, i) => i !== ix);
                    chrome.storage.local.set({ scheduled_tasks: newTasks }, () => {});
                  } else {
                    // update task entry only if the executor returned updates
                    if (result && result.taskUpdates) {
                      tasks[ix] = Object.assign({}, tasks[ix], result.taskUpdates || {});
                      chrome.storage.local.set({ scheduled_tasks: tasks }, () => {});
                    }
                  }
                } catch (e) { console.debug('execute-now cleanup failed', e); }
                try { sendResponse && sendResponse({ ok: true, result }); } catch (e) {}
              } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (e2) {} }
            });
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (e2) {} }
        })();
        return true; // indicate async
      }

      // Rescan a scheduled task: open the selling page and request a new scheduled-relist scan
      if (message.action === 'rescan-scheduled-task' && message.taskId) {
        (async () => {
          try {
            const taskId = message.taskId;
            const targetUrl = 'https://www.facebook.com/marketplace/you/selling';
            // Try to find an existing open tab with the selling URL first
            try {
              chrome.tabs.query({ url: '*://*.facebook.com/marketplace/you/selling*' }, (tabs) => {
                try {
                  const tab = (tabs || [])[0];
                  const openAndSend = (tabId) => {
                    try {
                      const injectionErrors = [];
                      const attemptSend = (triesLeft) => {
                        try {
                          chrome.tabs.sendMessage(tabId, { action: 'start-scheduled-relist', taskId }, (resp) => {
                            try {
                              if (chrome.runtime.lastError) {
                                try { injectionErrors.push(String(chrome.runtime.lastError && chrome.runtime.lastError.message || chrome.runtime.lastError)); } catch (e) {}
                                if (triesLeft > 0) {
                                  try {
                                    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/content_main.js'] }, () => {
                                      try { consumeLastError(); } catch (e) {}
                                      setTimeout(() => attemptSend(triesLeft - 1), 400);
                                    });
                                  } catch (e) { setTimeout(() => attemptSend(triesLeft - 1), 400); }
                                } else {
                                  // exhausted retries: persist diag for later inspection
                                  try {
                                    const diagKey = 'ffm_injection_diag_' + taskId;
                                    const diag = { ts: Date.now(), taskId: taskId, errors: injectionErrors.slice(0,10) };
                                    chrome.storage.local.set({ [diagKey]: diag }, () => {});
                                  } catch (e) {}
                                }
                              }
                            } catch (e) { if (triesLeft > 0) setTimeout(() => attemptSend(triesLeft - 1), 400); }
                          });
                        } catch (e) { if (triesLeft > 0) setTimeout(() => attemptSend(triesLeft - 1), 400); }
                      };
                      // Wait for content script handshake before starting send attempts; fall back to immediate start on timeout.
                      try {
                        waitForContentListener(tabId, 5000).then(() => attemptSend(3)).catch(() => attemptSend(3));
                      } catch (e) { setTimeout(() => attemptSend(3), 700); }
                    } catch (e) {}
                  };
                  if (tab && tab.id) {
                    try { safeWindowsUpdate(tab.windowId, { focused: true }); } catch (e) {}
                    openAndSend(tab.id);
                    try { sendResponse && sendResponse({ ok: true, note: 'sent-to-existing' }); } catch (e) {}
                    return;
                  }
                  // Otherwise create a new tab
                  try {
                    safeTabsCreate({ url: targetUrl, active: true }).then((newTab) => {
                      try {
                        if (!newTab || !newTab.id) { try { sendResponse && sendResponse({ ok: false, error: 'tab-create-failed' }); } catch (e) {} return; }
                        const tabId = newTab.id;
                        try { if (newTab.windowId) safeWindowsUpdate(newTab.windowId, { focused: true }); } catch (e) {}
                        const onUpdated = (tid, changeInfo) => {
                          if (tid !== tabId) return;
                          if (changeInfo && changeInfo.status === 'complete') {
                            try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (e) {}
                            openAndSend(tabId);
                          }
                        };
                        try { chrome.tabs.onUpdated.addListener(onUpdated); } catch (e) { openAndSend(tabId); }
                        try { sendResponse && sendResponse({ ok: true, note: 'created-tab' }); } catch (e) {}
                      } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
                    }).catch(() => { try { sendResponse && sendResponse({ ok: false, error: 'tab-create-threw' }); } catch (e) {} });
                  } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
                } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
              });
            } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        })();
        return true;
      }

      // Probe frames for the active tab: return frameId, parentFrameId, url and whether scripting can execute there
      if (message.action === 'probe-frames') {
        (async () => {
          try {
            // Find active tab in current window
            const tabs = await new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, res));
            let tab = tabs && tabs[0];
            if (!tab || !tab.id) { try { sendResponse && sendResponse({ ok: false, error: 'no-active-tab' }); } catch (e) {} return; }
            // If the active tab is an extension page (popup), try to find a facebook marketplace tab to probe instead
            try {
              const url = tab.url || '';
              if (url.startsWith('chrome-extension://')) {
                try {
                  const fbTabs = await new Promise((res) => chrome.tabs.query({ url: ['*://*.facebook.com/*', '*://m.facebook.com/*'] }, res));
                  if (fbTabs && fbTabs.length) tab = fbTabs[0];
                } catch (e) {}
              }
            } catch (e) {}
            const tabId = tab.id;
            // Prefer scripting-based probing across frames; avoid webNavigation.getAllFrames due to FB unreliability.

            // Fallback: attempt to execute a small probe function in allFrames; frames that are cross-origin will fail
            try {
              chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
                try {
                  return { url: location.href, origin: location.origin };
                } catch (e) { return { error: String(e) }; }
              } }, (results) => {
                try {
                  const frames = (results || []).map((r, idx) => {
                    try {
                      if (!r) return { frameId: idx, url: null, origin: null, injectable: false };
                      const res = r.result || r || {};
                      if (res && res.error) return { frameId: idx, url: null, origin: null, injectable: false };
                      return { frameId: idx, url: res.url || null, origin: res.origin || null, injectable: true };
                    } catch (e) { return { frameId: idx, url: null, origin: null, injectable: false }; }
                  });
                  try { sendResponse && sendResponse({ ok: true, frames }); } catch (e) {}
                } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
              });
              return;
            } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        })();
        return true;
      }
    } catch (e) { /* ignore */ }
  });
} catch (e) { console.debug('scheduled-relist listeners install failed', e); }

// NOTE: The 'ffm_trigger_full_publish_from_content' handler was intentionally removed
// to avoid duplicate triggers; content scripts should send 'ffm_trigger_full_publish_after_relist'
// which this background already handles (see the listener above at the relist->publish location).

  // Debug helper: respond with current alarms and scheduled_tasks for troubleshooting
  try {
    addSafeListener((message, sender, sendResponse) => {
      try {
        if (!message || message.action !== 'debug-alarms') return;
        (async () => {
          try {
            const alarms = await new Promise((res) => {
              try { if (chrome && chrome.alarms && typeof chrome.alarms.getAll === 'function') chrome.alarms.getAll(res); else res([]); } catch (e) { res([]); }
            });
            chrome.storage.local.get({ scheduled_tasks: [] }, (resStorage) => {
              try { sendResponse && sendResponse({ ok: true, alarms: alarms || [], scheduled_tasks: resStorage.scheduled_tasks || [] }); } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch(_){} }
            });
          } catch (e) {
            try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
          }
        })();
        return true;
      } catch (e) { /* ignore */ }
    });
  } catch (e) { console.debug('debug-alarms listener install failed', e); }

// Display settings removed — openWindowMode/closeWindowMode/applyAlwaysOnTop handlers removed because Always-on-Top is unsupported on this platform.

// Handler: open or focus a Facebook selling tab and inject a lightweight layout UI directly into the page
addSafeListener((message, sender, sendResponse) => {
  try {
    if (!message || message.action !== 'open-inject-layout') return;
    (async () => {
      try {
        const targetUrl = 'https://www.facebook.com/marketplace/you/selling';
        // Try to find an existing selling tab
        chrome.tabs.query({ url: '*://*.facebook.com/marketplace/you/selling*' }, (tabs) => {
          try {
            const existing = (tabs || [])[0];
            const doInject = (tabId) => {
              try {
                // Focus window if possible
                try { chrome.tabs.get(tabId, (t) => { try { if (t && t.windowId) safeWindowsUpdate(t.windowId, { focused: true }); } catch (e) {} }); } catch (e) {}
                // Inject the in-page layout script (isolated world so it can call chrome.runtime)
                try {
                  chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content/inject_layout.js'] }, () => {
                    try { consumeLastError(); } catch (e) {}
                    // After attempting injection, wait for the handshake to confirm the UI is present
                    try {
                      waitForContentListener(tabId, 5000).then(() => {
                        try { sendResponse && sendResponse({ ok: true, injected: true }); } catch (e) {}
                      }).catch((err) => {
                        try { sendResponse && sendResponse({ ok: false, error: String(err) }); } catch (e) {}
                      });
                    } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (e2) {} }
                  });
                } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
              } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
            };

            if (existing && existing.id) {
              try { if (existing.windowId) safeWindowsUpdate(existing.windowId, { focused: true }); } catch (e) {}
              doInject(existing.id);
              return;
            }

            // Otherwise create a new tab and inject after load
            try {
              safeTabsCreate({ url: targetUrl, active: true }).then((newTab) => {
                try {
                  if (!newTab || !newTab.id) { try { sendResponse && sendResponse({ ok: false, error: 'tab-create-failed' }); } catch (e) {} return; }
                  const tabId = newTab.id;
                  try { if (newTab.windowId) safeWindowsUpdate(newTab.windowId, { focused: true }); } catch (e) {}
                  const onUpdated = (tid, changeInfo) => {
                    if (tid !== tabId) return;
                    if (changeInfo && changeInfo.status === 'complete') {
                      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (e) {}
                      doInject(tabId);
                    }
                  };
                  try { chrome.tabs.onUpdated.addListener(onUpdated); } catch (e) { doInject(tabId); }
                } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
              }).catch(() => { try { sendResponse && sendResponse({ ok: false, error: 'tab-create-threw' }); } catch (e) {} });
            } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
          } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
        });
      } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {} }
    })();
    return true; // async
  } catch (e) {}
});

// ===== AutoList Pro SCHEDULER — restore create/restore/heartbeat (safe & MV3-friendly) =====
(() => {
  const MAP_KEY = '__ffm_scheduled_tasks_map';  // object keyed by id (for popup compatibility)
  const LIST_KEY = 'scheduled_tasks';           // array of tasks (for legacy code)
  const PREFIX   = 'ffm_schedule_';             // alarm name prefix
  const HB_NAME  = 'ffm_heartbeat';             // heartbeat alarm name

  // ---- helpers ----
  const now = () => Date.now();

  function toTaskRecord(t) {
    // Normalize incoming shapes from both actions
    const id  = String(t.id);
    let when  = Number(t.when || 0);
    if (!Number.isFinite(when) && t.timeISO) when = new Date(String(t.timeISO)).getTime();
    if (!Number.isFinite(when)) throw new Error('Invalid time');
    // Nudge to >= now+2s to avoid immediate-expire flakiness
    if (when <= now() + 1000) when = now() + 2000;

    return {
      id,
      taskId: t.taskId || t.id || (t.payload && t.payload.id) || id,

      // Persist listingId when present at top-level or inside payload
      listingId: (
        t.listingId ||
        (t.payload && t.payload.listingId) ||
        null
      ),

      when,
      timeISO: t.timeISO || null,
      action: t.action || 'publish',
      publishRequestId: t.publishRequestId || (t.payload && t.payload.publishRequestId) || null,
      inventoryName: t.inventoryName || null,
      listingTitle: t.listingTitle || (t.payload && t.payload.listingTitle) || null,
      payload: t.payload || null,
    };
  }

  function alarmName(id) { return PREFIX + String(id); }

  function logActiveAlarms(tag='[bg]') {
    try {
      chrome.alarms.getAll((all) => {
        try {
          console.debug(`${tag} active alarms`, (all || []).map(a => a && a.name));
        } catch (e) {}
      });
    } catch (e) {}
  }

// Normalize scheduled tasks stored in chrome.storage into canonical records
async function normalizeTasksFromStorage() {
  try {
    const snap = await new Promise(res => chrome.storage.local.get({ scheduled_tasks: [] }, res));
    const arr = Array.isArray(snap && snap.scheduled_tasks) ? snap.scheduled_tasks : [];
    return (arr || []).map(t => {
      return {
        id: t.id || t.taskId || (t.payload && t.payload.id) || null,
        taskId: t.taskId || t.id || (t.payload && t.payload.id) || null,
        listingId: t.listingId || (t.payload && t.payload.listingId) || null,
        inventoryName: t.inventoryName || (t.payload && t.payload.inventoryName) || null,
        listingTitle: t.listingTitle || (t.payload && t.payload.listingTitle) || null,
        action: t.action || (t.payload && t.payload.action) || 'relist',
        timeISO: t.timeISO || (t.payload && t.payload.timeISO) || null,
        when: t.when || (t.payload && t.payload.when) || null,
        payload: t.payload || null
      };
    });
  } catch (e) {
    console.warn('[bg] normalizeTasksFromStorage failed', e);
    return [];
  }
}

  async function readStorage(keys) {
    return await new Promise(res => chrome.storage.local.get(keys, res));
  }
  async function writeStorage(obj) {
    return await new Promise(res => chrome.storage.local.set(obj, res));
  }
  async function removeStorage(keys) {
    return await new Promise(res => chrome.storage.local.remove(keys, res));
  }

  async function upsertTask(rec) {
    const snap = await readStorage([LIST_KEY, MAP_KEY]);
    const list = Array.isArray(snap[LIST_KEY]) ? snap[LIST_KEY] : [];
    const map  = (snap[MAP_KEY] && typeof snap[MAP_KEY] === 'object') ? snap[MAP_KEY] : {};

    // list: de-dup by id, then push
    const filtered = list.filter(x => x && String(x.id) !== rec.id);
    filtered.push(rec);

    // map: id -> record
    map[rec.id] = rec;

    await writeStorage({ [LIST_KEY]: filtered, [MAP_KEY]: map });
  }

  async function deleteTask(id) {
    const snap = await readStorage([LIST_KEY, MAP_KEY]);
    const list = Array.isArray(snap[LIST_KEY]) ? snap[LIST_KEY] : [];
    const map  = (snap[MAP_KEY] && typeof snap[MAP_KEY] === 'object') ? snap[MAP_KEY] : {};

    const filtered = list.filter(x => x && String(x.id) !== String(id));
    delete map[String(id)];

    await writeStorage({ [LIST_KEY]: filtered, [MAP_KEY]: map });
  }

  async function createAlarmFor(rec) {
    try {
      chrome.alarms.create(alarmName(rec.id), { when: rec.when });
      console.debug('[bg:schedule] created →', alarmName(rec.id), 'at', new Date(rec.when).toLocaleString());
      logActiveAlarms('[bg:schedule]');
      return true;
    } catch (e) {
      console.debug('[bg:schedule] alarms.create failed', e);
      return false;
    }
  }

  // ---- public ops ----
  async function scheduleFromMessage(message) {
    // Supports both shapes:
    // 1) { action:'schedule-task', task:{ id, when|timeISO, ... } }
    // 2) { action:'ffm_schedule_create', id, when, publishRequestId?, payload? }
    const rec = toTaskRecord(
      message.task || {
        id: message.id,
        when: message.when,
        timeISO: message.timeISO,
        action: message.actionName || 'publish',
        publishRequestId: message.publishRequestId,
        inventoryName: message.inventoryName,
        payload: message.payload,
      }
    );
    await upsertTask(rec);
    await createAlarmFor(rec);
    return { ok: true, id: rec.id, when: rec.when };
  }

  async function restoreAll() {
    try {
      const snap = await readStorage([LIST_KEY]);
      const list = Array.isArray(snap[LIST_KEY]) ? snap[LIST_KEY] : [];
      if (!list.length) { logActiveAlarms('[bg:restore]'); return; }

      // Create (or re-create) missing alarms for future tasks; run past-due tasks immediately
      const all = await new Promise(res => chrome.alarms.getAll(res));
      const have = new Set((all || []).map(a => a && a.name));

      for (const rec of list) {
        if (!rec || !rec.id) continue;
        if (rec.when <= now()) {
          // past-due: fire immediately (best-effort) and remove
          try {
            console.debug('[bg:schedule] past-due firing immediately →', rec.id);
            await handleFire(rec.id, /*fromAlarm*/false);
          } catch (e) {}
          continue;
        }
        const name = alarmName(rec.id);
        if (!have.has(name)) await createAlarmFor(rec);
      }
      logActiveAlarms('[bg:restore]');
    } catch (e) {
      console.debug('[bg:restore] failed', e);
    }
  }

  function handleFire(id, fromAlarm=true) {
    try {
      // Load the record
      readStorage([MAP_KEY]).then(async (snap) => {
        const map  = (snap[MAP_KEY] && typeof snap[MAP_KEY] === 'object') ? snap[MAP_KEY] : {};
        const rec  = map[String(id)] || null;

        try { console.debug('[bg:schedule] fired →', id, { fromAlarm, hasRecord: !!rec }); } catch (e) {}

        // Best-effort: invoke the publish executor if present
        try {
          if (typeof executeScheduledTask === 'function' && rec) {
            await Promise.resolve(executeScheduledTask(rec)).catch(() => {});
          }
        } catch (_) {}

        // Notify user (optional; guard API)
        try {
          if (rec && typeof createNotificationWithFallback === 'function') {
            const nid  = 'ffm_publish_' + (rec.publishRequestId || id);
            const opts = {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('images/Green_Alarm.png'),
              title: 'Listing scheduled',
              message: rec.inventoryName ? `${rec.inventoryName} is being published` : 'A scheduled listing is being published',
              priority: 0
            };
            await createNotificationWithFallback(nid, opts);
          }
        } catch (_) {}

        // Clean up: remove from storage and clear alarm
        try {
          await deleteTask(id);
        } catch (e) {
          try { console.debug('[bg:schedule] deleteTask error', e); } catch (_) {}
        }
        try { chrome.alarms.clear(alarmName(id), () => {}); } catch (_) {}
      });
    } catch (e) {
      try { console.debug('[bg:schedule] handleFire error', e); } catch (_) {}
    }
  }

  // ---- listeners ----

  // Create/Upsert handler (both actions)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (!message || !message.action) return;
      if (
        (message.action === 'schedule-task' && message.task) ||
        (message.action === 'ffm_schedule_create' && (message.id || (message.task && message.task.id)))
      ) {
        (async () => {
          try {
            const r = await scheduleFromMessage(message);
            sendResponse && sendResponse(r);
          } catch (e) {
            sendResponse && sendResponse({ ok: false, error: String(e && e.message || e) });
          }
        })();
        return true; // async
      }
    } catch (_) {}
  });

  // Fallback handler: start a scheduled publish given a saved listingId
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (!message || message.action !== 'ffm_scheduled_publish_start') return;
        (async () => {
          try {
            const listingId = message.listingId || null;
            const taskId = message.taskId || null;
            if (!listingId) {
              try { sendResponse && sendResponse({ ok: false, error: 'missing-listingId' }); } catch (e) {}
              return;
            }
            try { console.log('[SP] scheduled_publish_start received', { listingId, taskId }); } catch (e) {}

            // Attempt to locate the saved listing in storage
            const snap = await new Promise((r) => { try { chrome.storage.local.get(['listings','ffmSavedListings','__ffm_saved_listings_cache'], r); } catch (e) { r({}); } });
            const lists = Array.isArray(snap.listings) ? snap.listings : (Array.isArray(snap.ffmSavedListings) ? snap.ffmSavedListings : []);
            let listing = null;
            try {
              listing = (lists || []).find(l => l && (String(l.listingId) === String(listingId) || String(l.id) === String(listingId) || String(l.inventoryName) === String(listingId)));
            } catch (e) {}

            if (!listing) {
              try { sendResponse && sendResponse({ ok: false, error: 'listing-not-found' }); } catch (e) {}
              return;
            }

            // Stage a publishRequestId for the found listing
            const publishRequestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
            const stagedKey = 'ffm_publish_' + publishRequestId;
            try {
              await new Promise((r) => { try { chrome.storage.local.set({ [stagedKey]: listing, ffm_last_publish: Object.assign({}, listing, { publishRequestId }) }, r); } catch (e) { r(); } });
            } catch (e) {}

            // IMPORTANT: do NOT force autoPublish here — caller requested allowAutoPublish=false
            try {
              try { console.log('[SP] scheduled_publish_start → invoking handler directly', { publishRequestId, taskId }); } catch (e) {}
              await handlePublishListing({ action: 'publish-listing', publishRequestId, autoPublish: false, menuAuto: false, source: 'scheduled', taskId }, { id: 'scheduler' });
            } catch (e) { console.debug('[SP] publish-listing start handler failed', e); }

            try { sendResponse && sendResponse({ ok: true, publishRequestId }); } catch (e) {}
          } catch (e) {
            try { console.error('[SP] scheduled_publish_start failed', e); } catch (er) {}
            try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
          }
        })();
        return true;
      } catch (e) {}
    });
  } catch (e) {}

  // Alarm firing
  try {
    chrome.alarms.onAlarm.addListener((a) => {
      try {
        if (!a || !a.name) return;
        if (a.name === HB_NAME) {
          // If heartbeat is disabled, silently ignore and clear any existing instance.
          if (FFM_DISABLE_HEARTBEAT) {
            try { if (chrome && chrome.alarms && typeof chrome.alarms.clear === 'function') chrome.alarms.clear(HB_NAME); } catch (e) {}
            return;
          }

          // heartbeat: log alarms + rescue due tasks without alarms
          logActiveAlarms('[bg:HB]');
          (async () => {
            try {
              const snap = await readStorage([LIST_KEY]);
              const list = Array.isArray(snap[LIST_KEY]) ? snap[LIST_KEY] : [];
              if (!list.length) return;
              const names = new Set((await new Promise(res => chrome.alarms.getAll(res)) || []).map(x => x && x.name));
              for (const rec of list) {
                if (!rec || !rec.id) continue;
                const due = rec.when <= now();
                const name = alarmName(rec.id);
                if (due) {
                  await handleFire(rec.id, /*fromAlarm*/false);
                } else if (!names.has(name)) {
                  await createAlarmFor(rec);
                }
              }
            } catch (_) {}
          })();
          return;
        }
        if (a.name.startsWith(PREFIX)) {
          const id = a.name.slice(PREFIX.length);
          handleFire(id, /*fromAlarm*/true);
        }
      } catch (_) {}
    });
  } catch (_) {}

  // Restore on startup/activation/install
  try { chrome.runtime.onStartup.addListener(restoreAll); } catch (_) {}
  try { chrome.runtime.onInstalled.addListener(restoreAll); } catch (_) {}
  // Service worker wakeups can miss onStartup in some cases; do a delayed restore too.
  setTimeout(() => { restoreAll(); }, 800);

  // Heartbeat: every 30 seconds (testing). Minimum period is 1 minute in Chrome; some browsers accept fractional minutes.
  // For production set back to 2 (minutes).
  if (!FFM_DISABLE_HEARTBEAT) {
    try { chrome.alarms.create(HB_NAME, { periodInMinutes: 0.5 }); } catch (_) {}
  } else {
    // Ensure any previously-created heartbeat is removed when disabled
    try { if (chrome && chrome.alarms && typeof chrome.alarms.clear === 'function') chrome.alarms.clear(HB_NAME); } catch (_) {}
  }
  // Auto Active Check: legacy alarm cleanup.
  // Clear any old 'ffmAutoActiveCheck' alarm to avoid duplicate hourly alarms.
  try { if (chrome && chrome.alarms && typeof chrome.alarms.clear === 'function') chrome.alarms.clear('ffmAutoActiveCheck', () => { try { console.log('[bg] Cleared legacy alarm ffmAutoActiveCheck'); } catch(e){} }); } catch (_) {}
  // Listener for the periodic auto active check alarm
  try {
    if (chrome && chrome.alarms && typeof chrome.alarms.onAlarm.addListener === 'function') {
      chrome.alarms.onAlarm.addListener(async (a) => {
        try {
          if (!a || !a.name) return;
          if (a.name === 'ffmAutoActiveCheck') {
            try {
              // Legacy alarm — ignored. We clear legacy alarms on startup and prefer
              // the new `ffm_schedule_AAS_AUTO_HOURLY` flow.
              try { console.log('[AutoList Pro bg] Ignoring legacy alarm ffmAutoActiveCheck (cleared)'); } catch (e) {}
            } catch (e) {}
            return;
          }
        } catch (e) {}
      });
    }
  } catch (e) {}
// Install a safe listener for the user-guided Active Listings flow (CLFP-style).
// This opens the FB selling page and injects a small overlay that the user clicks to permit scraping.
try {
  addSafeListener((msg, sender, sendResponse) => {
    try {
      if (msg && msg.cmd === 'openActiveListingsPage') {
        try { console.log('[AutoList Pro bg] openActiveListingsPage requested'); } catch(e) {}
        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        // Open the page and inject overlay after a short delay
        try {
          safeTabsCreate({ url: 'https://www.facebook.com/marketplace/you/selling', active: true }).then((tab) => {
            try {
              if (!tab || !tab.id) { try { console.debug('[bg] openActiveListingsPage: failed to create tab'); } catch (e) {} return; }
              setTimeout(() => {
                try {
                  try { console.debug('[AutoList Pro bg] overlay injection requested for tab', tab && tab.id); } catch(_){}
                  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/shared_scrapers.js','content/active_listings_overlay.js'] }, () => {
                    try { if (chrome.runtime.lastError) console.debug('[bg] overlay inject lastError', chrome.runtime.lastError && chrome.runtime.lastError.message); } catch (e) {}
                  });
                } catch (e) { try { console.debug('[bg] executeScript failed', e); } catch(_){} }
              }, 7000);
            } catch (e) { try { console.debug('[bg] openActiveListingsPage inner error', e); } catch(_){} }
          }).catch(e => { try { console.debug('[bg] safeTabsCreate rejected', e); } catch(_){} });
        } catch (e) { try { console.debug('[bg] openActiveListingsPage error', e); } catch(_){} }
        return true;
      }
    } catch (e) {}
  });
} catch (e) { try { console.debug('[bg] install openActiveListingsPage listener failed', e); } catch(_){} }

// Unified Active Check runner (auto vs manual)
async function ffmRunActiveCheck(auto = true) {
  try {
    console.log('[AutoList Pro bg] ffmRunActiveCheck start (auto=%s)', auto);

    // 1) Open a fresh Selling tab every time (do not reuse existing)
    const url = 'https://www.facebook.com/marketplace/you/selling';
    const tab = await safeTabsCreate({ url, active: false });
    if (!tab || !tab.id) {
      console.debug('[AutoList Pro bg] ffmRunActiveCheck failed to create tab');
      return { ok: false, error: 'tab-open-failed' };
    }
    const tabId = tab.id;
    try { console.log('[AutoList Pro bg] Selling tab created id=%d', tabId); } catch (e) {}

    // 2) Wait for our content to announce readiness (ffm_content_ready)
    const readyOk = await waitForContentReady(tabId, 20000);
    try { console.log('[AutoList Pro bg] content ready wait ->', readyOk); } catch (e) {}

    // 3) Ask the content script to run the robust auto refresh
    const first = await invokeAutoRefresh(tabId, /*forced*/ false, 35000);
    try { console.log('[AutoList Pro bg] auto refresh result (first):', first); } catch (e) {}

    // 4) If empty or failed, try a forced pass once
    if (!first || !first.ok || (first.count | 0) === 0) {
      try { console.warn('[AutoList Pro bg] empty/failed first pass — retrying forced'); } catch (e) {}
      const second = await invokeAutoRefresh(tabId, /*forced*/ true, 35000);
      try { console.log('[AutoList Pro bg] auto refresh result (forced):', second); } catch (e) {}
    }

  // Close the tab after a short delay to allow any final work
  // -----------------------------------------------------------
  // DEBUG MODE: Disable closing the AS tab so we can inspect logs
  // -----------------------------------------------------------
  // try { setTimeout(() => { try { chrome.tabs.remove(tabId); } catch (e) {} }, 2500); } catch (e) {}
  try { console.warn('[AutoList Pro AS] DEBUG: Auto-close disabled — review logs in tab (tabId=' + tabId + ').'); } catch (e) {}
  } catch (err) {
    console.error('[AutoList Pro bg] ffmRunActiveCheck error', err);
  }

  // Helper: send message to content and await ffmActiveListingsResult or timeout
  function invokeAutoRefresh(tabIdInner, forced, timeoutMs) {
    return new Promise(resolve => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { chrome.runtime.onMessage.removeListener(onResult); } catch (e) {}
          resolve({ ok: false, timeout: true });
        }
      }, timeoutMs);

      function onResult(msg, sender) {
        try {
          if (sender && sender.tab && sender.tab.id === tabIdInner && msg && msg.action === 'ffmActiveListingsResult') {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              try { chrome.runtime.onMessage.removeListener(onResult); } catch (e) {}
              resolve({ ok: true, count: (msg.scraped || []).length, meta: msg.meta });
            }
          }
        } catch (e) {}
      }
      try { chrome.runtime.onMessage.addListener(onResult); } catch (e) {}

      try {
        ffmSafeSendMessage(tabIdInner, { action: 'ffmActiveListingsAuto', forced }).then((resp) => {
          try { console.log('[AutoList Pro bg] invokeAutoRefresh sendMessage response:', resp); } catch (e) {}
        }).catch((err) => {
          try { console.warn('[AutoList Pro bg] invokeAutoRefresh sendMessage error', err); } catch (e) {}
        });
      } catch (e) {
        try { chrome.runtime.onMessage.removeListener(onResult); } catch (er) {}
        clearTimeout(timeout);
        resolve({ ok: false, error: String(e) });
      }
    });
  }
}

// NOTE: background no longer defines a page scrapeActiveListings; the page-provided
// `window.ffmScrapeActiveListings` (injected by active_listings_overlay.js) is the
// authoritative implementation. Background will inject a small bridge that calls
// the page function via chrome.scripting.executeScript instead of shipping its own stub.

// Manual trigger via runtime message
// Replace older direct executeScript usage with a safe, throttled bridge that
// calls the page-owned `window.ffmScrapeActiveListings` in the MAIN world.
//let scrapeRunning = false;

//async function ffmScrapeActiveListings(tabId) {
  //if (scrapeRunning) {
    //console.warn('[AutoList Pro bg] scrape already running, skipping');
    //return;
 // }

  //scrapeRunning = true;
  //console.log('[AutoList Pro bg] >>> Starting Active Listings scrape at', new Date().toLocaleTimeString());

  //try {
  //  const data = await window.ffmScrapeActiveListings();
           // console.log('[AutoList Pro bg->page] ✅ Page scrape complete, listings:', data?.length ?? 0);
           // return { ok: true, listings: data };
         // } catch (err) {
         //   console.error('[AutoList Pro bg->page] ❌ scrape failed', err);
        //    return { ok: false, listings: [] };
       //   }
       // } else {
        //  console.warn('[AutoList Pro bg->page] ⚠️ ffmScrapeActiveListings not found');
       //   return { ok: false, listings: [] };
      //  }
     // },
    //});

    //const result = results?.[0]?.result;
    //console.log('[AutoList Pro bg] Received result:', result);
   // return result;
  //} catch (err) {
   // console.error('[AutoList Pro bg] ❌ executeScript failed', err);
  //  return { ok: false, listings: [] };
 // } finally {
 //   scrapeRunning = false;
 //   console.log('[AutoList Pro bg] <<< scrape finished');
 // }
//}

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg) return;
      if (msg.type === 'ffmRunManualActiveCheck') {
        console.log('[AutoList Pro bg] Manual Active Check requested');

        // find any open selling tab
        chrome.tabs.query({ url: "*://www.facebook.com/marketplace/you/selling*" }, async (tabs) => {
          const targetTab = tabs && tabs.length ? tabs[0] : null;
          if (!targetTab) {
            console.warn('[AutoList Pro bg] No selling tab found for scrapeActiveListings');
            try { sendResponse && sendResponse({ ok: false, error: 'No selling tab' }); } catch (e) {}
            return;
          }

          try {
            const res = await ffmScrapeActiveListings(targetTab.id);
            try { sendResponse && sendResponse(res || { ok: false, listings: [] }); } catch (e) {}
          } catch (e) {
            console.error('[AutoList Pro bg] ffmScrapeActiveListings failed', e);
            try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch (er) {}
          }
        });
        return true;
      }
    } catch (e) {}
  });
} catch (e) {}
})();
// =============================
// Patch 13: Media blobs for publish from AutoListProMediaDB
// =============================

// === AutoList Pro — Marketplace Create frame scanning & injection ===

async function ffmScanForCreateFrame(tabId) {
  // We try injecting detection code into ALL frames.
  // Any frame we do NOT have permission for simply won't execute.
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      try {
        // "Create listing" iframe always contains file input + title + price
        const hasFile = !!document.querySelector('input[type="file"][multiple]');
        const hasTitle = !!document.querySelector('input[aria-label*="Title"], input[placeholder*="Title"]');
        const hasPrice = !!document.querySelector('input[aria-label*="Price"], input[placeholder*="Price"]');

        return {
          href: location.href,
          isCreateFrame: hasFile && hasTitle && hasPrice
        };
      } catch (err) {
        return { error: String(err), isCreateFrame: false };
      }
    }
  });

  const matches = results.filter(r => r.result && r.result.isCreateFrame);
  return matches;
}

/**
 * Injects media/publish scripts into specific frames.
 */
async function ffmInjectMediaScriptsIntoFrames(tabId, frameIds) {
  if (!frameIds || !frameIds.length) {
    console.warn('[AutoList Pro bg] No frames passed to ffmInjectMediaScriptsIntoFrames');
    return;
  }

  const files = [
    'mediaDB.js',
    'content/content_main.js',
    'content/bridge_page.js'
  ];

  for (const frameId of frameIds) {
    try {
      console.log('[AutoList Pro bg] Injecting publish scripts into frame', { tabId, frameId, files });
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files
      });
    } catch (err) {
      console.warn('[AutoList Pro bg] Injection error for frame', frameId, err);
    }
  }
}

/**
 * Ensure at least one active "Create Listing" frame has our scripts.
 * Scans frames for the Create UI and injects into any matches.
 */
async function ffmEnsureCreateFrameInjected(tabId) {
  if (typeof tabId !== 'number') {
    console.warn('[AutoList Pro bg] ffmEnsureCreateFrameInjected called without tabId');
    return { ok: false, frames: [] };
  }

  // Scan inside frames instead of enumerating from BG
  const frames = await ffmScanForCreateFrame(tabId);

  if (!frames.length) {
    console.warn('[AutoList Pro bg] No create-frame detected via scanning');
    return { ok: false, frames: [] };
  }

  const frameIds = frames.map(f => f.frameId);
  console.log('[AutoList Pro bg] Create frame(s) detected via scan', frameIds);

  await chrome.scripting.executeScript({
    target: { tabId, frameIds },
    files: [
      'mediaDB.js',
      'content/content_main.js',
      'content/bridge_page.js'
    ]
  });

  return { ok: true, frames: frameIds };
}

function ffmResetCreateFrameInjectionCache(tabId) {
  if (typeof tabId === 'number') {
    ffmInjectedCreateFrames.delete(tabId);
  } else {
    ffmInjectedCreateFrames.clear();
  }
}



/**
 * Open AutoListProMediaDB and fetch records for a given listingId.
 * listingId is like: ffm_1763797979145_2d0v5
 */
// Reads every record from one IndexedDB database's "media" store. Never
// creates a database that doesn't already exist — callers must check
// ffmBgIdbExists() first for anything beyond the primary AutoListProMediaDB.
async function ffmBgReadAllMediaRecords(dbName) {
  try {
    const storeName = "media";
    const openReq = (globalThis.indexedDB || indexedDB).open(dbName);
    const db = await new Promise((resolve, reject) => {
      openReq.onerror = () => reject(openReq.error);
      openReq.onsuccess = () => resolve(openReq.result);
    });
    if (!db.objectStoreNames.contains(storeName)) {
      try { db.close(); } catch (e) {}
      return [];
    }
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const all = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || []);
    });
    return all;
  } catch (e) {
    console.warn("[AutoList Pro bg][Patch13] failed reading", dbName, e);
    return [];
  }
}

async function ffmBgIdbExists(dbName) {
  try {
    const idb = globalThis.indexedDB || indexedDB;
    if (!idb.databases) return false;
    const dbs = await idb.databases();
    return dbs.some((d) => d && d.name === dbName);
  } catch (e) { return false; }
}

async function ffmBgGetMediaRecordsForListing(uid, listingId) {
  try {
    if (!listingId) {
      console.warn("[AutoList Pro bg][Patch13] No listingId supplied");
      return [];
    }

    // Prefer an exact users/<uid>/listings/<id>/ prefix match when we have a
    // uid, but don't require one — local-only mode has no active login user,
    // so uid is routinely empty here. Fall back to matching any record whose
    // key contains /listings/<id>/ regardless of which uid it's filed under.
    const matchesListing = (rec) => {
      if (!rec || typeof rec.key !== "string") return false;
      if (uid && rec.key.startsWith(`users/${uid}/listings/${listingId}/`)) return true;
      return rec.key.indexOf(`/listings/${listingId}/`) !== -1;
    };

    let filtered = [];
    const primary = await ffmBgReadAllMediaRecords("AutoListProMediaDB");
    filtered = primary.filter(matchesListing);

    // Not found in this extension's own DB — check the legacy Fast4MPMediaDB
    // (some cloud-restore/import paths wrote photo blobs there under the old
    // database name). Read-only; never created if it doesn't already exist.
    if (!filtered.length && (await ffmBgIdbExists("Fast4MPMediaDB"))) {
      const legacy = await ffmBgReadAllMediaRecords("Fast4MPMediaDB");
      filtered = legacy.filter(matchesListing);
      if (filtered.length) console.log("[AutoList Pro bg][Patch13] found media in legacy Fast4MPMediaDB for", listingId);
    }

    console.log(
      "[AutoList Pro bg][Patch13] DB media records for listing",
      listingId,
      "->",
      filtered.length
    );

    const out = [];

    for (const rec of filtered) {
      if (!rec.blob) {
        console.warn("[AutoList Pro bg][Patch13] Record missing blob:", rec.key);
        continue;
      }

      const blob = rec.blob;
      const name =
        rec.name ||
        (typeof rec.key === "string" ? rec.key.split("/").pop() : "media") || 'media';

      // Heuristic: infer video vs image from key name and blob.type
      const keyLower = (rec.key || '').toLowerCase();
      const isVideoKey =
        keyLower.includes('/video_') ||
        keyLower.endsWith('.mp4') ||
        keyLower.endsWith('.mov') ||
        keyLower.endsWith('.webm');

      const blobType = (blob && blob.type) || '';
      const isVideoBlob = blobType.startsWith('video/');

      const isVideo = isVideoKey || isVideoBlob;

      const fallbackType = isVideo ? 'video/mp4' : 'image/jpeg';
      const finalType = blobType || fallbackType;

      // Convert Blob -> base64 data URL so content script can reconstruct File
      const ab = await blob.arrayBuffer();
      const u8 = new Uint8Array(ab);
      let binary = "";
      for (let i = 0; i < u8.length; i++) {
        binary += String.fromCharCode(u8[i]);
      }
      const base64 = btoa(binary);
      const dataUrl = `data:${finalType};base64,${base64}`;

      out.push({
        key: rec.key,
        type: finalType,
        index: typeof rec.index === "number" ? rec.index : 0,
        mimeType: finalType,
        name,
        dataUrl
      });
    }

    console.log('[AutoList Pro bg][Patch13-video] Built records', out.map(r => ({ name: r.name, type: r.type })));

    console.log(
      "[AutoList Pro bg][Patch13] Returning media records for listing",
      listingId,
      "->",
      out.length
    );

    return out;
  } catch (err) {
    console.error("[AutoList Pro bg][Patch13] ffmBgGetMediaRecordsForListing error", err);
    return [];
  }
}

// Dedicated handler for ffm_get_media_blobs_for_listing
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only handle the specific Patch13 message here; let other listeners continue
    if (msg?.action !== "ffm_get_media_blobs_for_listing" && msg?.action !== "ffm_get_media_blobs") return;

    (async () => {
      try {
        const listingId =
          msg.listingId ||
          msg.inventoryId ||
          msg.inventoryName ||
          (msg.listing && (msg.listing.id || msg.listing.inventoryId || msg.listing.inventoryName));

        if (!listingId) throw new Error('missing listingId');

        const uid = msg.uid || msg.userId || null;
        if (!uid) {
          console.warn('[AutoList Pro bg][Patch13] Missing uid for Patch13 handler', msg);
          sendResponse({ ok: false, error: 'missing-uid' });
          return;
        }

        console.log('[AutoList Pro bg][Patch13] Received ffm_get_media_blobs_for_listing for listingId:', listingId, 'uid:', uid);

        // --- existing Patch13 DB lookup / record builder ---
        const records = await ffmBgGetMediaRecordsForListing(uid, listingId);

        console.log('[Patch13] Returning records ->', records?.length || 0);
        sendResponse({ ok: true, records: records || [] });
      } catch (err) {
        console.warn('[Patch13] failed', err);
        try { sendResponse({ ok: false, error: String(err?.message || err) }); } catch (e) {}
      }
    })();

    // ✅ CRITICAL IN MV3: keep the message channel open for async sendResponse
    return true;
  });
}

// NOTE: webNavigation-based frame enumeration was removed as unreliable on Facebook.
// Cache resets are handled opportunistically elsewhere; avoid using chrome.webNavigation here.

// Lightweight Port-based handlers — support media requests and a content handshake
try {
  // Map of content ports by tabId so bg can push messages reliably
  try { globalThis.__ffm_content_ports_by_tab = globalThis.__ffm_content_ports_by_tab || new Map(); } catch (e) { if (typeof __ffm_content_ports_by_tab === 'undefined') var __ffm_content_ports_by_tab = {}; }
  try { globalThis.__ffm_pending_media_for_tab = globalThis.__ffm_pending_media_for_tab || {}; } catch (e) { if (typeof __ffm_pending_media_for_tab === 'undefined') var __ffm_pending_media_for_tab = {}; }

  chrome.runtime.onConnect.addListener((port) => {
    try {
      if (!port || !port.name) return;

      // Media port: request records for a listing (existing behavior)
      if (port.name === 'ffm_media_port') {
        port.onMessage.addListener(async (msg) => {
          try {
            if (!msg || msg.action !== 'ffm_get_media_port') return;
            const { listingId, userId } = msg;
            console.log('[bg][MEDIA_PORT] request', { listingId, userId });

            // Reuse the same Patch13 getter
            const records = await ffmBgGetMediaRecordsForListing(userId, listingId);

            console.log('[bg][MEDIA_PORT] returning records:', records?.length || 0);
            try { port.postMessage({ ok: true, result: records || [] }); } catch (e) { console.warn('[bg][MEDIA_PORT] postMessage failed', e); }
          } catch (e) {
            console.warn('[bg][MEDIA_PORT] failed processing', e);
            try { port.postMessage({ ok: false, error: String(e) }); } catch (er) {}
          }
        });
        return;
      }

      // Content handshake port: keep a mapping from tabId -> port so bg can push events
      if (port.name === 'ffm_content_port') {
        try {
          const tabId = port && port.sender && port.sender.tab && port.sender.tab.id;
          if (!tabId) {
            try { console.warn('[AutoList Pro bg] ffm_content_port connected without tabId'); } catch (e) {}
          } else {
            try {
              try {
                if (globalThis.__ffm_content_ports_by_tab && typeof globalThis.__ffm_content_ports_by_tab.set === 'function') {
                  globalThis.__ffm_content_ports_by_tab.set(tabId, port);
                } else {
                  __ffm_content_ports_by_tab[String(tabId)] = port;
                }
                try { console.log('[AutoList Pro bg] ffm_content_port registered for tab', tabId); } catch (e) {}
              } catch (e) {}
            } catch (e) {}

            // If we have queued media for this tab, deliver it now via the port
            try {
              if (globalThis.__ffm_pending_media_for_tab && globalThis.__ffm_pending_media_for_tab[String(tabId)]) {
                const pending = globalThis.__ffm_pending_media_for_tab[String(tabId)];
                try {
                  port.postMessage({ action: 'ffm_from_published_media_result', data: pending });
                  try { delete globalThis.__ffm_pending_media_for_tab[String(tabId)]; } catch (e) {}
                  try { console.log('[AutoList Pro bg] delivered queued media to tab via port', tabId); } catch (e) {}
                } catch (e) {
                  try { console.warn('[AutoList Pro bg] failed to deliver queued media via port', tabId, e && (e.message||e)); } catch (er) {}
                }
              }
            } catch (e) {}
          }

          port.onDisconnect.addListener(() => {
            try {
              if (globalThis.__ffm_content_ports_by_tab && typeof globalThis.__ffm_content_ports_by_tab.delete === 'function') globalThis.__ffm_content_ports_by_tab.delete(tabId);
              else try { delete __ffm_content_ports_by_tab[String(tabId)]; } catch (e) {}
            } catch (e) {}
            try { console.log('[AutoList Pro bg] ffm_content_port disconnected for tab', tabId); } catch (e) {}
          });

          // Optionally handle incoming messages on this port
          port.onMessage.addListener((msg) => {
            try {
              // Keep this minimal to avoid unexpected behavior; listen for simple pings
              if (msg && msg.action === 'ffm_content_ping') {
                try { port.postMessage({ action: 'ffm_content_pong' }); } catch (e) {}
              }
            } catch (e) {}
          });
        } catch (e) { console.warn('[AutoList Pro bg] ffm_content_port handler error', e); }
        return;
      }
    } catch (e) { console.warn('[bg][PORT] connect handler error', e); }
  });
} catch (e) { console.warn('[bg][PORT] install failed', e); }

// ===============================
// Advanced Scheduler (Auto-DnR) backend
// ===============================

const FFM_SCHED_ADV_RULES_KEY = "ffm_advanced_scheduler_rules";
const FFM_SCHED_ADV_PREFS_KEY = "ffm_advanced_scheduler_prefs";

// === Advanced DnR Scheduler (ADS) constants & helpers ===
const FFM_ADS_RULES_KEY = "ffm_advanced_scheduler_rules";
const FFM_ADS_PREFS_KEY = "ffm_advanced_scheduler_prefs";
const FFM_ADS_MISSED_KEY = "ffm_advanced_scheduler_missed";

// Per-listing alarm name prefix. Each listing gets its own daily alarm.
const FFM_ADS_ALARM_PREFIX = "ffm_auto_dnr_daily::";

// Pre-warm alarm prefix (fires shortly before the actual ADS alarm to warm resources)
const FFM_ADS_PREWARM_PREFIX = "ffm_ads_prewarm::";

function ffmAdsPrewarmAlarmName(listingId) {
  return `${FFM_ADS_PREWARM_PREFIX}${listingId}`;
}

function ffmAdsAlarmNameFor(listingId) {
  return `${FFM_ADS_ALARM_PREFIX}${listingId}`;
}

function ffmAdsListingIdFromAlarmName(name) {
  if (!name || !name.startsWith(FFM_ADS_ALARM_PREFIX)) return null;
  return name.slice(FFM_ADS_ALARM_PREFIX.length);
}

/**
 * Load scheduler rules + prefs from chrome.storage.local.
 * cb({ rules, prefs })
 */
function ffmSchedulerLoadAllState(cb) {
  try {
    chrome.storage.local.get([FFM_SCHED_ADV_RULES_KEY, FFM_SCHED_ADV_PREFS_KEY], (res) => {
      if (chrome.runtime.lastError) {
        try {
          console.warn("[AutoList Pro Scheduler] loadAllState error", chrome.runtime.lastError);
        } catch (e) {}
      }
      const rules = (res && res[FFM_SCHED_ADV_RULES_KEY]) || {};
      const prefs = (res && res[FFM_SCHED_ADV_PREFS_KEY]) || { testMode: false };
      cb({ rules, prefs });
    });
  } catch (e) {
    try { console.warn("[AutoList Pro Scheduler] loadAllState crashed", e); } catch (_) {}
    cb({ rules: {}, prefs: { testMode: false } });
  }
}

function ffmSchedulerSaveRules(rules, cb) {
  try {
    // Preserve runtime/stats fields from existing rules when performing an edit.
    try {
      chrome.storage.local.get([FFM_SCHED_ADV_RULES_KEY], async (res) => {
        try {
          const existing = (res && res[FFM_SCHED_ADV_RULES_KEY]) ? res[FFM_SCHED_ADV_RULES_KEY] : {};
          const PRESERVE_KEYS = ['history','lastRun','lastPublishedAt','lastRunStatus','runCount','stats','lastSuccessAt','lastFailureAt'];

          // Merge existing rule objects into incoming rules so we only update changed fields
          try {
            for (const id of Object.keys(rules || {})) {
              try {
                const incoming = rules[id] || {};
                const prior = existing[id] || {};
                // Deep-merge: prefer incoming scalar values, but preserve prior when
                // incoming value is `null`/`undefined`. Merge objects/arrays recursively
                function mergeRule(priorObj, incomingObj) {
                  const out = Object.assign({}, priorObj || {});
                  try {
                    for (const key of Object.keys(incomingObj || {})) {
                      const val = incomingObj[key];
                      if (typeof val === 'undefined' || val === null) {
                        // treat null/undefined as "no change" to avoid wiping history
                        continue;
                      }
                      if (Array.isArray(val)) {
                        out[key] = val.slice();
                        continue;
                      }
                      if (typeof val === 'object') {
                        out[key] = mergeRule(priorObj && priorObj[key] ? priorObj[key] : {}, val);
                        continue;
                      }
                      out[key] = val;
                    }
                  } catch (e) {}
                  return out;
                }

                const merged = mergeRule(prior || {}, incoming || {});
                rules[id] = merged;
              } catch (e) {}
            }
          } catch (e) {}

          chrome.storage.local.set({ [FFM_SCHED_ADV_RULES_KEY]: rules }, async () => {
            if (chrome.runtime.lastError) {
              try { console.warn("[AutoList Pro Scheduler] saveRules error", chrome.runtime.lastError); } catch (e) {}
            }
            try {
              // After saving rules, rebuild per-listing ADS alarms so scheduling stays in sync.
              if (typeof ffmAdsRebuildAllAlarms === 'function') {
                try { await ffmAdsRebuildAllAlarms("rules-changed"); } catch (e) { /* non-fatal */ }
              }
            } catch (e) {}
            if (cb) cb();
          });
        } catch (e) {
          // fallback: write rules as-is
          try { chrome.storage.local.set({ [FFM_SCHED_ADV_RULES_KEY]: rules }, () => { if (cb) cb(); }); } catch (er) { if (cb) cb(); }
        }
      });
    } catch (e) {
      try { chrome.storage.local.set({ [FFM_SCHED_ADV_RULES_KEY]: rules }, () => { if (cb) cb(); }); } catch (er) { if (cb) cb(); }
    }
  } catch (e) {
    try { console.warn("[AutoList Pro Scheduler] saveRules crashed", e); } catch (_) {}
    if (cb) cb();
  }
}

function ffmSchedulerSavePrefs(prefs, cb) {
  try {
    chrome.storage.local.set({ [FFM_SCHED_ADV_PREFS_KEY]: prefs }, () => {
      if (chrome.runtime.lastError) {
        try {
          console.warn("[AutoList Pro Scheduler] savePrefs error", chrome.runtime.lastError);
        } catch (e) {}
      }
      if (cb) cb();
    });
  } catch (e) {
    try { console.warn("[AutoList Pro Scheduler] savePrefs crashed", e); } catch (_) {}
    if (cb) cb();
  }
}

/**
 * Helper used by manual "Run Now" in the UI.
 * For now this only simulates the run (respecting testMode)
 * and updates repeat counters / disabled state. We will wire
 * it to the real DnR engine in a later step.
 */
function ffmSchedulerRunOne(listingId) {
  if (!listingId) return;

  ffmSchedulerLoadAllState((state) => {
    const rules = state.rules || {};
    const prefs = state.prefs || { testMode: false };
    const rule  = rules[listingId];

    if (!rule || !rule.enabled) {
      try {
        console.log("[AutoList Pro Scheduler] RunOne skipped — no enabled rule for", listingId);
      } catch (e) {}
      return;
    }

    // Helper to log + optionally disable the rule
    function markDisabled(reason) {
      rule.enabled = false;
      rule.disabledReason = reason || "Automatically disabled";
      ffmSchedulerSaveRules(rules);
    }

    // Ensure canonical listings are restored from persistent storage if needed,
    // then perform the normal lookup and evaluation.
    try {
      chrome.storage.local.get("ffmCanonicalListings", (stored) => {
        try {
          const storedMap = (stored && stored.ffmCanonicalListings) ? stored.ffmCanonicalListings : {};
          if (!globalThis.ffmCanonicalListings || Object.keys(globalThis.ffmCanonicalListings || {}).length === 0) {
            try { globalThis.ffmCanonicalListings = storedMap; } catch (e) {}
            try { console.log("[Scheduler] Restored canonical listings from storage:", Object.keys(storedMap).length); } catch (e) {}
          }
        } catch (e) {}

        // Prefer the canonical listing map kept in memory by Active Sync
        let listing = null;
        try {
          if (globalThis.ffmCanonicalListings && typeof globalThis.ffmCanonicalListings === "object") {
            listing = globalThis.ffmCanonicalListings[listingId] || globalThis.ffmCanonicalListings[String(listingId)];
          }
        } catch (e) { /* ignore lookup errors */ }

        // Final evaluation once we have (or fail to get) a listing
        function finishWithListing(fallbackListing) {
          if (!listing && fallbackListing) listing = fallbackListing;

          // If we *still* don't have a listing:
          if (!listing) {
            // If canonical map is empty, assume user hasn't run Active Sync yet → do NOT disable
            try {
              const hasCanonical = globalThis.ffmCanonicalListings && Object.keys(globalThis.ffmCanonicalListings).length > 0;
              if (!hasCanonical) {
                console.log(
                  "[AutoList Pro Scheduler] RunOne — canonical listings empty; run Active Sync first (not disabling rule)",
                  listingId
                );
                return;
              }
            } catch (e) { /* best-effort */ }

            try { console.log("[AutoList Pro Scheduler] RunOne — listing not found, disabling rule", listingId); } catch (e) {}
            markDisabled("Listing removed or not found");
            return;
          }

          // -------------- Active / status checks --------------
          const statusStr = String(
            listing.status || listing.fbStatusRaw || listing.fbStatus || listing.marketplaceStatus || listing.fbListedText || ""
          ).toLowerCase();

          const activeFlag = listing.active || listing.isActive || listing.ffm_flag_active;
          if (activeFlag === false || /sold|pending|inactive|deleted/.test(statusStr)) {
            try { console.log("[AutoList Pro Scheduler] RunOne — listing inactive/sold, disabling rule", listingId); } catch (e) {}
            markDisabled("Listing inactive/sold/pending/deleted");
            return;
          }

          // -------------- Repeat-N logic --------------
          if (rule.repeatMode === "n") {
            if (typeof rule.repeatCount !== "number") rule.repeatCount = 0;
            if (rule.repeatCount <= 0) { markDisabled("Repeat count exhausted"); return; }
          }

          const inTestMode = !!prefs.testMode;
          const title = listing.title || listing.inventoryName || rule.listingTitle || listingId;
          try {
            if (inTestMode) {
              console.log("[AutoList Pro Scheduler] TEST RUN — would run Auto-DnR for:", title, "(", listingId, ")");
            } else {
              console.log("[AutoList Pro Scheduler] Run-Now scheduling ADS DnR (3s) for:", title, "(", listingId, ")");
              try {
                // Persist a manual-run history entry so UI reflects the run
                try {
                  rule.history = rule.history || [];
                  rule.history.push({ when: Date.now(), action: 'manual-run', scheduled: true });
                } catch (e) {}

                // Save updated rule immediately
                try { ffmSchedulerSaveRules(rules); } catch (e) {}

                // Schedule a short-delay SDnR via the unified scheduler path (3 seconds)
                try {
                  chrome.runtime.sendMessage({ action: 'ffm_schedule_dnr_as_sdnr', listingId: listingId, inventoryName: listing.inventoryName || null, listingTitle: title || null, delayMs: 3000 }, (resp) => {
                    try { console.log('[FFM Scheduler] Run-Now dispatched schedule resp', resp); } catch(e){}
                  });
                } catch (e) {
                  console.warn('[FFM Scheduler] Run-Now schedule dispatch failed', e);
                }
              } catch (e) { console.warn('[FFM Scheduler] Run-Now helper failed', e); }
            }
          } catch (e) {}
        }

        // If canonical listing already found, we’re done
        if (listing) { finishWithListing(null); return; }

        // Otherwise, fall back to stored data (ffmSavedListings / saved_listings)
        try {
          chrome.storage.local.get(["ffmSavedListings", "saved_listings"], (res) => {
            let fallback = null;
            const savedArr = Array.isArray(res && res.saved_listings) ? res.saved_listings : [];
            fallback = savedArr.find((l) => {
              if (!l) return false; const id = l.id || l.inventoryId || l.inventoryName; return id === listingId;
            }) || null;
            if (!fallback && res && res.ffmSavedListings) {
              const obj = res.ffmSavedListings || {}; fallback = obj[listingId] || obj[String(listingId)] || null;
            }
            finishWithListing(fallback);
          });
        } catch (e) { finishWithListing(null); }
      });
    } catch (e) {
      // storage get failed -> continue with in-memory lookup
      let listing = null;
      try {
        if (globalThis.ffmCanonicalListings && typeof globalThis.ffmCanonicalListings === "object") {
          listing = globalThis.ffmCanonicalListings[listingId] || globalThis.ffmCanonicalListings[String(listingId)];
        }
      } catch (er) {}
      // reuse existing finishWithListing logic by calling it directly
      (function(){
        function finishWithListing(fallbackListing) {
          if (!listing && fallbackListing) listing = fallbackListing;
          if (!listing) { try { console.log("[AutoList Pro Scheduler] RunOne — listing not found, disabling rule", listingId); } catch(e){}; markDisabled("Listing removed or not found"); return; }
          const statusStr = String(listing.status || listing.fbStatusRaw || listing.fbStatus || listing.marketplaceStatus || listing.fbListedText || "").toLowerCase();
          const activeFlag = listing.active || listing.isActive || listing.ffm_flag_active;
          if (activeFlag === false || /sold|pending|inactive|deleted/.test(statusStr)) { try{console.log("[AutoList Pro Scheduler] RunOne — listing inactive/sold, disabling rule", listingId);}catch(e){}; markDisabled("Listing inactive/sold/pending/deleted"); return; }
          if (rule.repeatMode === "n") { if (typeof rule.repeatCount !== "number") rule.repeatCount = 0; if (rule.repeatCount <= 0) { markDisabled("Repeat count exhausted"); return; } }
          const inTestMode = !!prefs.testMode; const title = listing.title || listing.inventoryName || rule.listingTitle || listingId;
          try { if (inTestMode) console.log("[AutoList Pro Scheduler] TEST RUN — would run Auto-DnR for:", title, "(", listingId, ")"); else console.log("[AutoList Pro Scheduler] (TODO) Real Auto-DnR run for:", title, "(", listingId, ")"); } catch(e){}
          rule.lastRunAt = Date.now(); if (rule.repeatMode === "n") { rule.repeatCount = Math.max(0, (rule.repeatCount || 0) - 1); if (rule.repeatCount <= 0) { rule.enabled = false; rule.disabledReason = "Repeat count exhausted"; } }
          ffmSchedulerSaveRules(rules);
        }
        finishWithListing(null);
      })();
    }
  });
}

// Dedicated onMessage handler for scheduler actions
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.action) return;

      if (message.action === "ffm_scheduler_get_state") {
        ffmSchedulerLoadAllState((state) => {
          try {
            sendResponse({ ok: true, rules: state.rules, prefs: state.prefs });
          } catch (e) {}
        });
        return true; // async
      }

      if (message.action === "ffm_scheduler_update_prefs") {
        const prefs = message.prefs || { testMode: false };
        ffmSchedulerSavePrefs(prefs, () => {
          try { sendResponse({ ok: true }); } catch (e) {}
        });
        return true; // async
      }

      if (message.action === "ffm_scheduler_upsert_rule") {
        const listingId = message.listingId;
        const rule = message.rule || {};
        if (!listingId) {
          try { sendResponse({ ok: false, error: "missing listingId" }); } catch (e) {}
          return;
        }
        ffmSchedulerLoadAllState((state) => {
          state.rules = state.rules || {};
          state.rules[listingId] = Object.assign({}, state.rules[listingId] || {}, rule, {
            enabled: rule.enabled !== false
          });
          ffmSchedulerSaveRules(state.rules, () => {
            try { sendResponse({ ok: true }); } catch (e) {}
          });
        });
        return true; // async
      }

      if (message.action === "ffm_scheduler_toggle_rule") {
        const listingId = message.listingId;
        const enabled = !!message.enabled;
        if (!listingId) {
          try { sendResponse({ ok: false, error: "missing listingId" }); } catch (e) {}
          return;
        }
        ffmSchedulerLoadAllState((state) => {
          const rules = state.rules || {};
          const r = rules[listingId];
          if (r) {
            r.enabled = enabled;
            if (!enabled && !r.disabledReason) {
              r.disabledReason = "Manually disabled";
            }
            if (enabled) {
              delete r.disabledReason;
            }
            ffmSchedulerSaveRules(rules, () => {
              try { sendResponse({ ok: true }); } catch (e) {}
            });
          } else {
            try { sendResponse({ ok: false, error: "no such rule" }); } catch (e) {}
          }
        });
        return true; // async
      }

      if (message.action === "ffm_scheduler_delete_rule") {
        const listingId = message.listingId;
        if (!listingId) {
          try { sendResponse({ ok: false, error: "missing listingId" }); } catch (e) {}
          return;
        }
        ffmSchedulerLoadAllState((state) => {
          const rules = state.rules || {};
          if (rules[listingId]) {
            delete rules[listingId];
          }
          ffmSchedulerSaveRules(rules, () => {
            try { sendResponse({ ok: true }); } catch (e) {}
          });
        });
        return true; // async
      }

      if (message.action === "ffm_scheduler_run_one") {
        const listingId = message.listingId;
        ffmSchedulerRunOne(listingId);
        try { sendResponse({ ok: true }); } catch (e) {}
        return;
      }
    });
  }
} catch (e) {
  try { console.warn("[AutoList Pro Scheduler] Failed to attach onMessage listener", e); } catch (_) {}
}

// -------------------------------
// Run-Now helper for Advanced Scheduler
// -------------------------------
async function ffmAdsRunRuleNow(listingId, testMode) {
  console.log("[FFM Scheduler] Run-Now executing for:", listingId, "testMode:", testMode);

  // Helper to promisify chrome.storage.local.get
  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (res) => {
          resolve(res || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => { resolve(); });
      } catch (e) { resolve(); }
    });
  }

  try {
    const res = await storageGet(FFM_SCHED_ADV_RULES_KEY);
    const rules = res && res[FFM_SCHED_ADV_RULES_KEY] ? res[FFM_SCHED_ADV_RULES_KEY] : {};
    const rule = rules[listingId];

    if (!rule) {
      console.warn("[FFM Scheduler] Run-Now: No rule exists for listing", listingId);
    }

    if (testMode) {
      console.log("[FFM Scheduler] Test Mode → Simulating Auto-DnR for", listingId);
      if (rule) {
        rule.lastRun = Date.now();
        rules[listingId] = rule;
        await storageSet({ [FFM_SCHED_ADV_RULES_KEY]: rules });
      }
      return { ok: true, simulated: true };
    }

    // Real mode: kick off existing DnR engine
    console.log("[FFM Scheduler] Starting REAL Delete-and-Relist for", listingId);
    try {
      if (typeof ffmStartDeleteAndRelist === 'function') {
        await ffmStartDeleteAndRelist(listingId);
      } else {
        console.warn('[FFM Scheduler] ffmStartDeleteAndRelist not available; skipping actual DnR');
      }

      if (rule) {
        rule.lastRun = Date.now();
        rules[listingId] = rule;
        await storageSet({ [FFM_SCHED_ADV_RULES_KEY]: rules });
      }
      return { ok: true, started: true };
    } catch (err) {
      console.error("[FFM Scheduler] Run-Now failed", err);
      return { ok: false, error: String(err) };
    }
  } catch (e) {
    console.error('[FFM Scheduler] ffmAdsRunRuleNow general error', e);
    return { ok: false, error: String(e) };
  }
}

//--------------------------------------------------------------
// Compute next scheduled time for ADS (A: fire immediately if past)
//--------------------------------------------------------------
function ffmComputeNextADSRun(rule) {
  try {
    const now = Date.now();
    const [hour, minute] = (String(rule && rule.preferredTime || '04:30')).split(":").map(n => parseInt(n, 10));

    // Build today’s target time
    let next = new Date();
    next.setHours(hour, minute, 0, 0);

    // If time already passed → run immediately (user-set behavior A)
    if (next.getTime() < now) {
      try { console.log("[AutoList Pro Scheduler] Time passed → scheduling immediate ADS run (10 sec)"); } catch (e) {}
      return now + 10_000; // 10 seconds from now
    }

    // Otherwise → schedule later today
    return next.getTime();
  } catch (e) {
    try { console.warn('[AutoList Pro Scheduler] ffmComputeNextADSRun failed', e); } catch(_){}
    return Date.now() + 10_000;
  }
}

//--------------------------------------------------------------
// Create / update daily ADS alarm using correct preferredTime
//--------------------------------------------------------------
function ffmScheduleDailyADS(rule) {
  try {
    const whenTs = ffmComputeNextADSRun(rule);

    chrome.alarms.create(FFM_SCHED_DAILY_ALARM, {
      when: whenTs,
      periodInMinutes: 1440 // 24 hours
    });

    // NEW: Include listing titles in the scheduling log when available
    try {
      if (rule && typeof rule === 'object') {
        const title = rule.listingTitle || rule.inventoryName || rule.id || '(unknown)';
        console.log("[FFM Scheduler] Daily ADS alarm scheduled for", title, "→", new Date(whenTs));
      } else {
        // Fallback: load all rules and surface enabled rule titles
        try {
          chrome.storage.local.get([FFM_SCHED_ADV_RULES_KEY], (res) => {
            try {
              const all = (res && res[FFM_SCHED_ADV_RULES_KEY]) || {};
              const enabled = Object.values(all).filter(r => r && r.enabled);
              const titles = enabled.map(r => r.listingTitle || r.inventoryName || r.id || '(unknown)');
              if (titles.length > 0) {
                console.log("[FFM Scheduler] Daily ADS alarm scheduled for", titles.join(", "), "→", new Date(whenTs));
              } else {
                console.log("[FFM Scheduler] Daily ADS alarm scheduled (no active rules) →", new Date(whenTs));
              }
            } catch (e) {
              console.log("[FFM Scheduler] Daily ADS alarm scheduled →", new Date(whenTs));
            }
          });
        } catch (e) {
          console.log("[FFM Scheduler] Daily ADS alarm scheduled →", new Date(whenTs));
        }
      }
    } catch(e) {}
  } catch (err) {
    try { console.warn("[FFM Scheduler] Failed to schedule ADS:", err); } catch(e) {}
  }
}

// -----------------------------
// ADS per-listing alarm helpers
// -----------------------------

function ffmAdsComputeNextRunForRule(rule, nowMs) {
  try {
    if (!rule || !rule.enabled) return null;

    const now = nowMs || Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // 1) If the rule already has a future nextRunAt, honor it.
    const existingNext = rule.nextRunAt ? Number(rule.nextRunAt) : 0;
    if (existingNext && existingNext > now + 5_000) {
      return existingNext;
    }

    // 2) Otherwise, compute from time-of-day + daysActive interval.
    //    If `rule.activeSinceMs` is present (populated during rebuild),
    //    treat daysActive as the number of days since activeSinceMs when
    //    the job should first run (e.g. relist after N days active).
    const intervalDays = Number(rule.daysActive || 1);
    const timeStr = rule.time || rule.preferredTime || "04:30";

    const [hhStr, mmStr] = String(timeStr || "").split(":");
    const hh = parseInt(hhStr || "0", 10) || 0;
    const mm = parseInt(mmStr || "0", 10) || 0;

    // Decide base timestamp for scheduling.
    // - First-time setup: prefer `activeSinceMs` (commonly populated from lastActiveSync)
    // - After ADS successfully runs a relist/publish, prefer `lastRun` (actual publish time)
    // This ensures the initial nextRun honors the Active Sync, but subsequent
    // repeats are based on the real relist timestamp.
    const activeSince = rule && rule.activeSinceMs ? Number(rule.activeSinceMs) : 0;
    const lastRunMs = rule && (rule.lastRun || rule.lastRunAt) ? Number(rule.lastRun || rule.lastRunAt) : 0;

    if ((lastRunMs && lastRunMs > 0) || (activeSince && activeSince > 0)) {
      try {
        // Choose lastRun if present and reasonably recent, otherwise use activeSince
        const baseMs = (lastRunMs && lastRunMs > 0) ? lastRunMs : activeSince;
        const baseLabel = (baseMs === lastRunMs && lastRunMs > 0) ? 'lastRun' : 'activeSinceMs';
        const target = new Date(Number(baseMs) + (intervalDays * dayMs));
        target.setSeconds(0, 0);
        target.setHours(hh, mm, 0, 0);
        let when = target.getTime();

        // Advance forward in interval chunks until in the future
        while (when <= now) {
          when += intervalDays * dayMs;
        }

        try { console.log('[FFM Scheduler] computeNextRunForRule', { listingId: rule && rule.listingId, daysActive: intervalDays, base: baseLabel, baseTs: baseMs, computedNext: when ? new Date(when).toString() : null }); } catch (e) {}

        return when;
      } catch (e) {
        try { console.warn('[FFM Scheduler] base-timestamp scheduling failed', e); } catch(_) {}
      }
    }

    // Legacy / fallback: schedule starting from now and repeat every intervalDays
    let next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(hh, mm, 0, 0);

    let when = next.getTime();

    // If that window is already in the past, bump forward in chunks
    // of intervalDays until it's in the future.
    while (when <= now) {
      when += intervalDays * dayMs;
    }

    return when;
  } catch (e) {
    try { console.warn('[FFM Scheduler] ffmAdsComputeNextRunForRule failed', e); } catch(_) {}
    return null;
  }
}

// (debug helper removed)

// Try to locate listing-level active metadata from chrome.storage.local.
// Returns { isActive: boolean, activeSinceMs: number|null } or null.
async function ffmFetchListingActiveInfo(listingId) {
  try {
    if (!listingId) return null;
    const snap = await new Promise((res) => { try { chrome.storage.local.get(null, res); } catch (e) { res({}); } });
    if (!snap || typeof snap !== 'object') return null;

    // First, look for keys that explicitly include the listingId
    const candidateKeys = Object.keys(snap || {}).filter(k => k && k.includes(String(listingId)));
    const candidates = candidateKeys.map(k => snap[k]);

    // Also include any top-level objects that look like a listing object
    for (const k of Object.keys(snap || {})) {
      const v = snap[k];
      if (v && typeof v === 'object') {
        if (String(v.listingId || v.id || v.uid || '').includes(String(listingId))) candidates.push(v);
      }
    }

    for (const obj of (candidates || [])) {
      if (!obj || typeof obj !== 'object') continue;
      // Detect active flag
      const isActive = (obj.active === true) || (String(obj.status || '').toLowerCase() === 'active') || (obj.published === true) || (obj.isActive === true);
      // Possible timestamp fields (include alternative names used elsewhere)
      const candDates = [ 'activeSince', 'activeAt', 'publishedAt', 'firstActiveAt', 'createdAt', 'lastPublishedAt', 'postPublishedAt', 'lastPublished', 'ffm_lastPublished', 'timestamp' ];
      let activeSinceMs = null;
      for (const f of candDates) {
        if (typeof obj[f] !== 'undefined' && obj[f] !== null) {
          const v = obj[f];
          if (typeof v === 'number' && !Number.isNaN(v) && v > 0) { activeSinceMs = Number(v); break; }
          if (typeof v === 'string' && v.trim()) {
            const p = Date.parse(v);
            if (!Number.isNaN(p)) { activeSinceMs = p; break; }
          }
        }
      }

      // If the listing has a precomputed days-active value (popup sets `_ffm_daysActive`),
      // derive an approximate activeSinceMs from it (now - days*24h).
      try {
        if ((!activeSinceMs || activeSinceMs === null) && typeof obj._ffm_daysActive !== 'undefined' && obj._ffm_daysActive !== null) {
          const days = Number(obj._ffm_daysActive);
          if (!Number.isNaN(days) && days >= 0) {
            activeSinceMs = Date.now() - Math.round(days * dayMs);
          }
        }
      } catch (e) {}

      // If no explicit date found but lastPublishedAt exists as string numeric, try that
      if (!activeSinceMs && obj.lastPublishedAt) {
        const lp = Number(obj.lastPublishedAt);
        if (!Number.isNaN(lp) && lp > 0) activeSinceMs = lp;
      }

      if (isActive || activeSinceMs) {
        return { isActive: !!isActive, activeSinceMs: activeSinceMs || null };
      }
    }

    return null;
  } catch (e) {
    try { console.warn('[FFM Scheduler] ffmFetchListingActiveInfo error', e); } catch (_) {}
    return null;
  }
}

// Ensure rule object has `activeSinceMs` when possible by scanning storage and
// persisting the enriched rule back to the ADS rules set so future rebuilds
// can reuse it synchronously.
async function ffmEnrichRuleWithListingActiveInfo(listingId, rule) {
  try {
    if (!rule || !listingId) return;

    // Allow enrichment to compare/overwrite existing `activeSinceMs` when
    // storage-derived listing info is fresher. Older code returned early
    // whenever a rule had `activeSinceMs`, preventing updates after DnR/publish.
    // (We now perform the comparison below.)

    const info = await ffmFetchListingActiveInfo(listingId);
    if (!info) return;

    if (info.activeSinceMs) {
      const fetched = Number(info.activeSinceMs);
      const existing = rule.activeSinceMs ? Number(rule.activeSinceMs) : 0;
      // Temporary debug for investigating stale activeSinceMs issues
      try {
        if (String(listingId) === 'ffm_1766654635081_3975b') {
          try { console.debug('[FFM Scheduler][ENRICH DEBUG] listingId', listingId, 'fetched=', new Date(fetched).toString(), 'existing=', existing ? new Date(existing).toString() : 'none'); } catch (e) {}
        }
      } catch (e) {}
      // Overwrite if missing or the fetched timestamp is newer by >1 hour
      if (!existing || fetched > (existing + (60 * 60 * 1000))) {
        rule.activeSinceMs = fetched;
        // Clear any previously computed nextRunAt from the popup so background
        // recomputes using the authoritative activeSinceMs value.
        try { delete rule.nextRunAt; } catch (e) {}
      }
    }

    // Persist back into the ADS rules store so subsequent sync callers can rely on it
    try {
      const snap = await new Promise((r) => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], r); } catch (e) { r({}); } });
      const rules = (snap && snap[FFM_ADS_RULES_KEY]) ? snap[FFM_ADS_RULES_KEY] : {};
      rules[listingId] = Object.assign({}, rules[listingId] || {}, rule);
      await new Promise(r => { try { chrome.storage.local.set({ [FFM_ADS_RULES_KEY]: rules }, r); } catch (e) { r(); } });
      // persisted enriched rule
    } catch (e) {
      try { console.warn('[FFM Scheduler] failed to persist enriched rule', e); } catch(_) {}
    }
  } catch (e) { try { console.warn('[FFM Scheduler] ffmEnrichRuleWithListingActiveInfo failed', e); } catch(_) {} }
}

async function ffmAdsRebuildPerListingAlarms() {
  try {
    let totalRules = 0;
    let jobsCreated = 0;
    let jobsRescheduled = 0;
    let jobsSkipped = 0;
    const now = Date.now();

    const stored = await new Promise((res) => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], res); } catch (e) { res({}); } });
    const rules = (stored && stored[FFM_ADS_RULES_KEY]) ? stored[FFM_ADS_RULES_KEY] : {};

    const alarmsAll = await new Promise((res) => { try { chrome.alarms.getAll(res); } catch (e) { res([]); } });

    const adsAlarmNames = (alarmsAll || []).filter(a => a && (a.name === "ffm_auto_dnr_daily" || (a.name && a.name.startsWith(FFM_ADS_ALARM_PREFIX)))).map(a => a.name);
    if (adsAlarmNames.length) {
      await Promise.all(adsAlarmNames.map(n => new Promise((r) => { try { chrome.alarms.clear(n, () => r(true)); } catch (e) { r(false); } } )));
    }

    for (const [listingId, rule] of Object.entries(rules || {})) {
      totalRules++;
      if (!rule || !rule.enabled) {
        jobsSkipped++;
        try { console.warn('[ADS rebuild] job skipped', { listingId, reason: 'missing_or_disabled' }); } catch (e) {}
        continue;
      }
      // Try to enrich the rule with listing active info (activeSinceMs) so
      // days-active based schedules are computed against the real active date.
      try { await ffmEnrichRuleWithListingActiveInfo(listingId, rule); } catch (e) {}
      const when = ffmAdsComputeNextRunForRule(rule, now);
      // Targeted debug for rules that appear to schedule incorrectly
      try {
        if (String(listingId) === 'ffm_1766654635081_3975b') {
          try { console.debug('[FFM Scheduler][DEBUG] rule for', listingId, 'daysActive=', rule.daysActive, 'activeSinceMs=', rule.activeSinceMs ? new Date(Number(rule.activeSinceMs)).toString() : 'none', 'computedWhen=', when ? new Date(Number(when)).toString() : 'null'); } catch (e) {}
        }
      } catch (e) {}
      if (!when) {
        jobsSkipped++;
        try { console.warn('[ADS rebuild] job skipped', { listingId, reason: 'no_schedule_computed' }); } catch (e) {}
        continue;
      }
      const alarmName = ffmAdsAlarmNameFor(listingId);
      try {
        // Schedule a short pre-warm alarm 1 minute before the actual fire time
        try {
          const PREWARM_AT = Number(when) - 60_000;
          if (PREWARM_AT > Date.now()) {
            try { chrome.alarms.create(ffmAdsPrewarmAlarmName(listingId), { when: PREWARM_AT }); } catch (e) {}
            try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.alarmsCreated = (globalThis.__ffmTrace.counters.alarmsCreated||0)+1; } catch (e) {}
            try { ffmTraceEvent('alarm-created-prewarm', { listingId: listingId, when: PREWARM_AT }); } catch (e) {}
          }
        } catch (e) {}
        chrome.alarms.create(alarmName, { when, periodInMinutes: 1440 });
        try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.alarmsCreated = (globalThis.__ffmTrace.counters.alarmsCreated||0)+1; } catch (e) {}
        try { ffmTraceEvent('alarm-created', { listingId: listingId, when: when }); } catch (e) {}
        // Stamp intent metadata for authoritative scheduled runs so fire-time logic can trust the alarm.
        try {
          const metaKey = 'ffm_alarm_meta_' + String(alarmName || '');
          const meta = { authoritative: true, ruleId: rule && rule.id ? rule.id : null, scheduledAt: when };
          try { chrome.storage.local.set({ [metaKey]: meta }, () => {}); } catch (e) {}
        } catch (e) {}
        jobsCreated++;
        try { console.log("[FFM Scheduler] ADS alarm scheduled for", rule.listingTitle || listingId, "→", new Date(when)); } catch (e) {}
      } catch (e) { try { console.warn('[FFM Scheduler] Failed to create ADS alarm for', listingId, e); } catch(_){} }
    }

    // Determine active ADS alarms count
    let alarmsActive = 0;
    try {
      const currentAlarms = await new Promise((r) => { try { chrome.alarms.getAll(r); } catch (e) { r([]); } });
      alarmsActive = (currentAlarms || []).filter(a => a && (a.name === "ffm_auto_dnr_daily" || (a.name && a.name.startsWith(FFM_ADS_ALARM_PREFIX)))).length;
    } catch (e) { alarmsActive = 0; }

    return { totalRules, jobsCreated, jobsRescheduled, jobsSkipped, alarmsActive };
  } catch (e) {
    try { console.warn('[FFM Scheduler] ffmAdsRebuildPerListingAlarms error', e); } catch (er) {}
  }
}

function ffmAdsIsRuleDue(rule, nowMs) {
  try {
    if (!rule || !rule.enabled) return false;
    const now = nowMs || Date.now();

    // Preferred ADS path: driven by nextRunAt (set by wizard / reschedules)
    const nextRun = rule.nextRunAt ? Number(rule.nextRunAt) : 0;
    if (nextRun) {
      // Small fudge window (30s) so we don’t miss by a hair
      return now >= (nextRun - 30_000);
    }

    // Fallback: legacy behavior based on lastPublishedAt (for old rules)
    if (!rule.lastPublishedAt) return false;

    const dayMs = 24 * 60 * 60 * 1000;
    const minAgeDays = Number(rule.daysActive || 1);
    const ageDays = (now - Number(rule.lastPublishedAt)) / dayMs;
    return ageDays >= minAgeDays;
  } catch (e) {
    return false;
  }
}

async function ffmAdsHandleAlarmForListing(listingId, alarm) {
  try {
    const now = Date.now();
    const [rSnap, pSnap] = await Promise.all([
      new Promise((res) => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], res); } catch (e) { res({}); } }),
      new Promise((res) => { try { chrome.storage.local.get([FFM_ADS_PREFS_KEY], res); } catch (e) { res({}); } })
    ]);

    const rules = (rSnap && rSnap[FFM_ADS_RULES_KEY]) ? rSnap[FFM_ADS_RULES_KEY] : {};
    const prefs = (pSnap && pSnap[FFM_ADS_PREFS_KEY]) ? pSnap[FFM_ADS_PREFS_KEY] : { suppressMissedWarning: false, testMode: false };

    const rule = rules[listingId];
    if (!rule || !rule.enabled) {
      try { console.log('[FFM Scheduler] ADS alarm fired but rule missing/disabled', listingId); } catch (e) {}
      try { chrome.alarms.clear(ffmAdsAlarmNameFor(listingId)); } catch (e) {}
      return;
    }

    // -------------------------------------------
    // REAL-WORLD MISSED-RUN DETECTION PATCH
    // -------------------------------------------
    try {
      const wins = await chrome.windows.getAll();
      if (!wins || wins.length === 0) {
        return ffmAdsMarkMissedRun(rule, "Chrome was closed, so ADS could not create the required FB tabs.");
      }
      if (wins.length === 1 && wins[0] && wins[0].state === 'minimized') {
        return ffmAdsMarkMissedRun(rule, "Chrome was running in background mode and could not open FB tabs.");
      }
    } catch (e) {
      console.warn('[ADS] Headless detection error', e);
    }

    const title = rule.listingTitle || listingId;
    const scheduled = alarm && alarm.scheduledTime ? new Date(alarm.scheduledTime) : new Date(now);
    try { console.log('[FFM Scheduler] ADS alarm fired for', title, 'at', scheduled); } catch (e) {}

    // Telemetry: warn if this fire did not have a pre-warm
    try {
      if (!(globalThis && globalThis.ffmAdsWarm)) {
        try { console.warn('[ADS] Fire occurred without warm state — continuing anyway'); } catch (e) {}
      }
    } catch (e) {}

    // Determine if this alarm was created as an authoritative scheduled alarm.
    let alarmIsAuthoritative = false;
    try {
      if (alarm && alarm.name) {
        const metaKey = 'ffm_alarm_meta_' + String(alarm.name || '');
        try {
          const snap = await new Promise((r) => { try { chrome.storage.local.get([metaKey], r); } catch (e) { r({}); } });
          const meta = snap && snap[metaKey] ? snap[metaKey] : null;
          if (meta && meta.authoritative) alarmIsAuthoritative = true;
        } catch (e) {}
      }
    } catch (e) {}

    // ADS alarm is authoritative — skip rule validation. Otherwise, re-evaluate rules.
    if (!alarmIsAuthoritative) {
      // Not due yet? Just bounce, and DO NOT log history.
      if (!ffmAdsIsRuleDue(rule, now)) {
        try {
          const nextRunAt = rule.nextRunAt ? Number(rule.nextRunAt) : null;
          const lastPublishedAt = rule.lastPublishedAt ? Number(rule.lastPublishedAt) : null;
          const daysActive = Number(rule.daysActive || rule.repeatEvery || 1) || 1;
          try { console.log('[FFM Scheduler] Rule not due yet for', title); } catch (e) {}
          try { console.debug('[FFM Scheduler] Rule details: nextRunAt=', nextRunAt ? new Date(nextRunAt).toString() : 'none', 'lastPublishedAt=', lastPublishedAt ? new Date(lastPublishedAt).toString() : 'none', 'daysActive=', daysActive); } catch (e) {}

          // Send a notification similar to missed-run so the user knows why this didn't run
          try {
            const nowTs = Date.now();
            await ffmNotifyAppend({
              id: ffmNotifyGenerateId(),
              type: 'ads-not-due',
              level: 'info',
              createdAt: nowTs,
              listingId: rule.listingId,
              ruleId: rule.id,
              title: `Scheduled ADS not run — ${rule.listingTitle || rule.inventoryName || rule.listingId}`,
              message: `Rule evaluated as not due at ${new Date(nowTs).toLocaleString()}.
nextRunAt: ${nextRunAt ? new Date(nextRunAt).toLocaleString() : 'none'}
lastPublishedAt: ${lastPublishedAt ? new Date(lastPublishedAt).toLocaleString() : 'none'}
daysActive: ${daysActive}`,
              read: false
            });
          } catch (e) { try { console.warn('[ADS] Failed to append not-due notification', e); } catch (er) {} }

          return;
        } catch (e) {
          try { console.debug('[FFM Scheduler] Rule not-due branch failed', e); } catch (er) {}
          return;
        }
      }
    } else {
      try { console.log('[FFM Scheduler] ADS alarm authoritative — skipping rule validation for', title); } catch (e) {}
    }

    // 🔥 Execute Auto-DnR (scheduled only)
    let runStatus = 'unknown';
    let runNote = '';
    let ok = true;

    // Create enriched run record for this scheduled run
    const runRecord = ffmAdsBuildRunRecord();
    runRecord.stage = 'init';
    runRecord.time = Date.now();

    if (prefs.testMode) {
      runStatus = 'test';
      runNote = 'Test mode — DnR not actually run';
      try { console.log('[Auto-DnR TEST MODE] Would run DnR for:', listingId, rule); } catch (e) {}
    } else {
      try {
        const res = await ffmSchedulerExecuteAutoDnR({ listingId, rule, runRecord });
        // Treat explicit false as failure; undefined/true as success.
        ok = (res !== false);
      } catch (e) {
        ok = false;
        try { console.warn('[FFM Scheduler] execute AutoDnR failed', e); } catch (_) {}
      }

      if (ok) {
        runStatus = 'success';
        runNote = 'Auto DnR completed';
      } else {
        runStatus = 'failed';
        runNote = 'Auto DnR failed (delete or publish did not complete)';
      }
    }

    // 📝 Update lastRun + history (scheduled runs ONLY)
    try {
      runRecord.stage = runRecord.stage === 'delete-complete' && ok ? 'complete' : (runRecord.stage || (ok ? 'complete' : 'error'));
      runRecord.success = !!ok;
      runRecord.message = runNote || (ok ? 'Auto DnR completed and republished' : 'Auto DnR failed');
      runRecord.time = runRecord.time || now;

      // Ensure delete timing fields exist and compute defaults
      const deleteStart = runRecord.deleteStart || null;
      const deleteEnd = runRecord.deleteEnd || deleteStart;
      const deleteDurationMs = typeof runRecord.deleteDurationMs === 'number' ? runRecord.deleteDurationMs : (deleteStart && deleteEnd ? (deleteEnd - deleteStart) : 0);

      // ====== PUBLISH TIMING SAFETY (Option A) ======
      // Default publish timing to deleteEnd so history always shows sensible values.
      const publishStartDefault = (runRecord.publishStart != null) ? runRecord.publishStart : deleteEnd;
      const publishEndDefault = (runRecord.publishEnd != null) ? runRecord.publishEnd : deleteEnd;
      const publishDurationDefault = (typeof runRecord.publishDurationMs === 'number') ? runRecord.publishDurationMs : 0;

      runRecord.deleteStart = deleteStart;
      runRecord.deleteEnd = deleteEnd;
      runRecord.deleteDurationMs = deleteDurationMs;

      runRecord.publishStart = publishStartDefault;
      runRecord.publishEnd = publishEndDefault;
      runRecord.publishDurationMs = publishDurationDefault;

      // Total runtime (delete + publish). If publish hasn't happened yet, this will equal deleteDurationMs.
      runRecord.totalDurationMs = (deleteDurationMs || 0) + (publishDurationDefault || 0);
    } catch (e) {}

    rule.lastRun = runRecord.time || now;
    rule.lastRunStatus = runRecord.success ? 'success' : (runStatus || 'failed');
    rule.lastRunNote = runRecord.message || runNote;

    // Append runRecord to history (keep newest at end), cap to last 50
    try {
      rule.history = Array.isArray(rule.history) ? rule.history : [];
      rule.history.push(runRecord);
      if (rule.history.length > 50) rule.history = rule.history.slice(-50);
    } catch (e) {}

    try {
      if (typeof ffmAdsEvaluateAutoDeleteForRule === 'function') {
        // Run evaluator asynchronously (do not block alarm handling)
        try { ffmAdsEvaluateAutoDeleteForRule(rule); } catch (e) { /* non-fatal */ }
      }
    } catch (e) {}

    rules[listingId] = rule;

    // 🔁 Compute & schedule next run, and persist updated rules
    const nextWhen = ffmAdsComputeNextRunForRule(rule, now);
    try { console.log('[FFM Scheduler] reschedule computed nextWhen', { listingId, nextWhen: nextWhen ? new Date(nextWhen).toString() : null, daysActive: rule.daysActive, lastRun: rule.lastRun ? new Date(Number(rule.lastRun)).toString() : null, activeSinceMs: rule.activeSinceMs ? new Date(Number(rule.activeSinceMs)).toString() : null }); } catch (e) {}
    if (nextWhen) {
      // After a scheduled run completes successfully, prefer subsequent scheduling
      // from the actual run timestamp. Clear stored `activeSinceMs` so rebuilds
      // don't accidentally use stale Active Sync values.
      try {
        if (rule && rule.lastRun) {
          try { delete rule.activeSinceMs; } catch (e) {}
        }
      } catch (e) {}
      rule.nextRunAt = nextWhen;
      rules[listingId] = rule;

      try { chrome.storage.local.set({ [FFM_ADS_RULES_KEY]: rules }); } catch (e) {}

      const alarmName = ffmAdsAlarmNameFor(listingId);
      try {
        // Schedule pre-warm 1 minute prior to the firing time
        try {
          const PREWARM_AT = Number(nextWhen) - 60_000;
          if (PREWARM_AT > Date.now()) {
            try { chrome.alarms.create(ffmAdsPrewarmAlarmName(listingId), { when: PREWARM_AT }); } catch (e) {}
          }
        } catch (e) {}

        chrome.alarms.create(alarmName, { when: nextWhen, periodInMinutes: 1440 });
        try { console.log('[FFM Scheduler] created alarm', { alarmName, when: new Date(nextWhen).toString(), periodInMinutes: 1440 }); } catch (e) {}
        try {
          const metaKey = 'ffm_alarm_meta_' + String(alarmName || '');
          const meta = { authoritative: true, ruleId: rule && rule.id ? rule.id : null, scheduledAt: nextWhen };
          try { chrome.storage.local.set({ [metaKey]: meta }, () => {}); } catch (e) {}
        } catch (e) {}
      } catch (e) {}
      try { console.log('[FFM Scheduler] ADS alarm rescheduled for', title, '→', new Date(nextWhen)); } catch (e) {}
    } else {
      // No future run => clear alarm, persist final state
      try { chrome.alarms.clear(ffmAdsAlarmNameFor(listingId)); } catch (e) {}
      try { chrome.storage.local.set({ [FFM_ADS_RULES_KEY]: rules }); } catch (e) {}
      try { console.log('[FFM Scheduler] ADS rule has no future run, alarm cleared for', title); } catch (e) {}
    }
  } catch (e) {
    try { console.error('[FFM Scheduler] ffmAdsHandleAlarmForListing error', listingId, e); } catch (er) {}
  }
}

// One-time cleanup: remove ADS rules left behind for listings that no longer
// exist (deleted from Saved Listings some time ago, but the daily/forever
// schedule rule itself never got removed because it had already stopped
// rendering in the popup UI). These orphaned "everyday, forever" rules are
// what kept producing zero-alarm rebuilds and endless boot-restore retries.
async function ffmAdsPruneOrphanedForeverRules(reason = "unknown") {
  try {
    if (globalThis.__ffmAdsPruneRunning) return { pruned: 0, checked: 0 };
    globalThis.__ffmAdsPruneRunning = true;
    try {
      const [rulesSnap, savedSnap, canonicalSnap] = await Promise.all([
        new Promise((res) => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], res); } catch (e) { res({}); } }),
        new Promise((res) => { try { chrome.storage.local.get(['ffm_saved_listings', 'listings'], res); } catch (e) { res({}); } }),
        new Promise((res) => { try { chrome.storage.local.get(['ffmCanonicalListings'], res); } catch (e) { res({}); } })
      ]);

      const rules = (rulesSnap && rulesSnap[FFM_ADS_RULES_KEY]) ? rulesSnap[FFM_ADS_RULES_KEY] : {};
      const savedArr = Array.isArray(savedSnap && savedSnap.ffm_saved_listings)
        ? savedSnap.ffm_saved_listings
        : (Array.isArray(savedSnap && savedSnap.listings) ? savedSnap.listings : []);
      const canonicalMap = (canonicalSnap && canonicalSnap.ffmCanonicalListings && typeof canonicalSnap.ffmCanonicalListings === 'object')
        ? canonicalSnap.ffmCanonicalListings
        : {};

      const validIds = new Set();
      try {
        for (const l of savedArr) {
          if (!l) continue;
          if (l.id) validIds.add(String(l.id));
          if (l.listingId) validIds.add(String(l.listingId));
        }
      } catch (e) {}
      try {
        for (const k of Object.keys(canonicalMap || {})) validIds.add(String(k));
      } catch (e) {}

      let checked = 0;
      let pruned = 0;
      const toClearAlarms = [];
      for (const [listingId, rule] of Object.entries(rules || {})) {
        checked++;
        if (!rule || !rule.enabled) continue;
        const daysActive = Number(rule.daysActive || 1);
        const isEveryday = daysActive <= 1;
        const isForever = rule.repeat !== false && rule.repeat !== 'once' && !rule.runOnce;
        if (!isEveryday || !isForever) continue;
        if (validIds.has(String(listingId))) continue;

        // Rule references a listing that no longer exists anywhere (Saved
        // Listings or canonical/active listings) — this is exactly the
        // "schedule that was never deleted" case. Remove it.
        delete rules[listingId];
        toClearAlarms.push(listingId);
        pruned++;
        try { console.warn('[FFM Scheduler] Pruned orphaned daily/forever ADS rule', { listingId, title: rule.listingTitle || null, reason }); } catch (e) {}
      }

      if (pruned > 0) {
        try { await new Promise((r) => { try { chrome.storage.local.set({ [FFM_ADS_RULES_KEY]: rules }, r); } catch (e) { r(); } }); } catch (e) {}
        await Promise.all(toClearAlarms.map((listingId) => Promise.all([
          new Promise((r) => { try { chrome.alarms.clear(ffmAdsAlarmNameFor(listingId), () => r(true)); } catch (e) { r(false); } }),
          new Promise((r) => { try { chrome.alarms.clear(ffmAdsPrewarmAlarmName(listingId), () => r(true)); } catch (e) { r(false); } }),
          new Promise((r) => { try { chrome.storage.local.remove('ffm_alarm_meta_' + ffmAdsAlarmNameFor(listingId), () => r(true)); } catch (e) { r(false); } })
        ])));
        try { console.warn('[FFM Scheduler] ADS orphaned-rule cleanup complete', { checked, pruned }); } catch (e) {}
      }

      return { checked, pruned };
    } finally {
      globalThis.__ffmAdsPruneRunning = false;
    }
  } catch (e) {
    try { console.warn('[FFM Scheduler] ffmAdsPruneOrphanedForeverRules error', e); } catch (er) {}
    return { checked: 0, pruned: 0 };
  }
}

// Wrapper to prevent multiple ADS rebuilds running on the same startup
async function ffmAdsRebuildAllAlarms(reason = "unknown") {
  try {
    try { ffmSchedLog('ADS rebuild executing. Reason:', reason); } catch (e) {}
    try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.rebuilds = (globalThis.__ffmTrace.counters.rebuilds || 0) + 1; } catch (e) {}
    try { ffmTraceEvent('rebuild-start', { reason: reason }); } catch (e) {}
    // Prevent concurrent rebuilds which can spawn many alarms and heavy work
    if (globalThis.__ffmAdsRebuildRunning) {
      try { console.debug('[FFM Scheduler] ffmAdsRebuildAllAlarms skipped — already running'); } catch (e) {}
      return;
    }
    globalThis.__ffmAdsRebuildRunning = true;
    try {
      if (typeof ffmAdsRebuildPerListingAlarms === 'function') {
        try {
          const summary = await ffmAdsRebuildPerListingAlarms();
        try { console.log('[ADS rebuild] jobs:', {
          totalRules: summary && typeof summary.totalRules === 'number' ? summary.totalRules : 0,
          jobsCreated: summary && typeof summary.jobsCreated === 'number' ? summary.jobsCreated : 0,
          jobsRescheduled: summary && typeof summary.jobsRescheduled === 'number' ? summary.jobsRescheduled : 0,
          jobsSkipped: summary && typeof summary.jobsSkipped === 'number' ? summary.jobsSkipped : 0,
          alarmsActive: summary && typeof summary.alarmsActive === 'number' ? summary.alarmsActive : 0
        }); } catch (e) {}
        // Persist a storage-backed readiness marker so boot-restores from a
        // new service worker can detect that the ADS core has completed an
        // initial rebuild and is ready. This is more robust than relying
        // solely on in-memory flags which are lost across SW restarts.
        try {
          try { chrome.storage && chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ ffm_ads_core_ready: Date.now() }); } catch (e) {}
        } catch (e) {}
        } catch (e) { try { console.warn('[FFM Scheduler] ffmAdsRebuildPerListingAlarms failed', e); } catch(_){} }
      }
    } finally {
      try { globalThis.__ffmAdsRebuildRunning = false; } catch (e) {}
    }
  } catch (e) {
    try { console.warn('[FFM Scheduler] ffmAdsRebuildAllAlarms error', e); } catch (er) {}
  }
}

// ----------------------------------
// ADS Queue: enqueue and processor
// Signal that ADS core has finished loading and is ready for boot restores
try {
  globalThis.__ffm_ads_ready = true;
  try { console.warn('[FFM Scheduler] ADS core ready'); } catch (e) {}
} catch (e) {}
// ----------------------------------
// Enqueue an ADS job with a hard missed-run guard
function ffmAdsEnqueue(listingId, alarm) {
  try {
    (async () => {
      const now = Date.now();

      // Extract listingId if alarm name contains it
      let lid = listingId;
      if (!lid && alarm?.name?.includes("::")) {
        lid = alarm.name.split("::")[1];
      }
      if (!lid) {
        console.warn("[ADS Queue] Missing listingId for alarm", alarm);
        return;
      }

      // Load rule
      const { ffm_advanced_scheduler_rules: map = {} } =
        await chrome.storage.local.get("ffm_advanced_scheduler_rules");
      const rule = map[lid];
      if (!rule) return;

      const scheduled = rule.nextRunAt;
      const delivered = alarm?.scheduledTime || rule.nextRunAt;
      const lastRun = Number(rule.lastRun || 0);
      const MISSED_GRACE_MS = 15 * 1000;

      const nowTs = Date.now();

      // Alarm is missed ONLY if Chrome delivered it >15s late
      const isMissedRun =
        delivered + MISSED_GRACE_MS < nowTs &&
        (lastRun < scheduled - MISSED_GRACE_MS);

      if (isMissedRun) {
        console.warn("[ADS] Missed alarm detected →", lid);

        // LOG MISSED + RESCHEDULE
        if (typeof ffmAdsMarkMissedRun === "function") {
          await ffmAdsMarkMissedRun(rule, "chrome-inactive");
        }

        // DO NOT ENQUEUE, DO NOT RUN DnR
        return;
      }

      // --- NORMAL ON-TIME ALARM ---
      if (!globalThis.ffmAdsQueue) globalThis.ffmAdsQueue = [];
      globalThis.ffmAdsQueue.push({ listingId: lid, alarm });
      console.log("[ADS Queue] Enqueued job →", lid);
      try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.adsEnqueued = (globalThis.__ffmTrace.counters.adsEnqueued||0)+1; } catch (e) {}
      try { ffmTraceEvent('ads-enqueued', { listingId: lid }); } catch (e) {}

      ffmAdsProcessQueue();
    })();
  } catch (e) {
    console.error("[ADS Queue] enqueue failed:", e);
  }
}
// Processor stays the same, just operates on jobs that made it past the guard
async function ffmAdsProcessQueue() {
  try {
    if (globalThis.ffmAdsQueueRunning) return;
    if (!globalThis.ffmAdsQueue || globalThis.ffmAdsQueue.length === 0) return;

    globalThis.ffmAdsQueueRunning = true;
    try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.adsQueueRuns = (globalThis.__ffmTrace.counters.adsQueueRuns||0)+1; } catch (e) {}
    try { console.log('[ADS Queue] Processing started. Jobs:', globalThis.ffmAdsQueue.length); } catch (e) {}

    let ffmAdsProcessedCount = 0;
    while (globalThis.ffmAdsQueue && globalThis.ffmAdsQueue.length > 0) {
      const job = globalThis.ffmAdsQueue.shift();
      if (!job) continue;
      const listingId = job.listingId;
      // Stagger queued jobs: wait 1 minute per previously-processed job
      try {
        if (ffmAdsProcessedCount > 0) {
          const delayMs = Number(ffmAdsProcessedCount) * 60000; // 1 minute per additional listing
          try { console.log('[ADS Queue] staggering next job by', delayMs, 'ms for', listingId); } catch (e) {}
          await new Promise(r => setTimeout(r, delayMs));
        }
      } catch (e) { /* non-fatal */ }
      try { console.log('[ADS Queue] Starting DnR for', listingId); } catch (e) {}

      try {
        // Call existing handler for scheduled alarm runs (performs delete + schedules publish via SDNR flow)
        await ffmAdsHandleAlarmForListing(listingId, job.alarm);
        try { console.log('[ADS Queue] Completed DnR for', listingId); } catch (e) {}

        // Wait for the publish phase (triggered asynchronously by SDNR) to complete
        // before notifying and proceeding to the next job. This prevents the next
        // queued job from stealing focus while a publish is in progress.
        const ffmWaitForListingPublishComplete = async (lid, timeoutMs = 120000, pollMs = 500) => {
          try {
            const start = Date.now();
            while (Date.now() - start < Number(timeoutMs || 120000)) {
              const snap = await new Promise(res => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], res); } catch (e) { res({}); } });
              const rules = (snap && snap[FFM_ADS_RULES_KEY]) ? snap[FFM_ADS_RULES_KEY] : {};
              const rule = rules && rules[lid] ? rules[lid] : null;
              if (rule && Array.isArray(rule.history) && rule.history.length) {
                const last = rule.history[rule.history.length - 1];
                // publishEndWallTime or a positive publishDurationMs implies publish finished
                if (last && ((typeof last.publishDurationMs === 'number' && last.publishDurationMs > 0) || (typeof last.publishEndWallTime === 'number' && last.publishEndWallTime > 0) || last.publishEndWallTime)) {
                  return true;
                }
                // If last entry has stage 'complete' and success true, assume publish finished
                if (last && (last.stage === 'complete' || last.success === true) && (last.publishDurationMs || last.publishEndWallTime || last.totalDurationMs)) {
                  return true;
                }
              }
              // Additionally, if an SDnR run is still active for this listing, wait until it clears.
              try {
                const active = globalThis && globalThis.__ffmActiveSDnR ? globalThis.__ffmActiveSDnR : null;
                if (active) {
                  if (active.runKey) {
                    await new Promise(r => setTimeout(r, Number(pollMs || 500)));
                    continue;
                  }
                  if (active[lid]) {
                    await new Promise(r => setTimeout(r, Number(pollMs || 500)));
                    continue;
                  }
                }
              } catch (e) { /* ignore global check errors */ }

              // Also wait while the session-level publish lock is present (a publish is in progress)
              try {
                const sess = await new Promise(res => { try { chrome.storage.session.get(['ffm_publish_in_progress'], res); } catch (e) { res({}); } });
                if (sess && sess.ffm_publish_in_progress) {
                  await new Promise(r => setTimeout(r, Number(pollMs || 500)));
                  continue;
                }
              } catch (e) { /* ignore session read errors */ }
              // Also check in-memory publishInFlight set for any publish request ids
              try {
                if (typeof publishInFlight !== 'undefined' && publishInFlight && typeof publishInFlight[Symbol.iterator] === 'function') {
                  for (const pid of publishInFlight) {
                    try {
                      if (String(pid).includes(String(lid))) {
                        await new Promise(r => setTimeout(r, Number(pollMs || 500)));
                        continue;
                      }
                    } catch (e) {}
                  }
                }
              } catch (e) {}
              // Also scan persistent local inflight markers for keys that include the listing id
              try {
                const all = await new Promise(res => { try { chrome.storage.local.get(null, res); } catch (e) { res({}); } });
                if (all && typeof all === 'object') {
                  const keys = Object.keys(all || {});
                  const inflKeys = keys.filter(k => k && k.startsWith('ffm_publish_inflight_') && k.includes(String(lid)));
                  if (inflKeys.length) {
                    // if any persistent inflight marker exists, wait
                    await new Promise(r => setTimeout(r, Number(pollMs || 500)));
                    continue;
                  }
                }
              } catch (e) { /* ignore local scan errors */ }
              await new Promise(r => setTimeout(r, Number(pollMs || 500)));
            }
            return false;
          } catch (e) {
            try { console.warn('[ADS Queue] ffmWaitForListingPublishComplete error', e); } catch (er) {}
            return false;
          }
        };

        try {
          const published = await ffmWaitForListingPublishComplete(listingId, 120000, 500);
          if (!published) {
            try { console.warn('[ADS Queue] publish for', listingId, 'did not complete within timeout; proceeding'); } catch (e) {}
          }
        } catch (e) {}

        try { await ffmNotifyAdsCompletionForListing(listingId); } catch (e) {}
      } catch (err) {
        try { console.error('[ADS Queue] DnR job error for', listingId, err); } catch (e) {}
      }

        try { if (globalThis && globalThis.__ffmTrace && globalThis.__ffmTrace.counters) globalThis.__ffmTrace.counters.adsProcessed = (globalThis.__ffmTrace.counters.adsProcessed||0)+1; } catch (e) {}
        try { ffmTraceEvent('ads-processed', { listingId: listingId }); } catch (e) {}
        // Count jobs processed in this run for staggering subsequent jobs
        try { ffmAdsProcessedCount++; } catch (e) {}

      
    }

    try { console.log('[ADS Queue] Duplicate Stack complete.'); } catch (e) {}
    try {
      // ADS finished fully — safe reboot boundary
      try { ffmSoftReset('ads-queue-complete'); } catch (e) { console.error('[AutoList Pro] ADS post-run soft reset failed', e); }
      try { ffmScheduleHardReload(15000); } catch (e) { console.error('[AutoList Pro] ADS post-run schedule reload failed', e); }
    } catch (e) {}
  } catch (err) {
    try { console.error('[ADS Queue] Processor error:', err); } catch (e) {}
  }
  try { ffmFinalizeRun('ads-queue-complete'); } catch (e) {}
  globalThis.ffmAdsQueueRunning = false;

  // -------------------------------
  // Minimal in-memory ADS attention UI (badge + notification)
  // -------------------------------
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.ffmAdsAttentionActive = globalThis.ffmAdsAttentionActive || false;
      globalThis.ffmAdsAttentionEvents = globalThis.ffmAdsAttentionEvents || [];
    }
  } catch (e) {}

  function ffmHandleAdsCompletion({ title, completedAt }) {
    try {
      try { globalThis.ffmAdsAttentionEvents = globalThis.ffmAdsAttentionEvents || []; } catch (e) { globalThis.ffmAdsAttentionEvents = []; }
      globalThis.ffmAdsAttentionEvents.push({ title: String(title || 'ADS task'), completedAt: completedAt || Date.now() });

      if (!globalThis.ffmAdsAttentionActive) {
        globalThis.ffmAdsAttentionActive = true;
        try { ffmShowAdsAttention(); } catch (e) {}
      } else {
        try { ffmUpdateAdsAttention(); } catch (e) {}
      }
    } catch (e) {}
  }

  function ffmShowAdsAttention() {
    try {
      const events = globalThis.ffmAdsAttentionEvents || [];
      const count = events.length || 0;
      try { chrome.action.setBadgeText({ text: String(count) }); } catch (e) {}
      try { chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' }); } catch (e) {}
      try { chrome.action.setTitle({ title: buildAdsTooltip() }); } catch (e) {}

      try {
        chrome.notifications.create('FFM_ADS_COMPLETE', {
          type: 'basic',
          iconUrl: 'images/icon128.png',
          title: '✅ Advanced Scheduler Complete',
          message: buildAdsMessage(),
          buttons: [ { title: 'Open AutoList Pro' } ],
          priority: 2,
          requireInteraction: true
        }, () => {});
      } catch (e) {}
    } catch (e) {}
  }

  function ffmUpdateAdsAttention() {
    try {
      const events = globalThis.ffmAdsAttentionEvents || [];
      const count = events.length || 0;
      try { chrome.action.setBadgeText({ text: String(count) }); } catch (e) {}
      try { chrome.action.setTitle({ title: buildAdsTooltip() }); } catch (e) {}
      try {
        try { chrome.notifications.clear('FFM_ADS_COMPLETE'); } catch (e) {}
        chrome.notifications.create('FFM_ADS_COMPLETE', {
          type: 'basic',
          iconUrl: 'images/icon128.png',
          title: `✅ Advanced Scheduler Complete (${count})`,
          message: buildAdsMessage(),
          buttons: [ { title: 'Open AutoList Pro' } ],
          priority: 2,
          requireInteraction: true
        }, () => {});
      } catch (e) {}
    } catch (e) {}
  }

  function buildAdsTooltip() {
    try {
      const list = (globalThis.ffmAdsAttentionEvents || []).slice(-5).map(e => `• ${e.title}`).join('\n');
      return `Advanced Scheduler completed ${ (globalThis.ffmAdsAttentionEvents || []).length } task(s)\n\n` + list + `\n\nClick to reopen AutoList Pro`;
    } catch (e) { return 'Advanced Scheduler completed'; }
  }

  function buildAdsMessage() {
    try {
      const list = (globalThis.ffmAdsAttentionEvents || []).slice(-5).map(e => `• ${e.title}`).join('\n');
      return list + ((globalThis.ffmAdsAttentionEvents || []).length > 5 ? `\n+ ${(globalThis.ffmAdsAttentionEvents || []).length - 5} more…` : '') + `\n\nClick to reopen AutoList Pro`;
    } catch (e) { return 'Advanced Scheduler completed'; }
  }

  function ffmClearAdsAttention() {
    try {
      globalThis.ffmAdsAttentionActive = false;
      globalThis.ffmAdsAttentionEvents = [];
      try { chrome.action.setBadgeText({ text: '' }); } catch (e) {}
      try { chrome.action.setTitle({ title: 'AutoList Pro' }); } catch (e) {}
      try { chrome.notifications.clear('FFM_ADS_COMPLETE'); } catch (e) {}
      try { chrome.storage && chrome.storage.local && chrome.storage.local.remove && chrome.storage.local.remove('ffm_ads_attention'); } catch (e) {}
    } catch (e) {}
  }

  // Small helper: try to build a human title for a listingId and notify attention
  async function ffmNotifyAdsCompletionForListing(listingId) {
    try {
      const snap = await new Promise((r) => { try { chrome.storage.local.get([FFM_ADS_RULES_KEY], r); } catch (e) { r({}); } });
      const rules = (snap && snap[FFM_ADS_RULES_KEY]) ? snap[FFM_ADS_RULES_KEY] : {};
      const rule = rules && rules[listingId] ? rules[listingId] : null;
      const title = rule ? (rule.listingTitle || rule.inventoryName || listingId) : listingId;
      // Persist attention state first (so it survives SW restart)
      try { await ffmMarkAdsAttention({ title }); } catch (e) {}
      // Update in-memory UI as well
      try { ffmHandleAdsCompletion({ title, completedAt: Date.now() }); } catch (e) {}
    } catch (e) { try { ffmHandleAdsCompletion({ title: listingId || 'ADS task', completedAt: Date.now() }); } catch (er) {} }
  }

  // -------------------------------
  // Persistent attention helpers (storage-backed)
  // -------------------------------
  async function ffmMarkAdsAttention({ title }) {
    try {
      const snap = await new Promise((r) => { try { chrome.storage.local.get(['ffm_ads_attention'], r); } catch (e) { r({}); } });
      const data = (snap && snap.ffm_ads_attention) ? snap.ffm_ads_attention : { count: 0, events: [] };
      data.count = Number(data.count || 0) + 1;
      data.events = Array.isArray(data.events) ? data.events : [];
      data.events.push({ title: String(title || 'ADS task'), at: Date.now() });
      // cap to last 5
      data.events = data.events.slice(-5);
      try { await new Promise(r => { try { chrome.storage.local.set({ ffm_ads_attention: data }, r); } catch (e) { r(); } }); } catch (e) {}
      return data;
    } catch (e) { return null; }
  }

  function renderAdsAttention(data) {
    try {
      if (!data) return;
      const count = Number(data.count || 0);
      try { chrome.action.setBadgeText({ text: String(count) }); } catch (e) {}
      try { chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' }); } catch (e) {}
      const list = Array.isArray(data.events)
        ? data.events.slice(-5).map(e => {
            const when = e && e.at ? new Date(e.at).toLocaleString() : '';
            return `• ${when}${when && e.title ? ' — ' : ''}${e.title || ''}`;
          }).join('\n')
        : '';
      const title = `Advanced Scheduler completed ${ (Array.isArray(data.events) ? data.events.length : count) } task(s)\n\n${list}\n\nClick to reopen AutoList Pro`;
      try { chrome.action.setTitle({ title }); } catch (e) {}

      try { ffmShowAdsNotification({ count: count, events: Array.isArray(data.events) ? data.events.slice(-5) : [] }); } catch (e) {}
    } catch (e) {}
  }

  async function ffmRestoreAdsAttentionAfterBoot() {
    try {
      const snap = await new Promise(r => { try { chrome.storage.local.get(['ffm_ads_attention'], r); } catch (e) { r({}); } });
      const data = snap && snap.ffm_ads_attention ? snap.ffm_ads_attention : null;
      if (!data || !data.count) return;
      renderAdsAttention(data);
      // Defensive re-apply: some init paths clear the badge later. Re-apply shortly after
      // boot to ensure the ADS attention badge/title survive startup routines.
      try { setTimeout(() => { try { renderAdsAttention(data); } catch (e) {} }, 1500); } catch (e) {}
    } catch (e) {}
  }

  // Friendly, persistent notification used after boot when attention is present.
  function ffmShowAdsNotification({ count, events }) {
    const top = Array.isArray(events)
      ? events.slice(0, 3).map(ev => {
          const when = ev && ev.at ? new Date(ev.at).toLocaleString() : '';
          const title = ev && ev.title ? ev.title : '';
          return `• ${when}${when && title ? ' — ' : ''}${title}`;
        }).join("\n")
      : "";

    const more = (Number(count) || 0) > 3 ? `\n+ ${Number(count) - 3} more…` : "";

    try {
      chrome.notifications.create("FFM_ADS_COMPLETE", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `🎉 ADS Complete (${count})`,
        message: `Relisted successfully:\n${top}${more}\n\nTap “Open AutoList Pro” to review.`,
        buttons: [{ title: "Open AutoList Pro" }, { title: "Dismiss" }],
        requireInteraction: true,
        priority: 2
      });
    } catch (e) {
      try { console.warn('[AutoList Pro bg] ffmShowAdsNotification failed', e); } catch (er) {}
    }
  }

  // Expose helpers for debugging / manual invocation from the SW console
  try { if (typeof globalThis !== 'undefined') { globalThis.ffmRestoreAdsAttentionAfterBoot = ffmRestoreAdsAttentionAfterBoot; } } catch (e) {}

// Expose for debugging from the SW console with safe wrappers
try { if (typeof ffmAdsRebuildAllAlarms === 'function') { globalThis.__ffm_internal_ffmAdsRebuildAllAlarms = ffmAdsRebuildAllAlarms; } } catch (e) {}
try { if (typeof ffmAdsCheckForMissedRunsOnStartup === 'function') { globalThis.__ffm_internal_ffmAdsCheckForMissedRunsOnStartup = ffmAdsCheckForMissedRunsOnStartup; } } catch (e) {}

try {
  globalThis.ffmAdsRebuildAllAlarms = async function(reason = 'manual-console') {
    if (typeof globalThis.__ffm_internal_ffmAdsRebuildAllAlarms === 'function') {
      return await globalThis.__ffm_internal_ffmAdsRebuildAllAlarms(reason);
    }
    globalThis.__ffm_boot_restore_callbacks = globalThis.__ffm_boot_restore_callbacks || [];
    return new Promise((resolve, reject) => {
      globalThis.__ffm_boot_restore_callbacks.push(async () => {
        try {
          if (typeof globalThis.__ffm_internal_ffmAdsRebuildAllAlarms === 'function') {
            const res = await globalThis.__ffm_internal_ffmAdsRebuildAllAlarms(reason);
            resolve(res);
          } else {
            reject(new Error('ffmAdsRebuildAllAlarms internal not available'));
          }
        } catch (e) { reject(e); }
      });
    });
  };
} catch (e) {}

try {
  globalThis.ffmAdsCheckForMissedRunsOnStartup = async function() {
    if (typeof globalThis.__ffm_internal_ffmAdsCheckForMissedRunsOnStartup === 'function') {
      return await globalThis.__ffm_internal_ffmAdsCheckForMissedRunsOnStartup();
    }
    globalThis.__ffm_boot_restore_callbacks = globalThis.__ffm_boot_restore_callbacks || [];
    return new Promise((resolve, reject) => {
      globalThis.__ffm_boot_restore_callbacks.push(async () => {
        try {
          if (typeof globalThis.__ffm_internal_ffmAdsCheckForMissedRunsOnStartup === 'function') {
            const res = await globalThis.__ffm_internal_ffmAdsCheckForMissedRunsOnStartup();
            resolve(res);
          } else {
            reject(new Error('ffmAdsCheckForMissedRunsOnStartup internal not available'));
          }
        } catch (e) { reject(e); }
      });
    });
  };
} catch (e) {}

try { if (typeof globalThis !== 'undefined') { globalThis.ffmMarkAdsAttention = ffmMarkAdsAttention; } } catch (e) {}
try { if (typeof globalThis !== 'undefined') { globalThis.ffmClearAdsAttention = ffmClearAdsAttention; } } catch (e) {}
try { if (typeof globalThis !== 'undefined') { globalThis.renderAdsAttention = renderAdsAttention; } } catch (e) {}
  try {
    // If a queued restore callback exists from startup, run it now
    if (globalThis.__ffm_boot_restore_callbacks && Array.isArray(globalThis.__ffm_boot_restore_callbacks) && globalThis.__ffm_boot_restore_callbacks.length) {
      try { console.log('[FFM Scheduler] running queued boot restore callbacks'); } catch (e) {}
      try {
        for (const cb of globalThis.__ffm_boot_restore_callbacks.splice(0)) {
          try { cb(); } catch (e) { try { console.warn('[FFM Scheduler] boot restore callback failed', e); } catch (er) {} }
        }
      } catch (e) {}
    }
  } catch (e) {}

  // Wire notification click to clear and optionally reopen UI
  try {
    if (chrome && chrome.notifications && typeof chrome.notifications.onClicked !== 'undefined') {
      chrome.notifications.onClicked.addListener(async (id) => {
        try {
          if (id !== 'FFM_ADS_COMPLETE') return;
          try { ffmClearAdsAttention(); } catch (e) {}
          try {
            const win = await new Promise((res) => { try { chrome.windows.getCurrent(res); } catch (e) { res(null); } });
            if (win && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
              try { chrome.sidePanel.open({ windowId: win.id }); } catch (e) { try { chrome.runtime.sendMessage({ action: 'ffm_open_sidepanel' }); } catch (er) {} }
            } else {
              try { chrome.runtime.sendMessage({ action: 'ffm_open_sidepanel' }); } catch (e) {}
            }
          } catch (e) {}
        } catch (e) {}
      });
    }
  } catch (e) {}

  // Notification button clicks (e.g. "Open AutoList Pro")
  try {
    if (chrome && chrome.notifications && typeof chrome.notifications.onButtonClicked !== 'undefined') {
      chrome.notifications.onButtonClicked.addListener(async (id, index) => {
        try {
          if (id !== 'FFM_ADS_COMPLETE') return;
          // Open button
          if (index === 0) {
            try {
              const win = await new Promise((res) => { try { chrome.windows.getCurrent(res); } catch (e) { res(null); } });
              if (win && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
                try { chrome.sidePanel.open({ windowId: win.id }); } catch (e) { try { chrome.runtime.sendMessage({ action: 'ffm_open_sidepanel' }); } catch (er) {} }
              } else {
                try { chrome.runtime.sendMessage({ action: 'ffm_open_sidepanel' }); } catch (e) {}
              }
            } catch (e) {}
          }

          // Always clear afterwards
          try { ffmClearAdsAttention(); } catch (e) {}
        } catch (e) {}
      });
    }
  } catch (e) {}

  // Clear when side panel (or UI) signals it opened
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender) => {
        try {
          if (!msg) return false;
          if (msg && (msg.action === 'ffm_sidepanel_opened' || msg.action === 'ffm_open_sidepanel')) {
                try { console.log('[AutoList Pro bg] received', msg.action, 'from', sender && (sender.id || (sender.tab && sender.tab.id)) ); } catch (e) {}
                try { ffmClearAdsAttention(); } catch (e) {}
                // Direct fallback clear in case ffmClearAdsAttention is not available yet
                try {
                  try { chrome.action.setBadgeText({ text: '' }); } catch (e) {}
                  try { chrome.action.setTitle({ title: 'AutoList Pro' }); } catch (e) {}
                  try { chrome.notifications.clear('FFM_ADS_COMPLETE'); } catch (e) {}
                  try { chrome.storage && chrome.storage.local && chrome.storage.local.remove && chrome.storage.local.remove('ffm_ads_attention'); } catch (e) {}
                  try { console.log('[AutoList Pro bg] performed direct fallback clear'); } catch (e) {}
                } catch (e) {}
              }
        } catch (e) {}
        return false;
      });
    }
  } catch (e) {}

  // Optional: clear on extension action click
  try {
    if (chrome && chrome.action && chrome.action.onClicked) {
      chrome.action.onClicked.addListener(() => { try { ffmClearAdsAttention(); } catch (e) {} });
    }
  } catch (e) {}
}

// -------------------------------------------
// Mark a rule as missed, notify, reschedule and persist
// -------------------------------------------
async function ffmAdsMarkMissedRun(rule, reason) {
  try {
    const now = Date.now();
    if (!rule || !rule.listingId) return;

    // 1) Add to history (newest at end)
    rule.history = Array.isArray(rule.history) ? rule.history : [];
    rule.history.push({ success: false, time: now, message: reason || 'Missed ADS run' });
    // keep last 50
    rule.history = rule.history.slice(-50);

    // 2) Reschedule rule for next cycle
    const days = Number(rule.daysActive || rule.repeatEvery || 1) || 1;
    const preferred = rule.preferredTime || rule.preferred || '09:00';
    const parts = (preferred || '09:00').split(':').map(Number);
    const hh = parts[0] || 9;
    const mm = parts[1] || 0;

    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hh, mm, 0, 0);

    rule.nextRunAt = d.getTime();
    rule.lastRun = 0;

    // 3) Save rule back into storage
    const wrapper = await new Promise((res) => { try { chrome.storage.local.get(['ffm_advanced_scheduler_rules'], res); } catch (e) { res({}); } });
    const rulesMap = (wrapper && wrapper.ffm_advanced_scheduler_rules) ? wrapper.ffm_advanced_scheduler_rules : {};
    rulesMap[rule.listingId] = rule;
    await new Promise((res) => { try { chrome.storage.local.set({ ffm_advanced_scheduler_rules: rulesMap }, res); } catch (e) { res(); } });

    // 4) Notification
    await ffmNotifyAppend({
      id: ffmNotifyGenerateId(),
      type: 'ads-missed-run',
      level: 'warning',
      createdAt: now,
      listingId: rule.listingId,
      ruleId: rule.id,
      title: `Missed ADS run — ${rule.listingTitle || rule.inventoryName || rule.listingId}`,
      message: `${reason || 'A scheduled ADS run was missed.'}\n\nIt has been automatically rescheduled for ${d.toLocaleString()}.`,
      read: false
    });

    // 5) ensure alarm for this rule
    if (typeof ffmAdsEnsureAlarmForRule === 'function') {
      try { await ffmAdsEnsureAlarmForRule(rule, 'missed-reschedule'); } catch (e) { try { await ffmAdsRebuildAllAlarms('missed-reschedule-fallback'); } catch (_) {} }
    } else {
      try { await ffmAdsRebuildAllAlarms('missed-reschedule-no-ensure'); } catch (e) {}
    }

    console.warn('[ADS] Missed run handled and rescheduled for', rule.listingId, '->', new Date(rule.nextRunAt));
  } catch (e) {
    console.warn('[ADS] ffmAdsMarkMissedRun failed', e);
  }
}

// -------------------------------
// Build a rich run record for ADS runs
// -------------------------------
function ffmAdsBuildRunRecord() {
  return {
    deleteStart: null,
    deleteEnd: null,
    deleteDurationMs: null,

    publishStart: null,
    publishEnd: null,
    publishDurationMs: null,

    stage: "init",
    errorMessage: null,
    errorStage: null,

    success: false,
    time: Date.now(),
    listingVersion: null,
    message: "",
  };
}

// Lightweight facade to invoke the canonical publish-listing path directly from
// background contexts (scheduler, alarms, or other internal callers). This will
// stage a saved listing when given a `listingId` or call `publishListingById`
// directly when a `publishRequestId` is supplied. It preserves the existing
// one-off force flag behavior only when `message.autoPublish` is true.
async function handlePublishListing(message, sender) {
  try {
    if (!message) {
      throw new Error('missing message');
    }

    // If caller already provided a publishRequestId, use the canonical executor
    if (message.publishRequestId) {
      return await publishListingById(message.publishRequestId);
    }

    // If caller provided a saved listingId, stage it and call publishListingById
    if (message.listingId) {
      const listingId = message.listingId;
      const taskId = message.taskId || null;

      // Attempt to locate the saved listing across known storage keys
      const snap = await new Promise((res) => { try { chrome.storage.local.get(['listings','ffmSavedListings','__ffm_saved_listings_cache'], res); } catch (e) { res({}); } });
      const pool = [];
      if (Array.isArray(snap.ffmSavedListings)) pool.push(...snap.ffmSavedListings);
      if (Array.isArray(snap.__ffm_saved_listings_cache)) pool.push(...snap.__ffm_saved_listings_cache);
      if (Array.isArray(snap.listings)) pool.push(...snap.listings);

      const target = (pool || []).find(l => {
        try {
          if (!l) return false;
          if (String(l.listingId) === String(listingId)) return true;
          if (String(l.id) === String(listingId)) return true;
          if (l.inventoryName && String(l.inventoryName) === String(listingId)) return true;
          return false;
        } catch (e) { return false; }
      });

      if (!target) {
        console.warn('[SP] handlePublishListing: listing not found', listingId);
        return { ok: false, error: 'listing-not-found' };
      }

      const publishRequestId = message.publishRequestId || (Math.random().toString(36).slice(2) + Date.now().toString(36));
      const stagedKey = 'ffm_publish_' + publishRequestId;
      try {
        await new Promise((r) => {
          try {
            const pubSourceKey = 'ffm_publish_source_' + publishRequestId;
            const storeObj = { [stagedKey]: target, ffm_last_publish: Object.assign({}, target, { publishRequestId }) };
            if (message && (message.source || message.publishSource)) storeObj[pubSourceKey] = message.source || message.publishSource;
            chrome.storage.local.set(storeObj, r);
          } catch (e) { r(); }
        });
      } catch (e) {}

      // Preserve per-action force flag only when explicitly requested
      try {
        if (message && message.autoPublish) {
          const forceKey = 'ffm_force_auto_publish_' + publishRequestId;
          try { chrome.storage.local.set({ [forceKey]: true }, () => {}); } catch (e) {}
        }
      } catch (e) {}

      return await publishListingById(publishRequestId);
    }

    console.error('[SP] handlePublishListing: missing identifiers in message', message);
    return { ok: false, error: 'missing-identifiers' };
  } catch (err) {
    console.error('[SP] handlePublishListing failed', err);
    throw err;
  }
}

// Per-run SDnR active state: track the single active SDnR run (stateful)
try {
  if (typeof globalThis !== 'undefined') {
    // either null (no run) or an object { runKey, startedAt, stage }
    globalThis.__ffmActiveSDnR = globalThis.__ffmActiveSDnR || null;
  }
} catch (e) {}

function ffmTryStartSDnR(runKey) {
  try {
    if (!runKey) return false;
    // Support both scalar active-run object and map-based per-listing contexts.
    // If no active state exists, initialize as a scalar object for backward
    // compatibility unless a map is already expected elsewhere.
    if (!globalThis.__ffmActiveSDnR) {
      globalThis.__ffmActiveSDnR = { runKey: String(runKey), startedAt: Date.now(), stage: 'deleting' };
      return true;
    }

    // If scalar active-run is present, treat as already running.
    if (globalThis.__ffmActiveSDnR && globalThis.__ffmActiveSDnR.runKey) {
      return false;
    }

    // Otherwise treat __ffmActiveSDnR as a map and set a per-run entry.
    try {
      if (typeof globalThis.__ffmActiveSDnR !== 'object') globalThis.__ffmActiveSDnR = {};
      const key = String(runKey);
      if (globalThis.__ffmActiveSDnR[key]) return false;
      globalThis.__ffmActiveSDnR[key] = { runKey: key, startedAt: Date.now(), stage: 'deleting' };
      return true;
    } catch (e) { return false; }
  } catch (e) { return false; }
}

function ffmEndSDnR(runKey) {
  try {
    // Support both scalar and map forms when ending a run.
    if (!globalThis.__ffmActiveSDnR) return;

    // Scalar form: clear if runKey matches or not provided
    if (globalThis.__ffmActiveSDnR && globalThis.__ffmActiveSDnR.runKey) {
      if (!runKey || String(globalThis.__ffmActiveSDnR.runKey) === String(runKey)) {
        globalThis.__ffmActiveSDnR = null;
      }
      return;
    }

    // Map form: delete specific entry if present
    try {
      if (!runKey) return;
      const key = String(runKey);
      if (globalThis.__ffmActiveSDnR[key]) {
        try { delete globalThis.__ffmActiveSDnR[key]; } catch (e) { globalThis.__ffmActiveSDnR[key] = null; }
      }
    } catch (e) {}
  } catch (e) {}
}

  // ===== CLFP media-tab helper: open media tab, receive media results, forward to edit tab =====
  try {
    globalThis.__ffm_media_waiting = globalThis.__ffm_media_waiting || {};
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
        try {
          if (!msg || !msg.action) return false;

          // Request from an edit-page to open the public item URL in a helper tab
          if (msg.action === 'ffm_open_media_tab' && msg.pubUrl) {
            try {
              const editTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : null;
              const pub = String(msg.pubUrl);
              const openUrl = pub + (pub.indexOf('?') !== -1 ? '&' : '?') + '__ffm_media=1';
              try { console.log('[AutoList Pro bg] ffm_open_media_tab requested pubUrl=', pub, 'from editTabId=', editTabId); } catch (e) {}
              chrome.tabs.create({ url: openUrl, active: false }, (tab) => {
                try {
                  if (tab && tab.id) {
                    try { globalThis.__ffm_media_waiting[tab.id] = { editTabId: editTabId, ts: Date.now(), pubUrl: pub }; } catch (e) {}
                    try { console.log('[AutoList Pro bg] helper tab created id=', tab.id, 'for pubUrl=', pub); } catch (e) {}
                  }
                } catch (e) { try { console.error('[AutoList Pro bg] error in tabs.create callback', e); } catch(_) {} }
              });
            } catch (e) { try { console.error('[AutoList Pro bg] ffm_open_media_tab handler error', e); } catch(_) {} }
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            return true;
          }

          // Request to open both edit page and media helper together (from listing dialog)
          if (msg.action === 'ffm_open_edit_and_media' && msg.editUrl) {
            try {
              const editUrl = String(msg.editUrl);
              const pub = msg.pubUrl ? String(msg.pubUrl) : (msg.listingId && globalThis.__ffm_pub_map && globalThis.__ffm_pub_map[String(msg.listingId)] ? String(globalThis.__ffm_pub_map[String(msg.listingId)]) : null);
              // create the edit tab active
              chrome.tabs.create({ url: editUrl, active: true }, (editTab) => {
                try {
                  if (!editTab || !editTab.id) return;
                  try { console.log('[AutoList Pro bg] ffm_open_edit_and_media: edit tab created id=', editTab.id, 'url=', editUrl); } catch (e) {}
                  // open helper if we have pub URL
                  if (pub) {
                    const helperUrl = pub + (pub.indexOf('?') !== -1 ? '&' : '?') + '__ffm_media=1';
                    chrome.tabs.create({ url: helperUrl, active: false }, (helperTab) => {
                      try {
                        if (helperTab && helperTab.id) {
                          try { globalThis.__ffm_media_waiting = globalThis.__ffm_media_waiting || {}; globalThis.__ffm_media_waiting[helperTab.id] = { editTabId: editTab.id, ts: Date.now(), pubUrl: pub }; } catch(e){}
                          try { console.log('[AutoList Pro bg] ffm_open_edit_and_media: helper tab created id=', helperTab.id, 'for pubUrl=', pub); } catch(e){}
                        }
                      } catch(e){}
                    });
                    // store pub map for fallback
                    try { globalThis.__ffm_pub_map = globalThis.__ffm_pub_map || {}; if (msg.listingId) globalThis.__ffm_pub_map[String(msg.listingId)] = pub; } catch(e){}
                  }
                } catch (e) { try { console.error('[AutoList Pro bg] ffm_open_edit_and_media editTab callback error', e); } catch(_){} }
              });
            } catch (e) { try { console.error('[AutoList Pro bg] ffm_open_edit_and_media handler error', e); } catch(_){} }
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            return true;
          }

          // Media helper tab reports collected media back to background
          if (msg.action === 'ffm_from_published_media' && sender && sender.tab && sender.tab.id) {
            try {
              const mediaTabId = sender.tab.id;
              const entry = globalThis.__ffm_media_waiting && globalThis.__ffm_media_waiting[mediaTabId] ? globalThis.__ffm_media_waiting[mediaTabId] : null;
              const data = msg.data || null;
              try { console.log('[AutoList Pro bg] ffm_from_published_media received from mediaTab=', mediaTabId, 'entry=', !!entry, 'images=', (data && data.images && data.images.length) || 0, 'videos=', (data && data.videos && data.videos.length) || 0); } catch (e) {}
              try {
                const imgs = (data && Array.isArray(data.images)) ? data.images.map(i => (typeof i === 'string' ? i : (i && (i.src || i.currentSrc || i.url) || ''))).filter(Boolean) : [];
                if (imgs.length) console.log('[AutoList Pro bg] ffm_from_published_media image URLs:', imgs);
                try { console.debug && console.debug('[background] detailed images:', imgs); } catch(e){}
                const vids = (data && Array.isArray(data.videos)) ? data.videos.map(v => (typeof v === 'string' ? v : (v && (v.src || (v.sources && v.sources[0]) || v.url) || ''))).filter(Boolean) : [];
                if (vids.length) console.log('[AutoList Pro bg] ffm_from_published_media video URLs:', vids);
                try { console.debug && console.debug('[background] detailed videos:', vids); } catch(e){}
              } catch (e) {}
              // Attempt to run the canonical FB extractor in the page's MAIN world
              // to get the same image set the popup's "Search FB Images" uses.
              try {
                const runExtractorOnTab = async (tabId) => {
                  try {
                    const extractor = () => {
                      try {
                        const seen = new Set();
                        const images = [];
                        const addSrc = (src) => {
                          try {
                            if (!src) return; if (typeof src !== 'string') return; src = src.trim(); if (!src) return; if (src.indexOf('data:') === 0) return; if (seen.has(src)) return; seen.add(src); images.push(src);
                          } catch (e) {}
                        };

                        let cutoffEl = null;
                        try {
                          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                          while (walker.nextNode()) {
                            try {
                              const nv = walker.currentNode && walker.currentNode.nodeValue;
                              if (!nv) continue;
                              const clean = nv.toString().trim().toLowerCase();
                              if (clean === 'seller information') { cutoffEl = walker.currentNode && walker.currentNode.parentElement; break; }
                              if (/\bsponsored\b/i.test(clean)) { cutoffEl = walker.currentNode && walker.currentNode.parentElement; break; }
                            } catch (e) {}
                          }
                        } catch (e) {}

                        const imgs = Array.from(document.querySelectorAll('img'));
                        for (const img of imgs) {
                          try {
                            const src = img.currentSrc || img.src || (img.getAttribute && img.getAttribute('src'));
                            if (!src) continue;
                            const rect = (img.getBoundingClientRect && img.getBoundingClientRect()) || null;
                            if (rect && rect.width < 20 && rect.height < 20) continue;
                            if (cutoffEl) {
                              try {
                                if (typeof img.compareDocumentPosition === 'function') {
                                  const mask = img.compareDocumentPosition(cutoffEl);
                                  const isBefore = Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
                                  if (!isBefore) continue;
                                }
                              } catch (e) {}
                            }
                            addSrc(src);
                          } catch (e) {}
                        }

                        try {
                          const m = document.querySelector('meta[property="og:image"]');
                          if (m && m.content) addSrc(m.content);
                        } catch (e) {}

                        return Array.from(images);
                      } catch (e) { return []; }
                    };

                    const execRes = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: extractor, world: 'MAIN' });
                    const imgs = Array.isArray(execRes) && execRes[0] && Array.isArray(execRes[0].result) ? execRes[0].result : [];
                    return Array.from(new Set((imgs || []).filter(Boolean)));
                  } catch (e) {
                    // If immediate execution fails, try waiting for tab complete then run once more
                    try {
                      await new Promise((res) => {
                        let done = false;
                        const onUpdated = (tid, changeInfo) => {
                          try {
                            if (tid !== tabId) return;
                            if (changeInfo && changeInfo.status === 'complete') {
                              try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch(_){}
                              if (!done) { done = true; res(); }
                            }
                          } catch (e) {}
                        };
                        try { chrome.tabs.onUpdated.addListener(onUpdated); } catch (e) {}
                        setTimeout(() => { try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch(_){} if (!done) { done = true; res(); } }, 7000);
                      });
                      const execRes2 = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: extractor, world: 'MAIN' });
                      const imgs2 = Array.isArray(execRes2) && execRes2[0] && Array.isArray(execRes2[0].result) ? execRes2[0].result : [];
                      return Array.from(new Set((imgs2 || []).filter(Boolean)));
                    } catch (ee) {
                      return [];
                    }
                  }
                };

                let extractorImgs = [];
                try { extractorImgs = await runExtractorOnTab(sender.tab.id); } catch (e) { extractorImgs = []; }
                try { if (extractorImgs && extractorImgs.length) console.log('[AutoList Pro bg] extractor images from helper tab:', extractorImgs); } catch (e) {}

                // Also attempt to extract video URLs from the helper tab (MAIN world)
                try {
                  const runVideoExtractorOnTab = async (tabId) => {
                    try {
                      const vextractor = () => {
                        try {
                          const seen = new Set();
                          const vids = [];
                          const add = (s) => {
                            try {
                              if (!s || typeof s !== 'string') return;
                              s = s.trim(); if (!s) return; if (seen.has(s)) return; seen.add(s); vids.push(s);
                            } catch (e) {}
                          };

                          // 1) native <video> elements
                          try {
                            const videos = Array.from(document.querySelectorAll('video'));
                            for (const v of videos) {
                              try {
                                const src = v.currentSrc || v.src || '';
                                if (src && src.startsWith('http')) add(src);
                                const sources = Array.from(v.querySelectorAll('source')).map(s=>s.src||'').filter(Boolean);
                                for (const s of sources) add(s);
                              } catch (e) {}
                            }
                          } catch (e) {}

                          // 2) anchors linking to mp4 or fbcdn video endpoints
                          try {
                            const anchors = Array.from(document.querySelectorAll('a[href]'));
                            for (const a of anchors) {
                              try {
                                const href = a.href || '';
                                if (!href || !href.startsWith('http')) continue;
                                if (/\.mp4(\?|$)/i.test(href) || /\/video\//i.test(href) || /video-/.test(href) || /video-sjc|video-cam|video\./i.test(href)) add(href);
                              } catch (e) {}
                            }
                          } catch (e) {}

                          // 3) background-image URLs that look like mp4/fbcdn videos
                          try {
                            const els = Array.from(document.querySelectorAll('[style]'));
                            for (const el of els) {
                              try {
                                const cs = window.getComputedStyle(el);
                                const bg = cs && cs.backgroundImage ? cs.backgroundImage : '';
                                if (!bg || bg === 'none') continue;
                                const m = bg.match(/url\(["']?(.*?)["']?\)/);
                                if (m && m[1]) {
                                  const url = m[1]; if (!url) continue; if (/\.mp4(\?|$)/i.test(url) || /video\//i.test(url) || /video-/.test(url)) add(url);
                                }
                              } catch (e) {}
                            }
                          } catch (e) {}

                          return vids;
                        } catch (e) { return []; }
                      };

                      const execRes = await chrome.scripting.executeScript({ target: { tabId }, func: vextractor, world: 'MAIN' });
                      const res = Array.isArray(execRes) && execRes[0] && Array.isArray(execRes[0].result) ? execRes[0].result : [];
                      return Array.from(new Set((res || []).filter(Boolean)));
                    } catch (e) {
                      try {
                        await new Promise((res) => {
                          let done = false;
                          const onUpdated = (tid, changeInfo) => {
                            try { if (tid !== tabId) return; if (changeInfo && changeInfo.status === 'complete') { try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch(_){} if (!done) { done = true; res(); } } } catch (e) {}
                          };
                          try { chrome.tabs.onUpdated.addListener(onUpdated); } catch (e) {}
                          setTimeout(() => { try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch(_){} if (!done) { done = true; res(); } }, 7000);
                        });
                        const execRes2 = await chrome.scripting.executeScript({ target: { tabId }, func: vextractor, world: 'MAIN' });
                        const res2 = Array.isArray(execRes2) && execRes2[0] && Array.isArray(execRes2[0].result) ? execRes2[0].result : [];
                        return Array.from(new Set((res2 || []).filter(Boolean)));
                      } catch (ee) { return []; }
                    }
                  };

                  let extractorVids = [];
                  try { extractorVids = await runVideoExtractorOnTab(sender.tab.id); } catch (e) { extractorVids = []; }
                  try { if (extractorVids && extractorVids.length) console.log('[AutoList Pro bg] extractor videos from helper tab:', extractorVids); } catch (e) {}

                  // If the image extractor returned any mp4/video-like URLs, treat
                  // them as video candidates as well (some pages expose videos in
                  // image-like attributes). Merge them into extractorVids.
                  try {
                    const extractorVideoCandidates = (extractorImgs || []).filter(u => /(?:\.mp4(?:\?|$)|video-sjc|video-cam|\/o1\/v\/|\/video\/)/i.test(u));
                    if (extractorVideoCandidates && extractorVideoCandidates.length) {
                      try { console.log('[AutoList Pro bg] video candidates from extractor images:', extractorVideoCandidates); } catch(e){}
                      extractorVids = Array.from(new Set([].concat(extractorVids || [], extractorVideoCandidates || [])));
                    }
                  } catch(e) {}

                  // Merge helper-provided videos with extractor videos, prefer mp4/fbcdn, dedupe, cap to 1
                  try {
                    const helperVids = (data && Array.isArray(data.videos)) ? data.videos.map(v => (typeof v === 'string' ? v : (v && (v.src || (v.sources && v.sources[0]) || v.url) || ''))).filter(Boolean) : [];
                    const mergedV = Array.from(new Set([].concat(extractorVids || [], helperVids || [])));
                    const filteredV = mergedV.filter(u => { try { if (!u || typeof u !== 'string') return false; if (/static_map\.php|\/rsrc\.php/i.test(u)) return false; if (/\.png|\.jpe?g|\.svg(\?|$)/i.test(u)) return false; if (/\.mp4(\?|$)/i.test(u) || /scontent-|fbcdn\.net|video-sjc|video-cam|\/video\//i.test(u)) return true; return false; } catch (e) { return false; } });
                    const finalV = (filteredV || []).slice(0,1).map(u => ({ src: u }));
                    data.videos = finalV;
                  } catch (e) {}
                } catch (e) {
                  try { console.debug && console.debug('[AutoList Pro bg] video-extractor-merge failed', e); } catch (er) {}
                }

                // Merge extractor results with the helper-provided data (prefer extractor, then helper)
                try {
                  const helperUrls = (data && Array.isArray(data.images)) ? data.images.map(i => (typeof i === 'string' ? i : (i && (i.src || i.currentSrc || i.url) || ''))).filter(Boolean) : [];
                  const merged = Array.from(new Set([].concat(extractorImgs || [], helperUrls || [])));
                  // Filter out obvious video URLs and non-image endpoints. Prefer explicit
                  // image file extensions or fbcdn '/v/' high-quality paths. Keep top 10.
                  const imageCandidates = (merged || []).filter(u => {
                    try {
                      if (!u || typeof u !== 'string') return false;
                      const s = u.trim();
                      if (!s) return false;
                      // Exclude explicit mp4/video endpoints and obvious video hosts/paths
                      if (/\.mp4(\?|$)/i.test(s)) return false;
                      if (/static_map\.php|\/rsrc\.php/i.test(s)) return false;
                      if (/(?:video[-.]|video-sjc|video-cam|\/o1\/v\/|\/video\/)/i.test(s)) return false;
                      // Accept common image extensions
                      if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(s)) return true;
                      // Accept fbcdn high-quality image paths (/v/ or /v/t45) but ensure not video-host
                      if (/\/v\//.test(s) && /scontent-|fbcdn\.net/.test(s)) return true;
                      // As a last resort, accept scontent/fbcdn URLs that aren't identified as video
                      if (/scontent-|fbcdn\.net/.test(s)) return true;
                      return false;
                    } catch (err) { return false; }
                  });
                  const final = imageCandidates.slice(0, 10).map(u => ({ src: u }));
                  data.images = final;
                } catch (e) {}
              } catch (e) {
                try { console.debug && console.debug('[AutoList Pro bg] extractor-merge step failed', e); } catch (er) {}
              }
                // (duplicate later removed)

                if (entry && entry.editTabId) {
                try {
                  // Debug: log final merged media we will forward
                  try {
                    const dbgImgs = (data && Array.isArray(data.images)) ? data.images.map(i => (typeof i === 'string' ? i : (i && (i.src || i.currentSrc || i.url) || ''))).filter(Boolean) : [];
                    const dbgVids = (data && Array.isArray(data.videos)) ? data.videos.map(v => (typeof v === 'string' ? v : (v && (v.src || (v.sources && v.sources[0]) || v.url) || ''))).filter(Boolean) : [];
                    console.log('[AutoList Pro bg] final merged media to forward images:', dbgImgs, 'videos:', dbgVids);
                  } catch (ee) {}
                  // Cache the media result keyed by pubUrl and editTabId so tabs that
                  // haven't yet registered listeners can request it afterwards.
                  try { globalThis.__ffm_media_cache = globalThis.__ffm_media_cache || {}; if (entry.pubUrl) globalThis.__ffm_media_cache[String(entry.pubUrl)] = data; if (entry.editTabId) globalThis.__ffm_media_cache['tab:' + String(entry.editTabId)] = data; } catch(e){}
                  try {
                    chrome.tabs.sendMessage(entry.editTabId, { action: 'ffm_from_published_media_result', data: data }, (resp) => {
                        try {
                          if (chrome.runtime && chrome.runtime.lastError) {
                            console.warn('[AutoList Pro bg] forwarding media result - sendMessage failed:', chrome.runtime.lastError && chrome.runtime.lastError.message);
                            try {
                              // Queue the media for retry when the edit tab becomes ready
                              globalThis.__ffm_pending_media_for_tab = globalThis.__ffm_pending_media_for_tab || {};
                              try { globalThis.__ffm_pending_media_for_tab[String(entry.editTabId)] = data; } catch(e) {}
                            } catch (ee) {}

                            // Fallback: attempt to open a temporary port to the edit tab and post the data
                            try {
                              const tryConnect = () => {
                                try {
                                  const tmpPort = chrome.tabs.connect && chrome.tabs.connect(entry.editTabId, { name: 'ffm_content_port' });
                                  if (tmpPort) {
                                    try { console.log('[AutoList Pro bg] opened tmp port to tab', entry.editTabId, 'to attempt delivery'); } catch (e) {}
                                    try {
                                      tmpPort.postMessage({ action: 'ffm_from_published_media_result', data: data });
                                      // keep queued copy until we get an explicit success from content
                                      setTimeout(() => {
                                        try { tmpPort.disconnect(); } catch (e) {}
                                      }, 3000);
                                      return true;
                                    } catch (e) {
                                      try { console.warn('[AutoList Pro bg] tmp port postMessage failed', e && (e.message||e)); } catch (er) {}
                                    }
                                  }
                                } catch (e) { try { console.warn('[AutoList Pro bg] chrome.tabs.connect attempt failed', e && (e.message||e)); } catch(_){} }
                                return false;
                              };
                              tryConnect();
                            } catch (ee) {}
                          } else {
                            try { console.log('[AutoList Pro bg] forwarding media result succeeded for editTabId=', entry.editTabId); } catch(e) {}
                          }
                        } catch (e) {}
                      });
                  } catch (e) {
                    try { console.error('[AutoList Pro bg] forwarding media result threw', e); } catch(_){}
                  }
                } catch (e) { try { console.error('[AutoList Pro bg] forwarding media result failed', e); } catch(_){} }
                // Delivery helper: prefer content port Map, otherwise queue payload per-tab
                function ffmDeliverToEditTabOrQueue(editTabId, payload) {
                  try { globalThis.__ffm_content_ports_by_tab = globalThis.__ffm_content_ports_by_tab || new Map(); } catch (e) {}
                  try { globalThis.__ffm_pending_media_for_tab = globalThis.__ffm_pending_media_for_tab || {}; } catch (e) {}
                  payload = Object.assign({}, payload || {});
                  try {
                    const port = (globalThis.__ffm_content_ports_by_tab && typeof globalThis.__ffm_content_ports_by_tab.get === 'function') ? globalThis.__ffm_content_ports_by_tab.get(editTabId) : ((typeof __ffm_content_ports_by_tab !== 'undefined' && __ffm_content_ports_by_tab[String(editTabId)]) ? __ffm_content_ports_by_tab[String(editTabId)] : null);
                    if (port) {
                      try {
                        port.postMessage(payload);
                        try { console.log('[AutoList Pro bg] delivered payload via port to tab', editTabId, payload.action); } catch (e) {}
                        return true;
                      } catch (e) {
                        try { console.warn('[AutoList Pro bg] port delivery failed; queueing', editTabId, e && (e.message||e)); } catch (er) {}
                      }
                    }
                  } catch (e) {}
                  try {
                    try { globalThis.__ffm_pending_media_for_tab[String(editTabId)] = payload; } catch (e) { try { __ffm_pending_media_for_tab[String(editTabId)] = payload; } catch (er) {} }
                    try { console.log('[AutoList Pro bg] queued payload for tab', editTabId, payload.action); } catch (e) {}
                  } catch (e) {}
                  return false;
                }
              } else {
                try { console.warn('[AutoList Pro bg] no matching editTabId for mediaTab=', mediaTabId); } catch (e) {}
              }
              // cleanup: close the media tab and remove mapping
              try { chrome.tabs.remove(mediaTabId); } catch (e) { try { console.error('[AutoList Pro bg] tabs.remove failed', e); } catch(_){} }
              try { if (globalThis.__ffm_media_waiting) delete globalThis.__ffm_media_waiting[mediaTabId]; } catch (e) {}
            } catch (e) { try { console.error('[AutoList Pro bg] ffm_from_published_media handler error', e); } catch(_){} }
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            return true;
          }
          
          // Allow edit pages to request any cached media result by pubUrl or tabId
          if (msg.action === 'ffm_request_cached_media') {
            try {
              const pub = msg.pubUrl ? String(msg.pubUrl) : null;
              const tabKey = (msg.editTabId ? 'tab:' + String(msg.editTabId) : null);
              let found = null;
              try { if (pub && globalThis.__ffm_media_cache && globalThis.__ffm_media_cache[String(pub)]) found = globalThis.__ffm_media_cache[String(pub)]; } catch(e){}
              try { if (!found && tabKey && globalThis.__ffm_media_cache && globalThis.__ffm_media_cache[tabKey]) found = globalThis.__ffm_media_cache[tabKey]; } catch(e){}
              try { sendResponse && sendResponse({ ok: true, data: found || null }); } catch(e){}
            } catch (e) { try { sendResponse && sendResponse({ ok: false, error: String(e) }); } catch(e){} }
            return true;
          }

          // Acknowledgement from content page that it received forwarded media
          if (msg && msg.action === 'ffm_from_published_media_ack') {
            try {
              const tabId = sender && sender.tab && sender.tab.id;
              try { console.log('[AutoList Pro bg] received media ACK from tab', tabId); } catch (e) {}
              if (tabId && globalThis.__ffm_pending_media_for_tab && globalThis.__ffm_pending_media_for_tab[String(tabId)]) {
                try { delete globalThis.__ffm_pending_media_for_tab[String(tabId)]; } catch (e) {}
                try { console.log('[AutoList Pro bg] cleared queued media for tab', tabId); } catch (e) {}
              }
            } catch (e) {}
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            return true;
          }
        } catch (e) {}
        return false;
      });
    }
  } catch (e) {}

} catch (e) { try { console.error('[AutoList Pro bg] top-level error', e); } catch (ee) {} }

})();

/* =====================================================================
   AutoList Pro Patch: Self-healing guards + Hard Reset + Watchdogs (DROP-IN)
   ===================================================================== */

(() => {
  // -----------------------------
  // 0) Small utils
  // -----------------------------
  const now = () => Date.now();
  const since = (t) => (typeof t === "number" ? now() - t : null);

  function safeSetGlobal(name, value) {
    try {
      if (Object.prototype.hasOwnProperty.call(globalThis, name) || (name in globalThis)) {
        globalThis[name] = value;
        return true;
      }
    } catch (e) {}
    return false;
  }

  function safeGetGlobal(name) {
    try {
      return globalThis[name];
    } catch (e) {
      return undefined;
    }
  }

  function safeCall(fn, ...args) {
    try {
      return fn(...args);
    } catch (e) {
      return undefined;
    }
  }

  // -----------------------------
  // 1) Hard Reset (runtime state detox)
  // -----------------------------
  function ffmHardReset(reason = "unknown") {
    const ts = new Date().toLocaleString();
    try { console.warn(`[AutoList Pro HARD RESET] reason=${reason} @ ${ts}`); } catch (e) {}

    const cleared = [];

    if (safeSetGlobal("ffmPublishLock", false)) cleared.push("ffmPublishLock");
    if (safeSetGlobal("FFM_PUBLISH_LOCK", false)) cleared.push("FFM_PUBLISH_LOCK");
    if (safeSetGlobal("ffm_publish_lock", false)) cleared.push("ffm_publish_lock");
    if (safeSetGlobal("ffmPublishInProgress", false)) cleared.push("ffmPublishInProgress");
    if (safeSetGlobal("ffmPublishRunning", false)) cleared.push("ffmPublishRunning");

    if (safeSetGlobal("ffmDnRRunning", false)) cleared.push("ffmDnRRunning");
    if (safeSetGlobal("ffmSDnRRunning", false)) cleared.push("ffmSDnRRunning");
    if (safeSetGlobal("ffmAdsRunning", false)) cleared.push("ffmAdsRunning");
    if (safeSetGlobal("ffmQueueProcessing", false)) cleared.push("ffmQueueProcessing");
    if (safeSetGlobal("__ffm_ads_queue_processing", false)) cleared.push("__ffm_ads_queue_processing");
    if (safeSetGlobal("__ffm_dnr_queue_processing", false)) cleared.push("__ffm_dnr_queue_processing");

    if (safeSetGlobal("ffmCurrentJob", null)) cleared.push("ffmCurrentJob");
    if (safeSetGlobal("__ffm_ads_current_job", null)) cleared.push("__ffm_ads_current_job");
    if (safeSetGlobal("__ffm_sdnr_context", null)) cleared.push("__ffm_sdnr_context");

    const qNames = ["ffmAdsQueue", "__ffm_ads_queue", "ffmDnRQueue", "__ffm_dnr_queue"];
    for (const qn of qNames) {
      const q = safeGetGlobal(qn);
      if (Array.isArray(q)) {
        q.length = 0;
        cleared.push(`${qn}(cleared)`);
      }
    }

    safeSetGlobal("__ffm_publish_started_at", null);
    safeSetGlobal("__ffm_dnr_started_at", null);
    safeSetGlobal("__ffm_as_started_at", null);
    safeSetGlobal("__ffm_ads_queue_started_at", null);

    try {
      if (typeof ffmAdsRebuildAllAlarms === "function") {
        ffmAdsRebuildAllAlarms(`hard-reset:${reason}`).catch(() => {});
        cleared.push("ffmAdsRebuildAllAlarms()");
      } else if (typeof ffmAdsRebuildPerListingAlarms === "function") {
        Promise.resolve(ffmAdsRebuildPerListingAlarms()).catch(() => {});
        cleared.push("ffmAdsRebuildPerListingAlarms()");
      }
    } catch (e) {}

    try { console.warn("[AutoList Pro HARD RESET] cleared:", cleared); } catch (e) {}
    return { ok: true, reason, cleared };
  }

  try { globalThis.ffmHardReset = ffmHardReset; } catch (e) {}

  // -----------------------------
  // 2) Recover after publish
  // -----------------------------
  function ffmRecoverAfterPublish(reason = "publish-finalize") {
    try { console.warn("[AutoList Pro RECOVER] after publish:", reason); } catch (e) {}

    safeSetGlobal("ffmPublishLock", false);
    safeSetGlobal("FFM_PUBLISH_LOCK", false);
    safeSetGlobal("ffmPublishInProgress", false);
    safeSetGlobal("ffmPublishRunning", false);
    safeSetGlobal("__ffm_publish_started_at", null);

    safeSetGlobal("ffmDnRRunning", false);
    safeSetGlobal("ffmSDnRRunning", false);
    safeSetGlobal("__ffm_dnr_started_at", null);

    safeSetGlobal("ffmQueueProcessing", false);
    safeSetGlobal("__ffm_ads_queue_processing", false);
    safeSetGlobal("__ffm_ads_queue_started_at", null);
  }

  // -----------------------------
  // Central finalizer called after publish/DnR/ADS complete
  // -----------------------------
  function ffmFinalizeRun(reason = 'finalize') {
    try { console.log('[AutoList Pro] ffmFinalizeRun:', reason); } catch (e) {}
    try { ffmRecoverAfterPublish(reason); } catch (e) {}
    try { globalThis.ffmUserGestureActive = false; } catch (e) {}
    try { globalThis.__ffm_block_as = false; } catch (e) {}
  }

  // -----------------------------
  // 3) Watchdog
  // -----------------------------
  const WATCHDOG_EVERY_MS = 30_000;
  const STUCK_PUBLISH_MS  = 2 * 60_000;
  const STUCK_DNR_MS      = 5 * 60_000;
  const STUCK_AS_MS       = 2 * 60_000;
  const STUCK_ADS_Q_MS    = 5 * 60_000;

  function ffmWatchdogTick() {
    try {
      const p = safeGetGlobal("__ffm_publish_started_at");
      const d = safeGetGlobal("__ffm_dnr_started_at");
      const a = safeGetGlobal("__ffm_as_started_at");
      const q = safeGetGlobal("__ffm_ads_queue_started_at");

      if (p && since(p) > STUCK_PUBLISH_MS) return ffmHardReset("watchdog:publish-stuck");
      if (d && since(d) > STUCK_DNR_MS)     return ffmHardReset("watchdog:dnr-stuck");
      if (a && since(a) > STUCK_AS_MS)      return ffmHardReset("watchdog:as-stuck");
      if (q && since(q) > STUCK_ADS_Q_MS)   return ffmHardReset("watchdog:ads-queue-stuck");
    } catch (e) {}
  }

  try {
    if (!safeGetGlobal("__ffm_watchdog_interval")) {
      const id = setInterval(ffmWatchdogTick, WATCHDOG_EVERY_MS);
      safeSetGlobal("__ffm_watchdog_interval", id);
      try { console.log("[AutoList Pro] Watchdog installed"); } catch (e) {}
    }
  } catch (e) {}

  // -----------------------------
  // 4) Wrap key flows
  // -----------------------------
  function wrapAsyncFunction(fnName, { before, after, onError, finallyDo } = {}) {
    try {
      if (typeof globalThis[fnName] !== "function") return false;
      if (globalThis[fnName].__ffm_wrapped) return true;

      const orig = globalThis[fnName];
      const wrapped = async function (...args) {
        try { before && before(...args); } catch (e) {}
        try {
          const res = await orig.apply(this, args);
          try { after && after(res, ...args); } catch (e) {}
          return res;
        } catch (err) {
          try { onError && onError(err, ...args); } catch (e) {}
          throw err;
        } finally {
          try { finallyDo && finallyDo(...args); } catch (e) {}
        }
      };
      wrapped.__ffm_wrapped = true;
      wrapped.__ffm_original = orig;
      globalThis[fnName] = wrapped;
      try { console.log(`[AutoList Pro] Wrapped ${fnName}() for safety`); } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  wrapAsyncFunction("publishListingById", {
    before: () => { safeSetGlobal("__ffm_publish_started_at", now()); },
    onError: (err) => { try { console.warn("[AutoList Pro] publishListingById error -> forcing recover", err); } catch (e) {} },
    finallyDo: () => { ffmFinalizeRun("publishListingById.finally"); }
  });

  wrapAsyncFunction("ffmStartDeleteAndRelist", {
    before: () => safeSetGlobal("__ffm_dnr_started_at", now()),
    onError: (err) => { try { console.warn("[AutoList Pro] ffmStartDeleteAndRelist error -> hard reset", err); } catch (e) {} ; ffmHardReset("dnr-error"); },
    finallyDo: () => { safeSetGlobal("__ffm_dnr_started_at", null); ffmFinalizeRun('dnr.finally'); }
  });

  wrapAsyncFunction("ffmRunActiveSyncBackground", {
    before: () => safeSetGlobal("__ffm_as_started_at", now()),
    onError: (err) => { try { console.warn("[AutoList Pro] ffmRunActiveSyncBackground error -> hard reset", err); } catch (e) {} ; ffmHardReset("as-error"); },
    finallyDo: () => { safeSetGlobal("__ffm_as_started_at", null); ffmFinalizeRun('as.finally'); }
  });

  wrapAsyncFunction("ffmAdsProcessQueue", {
    before: () => safeSetGlobal("__ffm_ads_queue_started_at", now()),
    onError: (err) => { try { console.warn("[AutoList Pro] ffmAdsProcessQueue error -> hard reset", err); } catch (e) {} ; ffmHardReset("ads-queue-error"); },
    finallyDo: () => { safeSetGlobal("__ffm_ads_queue_started_at", null); ffmFinalizeRun('ads-queue.finally'); }
  });

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || !msg.action) return;
        if (msg.action === "ffm_hard_reset") {
          const reason = msg.reason || "manual";
          const out = ffmHardReset(reason);
          try { sendResponse(out); } catch (e) {}
          return;
        }
        if (msg.action === "ffm_recover_after_publish") {
          ffmRecoverAfterPublish(msg.reason || "manual");
          try { sendResponse({ ok: true }); } catch (e) {}
          return;
        }
      } catch (e) {}
    });
  } catch (e) {}

  try { console.log("[AutoList Pro] Safety patch installed (hard reset + wrappers + watchdog)"); } catch (e) {}
})();

  // -------------------------
  // ADS boot restore supervisor
  // -------------------------
  (function installAdsBootRestoreSupervisor() {
    try {
      // single-flight promise so startup cannot double-run/skip
      globalThis.__ffm_ads_boot_rebuild_p = null;

      // Retry count is persisted in chrome.storage.local (NOT just globalThis)
      // because the MV3 service worker gets torn down and respawned on its
      // own schedule (idle timeout, alarms, etc.). An in-memory counter reset
      // to 0 on every respawn meant the "retry up to 3 times" cap never
      // actually held — each new SW instance started the count over, so a
      // rule set that could never produce an alarm retried forever.
      const FFM_ADS_BOOT_RETRY_KEY = 'ffm_ads_boot_retry_state';
      const FFM_ADS_BOOT_MAX_RETRIES = 3;
      const FFM_ADS_BOOT_RETRY_RESET_MS = 10 * 60 * 1000; // treat as a fresh problem after 10 min

      async function ffmAdsGetBootRetryCount() {
        try {
          const res = await new Promise((r) => { try { chrome.storage.local.get([FFM_ADS_BOOT_RETRY_KEY], r); } catch (e) { r({}); } });
          const state = res && res[FFM_ADS_BOOT_RETRY_KEY];
          if (!state || typeof state.count !== 'number') return 0;
          if (state.ts && (Date.now() - Number(state.ts)) > FFM_ADS_BOOT_RETRY_RESET_MS) return 0;
          return state.count;
        } catch (e) { return 0; }
      }

      async function ffmAdsSetBootRetryCount(count) {
        try { await new Promise((r) => { try { chrome.storage.local.set({ [FFM_ADS_BOOT_RETRY_KEY]: { count, ts: Date.now() } }, r); } catch (e) { r(); } }); } catch (e) {}
      }

      async function ffmAdsBootRestore(reason) {
        // If one is already in progress, join it (do NOT skip)
        if (globalThis.__ffm_ads_boot_rebuild_p) return globalThis.__ffm_ads_boot_rebuild_p;

        globalThis.__ffm_ads_boot_rebuild_p = (async () => {
          try {
            console.warn('[FFM Scheduler] 🔁 ADS boot restore starting. Reason:', reason);
            try { globalThis.__ffm_ads_boot_start_ts = Date.now(); } catch (e) {}

            // IMPORTANT: hard-reset the "already running" guard(s) if they exist
            // (this is what causes: "skipped — already running" on boot)
            try { globalThis.__ffm_ads_rebuilding = false; } catch (e) {}
            try { globalThis.__ffmAdsRebuildRunning = false; } catch (e) {}
            try { globalThis.__ffmAdsRebuildRunning = false; } catch (e) {}

            // Give storage/canonical caches a moment to hydrate on boot
            // (avoid rebuilding from empty rules)
            await new Promise(r => setTimeout(r, 800));

            // Clean up any daily/forever rules left behind for listings that
            // no longer exist before attempting to rebuild alarms from them —
            // this is what was causing zero-alarm rebuilds to retry forever.
            let pruneInfo = null;
            try { pruneInfo = await ffmAdsPruneOrphanedForeverRules(reason); } catch (e) {}

            // Wait for ADS core readiness flag AND the rebuild function itself
            async function waitForAdsReadyAndFn(timeoutMs = 20000, intervalMs = 250) {
              const start = Date.now();
              try { console.debug && console.debug('[FFM Scheduler] waitForAdsReadyAndFn: waiting up to', timeoutMs, 'ms'); } catch (e) {}
              while ((Date.now() - start) < timeoutMs) {
                try {
                  let flag = !!globalThis.__ffm_ads_ready;
                  // Fallback: check persistent storage marker if in-memory flag isn't set
                  if (!flag) {
                    try {
                      const res = await new Promise((resolve) => {
                        try { chrome.storage.local.get(['ffm_ads_core_ready'], resolve); } catch (e) { resolve({}); }
                      });
                      if (res && res.ffm_ads_core_ready) {
                        flag = true;
                        try { console.debug && console.debug('[FFM Scheduler] waitForAdsReadyAndFn: storage marker found'); } catch (e) {}
                      }
                    } catch (e) {}
                  }
                  const fnPresent = (typeof ffmAdsRebuildAllAlarms === 'function');
                  if (flag && fnPresent) {
                    try { console.debug && console.debug('[FFM Scheduler] waitForAdsReadyAndFn: ready + fn present'); } catch (e) {}
                    return true;
                  }
                } catch (e) {}
                await new Promise(r => setTimeout(r, intervalMs));
              }
              try { console.warn('[FFM Scheduler] waitForAdsReadyAndFn: timed out after', timeoutMs, 'ms'); } catch (e) {}
              return false;
            }

            // Reserve stats container early so fallback attempts can populate it
            let stats = null;
            const readyAndFn = await waitForAdsReadyAndFn(20000, 250);
            if (!readyAndFn) {
              console.warn('[FFM Scheduler] ADS core or rebuild function not available within timeout — attempting storage-driven fallback before deferring boot restore');

              // Inline fallback attempt: try to build alarms directly from storage when
              // the canonical readiness check failed. This duplicates the later
              // fallbackRebuildFromStorage logic but ensures we attempt to recover
              // on boot when load ordering prevents the canonical helper from
              // reporting ready in time.
              try {
                const stored = await new Promise((res) => { try { chrome.storage.local.get(['ffm_advanced_scheduler_rules', 'ffm_advanced_scheduler_rules'], res); } catch (e) { res({}); } });
                const rules = (stored && (stored['ffm_advanced_scheduler_rules'] || stored['ffm_advanced_scheduler_rules'])) ? (stored['ffm_advanced_scheduler_rules'] || stored['ffm_advanced_scheduler_rules']) : {};
                if (rules && Object.keys(rules).length) {
                  try { console.debug && console.debug('[FFM Scheduler] ADS boot inline fallback: rules found', Object.keys(rules).length); } catch (e) {}
                  try {
                    // Ensure we have a compute-next-run function available.
                    function computeNextRunFallback(rule, nowMs) {
                      try {
                        if (!rule || !rule.enabled) return null;
                        const now = nowMs || Date.now();
                        const dayMs = 24 * 60 * 60 * 1000;
                        const existingNext = rule.nextRunAt ? Number(rule.nextRunAt) : 0;
                        if (existingNext && existingNext > now + 5_000) return existingNext;
                        const intervalDays = Number(rule.daysActive || 1);
                        const timeStr = rule.time || rule.preferredTime || "04:30";
                        const [hhStr, mmStr] = String(timeStr || "").split(":");
                        const hh = parseInt(hhStr || "0", 10) || 0;
                        const mm = parseInt(mmStr || "0", 10) || 0;
                        let next = new Date(now);
                        next.setSeconds(0, 0);
                        next.setHours(hh, mm, 0, 0);
                        let when = next.getTime();
                        while (when <= now) { when += intervalDays * dayMs; }
                        return when;
                      } catch (e) { try { console.warn('[FFM Scheduler] computeNextRun fallback failed', e); } catch(_){}; return null; }
                    }
                    const computeNextRun = (typeof ffmAdsComputeNextRunForRule === 'function') ? ffmAdsComputeNextRunForRule : computeNextRunFallback;
                    try { console.debug && console.debug('[FFM Scheduler] compute availability', { ffmAdsComputeNextRunForRule: typeof ffmAdsComputeNextRunForRule, computeNextRun: typeof computeNextRun }); } catch (e) {}
                    const all = await new Promise(r => { try { chrome.alarms.getAll(r); } catch (e) { r([]); } });
                    const adsAlarmNames = (all || []).filter(a => a && (a.name === 'ffm_auto_dnr_daily' || (a.name && a.name.startsWith('ffm_auto_dnr_daily::')))).map(a => a.name);
                    if (adsAlarmNames.length) {
                      await Promise.all(adsAlarmNames.map(n => new Promise((r) => { try { chrome.alarms.clear(n, () => r(true)); } catch (e) { r(false); } })));
                    }
                  } catch (e) {}

                  let created = 0;
                  const now = Date.now();
                  for (const [listingId, rule] of Object.entries(rules || {})) {
                    try {
                      if (!rule) {
                        console.debug && console.debug('[FFM Scheduler] inline fallback skip: missing rule', listingId);
                        continue;
                      }
                      if (!rule.enabled) {
                        console.debug && console.debug('[FFM Scheduler] inline fallback skip: disabled', listingId);
                        continue;
                      }
                      let when = null;
                      try {
                        // Call canonical helper if available, otherwise use the fallback directly.
                        if (typeof ffmAdsComputeNextRunForRule === 'function') {
                          when = ffmAdsComputeNextRunForRule(rule, now);
                        } else {
                          when = computeNextRunFallback(rule, now);
                        }
                      } catch (errCompute) {
                        console.warn && console.warn('[FFM Scheduler] computeNextRun threw', listingId, errCompute);
                        when = null;
                      }
                      if (!when) {
                        console.debug && console.debug('[FFM Scheduler] inline fallback skip: no schedule computed', { listingId, rule });
                        continue;
                      }
                      const computedAlarmName = 'ffm_auto_dnr_daily::' + String(listingId || '');
                      try {
                        const PREWARM_AT = Number(when) - 60_000;
                        console.debug && console.debug('[FFM Scheduler] inline fallback plan', { listingId, when, prewarmAt: PREWARM_AT });
                        if (PREWARM_AT > Date.now()) {
                          try {
                            const prewarmName = 'ffm_ads_prewarm::' + String(listingId || '');
                            chrome.alarms.create(prewarmName, { when: PREWARM_AT });
                            try { chrome.alarms.get(prewarmName, a => { if (!a) { try { console.warn('[FFM Scheduler] prewarm alarm missing after create', prewarmName, chrome.runtime && chrome.runtime.lastError); } catch(e){} } }); } catch(e){}
                          } catch (e) { console.warn('[FFM Scheduler] prewarm create failed', listingId, e); }
                        }
                        try {
                          chrome.alarms.create(computedAlarmName, { when, periodInMinutes: 1440 });
                          try { chrome.alarms.get(computedAlarmName, a => { if (!a) { try { console.warn('[FFM Scheduler] alarm missing after create', computedAlarmName, chrome.runtime && chrome.runtime.lastError); } catch(e){} } }); } catch(e){}
                        } catch (e) { console.warn('[FFM Scheduler] alarm create failed', computedAlarmName, e); }
                        try { const metaKey = 'ffm_alarm_meta_' + String(computedAlarmName || ''); const meta = { authoritative: true, ruleId: rule && rule.id ? rule.id : null, scheduledAt: when }; chrome.storage.local.set({ [metaKey]: meta }); } catch (e) { console.warn('[FFM Scheduler] meta persist failed', computedAlarmName, e); }
                        created++;
                      } catch (e) { console.warn('[FFM Scheduler] inline fallback per-rule error', listingId, e); }
                    } catch (e) { console.warn('[FFM Scheduler] inline fallback loop error', e); }
                  }
                  if (created > 0) {
                    stats = { totalRules: Object.keys(rules || {}).length, jobsCreated: created, alarmsActive: created };
                    // mark that the inline fallback succeeded so later boot warnings can be suppressed
                    try { globalThis.__ffm_ads_boot_fallback_used = true; } catch (e) {}
                    console.warn('[FFM Scheduler] ADS boot inline fallback created alarms', stats);
                  } else {
                    console.debug && console.debug('[FFM Scheduler] ADS boot inline fallback found rules but created 0 alarms');
                  }
                } else {
                  console.debug && console.debug('[FFM Scheduler] ADS boot inline fallback: no rules found in storage');
                }
              } catch (e) {
                console.warn('[FFM Scheduler] ADS boot inline fallback failed', e);
              }

              // If fallback did not create alarms, continue with retry/backoff as before
              if (!stats) {
                const retryCount = await ffmAdsGetBootRetryCount();
                if (retryCount < FFM_ADS_BOOT_MAX_RETRIES) {
                  const nextCount = retryCount + 1;
                  await ffmAdsSetBootRetryCount(nextCount);
                  const backoffMs = 1500 * nextCount;
                  setTimeout(() => { try { ffmAdsBootRestore('boot-wait-retry'); } catch (e) {} }, backoffMs);
                } else {
                  console.warn('[FFM Scheduler] ADS boot restore: giving up after', FFM_ADS_BOOT_MAX_RETRIES, 'retries (persisted across service-worker restarts). Run ffmAdsRebuildAllAlarms() manually if this is unexpected.');
                }
                return null;
              }
            }
            try {
              if (typeof ffmAdsRebuildAllAlarms === 'function') {
                stats = await ffmAdsRebuildAllAlarms('boot-restore');
              } else {
                // Only warn if the inline storage-driven fallback did not already succeed.
                if (!globalThis.__ffm_ads_boot_fallback_used) {
                  console.warn('[FFM Scheduler] ffmAdsRebuildAllAlarms not available at boot restore');
                } else {
                  console.debug && console.debug('[FFM Scheduler] ffmAdsRebuildAllAlarms unavailable but inline fallback succeeded — skipping noisy warning');
                }
              }
            } catch (e) {
              console.warn('[FFM Scheduler] ADS rebuild threw during boot restore', e);
            }

            // Fallback: if rebuild didn't create alarms (or function absent), attempt
            // a storage-driven rebuild that mirrors the manual 'rules-changed' path.
            // This helps when the canonical helper isn't reachable due to load ordering.
            async function fallbackRebuildFromStorage() {
              try {
                const stored = await new Promise((res) => { try { chrome.storage.local.get(['ffm_advanced_scheduler_rules', 'ffm_advanced_scheduler_rules'], res); } catch (e) { res({}); } });
                const rules = (stored && (stored['ffm_advanced_scheduler_rules'] || stored['ffm_advanced_scheduler_rules'])) ? (stored['ffm_advanced_scheduler_rules'] || stored['ffm_advanced_scheduler_rules']) : {};
                if (!rules || Object.keys(rules).length === 0) {
                  try { console.debug && console.debug('[FFM Scheduler] fallbackRebuildFromStorage: no rules found in storage'); } catch (e) {}
                  return null;
                }

                // Clear existing ADS alarms to avoid duplicates (same behavior as canonical rebuild)
                try {
                  const all = await new Promise(r => { try { chrome.alarms.getAll(r); } catch (e) { r([]); } });
                  const adsAlarmNames = (all || []).filter(a => a && (a.name === 'ffm_auto_dnr_daily' || (a.name && a.name.startsWith(FFM_ADS_ALARM_PREFIX)))).map(a => a.name);
                  if (adsAlarmNames.length) {
                    await Promise.all(adsAlarmNames.map(n => new Promise((r) => { try { chrome.alarms.clear(n, () => r(true)); } catch (e) { r(false); } })));
                  }
                } catch (e) {}

                let created = 0;
                const now = Date.now();
                // local fallback for computeNextRun in case the canonical helper isn't present
                const computeNextRun = (typeof ffmAdsComputeNextRunForRule === 'function') ? ffmAdsComputeNextRunForRule : function(rule, nowMs) {
                  try {
                    if (!rule || !rule.enabled) return null;
                    const nowLocal = nowMs || Date.now();
                    const dayMs = 24 * 60 * 60 * 1000;
                    const existingNext = rule.nextRunAt ? Number(rule.nextRunAt) : 0;
                    if (existingNext && existingNext > nowLocal + 5_000) return existingNext;
                    const intervalDays = Number(rule.daysActive || 1);
                    const timeStr = rule.time || rule.preferredTime || "04:30";
                    const [hhStr, mmStr] = String(timeStr || "").split(":");
                    const hh = parseInt(hhStr || "0", 10) || 0;
                    const mm = parseInt(mmStr || "0", 10) || 0;
                    let next = new Date(nowLocal);
                    next.setSeconds(0, 0);
                    next.setHours(hh, mm, 0, 0);
                    let when = next.getTime();
                    while (when <= nowLocal) { when += intervalDays * dayMs; }
                    return when;
                  } catch (e) { try { console.warn('[FFM Scheduler] computeNextRun fallback failed', e); } catch(_){}; return null; }
                };
                for (const [listingId, rule] of Object.entries(rules || {})) {
                  try {
                    if (!rule || !rule.enabled) continue;
                    const when = computeNextRun(rule, now);
                    if (!when) continue;
                    const alarmName = ffmAdsAlarmNameFor(listingId);
                      try {
                        const PREWARM_AT = Number(when) - 60_000;
                        if (PREWARM_AT > Date.now()) {
                          try {
                            chrome.alarms.create(ffmAdsPrewarmAlarmName(listingId), { when: PREWARM_AT });
                            try { chrome.alarms.get(ffmAdsPrewarmAlarmName(listingId), a => { if (!a) { try { console.warn('[FFM Scheduler] prewarm alarm missing after create', ffmAdsPrewarmAlarmName(listingId), chrome.runtime && chrome.runtime.lastError); } catch(e){} } }); } catch(e){}
                          } catch (e) {}
                        }
                        try {
                          chrome.alarms.create(alarmName, { when, periodInMinutes: 1440 });
                          try { chrome.alarms.get(alarmName, a => { if (!a) { try { console.warn('[FFM Scheduler] alarm missing after create', alarmName, chrome.runtime && chrome.runtime.lastError); } catch(e){} } }); } catch(e){}
                        } catch (e) {}
                        // persist metadata
                        try { const metaKey = 'ffm_alarm_meta_' + String(alarmName || ''); const meta = { authoritative: true, ruleId: rule && rule.id ? rule.id : null, scheduledAt: when }; chrome.storage.local.set({ [metaKey]: meta }); } catch (e) {}
                        created++;
                      } catch (e) {}
                  } catch (e) {}
                }
                return { totalRules: Object.keys(rules || {}).length, jobsCreated: created, alarmsActive: created };
              } catch (e) {
                try { console.warn('[FFM Scheduler] fallbackRebuildFromStorage failed', e); } catch (er) {}
                return null;
              }
            }

            if (!stats || (stats.alarmsActive === 0)) {
              try {
                const fb = await fallbackRebuildFromStorage();
                if (fb) stats = fb;
              } catch (e) {}
            }

            // Verify alarms created
            const alarms = await new Promise(resolve => {
              try {
                chrome.alarms.getAll(a => resolve(Array.isArray(a) ? a : []));
              } catch (e) { resolve([]); }
            });

            const adsCount = alarms.filter(a => String(a.name || '').startsWith('ffm_ads_')).length;
            const dailyCount = alarms.filter(a => String(a.name || '').startsWith('ffm_auto_dnr_daily')).length;

            console.warn('[FFM Scheduler] ADS boot restore verify', {
              adsAlarms: adsCount,
              dailyAlarms: dailyCount,
              totalAlarms: alarms.length,
              stats: stats || null
            });

            // Compact boot metrics snapshot for observability
            try {
              const bootSummary = {
                rules: (stats && stats.totalRules) ? stats.totalRules : (stats === null ? 0 : (stats.totalRules || 0)),
                alarms: alarms.length,
                fallbackUsed: !!globalThis.__ffm_ads_boot_fallback_used,
                verifyTimeMs: Date.now() - (globalThis.__ffm_ads_boot_start_ts || Date.now())
              };
              console.info('[FFM Scheduler] ADS BOOT SUMMARY:', bootSummary);
            } catch (e) {}

            // If we ended up with zero ADS alarms, retry a few times.
            // This handles the case where rules haven't loaded yet at the first boot tick.
            // NOTE: use dailyCount (the actual "ffm_auto_dnr_daily::" relist alarms),
            // not adsCount — adsCount only counts "ffm_ads_" prewarm alarms, which
            // legitimately don't exist when the next run is under a minute away,
            // and was causing retries to fire even when real alarms were present.
            if (dailyCount > 0) {
              // Success — clear the persisted retry counter so a real future
              // problem gets its own fresh set of retries.
              try { await ffmAdsSetBootRetryCount(0); } catch (e) {}
            } else if (pruneInfo && pruneInfo.checked > 0 && pruneInfo.checked === pruneInfo.pruned) {
              // Every rule that existed was an orphaned daily/forever rule and
              // just got deleted — zero alarms is now the correct, expected
              // state, not a boot-ordering race. Don't retry.
              console.warn('[FFM Scheduler] No ADS alarms after boot restore, but all rules were orphaned and pruned — nothing left to schedule.');
              try { await ffmAdsSetBootRetryCount(0); } catch (e) {}
            } else {
              const retryCount = await ffmAdsGetBootRetryCount();
              if (retryCount < FFM_ADS_BOOT_MAX_RETRIES) {
                const nextCount = retryCount + 1;
                await ffmAdsSetBootRetryCount(nextCount);
                const backoffMs = 1500 * nextCount;

                console.warn('[FFM Scheduler] ⚠️ ADS alarms missing after boot restore — retrying', {
                  attempt: nextCount,
                  backoffMs
                });

                setTimeout(() => {
                  try { ffmAdsBootRestore('boot-retry'); } catch (e) {}
                }, backoffMs);
              } else {
                console.warn('[FFM Scheduler] ADS boot restore: giving up after', FFM_ADS_BOOT_MAX_RETRIES, 'retries (persisted across service-worker restarts). Run ffmAdsRebuildAllAlarms() manually if this is unexpected.');
              }
            }

            return stats;
          } finally {
            // allow future boot-retries / manual triggers
            globalThis.__ffm_ads_boot_rebuild_p = null;
          }
        })();

        return globalThis.__ffm_ads_boot_rebuild_p;
      }

      // Kick once at startup (delayed slightly)
      try { setTimeout(() => { try { ffmAdsBootRestore('startup'); } catch (e) {} }, 1200); } catch (e) {}

      // Expose for debugging
      try { globalThis.ffmAdsBootRestore = ffmAdsBootRestore; } catch (e) {}

      console.warn('[FFM Scheduler] ADS boot restore supervisor installed');

      // Deterministic post-init hook: if a prior SW instance already wrote the
      // persistent ADS-ready marker, trigger the boot restore immediately so we
      // do not rely solely on polling windows which can race with init ordering.
      try {
        try {
          chrome.storage.local.get(['ffm_ads_core_ready'], (res) => {
            try {
              if (res && res.ffm_ads_core_ready) {
                console.warn('[FFM Scheduler] Persistent ADS-ready marker detected at supervisor install — triggering boot restore');
                try { ffmAdsBootRestore('startup-storage-detected'); } catch (e) {}
              }
            } catch (e) {}
          });
        } catch (e) {}
      } catch (e) {}
    } catch (e) {
      console.warn('[FFM Scheduler] ADS boot restore supervisor failed to install', e);
    }
  })();

// ================================
// Restore side panel after controlled reboot
// ================================
try {
  chrome.storage.local.get(
    ['ffm_restore_sidepanel_after_reload', 'ffm_restore_sidepanel_ts'],
    (res) => {
      try {
        if (!res || !res.ffm_restore_sidepanel_after_reload) return;

        console.warn('[AutoList Pro] 🔁 Restoring side panel after controlled reboot');

        // Clear flag immediately to avoid loops
        try { chrome.storage.local.remove(['ffm_restore_sidepanel_after_reload', 'ffm_restore_sidepanel_ts']); } catch (e) {}

        // Small delay lets Chrome fully settle
        setTimeout(async () => {
          try {
            if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
              try { await chrome.sidePanel.open({}); } catch (e) { /* ignore */ }
              console.warn('[AutoList Pro] ✅ Side panel reopened after reboot');
            }
          } catch (e) {
            console.warn('[AutoList Pro] Side panel restore skipped:', e && e.message ? e.message : e);
          }
        }, 1500);
      } catch (e) {}
    }
  );
} catch (e) {
  console.warn('[AutoList Pro] Side panel restore init failed', e);
}

// Expose save helpers for SW console debugging
try {
  globalThis.ffmSchedulerSaveRules = ffmSchedulerSaveRules;
} catch (e) {}

// Debug helper: simulate an incoming partial rule update and log before/after
try {
  globalThis.ffmDebugMergeTest = async function(listingId, incomingPartial) {
    try {
      const key = 'ffm_advanced_scheduler_rules';
      const get = (k) => new Promise(r => { try { chrome.storage.local.get(k, r); } catch (e) { r({}); } });
      const set = (obj) => new Promise(r => { try { chrome.storage.local.set(obj, r); } catch (e) { r(); } });

      const beforeRes = await get(key);
      const before = beforeRes && beforeRes[key] ? beforeRes[key] : {};
      console.log('[ffmDebugMergeTest] before', before[listingId]);

      console.log('[ffmDebugMergeTest] incomingPartial', incomingPartial);

      const incoming = {};
      incoming[listingId] = incomingPartial || {};

      // local deep-merge (same semantics as save paths)
      function mergeRuleLocal(priorObj, incomingObj) {
        const out = Object.assign({}, priorObj || {});
        try {
          for (const k of Object.keys(incomingObj || {})) {
            const val = incomingObj[k];
            if (typeof val === 'undefined' || val === null) continue;
            if (Array.isArray(val)) { out[k] = val.slice(); continue; }
            if (typeof val === 'object') {
              out[k] = mergeRuleLocal(priorObj && priorObj[k] ? priorObj[k] : {}, val);
              continue;
            }
            out[k] = val;
          }
        } catch (e) {}
        return out;
      }

      const newRules = Object.assign({}, before);
      for (const id of Object.keys(incoming)) {
        const merged = mergeRuleLocal(before[id] || {}, incoming[id] || {});
        console.log('[ffmDebugMergeTest] merged for', id, merged);
        newRules[id] = merged;
      }

      await set({ [key]: newRules });

      const afterRes = await get(key);
      const after = afterRes && afterRes[key] ? afterRes[key] : {};
      console.log('[ffmDebugMergeTest] after', after[listingId]);
      return { before: before[listingId], merged: newRules[listingId], after: after[listingId] };
    } catch (e) { console.error('[ffmDebugMergeTest] error', e); return null; }
  };
} catch (e) {}