/**
 * TubeStack side panel — compact queue view.
 */

const playlistSelect = document.getElementById("playlistSelect");
const playlistName = document.getElementById("playlistName");
const countLine = document.getElementById("countLine");
const tabBadge = document.getElementById("tabBadge");
const btnAddTabs = document.getElementById("btnAddTabs");
const btnNewQueue = document.getElementById("btnNewQueue");
const videoList = document.getElementById("videoList");
const emptyState = document.getElementById("emptyState");
const status = document.getElementById("status");
const btnFull = document.getElementById("btnFull");
const playbackBar = document.getElementById("playbackBar");
const btnPlayAll = document.getElementById("btnPlayAll");
const btnShuffle = document.getElementById("btnShuffle");

const RENDER_CAP = 200;

let playlists = [];
let libraryByVideoId = new Map();
let currentPlaylistId = null;
let settingsCurrentPlaylistId = null;
let tabCount = 0;
let reorderDragId = null;
let playbackSession = null;

function isActivePlaybackForQueue() {
  return Boolean(
    playbackSession &&
      playbackSession.playlistId === currentPlaylistId &&
      playbackSession.status === "playing"
  );
}

function rowPlaybackState(videoId) {
  const vid = String(videoId || "").trim();
  if (!playbackSession || playbackSession.playlistId !== currentPlaylistId) {
    return { playing: false, done: false };
  }
  const done = (playbackSession.completedVideoIds || []).includes(vid);
  const playing =
    playbackSession.status === "playing" && playbackSession.currentVideoId === vid;
  return { playing, done };
}

async function loadPlaybackSession() {
  const r = await send("TUBESTACK_SIDEBAR_PLAYLIST_GET");
  playbackSession = r?.session || null;
}

function updatePlaybackStatus() {
  if (!playbackSession || playbackSession.playlistId !== currentPlaylistId) return;
  const total = playbackSession.queueVideoIds?.length || 0;
  if (playbackSession.status === "playing" && playbackSession.currentVideoId) {
    const idx = (playbackSession.queueVideoIds || []).indexOf(playbackSession.currentVideoId);
    const pos = idx >= 0 ? idx + 1 : "?";
    status.textContent = `Playing ${pos} of ${total}…`;
  } else if (playbackSession.status === "complete") {
    status.textContent = `Finished all ${total} video${total === 1 ? "" : "s"}.`;
  }
}

function syncPlaybackControls(pl) {
  const hasItems = Boolean(pl?.items?.length);
  const playing = isActivePlaybackForQueue();
  playbackBar.hidden = !hasItems;
  btnPlayAll.disabled = !hasItems;
  btnShuffle.disabled = !hasItems;
  btnPlayAll.classList.toggle("icon-btn--active", playing);
  btnPlayAll.title = playing ? "Restart queue from the beginning" : "Play queue in order";
  btnPlayAll.setAttribute(
    "aria-label",
    playing ? "Restart queue from the beginning" : "Play queue in order"
  );
}

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

function getPlaylistVideoIds(pl) {
  return (Array.isArray(pl?.items) ? pl.items : [])
    .map((snap) => String(snap?.videoId || "").trim())
    .filter(Boolean);
}

async function persistPlaylistOrder(videoIds) {
  if (!currentPlaylistId) return false;
  const r = await send("TUBESTACK_REORDER_LOCAL_PLAYLIST_ITEMS", {
    playlistId: currentPlaylistId,
    videoIds,
  });
  if (!r?.ok) {
    status.textContent = r?.error || "Could not reorder queue.";
    return false;
  }
  playlists = Array.isArray(r.playlists) ? r.playlists : playlists;
  return true;
}

async function applyRowReorder(dragId, targetId) {
  const pl = findPlaylist(currentPlaylistId);
  if (!pl) return;
  const ids = getPlaylistVideoIds(pl);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return;
  ids.splice(from, 1);
  ids.splice(to, 0, dragId);
  if (!(await persistPlaylistOrder(ids))) return;
  await loadState();
  await loadPlaylistIntoView(currentPlaylistId);
  status.textContent = "Queue order updated.";
}

