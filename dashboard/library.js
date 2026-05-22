const LIST_LABELS = {
  watch_later: "Watch later",
  long_play: "Long play",
  shorts: "Shorts",
  documentary: "Documentary",
  music: "Music",
  custom: "Custom",
};

let allItems = [];
let selectedArtist = "";
let selectedAlbum = "";
let selectedCategory = "";
let artistSortOrder = "asc";
let albumSortOrder = "asc";
let categorySortOrder = "asc";
let libSearchQuery = "";
let libViewMode = "details";
let libQuickSort = "saved_desc";
let libListFilter = "";
let libPriorityFilter = "";
let libWatchStateFilter = "";
const TS_WATCH = globalThis.TUBESTACK_WATCH;
let localPlaylists = [];
let libSettings = {};
/** "recent" = tab/session saves only; "complete" = entire saved library including YouTube imports */
let libLibraryScope = "recent";
/** When set, library + browse columns only show videos in this local playlist snapshot. */
let libActivePlaylistId = null;

/** Which library video row shows inline category / album / delete (one at a time). */
let libVideoActionsId = "";

/** Checked video ids for bulk delete / move / new playlist (scoped to current filtered list). */
const libCheckedIds = new Set();

const LIB_SORT_VIEW_TOOLBAR_KEY = "ts_library_sort_view_toolbar_open";
const LIB_FILTER_SESSION = "__import_session__";
const LIB_FILTER_YT_IMPORT = "__import_youtube__";

/** expanded | compact | collapsed */
const LIB_BROWSE_PANEL_STATE_KEY = "ts_library_browse_panel_state";
const LIB_LIBRARY_SCOPE_KEY = "ts_library_scope";

function getLibBrowsePanelState() {
  const v = localStorage.getItem(LIB_BROWSE_PANEL_STATE_KEY);
  if (v === "compact" || v === "collapsed" || v === "expanded") return v;
  return "compact";
}

function setLibBrowsePanelState(state) {
  const allowed = ["expanded", "compact", "collapsed"];
  const next = allowed.includes(state) ? state : "expanded";
  localStorage.setItem(LIB_BROWSE_PANEL_STATE_KEY, next);
  applyLibBrowsePanelUi();
}

function applyLibBrowsePanelUi() {
  const panel = document.getElementById("libBrowsePanel");
  const collapseBtn = document.getElementById("libBrowseCollapseToggle");
  const sizeBtn = document.getElementById("libBrowseSizeBtn");
  const showMoreBtn = document.getElementById("libBrowseShowMoreBtn");
  if (!panel) return;
  const state = getLibBrowsePanelState();
  panel.classList.toggle("library-browse-panel--collapsed", state === "collapsed");
  panel.classList.toggle("library-browse-panel--compact", state === "compact");
  collapseBtn?.setAttribute("aria-expanded", state === "collapsed" ? "false" : "true");
  if (sizeBtn) {
    sizeBtn.textContent = state === "compact" ? "Show more" : "Show less";
    sizeBtn.hidden = state === "collapsed";
  }
  if (showMoreBtn) showMoreBtn.hidden = state !== "collapsed";
}

function toggleLibBrowsePanelCollapsed() {
  const cur = getLibBrowsePanelState();
  if (cur === "collapsed") {
    const prev = localStorage.getItem(`${LIB_BROWSE_PANEL_STATE_KEY}_prev`);
    setLibBrowsePanelState(prev === "compact" ? "compact" : "expanded");
    return;
  }
  localStorage.setItem(`${LIB_BROWSE_PANEL_STATE_KEY}_prev`, cur);
  setLibBrowsePanelState("collapsed");
}

function toggleLibBrowsePanelSize() {
  const cur = getLibBrowsePanelState();
  if (cur === "collapsed") {
    setLibBrowsePanelState("expanded");
    return;
  }
  setLibBrowsePanelState(cur === "compact" ? "expanded" : "compact");
}

function send(type, payload = {}) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve));
}

function deriveAlbum(item) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const explicit = tags.find((t) => /^album\s*:/i.test(String(t)));
  if (explicit) return String(explicit).replace(/^album\s*:/i, "").trim() || "Unassigned";
  if (item.libraryAlbum) return String(item.libraryAlbum).trim();
  if (tags.length) return String(tags[0]).trim();
  return "Unassigned";
}

function getDuration(it) {
  return it.durationSec == null ? null : Number(it.durationSec);
}

function formatDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase();
}

function libItemWatchState(it) {
  return TS_WATCH ? TS_WATCH.normalizeWatchStateId(it?.watchState) : "queue";
}

function libItemNote(it) {
  return TS_WATCH ? TS_WATCH.itemNoteText(it) : String(it?.notes || "").trim();
}

