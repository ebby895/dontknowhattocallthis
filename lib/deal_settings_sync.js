// lib/deal_settings_sync.js
// Layers runtime settings from chrome.storage over the config.js defaults.
//
// config.js is the committed baseline and holds no secrets. Anything the user
// changes in the settings panel lives in chrome.storage and wins at runtime, so
// tuning the autopilot never means editing a tracked file.

(function () {
  'use strict';

  const SETTINGS_STORE = 'nxg_settings';
  const KEEPALIVE_ALARM = 'nxg-keepalive';

  function apply(settings) {
    if (!settings || typeof settings !== 'object') return;
    try {
      if (!globalThis.CONFIG) return;
      Object.keys(settings).forEach((k) => {
        if (settings[k] !== undefined && settings[k] !== null) {
          globalThis.CONFIG[k] = settings[k];
        }
      });
    } catch (e) { /* CONFIG may be frozen in some contexts */ }
  }

  function load() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([SETTINGS_STORE], (r) => {
          apply(r && r[SETTINGS_STORE]);
          resolve((r && r[SETTINGS_STORE]) || {});
        });
      } catch (e) { resolve({}); }
    });
  }

  // Keep every context in step the moment a setting changes — flipping the
  // autopilot off must take effect immediately, not on next reload.
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[SETTINGS_STORE]) return;
        apply(changes[SETTINGS_STORE].newValue);
      });
    }
  } catch (e) { /* ignore */ }

  // --- 24/7 service worker keep-alive --------------------------------------
  // MV3 tears the worker down after ~30s idle. An alarm firing under a minute
  // apart is the supported way to keep it resident for continuous operation.
  try {
    if (typeof chrome !== 'undefined' && chrome.alarms && chrome.runtime &&
        !(typeof window !== 'undefined')) {
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
      chrome.alarms.onAlarm.addListener((a) => {
        if (a && a.name === KEEPALIVE_ALARM) {
          // Touching an extension API is enough to reset the idle timer.
          try { chrome.runtime.getPlatformInfo(() => {}); } catch (e) {}
        }
      });
    }
  } catch (e) { /* ignore */ }

  load();

  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.DealSettings = globalThis.DealSettings || { load, apply, SETTINGS_STORE };
    }
  } catch (e) { /* ignore */ }
})();
