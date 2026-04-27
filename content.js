// Loaf — content script
// Injects the cat blocker overlay when the background tells us the limit is up.

(function () {
  const INTRO_END = 7;     // seconds — cat walks/sits during 0–7
  const TOTAL_END = 11;    // seconds — sit-and-watch loops between 7–11
  let overlay = null;
  let timerInterval = null;

  function fmt(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function secondsUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return Math.max(0, Math.floor((midnight - now) / 1000));
  }

  function buildOverlay(host) {
    const root = document.createElement('div');
    root.id = 'loaf-root';
    root.innerHTML = `
      <div class="loaf-dim"></div>
      <div class="loaf-stage">
        <div class="loaf-text">
          <div class="loaf-brand">
            <span class="loaf-dot"></span>
            <span>loaf</span>
          </div>
          <div class="loaf-headline">time's up.</div>
          <div class="loaf-host">${host || 'this site'}</div>
          <div class="loaf-timer-wrap">
            <div class="loaf-timer-label">unblocks in</div>
            <div class="loaf-timer">--:--</div>
          </div>
        </div>
        <video class="loaf-cat" muted playsinline autoplay preload="auto">
          <source src="${chrome.runtime.getURL('cat.webm')}" type="video/webm">
        </video>
      </div>
    `;
    return root;
  }

  function startVideoLogic(video) {
    // First playthrough is 0 → end. After it crosses past INTRO_END once, we
    // loop the watching segment INTRO_END → TOTAL_END forever.
    let introDone = false;

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    });

    video.addEventListener('timeupdate', () => {
      if (!introDone && video.currentTime >= INTRO_END - 0.05) {
        // we've reached the watching segment for the first time —
        // from now on, loop between INTRO_END and TOTAL_END
        introDone = true;
      }
      if (introDone && video.currentTime >= TOTAL_END - 0.08) {
        video.currentTime = INTRO_END;
        video.play().catch(() => {});
      }
    });

    video.addEventListener('ended', () => {
      introDone = true;
      video.currentTime = INTRO_END;
      video.play().catch(() => {});
    });
  }

  function startTimer() {
    const el = overlay.querySelector('.loaf-timer');
    const tick = () => {
      el.textContent = fmt(secondsUntilMidnight());
    };
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function showBlocker(host) {
    if (overlay) return;
    overlay = buildOverlay(host);
    (document.body || document.documentElement).appendChild(overlay);
    document.documentElement.classList.add('loaf-blocked');
    startVideoLogic(overlay.querySelector('.loaf-cat'));
    startTimer();
  }

  function hideBlocker() {
    if (!overlay) return;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    overlay.remove();
    overlay = null;
    document.documentElement.classList.remove('loaf-blocked');
  }

  // Listen for the block command from the background worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'LOAF_BLOCK') {
      showBlocker(msg.host);
    } else if (msg && msg.type === 'LOAF_UNBLOCK') {
      hideBlocker();
    }
  });

  // On page load, ask the background whether this host is already over its limit
  // (so a refresh keeps the cat there).
  chrome.runtime.sendMessage({ type: 'LOAF_GET_STATE' }, (state) => {
    if (!state || !state.limitKey) return;
    const used = state.todayUsage[state.limitKey] || 0;
    const limit = state.limits[state.limitKey] || Infinity;
    if (used >= limit) showBlocker(state.limitKey);
  });
})();