function fillLibWatchStateFilterOptions() {
  const targets = [document.getElementById("libWatchStateFilter"), document.getElementById("libBulkWatchState")].filter(
    Boolean
  );
  if (!TS_WATCH || !targets.length) return;
  const filterOpts =
    '<option value="">All Watch States</option>' +
    TS_WATCH.WATCH_STATE_LIST.map((x) => `<option value="${x.id}">${x.label}</option>`).join("");
  const bulkOpts =
    '<option value="">Set Watch State…</option>' +
    TS_WATCH.WATCH_STATE_LIST.map((x) => `<option value="${x.id}">${x.label}</option>`).join("");
  for (const sel of targets) {
    const cur = sel.value;
    sel.innerHTML = sel.id === "libBulkWatchState" ? bulkOpts : filterOpts;
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
}

function matchesLibrarySearch(item, q) {
  if (!q) return true;
  const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
  const tsNotes = (item.timestampNotes || []).map((x) => `${x.label || ""} ${x.note || ""}`).join(" ");
  const hay = [
    item.title,
    item.channel,
    deriveAlbum(item),
    LIST_LABELS[item.category] || "Unassigned",
    TS_WATCH ? TS_WATCH.watchStateLabel(libItemWatchState(item)) : "",
    item.playlistTitle,
    item.playlistName,
    item.topic,
    tags,
    libItemNote(item),
    tsNotes,
  ]
    .map((x) => normalizeText(x))
    .join(" ");
  return hay.includes(q);
}

function itemMatchesLibraryScope(it) {
  if (libLibraryScope === "complete") return true;
  return it.libraryImportSource !== "youtube_playlist";
}

function syncLibScopeButtons() {
  const recentBtn = document.getElementById("libScopeRecent");
  const completeBtn = document.getElementById("libScopeComplete");
  const isComplete = libLibraryScope === "complete";
  recentBtn?.classList.toggle("active", !isComplete);
  completeBtn?.classList.toggle("active", isComplete);
  recentBtn?.setAttribute("aria-pressed", isComplete ? "false" : "true");
  completeBtn?.setAttribute("aria-pressed", isComplete ? "true" : "false");
}

function setLibLibraryScope(scope) {
  const next = scope === "complete" ? "complete" : "recent";
  if (libLibraryScope === next) return;
  libLibraryScope = next;
  localStorage.setItem(LIB_LIBRARY_SCOPE_KEY, libLibraryScope);
  if (libLibraryScope === "recent" && libActivePlaylistId) {
    const pl = localPlaylists.find((p) => p.id === libActivePlaylistId);
    if (pl?.playlistSource === "youtube_import") libActivePlaylistId = null;
  }
  selectedArtist = "";
  selectedAlbum = "";
  selectedCategory = "";
  syncLibScopeButtons();
  renderSessionSelect();
  renderAll();
}

function watchUrlForItem(it) {
  const u = String(it.url || "").trim();
  if (u) return u;
  const vid = String(it.videoId || "").trim();
  if (vid && /^[\w-]{11}$/.test(vid)) return `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`;
  return "";
}

function distinctAlbumValuesForPicker() {
  const s = new Set();
  for (const x of getLibraryViewItems()) {
    const a = deriveAlbum(x);
    if (a && a !== "Unassigned") s.add(a);
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

function toggleLibraryVideoActions(id) {
  libVideoActionsId = libVideoActionsId === id ? "" : id;
  renderVideos();
}

async function applyLibraryItemUpdate(it, patch) {
  const r = await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, ...patch } });
  if (!r?.ok) {
    alert(r?.error || r?.message || "Could not save changes.");
    return;
  }
  if (r.item) {
    const idx = allItems.findIndex((x) => x.id === it.id);
    if (idx >= 0) allItems[idx] = r.item;
  }
  renderAll();
}

async function deleteLibraryItem(it) {
  const title = (it.title || "Untitled").slice(0, 120);
  if (
    !confirm(
      `Remove this video from your library?\n\n“${title}”\n\nThis cannot be undone.`
    )
  ) {
    return;
  }
  const r = await send("TUBESTACK_DELETE_ITEMS", { ids: [it.id] });
  if (!r?.ok) {
    alert(r?.error || r?.message || "Could not remove video.");
    return;
  }
  allItems = allItems.filter((x) => x.id !== it.id);
  if (libVideoActionsId === it.id) libVideoActionsId = "";
  libCheckedIds.delete(it.id);
  renderAll();
}

function libraryHasFacetFilter() {
  return Boolean(selectedArtist || selectedAlbum || selectedCategory);
}

function facetTitleLine() {
  const parts = [];
  if (selectedArtist) parts.push(`Creator · ${selectedArtist}`);
  if (selectedAlbum) parts.push(`Album · ${selectedAlbum}`);
  if (selectedCategory) parts.push(`Category · ${selectedCategory}`);
  return parts.join("  ·  ");
}

