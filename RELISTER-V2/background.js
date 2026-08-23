// Relistify V2 — Local-First Background Service Worker
// Fully unlocked, self-contained, no external servers or payment gateways.

const MSG = {
  SCAN_LISTINGS: "rlf:scan-listings",
  REQUEST_SCAN: "rlf:request-scan",
  READ_PAGE_VAR: "rlf:page-var",
  READ_PAGE_VARS: "rlf:page-vars",
  VIDEO_DOWNLOAD_BEGIN: "rlf:video-download-begin",
  VIDEO_DOWNLOAD_CHUNK: "rlf:video-download-chunk",
  VIDEO_DOWNLOAD_END: "rlf:video-download-end",
  FETCH_SUBSCRIBER: "rlf:user",
  FETCH_PLANS: "rlf:plans",
  LAUNCH_CHECKOUT: "rlf:pay",
  LAUNCH_LOGIN: "rlf:login",
  UPDATE_BADGE: "rlf:badge"
};

// In-memory variable and video session caches
const pageVarCache = new Map();
const pendingPageVarRequests = new Map();
const videoSessions = new Map();

const SELLING_URLS = new Set([
  "/marketplace/you/selling",
  "/marketplace/seller/listings"
]);
const FB_HOSTS = new Set(["www.facebook.com", "web.facebook.com"]);
const MARKETPLACE_URL_MATCHES = [
  "https://www.facebook.com/marketplace/you/selling*",
  "https://www.facebook.com/marketplace/seller/listings*",
  "https://web.facebook.com/marketplace/you/selling*",
  "https://web.facebook.com/marketplace/seller/listings*"
];

// Always return active Pro user state
function getLocalUserState() {
  return {
    id: "local_user",
    email: "pro@relistify.local",
    paid: true,
    paidAt: new Date().toISOString(),
    installedAt: Date.now(),
    trialStartedAt: null,
    subscriptionStatus: "active",
    subscriptionCancelAt: null
  };
}

function setActionIcon(isPro = true) {
  const iconPaths = isPro
    ? { 16: "icon-gold16.png", 48: "icon-gold48.png", 128: "icon-gold128.png" }
    : { 16: "icon16.png", 48: "icon48.png", 128: "icon128.png" };
  try {
    chrome.action.setIcon({ path: iconPaths });
  } catch (e) {}
}

// Memory Cache Helpers
function getCachedVar(key, url) {
  const cacheKey = `${url}:${key}`;
  const entry = pageVarCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    pageVarCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCachedVar(key, url, value, ttlMs = 300000) {
  const cacheKey = `${url}:${key}`;
  pageVarCache.set(cacheKey, {
    value,
    timestamp: Date.now(),
    expiry: Date.now() + ttlMs
  });
}

function getCachedVars(keys, url) {
  const found = {};
  const missing = [];
  for (const k of keys) {
    const val = getCachedVar(k, url);
    if (val !== null && val !== undefined) {
      found[k] = val;
    } else {
      missing.push(k);
    }
  }
  return { found, missing };
}

// Tab and MAIN-world execution helpers
function samePageUrl(a, b) {
  try {
    const ua = new URL(a), ub = new URL(b);
    return ua.origin === ub.origin &&
           ua.pathname.replace(/\/+$/, "") === ub.pathname.replace(/\/+$/, "");
  } catch (e) {
    return false;
  }
}

async function findExistingTab(targetUrl) {
  try {
    const tabs = await chrome.tabs.query({ url: targetUrl });
    const active = tabs.find(t => t.active && t.id);
    if (active?.id) return active.id;
    const any = tabs.find(t => t.id);
    return any?.id || null;
  } catch (e) {
    return null;
  }
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      if (!finished) {
        finished = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        clearTimeout(timer);
      }
    };
    const onUpdated = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };
    const onRemoved = (removedId) => {
      if (removedId === tabId) {
        cleanup();
        reject(new Error("Tab closed before loading finished."));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Tab load timed out."));
    }, 15000);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") {
        cleanup();
        resolve();
      }
    }).catch(() => {
      cleanup();
      reject(new Error("Tab not found."));
    });
  });
}

async function openTempTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error("Failed to open background reader tab.");
  await waitForTabComplete(tab.id);
  return tab.id;
}

async function safeCloseTab(tabId) {
  try {
    await new Promise(r => setTimeout(r, 100));
    await chrome.tabs.remove(tabId);
  } catch (e) {}
}

