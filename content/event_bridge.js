console.log("[AutoList Pro] event_bridge.js loaded");

// Page-scoped getter: read media records from AutoListProMediaDB and return File[] for a listing
// Usage: window.ffmGetListingFiles(listingNameOrId) => Promise<File[]>
window.ffmGetListingFiles = function (listingNameOrId) {
	return new Promise((resolve, reject) => {
		try {
			const openReq = indexedDB.open('AutoListProMediaDB');

			openReq.onerror = function (ev) {
				console.warn('[AutoList Pro][MEDIA] IndexedDB open error', ev);
				reject(new Error('indexeddb-open-error'));
			};

			openReq.onsuccess = function (ev) {
				const db = ev.target.result;
				try {
					const tx = db.transaction('media', 'readonly');
					const store = tx.objectStore('media');

					// First try indexed lookup by listingName (fast, correct for current DB shape)
					try {
						if (store.indexNames && store.indexNames.contains && store.indexNames.contains('by_listingName')) {
							const idx = store.index('by_listingName');
							const results = [];
							const range = IDBKeyRange.only(listingNameOrId);
							const cursorReq = idx.openCursor(range);
							cursorReq.onerror = function (e) { console.warn('[AutoList Pro][MEDIA] index cursor error', e); };
							cursorReq.onsuccess = function (e) {
								const cursor = e.target.result;
								if (cursor) {
									results.push(cursor.value);
									cursor.continue();
									return;
								}
								// No more results — process
								results.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
								const files = results.map(function (r, idx) {
									const mime = r.mimeType || r.type || 'application/octet-stream';
									const name = r.filename || r.key || ('media-' + (r.index || idx));
									try { return new File([r.blob], name, { type: mime }); } catch (err) { const blob = r.blob instanceof Blob ? r.blob : new Blob([r.blob], { type: mime }); blob.name = name; return blob; }
								});
								console.log('[AutoList Pro][MEDIA] page getter (by_listingName) found', files.length, 'files for', listingNameOrId);
								return resolve(files);
							};
							return; // we handled via index
						}
					} catch (e) {
						console.warn('[AutoList Pro][MEDIA] by_listingName index lookup failed', e);
					}

					// Fallback: scan all records and match by key prefix (supports listingId lookup)
					const found = [];
					const cursorReq = store.openCursor();
					cursorReq.onerror = function (e) { console.warn('[AutoList Pro][MEDIA] fallback cursor error', e); reject(new Error('cursor-error')); };
					cursorReq.onsuccess = function (e) {
						const cursor = e.target.result;
						if (cursor) {
							const rec = cursor.value;
							try {
								if (rec && rec.key && typeof rec.key === 'string' && rec.key.indexOf('/listings/' + listingNameOrId + '/') !== -1) {
									found.push(rec);
								}
							} catch (err) {}
							cursor.continue();
							return;
						}

						found.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
						const files = found.map(function (r, idx) {
							const mime = r.mimeType || r.type || 'application/octet-stream';
							const name = r.filename || r.key || ('media-' + (r.index || idx));
							try { return new File([r.blob], name, { type: mime }); } catch (err) { const blob = r.blob instanceof Blob ? r.blob : new Blob([r.blob], { type: mime }); blob.name = name; return blob; }
						});
						console.log('[AutoList Pro][MEDIA] page getter (fallback) found', files.length, 'files for', listingNameOrId);
						resolve(files);
					};
				} catch (err) {
					console.error('[AutoList Pro][MEDIA] tx error', err);
					reject(err);
				}
			};
		} catch (err) {
			console.error('[AutoList Pro][MEDIA] unexpected error', err);
			reject(err);
		}
	});
};