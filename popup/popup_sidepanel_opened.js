// Runs early in the popup to notify background and clear any persisted ADS attention.
(function () {
  try {
    function clearAdsAttentionLocal() {
      try { console.log('[popup_sidepanel_opened] sending ffm_sidepanel_opened'); } catch (e) {}
      try { if (chrome && chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ action: 'ffm_sidepanel_opened' }, function () { try { console.log('[popup_sidepanel_opened] sendMessage callback'); } catch (e) {} }); } catch (e) {}
      try { if (chrome && chrome.action && chrome.action.setBadgeText) { chrome.action.setBadgeText({ text: '' }); try { console.log('[popup_sidepanel_opened] cleared badge via chrome.action'); } catch (e) {} } } catch (e) {}
      try { if (chrome && chrome.notifications && chrome.notifications.clear) chrome.notifications.clear('FFM_ADS_COMPLETE', function() { try { console.log('[popup_sidepanel_opened] cleared notification'); } catch (e) {} }); } catch (e) {}
      try { if (chrome && chrome.storage && chrome.storage.local && chrome.storage.local.remove) chrome.storage.local.remove('ffm_ads_attention', function() { try { console.log('[popup_sidepanel_opened] removed ffm_ads_attention'); } catch (e) {} }); } catch (e) {}
    }

    if (document && document.readyState && (document.readyState === 'loading' || document.readyState === 'interactive')) {
      window.addEventListener('DOMContentLoaded', clearAdsAttentionLocal, { once: true });
    } else {
      // Already ready
      setTimeout(clearAdsAttentionLocal, 0);
    }
  } catch (e) {
    // silent
  }
})();
