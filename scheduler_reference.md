# Scheduler Reference — Fast4MP

Generated: December 2025 — extracted scheduler code and summaries from the repo.

## Purpose
This document collects the key code blocks and flow for Scheduled Publish (SP), Scheduled Delete & Relist (SDnR / DnR), alarms, and the popup ↔ background handshake used by Fast4MP.

Files referenced:
- popup/popup_main.js — popup-side handlers, schedule modal, save flow, popup message handlers
- background.js — alarm creation, onAlarm listeners, scheduler execution (`executeScheduledTask`)

---

## High-level flow
- Scheduling a task (publish or relist) is done via the popup schedule UI; the popup stages large publish payloads under `ffm_publish_<id>` and persists a `task` into `scheduled_tasks` in `chrome.storage.local`, then messages background to create an alarm.
- Background creates a Chrome alarm (name `ffm_schedule_<task.id>`), which later triggers `chrome.alarms.onAlarm`.
- On alarm, background loads the task from `scheduled_tasks` and calls `executeScheduledTask(task)`.
- For `publish` tasks, background attempts a popup relay handshake:
  - Background writes a request token `ffm_schedule_ack_req_<task.id>` and sends `ffm_run_popup_publish` with `ackToken`.
  - The popup, upon locating the matching saved listing and about to start publish, writes `ffm_schedule_ack_ack_<task.id>` = `ackToken` and sets a persistent inflight marker `ffm_publish_inflight_<task.id>`.
  - Background polls for the ack (short timeout). If popup claimed task, background skips its own publish. Otherwise background proceeds with staged publish or listing lookup + `publishListingById`.
- For DnR/SDnR, background may schedule a quick alarm `dnr_<ts>` and on alarm it executes the relist path (via `executeScheduledTask` or SDnR helper). Popup has handlers for popup-initiated DnR but ignores scheduled DnR UI triggers.

---

## Popup: Scheduled Publish handler (excerpt)
Location: `popup/popup_main.js`

```javascript
// Background requested per-card Publish
if (msg.type === 'ffm_run_popup_publish') {
  // ----- Fast4MP: Scheduled Publish Signal -----
  if (msg.scheduleTaskId) {
      console.log("[Fast4MP popup] Scheduler run detected — forcing auto-publish path");
      try {
        window.ffm_is_scheduled_publish = !!msg.scheduleTaskId;
        // persist scheduled listing id optionally
        window.ffm_scheduled_listingId = (msg && msg.listing && (msg.listing.listingId || msg.listing.id)) || null;
      } catch (e) {}
  }

  try {
    const taskId = msg.scheduleTaskId;
    const ackToken = msg.ackToken;
    // find matching saved-listing card by normalized title/inventoryName
    const match = /* DOM search logic */;

    if (!match) return { ok: false, reason: 'not-found' };

    const btn = match.querySelector('.publish-btn, .ffm-publish-btn, button.publish');
    if (btn && typeof btn._ffm_handlePublish === 'function') {
        // Persist ack + inflight marker then call handler
        if (taskId && ackToken) {
          const ackKey = 'ffm_schedule_ack_ack_' + taskId;
          const inflKey = 'ffm_publish_inflight_' + taskId;
          const toWrite = {};
          toWrite[ackKey] = ackToken;
          toWrite[inflKey] = { ts: Date.now(), token: ackToken };
          chrome.storage.local.set(toWrite, () => {
            try { btn._ffm_handlePublish(); } catch (e) {}
          });
        } else {
          try { btn._ffm_handlePublish(); } catch (e) { return { ok: false, error: String(e) }; }
        }
      return { ok: true };
    }
    // fallback: click the button and write ack/inflight as above
  } catch (e) { return { ok: false, error: String(e) }; }
}
```

Notes: popup writes `ffm_schedule_ack_ack_<taskId>` and `ffm_publish_inflight_<taskId>` to claim the scheduled publish. Background polls for the ack token before attempting its own publish.

---

## Popup: Scheduled DnR (SDnR) handler (popup ignores scheduled UI DnR)
Location: `popup/popup_main.js`

```javascript
// Background requested per-card Delete/Relist (DnR) via popup UI
if (msg.type === 'ffm_run_popup_dnr') {
  // If this trigger came from a scheduled task, ignore it — SDnR must not invoke the popup DnR flow.
  try {
    if (msg && msg.scheduleTaskId) {
      sendResponse && sendResponse({ ok: false, reason: 'ignored-scheduled' });
      return;
    }
  } catch(e){}

  // Otherwise, poll saved-listings to find the card, then find .dnr-btn and invoke it.
  // If taskId && ackToken provided, write:
  //   ffm_schedule_ack_ack_<taskId> = ackToken
  //   ffm_dnr_inflight_<taskId> = { ts: Date.now(), token: ackToken }
}
```

The popup flow waits up to ~10s for the listing card and handler to exist, then clicks/invokes the DnR handler.

---

## Background: Schedule DnR → SDnR (creating a quick scheduled task)
Location: `background.js` (message handler)

