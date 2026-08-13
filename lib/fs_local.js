// AutoList Pro — local folder export (File System Access API)
// Mirrors every saved listing (metadata + photos + videos) to a real folder
// on disk (C:\Users\<you>\AutoList_Data by default), independent of Chrome's
// internal storage. Ported from the same proven module used by Facebook-MP
// (lib/fs_local.js there) — same handle-persistence and write pattern.
(function () {
  const NS = (window.AutoListLocal = window.AutoListLocal || {});
  const DB = 'autolistprofs', STORE = 'handles';
  NS.FOLDER_NAME = 'AutoList_Data';

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function saveHandle(h, key = 'root') { const db = await idb(); db.transaction(STORE, 'readwrite').objectStore(STORE).put(h, key); }
  async function loadHandle(key = 'root') {
    const db = await idb();
    return new Promise((res) => { const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
  }
  NS.clearFolder = async function () { const db = await idb(); db.transaction(STORE, 'readwrite').objectStore(STORE).delete('root'); };

  async function ensurePermission(handle) {
    const opts = { mode: 'readwrite' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  // Opens a picker (must be called from a user gesture, e.g. a button click).
  // Starts in Documents; if the user picks the AutoList_Data folder directly,
  // use it as-is, otherwise create/open an AutoList_Data subfolder inside
  // whatever they picked.
  NS.chooseFolder = async function () {
    const picked = await window.showDirectoryPicker({ id: 'autolist_pro_data', mode: 'readwrite' });
    const root = picked.name === NS.FOLDER_NAME ? picked : await picked.getDirectoryHandle(NS.FOLDER_NAME, { create: true });
    await saveHandle(root);
    return root;
  };

  NS.getFolder = async function () {
    const root = await loadHandle();
    if (root && await ensurePermission(root)) return root;
    return null;
  };

  // Checks permission WITHOUT prompting — safe on page load. Use this to
  // decide whether to show "Choose folder" vs "Connected" in the UI.
  NS.getFolderQuiet = async function () {
    const handle = await loadHandle();
    if (!handle) return { handle: null, granted: false };
    const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    return { handle, granted };
  };

  async function writeFile(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }
  function dataUrlToBlob(dataUrl) {
    const [head, b64] = String(dataUrl).split(',');
    const mime = (head.match(/data:(.+?);/) || [])[1] || 'image/jpeg';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  async function toBlob(src) {
    if (src instanceof Blob) return src;
    if (!src || typeof src !== 'string') return null;
    if (src.indexOf('data:') === 0) return dataUrlToBlob(src);
    if (src.indexOf('blob:') === 0) { try { const r = await fetch(src); return await r.blob(); } catch (e) { return null; } }
    return null;
  }
  function extFromBlob(blob, fallback) {
    const t = (blob && blob.type) || '';
    if (t.indexOf('png') !== -1) return 'png';
    if (t.indexOf('webp') !== -1) return 'webp';
    if (t.indexOf('mp4') !== -1) return 'mp4';
    if (t.indexOf('webm') !== -1) return 'webm';
    if (t.indexOf('quicktime') !== -1) return 'mov';
    return fallback;
  }
  function slugify(s) {
    const slug = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return slug || 'listing';
  }
  NS.folderNameFor = function (listing) {
    const id = (listing && (listing.listingId || listing.id)) || 'unsaved';
    return slugify(listing && (listing.inventoryName || listing.title)) + '_' + String(id);
  };

  // Writes one listing's metadata (JSON, no image/video data — those go to
  // their own files) plus every photo/video, into its own subfolder.
  NS.writeListing = async function (listing) {
    const root = await NS.getFolder();
    if (!root) throw new Error('No local folder selected.');
    const dir = await root.getDirectoryHandle(NS.folderNameFor(listing), { create: true });

    const meta = Object.assign({}, listing);
    delete meta.images;
    delete meta.videos;
    meta.exportedAt = new Date().toISOString();
    await writeFile(dir, 'listing.json', JSON.stringify(meta, null, 2));

    const images = Array.isArray(listing.images) ? listing.images : [];
    for (let i = 0; i < images.length; i++) {
      const blob = await toBlob(images[i]);
      if (!blob) continue;
      await writeFile(dir, `photo_${i + 1}.${extFromBlob(blob, 'jpg')}`, blob);
    }

    const videos = Array.isArray(listing.videos) ? listing.videos : [];
    for (let i = 0; i < videos.length; i++) {
      const blob = await toBlob(videos[i]);
      if (!blob) continue;
      await writeFile(dir, `video_${i + 1}.${extFromBlob(blob, 'mp4')}`, blob);
    }

    return true;
  };

  // Re-opens the folder just written to and confirms listing.json is
  // actually there — a write() that didn't throw isn't proof it landed.
  NS.verifyListingWritten = async function (listing) {
    try {
      const root = await NS.getFolder();
      if (!root) return false;
      const dir = await root.getDirectoryHandle(NS.folderNameFor(listing), { create: false });
      await dir.getFileHandle('listing.json', { create: false });
      return true;
    } catch (e) { return false; }
  };

  function extFromName(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function mimeFromExt(ext) {
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
    return map[ext] || (ext ? 'application/octet-stream' : '');
  }

  // Appends plain-text lines to activity_log.txt at the root of the chosen
  // folder (not inside a per-listing subfolder) — a simple, readable record
  // of what the extension has done (exports, relists, etc.) for users who
  // want to double-check without opening the extension. File System Access
  // API has no native append mode, so this reads the existing text first.
  NS.appendLogLines = async function (lines) {
    const root = await NS.getFolder();
    if (!root) throw new Error('No local folder selected.');
    let existing = '';
    try {
      const fh = await root.getFileHandle('activity_log.txt', { create: false });
      const file = await fh.getFile();
      existing = await file.text();
    } catch (e) { /* file doesn't exist yet — start fresh */ }
    const addition = (Array.isArray(lines) ? lines.join('\n') : String(lines)) + '\n';
    await writeFile(root, 'activity_log.txt', existing + addition);
  };

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // Retries a flaky FS Access API call a couple of times before giving up —
  // covers a file that was just written moments earlier (e.g. an
  // antivirus/indexer scan) throwing transiently for a few hundred ms.
  // NOTE: a long/exponential backoff here was tried and measured to make
  // zero difference for genuinely-failing folders (they fail identically on
  // the very first attempt every time) while adding ~11 minutes to a real
  // 119-listing import — so this stays short. A folder that fails, fails
  // instantly; waiting longer does not change that.
  async function withRetry(fn, attempts = 2, baseDelayMs = 200) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (e) { lastErr = e; if (i < attempts - 1) await sleep(baseDelayMs * Math.pow(2, i)); }
    }
    throw lastErr;
  }

  async function readMediaEntries(handle) {
    const images = [];
    const videos = [];
    for await (const [fname, fhandle] of handle.entries()) {
      if (fhandle.kind !== 'file') continue;
      const m = /^(photo|video)_(\d+)\./i.exec(fname);
      if (!m) continue;
      const ext = extFromName(fname);
      let file;
      try {
        file = await withRetry(() => fhandle.getFile());
      } catch (e) {
        console.warn('[AutoList Pro] readAllListings: could not read "' + fname + '" — ' + (e && e.name) + ': ' + (e && e.message), e);
        continue;
      }
      const entry = { index: Number(m[2]) - 1, blob: file, mimeType: file.type || mimeFromExt(ext) };
      if (m[1].toLowerCase() === 'photo') images.push(entry); else videos.push(entry);
    }
    images.sort((a, b) => a.index - b.index);
    videos.sort((a, b) => a.index - b.index);
    return { images, videos };
  }

  // Reads back every listing previously written by writeListing(): one
  // subfolder per listing, each with listing.json + photo_N.* + video_N.*.
  // Returns [{ listing, images: [{index, blob, mimeType}], videos: [...] }]
  // — does NOT touch chrome.storage or mediaDB, just reads the folder.
  //
  // A folder whose listing.json can't be read (transient FS error, or the
  // file is genuinely missing/corrupt) is no longer dropped outright: if it
  // still has photo_N/video_N files, those are recovered under a stub
  // listing (flagged `_importRecovered: true`) so the media isn't silently
  // lost — only a folder with neither a readable listing.json nor any
  // media files is skipped.
  NS.readAllListings = async function () {
    const root = await NS.getFolder();
    if (!root) throw new Error('No local folder selected.');
    const out = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue;
      let listing = null;
      let metaError = null;
      try {
        listing = await withRetry(async () => {
          const metaHandle = await handle.getFileHandle('listing.json', { create: false });
          const metaFile = await metaHandle.getFile();
          return JSON.parse(await metaFile.text());
        });
      } catch (e) {
        metaError = e;
      }

      let images, videos;
      try {
        ({ images, videos } = await readMediaEntries(handle));
      } catch (e) {
        console.warn('[AutoList Pro] readAllListings: skipping folder "' + name + '" — ' + (e && e.name) + ': ' + (e && e.message), e);
        continue;
      }

      if (!listing) {
        if (!images.length && !videos.length) {
          console.warn('[AutoList Pro] readAllListings: skipping folder "' + name + '" — ' + (metaError && metaError.name) + ': ' + (metaError && metaError.message), metaError);
          continue;
        }
        console.warn('[AutoList Pro] readAllListings: "' + name + '" has no readable listing.json (' + (metaError && metaError.name) + ': ' + (metaError && metaError.message) + ') — recovering ' + images.length + ' photo(s)/' + videos.length + ' video(s) under a stub listing.', metaError);
        listing = { id: name, inventoryName: name, title: name, _importRecovered: true, _importError: (metaError && metaError.name) + ': ' + (metaError && metaError.message) };
      }

      out.push({ listing, images, videos });
    }
    return out;
  };
})();
