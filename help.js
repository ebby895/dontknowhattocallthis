(function(){
  try {
    const redirect = chrome.identity.getRedirectURL();
    const extId = chrome.runtime.id;
    const redirectEl = document.getElementById('help-redirect-uri');
    const extIdEl = document.getElementById('help-extension-id');
    if (redirectEl) redirectEl.value = redirect || '';
    if (extIdEl) extIdEl.value = extId || '';

    const copy = (el) => {
      try { navigator.clipboard.writeText(el.value || ''); } catch (e) {
        el.select(); document.execCommand('copy');
      }
    };
    document.getElementById('help-copy-redirect')?.addEventListener('click', ()=> copy(redirectEl));
    document.getElementById('help-copy-extid')?.addEventListener('click', ()=> copy(extIdEl));

    // Load saved Client ID
    const clientEl = document.getElementById('help-client-id');
    const refreshClient = () => chrome.storage.local.get({ drive_client_id: '' }, (r) => { clientEl && (clientEl.value = r.drive_client_id || ''); });
    document.getElementById('help-refresh')?.addEventListener('click', refreshClient);
    refreshClient();

    // Setup checks
    const results = document.getElementById('help-results');
    function addResult(ok, text) {
      const li = document.createElement('li');
      const badge = document.createElement('span');
      badge.textContent = ok ? 'PASS' : 'CHECK';
      badge.className = ok ? 'ok' : 'warn';
      li.appendChild(badge);
      li.appendChild(document.createTextNode(' ' + text));
      results.appendChild(li);
    }
    function clearResults(){ results.textContent=''; }

    document.getElementById('help-run-checks')?.addEventListener('click', () => {
      clearResults();
      const cid = clientEl?.value?.trim() || '';
      const rid = redirectEl?.value?.trim() || '';
  const cidOk = /\.apps\.googleusercontent\.com$/.test(cid) && cid.length > 20;
      addResult(cidOk, 'Client ID saved in Menu → matches pattern "*.apps.googleusercontent.com"');
  const ridOk = /chromiumapp\.org\/$/.test(rid);
      addResult(ridOk, 'Redirect URI ends with "chromiumapp.org/"');
      addResult(true, 'Drive API should be Enabled in your project (open the Drive API Library to verify).');
      addResult(true, 'Add yourself as a Test user on the OAuth consent screen.');
      if (!cidOk) addResult(false, 'Paste your Client ID in the popup Menu and click Save Client ID.');
      if (!ridOk) addResult(false, 'Copy the Redirect URI from this page and paste it into your OAuth client’s Authorized redirect URIs.');
    });

    // Test sign-in using saved Client ID
    document.getElementById('help-test-auth')?.addEventListener('click', () => {
      clearResults();
      const cid = clientEl?.value?.trim() || '';
      if (!cid) { addResult(false, 'No Client ID saved. Open popup Menu and Save Client ID first.'); return; }
      const redirectUri = chrome.identity.getRedirectURL();
      const scope = encodeURIComponent('https:\/\/www.googleapis.com\/auth\/drive.file https:\/\/www.googleapis.com\/auth\/drive.readonly');
      const authUrl = `https:\/\/accounts.google.com\/o\/oauth2\/v2\/auth?client_id=${encodeURIComponent(cid)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&prompt=consent`;
      try {
        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectedTo) => {
          if (chrome.runtime.lastError) {
            addResult(false, 'launchWebAuthFlow error: ' + (chrome.runtime.lastError.message || 'Unknown'));
            if ((chrome.runtime.lastError.message || '').match(/redirect_uri_mismatch/i)) {
              addResult(false, 'Fix: Add the Redirect URI shown at the top of this page to your OAuth client.');
            }
            return;
          }
          try {
            const hash = (redirectedTo || '').split('#')[1] || '';
            const params = new URLSearchParams(hash);
            const token = params.get('access_token');
            if (token) {
              addResult(true, 'Success! Received an access token. Your OAuth setup is correct.');
            } else {
              addResult(false, 'Did not receive an access token. Check consent screen and scopes.');
            }
          } catch (e) {
            addResult(false, 'Parse error verifying token: ' + String(e));
          }
        });
      } catch (e) {
        addResult(false, 'launchWebAuthFlow threw: ' + String(e));
      }
    });

    // Sleep/hibernate help link (CSP-compliant handler)
    try {
      const sleepLink = document.getElementById('sleepHelpLink');
      if (sleepLink) {
        sleepLink.addEventListener('click', (e) => {
          try {
            e.preventDefault();
            const isMac = navigator.platform && navigator.platform.toUpperCase().includes('MAC');
            const url = isMac
              ? 'https://support.apple.com/en-us/HT204032'
              : 'https://support.microsoft.com/windows/prevent-your-pc-from-going-to-sleep-';
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.tabs && typeof chrome.tabs.create === 'function') {
              chrome.tabs.create({ url });
            } else {
              window.open(url, '_blank', 'noopener');
            }
          } catch (err) { try { window.open('https://support.microsoft.com/windows/prevent-your-pc-from-going-to-sleep-', '_blank', 'noopener'); } catch (e) {} }
        });
      }
    } catch (e) {}
  } catch (e) { console.debug('help page init error', e); }
})();