function computeDisplayedVideoList() {
  let list = getLibraryViewItems();
  if (selectedArtist) list = list.filter((it) => (it.channel || "Unknown creator") === selectedArtist);
  if (selectedAlbum) list = list.filter((it) => deriveAlbum(it) === selectedAlbum);
  if (selectedCategory) list = list.filter((it) => (LIST_LABELS[it.category] || "Unassigned") === selectedCategory);
  if (libListFilter === LIB_FILTER_SESSION) {
    list = list.filter((it) => it.libraryImportSource !== "youtube_playlist");
  } else if (libListFilter === LIB_FILTER_YT_IMPORT) {
    list = list.filter((it) => it.libraryImportSource === "youtube_playlist");
  } else if (libListFilter) {
    list = list.filter((it) => (it.category || "") === libListFilter);
  }
  if (libPriorityFilter) list = list.filter((it) => (it.priority || "") === libPriorityFilter);
  if (libWatchStateFilter) list = list.filter((it) => libItemWatchState(it) === libWatchStateFilter);
  if (libSearchQuery) list = list.filter((it) => matchesLibrarySearch(it, libSearchQuery));
  if (libQuickSort === "title_asc") {
    list.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  } else if (libQuickSort === "creator_asc") {
    list.sort((a, b) => String(a.channel || "").localeCompare(String(b.channel || "")));
  } else if (libQuickSort === "duration_desc") {
    list.sort((a, b) => (getDuration(b) || 0) - (getDuration(a) || 0));
  } else if (libQuickSort === "duration_asc") {
    list.sort((a, b) => (getDuration(a) || 0) - (getDuration(b) || 0));
  } else if (libQuickSort === "category_asc") {
    list.sort((a, b) =>
      (LIST_LABELS[a.category] || "Unassigned").localeCompare(LIST_LABELS[b.category] || "Unassigned")
    );
  } else {
    list.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
  }
  return list;
}

function libraryItemToPlaylistSnapshot(it) {
  const vid = String(it.videoId || "").trim();
  const url =
    String(it.url || "").trim() ||
    (vid && /^[\w-]{11}$/.test(vid) ? `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}` : "");
  const snap = {
    videoId: vid && /^[\w-]{11}$/.test(vid) ? vid : "",
    url,
    title: it.title || "Video",
    channel: it.channel || "",
    thumbnail:
      it.thumbnail || (vid && /^[\w-]{11}$/.test(vid) ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : ""),
  };
  if (it.durationSec != null && !Number.isNaN(Number(it.durationSec))) snap.durationSec = Number(it.durationSec);
  return snap;
}

function syncLibBulkUi(list) {
  const bar = document.getElementById("libBulkBar");
  const selAll = document.getElementById("libBulkSelectAll");
  const sum = document.getElementById("libBulkSummary");
  const plSel = document.getElementById("libBulkPlaylistSelect");
  if (!bar || !selAll || !sum || !plSel) return;
  const listIds = list.map((x) => x.id);
  const picked = listIds.filter((id) => libCheckedIds.has(id)).length;
  bar.classList.toggle("hidden", picked === 0);
  sum.textContent = picked ? `${picked} selected` : "";
  const allOn = list.length > 0 && picked === list.length;
  const someOn = picked > 0 && !allOn;
  selAll.checked = allOn;
  selAll.indeterminate = someOn;
  const currentPl = plSel.value;
  plSel.innerHTML = '<option value="">Move to…</option>';
  for (const pl of playlistsForLibraryScope()) {
    const o = document.createElement("option");
    o.value = pl.id;
    o.textContent = `${pl.name || "Untitled"} (${(pl.items || []).length})`;
    plSel.appendChild(o);
  }
  if (currentPl && [...plSel.options].some((o) => o.value === currentPl)) plSel.value = currentPl;
}

