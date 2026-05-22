/**
 * TubeStack — background: YouTube tabs, library, themes, progress, playlist pack.
 * Host access: youtube.com / m.youtube.com (manifest). Google YouTube API + OpenAI are optional_host_permissions
 * and are requested at runtime only when those features run (see ensureGoogleApisHostAccess / ensureOpenaiHostAccess).
 */

const YT_HOSTS = new Set(["www.youtube.com", "m.youtube.com"]);

importScripts("granular-genres.js");
importScripts("genre-taxonomy.js");
importScripts("../lib/watch-states.js");
const TS_WATCH = globalThis.TUBESTACK_WATCH;
const GRANULAR_GENRE_PRESETS = globalThis.GRANULAR_GENRE_PRESETS || [];
delete globalThis.GRANULAR_GENRE_PRESETS;
const BROAD_GENRE_TAXONOMY = globalThis.TUBESTACK_BROAD_GENRES || [];
delete globalThis.TUBESTACK_BROAD_GENRES;

const MAX_FAVORITE_THEMES = 8;
const MAX_PLAYLIST_THEMES = 5;

const SEED_THEMES = [
  { label: "Gaming", keywords: ["gaming", "gameplay", "gamer", "speedrun", "esports", "walkthrough", "lets play"] },
  { label: "Emulation", keywords: ["emulator", "emulation", "retroarch", "dolphin", "pcsx2", "cemu", "rom hack", "mame"] },
  { label: "Tech & software", keywords: ["software", "programming", "developer", "linux", "windows", "review", "tutorial code", "ai", "machine learning"] },
  { label: "Science", keywords: ["science", "physics", "chemistry", "biology", "space", "nasa", "experiment"] },
  { label: "News & politics", keywords: ["news", "breaking", "politics", "election", "government", "policy", "journalism"] },
  { label: "Music", keywords: ["music", "album", "song", "live performance", "concert", "remix", "cover"] },
  { label: "Film & TV", keywords: ["movie", "film", "tv show", "trailer", "recap", "cinema", "series"] },
  { label: "Education", keywords: ["lecture", "course", "explained", "learn", "history lesson", "math", "language learning"] },
  { label: "DIY & repair", keywords: ["repair", "diy", "how to fix", "teardown", "restoration", "build"] },
  { label: "Fitness & health", keywords: ["workout", "fitness", "gym", "health", "nutrition", "yoga", "running"] },
  { label: "Cooking", keywords: ["recipe", "cooking", "chef", "bake", "food", "kitchen"] },
  { label: "Comedy & entertainment", keywords: ["comedy", "sketch", "standup", "funny", "entertainment", "reaction"] },
  { label: "Finance & business", keywords: ["finance", "stock", "investing", "business", "startup", "economy", "market"] },
  { label: "Travel & culture", keywords: ["travel", "vlog", "culture", "tour", "city guide", "adventure"] },
  { label: "Art & design", keywords: ["art", "design", "drawing", "animation", "graphic design", "photography"] },
  { label: "Sports", keywords: ["sports", "highlights", "nba", "nfl", "soccer", "football", "olympics"] },
];

/** Saved per-video "List" values (UI: List). */
const DEFAULT_CATEGORIES = [
  "watch_later",
  "long_play",
  "shorts",
  "documentary",
  "music",
  "custom",
];

const LEGACY_LIST_CATEGORY = {
  watch_soon: "watch_later",
  finish_later: "watch_later",
  reference: "custom",
  tutorial: "long_play",
  news: "documentary",
  background: "long_play",
  music: "music",
};

const VALID_PRIORITIES = new Set(["prio_high", "prio_med", "prio_low", "prio_drop"]);
const LEGACY_PRIORITY = {
  must: "prio_high",
  maybe: "prio_med",
  archive: "prio_low",
  delete: "prio_drop",
  watched_enough: "prio_drop",
};

function migrateLibraryListAndPriority(items) {
  const validC = new Set(DEFAULT_CATEGORIES);
  let changed = false;
  for (const it of items) {
    if (LEGACY_PRIORITY[it.priority]) {
      it.priority = LEGACY_PRIORITY[it.priority];
      changed = true;
    } else if (!VALID_PRIORITIES.has(it.priority)) {
      it.priority = "prio_med";
      changed = true;
    }
    if (LEGACY_LIST_CATEGORY[it.category]) {
      it.category = LEGACY_LIST_CATEGORY[it.category];
      changed = true;
    } else if (!validC.has(it.category)) {
      it.category = "custom";
      changed = true;
    }
  }
  return changed;
}

