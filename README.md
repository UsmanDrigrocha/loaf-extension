# Loaf 🟠

> the cat is watching.

A Chrome extension that sets daily time limits on any site. Go over, and a chonky orange cat takes over your screen until midnight.

---

## How it works

- Click the toolbar icon, type a number of minutes, hit save.
- The background service worker accumulates time on that site in 5-second buckets while the tab is focused (idle / background tabs don't count).
- When you cross the limit, the content script injects a full-screen overlay:
  - The cat video plays its **first 7 seconds** (cat walks in, sits down).
  - From second 7 onwards, the **last 4 seconds loop forever** (cat just watches you).
  - The page bleeds through faintly behind the warm-brown dim — your tab isn't gone, it's just judged.
  - A countdown shows how long until midnight resets the clock.
- Reload the page and the cat is still there. The block survives refreshes.

## Install (developer mode)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and pick this folder.
4. Pin Loaf to your toolbar.

## Files

```
loaf/
├── manifest.json     ← MV3 manifest
├── background.js     ← service worker, time tracking, block trigger
├── content.js        ← injected into every page, shows the cat
├── content.css       ← the brown-glass overlay styling
├── popup.html/css/js ← the toolbar popup UI
├── cat.webm          ← the cat (alpha-channel WebM, 11s)
└── icons/            ← 16 / 48 / 128 px
```

## Customising

- **Daily reset**: currently resets at local midnight. To change, edit `secondsUntilMidnight()` in `content.js` and the day-bucketing in `background.js`.
- **Loop window**: edit `INTRO_END` (default 7) and `TOTAL_END` (default 11) at the top of `content.js`.
- **Tracked sites**: managed live via the popup. Subdomain matches are automatic — a limit on `twitter.com` covers `www.twitter.com` and `x.twitter.com`.

## Tech notes

- MV3 service worker, so tracking uses `chrome.alarms` (5s tick) + `chrome.idle` rather than `setInterval` — survives worker termination.
- Storage is `chrome.storage.local`; usage older than 7 days is auto-pruned.
- Video must be a VP9/VP8 WebM with `alpha_mode=1` for transparency. The supplied `cat.webm` already is one.
- Overlay uses `z-index: 2147483647` and `pointer-events: auto` to sit on top of even sticky site UIs (Twitter sidebar, etc.).
