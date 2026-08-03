// Lightweight stub for popup dashboard features
// Created to avoid net::ERR_FILE_NOT_FOUND and to provide a simple ack path for DnR messages.
(function(){
  try { console.debug('[AutoList Pro popup-dashboard] loaded'); } catch (e) {}
  // Listen for a simple ack request from popup scripts and reply if needed
  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
          if (!msg) return false;
          if (msg.type === 'ffm_ping_dashboard') {
            try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
            return true;
          }
        } catch (e) {}
        return false;
      });
    }
  } catch (e) {}
})();
