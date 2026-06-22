/**
 * TubeStack side panel — playlist viewer/editor.
 *
 * Shows the selected (or just-imported) playlist as a compact, editable list of videos.
 *   - Pick a playlist from the dropdown → it loads into the sidebar.
 *   - Import button → saves this window's YouTube tabs into a new playlist and shows it here.
 *   - Per-video: a category dropdown (basic categorization), remove-from-playlist, click to open.
 *
 * Playlist items are lightweight snapshots; editable fields (category) live on the matching
 * library item, joined by videoId. All operations reuse existing TUBESTACK_* messages —
 * no new permissions, no network, no service-worker changes.
 */

const playlistSelect = document.getElementById("playlistSelect");
const playlistName = document.getElementById("playlistName");
const countLine = document.getElementById("countLine");
const btnImportTabs = document.getElementById("btnImportTabs");
const videoList = document.getElementById("videoList");
const emptyState = document.getElementById("emptyState");
const status = document.getElementById("status");
const btnFull = document.getElementById("btnFull");
const btnPopup = document.getElementById("btnPopup");

/** Render cap so a very large playlist never lays out hundreds of nodes at once. */
const RENDER_CAP = 200;

const CATEGORY_LABELS = {
  watch_later: "Watch later",
  long_play: "Long play",
  shorts: "Shorts",
  documentary: "Documentary",
  music: "Music",
  custom: "Custom",
};

let playlists = [];
let categoryIds = Object.keys(CATEGORY_LABELS);
let libraryByVideoId = new Map();
let currentPlaylistId = null;
let settingsCurrentPlaylistId = null;

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function openExtensionInNewTab(path) {
  const url = chrome.runtime.getURL(path);
  await chrome.tabs.create({ url, active: true });
}

function dashboardPlaylistPath(playlistId) {
  const id = String(playlistId || "").trim();
  if (!id) return "dashboard/dashboard.html";
  return `dashboard/dashboard.html?playlist=${encodeURIComponent(id)}`;
}

function findPlaylist(id) {
  return playlists.find((x) => x.id === id) || null;
}

/* ---------------- State load ---------------- */

async function loadState() {
  const [state, itemsRes] = await Promise.all([
    send("TUBESTACK_GET_STATE"),
    send("TUBESTACK_GET_ITEMS"),
  ]);
  playlists = Array.isArray(state?.localPlaylists) ? state.localPlaylists : [];
  settingsCurrentPlaylistId = String(state?.settings?.currentPlaylistId || "").trim() || null;
  if (Array.isArray(state?.categories) && state.categories.length) {
    categoryIds = state.categories;
  }

  const items = Array.isArray(itemsRes?.items) ? itemsRes.items : [];
  libraryByVideoId = new Map();
  for (const it of items) {
    const vid = String(it.videoId || "").trim();
    if (vid && !libraryByVideoId.has(vid)) libraryByVideoId.set(vid, it);
  }
}

/* ---------------- Playlist dropdown ---------------- */

function refreshPlaylistOptions(preferredId = null) {
  if (!playlists.length) {
    playlistSelect.hidden = true;
    playlistSelect.innerHTML = "";
    playlistSelect.disabled = true;
    return;
  }
  playlistSelect.hidden = false;
  playlistSelect.disabled = false;

  const sorted = [...playlists].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  const want =
    (preferredId && sorted.find((x) => x.id === preferredId)?.id) ||
    (currentPlaylistId && sorted.find((x) => x.id === currentPlaylistId)?.id) ||
    (settingsCurrentPlaylistId && sorted.find((x) => x.id === settingsCurrentPlaylistId)?.id) ||
    sorted[0].id;

  playlistSelect.innerHTML = sorted
    .map((pl) => {
      const n = Array.isArray(pl.items) ? pl.items.length : 0;
      const name = escapeHtml(String(pl.name || "Untitled").trim()) || "Untitled";
      return `<option value="${escapeHtml(String(pl.id))}"${pl.id === want ? " selected" : ""}>${name} · ${n}</option>`;
    })
    .join("");
}

playlistSelect.addEventListener("change", () => {
  const id = playlistSelect.value;
  if (id) void loadPlaylistIntoView(id);
});

