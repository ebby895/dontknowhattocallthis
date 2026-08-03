(function(){
  function el(id){return document.getElementById(id)}
  function fmtTime(ts){ try{ const d = new Date(ts); return d.toLocaleString(); }catch(e){return ''} }

  function render(notifs){
    const list = el('list');
    if(!Array.isArray(notifs) || !notifs.length){ list.innerHTML = '<div class="ffm-notify-item">No notifications.</div>'; return; }
    list.innerHTML = '';
    notifs.forEach(n => {
      const item = document.createElement('div');
      item.className = 'ffm-notify-item';
      item.style.padding = '10px 6px';

      const titleRow = document.createElement('div'); titleRow.style.display='flex'; titleRow.style.justifyContent='space-between'; titleRow.style.alignItems='center';
      const title = document.createElement('div'); title.className='ffm-notify-title'; title.textContent = n.title || '';
      const time = document.createElement('div'); time.className='ffm-notify-time'; time.textContent = fmtTime(n.createdAt || n.ts || Date.now());
      titleRow.appendChild(title); titleRow.appendChild(time);

      const msg = document.createElement('div'); msg.className='ffm-notify-message'; msg.style.marginTop='8px'; msg.innerHTML = (n.message||'').replace(/\n/g,'<br>');

      const actions = document.createElement('div'); actions.className='ffm-notify-actions'; actions.style.marginTop='10px';
      if(n.listingId){
        const run = document.createElement('button'); run.className='action-btn'; run.textContent='Run Now'; run.style.padding='6px 10px';
        run.addEventListener('click', ()=>{
          try{ chrome.runtime.sendMessage({ action: 'ffm_scheduler_run_one', listingId: n.listingId }, ()=>{}); }catch(e){}
          try{ chrome.runtime.sendMessage({ action: 'ffm_notifications_mark_read', ids: [n.id] }, ()=>{}); }catch(e){}
          run.disabled = true;
        });
        actions.appendChild(run);
      }
      const mark = document.createElement('button'); mark.className='action-btn'; mark.textContent='Mark Read'; mark.style.marginLeft='8px'; mark.style.background='#777';
      mark.addEventListener('click', ()=>{
        try{ chrome.runtime.sendMessage({ action: 'ffm_notifications_mark_read', ids: [n.id] }, ()=>{ fetchAndRender(); }); }catch(e){}
      });
      actions.appendChild(mark);

      item.appendChild(titleRow);
      item.appendChild(msg);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function fetchAndRender(){
    try{
      chrome.runtime.sendMessage({ action: 'ffm_notifications_get' }, (resp)=>{
        try{ if(!resp || !resp.ok) return; render(resp.notifications || []); }catch(e){}
      });
    }catch(e){ console.warn('notify popup fetch failed', e); }
  }

  // initial
  fetchAndRender();
  
  // Close button
  try{
    const closeBtn = document.getElementById('notify-close');
    if(closeBtn) closeBtn.addEventListener('click', ()=>{ try{ window.close(); }catch(e){} });
  }catch(e){}

  // refresh when window becomes visible
  window.addEventListener('focus', fetchAndRender);
})();
