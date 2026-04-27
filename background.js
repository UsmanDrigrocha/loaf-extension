// Loaf — background service worker
// Tracks per-domain time spent today and triggers the block when limits are hit.

const STORAGE_LIMITS = 'limits';        // { "twitter.com": 1800, ... }  (seconds)
const STORAGE_USAGE = 'usage';          // { "2026-04-27": { "twitter.com": 1234 } }
const TICK_SECONDS = 5;                 // accumulate in 5s buckets

// ---------- helpers ----------

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function hostFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    // strip leading "www."
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

// match a host against a limit key — limit "twitter.com" matches "x.twitter.com"
function matchLimitKey(host, limits) {
  if (!host) return null;
  if (limits[host] != null) return host;
  for (const key of Object.keys(limits)) {
    if (host === key || host.endsWith('.' + key)) return key;
  }
  return null;
}

async function getLimits() {
  const r = await chrome.storage.local.get(STORAGE_LIMITS);
  return r[STORAGE_LIMITS] || {};
}

async function getUsage() {
  const r = await chrome.storage.local.get(STORAGE_USAGE);
  const all = r[STORAGE_USAGE] || {};
  const today = todayKey();
  // prune anything older than 7 days to keep storage tidy
  const keep = {};
  const cutoff = Date.now() - 7 * 86400_000;
  for (const [day, data] of Object.entries(all)) {
    if (new Date(day).getTime() >= cutoff) keep[day] = data;
  }
  if (!keep[today]) keep[today] = {};
  return keep;
}

async function saveUsage(usage) {
  await chrome.storage.local.set({ [STORAGE_USAGE]: usage });
}

// ---------- active tracking ----------

let activeTabId = null;
let activeHost = null;
let activeWindowFocused = true;
let userIdle = false;

async function refreshActive() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url) {
      activeTabId = null;
      activeHost = null;
      return;
    }
    activeTabId = tab.id;
    activeHost = hostFromUrl(tab.url);
  } catch (_) {
    activeTabId = null;
    activeHost = null;
  }
}

chrome.tabs.onActivated.addListener(() => refreshActive());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url || info.status === 'complete') refreshActive();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  activeWindowFocused = windowId !== chrome.windows.WINDOW_ID_NONE;
  if (activeWindowFocused) refreshActive();
});
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener((state) => {
  userIdle = state !== 'active';
});

// ---------- tick ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('loaf-tick', { periodInMinutes: TICK_SECONDS / 60 });
  refreshActive();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('loaf-tick', { periodInMinutes: TICK_SECONDS / 60 });
  refreshActive();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'loaf-tick') return;
  if (!activeWindowFocused || userIdle) return;
  if (!activeHost) {
    await refreshActive();
    if (!activeHost) return;
  }

  const limits = await getLimits();
  const limitKey = matchLimitKey(activeHost, limits);
  if (!limitKey) return; // not a tracked site

  const usage = await getUsage();
  const today = todayKey();
  usage[today][limitKey] = (usage[today][limitKey] || 0) + TICK_SECONDS;
  await saveUsage(usage);

  const used = usage[today][limitKey];
  const limit = limits[limitKey];

  if (used >= limit && activeTabId != null) {
    // tell the active tab to block
    try {
      await chrome.tabs.sendMessage(activeTabId, {
        type: 'LOAF_BLOCK',
        host: limitKey,
        used,
        limit
      });
    } catch (_) {
      // content script may not be injected on this page (chrome:// etc.) — ignore
    }
  }
});

// ---------- messages from popup / content ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'LOAF_GET_STATE') {
      const limits = await getLimits();
      const usage = await getUsage();
      const today = todayKey();
      let host = null;
      if (sender.tab && sender.tab.url) host = hostFromUrl(sender.tab.url);
      else if (msg.host) host = msg.host;
      else {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        host = tab ? hostFromUrl(tab.url) : null;
      }
      const limitKey = host ? matchLimitKey(host, limits) : null;
      sendResponse({
        host,
        limitKey,
        limits,
        todayUsage: usage[today] || {},
        today
      });
      return;
    }

    if (msg.type === 'LOAF_SET_LIMIT') {
      const limits = await getLimits();
      if (msg.seconds > 0) limits[msg.host] = msg.seconds;
      else delete limits[msg.host];
      await chrome.storage.local.set({ [STORAGE_LIMITS]: limits });
      sendResponse({ ok: true, limits });
      return;
    }

    if (msg.type === 'LOAF_RESET_TODAY') {
      const usage = await getUsage();
      const today = todayKey();
      if (msg.host) delete usage[today][msg.host];
      else usage[today] = {};
      await saveUsage(usage);
      sendResponse({ ok: true });
      return;
    }
  })();
  return true; // keep channel open for async sendResponse
});