/* ---------------- Playlist view ---------------- */

async function loadPlaylistIntoView(id, { updateSelect = true } = {}) {
  currentPlaylistId = id;
  const pl = findPlaylist(id);
  if (!pl) {
    renderEmpty("Playlist not found.");
    return;
  }
  if (updateSelect && playlistSelect.value !== id) playlistSelect.value = id;
  playlistName.textContent = String(pl.name || "Playlist");
  renderVideos(pl);
}

function renderEmpty(message) {
  videoList.hidden = true;
  videoList.innerHTML = "";
  emptyState.hidden = false;
  emptyState.textContent = message || "Pick a playlist above, or import this window's tabs.";
}

function renderVideos(pl) {
  const snaps = Array.isArray(pl.items) ? pl.items : [];
  if (!snaps.length) {
    renderEmpty("This playlist has no videos.");
    return;
  }

  const shown = snaps.slice(0, RENDER_CAP);
  const overflow = snaps.length - shown.length;

  const rows = shown.map((snap) => {
    const vid = String(snap.videoId || "").trim();
    const lib = vid ? libraryByVideoId.get(vid) : null;
    const itemId = lib?.id || "";
    const category = String(lib?.category || "watch_later");
    const url = escapeHtml(String(snap.url || ""));
    const title = escapeHtml(String(snap.title || "YouTube video")) || "YouTube video";
    const channel = escapeHtml(String(snap.channel || ""));
    const thumb = escapeHtml(String(snap.thumbnail || ""));
    const options = categoryIds
      .map(
        (c) =>
          `<option value="${escapeHtml(String(c))}"${c === category ? " selected" : ""}>${
            escapeHtml(CATEGORY_LABELS[c] || c)
          }</option>`
      )
      .join("");

    return `
      <li class="vrow" data-videoid="${escapeHtml(vid)}" data-itemid="${escapeHtml(itemId)}">
        <img class="vrow-thumb" src="${thumb}" alt="" loading="lazy" />
        <div class="vrow-meta">
          <a class="vrow-title" href="${url}" target="_blank" rel="noopener noreferrer" title="${title}">${title}</a>
          ${channel ? `<span class="vrow-channel">${channel}</span>` : ""}
          <div class="vrow-controls">
            <select class="vrow-cat" ${itemId ? "" : "disabled"} title="Category">${options}</select>
            <button type="button" class="vrow-remove" title="Remove from this playlist" aria-label="Remove from this playlist">✕</button>
          </div>
        </div>
      </li>`;
  });

  if (overflow > 0) {
    rows.push(`<li class="vrow-more">+${overflow} more — open the full dashboard to see all.</li>`);
  }

  videoList.innerHTML = rows.join("");
  videoList.hidden = false;
  emptyState.hidden = true;
}

/* ---------------- Inline editing (delegated) ---------------- */

videoList.addEventListener("change", (e) => {
  const sel = e.target.closest(".vrow-cat");
  if (!sel) return;
  const li = sel.closest(".vrow");
  if (!li) return;
  void onCategoryChange(li.dataset.videoid, li.dataset.itemid, sel.value);
});

videoList.addEventListener("click", (e) => {
  const rm = e.target.closest(".vrow-remove");
  if (!rm) return; // title is an <a target=_blank>; default opens it
  const li = rm.closest(".vrow");
  if (li) void onRemoveFromPlaylist(li.dataset.videoid);
});

async function onCategoryChange(videoId, itemId, value) {
  if (!itemId) {
    status.textContent = "No library row to update for this video.";
    return;
  }
  const r = await send("TUBESTACK_UPDATE_ITEM", { id: itemId, category: value });
  if (r?.ok) {
    const lib = libraryByVideoId.get(String(videoId || "").trim());
    if (lib) lib.category = value;
    status.textContent = `Category → ${CATEGORY_LABELS[value] || value}.`;
  } else {
    status.textContent = r?.error || "Could not update category.";
  }
}