function isYouTubeWatchUrl(url) {
  try {
    const u = new URL(url);
    if (!YT_HOSTS.has(u.hostname)) return false;
    if (u.pathname === "/watch" && u.searchParams.has("v")) return true;
    return /^\/shorts\/[^/?#]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

function normalizeWatchUrl(videoId, timestampSec) {
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  if (timestampSec != null && timestampSec > 0) {
    return `${base}&t=${Math.floor(timestampSec)}s`;
  }
  return base;
}

function parseVideoId(url) {
  try {
    const u = new URL(url);
    const watchId = u.searchParams.get("v");
    if (watchId) return watchId;
    const m = u.pathname.match(/^\/shorts\/([^/?#]+)/i);
    if (m?.[1]) return m[1];
    return null;
  } catch {
    return null;
  }
}

/** Match manifest optional_host_permissions (requested before network calls to these origins). */
const OPTIONAL_ORIGINS_GOOGLE_APIS = ["https://www.googleapis.com/*"];
const OPTIONAL_ORIGINS_OPENAI = ["https://api.openai.com/*"];

async function ensureOptionalHostOrigins(origins) {
  try {
    if (await chrome.permissions.contains({ origins })) return true;
  } catch {
    return false;
  }
  try {
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

async function ensureGoogleApisHostAccess() {
  const ok = await ensureOptionalHostOrigins(OPTIONAL_ORIGINS_GOOGLE_APIS);
  if (!ok) {
    const e = new Error(
      "TubeStack needs permission to reach Google’s YouTube API (www.googleapis.com). Allow the browser prompt, or enable that optional site access for this extension, then try again."
    );
    e.code = "host_permission_denied_googleapis";
    throw e;
  }
}

async function ensureOpenaiHostAccess() {
  const ok = await ensureOptionalHostOrigins(OPTIONAL_ORIGINS_OPENAI);
  if (!ok) {
    const e = new Error(
      "TubeStack needs permission to reach OpenAI (api.openai.com) when you use AI features. Allow the prompt or enable optional site access, then try again."
    );
    e.code = "host_permission_denied_openai";
    throw e;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const SAVE_YT_TAB_MODES = new Set(["left", "right", "all", "except_current"]);

async function getYouTubeWatchTabsForMode(mode) {
  const current = await getActiveTab();
  if (!current?.id || current.windowId == null) {
    return { error: "No active tab.", tabs: [], currentTabId: null };
  }
  const all = await chrome.tabs.query({ windowId: current.windowId });
  const currentIndex = current.index ?? 0;
  const watchTabs = all.filter((t) => t.url && isYouTubeWatchUrl(t.url));

  let tabs;
  if (mode === "all") {
    tabs = [...watchTabs];
  } else if (mode === "except_current") {
    tabs = watchTabs.filter((t) => t.id !== current.id);
  } else if (mode === "left") {
    tabs = watchTabs.filter((t) => t.id !== current.id && (t.index ?? 0) < currentIndex);
  } else if (mode === "right") {
    tabs = watchTabs.filter((t) => t.id !== current.id && (t.index ?? 0) > currentIndex);
  } else {
    return { error: "Unknown save mode.", tabs: [], currentTabId: current.id };
  }

  tabs.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return { currentTabId: current.id, tabs };
}

async function getSaveYouTubeTabCounts() {
  const current = await getActiveTab();
  if (!current?.id || current.windowId == null) {
    return { ok: false, error: "No active tab." };
  }
  const all = await chrome.tabs.query({ windowId: current.windowId });
  const currentIndex = current.index ?? 0;
  const watchTabs = all.filter((t) => t.url && isYouTubeWatchUrl(t.url));
  const left = watchTabs.filter((t) => t.id !== current.id && (t.index ?? 0) < currentIndex).length;
  const right = watchTabs.filter((t) => t.id !== current.id && (t.index ?? 0) > currentIndex).length;
  const allCount = watchTabs.length;
  const exceptCurrent = watchTabs.filter((t) => t.id !== current.id).length;
  return { ok: true, left, right, all: allCount, exceptCurrent };
}

async function requestMetadataFromTab(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "TUBESTACK_GET_METADATA" });
    if (res && res.ok) return res.data;
  } catch {
    /* */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/youtube-metadata.js"],
    });
    const res = await chrome.tabs.sendMessage(tabId, { type: "TUBESTACK_GET_METADATA" });
    if (res && res.ok) return res.data;
  } catch {
    /* */
  }
  return null;
}

function uuid() {
  return crypto.randomUUID();
}

async function loadItems() {
  const { items = [] } = await chrome.storage.local.get("items");
  const arr = Array.isArray(items) ? items : [];
  const progressMap = await loadVideoProgress();
  let changed = false;
  for (const it of arr) {
    if (TS_WATCH.normalizeLibraryItemFields(it, progressMap)) changed = true;
  }
  if (changed) await saveItems(arr);
  return arr;
}

async function saveItems(items) {
  await chrome.storage.local.set({ items });
}

/**
 * API keys and the YouTube OAuth Web Client ID persist only inside the `settings` object in
 * chrome.storage.local. The extension has no first-party backend; values leave the device only when
 * you trigger calls to Google or OpenAI. OAuth access tokens for playlist import are RAM-only (__youtubeImportAuth).
 */
async function loadSettings() {
  const data = await chrome.storage.local.get("settings");
  const raw = data.settings && typeof data.settings === "object" ? data.settings : {};
  const { next, changed } = migrateSettingsFieldNames(raw);
  if (changed) await chrome.storage.local.set({ settings: next });
  return next;
}

async function saveSettings(patch) {
  const cur = await loadSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** YouTube category ID → TubeStack seed theme label (must match SEED_THEMES labels). */
const CATEGORY_ID_TO_THEME_LABEL = {
  1: "Film & TV",
  2: "DIY & repair",
  10: "Music",
  17: "Sports",
  19: "Travel & culture",
  20: "Gaming",
  22: "Comedy & entertainment",
  23: "Comedy & entertainment",
  24: "Comedy & entertainment",
  25: "News & politics",
  26: "DIY & repair",
  27: "Education",
  28: "Tech & software",
};

const YT_CATEGORY_LABELS = {
  1: "Film & Animation",
  2: "Autos & Vehicles",
  10: "Music",
  15: "Pets & Animals",
  17: "Sports",
  19: "Travel & Events",
  20: "Gaming",
  22: "People & Blogs",
  23: "Comedy",
  24: "Entertainment",
  25: "News & Politics",
  26: "Howto & Style",
  27: "Education",
  28: "Science & Technology",
};

const TOKEN_STOP = new Set([
  "this",
  "that",
  "with",
  "from",
  "your",
  "have",
  "will",
  "about",
  "what",
  "when",
  "where",
  "just",
  "into",
  "then",
  "than",
  "them",
  "they",
  "there",
  "their",
  "video",
  "full",
  "part",
  "episode",
  "official",
  "trailer",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
  "2026",
]);

function normalizeChannelHandle(input) {
  if (!input) return "";
  let s = String(input).trim();
  if (s.includes("youtube.com") || s.includes("youtu.be")) {
    try {
      const u = new URL(s.startsWith("http") ? s : `https://${s.replace(/^\/\//, "")}`);
      const m = u.pathname.match(/@([^/]+)/);
      if (m) return m[1].toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const ch = u.pathname.match(/\/channel\/([^/]+)/);
      if (ch) return ch[1].trim();
    } catch {
      /* */
    }
  }
  return s
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function tokenizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^#+/, ""))
    .filter((w) => w.length > 3 && !TOKEN_STOP.has(w));
}

/** YouTube Data API v3 with API key — HTTPS only to www.googleapis.com; key is never sent to non-Google hosts. */
async function ytDataApi(apiKey, path, params) {
  await ensureGoogleApisHostAccess();
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  u.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  const res = await fetch(u.toString());
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || `${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.reason = json?.error?.errors?.[0]?.reason;
    throw err;
  }
  return json;
}

async function youtubeChannelProfileScan(apiKey, handleRaw) {
  const handle = normalizeChannelHandle(handleRaw);
  if (!apiKey || String(apiKey).trim().length < 20) {
    throw new Error("Enter a valid YouTube Data API key (from Google Cloud Console).");
  }
  if (!handle) {
    throw new Error("Enter your channel @handle or paste your channel URL (subscriptions need OAuth later; uploads work with a key).");
  }

  let chJson = await ytDataApi(apiKey, "channels", {
    part: "snippet,contentDetails,statistics",
    forHandle: handle,
  });

  if (!chJson.items?.length && /^UC[\w-]{20,}$/.test(handle)) {
    chJson = await ytDataApi(apiKey, "channels", {
      part: "snippet,contentDetails,statistics",
      id: handle,
    });
  }

  if (!chJson.items?.length) {
    throw new Error(
      "Channel not found. Use the exact @handle from your channel URL, or your channel ID (UC…)."
    );
  }

  const ch = chJson.items[0];
  const uploadsId = ch.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) {
    throw new Error("This channel has no public uploads playlist.");
  }

  const plJson = await ytDataApi(apiKey, "playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsId,
    maxResults: 25,
  });

  const videoIds = (plJson.items || [])
    .map((it) => it.contentDetails?.videoId || it.snippet?.resourceId?.videoId)
    .filter(Boolean);

  if (!videoIds.length) {
    throw new Error("No recent uploads returned — try again or check API quota.");
  }

  const videosOut = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const vidJson = await ytDataApi(apiKey, "videos", {
      part: "snippet,contentDetails",
      id: batch.join(","),
    });
    for (const v of vidJson.items || []) {
      videosOut.push({
        videoId: v.id,
        title: v.snippet?.title || "",
        categoryId: String(v.snippet?.categoryId || ""),
        tags: (v.snippet?.tags || []).map((t) => String(t).toLowerCase()),
      });
    }
  }

  const categoryBreakdown = {};
  for (const v of videosOut) {
    const c = v.categoryId || "0";
    categoryBreakdown[c] = (categoryBreakdown[c] || 0) + 1;
  }

  return {
    channelId: ch.id,
    channelTitle: ch.snippet?.title || handle,
    handle,
    subscriberCount: ch.statistics?.subscriberCount || null,
    videoSamples: videosOut.length,
    categoryBreakdown,
    categoryLabels: YT_CATEGORY_LABELS,
    videos: videosOut,
  };
}

async function applyYoutubeScanToThemes(scan) {
  const themes = await loadThemes();
  const labelToTheme = new Map(themes.map((t) => [t.label, t]));
  const additions = new Map();

  for (const v of scan.videos || []) {
    const mapped = CATEGORY_ID_TO_THEME_LABEL[v.categoryId];
    if (!mapped) continue;
    if (!additions.has(mapped)) additions.set(mapped, new Set());
    const bag = additions.get(mapped);
    for (const t of tokenizeTitle(v.title)) bag.add(t);
    for (const tag of v.tags || []) {
      const s = String(tag).toLowerCase().trim();
      if (s.length > 2 && s.length < 48) bag.add(s);
    }
  }

  for (const [label, extra] of additions) {
    const theme = labelToTheme.get(label);
    if (!theme) continue;
    const kw = new Set((theme.keywords || []).map((k) => String(k).toLowerCase()));
    kw.add(theme.label.toLowerCase());
    for (const x of extra) {
      if (kw.size >= 90) break;
      kw.add(x);
    }
    theme.keywords = [...kw];
  }

  await saveThemes(themes);
  return themes;
}

async function testYoutubeOAuthConnection(msg = {}) {
  const fromMsg = String(msg.youtubeOAuthClientId ?? "").trim();
  const s = await loadSettings();
  const clientId = fromMsg || String(s.youtubeOAuthClientId || "").trim();
  if (!clientId) {
    return {
      ok: false,
      error: "missing_oauth_client_id",
      message: "Paste a Web application OAuth 2.0 Client ID first.",
    };
  }
  try {
    const token = await getYoutubeOAuthAccessToken(clientId);
    const now = Date.now();
    __youtubeImportAuth = { token, clientId: clientId.trim(), expiresAt: now + 45 * 60 * 1000 };
    await markIntegrationTest("youtube_oauth", true);
    return {
      ok: true,
      message: "Google sign-in completed; YouTube scope was granted for this extension.",
    };
  } catch (e) {
    await markIntegrationTest("youtube_oauth", false);
    return { ok: false, error: "oauth_failed", message: String(e.message || e) };
  }
}

async function testYoutubeDataApiKey(apiKeyFromClient) {
  const s = await loadSettings();
  const fromField = String(apiKeyFromClient ?? "").trim();
  const stored = String(s.youtubeDataApiKey || "").trim();
  const key = fromField || stored;
  if (!key || key.length < 20) {
    return {
      ok: false,
      error: "no_key",
      message: "Paste your API key (at least 20 characters), or keep a key already saved on this device.",
    };
  }
  if (!(await ensureOptionalHostOrigins(OPTIONAL_ORIGINS_GOOGLE_APIS))) {
    await markIntegrationTest("youtube_api", false);
    return {
      ok: false,
      error: "host_permission_denied",
      message:
        "TubeStack needs optional access to www.googleapis.com only when you use YouTube API features. Allow the browser prompt and try again.",
    };
  }
  const testUrl = `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(testUrl);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `${res.status} ${res.statusText}`;
      await markIntegrationTest("youtube_api", false);
      return { ok: false, error: "api_error", message: msg };
    }
    if (json.error) {
      await markIntegrationTest("youtube_api", false);
      return { ok: false, error: "api_error", message: json.error.message || "YouTube API returned an error." };
    }
    await markIntegrationTest("youtube_api", true);
    return {
      ok: true,
      message: "YouTube Data API v3 accepted this key (videos.list probe).",
    };
  } catch (e) {
    await markIntegrationTest("youtube_api", false);
    return { ok: false, error: "network", message: String(e.message || e) };
  }
}

async function saveOobeCredentials(msg = {}) {
  const cur = await loadSettings();
  const next = { ...cur };
  if (msg.email !== undefined) {
    const t = String(msg.email || "").trim();
    if (t) next.youtubeAccountEmail = t;
  }
  if (msg.channelHandle !== undefined) {
    const h = String(msg.channelHandle || "").trim();
    if (h) next.youtubeChannelHandle = normalizeChannelHandle(h);
  }
  if (msg.apiKey !== undefined && String(msg.apiKey || "").trim().length >= 20) {
    next.youtubeDataApiKey = String(msg.apiKey).trim();
  }
  const emailOk = Boolean(next.youtubeAccountEmail && String(next.youtubeAccountEmail).includes("@"));
  const apiOk = Boolean(next.youtubeDataApiKey && String(next.youtubeDataApiKey).trim().length >= 20);
  if (emailOk && apiOk) {
    next.personalizationMode = "full";
  }
  if (msg.youtubeOAuthClientId !== undefined) {
    const o = String(msg.youtubeOAuthClientId || "").trim();
    if (o) next.youtubeOAuthClientId = o;
  }
  await chrome.storage.local.set({ settings: next });
  return { ok: true, settings: sanitizeSettingsForClient(next), hasYoutubeApiKey: Boolean(next.youtubeDataApiKey) };
}

async function runYoutubeApiScan({ boostThemes = true } = {}) {
  const s = await loadSettings();
  const apiKey = s.youtubeDataApiKey;
  const handle = s.youtubeChannelHandle;
  if (!apiKey) return { ok: false, error: "missing_api_key" };
  if (!handle) return { ok: false, error: "missing_handle" };

  let scan;
  try {
    scan = await youtubeChannelProfileScan(apiKey, handle);
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }

  const summary = {
    channelTitle: scan.channelTitle,
    channelId: scan.channelId,
    handle: scan.handle,
    subscriberCount: scan.subscriberCount,
    videoSamples: scan.videoSamples,
    categoryBreakdown: scan.categoryBreakdown,
    scannedAt: new Date().toISOString(),
  };
  await saveSettings({ youtubeLastScanSummary: summary });

  let themes = await loadThemes();
  if (boostThemes) {
    themes = await applyYoutubeScanToThemes(scan);
  }

  return {
    ok: true,
    summary,
    themes,
    message:
      "Pulled recent uploads and categories. Keyword weights were updated for matching themes. Full subscription lists will use OAuth in a future update.",
  };
}

/** Strip secret values before sending `settings` to the dashboard UI (OAuth Client ID stays; it is public). */
function sanitizeSettingsForClient(raw) {
  if (!raw || typeof raw !== "object") return {};
  const s = { ...raw };
  delete s.youtubeDataApiKey;
  delete s.openaiApiKey;
  return s;
}

async function markIntegrationTest(kind, ok) {
  const now = new Date().toISOString();
  const patch = {};
  if (kind === "youtube_api") {
    patch.youtubeApiLastTestAt = now;
    patch.youtubeApiLastTestOk = ok === true;
  } else if (kind === "youtube_oauth") {
    patch.youtubeOAuthLastTestAt = now;
    patch.youtubeOAuthLastTestOk = ok === true;
  } else if (kind === "openai") {
    patch.openaiLastTestAt = now;
    patch.openaiLastTestOk = ok === true;
  } else {
    return;
  }
  await saveSettings(patch);
}

function integrationHealthFromSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    localMode: true,
    youtubeApi: {
      configured: Boolean(String(s.youtubeDataApiKey || "").trim()),
      lastTestAt: s.youtubeApiLastTestAt || null,
      lastTestOk: s.youtubeApiLastTestOk === true,
    },
    youtubeOAuth: {
      configured: Boolean(String(s.youtubeOAuthClientId || "").trim()),
      lastTestAt: s.youtubeOAuthLastTestAt || null,
      lastTestOk: s.youtubeOAuthLastTestOk === true,
    },
    openai: {
      configured: Boolean(String(s.openaiApiKey || "").trim()),
      lastTestAt: s.openaiLastTestAt || null,
      lastTestOk: s.openaiLastTestOk === true,
    },
  };
}

/** Stable short hash for cache keys (titles only; no crypto guarantee). */
function hashStringDjb2(s) {
  const str = String(s || "");
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = Math.imul(h, 33) ^ str.charCodeAt(i);
  return String(h >>> 0);
}

/**
 * User-facing copy for OpenAI HTTP failures (quota, billing, rate limits). Never includes request bodies or keys.
 */
function openAiHttpErrorMessage(status, json) {
  const err = json?.error;
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  const blob = `${code} ${msg} ${status}`.toLowerCase();
  if (status === 429 || blob.includes("rate_limit") || blob.includes("rate limit")) {
    return "OpenAI rate limit reached. Wait a few minutes or check usage limits on platform.openai.com, then try again.";
  }
  if (
    blob.includes("insufficient_quota") ||
    blob.includes("billing") ||
    blob.includes("payment") ||
    blob.includes("credit") ||
    blob.includes("exceeded your")
  ) {
    return "OpenAI quota or billing blocked this request. Add credits or fix billing on platform.openai.com, then try again.";
  }
  if (status === 401) {
    return "OpenAI rejected the API key (401). Paste a valid secret key in Settings and try again.";
  }
  if (msg) return msg;
  return `OpenAI request failed (${status}).`;
}

const OPENAI_LIBRARY_CLASSIFY_CACHE_KEY = "openAiLibraryClassifyV1";
const OPENAI_LIBRARY_CLASSIFY_CACHE_KEY_LEGACY = "openAiHistoryClassifyV1";
const OPENAI_LIBRARY_CLASSIFY_TTL_MS = 7 * 86400000;
const OPENAI_LIBRARY_CLASSIFY_MAX_KEYS = 2500;

const SETTINGS_KEY_MIGRATIONS = [
  ["youtubeHistorySummary", "localViewingSummary"],
  ["youtubeHistoryGenreScanSummary", "localViewingGenreSummary"],
];

/** @type {Set<string>} */
const PROGRESS_SOURCES = new Set([
  "observed_youtube_page",
  "captured_on_save",
  "url_timestamp",
  "manual",
  "unknown",
]);

async function migrateOpenAiLibraryClassifyCache() {
  const bag = await chrome.storage.local.get([
    OPENAI_LIBRARY_CLASSIFY_CACHE_KEY,
    OPENAI_LIBRARY_CLASSIFY_CACHE_KEY_LEGACY,
  ]);
  if (bag[OPENAI_LIBRARY_CLASSIFY_CACHE_KEY_LEGACY] && !bag[OPENAI_LIBRARY_CLASSIFY_CACHE_KEY]) {
    await chrome.storage.local.set({
      [OPENAI_LIBRARY_CLASSIFY_CACHE_KEY]: bag[OPENAI_LIBRARY_CLASSIFY_CACHE_KEY_LEGACY],
    });
    await chrome.storage.local.remove(OPENAI_LIBRARY_CLASSIFY_CACHE_KEY_LEGACY);
  }
}

async function loadOpenAiLibraryClassifyCache() {
  await migrateOpenAiLibraryClassifyCache();
  const bag = await chrome.storage.local.get(OPENAI_LIBRARY_CLASSIFY_CACHE_KEY);
  const c = bag[OPENAI_LIBRARY_CLASSIFY_CACHE_KEY];
  return c && typeof c === "object" ? c : {};
}

function pruneOpenAiLibraryClassifyCache(cache) {
  const entries = Object.entries(cache);
  if (entries.length <= OPENAI_LIBRARY_CLASSIFY_MAX_KEYS) return cache;
  entries.sort((a, b) => (a[1]?.at || 0) - (b[1]?.at || 0));
  const drop = entries.length - OPENAI_LIBRARY_CLASSIFY_MAX_KEYS;
  const next = { ...cache };
  for (let i = 0; i < drop; i++) delete next[entries[i][0]];
  return next;
}

async function saveOpenAiLibraryClassifyCache(cache) {
  await chrome.storage.local.set({
    [OPENAI_LIBRARY_CLASSIFY_CACHE_KEY]: pruneOpenAiLibraryClassifyCache(cache),
  });
}

function migrateSettingsFieldNames(settings) {
  const next = { ...settings };
  let changed = false;
  for (const [oldKey, newKey] of SETTINGS_KEY_MIGRATIONS) {
    if (!Object.prototype.hasOwnProperty.call(next, oldKey)) continue;
    if (!Object.prototype.hasOwnProperty.call(next, newKey)) next[newKey] = next[oldKey];
    delete next[oldKey];
    changed = true;
  }
  return { next, changed };
}

/** Minimal library fields sent to OpenAI (no URLs, transcripts, or Google secrets). */
function buildLibraryItemPayloadForOpenAi(it, themeLabelById) {
  const tags = [...(it.tags || [])].map((t) => String(t).trim()).filter(Boolean).slice(0, 15);
  const suggestedTags = [...(it.suggestedTags || [])].map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
  const out = {
    id: it.id,
    title: String(it.title || "").slice(0, 200),
    channel: String(it.channel || "").slice(0, 120),
    listCategory: String(it.category || "").slice(0, 48),
  };
  const tid = it.themeId != null ? String(it.themeId).trim() : "";
  if (tid && themeLabelById.has(tid)) {
    out.currentCategoryLabel = String(themeLabelById.get(tid) || "").slice(0, 80);
  }
  if (tags.length) out.tags = tags;
  if (suggestedTags.length) out.suggestedTags = suggestedTags;
  const note = TS_WATCH.itemNoteText(it);
  if (note) out.note = note.slice(0, 240);
  const ws = TS_WATCH.normalizeWatchStateId(it.watchState);
  out.watchState = ws;
  out.watchStateLabel = TS_WATCH.watchStateLabel(ws);
  if (Array.isArray(it.timestampNotes) && it.timestampNotes.length) {
    out.timestampNoteCount = it.timestampNotes.length;
  }
  const desc = it.description != null ? String(it.description).trim() : "";
  if (desc) out.descriptionSnippet = desc.slice(0, 320);
  return out;
}

/**
 * Full YouTube account scope (not youtube.readonly): required for user-initiated writes such as
 * playlists.insert / playlistItems.insert. Read-only scope would suffice for subscriptions.list alone, but
 * TubeStack uses one consent flow for create + import + sync to avoid multiple Google prompts.
 */
const YOUTUBE_OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube";

function isValidVideoId(id) {
  return typeof id === "string" && /^[\w-]{11}$/.test(id);
}

/** Opens Google’s OAuth page with interactive: true only. Call only from handlers tied to explicit user actions (dashboard buttons, etc.). */
function getYoutubeOAuthAccessToken(clientId) {
  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirectUri,
    response_type: "token",
    scope: YOUTUBE_OAUTH_SCOPE,
    prompt: "consent",
    include_granted_scopes: "true",
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!responseUrl) {
        reject(new Error("Sign-in was cancelled."));
        return;
      }
      try {
        const hash = new URL(responseUrl).hash.replace(/^#/, "");
        const p = new URLSearchParams(hash);
        const err = p.get("error");
        if (err) {
          reject(new Error(p.get("error_description") || err));
          return;
        }
        const token = p.get("access_token");
        if (!token) reject(new Error("No access token returned. Check OAuth client and redirect URI."));
        else resolve(token);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** YouTube Data API v3 with OAuth Bearer — HTTPS only to www.googleapis.com; bearer never sent to non-Google hosts. */
async function ytOAuthJson(accessToken, method, pathWithQuery, body) {
  await ensureGoogleApisHostAccess();
  const url = `https://www.googleapis.com/youtube/v3/${pathWithQuery}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `${res.status} ${res.statusText}`);
  }
  return json;
}

async function createYoutubePlaylistOnAccount({ title, description, privacyStatus, videoIds }) {
  const settings = await loadSettings();
  const clientId = String(settings.youtubeOAuthClientId || "").trim();
  if (!clientId) {
    return {
      ok: false,
      error:
        "missing_oauth_client_id",
      hint: "Add a Web application OAuth 2.0 Client ID in the sidebar and paste the authorized redirect URI into Google Cloud Console.",
    };
  }

  const p = String(privacyStatus || "private").toLowerCase();
  const privacy = ["public", "private", "unlisted"].includes(p) ? p : "private";
  const uniqueIds = [...new Set((videoIds || []).map(String).filter(isValidVideoId))].slice(0, 200);
  if (!uniqueIds.length) {
    return { ok: false, error: "no_videos", hint: "No valid YouTube video IDs were found in this selection." };
  }

  const auth = await getYoutubeImportAccessTokenCached(clientId);
  if (!auth.ok) {
    return {
      ok: false,
      error: auth.error || "oauth_failed",
      message: auth.message || "Google sign-in was cancelled or failed.",
    };
  }
  const accessToken = auth.accessToken;

  const rawTitle = (title && String(title).trim()) || "TubeStack playlist";
  const ytTitle = rawTitle.length > 150 ? rawTitle.slice(0, 150) : rawTitle;
  const playlist = await ytOAuthJson(accessToken, "POST", "playlists?part=snippet,status", {
    snippet: {
      title: ytTitle,
      description: (description && String(description).trim()) || "Created with TubeStack",
    },
    status: { privacyStatus: privacy },
  });

  const playlistId = playlist?.id;
  if (!playlistId) {
    return { ok: false, error: "playlist_create_failed", hint: "YouTube did not return a playlist id." };
  }

  let added = 0;
  const failures = [];
  for (const videoId of uniqueIds) {
    try {
      await ytOAuthJson(accessToken, "POST", "playlistItems?part=snippet", {
        snippet: {
          playlistId,
          resourceId: { kind: "youtube#video", videoId },
        },
      });
      added++;
      await new Promise((r) => setTimeout(r, 55));
    } catch (e) {
      failures.push({ videoId, message: String(e.message || e) });
    }
  }

  return {
    ok: true,
    playlistId,
    playlistUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    addedCount: added,
    requestedCount: uniqueIds.length,
    failures: failures.slice(0, 5),
  };
}

async function loadThemes() {
  const { themes } = await chrome.storage.local.get("themes");
  if (Array.isArray(themes) && themes.length) return themes;
  return seedThemes();
}

async function seedThemes() {
  const themes = SEED_THEMES.map((t) => ({
    id: uuid(),
    label: t.label,
    keywords: (t.keywords || []).map((k) => k.toLowerCase()),
    tier: "off",
  }));
  await chrome.storage.local.set({ themes });
  return themes;
}

async function saveThemes(themes) {
  await chrome.storage.local.set({ themes });
}

function normalizeVideoProgressRecord(rec) {
  const prev = rec && typeof rec === "object" ? rec : {};
  const playheadSec = Math.max(0, Math.floor(Number(prev.playheadSec) || 0));
  const durationRaw = prev.durationSec;
  const durationSec =
    durationRaw != null && Number.isFinite(Number(durationRaw)) && Number(durationRaw) > 0
      ? Math.floor(Number(durationRaw))
      : null;
  const totalWatchedSec = Math.max(0, Math.floor(Number(prev.totalWatchedSec) || 0));
  const updatedAt =
    typeof prev.updatedAt === "string" && prev.updatedAt ? prev.updatedAt : new Date().toISOString();
  let progressSource = String(prev.progressSource || "").trim();
  if (!PROGRESS_SOURCES.has(progressSource)) progressSource = "unknown";
  const out = { playheadSec, durationSec, updatedAt, totalWatchedSec, progressSource };
  if (prev.capturedAt != null) out.capturedAt = String(prev.capturedAt);
  return out;
}

/** Progress captured when saving/closing tabs (youtube-metadata.js) — never guessed. */
function progressPatchFromSaveMeta(videoId, meta) {
  if (!videoId || !meta || typeof meta !== "object") return null;
  const capture = String(meta.progressCapture || "");
  const dur = Number(meta.durationSec);
  const hasDur = Number.isFinite(dur) && dur > 0;
  const ph = Number(meta.timestampSec);
  const playheadSec = Number.isFinite(ph) && ph >= 0 ? Math.floor(ph) : 0;

  if (capture === "page_player") {
    if (playheadSec <= 0 && !hasDur) return null;
    return {
      playheadSec,
      durationSec: hasDur ? Math.floor(dur) : null,
      progressSource: "captured_on_save",
      capturedAt: new Date().toISOString(),
    };
  }
  if (capture === "url_only" && playheadSec > 0) {
    return {
      playheadSec,
      durationSec: hasDur ? Math.floor(dur) : null,
      progressSource: "url_timestamp",
      capturedAt: new Date().toISOString(),
    };
  }
  return null;
}

function mergeVideoProgressRecord(prev, patch) {
  const base = normalizeVideoProgressRecord(prev);
  const nextPlayhead = Math.max(base.playheadSec, Math.floor(Number(patch.playheadSec) || 0));
  const patchDur = patch.durationSec;
  const nextDur =
    patchDur != null && Number.isFinite(Number(patchDur)) && Number(patchDur) > 0
      ? Math.floor(Number(patchDur))
      : base.durationSec;
  const addWatch = Math.max(0, Math.min(Number(patch.deltaWatchSec) || 0, 120));
  const source = PROGRESS_SOURCES.has(patch.progressSource) ? patch.progressSource : base.progressSource;
  const out = {
    playheadSec: nextPlayhead,
    durationSec: nextDur,
    updatedAt: patch.updatedAt || new Date().toISOString(),
    totalWatchedSec: base.totalWatchedSec + addWatch,
    progressSource: source,
  };
  if (patch.capturedAt != null) out.capturedAt = String(patch.capturedAt);
  else if (base.capturedAt != null) out.capturedAt = base.capturedAt;
  return out;
}

async function loadVideoProgress() {
  const { videoProgress = {} } = await chrome.storage.local.get("videoProgress");
  const raw = videoProgress && typeof videoProgress === "object" ? videoProgress : {};
  const map = {};
  let changed = false;
  for (const [vid, rec] of Object.entries(raw)) {
    const norm = normalizeVideoProgressRecord(rec);
    map[vid] = norm;
    if (JSON.stringify(norm) !== JSON.stringify(rec)) changed = true;
  }
  if (changed) await saveVideoProgress(map);
  return map;
}

async function saveVideoProgress(map) {
  await chrome.storage.local.set({ videoProgress: map });
}

async function loadWatchByDay() {
  const { watchByDay = {} } = await chrome.storage.local.get("watchByDay");
  return watchByDay && typeof watchByDay === "object" ? watchByDay : {};
}

async function loadLocalPlaylists() {
  const { localPlaylists = [] } = await chrome.storage.local.get("localPlaylists");
  const arr = Array.isArray(localPlaylists) ? localPlaylists : [];
  let changed = false;
  for (const pl of arr) {
    if (TS_WATCH.normalizeLocalPlaylistFields(pl)) changed = true;
  }
  if (changed) await saveLocalPlaylists(arr);
  return arr;
}

async function saveLocalPlaylists(lists) {
  await chrome.storage.local.set({ localPlaylists: lists });
}

async function loadSubscriptionChannels() {
  const { subscriptionChannels = [] } = await chrome.storage.local.get("subscriptionChannels");
  return Array.isArray(subscriptionChannels) ? subscriptionChannels : [];
}

async function saveSubscriptionChannels(rows) {
  await chrome.storage.local.set({ subscriptionChannels: rows });
}

/**
 * Settings → Data & privacy: wipe saved videos, progress, local playlists, and import/scan summaries
 * stored alongside the library. Does not remove API keys, OAuth Client ID, themes, or the subscription directory.
 */
async function eraseLocalLibraryData() {
  await saveItems([]);
  await chrome.storage.local.set({
    videoProgress: {},
    watchByDay: {},
    localPlaylists: [],
  });
  const cur = await loadSettings();
  const next = { ...cur };
  for (const k of [
    "latestImportBatchId",
    "latestImportAt",
    "localViewingSummary",
    "localViewingGenreSummary",
    "youtubeHistorySummary",
    "youtubeHistoryGenreScanSummary",
    "youtubeLastScanSummary",
  ]) {
    delete next[k];
  }
  next.currentPlaylistId = null;
  next.currentPlaylistName = defaultYtTabgroupPlaylistName();
  await chrome.storage.local.set({ settings: next });
  return { ok: true };
}

/**
 * Replace subscription directory with the signed-in user’s YouTube subscriptions (OAuth).
 * Uses contentDetails.newItemCount — YouTube’s “new since last read on YouTube” signal (may lag vs the app/website).
 */
async function syncYoutubeSubscriptionsViaOAuth() {
  const settings = await loadSettings();
  const clientId = String(settings.youtubeOAuthClientId || "").trim();
  if (!clientId) {
    return {
      ok: false,
      error: "missing_oauth_client_id",
      message: "Add a YouTube OAuth Client ID in Settings, then try again.",
    };
  }
  if (!(await ensureOptionalHostOrigins(OPTIONAL_ORIGINS_GOOGLE_APIS))) {
    return {
      ok: false,
      error: "host_permission_denied",
      message:
        "TubeStack needs permission to contact Google’s YouTube API. Allow the browser prompt, then sync again.",
    };
  }
  const auth = await getYoutubeImportAccessTokenCached(clientId);
  if (!auth.ok) {
    return {
      ok: false,
      error: auth.error || "oauth_failed",
      message: auth.message || "Google sign-in was cancelled or failed.",
    };
  }
  const accessToken = auth.accessToken;

  const prev = await loadSubscriptionChannels();
  const prevByChannelId = new Map();
  const prevByName = new Map();
  for (const row of prev) {
    if (row.channelId) prevByChannelId.set(row.channelId, row);
    const nk = normalizeSubChannelName(row.name);
    if (nk) prevByName.set(nk, row);
  }

  const rows = [];
  let pageToken = "";
  for (let page = 0; page < 80; page++) {
    const qs = new URLSearchParams({
      part: "snippet,contentDetails",
      mine: "true",
      maxResults: "50",
    });
    if (pageToken) qs.set("pageToken", pageToken);
    let data;
    try {
      data = await ytOAuthJson(accessToken, "GET", `subscriptions?${qs.toString()}`);
    } catch (e) {
      return { ok: false, error: "subscriptions_failed", message: String(e?.message || e) };
    }
    const items = data.items || [];
    for (const it of items) {
      const chId = it?.snippet?.resourceId?.channelId;
      if (!chId || typeof chId !== "string") continue;
      const title = String(it?.snippet?.title || "Channel").trim() || "Channel";
      const thumbs = it?.snippet?.thumbnails;
      const thumbUrl = thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || "";
      const newN = Math.max(0, Math.floor(Number(it?.contentDetails?.newItemCount) || 0));
      const old = prevByChannelId.get(chId) || prevByName.get(normalizeSubChannelName(title));
      rows.push({
        name: title,
        channelId: chId,
        thumbnailUrl: thumbUrl,
        newItemCount: newN,
        fetchedAt: new Date().toISOString(),
        addedAt: old?.addedAt || new Date().toISOString(),
        source: "youtube_oauth",
      });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  await saveSubscriptionChannels(rows);
  return { ok: true, subscriptionChannels: rows, count: rows.length };
}

function normalizeSubChannelName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Merge scraped channel labels into the subscription directory (not themes). */
async function mergeSubscriptionChannelLabels(labels) {
  const cur = await loadSubscriptionChannels();
  const byKey = new Map();
  for (const row of cur) {
    const k = normalizeSubChannelName(row.name);
    if (k) byKey.set(k, { ...row, name: row.name || String(row.name || "").trim() });
  }
  let added = 0;
  for (const raw of labels || []) {
    const name = String(raw || "").trim();
    if (name.length < 2 || name.length > 80) continue;
    const k = normalizeSubChannelName(name);
    if (!k || byKey.has(k)) continue;
    byKey.set(k, { name, addedAt: new Date().toISOString(), source: "import" });
    added++;
  }
  const next = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  await saveSubscriptionChannels(next);
  return { ok: true, subscriptionChannels: next, addedCount: added };
}

async function deleteSubscriptionChannelEntry(name) {
  const k = normalizeSubChannelName(name);
  if (!k) {
    return { ok: false, error: "empty_name", subscriptionChannels: await loadSubscriptionChannels() };
  }
  const cur = await loadSubscriptionChannels();
  const next = cur.filter((row) => normalizeSubChannelName(row.name) !== k);
  await saveSubscriptionChannels(next);
  return { ok: true, subscriptionChannels: next };
}

const MAX_LOCAL_PLAYLISTS = 120;

function defaultYtTabgroupPlaylistName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `yt_tabgroup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function trimPlaylistsCap(lists, max) {
  const xs = [...lists];
  while (xs.length > max) {
    let oldestI = -1;
    let oldestT = Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i].playlistSource !== "youtube_import") continue;
      const t = Date.parse(xs[i].createdAt || "") || 0;
      if (t < oldestT) {
        oldestT = t;
        oldestI = i;
      }
    }
    if (oldestI >= 0) xs.splice(oldestI, 1);
    else xs.pop();
  }
  return xs;
}

function durationSecFromIso8601Duration(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseFloat(m[3] || "0");
  return Math.round(h * 3600 + min * 60 + s);
}

/**
 * Reuse one Google sign-in across list → preview → import in the dashboard.
 * Bearer access token is kept in service worker memory only (never written to chrome.storage.local).
 * Reusing the cache is not a silent sign-in: it only skips the browser window if the user already
 * completed launchWebAuthFlow within the TTL below.
 */
let __youtubeImportAuth = { token: "", clientId: "", expiresAt: 0 };

function clearYoutubeImportAuthCache() {
  __youtubeImportAuth = { token: "", clientId: "", expiresAt: 0 };
}

async function getYoutubeImportAccessTokenCached(clientId) {
  const cid = String(clientId || "").trim();
  if (!cid) {
    return {
      ok: false,
      error: "missing_oauth_client_id",
      message: "Add and save a YouTube OAuth Client ID in Settings, then use Test Google sign-in.",
    };
  }
  const now = Date.now();
  if (__youtubeImportAuth.token && __youtubeImportAuth.clientId === cid && now < __youtubeImportAuth.expiresAt) {
    return { ok: true, accessToken: __youtubeImportAuth.token };
  }
  try {
    const token = await getYoutubeOAuthAccessToken(cid);
    __youtubeImportAuth = { token, clientId: cid, expiresAt: now + 45 * 60 * 1000 };
    return { ok: true, accessToken: token };
  } catch (e) {
    clearYoutubeImportAuthCache();
    return { ok: false, error: "oauth_failed", message: String(e.message || e) };
  }
}

async function tubestackYoutubePlaylistsList() {
  const settings = await loadSettings();
  const cid = String(settings.youtubeOAuthClientId || "").trim();
  const auth = await getYoutubeImportAccessTokenCached(cid);
  if (!auth.ok) return auth;
  const MAX_PLAYLISTS = 70;
  const playlists = [];
  let pageToken = "";
  do {
    const json = await ytOAuthJson(
      auth.accessToken,
      "GET",
      `playlists?part=snippet,contentDetails&mine=true&maxResults=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
    );
    for (const p of json.items || []) {
      playlists.push({
        id: p.id,
        title: p.snippet?.title || "Untitled playlist",
        itemCount: Number(p.contentDetails?.itemCount || 0),
      });
    }
    pageToken = json.nextPageToken || "";
    if (playlists.length >= MAX_PLAYLISTS) break;
  } while (pageToken);
  return { ok: true, playlists };
}

async function tubestackYoutubePlaylistPreview(msg) {
  const playlistId = String(msg?.playlistId || "").trim();
  if (!playlistId) return { ok: false, error: "missing_playlist_id", message: "Missing playlist id." };
  const settings = await loadSettings();
  const cid = String(settings.youtubeOAuthClientId || "").trim();
  const auth = await getYoutubeImportAccessTokenCached(cid);
  if (!auth.ok) return auth;
  const max = Math.min(220, Math.max(10, Number(msg?.maxVideos) || 160));
  const videos = [];
  let pageToken = "";
  let truncated = false;
  do {
    const pjson = await ytOAuthJson(
      auth.accessToken,
      "GET",
      `playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=50${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
      }`
    );
    for (const row of pjson.items || []) {
      const sn = row.snippet || {};
      const vid = sn.resourceId?.videoId;
      if (!vid || !/^[\w-]{11}$/.test(vid)) continue;
      videos.push({
        videoId: vid,
        title: sn.title || "—",
        channel: sn.videoOwnerChannelTitle || sn.channelTitle || "",
      });
      if (videos.length >= max) {
        truncated = Boolean(pjson.nextPageToken);
        break;
      }
    }
    pageToken = pjson.nextPageToken || "";
    if (videos.length >= max) break;
    await new Promise((r) => setTimeout(r, 22));
  } while (pageToken && videos.length < max);
  return { ok: true, videos, truncated, count: videos.length };
}

async function importYoutubePlaylistsWithAccessToken(accessToken, playlistMetas) {
  const themes = await loadThemes();
  const PER_PLAYLIST_CAP = 220;
  const DETAIL_BATCH = 50;

  const existingItemsAll = await loadItems();
  const existingVideoIds = new Set(
    existingItemsAll.map((x) => String(x.videoId || "").trim()).filter((v) => /^[\w-]{11}$/.test(v))
  );
  const existingLists = await loadLocalPlaylists();
  const listsSansImports = existingLists.filter((x) => x.playlistSource !== "youtube_import");

  const newLibraryItems = [];
  const newPlaylists = [];
  let totalPlaylistVideos = 0;

  for (const plMeta of playlistMetas) {
    const albumLabel = String(plMeta.title || "YouTube playlist").slice(0, 200);
    const videoIdsOrdered = [];
    let pt = "";
    do {
      const pjson = await ytOAuthJson(
        accessToken,
        "GET",
        `playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(plMeta.id)}&maxResults=50${
          pt ? `&pageToken=${encodeURIComponent(pt)}` : ""
        }`
      );
      for (const row of pjson.items || []) {
        const vid = row.snippet?.resourceId?.videoId || row.contentDetails?.videoId;
        if (vid && /^[\w-]{11}$/.test(vid)) videoIdsOrdered.push(vid);
        if (videoIdsOrdered.length >= PER_PLAYLIST_CAP) break;
      }
      pt = pjson.nextPageToken || "";
      if (videoIdsOrdered.length >= PER_PLAYLIST_CAP) break;
      await new Promise((r) => setTimeout(r, 35));
    } while (pt);

    if (!videoIdsOrdered.length) continue;

    const detailById = new Map();
    for (let i = 0; i < videoIdsOrdered.length; i += DETAIL_BATCH) {
      const slice = videoIdsOrdered.slice(i, i + DETAIL_BATCH);
      const vjson = await ytOAuthJson(
        accessToken,
        "GET",
        `videos?part=snippet,contentDetails&id=${slice.map(encodeURIComponent).join(",")}`
      );
      for (const v of vjson.items || []) {
        if (v.id) detailById.set(v.id, v);
      }
      await new Promise((r) => setTimeout(r, 35));
    }

    const snapshots = [];
    for (const vid of videoIdsOrdered) {
      const v = detailById.get(vid);
      let snap;
      if (!v) {
        snap = {
          videoId: vid,
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
          title: "YouTube video",
          channel: "",
          thumbnail: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
          libraryAlbum: albumLabel,
        };
        if (!existingVideoIds.has(vid)) {
          existingVideoIds.add(vid);
          const item = {
            id: uuid(),
            url: snap.url,
            videoId: vid,
            title: snap.title,
            channel: "",
            thumbnail: snap.thumbnail,
            durationSec: null,
            timestampSec: null,
            savedAt: new Date().toISOString(),
            category: "watch_later",
            tags: [],
            suggestedTags: [],
            priority: "prio_med",
            notes: "",
            note: "",
            watchState: TS_WATCH.DEFAULT_WATCH_STATE,
            timestampNotes: [],
            themeId: null,
            libraryAlbum: albumLabel,
            playlistName: albumLabel,
            libraryImportSource: "youtube_playlist",
            youtubePlaylistId: plMeta.id,
          };
          item.granularGenre = inferGranularGenreForText(item.title, item.channel);
          const best = bestThemeForItem(item, themes);
          if (best) item.themeId = best.id;
          newLibraryItems.push(item);
        }
      } else {
        const sn = v.snippet || {};
        const cd = v.contentDetails || {};
        const durationSec = durationSecFromIso8601Duration(cd.duration);
        const thumb =
          sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
        snap = {
          videoId: vid,
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
          title: sn.title || "YouTube video",
          channel: sn.channelTitle || "",
          thumbnail: thumb,
          durationSec,
          libraryAlbum: albumLabel,
        };
        if (!existingVideoIds.has(vid)) {
          existingVideoIds.add(vid);
          const item = {
            id: uuid(),
            url: snap.url,
            videoId: vid,
            title: snap.title,
            channel: snap.channel,
            thumbnail: snap.thumbnail,
            durationSec,
            timestampSec: null,
            savedAt: new Date().toISOString(),
            category: "watch_later",
            tags: [],
            suggestedTags: [],
            priority: "prio_med",
            notes: "",
            note: "",
            watchState: TS_WATCH.DEFAULT_WATCH_STATE,
            timestampNotes: [],
            themeId: null,
            libraryAlbum: albumLabel,
            playlistName: albumLabel,
            libraryImportSource: "youtube_playlist",
            youtubePlaylistId: plMeta.id,
          };
          item.granularGenre = inferGranularGenreForText(item.title, item.channel);
          const best = bestThemeForItem(item, themes);
          if (best) item.themeId = best.id;
          newLibraryItems.push(item);
        }
      }
      snapshots.push(snap);
    }

    totalPlaylistVideos += snapshots.length;
    newPlaylists.push({
      id: uuid(),
      name: albumLabel,
      createdAt: new Date().toISOString(),
      items: snapshots,
      kind: "static",
      groupBy: null,
      smartSummary: `Imported from YouTube · ${snapshots.length} videos`,
      playlistSource: "youtube_import",
      youtubePlaylistId: plMeta.id,
    });
  }

  if (!newPlaylists.length) {
    return {
      ok: false,
      error: "no_playlists",
      message: "No videos were found for the playlists you selected.",
    };
  }

  const existingItems = existingItemsAll.filter((x) => x.libraryImportSource !== "youtube_playlist");
  const mergedItems = [...newLibraryItems, ...existingItems];
  await saveItems(mergedItems);
  const mergedLists = trimPlaylistsCap([...newPlaylists, ...listsSansImports], MAX_LOCAL_PLAYLISTS);
  await saveLocalPlaylists(mergedLists);

  return {
    ok: true,
    importedPlaylistCount: newPlaylists.length,
    newLibraryVideoCount: newLibraryItems.length,
    totalPlaylistVideos,
    message: `Imported ${newPlaylists.length} playlist(s); added ${newLibraryItems.length} new video(s) to the library (${totalPlaylistVideos} total rows across playlists).`,
  };
}

async function tubestackImportYoutubePlaylistsSelected(msg) {
  const raw = msg?.playlists;
  if (!Array.isArray(raw) || !raw.length) {
    return { ok: false, error: "no_selection", message: "Select at least one playlist to import." };
  }
  const playlistMetas = raw
    .map((x) => ({
      id: String(x?.id || "").trim(),
      title: String(x?.title || "Playlist").trim().slice(0, 200),
    }))
    .filter((x) => x.id);
  if (!playlistMetas.length) {
    return { ok: false, error: "no_selection", message: "No valid playlist ids in selection." };
  }

  const settings = await loadSettings();
  const cid = String(settings.youtubeOAuthClientId || "").trim();
  const auth = await getYoutubeImportAccessTokenCached(cid);
  if (!auth.ok) return auth;

  try {
    const result = await importYoutubePlaylistsWithAccessToken(auth.accessToken, playlistMetas);
    clearYoutubeImportAuthCache();
    return result;
  } catch (e) {
    clearYoutubeImportAuthCache();
    return { ok: false, error: "import_failed", message: String(e.message || e) };
  }
}

async function saveLocalPlaylistEntry({ name, items, kind, groupBy, smartSummary, playlistSource, youtubePlaylistId }) {
  const lists = await loadLocalPlaylists();
  const trimmed = String(name || "").trim();
  const finalName = trimmed || defaultYtTabgroupPlaylistName();
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, error: "no_items" };
  }
  const src =
    playlistSource === "youtube_import" ? "youtube_import" : playlistSource === "session" ? "session" : "session";
  const entry = {
    id: uuid(),
    name: finalName.slice(0, 200),
    createdAt: new Date().toISOString(),
    items,
    kind: kind === "smart" ? "smart" : "static",
    groupBy: typeof groupBy === "string" && groupBy.length < 64 ? groupBy : null,
    smartSummary: typeof smartSummary === "string" ? smartSummary.slice(0, 500) : null,
    stackNote: "",
    researchSummary: "",
    decisions: [],
    playlistSource: src,
  };
  if (src === "youtube_import" && youtubePlaylistId) {
    entry.youtubePlaylistId = String(youtubePlaylistId).slice(0, 80);
  }
  const next = trimPlaylistsCap([entry, ...lists], MAX_LOCAL_PLAYLISTS);
  await saveLocalPlaylists(next);
  return { ok: true, playlists: next };
}

async function renameLocalPlaylistEntry({ id, name }) {
  const lists = await loadLocalPlaylists();
  const t = lists.find((x) => x.id === id);
  if (!t) return { ok: false, error: "not_found" };
  const n = String(name || "").trim();
  if (!n) return { ok: false, error: "empty_name" };
  t.name = n.slice(0, 200);
  await saveLocalPlaylists(lists);
  return { ok: true, playlists: lists };
}

async function deleteLocalPlaylistEntry(id) {
  const sid = String(id || "").trim();
  if (!sid) return { ok: false, error: "missing_id" };
  const lists = (await loadLocalPlaylists()).filter((x) => x.id !== sid);
  await saveLocalPlaylists(lists);
  const settings = await loadSettings();
  if (String(settings.currentPlaylistId || "").trim() === sid) {
    await saveSettings({
      currentPlaylistId: null,
      currentPlaylistName: defaultYtTabgroupPlaylistName(),
    });
  }
  return { ok: true, playlists: lists };
}

function playlistItemKey(it) {
  const vid = String(it?.videoId || "").trim();
  if (vid) return `v:${vid}`;
  const url = String(it?.url || "").trim();
  if (url) return `u:${url}`;
  return `t:${String(it?.title || "").trim().toLowerCase()}::${String(it?.channel || "").trim().toLowerCase()}`;
}

async function addItemsToLocalPlaylistEntry({ playlistId, items, createNew, name }) {
  const incoming = Array.isArray(items) ? items.filter((x) => x && (x.videoId || x.url)) : [];
  if (!incoming.length) return { ok: false, error: "no_items" };
  const lists = await loadLocalPlaylists();

  if (createNew) {
    return saveLocalPlaylistEntry({
      name: String(name || "").trim() || defaultYtTabgroupPlaylistName(),
      items: incoming,
      kind: "static",
      playlistSource: "session",
    });
  }

  const target = lists.find((x) => x.id === playlistId);
  if (!target) return { ok: false, error: "not_found" };

  const curItems = Array.isArray(target.items) ? target.items : [];
  const seen = new Set(curItems.map(playlistItemKey));
  let addedCount = 0;
  for (const it of incoming) {
    const k = playlistItemKey(it);
    if (seen.has(k)) continue;
    curItems.push(it);
    seen.add(k);
    addedCount++;
  }
  target.items = curItems;
  await saveLocalPlaylists(lists);
  return { ok: true, playlists: lists, addedCount };
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function haystack(item) {
  const tsNotes = (item.timestampNotes || []).map((x) => `${x.label || ""} ${x.note || ""}`).join(" ");
  return [
    item.title,
    item.channel,
    TS_WATCH.watchStateLabel(item.watchState),
    ...(item.tags || []),
    TS_WATCH.itemNoteText(item),
    tsNotes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreKeywords(text, keywords) {
  if (!text || !keywords?.length) return 0;
  let score = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    if (text.includes(kw)) score += 2 + Math.min(kw.length, 20) * 0.05;
  }
  return score;
}

function inferGranularGenreForText(title, channel) {
  const text = [title, channel].filter(Boolean).join(" ").toLowerCase();
  let bestLabel = "General & mixed";
  let bestScore = 0;
  for (const p of GRANULAR_GENRE_PRESETS) {
    const s =
      scoreKeywords(text, p.keywords) + scoreKeywords(text, [String(p.label || "").toLowerCase()]);
    if (s > bestScore) {
      bestScore = s;
      bestLabel = p.label;
    }
  }
  return bestLabel;
}

function activeThemes(themes) {
  return themes.filter((t) => t.tier === "active" || t.tier === "favorite");
}

function bestThemeForItem(item, themes) {
  const text = haystack(item);
  const candidates = activeThemes(themes);
  let best = null;
  let bestScore = 0;
  for (const t of candidates) {
    const s = scoreKeywords(text, t.keywords) + (t.label ? scoreKeywords(text, [t.label.toLowerCase()]) : 0);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return bestScore >= 1.5 ? best : null;
}

async function autoAssignThemesToItems() {
  const [items, themes] = await Promise.all([loadItems(), loadThemes()]);
  let changed = false;
  for (const it of items) {
    const t = bestThemeForItem(it, themes);
    const nextId = t?.id ?? null;
    if (it.themeId !== nextId) {
      it.themeId = nextId;
      changed = true;
    }
  }
  if (changed) await saveItems(items);
  return { ok: true, updated: changed };
}

function getPlayheadFromStorage(item, progressMap) {
  const vid = item.videoId;
  if (!vid) return item.timestampSec ?? 0;
  const p = progressMap[vid];
  const fromPlayer = p?.playheadSec ?? 0;
  const fromSaved = item.timestampSec ?? 0;
  return Math.max(fromSaved, fromPlayer);
}

function getDuration(item, progressMap) {
  const vid = item.videoId;
  const p = vid ? progressMap[vid] : null;
  return item.durationSec ?? p?.durationSec ?? null;
}

function remainingSeconds(item, progressMap) {
  return timeLeftSec(item, progressMap);
}

function timeLeftSec(item, progressMap) {
  const dur = getDuration(item, progressMap);
  if (dur == null) return null;
  const pos = getPlayheadFromStorage(item, progressMap);
  return Math.max(0, dur - pos);
}

function completionRatio(item, progressMap) {
  const dur = getDuration(item, progressMap);
  if (!dur || dur <= 0) return null;
  const pos = getPlayheadFromStorage(item, progressMap);
  return Math.min(1, pos / dur);
}

/** Focused Playlist ranking — local progress/themes only (no network). */
function interestScore(item, progressMap, themes) {
  let score = 0;
  const theme = themes.find((t) => t.id === item.themeId);
  if (theme?.tier === "favorite") score += 50;
  else if (theme?.tier === "active") score += 25;
  const r = completionRatio(item, progressMap);
  if (r != null) {
    if (r >= 0.15 && r <= 0.92) score += 20;
    if (r >= 0.85 && r < 0.97) score += 15;
    if (r >= 0.97) score -= 25;
  }
  if (item.priority === "prio_high") score += 18;
  else if (item.priority === "prio_low") score -= 4;
  else if (item.priority === "prio_drop") score -= 30;
  const tl = remainingSeconds(item, progressMap);
  if (tl != null && tl > 0 && tl < 420) score += 12;
  if (TS_WATCH) {
    const ws = TS_WATCH.normalizeWatchStateId(item.watchState);
    if (ws === "queue" || ws === "watching") score += 22;
    if (ws === "important") score += 16;
    if (ws === "saved") score += 8;
    if (ws === "finished" || ws === "skip") score -= 32;
    if (ws === "reference") score += 6;
  }
  return score;
}

function enrichItemForFocusedPlaylist(it, progressMap) {
  return {
    ...it,
    durationSec: getDuration(it, progressMap),
    playheadSec: getPlayheadFromStorage(it, progressMap),
    remainingSeconds: remainingSeconds(it, progressMap),
  };
}

function sortItemsList(list, mode, progressMap, themes) {
  const copy = [...list];
  const cmpNum = (a, b, dir, get) => {
    const va = get(a);
    const vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return dir * (va - vb);
  };
  copy.sort((a, b) => {
    switch (mode) {
      case "time_left_asc":
        return cmpNum(a, b, 1, (x) => timeLeftSec(x, progressMap));
      case "time_left_desc":
        return cmpNum(a, b, -1, (x) => timeLeftSec(x, progressMap));
      case "duration_asc":
        return cmpNum(a, b, 1, (x) => getDuration(x, progressMap));
      case "duration_desc":
        return cmpNum(a, b, -1, (x) => getDuration(x, progressMap));
      case "interest_desc":
        return (
          interestScore(b, progressMap, themes) - interestScore(a, progressMap, themes) ||
          (new Date(b.savedAt) - new Date(a.savedAt))
        );
      case "saved_recent":
        return new Date(b.savedAt) - new Date(a.savedAt);
      case "completion_asc":
        return cmpNum(a, b, 1, (x) => completionRatio(x, progressMap));
      case "completion_desc":
        return cmpNum(a, b, -1, (x) => completionRatio(x, progressMap));
      default:
        return new Date(b.savedAt) - new Date(a.savedAt);
    }
  });
  return copy;
}

function itemMatchesThemeIds(item, themeIds, themes) {
  if (!themeIds?.length) return false;
  if (item.themeId && themeIds.includes(item.themeId)) return true;
  const text = haystack(item);
  for (const id of themeIds) {
    const t = themes.find((x) => x.id === id);
    if (!t) continue;
    const s = scoreKeywords(text, t.keywords) + (t.label ? scoreKeywords(text, [t.label.toLowerCase()]) : 0);
    if (s >= 1.5) return true;
  }
  return false;
}

/** Best theme among the pack’s selected theme IDs (keyword match); falls back to first pack theme. */
function bestPackThemeId(item, themeIds, themes) {
  if (!themeIds?.length) return null;
  const text = haystack(item);
  let bestId = null;
  let bestScore = 0;
  for (const id of themeIds) {
    const t = themes.find((x) => x.id === id);
    if (!t) continue;
    const s = scoreKeywords(text, t.keywords) + (t.label ? scoreKeywords(text, [t.label.toLowerCase()]) : 0);
    const bias = item.themeId === id ? 0.25 : 0;
    if (s + bias > bestScore) {
      bestScore = s + bias;
      bestId = id;
    }
  }
  if (bestId && bestScore >= 0.5) return bestId;
  if (item.themeId && themeIds.includes(item.themeId)) return item.themeId;
  return themeIds[0] || null;
}

function estimateSlotSeconds(item, progressMap) {
  const tl = remainingSeconds(item, progressMap);
  if (tl != null && tl > 0) return tl;
  const dur = getDuration(item, progressMap);
  if (dur != null && dur > 0) return dur;
  return 300;
}

/** Build a Focused Playlist queue from local library + videoProgress only (no network). */
async function buildPlaylist({ themeIds, budgetMinutes, sortMode }) {
  const ids = (themeIds || []).filter(Boolean).slice(0, MAX_PLAYLIST_THEMES);
  if (!ids.length) return { ok: false, error: "Pick at least one category." };
  if (ids.length > MAX_PLAYLIST_THEMES) return { ok: false, error: `Max ${MAX_PLAYLIST_THEMES} themes.` };

  const budgetSec = Math.max(1, Number(budgetMinutes) || 0) * 60;
  const [items, themes, progressMap] = await Promise.all([loadItems(), loadThemes(), loadVideoProgress()]);

  const pool = items.filter((it) => itemMatchesThemeIds(it, ids, themes));
  const sorted = sortItemsList(pool, sortMode || "time_left_asc", progressMap, themes);

  const queue = [];
  let used = 0;
  for (const it of sorted) {
    const slot = estimateSlotSeconds(it, progressMap);
    if (used + slot > budgetSec && queue.length > 0) break;
    queue.push(it);
    used += slot;
    if (used >= budgetSec) break;
  }

  const allItems = await loadItems();
  for (const it of queue) {
    const sug = bestPackThemeId(it, ids, themes);
    if (sug) {
      it.themeId = sug;
      const row = allItems.find((x) => x.id === it.id);
      if (row) row.themeId = sug;
    }
  }
  await saveItems(allItems);

  return {
    ok: true,
    queue: queue.map((it) => {
      const row = enrichItemForFocusedPlaylist(it, progressMap);
      row.interestScore = interestScore(it, progressMap, themes);
      return row;
    }),
    estimatedSeconds: used,
    budgetSeconds: budgetSec,
    sortMode: sortMode || "time_left_asc",
  };
}

/** Observed playback on open YouTube watch tabs (content/youtube-progress.js → TUBESTACK_PROGRESS_TICK). */
async function handleProgressTick(msg) {
  const { videoId, playheadSec, durationSec, deltaWatchSec } = msg;
  if (!videoId) return;
  const map = await loadVideoProgress();
  map[videoId] = mergeVideoProgressRecord(map[videoId], {
    playheadSec: playheadSec || 0,
    durationSec: durationSec ?? null,
    deltaWatchSec: deltaWatchSec || 0,
    progressSource: "observed_youtube_page",
    updatedAt: new Date().toISOString(),
  });
  await saveVideoProgress(map);

  if (addWatch > 0) {
    const days = await loadWatchByDay();
    const key = todayKey();
    days[key] = (days[key] || 0) + addWatch;
    await chrome.storage.local.set({ watchByDay: days });
  }
}

async function cycleTheme(themeId) {
  const themes = await loadThemes();
  const idx = themes.findIndex((t) => t.id === themeId);
  if (idx < 0) return { ok: false, error: "Category not found" };

  /** Single-click only toggles green “active”; gold is double-click in the dashboard. */
  const cur = themes[idx].tier || "off";
  if (cur === "favorite") {
    themes[idx] = { ...themes[idx], tier: "active" };
    await saveThemes(themes);
    return { ok: true, themes };
  }
  const nextTier = cur === "active" ? "off" : "active";
  themes[idx] = { ...themes[idx], tier: nextTier };
  await saveThemes(themes);
  return { ok: true, themes };
}

async function mergeScrapedChannels(labels) {
  const themes = await loadThemes();
  const existingLower = new Set(themes.map((t) => t.label.toLowerCase()));
  let added = 0;
  for (const raw of labels || []) {
    const label = (raw || "").trim();
    if (label.length < 2 || label.length > 80) continue;
    const low = label.toLowerCase();
    if (existingLower.has(low)) continue;
    const parts = label
      .split(/[\s|/,&]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x.length > 1);
    themes.push({
      id: uuid(),
      label,
      keywords: Array.from(new Set([low, ...parts])),
      tier: "off",
    });
    existingLower.add(low);
    added++;
    if (added >= 40) break;
  }
  await saveThemes(themes);
  return { ok: true, themes, addedCount: added };
}

async function setThemeKeywords(themeId, keywords) {
  const themes = await loadThemes();
  const t = themes.find((x) => x.id === themeId);
  if (!t) return { ok: false, error: "Category not found" };
  const kw = (keywords || [])
    .map((k) => String(k).toLowerCase().trim())
    .filter(Boolean);
  t.keywords = Array.from(new Set([t.label.toLowerCase(), ...kw]));
  await saveThemes(themes);
  return { ok: true, themes };
}

async function scrapeYouTubeTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/channel-scrape.js"],
    });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "TUBESTACK_SCRAPE_CHANNELS" });
    if (res?.ok) return { ok: true, channels: res.channels || [] };
    return { ok: false, error: res?.error || "No channels parsed" };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function scrapeYouTubeChannelsPage(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/channel-scrape.js"],
    });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: "TUBESTACK_SCRAPE_CHANNELS",
      deepScan: true,
    });
    if (res?.ok) return { ok: true, channels: res.channels || [] };
    return { ok: false, error: res?.error || "No channels parsed" };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function mergeThemesFromGranularLabels(labels) {
  const presetMap = new Map(GRANULAR_GENRE_PRESETS.map((p) => [String(p.label).toLowerCase(), p]));
  const themes = await loadThemes();
  const existingLower = new Set(themes.map((t) => t.label.toLowerCase()));
  let added = 0;
  for (const raw of labels || []) {
    const key = String(raw || "").trim().toLowerCase();
    if (!key) continue;
    const preset = presetMap.get(key);
    if (!preset) continue;
    if (existingLower.has(key)) continue;
    if (added >= 45) break;
    const kw = new Set(
      (preset.keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean)
    );
    kw.add(preset.label.toLowerCase());
    themes.push({
      id: uuid(),
      label: preset.label,
      keywords: [...kw],
      tier: "active",
    });
    existingLower.add(key);
    added++;
  }
  await saveThemes(themes);
  return { ok: true, themes, addedCount: added };
}

/** Unique saved library videos for category rebuild (titles/channels only; no Chrome History API). */
async function gatherLibraryVideosForGenreRebuild() {
  const items = await loadItems();
  const byVid = new Map();
  for (const it of items) {
    const vid = String(it.videoId || "").trim();
    if (!vid || !isValidVideoId(vid)) continue;
    const title = String(it.title || "").trim() || "YouTube video";
    const channel = String(it.channel || "").trim();
    const prev = byVid.get(vid);
    if (!prev || title.length > (prev.title?.length || 0)) {
      byVid.set(vid, {
        videoId: vid,
        url: it.url || normalizeWatchUrl(vid),
        title,
        channel,
        visitCount: 1,
        lastVisitTime: it.savedAt ? new Date(it.savedAt).getTime() : 0,
      });
    }
  }
  const videos = [...byVid.values()];
  if (!videos.length) {
    return {
      ok: false,
      error: "empty_library",
      message: "Save some YouTube videos to your library first, then run rebuild.",
      videos: [],
    };
  }
  return { ok: true, videos };
}

function bestBroadGenreForTitle(title, channel) {
  const text = [title, channel].filter(Boolean).join(" ").toLowerCase();
  let best = BROAD_GENRE_TAXONOMY[BROAD_GENRE_TAXONOMY.length - 1];
  let bestScore = -1;
  for (const g of BROAD_GENRE_TAXONOMY) {
    if (g.label === "General & mixed") continue;
    const s =
      scoreKeywords(text, g.keywords || []) + scoreKeywords(text, [String(g.label || "").toLowerCase()]);
    if (s > bestScore) {
      bestScore = s;
      best = g;
    }
  }
  if (bestScore < 0.35) return BROAD_GENRE_TAXONOMY[BROAD_GENRE_TAXONOMY.length - 1];
  return best;
}

function keywordsFromLabel(label) {
  const low = String(label || "")
    .trim()
    .toLowerCase();
  const parts = low.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return Array.from(new Set([low, ...parts])).slice(0, 48);
}

function bestThemeForItemAmongAll(item, themes) {
  const text = haystack(item);
  let best = null;
  let bestScore = 0;
  for (const t of themes) {
    const s =
      scoreKeywords(text, t.keywords || []) + (t.label ? scoreKeywords(text, [String(t.label).toLowerCase()]) : 0);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return bestScore >= 1.0 ? best : null;
}

async function reassignLibraryThemesToThemeSet(themes) {
  const items = await loadItems();
  let changed = false;
  for (const it of items) {
    const t = bestThemeForItemAmongAll(it, themes);
    const nextId = t?.id ?? null;
    if (it.themeId !== nextId) {
      it.themeId = nextId;
      changed = true;
    }
  }
  if (changed) await saveItems(items);
  return { ok: true, changed };
}

async function renameThemeEntry({ themeId, label }) {
  const themes = await loadThemes();
  const t = themes.find((x) => x.id === themeId);
  if (!t) return { ok: false, error: "Category not found" };
  const trimmed = String(label || "").trim().slice(0, 80);
  if (!trimmed) return { ok: false, error: "empty_name" };
  const low = trimmed.toLowerCase();
  const kw = new Set((t.keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean));
  kw.add(low);
  for (const w of keywordsFromLabel(trimmed)) kw.add(w);
  t.label = trimmed;
  t.keywords = [...kw];
  await saveThemes(themes);
  return { ok: true, themes };
}

async function toggleThemeFavoriteTier(themeId) {
  const themes = await loadThemes();
  const idx = themes.findIndex((x) => x.id === themeId);
  if (idx < 0) return { ok: false, error: "Category not found" };
  const cur = themes[idx].tier || "off";
  const next = cur === "favorite" ? "active" : "favorite";
  if (next === "favorite") {
    const favCount = themes.filter((x) => x.tier === "favorite").length;
    if (favCount >= MAX_FAVORITE_THEMES) {
      return {
        ok: false,
        error: `You can mark at most ${MAX_FAVORITE_THEMES} genres as gold. Double-click another to un-gold first.`,
      };
    }
  }
  themes[idx] = { ...themes[idx], tier: next };
  await saveThemes(themes);
  return { ok: true, themes };
}

async function addThemeEntry(label) {
  const themes = await loadThemes();
  const trimmed = String(label || "").trim().slice(0, 80);
  if (!trimmed) return { ok: false, error: "empty_name" };
  const low = trimmed.toLowerCase();
  if (themes.some((t) => String(t.label || "").trim().toLowerCase() === low)) {
    return { ok: false, error: "duplicate_name" };
  }
  const keywords = new Set();
  keywords.add(low);
  for (const w of keywordsFromLabel(trimmed)) keywords.add(w);
  themes.push({
    id: uuid(),
    label: trimmed,
    keywords: [...keywords],
    tier: "off",
  });
  await saveThemes(themes);
  return { ok: true, themes };
}

async function deleteThemeEntry(themeId) {
  const themes = await loadThemes();
  const idx = themes.findIndex((x) => x.id === themeId);
  if (idx < 0) return { ok: false, error: "Category not found" };
  if (themes.length <= 1) return { ok: false, error: "keep_one_category" };
  const nextThemes = themes.filter((x) => x.id !== themeId);
  await saveThemes(nextThemes);
  const items = await loadItems();
  let changed = false;
  for (const it of items) {
    if (it.themeId === themeId) {
      it.themeId = null;
      changed = true;
    }
  }
  if (changed) await saveItems(items);
  return { ok: true, themes: nextThemes };
}

async function fetchVideoTagsForItem({ id, videoId, max = 6 }) {
  const settings = await loadSettings();
  const apiKey = String(settings.youtubeDataApiKey || "").trim();
  if (!apiKey) return { ok: false, error: "missing_api_key" };
  const vid = String(videoId || "").trim();
  if (!isValidVideoId(vid)) return { ok: false, error: "invalid_video_id" };
  let tags = [];
  try {
    const json = await ytDataApi(apiKey, "videos", { part: "snippet", id: vid, maxResults: 1 });
    tags = (json?.items?.[0]?.snippet?.tags || []).map((t) => String(t || "").trim()).filter(Boolean);
  } catch (e) {
    return { ok: false, error: e?.message || "tag_fetch_failed" };
  }
  tags = tags.slice(0, Math.max(1, Number(max) || 6));
  if (id) {
    const items = await loadItems();
    const it = items.find((x) => x.id === id);
    if (it) {
      it.tags = tags;
      await saveItems(items);
    }
  }
  return { ok: true, tags };
}

function nearestBroadLabel(raw, labels) {
  const r = String(raw || "")
    .trim()
    .toLowerCase();
  if (!r) return labels[labels.length - 1];
  let best = labels[labels.length - 1];
  let bestScore = -1;
  for (const L of labels) {
    const l = L.toLowerCase();
    if (r === l) return L;
    let s = 0;
    if (l.includes(r) || r.includes(l)) s = 8;
    s += scoreKeywords(r, [l]);
    if (s > bestScore) {
      bestScore = s;
      best = L;
    }
  }
  return best;
}

async function openAiClassifyTitleChunk({ items, apiKey, model, broadLabels }) {
  await ensureOpenaiHostAccess();
  const payload = items.map((x) => {
    const row = {
      videoId: x.videoId,
      title: String(x.title || "").slice(0, 200),
    };
    const ch = String(x.channel || "").trim();
    if (ch) row.channel = ch.slice(0, 120);
    return row;
  });
  const user = `Input (JSON array of saved library videos):\n${JSON.stringify(payload)}`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Each row is a YouTube video saved in the user's TubeStack library: videoId, title, and optional channel name.
There are no transcripts, page URLs, or API keys in this payload. For each row, suggest niche: a short 2-6 word user-specific sub-interest when the title clearly implies one; otherwise "".
Broad must be EXACTLY one of: ${broadLabels.join(" | ")} (best guess from title and optional channel only).
Respond as JSON: {"items":[{"videoId":"","broad":"","niche":""}]}`,
        },
        { role: "user", content: user },
      ],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(openAiHttpErrorMessage(res.status, json));
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty model response");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model returned non-JSON");
  }
  const out = parsed.items || parsed.results || parsed.data;
  if (!Array.isArray(out)) throw new Error("JSON missing items[]");
  return out;
}

