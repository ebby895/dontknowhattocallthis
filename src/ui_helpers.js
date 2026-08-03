/*
src/ui_helpers.js
Small DOM helpers.
*/
export function waitForSelector(selector, opts = {}) {
  const root = opts.root || document;
  const timeout = opts.timeout || 5000;
  const interval = opts.interval || 150;
  return new Promise((resolve) => {
    const end = Date.now() + timeout;
    (function poll(){
      const el = root.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() > end) return resolve(null);
      setTimeout(poll, interval);
    })();
  });
}

export function dispatchClick(el) {
  ['mousedown','mouseup','click'].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  });
}