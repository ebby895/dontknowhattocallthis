// mediaDB.js
// Shared AutoList Pro media DB helper for popup + background (MV3 safe)

(() => {
  const DB_NAME = 'AutoListProMediaDB';
  // Legacy database name some older cloud-restore/import paths wrote photo blobs
  // into (before this codebase was renamed from Fast4MP-live). Read-only fallback
  // only — never written to — so listings whose media landed there via an older
  // tool aren't invisible to this extension's own media lookups.
  const FALLBACK_DB_NAME = 'Fast4MPMediaDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'media';

  const root = (typeof self !== 'undefined') ? self : window;

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('by_listingName', 'listingName', { unique: false });
          store.createIndex('by_type', 'type', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        console.warn('[AutoListProMediaDB] Upgrade blocked (another tab still open?)');
      };
    });
  }

  // Internal helper to run a transaction
  async function withStore(mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);

      let result;
      try {
        result = fn(store);
      } catch (err) {
        reject(err);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  // Whether the legacy fallback DB exists in this browser profile at all — checked
  // before every fallback attempt so we never *create* an empty Fast4MPMediaDB for
  // profiles that never had one (indexedDB.open() would otherwise do that as a
  // side effect just by being called).
  async function fallbackDbExists() {
    try {
      if (!indexedDB.databases) return false;
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d && d.name === FALLBACK_DB_NAME);
    } catch (e) { return false; }
  }

  // Same shape as withStore(), but against the read-only legacy fallback DB.
  // Resolves undefined (not an error) if the DB/store doesn't exist.
  async function withFallbackStore(mode, fn) {
    if (!(await fallbackDbExists())) return undefined;
    return new Promise((resolve) => {
      let request;
      try { request = indexedDB.open(FALLBACK_DB_NAME); } catch (e) { resolve(undefined); return; }
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains(STORE_NAME)) { try { db.close(); } catch (e) {} resolve(undefined); return; }
          const tx = db.transaction(STORE_NAME, mode);
          const store = tx.objectStore(STORE_NAME);
          let result;
          try { result = fn(store); } catch (err) { resolve(undefined); return; }
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
      };
      request.onerror = () => resolve(undefined);
    });
  }

  // Utility: derive listingName from key if caller doesn't pass it
  function inferListingNameFromKey(key) {
    // "listings/<listingName>/image_0.jpg"
    const parts = key.split('/');
    if (parts.length >= 3) {
      if (parts[0] === 'listings') {
        // listingName may contain slashes if user is wild, but in our design
        // it's just everything between first and last segment
        return parts.slice(1, parts.length - 1).join('/');
      }
      // New ID-first layout: users/<uid>/listings/<listingName>/...
      if (parts[0] === 'users' && parts[2] === 'listings' && parts.length >= 4) {
        return parts.slice(3, parts.length - 1).join('/');
      }
    }
    return null;
  }

  // ---- Public API ----

  /**
   * Put a blob into the DB with a fully-specified key.
   * @param {Object} options
   * @param {string} options.key          S3-style key: "listings/Name/image_0.jpg"
   * @param {"image"|"video"} options.type
   * @param {number} options.index        0-based media index
   * @param {Blob} options.blob
   * @param {string} [options.mimeType]
   * @param {string} [options.listingName]
   */
  // putBlob supports two call styles for backward compatibility:
  // 1) putBlob(options) where options = { key, type, index, blob, mimeType, listingName }
  // 2) putBlob(listingName, mediaType, index, blob, mimeType, filename) (legacy positional)
  async function putBlob() {
    let options;
    if (arguments.length === 1 && typeof arguments[0] === 'object') {
      options = arguments[0];
    } else {
      const [listingName, mediaType, index, blob, mimeType, filename] = arguments;
      if (!listingName || !mediaType || !blob) {
        throw new Error('[AutoListProMediaDB] putBlob(positional) requires listingName, mediaType, blob');
      }

      let ext = mediaType === 'image' ? 'jpg' : 'mp4';
      if (mimeType) {
        if (mimeType === 'image/png') ext = 'png';
        else if (mimeType === 'image/webp') ext = 'webp';
        else if (mimeType === 'video/webm') ext = 'webm';
      }

      const safeIndex = (typeof index === 'number') ? index : 0;
      const name = filename || `${mediaType}_${safeIndex}.${ext}`;
      const key = `listings/${listingName}/${name}`;

      options = {
        key,
        type: mediaType,
        index: safeIndex,
        blob,
        mimeType: mimeType || (blob && blob.type) || '',
        listingName
      };
    }

    const { key, type, index, blob } = options;
    let { mimeType, listingName } = options;

    if (!key || !blob || !type) {
      throw new Error('[AutoListProMediaDB] putBlob requires key, type, blob');
    }

    if (typeof index !== 'number') {
      console.warn('[AutoListProMediaDB] putBlob: index missing, defaulting to 0 for', key);
    }

    if (!mimeType && blob.type) {
      mimeType = blob.type;
    }
    if (!listingName) {
      listingName = inferListingNameFromKey(key) || '';
    }

    const record = {
      key,
      blob,
      type,
      index: (typeof index === 'number') ? index : 0,
      mimeType: mimeType || '',
      listingName
    };

    return withStore('readwrite', (store) => {
      store.put(record);
    });
  }

  // Convert a data: URL or a blob: URL or remote URL into a Blob.
  // Accepts either a data URL string, a blob: URL, or any fetchable URL.
  async function dataUrlToBlob(dataUrl) {
    if (!dataUrl) return null;

    // If it's a data URL (base64), decode it
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      try {
        const parts = dataUrl.split(',');
        const meta = parts[0];
        const isBase64 = meta.indexOf(';base64') !== -1;
        const mime = meta.split(':')[1].split(';')[0];
        const raw = parts[1] || '';
        if (isBase64) {
          const byteString = atob(raw);
          const ia = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
          return new Blob([ia], { type: mime || 'application/octet-stream' });
        } else {
          // percent-encoded
          const decoded = decodeURIComponent(raw);
          return new Blob([decoded], { type: mime || 'application/octet-stream' });
        }
      } catch (e) {
        console.warn('[AutoListProMediaDB] dataUrlToBlob decode failed', e);
        return null;
      }
    }

    // If it's a blob: URL or any other URL, try fetching it
    try {
      const resp = await fetch(dataUrl);
      if (!resp || !resp.ok) {
        console.warn('[AutoListProMediaDB] dataUrlToBlob fetch failed', dataUrl, resp && resp.status);
        return null;
      }
      const blob = await resp.blob();
      return blob;
    } catch (e) {
      console.warn('[AutoListProMediaDB] dataUrlToBlob fetch error', e);
      return null;
    }
  }

  /**
   * Convenience: generate a typical key and store blob.
   * Example: ("DreamCloud Premier", "image", 0, blob, "image/jpeg")
   * -> key = "listings/DreamCloud Premier/image_0.jpg"
   */
  async function putListingBlob(listingName, mediaType, index, blob, mimeType) {
    if (!listingName) {
      throw new Error('[AutoListProMediaDB] putListingBlob requires listingName');
    }
    if (mediaType !== 'image' && mediaType !== 'video') {
      throw new Error('[AutoListProMediaDB] mediaType must be "image" or "video"');
    }

    const safeIndex = (typeof index === 'number') ? index : 0;

    // Derive an extension from mimeType, defaulting to jpg/mp4
    let ext = mediaType === 'image' ? 'jpg' : 'mp4';
    if (mimeType) {
      if (mimeType === 'image/png') ext = 'png';
      else if (mimeType === 'image/webp') ext = 'webp';
      else if (mimeType === 'video/webm') ext = 'webm';
      // otherwise keep defaults
    }

    // Require active user context for user-scoped keys
    const uid = (typeof window !== 'undefined' && window.ffmActiveUserId) ? window.ffmActiveUserId : null;
    if (!uid) throw new Error('[AutoListProMediaDB] Attempted to create listing blob without active user');
    const key = `users/${uid}/listings/${listingName}/${mediaType}_${safeIndex}.${ext}`;

    await putBlob({
      key,
      type: mediaType,
      index: safeIndex,
      blob,
      mimeType,
      listingName
    });

    // IMPORTANT: return the generated key so callers can store localImageKeys/localVideoKeys
    return key;
  }

  /**
   * Get a single record by key.
   */
  async function getByKey(key) {
    // Defensive: calling IDB get with a falsy/undefined key throws a DataError
    // in some browsers. Return null early for falsy keys to avoid that.
    if (!key && key !== 0) return null;

    const primary = await withStore('readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
    if (primary) return primary;

    // Not in this extension's own DB — check the legacy fallback DB before
    // giving up (see FALLBACK_DB_NAME comment above).
    try {
      const fallback = await withFallbackStore('readonly', (store) => {
        return new Promise((resolve) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      });
      if (fallback) return fallback;
    } catch (e) {}
    return null;
  }

  /**
   * Alias/compat: get a single record by key (returns record with blob)
   * Kept as a small helper for popup code that expects `getBlob`.
   */
  async function getBlob(key) {
    return getByKey(key);
  }

  /**
   * Get media records for a listing name, split into images/videos.
   * Returns: { images: [{...}], videos: [{...}] }
   */
  // Fallback-DB cursor scan (no index assumed — the legacy DB's schema isn't
  // guaranteed to have the same indexes, just the same record shape).
  function scanForListingMedia(store, listingName) {
    return new Promise((resolve) => {
      const images = [];
      const videos = [];
      const req = store.openCursor();
      req.onerror = () => resolve({ images, videos });
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          images.sort((a, b) => a.index - b.index);
          videos.sort((a, b) => a.index - b.index);
          resolve({ images, videos });
          return;
        }
        try {
          const record = cursor.value;
          const matches = record && (
            record.listingName === listingName ||
            (typeof record.key === 'string' && record.key.indexOf(`/listings/${listingName}/`) !== -1)
          );
          if (matches) {
            if (record.type === 'image') images.push(record);
            else if (record.type === 'video') videos.push(record);
          }
        } catch (e) {}
        cursor.continue();
      };
    });
  }

  async function getBlobsForListing(listingName) {
    if (!listingName) {
      throw new Error('[AutoListProMediaDB] getBlobsForListing requires listingName');
    }

    const primary = await withStore('readonly', (store) => {
      const index = store.index('by_listingName');
      const range = IDBKeyRange.only(listingName);

      return new Promise((resolve, reject) => {
        const images = [];
        const videos = [];

        const req = index.openCursor(range);
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) {
            // Sort by index to keep order stable
            images.sort((a, b) => a.index - b.index);
            videos.sort((a, b) => a.index - b.index);

            resolve({ images, videos });
            return;
          }

          const record = cursor.value;
          if (record.type === 'image') images.push(record);
          else if (record.type === 'video') videos.push(record);

          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });

    if (primary && (primary.images.length || primary.videos.length)) return primary;

    // Nothing in this extension's own DB — check the legacy fallback DB.
    try {
      const fallback = await withFallbackStore('readonly', (store) => scanForListingMedia(store, listingName));
      if (fallback && (fallback.images.length || fallback.videos.length)) return fallback;
    } catch (e) {}
    return primary || { images: [], videos: [] };
  }

  /**
   * Get media records for a user-scoped listing (users/<uid>/listings/<listingId>/...)
   * Returns { images: [...], videos: [...] }
   */
  function scanForPrefix(store, prefix) {
    return new Promise((resolve, reject) => {
      const images = [];
      const videos = [];

      const req = store.openCursor();
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) {
          images.sort((a, b) => a.index - b.index);
          videos.sort((a, b) => a.index - b.index);
          resolve({ images, videos });
          return;
        }

        const record = cursor.value;
        try {
          if (record && typeof record.key === 'string' && record.key.startsWith(prefix)) {
            if (record.type === 'image') images.push(record);
            else if (record.type === 'video') videos.push(record);
          }
        } catch (e) {}

        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getBlobsForUserListing(uid, listingId) {
    if (!uid) throw new Error('[AutoListProMediaDB] getBlobsForUserListing requires uid');
    if (!listingId) throw new Error('[AutoListProMediaDB] getBlobsForUserListing requires listingId');

    const prefix = `users/${uid}/listings/${listingId}/`;

    const primary = await withStore('readonly', (store) => scanForPrefix(store, prefix));
    if (primary && (primary.images.length || primary.videos.length)) return primary;

    // Not in this extension's own DB — check the legacy fallback DB with the same prefix.
    try {
      const fallback = await withFallbackStore('readonly', (store) => scanForPrefix(store, prefix));
      if (fallback && (fallback.images.length || fallback.videos.length)) return fallback;
    } catch (e) {}
    return primary || { images: [], videos: [] };
  }

  /**
   * Get records for multiple keys at once.
   * Returns an array (same order as keys; missing keys -> null).
   */
  async function getByKeys(keys) {
    if (!Array.isArray(keys)) {
      throw new Error('[AutoListProMediaDB] getByKeys requires array of keys');
    }

    return withStore('readonly', (store) => {
      // Defensive: skip falsy keys (undefined/null/empty) to avoid IDB DataError
      return Promise.all(
        keys.map((key) => new Promise((resolve, reject) => {
          if (!key && key !== 0) return resolve(null);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        }))
      );
    });
  }

  /**
   * Delete all media for a given listingName.
   * Used if a Saved Listing is permanently removed.
   */
  async function deleteListingMedia(listingName) {
    if (!listingName) {
      throw new Error('[AutoListProMediaDB] deleteListingMedia requires listingName');
    }

    return withStore('readwrite', (store) => {
      const index = store.index('by_listingName');
      const range = IDBKeyRange.only(listingName);

      return new Promise((resolve, reject) => {
        const req = index.openCursor(range);
        req.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) {
            resolve();
            return;
          }
          cursor.delete();
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  /**
   * Simple debug summary: how many images/videos for a listing.
   * Returns { listingName, imageCount, videoCount }
   */
  async function getListingSummary(listingName) {
    const { images, videos } = await getBlobsForListing(listingName);
    return {
      listingName,
      imageCount: images.length,
      videoCount: videos.length
    };
  }

  /**
   * For manual maintenance: wipe everything (use with care).
   */
  async function clearAll() {
    return withStore('readwrite', (store) => {
      store.clear();
    });
  }

  /**
   * Get all records in the DB. Returns an array of all stored records.
   */
  async function getAll() {
    return withStore('readonly', (store) => {
      return new Promise((resolve, reject) => {
        const arr = [];
        const req = store.openCursor();
        req.onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return resolve(arr);
          arr.push(c.value);
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  /**
   * Repair broken records: remove any records that do not contain a usable blob.
   * Returns an object { removedCount }.
   */
  async function repairBrokenRecords() {
    return withStore('readwrite', (store) => {
      return new Promise((resolve, reject) => {
        let removed = 0;
        const req = store.openCursor();
        req.onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return resolve({ removedCount: removed });
          try {
            const rec = c.value;
            const blob = rec && rec.blob;
            const isBad = !blob || (typeof blob.size === 'number' && blob.size === 0);
            if (isBad) {
              try { c.delete(); } catch (e) {}
              removed++;
            }
          } catch (e) {
            try { c.delete(); } catch (e) {}
            removed++;
          }
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  /**
   * Vacuum: remove any media records that are not referenced by the provided
   * `activeListingNames` array. Returns { removedCount }.
   */
  async function vacuum(activeListingNames) {
    const activeSet = new Set(Array.isArray(activeListingNames) ? activeListingNames.filter(Boolean) : []);
    return withStore('readwrite', (store) => {
      return new Promise((resolve, reject) => {
        let removed = 0;
        const req = store.openCursor();
        req.onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return resolve({ removedCount: removed });
          try {
            const rec = c.value;
            const listingName = rec && rec.listingName;
            if (!listingName || !activeSet.has(listingName)) {
              try { c.delete(); } catch (e) {}
              removed++;
            }
          } catch (e) {
            try { c.delete(); } catch (e) {}
            removed++;
          }
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  /**
   * Convenience: run repairBrokenRecords followed by vacuum(activeListingNames).
   * Returns an object { repaired: { removedCount }, vacuumed: { removedCount } }.
   */
  async function autoClean(activeListingNames) {
    const repaired = await repairBrokenRecords();
    const vacuumed = await vacuum(activeListingNames);
    return { repaired, vacuumed };
  }

  /**
   * Cleanup one listing: remove broken/zero-length blobs for a specific listingName.
   * Returns { removedCount }.
   */
  async function cleanupOneListing(listingName) {
    if (!listingName) return { removedCount: 0, error: 'missing_listingName' };
    return withStore('readwrite', (store) => {
      const idx = store.index('by_listingName');
      const range = IDBKeyRange.only(listingName);
      return new Promise((resolve, reject) => {
        let removed = 0;
        const req = idx.openCursor(range);
        req.onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return resolve({ removedCount: removed });
          try {
            const rec = c.value;
            const blob = rec && rec.blob;
            const isBad = !blob || (typeof blob.size === 'number' && blob.size === 0);
            if (isBad) {
              try { c.delete(); } catch (e) {}
              removed++;
            }
          } catch (e) {
            try { c.delete(); } catch (e) {}
            removed++;
          }
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  /**
   * Delete a single media record by its full key.
   * @param {string} key
   */
  async function deleteMediaByKey(key) {
    if (!key) return;
    return withStore('readwrite', (store) => {
      try {
        store.delete(key);
      } catch (e) {}
    });
  }

  // Backwards-compatible alias
  async function deleteMedia(key) {
    return deleteMediaByKey(key);
  }

  /**
   * Delete a media record by its internal `id` property (if present).
   * This scans the store and deletes the first matching record with `rec.id === id`.
   */
  async function deleteMediaById(id) {
    if (!id) return;
    return withStore('readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.openCursor();
        req.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return resolve();
          try {
            const rec = cursor.value;
            if (rec && rec.id && String(rec.id) === String(id)) {
              try { cursor.delete(); } catch (e) {}
              return resolve();
            }
          } catch (e) {}
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  /**
   * Return an array of File objects (reconstructed) for a listingName.
   * This is async because it reads blobs and converts to ArrayBuffers.
   */
  async function getFilesForListing(listingName) {
    if (!listingName) return [];
    try {
      const blobs = await getBlobsForListing(listingName);
      const images = Array.isArray(blobs.images) ? blobs.images : [];
      const files = [];
      for (const rec of images) {
        try {
          const maybeBlob = rec && (rec.blob || rec.data || rec.buffer) || null;
          if (!maybeBlob) continue;
          let ab;
          if (maybeBlob instanceof ArrayBuffer) ab = maybeBlob;
          else if (typeof maybeBlob.arrayBuffer === 'function') ab = await maybeBlob.arrayBuffer();
          else continue;
          const uint = new Uint8Array(ab);
          const name = rec.name || rec.filename || (rec.key && String(rec.key).split('/').pop()) || 'image.jpg';
          const mime = rec.mimeType || rec.type || (maybeBlob && maybeBlob.type) || 'image/jpeg';
          const file = new File([uint], name, { type: mime });
          files.push(file);
        } catch (e) {
          // skip problematic record
        }
      }
      return files;
    } catch (e) { return []; }
  }

  /**
   * Return the FIRST image blob for a listing (used for thumbnails)
   * Accepts either a plain listingName/listingId or a user-scoped listingId.
   * Read-only: iterates the store and resolves the first matching image blob.
   */
  function scanForFirstImage(store, listingId) {
    return new Promise((resolve) => {
      const req = store.openCursor();
      req.onerror = () => resolve(null);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return resolve(null);

        try {
          const rec = cursor.value;
          if (!rec) { cursor.continue(); return; }

          // Match by listingName field when present
          if (rec.listingName && rec.listingName === listingId && rec.type === 'image' && rec.blob) {
            return resolve(rec.blob);
          }

          // Or match by key pattern (supports users/<uid>/listings/<listingId>/...)
          if (rec.key && typeof rec.key === 'string' && rec.key.indexOf(`/listings/${listingId}/`) !== -1 && rec.type === 'image' && rec.blob) {
            return resolve(rec.blob);
          }
        } catch (e) {
          // ignore per-record errors
        }

        cursor.continue();
      };
    });
  }

  async function getFirstImageForListing(listingId) {
    if (!listingId) return null;

    const primary = await withStore('readonly', (store) => scanForFirstImage(store, listingId));
    if (primary) return primary;

    // Not in this extension's own DB — check the legacy fallback DB.
    try {
      const fallback = await withFallbackStore('readonly', (store) => scanForFirstImage(store, listingId));
      if (fallback) return fallback;
    } catch (e) {}
    return null;
  }

  /**
   * Compatibility wrapper: accept a plain record object (possibly from popup)
   * and write it into the DB. The record may contain `blob`, `buffer`, `data`
   * (ArrayBuffer/Uint8Array), `mimeType`, `key`, `type`, `index`, `listingName`.
   * Returns the stored key on success.
   */
  async function putRecord(rec) {
    if (!rec || typeof rec !== 'object') throw new Error('[AutoListProMediaDB] putRecord requires an object');

    let { key, type, index, blob, buffer, data, mimeType, listingName } = rec;

    // If we have raw ArrayBuffer/Uint8Array, wrap into a Blob
    try {
      if (!blob) {
        if (buffer && (buffer instanceof ArrayBuffer)) {
          blob = new Blob([buffer], { type: mimeType || '' });
        } else if (data && (data instanceof Uint8Array)) {
          blob = new Blob([data.buffer || data], { type: mimeType || '' });
        } else if (data && data.buffer && data.buffer instanceof ArrayBuffer) {
          blob = new Blob([data.buffer], { type: mimeType || '' });
        }
      }
    } catch (e) {
      // ignore and fallback to requiring a blob below
    }

    // If listingName missing, try to infer from key
    if (!listingName) listingName = key ? inferListingNameFromKey(key) : '';

    // If key not provided, construct a reasonable key using listingName
    if (!key) {
      const safeIndex = (typeof index === 'number') ? index : 0;
      const ext = (mimeType && mimeType.indexOf('png') !== -1) ? 'png' : (mimeType && mimeType.indexOf('webp') !== -1 ? 'webp' : (type === 'video' ? 'mp4' : 'jpg'));
      const filename = (rec.filename || `${type || 'image'}_${safeIndex}.${ext}`);
      const uid = (typeof window !== 'undefined' && window.ffmActiveUserId) ? window.ffmActiveUserId : null;
      if (!uid) throw new Error('[AutoListProMediaDB] Attempted to create media key without active user');
      if (listingName) key = `users/${uid}/listings/${listingName}/${filename}`;
      else key = `users/${uid}/listings/unknown/${filename}`;
    }

    if (!blob) {
      throw new Error('[AutoListProMediaDB] putRecord: no blob/buffer/data provided');
    }

    // Normalize fields and delegate to putBlob
    return putBlob({ key, type: type || 'image', index: (typeof index === 'number') ? index : 0, blob, mimeType: mimeType || (blob && blob.type) || '', listingName: listingName || '' });
  }

  // Export API
  const api = {
    openDB,
    putBlob,
    dataUrlToBlob,
    putListingBlob,
    getByKey,
    getByKeys,
    getBlobsForListing,
    getBlobsForUserListing,
    getBlob,
    deleteMediaByKey,
    deleteMediaById,
    deleteMedia,
    deleteListingMedia,
    getListingSummary,
    clearAll,
    // Maintenance helpers
    getAll,
    repairBrokenRecords,
    vacuum,
    autoClean,
    // Single-listing helpers (used by content scripts)
    cleanupOneListing,
      getFilesForListing,
      // Return first image blob for a listing id/name
      getFirstImageForListing,
      // Compatibility write helper
      putRecord
  };

  root.ffmMediaDB = api;

  // Better visibility: where is mediaDB running?
  try {
    let scope = 'unknown';
    if (typeof ServiceWorkerGlobalScope !== 'undefined' && root instanceof ServiceWorkerGlobalScope) {
      scope = 'background-sw';
    } else if (typeof Window !== 'undefined' && root instanceof Window) {
      scope = 'window';
    } else {
      scope = Object.prototype.toString.call(root);
    }

    let url = '(no location)';
    try {
      if (typeof location !== 'undefined' && location && location.href) {
        url = location.href;
      }
    } catch (_) {}

    console.log('[AutoListProMediaDB] mediaDB.js loaded', { scope, url });
  } catch (e) {
    console.log('[AutoListProMediaDB] mediaDB.js loaded (log error)', String(e));
  }
})();