async function openAiJsonCompletion({ apiKey, model, system, user }) {
  const key = String(apiKey || "").trim();
  if (key.length < 20) throw new Error("openai_key_required");
  await ensureOpenaiHostAccess();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(openAiHttpErrorMessage(res.status, json));
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty model response");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model returned non-JSON");
  }
  return parsed;
}

/** Validate key (models list) + tiny completion for rate-limit headers; optional billing snapshot. */
async function testOpenAiConnection(msg = {}) {
  const settings = await loadSettings();
  const apiKey = String(msg.openaiApiKey || "").trim() || String(settings.openaiApiKey || "").trim();
  if (apiKey.length < 20) {
    return { ok: false, error: "openai_key_required", message: "Paste a key or save one in Settings first." };
  }
  if (!(await ensureOptionalHostOrigins(OPTIONAL_ORIGINS_OPENAI))) {
    await markIntegrationTest("openai", false);
    return {
      ok: false,
      error: "host_permission_denied",
      message:
        "TubeStack needs optional access to api.openai.com only when you use AI features. Allow the browser prompt and try again.",
    };
  }
  const auth = { Authorization: `Bearer ${apiKey}` };

  let modelCount = 0;
  try {
    const r = await fetch("https://api.openai.com/v1/models", { method: "GET", headers: auth });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      await markIntegrationTest("openai", false);
      return {
        ok: false,
        error: "openai_http",
        message: openAiHttpErrorMessage(r.status, j),
      };
    }
    modelCount = Array.isArray(j?.data) ? j.data.length : 0;
  } catch (e) {
    await markIntegrationTest("openai", false);
    return { ok: false, error: "network", message: String(e.message || e) };
  }

  let completionOk = false;
  let completionError = null;
  let lastUsage = null;
  const rateLimits = {};
  try {
    const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 2,
        temperature: 0,
        messages: [{ role: "user", content: "ok" }],
      }),
    });
    const pick = (name) => {
      const v = r2.headers.get(name);
      if (v != null && String(v).trim() !== "") rateLimits[name] = v.trim();
    };
    pick("x-ratelimit-remaining-requests");
    pick("x-ratelimit-limit-requests");
    pick("x-ratelimit-remaining-tokens");
    pick("x-ratelimit-limit-tokens");
    pick("x-ratelimit-reset-requests");
    pick("x-ratelimit-reset-tokens");
    if (r2.ok) {
      completionOk = true;
      const body = await r2.json().catch(() => ({}));
      lastUsage = body?.usage || null;
    } else {
      const j2 = await r2.json().catch(() => ({}));
      completionError = openAiHttpErrorMessage(r2.status, j2);
    }
  } catch (e) {
    completionError = String(e.message || e);
  }

  let usageCredits = null;
  try {
    const rb = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", {
      method: "GET",
      headers: auth,
    });
    if (rb.ok) {
      const bj = await rb.json().catch(() => null);
      if (bj && (bj.total_available != null || bj.total_granted != null)) {
        usageCredits = {
          totalAvailable: typeof bj.total_available === "number" ? bj.total_available : null,
          totalUsed: typeof bj.total_used === "number" ? bj.total_used : null,
          totalGranted: typeof bj.total_granted === "number" ? bj.total_granted : null,
        };
      }
    }
  } catch {
    /* billing endpoint often 401 for standard keys */
  }

  const allOk = completionOk && modelCount > 0;
  await markIntegrationTest("openai", allOk);
  return {
    ok: true,
    modelCount,
    completionOk,
    completionError,
    rateLimits: Object.keys(rateLimits).length ? rateLimits : null,
    lastUsage,
    usageCredits,
    billingCreditsAvailable: usageCredits != null,
  };
}

