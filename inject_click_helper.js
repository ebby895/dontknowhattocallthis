/*
inject_click_helper.js

Example usage from background.js or popup.js (Manifest V3):

chrome.scripting.executeScript({
  target: { tabId: targetTabId, allFrames: false },
  world: 'MAIN',
  files: ['pageClickHelper.js']
}, () => {
  // After injection, call the helper function
  chrome.scripting.executeScript({
    target: { tabId: targetTabId, allFrames: false },
    world: 'MAIN',
    func: (selector) => {
      return window.__AutoListPro_pageClickHelper.clickWhenReady(selector, { timeout: 6000 });
    },
    args: ['div[aria-label="Next"], button[aria-label="Next"], button:contains("Next")']
  }, (results) => {
    console.log('click helper result:', results && results[0] && results[0].result);
  });
});

Note: In Manifest V3 the first executeScript with `files` injects the helper file; the second call invokes the function and returns the result.
*/