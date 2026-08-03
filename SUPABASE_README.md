Supabase integration (Fast4MP extension)

Quick setup & test

- `supabaseClient.js` contains a minimal REST-based auth helper and was configured with your project URL.
- Replace nothing further unless you want a different anon key — the provided anon key is already present in the file.

To test in Chrome:
1. Open `chrome://extensions` and reload the unpacked extension.
2. Open the extension popup.
3. Enter a Supabase user email and password (email/password auth) and click "Sign In".
4. On successful sign-in you should see your email displayed and a "Sign out" button.

Notes & limitations
- This client uses Supabase REST auth endpoints. It does not implement automatic refresh of expired sessions (refresh_token flow). If you need persistent sessions, I can add refresh logic that exchanges the refresh token for a new access token.
- Sessions are stored in `chrome.storage.local` under the key `ffm_supabase_session`.
- Use `window.supabaseClient.fetchWithAuth(path, opts)` to make authenticated requests to Supabase from popup scripts.

Next steps (optional)
- Add token refresh logic using the refresh token.
- Add OAuth provider support (Google/Apple) if desired — requires additional UI and redirect handling.
- Implement server-side Edge Function usage (e.g., create-checkout) and wire the popup to call it via `fetchWithAuth`.

Contact me if you want any of the optional items implemented now.
