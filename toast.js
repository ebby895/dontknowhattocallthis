// toast.js (enhanced)
// Supports signatures:
//   showToast(message)
//   showToast(message, durationMs)
//   showToast(message, type)
//   showToast(message, { type, duration })
// where type in { 'success', 'error', 'info' }
(function initAutoListProToast(){
  function resolveArgs(message, arg) {
    const def = (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.defaultToastDuration) ? window.CONFIG.defaultToastDuration : 2500;
    let type = null; let duration = def;
    if (typeof arg === 'number') {
      duration = arg;
    } else if (typeof arg === 'string') {
      type = arg;
    } else if (arg && typeof arg === 'object') {
      if (typeof arg.duration === 'number') duration = arg.duration;
      if (typeof arg.type === 'string') type = arg.type;
    }
    return { message: String(message), type, duration };
  }

  function showToast(message, arg) {
    try {
      const { message: msg, type, duration } = resolveArgs(message, arg);
      const toast = document.createElement('div');
      toast.className = 'fast4mp-toast' + (type ? (' fast4mp-toast-' + type) : '');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = `<span class="fast4mp-toast-icon">${iconFor(type)}</span><span class="fast4mp-toast-text"></span>`;
      toast.querySelector('.fast4mp-toast-text').textContent = msg;
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, duration);
      return toast;
    } catch (e) {
      try { console.warn('[AutoList Pro] showToast error', e); } catch(_) {}
    }
  }

  function iconFor(type) {
    switch ((type||'').toLowerCase()) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'info': return 'ℹ️';
      default: return '⚙️';
    }
  }

  try { window.showToast = showToast; } catch(_) {}
  try { console.log('[AutoList Pro] Toast system ready'); } catch(_) {}
})();
