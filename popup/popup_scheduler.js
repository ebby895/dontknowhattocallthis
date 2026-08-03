//
// popup_scheduler.js — Advanced Scheduler (ADS) UI for AutoList Pro
//

/* global chrome */

// ---------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------

window.ffmSchedulerState = window.ffmSchedulerState || {
  rules: {},          // listingId -> rule
  listings: [],       // active listings snapshot
  editingRuleId: null,
  selectedListing: null,
  daysActive: 1,
  timeOfDay: "09:00",
  repeatMode: "forever", // "forever" | "once"
  step: 1
};

// History filter state
let ffmHistoryFilter = "all"; // all | success | failed | today | last7

const FFM_ADS_RULES_KEY = "ffm_advanced_scheduler_rules";


// ---------------------------------------------------------------------
// Simple helpers
// ---------------------------------------------------------------------

function ffmSchedulerEscapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ffmSchedulerStorageGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (res) => {
        resolve(res || {});
      });
    } catch (e) {
      console.warn("[ADS] storage.get failed", e);
      resolve({});
    }
    // React to storage changes so Saved Events / Upcoming lists stay in sync
    try {
      if (chrome && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          try {
            if (areaName !== 'local') return;
            const watched = ['ffm_advanced_scheduler_rules', 'scheduled_tasks', 'ffmCanonicalListings', 'listings', 'ffm_scheduler_refresh_req'];
            const keys = Object.keys(changes || {});
            const intersects = keys.some(k => watched.includes(k));
            if (!intersects) return;
            (async () => {
              try {
                await ffmSchedulerHydrateFromStorage();
                try { ffmSchedulerRenderOverlayRules(); } catch (e) {}
                try { ffmSchedulerRenderUpcomingOverlayEvents(); } catch (e) {}
              } catch (e) {}
            })();
          } catch (e) {}
        });
      }
    } catch (e) {}

    // When the popup becomes visible again, rehydrate to pick up any background changes
    try {
      document.addEventListener('visibilitychange', () => {
        try {
          if (document.visibilityState === 'visible') {
            (async () => {
              try {
                await ffmSchedulerHydrateFromStorage();
                try { ffmSchedulerRenderOverlayRules(); } catch (e) {}
                try { ffmSchedulerRenderUpcomingOverlayEvents(); } catch (e) {}
              } catch (e) {}
            })();
          }
        } catch (e) {}
      });
    } catch (e) {}
  });
}

function ffmSchedulerStorageSet(obj) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(obj, () => resolve(true));
    } catch (e) {
      console.warn("[ADS] storage.set failed", e);
      resolve(false);
    }
  });
}

function ffmSchedulerRulesMapToArray(map) {
  const m = map || {};
  return Object.keys(m)
    .map((k) => Object.assign({ listingId: k }, m[k]))
    .sort((a, b) => {
      const ca = Number(a.createdAt || 0);
      const cb = Number(b.createdAt || 0);
      return ca - cb;
    });
}

// Helper to compute next run timestamp for a given HH:MM time string
function ffmADSComputeNextRunTime(timeStr) {
  try {
    // Be defensive: allow numbers or other types and coerce to string
    const ts = String(timeStr || "");
    const parts = ts.split(":").map(Number);
    const hh = parts[0] || 0;
    const mm = parts[1] || 0;
    const now = new Date();
    const next = new Date();
    next.setHours(hh, mm, 0, 0);
    // If today has already passed this time, schedule for tomorrow
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  } catch (e) {
    console.warn("[ADS] computeNextRunTime failed", e);
    return null;
  }
}

// ----------------------------
// Last-run formatting helpers
// ----------------------------
function ffmAdsFormatTimeShortFromTs(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    let hh = d.getHours();
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12;
    if (hh === 0) hh = 12;
    return `${hh}:${mm} ${ampm}`;
  } catch (e) {
    return '';
  }
}

// Human-friendly date/time formatter for history entries
function ffmAdsFormatDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}

function ffmAdsBuildLastRunLabel(rule) {
  if (!rule || !rule.lastRun || !rule.lastRunStatus) {
    return 'Last run: —';
  }
  const t = ffmAdsFormatTimeShortFromTs(rule.lastRun);
  const status = rule.lastRunStatus || 'unknown';
  let icon = '●';
  let label = 'Unknown';

  if (status === 'success') { icon = '🟢'; label = 'Success'; }
  else if (status === 'failed') { icon = '🔴'; label = 'Failed'; }
  else if (status === 'skipped') { icon = '⚠️'; label = 'Skipped'; }
  else if (status === 'test') { icon = '🧪'; label = 'Test'; }

  const extraNote = rule.lastRunNote ? ` – ${ffmSchedulerEscapeHtml(rule.lastRunNote)}` : '';
  return `Last run: <span style="white-space:nowrap;">${icon} ${label}${t ? ' @ ' + t : ''}</span>${extraNote}`;
}

// ---------------------------------------------------------------------
// CSS injection (overlay + cards + wizard)
// ---------------------------------------------------------------------

(function injectAdsCss() {
  try {
    if (document.getElementById("ffm-ads-css")) return;

    const ffmADSCSS = `
  /* Overlay shell */
  #ffm-ads-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.45);
    z-index: 999999;
    display: none;
    align-items: center;
    justify-content: center;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  #ffm-ads-overlay-inner {
    background: #fff;
    width: 520px;
    max-height: 90vh;
    border-radius: 10px;
    box-shadow: 0 12px 30px rgba(0,0,0,0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #ffm-ads-panel-header {
    padding: 14px 18px;
    border-bottom: 1px solid #eee;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fafafa;
  }
  #ffm-ads-panel-header h2 {
    font-size: 18px;
    margin: 0;
  }
  #ffm-ads-panel-body {
    padding: 16px 18px 18px 18px;
    overflow-y: auto;
  }
  .ffm-ads-close-btn {
    border: 1px solid #ccc;
    background: #f5f5f5;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .ffm-ads-help-btn {
    border: 1px solid #ccc;
    background: #fff;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    margin-right: 8px;
  }
  .ffm-ads-primary-btn {
    display: inline-block;
    background: #0078ff;
    color: #fff;
    border-radius: 999px;
    padding: 8px 18px;
    border: none;
    font-size: 14px;
    cursor: pointer;
  }
  .ffm-ads-primary-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ffm-ads-section-title {
    font-size: 14px;
    font-weight: 600;
    margin: 20px 0 6px 0;
  }
  .ffm-ads-subtext {
    font-size: 12px;
    color: #666;
    margin-bottom: 4px;
  }
  .ffm-ads-empty {
    color: #777;
    padding: 10px 4px;
    font-size: 13px;
  }

  /* Saved Events cards */
  .ffm-ads-event {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #e3e3e3;
    margin-bottom: 10px;
    background: #fafafa;
  }
  .ffm-ads-event-header {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .ffm-ads-event-meta {
    font-size: 12px;
    color: #555;
    margin-bottom: 8px;
  }
  .ffm-ads-event-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .ffm-ads-event-actions button {
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid #ccc;
    background: #fff;
    cursor: pointer;
  }
  .ffm-ads-enable-label {
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  /* Upcoming cards */
  .ffm-ads-upcoming-card {
    background: #eef4ff;
    border: 1px solid #b8d0ff;
    padding: 10px;
    border-radius: 8px;
    margin: 8px 0;
  }
  .ffm-ads-up-row {
    display:flex;
    align-items:center;
    gap:6px;
    font-size:14px;
    font-weight:600;
  }
  .ffm-ads-up-time {
    font-size: 13px;
    color:#333;
    margin-top:2px;
  }
  .ffm-ads-up-title {
    margin-top:4px;
    font-size:15px;
    font-weight:600;
  }
  .ffm-ads-up-repeat {
    margin-top:2px;
    font-size:12px;
    color:#555;
  }
  .ffm-ads-upcoming-footer {
    margin-top:8px;
    padding-top:6px;
    border-top:1px solid #e0e0e0;
    display:flex;
    justify-content:space-between;
    align-items:center;
    font-size:11px;
    color:#555;
  }
  .ffm-ads-link-btn {
    border:none;
    background:none;
    padding:0;
    margin:0;
    font-size:11px;
    color:#0078ff;
    cursor:pointer;
    text-decoration:underline;
  }

  /* Wizard */
  .ffm-ads-wizard-section {
    font-size: 14px;
  }
  .ffm-ads-wizard-section p {
    font-size: 13px;
  }
  .ffm-ads-listing-list {
    margin-top: 10px;
  }
  .ffm-ads-listing-card {
    border: 1px solid #e3e3e3;
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 8px;
    background:#fafafa;
    display:flex;
    justify-content:space-between;
    align-items:center;
  }
  .ffm-ads-listing-title {
    font-size: 13px;
    font-weight: 500;
  }
  .ffm-ads-listing-sub {
    font-size: 11px;
    color:#666;
  }
  .ffm-ads-listing-card button {
    font-size: 12px;
    padding:4px 10px;
    border-radius: 4px;
    border:1px solid #0078ff;
    color:#0078ff;
    background:#fff;
    cursor:pointer;
  }
  .ffm-ads-wizard-footer {
    margin-top: 18px;
    display:flex;
    gap:10px;
  }
  .ffm-ads-btn-secondary {
    border-radius: 999px;
    border:1px solid #ccc;
    padding:6px 14px;
    font-size:13px;
    background:#fff;
    cursor:pointer;
  }
  .ffm-ads-btn-primary {
    border-radius: 999px;
    border:none;
    padding:6px 16px;
    font-size:13px;
    background:#00a000;
    color:#fff;
    cursor:pointer;
  }
  input#ffm-ads-days-active {
    width:80px;
  }

  /* History modal items */
  .ffm-ads-history-item {
    display: flex;
    flex-direction: row;
    border-bottom: 1px solid #e6e6e6;
    padding: 8px 0;
    font-size: 13px;
  }

  .ffm-ads-history-bar {
    width: 4px;
    border-radius: 2px;
    margin-right: 10px;
  }

  .ffm-ads-history-details {
    flex: 1;
  }

  .ffm-ads-history-title {
    font-weight: 600;
    margin-bottom: 2px;
  }

  .ffm-ads-history-time {
    color: #666;
    font-size: 12px;
    margin-bottom: 4px;
  }

  .ffm-ads-history-msg {
    font-size: 12px;
    white-space: pre-line;
    color: #444;
  }

  /* Filter buttons */
  .ffm-hist-filter-btn {
    padding:4px 10px;
    background:#f2f2f2;
    border-radius:6px;
    border:1px solid #ccc;
    cursor:pointer;
    font-size:12px;
  }
  .ffm-hist-filter-btn.active {
    background:#0b6bff;
    color:white;
    border-color:#0b6bff;
  }

  /* Filter buttons for history modal */
  .ffm-hist-filter-btn {
    padding:4px 10px;
    background:#f2f2f2;
    border-radius:6px;
    border:1px solid #ccc;
    cursor:pointer;
    font-size:12px;
  }
  .ffm-hist-filter-btn.active {
    background:#0b6bff;
    color:white;
    border-color:#0b6bff;
  }

  /* History summary (advanced metrics) */
  .ffm-history-summary {
    font-size: 13px;
    line-height: 1.5;
    margin-bottom: 10px;
  }

  .ffm-history-hr {
    margin: 8px 0;
    border: none;
    border-top: 1px solid #ddd;
  }

  .ffm-history-sub {
    font-size: 12px;
    color: #777;
    margin-left: 6px;
  }
`;

    const style = document.createElement("style");
    style.id = "ffm-ads-css";
    style.textContent = ffmADSCSS;
    document.head.appendChild(style);
  } catch (e) {
    console.warn("[AutoList Pro Scheduler] CSS injection failed", e);
  }
})();

