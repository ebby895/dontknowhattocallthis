// popup/deal_settings.js
// Settings surface for the deal engine. The Gemini key is written straight to
// chrome.storage — entered once, persists across restarts, never lands in a
// file that gets committed.

(function () {
  'use strict';

  const KEY_STORE = 'nxg_gemini_key';
  const SETTINGS_STORE = 'nxg_settings';
  const RATE_KEY = 'nxg_post_history';
  const QUEUE_KEY = 'nxg_deal_queue';

  // Runtime overrides layered on top of config.js defaults. config.js stays the
  // committed baseline; whatever you set here wins at runtime.
  const FIELDS = {
    assocTag:     { key: 'associateTag',           type: 'text',   def: 'nxtgenhotdeal-20' },
    instantScan:  { key: 'instantScan',            type: 'bool',   def: true },
    autoPostArmed:{ key: 'autoPostArmed',          type: 'bool',   def: false },
    maxAge:       { key: 'autoPostMaxAgeMinutes',  type: 'number', def: 45 },
    minGap:       { key: 'autoPostMinGapMinutes',  type: 'number', def: 12 },
    maxHour:      { key: 'autoPostMaxPerHour',     type: 'number', def: 4 },
    maxDay:       { key: 'autoPostMaxPerDay',      type: 'number', def: 25 },
    minDisc:      { key: 'dealMinDiscountPct',     type: 'number', def: 15 },
    model:        { key: 'geminiModel',            type: 'text',   def: 'gemini-2.5-flash' }
  };

  const $ = (id) => document.getElementById(id);

  function get(keys) {
    return new Promise((r) => chrome.storage.local.get(keys, (v) => r(v || {})));
  }
  function set(obj) {
    return new Promise((r) => chrome.storage.local.set(obj, () => r(true)));
  }

  function flash(el, msg, ok) {
    el.textContent = msg;
    el.className = 'status ' + (ok ? 'ok' : 'err');
    setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
  }

  // --- Key ------------------------------------------------------------------

  async function loadKey() {
    const r = await get([KEY_STORE]);
    const k = r[KEY_STORE] || '';
    if (k) {
      // Show it's set without echoing the secret back into the DOM.
      $('geminiKey').placeholder = 'Saved (' + k.slice(0, 6) + '…' + k.slice(-4) + ')';
    }
  }

  $('saveKey').addEventListener('click', async () => {
    const v = $('geminiKey').value.trim();
    if (!v) return flash($('keyStatus'), 'Enter a key first.', false);
    await set({ [KEY_STORE]: v });
    $('geminiKey').value = '';
    await loadKey();
    flash($('keyStatus'), 'Saved. You will not need to enter it again.', true);
  });

  // --- Settings -------------------------------------------------------------

  async function loadSettings() {
    const r = await get([SETTINGS_STORE]);
    const s = r[SETTINGS_STORE] || {};

    Object.keys(FIELDS).forEach((id) => {
      const f = FIELDS[id];
      const cfgVal = (globalThis.CONFIG && globalThis.CONFIG[f.key]);
      const val = s[f.key] !== undefined ? s[f.key]
                : (cfgVal !== undefined ? cfgVal : f.def);
      const el = $(id);
      if (!el) return;
      if (f.type === 'bool') el.checked = !!val;
      else el.value = val;
    });

    $('armedWarn').hidden = !$('autoPostArmed').checked;
  }

  $('autoPostArmed').addEventListener('change', () => {
    $('armedWarn').hidden = !$('autoPostArmed').checked;
  });

  $('saveSettings').addEventListener('click', async () => {
    const out = {};
    Object.keys(FIELDS).forEach((id) => {
      const f = FIELDS[id];
      const el = $(id);
      if (!el) return;
      if (f.type === 'bool') out[f.key] = el.checked;
      else if (f.type === 'number') out[f.key] = Number(el.value) || f.def;
      else out[f.key] = (el.value || '').trim() || f.def;
    });

    if (!/^[a-z0-9-]+-\d{2}$/i.test(out.associateTag)) {
      return flash($('setStatus'), 'That does not look like an associate tag.', false);
    }

    await set({ [SETTINGS_STORE]: out });
    flash($('setStatus'), 'Saved. Reload x.com tabs to apply.', true);
  });

  // --- Activity -------------------------------------------------------------

  async function loadStats() {
    const r = await get([RATE_KEY, QUEUE_KEY]);
    const hist = r[RATE_KEY] || [];
    const queue = r[QUEUE_KEY] || [];
    const now = Date.now();

    $('statHour').textContent = hist.filter((e) => e.at > now - 3600e3).length;
    $('statDay').textContent = hist.filter((e) => e.at > now - 86400e3).length;
    $('statQueue').textContent = queue.filter(
      (d) => d.status !== 'posted' && d.status !== 'dismissed'
    ).length;
  }

  $('openQueue').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/deal_queue.html') });
  });

  loadKey();
  loadSettings();
  loadStats();
})();