async function executeReadScriptOnTab(tabId, keys, options) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [keys, options || {}],
    func: async (requestedKeys, opts) => {
      // 1. Inline JSON extraction from application/json scripts
      if (opts?.inline_json) {
        const scanScripts = () => {
          const values = {};
          const keySet = new Set(requestedKeys);
          const reqProp = typeof opts.required_property === "string" ? opts.required_property : "";
          let scriptsCount = 0;
          let matchedKeys = 0;

          const walk = obj => {
            if (obj && typeof obj === "object") {
              for (const [k, v] of Object.entries(obj)) {
                if (keySet.has(k)) {
                  matchedKeys += 1;
                  if (!reqProp || (v && typeof v === "object" && v[reqProp] != null)) {
                    values[k] = v;
                  }
                }
                walk(v);
              }
            }
          };

          const scriptNodes = Array.from(document.querySelectorAll('script[type="application/json"]'));
          for (const s of scriptNodes) {
            try {
              walk(JSON.parse(s.textContent || "{}"));
              scriptsCount += 1;
            } catch (e) {}
          }
          return { values, scriptsCount, matchedKeys };
        };

        const maxWait = Math.max(0, Number(opts.wait_ms) || 0);
        const deadline = Date.now() + maxWait;
        while (true) {
          const { values } = scanScripts();
          if (requestedKeys.every(k => values[k] != null)) {
            return values;
          }
          if (Date.now() >= deadline) {
            return Object.fromEntries(requestedKeys.map(k => [k, values[k] ?? null]));
          }
          await new Promise(r => setTimeout(r, 250));
        }
      }

      // 2. Facebook window.require module extraction
      const req = window.require;
      const results = {};
      for (const k of requestedKeys) {
        try {
          if (typeof req === "function") {
            const mod = req(k);
            if (Array.isArray(opts?.call_args) && typeof mod === "function") {
              results[k] = mod(...opts.call_args);
            } else if (opts?.function_name && mod && typeof mod[opts.function_name] === "function") {
              results[k] = mod[opts.function_name]();
            } else {
              results[k] = mod;
            }
          } else {
            results[k] = window[k] ?? null;
          }
        } catch (e) {
          results[k] = null;
        }
      }
      return results;
    }
  });
  return res?.result ?? {};
}

// Tabs this service worker opened purely to read page variables. Content
// scripts running inside them must never trigger another reader tab.
const readerTabIds = new Set();
// One in-flight reader tab per URL, shared by every concurrent caller.
const inFlightReaderTabs = new Map();

// Only these decide whether a read succeeded. LSD and marketplaceId are
// nice-to-have and are frequently absent on a perfectly good page — treating
// them as required is what used to send us off opening reader tabs forever.
const ESSENTIAL_PAGE_VARS = ["DTSGInitialData", "CurrentUserInitialData"];

function hasUsableVars(keys, result) {
  if (!result) return false;
  const essential = keys.filter(k => ESSENTIAL_PAGE_VARS.includes(k));
  // If the caller asked for essentials, those alone decide.
  if (essential.length > 0) return essential.every(k => result[k] != null);
  // Otherwise any answer at all is good enough.
  return keys.some(k => result[k] != null);
}

// A reader tab loading one of these runs our own content script, which calls
// straight back into here. That is what produced the runaway tab storm:
// ensureDocIds() asks for Relay operation ids that do not live on the selling
// page, the "did we get everything" check fails, we open a reader tab, and its
// content script asks for the very same missing ids. Never again.
function isContentScriptUrl(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return p.includes("/marketplace/you/selling") ||
           p.includes("/marketplace/seller/listings") ||
           p.includes("/marketplace/selling");
  } catch (e) {
    return false;
  }
}

// Absolute ceiling, independent of every other guard. If this ever trips,
// something upstream is looping and we stop rather than fill the tab strip.
const MAX_CONCURRENT_READER_TABS = 2;

async function openReaderTabOnce(url, keys, options) {
  if (inFlightReaderTabs.has(url)) return inFlightReaderTabs.get(url);

  if (isContentScriptUrl(url)) {
    console.warn("[Relistify] refusing reader tab for a content-script page:", url);
    return {};
  }

  if (readerTabIds.size >= MAX_CONCURRENT_READER_TABS) {
    console.warn("[Relistify] reader tab ceiling reached; refusing to open more.");
    return {};
  }

  const promise = (async () => {
    const tempTabId = await openTempTab(url);
    readerTabIds.add(tempTabId);
    try {
      return await executeReadScriptOnTab(tempTabId, keys, options);
    } finally {
      readerTabIds.delete(tempTabId);
      await safeCloseTab(tempTabId);
    }
  })();

  inFlightReaderTabs.set(url, promise);
  try {
    return await promise;
  } finally {
    inFlightReaderTabs.delete(url);
  }
}

