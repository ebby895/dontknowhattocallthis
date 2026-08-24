// Relistify V2 — Popup Script
// Immediate & resilient event binding

function initPopup() {
  const versionEl = document.getElementById("version");
  if (versionEl && chrome.runtime?.getManifest) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  const openBtn = document.getElementById("go-to-marketplace");
  if (openBtn) {
    openBtn.onclick = handleOpenMarketplace;
  }
}

async function handleOpenMarketplace(e) {
  if (e) e.preventDefault();
  
  const openBtn = document.getElementById("go-to-marketplace");
  if (openBtn) {
    openBtn.style.opacity = "0.75";
    openBtn.textContent = "Opening...";
  }

  // Always open a fresh tab. Reusing an existing Marketplace tab meant the
  // scan could start against a half-navigated page (and clobbered whatever
  // the user had open there).
  // Filtered + sorted view, taken from the user's own capture script: live and
  // in-stock only, newest first. Fewer irrelevant cards for the scan to sift.
  const targetUrl = "https://www.facebook.com/marketplace/you/selling?" +
    "state=LIVE&status[0]=IN_STOCK&order=CREATION_TIMESTAMP_DESC";
  try {
    await chrome.tabs.create({ url: targetUrl, active: true });
  } catch (err) {
    await chrome.tabs.create({ url: targetUrl, active: true });
  }

  setTimeout(() => {
    window.close();
  }, 150);
}

// Global delegated click listener (immune to script timing or DOM reload race conditions)
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#go-to-marketplace");
  if (btn) {
    handleOpenMarketplace(e);
  }
});

// Run immediately if DOM is already ready, or on DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}