// Multi-user helpers (M1)
export const FFM_ACTIVE_USER_KEY = 'ffm_active_user_id';

// Normalize legacy `fast4mp_last_user` (plain email) to hashed `fast4mp_last_user_hash`.
export async function ffmNormalizeLastUser() {
  try {
    const legacyKey = 'fast4mp_last_user';
    const canonKey = 'fast4mp_last_user_hash';
    const stored = await new Promise((res) => { try { chrome.storage.local.get([legacyKey, canonKey], res); } catch (e) { res({}); } });
    const canon = stored && stored[canonKey] ? stored[canonKey] : null;
    if (canon) return canon;
    const legacy = stored && stored[legacyKey] ? stored[legacyKey] : null;
    // Check window.localStorage as well (popup contexts may have legacy keys there)
    let localLegacy = null;
    try {
      if (!legacy && typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
        localLegacy = window.localStorage.getItem(legacyKey) || null;
      }
    } catch (e) { localLegacy = null; }
    const effective = legacy || localLegacy;
    if (!effective) return null;
    if (!legacy) return null;
    const toProc = String(effective);
    if (toProc.includes('@')) {
      try {
        const enc = new TextEncoder().encode(toProc.toLowerCase().trim());
        const buf = await crypto.subtle.digest('SHA-256', enc);
        const hashed = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
        if (hashed) {
          try { await new Promise((r) => { try { chrome.storage.local.set({ [legacyKey]: hashed, [canonKey]: hashed }, () => r(true)); } catch (e) { r(true); } }); } catch (e) {}
          try { if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem(legacyKey, hashed); } catch (e) {}
          try { console.log('[FFM] Migrated legacy fast4mp_last_user (popup_helpers)'); } catch (e) {}
        }
        return hashed;
      } catch (e) { return null; }
    }
    // If legacy exists but doesn't contain '@', assume it's a hash and copy
    if (typeof toProc === 'string') {
      try { await new Promise((r) => { try { chrome.storage.local.set({ [canonKey]: toProc }, () => r(true)); } catch (e) { r(true); } }); } catch (e) {}
      try { if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem(legacyKey, toProc); } catch (e) {}
      return toProc;
    }
    return null;
  } catch (e) { return null; }
}

export async function ffmGetActiveUserId() {
  return new Promise((resolve) => {
    try {
        // Ensure legacy last-user is normalized before checking active user
        try { await ffmNormalizeLastUser(); } catch (e) {}

        chrome.storage.local.get(FFM_ACTIVE_USER_KEY, (r) => {
        try { resolve(r && r[FFM_ACTIVE_USER_KEY] ? r[FFM_ACTIVE_USER_KEY] : null); } catch (e) { resolve(null); }
      });
    } catch (e) { resolve(null); }
  });
}

export function ffmUserKey(baseKey, userId) {
  if (!userId) return null;
  return `users/${userId}/${baseKey}`;
}

