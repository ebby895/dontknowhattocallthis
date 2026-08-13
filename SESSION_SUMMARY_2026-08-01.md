# AutoList Pro — Session Summary (2026-08-01)

## 1. Reload keyboard shortcut + Windows notification
- Added a `Ctrl+Shift+Space` global shortcut (`manifest.json` → `commands.reload-extension`, `"global": true`) that reloads the extension from anywhere, without needing `chrome://extensions` open.
- `background.js` handles the command via `chrome.commands.onCommand`, stamps a `ffm_reload_toast_pending` timestamp before reloading.
- On the fresh restart, `background.js` checks that flag and fires a real Windows notification ("AutoList Pro — Extension reloaded") near the system clock — this works regardless of whether the side panel is open (an earlier in-page-toast attempt didn't, since it depended on the panel being visible).
- Known quirk: Chrome sometimes drops a `"global": true` shortcut back to "Not set" after a reload. Fix each time: `chrome://extensions/shortcuts` → pencil icon → retype `Ctrl+Shift+Space`.

## 2. Bug fix: category/description/photos vanishing on load
Root cause: after removing the Retail Price field from `popup.html`, one line in the "load saved listing into form" handler (`popup_main.js`) set `retailPriceInput.value = ...` without a null-check — since the element no longer existed, this threw and silently killed every line after it in that function: category select, `ffmLoadSavedListingIntoForm()` (photos/videos), and the description textarea never ran. Fixed by wrapping in `if (retailPriceInput)`.

This is the **third** time this exact failure shape has hit this codebase this session — removing/renaming a DOM element and leaving one unguarded reference to it kills everything downstream in whatever function contains it.

## 3. Active Sync — how it actually works (researched, not guessed)
- Live implementation: `ffmUpdateActiveListingFlags()` in `popup_main.js`, triggered by the "🔄 Active Sync" button.
- Sets `isActive`/`active`/`ffm_flag_active`, `fbStatusRaw`, `fbListedDays`/`listedDaysAgo`, `fbListedText`, `lastCheckedTs`.
- Age-tier badge coloring: 🟢 0-3 days, 🟡 4-5 days, 🔴 6+ days, 🔘 active-but-unparseable-date.
- Added `lastSyncAttemptTs` to the full-scan reset pass so "confirmed not active" can be told apart from "never synced."
- There's a second, **dead** implementation in `content_main.js` wired to hidden buttons — not used by the live UI, safe to ignore (or clean up later).

## 4. New feature: selective Export Listings
- Old "Export All Existing Listings" button replaced with **📤 Export Listings…**, now living in the Saved Listings toolbar next to 🔄 Active Sync and 🔁 Relist Multiple (moved there per request).
- Opens a checkbox picker (`showBulkListingActionModal`) — Check All / Uncheck All, "Only Active Listings," "Only Listings Not Published Yet," or hand-pick.
- If no backup folder is connected yet, clicking it now opens the folder picker immediately instead of failing silently in a menu section you might not have open.
- Shows a floating **Cancel** button (bottom of screen, works from any section) while exporting — stops queueing more, doesn't roll back what's already written.
- Writes a plain-language `activity_log.txt` to the connected folder (e.g. `Exported OK: "Blue Sofa"`).

### Real bug found and fixed: exports had zero photos
Found by physically inspecting exported files on disk: 119 exported listings, every `listing.json` correctly showing `imageCount: 2+`, but **zero** photo files anywhere. Root cause in `ffmResolveListingMediaForExport()`: it only pulled from mediaDB for listings whose `images` array already had placeholder entries — for listings where that array was empty (real photos lived only in mediaDB via `localImageKeys`), the resolver never even queried mediaDB. Fixed to fall back to mediaDB's full blob list when the array is empty. This is the **fourth** instance this session of the same root pattern: treating `listing.images` as authoritative instead of querying mediaDB directly.

## 5. New feature: Bulk Delete/Relist
- **🔁 Relist Multiple…** button, scoped to currently-active listings only (Delete/Relist doesn't apply to unpublished ones).
- Same checkbox picker, plus a "days old or older" auto-select filter.
- Loops the existing single-listing `handleDeleteAndRelist()` — reuses its already-safe, paced background scheduler; no new Facebook automation was written.
- Cancel button here only stops queueing *more* listings — anything already sent to the background has a `chrome.alarms` entry firing ~1 second later and can't be pulled back. Confirmed via code read: alarms persist across popup refresh and even full extension reload, so "cancel then refresh" doesn't help either. Left as-is per explicit instruction not to build true mid-flight cancellation.

## 6. Advanced Scheduler redesigned (bulk instead of per-listing wizard)
- Old flow was a 3-step wizard (pick one listing → configure rule → review/save), repeated per listing.
- New "Create Advanced Schedule" screen: rule config (days active / time of day / repeat) at the top, a checkbox list of every active listing below, one Save button applies the rule to all checked listings.
- Any listing that already has a schedule shows a **red warning** under its name (e.g. "⚠ Already scheduled: relists after 1 day(s) active, at 09:00, repeats forever — next run: ...") so a second overlapping schedule can't be created by accident.
- The old 3-step wizard still exists, only used now for editing one already-existing single schedule.
- Save logic refactored into a reusable `ffmADSSaveRuleForListing()` shared by both the bulk screen and the single-edit path.

## 7. Cross-device export/import troubleshooting (PC ↔ laptop)
Two separate issues diagnosed:
- **Folder confusion, not a bug**: a folder named "Active" the user found also belongs to a different installed extension ("Crosslister by Flyp") — confirmed via its `listing.json` containing `flyp_id`/`fb_listing_id` fields and bare-numeric photo filenames (`0.jpg`, `1.jpg`) instead of AutoList_Pro's own `photo_1.jpg` format. Importing from it "worked" (found listings by coincidence) but skipped every photo.
- **Real bug**: covered in section 4 above — now fixed.
- AutoList_Pro's own real local export folder on this PC: `#EXTENSION\#AutoList_Pro Backup Listing\AutoList_Data\`.

## 8. Backups
- `C:\Users\VPS\Documents\#extension\` is synced live to Google Drive (mounted here as `G:\My Drive\#EXTENSION`) — confirmed by checking a backup zip made seconds earlier already appearing there. No separate Drive upload step needed; the existing backup-zip habit already covers it.
- Latest backup: `AutoList_Pro_backup_20260801_163849_after_scheduler_and_export_fix.ZIP`.

## Files touched this session
- `manifest.json` — reload shortcut command
- `background.js` — reload command handler, reload notification, (from earlier: media-lookup fallback fix)
- `popup/popup_main.js` — retail price crash fix, bulk selection modal, Export Listings rewrite + relocation, Bulk Delete/Relist, floating progress/cancel bar, media export fix, `lastSyncAttemptTs`
- `popup/popup_scheduler.js` — bulk schedule-create screen, refactored save logic
- `lib/fs_local.js` — `appendLogLines()` for the activity log
- `popup.html` — Export button removed from Local Backup Folder section, help text updated