// ---------------------------------------------------------------------
// Listings plumbed in from popup / content via window.postMessage
// ---------------------------------------------------------------------

function ffmSchedulerReceiveListings(listings) {
  try {
    const arr = Array.isArray(listings) ? listings : [];
    window.ffmSchedulerState.listings = arr;
    // Scheduler listings received (debug removed)
    // Optionally sync to background so canonical listing cache stays hot
    try {
      chrome.runtime.sendMessage({ action: "ffm_ads_sync_listings", listings: arr });
    } catch (e) {}
  } catch (e) {
    // receiveListings failure (debug suppressed)
  }
}

window.addEventListener("message", (ev) => {
  if (!ev.data || ev.data.type !== "ffm_popup_listings") return;
  ffmSchedulerReceiveListings(ev.data.listings);
});

// ---------------------------------------------------------------------
// Open-button wiring (toolbar “Advanced Scheduler” button)
// ---------------------------------------------------------------------

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("#ffm-advanced-scheduler-btn");
  if (!btn) return;
  console.log("[AutoList Pro Scheduler] Button clicked → Opening ADS overlay");
  try {
    if (typeof window.ffmADSOpenPanel === "function") {
      window.ffmADSOpenPanel(true);
    } else {
      console.warn("[ADS] ffmADSOpenPanel missing");
    }
  } catch (e) {
    console.warn("[ADS] open panel failed", e);
  }
});

// ---------------------------------------------------------------------
// State hydration
// ---------------------------------------------------------------------

async function ffmSchedulerHydrateFromStorage() {
  try {
    const res = await ffmSchedulerStorageGet([FFM_ADS_RULES_KEY, "ffmCanonicalListings", "listings"]);
    const map =
      res &&
      res[FFM_ADS_RULES_KEY] &&
      typeof res[FFM_ADS_RULES_KEY] === "object" &&
      !Array.isArray(res[FFM_ADS_RULES_KEY])
        ? res[FFM_ADS_RULES_KEY]
        : {};

    window.ffmSchedulerState.rules = map;

    // Build listings snapshot
    const canonical = res.ffmCanonicalListings || {};
    const fromCanonical = Object.keys(canonical).map((k) => canonical[k]);
    const fromSaved = Array.isArray(res.listings) ? res.listings : [];
    const byId = {};
    for (const src of [fromCanonical, fromSaved]) {
      for (const item of src) {
        if (!item) continue;
        const id = item.listingId || item.id;
        if (!id) continue;
        if (!byId[id]) byId[id] = item;
      }
    }
    window.ffmSchedulerState.listings = Object.values(byId);

    try { /* hydration complete (log suppressed) */ } catch (e) {}
    return map;
  } catch (e) {
    console.warn("[ADS] hydrateFromStorage failed", e);
    window.ffmSchedulerState.rules = {};
    return {};
  }
}

// Listen for background notifications that ADS rules changed and refresh UI
try {
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      try {
        if (!msg || !msg.action) return;
        if (msg.action === 'ffm-ads-rules-updated') {
          (async () => {
            try {
              await ffmSchedulerHydrateFromStorage();
              try { ffmSchedulerRenderOverlayRules(); } catch (e) {}
              try { ffmSchedulerRenderUpcomingOverlayEvents(); } catch (e) {}
            } catch (e) {}
          })();
        }
      } catch (e) {}
    });
  }
} catch (e) {}

// ---------------------------------------------------------------------
// Overlay shell + home screen
// ---------------------------------------------------------------------

