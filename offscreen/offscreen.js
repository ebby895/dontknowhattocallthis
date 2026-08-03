// offscreen.js retired — hidden-tab Active Sync now used.
console.log('[Offscreen] offscreen.js retired — not used.');
console.log("[AutoList Pro Offscreen] offscreen.js loaded");

// Forward logs from offscreen -> background.js
(function () {
    const origLog = console.log.bind(console);
    const origErr = console.error.bind(console);
    console.log = function (...args) {
        try {
            chrome.runtime.sendMessage({
                action: 'ffm_offscreen_log',
                args: args.map(a => {
                    try { return (typeof a === 'object') ? JSON.stringify(a) : String(a); } catch (e) { return String(a); }
                })
            });
        } catch (e) {}
        try { origLog(...args); } catch (e) {}
    };
    console.error = function (...args) {
        try {
            chrome.runtime.sendMessage({
                action: 'ffm_offscreen_log',
                args: args.map(a => {
                    try { return (typeof a === 'object') ? JSON.stringify(a) : String(a); } catch (e) { return String(a); }
                }),
                level: 'error'
            });
        } catch (e) {}
        try { origErr(...args); } catch (e) {}
    };
})();

// Wait for the hidden iframe to be fully loaded
function ffmWaitForIframeReady() {
    return new Promise(resolve => {
        const frame = document.getElementById("ffmWorker");

        if (!frame) {
            console.warn("[AutoList Pro Offscreen] ffmWorker iframe missing");
            resolve();
            return;
        }

        try {
            // If already loaded (same-origin frame access may fail in some cases)
            const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
            if (doc && doc.readyState === "complete") {
                console.log("[AutoList Pro Offscreen] iframe already ready");
                resolve();
                return;
            }
        } catch (e) {
            // Accessing contentDocument may throw due to cross-origin restrictions; fallthrough to onload
        }

        // Otherwise wait for onload
        frame.onload = () => {
            try { console.log("[AutoList Pro Offscreen] iframe onload fired"); } catch (e) {}
            resolve();
        };

        // Safety fallback: resolve after a short timeout if onload doesn't fire
        setTimeout(() => { try { resolve(); } catch (e) {} }, 3000);
    });
}

// Expose to content_main.js running inside offscreen context
window.ffmWaitForIframeReady = ffmWaitForIframeReady;
