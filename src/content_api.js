/*
 content_api.js
 A small API wrapper showing message-based calls between content script and background.
 Keep content scripts lightweight and delegate privileged actions to background.
*/
export function requestClickNext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'click_next' }, (resp) => {
      resolve(resp);
    });
  });
}

// Example: listener in content script to react to background responses
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'click_result') {
    console.log('Click result from background:', msg.result);
  }
});