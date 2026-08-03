// Probe for confirming workspace popup scripts are loaded by the browser
try { console.log('[AutoList Pro] popup_probe loaded (workspace)'); } catch (e) {}

// Try to fetch the runtime copy of popup_main.js and log its length and tail
(function(){
	try {
		if (!chrome || !chrome.runtime || !chrome.runtime.getURL) return;
		const url = chrome.runtime.getURL('popup/popup_main.js');
		try {
			fetch(url, { cache: 'no-store' }).then(res => {
				if (!res || !res.ok) { console.warn('[AutoList Pro] probe: could not fetch popup_main.js', res && res.status); return; }
				return res.text();
			}).then(txt => {
				try {
					if (typeof txt !== 'string') { console.warn('[AutoList Pro] probe: popup_main.js fetch returned non-string'); return; }
					const len = txt.length;
					const tail = txt.slice(Math.max(0, len - 300));
					console.log('[AutoList Pro] probe: popup_main.js length=' + len);
					console.log('[AutoList Pro] probe: popup_main.js tail:\n' + tail);
				} catch (e) { console.debug('[AutoList Pro] probe fetch->text error', e); }
			}).catch(err => { console.warn('[AutoList Pro] probe fetch error', err); });
		} catch (e) { console.debug('[AutoList Pro] probe fetch outer error', e); }
	} catch (e) {}
})();