function ffmADSBuildShellIfNeeded() {
  let overlay = document.getElementById("ffm-ads-overlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "ffm-ads-overlay";
  overlay.innerHTML = `
    <div id="ffm-ads-overlay-inner">
      <div id="ffm-ads-panel-header">
        <h2>Advanced Scheduler</h2>
        <div style="display:flex; align-items:center; gap:6px;">
          <button class="ffm-ads-help-btn" id="ffm-ads-help-btn" title="Help — Advanced Scheduler">?</button>
          <button class="ffm-ads-close-btn" id="ffm-ads-close-btn">Close</button>
        </div>
      </div>
      <div id="ffm-ads-panel-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Close button
  overlay.querySelector("#ffm-ads-close-btn").addEventListener("click", () => {
    try { window.ffmADSOpenPanel(false); } catch (e) {}
  });

  // Help button: open YouTube help link
  try {
    const help = overlay.querySelector('#ffm-ads-help-btn');
    if (help) {
      help.addEventListener('click', () => {
        try {
          const url = 'https://www.youtube.com/watch?v=-qG5hRKixzo';
          try { chrome.runtime.sendMessage({ type: 'ffm-open-url', url }, (resp) => { try { if (!resp || !resp.ok) console.debug('[ADS help] bg open-url failed', resp); } catch(e){} }); }
          catch (e) { try { window.open(url, '_blank'); } catch (ee) {} }
        } catch (e) {}
      });
    }
  } catch (e) {}

  return overlay;
}

function ffmADSRenderHome() {
  const overlay = ffmADSBuildShellIfNeeded();
  overlay.style.display = "flex";

  const body = document.getElementById("ffm-ads-panel-body");
  if (!body) return;

  body.innerHTML = `
    <div>
      <div style="display:flex; justify-content:center; margin-bottom:18px;">
        <button id="ffm-ads-create-btn" class="ffm-ads-primary-btn">Create Advanced Schedule</button>
      </div>
      <div id="ffm-ads-helper" style="margin-bottom:12px;padding:10px;border-radius:8px;background:#fff8e6;border:1px solid #ffe4b5;font-size:13px;color:#333;">
        <strong>Important:</strong> Scheduled actions require Chrome to be open and the device awake.
        &nbsp;<a href="help.html" class="learn-how-link" target="_blank" rel="noopener">Click here for more details</a>
        <div style="margin-top:8px;font-size:13px;">
          <label style="user-select:none; display:inline-flex; align-items:center; gap:8px;">
            <input id="ffm-ads-hide-warning-overlay" type="checkbox" style="vertical-align:middle;" /> Don't show this message again
          </label>
        </div>
      </div>
      <div>
        <div class="ffm-ads-section-title">Upcoming Events</div>
        <div class="ffm-ads-subtext">Next automatic Delete &amp; Relist runs based on your rules.</div>
        <div id="ffm-ads-upcoming-container" class="ffm-ads-upcoming-list"></div>
      </div>

      <div>
        <div class="ffm-ads-section-title" style="margin-top:18px;">Saved Events</div>
        <div id="ffm-ads-saved-events" class="ffm-ads-saved-list"></div>
      </div>
    </div>
  `;

  // Wire create button
  const createBtn = document.getElementById("ffm-ads-create-btn");
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      console.log("[ADS] Create schedule clicked");
      ffmSchedulerOpenBulkCreate();
    });
  }

  // Wire ADS helper hide checkbox (persisted via schedule_hide_warning)
  try {
    const adsHelper = document.getElementById('ffm-ads-helper');
    const adsHideCb = document.getElementById('ffm-ads-hide-warning-overlay') || document.getElementById('ffm-ads-hide-warning');
    if (adsHelper && adsHideCb) {
      try {
        const readFromStorage = (cb) => {
          try {
            if (chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
              chrome.storage.local.get({ schedule_hide_warning: false }, (res) => {
                try { cb(null, !!(res && res.schedule_hide_warning)); } catch (e) { cb(e); }
              });
            } else {
              cb(null, false);
            }
          } catch (e) { cb(e); }
        };

        readFromStorage((err, hide) => {
          try {
            if (err) console.debug('[ADS] read schedule_hide_warning error', err);
            // fallback: check localStorage in case chrome.storage failed to persist
            try {
              if (!hide && window && window.localStorage && typeof window.localStorage.getItem === 'function') {
                const v = window.localStorage.getItem('schedule_hide_warning');
                if (v === '1' || v === 'true') hide = true;
              }
            } catch (e) {}
            try { /* debug: schedule_hide_warning read suppressed */ } catch(e){}
            adsHideCb.checked = !!hide;
            try { adsHelper.style.display = hide ? 'none' : ''; } catch(e){}
            // Re-apply shortly to avoid race with any subsequent DOM writes
            try { setTimeout(() => { try { adsHelper.style.display = hide ? 'none' : ''; } catch(e){} }, 80); } catch(e){}
          } catch (e) {}
        });
      } catch (e) {}

      adsHideCb.addEventListener('change', (ev) => {
        try {
          const v = !!(ev && ev.target && ev.target.checked);
          try { chrome.storage.local.set({ schedule_hide_warning: v }); } catch (e) {}
          try { if (window && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem('schedule_hide_warning', v ? '1' : '0'); } catch (e) {}
          try { adsHelper.style.display = v ? 'none' : ''; } catch (e) {}
          // Also hide the regular schedule modal warning if present
          try { const sw = document.getElementById('schedule-warning'); if (sw) sw.style.display = v ? 'none' : ''; } catch (e) {}
          // Sync other checkbox instance(s)
          try { const other = document.querySelectorAll('#ffm-ads-hide-warning, #ffm-ads-hide-warning-overlay'); other.forEach(cb => { try { cb.checked = v; } catch(e){} }); } catch(e){}
        } catch (e) { console.debug('[ADS] adsHideCb change failed', e); }
      });
    }
  } catch (e) { /* non-fatal */ }

  // Render lists based on current state
  ffmSchedulerRenderOverlayRules();
  ffmSchedulerRenderUpcomingOverlayEvents();
}

// Public entry: open/close overlay
window.ffmADSOpenPanel = async function (open) {
  try {
    const overlay = ffmADSBuildShellIfNeeded();

    if (!open) {
      overlay.style.display = "none";
      return;
    }

    // Hydrate rules before showing
    await ffmSchedulerHydrateFromStorage();
    ffmADSRenderHome();
  } catch (e) {
    console.warn("[ADS] ffmADSOpenPanel error", e);
  }
};

// Helper to go “home” from wizard
function ffmADSWizardGoHome() {
  window.ffmSchedulerState.step = 1;
  window.ffmSchedulerState.editingRuleId = null;
  ffmADSRenderHome();
}

// ---------------------------------------------------------------------
// Bulk create — one rule config, applied to several checked listings at
// once. Replaces the old Step1→Step2→Step3 "one listing at a time" wizard
// for NEW schedules (per user request); Step1/2/3 below are kept only for
// the "Edit" flow on a single already-existing schedule (ffmSchedulerEditRule).
// ---------------------------------------------------------------------

function ffmSchedulerOpenBulkCreate() {
  const overlay = ffmADSBuildShellIfNeeded();
  overlay.style.display = "flex";

  const body = document.getElementById("ffm-ads-panel-body");
  if (!body) return;

  const st = window.ffmSchedulerState;
  const listings = st.listings || [];
  const rules = st.rules || {};

  body.innerHTML = `
    <div class="ffm-ads-header">
      <h2 style="font-size:18px; margin-bottom:10px;">Create Advanced Schedule</h2>
    </div>
    <div class="ffm-ads-wizard-section">
      <p style="font-size:12px; color:#555; margin-top:-6px; margin-bottom:16px;">
        Configure Delete and Relist to automatically run after being active for X number of days,
        then check every listing you want this same schedule applied to.<br>
        The schedule will only run for listings that are Active.
      </p>

      <div style="margin-bottom:14px;">
        <label style="font-size:14px; font-weight:600; display:block; margin-bottom:6px;">
          Delete and Relist after this many days active:
        </label>
        <input id="ffm-ads-bulk-days-active" type="number" min="0" value="1"
            style="width:80px; padding:4px 6px; margin:0; font-size:14px;">
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:14px; font-weight:600; display:block; margin-bottom:8px;">
          Run at time of day:
        </label>
        <input id="ffm-ads-bulk-time" type="time" value="09:00"
            style="font-size:14px; padding:4px 6px;">
      </div>

      <label style="font-size:14px; font-weight:600;">Repeat:</label><br>
      <select id="ffm-ads-bulk-repeat"
          style="padding:6px; font-size:14px; margin:6px 0 18px 0; width:200px;">
        <option value="forever" selected>Repeat forever</option>
        <option value="once">Run once only</option>
      </select>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-weight:600;font-size:14px;">Apply to which listings?</div>
        <div style="display:flex;gap:6px;">
          <button class="ffm-ads-btn-secondary" id="ffm-ads-bulk-check-all" style="padding:4px 8px;font-size:12px;">Check All</button>
          <button class="ffm-ads-btn-secondary" id="ffm-ads-bulk-uncheck-all" style="padding:4px 8px;font-size:12px;">Uncheck All</button>
        </div>
      </div>
      <div id="ffm-ads-bulk-count" style="font-size:12px;color:#666;margin-bottom:6px;"></div>

      <div id="ffm-ads-bulk-list" style="max-height:38vh;overflow:auto;border:1px solid rgba(0,0,0,0.08);border-radius:6px;padding:6px;margin-bottom:14px;"></div>

      <div class="ffm-ads-wizard-footer">
        <button class="ffm-ads-btn-secondary" id="ffm-ads-bulk-cancel">Cancel</button>
        <button class="ffm-ads-btn-primary" id="ffm-ads-bulk-save">Save Schedule</button>
      </div>
    </div>
  `;

  const listEl = document.getElementById("ffm-ads-bulk-list");
  const countEl = document.getElementById("ffm-ads-bulk-count");

  if (!listings.length) {
    listEl.innerHTML = `
      <div class="ffm-ads-empty">
        No active listings found.<br>
        Run Active Sync or refresh Saved Listings, then try again.
      </div>
    `;
  } else {
    listEl.innerHTML = listings
      .map((l) => {
        const id = l.listingId || l.id || "";
        const title = l.title || l.listingTitle || l.inventoryName || ("Listing " + id);

        // Red warning if this listing already has a schedule, so the user
        // doesn't unknowingly create a second, overlapping one.
        let warningHtml = "";
        const existingRule = rules[id];
        if (existingRule && existingRule.enabled !== false) {
          const freqLabel = (existingRule.repeat === false || existingRule.runOnce) ? "runs once" : "repeats forever";
          const daysLabel = (existingRule.daysActive != null) ? existingRule.daysActive : "?";
          const timeLabel = existingRule.preferredTime || existingRule.time || "09:00";
          let nextRunLabel = "";
          try { if (existingRule.nextRunAt) nextRunLabel = " — next run: " + new Date(existingRule.nextRunAt).toLocaleString(); } catch (e) {}
          warningHtml = `
            <div style="margin-top:4px;padding:5px 8px;background:#fdeaea;border:1px solid #f3b3b3;border-radius:4px;color:#9c1c1c;font-size:11px;">
              ⚠ Already scheduled: relists after ${ffmSchedulerEscapeHtml(String(daysLabel))} day(s) active, at ${ffmSchedulerEscapeHtml(timeLabel)}, ${freqLabel}${ffmSchedulerEscapeHtml(nextRunLabel)}
            </div>
          `;
        }

        return `
          <label style="display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:4px;cursor:pointer;">
            <input type="checkbox" class="ffm-ads-bulk-cb" data-listing-id="${ffmSchedulerEscapeHtml(id)}" style="margin-top:2px;flex-shrink:0;" />
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;word-break:break-word;">${ffmSchedulerEscapeHtml(title)}</div>
              ${warningHtml}
            </div>
          </label>
        `;
      })
      .join("");
  }

  const updateCount = () => {
    const boxes = Array.from(document.querySelectorAll(".ffm-ads-bulk-cb"));
    const n = boxes.filter((b) => b.checked).length;
    countEl.textContent = `${n} of ${boxes.length} selected`;
  };
  updateCount();
  listEl.addEventListener("change", (ev) => {
    if (ev.target && ev.target.classList && ev.target.classList.contains("ffm-ads-bulk-cb")) updateCount();
  });

  const checkAllBtn = document.getElementById("ffm-ads-bulk-check-all");
  const uncheckAllBtn = document.getElementById("ffm-ads-bulk-uncheck-all");
  if (checkAllBtn) checkAllBtn.addEventListener("click", () => { document.querySelectorAll(".ffm-ads-bulk-cb").forEach((cb) => (cb.checked = true)); updateCount(); });
  if (uncheckAllBtn) uncheckAllBtn.addEventListener("click", () => { document.querySelectorAll(".ffm-ads-bulk-cb").forEach((cb) => (cb.checked = false)); updateCount(); });

  const cancelBtn = document.getElementById("ffm-ads-bulk-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", ffmADSWizardGoHome);

  const saveBtn = document.getElementById("ffm-ads-bulk-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      try {
        const d = document.getElementById("ffm-ads-bulk-days-active");
        const t = document.getElementById("ffm-ads-bulk-time");
        const r = document.getElementById("ffm-ads-bulk-repeat");
        const daysVal = Math.max(0, parseInt(d && d.value ? d.value : "0", 10) || 0);
        const timeVal = (t && t.value) || "09:00";
        const repeatVal = (r && r.value) || "forever";

        const checked = Array.from(document.querySelectorAll(".ffm-ads-bulk-cb")).filter((cb) => cb.checked);
        if (!checked.length) { alert("Check at least one listing first."); return; }

        saveBtn.disabled = true;
        const origLabel = saveBtn.textContent;
        saveBtn.textContent = `Saving 0 of ${checked.length}…`;

        let done = 0, failed = 0;
        for (const cb of checked) {
          const listingId = cb.getAttribute("data-listing-id");
          const listing =
            listings.find((l) => String(l.listingId || l.id) === String(listingId)) ||
            { listingId, id: listingId, title: "Selected listing", inventoryName: listingId };
          try {
            await ffmADSSaveRuleForListing(listing, { daysActive: daysVal, timeOfDay: timeVal, repeatMode: repeatVal });
            done++;
          } catch (e) {
            console.warn("[ADS] bulk save failed for", listingId, e);
            failed++;
          }
          saveBtn.textContent = `Saving ${done + failed} of ${checked.length}…`;
        }
        saveBtn.textContent = origLabel;

        await ffmSchedulerHydrateFromStorage();
        try { ffmSchedulerRenderOverlayRules(); } catch (e) {}
        try { ffmSchedulerRenderUpcomingOverlayEvents(); } catch (e) {}
        try {
          const summary = failed ? `Schedule saved for ${done} listing(s), ${failed} failed.` : `Schedule saved for ${done} listing(s).`;
          if (window.showToast) window.showToast(summary, failed ? 'error' : 'success');
        } catch (e) {}
        ffmADSWizardGoHome();
      } catch (e) {
        console.error("[ADS] bulk save failed", e);
        try { if (window.showToast) window.showToast('Saving the schedule failed — see console.', 'error'); } catch (er) {}
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

// ---------------------------------------------------------------------
// Wizard — Step 1 (choose listing) — used only by "Edit" on an existing
// single schedule now (ffmSchedulerEditRule); new schedules go through
// ffmSchedulerOpenBulkCreate above.
// ---------------------------------------------------------------------

async function ffmSchedulerOpenStep1() {
  try {
    await ffmSchedulerHydrateFromStorage();
  } catch (e) {}

  const overlay = ffmADSBuildShellIfNeeded();
  overlay.style.display = "flex";

  const body = document.getElementById("ffm-ads-panel-body");
  if (!body) return;

  const st = window.ffmSchedulerState;
  const listings = st.listings || [];

  body.innerHTML = `
    <div class="ffm-ads-header">
      <h2 style="font-size:18px; margin-bottom:10px;">Step 1 — Choose Listing</h2>
    </div>
    <div class="ffm-ads-wizard-section">
      <p>Select a listing to automatically Delete &amp; Relist based on days active.</p>
      <div id="ffm-ads-step1-list" class="ffm-ads-listing-list"></div>
      <div class="ffm-ads-wizard-footer">
        <button class="ffm-ads-btn-secondary" id="ffm-ads-step1-cancel">Cancel</button>
      </div>
    </div>
  `;

  const listEl = document.getElementById("ffm-ads-step1-list");
  if (!listEl) return;

  if (!listings || listings.length === 0) {
    listEl.innerHTML = `
      <div class="ffm-ads-empty">
        No active listings found.<br>
        Run Active Sync or refresh Saved Listings, then try again.
      </div>
    `;
  } else {
    listEl.innerHTML = listings
      .map((l) => {
        const id = l.listingId || l.id || "";
        const title =
          l.title || l.listingTitle || l.inventoryName || ("Listing " + id);
        const sub = l.inventoryName || l.title || "";
        return `
          <div class="ffm-ads-listing-card" data-listing-id="${ffmSchedulerEscapeHtml(
            id
          )}">
            <div>
              <div class="ffm-ads-listing-title">${ffmSchedulerEscapeHtml(
                title
              )}</div>
              <div class="ffm-ads-listing-sub">${ffmSchedulerEscapeHtml(
                sub
              )}</div>
            </div>
            <button class="ffm-ads-select-listing">Select</button>
          </div>
        `;
      })
      .join("");
  }

  const cancel = document.getElementById("ffm-ads-step1-cancel");
  if (cancel) cancel.addEventListener("click", ffmADSWizardGoHome);

  // Click handler for “Select” buttons (delegated)
  listEl.addEventListener("click", (ev) => {
    const card = ev.target.closest(".ffm-ads-listing-card");
    if (!card) return;
    if (!ev.target.closest(".ffm-ads-select-listing")) return;

    const listingId = card.getAttribute("data-listing-id");
    const found =
      (st.listings || []).find(
        (l) =>
          String(l.listingId) === String(listingId) ||
          String(l.id) === String(listingId)
      ) || null;

    st.selectedListing = found || {
      listingId,
      id: listingId,
      title: "Selected listing",
      listingTitle: "Selected listing",
      inventoryName: listingId
    };
    st.step = 2;

    // If there is an existing rule for this listing, prefill from it
    const existing = st.rules && st.rules[listingId];
    if (existing) {
      st.daysActive = Number(existing.daysActive || 1);
      st.timeOfDay =
        existing.preferredTime || existing.time || st.timeOfDay || "09:00";
      st.repeatMode =
        existing.repeatMode ||
        existing.repeat ||
        (existing.runOnce ? "once" : "forever");
      st.editingRuleId = listingId;
    } else {
      st.daysActive = 1;
      st.timeOfDay = "09:00";
      st.repeatMode = "forever";
      st.editingRuleId = null;
    }

    ffmSchedulerRenderWizardStep2();
  });
}

// ---------------------------------------------------------------------
// Wizard — Step 2 (configure rule)
// ---------------------------------------------------------------------

function ffmSchedulerRenderWizardStep2() {
  const st = window.ffmSchedulerState;
  const root =
    document.getElementById("ffm-ads-panel-body") ||
    document.getElementById("ffm-ads-panel") ||
    document.getElementById("ffm-ads-overlay-body");
  if (!root) return console.error("[ADS] No panel body for Step 2");

  const listing = st.selectedListing || {};
  const days =
    typeof st.daysActive !== "undefined" && st.daysActive !== null
      ? st.daysActive
      : 1;
  const time = st.timeOfDay || "09:00";
  const repeat = st.repeatMode || "forever";

  root.innerHTML = `
  <div class="ffm-ads-header">
      <h2 style="font-size:18px; margin-bottom:12px;">Step 2 — Configure Rule</h2>
  </div>

  <div class="ffm-ads-wizard-section">

      <div style="font-size:14px; margin-bottom:12px;">
        <strong>Listing:</strong>
        ${ffmSchedulerEscapeHtml(
          listing.title || listing.listingTitle || listing.inventoryName || "(unknown listing)"
        )}
      </div>

      <p style="font-size:12px; color:#555; margin-top:-6px; margin-bottom:16px;">
        Configure Delete and Relist to automatically run after being active for X number of days.<br>
        The schedule will only run if the listing is Active.
      </p>

      <div style="margin-bottom:14px;">
        <label style="font-size:14px; font-weight:600; display:block; margin-bottom:6px;">
          Delete and Relist after this many days active:
        </label>
        <input id="ffm-ads-days-active" type="number" min="0"
            value="${days}"
            style="width:80px; padding:4px 6px; margin:0; font-size:14px;">
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:14px; font-weight:600; display:block; margin-bottom:8px;">
          Run at time of day:
        </label>
        <div style="display:flex; align-items:center; gap:6px;">
            <input id="ffm-ads-time" type="time"
                value="${time}"
                style="font-size:14px; padding:4px 6px;">
        </div>
      </div>

      <label style="font-size:14px; font-weight:600;">
        Repeat:
      </label><br>

      <select id="ffm-ads-repeat"
          style="padding:6px; font-size:14px; margin:6px 0 20px 0; width:200px;">
          <option value="forever" ${
            repeat === "forever" ? "selected" : ""
          }>Repeat forever</option>
          <option value="once" ${
            repeat === "once" ? "selected" : ""
          }>Run once only</option>
      </select>

      <div class="ffm-ads-wizard-footer">
          <button class="ffm-ads-btn-secondary" id="ffm-ads-back-step2">← Back</button>
          <button class="ffm-ads-btn-primary" id="ffm-ads-step2-continue">Continue</button>
      </div>
  </div>
  `;

  const backBtn = document.getElementById("ffm-ads-back-step2");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // If editing, going back returns to home; otherwise go to Step 1
      if (window.ffmSchedulerState && window.ffmSchedulerState.editingRuleId) {
        ffmADSWizardGoHome();
      } else {
        ffmSchedulerOpenStep1();
      }
    });
  }

  const contBtn = document.getElementById("ffm-ads-step2-continue");
  if (contBtn) {
    contBtn.addEventListener("click", () => {
      try {
        const d = document.getElementById("ffm-ads-days-active");
        const t = document.getElementById("ffm-ads-time");
        const r = document.getElementById("ffm-ads-repeat");

        const daysVal = Math.max(0, parseInt(d && d.value ? d.value : "0", 10) || 0);
        const timeVal = (t && t.value) || "09:00";
        const repeatVal = (r && r.value) || "forever";

        window.ffmSchedulerState.daysActive = daysVal;
        window.ffmSchedulerState.timeOfDay = timeVal;
        window.ffmSchedulerState.repeatMode = repeatVal;
        window.ffmSchedulerState.step = 3;

        ffmSchedulerRenderWizardStep3();
      } catch (e) {
        console.error("[ADS] Step 2 continue failed", e);
      }
    });
  }
}

// ---------------------------------------------------------------------
// Wizard — Step 3 (review + save)
// ---------------------------------------------------------------------

function ffmSchedulerRenderWizardStep3() {
  const st = window.ffmSchedulerState;
  const root =
    document.getElementById("ffm-ads-panel-body") ||
    document.getElementById("ffm-ads-panel") ||
    document.getElementById("ffm-ads-overlay-body");
  if (!root) return console.error("[ADS] No panel body for Step 3");

  const listing = st.selectedListing || {};
  const listingLabel =
    listing.title ||
    listing.listingTitle ||
    listing.inventoryName ||
    listing.listingId ||
    listing.id ||
    "(unknown listing)";

  const days = st.daysActive || 0;
  const time = st.timeOfDay || "09:00";
  const repeat = st.repeatMode || "forever";

  root.innerHTML = `
    <div class="ffm-ads-header">
      <h2 style="font-size:18px; margin-bottom:12px;">Step 3 — Review Schedule</h2>
    </div>

    <div class="ffm-ads-wizard-section">
      <p style="font-size:13px; color:#555; margin-bottom:16px;">
        Confirm your settings, then click <strong>Save Schedule</strong>.
      </p>

      <div style="margin-bottom:10px;">
        <div style="font-weight:600; font-size:13px;">Listing:</div>
        <div style="font-size:13px;">${ffmSchedulerEscapeHtml(listingLabel)}</div>
      </div>

      <div style="margin-bottom:10px;">
        <div style="font-weight:600; font-size:13px;">Days Active:</div>
        <div style="font-size:13px;">${days}</div>
      </div>

      <div style="margin-bottom:10px;">
        <div style="font-weight:600; font-size:13px;">Time of Day:</div>
        <div style="font-size:13px;">${ffmSchedulerEscapeHtml(time)}</div>
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-weight:600; font-size:13px;">Repeat:</div>
        <div style="font-size:13px;">${
          repeat === "once" ? "Run once only" : "Repeat forever"
        }</div>
      </div>

      <div class="ffm-ads-wizard-footer">
        <button class="ffm-ads-btn-secondary" id="ffm-ads-back-step3">← Back</button>
        <button class="ffm-ads-btn-primary" id="ffm-ads-save-rule">Save Schedule</button>
      </div>
    </div>
  `;

  const backBtn = document.getElementById("ffm-ads-back-step3");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.ffmSchedulerState.step = 2;
      ffmSchedulerRenderWizardStep2();
    });
  }

  const saveBtn = document.getElementById("ffm-ads-save-rule");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      ffmADSSaveRule();
    });
  }
}

// ---------------------------------------------------------------------
// Save rule (wizard Step 3)
// ---------------------------------------------------------------------

// Core save logic, extracted from the old single-listing-only ffmADSSaveRule
// so both the single-edit wizard (Step 3) and the bulk "apply to several
// listings at once" screen can share one implementation instead of two
// copies drifting apart. `ruleConfig` = { daysActive, timeOfDay, repeatMode }.
// Throws if `listing` has no usable id. Returns the saved rule object.
async function ffmADSSaveRuleForListing(listing, ruleConfig) {
  listing = listing || {};
  const listingId = listing.listingId || listing.id || listing.inventoryName || null;
  if (!listingId) throw new Error("Missing listing id for schedule. Please reselect the listing.");

  const nowTs = Date.now();
  const daysActive = Number((ruleConfig && ruleConfig.daysActive) || 0);
  const preferredTime = (ruleConfig && ruleConfig.timeOfDay) || "09:00";
  const repeatMode = (ruleConfig && ruleConfig.repeatMode) || "forever";

  // Read-then-merge against the LATEST storage each call (not a snapshot
  // taken once at the start) so saving several listings in a row can't
  // clobber each other's writes.
  const store = await ffmSchedulerStorageGet([FFM_ADS_RULES_KEY]);
  const rulesNow =
    store && store[FFM_ADS_RULES_KEY] && typeof store[FFM_ADS_RULES_KEY] === "object"
      ? store[FFM_ADS_RULES_KEY]
      : {};
  const priorRule = rulesNow[listingId] || null;

  const baseRule = {
    id: priorRule ? (priorRule.id || "ads_" + nowTs) : "ads_" + nowTs,
    listingId,
    listingTitle: listing.title || listing.listingTitle || listing.inventoryName || "",
    inventoryName: listing.inventoryName || "",
    daysActive,
    // keep a synced helper field to record the original numeric daysActive
    _ffm_daysActive: daysActive,
    // MUST be preferredTime (background uses this)
    preferredTime,
    // MUST be boolean, not string
    repeat: (repeatMode !== "once"),
    // Optional but improves clarity for background
    runOnce: (repeatMode === "once"),
    enabled: true,
    createdAt: priorRule ? (priorRule.createdAt || nowTs) : nowTs
  };

  // If the listing object contains days-active or last-published info
  // attach an `activeSinceMs` value so background scheduling can honor
  // "relist after N days active" semantics.
  try {
    const dayMs = 24 * 60 * 60 * 1000;
    if (typeof listing._ffm_daysActive !== 'undefined' && listing._ffm_daysActive !== null) {
      const days = Number(listing._ffm_daysActive);
      if (!Number.isNaN(days)) {
        baseRule.activeSinceMs = Date.now() - Math.round(days * dayMs);
        baseRule._ffm_daysActive = days;
      }
    } else if (listing.lastPublishedAt || listing.lastPublished || listing.publishedAt || listing.timestamp) {
      const cand = listing.lastPublishedAt || listing.lastPublished || listing.publishedAt || listing.timestamp;
      const num = typeof cand === 'number' ? Number(cand) : Date.parse(String(cand || ''));
      if (!Number.isNaN(num) && num > 0) {
        baseRule.activeSinceMs = Number(num);
      }
    }
  } catch (e) {}

  // Critical: compute nextRunAt for Upcoming UI
  try {
    const dayMs = 24 * 60 * 60 * 1000;
    if (baseRule.activeSinceMs && Number(baseRule.daysActive) > 0) {
      try {
        const intervalDays = Number(baseRule.daysActive || 1);
        const timeParts = String(preferredTime || '09:00').split(':');
        const hh = parseInt(timeParts[0] || '0', 10) || 0;
        const mm = parseInt(timeParts[1] || '0', 10) || 0;
        const target = new Date(Number(baseRule.activeSinceMs) + (intervalDays * dayMs));
        target.setSeconds(0, 0);
        target.setHours(hh, mm, 0, 0);
        let when = target.getTime();
        const now = Date.now();
        while (when <= now) {
          when += intervalDays * dayMs;
        }
        baseRule.nextRunAt = when;
      } catch (e) {
        baseRule.nextRunAt = ffmADSComputeNextRunTime(preferredTime);
      }
    } else {
      baseRule.nextRunAt = ffmADSComputeNextRunTime(preferredTime);
    }
  } catch (e) {
    baseRule.nextRunAt = ffmADSComputeNextRunTime(preferredTime);
  }

  // Deep-merge incoming `baseRule` into any prior saved rule to preserve
  // nested fields like `history`, `stats`, timestamps, and run counts.
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

  rulesNow[listingId] = mergeRuleLocal(rulesNow[listingId] || {}, baseRule || {});
  await ffmSchedulerStorageSet({ [FFM_ADS_RULES_KEY]: rulesNow });
  window.ffmSchedulerState.rules = rulesNow;

  console.log("[ADS] Rule saved:", baseRule);

  // Tell background to recreate alarms
  await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { action: "ffm_scheduler_upsert_rule", listingId, rule: baseRule },
        (resp) => { console.log("[ADS] upsert response:", resp); resolve(resp); }
      );
    } catch (e) { console.warn('[ADS] upsert send failed', e); resolve(null); }
  });

  return rulesNow[listingId];
}

async function ffmADSSaveRule() {
  try {
    const st = window.ffmSchedulerState || {};
    const listing = st.selectedListing || {};

    try {
      await ffmADSSaveRuleForListing(listing, {
        daysActive: st.daysActive,
        timeOfDay: st.timeOfDay,
        repeatMode: st.repeatMode
      });
    } catch (e) {
      alert((e && e.message) || "Missing listing id for schedule. Please reselect the listing.");
      return;
    }

    window.ffmSchedulerState.editingRuleId = null;

    await ffmSchedulerHydrateFromStorage();

    try { ffmSchedulerRenderOverlayRules(); } catch (e) {}
    try { ffmSchedulerRenderUpcomingOverlayEvents(); } catch (e) {}
    try { ffmADSWizardGoHome(); } catch (e) {}

  } catch (e) {
    console.error("[ADS] ffmADSSaveRule crashed", e);
  }
}

// ---------------------------------------------------------------------
// Saved Events renderer (rules list)
// ---------------------------------------------------------------------

function ffmSchedulerRenderOverlayRules() {
  try {
    const st = window.ffmSchedulerState || {};
    const rulesObj = st.rules || {};
    const container = document.getElementById("ffm-ads-saved-events");
    if (!container) return;

    // rulesObj may be stored as a map keyed by listingId where the value
    // doesn't include a `listingId` property. Normalize by using the map
    // entries and falling back to the key when needed.
    const rulesArr = Object.entries(rulesObj || {})
      .map(([k, v]) => {
        try {
          const r = v || {};
          if (!r) return null;
          if (!r.listingId) r.listingId = k;
          return r;
        } catch (e) { return null; }
      })
      .filter(r => !!r && !!r.listingId)
      .sort((a, b) => {
        // Sort by nextRunAt ascending, then title
        const na = a.nextRunAt || 0;
        const nb = b.nextRunAt || 0;
        if (na && nb && na !== nb) return na - nb;
        const ta = (a.listingTitle || '').toLowerCase();
        const tb = (b.listingTitle || '').toLowerCase();
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        return 0;
      });

    if (!rulesArr.length) {
      container.innerHTML = `<div style="font-size:13px; color:#777; padding:4px 0 12px 0;">No saved events yet.</div>`;
      return;
    }

    const html = rulesArr.map(rule => {
      const title = ffmSchedulerEscapeHtml(rule.listingTitle || rule.inventoryName || rule.listingId || 'Unknown listing');
      const daysActive = Number(rule.daysActive || 1);
      const time = rule.time || rule.preferredTime || '09:00';
      const enabled = rule.enabled !== false;
      const repeatText = (rule.repeat === false || rule.repeat === 'once') ? 'Run once' : `Every ${daysActive} days active`;

      const historyArr = Array.isArray(rule.history) ? rule.history : [];
      const runsCount = historyArr.length;
      const runsBadge = runsCount > 0
        ? `<span style="font-size:11px; color:#666; margin-left:6px;">(${runsCount} run${runsCount === 1 ? '' : 's'})</span>`
        : '';

      const lastRunHtml = ffmAdsBuildLastRunLabel(rule);

      return `
