/**
 * Runs on YouTube watch pages. Responds to TUBESTACK_GET_METADATA with player/DOM hints.
 */
(function () {
  if (window.__TUBESTACK_METADATA__) return;
  window.__TUBESTACK_METADATA__ = true;

  function parseIsoDuration(iso) {
    if (!iso || typeof iso !== "string" || !iso.startsWith("PT")) return null;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return null;
    const h = parseInt(m[1] || "0", 10);
    const min = parseInt(m[2] || "0", 10);
    const s = parseInt(m[3] || "0", 10);
    return h * 3600 + min * 60 + s;
  }

  function getFromYtInitialData() {
    try {
      if (typeof window.ytInitialPlayerResponse === "object" && window.ytInitialPlayerResponse) {
        const json = window.ytInitialPlayerResponse;
        const vd = json?.videoDetails;
        if (vd?.videoId) {
          const thumbs = vd?.thumbnail?.thumbnails;
          const thumbnail = thumbs?.length ? thumbs[thumbs.length - 1]?.url : null;
          return {
            videoId: vd.videoId,
            title: vd.title || document.title,
            channel: vd.author || null,
            durationSec: vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : null,
            thumbnail,
          };
        }
      }
      const scripts = document.querySelectorAll("script");
      for (const el of scripts) {
        const t = el.textContent || "";
        if (!t.includes("var ytInitialPlayerResponse")) continue;
        const match = t.match(/var ytInitialPlayerResponse\s*=\s*({.+?});/s);
        if (!match) continue;
        const json = JSON.parse(match[1]);
        const vd = json?.videoDetails;
        if (!vd?.videoId) continue;
        const thumbs = vd?.thumbnail?.thumbnails;
        const thumbnail = thumbs?.length ? thumbs[thumbs.length - 1]?.url : null;
        return {
          videoId: vd.videoId,
          title: vd.title || document.title,
          channel: vd.author || null,
          durationSec: vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : null,
          thumbnail,
        };
      }
    } catch {
      /* */
    }
    return null;
  }

  function getFromJsonLd() {
    const nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (const n of nodes) {
      try {
        const j = JSON.parse(n.textContent || "{}");
        const graph = Array.isArray(j["@graph"]) ? j["@graph"] : [j];
        for (const node of graph) {
          if (node["@type"] === "VideoObject" && node.embedUrl) {
            const u = new URL(node.embedUrl);
            const id = u.searchParams.get("v");
            if (!id) continue;
            const dur = node.duration ? parseIsoDuration(node.duration) : null;
            return {
              videoId: id,
              title: node.name || document.title,
              channel: node.author?.name || null,
              durationSec: dur,
              thumbnail: node.thumbnailUrl?.[0] || node.thumbnailUrl || null,
            };
          }
        }
      } catch {
        /* */
      }
    }
    return null;
  }

  function getCurrentTimeFromVideo() {
    const v = document.querySelector("video");
    if (v && !Number.isNaN(v.currentTime) && v.currentTime > 2) {
      return Math.floor(v.currentTime);
    }
    return null;
  }

  function collect() {
    const fromPlayer = getFromYtInitialData();
    const fromLd = getFromJsonLd();
    const base = fromPlayer || fromLd || {};
    const url = new URL(window.location.href);
    const vParam = url.searchParams.get("v");
    const videoId = base.videoId || vParam || null;
    const fromPlayer = getCurrentTimeFromVideo();
    let timestampSec = fromPlayer;
    /** "page_player" | "url_only" | null — tells the service worker whether progress is from the <video> element. */
    let progressCapture = fromPlayer != null ? "page_player" : null;
    if (timestampSec == null) {
      const t = url.searchParams.get("t") || url.searchParams.get("start");
      if (t) {
        if (/^\d+$/.test(t)) {
          timestampSec = parseInt(t, 10);
          progressCapture = "url_only";
        }
      }
    }
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const ogImage = document.querySelector('meta[property="og:image"]')?.content;
    const channelEl =
      document.querySelector("ytd-channel-name a") ||
      document.querySelector("#channel-name a") ||
      document.querySelector('link[itemprop="name"]');
    const channel =
      base.channel ||
      channelEl?.textContent?.trim() ||
      document.querySelector('meta[itemprop="author"]')?.content ||
      null;

    return {
      videoId,
      title: base.title || ogTitle || document.title?.replace(/\s*-\s*YouTube\s*$/i, "") || "YouTube",
      channel,
      durationSec: base.durationSec ?? null,
      thumbnail: base.thumbnail || ogImage || null,
      timestampSec,
      progressCapture,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "TUBESTACK_GET_METADATA") return;
    try {
      const data = collect();
      sendResponse({ ok: true, data });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  });
})();