function applyLibSortViewToolbarUi() {
  const toolbar = document.getElementById("libVideosToolbar");
  const toggle = document.getElementById("libSortViewToggle");
  if (!toolbar || !toggle) return;
  const open = localStorage.getItem(LIB_SORT_VIEW_TOOLBAR_KEY) === "1";
  toolbar.classList.toggle("lib-videos-toolbar--collapsed", !open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleLibSortViewToolbar() {
  const toolbar = document.getElementById("libVideosToolbar");
  const toggle = document.getElementById("libSortViewToggle");
  if (!toolbar || !toggle) return;
  const open = toolbar.classList.contains("lib-videos-toolbar--collapsed");
  toolbar.classList.toggle("lib-videos-toolbar--collapsed", !open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  localStorage.setItem(LIB_SORT_VIEW_TOOLBAR_KEY, open ? "1" : "0");
}

function updateVideosHeader(list) {
  const defaultHead = document.getElementById("libDefaultVideoTitle");
  const facetHead = document.getElementById("libFacetVideoHead");
  const videosTitle = document.getElementById("videosTitle");
  const facetName = document.getElementById("libFacetName");
  const facetCount = document.getElementById("libFacetInlineCount");
  const facetDelete = document.getElementById("libFacetDeleteAll");
  const showFacet = libraryHasFacetFilter();
  if (defaultHead) defaultHead.classList.toggle("hidden", showFacet);
  if (facetHead) facetHead.classList.toggle("hidden", !showFacet);
  if (facetDelete) facetDelete.classList.toggle("hidden", !showFacet);
  if (showFacet && facetName && facetCount) {
    facetName.textContent = facetTitleLine();
    facetCount.textContent = ` · ${list.length} video${list.length === 1 ? "" : "s"}`;
  }
  if (videosTitle) {
    if (libActivePlaylistId) {
      const pl = localPlaylists.find((p) => p.id === libActivePlaylistId);
      const base = pl?.name || "Playlist";
      videosTitle.textContent = selectedArtist
        ? `${base} · ${selectedArtist} (${list.length})`
        : `${base} (${list.length})`;
    } else if (libLibraryScope === "complete") {
      videosTitle.textContent = selectedArtist
        ? `Complete library — ${selectedArtist} (${list.length})`
        : `Complete library (${list.length})`;
    } else {
      videosTitle.textContent = selectedArtist
        ? `Recent sessions — ${selectedArtist} (${list.length})`
        : `Recent sessions & saves (${list.length})`;
    }
  }
}

async function reloadLibraryFullState() {
  const r = await send("TUBESTACK_GET_STATE");
  if (r?.ok) {
    if (Array.isArray(r.items)) allItems = r.items;
    if (Array.isArray(r.localPlaylists)) localPlaylists = r.localPlaylists;
    if (r.settings && typeof r.settings === "object") libSettings = r.settings;
  }
  renderAll();
}

function getLibraryViewItems() {
  let items = allItems.filter((it) => itemMatchesLibraryScope(it));
  if (libActivePlaylistId) {
    const pl = localPlaylists.find((p) => p.id === libActivePlaylistId);
    const videoIds = new Set(
      (pl?.items || []).map((x) => String(x.videoId || "").trim()).filter((v) => /^[\w-]{11}$/.test(v))
    );
    if (videoIds.size) {
      items = items.filter((it) => videoIds.has(String(it.videoId || "").trim()));
    }
  }
  return items;
}

function currentSessionSelectValue() {
  if (libActivePlaylistId) return `pl:${libActivePlaylistId}`;
  return libLibraryScope === "complete" ? "all" : "recent";
}

function playlistsForLibraryScope() {
  const showImp = libSettings.libraryShowYoutubeImported !== false;
  if (libLibraryScope === "complete" && showImp) return [...localPlaylists];
  return localPlaylists.filter((p) => p.playlistSource !== "youtube_import");
}

function appendSessionPlaylistOptions(host, playlists) {
  for (const pl of playlists.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))) {
    const o = document.createElement("option");
    o.value = `pl:${pl.id}`;
    const n = (pl.items || []).length;
    const label = (pl.name || "Untitled").trim();
    o.textContent = `${label.length > 26 ? `${label.slice(0, 25)}…` : label} (${n})`;
    host.appendChild(o);
  }
}

function renderSessionSelect() {
  const sel = document.getElementById("libSessionSelect");
  const hint = document.getElementById("libBrowseOriginHint");
  if (!sel) return;
  const cur = currentSessionSelectValue();
  sel.innerHTML = "";

  const showImp = libSettings.libraryShowYoutubeImported !== false;
  const sessionPlaylists = localPlaylists.filter((p) => p.playlistSource !== "youtube_import");
  const importedPlaylists = showImp
    ? localPlaylists.filter((p) => p.playlistSource === "youtube_import")
    : [];

  if (libLibraryScope === "complete") {
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All library videos";
    sel.appendChild(allOpt);

    const ogSessions = document.createElement("optgroup");
    ogSessions.label = "Saved sessions";
    appendSessionPlaylistOptions(ogSessions, sessionPlaylists);
    if (ogSessions.children.length) sel.appendChild(ogSessions);

    if (importedPlaylists.length) {
      const ogImp = document.createElement("optgroup");
      ogImp.label = "Imported playlists";
      appendSessionPlaylistOptions(ogImp, importedPlaylists);
      sel.appendChild(ogImp);
    }
    hint?.classList.add("hidden");
  } else {
    const allRecent = document.createElement("option");
    allRecent.value = "recent";
    allRecent.textContent = "All recent saves";
    sel.appendChild(allRecent);

    const ogSessions = document.createElement("optgroup");
    ogSessions.label = "Saved sessions";
    appendSessionPlaylistOptions(ogSessions, sessionPlaylists);
    if (ogSessions.children.length) sel.appendChild(ogSessions);

    if (!showImp && hint) {
      hint.textContent =
        "YouTube-imported videos appear in Complete library. Turn on “Show imported back catalog” in Settings to list imported playlists.";
      hint.classList.remove("hidden");
    } else {
      hint?.classList.add("hidden");
    }
  }

  const allowed = new Set([...sel.options].map((o) => o.value));
  if (allowed.has(cur)) {
    sel.value = cur;
  } else {
    sel.value = libLibraryScope === "complete" ? "all" : "recent";
    libActivePlaylistId = null;
  }
}

function applySessionSelectValue(value) {
  if (value === "recent" || value === "all") {
    libActivePlaylistId = null;
  } else if (value.startsWith("pl:")) {
    const id = value.slice(3);
    const pl = localPlaylists.find((p) => p.id === id);
    if (pl?.playlistSource === "youtube_import" && libLibraryScope === "recent") {
      libActivePlaylistId = null;
    } else {
      libActivePlaylistId = id;
    }
  }
  selectedArtist = "";
  selectedAlbum = "";
  selectedCategory = "";
  renderAll();
}

function renderColumn(hostId, rows, selectedValue, onPick) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.className = "lib-item" + (!selectedValue ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => onPick(""));
  host.appendChild(allBtn);
  for (const row of rows) {
    const b = document.createElement("button");
    b.className = "lib-item" + (selectedValue === row.name ? " active" : "");
    b.innerHTML = `${row.name} <span class="lib-count">(${row.count})</span>`;
    b.addEventListener("click", () => onPick(row.name));
    host.appendChild(b);
  }
}