```javascript
// msg.action === "ffm_schedule_dnr_as_sdnr"
const when = Date.now() + 1000; // fire in ~1s
const taskId = 'dnr_' + when;
const task = {
  id: taskId,
  listingId,
  inventoryName,
  listingTitle,
  action: 'relist',
  when,
  timeISO: new Date(when).toISOString()
};

// Persist into scheduled_tasks (de-dup by id)
chrome.storage.local.get({ scheduled_tasks: [] }, (res) => {
  const arr = Array.isArray(res.scheduled_tasks) ? res.scheduled_tasks : [];
  const cleaned = arr.filter(t => !(t && String(t.id) === String(task.id)));
  cleaned.push({ id: String(task.id), taskId: String(task.id), listingId: task.listingId || null, when: when, timeISO: task.timeISO || null, action: task.action || 'relist', inventoryName: task.inventoryName || null, payload: null });
  chrome.storage.local.set({ scheduled_tasks: cleaned });
});

// Create the alarm named 'ffm_schedule_' + task.id
const alarmName = 'ffm_schedule_' + task.id;
chrome.alarms.create(alarmName, { when });
```

Background stores `['ffm_schedule_created_' + task.id]` metadata and logs alarms.getAll for debugging.

---

## Background: onAlarm handling (high-level)
Location: `background.js`

```javascript
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm || !alarm.name) return;

  // Detect quick DNR alarms prefixed with 'dnr_' and run SDnR handler
  if (alarm.name.startsWith('dnr_')) {
    // lookup persisted scheduled task record (various fallback maps)
    // call executeScheduledTask(task) or ffmRunSDNRFlow(task)
    // remove task from maps and persist
    return;
  }

  // Normal scheduled tasks use alarm name 'ffm_schedule_<taskId>'
  if (!alarm.name.startsWith('ffm_schedule_')) return;
  const taskId = alarm.name.slice('ffm_schedule_'.length);
  chrome.storage.local.get({ scheduled_tasks: [] }, async (res) => {
    const tasks = res.scheduled_tasks || [];
    const ix = tasks.findIndex(t => t && String(t.id) === String(taskId));
    if (ix < 0) return;
    const task = tasks[ix];
    const result = await executeScheduledTask(task);
    // if result.keep !== true, remove the task; else persist updates
  });
});
```

The onAlarm handler also performs 'stale alarm suppression' (if alarm fired much later than scheduled it logs a missed run and may mark missed-run state and skip execution).

---

## Background: `executeScheduledTask` wrapper and implementation
Location: `background.js`

```javascript
// Wrapper (early) — prevents duplicate runs via in-memory Set
var _ffm_recentlyExecuted = new Set();
var executeScheduledTask = async function(task) {
  if (!task || !task.id) return false;
  const idKey = String(task.id);
  if (_ffm_recentlyExecuted.has(idKey)) return false;
  _ffm_recentlyExecuted.add(idKey);
  setTimeout(() => { _ffm_recentlyExecuted.delete(idKey); }, 10000);
  if (typeof __ffm_executeScheduledTask_impl === 'function') return await __ffm_executeScheduledTask_impl(task);
  return false;
};

// Real implementation later assigned to __ffm_executeScheduledTask_impl
__ffm_executeScheduledTask_impl = async function(task) {
  if (!task || !task.action) return false;
  // Block Active Sync while running: set global __ffm_block_as = true
  if (task.action === 'publish') {
    // Attempt popup handshake: write reqKey 'ffm_schedule_ack_req_<id>' with token
    // sendMessage type 'ffm_run_popup_publish' with ackToken
    // wait up to ~4s for popup to write ackKey == token
    // if ack received -> popup will handle publish and background returns
    // else check persistent inflight 'ffm_publish_inflight_<id>' (recent) and skip if present
    // else background attempts publish via pre-staged ffm_publish_<publishRequestId> or by looking up listing by inventoryName and calling publishListingById
  }
  // other actions handled similarly
};
```

Notes: publish branch contains careful staging and transfer of inflight markers so background and popup avoid double-running the publish. It also handles pre-staged payloads referenced by `task.publishRequestId`.

---

## Popup schedule modal & save flow (creation of scheduled tasks)
Location: `popup/popup_main.js`

Key functions: `openScheduleModalForListing(listing, opener)` and `saveScheduledTask()`

- `openScheduleModalForListing` sets sane defaults (next full minute), sets `scheduleAction` to 'publish' by default, reads `schedule_hide_warning` preference, and shows the modal.
- `saveScheduledTask` builds a small `task` object (id, listingId, inventoryName, listingTitle, action, timeISO, when). If action === 'publish', it stages the full listing into `ffm_publish_<publishRequestId>` (with a fallback stripLargeDataUrls on failure), and stores `task.publishRequestId`. Then it persists `scheduled_tasks` (array) and calls `ffmSendMessage({ action: 'schedule-task', task })` to tell background to create the alarm.

---

## Next steps / options
- I saved this document as `scheduler_reference.md` in the workspace root (`c:\Users\Taylor\Documents\scheduler_reference.md`).
- I can add direct file/line links to each snippet, or extract the full `__ffm_executeScheduledTask_impl` publish branch and helper functions like `publishListingById` and `ffmRunSDNRFlow` if you want full runnable context.

---

End of document.
