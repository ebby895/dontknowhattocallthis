document.addEventListener('DOMContentLoaded', () => {
  try {
    const learnLink = document.getElementById('learn-how-link');
    if (!learnLink) return;

    learnLink.addEventListener('click', (e) => {
      try {
        e.preventDefault();
        const url = (chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('help.html') : 'help.html';
        if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
          chrome.tabs.create({ url });
        } else {
          window.open(url, '_blank', 'noopener');
        }
      } catch (err) {
        try { window.open('help.html', '_blank', 'noopener'); } catch (e) {}
      }
    });
  } catch (e) { console.debug('popup_help_link wiring failed', e); }
});
