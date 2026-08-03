(() => {
  try {
    console.log('[AutoList Pro] Active Listings overlay injected');

    // Helper: scroll the selling page so Facebook lazy-loads more listings
    async function ffmAutoScrollListings() {
      try {
        let lastHeight = 0;
        for (let i = 0; i < 8; i++) { // Scroll up to 8 times (≈ covers 50+ listings)
          window.scrollBy(0, window.innerHeight);
          await new Promise(r => setTimeout(r, 800));
          const newHeight = document.body.scrollHeight || 0;
          if (newHeight === lastHeight) break;
          lastHeight = newHeight;
        }
      } catch (e) { /* non-fatal */ }
    }

    if (document.getElementById('__ffm_active_listings_banner')) return;

    const banner = document.createElement('div');
    banner.id = '__ffm_active_listings_banner';
    banner.textContent = '🔍 Click here to Check / Sort your Active Listings';
    Object.assign(banner.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      background: '#1877f2',
      color: 'white',
      padding: '10px 16px',
      borderRadius: '8px',
      zIndex: 2147483647,
      fontSize: '14px',
      fontFamily: 'sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
    });

    banner.addEventListener('click', async () => {
      try {
        banner.textContent = '⏳ Scanning active listings...';

        // Scroll enough to render all listings
        for (let i = 0; i < 20; i++) {
          window.scrollBy(0, window.innerHeight);
          await new Promise(r => setTimeout(r, 800));
        }

        const cards = Array.from(document.querySelectorAll('[role="article"], div[aria-label][tabindex="0"]'));
        const listings = [];

        // Ignore obvious toolbar / management cards
        const ignoreWords = [
          'Manage listings','Clear','Sort by','Filters','Status',
          'Mark as sold','Mark out of stock','Mark as available','Mark as in stock',
          'Share','Renew listing','Delete & relist','Relist this item',
          'Tip: Renew your listing?'
        ];

        // clean numeric $ pattern (no letters like k/ea/+)
        const cleanPriceLine = /^\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/;
        const cleanPriceAny  = /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g;

        for (const card of cards) {
          // Collect visible lines
          const rawLines = (card.innerText || "").split("\n").map(t => t.trim()).filter(Boolean);
          if (!rawLines.length) continue;

          if (ignoreWords.some(w => rawLines[0].startsWith(w))) continue;

          // ---------- TITLE DETECTION ----------
          let title = "";
          // A) Prefer title spans that use -webkit-box (common for bold/truncated title)
          for (const el of card.querySelectorAll('span, div')) {
            const style = (el.getAttribute('style') || "").toLowerCase();
            const txt = el.innerText?.trim();
            if (!txt) continue;
            if (style.includes('-webkit-box') && txt.length > 3 && !/^\$/.test(txt)) { title = txt; break; }
          }
          // B) Fallback: bold-ish font weight
          if (!title) {
            for (const el of card.querySelectorAll('span, div')) {
              const txt = el.innerText?.trim();
              if (!txt) continue;
              const weight = parseInt(window.getComputedStyle(el).fontWeight, 10);
              if (weight >= 600 && !/^\$/.test(txt) && txt.length > 3) { title = txt; break; }
            }
          }
          // C) Last fallback: first non-$, non-status line
          if (!title) {
            title = rawLines.find(l =>
              l.length > 3 &&
              !/^\$/.test(l) &&
              !/Active|Listed|Sold|Out of stock|Pending|ago|today|yesterday/i.test(l)
            ) || rawLines[0] || "";
          }

          if (!title || ignoreWords.some(w => title.includes(w))) continue;

          // ---------- STATUS / ACTIVE ----------
          let status = "";
          for (const l of rawLines) {
            if (/Active|Listed|Sold|Out of stock|Pending|ago|today|yesterday/i.test(l)) {
              const idx = rawLines.indexOf(l);
              const next = rawLines[idx + 1] || "";
              status = `${l} ${next}`.replace(/\s+/g, " ").replace(/·/g, "").trim();
              break;
            }
          }
          const isActive = /(^|\s)(Active|In stock)(\s|$)/i.test(status) &&
                           !/Sold|Out of stock|Pending/i.test(status);

          // ---------- PRICE (closest clean $ after the title) ----------
          let price = "";

          // Find the line index of our chosen title (exact match if present)
          let titleIdx = rawLines.indexOf(title);
          if (titleIdx < 0) {
            // fallback: find line that contains most of the title's first chunk
            const chunk = title.slice(0, 24);
            titleIdx = rawLines.findIndex(l => l.includes(chunk));
          }

          // 1) Prefer first clean price line appearing AFTER the title line
          if (titleIdx >= 0) {
            const after = rawLines.slice(titleIdx + 1);
            const afterHit = after.find(l => cleanPriceLine.test(l));
            if (afterHit) price = afterHit.trim();
          }

          // 2) Otherwise, look anywhere for a clean price line
          if (!price) {
            const anyLine = rawLines.find(l => cleanPriceLine.test(l));
            if (anyLine) price = anyLine.trim();
          }

          // 3) Otherwise, search for any clean $ amount inside lines (choose the nearest after title, else the first)
          if (!price) {
            const candidates = [];
            for (let i = 0; i < rawLines.length; i++) {
              const line = rawLines[i];
              const matches = line.match(cleanPriceAny) || [];
              for (const m of matches) {
                // exclude ones with letters around (e.g., $3.5k, $400ea, $200+)
                if (/[a-z]/i.test(m)) continue;
                candidates.push({ val: m.trim(), idx: i });
              }
            }
            if (candidates.length) {
              let chosen = null;
              if (titleIdx >= 0) {
                // pick the first candidate AFTER the title line
                chosen = candidates.find(c => c.idx > titleIdx) || candidates[0];
              } else {
                chosen = candidates[0];
              }
              price = chosen.val;
            }
          }

          // 4) Last resort: if nothing clean was found, fall back to embedded numeric $ in the title (still filtered)
          if (!price) {
            const tMatch = (title.match(cleanPriceAny) || []).find(m => !/[a-z]/i.test(m));
            if (tMatch) {
              price = tMatch.trim();
              title = title.replace(price, "").replace(/\s{2,}/g, " ").trim();
            }
          }

          // 5) Absolute fallback so item still merges by title
          if (!price) price = title;

          listings.push({ title, price, status, active: isActive });
        }

        // De-duplicate by title+price
        const unique = [];
        for (const l of listings) {
          if (!unique.some(u => u.title === l.title && u.price === l.price)) unique.push(l);
        }

        console.log(`[AutoList Pro] Scraped ${unique.length} listings`, unique);
        banner.textContent = `✅ Found ${unique.length} listings`;

        // Ship to background for merge (but suppress when hidden AS is active)
        try {
          chrome.storage.local.get(['ffm_as_hidden_active'], (r) => {
            if (r && r.ffm_as_hidden_active) {
              try { console.debug('[AS:hidden] suppressed overlay ffmActiveListingsResult'); } catch (e) {}
              return;
            }
            try { chrome.runtime.sendMessage({ action: 'ffmActiveListingsResult', scraped: unique }); } catch (e) {}
          });
        } catch (e) {}

        setTimeout(() => { try { banner.remove(); } catch (_) {} }, 1500);

      } catch (err) {
        console.error('[AutoList Pro] scrape error', err);
        banner.textContent = '⚠️ Scrape failed (see console)';
      }
    });

    try { document.body.appendChild(banner); } catch (e) { try { document.documentElement.appendChild(banner); } catch (er) {} }
  } catch (e) { try { console.debug('[AutoList Pro] active_listings_overlay init failed', e); } catch (_) {} }
})();