<div class="ffm-ads-saved-card" data-ads-listing-id="${ffmSchedulerEscapeHtml(rule.listingId)}"
     style="border-radius:10px; border:1px solid #e0e0e0; padding:10px 12px; margin-bottom:10px; background:#fff;">
  <div style="display:flex; justify-content:flex-start; align-items:center; gap:8px;">
    <div style="flex:1 1 auto; min-width:0;">
      <div style="font-size:14px; font-weight:600; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${title}${runsBadge}
      </div>
      <div style="font-size:12px; color:#555; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        After ${daysActive} day${daysActive === 1 ? '' : 's'} @ <strong>${ffmSchedulerEscapeHtml(time)}</strong> · ${ffmSchedulerEscapeHtml(repeatText)}
      </div>
      <div style="font-size:11px; color:#444; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${lastRunHtml}
      </div>
    </div>
  </div>

  <div style="display:flex; align-items:center; justify-content:flex-start; margin-top:8px; gap:8px;">
    <div class="saved-actions" style="display:flex; align-items:center; gap:6px;">
      <button class="action-btn ffm-ads-edit-btn"    data-ads-id="${ffmSchedulerEscapeHtml(rule.listingId)}">Edit</button>
      <button class="action-btn ffm-ads-run-now-btn" data-ads-id="${ffmSchedulerEscapeHtml(rule.listingId)}">Run Now</button>
      <button class="delete-btn ffm-ads-delete-btn"  data-ads-id="${ffmSchedulerEscapeHtml(rule.listingId)}">Delete</button>

      <label style="font-size:12px; display:flex; align-items:center; gap:4px; margin-left:6px;">
        <input type="checkbox"
               class="ffm-ads-enabled-toggle"
               data-ads-id="${ffmSchedulerEscapeHtml(rule.listingId)}"
               ${enabled ? 'checked' : ''}>
        Enabled
      </label>
    </div>

    <div>
      <button class="action-btn ffm-ads-history-btn"
              data-ads-id="${ffmSchedulerEscapeHtml(rule.listingId)}"
              style="font-size:11px; padding:4px 10px;">View History</button>
    </div>
  </div>
