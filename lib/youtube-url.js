/**
 * Shared YouTube URL helpers (service worker, content scripts, extension pages).
 */
(function (root) {
  const YT_HOSTS = new Set(["www.youtube.com", "m.youtube.com"]);
  const VIDEO_ID_RE = /^[\w-]{11}$/;

  function parseUrl(url) {
    try {
      return new URL(String(url || "").trim());
    } catch {
      return null;
    }
  }

  function isYouTubeHost(hostname) {
    return YT_HOSTS.has(String(hostname || ""));
  }

  function isValidYouTubeVideoId(id) {
    return VIDEO_ID_RE.test(String(id || "").trim());
  }

  function extractYouTubeVideoId(url) {
    const u = parseUrl(url);
    if (!u || !isYouTubeHost(u.hostname)) return null;
    if (u.pathname === "/watch" || u.pathname.startsWith("/watch/")) {
      const v = u.searchParams.get("v");
      if (v && isValidYouTubeVideoId(v)) return v;
    }
    const shortsMatch = u.pathname.match(/^\/shorts\/([^/?#]+)/i);
    if (shortsMatch?.[1] && isValidYouTubeVideoId(shortsMatch[1])) return shortsMatch[1];
    return null;
  }

  function isYouTubeWatchUrl(url) {
    const u = parseUrl(url);
    if (!u || !isYouTubeHost(u.hostname)) return false;
    if (u.pathname !== "/watch" && !u.pathname.startsWith("/watch/")) return false;
    const v = u.searchParams.get("v");
    return Boolean(v && isValidYouTubeVideoId(v));
  }

  function isYouTubeShortsUrl(url) {
    const u = parseUrl(url);
    if (!u || !isYouTubeHost(u.hostname)) return false;
    const m = u.pathname.match(/^\/shorts\/([^/?#]+)/i);
    return Boolean(m?.[1] && isValidYouTubeVideoId(m[1]));
  }

  function isSupportedYouTubeVideoUrl(url) {
    return isYouTubeWatchUrl(url) || isYouTubeShortsUrl(url);
  }

  function canonicalYouTubeVideoUrl(videoId, { shorts = false, timestampSec = null } = {}) {
    if (!isValidYouTubeVideoId(videoId)) return null;
    const id = String(videoId).trim();
    if (shorts) {
      return `https://www.youtube.com/shorts/${encodeURIComponent(id)}`;
    }
    let base = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    if (timestampSec != null && timestampSec > 0) {
      base += `&t=${Math.floor(timestampSec)}s`;
    }
    return base;
  }

  root.TUBESTACK_YT_URL = {
    YT_HOSTS,
    isValidYouTubeVideoId,
    extractYouTubeVideoId,
    isYouTubeWatchUrl,
    isYouTubeShortsUrl,
    isSupportedYouTubeVideoUrl,
    canonicalYouTubeVideoUrl,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