async function extractPageVariables(keys, url, options, senderTab, allowReaderTab) {
  // The caller is already sitting on the page we would open. Read it in place.
  const senderIsOnTarget =
    senderTab?.id != null &&
    typeof senderTab.url === "string" &&
    samePageUrl(senderTab.url, url);

  if (senderIsOnTarget) {
    const result = await executeReadScriptOnTab(senderTab.id, keys, options);
    // Whatever that page has is all there is to have — never escalate to a
    // reader tab for a page the caller is already looking at.
    return result || {};
  }

  // A reader tab asking for its own variables must not spawn another one.
  if (senderTab?.id != null && readerTabIds.has(senderTab.id)) {
    const result = await executeReadScriptOnTab(senderTab.id, keys, options);
    return result || {};
  }

  const existingTabId = await findExistingTab(url);
  if (existingTabId != null) {
    const result = await executeReadScriptOnTab(existingTabId, keys, options);
    if (hasUsableVars(keys, result)) {
      return result;
    }
  }

  // Reader tabs are opt-in and only the relist flow opts in. Scanning the
  // selling page must never open a tab: everything it needs is on the page
  // the caller is already looking at.
  if (!allowReaderTab) {
    return {};
  }

  return openReaderTabOnce(url, keys, options);
}

async function readPageVar(key, url, options, senderTab, allowReaderTab) {
  const cached = getCachedVar(key, url);
  if (cached !== null) return cached;

  const pendingKey = `${url}:${key}`;
  if (pendingPageVarRequests.has(pendingKey)) {
    return pendingPageVarRequests.get(pendingKey);
  }

  const promise = (async () => {
    const vars = await extractPageVariables([key], url, options, senderTab, allowReaderTab);
    const val = vars[key];
    if (val != null) {
      setCachedVar(key, url, val);
      return val;
    }
    throw new Error(`Page variable "${key}" was not found on ${url}`);
  })();

  pendingPageVarRequests.set(pendingKey, promise);
  try {
    return await promise;
  } finally {
    pendingPageVarRequests.delete(pendingKey);
  }
}

async function readPageVars(keys, url, options, senderTab, allowReaderTab) {
  const { found, missing } = getCachedVars(keys, url);
  if (missing.length === 0) return found;

  const extracted = await extractPageVariables(missing, url, options, senderTab, allowReaderTab);
  for (const [k, v] of Object.entries(extracted)) {
    if (v != null) setCachedVar(k, url, v);
  }
  return { ...found, ...extracted };
}

// Convert byte array to base64 chunk
function uint8ToBase64(uint8) {
  let binary = "";
  const len = uint8.length;
  for (let i = 0; i < len; i += 32768) {
    binary += String.fromCharCode(...uint8.subarray(i, i + 32768));
  }
  return btoa(binary);
}

