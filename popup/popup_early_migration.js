// Early migration module: normalize legacy fast4mp_last_user from localStorage and chrome.storage
(async function(){
  try {
    const legacyKey = 'fast4mp_last_user';
    const canonKey = 'fast4mp_last_user_hash';
    let legacy = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
        legacy = window.localStorage.getItem(legacyKey) || null;
      }
    } catch(e) { legacy = null; }

    try {
      const stored = await new Promise((res) => { try { chrome.storage.local.get([legacyKey, canonKey], res); } catch(e){ res({}); } });
      if (!legacy && stored && stored[legacyKey]) legacy = stored[legacyKey];
      if (!legacy && stored && stored[canonKey]) legacy = stored[canonKey];
    } catch(e){}

    if (!legacy) return;

    if (typeof legacy === 'string' && legacy.includes('@')) {
      try {
        const enc = new TextEncoder().encode(legacy.toLowerCase().trim());
        const buf = await crypto.subtle.digest('SHA-256', enc);
        const hashed = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
        if (hashed) {
          try { chrome.storage.local.set({ [legacyKey]: hashed, [canonKey]: hashed }); } catch(e){}
          try { if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') window.localStorage.setItem(legacyKey, hashed); } catch(e){}
          try { console.log('[FFM] Early migration applied (external module)'); } catch(e){}
        }
      } catch(e){}
    }
  } catch(e){}
})();

export default {};
