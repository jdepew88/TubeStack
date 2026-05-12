/**
 * Injected on YouTube tabs to scrape visible channel / subscription names from feed layouts.
 */
(function () {
  if (window.__TUBESTACK_CHANNEL_SCRAPE__) return;
  window.__TUBESTACK_CHANNEL_SCRAPE__ = true;

  function textClean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function scrapeDom() {
    const names = new Set();
    const add = (t) => {
      const x = textClean(t);
      if (x.length > 1 && x.length < 80) names.add(x);
    };

    document.querySelectorAll("#channel-title a, ytd-channel-name a").forEach((el) => add(el.textContent));
    document.querySelectorAll("ytd-grid-channel-renderer #text a").forEach((el) => add(el.textContent));
    document.querySelectorAll("ytd-mini-channel-info #channel-name a").forEach((el) => add(el.textContent));
    document.querySelectorAll("#metadata-line a").forEach((el) => add(el.textContent));

    return [...names];
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function deepScrapeAllChannels() {
    const names = new Set(scrapeDom());
    let lastHeight = 0;
    let stablePasses = 0;
    for (let i = 0; i < 24; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight || 0);
      await sleep(350);
      for (const n of scrapeDom()) names.add(n);
      const h = Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0);
      if (h <= lastHeight + 2) stablePasses++;
      else stablePasses = 0;
      lastHeight = h;
      if (stablePasses >= 3) break;
    }
    window.scrollTo(0, 0);
    return [...names];
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "TUBESTACK_SCRAPE_CHANNELS") return;
    (async () => {
      try {
        const channels = msg?.deepScan ? await deepScrapeAllChannels() : scrapeDom();
        sendResponse({ ok: true, channels });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  });
})();