async function loadState() {
  const [state, itemsRes] = await Promise.all([
    send("TUBESTACK_GET_STATE"),
    send("TUBESTACK_GET_ITEMS"),
  ]);
  playlists = Array.isArray(state?.localPlaylists) ? state.localPlaylists : [];
  settingsCurrentPlaylistId = String(state?.settings?.currentPlaylistId || "").trim() || null;

  const items = Array.isArray(itemsRes?.items) ? itemsRes.items : [];
  libraryByVideoId = new Map();
  for (const it of items) {
    const vid = String(it.videoId || "").trim();
    if (vid && !libraryByVideoId.has(vid)) libraryByVideoId.set(vid, it);
  }
}

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
      return `<option value="${escapeHtml(String(pl.id))}"${pl.id === want ? " selected" : ""}>${name} (${n})</option>`;
    })
    .join("");
}

async function persistQueueSelection(id) {
  const pl = findPlaylist(id);
  if (!pl) return;
  await send("TUBESTACK_PATCH_SETTINGS", {
    patch: {
      currentPlaylistId: pl.id,
      currentPlaylistName: pl.name,
    },
  });
}

playlistSelect.addEventListener("change", () => {
  const id = playlistSelect.value;
  if (id) void loadPlaylistIntoView(id, { persist: true });
});

async function loadPlaylistIntoView(id, { updateSelect = true, persist = false } = {}) {
  currentPlaylistId = id;
  const pl = findPlaylist(id);
  if (!pl) {
    renderEmpty("Queue not found.");
    playlistName.hidden = true;
    syncPlaybackControls(null);
    return;
  }
  if (updateSelect && playlistSelect.value !== id) playlistSelect.value = id;
  playlistName.textContent = `${pl.items?.length || 0} videos`;
  playlistName.hidden = false;
  renderVideos(pl);
  if (persist) await persistQueueSelection(id);
}

function renderEmpty(message) {
  videoList.hidden = true;
  videoList.innerHTML = "";
  emptyState.hidden = false;
  emptyState.textContent = message || "Select a queue or add tabs to get started.";
  syncPlaybackControls(null);
}

function renderVideos(pl) {
  const snaps = Array.isArray(pl.items) ? pl.items : [];
  if (!snaps.length) {
    renderEmpty("This queue is empty — add window tabs above.");
    playlistName.textContent = "0 videos";
    return;
  }

  syncPlaybackControls(pl);

  const shown = snaps.slice(0, RENDER_CAP);
  const overflow = snaps.length - shown.length;

  const rows = shown.map((snap) => {
    const url = escapeHtml(String(snap.url || ""));
    const title = escapeHtml(String(snap.title || "YouTube video")) || "YouTube video";
    const channel = escapeHtml(String(snap.channel || ""));
    const thumb = escapeHtml(String(snap.thumbnail || ""));
    const vid = String(snap.videoId || "").trim();
    const vidAttr = escapeHtml(vid);
    const { playing, done } = rowPlaybackState(vid);
    const rowClass = ["vrow", playing ? "vrow--now" : "", done ? "vrow--done" : ""]
      .filter(Boolean)
      .join(" ");

    return `
      <li class="${rowClass}" data-videoid="${vidAttr}" draggable="false">
        <button type="button" class="vrow-drag" draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</button>
        <img class="vrow-thumb" src="${thumb}" alt="" loading="lazy" />
        <div class="vrow-meta">
          <a class="vrow-title" href="${url}" target="_blank" rel="noopener noreferrer" title="${title}">${title}</a>
          ${channel ? `<span class="vrow-channel">${channel}</span>` : ""}
          ${playing ? `<span class="vrow-now-label">Now playing</span>` : ""}
        </div>
        <button type="button" class="vrow-remove" title="Remove from queue" aria-label="Remove from queue">×</button>
      </li>`;
  });

  if (overflow > 0) {
    rows.push(`<li class="vrow-more">+${overflow} more in full dashboard</li>`);
  }

  videoList.innerHTML = rows.join("");
  videoList.hidden = false;
  emptyState.hidden = true;
  playlistName.textContent = `${snaps.length} video${snaps.length === 1 ? "" : "s"}`;
  wireVideoRowDrag();
  updatePlaybackStatus();
}

