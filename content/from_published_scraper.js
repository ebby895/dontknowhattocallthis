(async function initFromPublishedScraper() {
  try {
    console.debug('[AutoList Pro CLFP] from_published_scraper.js loaded');

    // Bail early when running inside an iframe — we only want top-frame injection
    try {
      if (window.top !== window.self) {
        try { console.debug('[AutoList Pro CLFP] Skipping iframe context'); } catch (e) {}
        return;
      }
    } catch (e) {}

    // Idempotent guard: ensure we only init CLFP once per page (Chrome 144 may fire multiple times)
    try {
      if (window.__ffm_clfp_initialized) {
        try { console.debug('[AutoList Pro CLFP] already initialized - skipping'); } catch (e) {}
        return;
      }
      window.__ffm_clfp_initialized = true;
    } catch (e) {}

    // Listen for background activation signal and attempt a reload so CLFP can initialize
    try {
      if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          try {
            if (!msg) return;
            if (msg.type === 'ffm_set_clfp_active' && msg.active) {
              try { console.debug('[AutoList Pro CLFP] received activation signal; reloading to init'); } catch (e) {}
              try { location.reload(); } catch (e) {}
            }
          } catch (e) {}
        });
      }
    } catch (e) {}

    // If this page was opened as a media-collector helper (pubUrl opened with
    // __ffm_media=1), run the media-only scraper and send results to background,
    // then exit. This runs regardless of CLFP_ACTIVE state.
    try {
      const search = (location.search || '') + (location.hash || '');
      if (String(search).indexOf('__ffm_media=1') !== -1) {
        try {
          const mediaTestWithVideo = function() {
            function isVisible(el){ try { return !!(el.offsetWidth||el.offsetHeight||el.getClientRects().length); } catch(e){return false;} }
            function isFb(src){ return /fbcdn\.net|scontent-/.test(src); }
            const imgs = Array.from(document.querySelectorAll('img'))
              .filter(i => (i.currentSrc||i.src||'').startsWith('http') && isVisible(i) && isFb(i.currentSrc||i.src||''))
              .map(i=>({ src: i.currentSrc||i.src||'', alt: i.alt||'', class: i.className||'', w: i.naturalWidth||i.width||0, h: i.naturalHeight||i.height||0 }));
            const canonical = s => { try { const u=new URL(s); return u.origin+u.pathname; } catch(e){ return String(s).split('?')[0]; }};
            const seen=new Set(), uniqueImgs=[];
            for(const im of imgs){ const k=canonical(im.src); if(!seen.has(k)){ seen.add(k); uniqueImgs.push(im); } }

            const vids = [];
            const addVid = (obj) => {
              try {
                if (!obj) return;
                const src = obj.src || obj.currentSrc || (obj.sources && obj.sources[0]) || '';
                if (!src || !src.startsWith('http')) {
                  try { console.debug && console.debug('[media-test][addVid] skip: no-src-or-not-http', src); } catch(e){}
                  return;
                }
                // Exclude obvious non-video fbcdn endpoints (maps, resource icons, thumbnails)
                if (/static_map\.php|\/rsrc\.php/i.test(src)) {
                  try { console.debug && console.debug('[media-test][addVid] skip: non-video-endpoint', src); } catch(e){}
                  return;
                }
                if (/\.(png|jpe?g|svg)(\?|$)/i.test(src)) {
                  try { console.debug && console.debug('[media-test][addVid] skip: image-file', src); } catch(e){}
                  return;
                }
                // prefer fbcdn/scontent or mp4 urls or explicit /video/ paths
                if (!isFb(src) && !/\.mp4(\?|$)/i.test(src) && !/\/video\//i.test(src)) {
                  try { console.debug && console.debug('[media-test][addVid] skip: not-fb-or-mp4-or-videopath', src); } catch(e){}
                  return;
                }
                vids.push({ src: src, poster: obj.poster || '', sources: Array.isArray(obj.sources) ? obj.sources.slice() : (obj.sources ? [obj.sources] : []), w: Number(obj.w) || 0, h: Number(obj.h) || 0 });
              } catch (e) {}
            };

            // 1) native <video> elements — prefer these and return only the first good one
            const nativeVids = [];
            for (const v of Array.from(document.querySelectorAll('video'))) {
              try {
                const src = v.currentSrc || v.src || '';
                const poster = v.poster || '';
                const sources = Array.from(v.querySelectorAll('source')).map(s=>s.src||'').filter(Boolean);
                if (src && src.startsWith('http')) {
                  nativeVids.push({ src, poster, sources, w: v.videoWidth||0, h: v.videoHeight||0 });
                }
              } catch(e){}
            }
            if (nativeVids.length > 0) {
              try { console.debug && console.debug('[media-test] native video elements found', nativeVids.map(v=>v.src)); } catch(e){}
              // Dedupe and prefer the first native video element src
              try {
                const k = (s => { try { const u=new URL(s); return u.origin+u.pathname; } catch(e){ return String(s).split('?')[0]; }})(nativeVids[0].src || '');
                if (k) {
                  // only include the first native video element
                  addVid(nativeVids[0]);
                }
              } catch(e) { addVid(nativeVids[0]); }
            } else {
              // 2) anchors linking directly to mp4 or fbcdn video URLs (fallback)
              try {
                for (const a of Array.from(document.querySelectorAll('a[href]'))) {
                  try {
                    const href = a.href || '';
                    if (!href || !href.startsWith('http')) continue;
                    if (/\.mp4(\?|$)/i.test(href) || isFb(href) || /\/video\//i.test(href)) {
                      // only add visible anchors
                      if (!isVisible(a)) continue;
                      addVid({ src: href, poster: '', sources: [href], w: a.clientWidth||0, h: a.clientHeight||0 });
                    }
                  } catch(e){}
                }
              } catch(e){}

              // 3) background-image URLs on visible elements (fallback)
              try {
                const bgEls = Array.from(document.querySelectorAll('[style]'));
                for (const el of bgEls) {
                  try {
                    if (!isVisible(el)) continue;
                    const cs = window.getComputedStyle(el);
                    const bg = cs && cs.backgroundImage ? cs.backgroundImage : '';
                    if (!bg || bg === 'none') continue;
                    const m = bg.match(/url\(["']?(.*?)["']?\)/);
                    if (m && m[1]) {
                      const url = m[1];
                      if (url && url.startsWith('http') && (isFb(url) || /\.mp4(\?|$)/i.test(url))) {
                        addVid({ src: url, poster: '', sources: [url], w: el.clientWidth||0, h: el.clientHeight||0 });
                      }
                    }
                  } catch(e){}
                }
              } catch(e){}
            }

            // Deduplicate videos by canonical path (origin + pathname)
            const canonicalVid = s => { try { const u=new URL(s); return u.origin+u.pathname; } catch(e){ return String(s).split('?')[0]; }};
            const seenV = new Set();
            const uniqueVids = [];
            for (const v of vids) {
              try {
                const k = canonicalVid(v.src || (v.sources && v.sources[0]) || '');
                if (!k) continue;
                if (!seenV.has(k)) { seenV.add(k); uniqueVids.push(v); }
              } catch(e){}
            }
            try { console.debug && console.debug('[media-test] unique video candidates:', uniqueVids.map(v=>v.src)); } catch(e){}

            // Prefer mp4/fbcdn videos and sort by area descending
            const pref = uniqueVids.filter(v => ( /\.mp4(\?|$)/i.test(v.src) || (v.sources && v.sources.some(s => /\.mp4(\?|$)/i.test(s))) )).sort((a,b) => ((b.w||0)*(b.h||0)) - ((a.w||0)*(a.h||0)));
            const others = uniqueVids.filter(v => !( /\.mp4(\?|$)/i.test(v.src) || (v.sources && v.sources.some(s => /\.mp4(\?|$)/i.test(s))) )).sort((a,b) => ((b.w||0)*(b.h||0)) - ((a.w||0)*(a.h||0)));
            let finalVids = pref.concat(others);
            if (!finalVids || finalVids.length === 0) finalVids = uniqueVids.slice();
            // cap to top 1 video (prefer single best video)
            finalVids = finalVids.slice(0, 1);
            try { console.debug && console.debug('[media-test] chosen final video(s):', (finalVids || []).map(v => v && (v.src || (v.sources && v.sources[0]) || v.url) || String(v))); } catch(e){}

            // Further filter: prefer larger fbcdn/scontent images, dedupe already applied above
            try {
              const MIN_AREA = 50000; // ignore very small images (w*h)
              const fbOnly = uniqueImgs.filter(im => {
                try {
                  if (!isFb(im.src)) return false;
                  const area = (Number(im.w) || 0) * (Number(im.h) || 0);
                  if (area < MIN_AREA) return false;
                  // Exclude URLs that look like small-stamped thumbnails: jpg?stp=
                  if (/\.jpe?g\?[^#]*\bstp=/i.test(im.src)) return false;
                  return true;
                } catch(e){ return false; }
              });
              // Sort by area desc
              const sorted = fbOnly.sort((a,b) => ((b.w||0)*(b.h||0)) - ((a.w||0)*(a.h||0)));
              // Prefer images with '/v/t45' in their URL (higher-quality full images)
              const preferred = sorted.filter(im => im && im.src && /\/v\/t45/.test(im.src));
              // Exclude obvious t39 thumbnails where possible
              const nonT39 = sorted.filter(im => im && im.src && !/\/v\/t39/.test(im.src) && !/\/v\/t45/.test(im.src));
              let finalImgs = preferred.concat(nonT39);
              // Fallback: if nothing left, include the sorted list (allow t39 as last resort)
              if (!finalImgs || finalImgs.length === 0) finalImgs = sorted.slice();
              // Limit to top N (10)
              finalImgs = finalImgs.slice(0, 10);
              // If filtering removed everything, fall back to the original collected images
              try {
                if ((!finalImgs || finalImgs.length === 0) && Array.isArray(uniqueImgs) && uniqueImgs.length > 0) {
                  finalImgs = uniqueImgs.slice(0, 10);
                }
              } catch (e) {}
              const out = { images: finalImgs, videos: finalVids || vids };
              try { console.log('[media-test] images(original)=', uniqueImgs.length, 'filtered=', finalImgs.length, 'videos=', vids.length); } catch(e){}
              try {
                const urls = finalImgs.map(i => (i && (i.src || i.currentSrc || i.url)) || String(i));
                console.log('[media-test] filtered image URLs (preferred /v/t45):', urls);
              } catch (e) {}
              try {
                const vurls = (finalVids || []).map(v => (v && (v.src || (v.sources && v.sources[0]) || v.url)) || String(v));
                console.log('[media-test] filtered video URLs:', vurls);
              } catch (e) {}
              return out;
            } catch (e) {
              const out = { images: uniqueImgs, videos: vids };
              try { console.log('[media-test] images=', uniqueImgs.length, 'videos=', vids.length); } catch(e){}
              try { const urls = uniqueImgs.map(i => (i && (i.src || i.currentSrc || i.url)) || String(i)); console.log('[media-test] fallback image URLs:', urls); } catch(e){}
              return out;
            }
          };

          // Retry/wait loop: some packaged builds may load images later — wait up to
          // ~4s (8 attempts x 500ms) for images/video to appear before sending.
          const attemptSend = async () => {
            try {
              let attempts = 0;
              let res = mediaTestWithVideo();
              while (attempts < 8) {
                try {
                  const hasImgs = res && Array.isArray(res.images) && res.images.length > 0;
                  const hasVids = res && Array.isArray(res.videos) && res.videos.length > 0;
                  if (hasImgs || hasVids) break;
                } catch (e) {}
                // sleep 500ms and retry
                await new Promise(r => setTimeout(r, 500));
                attempts++;
                try { res = mediaTestWithVideo(); } catch (e) { res = res || { images: [], videos: [] }; }
              }
              try { const urls = (res && Array.isArray(res.images)) ? res.images.map(i => (i && (i.src || i.currentSrc || i.url)) || String(i)) : []; console.debug('[AutoList Pro CLFP] media helper sending images:', urls); } catch(e){}
              try { chrome.runtime.sendMessage({ action: 'ffm_from_published_media', data: res }); } catch (e) { console.debug('[AutoList Pro CLFP] send media result failed', e); }
            } catch (err) { try { console.debug('[AutoList Pro CLFP] media helper attemptSend failed', err); } catch(_){} }
          };
          attemptSend();
        } catch (e) { console.debug('[AutoList Pro CLFP] media helper failed', e); }
        return;
      }
    } catch (e) {}

    // Helper: ask the background for the CLFP session status. Background
    // reads session storage (safe) and responds, avoiding storage access from
    // the content script which can be blocked in some contexts.
    async function isCLFPActive() {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'ffm_get_clfp_status' }, (res) => {
            try {
              if (chrome.runtime && chrome.runtime.lastError) {
                try { console.debug('[AutoList Pro CLFP] runtime error when checking status:', chrome.runtime.lastError.message); } catch (e) {}
                return resolve(false);
              }
              resolve(!!(res && res.active));
            } catch (e) { resolve(false); }
          });
        } catch (e) { try { console.debug('[AutoList Pro CLFP] CLFP check failed', e); } catch(_){} resolve(false); }
      });
    }

    // Remove injected buttons automatically if CLFP_ACTIVE is cleared elsewhere.
    // This uses chrome.storage.onChanged when available as a convenience; the
    // primary CLFP check uses the runtime bridge above.
    try {
      if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
        chrome.storage.onChanged.addListener((changes, area) => {
          try {
            if (area === 'session' && Object.prototype.hasOwnProperty.call(changes, 'CLFP_ACTIVE')) {
              const nv = changes.CLFP_ACTIVE && changes.CLFP_ACTIVE.newValue;
              if (typeof nv === 'undefined') {
                try {
                  const sel = '.ffm-generate-btn, .ffm-generate-img-btn-dialog, .ffm-generate-img-btn-card';
                  document.querySelectorAll(sel).forEach(n => { try { n.remove(); } catch(e){} });
                  console.debug('[AutoList Pro CLFP] CLFP_ACTIVE cleared — removed generate buttons');
                } catch (e) {}
              }
            }
          } catch (e) {}
        });
      }
    } catch (e) {}

    // Determine explicit activation signals (less fragile than the previous guard)
    try {
      const qs = new URLSearchParams(location.search || '');
      const hasGenerate = qs.get('__ffm_generate') === '1' || qs.get('__ffm_generate') === 'true' || !!qs.get('__ffm_generate');
      const pubUrl = qs.get('__ffm_pub') || '';
      const isEdit = String(location.pathname || '').startsWith('/marketplace/edit') || /\/marketplace\/edit\//.test(String(location.pathname || ''));
      const isMarketplace = String(location.pathname || '').startsWith('/marketplace/');
      const isTopFrame = (window.top === window.self);

      const active = !!(hasGenerate && isEdit && isMarketplace && isTopFrame);

      console.log('[AutoList Pro CLFP] ACTIVE DECISION', { active, hasGenerate, isEdit, isMarketplace, isTopFrame, href: location.href, pubUrl });

      if (!active) {
        console.log('[AutoList Pro CLFP] CLFP inactive — skipping EDIT init, but allowing Generate injection');
        // IMPORTANT: do NOT return — we still need scanForListings + observers on selling page
      } else {
        // CLFP is considered active for this page — wait for the edit form to mount (retry up to 30s)
        const MAX_MS = 30000;
        const START = Date.now();

        const waitForEditReady = async () => {
          try {
            while (true) {
              try {
                const form = document.querySelector('form');
                const hasDraftText = document.body && typeof document.body.innerText === 'string' && document.body.innerText.includes('Save draft');
                const ready = !!form || !!hasDraftText;
                if (ready) return true;
              } catch (e) {}
              if (Date.now() - START > MAX_MS) return false;
              await new Promise(r => setTimeout(r, 250));
            }
          } catch (e) { return false; }
        };

        const ready = await waitForEditReady();
        if (!ready) {
          console.warn('[AutoList Pro CLFP] edit page never became ready — giving up after 30s');
          // DO NOT return; allow injection observers below to stay alive
        } else {
          console.log('[AutoList Pro CLFP] edit page ready — starting observer/scrape init');
          try {
            if (typeof window.ffmInvalidateScrapeCache === 'function') {
              try { await window.ffmInvalidateScrapeCache('CLFP init'); }
              catch (e) { console.debug('[AutoList Pro CLFP] ffmInvalidateScrapeCache failed', e); }
            }
          } catch (e) {}
        }
      }
    } catch (e) { console.error('[AutoList Pro CLFP] initFromPublishedScraper crashed', e); return; }

    const BTN_CLASS = 'ffm-generate-btn';

    // --- Pub-media delivery helpers (port + runtime bridge) ---
    try {
      if (!window.__ffm_published_media_inited) {
        window.__ffm_published_media_inited = true;
        window.__ffm_published_media_callbacks = [];
        window.__ffm_published_media_latest = null;

        // runtime fallback: if a runtime message arrives, notify callbacks
        try {
          chrome.runtime.onMessage.addListener((msg) => {
            try {
              if (!msg || msg.action !== 'ffm_from_published_media_result') return;
              window.__ffm_published_media_latest = msg.data || null;
              const cbs = (window.__ffm_published_media_callbacks || []).slice();
              window.__ffm_published_media_callbacks = [];
              cbs.forEach(cb => { try { cb(window.__ffm_published_media_latest); } catch (e) {} });
              // Acknowledge receipt to background so it can clear any queued copy
              try { chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffm_from_published_media_ack' }, () => {}); } catch (e) {}
            } catch (e) {}
          });
        } catch (e) {}

        // port-based delivery: background can push results via long-lived port
        try {
          const __ffm_content_port = chrome.runtime.connect({ name: 'ffm_content_port' });
          __ffm_content_port.onMessage.addListener((msg) => {
            try {
              if (!msg || msg.action !== 'ffm_from_published_media_result') return;
              window.__ffm_published_media_latest = msg.data || null;
              const cbs = (window.__ffm_published_media_callbacks || []).slice();
              window.__ffm_published_media_callbacks = [];
              cbs.forEach(cb => { try { cb(window.__ffm_published_media_latest); } catch (e) {} });
              // Acknowledge receipt to background so it can clear any queued copy
              try { chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage({ action: 'ffm_from_published_media_ack' }, () => {}); } catch (e) {}
            } catch (e) {}
          });
        } catch (e) {}
      }
    } catch (e) {}
    // Helper: await a published-media result delivered via runtime or port
    function ffmAwaitPublishedMedia(timeoutMs = 12000, pubUrl = null) {
      return new Promise((resolve) => {
        try {
          try { if (window.__ffm_published_media_latest) return resolve(window.__ffm_published_media_latest); } catch (e) {}
          if (!window.__ffm_published_media_callbacks) window.__ffm_published_media_callbacks = [];
          let settled = false;
          const cb = (data) => {
            try {
              if (settled) return;
              settled = true;
              resolve(data || null);
            } catch (e) { resolve(null); }
          };
          window.__ffm_published_media_callbacks.push(cb);

          // polling fallback: query background cache every 500ms while waiting
          let pollId = null;
          try {
            if (typeof chrome !== 'undefined' && chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
              pollId = setInterval(() => {
                try {
                  chrome.runtime.sendMessage({ action: 'ffm_request_cached_media', pubUrl: pubUrl, editTabId: null }, (r) => {
                    try {
                      if (chrome.runtime && chrome.runtime.lastError) return;
                      const d = (r && (r.data || r.result)) ? (r.data || r.result) : null;
                      if (d) {
                        if (!settled) {
                          settled = true;
                          try { const idx = (window.__ffm_published_media_callbacks || []).indexOf(cb); if (idx >= 0) window.__ffm_published_media_callbacks.splice(idx, 1); } catch (e) {}
                          try { clearInterval(pollId); } catch (e) {}
                          resolve(d || null);
                        }
                      }
                    } catch (e) {}
                  });
                } catch (e) {}
              }, 500);
            }
          } catch (e) {}

          const toId = setTimeout(() => {
            try {
              if (settled) return;
              settled = true;
              const idx = (window.__ffm_published_media_callbacks || []).indexOf(cb);
              if (idx >= 0) window.__ffm_published_media_callbacks.splice(idx, 1);
              try { if (pollId) clearInterval(pollId); } catch (e) {}
              resolve(null);
            } catch (e) { try { if (pollId) clearInterval(pollId); } catch (er) {} resolve(null); }
          }, timeoutMs);
        } catch (e) { resolve(null); }
      });
    }
    const observerConfig = { childList: true, subtree: true };

    // Helper: extract edit info (edit URL and listing id) from a card or link when available
    function getEditInfo(baseEl) {
      try {
        if (!baseEl) return { editUrl: null, listingId: null };
        // look for explicit edit anchors nearby
        let a = null;
        try { a = baseEl.querySelector('a[href*="/marketplace/edit/"], a[href*="listing_id="]'); } catch (e) { a = null; }
        if (!a) {
          try { a = document.querySelector('a[href*="/marketplace/edit/"], a[href*="listing_id="]'); } catch (e) { a = null; }
        }
        const href = a && a.href ? String(a.href) : null;
        let listingId = null;
        try {
          if (href) {
            const m = href.match(/[?&]listing_id=(\d{6,})/);
            if (m && m[1]) listingId = m[1];
            else {
              const m2 = href.match(/\/marketplace\/edit\/.*listing_id=(\d{6,})/);
              if (m2 && m2[1]) listingId = m2[1];
            }
          }
        } catch (e) {}
        return { editUrl: href, listingId };
      } catch (e) { return { editUrl: null, listingId: null }; }
    }

    // Helper: normalize/clean listing title by removing common promotional suffixes
    function cleanListingTitle(s) {
      try {
        if (!s && s !== 0) return '';
        let t = String(s).trim();
        // Remove parenthetical promotional tags like (Like New) or [Like New]
        t = t.replace(/\s*[\(\[]\s*(like new|new|excellent condition|good condition|used)\s*[\)\]]/ig, '');
        // Remove trailing hyphenated tags: " - Like New!", "— Like New" etc.
        t = t.replace(/[\-—–]\s*(like new|new|excellent condition|good condition|used)\b[!\.]*/ig, '');
        // Remove common prefixes/suffixes like "Like New!" standalone
        t = t.replace(/\b(like new|new|excellent condition|good condition|used)\b[!\.]*/ig, '');
        // Collapse whitespace
        t = t.replace(/\s+/g, ' ').trim();
        return t;
      } catch (e) { return String(s || '').trim(); }
    }

    // Helper: adds button to a single listing card
    function attachGenerateButton(card) {
      try {
        if (!card || card.querySelector(`.${BTN_CLASS}`)) return; // already added

        // Prefer to find the canonical listing link within the card
        const link = card.querySelector('a[href*="/item/"]') || document.querySelector('a[href*="/item/"]');
        if (!link) return;

        // Create an <img> that acts as the clickable generate button (simple markup as requested)
        try {
          const imgURL = (chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('images/generate_icon.png') : 'images/generate_icon.png';
          const img = document.createElement('img');
          img.className = BTN_CLASS + ' generate-btn ffm-generate-img-btn-card';
          img.alt = 'Generate Listing';
          img.title = 'Generate Listing';
          img.src = imgURL;
          // Make the image visually appropriate for a small inline icon
          img.style.cssText = 'display:block; width:28px; height:auto; cursor:pointer; background: transparent; border: none; padding: 0;';
          img.addEventListener('click', (e) => {
            try {
              e.stopPropagation(); e.preventDefault();
                  const sendFinal = async () => {
                    try {
                      // Smart retail price extraction:
                      try {
                        if (!out.retailPrice && out.retailPrice !== 0) {
                          const parseMoney = (txt) => {
                            try {
                              const money = [];
                              const moneyRe = /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
                              let mm;
                              while ((mm = moneyRe.exec(String(txt || ''))) !== null) {
                                try { const n = Number(String(mm[1]).replace(/,/g, '')); if (isFinite(n)) money.push(n); } catch(e){}
                              }
                              return money;
                            } catch(e) { return []; }
                          };

                          // 1) explicit 'retail' mention in description (preferred)
                          try {
                            const descText = String(out.description || '');
                            const m = descText.match(/retail(?:\sprice)?[^$0-9\d]{0,40}\$\s*([0-9,\.]+)/i);
                            if (m && m[1]) {
                              out.retailPrice = Number(String(m[1]).replace(/,/g, '')) || null;
                            }
                          } catch(e) {}

                          // 2) amounts heuristic: prefer amounts in description, else page
                          if (!out.retailPrice) {
                            let amounts = parseMoney(out.description || '');
                            if (!amounts.length) {
                              try {
                                const joined = [out.description || '', out.title || '', (document && document.body && (document.body.innerText || '')) || ''].join('\n');
                                amounts = parseMoney(joined);
                              } catch(e) { amounts = []; }
                            }
                            if (amounts.length) {
                              const uniq = Array.from(new Set(amounts)).sort((a,b)=>a-b);
                              // try to pick smallest amount strictly greater than price
                              let priceNum = null;
                              try { if (out.price || out.price === 0) priceNum = Number(String(out.price).replace(/[^0-9\.]/g, '')); } catch(e) { priceNum = null; }
                              if (priceNum != null && isFinite(priceNum)) {
                                const candidates = uniq.filter(a => a > priceNum);
                                if (candidates.length) out.retailPrice = candidates[0];
                              }
                              // otherwise pick largest amount as retail (best-effort)
                              if (!out.retailPrice) out.retailPrice = uniq[uniq.length-1];
                            }
                          }
                        }
                      } catch(e) { /* ignore retail heuristics */ }
                    } catch (e) {}

                    // Persist the base scrape immediately
                    try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: out }); } catch (e) {}

                    // If a public URL was provided as a param to this edit page, request
                    // high-quality media collection from that public page and merge results
                    // before sending the final scrape result.
                    try {
                      const qs = location.search || '';
                      const m = qs.match(/__ffm_pub=([^&]+)/);
                      const pubUrl = (m && m[1]) ? decodeURIComponent(m[1]) : null;
                      if (pubUrl && chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                        // Request background open a media helper tab for the pubUrl and link results back
                        try { console.debug('[AutoList Pro CLFP] requesting media helper open for pubUrl=', pubUrl); chrome.runtime.sendMessage({ action: 'ffm_open_media_tab', pubUrl: pubUrl }); } catch (e) { try { console.debug('[AutoList Pro CLFP] ffm_open_media_tab send failed', e); } catch(_){} }

                        // Wait up to 12s for media result forwarded back to this tab
                        const media = await ffmAwaitPublishedMedia(12000);
                        if (media) {
                          try { out.images = (media.images || []).slice(); out.videos = (media.videos || []).slice(); } catch (e) {}
                        }
                      }
                    } catch (e) { /* ignore media collection errors */ }

                    try { chrome.runtime.sendMessage({ action: 'scrape-result', data: out, origin: 'from_published' }); } catch (e) { console.debug('[AutoList Pro CLFP] auto-scrape sendMessage failed', e); }
                  };
                } catch (e) { /* ignore click handler errors */ }
              });
          img.style.zIndex = 9999;

          // Ensure the card is positioned so absolute placement works
          try { const cs = window.getComputedStyle(card); if (cs && cs.position === 'static') card.style.position = 'relative'; } catch (e) {}

          card.appendChild(img);
        } catch (e) {
          try { console.debug('[AutoList Pro CLFP] failed to create image button', e); } catch (er) {}
        }

        // Ensure the card is positioned so absolute placement works
        try {
          const cs = window.getComputedStyle(card);
          if (cs && cs.position === 'static') card.style.position = 'relative';
        } catch (e) {}

        // Prefer inserting into a header area if available, otherwise into the card
        try {
          const header = card.querySelector('div[role="heading"], h1, h2, [data-testid="marketplace_feed_item_title"]');
          if (header && header.parentElement) {
            // insert into the parent so it sits visually over the card
            header.parentElement.appendChild(img);
          } else {
            card.appendChild(img);
          }
        } catch (e) { try { card.appendChild(img); } catch (er) {} }
      } catch (e) { /* ignore per-page errors */ }
    }

    // Helper: scans for the preview dialog and injects a button into the dialog's right column.
    // We restrict injection to the Your Listing preview dialog so buttons do not appear on the overview.
    function scanForListings() {
      try {
        const DIALOG_SELECTOR = 'div[role="dialog"][aria-label="Your Listing"]';
        const dialog = document.querySelector(DIALOG_SELECTOR);
        if (!dialog) return; // only operate when preview dialog is present

        // If we've already added a button inside this dialog, skip
        if (dialog.querySelector(`.${BTN_CLASS}`)) return;

        // Attempt to locate a logical 'right column' inside the dialog by geometry: any child
        // element whose left edge is in the right-half of the dialog.
        const dialogRect = dialog.getBoundingClientRect();
        const potentialCols = Array.from(dialog.querySelectorAll('div, section, aside'));
        let rightCol = potentialCols.find(el => {
          try { const r = el.getBoundingClientRect(); return (r.left > dialogRect.left + dialogRect.width / 2 - 2); } catch(e){ return false; }
        });

        // Fallbacks if heuristic fails
        if (!rightCol) rightCol = dialog.querySelector('aside') || dialog.querySelector('[role="complementary"]') || null;

        // Find a canonical link inside the dialog to use as the listing URL/title
        let link = null;
        try {
          link = dialog.querySelector('a[href*="/marketplace/item/"], a[href*="/item/"]');
          if (!link) {
            const img = dialog.querySelector('img');
            if (img) link = img.closest('a');
          }
        } catch (e) { link = null; }

        // Create and place the button inside the right column if possible, otherwise append to dialog
        try {
          // Create a simple <img> that acts as the clickable generate control in the dialog
          try {
            // If the dialog already contains our button, do nothing
            if (dialog && dialog.querySelector && dialog.querySelector('.ffm-generate-img-btn-dialog')) return;
            const imgURL = (chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('images/generate_icon.png') : 'images/generate_icon.png';
            const imgBtn = document.createElement('img');
            imgBtn.src = imgURL;
            imgBtn.alt = 'Generate Listing';
            imgBtn.title = 'Generate Listing';
            imgBtn.className = 'ffm-generate-img-btn-dialog';

            // Style for placement inside the dialog (absolute; anchored bottom-right)
            imgBtn.style.cssText = `
              width: 120px;
              height: auto;
              position: absolute;
              bottom: 12px;
              right: 20px;
              cursor: pointer;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
              transition: transform 0.2s, box-shadow 0.2s;
              z-index: 9999;
              background: transparent;
              border: none;
              padding: 0;
            `;

            imgBtn.addEventListener('mouseenter', () => {
              try { imgBtn.style.transform = 'scale(1.03)'; imgBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)'; } catch (e) {}
            });
            imgBtn.addEventListener('mouseleave', () => {
              try { imgBtn.style.transform = 'scale(1)'; imgBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)'; } catch (e) {}
            });

            imgBtn.addEventListener('click', (e) => {
              try {
                e.stopPropagation(); e.preventDefault();
                const url = link ? link.href : (location.href || '');
                const title = link ? ((link.textContent || '').trim() || document.title || '(Untitled Listing)') : (document.title || '(Untitled Listing)');
                // attempt to discover edit link/listing id from the dialog
                let editInfo = { editUrl: null, listingId: null };
                try { editInfo = getEditInfo(dialog) || editInfo; } catch (e) {}
                console.debug('[AutoList Pro CLFP] Dialog Generate clicked →', url, 'editInfo=', editInfo);
                try {
                  if (editInfo && editInfo.editUrl) {
                    try {
                      let baseEditUrl = null;
                      if (editInfo.listingId) {
                        baseEditUrl = 'https://www.facebook.com/marketplace/edit/?listing_id=' + String(editInfo.listingId);
                      } else {
                        try {
                          const m = String(editInfo.editUrl).match(/[?&]listing_id=(\d{6,})/);
                          if (m && m[1]) baseEditUrl = 'https://www.facebook.com/marketplace/edit/?listing_id=' + m[1];
                          else {
                            const m2 = String(editInfo.editUrl).match(/\/item\/(\d{6,})/);
                            if (m2 && m2[1]) baseEditUrl = 'https://www.facebook.com/marketplace/edit/?listing_id=' + m2[1];
                          }
                        } catch (e) {}
                      }
                      if (baseEditUrl) {
                        const pubParam = '__ffm_pub=' + encodeURIComponent(url || '');
                        const openUrl = baseEditUrl + (baseEditUrl.indexOf('?') !== -1 ? '&' : '?') + '__ffm_generate=1' + '&' + pubParam;
                        // Prefer asking background to open both tabs so helper runs in parallel.
                        try {
                          if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                            chrome.runtime.sendMessage({ action: 'ffm_open_edit_and_media', editUrl: openUrl, pubUrl: url, listingId: editInfo.listingId }, (res) => {
                              try {
                                if (chrome.runtime && chrome.runtime.lastError) throw chrome.runtime.lastError;
                                if (res && res.ok) return; // background handled opening
                                // fallback to old behavior
                                try { chrome.runtime.sendMessage({ action: 'ffm_from_published_started', url, title, editUrl: baseEditUrl, listingId: editInfo.listingId, pubUrl: url }); } catch (e) {}
                                window.open(openUrl, '_blank');
                              } catch (e) {
                                // fallback
                                try { chrome.runtime.sendMessage({ action: 'ffm_from_published_started', url, title, editUrl: baseEditUrl, listingId: editInfo.listingId, pubUrl: url }); } catch (er) {}
                                window.open(openUrl, '_blank');
                              }
                            });
                            return;
                          }
                        } catch (e) {}
                        try { chrome.runtime.sendMessage({ action: 'ffm_from_published_started', url, title, editUrl: baseEditUrl, listingId: editInfo.listingId, pubUrl: url }); } catch (e) {}
                        window.open(openUrl, '_blank');
                        return;
                      }
                      const raw = String(editInfo.editUrl);
                      const stripped = raw.split('?')[0];
                      const pubParam = '__ffm_pub=' + encodeURIComponent(url || '');
                      const openUrl = stripped + (stripped.indexOf('?') !== -1 ? '&' : '?') + '__ffm_generate=1' + '&' + pubParam;
                      try {
                        if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                          chrome.runtime.sendMessage({ action: 'ffm_open_edit_and_media', editUrl: openUrl, pubUrl: url, listingId: editInfo.listingId }, (res) => {
                            try {
                              if (chrome.runtime && chrome.runtime.lastError) throw chrome.runtime.lastError;
                              if (res && res.ok) return;
                              window.open(openUrl, '_blank');
                            } catch (e) { window.open(openUrl, '_blank'); }
                          });
                          return;
                        }
                      } catch (e) {}
                      window.open(openUrl, '_blank');
                      return;
                    } catch (e) { /* fallback to message */ }
                  }
                  chrome.runtime.sendMessage({ action: 'ffm_from_published_url', url, title, editUrl: editInfo.editUrl, listingId: editInfo.listingId, pubUrl: url });
                } catch (err) { console.debug('[AutoList Pro CLFP] sendMessage failed', err); }
              } catch (err) { console.debug('[AutoList Pro CLFP] dialog generate click error', err); }
            });

            // Ensure the dialog is relatively positioned so absolute placement works
            try { const cs = window.getComputedStyle(dialog); if (cs && cs.position === 'static') dialog.style.position = 'relative'; } catch (e) {}

            try { dialog.appendChild(imgBtn); } catch (e) { console.debug('[AutoList Pro CLFP] append dialog img failed', e); }
          } catch (err) { /* ignore DOM insertion errors */ }
        } catch (err) { /* ignore DOM insertion errors */ }
      } catch (e) { /* ignore */ }
    }

    // Run once on load
    setTimeout(scanForListings, 1500);

    // If this page was opened by a Generate click, indicated by the special query flag,
    // run the edit-page scraper in-page and post the result to the background.
    try {
      const urlHasGenerateFlag = (location.search || '').indexOf('__ffm_generate=1') !== -1 || (location.hash || '').indexOf('__ffm_generate=1') !== -1;
      if (urlHasGenerateFlag) {
        try {
          (async () => {
            // Ensure the edit form is present before attempting the edit-page scraper.
            function ffmEditFormReady() {
              try {
                return (
                  !!document.querySelector('form') ||
                  (document.body && typeof document.body.innerText === 'string' && document.body.innerText.indexOf('Save draft') !== -1)
                );
              } catch (e) { return false; }
            }

            async function ffmEnsureEditFormOpen() {
              try {
                if (ffmEditFormReady()) return true;
                try { console.log('[CLFP] edit form not mounted — attempting to open'); } catch (e) {}
                const buttons = Array.from(document.querySelectorAll('span,div,button'));
                const editBtn = buttons.find(el => {
                  try { return /edit|next|continue/i.test((el.textContent || '')); } catch (e) { return false; }
                });
                if (editBtn) {
                  try { editBtn.click(); try { console.log('[CLFP] clicked edit/next button'); } catch (e) {} } catch (e) {}
                }
                for (let i = 0; i < 40; i++) {
                  try { if (ffmEditFormReady()) { try { console.log('[CLFP] edit form mounted'); } catch (e) {} return true; } } catch (e) {}
                  await new Promise(r => setTimeout(r, 250));
                }
                try { console.warn('[CLFP] edit form never mounted'); } catch (e) {}
                return false;
              } catch (e) { return false; }
            }

            const ensureOk = await ffmEnsureEditFormOpen();
            if (!ensureOk) {
              try { console.debug('[AutoList Pro CLFP] edit form unavailable — aborting generate scrape'); } catch (e) {}
              return;
            }
            // Wait for authoritative edit-form elements to render instead of using a fixed timeout.
            // Poll for up to 8s for either a title input or a price input / category selector to appear.
            const waitFor = async (predicate, timeoutMs = 8000, intervalMs = 300) => {
              const start = Date.now();
              while (Date.now() - start < timeoutMs) {
                try { if (predicate()) return true; } catch (e) {}
                await new Promise(r => setTimeout(r, intervalMs));
              }
              return false;
            };

            await waitFor(() => {
              try {
                const titleInput = document.querySelector('input[name*="title"], input[id*="title"], textarea[name*="title"], [aria-label*="Title"]');
                const priceInput = document.querySelector('input[name*="price"], input[id*="price"], [aria-label*="Price"]');
                const catSel = document.querySelector('select[name*="category"], select[id*="category"], [aria-label*="Category"]');
                return !!(titleInput || priceInput || catSel);
              } catch (e) { return false; }
            }, 8000, 300);

              // Replace this with the lightweight deterministic approach provided by the user
              const doDetailScrape = () => {
                try {
                  const res = { fields: {}, title: '', inventoryName: '', _sources: {} };

                  const getValueAfter = (labelText) => {
                    try {
                      const labelEl = Array.from(document.querySelectorAll('span')).find(el => (el.textContent || '').trim() === labelText);
                      if (!labelEl) return null;

                      // 1) Try input value in the closest wrapper
                      try {
                        const wrapper = labelEl.closest && labelEl.closest('div');
                        if (wrapper) {
                          const input = wrapper.querySelector('input[type="text"], input[type="search"], input[role="combobox"], [role="combobox"]');
                          if (input && ('value' in input) && String(input.value || '').trim()) return String(input.value).trim();
                        }
                      } catch(e){}

                      // 2) Next visible span in parent (excluding label)
                      try {
                        if (labelEl.parentElement) {
                          const spans = Array.from(labelEl.parentElement.querySelectorAll('span'));
                          const nextSpan = spans.find(span => span !== labelEl && (span.textContent || '').trim() !== '' && !new RegExp(labelText, 'i').test(span.textContent || ''));
                          if (nextSpan) return (nextSpan.textContent || '').trim();
                        }
                      } catch(e){}

                      // 3) Fallback: next sibling container
                      try {
                        if (labelEl.nextElementSibling) {
                          const maybe = labelEl.nextElementSibling.querySelector && labelEl.nextElementSibling.querySelector('span, input');
                          if (maybe) return (maybe.textContent || maybe.value || '').trim() || null;
                        }
                      } catch(e){}

                      return null;
                    } catch(e) { return null; }
                  };

                  try { const cat = getValueAfter('Category'); if (cat) { res.fields.category = cat; res._sources.category = 'detailScrape'; } } catch(e){}
                  try { const bed = getValueAfter('Bed Size'); if (bed) { res.fields.bedSize = bed; res._sources.bedSize = 'detailScrape'; } } catch(e){}
                  try { const core = getValueAfter('Core Construction'); if (core) { res.fields.coreConstruction = core; res._sources.coreConstruction = 'detailScrape'; } } catch(e){}
                  try { const comfort = getValueAfter('Comfort Level'); if (comfort) { res.fields.comfortLevel = comfort; res._sources.comfortLevel = 'detailScrape'; } } catch(e){}

                  try {
                    const titleEl = document.querySelector('h1,h2,h3') || Array.from(document.querySelectorAll('span,div')).find(n=>{ const t=(n && (n.innerText||'')).toString().trim(); return t && t.length>10 && /[A-Z0-9]/.test(t[0]); });
                    if (titleEl) { res.title = (titleEl.innerText||'').toString().trim(); res.inventoryName = res.title; res._sources.title = 'detailScrape'; }
                  } catch(e){}

                  return res;
                } catch(e) { return {}; }
              };

              const early = doDetailScrape();

            // perform the scrape (best-effort) after waiting
                
            // === AutoList Pro v6 Smart Scraper (replacing legacy block) ===
            async function scrapeListingDetails() {
              function getValueAfter(labelText) {
                const labelEl = Array.from(document.querySelectorAll("span"))
                  .find(el => (el.textContent || '').trim() === labelText);
                if (!labelEl) return null;
                let value = null;
                const input = labelEl.closest("div")?.querySelector('input[type="text"],input[type="search"],input[type="number"]');
                if (input && input.value) value = input.value.trim();
                if (!value) {
                  const textarea = labelEl.closest("div")?.querySelector("textarea");
                  if (textarea && textarea.value.trim()) value = textarea.value.trim();
                }
                if (!value) {
                  const divValue = labelEl.closest("div")?.querySelector('div[aria-hidden="true"]');
                  if (divValue && divValue.textContent.trim()) value = divValue.textContent.trim();
                }
                if (!value) {
                  const nextSpan = Array.from(labelEl.parentElement.querySelectorAll("span"))
                    .find(span => span !== labelEl && (span.textContent || '').trim() !== "" &&
                      !/Title|Price|Category|Core|Comfort|Bed|Description/i.test((span.textContent || '')));
                  if (nextSpan) value = nextSpan.textContent.trim();
                }
                if (!value && labelEl.nextElementSibling) {
                  const maybe = labelEl.nextElementSibling.querySelector("input,span,div,textarea");
                  if (maybe) value = (maybe.value || maybe.textContent || '').trim();
                }
                if (!value) return "(Not found)";
                // Preserve paragraph/line breaks for Description while normalizing spaces within lines
                try {
                  if (String(labelText || '').toLowerCase() === 'description') {
                    // Normalize CRLF -> LF, trim each line and collapse multiple spaces within a line,
                    // then collapse 3+ consecutive newlines down to two to keep paragraph gaps but avoid excessive blanks.
                    let s = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    const lines = s.split('\n').map(l => l.replace(/\s+/g, ' ').trim());
                    s = lines.join('\n');
                    s = s.replace(/\n{3,}/g, '\n\n').trim();
                    return s;
                  }
                } catch (e) {}
                return value ? value.replace(/\s+/g, " ").trim() : "(Not found)";
              }
              async function waitForDescription(timeoutMs = 5000) {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                  const desc = getValueAfter("Description");
                  if (desc && desc !== "(Not found)") return desc;
                  await new Promise(r => setTimeout(r, 500));
                }
                return "(Not found)";
              }
              try {
                const data = {};
                try { data.Title = getValueAfter("Title"); } catch(e) { data.Title = null; }
                try { data.Price = getValueAfter("Price"); } catch(e) { data.Price = null; }
                try { data.Category = getValueAfter("Category"); } catch(e) { data.Category = null; }
                try { data.BedSize = getValueAfter("Bed Size"); } catch(e) { data.BedSize = null; }
                try { data.Core = getValueAfter("Core Construction"); } catch(e) { data.Core = null; }
                try { data.Comfort = getValueAfter("Comfort Level"); } catch(e) { data.Comfort = null; }
                try { data.BikeType = getValueAfter("Type"); } catch(e) { data.BikeType = null; }
                try { data.WheelSize = getValueAfter("Wheel Size"); } catch(e) { data.WheelSize = null; }
                try { data.Material = getValueAfter("Material"); } catch(e) { data.Material = null; }
                try { data.Color = getValueAfter("Color"); } catch(e) { data.Color = null; }
                try { data.SmartHomeCompatibility = getValueAfter("Smart Home Compatibility"); } catch(e) { data.SmartHomeCompatibility = null; }
                try { data.Description = await waitForDescription(); } catch(e) { data.Description = ""; }

                // --- CONDITION (v4: includes sibling-row + summary block pattern) ---
                try {
                  let conditionValue = null;

                  // Try summary-row version (label/value in sibling <span> blocks)
                  const summaryRow = Array.from(document.querySelectorAll("div"))
                    .find(div =>
                      div.innerText?.trim().startsWith("Condition") &&
                      div.querySelectorAll("span").length >= 2
                    );
                  if (summaryRow) {
                    const spans = Array.from(summaryRow.querySelectorAll("span"));
                    const valSpan = spans.find(s => s.textContent.trim().toLowerCase() !== "condition");
                    if (valSpan) conditionValue = valSpan.textContent.trim();
                  }

                  // Try edit-form version
                  if (!conditionValue) {
                    const labelSpan = Array.from(document.querySelectorAll("span"))
                      .find(el => el.textContent.trim().toLowerCase() === "condition");
                    if (labelSpan) {
                      const container = labelSpan.closest("div");
                      const valueEl = container?.querySelector('select, input, span.x6ikm8r, div[role="button"], div[aria-label]');
                      if (valueEl) conditionValue = valueEl.value || valueEl.textContent.trim();
                    }
                  }

                  // Fallback by aria-label
                  if (!conditionValue) {
                    const aria = document.querySelector('[aria-label="Condition"], [aria-label*="condition" i]');
                    if (aria) conditionValue = aria.value || aria.textContent.trim();
                  }

                  if (conditionValue) data.Condition = conditionValue;
                } catch (err) {
                  console.warn("[scrape] Condition detection error", err);
                }

                // --- HIDE FROM FRIENDS (v4: handles both switch + confirmation text) ---
                try {
                  let hideFlag = false;

                  // 1️⃣ Direct input-based toggle
                  const switchInput = Array.from(document.querySelectorAll('input[role="switch"][type="checkbox"], div[role="switch"]'))
                    .find(el => {
                      const label = (el.getAttribute && el.getAttribute("aria-label") || "").toLowerCase();
                      return label.includes("hide from friends") || label.includes("enabled");
                    });

                  if (switchInput) {
                    // If aria-checked or checked attr is true → ON
                    const ariaVal = switchInput.getAttribute && switchInput.getAttribute("aria-checked");
                    const checkedAttr = switchInput.hasAttribute && switchInput.hasAttribute("checked");
                    hideFlag = ariaVal === "true" || checkedAttr === true;
                  }

                  // 2️⃣ Fallback: detect the “Hiding from friends will remove this listing…” message
                  if (!hideFlag) {
                    const confirmMsg = Array.from(document.querySelectorAll("span"))
                      .find(el => (el.textContent || "").trim().toLowerCase().includes("hiding from friends will remove this listing"));
                    if (confirmMsg) hideFlag = true;
                  }

                  data.HideFromFriends = hideFlag;
                  try { console.debug("[scrape] ✅ HideFromFriends:", hideFlag); } catch(e){}
                } catch (err) {
                  console.warn("[scrape] ❌ HideFromFriends detection error", err);
                }

                // --- MEETUP PREFERENCES (Public meetup / Door pickup / Door dropoff) ---
                // Same role="checkbox" + textContent-prefix pattern confirmed live against
                // FB's "Meetup preferences" section (2026-08-01) — matches the reverse
                // (checkbox-setting) automation in content/content_main.js's
                // setMeetupPreferences().
                try {
                  const meetupCheckboxes = Array.from(document.querySelectorAll('[role="checkbox"]'));
                  const readMeetupChecked = (label) => {
                    const el = meetupCheckboxes.find((cb) => (cb.textContent || '').trim().startsWith(label));
                    return !!(el && el.getAttribute('aria-checked') === 'true');
                  };
                  data.PublicMeetup = readMeetupChecked('Public meetup');
                  data.DoorPickup = readMeetupChecked('Door pickup');
                  data.DoorDropoff = readMeetupChecked('Door dropoff');
                  try { console.debug('[scrape] ✅ Meetup prefs:', { PublicMeetup: data.PublicMeetup, DoorPickup: data.DoorPickup, DoorDropoff: data.DoorDropoff }); } catch (e) {}
                } catch (err) {
                  console.warn('[scrape] ❌ Meetup preferences detection error', err);
                }

                return data;
              } catch(e) { return {}; }
            }
            function scrapeMedia() {
              const imgs = Array.from(document.querySelectorAll("img"))
                .map(i => i.src)
                .filter(u => u && u.startsWith("http") && !u.includes("emoji") && !u.includes("profile"))
                .filter((v,i,a)=>a.indexOf(v)===i);
              const vids = Array.from(document.querySelectorAll("video"))
                .map(v => v.currentSrc || v.src)
                .filter(Boolean)
                .filter((v,i,a)=>a.indexOf(v)===i);
              return { imgs, vids };
            }

            // Wait for the authoritative Title input to exist and have a value before scraping.
            // Prefer a stable FB input id pattern when present, otherwise fall back to common title inputs.
            await waitFor(() => {
              try {
                const candidates = [
                  'input[id^="_r_2l_"][value]',
                  'input[name*="title"][value]',
                  'input[id*="title"][value]',
                  'textarea[name*="title"]'
                ];
                for (const s of candidates) {
                  try {
                    const el = document.querySelector(s);
                    if (el) {
                      // if it's an input/textarea, ensure it has non-empty value/text
                      const v = ('value' in el) ? String(el.value || '').trim() : String(el.textContent || '').trim();
                      if (v) return true;
                    }
                  } catch (e) {}
                }
              } catch (e) {}
              return false;
            }, 5000, 150);

            const v6 = await scrapeListingDetails();
            // If this edit page was opened with a public-item URL, do NOT run the
            // edit-page media scrape (it collects many low-quality imgs). Instead
            // wait for the media-helper to return the curated results.
            const qsPubCheck = location.search || '';
            const pubMatchTop = qsPubCheck.match(/__ffm_pub=([^&]+)/);
            const pubUrlFromQuery = (pubMatchTop && pubMatchTop[1]) ? decodeURIComponent(pubMatchTop[1]) : null;
            const media = pubUrlFromQuery ? { imgs: [], vids: [] } : scrapeMedia();

            const out = {
              url: location.href,
              title: v6.Title || '',
              inventoryName: v6.Title || '',
              price: (v6.Price && /^\$?\d/.test(v6.Price)) ? v6.Price : v6.Price,
              retailPrice: null,
              description: v6.Description || '',
              fields: (() => {
                const cleanScraped = (v) => (v && v !== '(Not found)') ? v : '';
                const scrapedCategory = v6.Category || '';
                const isBicycleCat = scrapedCategory === 'Bicycles';
                const isElectronicsCat = /electronics/i.test(scrapedCategory);
                return {
                  category: scrapedCategory,
                  bedSize: v6.BedSize || '',
                  coreConstruction: v6.Core || '',
                  comfortLevel: v6.Comfort || '',
                  condition: v6.Condition || '',
                  bikeType: isBicycleCat ? cleanScraped(v6.BikeType) : '',
                  wheelSize: isBicycleCat ? cleanScraped(v6.WheelSize) : '',
                  bikeMaterial: isBicycleCat ? cleanScraped(v6.Material) : '',
                  smartHomeCompatibility: isElectronicsCat ? cleanScraped(v6.SmartHomeCompatibility) : '',
                  elecColor: isElectronicsCat ? cleanScraped(v6.Color) : '',
                };
              })(),
              hideFromFriends: (!!v6.HideFromFriends) || false,
              publicMeetup: !!v6.PublicMeetup,
              doorPickup: !!v6.DoorPickup,
              doorDropoff: !!v6.DoorDropoff,
              images: media.imgs || [],
              videos: media.vids || [],
              timestamp: Date.now(),
              _sources: {}
            };
;

                // Before persisting/sending, attempt to run the older mini-scrape (the one
                // in content_main.js that responds to 'perform-generate-scrape') in this tab
                // and merge any missing fields. This exploits the preview area on the edit
                // page which often contains the same visible text the old scraper used.
                try {
                  // Validator in outer scope for use during merge
                  const isLikelyBedSize = (v) => {
                    try {
                      if (!v && v !== 0) return false;
                      const s = String(v || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                      if (!s) return false;
                      const known = ['twin', 'twin xl', 'full', 'double', 'queen', 'king', 'california king', 'cal king', 'single', 'crib', 'small single', 'super single', 'european king'];
                      for (const k of known) if (s.indexOf(k) !== -1) return true;
                      if (/\b(twin|full|double|queen|king|california|single|crib)\b/.test(s)) return true;
                      return false;
                    } catch (e) { return false; }
                  };
                  // Outer-scope validators for core and comfort
                  const isLikelyCoreConstruction = (v) => {
                    try {
                      if (!v && v !== 0) return false;
                      let s = String(v || '').toLowerCase().replace(/[_\-\u2013\u2014]/g,' ');
                      s = s.replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
                      if (!s) return false;
                      const kws = ['hybrid','inner spring','innerspring','memory foam','memory','latex','pocket coil','coil','foam','gel','microcoil','spring','pillow top','airbed','air bed','adjustable foam','polyfoam'];
                      for (const k of kws) if (s.indexOf(k) !== -1) return true;
                      if (/\b(coil|foam|latex|memory|hybrid|innerspring)\b/.test(s)) return true;
                      return false;
                    } catch(e) { return false; }
                  };
                  const isLikelyComfortLevel = (v) => {
                    try {
                      if (!v && v !== 0) return false;
                      let s = String(v || '').toLowerCase().replace(/[_\-\u2013\u2014]/g,' ');
                      s = s.replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
                      if (!s) return false;
                      const kws = ['soft','very soft','medium','medium firm','medium-firm','mid firm','mid-firm','firm','very firm','extra firm','plush','plush feel','pillow top','cushion firm'];
                      for (const k of kws) if (s.indexOf(k) !== -1) return true;
                      if (/\b(soft|medium|firm|plush|pillow)\b/.test(s)) return true;
                      return false;
                    } catch(e) { return false; }
                  };
                  const sendFinal = () => {
                    try {
                      // Smart retail price extraction:
                      try {
                        if (!out.retailPrice && out.retailPrice !== 0) {
                          const parseMoney = (txt) => {
                            try {
                              const money = [];
                              const moneyRe = /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
                              let mm;
                              while ((mm = moneyRe.exec(String(txt || ''))) !== null) {
                                try { const n = Number(String(mm[1]).replace(/,/g, '')); if (isFinite(n)) money.push(n); } catch(e){}
                              }
                              return money;
                            } catch(e) { return []; }
                          };

                          // 1) explicit 'retail' mention in description (preferred)
                          try {
                            const descText = String(out.description || '');
                            const m = descText.match(/retail(?:\sprice)?[^$0-9\d]{0,40}\$\s*([0-9,\.]+)/i);
                            if (m && m[1]) {
                              out.retailPrice = Number(String(m[1]).replace(/,/g, '')) || null;
                            }
                          } catch(e) {}

                          // 2) amounts heuristic: prefer amounts in description, else page
                          if (!out.retailPrice) {
                            let amounts = parseMoney(out.description || '');
                            if (!amounts.length) {
                              try {
                                const joined = [out.description || '', out.title || '', (document && document.body && (document.body.innerText || '')) || ''].join('\n');
                                amounts = parseMoney(joined);
                              } catch(e) { amounts = []; }
                            }
                            if (amounts.length) {
                              const uniq = Array.from(new Set(amounts)).sort((a,b)=>a-b);
                              // try to pick smallest amount strictly greater than price
                              let priceNum = null;
                              try { if (out.price || out.price === 0) priceNum = Number(String(out.price).replace(/[^0-9\.]/g, '')); } catch(e) { priceNum = null; }
                              if (priceNum != null && isFinite(priceNum)) {
                                const candidates = uniq.filter(a => a > priceNum);
                                if (candidates.length) out.retailPrice = candidates[0];
                              }
                              // otherwise pick largest amount as retail (best-effort)
                              if (!out.retailPrice) out.retailPrice = uniq[uniq.length-1];
                            }
                          }
                        }
                      } catch(e) { /* ignore retail heuristics */ }
                    } catch (e) {}
                    try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ ffm_last_generate_scrape: out }); } catch (e) {}
                    try { chrome.runtime.sendMessage({ action: 'scrape-result', data: out, origin: 'from_published' }); } catch (e) { console.debug('[AutoList Pro CLFP] auto-scrape sendMessage failed', e); }
                  };

                  let responded = false;
                  try {
                    if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                      try {
                        // Ask the page's top-level mini-scrape to run and return its result
                        chrome.runtime.sendMessage({ action: 'perform-generate-scrape' }, async (res) => {
                          try {
                            responded = true;
                            if (res && typeof res === 'object') {
                              // Merge missing top-level fields if the mini-scrape has them
                              try { if ((!out.inventoryName || out.inventoryName === '') && res.inventoryName) out.inventoryName = res.inventoryName; } catch (e) {}
                              try { if ((!out.title || out.title === '') && res.title) out.title = res.title; } catch (e) {}
                              try { if ((!out.price || out.price === null || out.price === '') && (res.price || res.price === 0)) out.price = res.price; } catch (e) {}
                              try { if ((!out.description || out.description === '') && res.description) out.description = res.description; } catch (e) {}
                              try { if ((!out.retailPrice || out.retailPrice === null) && res.retailPrice) out.retailPrice = res.retailPrice; } catch (e) {}
                              // Merge category and mattress/detail fields if missing
                              try {
                                out.fields = out.fields || {};
                                const miniCat = (res && res.fields && res.fields.category) || res && res.category;
                                if ((!out.fields.category || out.fields.category === '') && miniCat) out.fields.category = miniCat;
                                // Merge mattress-specific detail fields from mini-scrape's fields or details
                                try {
                                  const srcFields = (res && res.fields) || {};
                                  const srcDetails = (res && res.details) || {};
                                  const pick = (keys) => {
                                    for (const k of keys) {
                                      if (typeof srcFields[k] !== 'undefined' && srcFields[k] !== null && String(srcFields[k]).trim() !== '') return srcFields[k];
                                      if (typeof srcDetails[k] !== 'undefined' && srcDetails[k] !== null && String(srcDetails[k]).trim() !== '') return srcDetails[k];
                                    }
                                    return null;
                                  };
                                  const maybeAssign = (outKey, candidates) => {
                                    try {
                                      if (!out.fields[outKey] || String(out.fields[outKey]).trim() === '') {
                                        const v = pick(candidates);
                                        if (v !== null) out.fields[outKey] = v;
                                      }
                                    } catch (e) {}
                                  };
                                  maybeAssign('condition', ['condition','Condition']);
                                  maybeAssign('bedSize', ['bedSize','Bed Size','Bed_Size','BedSize']);
                                  maybeAssign('coreConstruction', ['coreConstruction','Core Construction','Core']);
                                  maybeAssign('comfortLevel', ['comfortLevel','Comfort Level','Comfort']);
                                  maybeAssign('brand', ['brand','Brand','Make']);
                                  maybeAssign('model', ['model','Model']);
                                  maybeAssign('size', ['size','Size']);
                                  maybeAssign('color', ['color','Colour','Color']);
                                  maybeAssign('material', ['material','Material','Fabric']);
                                  maybeAssign('sku', ['sku','SKU','part','mpn']);
                                } catch (e) {}
                                // Additionally, try parsing the mini-scrape's preview HTML/text for mattress fields
                                try {
                                  const previewHtml = (res && (res.previewSampleHTML || res.previewSampleHtml || res.preview)) || '';
                                  const previewText = previewHtml ? stripTags(previewHtml) : (res && typeof res.details === 'string' ? res.details : '');
                                  if (previewText) {
                                    try {
                                      const parsed = parseListingData(previewText) || {};
                                      const isJsonish = (v) => { try { const s = String(v||'').trim(); return s.startsWith('{') || s.startsWith('['); } catch(e){return false;} };
                                      if (parsed.condition && (!out.fields.condition || String(out.fields.condition).trim()==='' || isJsonish(out.fields.condition))) out.fields.condition = parsed.condition;
                        if (parsed.bedSize && isLikelyBedSize(parsed.bedSize) && (!out.fields.bedSize || String(out.fields.bedSize).trim()==='' || isJsonish(out.fields.bedSize))) out.fields.bedSize = parsed.bedSize; else if (parsed.bedSize) try { console.debug && console.debug('[AutoList Pro CLFP] mini-scrape parsed rejected bedSize =', parsed.bedSize); } catch(e){}
                                      if (parsed.coreConstruction && isLikelyCoreConstruction(parsed.coreConstruction) && (!out.fields.coreConstruction || String(out.fields.coreConstruction).trim()==='' || isJsonish(out.fields.coreConstruction))) out.fields.coreConstruction = parsed.coreConstruction; else if (parsed.coreConstruction) try { console.debug && console.debug('[AutoList Pro CLFP] mini-scrape parsed rejected coreConstruction =', parsed.coreConstruction); } catch(e){}
                                      if (parsed.comfortLevel && isLikelyComfortLevel(parsed.comfortLevel) && (!out.fields.comfortLevel || String(out.fields.comfortLevel).trim()==='' || isJsonish(out.fields.comfortLevel))) out.fields.comfortLevel = parsed.comfortLevel; else if (parsed.comfortLevel) try { console.debug && console.debug('[AutoList Pro CLFP] mini-scrape parsed rejected comfortLevel =', parsed.comfortLevel); } catch(e){}
                                      if (parsed.listedWhen && (!out.listedWhen || String(out.listedWhen).trim()==='')) out.listedWhen = parsed.listedWhen;
                                      if ((parsed.price || parsed.price===0) && (!out.price || out.price===null)) out.price = parsed.price;
                                      if ((parsed.retailPrice || parsed.retailPrice===0) && (!out.retailPrice || out.retailPrice===null)) out.retailPrice = parsed.retailPrice;
                                    } catch(e){}
                                  }
                                } catch(e){}
                              } catch (e) {}
                                  // After merging, reject any obviously invalid bedSize so sendFinal will allow follow-ups to populate it
                                  try {
                                    if (out && out.fields && out.fields.bedSize && !isLikelyBedSize(out.fields.bedSize)) {
                                      try { console.debug && console.debug('[AutoList Pro CLFP] final merge rejected bedSize (clearing) =', out.fields.bedSize); } catch(e){}
                                      out.fields.bedSize = '';
                                    }
                                  } catch(e) {}
                                  try {
                                    if (out && out.fields && out.fields.coreConstruction && !isLikelyCoreConstruction(out.fields.coreConstruction)) {
                                      try { console.debug && console.debug('[AutoList Pro CLFP] final merge rejected coreConstruction (clearing) =', out.fields.coreConstruction); } catch(e){}
                                      out.fields.coreConstruction = '';
                                    }
                                  } catch(e) {}
                                  try {
                                    if (out && out.fields && out.fields.comfortLevel && !isLikelyComfortLevel(out.fields.comfortLevel)) {
                                      try { console.debug && console.debug('[AutoList Pro CLFP] final merge rejected comfortLevel (clearing) =', out.fields.comfortLevel); } catch(e){}
                                      out.fields.comfortLevel = '';
                                    }
                                  } catch(e) {}
                            }
                          } catch (e) { console.debug('[AutoList Pro CLFP] merge from mini-scrape failed', e); }
                          try {
                              // Sanitization: prefer visible preview/category text over JSON-like control values
                              try {
                                out._sources = out._sources || {};
                                const isJsonish = (v) => { try { const s = String(v||'').trim(); return s.startsWith('{') || s.startsWith('['); } catch(e){return false;} };

                                // find a preview element similar to earlier logic
                                let previewSanEl = null;
                                try {
                                  const previewCandidates = Array.from(document.querySelectorAll('div[aria-hidden="false"], div, section, article'));
                                  previewSanEl = previewCandidates.find(c => { try { const t = (c.innerText||'').toLowerCase(); return t.indexOf('condition')!==-1 || t.indexOf('bed size')!==-1 || t.indexOf('details')!==-1; } catch(e){return false;} });
                                } catch(e) { previewSanEl = null; }

                                // sanitize category: clear jsonish and try to replace from visible label
                                try {
                                  const curCat = out.fields && out.fields.category;
                                  if (!curCat || isJsonish(curCat)) {
                                    let cand = '';
                                    try { cand = findValueNearLabel('category') || ''; } catch(e) { cand = ''; }
                                    try { if ((!cand || isJsonish(cand)) && previewSanEl) cand = findLabelValue(previewSanEl, /category/i) || ''; } catch(e) {}
                                    if (cand && !isJsonish(cand)) { out.fields.category = cand; out._sources.category = 'preview'; try { console.debug('[AutoList Pro CLFP] sanitized category =', cand); } catch(e){} }
                                    else if (isJsonish(curCat)) { try { console.debug('[AutoList Pro CLFP] cleared jsonish category =', curCat); } catch(e){}; out.fields.category = ''; }
                                  }
                                } catch(e) {}

                                // sanitize bedSize/core/comfort by trying preview label/value heuristics if empty
                                try {
                                  if (!out.fields.bedSize || String(out.fields.bedSize).trim() === '') {
                                    let cand = '';
                                    try { cand = (previewSanEl && findLabelValue(previewSanEl,/bed size/i)) || findValueNearLabel('bed size') || (previewSanEl && findLabelValue(previewSanEl,/bed/i)) || ''; } catch(e) { cand = ''; }
                                    if (cand && isLikelyBedSize(cand)) { out.fields.bedSize = cand; out._sources.bedSize = 'preview'; try { console.debug('[AutoList Pro CLFP] sanitized bedSize =', cand); } catch(e){} }
                                  }
                                } catch(e) {}

                                try {
                                  if (!out.fields.coreConstruction || String(out.fields.coreConstruction).trim() === '') {
                                    let cand = '';
                                    try { cand = (previewSanEl && findLabelValue(previewSanEl,/core/i)) || findValueNearLabel('core') || ''; } catch(e) { cand = ''; }
                                    if (cand && isLikelyCoreConstruction(cand)) { out.fields.coreConstruction = cand; out._sources.coreConstruction = 'preview'; try { console.debug('[AutoList Pro CLFP] sanitized coreConstruction =', cand); } catch(e){} }
                                    else if (cand) try { console.debug && console.debug('[AutoList Pro CLFP] sanitized rejected coreConstruction =', cand); } catch(e){}
                                  }
                                } catch(e) {}

                                try {
                                  if (!out.fields.comfortLevel || String(out.fields.comfortLevel).trim() === '') {
                                    let cand = '';
                                    try { cand = (previewSanEl && findLabelValue(previewSanEl,/comfort/i)) || findValueNearLabel('comfort') || ''; } catch(e) { cand = ''; }
                                    if (cand && isLikelyComfortLevel(cand)) { out.fields.comfortLevel = cand; out._sources.comfortLevel = 'preview'; try { console.debug('[AutoList Pro CLFP] sanitized comfortLevel =', cand); } catch(e){} }
                                    else if (cand) try { console.debug && console.debug('[AutoList Pro CLFP] sanitized rejected comfortLevel =', cand); } catch(e){}
                                  }
                                } catch(e) {}
                                // Global fallback: scan title/inventoryName and full page text for known patterns
                                try {
                                  const bodyText = (document && document.body && (document.body.innerText || '')) || '';
                                  // Helper: find first matching regex from array
                                  const findFirst = (arr) => {
                                    try {
                                      for (const r of arr) {
                                        try {
                                          const m = bodyText.match(r);
                                          if (m && m[1]) return m[1].trim();
                                        } catch(e){}
                                      }
                                    } catch(e){}
                                    return null;
                                  };

                                  // Bed size: prefer title/inventoryName first
                                  try {
                                    if (!out.fields.bedSize || String(out.fields.bedSize).trim() === '') {
                                      const titleCand = (out.inventoryName || out.title || '') || '';
                                      if (titleCand && isLikelyBedSize(titleCand)) {
                                        out.fields.bedSize = titleCand.match(/(twin xl|twin|full|double|queen|king|california king|cal king|single|crib|small single|super single|european king)/i)[0];
                                        out._sources.bedSize = 'title';
                                        try { console.debug('[AutoList Pro CLFP] global found bedSize from title =', out.fields.bedSize); } catch(e){}
                                      } else {
                                        const bedRegexes = [ /bed\s*size[:\s\-]*([A-Za-z0-9 \-]+)/i, /bed\s*size\s*\n\s*([A-Za-z0-9 \-]+)/i, /(queen|king|full|double|twin xl|twin|cal king|california king|single|crib)\b/i ];
                                        const g = findFirst(bedRegexes);
                                        if (g && isLikelyBedSize(g)) { out.fields.bedSize = g; out._sources.bedSize = 'globalText'; try { console.debug('[AutoList Pro CLFP] global found bedSize =', g); } catch(e){} }
                                      }
                                    }
                                  } catch(e){}

                                  // core construction: common keywords
                                  try {
                                    if (!out.fields.coreConstruction || String(out.fields.coreConstruction).trim() === '') {
                                      const coreRegexes = [ /core\s*(?:construction)?[:\s\-]*([A-Za-z0-9 \-]+)/i, /(hybrid|innerspring|memory foam|memory|latex|pocket coil|coil|foam)\b/i ];
                                      const cg = findFirst(coreRegexes);
                                      if (cg && isLikelyCoreConstruction(cg)) { out.fields.coreConstruction = cg; out._sources.coreConstruction = 'globalText'; try { console.debug('[AutoList Pro CLFP] global found coreConstruction =', cg); } catch(e){} }
                                      else if (cg) try { console.debug && console.debug('[AutoList Pro CLFP] global rejected coreConstruction =', cg); } catch(e){}
                                    }
                                  } catch(e){}

                                  // comfort level: soft/medium/firm etc.
                                  try {
                                    if (!out.fields.comfortLevel || String(out.fields.comfortLevel).trim() === '') {
                                      const comfortRegexes = [ /comfort\s*(?:level)?[:\s\-]*([A-Za-z0-9 \-]+)/i, /\b(soft|medium|firm|plush|plush feel|very firm|very soft)\b/i ];
                                      const fg = findFirst(comfortRegexes);
                                      if (fg && isLikelyComfortLevel(fg)) { out.fields.comfortLevel = fg; out._sources.comfortLevel = 'globalText'; try { console.debug('[AutoList Pro CLFP] global found comfortLevel =', fg); } catch(e){} }
                                      else if (fg) try { console.debug && console.debug('[AutoList Pro CLFP] global rejected comfortLevel =', fg); } catch(e){}
                                    }
                                  } catch(e){}
                                } catch(e) {}
                              } catch(e) {}
                              try {
                                if (pubUrlFromQuery && chrome && chrome.runtime && typeof chrome.runtime.onMessage !== 'undefined') {
                                  try { console.debug('[AutoList Pro CLFP] edit page waiting for media helper result for pubUrl=', pubUrlFromQuery); } catch (e) {}
                                  // First try to request any cached result from the background
                                  let helperMedia = null;
                                  try {
                                    helperMedia = await new Promise((res) => {
                                      try {
                                        chrome.runtime.sendMessage({ action: 'ffm_request_cached_media', pubUrl: pubUrlFromQuery, editTabId: null }, (r) => {
                                          try { if (chrome.runtime && chrome.runtime.lastError) return res(null); res(r && (r.data || r.result) ? (r.data || r.result) : null); } catch (e) { res(null); }
                                        });
                                      } catch (e) { res(null); }
                                    });
                                  } catch (e) { helperMedia = null; }

                                  // If no cached result, wait for forwarded message but only block on images.
                                  if (!helperMedia) {
                                    try {
                                      const helperTimeoutMs = 15000;
                                      // Race between helper arrival and a timeout (belt-and-suspenders)
                                      helperMedia = await Promise.race([
                                        ffmAwaitPublishedMedia(12000),
                                        new Promise(res => setTimeout(() => res({ images: [], videos: [] }), helperTimeoutMs))
                                      ]);
                                    } catch (e) { helperMedia = { images: [], videos: [] }; }
                                  }

                                  if (helperMedia) {
                                    try {
                                      const images = Array.isArray(helperMedia.images) ? helperMedia.images.map(im => {
                                        try {
                                          if (!im) return null;
                                          if (typeof im === 'string') return im;
                                          return im.src || im.currentSrc || im.url || null;
                                        } catch (e) { return null; }
                                      }).filter(Boolean) : [];

                                      const videos = Array.isArray(helperMedia.videos) ? helperMedia.videos.map(v => {
                                        try { return v && (v.src || (v.sources && v.sources[0]) || v.url) || null; } catch(e){ return null; }
                                      }).filter(Boolean) : [];

                                      console.log('[AutoList Pro CLFP] helper media received', { images: images.length, videos: videos.length });

                                      // Critical: do not block on videos only — FB video attach is async/non-deterministic
                                      if (!images.length && videos.length) {
                                        console.warn('[AutoList Pro CLFP] video-only or video-present listing — skipping media wait gate');
                                      }

                                      out.images = images.slice();
                                      out.videos = videos.slice();
                                    } catch (e) {}
                                    try { console.debug('[AutoList Pro CLFP] merged helper media counts images=', (out.images && out.images.length) || 0, 'videos=', (out.videos && out.videos.length) || 0); } catch (e) {}
                                  }
                                }
                              } catch (e) {}
                              sendFinal();
                          } catch (e) { try { sendFinal(); } catch(e){} }
                        });
                      } catch (e) { console.debug('[AutoList Pro CLFP] perform-generate-scrape call failed', e); }
                    }
                  } catch (e) {}

                  // If no response within 1200ms, just send the edit-page scrape result
                  setTimeout(() => { try { if (!responded) { console.debug('[AutoList Pro CLFP] mini-scrape did not respond, sending authoritative edit-page scrape'); sendFinal(); } } catch (e) {} }, 1200);
                } catch (e) { console.debug('[AutoList Pro CLFP] auto-scrape finalization failed', e); }
          })().catch((e) => { console.debug('[AutoList Pro CLFP] auto-scrape iife failed', e); });
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    // Also run a short-lived interval to catch SPA / late-rendered cards on initial view
    try {
  const scanInterval = 2000; // ms
  // Extend scan duration to 30 minutes (was 30s) to catch late-rendered items in long sessions
  const scanDuration = 1800000; // ms total to keep interval long-lived
      const ticker = setInterval(() => { try { scanForListings(); } catch (e) {} }, scanInterval);
      setTimeout(() => { try { clearInterval(ticker); } catch (e) {} }, scanDuration);
    } catch (e) { /* ignore */ }

    // Watch for new listings (scroll / lazy load)
    const observer = new MutationObserver(() => {
      try { scanForListings(); } catch (e) {}
    });
    observer.observe(document.body, observerConfig);

    console.debug('[AutoList Pro CLFP] MutationObserver active');
  } catch (e) { console.debug('[AutoList Pro CLFP] from_published_scraper init failed', e); }
})();
