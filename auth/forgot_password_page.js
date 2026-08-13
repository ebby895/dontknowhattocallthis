// auth/forgot_password_page.js
// ==============================
// Phase 2.6 Forgot Password Page
// ==============================

export function loadForgotPasswordPage(targetId = 'ffm-auth-overlay-inner') {
  const host = document.getElementById(targetId);
  if (!host) return;

  host.innerHTML = `
    <div class="login-wrapper">
      <h1 class="login-title">RESET PASSWORD</h1>

      <div class="input-group">
        <span class="icon">📧</span>
        <input id="ffm-forgot-email" type="email"
          placeholder="Email" class="input" />
      </div>

      <button id="ffm-forgot-submit" class="login-btn">
        Send reset email
      </button>

      <p class="signup-footer">
        Remembered your password?
        <a id="ffm-forgot-back-login" href="#">Sign in</a>
      </p>

      <p id="ffm-forgot-status" class="status"></p>
    </div>
  `;

  host.querySelector('#ffm-forgot-submit')
    .addEventListener('click', handleReset);

  host.querySelector('#ffm-forgot-back-login')
    .addEventListener('click', (e) => {
      e.preventDefault();
      import('./login_page.js')
        .then(m => m.loadLoginPage(targetId))
        .catch(console.error);
    });
}

function handleReset() {
  const email = document.getElementById('ffm-forgot-email')?.value.trim();
  const statusEl = document.getElementById('ffm-forgot-status');

  if (!email) {
    statusEl.textContent = 'Please enter your email';
    return;
  }

  statusEl.textContent = 'Sending reset email…';

  chrome.runtime.sendMessage(
    { type: 'ffm-auth:reset-password', email },
    (res) => {
      if (!res || !res.ok) {
        statusEl.textContent = res?.error || 'Failed to send reset email';
        return;
      }

      statusEl.innerHTML = `
        <div style="color:#0a7a2f;font-weight:600;margin-bottom:6px;">
          Email sent
        </div>
        <div style="font-size:13px;line-height:1.4;">
          Check your inbox for a password reset link.<br/>
          After resetting, return here and sign in.
        </div>
      `;
    }
  );
}