videoList.addEventListener("click", (e) => {
  const rm = e.target.closest(".vrow-remove");
  if (!rm) return;
  const li = rm.closest(".vrow");
  if (li) void onRemoveFromPlaylist(li.dataset.videoid);
});

function wireVideoRowDrag() {
  videoList.querySelectorAll(".vrow").forEach((row) => {
    const handle = row.querySelector(".vrow-drag");
    if (!handle || row.dataset.dragBound === "1") return;
    row.dataset.dragBound = "1";
    const vid = row.dataset.videoid;

    handle.addEventListener("dragstart", (e) => {
      reorderDragId = vid;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", vid);
      row.classList.add("vrow--dragging");
    });

    handle.addEventListener("dragend", () => {
      reorderDragId = null;
      row.classList.remove("vrow--dragging", "vrow--over");
      videoList.querySelectorAll(".vrow--over").forEach((el) => el.classList.remove("vrow--over"));
    });

    row.addEventListener("dragover", (e) => {
      if (!reorderDragId || reorderDragId === vid) return;
      e.preventDefault();
      row.classList.add("vrow--over");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("vrow--over");
    });

    row.addEventListener("drop", async (e) => {
      if (!reorderDragId || reorderDragId === vid) return;
      e.preventDefault();
      row.classList.remove("vrow--over");
      const dragId = reorderDragId;
      reorderDragId = null;
      await applyRowReorder(dragId, vid);
    });
  });
}

async function playQueue({ shuffle }) {
  if (!currentPlaylistId) return;
  const pl = findPlaylist(currentPlaylistId);
  const n = pl?.items?.length || 0;
  if (!n) {
    status.textContent = "Queue is empty.";
    return;
  }

  btnPlayAll.disabled = true;
  btnShuffle.disabled = true;
  status.textContent = shuffle ? "Shuffling queue…" : "Starting playback…";

  const r = await send("TUBESTACK_SIDEBAR_PLAYLIST_START", {
    playlistId: currentPlaylistId,
    shuffle,
  });

  if (r?.playlists) playlists = r.playlists;
  playbackSession = r?.session || null;

  if (!r?.ok) {
    status.textContent = r?.message || r?.error || "Could not start playback.";
    syncPlaybackControls(pl);
    return;
  }

  if (shuffle) {
    refreshPlaylistOptions(currentPlaylistId);
    await loadPlaylistIntoView(currentPlaylistId);
  } else {
    renderVideos(findPlaylist(currentPlaylistId) || pl);
  }

  syncPlaybackControls(pl);
  updatePlaybackStatus();
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
  status.textContent = "Removed from queue.";
}

async function refreshCount() {
  const r = await send("TUBESTACK_GET_SAVE_TAB_COUNTS");
  if (!r?.ok) {
    tabCount = 0;
    tabBadge.hidden = true;
    countLine.textContent =
      r?.error === "No active tab." ? "Open from a window with YouTube tabs." : "Could not read tabs.";
    btnAddTabs.disabled = true;
    btnNewQueue.disabled = true;
    return;
  }
  tabCount = r.all || 0;
  if (tabCount) {
    tabBadge.textContent = String(tabCount);
    tabBadge.hidden = false;
    countLine.textContent = `${tabCount} YouTube tab${tabCount === 1 ? "" : "s"} in this window · saved tabs close.`;
  } else {
    tabBadge.hidden = true;
    countLine.textContent = "No YouTube tabs in this window.";
  }
  const canAdd = tabCount > 0;
  btnAddTabs.disabled = !canAdd;
  btnNewQueue.disabled = !canAdd;
}

