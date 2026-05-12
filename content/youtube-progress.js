/**
 * Watch-page progress heartbeats for TubeStack (time watched + playhead for sorting).
 */
(function () {
  if (window.__TUBESTACK_PROGRESS__) return;
  window.__TUBESTACK_PROGRESS__ = true;

  let lastSent = 0;
  let lastTime = 0;
  let accDelta = 0;
  let tickTimer = null;

  function stopTicker() {
    if (tickTimer != null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function sendProgressTick(payload) {
    try {
      if (!chrome.runtime?.id) {
        stopTicker();
        return;
      }
      chrome.runtime.sendMessage(payload, () => {
        const err = chrome.runtime.lastError;
        if (err && /invalidated/i.test(String(err.message || err))) {
          stopTicker();
        }
      });
    } catch {
      stopTicker();
    }
  }

  function getVideo() {
    return document.querySelector("video");
  }

  function getVideoId() {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("v");
    } catch {
      return null;
    }
  }

  function tick() {
    const v = getVideo();
    const videoId = getVideoId();
    if (!v || !videoId || !v.duration || Number.isNaN(v.duration)) return;

    const now = performance.now();
    const t = v.currentTime || 0;
    const playing = !v.paused && !v.ended && document.visibilityState === "visible";

    if (playing && lastTime > 0) {
      const dt = (now - lastSent) / 1000;
      if (dt > 0 && dt < 5) accDelta += dt;
    }
    lastTime = t;

    const shouldFlush = accDelta >= 8 || (playing && performance.now() - lastSent > 15000);
    if (!shouldFlush) return;

    const playheadSec = Math.floor(t);
    const durationSec = Math.floor(v.duration);
    const deltaWatch = Math.floor(accDelta);
    accDelta = 0;
    lastSent = performance.now();

    if (deltaWatch > 0 || playheadSec > 0) {
      sendProgressTick({
        type: "TUBESTACK_PROGRESS_TICK",
        videoId,
        playheadSec,
        durationSec,
        deltaWatchSec: deltaWatch,
        visible: document.visibilityState === "visible",
      });
    }
  }

  tickTimer = setInterval(tick, 2000);
  document.addEventListener("visibilitychange", () => {
    lastSent = performance.now();
    accDelta = 0;
  });
})();
