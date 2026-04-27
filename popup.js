// Loaf — popup logic

const $ = (sel) => document.querySelector(sel);

function fmtMin(seconds) {
  if (!seconds) return '0m';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

let state = null;

async function refresh() {
  state = await send({ type: 'LOAF_GET_STATE' });
  render();
}

function render() {
  if (!state) return;
  const host = state.host || 'unknown';
  $('#host').textContent = host;

  const limitKey = state.limitKey || host;
  const limit = state.limits[limitKey] || 0;
  const used = state.todayUsage[limitKey] || 0;

  // limit input shows current value (or empty/default)
  $('#minutes').value = limit ? Math.round(limit / 60) : '';

  // usage pill
  const pill = $('#usage-pill');
  if (limit > 0) {
    pill.textContent = `${fmtMin(used)} / ${fmtMin(limit)}`;
    pill.classList.toggle('over', used >= limit);
  } else {
    pill.textContent = `${fmtMin(used)} · no limit`;
    pill.classList.remove('over');
  }

  // bar
  const bar = $('#bar-fill');
  if (limit > 0) {
    const pct = Math.min(100, (used / limit) * 100);
    bar.style.width = pct + '%';
    bar.classList.toggle('over', used >= limit);
  } else {
    bar.style.width = '0%';
    bar.classList.remove('over');
  }

  // list of other tracked sites
  const list = $('#list');
  list.innerHTML = '';
  const entries = Object.entries(state.limits)
    .filter(([h]) => h !== limitKey)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'nothing else, yet.';
    list.appendChild(li);
  } else {
    for (const [h, lim] of entries) {
      const u = state.todayUsage[h] || 0;
      const li = document.createElement('li');
      const over = u >= lim;
      li.innerHTML = `
        <span class="host-name">${h}</span>
        <span class="meta ${over ? 'over' : ''}">${fmtMin(u)} / ${fmtMin(lim)}</span>
      `;
      list.appendChild(li);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refresh();

  $('#save').addEventListener('click', async () => {
    if (!state || !state.host) return;
    const minutes = parseInt($('#minutes').value, 10);
    if (isNaN(minutes) || minutes < 0) return;
    await send({
      type: 'LOAF_SET_LIMIT',
      host: state.host,
      seconds: minutes * 60
    });
    await refresh();
  });

  $('#off').addEventListener('click', async () => {
    if (!state || !state.host) return;
    await send({ type: 'LOAF_SET_LIMIT', host: state.host, seconds: 0 });
    await refresh();
  });

  $('#reset').addEventListener('click', async () => {
    if (!state || !state.host) return;
    const key = state.limitKey || state.host;
    await send({ type: 'LOAF_RESET_TODAY', host: key });
    // also tell content script in current tab to unblock
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'LOAF_UNBLOCK' }); } catch (_) {}
    }
    await refresh();
  });

  // also save on Enter
  $('#minutes').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#save').click();
  });
});
