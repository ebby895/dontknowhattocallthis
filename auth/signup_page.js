// auth/signup_page.js
// ==============================
// Phase 2.5 Signup Page (Overlay)
// - No supabase import
// - Talks to background only
// ==============================

export function loadSignupPage(targetId = 'ffm-auth-overlay-inner') {
	const host = document.getElementById(targetId);
	if (!host) return;

	host.innerHTML = `
		<div class="login-wrapper">
			<h1 class="login-title">SIGN UP</h1>

			<div class="input-group">
				<span class="icon">📧</span>
				<input id="ffm-signup-email" type="email" placeholder="Email" class="input" />
			</div>

			<div class="input-group">
				<span class="icon">🔒</span>
				<input id="ffm-signup-password" type="password" placeholder="Password" class="input" />
			</div>

			<div class="input-group">
				<span class="icon">🔒</span>
				<input id="ffm-signup-password2" type="password" placeholder="Confirm password" class="input" />
			</div>

			<button id="ffm-signup-submit" class="login-btn">CREATE ACCOUNT</button>

			<p class="signup-footer">
				Already have an account?
				<a id="ffm-signup-back-login" href="#">Sign in</a>
			</p>

			<p id="ffm-signup-status" class="status"></p>
		</div>
	`;

	const submit = host.querySelector('#ffm-signup-submit');
	if (submit) submit.addEventListener('click', handleSignup);

	const back = host.querySelector('#ffm-signup-back-login');
	if (back) back.addEventListener('click', (e) => {
		e.preventDefault();
		import('./login_page.js')
			.then(m => m.loadLoginPage(targetId))
			.catch(console.error);
	});
}

function handleSignup() {
	const email = document.getElementById('ffm-signup-email')?.value.trim();
	const p1 = document.getElementById('ffm-signup-password')?.value.trim();
	const p2 = document.getElementById('ffm-signup-password2')?.value.trim();
	const statusEl = document.getElementById('ffm-signup-status');

	if (!email || !p1 || !p2) {
		if (statusEl) statusEl.textContent = 'Please fill all fields';
		return;
	}
	if (p1 !== p2) {
		if (statusEl) statusEl.textContent = 'Passwords do not match';
		return;
	}

	if (statusEl) statusEl.textContent = 'Creating account…';

	try {
		chrome.runtime.sendMessage(
			{ type: 'ffm-auth:signup', email, password: p1 },
			async (res) => {
				if (!res || !res.ok) {
					if (statusEl) statusEl.textContent = res?.error || 'Signup failed';
					return;
				}

				// Account created, but may require email confirmation
				const requiresConfirm =
					!(res.state && res.state.signedIn);

				if (requiresConfirm) {
					statusEl.innerHTML = `
						<div style="color:#0a7a2f;font-weight:600;margin-bottom:6px;">
							Account created
						</div>
						<div style="font-size:13px;line-height:1.4;">
							Please check your email and confirm your account.<br/>
							After confirming, return here and sign in.
						</div>
						<div style="margin-top:10px;">
							<button id="ffm-signup-back-login" style="background:#0b6bff;color:#fff;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;">Back to Sign in</button>
						</div>
					`;

					// Wire back-to-login button to swap to login UI
					setTimeout(() => {
						try {
							const btn = document.getElementById('ffm-signup-back-login');
							if (btn) {
								btn.addEventListener('click', (ev) => {
									ev.preventDefault();
									import('./login_page.js')
										.then(m => m.loadLoginPage(targetId))
										.catch(console.error);
								});
							}
						} catch (e) {}
					}, 0);

					return; // keep overlay open so user sees message
				}

				// If auto-signed-in (email confirm disabled)
				statusEl.textContent = 'Signed in';

				try { window.ffmCloseLoginOverlay?.(); } catch (e) {}
				try { await window.ffmAuthRefreshUI?.(); } catch (e) {}
			}
		);
	} catch (e) {
		if (statusEl) statusEl.textContent = e?.message || String(e);
	}
}