/**
 * AI-assisted library category assignment. Dashboard sends concrete itemIds (max 120).
 * strategy: "existing" | "discover" | "criteria"
 */
async function aiCategorizeLibrary(msg = {}) {
  const settings = await loadSettings();
  let apiKey = String(msg.openaiApiKey || "").trim() || String(settings.openaiApiKey || "").trim();
  if (msg.saveOpenaiKey === true && String(msg.openaiApiKey || "").trim().length >= 20) {
    await saveSettings({ openaiApiKey: String(msg.openaiApiKey).trim() });
    apiKey = String(msg.openaiApiKey).trim();
  }
  if (apiKey.length < 20) {
    return { ok: false, error: "openai_key_required", message: "Add an OpenAI API key in Settings (or paste below)." };
  }

  const strategy = msg.strategy === "existing" ? "existing" : msg.strategy === "criteria" ? "criteria" : "discover";
  const rawIds = Array.isArray(msg.itemIds) ? msg.itemIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const itemIds = [...new Set(rawIds)];
  if (!itemIds.length) {
    return { ok: false, error: "no_items", message: "No videos selected." };
  }

  const MAX = 120;
  const cappedIds = itemIds.slice(0, MAX);

  const allItems = await loadItems();
  const order = new Map(cappedIds.map((id, i) => [id, i]));
  let targets = allItems.filter((x) => cappedIds.includes(x.id));
  targets.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (!targets.length) {
    return { ok: false, error: "no_items", message: "None of those videos are in your library." };
  }

  const model = String(msg.openaiModel || "").trim() || "gpt-4o-mini";
  let themes = await loadThemes();

  const themeLabelById = new Map(themes.map((t) => [t.id, String(t.label || "").trim()]));
  const rows = targets.map((it) => buildLibraryItemPayloadForOpenAi(it, themeLabelById));

  try {
    if (strategy === "existing") {
      const catList = themes.map((t) => ({ id: t.id, label: String(t.label || "").slice(0, 80) }));
      if (!catList.length) {
        return { ok: false, error: "no_categories", message: "Add at least one category first." };
      }
      const merged = new Map();
      const chunkSize = 36;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const system = `You assign each YouTube library video to exactly one saved category. Each object in videos[] only contains metadata TubeStack already stored (title, channel, listCategory, optional tags/suggestedTags/notes/descriptionSnippet, optional currentCategoryLabel). Do not assume transcripts, watch URLs, or Google/OpenAI secrets are available. Use only themeId values from categories[]. Pick the closest fit when uncertain. JSON only: {"assignments":[{"itemId":"","themeId":""}]} — include every video in videos[] exactly once.`;
        const user = JSON.stringify({ categories: catList, videos: chunk });
        const parsed = await openAiJsonCompletion({ apiKey, model, system, user });
        const arr = parsed.assignments || parsed.results;
        if (!Array.isArray(arr)) throw new Error("JSON missing assignments[]");
        for (const a of arr) {
          const id = String(a.itemId || "").trim();
          const tid = String(a.themeId || "").trim();
          if (!id || !tid) continue;
          if (!catList.some((c) => c.id === tid)) continue;
          merged.set(id, tid);
        }
      }
      const idToItem = new Map(allItems.map((x) => [x.id, x]));
      let updated = 0;
      for (const [id, themeId] of merged) {
        const it = idToItem.get(id);
        if (!it) continue;
        if (it.themeId !== themeId) {
          it.themeId = themeId;
          updated++;
        }
      }
      await saveItems(allItems);
      return {
        ok: true,
        strategy: "existing",
        updatedCount: updated,
        assignedCount: merged.size,
        truncated: itemIds.length > MAX,
        themes: await loadThemes(),
        items: allItems,
      };
    }

    const granularity = msg.granularity === "specific" ? "specific" : "broad";
    const targetK = Math.min(28, Math.max(2, Number(msg.targetCategoryCount) || 8));
    const criteriaText = String(msg.criteriaText || "").trim().slice(0, 1200);

    const granHint =
      granularity === "broad"
        ? "Prefer broad buckets (e.g. Tech, Gaming, Music) — short labels."
        : "Prefer specific niches (e.g. Android, iOS, PC gaming, Generative AI) — still concise (2–6 words).";

    const phase1System =
      strategy === "criteria"
        ? `You name exactly ${targetK} category labels for a personal YouTube library. Follow the user's instructions in the JSON field userCriteria. ${granHint} videoSamples contain only stored TubeStack fields (no transcripts, no YouTube/Google API keys). JSON only: {"categories":["label1",...]} — categories.length must equal ${targetK}. Labels must be unique (case-insensitive).`
        : `You name exactly ${targetK} category labels that best group the user's saved YouTube videos (see videoSamples). ${granHint} videoSamples contain only stored TubeStack fields (no transcripts, no URLs, no API keys). JSON only: {"categories":["label1",...]} — categories.length must equal ${targetK}. Labels must be unique (case-insensitive).`;

    const phase1User =
      strategy === "criteria"
        ? JSON.stringify({
            userCriteria: criteriaText || "(infer sensible groups from the videos)",
            videoSamples: rows.slice(0, 60),
            totalVideos: rows.length,
          })
        : JSON.stringify({ videoSamples: rows.slice(0, 60), totalVideos: rows.length });

    const p1 = await openAiJsonCompletion({ apiKey, model, system: phase1System, user: phase1User });
    let categories = p1.categories || p1.categoryLabels;
    if (!Array.isArray(categories)) throw new Error("JSON missing categories[]");
    categories = categories
      .map((x) => String(x || "").trim().slice(0, 80))
      .filter(Boolean);
    const seen = new Set();
    categories = categories.filter((c) => {
      const k = c.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (categories.length < 2) throw new Error("Model returned too few categories");
    if (categories.length > targetK) categories = categories.slice(0, targetK);

    const labelToThemeId = new Map(themes.map((t) => [String(t.label || "").trim().toLowerCase(), t.id]));
    const newThemes = [];
    for (const lab of categories) {
      const k = lab.toLowerCase();
      if (labelToThemeId.has(k)) continue;
      const id = uuid();
      const kwSet = new Set([k, ...keywordsFromLabel(lab)]);
      newThemes.push({
        id,
        label: lab,
        keywords: [...kwSet].slice(0, 48),
        tier: "active",
        genreScope: "ai",
      });
      labelToThemeId.set(k, id);
    }
    if (newThemes.length) {
      themes = [...themes, ...newThemes];
      await saveThemes(themes);
    }

    const categoryLabels = categories.map((c) => c.trim()).filter(Boolean);
    const allowedLower = new Set(categoryLabels.map((c) => c.toLowerCase()));

    const mergedAssign = new Map();
    const chunk2 = 40;
    for (let i = 0; i < rows.length; i += chunk2) {
      const chunk = rows.slice(i, i + chunk2);
      const system2 = `Assign each video to exactly one category from allowedCategories (copy categoryLabel text exactly as listed). videos[] objects include only TubeStack metadata already listed (no transcripts). JSON only: {"assignments":[{"itemId":"","categoryLabel":""}]} — include every video in videos[] exactly once.`;
      const user2 = JSON.stringify({
        allowedCategories: categoryLabels,
        videos: chunk,
      });
      const p2 = await openAiJsonCompletion({ apiKey, model, system: system2, user: user2 });
      const arr = p2.assignments || p2.results;
      if (!Array.isArray(arr)) throw new Error("JSON missing assignments[]");
      for (const a of arr) {
        const id = String(a.itemId || "").trim();
        let lab = String(a.categoryLabel || "").trim();
        if (!id) continue;
        if (!allowedLower.has(lab.toLowerCase())) {
          lab = categoryLabels[0];
        }
        const themeId =
          labelToThemeId.get(lab.toLowerCase()) || labelToThemeId.get(String(categoryLabels[0] || "").toLowerCase());
        if (themeId) mergedAssign.set(id, themeId);
      }
    }

    const fallbackId = labelToThemeId.get(String(categoryLabels[0] || "").toLowerCase());
    for (const r of rows) {
      if (!mergedAssign.has(r.id) && fallbackId) mergedAssign.set(r.id, fallbackId);
    }

    const idToItem = new Map(allItems.map((x) => [x.id, x]));
    let updated = 0;
    for (const [id, themeId] of mergedAssign) {
      const it = idToItem.get(id);
      if (!it) continue;
      if (it.themeId !== themeId) {
        it.themeId = themeId;
        updated++;
      }
    }
    await saveItems(allItems);
    return {
      ok: true,
      strategy,
      updatedCount: updated,
      assignedCount: mergedAssign.size,
      newThemesCount: newThemes.length,
      categoriesUsed: categoryLabels,
      truncated: itemIds.length > MAX,
      themes: await loadThemes(),
      items: allItems,
    };
  } catch (e) {
    return { ok: false, error: "openai_failed", message: String(e.message || e) };
  }
}

async function rebuildGenresFromLibraryHeuristic({ maxUserNiches = 15, replaceExisting = true }) {
  const g = await gatherLibraryVideosForGenreRebuild();
  if (!g.ok) return g;
  const videos = g.videos;
  const broadLower = new Set(BROAD_GENRE_TAXONOMY.map((x) => x.label.toLowerCase()));
  const nicheCounts = new Map();
  for (const v of videos) {
    const niche = inferGranularGenreForText(v.title, null);
    if (!niche || niche === "General & mixed") continue;
    if (broadLower.has(niche.toLowerCase())) continue;
    nicheCounts.set(niche, (nicheCounts.get(niche) || 0) + (v.visitCount || 1));
  }
  const topNiches = [...nicheCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxUserNiches)
    .map(([label]) => label);

  const presetMap = new Map(GRANULAR_GENRE_PRESETS.map((p) => [String(p.label).toLowerCase(), p]));

  const newThemes = [];
  for (const bg of BROAD_GENRE_TAXONOMY) {
    const kw = new Set(
      [...(bg.keywords || []).map((k) => String(k).toLowerCase()), String(bg.label || "").toLowerCase()].filter(Boolean)
    );
    newThemes.push({
      id: uuid(),
      label: bg.label,
      keywords: [...kw],
      tier: "active",
      genreScope: "broad",
    });
  }
  for (const label of topNiches) {
    const preset = presetMap.get(label.toLowerCase());
    const kw = new Set();
    kw.add(label.toLowerCase());
    if (preset) {
      for (const k of preset.keywords || []) kw.add(String(k).toLowerCase());
    } else {
      for (const w of keywordsFromLabel(label)) kw.add(w);
    }
    newThemes.push({
      id: uuid(),
      label,
      keywords: [...kw],
      tier: "active",
      genreScope: "niche",
    });
  }

  if (replaceExisting) {
    await saveThemes(newThemes);
    await reassignLibraryThemesToThemeSet(newThemes);
  }
  return {
    ok: true,
    mode: "heuristic",
    themes: newThemes,
    libraryVideos: videos.length,
    userNiches: topNiches.length,
  };
}

async function rebuildGenresFromLibraryOpenAI({
  maxUserNiches = 15,
  replaceExisting = true,
  apiKey,
  model,
}) {
  const key = String(apiKey || "").trim();
  if (key.length < 20) return { ok: false, error: "openai_key_required", message: "Add an OpenAI API key in settings or paste it in the rebuild dialog." };
  const g = await gatherLibraryVideosForGenreRebuild();
  if (!g.ok) return g;
  let videos = g.videos.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0)).slice(0, 280);
  const broadLabels = BROAD_GENRE_TAXONOMY.map((x) => x.label);
  const nicheWeight = new Map();
  const chunkSize = 28;
  const now = Date.now();
  let cache = await loadOpenAiLibraryClassifyCache();
  try {
    for (let i = 0; i < videos.length; i += chunkSize) {
      const chunk = videos.slice(i, i + chunkSize);
      const need = [];
      const cachedRows = [];
      for (const v of chunk) {
        const th = hashStringDjb2(String(v.title || "").slice(0, 240));
        const ent = cache[v.videoId];
        if (ent && ent.th === th && now - ent.at < OPENAI_LIBRARY_CLASSIFY_TTL_MS) {
          cachedRows.push({ videoId: v.videoId, broad: ent.broad, niche: ent.niche });
        } else {
          need.push(v);
        }
      }
      let rows = cachedRows.slice();
      if (need.length) {
        const fresh = await openAiClassifyTitleChunk({ items: need, apiKey: key, model, broadLabels });
        for (const row of fresh) {
          const vid = String(row.videoId || "").trim();
          const rec = need.find((x) => x.videoId === vid);
          if (rec) {
            cache[vid] = {
              th: hashStringDjb2(String(rec.title || "").slice(0, 240)),
              broad: String(row.broad || ""),
              niche: String(row.niche || ""),
              at: now,
            };
          }
        }
        rows = rows.concat(fresh);
        await saveOpenAiLibraryClassifyCache(cache);
      }
      const byId = new Map(chunk.map((x) => [x.videoId, x]));
      for (const row of rows) {
        const niche = String(row.niche || "")
          .trim()
          .slice(0, 80);
        if (niche.length <= 3) continue;
        const rec = byId.get(row.videoId);
        const w = rec?.visitCount || 1;
        nicheWeight.set(niche, (nicheWeight.get(niche) || 0) + w);
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: "openai_failed",
      message: String(e?.message || e) || "OpenAI request failed during category rebuild.",
    };
  }

  const topNiches = [...nicheWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxUserNiches)
    .map(([label]) => label);

  const newThemes = [];
  for (const bg of BROAD_GENRE_TAXONOMY) {
    const kw = new Set(
      [...(bg.keywords || []).map((k) => String(k).toLowerCase()), String(bg.label || "").toLowerCase()].filter(Boolean)
    );
    newThemes.push({
      id: uuid(),
      label: bg.label,
      keywords: [...kw],
      tier: "active",
      genreScope: "broad",
    });
  }
  for (const label of topNiches) {
    newThemes.push({
      id: uuid(),
      label,
      keywords: keywordsFromLabel(label),
      tier: "active",
      genreScope: "niche",
    });
  }

  if (replaceExisting) {
    await saveThemes(newThemes);
    await reassignLibraryThemesToThemeSet(newThemes);
  }
  return {
    ok: true,
    mode: "openai",
    themes: newThemes,
    libraryVideos: g.videos.length,
    userNiches: topNiches.length,
  };
}

