/**
 * Shared YouTube URL helpers (service worker, content scripts, extension pages).
 */
(function (root) {
  const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
  const VIDEO_ID_RE = /^[\w-]{11}$/;
  const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,120}$/;

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

  function extractYouTubePlaylistId(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (PLAYLIST_ID_RE.test(raw) && !raw.includes(".")) {
      // Auto-generated mix/radio lists are unstable via the Data API.
      if (/^RD/i.test(raw)) return null;
      return raw;
    }
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = parseUrl(normalized);
    if (!u || !isYouTubeHost(u.hostname)) return null;
    const listId = String(u.searchParams.get("list") || "").trim();
    if (!PLAYLIST_ID_RE.test(listId)) return null;
    if (/^RD/i.test(listId)) return null;
    return listId;
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
    extractYouTubePlaylistId,
    isYouTubeWatchUrl,
    isYouTubeShortsUrl,
    isSupportedYouTubeVideoUrl,
    canonicalYouTubeVideoUrl,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