</div>`;
    }).join('');

    container.innerHTML = html;

    // Inject a compact "..." menu for each saved card and move secondary actions into the popover
    try {
      const cards = container.querySelectorAll('.ffm-ads-saved-card');
      cards.forEach(card => {
        try {
          const actions = card.querySelector('.saved-actions');
          if (!actions) return;

          // Create menu wrapper (keeps existing handlers when we move nodes)
          const menuWrap = document.createElement('div');
          menuWrap.className = 'sl-menu';
          menuWrap.style.display = 'inline-block';
          menuWrap.style.position = 'relative';

          const menuBtn = document.createElement('button');
          menuBtn.className = 'btn-menu';
          menuBtn.textContent = '...';
          menuBtn.style.padding = '4px 8px';
          menuBtn.style.borderRadius = '8px';
          menuBtn.style.background = '#f5f8ff';
          menuBtn.style.border = 'none';
          menuBtn.style.cursor = 'pointer';

          const pop = document.createElement('div');
          pop.className = 'sl-menu-popover';
          pop.style.position = 'absolute';
          pop.style.right = '0';
          pop.style.top = '30px';
          pop.style.minWidth = '160px';
          pop.style.background = '#fff';
          pop.style.border = '1px solid #e6eefc';
          pop.style.borderRadius = '8px';
          pop.style.boxShadow = '0 6px 18px rgba(18,78,127,0.08)';
          pop.style.padding = '8px';
          pop.style.display = 'none';
          pop.style.zIndex = '50';

          const popBody = document.createElement('div');
          popBody.className = 'sl-body';
          pop.appendChild(popBody);

          // Move Delete and History (secondary actions) into the popover if present
          const deleteBtn = actions.querySelector('.ffm-ads-delete-btn');
          const historyBtn = card.querySelector('.ffm-ads-history-btn');
          if (deleteBtn) popBody.appendChild(deleteBtn);
          if (historyBtn) popBody.appendChild(historyBtn);

          // Add the menu button and popover after the actions block
          menuWrap.appendChild(menuBtn);
          menuWrap.appendChild(pop);
          // Insert menuWrap into the actions container's parent and push it to the far right
          menuWrap.style.marginLeft = 'auto';
          actions.parentNode.appendChild(menuWrap);

          // Toggle popover on menu click
          menuBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // hide other popovers
            document.querySelectorAll('.sl-menu-popover').forEach(p => { if (p !== pop) p.style.display = 'none'; });
            pop.style.display = (pop.style.display === 'none' || !pop.style.display) ? 'block' : 'none';
          });
        } catch (e) { console.warn('[ADS] menu injection failed for card', e); }
      });

      // Capture-phase document click to hide any open popovers before other handlers run
      document.addEventListener('click', (e) => {
        try {
          if (!e.target.closest || !e.target.closest('.sl-menu')) {
            document.querySelectorAll('.sl-menu-popover').forEach(p => { p.style.display = 'none'; });
          }
        } catch (ee) {}
      }, true);
    } catch (e) { console.warn('[ADS] inject menus failed', e); }

    // Re-wire buttons including History
    ffmSchedulerWireSavedButtons();
  } catch (e) {
    console.warn('[ADS] Saved Events render failed', e);
  }
}

// ---------------------------------------------------------------------
// Upcoming Events renderer
// ---------------------------------------------------------------------

// Render a given list of upcoming alarm events (events: [{ alarm, listingId, title }])
function ffmSchedulerRenderUpcoming(events, ruleMap) {
  try {
    // ⭐ Correct container ID from actual ADS HTML
    const listEl =
      document.getElementById("ffm-ads-upcoming-container") ||
      document.querySelector("#ffm-ads-upcoming-container") ||
      document.querySelector(".ffm-ads-upcoming-list");
    if (!listEl) return;

    const items = (Array.isArray(events) ? events : [])
      .map(e => {
        const listingId = e.listingId || '';
        const title = (e.title) || ((ruleMap && ruleMap[listingId] && ruleMap[listingId].listingTitle) ? ruleMap[listingId].listingTitle : listingId || 'Unknown listing');
        const nextTs = (e.alarm && e.alarm.scheduledTime) ? Number(e.alarm.scheduledTime) : 0;
        const rule = ruleMap && ruleMap[listingId] ? ruleMap[listingId] : null;
        return { listingId, title, nextTs, rule };
      })
      .filter(i => i && i.nextTs)
      .sort((a, b) => a.nextTs - b.nextTs);

    if (!items.length) {
      listEl.innerHTML = `<div class="ffm-ads-empty">No upcoming events.</div>`;
      return;
    }

    listEl.innerHTML = items.map((item, idx) => {
      const d = new Date(item.nextTs);
      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

      const r = item.rule || {};
      const repeat = r.repeatMode || r.repeat || (r.runOnce ? 'once' : 'forever');
      const days = r.daysActive || 0;
      const repeatText = repeat === 'once' ? `One-time after ${days} days active` : `Every ${days} days active`;

      return `
        <div class="ffm-ads-upcoming-card ${idx === 0 ? 'ffm-ads-next' : ''}" data-listing-id="${ffmSchedulerEscapeHtml(item.listingId)}">
          <div class="ffm-ads-up-row">
            <span>${dateStr}</span>
            <span class="ffm-ads-up-time">@ ${ffmSchedulerEscapeHtml(timeStr)}</span>
          </div>
          <div class="ffm-ads-up-title">${ffmSchedulerEscapeHtml(item.title)}</div>
          <div class="ffm-ads-up-repeat">${ffmSchedulerEscapeHtml(repeatText)}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.warn('[ADS] ffmSchedulerRenderUpcoming failed', e);
  }
}