async function rebuildGenresFromLibrary(msg = {}) {
  const mode = msg.mode === "openai" ? "openai" : "heuristic";
  const maxUserNiches = Math.min(20, Math.max(5, Number(msg.maxUserNiches) || 15));
  const replaceExisting = msg.replaceExisting !== false;
  const settings = await loadSettings();
  let apiKey = String(msg.openaiApiKey || "").trim() || String(settings.openaiApiKey || "").trim();

  if (mode === "openai") {
    if (msg.saveOpenaiKey && String(msg.openaiApiKey || "").trim().length >= 20) {
      await saveSettings({ openaiApiKey: String(msg.openaiApiKey).trim() });
      apiKey = String(msg.openaiApiKey).trim();
    }
    return rebuildGenresFromLibraryOpenAI({
      maxUserNiches,
      replaceExisting,
      apiKey,
      model: msg.openaiModel,
    });
  }
  return rebuildGenresFromLibraryHeuristic({ maxUserNiches, replaceExisting });
}

async function dismissLatestImportBatch() {
  await saveSettings({ latestImportBatchId: null });
  return { ok: true };
}

function buildItemFromTab(tab, meta) {
  const url = tab.url || "";
  const isShort = /\/shorts\//i.test(url);
  const videoId = parseVideoId(url) || meta?.videoId || null;
  let timestampSec = meta?.timestampSec ?? null;
  if (timestampSec == null) {
    try {
      const u = new URL(url);
      const t = u.searchParams.get("t") || u.searchParams.get("start");
      if (t) {
        if (/^\d+$/.test(t)) timestampSec = parseInt(t, 10);
        else {
          const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
          if (m) {
            const h = parseInt(m[1] || "0", 10);
            const min = parseInt(m[2] || "0", 10);
            const s = parseInt(m[3] || "0", 10);
            timestampSec = h * 3600 + min * 60 + s;
          }
        }
      }
    } catch {
      /* */
    }
  }

  const title = meta?.title || tab.title || "YouTube video";
  const channel = meta?.channel ?? null;
  const thumbnail = meta?.thumbnail ?? (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
  const durationSec = meta?.durationSec ?? null;

  const canonicalUrl = videoId != null ? (isShort ? `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}` : normalizeWatchUrl(videoId, timestampSec)) : url;

  const item = {
    id: uuid(),
    url: canonicalUrl,
    videoId,
    title,
    channel,
    thumbnail,
    durationSec,
    timestampSec,
    savedAt: new Date().toISOString(),
    category: isShort ? "shorts" : "watch_later",
    tags: isShort ? ["shorts"] : [],
    suggestedTags: [],
    priority: "prio_med",
    notes: "",
    note: "",
    watchState: TS_WATCH.DEFAULT_WATCH_STATE,
    timestampNotes: [],
    themeId: null,
    libraryImportSource: "session",
  };
  item.granularGenre = inferGranularGenreForText(item.title, item.channel);
  return item;
}

async function saveYouTubeTabsByMode(mode) {
  if (!SAVE_YT_TAB_MODES.has(mode)) {
    return { ok: false, error: "invalid_mode", saved: [] };
  }
  const { tabs, error, currentTabId } = await getYouTubeWatchTabsForMode(mode);
  if (error) return { ok: false, error, saved: [] };

  const ordered = [...tabs].sort((a, b) => {
    if (a.id === currentTabId) return 1;
    if (b.id === currentTabId) return -1;
    return (a.index ?? 0) - (b.index ?? 0);
  });

  const importBatchId = uuid();
  const themes = await loadThemes();
  const saved = [];
  const tabIdsToClose = [];
  const progressMap = await loadVideoProgress();
  let progressDirty = false;

  for (const tab of ordered) {
    if (!tab.id || !tab.url) continue;
    const meta = await requestMetadataFromTab(tab.id);
    const item = buildItemFromTab(tab, meta);
    item.importBatchId = importBatchId;
    const best = bestThemeForItem(item, themes);
    if (best) item.themeId = best.id;
    if (item.videoId) {
      const patch = progressPatchFromSaveMeta(item.videoId, meta);
      if (patch) {
        progressMap[item.videoId] = mergeVideoProgressRecord(progressMap[item.videoId], {
          ...patch,
          deltaWatchSec: 0,
        });
        progressDirty = true;
        if (patch.progressSource === "captured_on_save" && patch.playheadSec > 0) {
          item.timestampSec = patch.playheadSec;
        } else if (patch.progressSource === "url_timestamp" && patch.playheadSec > 0) {
          item.timestampSec = patch.playheadSec;
        }
      }
    }
    saved.push(item);
    tabIdsToClose.push(tab.id);
  }

  if (progressDirty) await saveVideoProgress(progressMap);

  if (saved.length) {
    const existing = await loadItems();
    await saveItems([...saved, ...existing]);
    await saveSettings({
      latestImportBatchId: importBatchId,
      latestImportAt: new Date().toISOString(),
    });
  }

  for (const id of tabIdsToClose) {
    try {
      await chrome.tabs.remove(id);
    } catch {
      /* */
    }
  }

  return { ok: true, savedCount: saved.length, saved, mode };
}

function sanitizeItemPatch(fields) {
  const next = { ...fields };
  if ("watchState" in next) {
    next.watchState = TS_WATCH.normalizeWatchStateId(next.watchState);
  }
  if ("note" in next || "notes" in next) {
    const note = TS_WATCH.itemNoteText({ note: next.note, notes: next.notes });
    next.note = note;
    next.notes = note;
  }
  if ("timestampNotes" in next) {
    next.timestampNotes = TS_WATCH.normalizeTimestampNotes(next.timestampNotes);
  }
  return next;
}

async function updateItem(patch) {
  const { id, ...fields } = patch || {};
  if (!id) return { ok: false, error: "Missing id" };
  const items = await loadItems();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, error: "Not found" };
  items[i] = { ...items[i], ...sanitizeItemPatch(fields) };
  TS_WATCH.normalizeLibraryItemFields(items[i], await loadVideoProgress());
  await saveItems(items);
  return { ok: true, item: items[i] };
}

