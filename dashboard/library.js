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
let localPlaylists = [];
let libSettings = {};
/** "recent" = browser-tab sessions & other non-YouTube-import saves; "imported" = back catalog from YouTube OAuth import */
let libPlaylistOrigin = "recent";

/** Which library video row shows inline category / album / delete (one at a time). */
let libVideoActionsId = "";

/** Checked video ids for bulk delete / move / new playlist (scoped to current filtered list). */
const libCheckedIds = new Set();

const LIB_PLAYLIST_PANEL_COLLAPSED_KEY = "ts_library_playlists_collapsed";

function getLibPlaylistPanelCollapsed() {
  return localStorage.getItem(LIB_PLAYLIST_PANEL_COLLAPSED_KEY) === "1";
}

function applyLibPlaylistPanelCollapsedUi() {
  const panel = document.querySelector(".library-playlists-panel");
  const btn = document.getElementById("libPlaylistPanelToggle");
  const collapsed = getLibPlaylistPanelCollapsed();
  panel?.classList.toggle("library-playlists-panel--collapsed", collapsed);
  if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function toggleLibPlaylistPanelCollapsed() {
  const next = !getLibPlaylistPanelCollapsed();
  localStorage.setItem(LIB_PLAYLIST_PANEL_COLLAPSED_KEY, next ? "1" : "0");
  applyLibPlaylistPanelCollapsedUi();
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

function matchesLibrarySearch(item, q) {
  if (!q) return true;
  const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
  const hay = [
    item.title,
    item.channel,
    deriveAlbum(item),
    LIST_LABELS[item.category] || "Unassigned",
    item.playlistTitle,
    item.playlistName,
    item.topic,
    tags,
  ]
    .map((x) => normalizeText(x))
    .join(" ");
  return hay.includes(q);
}

function itemMatchesLibraryOrigin(it) {
  const isYt = it.libraryImportSource === "youtube_playlist";
  if (libPlaylistOrigin === "recent") return !isYt;
  if (libPlaylistOrigin === "imported") {
    if (libSettings.libraryShowYoutubeImported === false) return false;
    return isYt;
  }
  return true;
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
  if (libListFilter) list = list.filter((it) => (it.category || "") === libListFilter);
  if (libPriorityFilter) list = list.filter((it) => (it.priority || "") === libPriorityFilter);
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
  for (const pl of playlistsForLibraryOrigin()) {
    const o = document.createElement("option");
    o.value = pl.id;
    o.textContent = `${pl.name || "Untitled"} (${(pl.items || []).length})`;
    plSel.appendChild(o);
  }
  if (currentPl && [...plSel.options].some((o) => o.value === currentPl)) plSel.value = currentPl;
}

function updateVideosHeader(list) {
  const defaultHead = document.getElementById("libDefaultVideoTitle");
  const facetHead = document.getElementById("libFacetVideoHead");
  const videosTitle = document.getElementById("videosTitle");
  const facetName = document.getElementById("libFacetName");
  const facetCount = document.getElementById("libFacetInlineCount");
  const showFacet = libraryHasFacetFilter();
  if (defaultHead) defaultHead.classList.toggle("hidden", showFacet);
  if (facetHead) facetHead.classList.toggle("hidden", !showFacet);
  if (showFacet && facetName && facetCount) {
    facetName.textContent = facetTitleLine();
    facetCount.textContent = ` · ${list.length} video${list.length === 1 ? "" : "s"}`;
  }
  if (videosTitle) {
    if (libPlaylistOrigin === "imported") {
      videosTitle.textContent = selectedArtist
        ? `Imported — ${selectedArtist} (${list.length})`
        : `Imported from YouTube (${list.length})`;
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
  return allItems.filter((it) => itemMatchesLibraryOrigin(it));
}

function playlistsForLibraryOrigin() {
  const showImp = libSettings.libraryShowYoutubeImported !== false;
  if (libPlaylistOrigin === "imported" && !showImp) return [];
  if (libPlaylistOrigin === "imported") {
    return localPlaylists.filter((p) => p.playlistSource === "youtube_import");
  }
  return localPlaylists.filter((p) => p.playlistSource !== "youtube_import");
}

function renderPlaylistChips() {
  const host = document.getElementById("libraryPlaylistChips");
  const hint = document.getElementById("libOriginHint");
  if (!host) return;
  host.innerHTML = "";
  if (libPlaylistOrigin === "imported" && libSettings.libraryShowYoutubeImported === false) {
    if (hint) {
      hint.textContent =
        "Imported playlists are hidden. Turn on “Show imported back catalog” in the dashboard Settings window.";
      hint.classList.remove("hidden");
    }
    return;
  }
  if (hint) hint.classList.add("hidden");
  const list = [...playlistsForLibraryOrigin()].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "library-playlists-empty";
    p.textContent =
      libPlaylistOrigin === "imported"
        ? "No YouTube-imported playlists yet. Use Settings → Import my YouTube playlists now."
        : "No recent session playlists yet. Save YouTube tabs from the TubeStack toolbar.";
    host.appendChild(p);
    return;
  }
  for (const pl of list) {
    const a = document.createElement("a");
    a.className = "library-playlist-chip";
    const n = (pl.items || []).length;
    a.href = chrome.runtime.getURL(`dashboard/dashboard.html?playlist=${encodeURIComponent(pl.id)}`);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `${pl.name || "Untitled"} · ${n}`;
    a.title =
      pl.playlistSource === "youtube_import" ? "Historical playlist imported from YouTube" : "Recent session playlist";
    host.appendChild(a);
  }
}

function setLibPlaylistOrigin(origin) {
  libPlaylistOrigin = origin === "imported" ? "imported" : "recent";
  document.getElementById("libOriginRecent")?.classList.toggle("active", libPlaylistOrigin === "recent");
  document.getElementById("libOriginImported")?.classList.toggle("active", libPlaylistOrigin === "imported");
  selectedArtist = "";
  selectedAlbum = "";
  selectedCategory = "";
  renderPlaylistChips();
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
    meta.textContent = `${it.channel || "Unknown creator"} · ${formatDuration(getDuration(it))}`;

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
  applyLibraryColumnsCollapse();
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
  sel.innerHTML = `<option value="">All lists</option>`;
  for (const [key, label] of Object.entries(LIST_LABELS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = current;
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

function applyLibraryColumnsCollapse() {
  const page = document.querySelector(".library-page");
  const videos = document.getElementById("videosList");
  if (!page || !videos) return;
  const collapsed = videos.scrollTop > 2;
  page.classList.toggle("columns-collapsed", collapsed);
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
    renderPlaylistChips();
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
    renderPlaylistChips();
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
  applyLibPlaylistPanelCollapsedUi();
  document.getElementById("libPlaylistPanelToggle")?.addEventListener("click", () => toggleLibPlaylistPanelCollapsed());

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
  document.getElementById("videosList")?.addEventListener("scroll", applyLibraryColumnsCollapse);
  document.getElementById("libOriginRecent")?.addEventListener("click", () => setLibPlaylistOrigin("recent"));
  document.getElementById("libOriginImported")?.addEventListener("click", () => setLibPlaylistOrigin("imported"));
  const r = await send("TUBESTACK_GET_STATE");
  allItems = Array.isArray(r?.items) ? r.items : [];
  localPlaylists = Array.isArray(r?.localPlaylists) ? r.localPlaylists : [];
  libSettings = r?.settings && typeof r.settings === "object" ? r.settings : {};
  renderListFilterOptions();
  renderLibraryPriorityBar();
  setLibPlaylistOrigin("recent");
  applyLibraryColumnsCollapse();
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
    renderLibraryPriorityBar();
    renderPlaylistChips();
    renderAll();
  })();
});

void boot();