// Refresh upcoming events by scanning chrome.alarms and caching them in state
function ffmSchedulerRefreshUpcoming() {
  try {
    chrome.alarms.getAll(alarms => {
      const events = [];
      const ruleMap = (window.ffmSchedulerState && window.ffmSchedulerState.rules) ? window.ffmSchedulerState.rules : {};

      (alarms || []).forEach(a => {
        if (!a || !a.name || !a.name.startsWith('ffm_auto_dnr_daily::')) return;
        const listingId = (a.name.split('::')[1] || '');
        events.push({ alarm: a, listingId, title: (ruleMap[listingId] && ruleMap[listingId].listingTitle) || listingId });
      });

      // sort by scheduledTime
      events.sort((x, y) => (x.alarm && x.alarm.scheduledTime ? x.alarm.scheduledTime : 0) - (y.alarm && y.alarm.scheduledTime ? y.alarm.scheduledTime : 0));

      // cache in state so multiple callers (home overlay, rule edits) can re-render
      try {
        window.ffmSchedulerState = window.ffmSchedulerState || {};
        window.ffmSchedulerState.upcomingEvents = events;
        window.ffmSchedulerState.upcomingRuleMap = ruleMap;
      } catch (e) {
        console.warn('[ADS] failed to cache upcoming events in state', e);
      }

      if (typeof ffmSchedulerRenderUpcomingOverlayEvents === 'function') {
        ffmSchedulerRenderUpcomingOverlayEvents();
      } else {
        // fallback to direct renderer if overlay helper is missing
        ffmSchedulerRenderUpcoming(events, ruleMap);
      }
    });
  } catch (e) {
    console.warn('[ADS] ffmSchedulerRefreshUpcoming failed', e);
  }
}

// Overlay-aware renderer: show up to MAX_VISIBLE events, with View all / Show less toggle
function ffmSchedulerRenderUpcomingOverlayEvents() {
  const container = document.getElementById("ffm-ads-upcoming-container");
  if (!container) return;

  const rulesMap = window.ffmSchedulerState.rules || {};
  const rulesArr = ffmSchedulerRulesMapToArray(rulesMap).filter(
    (r) => r.enabled !== false
  );

  const items = rulesArr
    .map((r) => {
      const listingId = r.listingId || "";
      const title =
        r.listingTitle || r.inventoryName || "Unknown listing (" + listingId + ")";
      const nextTs =
        Math.max(Number(r.nextRun || 0), Number(r.nextRunAt || 0)) ||
        ffmADSComputeNextRunTime(r.preferredTime || r.time || "09:00");
      if (!nextTs) return null;
      return { listingId, title, rule: r, nextTs };
    })
    .filter(Boolean)
    .sort((a, b) => a.nextTs - b.nextTs);

  if (!items.length) {
    container.innerHTML = `<div class="ffm-ads-empty">No upcoming events.</div>`;
    return;
  }

  const maxVisible = 3;
  const visible = items.slice(0, maxVisible);
  const hiddenCount = Math.max(0, items.length - visible.length);

  console.log("[ADS] Upcoming overlay events:", {
    total: items.length,
    visible: visible.length,
    hidden: hiddenCount,
  });

  let html = visible
    .map((item, idx) => {
      const d = new Date(item.nextTs);
      const dateStr = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const timeStr = ffmAdsFormatTimeShortFromTs(item.nextTs);

      const r = item.rule;
      const repeat =
        r.repeatMode || r.repeat || (r.runOnce ? "once" : "forever");
      const days = r.daysActive || 0;
      const repeatText =
        repeat === "once"
          ? `One-time after ${days} days active`
          : `Every ${days} days active`;

      return `
        <div class="ffm-ads-upcoming-card ${
          idx === 0 ? "ffm-ads-next" : ""
        }" data-listing-id="${ffmSchedulerEscapeHtml(item.listingId)}">
          <div class="ffm-ads-up-row">
            <span>${ffmSchedulerEscapeHtml(dateStr)}</span>
            <span class="ffm-ads-up-time">@ ${ffmSchedulerEscapeHtml(timeStr)}</span>
          </div>
          <div class="ffm-ads-up-title">${ffmSchedulerEscapeHtml(item.title)}</div>
          <div class="ffm-ads-up-repeat">${ffmSchedulerEscapeHtml(repeatText)}</div>
        </div>
      `;
    })
    .join("");

  if (hiddenCount > 0) {
    html += `
      <div class="ffm-ads-upcoming-footer">
        <span class="ffm-ads-upcoming-summary">
          Showing ${visible.length} of ${items.length} upcoming events
        </span>
        <button type="button" id="ffm-ads-view-all-upcoming" class="ffm-ads-link-btn">
          View all
        </button>
      </div>
    `;
  }

  container.innerHTML = html;

  if (hiddenCount > 0) {
    const btn = document.getElementById("ffm-ads-view-all-upcoming");
    if (btn) {
      btn.addEventListener("click", () => {
        try {
          ffmADSOpenUpcomingFullListModal(items);
        } catch (e) {
          console.warn("[ADS] View all upcoming failed", e);
        }
      });
    }
  }
}

