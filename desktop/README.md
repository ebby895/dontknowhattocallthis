# NxtGen Deal Engine — desktop

Eb's Price Glitch Command Center. Watches the accounts you follow on X, keeps
only the posts whose link chain ends on Amazon, rebuilds the link with your own
associate tag, writes original copy, and posts it.

Standalone — it shares no code with the Chrome extension in the repo root. Either
can run on its own.

## Run it

**Double-click `Start NxtGen.bat`** in this folder.

First run takes a few minutes: it builds a private environment beside the file,
installs the dependencies and downloads Chromium. Every run after that goes
straight into the app. If anything fails, the window stays open with the error
in it rather than vanishing.

Needs Python installed — get it from [python.org](https://www.python.org/downloads/)
and **tick "Add python.exe to PATH"** on the installer's first screen. The
launcher checks for it and tells you if it's missing.

Everything lives inside this folder: deleting `.venv` undoes the install.

<details>
<summary>Manual install (macOS, Linux, or if you prefer a terminal)</summary>

```
cd desktop
pip install -r requirements.txt
playwright install chromium
python run.py
```
</details>

First launch opens a Chrome window on x.com. **Sign in once** — the profile keeps
the session, so you never sign in again.

## Setup

1. **Settings → API keys** — paste your Gemini key. It goes to the Windows
   Credential Manager (Keychain on macOS, Secret Service on Linux), never to a
   file. Entered once, persists across restarts. Keepa is optional but it's what
   lets the engine measure a real discount against 90-day price history instead
   of trusting an inflated "was" price.
2. **Settings → Amazon** — confirm the associate tag (`nxtgenhotdeal-20`).
3. **Start engine** in the sidebar. It runs in review mode: deals land in the
   queue, nothing publishes on its own.
4. Watch the queue for a day. When the drafts look right, tick
   **Settings → Autopilot → Armed**.

## How it works

```
x.com timeline (your session, Following tab)
        │
        ▼  capture.py — Playwright reads a real logged-in page
   posts with outbound links
        │
        ▼  resolver.py — follows every redirect chain to where it lands
   final URLs
        │
        ▼  core.py — THE GATE: Amazon-terminating chains only
   ASIN extracted, foreign tags stripped, link rebuilt with your tag
        │
        ▼  verify.py — live price, stock, category, real discount vs history
   verified deal
        │
        ▼  ai.py / copywriter.py — original copy from verified facts only
   draft
        │
        ▼  gates.py — six checks, fail closed
   post ─────────────────► poster.py ──► your feed
   or held ──────────────► queue, with the reason shown
```

The redirector is followed to *learn* the destination and then discarded.
Published links are always plain `amazon.com/dp/<ASIN>?tag=…`.

## The gates

A draft publishes unattended only if all six pass. Anything else goes to the
queue with the reason attached.

| Gate | What it requires |
|---|---|
| link | exactly one URL, on Amazon, carrying your tag |
| disclosure | `#ad` present |
| length | within 280 characters (or Premium enabled) |
| freshness | deal younger than the age cap — default 45 min |
| substance | a verified discount, or a captured promo code, and in stock |
| rate | per-ASIN dedupe, minimum gap, hourly and daily caps |

Deals discounted 90%+ are flagged as likely pricing errors and held rather than
posted — those orders get cancelled, which reverses the commission and costs
followers.

## Stats

- **Dashboard** — commission, clicks, EPC, conversion, capture funnel, live log
- **Revenue** — commission and clicks by day, per-post earnings. Import your
  Associates report CSV (there is no API for this below the Creators API sales
  threshold)
- **Pipeline** — scanned, resolved, Amazon hits vs rejects, why deals were held,
  detect→post latency
- **Performance** — commission by category, orders by discount depth, by deal
  mechanic, best source accounts
- **Timing** — engagement by hour, orders by deal age at posting, AI copy vs
  template

## Input modes

- `playwright` (default) — drives the composer in the controlled browser. Does
  not fight you for the keyboard.
- `keyboard` — real OS-level keystrokes via pyautogui, for driving a browser
  Playwright isn't attached to. Leave the machine alone while it types; slam the
  pointer into a screen corner to abort.

## Operating notes

- The app must stay open with the browser running. Closing it stops capture.
- Your X account must be listed in your Amazon Associates profile before you
  post links from it. Unlisted platforms are the most common cause of account
  termination.
- Don't share promo codes for sales that haven't started, and don't state a
  price the engine hasn't verified — both are in the Associates policy, and both
  are enforced in code here rather than left to you to remember.

## Tests

```
python tests/test_engine.py
```

50 tests over the Amazon gate (including lookalike domains such as
`amazon.com.evil.co`), ASIN extraction, foreign-tag stripping, promo-code
parsing, copy generation, all six gates, the store, and the AI output validator.
No network, browser or Qt required.

## Layout

| File | Role |
|---|---|
| `nxtgen/core.py` | Amazon gate, ASIN, codes, the `Deal` model, ranking |
| `nxtgen/resolver.py` | redirect chain resolution, incl. meta-refresh bounces |
| `nxtgen/verify.py` | live price, stock, category, Keepa history, glitch flag |
| `nxtgen/copywriter.py` | template copy — the floor and the fallback |
| `nxtgen/ai.py` | Gemini generation, output validation |
| `nxtgen/gates.py` | the six pre-publish checks |
| `nxtgen/poster.py` | Playwright and keyboard input modes |
| `nxtgen/capture.py` | Playwright timeline reader |
| `nxtgen/engine.py` | the pipeline loop |
| `nxtgen/db.py` | SQLite store and all four analytics families |
| `nxtgen/ui/` | Qt window, theme, charts |