function renderVideos() {
  const host = document.getElementById("videosList");
  if (!host) return;
  const list = computeDisplayedVideoList();
  updateVideosHeader(list);

  const listIdSet = new Set(list.map((x) => x.id));
  for (const id of [...libCheckedIds]) {
    if (!listIdSet.has(id)) libCheckedIds.delete(id);
  }
  if (libVideoActionsId && !listIdSet.has(libVideoActionsId)) {
    libVideoActionsId = "";
  }

  host.innerHTML = "";
  host.classList.toggle("lib-view-list", libViewMode === "list");
  host.classList.toggle("lib-view-grid", libViewMode === "grid");
  const albumChoices = distinctAlbumValuesForPicker();

  for (const it of list) {
    const row = document.createElement("div");
    row.className = "video-row" + (libVideoActionsId === it.id ? " video-row--open" : "");
    row.dataset.id = it.id;
    row.setAttribute("aria-expanded", libVideoActionsId === it.id ? "true" : "false");

    const pick = document.createElement("label");
    pick.className = "video-pick";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = libCheckedIds.has(it.id);
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) libCheckedIds.add(it.id);
      else libCheckedIds.delete(it.id);
      syncLibBulkUi(computeDisplayedVideoList());
    });
    pick.appendChild(cb);

    const main = document.createElement("div");
    main.className = "video-row-main";

    const thumbHref = watchUrlForItem(it) || "#";
    const thumbLink = document.createElement("a");
    thumbLink.className = "video-thumb-link";
    thumbLink.href = thumbHref;
    if (thumbHref !== "#") {
      thumbLink.target = "_blank";
      thumbLink.rel = "noopener noreferrer";
    } else {
      thumbLink.addEventListener("click", (e) => e.preventDefault());
      thumbLink.setAttribute("aria-disabled", "true");
    }
    thumbLink.setAttribute("aria-label", `Open video: ${it.title || "Untitled"}`);
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = it.thumbnail || (it.videoId ? `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg` : "");
    thumbLink.appendChild(img);

    const stack = document.createElement("div");
    stack.className = "video-stack";

    const titleA = document.createElement("a");
    titleA.className = "video-title";
    titleA.href = thumbHref;
    if (thumbHref !== "#") {
      titleA.target = "_blank";
      titleA.rel = "noopener noreferrer";
    } else {
      titleA.addEventListener("click", (e) => e.preventDefault());
      titleA.setAttribute("aria-disabled", "true");
    }
    titleA.textContent = it.title || "Untitled";

    const meta = document.createElement("div");
    meta.className = "video-meta";
    meta.appendChild(
      document.createTextNode(`${it.channel || "Unknown creator"} · ${formatDuration(getDuration(it))}`)
    );
    if (TS_WATCH) {
      const wsLab = TS_WATCH.watchStateLabel(libItemWatchState(it));
      const badge = document.createElement("span");
      badge.className = `watch-state-badge watch-state-badge--${libItemWatchState(it)}`;
      badge.textContent = wsLab;
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(badge);
    }

    const actions = document.createElement("div");
    actions.className = "lib-video-actions";
    actions.hidden = libVideoActionsId !== it.id;

    const catWrap = document.createElement("label");
    catWrap.className = "lib-video-field";
    const catLab = document.createElement("span");
    catLab.className = "lib-video-field-label";
    catLab.textContent = "Category";
    const catSel = document.createElement("select");
    catSel.className = "lib-video-select";
    catSel.setAttribute("aria-label", "Category");
    const knownCat = it.category && LIST_LABELS[it.category];
    if (it.category && !knownCat) {
      const unk = document.createElement("option");
      unk.value = it.category;
      unk.textContent = String(it.category);
      unk.selected = true;
      catSel.appendChild(unk);
    }
    for (const [key, label] of Object.entries(LIST_LABELS)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = label;
      if (knownCat && key === it.category) opt.selected = true;
      catSel.appendChild(opt);
    }
    catSel.addEventListener("change", () => void applyLibraryItemUpdate(it, { category: catSel.value }));
    catWrap.appendChild(catLab);
    catWrap.appendChild(catSel);

    if (TS_WATCH) {
      const wsWrap = document.createElement("label");
      wsWrap.className = "lib-video-field";
      const wsLab = document.createElement("span");
      wsLab.className = "lib-video-field-label";
      wsLab.textContent = "Watch State";
      const wsSel = document.createElement("select");
      wsSel.className = "lib-video-select";
      wsSel.setAttribute("aria-label", "Watch State");
      for (const s of TS_WATCH.WATCH_STATE_LIST) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.label;
        if (libItemWatchState(it) === s.id) opt.selected = true;
        wsSel.appendChild(opt);
      }
      wsSel.addEventListener("change", () => void applyLibraryItemUpdate(it, { watchState: wsSel.value }));
      wsWrap.appendChild(wsLab);
      wsWrap.appendChild(wsSel);
      actions.appendChild(wsWrap);
    }

    const albWrap = document.createElement("label");
    albWrap.className = "lib-video-field";
    const albLab = document.createElement("span");
    albLab.className = "lib-video-field-label";
    albLab.textContent = "Album";
    const albSel = document.createElement("select");
    albSel.className = "lib-video-select";
    albSel.setAttribute("aria-label", "Album");
    const curAlbum = deriveAlbum(it);
    const albOptUn = document.createElement("option");
    albOptUn.value = "";
    albOptUn.textContent = "Unassigned";
    if (curAlbum === "Unassigned") albOptUn.selected = true;
    albSel.appendChild(albOptUn);
    const albumPickSet = new Set(albumChoices);
    if (curAlbum !== "Unassigned") albumPickSet.add(curAlbum);
    for (const name of [...albumPickSet].sort((a, b) => a.localeCompare(b))) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === curAlbum) opt.selected = true;
      albSel.appendChild(opt);
    }
    albSel.addEventListener("change", () =>
      void applyLibraryItemUpdate(it, { libraryAlbum: albSel.value ? albSel.value : "" })
    );
    albWrap.appendChild(albLab);
    albWrap.appendChild(albSel);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "lib-video-del";
    del.title = "Remove from library";
    del.setAttribute("aria-label", "Remove from library");
    del.textContent = "×";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      void deleteLibraryItem(it);
    });

    actions.appendChild(catWrap);
    actions.appendChild(albWrap);
    actions.appendChild(del);

    stack.appendChild(titleA);
    stack.appendChild(meta);
    stack.appendChild(actions);

    main.appendChild(thumbLink);
    main.appendChild(stack);

    row.addEventListener("click", (e) => {
      if (e.target.closest(".video-pick")) return;
      if (e.target.closest("a.video-thumb-link")) return;
      if (e.target.closest("a.video-title")) return;
      if (e.target.closest("select, button.lib-video-del")) return;
      toggleLibraryVideoActions(it.id);
    });

    row.appendChild(pick);
    row.appendChild(main);
    host.appendChild(row);
  }
  syncLibBulkUi(list);
}

