// Settings page: use background auth bridge (do not load Supabase UMD here)

function render() {
  const root = document.getElementById('settings-root');
  try {
    chrome.runtime.sendMessage({ type: 'ffm-auth:get-state' }, (res) => {
      try {
        const user = res && res.user ? res.user : null;
        const email = user && user.email ? user.email : 'Not signed in';
        root.querySelector('.email').textContent = email;
      } catch (e) {
        root.querySelector('.email').textContent = 'Error loading account';
      }
    });
  } catch (e) {
    try { root.querySelector('.email').textContent = 'Error loading account'; } catch (_) {}
  }
}

// Trial helpers (client-side cache)
async function ffmGetTrialState() {
  return new Promise((res) => {
    try { chrome.storage.local.get(['ffm_trial'], (r) => { res((r && r.ffm_trial) ? r.ffm_trial : null); }); } catch (e) { res(null); }
  });
}

function ffmGetTrialDaysLeft(trial) {
  if (!trial || trial.isPaid) return null;
  const msLeft = (trial.trialExpiresAt || trial.trial_expires_at) - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

async function ffmRenderTrialUI() {
  try {
    const trial = await ffmGetTrialState();
    const box = document.getElementById('ffm-trial-box');
    if (!box) return;
    if (!trial) { box.style.display = 'none'; return; }
    box.style.display = '';
    const statusEl = box.querySelector('.ffm-trial-status');
    const btn = document.getElementById('ffm-upgrade-btn');
    if (!statusEl || !btn) return;
    if (trial.isPaid) {
      statusEl.textContent = 'Pro ✓';
      btn.textContent = 'Billing';
      btn.classList.add('pro');
      return;
    }
    const daysLeft = ffmGetTrialDaysLeft(trial);
    if (daysLeft > 0) {
      statusEl.textContent = `Trial: ${daysLeft} Days Left`;
      btn.textContent = 'Upgrade ⚡';
    } else {
      statusEl.textContent = 'Trial Expired';
      btn.textContent = 'Upgrade ⚡';
    }
    btn.onclick = () => { try { chrome.tabs.create({ url: 'https://fast4mp.com/upgrade' }); } catch (e) {} };
  } catch (e) {}
}

// Minimal trial renderer that accepts a trial object
function ffmRenderTrialUI(trial) {
  try {
    const el = document.getElementById('ffm-trial-banner');
    if (!el) return;
    if (!trial) { el.innerHTML = ''; return; }
    if (trial.isPaid) {
      el.innerHTML = `<span class="pro-badge">Pro</span>`;
      return;
    }
    el.innerHTML = `
      <div class="trial-box">
        Trial: ${trial.daysLeft} days left
        <button id="ffm-upgrade-btn">Upgrade ⚡</button>
      </div>
    `;
    const btn = document.getElementById('ffm-upgrade-btn');
    if (btn) btn.onclick = () => { try { chrome.tabs.create({ url: 'https://fast4mp.com/upgrade' }); } catch (e) {} };
  } catch (e) {}
}

function doLogout() {
  try {
    chrome.runtime.sendMessage({ type: 'ffm-auth:logout' }, () => {
      try { chrome.runtime.sendMessage({ action: 'ffmForceLogout' }); } catch (e) {}
      try { window.close(); } catch (e) {}
    });
  } catch (e) { try { window.close(); } catch (_) {} }
}

function initHandlers() {
  const logoutBtn = document.getElementById('logout-btn');
  const closeBtn = document.getElementById('close-btn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try { chrome.runtime.sendMessage({ type: 'ffm-auth:logout' }, () => {
        try { chrome.runtime.sendMessage({ action: 'ffmForceLogout' }); } catch (e) {}
        try { window.close(); } catch (e) {}
      }); } catch (e) { try { window.close(); } catch (_) {} }
    };
  }
  if (closeBtn) closeBtn.addEventListener('click', () => { try { window.close(); } catch (e) {} });
}

window.addEventListener('DOMContentLoaded', () => {
  try { render(); } catch (e) {}
  try { initHandlers(); } catch (e) {}
  try { ffmRenderTrialUI(); } catch (e) {}
});