async function bulkUpdateItems({ ids, patch }) {
  const idSet = new Set((ids || []).map((x) => String(x || "").trim()).filter(Boolean));
  if (!idSet.size) return { ok: false, error: "no_ids" };
  const items = await loadItems();
  const progressMap = await loadVideoProgress();
  const sanitized = sanitizeItemPatch(patch || {});
  let updated = 0;
  for (const it of items) {
    if (!idSet.has(it.id)) continue;
    Object.assign(it, sanitized);
    TS_WATCH.normalizeLibraryItemFields(it, progressMap);
    updated++;
  }
  if (updated) await saveItems(items);
  return { ok: true, updatedCount: updated, items };
}

async function updateLocalPlaylistStack({ playlistId, patch }) {
  const id = String(playlistId || "").trim();
  if (!id) return { ok: false, error: "missing_id" };
  const lists = await loadLocalPlaylists();
  const pl = lists.find((x) => x.id === id);
  if (!pl) return { ok: false, error: "not_found" };
  if (patch && typeof patch === "object") {
    if ("stackNote" in patch) pl.stackNote = String(patch.stackNote || "").slice(0, 8000);
    if ("researchSummary" in patch) pl.researchSummary = String(patch.researchSummary || "").slice(0, 12000);
    if ("decisions" in patch) pl.decisions = TS_WATCH.normalizeDecisions(patch.decisions);
    if ("name" in patch) {
      const n = String(patch.name || "").trim();
      if (n) pl.name = n.slice(0, 200);
    }
  }
  TS_WATCH.normalizeLocalPlaylistFields(pl);
  await saveLocalPlaylists(lists);
  return { ok: true, playlist: pl, playlists: lists };
}