async function saveWindowTabs({ createNew }) {
  btnAddTabs.disabled = true;
  btnNewQueue.disabled = true;
  status.textContent = "Saving tabs…";

  const r = await send("TUBESTACK_SAVE_YT_TABS", { mode: "all" });
  if (!r?.ok || !r.savedCount) {
    status.textContent = !r?.ok ? r?.error || "Something went wrong." : "No YouTube tabs to save.";
    await refreshCount();
    return;
  }

  let playlistId = currentPlaylistId;
  let addRes;

  if (createNew || !playlistId || !findPlaylist(playlistId)) {
    addRes = await send("TUBESTACK_LOCAL_PLAYLIST_ADD_ITEMS", {
      items: r.saved,
      createNew: true,
    });
    playlistId = addRes?.playlistId || addRes?.playlists?.[0]?.id;
  } else {
    addRes = await send("TUBESTACK_LOCAL_PLAYLIST_ADD_ITEMS", {
      playlistId,
      items: r.saved,
      createNew: false,
    });
  }

  if (!addRes?.ok) {
    status.textContent = addRes?.error || "Saved tabs, but queue update failed.";
    await refreshCount();
    return;
  }

  const pl = findPlaylist(playlistId) || addRes.playlists?.find((p) => p.id === playlistId);
  const name = pl?.name || "queue";
  const added = addRes.addedCount ?? r.savedCount;

  if (createNew) {
    status.textContent = `Created "${name}" with ${r.savedCount} tab${r.savedCount === 1 ? "" : "s"}.`;
  } else if (added < r.savedCount) {
    status.textContent = `Added ${added} to "${name}" (${r.savedCount - added} already in queue).`;
  } else {
    status.textContent = `Added ${added} tab${added === 1 ? "" : "s"} to "${name}".`;
  }

  await loadState();
  refreshPlaylistOptions(playlistId);
  await loadPlaylistIntoView(playlistId, { persist: true });
  await refreshCount();
}

btnAddTabs.addEventListener("click", () => saveWindowTabs({ createNew: false }));
btnNewQueue.addEventListener("click", () => saveWindowTabs({ createNew: true }));
btnPlayAll.addEventListener("click", () => playQueue({ shuffle: false }));
btnShuffle.addEventListener("click", () => playQueue({ shuffle: true }));

btnFull.addEventListener("click", () => openExtensionInNewTab(dashboardPlaylistPath(currentPlaylistId)));

async function initSidebarTheme() {
  const data = await chrome.storage.local.get("settings");
  globalThis.TUBESTACK_UI_THEMES?.applyUiTheme(data.settings?.uiThemePreset);
  globalThis.TUBESTACK_UI_THEMES?.bindUiThemeStorageSync();
}

function bindStorageSync() {
  if (!chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.sidebarPlayback) {
      playbackSession = changes.sidebarPlayback.newValue || null;
      const pl = currentPlaylistId ? findPlaylist(currentPlaylistId) : null;
      if (pl) {
        renderVideos(pl);
      } else {
        updatePlaybackStatus();
        syncPlaybackControls(pl);
      }
    }
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

async function init() {
  await loadState();
  await loadPlaybackSession();
  refreshPlaylistOptions();
  const initialId =
    currentPlaylistId ||
    (settingsCurrentPlaylistId && findPlaylist(settingsCurrentPlaylistId)?.id) ||
    (playlists.length
      ? [...playlists].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0].id
      : null);
  if (initialId) {
    await loadPlaylistIntoView(initialId);
  } else {
    playlistName.hidden = true;
    renderEmpty();
    playbackBar.hidden = true;
  }
  await refreshCount();
}

void initSidebarTheme();
bindStorageSync();
void init();
