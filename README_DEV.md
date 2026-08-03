# 🧾 Fast4MP Developer Guide

## 🚀 Project Overview
Fast4MP is a Chrome extension for Sharetown Marketplace automation with AWS backend integration.
This version uses a **modularized structure** for easier debugging and future Manifest V3 compliance, while maintaining full compatibility with the original logic.

---

## 🧩 File & Folder Guide

### Root
| File | Purpose |
|------|----------|
| `manifest.json` | Chrome manifest (Manifest V3 hybrid) |
| `background.js` | Handles background tasks, messaging, AWS requests |
| `styles.css` | Shared popup styling |
| `help.html`, `help.js` | Help section for users |
| `qrcode.min.js` | QR code generator |
| `images/` | All icons and UI images |

### popup/
| File | Description |
|------|--------------|
| `popup_helpers.js` | Reusable helper functions for popup logic |
| `popup_ui.js` | Handles DOM updates, labels, layout rendering |
| `popup_events.js` | Manages event listeners and button actions |
| `popup_main.js` | Entry point; initializes popup and coordinates modules |

**Load order:**  
Defined in `popup.html` → helpers → ui → events → main  
✅ Keeps debugging easy (`console.log` traces in each file)

### content/
| File | Description |
|------|--------------|
| `dom_helpers.js` | DOM selectors and manipulation tools |
| `scrape_actions.js` | Handles scraping, mutations, or automation steps |
| `event_bridge.js` | Communicates with background.js via runtime messaging |
| `content_main.js` | Entry point for content logic, coordinates modules |

---

## 🪶 Debugging Tips
1. **Open Chrome DevTools:**
   - For popup: Right-click → *Inspect popup*
   - For content: *Inspect page → Console tab*
2. **Look for log headers:**
   Each module logs when loaded, e.g.  
   ```
   [Fast4MP] popup_ui.js loaded
   ```
   This helps confirm that load order is correct.
3. **Keep filenames consistent.**
   If you rename a script, update it in `popup.html` or `manifest.json`.

---

## ⚙️ AWS Backend
Your AWS Lambda code lives in `/aws-backend/`.  
To deploy:
```bash
cd aws-backend
sam build
sam deploy --guided
```

---

## 🧠 Future Migration to Full Manifest V3
When ready to modernize:
1. Change popup script tags to:
   ```html
   <script type="module" src="popup/popup_main.js"></script>
   ```
2. Replace script includes with ES6 imports:
   ```js
   import './popup_helpers.js';
   import './popup_ui.js';
   import './popup_events.js';
   ```
3. Add to `manifest.json`:
   ```json
   "web_accessible_resources": [{
     "resources": ["popup/*.js", "content/*.js"],
     "matches": ["<all_urls>"]
   }]
   ```

---

## 🧰 Recommended Dev Tools
- **Prettier + ESLint:** consistent formatting  
- **VSCode Chrome Extension Pack:** debugging tools  
- **Source maps:** optional if you adopt Rollup/Vite later