function ffmADSOpenUpcomingFullListModal(items) {
  try {
    const overlay = ffmADSBuildShellIfNeeded();
    const body = overlay.querySelector("#ffm-ads-panel-body");
    if (!body) return;

    const rulesMap = window.ffmSchedulerState.rules || {};
    let allItems = items;

    // If items not passed, recompute from rules
    if (!allItems || !allItems.length) {
      const rulesArr = ffmSchedulerRulesMapToArray(rulesMap).filter(
        (r) => r.enabled !== false
      );
      allItems = rulesArr
        .map((r) => {
          const listingId = r.listingId || "";
          const title =
            r.listingTitle ||
            r.inventoryName ||
            "Unknown listing (" + listingId + ")";
          const nextTs =
            Math.max(Number(r.nextRun || 0), Number(r.nextRunAt || 0)) ||
            ffmADSComputeNextRunTime(r.preferredTime || r.time || "09:00");
          if (!nextTs) return null;
          return { listingId, title, rule: r, nextTs };
        })
        .filter(Boolean)
        .sort((a, b) => a.nextTs - b.nextTs);
    }

    if (!allItems.length) {
      body.innerHTML = `
        <div class="ffm-ads-body-section">
          <div class="ffm-ads-section-header">
            <div>
              <div class="ffm-ads-section-title">All Upcoming Events</div>
              <div class="ffm-ads-section-sub">No upcoming events found.</div>
            </div>
            <button id="ffm-ads-upcoming-back-btn" class="ffm-ads-link-btn">Back</button>
          </div>
        </div>
      `;
      const backBtn = document.getElementById("ffm-ads-upcoming-back-btn");
      if (backBtn) {
        backBtn.addEventListener("click", () => {
          try { ffmADSRenderHome(); } catch (e) {}
        });
      }
      return;
    }

    const cardsHtml = allItems
      .map((item, idx) => {
        const d = new Date(item.nextTs);
        const dateStr = d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const timeStr = ffmAdsFormatTimeShortFromTs(item.nextTs);

        const r = item.rule;
        const repeat =
          r.repeatMode || r.repeat || (r.runOnce ? "once" : "forever");
        const days = r.daysActive || 0;
        const repeatText =
          repeat === "once"
            ? `One-time after ${days} days active`
            : `Every ${days} days active`;

        return `
          <div class="ffm-ads-upcoming-card ${
            idx === 0 ? "ffm-ads-next" : ""
          }" data-listing-id="${ffmSchedulerEscapeHtml(item.listingId)}">
            <div class="ffm-ads-up-row">
              <span>${ffmSchedulerEscapeHtml(dateStr)}</span>
              <span class="ffm-ads-up-time">@ ${ffmSchedulerEscapeHtml(timeStr)}</span>
            </div>
            <div class="ffm-ads-up-title">${ffmSchedulerEscapeHtml(item.title)}</div>
            <div class="ffm-ads-up-repeat">${ffmSchedulerEscapeHtml(repeatText)}</div>
          </div>
        `;
      })
      .join("");

    body.innerHTML = `
      <div class="ffm-ads-body-section">
        <div class="ffm-ads-section-header">
          <div>
            <div class="ffm-ads-section-title">All Upcoming Events</div>
            <div class="ffm-ads-section-sub">
              Full schedule for all enabled ADS rules.
            </div>
          </div>
          <button id="ffm-ads-upcoming-back-btn" class="ffm-ads-link-btn">Back</button>
        </div>
        <div class="ffm-ads-upcoming-list">
          ${cardsHtml}
        </div>
      </div>
    `;

    const backBtn = document.getElementById("ffm-ads-upcoming-back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        try { ffmADSRenderHome(); } catch (e) {}
      });
    }
  } catch (e) {
    console.warn("[ADS] OpenUpcomingFullListModal failed", e);
  }
}

// ---------------------------------------------------------------------
// Render simple ADS history summary + rows (minimal timing info)
// ---------------------------------------------------------------------
async function ffmADSRenderHistory(rule, filteredHistory) {
  const box =
    document.getElementById("ffm-ads-history-list") ||
    document.getElementById("ffm-sched-history-list");

  if (!box) return;

  const history = filteredHistory && filteredHistory.length
    ? filteredHistory
    : (rule.history || []);

  if (!history || !history.length) {
    box.innerHTML =
      '<div class="ffm-ads-empty">No history yet.</div>';
    return;
  }

  // ------------------------------
  // SIMPLE SUMMARY
  // ------------------------------
  let successCount = 0;
  let failureCount = 0;
  let lastRunTs = null;

  for (const h of history) {
    if (!h) continue;

    if (h.success === true) successCount++;
    else if (h.success === false) failureCount++;

    const ts = h.time || h.timestamp || h.when || null;
    if (ts && (!lastRunTs || ts > lastRunTs)) lastRunTs = ts;
  }

  const totalRuns = successCount + failureCount;
  const successRate = totalRuns
    ? Math.round((successCount / totalRuns) * 100)
    : 0;

  const lastRunStr = lastRunTs
    ? new Date(lastRunTs).toLocaleString()
    : "—";
  // Minimal summary only (Total Runs + Success Rate). No timing or rows.
  const summaryHtml = `
    <div class="ffm-ads-history-summary" style="font-size:13px; line-height:1.3;">
      <div><strong>Total Runs:</strong> ${totalRuns}</div>
      <div><strong>Success Rate:</strong> ${successRate}% (${successCount} success, ${failureCount} failed)</div>
    </div>
  `;

  box.innerHTML = summaryHtml;
}

// ---------------------------------------------------------------------
// Saved Events wiring helper (attach per-card handlers)
// ---------------------------------------------------------------------
function ffmSchedulerWireSavedButtons() {
  try {
    const root = document.getElementById('ffm-ads-saved-events') || document;

    // Edit
    root.querySelectorAll('.ffm-ads-edit-btn').forEach(btn => {
      try {
        btn.removeEventListener('click', btn.__ffm_bound_edit);
      } catch (e) {}
      const fn = function () {
        const id = this.getAttribute('data-ads-id');
        if (!id) return;
        ffmSchedulerEditRule(id);
      };
      btn.__ffm_bound_edit = fn;
      btn.addEventListener('click', fn);
    });

    // Run Now
    root.querySelectorAll('.ffm-ads-run-now-btn').forEach(btn => {
      try { btn.removeEventListener('click', btn.__ffm_bound_run); } catch (e) {}
      const fn = function () { const id = this.getAttribute('data-ads-id'); if (!id) return; ffmSchedulerRunRuleNow(id); };
      btn.__ffm_bound_run = fn;
      btn.addEventListener('click', fn);
    });

    // Delete
    root.querySelectorAll('.ffm-ads-delete-btn').forEach(btn => {
      try { btn.removeEventListener('click', btn.__ffm_bound_del); } catch (e) {}
      const fn = function () { const id = this.getAttribute('data-ads-id'); if (!id) return; ffmSchedulerDeleteRule(id); };
      btn.__ffm_bound_del = fn;
      btn.addEventListener('click', fn);
    });

    // Enable toggle
    root.querySelectorAll('.ffm-ads-enabled-toggle').forEach(inp => {
      try { inp.removeEventListener('change', inp.__ffm_bound_toggle); } catch (e) {}
      const fn = function () { const id = this.getAttribute('data-ads-id'); if (!id) return; ffmSchedulerToggleRule(id, !!this.checked); };
      inp.__ffm_bound_toggle = fn;
      inp.addEventListener('change', fn);
    });

    // History buttons
    root.querySelectorAll('.ffm-ads-history-btn').forEach(btn => {
      try { btn.removeEventListener('click', btn.__ffm_bound_hist); } catch (e) {}
      const fn = function () { const id = this.getAttribute('data-ads-id'); if (!id) return; try { ffmSchedulerOpenHistoryModal(id); } catch (e) { console.warn('[ADS] history modal failed', e); } };
      btn.__ffm_bound_hist = fn;
      btn.addEventListener('click', fn);
    });
  } catch (e) {
    console.warn('[ADS] wireSavedButtons failed', e);
  }
}

// Edit → open wizard Step 2 prefilled
function ffmSchedulerEditRule(listingId) {
  const st = window.ffmSchedulerState;
  const rules = st.rules || {};
  const rule = rules[listingId];
  if (!rule) {
    console.warn("[ADS] edit: no rule for", listingId);
    return;
  }

  const listings = st.listings || [];
  const fromListings =
    listings.find(
      (l) =>
        String(l.listingId) === String(listingId) ||
        String(l.id) === String(listingId)
    ) || null;

  st.selectedListing =
    fromListings || {
      listingId,
      id: listingId,
      title: rule.listingTitle || "Scheduled listing",
      listingTitle: rule.listingTitle || "Scheduled listing",
      inventoryName: rule.inventoryName || listingId
    };

  st.daysActive = Number(rule.daysActive || 0);
  st.timeOfDay = rule.preferredTime || rule.time || "09:00";
  st.repeatMode =
    rule.repeatMode || rule.repeat || (rule.runOnce ? "once" : "forever");
  st.editingRuleId = listingId;
  st.step = 2;

  ffmSchedulerRenderWizardStep2();
}

// Run Now → background Auto-DnR helper
function ffmSchedulerRunRuleNow(listingId) {
  try {
    console.log("[ADS] Run Now clicked for", listingId);
    // Use the scheduler's run-one API which updates rule metadata without
    // recording a scheduled-history entry. This keeps manual Run Now out of
    // the scheduled runs history.
    chrome.runtime.sendMessage(
      { action: "ffm_scheduler_run_one", listingId },
      (resp) => {
        if (chrome.runtime.lastError) {
          console.warn("[ADS] ffm_scheduler_run_one lastError", chrome.runtime.lastError);
        } else {
          console.log("[ADS] Run-Now response:", resp);
        }
      }
    );
  } catch (e) {
    console.warn("[ADS] Run-Now sendMessage failed", e);
  }
}