function sortRowsAlpha(rows, order = "asc") {
  const mul = order === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => mul * a.name.localeCompare(b.name));
}

function renderAll() {
  const artistMap = new Map();
  const albumMap = new Map();
  const categoryMap = new Map();
  for (const it of getLibraryViewItems()) {
    const artist = it.channel || "Unknown creator";
    const album = deriveAlbum(it);
    const category = LIST_LABELS[it.category] || "Unassigned";
    artistMap.set(artist, (artistMap.get(artist) || 0) + 1);
    albumMap.set(album, (albumMap.get(album) || 0) + 1);
    categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
  }
  const toRows = (map) => [...map.entries()].map(([name, count]) => ({ name, count }));
  renderColumn("artistList", sortRowsAlpha(toRows(artistMap), artistSortOrder), selectedArtist, (v) => {
    selectedArtist = v;
    renderAll();
  });
  renderColumn("albumList", sortRowsAlpha(toRows(albumMap), albumSortOrder), selectedAlbum, (v) => {
    selectedAlbum = v;
    renderAll();
  });
  renderColumn("categoryList", sortRowsAlpha(toRows(categoryMap), categorySortOrder), selectedCategory, (v) => {
    selectedCategory = v;
    renderAll();
  });
  renderVideos();
}

function renderListFilterOptions() {
  const sel = document.getElementById("libListFilter");
  if (!sel) return;
  const current = libListFilter;
  sel.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "All lists";
  sel.appendChild(allOpt);

  const ogSession = document.createElement("optgroup");
  ogSession.label = "Saved sessions";
  const sessOpt = document.createElement("option");
  sessOpt.value = LIB_FILTER_SESSION;
  sessOpt.textContent = "Recent tab saves";
  ogSession.appendChild(sessOpt);
  sel.appendChild(ogSession);

  const ogWatch = document.createElement("optgroup");
  ogWatch.label = "Watch list";
  for (const [key, label] of Object.entries(LIST_LABELS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    ogWatch.appendChild(opt);
  }
  sel.appendChild(ogWatch);

  const ogYt = document.createElement("optgroup");
  ogYt.label = "YouTube import";
  const ytOpt = document.createElement("option");
  ytOpt.value = LIB_FILTER_YT_IMPORT;
  ytOpt.textContent = "Imported from YouTube";
  ogYt.appendChild(ytOpt);
  sel.appendChild(ogYt);

  if ([allOpt.value, sessOpt.value, ytOpt.value, ...Object.keys(LIST_LABELS)].includes(current)) {
    sel.value = current;
  } else {
    sel.value = "";
    libListFilter = "";
  }
}

function renderLibraryPriorityBar() {
  const host = document.getElementById("libPriorityBar");
  if (!host) return;
  host.innerHTML = "";
  const defs = [
    ["", "All", "lib-pri-btn--all"],
    ["prio_high", "H", "lib-pri-high"],
    ["prio_med", "M", "lib-pri-med"],
    ["prio_low", "L", "lib-pri-low"],
    ["prio_drop", "D", "lib-pri-drop"],
  ];
  for (const [value, label, cls] of defs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `lib-pri-btn ${cls}`.trim();
    b.textContent = label;
    b.classList.toggle("active", libPriorityFilter === value);
    b.addEventListener("click", () => {
      libPriorityFilter = value;
      renderLibraryPriorityBar();
      renderVideos();
    });
    host.appendChild(b);
  }
}

function setupLibraryBulkAndFacet() {
  const page = document.querySelector(".library-page");
  if (!page || page.dataset.libBulkBound === "1") return;
  page.dataset.libBulkBound = "1";

  document.getElementById("libBulkSelectAll")?.addEventListener("change", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const curList = computeDisplayedVideoList();
    const ids = curList.map((x) => x.id);
    if (el.checked) {
      for (const id of ids) libCheckedIds.add(id);
    } else {
      for (const id of ids) libCheckedIds.delete(id);
    }
    renderVideos();
  });

  document.getElementById("libBulkDeleteSelected")?.addEventListener("click", async () => {
    const curList = computeDisplayedVideoList();
    const ids = curList.filter((x) => libCheckedIds.has(x.id)).map((x) => x.id);
    if (!ids.length) return;
    if (!confirm(`Remove ${ids.length} selected video(s) from your library?\n\nThis cannot be undone.`)) return;
    const r = await send("TUBESTACK_DELETE_ITEMS", { ids });
    if (!r?.ok) {
      alert(r?.error || r?.message || "Could not delete.");
      return;
    }
    libCheckedIds.clear();
    await reloadLibraryFullState();
  });

  document.getElementById("libBulkMoveBtn")?.addEventListener("click", async () => {
    const curList = computeDisplayedVideoList();
    const items = curList.filter((x) => libCheckedIds.has(x.id)).map(libraryItemToPlaylistSnapshot);
    const plId = document.getElementById("libBulkPlaylistSelect")?.value || "";
    if (!items.length) return;
    if (!plId) {
      alert("Choose a playlist under “Move to…”.");
      return;
    }
    const r = await send("TUBESTACK_LOCAL_PLAYLIST_ADD_ITEMS", { playlistId: plId, items });
    if (!r?.ok) {
      alert(r?.error || r?.message || "Could not move.");
      return;
    }
    localPlaylists = r.playlists || localPlaylists;
    libCheckedIds.clear();
    renderSessionSelect();
    renderVideos();
  });

  document.getElementById("libBulkNewPlBtn")?.addEventListener("click", async () => {
    const curList = computeDisplayedVideoList();
    const items = curList.filter((x) => libCheckedIds.has(x.id)).map(libraryItemToPlaylistSnapshot);
    if (!items.length) return;
    const name = prompt("New playlist name", "Library picks");
    if (name === null) return;
    const r = await send("TUBESTACK_LOCAL_PLAYLIST_ADD_ITEMS", {
      createNew: true,
      name: name.trim() || "Library picks",
      items,
    });
    if (!r?.ok) {
      alert(r?.error || r?.message || "Could not create playlist.");
      return;
    }
    localPlaylists = r.playlists || localPlaylists;
    libCheckedIds.clear();
    renderSessionSelect();
    renderVideos();
  });

  document.getElementById("libFacetDeleteAll")?.addEventListener("click", async () => {
    if (!libraryHasFacetFilter()) return;
    const curList = computeDisplayedVideoList();
    if (!curList.length) return;
    if (
      !confirm(
        `Remove all ${curList.length} video(s) in this filtered list from your library?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    const ids = curList.map((x) => x.id);
    const r = await send("TUBESTACK_DELETE_ITEMS", { ids });
    if (!r?.ok) {
      alert(r?.error || r?.message || "Could not delete.");
      return;
    }
    libCheckedIds.clear();
    await reloadLibraryFullState();
  });
}

async function boot() {
  setupLibraryBulkAndFacet();
  applyLibBrowsePanelUi();
  applyLibSortViewToolbarUi();
  document.getElementById("libSortViewToggle")?.addEventListener("click", () => toggleLibSortViewToolbar());
  document.getElementById("libBrowseCollapseToggle")?.addEventListener("click", () => toggleLibBrowsePanelCollapsed());
  document.getElementById("libBrowseSizeBtn")?.addEventListener("click", () => toggleLibBrowsePanelSize());
  document.getElementById("libBrowseShowMoreBtn")?.addEventListener("click", () => {
    const prev = localStorage.getItem(`${LIB_BROWSE_PANEL_STATE_KEY}_prev`);
    setLibBrowsePanelState(prev === "compact" ? "compact" : "expanded");
  });

  const artistSort = document.getElementById("artistSortOrder");
  const albumSort = document.getElementById("albumSortOrder");
  const categorySort = document.getElementById("categorySortOrder");
  artistSort?.addEventListener("change", () => {
    artistSortOrder = artistSort.value === "desc" ? "desc" : "asc";
    renderAll();
  });
  albumSort?.addEventListener("change", () => {
    albumSortOrder = albumSort.value === "desc" ? "desc" : "asc";
    renderAll();
  });
  categorySort?.addEventListener("change", () => {
    categorySortOrder = categorySort.value === "desc" ? "desc" : "asc";
    renderAll();
  });
  const libSearch = document.getElementById("libSearch");
  const libView = document.getElementById("libViewMode");
  const libSort = document.getElementById("libQuickSort");
  const libList = document.getElementById("libListFilter");
  libSearch?.addEventListener("input", () => {
    libSearchQuery = normalizeText(libSearch.value);
    renderVideos();
  });
  libView?.addEventListener("change", () => {
    libViewMode = libView.value || "details";
    renderVideos();
  });
  libSort?.addEventListener("change", () => {
    libQuickSort = libSort.value || "saved_desc";
    renderVideos();
  });
  libList?.addEventListener("change", () => {
    libListFilter = libList.value || "";
    renderVideos();
  });
  document.getElementById("libWatchStateFilter")?.addEventListener("change", (e) => {
    libWatchStateFilter = e.target.value || "";
    renderVideos();
  });
  document.getElementById("libBulkWatchStateBtn")?.addEventListener("click", async () => {
    const ws = document.getElementById("libBulkWatchState")?.value || "";
    const ids = [...libCheckedIds];
    if (!ids.length) {
      alert("Select at least one video.");
      return;
    }
    if (!ws) {
      alert("Choose a Watch State.");
      return;
    }
    const r = await send("TUBESTACK_BULK_UPDATE_ITEMS", { ids, patch: { watchState: ws } });
    if (!r?.ok) {
      alert(r?.error || "Could not update Watch State.");
      return;
    }
    await reloadLibraryFullState();
  });
  document.getElementById("libSessionSelect")?.addEventListener("change", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement)) return;
    applySessionSelectValue(el.value);
  });
  document.getElementById("libScopeRecent")?.addEventListener("click", () => setLibLibraryScope("recent"));
  document.getElementById("libScopeComplete")?.addEventListener("click", () => setLibLibraryScope("complete"));
  const r = await send("TUBESTACK_GET_STATE");
  allItems = Array.isArray(r?.items) ? r.items : [];
  localPlaylists = Array.isArray(r?.localPlaylists) ? r.localPlaylists : [];
  libSettings = r?.settings && typeof r.settings === "object" ? r.settings : {};
  const savedScope = localStorage.getItem(LIB_LIBRARY_SCOPE_KEY);
  libLibraryScope = savedScope === "complete" ? "complete" : "recent";
  renderListFilterOptions();
  fillLibWatchStateFilterOptions();
  renderLibraryPriorityBar();
  libActivePlaylistId = null;
  syncLibScopeButtons();
  renderSessionSelect();
  renderAll();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.localPlaylists && !changes.settings)) return;
  void (async () => {
    const r = await send("TUBESTACK_GET_STATE");
    if (!r?.ok) return;
    allItems = Array.isArray(r?.items) ? r.items : [];
    localPlaylists = Array.isArray(r?.localPlaylists) ? r.localPlaylists : [];
    libSettings = r?.settings && typeof r.settings === "object" ? r.settings : {};
    renderListFilterOptions();
    fillLibWatchStateFilterOptions();
    renderLibraryPriorityBar();
    syncLibScopeButtons();
    renderSessionSelect();
    renderAll();
  })();
});

void boot();
