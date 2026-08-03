# Fast4MP Extension Audit & Patches

Generated: automated pass

## Inventory
Files included in patched package:
- manifest.json (cleaned / lowercased)
- background.js (original)
- content.js (original, large)
- popup.html / popup.js / styles.css (original)
- pageClickHelper.js (NEW) - helper to inject into page (MAIN world)
- inject_click_helper.js (NEW) - example injector snippet
- audit_report.md (this file)

## High-priority fixes applied
1. **Renamed manifest to `manifest.json`** to avoid install issues on case-sensitive filesystems.
2. **Added `pageClickHelper.js`**: injection helper that tries dispatch chain, React fiber invocation, and keyboard fallback.
3. **Provided `inject_click_helper.js`**: example of how to inject the helper into the page using `chrome.scripting.executeScript` (world: 'MAIN').

## Recommended further work (prioritized)
1. **Modularize `content.js` and `popup.js`**:
   - Break into `src/` with smaller modules for selectors, UI, Facebook-specific operations, storage, and background comms.
   - Keep a `dist/` that bundles/minifies for release.
2. **Narrow host permissions**:
   - Current manifest was adjusted to explicitly include `https://www.facebook.com/*` and `https://m.facebook.com/*`.
   - If you need other sites, prefer `optional_host_permissions` and request at runtime.
3. **Add robust retry and mutation observation for UI actions**:
   - The provided helper does basic waiting; for complex flows, extend to observe specific DOM changes that indicate success.
4. **Improve logging**:
   - Use `chrome.storage.local` to store debug logs when debug mode is enabled, and add UI to the popup to download logs.
5. **Security review**:
   - Search for `eval`, `new Function`, and unsanitized `innerHTML`. Replace with safer DOM APIs and templating.
6. **CSP fixes**:
   - Move inline JS from popup.html into popup.js. Ensure all external files are included in manifest web_accessible_resources if needed in page context.

## File-specific notes
- **content.js (~240 KB)**: large file, likely contains all Facebook selectors and automation logic. It is the best candidate for splitting and cleaning. I recommend we create a smaller wrapper that calls the injected `pageClickHelper` for any click operations that must run in MAIN world.
- **background.js**: ensure calls to `chrome.scripting.executeScript` target the correct `tabId` and specify `world: 'MAIN'` when you need page context.
- **popup.js**: large; ensure it doesn't rely on `chrome.tabs.executeScript` (deprecated) and uses `chrome.scripting`.

## Next deliverables I included
- A patched folder with the new helper files (see `pageClickHelper.js` and `inject_click_helper.js`).
- A cleaned `manifest.json` (keeps all original keys but ensures lowercase filename and includes recommended minimal permissions and host permissions).

If you want, I can now:
- Patch `background.js` to include an example function `clickMarketplaceNext(tabId)` that injects `pageClickHelper.js` then calls it (and write the patched background.js).
- Split `content.js` into modules and produce a cleaned `src/` structure (this is more invasive).
- Add logging utilities and popup UI changes.

Tell me which of those to apply next; I can modify files now and produce an updated zip.