// Delete rule
async function ffmSchedulerDeleteRule(listingId) {
  if (!listingId) return;
  const ok = confirm("Delete this schedule?");
  if (!ok) return;

  try {
    const store = await ffmSchedulerStorageGet([FFM_ADS_RULES_KEY]);
    const existing =
      store &&
      store[FFM_ADS_RULES_KEY] &&
      typeof store[FFM_ADS_RULES_KEY] === "object"
        ? store[FFM_ADS_RULES_KEY]
        : {};
    if (existing[listingId]) delete existing[listingId];
    await ffmSchedulerStorageSet({ [FFM_ADS_RULES_KEY]: existing });

    window.ffmSchedulerState.rules = existing;

    try {
      chrome.runtime.sendMessage(
        { action: "ffm_scheduler_delete_rule", listingId },
        (resp) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[ADS] ffm_scheduler_delete_rule lastError",
              chrome.runtime.lastError
            );
          } else {
            console.log("[ADS] delete_rule response:", resp);
          }
        }
      );
    } catch (e) {
      console.warn("[ADS] delete_rule sendMessage failed", e);
    }

    ffmSchedulerRenderOverlayRules();
    ffmSchedulerRenderUpcomingOverlayEvents();
  } catch (e) {
    console.warn("[ADS] deleteRule failed", e);
  }
}

// Enable / Disable rule
async function ffmSchedulerToggleRule(listingId, enabled) {
  try {
    const store = await ffmSchedulerStorageGet([FFM_ADS_RULES_KEY]);
    const existing =
      store &&
      store[FFM_ADS_RULES_KEY] &&
      typeof store[FFM_ADS_RULES_KEY] === "object"
        ? store[FFM_ADS_RULES_KEY]
        : {};
    if (existing[listingId]) {
      existing[listingId].enabled = !!enabled;
      if (!enabled && !existing[listingId].disabledReason) {
        existing[listingId].disabledReason = "Manually disabled";
      }
      if (enabled && existing[listingId].disabledReason) {
        delete existing[listingId].disabledReason;
      }
      await ffmSchedulerStorageSet({ [FFM_ADS_RULES_KEY]: existing });
      window.ffmSchedulerState.rules = existing;
    }

    try {
      chrome.runtime.sendMessage(
        { action: "ffm_scheduler_toggle_rule", listingId, enabled: !!enabled },
        (resp) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[ADS] ffm_scheduler_toggle_rule lastError",
              chrome.runtime.lastError
            );
          } else {
            console.log("[ADS] toggle_rule response:", resp);
          }
        }
      );
    } catch (e) {
      console.warn("[ADS] toggle_rule sendMessage failed", e);
    }

    ffmSchedulerRenderOverlayRules();
    ffmSchedulerRenderUpcomingOverlayEvents();
  } catch (e) {
    console.warn("[ADS] toggleRule failed", e);
  }
}

// ---------------------------------------------------------------------
// Final log
// ---------------------------------------------------------------------

try {
  console.log("[AutoList Pro Scheduler] ADS UI module loaded");
} catch (e) {}

// -------------------------
// History Summary (simple)
// -------------------------
function ffmSchedulerRenderHistoryStats(rule, filteredHistory) {
  if (!rule || !Array.isArray(filteredHistory)) return "";

  const totalRuns = filteredHistory.length;
  if (!totalRuns) return "";

  const successes = filteredHistory.filter(r => r.success).length;
  const failures = totalRuns - successes;
  const successRate = totalRuns ? Math.round((successes / totalRuns) * 100) : 0;

  return `
    <div class="ffm-history-summary" style="font-size:13px; line-height:1.5; margin-bottom:12px;">
      <div><strong>Total Runs:</strong> ${totalRuns}</div>
      <div><strong>Success Rate:</strong> ${successRate}%</div>
    </div>
  `;
}

function ffmSchedulerOpenHistoryModal(listingId) {
  try {
    const st = window.ffmSchedulerState || {};
    const rules = st.rules || {};
    const rule = rules[listingId];
    if (!rule) return;

    const historyArr = Array.isArray(rule.history) ? rule.history : [];
    const title = rule.listingTitle || rule.inventoryName || listingId;
    const runsCount = historyArr.length;

    // Keep last 50 entries, newest first
    const history = (historyArr || []).slice(-50).reverse();

    let modal = document.getElementById('ffm-ads-history-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ffm-ads-history-modal';
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.zIndex = '999999';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.background = 'rgba(0,0,0,0.35)';
      modal.addEventListener('click', function (evt) {
        if (evt.target === modal) ffmSchedulerCloseHistoryModal();
      });
      document.body.appendChild(modal);
    }

    // Prepare filtered + grouped HTML
    const filtered = ffmFilterHistory(history, ffmHistoryFilter);
    const summaryHtml = ffmSchedulerRenderHistoryStats(rule, filtered);
    const groupedHtml = ffmRenderHistoryGroups(filtered);

    modal.innerHTML = `
      <div style="background:#fff; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.18); max-width:520px; width:90%; padding:16px 18px; font-family:system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-size:15px; font-weight:600;">History — ${ffmSchedulerEscapeHtml(title)}</div>
          <button id="ffm-ads-history-close"
                  style="border:none; background:#eee; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">Close</button>
        </div>
        <div class="ffm-history-filter-bar" style="display:flex; gap:8px; padding:8px 0; margin-bottom:10px;">
          <button class="ffm-hist-filter-btn" data-filter="all">All</button>
          <button class="ffm-hist-filter-btn" data-filter="success">Success</button>
          <button class="ffm-hist-filter-btn" data-filter="failed">Failed</button>
          <button class="ffm-hist-filter-btn" data-filter="today">Today</button>
          <button class="ffm-hist-filter-btn" data-filter="last7">Last 7 Days</button>
        </div>
          <div style="font-size:12px; color:#555; margin-bottom:6px;">
            Showing up to 50 most recent <strong>scheduled</strong> Auto DnR runs${runsCount ? ` (${runsCount} total)` : ''}.
          </div>
        <div style="max-height:260px; overflow-y:auto; padding-right:4px;">
          ${summaryHtml}
          ${groupedHtml}
        </div>
      </div>
    `;

    const closeBtn = modal.querySelector('#ffm-ads-history-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', ffmSchedulerCloseHistoryModal);
    }
    // Wire filter buttons
    try {
      const btns = modal.querySelectorAll('.ffm-hist-filter-btn');
      btns.forEach(b => {
        if (b.dataset && b.dataset.filter === ffmHistoryFilter) b.classList.add('active');
        b.addEventListener('click', () => {
          ffmHistoryFilter = b.dataset.filter || 'all';
          // update active state
          btns.forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          // re-open modal (re-render) for this listing
          ffmSchedulerOpenHistoryModal(listingId);
        });
      });
    } catch (e) {}
  } catch (e) {
    console.warn('[ADS] open history modal failed', e);
  }
}

function ffmSchedulerCloseHistoryModal() {
  const modal = document.getElementById('ffm-ads-history-modal');
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
}

// Render a single history entry for the history modal
// Render a single history entry (clean version)
function ffmSchedulerRenderHistoryEntry(rec) {
  if (!rec) return "";

  const isSuccess = rec.success === true;
  const icon = isSuccess
    ? `<span style="color:#16a34a;font-weight:600;">●</span>`
    : `<span style="color:#dc2626;font-weight:600;">●</span>`;

  const statusText = isSuccess ? "Success" : "Failed";
  const timeStr = new Date(rec.time || Date.now()).toLocaleString();

  // Message (fallback)
  const msg = rec.message || (isSuccess ? "Auto DnR completed" : "Run failed");

  return `
    <div class="ffm-ads-history-entry" style="padding:10px 0; border-bottom:1px solid #eee;">
      <div style="display:flex; justify-content:space-between;">
        <div style="font-weight:600;">${icon} ${statusText}</div>
        <div style="color:#555; font-size:12px;">${timeStr}</div>
      </div>

      <div style="font-size:12px; margin-top:4px;">
        ${msg}
      </div>
    </div>
  `;
}

// (duplicate summary function removed — single definition retained earlier)

// Filter helpers
function ffmFilterHistory(history, filter) {
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  switch (filter) {
    case "success":
      return history.filter(h => h.success === true);
    case "failed":
      return history.filter(h => h.success === false);
    case "today":
      return history.filter(h => {
        const d = new Date(h.time);
        const today = new Date();
        return d.toDateString() === today.toDateString();
      });
    case "last7":
      return history.filter(h => now - h.time <= 7 * dayMs);
    default:
      return history;
  }
}

function ffmGroupHistoryByDate(history) {
  const groups = { today: [], yesterday: [], week: [], lastweek: [], older: [] };
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 3600 * 1000;
  const weekStart = todayStart - 7 * 24 * 3600 * 1000;
  const lastWeekStart = todayStart - 14 * 24 * 3600 * 1000;
  function labelFor(t) {
    if (t >= todayStart) return "today";
    if (t >= yesterdayStart) return "yesterday";
    if (t >= weekStart) return "week";
    if (t >= lastWeekStart) return "lastweek";
    return "older";
  }
  for (const rec of history) {
    if (!rec || !rec.time) continue;
    const g = labelFor(rec.time);
    groups[g].push(rec);
  }
  return groups;
}

function ffmRenderHistoryGroups(history) {
  const groups = ffmGroupHistoryByDate(history);
  const order = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "Earlier This Week" },
    { key: "lastweek", label: "Last Week" },
    { key: "older", label: "Older" }
  ];
  let html = "";
  for (const g of order) {
    const arr = groups[g.key];
    if (!arr || arr.length === 0) continue;
    html += `<div style="font-weight:600;margin:12px 0 6px 0;color:#444;">${g.label}</div>`;
    for (const rec of arr) {
      html += ffmSchedulerRenderHistoryEntry(rec);
    }
  }
  return html;
}