export async function ffmSetActiveUserId(userId) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(FFM_ACTIVE_USER_KEY, (r) => {
        try {
          const existing = r && r[FFM_ACTIVE_USER_KEY] ? r[FFM_ACTIVE_USER_KEY] : null;
          // If an existing different user is present, show the Single-Browser User Guard
          if (existing && existing !== userId) {
            try {
              // If modal already shown, just resolve false
              if (document.getElementById('ffm-single-user-guard')) {
                resolve(false);
                return;
              }

              const root = document.createElement('div');
              root.id = 'ffm-single-user-guard';
              root.style.position = 'fixed';
              root.style.inset = '0';
              root.style.background = 'rgba(0,0,0,0.6)';
              root.style.display = 'flex';
              root.style.alignItems = 'center';
              root.style.justifyContent = 'center';
              root.style.zIndex = '200000';

              const card = document.createElement('div');
              card.style.width = 'min(640px,92vw)';
              card.style.background = '#fff';
              card.style.borderRadius = '10px';
              card.style.padding = '18px';
              card.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';
              card.style.maxHeight = '80vh';
              card.style.overflow = 'auto';

              const title = document.createElement('h2');
              title.textContent = 'Another AutoList Pro user is already signed in';
              title.style.marginTop = '0';
              card.appendChild(title);

              const body = document.createElement('div');
              body.style.fontSize = '14px';
              body.style.color = '#222';
              body.style.lineHeight = '1.4';
              body.style.whiteSpace = 'pre-wrap';
              body.innerText = `AutoList Pro stores listings and schedules locally per browser profile\nto keep your data safe and isolated.\n\nAnother account has already signed in on this Chrome profile.\n\nTo use a different account:\n• Open a new Chrome Profile\n• Or use Incognito / another browser\n\nThis prevents listings and schedules from mixing between users.`;
              card.appendChild(body);

              const actions = document.createElement('div');
              actions.style.display = 'flex';
              actions.style.justifyContent = 'flex-end';
              actions.style.gap = '8px';
              actions.style.marginTop = '12px';

              const okBtn = document.createElement('button');
              okBtn.className = 'action-btn ffm-guard-ok-btn';
              okBtn.textContent = 'OK';
              okBtn.addEventListener('click', async () => {
                try {
                  okBtn.disabled = true;
                  // Ask background to sign out the current session
                  await new Promise((res) => {
                    try {
                      chrome.runtime.sendMessage({ type: 'ffm-auth:logout' }, (r) => res(r));
                    } catch (e) { res({ ok: false }); }
                  });

                  // Clear the active-user key locally
                  try { chrome.storage.local.remove([FFM_ACTIVE_USER_KEY]); } catch (e) {}

                  // Remove modal
                  try { const el = document.getElementById('ffm-single-user-guard'); if (el) el.remove(); } catch (e) {}

                  // Show sign-in screen in the popup overlay
                  try {
                    import('./auth/login_page.js').then((m) => { try { m.loadLoginPage('ffm-auth-overlay-inner'); } catch (e) {} }).catch(() => {});
                  } catch (e) {}

                  resolve(false);
                } catch (e) {
                  try { const el = document.getElementById('ffm-single-user-guard'); if (el) el.remove(); } catch (er) {}
                  resolve(false);
                }
              });

              actions.appendChild(okBtn);
              card.appendChild(actions);

              // Prevent backdrop clicks
              root.addEventListener('click', (ev) => { ev.stopPropagation(); });
              root.appendChild(card);
              document.body.appendChild(root);
            } catch (e) {
              // If UI fails, fall back to denying set
              resolve(false);
            }
            return;
          }

          // No conflict — set the active user id
          chrome.storage.local.set({ [FFM_ACTIVE_USER_KEY]: userId }, () => resolve(true));
        } catch (e) { resolve(false); }
      });
    } catch (e) { resolve(false); }
  });
}

export async function ffmClearActiveUser() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove([FFM_ACTIVE_USER_KEY], () => resolve(true));
    } catch (e) { resolve(false); }
  });
}

// Default -> user migration (runs once after login)
export async function ffmMigrateDefaultToUser(userId) {
  if (!userId) return;
  const oldKeys = [
    'saved_listings',
    'draft_listings',
    'ffm_settings',
    'ffm_defaults'
  ];

  try {
    const snapshot = await new Promise((res) => { try { chrome.storage.local.get(oldKeys, res); } catch (e) { res({}); } });
    const writes = {};
    for (const k of oldKeys) {
      if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, k)) {
        writes[`users/${userId}/${k}`] = snapshot[k];
      }
    }

    if (Object.keys(writes).length) {
      await new Promise((res) => { try { chrome.storage.local.set(writes, () => res(true)); } catch (e) { res(true); } });
      try { await new Promise((res) => { try { const keys = Array.isArray(oldKeys) ? oldKeys.filter(k => (k !== '__ffm_persist' && k !== 'fast4mp_last_user_hash')) : (oldKeys === '__ffm_persist' ? [] : [oldKeys]); chrome.storage.local.remove(keys, () => res(true)); } catch (e) { res(true); } }); } catch (e) {}
      try { console.info(`[AutoList Pro] Migrated default data → user ${userId}`); } catch (e) {}
    }
  } catch (e) {
    try { console.warn('[AutoList Pro] Migration failed', e); } catch (er) {}
  }
}
