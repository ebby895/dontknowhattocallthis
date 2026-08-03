/*
pageClickHelper.js
This script is intended to be injected into the page context (world: 'MAIN').
Provides clickWhenReady(selector, options) which:
 - waits for the selector to appear (MutationObserver)
 - attempts dispatchEvent chain (mousedown, mouseup, click)
 - attempts React fiber onClick invocation if available
 - attempts focus + Enter keydown/keyup as fallback
Returns an object { success: boolean, method: 'dispatch'|'react'|'keyboard'|'timeout', details }
*/
window.__AutoListPro_pageClickHelper = (function() {
  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  function tryDispatch(el) {
    try {
      ['mousedown','mouseup','click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    } catch(e) {
      return false;
    }
  }

  function tryReactInvoke(el) {
    try {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) return false;
      const fiber = el[key];
      // walk up to find memoizedProps or pendingProps
      let props = fiber.memoizedProps || (fiber.pendingProps || null);
      if (!props && fiber.return) {
        props = fiber.return.memoizedProps || fiber.return.pendingProps;
      }
      const handler = props && props.onClick;
      if (typeof handler === 'function') {
        try {
          handler({ isTrusted: true, type: 'click' });
          return true;
        } catch(e) {
          // Some handlers expect event shape; still counts as attempt
          return false;
        }
      }
      return false;
    } catch(e) {
      return false;
    }
  }

  function tryKeyboard(el) {
    try {
      el.focus && el.focus();
      const ev = new KeyboardEvent('keydown', { bubbles:true, cancelable:true, key:'Enter', code:'Enter' });
      document.activeElement.dispatchEvent(ev);
      const ev2 = new KeyboardEvent('keyup', { bubbles:true, cancelable:true, key:'Enter', code:'Enter' });
      document.activeElement.dispatchEvent(ev2);
      return true;
    } catch(e) {
      return false;
    }
  }

  async function clickWhenReady(selector, opts) {
    opts = Object.assign({ timeout: 5000, interval: 150, retry: 3, root: document }, opts || {});
    const deadline = Date.now() + opts.timeout;

    // Wait for element
    while(Date.now() < deadline) {
      const el = (opts.root).querySelector(selector);
      if (el) {
        // If element is disabled or not visible, wait briefly
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          // try small wait
        }
        // Try dispatch chain, retrying if necessary
        for (let attempt=0; attempt<opts.retry; attempt++) {
          if (tryDispatch(el)) {
            // check if click likely worked by a short delay and DOM change - caller can re-check
            return { success: true, method: 'dispatch', attempt: attempt+1 };
          }
          await sleep(80);
        }
        // Try React fiber invoke
        if (tryReactInvoke(el)) return { success: true, method: 'react' };
        // Try keyboard fallback
        if (tryKeyboard(el)) return { success: true, method: 'keyboard' };
        return { success: false, method: 'no-method' };
      }
      await sleep(opts.interval);
    }
    return { success: false, method: 'timeout' };
  }

  return { clickWhenReady };
})();