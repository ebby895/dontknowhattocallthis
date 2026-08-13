const PERSIST_KEY = "__ffm_persist";

const FFM_LAST_USER = "fast4mp_last_user_hash";

/**
 * Returns a stable device identifier.
 * Creates it once and never overwrites it.
 */
export async function ffmGetPersistId() {
  try {
    const stored = await chrome.storage.local.get(PERSIST_KEY);
    if (stored && stored[PERSIST_KEY]) {
      return stored[PERSIST_KEY];
    }
  } catch (e) {
    // ignore and create new
  }

  const id = crypto.randomUUID();
  try { await chrome.storage.local.set({ [PERSIST_KEY]: id }); } catch (e) {}
  return id;
}

/**
 * Returns a hashed fingerprint safe for backend use.
 * Raw UUID never leaves the client.
 */
export async function ffmGetPersistFingerprint() {
  const id = await ffmGetPersistId();
  const data = new TextEncoder().encode(id + "::ffm");
  const hash = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function ffmSha256(str) {
  try {
    const enc = new TextEncoder().encode(String(str || ''));
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}

// Normalize legacy `fast4mp_last_user` storage (plain email) to hashed value.
// Returns the canonical hashed value or null when not present.
export async function ffmNormalizeLastUser(email) {
  try {
    const legacyKey = 'fast4mp_last_user';
    const canonical = FFM_LAST_USER;
    const stored = await new Promise((res) => { try { chrome.storage.local.get([legacyKey, canonical], res); } catch (e) { res({}); } });

    const canon = stored && stored[canonical] ? stored[canonical] : null;
    if (canon) return canon;

    const legacy = stored && stored[legacyKey] ? stored[legacyKey] : null;
    // If nothing in chrome.storage, check window.localStorage (popup contexts may have legacy entries there)
    let localLegacy = null;
    try {
      if (!legacy && typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
        localLegacy = window.localStorage.getItem(legacyKey) || null;
      }
    } catch (e) { localLegacy = null; }
    const effectiveLegacy = legacy || localLegacy;
    if (!effectiveLegacy) return null;
    if (!legacy) return null;

    // If legacy looks like an email, hash and overwrite both keys.
    const toProcess = String(effectiveLegacy);
    if (toProcess.includes('@')) {
      const hashed = await ffmSha256(toProcess.toLowerCase().trim());
      if (hashed) {
        try { await new Promise((res) => { try { chrome.storage.local.set({ [legacyKey]: hashed, [canonical]: hashed }, () => res(true)); } catch (e) { res(true); } }); } catch (e) {}
        try { if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem(legacyKey, hashed); } catch (e) {}
        try { console.log('[FFM] Migrated legacy fast4mp_last_user'); } catch (e) {}
      }
      return hashed;
    }

    // If legacy exists but doesn't contain '@', assume it's already a hash — copy to canonical key.
    if (typeof toProcess === 'string') {
      try { await new Promise((res) => { try { chrome.storage.local.set({ [canonical]: toProcess }, () => res(true)); } catch (e) { res(true); } }); } catch (e) {}
      try { if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem(legacyKey, toProcess); } catch (e) {}
      return toProcess;
    }

    return null;
  } catch (e) { return null; }
}

export function ffmGenerateId() {
  try { return crypto.randomUUID(); } catch (e) { return String(Date.now()) + '-' + Math.random().toString(36).slice(2,8); }
}

export async function ffmEnsurePersistId() {
  try {
    const stored = await new Promise((res) => { try { chrome.storage.local.get([PERSIST_KEY], res); } catch (e) { res({}); } });
    if (!stored || !stored[PERSIST_KEY]) {
      const id = ffmGenerateId();
      await new Promise((res) => { try { chrome.storage.local.set({ [PERSIST_KEY]: id }, () => res(true)); } catch (e) { res(true); } });
    }
  } catch (e) {}
}

export async function ffmCheckTrialEligibility(email) {
  try {
    const emailHash = email ? await ffmSha256(String(email).toLowerCase().trim()) : null;
    const lastUser = await ffmNormalizeLastUser(email);
    const store = await new Promise((res) => { try { chrome.storage.local.get([PERSIST_KEY], res); } catch (e) { res({}); } });
    const persist = store && store[PERSIST_KEY] ? store[PERSIST_KEY] : null;

    if (persist && lastUser && emailHash && lastUser !== emailHash) {
      return { allowed: false, reason: 'device_reuse' };
    }
    return { allowed: true };
  } catch (e) { return { allowed: true }; }
}

export async function ffmMarkTrialUsed(email) {
  try {
    if (!email) return false;
    const emailHash = await ffmSha256(String(email).toLowerCase().trim());
    if (!emailHash) return false;
    await new Promise((res) => { try { chrome.storage.local.set({ [FFM_LAST_USER]: emailHash }, () => res(true)); } catch (e) { res(true); } });
    return true;
  } catch (e) { return false; }
}

// Multi-user lock helpers
export async function ffmIsMultiUserLocked() {
  try {
    const s = await new Promise((res) => { try { chrome.storage.local.get(['ffm_multi_user_locked'], res); } catch (e) { res({}); } });
    return !!(s && s.ffm_multi_user_locked);
  } catch (e) { return false; }
}

export async function ffmSetMultiUserLocked(val) {
  try { await new Promise((res) => { try { chrome.storage.local.set({ ffm_multi_user_locked: !!val }, () => res(true)); } catch (e) { res(true); } }); } catch (e) {}
}

// Safely set the last-user hash only when not locked or when matching existing.
export async function ffmTrySetLastUserHash(hash) {
  try {
    if (!hash) return false;
    const canonical = FFM_LAST_USER;
    const legacyKey = 'fast4mp_last_user';
    const store = await new Promise((res) => { try { chrome.storage.local.get([canonical, 'ffm_multi_user_locked'], res); } catch (e) { res({}); } });
    const existing = store && store[canonical] ? store[canonical] : null;
    const locked = !!(store && store.ffm_multi_user_locked);

    if (existing && existing !== hash) {
      // existing different -> mark locked and do not overwrite
      await ffmSetMultiUserLocked(true);
      return false;
    }

    // Not existing or same: write canonical and legacy copies and clear lock
    await new Promise((res) => { try { chrome.storage.local.set({ [canonical]: hash, [legacyKey]: hash, ffm_multi_user_locked: false }, () => res(true)); } catch (e) { res(true); } });
    try { if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem(legacyKey, hash); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

/**
 * Protects the persist key from accidental deletion.
 * Re-hydrates it if wiped by cleanup logic.
 */
export async function ffmEnsurePersistIntegrity() {
  try {
    const stored = await chrome.storage.local.get(PERSIST_KEY);
    if (!stored || !stored[PERSIST_KEY]) {
      const id = crypto.randomUUID();
      await chrome.storage.local.set({ [PERSIST_KEY]: id });
      try { console.warn('[AutoList Pro] Persist ID was missing — regenerated'); } catch (e) {}
    }
  } catch (e) {
    try { console.warn('[AutoList Pro] ffmEnsurePersistIntegrity failed', e); } catch (er) {}
  }
}

export function ffmFilterProtectedKeys(keys) {
  if (!keys) return keys;
  const arr = Array.isArray(keys) ? keys.slice() : [keys];
  return arr.filter(k => k !== PERSIST_KEY);
}

/**
 * Safe remove that never deletes the persist key.
 * Returns a Promise that resolves when removal completes.
 */
export function ffmSafeRemove(keys, cb) {
  const filtered = ffmFilterProtectedKeys(keys);
  return new Promise((resolve) => {
    try {
      if (!filtered || filtered.length === 0) {
        if (typeof cb === 'function') cb();
        return resolve(true);
      }
      chrome.storage.local.remove(filtered, (...args) => {
        try { if (typeof cb === 'function') cb(...args); } catch (e) {}
        resolve(true);
      });
    } catch (e) {
      try { if (typeof cb === 'function') cb(e); } catch (er) {}
      resolve(false);
    }
  });
}