async function aiSuggestWatchStates(msg = {}) {
  const settings = await loadSettings();
  let apiKey = String(msg.openaiApiKey || "").trim() || String(settings.openaiApiKey || "").trim();
  if (msg.saveOpenaiKey === true && String(msg.openaiApiKey || "").trim().length >= 20) {
    await saveSettings({ openaiApiKey: String(msg.openaiApiKey).trim() });
    apiKey = String(msg.openaiApiKey).trim();
  }
  if (apiKey.length < 20) {
    return { ok: false, error: "openai_key_required", message: "Add an OpenAI API key in Settings (or paste below)." };
  }

  const rawIds = Array.isArray(msg.itemIds) ? msg.itemIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const itemIds = [...new Set(rawIds)];
  if (!itemIds.length) return { ok: false, error: "no_items", message: "No videos selected." };

  const MAX = 60;
  const cappedIds = itemIds.slice(0, MAX);
  const allItems = await loadItems();
  const order = new Map(cappedIds.map((id, i) => [id, i]));
  let targets = allItems.filter((x) => cappedIds.includes(x.id));
  targets.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (!targets.length) {
    return { ok: false, error: "no_items", message: "None of those videos are in your library." };
  }

  const model = String(msg.openaiModel || "").trim() || "gpt-4o-mini";
  const themeLabelById = new Map((await loadThemes()).map((t) => [t.id, String(t.label || "").trim()]));
  const watchLabels = TS_WATCH.WATCH_STATE_LIST.map((x) => `${x.id} (${x.label})`).join(", ");
  const rows = targets.map((it) => {
    const row = buildLibraryItemPayloadForOpenAi(it, themeLabelById);
    row.videoId = it.videoId || "";
    row.currentWatchState = TS_WATCH.normalizeWatchStateId(it.watchState);
    return row;
  });

  let stackContext = "";
  const plId = String(msg.playlistId || "").trim();
  if (plId) {
    const pl = (await loadLocalPlaylists()).find((x) => x.id === plId);
    if (pl) {
      stackContext = JSON.stringify({
        name: pl.name,
        stackNote: String(pl.stackNote || "").slice(0, 500),
        researchSummary: String(pl.researchSummary || "").slice(0, 800),
      });
    }
  }

  const suggestions = [];
  const chunkSize = 24;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const system = `You suggest Watch States for saved YouTube library videos. Watch States are separate from tags/categories.
Allowed suggestedWatchState values only: ${TS_WATCH.WATCH_STATE_LIST.map((x) => x.id).join(", ")}.
Tags are user-defined labels in suggestedTags[] (strings only). Do NOT put Watch State names into suggestedTags.
Do not assume transcripts or data from unrelated sites. JSON only:
{"videos":[{"videoId":"","suggestedWatchState":"","suggestedTags":[""],"reason":""}]}
Include every video in the input exactly once.`;
    const user = JSON.stringify({ watchStateOptions: watchLabels, stackContext: stackContext || null, videos: chunk });
    const parsed = await openAiJsonCompletion({ apiKey, model, system, user });
    const arr = parsed.videos || parsed.items || parsed.results;
    if (!Array.isArray(arr)) throw new Error("JSON missing videos[]");
    for (const row of arr) {
      const videoId = String(row.videoId || "").trim();
      if (!videoId) continue;
      suggestions.push({
        videoId,
        itemId: targets.find((t) => t.videoId === videoId)?.id || null,
        suggestedWatchState: TS_WATCH.normalizeWatchStateId(row.suggestedWatchState),
        suggestedTags: Array.isArray(row.suggestedTags)
          ? row.suggestedTags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8)
          : [],
        reason: String(row.reason || "").slice(0, 400),
      });
    }
  }

  return {
    ok: true,
    suggestions,
    truncated: itemIds.length > MAX,
    applyRequired: true,
    message: "Review suggestions before applying. Watch States are not changed until you confirm.",
  };
}

async function applyWatchStateSuggestions(msg = {}) {
  const rows = Array.isArray(msg.suggestions) ? msg.suggestions : [];
  if (!rows.length) return { ok: false, error: "no_suggestions" };
  const items = await loadItems();
  const byVid = new Map(items.filter((x) => x.videoId).map((x) => [x.videoId, x]));
  const byId = new Map(items.map((x) => [x.id, x]));
  let updated = 0;
  for (const s of rows) {
    const it = (s.itemId && byId.get(s.itemId)) || (s.videoId && byVid.get(s.videoId));
    if (!it) continue;
    if (msg.applyWatchState !== false && s.suggestedWatchState) {
      it.watchState = TS_WATCH.normalizeWatchStateId(s.suggestedWatchState);
      updated++;
    }
    if (msg.applyTags === true && Array.isArray(s.suggestedTags) && s.suggestedTags.length) {
      const merged = new Set([...(it.tags || []), ...s.suggestedTags.map((t) => String(t).trim()).filter(Boolean)]);
      it.tags = [...merged].slice(0, 12);
    }
  }
  if (updated) await saveItems(items);
  return { ok: true, updatedCount: updated, items };
}

async function deleteItems(ids) {
  const set = new Set(ids);
  const items = (await loadItems()).filter((x) => !set.has(x.id));
  await saveItems(items);
  return { ok: true };
}

/** Open saved snapshot rows (library items or local playlist entries) as YouTube tabs. */
async function openSnapshotItemsAsTabs(items, progressMap) {
  const list = Array.isArray(items) ? items : [];
  let opened = 0;
  for (const it of list) {
    const vid = it.videoId;
    const pos = getPlayheadFromStorage(it, progressMap);
    const url =
      vid != null
        ? normalizeWatchUrl(vid, pos > 2 ? pos : it.timestampSec ?? null)
        : it.url || null;
    if (!url) continue;
    await chrome.tabs.create({ url, active: false });
    opened++;
  }
  return { ok: true, opened, requested: list.length };
}

async function restoreItems(ids) {
  const set = new Set(ids);
  const items = await loadItems();
  const progressMap = await loadVideoProgress();
  const toOpen = items.filter((x) => set.has(x.id));
  return openSnapshotItemsAsTabs(toOpen, progressMap);
}

/** Restore session: open every video in a saved local playlist as tabs. */
async function restoreLocalPlaylistSession(playlistId) {
  const id = String(playlistId || "").trim();
  if (!id) return { ok: false, error: "missing_id" };
  const lists = await loadLocalPlaylists();
  const pl = lists.find((x) => x.id === id);
  if (!pl) return { ok: false, error: "not_found" };
  const items = Array.isArray(pl.items) ? pl.items : [];
  if (!items.length) {
    return { ok: false, error: "empty_playlist", message: "This playlist has no videos." };
  }
  const progressMap = await loadVideoProgress();
  const r = await openSnapshotItemsAsTabs(items, progressMap);
  return { ...r, playlistName: pl.name || "" };
}

