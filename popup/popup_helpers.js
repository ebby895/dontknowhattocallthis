console.log("[AutoList Pro] popup_helpers.js loaded");

// --------------------------
// Local-only single-user enforcement helpers
// --------------------------
import { ffmSha256, ffmEnsurePersistId, ffmNormalizeLastUser, ffmTrySetLastUserHash, ffmSetMultiUserLocked } from '../shared/device_persist.js';

export async function ffmLockApp({ title, body }) {
	try {
			// Disable broad set of interactive controls so the UI is visibly and functionally locked
			try {
				const selectors = ['.ffm-requires-trial', 'button', 'a', 'input', '[role="button"]', '.action-btn', '.ffm-primary-btn'];
				const elems = new Set();
				selectors.forEach(s => {
					try { document.querySelectorAll(s).forEach(el => elems.add(el)); } catch (_) {}
				});
				Array.from(elems).forEach(el => {
					try {
						if (el.hasAttribute && el.hasAttribute('data-ffm-exempt')) return;
						el.setAttribute('data-ffm-locked', '1');
						if (el.tagName && el.tagName.toLowerCase() === 'button') {
							el.disabled = true;
						}
						try { el.setAttribute('aria-disabled', 'true'); } catch (e) {}
						try { el.style.pointerEvents = 'none'; el.style.opacity = '0.55'; } catch (e) {}
					} catch (_) {}
				});
			} catch (_) {}

		// Small modal
		try {
			if (document.getElementById('ffm-device-lock-modal')) return;
			const root = document.createElement('div');
			root.id = 'ffm-device-lock-modal';
			root.style.position = 'fixed';
			root.style.inset = '0';
			root.style.background = 'rgba(0,0,0,0.6)';
			root.style.display = 'flex';
			root.style.alignItems = 'center';
			root.style.justifyContent = 'center';
			root.style.zIndex = '200000';

			const card = document.createElement('div');
			card.style.width = 'min(640px,92vw)';
			card.style.background = '#fff';
			card.style.borderRadius = '10px';
			card.style.padding = '18px';
			card.style.boxShadow = '0 8px 30px rgba(0,0,0,0.35)';

			const h = document.createElement('h2'); h.textContent = title || 'Trial unavailable on this device';
			const p = document.createElement('div'); p.style.whiteSpace = 'pre-wrap'; p.style.marginTop = '8px'; p.textContent = body || '';

			const actions = document.createElement('div'); actions.style.marginTop = '12px'; actions.style.textAlign = 'right';

			const signout = document.createElement('button');
			signout.className = 'action-btn';
			signout.id = 'ffm-device-lock-signout';
			signout.textContent = 'Sign out';
			// Exempt signout from the global disable so user can log out
			try { signout.setAttribute('data-ffm-exempt', '1'); } catch (e) {}
			signout.addEventListener('click', async () => {
				try {
					signout.disabled = true;
					// Ask background to logout, then clear local active user keys and reload after a short delay
					try {
						chrome.runtime.sendMessage({ type: 'ffm-auth:logout' }, () => {
							try { chrome.storage.local.remove(['ffm_active_user_id','ffm_active_user_email','ffm_supabase_session','ffm_supabase_user'], () => { try { setTimeout(() => { try { window.location.reload(); } catch(e){} }, 120); } catch(e){} }); } catch (e) { try { setTimeout(() => { try { window.location.reload(); } catch(e){} }, 120); } catch(e){} }
						});
					} catch (e) {
						try { setTimeout(() => { try { window.location.reload(); } catch(e){} }, 120); } catch(e){}
					}
				} catch (e) {}
			});

			actions.appendChild(signout);

			card.appendChild(h); card.appendChild(p); card.appendChild(actions);
			root.appendChild(card);
			document.body.appendChild(root);
		} catch (e) {
			try { alert((title ? title + '\n\n' : '') + (body || '')); } catch (_) {}
		}
	} catch (e) {}
}

export async function ffmEnforceSingleUser(email, opts) {
	try {
		await ffmEnsurePersistId();
		// Ensure persist id exists
		await ffmEnsurePersistId();
		const persistStore = await new Promise((res) => { try { chrome.storage.local.get(['__ffm_persist'], res); } catch (e) { res({}); } });
		const persist = persistStore && persistStore.__ffm_persist ? persistStore.__ffm_persist : null;
		// Normalize legacy `fast4mp_last_user` (migrate plain email -> hash) and return canonical hash
		const lastUser = await ffmNormalizeLastUser(email);
		const emailHash = email ? await ffmSha256(String(email).toLowerCase().trim()) : null;
		const writeHash = opts && typeof opts.writeHash !== 'undefined' ? !!opts.writeHash : true;

		if (persist && lastUser && emailHash && lastUser !== emailHash) {
			await ffmLockApp({
				title: 'Device already in use',
				body: 'This device already has AutoList Pro data associated with another users account.\n\nMultiple users cannot share the same local file system.\nChanging accounts will not restore free access.'
			});
			// Mark locked flag so other contexts honor the lock
			try { await ffmSetMultiUserLocked(true); } catch (e) {}
			return false;
		}

		// First user or same user: optionally persist last user hash locally using safe writer
		if (emailHash && writeHash) {
			try {
				const ok = await ffmTrySetLastUserHash(emailHash);
				if (!ok) {
					await ffmLockApp({ title: 'Device already in use', body: 'This device already has AutoList Pro data associated with another users account.\n\nMultiple users cannot share the same local file system.\nChanging accounts will not restore free access.' });
					return false;
				}
			} catch (e) {}
		}
		return true;
	} catch (e) { return true; }
}