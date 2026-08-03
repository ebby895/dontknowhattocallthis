Release notes — Fast4MP v4.0

Highlights
- Bump extension manifest to `4.0`.
- Create Listing From Publish (CLFP): launch fresh edit tab plus a helper media scraper tab to gather higher-quality images and videos from public listings.
- Media helper: improved image filtering (prefer high-quality fbcdn images) and initial video discovery support.
- Popup: integrated helper images/videos into the edit form; video preview fetches remote video to blob for reliable playback.
- Video upload wait: increased video preview wait timeout to 5 minutes to handle longer processing times.
- Deletion flow: soft-refresh now triggered after media deletion so Saved Listings reflect removals immediately.
- Added diagnostic debug logs for media scraping and background forwarding to aid troubleshooting.

Notes
- Some debug logging was added temporarily to help diagnose video scraping; consider trimming logs after verification.
- End-to-end saving of helper-sourced videos to MediaDB requires a repro for final validation.

If you want, I can:
- Remove or reduce the temporary debug logs.
- Make the video-wait timeout configurable.
- Draft a short changelog entry for the Chrome Web Store release page.
