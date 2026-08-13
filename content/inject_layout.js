// inject_layout.js
// Lightweight in-page layout injected by background to host scheduler UI directly on the FB selling page.
(function(){
  try {
    // Avoid injecting multiple times
    if (window.__ffm_inject_layout_installed) return;
    window.__ffm_inject_layout_installed = true;

    // Create a minimal overlay container
    const container = document.createElement('div');
    container.id = 'ffm-inject-layout-root';
    container.style.position = 'fixed';
    container.style.right = '12px';
    container.style.bottom = '12px';
    container.style.zIndex = 2147483647; // top-most
    container.style.background = 'rgba(0,0,0,0.75)';
    container.style.color = '#fff';
    container.style.padding = '8px';
    container.style.borderRadius = '8px';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.fontSize = '13px';
    container.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
    container.style.maxWidth = '320px';
    container.style.minWidth = '200px';

    const title = document.createElement('div');
    title.textContent = 'AutoList Pro Scheduler';
    title.style.fontWeight = '600';
    title.style.marginBottom = '6px';
    container.appendChild(title);

    const status = document.createElement('div');
    status.id = 'ffm-inject-layout-status';
    status.textContent = 'Ready';
    status.style.opacity = '0.9';
    container.appendChild(status);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.marginTop = '8px';
    closeBtn.style.padding = '4px 8px';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = function(){ try { container.remove(); } catch(e){} };
    container.appendChild(closeBtn);

    document.body.appendChild(container);

    // Send handshake to background via runtime message to mark tab ready
    try { chrome.runtime.sendMessage({ action: 'ffm_iframe_ready' }); } catch (e) {}

    // Respond to pings
    try {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        try {
          if (!msg) return;
      if (msg.action === 'ffm_probe_ping') {
        try { sendResponse && sendResponse({ ok: true }); } catch (e) {}
        // Synchronous response only; indicate no async response will follow
        return false;
          }
        } catch (e) {}
      });
    } catch (e) {}

  } catch (e) { console.debug('inject_layout install failed', e); }
})();
