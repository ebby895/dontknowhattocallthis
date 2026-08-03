// auth/login_page.js
// ==============================
// Phase 2 Login Page (Legacy UI, Safe Logic)
// - UI preserved
// - No supabase import
// - No popup reload
// ==============================

export function loadLoginPage(targetId = "ffm-auth-overlay-inner") {
	const host = document.getElementById(targetId);
	if (!host) return;

	host.innerHTML = `
		<div class="login-wrapper">
			<h1 class="login-title">LOGIN</h1>

			<div class="input-group">
				<span class="icon">📧</span>
				<input id="ffm-login-email" type="email" placeholder="Email" class="input" />
			</div>

			<div class="input-group">
				<span class="icon">🔒</span>
				<input id="ffm-login-password" type="password" placeholder="Password" class="input" />
			</div>

			<label class="remember-row">
				<input id="ffm-login-remember" type="checkbox" />
				<span>Remember me</span>
			</label>

			<button id="ffm-login-submit" class="login-btn">LOGIN</button>

			<p class="forgot-footer">
				<a id="ffm-login-forgot" href="#">Forgot password?</a>
			</p>

			<p class="signup-footer">
				Not a member? <a id="ffm-login-signup" href="#">Sign up now</a>
			</p>

			<p id="ffm-login-status" class="status"></p>
		</div>
	`;

	host.querySelector('#ffm-login-submit')
		.addEventListener('click', handleLogin);

	host.querySelector('#ffm-login-signup')
		.addEventListener('click', (e) => {
			e.preventDefault();
			import('./signup_page.js')
				.then(m => m.loadSignupPage(targetId))
				.catch(console.error);
		});

	host.querySelector('#ffm-login-forgot')
		.addEventListener('click', (e) => {
			e.preventDefault();
			import('./forgot_password_page.js')
				.then(m => m.loadForgotPasswordPage(targetId))
				.catch(console.error);
		});

	// Load saved credentials (if any) and prefill the form
	try {
		chrome.storage.local.get(['ffm_saved_credentials'], (r) => {
			const creds = r && r.ffm_saved_credentials ? r.ffm_saved_credentials : null;
			if (!creds) return;
			try { if (creds.email) host.querySelector('#ffm-login-email').value = creds.email; } catch (e) {}
			try { if (creds.password) host.querySelector('#ffm-login-password').value = creds.password; } catch (e) {}
			try { host.querySelector('#ffm-login-remember').checked = true; } catch (e) {}
		});
	} catch (e) {}
}

function handleLogin() {
	const email = document.getElementById('ffm-login-email')?.value.trim();
	const password = document.getElementById('ffm-login-password')?.value.trim();
	const remember = document.getElementById('ffm-login-remember')?.checked;
	const statusEl = document.getElementById('ffm-login-status');

	if (!email || !password) {
		statusEl.textContent = 'Please enter email and password';
		return;
	}

	statusEl.textContent = 'Signing in…';

	chrome.runtime.sendMessage(
		{ type: 'ffm-auth:login', email, password },
			async (res) => {
				if (!res || !res.ok) {
					statusEl.textContent = res?.error || 'Login failed';
					return;
				}

				if (remember) {
					// Remember is handled after enforcement to avoid overwriting device association
				}

				// After successful auth, ensure active-user check BEFORE finishing login flow.
				try {
					const ph = await import('../popup_helpers.js');
					let allowed = true;
					if (res && res.user && res.user.id) {
						try {
							allowed = await ph.ffmSetActiveUserId(res.user.id);
						} catch (e) { allowed = false; }
					}

					if (!allowed) {
						// Guard blocked login — do NOT close overlay or run migration.
						// Modal shown by ffmSetActiveUserId will handle logout and return to sign-in.
						statusEl.textContent = '';
						return;
					}

					// Enforce single-user per device (local-only guard)
					try {
						const enforceOk = await ph.ffmEnforceSingleUser(res.user?.email || email, { writeHash: remember });
						if (!enforceOk) {
							statusEl.textContent = '';
							return;
						}
					} catch (e) { }

					// No conflict — finalize login
					try {
						if (remember) {
							try { chrome.storage.local.set({ ffm_saved_credentials: { email: email, password: password } }); } catch (e) {}
						} else {
							try { chrome.storage.local.remove(['ffm_saved_credentials']); } catch (e) {}
						}
					} catch (e) {}
					statusEl.textContent = 'Signed in';
					try { window.ffmCloseLoginOverlay?.(); } catch {}
					try { await ph.ffmMigrateDefaultToUser(res.user.id); } catch (e) {}
				} catch (e) {
					// If anything unexpected happens, proceed conservatively: show signed-in UI
					try {
						if (remember) {
							try { chrome.storage.local.set({ ffm_saved_credentials: { email: email, password: password } }); } catch (e) {}
						} else {
							try { chrome.storage.local.remove(['ffm_saved_credentials']); } catch (e) {}
						}
					} catch (er) {}
					statusEl.textContent = 'Signed in';
					try { window.ffmCloseLoginOverlay?.(); } catch {}
				}

				try { await window.ffmAuthRefreshUI?.(); } catch {}
			}
	);
}