// Message Listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const kind = msg?.kind;
  const args = msg?.args;

  switch (kind) {
    case MSG.REQUEST_SCAN: {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { kind: MSG.SCAN_LISTINGS }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;
    }

    case MSG.FETCH_SUBSCRIBER: {
      const user = getLocalUserState();
      setActionIcon(true);
      sendResponse(user);
      break;
    }

    case MSG.FETCH_PLANS: {
      sendResponse({ paid: true, plans: [] });
      break;
    }

    case MSG.LAUNCH_CHECKOUT:
    case MSG.LAUNCH_LOGIN: {
      // Pro is always active; notify caller
      sendResponse({ ok: true, status: "active" });
      break;
    }

    case MSG.UPDATE_BADGE: {
      const staleCount = Number(args?.staleCount) || 0;
      const text = staleCount > 0 ? String(staleCount) : "";
      try {
        chrome.action.setBadgeText({ text });
        chrome.action.setBadgeBackgroundColor({ color: staleCount > 0 ? "#ef4444" : "#000000" });
      } catch (e) {}
      sendResponse({ ok: true });
      break;
    }

    case MSG.READ_PAGE_VAR: {
      const key = args?.key;
      const url = args?.url;
      const opts = args?.options;
      readPageVar(key, url, opts, sender.tab, args?.allowReaderTab === true)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message || String(err) }));
      return true;
    }

    case MSG.READ_PAGE_VARS: {
      const keys = args?.keys;
      const url = args?.url;
      const opts = args?.options;
      if (!Array.isArray(keys) || keys.length === 0) {
        sendResponse({ error: "No keys requested." });
        return true;
      }
      readPageVars(keys, url, opts, sender.tab, args?.allowReaderTab === true)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message || String(err) }));
      return true;
    }

    case MSG.VIDEO_DOWNLOAD_BEGIN: {
      const sourceUrl = args?.sourceUrl;
      const tabId = sender.tab?.id;

      if (!sourceUrl || !tabId) {
        sendResponse({ error: { message: "Invalid video download parameters." } });
        return true;
      }

      // Validate allowed domains
      try {
        const u = new URL(sourceUrl);
        if (u.protocol !== "https:" || (!u.hostname.endsWith(".fbcdn.net") && !u.hostname.endsWith(".facebook.com"))) {
          sendResponse({ error: { message: "Video host not allowed." } });
          return true;
        }
      } catch (e) {
        sendResponse({ error: { message: "Malformed video URL." } });
        return true;
      }

      // Cleanup expired video sessions
      const now = Date.now();
      for (const [id, sess] of videoSessions.entries()) {
        if (sess.expiresAt <= now) videoSessions.delete(id);
      }

      fetch(sourceUrl, {
        headers: { Range: "bytes=0-" },
        credentials: "include",
        referrer: "https://www.facebook.com/",
        referrerPolicy: "strict-origin-when-cross-origin"
      })
        .then(async res => {
          if (!res.ok) {
            sendResponse({ error: { message: `Video fetch failed: HTTP ${res.status}` } });
            return;
          }
          const blob = await res.blob();
          if (!blob.size) {
            sendResponse({ error: { message: "Empty video downloaded." } });
            return;
          }
          const sessionId = crypto.randomUUID();
          videoSessions.set(sessionId, {
            blob,
            tabId,
            expiresAt: Date.now() + 600000
          });
          sendResponse({ sessionId, size: blob.size, type: blob.type || "video/mp4" });
        })
        .catch(err => {
          sendResponse({ error: { message: err.message || "Video download failed." } });
        });
      return true;
    }

    case MSG.VIDEO_DOWNLOAD_CHUNK: {
      const sessionId = args?.sessionId;
      const start = Number(args?.start);
      const end = Number(args?.end);
      const session = videoSessions.get(sessionId);

      if (!session || session.tabId !== sender.tab?.id || session.expiresAt <= Date.now()) {
        if (sessionId) videoSessions.delete(sessionId);
        sendResponse({ error: { message: "Video download session expired." } });
        return true;
      }

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > session.blob.size) {
        sendResponse({ error: { message: "Invalid chunk boundaries." } });
        return true;
      }

      session.blob.slice(start, end).arrayBuffer().then(buf => {
        const u8 = new Uint8Array(buf);
        sendResponse({ data: uint8ToBase64(u8) });
      }).catch(err => {
        sendResponse({ error: { message: err.message || "Chunk slice failed." } });
      });
      return true;
    }

    case MSG.VIDEO_DOWNLOAD_END: {
      const sessionId = args?.sessionId;
      if (sessionId && videoSessions.has(sessionId)) {
        const sess = videoSessions.get(sessionId);
        if (sess.tabId === sender.tab?.id) {
          videoSessions.delete(sessionId);
        }
      }
      sendResponse({ ok: true });
      break;
    }

    default:
      break;
  }
  return true;
});

// Tab update listener: auto scan when Selling page finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    try {
      const u = new URL(tab.url);
      if (FB_HOSTS.has(u.hostname)) {
        const normalizedPath = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
        if (SELLING_URLS.has(normalizedPath)) {
          chrome.tabs.sendMessage(tabId, { kind: MSG.SCAN_LISTINGS }).catch(() => {});
        }
      }
    } catch (e) {}
  }
});

// Extension Action Click: Open or navigate to Selling page
chrome.action.onClicked.addListener(async () => {
  const sellingUrl = "https://www.facebook.com/marketplace/you/selling/";
  const tabs = await chrome.tabs.query({ url: MARKETPLACE_URL_MATCHES });
  if (tabs[0]?.id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.tabs.reload(tabs[0].id);
  } else {
    await chrome.tabs.create({ url: sellingUrl, active: true });
  }
});

// Initialize gold icon
setActionIcon(true);
console.log("Relistify V2 service worker initialized in local Pro mode.");