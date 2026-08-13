// This runs in PAGE context, not extension world.
(function() {
  let counter = 0;

  window.ffmPageBridge = {
    send(payload) {
      const id = 'msg_' + (++counter);

      window.postMessage({
        source: 'ffm-page',
        id,
        payload
      }, '*');

      return id;
    }
  };

  // Page-world handler: return ArrayBuffer for a DB-stored blob safely
  window.addEventListener('message', async (ev) => {
    try {
      const d = ev && ev.data;
      if (!d || d.__ffm !== 1 || d.type !== 'FFM_GET_BLOB_AB') return;
      const { reqId, key } = d;
      if (!reqId || !key) {
        window.postMessage({ __ffm: 1, type: 'FFM_GET_BLOB_AB_RES', reqId, ok: false, error: 'missing-reqid-or-key' }, '*');
        return;
      }

      try {
        if (!window.ffmMediaDB || typeof window.ffmMediaDB.getBlob !== 'function') throw new Error('ffmMediaDB unavailable');
        const rec = await window.ffmMediaDB.getBlob(key);
        if (!rec) throw new Error('blob not found for key=' + key);
        const blob = rec.blob || rec.data || null;
        if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('record does not contain Blob with arrayBuffer()');
        const ab = await blob.arrayBuffer();

        // Transfer the ArrayBuffer back to the content world
        try {
          window.postMessage({ __ffm: 1, type: 'FFM_GET_BLOB_AB_RES', reqId, ok: true, ab }, '*', [ab]);
        } catch (e) {
          // If transfer list fails, still post without transfer
          window.postMessage({ __ffm: 1, type: 'FFM_GET_BLOB_AB_RES', reqId, ok: true, ab }, '*');
        }
      } catch (err) {
        window.postMessage({ __ffm: 1, type: 'FFM_GET_BLOB_AB_RES', reqId, ok: false, error: String(err) }, '*');
      }
    } catch (e) {}
  });
})();
