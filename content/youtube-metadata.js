/**
 * Runs on YouTube watch and Shorts pages. Responds to TUBESTACK_GET_METADATA with player/DOM hints.
 */
(function () {
  if (window.__TUBESTACK_METADATA__) return;
  window.__TUBESTACK_METADATA__ = true;

  const YT = globalThis.TUBESTACK_YT_URL;

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
          if (node["@type"] !== "VideoObject") continue;
          let id = null;
          if (node.embedUrl) {
            id = YT?.extractYouTubeVideoId(node.embedUrl);
          }
          if (!id && node.url) {
            id = YT?.extractYouTubeVideoId(node.url);
          }
          if (!id && node.contentUrl) {
            id = YT?.extractYouTubeVideoId(node.contentUrl);
          }
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

  function collectChannel(base) {
    const channelEl =
      document.querySelector("ytd-channel-name a") ||
      document.querySelector("#channel-name a") ||
      document.querySelector("ytd-reel-player-header-renderer #channel-name a") ||
      document.querySelector("yt-reel-player-header-renderer #channel-name a") ||
      document.querySelector('link[itemprop="name"]');
    return (
      base.channel ||
      channelEl?.textContent?.trim() ||
      document.querySelector('meta[itemprop="author"]')?.content ||
      document.querySelector('meta[property="og:video:tag"]')?.content ||
      null
    );
  }

  function collect() {
    const pageUrl = window.location.href;
    const playerMeta = getFromYtInitialData();
    const fromLd = getFromJsonLd();
    const base = playerMeta || fromLd || {};
    const videoId = base.videoId || YT?.extractYouTubeVideoId(pageUrl) || null;
    const currentTime = getCurrentTimeFromVideo();
    let timestampSec = currentTime;
    /** "page_player" | "url_only" | null — tells the service worker whether progress is from the <video> element. */
    let progressCapture = currentTime != null ? "page_player" : null;
    if (timestampSec == null) {
      try {
        const u = new URL(pageUrl);
        const t = u.searchParams.get("t") || u.searchParams.get("start");
        if (t && /^\d+$/.test(t)) {
          timestampSec = parseInt(t, 10);
          progressCapture = "url_only";
        }
      } catch {
        /* */
      }
    }
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const ogImage = document.querySelector('meta[property="og:image"]')?.content;
    let title =
      base.title ||
      ogTitle ||
      document.title?.replace(/\s*-\s*YouTube\s*$/i, "").trim() ||
      null;
    if (title && /^youtube$/i.test(title.trim())) title = null;
    const thumbnail =
      base.thumbnail ||
      ogImage ||
      (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
    if (!title) {
      title = ogTitle?.replace(/\s*-\s*YouTube\s*$/i, "").trim() || null;
      if (title && /^youtube$/i.test(title.trim())) title = null;
    }
    if (!title) title = "YouTube video";

    return {
      videoId,
      title,
      channel: collectChannel(base),
      durationSec: base.durationSec ?? null,
      thumbnail,
      timestampSec,
      progressCapture,
      pageUrl,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "TUBESTACK_GET_METADATA") {
      try {
        const data = collect();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
    if (msg?.type === "TUBESTACK_REQUEST_PIP") {
      void requestPictureInPicture(msg.videoId).then(sendResponse);
      return true;
    }
  });

  async function requestPictureInPicture(expectedVideoId) {
    const v = document.querySelector("video");
    if (!v) {
      return { ok: false, error: "no_video", message: "No video player on this page." };
    }

    const pageVideoId = YT?.extractYouTubeVideoId(window.location.href) || null;
    const expected = String(expectedVideoId || "").trim();
    if (expected && pageVideoId && expected !== pageVideoId) {
      return {
        ok: false,
        error: "video_mismatch",
        message: "Playback tab is on a different video.",
      };
    }

    if (document.pictureInPictureElement === v) {
      return { ok: true, already: true };
    }

    if (typeof v.requestPictureInPicture === "function") {
      try {
        await v.requestPictureInPicture();
        return { ok: true };
      } catch {
        /* try YouTube control */
      }
    }

    const btn =
      document.querySelector("button.ytp-pip-button") ||
      document.querySelector('button[aria-label*="Picture-in-Picture"]') ||
      document.querySelector('button[aria-label*="picture-in-picture"]');
    if (btn) {
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (document.pictureInPictureElement) {
        return { ok: true, via: "button" };
      }
    }

    return {
      ok: false,
      error: "pip_failed",
      message: "Picture-in-Picture is not available for this video right now.",
    };
  }
})();
