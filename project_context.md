# Fast4MP — Project Context & Working Specification
Comprehensive reference for all development inside this ChatGPT Project.

---

## 📌 Overview: What is Fast4MP?

Fast4MP (Fast Facebook Marketplace Automation) is a multi-component Chrome extension + local toolchain that automates high-volume listing management on Facebook Marketplace.  

It is used to:
- Create new marketplace listings  
- Delete and re-publish (“Delete and Relist” / DnR)  
- Maintain accurate Active Listings (AL) and Saved Listings (SL)  
- Assist with inventory workflows, especially Sharetown-style reselling  
- Reduce repetitive manual FB listing creation steps  
- Automate image selection, pricing, delivery types, and metadata filling  

The extension must behave like a **real human user** and stay within FB UI constraints.  
Stability and zero crashes are priority #1.

---

# 📚 ACRONYMS (All used throughout Fast4MP)

### Core Actions
- **AS** – Active Sync  
- **AAS** – Auto Active Sync  
- **DnR** – Delete and Relist  
- **SL** – Saved Listings  
- **AL** – Active Listings  

### UI Modes
- **CLST** – Create Listing (Sharetown Template)  
- **CLFP** – Create Listing From Page  
- **CFST** – Create From Sharetown Template  
- **CLFP_ACTIVE** – Popup status when CLFP mode is active  

### Data / State / Files
- **ffm_saved_listings** – The master Saved Listings array in chrome.storage  
- **ffm_staged_listing** – Staged listing ready for publish/relist  
- **ffm_pub_delivery_* ** – Delivery options storage during publish  
- **ffm_publish_cleanup_* ** – Alarm used to clean leftover publishing state  
- **ffm_relist_payload** – Slim payload injected for relist publish stage  

### Messaging / Debug
- **ffm_content_ready** – Content script announces injection is complete  
- **ffmActiveListingsUpdate** – Active sync results  
- **ffm_refresh_* ** – Signals popup refresh  
- **force-auto** – Flag used to auto-fill publish flows  
- **publish-trace** – Debug event messages from publish logic  

---

# 🏛 Fast4MP Architecture Overview

Fast4MP is built from several major components:

---

## **1. popup_main.js**
Controls:

- The entire popup UI  
- Saved Listings rendering (SL)  
- Sort + Filter + Defer/Lock logic  
- MutationObservers on state toggles  
- Scheduling refresh cycles  
- Publish initiation (sending the “publish-listing” message to BG)  
- DnR initiation (sending “ffmDeleteListing”)  
- Managing CLFP/CLST/CFST modes  
- Avoids double-renders and loops

Popup rules:
- Must NEVER freeze or crash  
- Must NEVER double-run renders  
- Must debounce storage changes  
- Must detect identical storage writes and skip  

---

## **2. background.js**
The heart of Fast4MP automation.  
Performs:

### **Publish Flow**
- safeTabsCreate for FB create-item page  
- Wait for content_ready  
- Inject populate-fb messages  
- Retry-safe messaging  
- Publish completion detection  
- Delivery options injection  
- Cleanup via publish-cleanup alarm  

### **Delete and Relist (DnR)**
- Delete original listing  
- Wait for confirmation  
- Open new tab for publish  
- Inject slim relist payload  
- Retry messaging until stable  
- Prevents popup crash during the FB React unmount/remount transitions  

### **Active Sync**
- Open “Your Listings”  
- Scrape active cards  
- Merge flags into SL  
- Save back into chrome.storage  

### **Messaging Router**
Ensures background receives:
- ffm_content_ready  
- publish-trace  
- populate-fb-ready  
- ffm_refresh_popup  
- ffmActiveListingsMerged  

### **State Locks**
- Publish locks  
- DnR chain guards  
- Double-open prevention  

---

## **3. content_main.js**
Handles all DOM-level automation:

- Scraping Active Listings page  
- Extracting fields (title, price, condition, category, shipping, etc.)  
- Clicking NEXT buttons  
- Handling weird FB React transitions  
- Detecting which page the user is on  
- Publishing form fill:
  - title
  - description
  - category guessing
  - delivery type
  - price
  - “hide from friends”
- Injecting relist data fields  
- Buttons for image-selection overlay  
- Overlay UI for “Choose images to publish”  
- Detecting multi-layout Marketplace changes  

Content script rules:
- Must ALWAYS reply if it says “return true”  
- Must NEVER leave message channels unresolved  
- Should survive FB React reloads  
- Should be idempotent  

---

# 🩹 Known Issues (As of 2025-02)

### ❗ 1. DnR Publish Step Crash
- FB unloads and reloads create-item page  
- content_main.js detaches temporarily  
- background.js sends message → channel closes → crash  
- Requires robust retry message injector (`safeSendMessage()` or improved version)

### ❗ 2. Active Sync → Popup SL not refreshing
- AS updates backend  
- Popup doesn't always show changes until reload  
- Caused by storageChange debounce or identical-write bypass  
- Needs consistent `ffmRefreshSavedListings` behavior  

### ❗ 3. CLST / CFST freeze after publishing
- Popup enters mode state but never exits  
- Likely missing a return-to-home state trigger  
- Requires tracing popup state flags  

### ❗ 4. StorageChange Loops
- Popup previously reacted to identical data  
- Caused multiple renders  
- Needed JSON.stringify guard (recently implemented)  

### ❗ 5. Some FB layouts have duplicate images overlapping
- Users must select thumbnails  
- Overlay buttons not always hidden  
- Possibly from stacking of image grids  

---

# ⚙ Development Rules / Preferences

### ✔ Patches, not rewrites  
User prefers incremental patches — do **NOT** rewrite full files unless explicitly told.

### ✔ Maintain original structure  
Respect folder layout:
/background.js
/popup/popup_main.js
/content/content_main.js

yaml
Copy code

### ✔ Keep console logs  
Debug logs are helpful and should remain unless cleaning is requested.

### ✔ Use “stable messaging patterns”  
Always wrap Chrome messages to content scripts using retry-safe logic.

### ✔ Avoid breaking SL rendering  
SL performance is important  
Avoid loops, multiple renders, or duplicate triggers.

### ✔ Maintain backward-compatible behavior  
New fixes should not remove working functionality (CLFP, AS, Publish, DnR, etc).

### ✔ Do not modify Manifest unless requested  
Manifest is stable and correct unless major features added.

---

# 🚦 Development Checklist (Active)

This section lists what we are currently working on:

### [ ] Stabilize DnR Publish Retry Logic  
### [ ] Fix Active Sync SL Refresh Delay  
### [ ] Re-test CLFP & CFST interactions  
### [ ] Ensure popup state resets after publish  
### [ ] Finalize safeSendMessage for:
- sendPopulateMessageToTab  
- injectRelistPayload  
- ensureStagedThenSend  
- publishListingById  

### [ ] Confirm no storageChange loops remain  
### [ ] Full extension-wide functional test  
### [ ] Long-term cleanup (after stability achieved)

---

# 🗃 File Map (Reference)

/background.js
/content/content_main.js
/popup/popup_main.js
/popup/popup_ui.js
/popup/popup_events.js
/popup/popup_probe.js
/images/*.png
/css/popup.css
/manifest.json

yaml
Copy code

---

# 🧠 Summary

This file defines:
- All acronyms  
- Complete architecture  
- Known issues  
- Debugging history  
- Coding rules  
- Future tasks  
- How ChatGPT should behave when working on Fast4MP  

Keep this file updated at major milestones.