function matchesSearch(item, q) {
  if (!q.trim()) return true;
  const s = q.toLowerCase();
  const hay = [
    item.title,
    item.channel,
    item.notes,
    item.category,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(s);
}

async function searchItems(query) {
  const items = await loadItems();
  return items.filter((x) => matchesSearch(x, query));
}

async function getFullState() {
  let items = await loadItems();
  if (migrateLibraryListAndPriority(items)) {
    await saveItems(items);
  }
  const [themes, rawSettings, videoProgress, watchByDay, localPlaylists, subscriptionChannels] =
    await Promise.all([
      loadThemes(),
      loadSettings(),
      loadVideoProgress(),
      loadWatchByDay(),
      loadLocalPlaylists(),
      loadSubscriptionChannels(),
    ]);
  const today = todayKey();
  let oauthRedirectUri = "";
  try {
    oauthRedirectUri = chrome.identity.getRedirectURL();
  } catch {
    /* */
  }
  return {
    ok: true,
    items,
    themes,
    settings: sanitizeSettingsForClient(rawSettings),
    hasYoutubeApiKey: Boolean(rawSettings.youtubeDataApiKey),
    hasOpenaiKey: Boolean(rawSettings.openaiApiKey),
    hasYoutubeOAuthClientId: Boolean(String(rawSettings.youtubeOAuthClientId || "").trim()),
    integrationHealth: integrationHealthFromSettings(rawSettings),
    extensionId: chrome.runtime?.id || "",
    oauthRedirectUri,
    videoProgress,
    watchByDay,
    todayWatchSeconds: watchByDay[today] || 0,
    categories: DEFAULT_CATEGORIES,
    limits: { maxFavoriteThemes: MAX_FAVORITE_THEMES, maxPlaylistThemes: MAX_PLAYLIST_THEMES },
    localPlaylists,
    subscriptionChannels,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "TUBESTACK_SAVE_LEFT": {
        sendResponse(await saveYouTubeTabsByMode("left"));
        break;
      }
      case "TUBESTACK_SAVE_YT_TABS": {
        sendResponse(await saveYouTubeTabsByMode(msg.mode));
        break;
      }
      case "TUBESTACK_GET_ITEMS": {
        const items = await loadItems();
        sendResponse({ ok: true, items, categories: DEFAULT_CATEGORIES });
        break;
      }
      case "TUBESTACK_GET_STATE": {
        sendResponse(await getFullState());
        break;
      }
      case "TUBESTACK_PATCH_SETTINGS": {
        const patch = msg.patch || {};
        if (Object.prototype.hasOwnProperty.call(patch, "youtubeOAuthClientId")) {
          clearYoutubeImportAuthCache();
        }
        const merged = await saveSettings(patch);
        sendResponse({
          ok: true,
          settings: sanitizeSettingsForClient(merged),
          hasYoutubeApiKey: Boolean(merged.youtubeDataApiKey),
          hasOpenaiKey: Boolean(merged.openaiApiKey),
        });
        break;
      }
      case "TUBESTACK_TEST_OPENAI_CONNECTION": {
        sendResponse(await testOpenAiConnection(msg));
        break;
      }
      case "TUBESTACK_CREATE_YOUTUBE_PLAYLIST": {
        sendResponse(
          await createYoutubePlaylistOnAccount({
            title: msg.title,
            description: msg.description,
            privacyStatus: msg.privacyStatus,
            videoIds: msg.videoIds,
          })
        );
        break;
      }
      case "TUBESTACK_LOCAL_PLAYLIST_SAVE": {
        sendResponse(
          await saveLocalPlaylistEntry({
            name: msg.name,
            items: msg.items,
            kind: msg.kind,
            groupBy: msg.groupBy,
            smartSummary: msg.smartSummary,
            playlistSource: msg.playlistSource,
            youtubePlaylistId: msg.youtubePlaylistId,
          })
        );
        break;
      }
      case "TUBESTACK_YOUTUBE_PLAYLISTS_LIST": {
        sendResponse(await tubestackYoutubePlaylistsList());
        break;
      }
      case "TUBESTACK_YOUTUBE_PLAYLIST_PREVIEW": {
        sendResponse(await tubestackYoutubePlaylistPreview(msg));
        break;
      }
      case "TUBESTACK_IMPORT_YOUTUBE_PLAYLISTS_SELECTED": {
        sendResponse(await tubestackImportYoutubePlaylistsSelected(msg));
        break;
      }
      case "TUBESTACK_YOUTUBE_IMPORT_SESSION_CLEAR": {
        clearYoutubeImportAuthCache();
        sendResponse({ ok: true });
        break;
      }
      case "TUBESTACK_ERASE_LOCAL_LIBRARY_DATA": {
        sendResponse(await eraseLocalLibraryData());
        break;
      }
      case "TUBESTACK_CLEAR_SUBSCRIPTION_CHANNELS": {
        await saveSubscriptionChannels([]);
        sendResponse({ ok: true });
        break;
      }
      case "TUBESTACK_CLEAR_OPENAI_LOCAL_CACHE": {
        await chrome.storage.local.remove([
          OPENAI_LIBRARY_CLASSIFY_CACHE_KEY,
          OPENAI_LIBRARY_CLASSIFY_CACHE_KEY_LEGACY,
        ]);
        sendResponse({ ok: true });
        break;
      }
      case "TUBESTACK_MERGE_SUBSCRIPTION_CHANNELS": {
        sendResponse(await mergeSubscriptionChannelLabels(msg.labels || []));
        break;
      }
      case "TUBESTACK_YOUTUBE_SUBSCRIPTIONS_SYNC": {
        sendResponse(await syncYoutubeSubscriptionsViaOAuth());
        break;
      }
      case "TUBESTACK_DELETE_SUBSCRIPTION_CHANNEL": {
        sendResponse(await deleteSubscriptionChannelEntry(msg.name));
        break;
      }
      case "TUBESTACK_RESET_ONBOARDING": {
        await saveSettings({ onboardingComplete: false });
        rebuildTubeStackContextMenus();
        sendResponse({ ok: true });
        break;
      }
      case "TUBESTACK_LOCAL_PLAYLIST_RENAME": {
        sendResponse(await renameLocalPlaylistEntry({ id: msg.id, name: msg.name }));
        break;
      }
      case "TUBESTACK_LOCAL_PLAYLIST_DELETE": {
        sendResponse(await deleteLocalPlaylistEntry(msg.id));
        break;
      }
      case "TUBESTACK_LOCAL_PLAYLIST_ADD_ITEMS": {
        sendResponse(
          await addItemsToLocalPlaylistEntry({
            playlistId: msg.playlistId,
            items: msg.items,
            createNew: msg.createNew === true,
            name: msg.name,
          })
        );
        break;
      }
      case "TUBESTACK_UPDATE_ITEM": {
        sendResponse(await updateItem(msg.patch));
        break;
      }
      case "TUBESTACK_BULK_UPDATE_ITEMS": {
        sendResponse(await bulkUpdateItems({ ids: msg.ids, patch: msg.patch }));
        break;
      }
      case "TUBESTACK_UPDATE_LOCAL_PLAYLIST_STACK": {
        sendResponse(await updateLocalPlaylistStack({ playlistId: msg.playlistId, patch: msg.patch }));
        break;
      }
      case "TUBESTACK_AI_SUGGEST_WATCH_STATES": {
        sendResponse(await aiSuggestWatchStates(msg));
        break;
      }
      case "TUBESTACK_APPLY_WATCH_STATE_SUGGESTIONS": {
        sendResponse(await applyWatchStateSuggestions(msg));
        break;
      }
      case "TUBESTACK_DELETE_ITEMS": {
        sendResponse(await deleteItems(msg.ids || []));
        break;
      }
      case "TUBESTACK_RESTORE": {
        sendResponse(await restoreItems(msg.ids || []));
        break;
      }
      case "TUBESTACK_RESTORE_LOCAL_PLAYLIST": {
        sendResponse(await restoreLocalPlaylistSession(msg.playlistId));
        break;
      }
      case "TUBESTACK_SEARCH": {
        const items = await searchItems(msg.query || "");
        sendResponse({ ok: true, items });
        break;
      }
      case "TUBESTACK_COUNT_LEFT": {
        const c = await getSaveYouTubeTabCounts();
        sendResponse(c.ok ? { ok: true, count: c.left } : c);
        break;
      }
      case "TUBESTACK_GET_SAVE_TAB_COUNTS": {
        sendResponse(await getSaveYouTubeTabCounts());
        break;
      }
      case "TUBESTACK_PROGRESS_TICK": {
        await handleProgressTick(msg);
        sendResponse({ ok: true });
        break;
      }
      case "TUBESTACK_CYCLE_THEME": {
        sendResponse(await cycleTheme(msg.themeId));
        break;
      }
      case "TUBESTACK_MERGE_CHANNELS": {
        sendResponse(await mergeScrapedChannels(msg.labels || []));
        break;
      }
      case "TUBESTACK_SET_THEME_KEYWORDS": {
        sendResponse(await setThemeKeywords(msg.themeId, msg.keywords));
        break;
      }
      case "TUBESTACK_SCRAPE_TAB": {
        sendResponse(await scrapeYouTubeTab(msg.tabId));
        break;
      }
      case "TUBESTACK_RUN_AUTO_SORT": {
        sendResponse(await autoAssignThemesToItems());
        break;
      }
      case "TUBESTACK_BUILD_PLAYLIST": {
        sendResponse(
          await buildPlaylist({
            themeIds: msg.themeIds,
            budgetMinutes: msg.budgetMinutes,
            sortMode: msg.sortMode,
          })
        );
        break;
      }
      case "TUBESTACK_MERGE_GRANULAR_GENRE_THEMES": {
        sendResponse(await mergeThemesFromGranularLabels(msg.labels || []));
        break;
      }
      case "TUBESTACK_REBUILD_GENRES_FROM_LIBRARY":
      case "TUBESTACK_REBUILD_GENRES_FROM_HISTORY": {
        sendResponse(await rebuildGenresFromLibrary(msg));
        break;
      }
      case "TUBESTACK_AI_CATEGORIZE_LIBRARY": {
        sendResponse(await aiCategorizeLibrary(msg));
        break;
      }
      case "TUBESTACK_RENAME_THEME": {
        sendResponse(await renameThemeEntry({ themeId: msg.themeId, label: msg.label }));
        break;
      }
      case "TUBESTACK_TOGGLE_THEME_FAVORITE": {
        sendResponse(await toggleThemeFavoriteTier(msg.themeId));
        break;
      }
      case "TUBESTACK_ADD_THEME": {
        sendResponse(await addThemeEntry(msg.label));
        break;
      }
      case "TUBESTACK_DELETE_THEME": {
        sendResponse(await deleteThemeEntry(msg.themeId));
        break;
      }
      case "TUBESTACK_FETCH_VIDEO_TAGS": {
        sendResponse(await fetchVideoTagsForItem(msg));
        break;
      }
      case "TUBESTACK_DISMISS_IMPORT_BATCH": {
        sendResponse(await dismissLatestImportBatch());
        break;
      }
      case "TUBESTACK_TEST_YOUTUBE_API_KEY": {
        sendResponse(await testYoutubeDataApiKey(msg.apiKey));
        break;
      }
      case "TUBESTACK_TEST_YOUTUBE_OAUTH": {
        sendResponse(await testYoutubeOAuthConnection(msg));
        break;
      }
      case "TUBESTACK_SAVE_OOBE_CREDENTIALS": {
        sendResponse(await saveOobeCredentials(msg));
        break;
      }
      case "TUBESTACK_YOUTUBE_API_SCAN": {
        sendResponse(await runYoutubeApiScan({ boostThemes: msg.boostThemes !== false }));
        break;
      }
      case "TUBESTACK_COMPLETE_ONBOARDING": {
        await saveSettings({ onboardingComplete: true });
        rebuildTubeStackContextMenus();
        sendResponse({ ok: true });
        break;
      }
      case "TUBESTACK_SET_FOCUS": {
        const minutes = Number(msg.minutes) || 0;
        if (minutes <= 0) {
          await saveSettings({ focusSession: null });
          sendResponse({ ok: true, focusSession: null });
        } else {
          const endsAt = Date.now() + minutes * 60000;
          const fs = { startedAt: Date.now(), endsAt, minutes };
          await saveSettings({ focusSession: fs });
          sendResponse({ ok: true, focusSession: fs });
        }
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  })();
  return true;
});

const TUBESTACK_CTX = {
  root: "tubestack-ctx-root",
  saveLeft: "tubestack-ctx-save-left",
  saveRight: "tubestack-ctx-save-right",
  saveAll: "tubestack-ctx-save-all",
  saveExcept: "tubestack-ctx-save-except",
  scrapeChannels: "tubestack-ctx-scrape-channels",
  dashboard: "tubestack-ctx-dashboard",
  /** Right-click extension icon (toolbar) — only while onboarding not finished */
  setupWizardAction: "tubestack-ctx-action-setup-wizard",
};

const TUBESTACK_CTX_WEB = ["http://*/*", "https://*/*"];
const TUBESTACK_CTX_CONTEXTS = ["page", "frame", "link", "video", "audio", "image", "selection"];

/** Chrome’s `contextMenus.create` rejects unknown keys (e.g. `icons` on child items). Only pass allowed props. */
function createContextMenuEntry(partial) {
  const allowed = new Set([
    "id",
    "type",
    "title",
    "checked",
    "contexts",
    "documentUrlPatterns",
    "targetUrlPatterns",
    "enabled",
    "parentId",
  ]);
  const props = {};
  for (const [k, v] of Object.entries(partial)) {
    if (allowed.has(k) && v !== undefined) props[k] = v;
  }
  chrome.contextMenus.create(props);
}

function rebuildTubeStackContextMenus() {
  void (async () => {
    let wizardDone = false;
    try {
      const settings = await loadSettings();
      wizardDone = settings.onboardingComplete === true;
    } catch {
      /* keep wizardDone false */
    }

    await new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => resolve());
    });

    try {
      const child = {
        contexts: TUBESTACK_CTX_CONTEXTS,
        documentUrlPatterns: TUBESTACK_CTX_WEB,
      };
      createContextMenuEntry({
        id: TUBESTACK_CTX.root,
        title: "TubeStack",
        ...child,
      });
      createContextMenuEntry({
        id: TUBESTACK_CTX.saveLeft,
        parentId: TUBESTACK_CTX.root,
        title: "Save all to the left",
        ...child,
      });
      createContextMenuEntry({
        id: TUBESTACK_CTX.saveRight,
        parentId: TUBESTACK_CTX.root,
        title: "Save all to the right",
        ...child,
      });
      createContextMenuEntry({
        id: TUBESTACK_CTX.saveAll,
        parentId: TUBESTACK_CTX.root,
        title: "Save all watch tabs",
        ...child,
      });
      createContextMenuEntry({
        id: TUBESTACK_CTX.saveExcept,
        parentId: TUBESTACK_CTX.root,
        title: "Save all except this video",
        ...child,
      });
      createContextMenuEntry({
        id: TUBESTACK_CTX.scrapeChannels,
        parentId: TUBESTACK_CTX.root,
        title: "Import channels from this page",
        contexts: ["page"],
        documentUrlPatterns: ["*://www.youtube.com/feed/channels*", "*://m.youtube.com/feed/channels*"],
      });
      createContextMenuEntry({
        id: TUBESTACK_CTX.dashboard,
        parentId: TUBESTACK_CTX.root,
        title: "Open dashboard",
        ...child,
      });
      if (!wizardDone) {
        createContextMenuEntry({
          id: TUBESTACK_CTX.setupWizardAction,
          title: "Setup wizard",
          contexts: ["action"],
        });
      }
    } catch {
      /* Avoid logging full Error objects (could surface sensitive context in edge cases). */
      console.error("TubeStack: context menu setup failed");
    }
  })();
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = info.menuItemId;
  if (typeof id !== "string" || !id.startsWith("tubestack-ctx-")) return;

  if (id === TUBESTACK_CTX.dashboard) {
    const url = chrome.runtime.getURL("dashboard/dashboard.html");
    if (tab?.id != null) chrome.tabs.update(tab.id, { url });
    else chrome.tabs.create({ url });
    return;
  }
  if (id === TUBESTACK_CTX.setupWizardAction) {
    const url = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.create({ url, active: true });
    return;
  }
  if (id === TUBESTACK_CTX.scrapeChannels) {
    const tabId = tab?.id;
    if (!tabId) return;
    void (async () => {
      const scrape = await scrapeYouTubeChannelsPage(tabId);
      if (!scrape?.ok) return;
      await mergeSubscriptionChannelLabels(scrape.channels || []);
    })();
    return;
  }

  const modeById = {
    [TUBESTACK_CTX.saveLeft]: "left",
    [TUBESTACK_CTX.saveRight]: "right",
    [TUBESTACK_CTX.saveAll]: "all",
    [TUBESTACK_CTX.saveExcept]: "except_current",
  };
  const mode = modeById[id];
  if (!mode) return;
  void saveYouTubeTabsByMode(mode);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await chrome.storage.local.get(["items", "themes", "localPlaylists"]);
  if (!Array.isArray(data.items)) await chrome.storage.local.set({ items: [] });
  if (!Array.isArray(data.themes) || !data.themes.length) await seedThemes();
  if (!Array.isArray(data.localPlaylists)) await chrome.storage.local.set({ localPlaylists: [] });
  const ch = await chrome.storage.local.get("subscriptionChannels");
  if (!Array.isArray(ch.subscriptionChannels)) await chrome.storage.local.set({ subscriptionChannels: [] });

  if (details.reason === "install") {
    try {
      const settings = await loadSettings();
      if (settings.onboardingComplete !== true) {
        await chrome.tabs.create({
          url: chrome.runtime.getURL("dashboard/dashboard.html"),
          active: true,
        });
      }
    } catch {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard/dashboard.html"),
        active: true,
      });
    }
  }

  rebuildTubeStackContextMenus();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.settings) return;
  const oldVal = changes.settings.oldValue;
  const newVal = changes.settings.newValue;
  const oldDone = oldVal && typeof oldVal === "object" ? oldVal.onboardingComplete : undefined;
  const newDone = newVal && typeof newVal === "object" ? newVal.onboardingComplete : undefined;
  if (oldDone === newDone) return;
  rebuildTubeStackContextMenus();
});