async function onRemoveFromPlaylist(videoId) {
  if (!currentPlaylistId) return;
  const vid = String(videoId || "").trim();
  if (!vid) return;
  const r = await send("TUBESTACK_REMOVE_LOCAL_PLAYLIST_ITEMS", {
    playlistId: currentPlaylistId,
    videoIds: [vid],
  });
  if (!r?.ok) {
    status.textContent = r?.error || "Could not remove video.";
    return;
  }
  await loadState();
  refreshPlaylistOptions(currentPlaylistId);
  await loadPlaylistIntoView(currentPlaylistId);
  status.textContent = "Removed from playlist.";
}

/* ---------------- Import current window's tabs ---------------- */

async function refreshCount() {
  const r = await send("TUBESTACK_GET_SAVE_TAB_COUNTS");
  if (!r?.ok) {
    countLine.textContent =
      r?.error === "No active tab." ? "Open this from a window with tabs." : "Could not read tabs.";
    btnImportTabs.disabled = true;
    return;
  }
  const n = r.all;
  if (n) {
    countLine.textContent = `${n} YouTube tab${n === 1 ? "" : "s"} here · import saves & closes them.`;
  } else {
    countLine.textContent = "No YouTube tabs in this window.";
  }
  btnImportTabs.disabled = n === 0;
}

btnImportTabs.addEventListener("click", async () => {
  btnImportTabs.disabled = true;
  status.textContent = "Importing…";
  const r = await send("TUBESTACK_SAVE_YT_TABS", { mode: "all" });
  if (!r?.ok || !r.savedCount) {
    status.textContent = !r?.ok ? r?.error || "Something went wrong." : "No YouTube tabs to import.";
    await refreshCount();
    return;
  }
  const savePl = await send("TUBESTACK_LOCAL_PLAYLIST_SAVE", {
    name: "",
    items: r.saved,
    playlistSource: "session",
  });
  if (!savePl?.ok) {
    status.textContent = savePl?.error || "Saved tabs, but playlist creation failed.";
    await refreshCount();
    return;
  }
  const playlistId = savePl.playlistId || savePl.playlists?.[0]?.id;
  const created =
    (Array.isArray(savePl.playlists) && savePl.playlists.find((p) => p.id === playlistId)?.name) ||
    "a new playlist";
  status.textContent = `Imported ${r.savedCount} tab${r.savedCount === 1 ? "" : "s"} into "${created}".`;

  await loadState();
  refreshPlaylistOptions(playlistId);
  await loadPlaylistIntoView(playlistId);
  await refreshCount();
});

/* ---------------- Footer ---------------- */

btnFull.addEventListener("click", () => openExtensionInNewTab(dashboardPlaylistPath(currentPlaylistId)));

btnPopup.addEventListener("click", async () => {
  btnPopup.disabled = true;
  const r = await send("TUBESTACK_SET_QUICK_SIDEBAR_MODE", { enabled: false });
  btnPopup.disabled = false;
  status.textContent = r?.ok
    ? "Switched to popup mode. Click the toolbar icon to open the popup."
    : "Could not switch modes — try again.";
});

/* ---------------- Theme + live updates ---------------- */

async function initSidebarTheme() {
  const data = await chrome.storage.local.get("settings");
  globalThis.TUBESTACK_UI_THEMES?.applyUiTheme(data.settings?.uiThemePreset);
  globalThis.TUBESTACK_UI_THEMES?.bindUiThemeStorageSync();
}

function bindStorageSync() {
  if (!chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.localPlaylists || changes.items) void onLibraryChanged();
  });
}

async function onLibraryChanged() {
  const previousId = currentPlaylistId;
  await loadState();
  refreshPlaylistOptions(previousId);
  if (previousId && findPlaylist(previousId)) {
    await loadPlaylistIntoView(previousId);
  }
}

/* ---------------- Init ---------------- */

async function init() {
  await loadState();
  refreshPlaylistOptions();
  // Show the most recent (or last-used) playlist immediately so the list is visible on open.
  const initialId =
    currentPlaylistId ||
    (settingsCurrentPlaylistId && findPlaylist(settingsCurrentPlaylistId)?.id) ||
    (playlists.length
      ? [...playlists].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0].id
      : null);
  if (initialId) {
    await loadPlaylistIntoView(initialId);
  } else {
    renderEmpty();
  }
  refreshCount();
}

void initSidebarTheme();
bindStorageSync();
void init();
