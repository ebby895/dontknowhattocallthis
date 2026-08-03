// src/original_content.js
// Auto-generated wrapper that stores the original content.js as a string and exposes runOriginal()
// WARNING: This wrapper executes the original script code in the current context using Function().

const ORIGINAL_CODE = `/* dist/content.js - preserved original content script for AutoList Pro */
// Early defensive cleanup for Facebook pages: remove any injected panel/iframe/styles
// and reset any inline layout changes that may have forced Facebook into a small boxed layout.
(function ffmCleanupFacebookLayout() {
  try {
    const href = (window && window.location && window.location.href) ? window.location.href : '';
    if (!/facebook\.com/.test(href)) return;
  console.debug('ffm: running Facebook layout cleanup to remove injected extension UI');

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
              console.debug('Removed extension-injected style tag');
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
            console.debug('Removed extension CSS link tag');
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

  console.debug('ffm: Facebook cleanup complete — UI elements removed and layout restored');
  } catch (err) {
    try { console.debug('ffmCleanupFacebookLayout error', err); } catch (e) {}
  }
})();

console.log('AutoList Pro content script loaded on page');
// Debug overlay flags and stubs were removed during cleanup; provide harmless no-op
// declarations here so any remaining calls are harmless and don't break the file.
// Debug overlays removed completely.
// Controlled injection: create or remove the panel on demand
// Simplified always-on-top handling: toggle class and z-index only (no global listeners)
let originalBodyMarginRight = '';
let originalHtmlMarginRight = '';

// If we're on facebook.com, remove any previously injected pinned panel and disable
// panel injection for this page. This prevents the extension from inserting a
// sidebar/panel that conflicts with Facebook's layout (especially during publish).
try {
  const href = (window && window.location && window.location.href) ? window.location.href : '';
  if (/facebook\.com/.test(href)) {
    try {
      const existing = document.getElementById('extension-pin-panel') || document.querySelector('.ffm-pin-panel');
      if (existing) {
        try { existing.remove(); console.debug('AutoList Pro: removed existing pinned panel on facebook.com'); } catch (e) {}
      }
    } catch (e) {}
    // Set a flag so future calls to createPanel can skip injection early
    try { window.ffm_panel_disabled = true; } catch (e) {}
  }
} catch (e) {}

function createPanel() {
  // compact pinned top-right panel (minimizable). Keep only one instance.
  // Do not inject the pinned panel on Facebook pages — that UI conflicts with
  // Facebook's own layout and the publish flow. Skip creation when on facebook.com.
  try {
    const href = (window && window.location && window.location.href) ? window.location.href : '';
    if (/facebook\.com/.test(href)) {
      console.debug('createPanel: skipping injection on facebook.com pages');
      return;
    }
  } catch (e) {}
  // Respect global disable flag (set during initial load on some pages)
  try { if (window && window.ffm_panel_disabled) return; } catch (e) {}
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
  try { chrome.runtime.sendMessage({ action: 'ffm_iframe_ready', tabId: (window && window.location && window.location.href) || '' }); } catch (e) {}
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
    if (!message) return;
    // Toggle Next-overlay/debug helper
    // (ffm_toggle_next_overlay listener removed)

    // (ffm_dump_inline_jsons debug listener removed)
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
  try {
    if (!target) return false;
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
    let steps = 0;
    while (el && !isFocusable(el) && steps < 6) { el = el.parentElement; steps++; }
    if (!el) el = target;

    try {
      // ensure element is focusable
      if (!isFocusable(el)) {
        try { el.setAttribute && el.setAttribute('tabindex', '-1'); } catch (e) {}
      }
      try { el.focus && el.focus(); } catch (e) {}
    } catch (e) {}

    // dispatch a standard Enter key sequence (keydown, keypress, keyup) on the element and the document
    try {
      const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      const kp = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      // dispatch on element first
      try { el.dispatchEvent && el.dispatchEvent(kd); } catch (e) {}
      try { el.dispatchEvent && el.dispatchEvent(kp); } catch (e) {}
      try { el.dispatchEvent && el.dispatchEvent(ku); } catch (e) {}
      // small pause and also dispatch on document in case handlers listen there
      await new Promise(r => setTimeout(r, 20));
      try { document.dispatchEvent && document.dispatchEvent(kd); } catch (e) {}
      try { document.dispatchEvent && document.dispatchEvent(kp); } catch (e) {}
      try { document.dispatchEvent && document.dispatchEvent(ku); } catch (e) {}
      return true;
    } catch (e) { return false; }
  } catch (e) { return false; }
}

// Try a sequence of activation strategies in order:
// 1) Dispatch mousedown/mouseup/click on the element (realClick chain)
// 2) Try to find and call React's onClick handler via the internal fiber node
// 3) Programmatic Enter key dispatch (ffmPressEnter)
// Returns true if any strategy was executed without throwing.
async function ffmTryHardClick(el) {
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

// Lightweight visual marker to show where we are about to attempt a click (for debugging)
function ffmShowMarkerAt(el, opts) {
  try {
    if (!el) return;
    const rect = (typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : null;
    const cx = rect ? Math.round(rect.left + rect.width/2) : (opts && opts.x) || 0;
    const cy = rect ? Math.round(rect.top + rect.height/2) : (opts && opts.y) || 0;
    // remove old marker
    try { const old = document.getElementById('ffm-debug-marker'); if (old) old.remove(); } catch (e) {}
    const d = document.createElement('div'); d.id = 'ffm-debug-marker';
    d.style.position = 'fixed'; d.style.left = (cx-12) + 'px'; d.style.top = (cy-12) + 'px'; d.style.width = '24px'; d.style.height = '24px'; d.style.border = '3px solid rgba(255,64,64,0.95)'; d.style.borderRadius = '50%'; d.style.zIndex = '2147483647'; d.style.pointerEvents = 'none'; d.style.transition = 'opacity 200ms ease-out, transform 200ms ease-out';
    const label = document.createElement('div'); label.textContent = '⦿'; label.style.position = 'absolute'; label.style.left = '-2px'; label.style.top = '-2px'; label.style.color = 'rgba(255,64,64,0.95)'; label.style.fontSize = '14px'; label.style.pointerEvents = 'none'; d.appendChild(label);
    document.documentElement.appendChild(d);
    // fade out after a short time
    setTimeout(() => { try { d.style.opacity = '0.25'; d.style.transform = 'scale(1.25)'; } catch (e) {} }, 350);
    setTimeout(() => { try { d.remove(); } catch (e) {} }, 1200);
  } catch (e) {}
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
        // no-op for banner show/hide after cleanup; just track state
        if (now && !lastIsAudience) { lastIsAudience = true; }
        else if (!now && lastIsAudience) { lastIsAudience = false; }
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

// Top-level helper to click the Next/Continue/Publish button. Defined at top-level so
// the populate flow can call it from anywhere.
async function clickNextButton() {
  try {
    const key = 'ffm_next_button';
    // Try cached selector first
    try {
      const map = await ffmGetSelectorMap();
      const cached = map && map[key];
      if (cached) {
        const el = document.querySelector(cached);
        if (el && el.offsetParent !== null) {
          try { el.click(); return true; } catch (e) { try { el.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} }
        }
      }
    } catch (e) { console.debug('clickNextButton: selector cache read error', e); }

    const isBad = (txt) => { try { const t = (txt||'').toLowerCase(); return t.includes('boost') || t.includes('promote') || t.includes('ad') || t.includes('sponsored'); } catch (e) { return false; } };
    const texts = ['next', 'continue', 'done', 'publish', 'post', 'save & continue', 'save and continue', 'next step'];

    // Helper: prefer elements that are backed by React internals (nodes often have properties like
    // __reactProps$<id> or __reactFiber$<id>). These tend to be the actual interactive controls in FB UIs.
    function isReactNode(el) {
      try {
        if (!el || typeof el !== 'object') return false;
        for (const k in el) {
          if (!k) continue;
          if (k.indexOf && k.indexOf('__react') === 0) return true;
        }
        return false;
      } catch (e) { return false; }
    }

    // targeted fast-path: exact role=button with aria-label 'Next' (mirrors Selenium XPath used by the user)
    try {
      const exactCandidates = Array.from(document.querySelectorAll('[role="button"]')).filter(el => {
        try {
          const al = (el.getAttribute && el.getAttribute('aria-label')) || '';
          return al && al.toString().trim().toLowerCase() === 'next' && el.offsetParent !== null && !isBad(el.textContent || al);
        } catch (e) { return false; }
      });
      const exactNext = (exactCandidates.find(isReactNode) || exactCandidates[0]) || null;
      if (exactNext) {
        try {
          try { exactNext.scrollIntoView({ block: 'center' }); } catch (e) {}
          // small pause for UI to wire up
          await new Promise(r => setTimeout(r, 120));

          // Use aggressive click helper (window-level pointer + element dispatch + keyboard fallback)
          try {
            try { ffmShowMarkerAt(exactNext); } catch (e) {};
            await ffmTryHardClick(exactNext);
            // if click didn't trigger, try sending Enter to the target
            try { await ffmPressEnter(exactNext); } catch (e) {}
          } catch (e) { /* best effort */ }

          try {
            const sel = (typeof computeCss === 'function' ? computeCss(exactNext) : null) || (exactNext.id ? \`#${exactNext.id}\` : null) || computeCssLocal(exactNext);
            const ariaAlt = (exactNext.getAttribute && exactNext.getAttribute('aria-label')) ? \`aria:${exactNext.getAttribute('aria-label')}\` : null;
            const xpathAlt = computeXPath(exactNext) ? \`xpath:${computeXPath(exactNext)}\` : null;
            if (sel || ariaAlt || xpathAlt) {
              try {
                const map = await ffmGetSelectorMap();
                if (sel) map[key] = sel;
                if (ariaAlt) map[\`${key}_alt\`] = ariaAlt;
                else if (xpathAlt) map[\`${key}_alt\`] = xpathAlt;
                await ffmSetSelectorMap(map);
              } catch (e) { /* non-fatal */ }
            }
          } catch (e) {}
          console.debug('clickNextButton: clicked exact role=button aria-label=Next candidate');
          return true;
        } catch (e) { /* best effort */ }
      }
    } catch (e) {}

    // Facebook variant fast-path: some FB UIs render Next as a styled span with many class names.
    // Example the user reported: <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft x1j85h84">Next</span>
    try {
      const fbSpanCandidates = Array.from(document.querySelectorAll('span')).filter(el => {
        try {
          const txt = (el.textContent || '').toString().trim().toLowerCase();
          if (txt !== 'next') return false;
          if (el.offsetParent === null) return false; // must be visible
          const cls = (el.className || '').toString();
          // target common FB classname pattern (x1lliihq) or any span that matches exact text 'Next'
          return !!cls && (cls.indexOf('x1lliihq') !== -1 || cls.indexOf('x78zum5') !== -1) && !isBad(el.textContent || el.getAttribute && el.getAttribute('aria-label'));
        } catch (e) { return false; }
      });
      const fbSpanNext = (fbSpanCandidates.find(isReactNode) || fbSpanCandidates[0]) || null;
      if (fbSpanNext) {
        try {
          const clickable = fbSpanNext.closest && (fbSpanNext.closest('button, [role="button"], a') || fbSpanNext) || fbSpanNext;
          try { clickable.scrollIntoView({ block: 'center' }); } catch (e) {}
          await new Promise(r => setTimeout(r, 120));
          try { try { ffmShowMarkerAt(clickable); } catch (e) {} await ffmTryHardClick(clickable); try { await ffmPressEnter(clickable); } catch (e) {} } catch (e) {}
          try {
            const sel = (typeof computeCss === 'function' ? computeCss(clickable) : null) || (clickable.id ? \`#${clickable.id}\` : null) || computeCssLocal(clickable);
            const ariaAlt = (clickable.getAttribute && clickable.getAttribute('aria-label')) ? \`aria:${clickable.getAttribute('aria-label')}\` : null;
            const xpathAlt = computeXPath(clickable) ? \`xpath:${computeXPath(clickable)}\` : null;
            if (sel || ariaAlt || xpathAlt) {
              try { const map = await ffmGetSelectorMap(); if (sel) map[key] = sel; if (ariaAlt) map[\`${key}_alt\`] = ariaAlt; else if (xpathAlt) map[\`${key}_alt\`] = xpathAlt; await ffmSetSelectorMap(map); } catch (e) {}
            }
          } catch (e) {}
          console.debug('clickNextButton: clicked FB span Next variant via nearest clickable ancestor');
          return true;
        } catch (e) { /* best-effort */ }
      }
    } catch (e) {}

    // fast-path: visible text node/span whose text is exactly 'Next' — click its nearest clickable ancestor
    try {
      const textCandidates = Array.from(document.querySelectorAll('span, div, button, [role="button"]')).filter(el => {
        try {
          const txt = (el.textContent || '').toString().trim().toLowerCase();
          return txt === 'next' && el.offsetParent !== null && !isBad(el.textContent || el.getAttribute && el.getAttribute('aria-label'));
        } catch (e) { return false; }
      });
      const textNext = (textCandidates.find(isReactNode) || textCandidates[0]) || null;
      if (textNext) {
        try {
          // find nearest clickable ancestor (prioritize role/button, button, anchor)
          const clickable = textNext.closest && (textNext.closest('button, [role="button"], a') || textNext.closest('[role="button"]')) || null;
          const targetEl = clickable || textNext;
          try { targetEl.scrollIntoView({ block: 'center' }); } catch (e) {}
          await new Promise(r => setTimeout(r, 120));

          // Use aggressive click helper (dispatch pointer events at window + element and keyboard fallbacks)
          try {
            try { ffmShowMarkerAt(targetEl); } catch (e) {};
            await ffmTryHardClick(targetEl);
            try { await ffmPressEnter(targetEl); } catch (e) {}
          } catch (e) { /* best effort */ }

          // persist selectors
          try {
            const sel = (typeof computeCss === 'function' ? computeCss(targetEl) : null) || (targetEl.id ? \`#${targetEl.id}\` : null) || computeCssLocal(targetEl);
            const ariaAlt = (targetEl.getAttribute && targetEl.getAttribute('aria-label')) ? \`aria:${targetEl.getAttribute('aria-label')}\` : null;
            const xpathAlt = computeXPath(targetEl) ? \`xpath:${computeXPath(targetEl)}\` : null;
            if (sel || ariaAlt || xpathAlt) {
              const map = await ffmGetSelectorMap(); if (sel) map[key] = sel; if (ariaAlt) map[\`${key}_alt\`] = ariaAlt; else if (xpathAlt) map[\`${key}_alt\`] = xpathAlt; await ffmSetSelectorMap(map);
            }
          } catch (e) {}

          console.debug('clickNextButton: clicked text-node Next via clickable ancestor');
          return true;
        } catch (e) { /* best-effort */ }
      }
    } catch (e) {}

  // candidates: visible buttons and role=button elements
  const candidates = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], [aria-label]')).filter(n => n && n.offsetParent !== null && (n.textContent || n.value || n.getAttribute('aria-label')));
  // debug overlay call removed

    // local computeCss fallback
    const computeCssLocal = (el) => {
      try {
        if (!el) return null; if (el.id) return \`#${el.id}\`;
        const parts = []; let node = el;
        while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
          let part = node.tagName.toLowerCase();
          if (node.className && typeof node.className === 'string') { const cls = node.className.trim().split(/\s+/).filter(Boolean); if (cls.length) part += '.' + cls.slice(0,3).join('.'); }
          try { const parent = node.parentElement; if (parent) { const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName); if (siblings.length > 1) { const idx = siblings.indexOf(node) + 1; part += \`:nth-child(${idx})\`; } } } catch (e) {}
          parts.unshift(part); node = node.parentElement;
        }
        return parts.join(' > ');
      } catch (e) { return null; }
    };

    // small XPath helper for alternative selector persistence
    const computeXPath = (el) => {
      try {
        if (!el || el.nodeType !== 1) return null;
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
          let part = node.tagName.toLowerCase();
          if (node.id) {
            part += \`[@id="${node.id}"]\`;
            parts.unshift(part);
            break;
          }
          let i = 1;
          let sib = node.previousElementSibling;
          while (sib) { if (sib.tagName === node.tagName) i++; sib = sib.previousElementSibling; }
          part += \`[${i}]\`;
          parts.unshift(part);
          node = node.parentElement;
        }
        return '/' + parts.join('/');
      } catch (e) { return null; }
    };

    for (const c of candidates) {
      try {
        const txt = ((c.textContent || '') + ' ' + (c.value || '') + ' ' + (c.getAttribute && c.getAttribute('aria-label') || '')).toLowerCase().trim();
        if (!txt) continue; if (isBad(txt)) continue;
        for (const t of texts) {
          if (txt.includes(t)) {
            try { c.click(); console.debug('clickNextButton: clicked candidate by text', t);
              try { const sel = (typeof computeCss === 'function' ? computeCss(c) : computeCssLocal(c)) || (c.id ? \`#${c.id}\` : null); if (sel) { const map = await ffmGetSelectorMap(); map[key] = sel; await ffmSetSelectorMap(map); } } catch (e) {}
              return true;
            } catch (e) { try { c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} }
          }
        }
      } catch (e) {}
    }

    // footer fallback
    try {
      const foot = Array.from(document.querySelectorAll('footer, div')).filter(d => d && d.offsetParent !== null && /footer|actions|controls|buttons|modal|dialog/i.test(d.className || d.id || '') ).slice(-1)[0];
      if (foot) {
        const btn = Array.from(foot.querySelectorAll('button, [role="button"]')).find(b => b && b.offsetParent !== null && !isBad(b.textContent || b.getAttribute('aria-label')));
        if (btn) { try { btn.click(); return true; } catch (e) { try { btn.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} } }
      }
    } catch (e) {}

    // Priority: try buttons that appear near the bottom of the viewport (typical Next/Continue footer)
    try {
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      const bottomThreshold = 420; // px from bottom to consider "footer" area
      const bottomCandidates = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], [aria-label]'))
        .filter(n => n && n.offsetParent !== null && (n.textContent || n.value || n.getAttribute('aria-label')))
        .filter(n => {
          try { const r = n.getBoundingClientRect(); return (r.top >= (vh - bottomThreshold)); } catch (e) { return false; }
        });

      if (bottomCandidates.length) {
        for (const b of bottomCandidates) {
          try {
            try { b.scrollIntoView({ block: 'center' }); } catch (e) {}
            // small delay to allow FB to wire up any focus handlers
            await new Promise(r => setTimeout(r, 160));
            try { b.click(); console.debug('clickNextButton: clicked bottom-area candidate', (b.textContent || b.getAttribute('aria-label') || '').toString().trim());
              try { const sel = (typeof computeCss === 'function' ? computeCss(b) : null) || (b.id ? \`#${b.id}\` : null); if (sel) { const map = await ffmGetSelectorMap(); map[key] = sel; await ffmSetSelectorMap(map); } } catch (e) {}
              return true;
            } catch (e) { try { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; } catch (e2) {} }
          } catch (e) { /* best-effort */ }
        }
      }
    } catch (e) { /* ignore footer attempt errors */ }

    // Quick retry: re-check for exact aria=Next candidate a couple times (handles timing races)
    try {
      const retryCount = 2;
      for (let i = 0; i < retryCount; i++) {
        await new Promise(r => setTimeout(r, 200));
        const retryNext = Array.from(document.querySelectorAll('[role="button"]')).find(el => {
          try { const al = (el.getAttribute && el.getAttribute('aria-label')) || ''; return al && al.toString().trim().toLowerCase() === 'next' && el.offsetParent !== null && !isBad(el.textContent || al); } catch (e) { return false; }
        });
        if (retryNext) {
          try {
            retryNext.scrollIntoView({ block: 'center' });
            await new Promise(r => setTimeout(r, 120));
            try { retryNext.click(); } catch (e) { try { retryNext.dispatchEvent(new MouseEvent('click',{bubbles:true})); } catch (e2) {} }
            try {
              const sel = (typeof computeCss === 'function' ? computeCss(retryNext) : null) || (retryNext.id ? \`#${retryNext.id}\` : null) || computeCssLocal(retryNext);
              const ariaAlt = (retryNext.getAttribute && retryNext.getAttribute('aria-label')) ? \`aria:${retryNext.getAttribute('aria-label')}\` : null;
              const xpathAlt = computeXPath(retryNext) ? \`xpath:${computeXPath(retryNext)}\` : null;
              const map = await ffmGetSelectorMap(); if (sel) map[key] = sel; if (ariaAlt) map[\`${key}_alt\`] = ariaAlt; else if (xpathAlt) map[\`${key}_alt\`] = xpathAlt; await ffmSetSelectorMap(map);
            } catch (e) {}
            console.debug('clickNextButton: clicked retry exact aria=Next');
            return true;
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {}

    // Keyboard fallback: focus bottom area and send Enter keypresses (helps activate controls that only listen to keyboard)
    try {
      try { window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' }); } catch (e) {}
      await new Promise(r => setTimeout(r, 120));
      const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
      try { if (typeof target.focus === 'function') target.focus(); } catch (e) {}
      for (let k = 0; k < 3; k++) {
          try {
            const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            target.dispatchEvent(kd); target.dispatchEvent(ku);
          } catch (e) {}
          await new Promise(r => setTimeout(r, 160));
      }
      console.debug('clickNextButton: attempted keyboard Enter fallback');
      return true; // optimistic — keyboard likely triggered the control
    } catch (e) {}

    // If the above didn't activate but some element is visually highlighted (focused or shows outline), try sending Enter to that element specifically
    try {
      const focused = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      const isVisuallyHighlighted = (el) => {
        try {
          if (!el) return false;
          const s = window.getComputedStyle(el);
          if (!s) return false;
          const outline = (s.outlineStyle && s.outlineStyle !== 'none') || (s.outlineWidth && parseFloat(s.outlineWidth) > 0);
          const box = (s.boxShadow && s.boxShadow !== 'none');
          return outline || box;
        } catch (e) { return false; }
      };
      const highlighted = focused || Array.from(document.querySelectorAll('button, [role="button"], a, input')).find(isVisuallyHighlighted) || null;
      if (highlighted) {
        try { if (typeof highlighted.focus === 'function') highlighted.focus(); } catch (e) {}
        for (let k=0;k<2;k++) {
          try {
            const kd = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
            const ku = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
            highlighted.dispatchEvent(kd); highlighted.dispatchEvent(ku);
          } catch (e) {}
          await new Promise(r => setTimeout(r, 120));
        }
        console.debug('clickNextButton: attempted Enter on highlighted element', highlighted);
        return true;
      }
    } catch (e) {}

    console.debug('clickNextButton: no candidate found');
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
          noteHidden.textContent = \`FFM: ${hiddenCandidates.length} hidden candidates found (inspect DOM)\`;
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
            const label = document.createElement('div'); label.textContent = \`hidden ${hIdx}\`; label.style.fontSize='12px'; label.style.padding='2px 6px'; label.style.color='#222'; marker.appendChild(label);
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

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;
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

            // Search heuristics: visible buttons with common next texts
            const texts = ['next', 'continue', 'done', 'publish', 'post', 'save & continue', 'save and continue', 'next step', 'continue to checkout'];
            const isBad = (txt) => { try { const t = (txt||'').toLowerCase(); return t.includes('boost') || t.includes('promote') || t.includes('ad') || t.includes('sponsored'); } catch (e) { return false; } };

            // collect candidate buttons/controls
            const candidates = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"], [aria-label]')).filter(n => n && n.offsetParent !== null && (n.textContent || n.value || n.getAttribute('aria-label')));
            // debug overlay call removed

            // quick pass: find elements whose aria-label exactly equals 'Next' (case-insensitive)
            try {
              const ariaNext = Array.from(document.querySelectorAll('[aria-label]')).find(el => (el.getAttribute('aria-label')||'').trim().toLowerCase() === 'next' && el.offsetParent !== null && !isBad(el.textContent || el.getAttribute('aria-label')));
              if (ariaNext) { try { ariaNext.click(); console.debug('clickNextButton: clicked aria-label Next'); const sel = computeCss && computeCss(ariaNext) || (ariaNext.id ? \`#${ariaNext.id}\` : null); if (sel) { const map = await ffmGetSelectorMap(); map[key] = sel; await ffmSetSelectorMap(map); } return true; } catch (e) { try { ariaNext.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; } catch (e2) {} } }
            } catch (e) {}

            // computeCss helper (local) in case global isn't available
            const computeCssLocal = (el) => {
              try {
                if (!el) return null;
                if (el.id) return \`#${el.id}\`;
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
                        part += \`:nth-child(${idx})\`;
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
                  if (txt.includes(t)) {
                    try { c.click(); console.debug('clickNextButton: clicked candidate by text', t, c);
                      // cache selector for future runs
                      try { const sel = (typeof computeCss === 'function' ? computeCss(c) : computeCssLocal(c)) || (c.id ? \`#${c.id}\` : null); if (sel) { const map = await ffmGetSelectorMap(); map[key] = sel; await ffmSetSelectorMap(map); } } catch (e) {}
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
      // make setPriceWithRetry return a Promise that resolves when price set or timeout
      // Returns an object: { ok: boolean, score: number }
      const computePriceScore = (expected, actual) => {
        try {
          const a = (actual || '').toString().trim();
          const e = (expected || '').toString().trim();
          if (!e && !a) return 1.0;
          if (!e || !a) return 0.0;
          const normalize = (s) => s.replace(/[^0-9\.\-]/g, '').replace(/,+/g, '');
          const pn = parseFloat(normalize(e));
          const an = parseFloat(normalize(a));
          if (!isNaN(pn) && !isNaN(an)) {
            if (Math.abs(pn - an) < 1e-6) return 1.0;
            const rel = Math.abs(pn - an) / Math.max(1, Math.abs(pn));
            if (rel < 0.02) return 0.98;
            if (rel < 0.05) return 0.9;
            if (rel < 0.15) return 0.8;
            return 0.6;
          }
          if (a.includes(e) || e.includes(a)) return 0.85;
          return 0.5;
        } catch (e) { return 0.0; }
      };

      const setPriceWithRetry = (value, opts) => {
        opts = opts || {};
        const MIN_PRICE_SCORE = (typeof opts.minScore === 'number') ? opts.minScore : 0.6;
        const MAX_LOW_SCORE_RETRIES = (typeof opts.lowRetries === 'number') ? opts.lowRetries : 3;
        return new Promise((resolve) => {
          let attempts = 0;
          const maxAttempts = 16; // ~5 seconds at 300ms interval
          let best = { ok: false, score: 0.0, attempts: 0, actual: null, selector: null };
          const trySet = async () => {
            attempts++;
            try {
              const ok = setPrice(value);
              if (ok) {
                try {
                  const selectors = ['input[placeholder*="Price"]', 'input[aria-label*="Price"]', 'input[name="price"]', 'input[type="number"]'];
                  let found = null; let usedSel = null;
                  for (const s of selectors) {
                    const el = document.querySelector(s);
                    if (el) { found = el; usedSel = s; break; }
                  }
                  if (!found) {
                    const numberInputs = Array.from(document.querySelectorAll('input')).filter(i => i && (i.type === 'number' || /\d/.test(i.value)));
                    if (numberInputs.length > 0) { found = numberInputs[0]; usedSel = 'fallback:numberInputs'; }
                  }
                  const actual = found ? (found.value || found.textContent || '') : '';
                  const score = computePriceScore(value || '', actual || '');
                  if (score > best.score) {
                    best = { ok: true, score, attempts, actual, selector: usedSel };
                  }
                  try { console.log('[AutoList Pro] setPriceWithRetry try', { attempts, value, actual, selector: usedSel, score }); } catch (e) {}

                  if (score >= MIN_PRICE_SCORE) {
                    window.ffm_last_price_score = best.score;
                    try { chrome.storage.local.set({ ffm_price_diag_last: { when: Date.now(), expected: String(value), actual: String(actual), score: best.score, attempts } }); } catch (e) {}
                    resolve({ ok: true, score: best.score, attempts, actual, selector: usedSel });
                    return;
                  }

                  if (attempts <= maxAttempts) {
                    if (best.score < MIN_PRICE_SCORE && MAX_LOW_SCORE_RETRIES > 0) {
                      let lowAttempts = 0;
                      while (lowAttempts < MAX_LOW_SCORE_RETRIES) {
                        lowAttempts++;
                        try {
                          if (found) { try { found.focus(); found.value = ''; found.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
                          await new Promise(r => setTimeout(r, 220));
                          setPrice(value);
                          await new Promise(r => setTimeout(r, 300));
                          const reactual = found ? (found.value || found.textContent || '') : '';
                          const resc = computePriceScore(value || '', reactual || '');
                          try { console.log('[AutoList Pro] setPriceWithRetry low-retry', { lowAttempts, reactual, resc }); } catch (e) {}
                          if (resc > best.score) {
                            best = { ok: true, score: resc, attempts, actual: reactual, selector: usedSel };
                          }
                          if (resc >= MIN_PRICE_SCORE) break;
                        } catch (e) {}
                      }
                      try { chrome.storage.local.set({ ffm_price_diag_last: { when: Date.now(), expected: String(value), actual: String(best.actual || ''), score: best.score, attempts, lowRetries: MAX_LOW_SCORE_RETRIES } }); } catch (e) {}
                      window.ffm_last_price_score = best.score;
                      resolve({ ok: best.score >= MIN_PRICE_SCORE, score: best.score, attempts, actual: best.actual, selector: best.selector });
                      return;
                    }
                  }

                  window.ffm_last_price_score = best.score;
                  try { chrome.storage.local.set({ ffm_price_diag_last: { when: Date.now(), expected: String(value), actual: String(actual || ''), score, attempts } }); } catch (e) {}
                  resolve({ ok: score >= MIN_PRICE_SCORE, score, attempts, actual, selector: usedSel });
                  return;
                } catch (e) {
                  window.ffm_last_price_score = 0.0;
                  try { chrome.storage.local.set({ ffm_price_diag_last: { when: Date.now(), expected: String(value), error: String(e && e.message) || 'unknown' } }); } catch (er) {}
                  resolve({ ok: true, score: 0.0, attempts });
                  return;
                }
              }
            } catch (e) {
              // ignore individual setPrice errors, continue retry loop
            }
            if (attempts >= maxAttempts) {
              window.ffm_last_price_score = best.score || 0.0;
              try { chrome.storage.local.set({ ffm_price_diag_last: { when: Date.now(), expected: String(value), score: best.score || 0.0, attempts } }); } catch (e) {}
              resolve({ ok: false, score: best.score || 0.0, attempts });
              return;
            }
            setTimeout(trySet, 300);
          };
          trySet();
        });
      };

      (async () => {
        try {
        // 1) Upload pictures first (user preference)
        if (listing.images && listing.images.length > 0) {
          const files = [];
          for (let i = 0; i < listing.images.length; i++) {
            try {
              const f = await dataUrlToFile(listing.images[i], \`img${i}.jpg\`);
              files.push(f);
            } catch (err) {
              console.warn('image conversion failed', err);
            }
          }
          if (files.length > 0) {
            const fileInputs = Array.from(document.querySelectorAll('input[type=file]'));
            if (fileInputs.length === 0) {
              console.warn('No file input found to attach images');
            } else {
              const visibleInput = fileInputs.find(i => i.offsetParent !== null) || fileInputs[0];
              const dt = new DataTransfer();
              files.forEach(f => dt.items.add(f));
              try {
                visibleInput.files = dt.files;
                visibleInput.dispatchEvent(new Event('change', { bubbles: true }));
                // give FB some time to process uploaded images
                await sleep(1000);
              } catch (err) {
                console.debug('Failed to set files on input', err);
              }
            }
          }
        }

        // 2) Set Title
        try {
          // Prefer explicit listing.title; fallback to inventoryName if title is empty
          setTitle((listing.title && String(listing.title).trim()) || (listing.inventoryName && String(listing.inventoryName).trim()) || '');
        } catch (e) { console.warn('setTitle error', e); }
        await sleep(800);

        // 3) Set Price (with retries) — capture confirmation score
        try {
          const priceResult = await setPriceWithRetry(listing.price || '', { minScore: 0.6, lowRetries: 3 });
          try { window.ffm_last_price_score = (priceResult && typeof priceResult.score === 'number') ? priceResult.score : (window.ffm_last_price_score || 0.0); } catch (e) {}
          try { console.log('[AutoList Pro] setPriceWithRetry result', priceResult); } catch (e) {}
          try { chrome.storage.local.set({ ffm_price_last_result: { when: Date.now(), expected: String(listing.price || ''), score: (priceResult && priceResult.score) || 0.0, ok: !!(priceResult && priceResult.ok), attempts: (priceResult && priceResult.attempts) || 0 } }); } catch (e) {}
        } catch (e) { try { window.ffm_last_price_score = 0.0; } catch (er) {} }
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
                console.debug('[AutoList Pro] tab-match-scan', t+1, txt);

                if (txt && requested && new RegExp(requested.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&'), 'i').test(txt)) {
                  try { f.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
                  try { f.click && f.click(); } catch (e) { try { f.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {} }
                  await sleep(120 + ffm_randInt(20,60));
                  try { const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }); const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }); f.dispatchEvent(down); f.dispatchEvent(up); } catch (e) {}
                  await sleep(400 + ffm_randInt(40,120));
                  return;
                }
              }
              console.debug('[AutoList Pro] did not find matching category via tab-scan for', requested);
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
                try { lab = document.querySelector(\`label[for="${r.id}"]\`) || r.closest('label'); } catch (e) {}
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
                if (el.id) return \`#${el.id}\`;
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
                        part += \`:nth-child(${idx})\`;
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
              const cached = map && map[\`attr_${attrKey}\`];
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
                try { lab = document.querySelector(\`label[for="${r.id}"]\`) || r.closest('label'); } catch (e) {}
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
                if (el.id) return \`#${el.id}\`;
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
                        part += \`:nth-child(${idx})\`;
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
            const id = af.id ? \`#${af.id}\` : '';
            const cls = (af.className && typeof af.className === 'string') ? '.' + af.className.trim().split(/\s+/).slice(0,3).join('.') : '';
            const aria = (af.getAttribute && (af.getAttribute('aria-label') || af.getAttribute('role') || af.getAttribute('aria-checked'))) || '';
            const txt = (af.textContent || '').toString().trim().replace(/\s+/g, ' ').slice(0, 120);
            return \`${tag}${id}${cls} aria="${aria}" text="${txt}"\`;
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
                  if (el.id) return \`#${el.id}\`;
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
                        if (siblings.length > 1) part += \`:nth-child(${Array.from(parent.children).indexOf(node) + 1})\`;
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
                    m.id = \`ffm-hide-marker-${num}\`;
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
                    li.textContent = \`${num}. ${txt.toString().trim().replace(/\s+/g,' ').slice(0,140)}\`;
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

  // Previously we held after toggling. Now auto-click Next, retry if necessary until the
  // delivery step appears, then select the delivery method 'Local Pickup'.
  try {
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

    // Helper: try click Next a few times with delays (used after delivery selection)
    async function clickNextWithRetries(retries = 3) {
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
        if (/to review before (publishing|publish)/i.test(bodyText)) return true;
        if (bodyText.indexOf('review') !== -1 && bodyText.indexOf('publish') !== -1) return true;
        // scan nearby nodes for combined 'review' + 'publish' wording
        const nodes = Array.from(document.querySelectorAll('div, span, p, label'));
        for (const n of nodes) {
          try {
            const t = (n.textContent || '').toString().toLowerCase();
            if (!t) continue;
            if (t.indexOf('review') !== -1 && t.indexOf('publish') !== -1) return true;
          } catch (e) {}
        }
      } catch (e) {}
      return false;
    }

    // Kick off clicking Next until delivery step appears
      try {
        // If there's a likely Next button matching the snippet the user provided, persist it for future runs.
        try {
          const candidate = Array.from(document.querySelectorAll('div[role="button"][aria-label="Next"], button[aria-label="Next"], span')).find(el => {
            try {
              if (!el || el.offsetParent === null) return false;
              const txt = (el.textContent||'').trim().toLowerCase();
              if (txt !== 'next') return false;
              const cls = (el.className || '').toString();
              // prefer nodes with the FB short class prefixes we've seen
              if (cls && (cls.indexOf('x1i10hfl') !== -1 || cls.indexOf('x1lliihq') !== -1)) return true;
              return false;
            } catch (e) { return false; }
          });
          if (candidate) {
            try {
            // Prefer to persist the clickable ancestor (button or [role=button]) if the candidate is a span
            let toPersist = candidate;
            try { const anc = candidate.closest && (candidate.closest('button, [role="button"]')); if (anc) toPersist = anc; } catch (e) {}
            const sel = computeCssLocal(toPersist) || (toPersist.id ? \`#${toPersist.id}\` : null) || null;
            if (sel) {
              try { const map = await ffmGetSelectorMap(); map['ffm_next_button'] = sel; await ffmSetSelectorMap(map); console.debug('persisted ffm_next_button selector for Next:', sel); } catch (e) { console.debug('persist next selector error', e); }
            }
            } catch (e) { console.debug('compute/persist candidate selector failed', e); }
          }
        } catch (e) {}
      } catch (e) {}
    const loaded = await clickNextUntilDelivery(20000);
    if (!loaded) console.debug('populate-fb: delivery step did not load within timeout after clicking Next');

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
              const sel = \`#${el.id}\`;
              const map = await ffmGetSelectorMap();
              map['attr_delivery_method'] = sel;
              await ffmSetSelectorMap(map);
              console.debug('selectDeliveryMethod: cached delivery selector', sel);
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
                  if (idx > 1) part += \`:nth-child(${idx})\`;
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
              console.debug('selectDeliveryMethod: cached delivery selector', sel);
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

    // After the delivery step appears (or we gave up waiting), attempt selection and advance
    try {
      let picked = await selectDeliveryMethod('Local Pickup');
      console.debug('populate-fb: selectDeliveryMethod result ->', picked);
      // If we successfully picked Local Pickup, advance by clicking Next on the delivery page
      if (picked) {
        try {
          // If we're on the audience step and the page shows a review-before-publishing message,
          // do not auto-advance (avoid auto-publishing).
          if (ffmIsAudienceUrl() && ffmPageShowsReviewBeforePublish()) {
            console.debug('populate-fb: audience/review detected -> pausing auto-advance to allow manual review');
            } else {
            await sleep(800); // brief pause to let UI stabilize (increased to avoid accidental Publish)
            await clickNextWithRetries(1);
            console.debug('populate-fb: clicked Next after delivery selection (single attempt)');
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
            } else {
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
        } catch (e) {
          console.debug('populate-fb async flow error', e);
        }
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
      Description_1: "{Inventory_Name} - {Condition}\nPrice: {Price} (Retail: {Retail_Price})\nSize: {Size} | Core: {Core} | Comfort: {Comfort}\n\nContact to arrange pickup.",
      Description_2: "Selling {Inventory_Name} - {Condition}. Asking {Price}. In great condition. Local pickup only.",
      Description_3: "{Inventory_Name} - {Price}. Retail was {Retail_Price}. {Size} - {Core} - {Comfort}. Message me for details.",
      Description_4: "{Inventory_Name} - {Condition}. Clean, smoke-free home. {Price} or best offer. Pickup in person."
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

    // Load stored templates or seed defaults
    safeGetStorage((res) => {
      try {
        if (res && res[STORAGE_KEY]) templates = Object.assign({}, DEFAULTS, res[STORAGE_KEY]);
        else safeSetStorage({ [STORAGE_KEY]: templates });
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

`;

export function runOriginal(scopeWindow = window, scopeDocument = document) {
  const fn = new Function('window', 'document', ORIGINAL_CODE + '\n//# sourceURL=fast4mp-original-content.js');
  return fn(scopeWindow, scopeDocument);
}

export default { runOriginal };
