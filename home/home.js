function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

const HOME_PL_SORT_KEY = "ts_home_pl_sort";
const HOME_PL_VIEW_KEY = "ts_home_pl_view";
const HOME_PL_GRID_SIZE_KEY = "ts_home_pl_grid_size";

let cachedRawPlaylists = [];
let homePlaylistSearch = "";
let homePlSort = localStorage.getItem(HOME_PL_SORT_KEY) || "newest";
let homePlView = localStorage.getItem(HOME_PL_VIEW_KEY) || "cards";
let homeGridSize = localStorage.getItem(HOME_PL_GRID_SIZE_KEY) || "md";
if (!["sm", "md", "lg"].includes(homeGridSize)) homeGridSize = "md";
let homeSearchTimer;

function thumbUrl(item) {
  if (item?.thumbnail) return item.thumbnail;
  const id = item?.videoId;
  if (id) return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  return "";
}

function pickFourRandom(items) {
  const copy = [...(items || [])];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, 4);
}

/** First ordered snapshot with a usable thumb — playlist “cover” for small lists. */
function pickSingleCoverThumb(items) {
  for (const it of items || []) {
    const u = thumbUrl(it);
    if (u) return u;
  }
  return "";
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase();
}

function playlistHaystack(pl) {
  const items = pl.items || [];
  const parts = [
    pl.name,
    pl.smartSummary,
    pl.groupBy,
    pl.kind,
    pl.playlistSource,
    String(items.length),
  ];
  for (const it of items.slice(0, 12)) {
    parts.push(it.title, it.channel);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function playlistsVisibleOnHome(settings, lists) {
  if (settings?.libraryShowYoutubeImported !== false) return lists;
  return lists.filter((p) => p.playlistSource !== "youtube_import");
}

function sortPlaylists(list, sortKey) {
  const copy = [...list];
  const t = (pl) => Date.parse(pl.createdAt || "") || 0;
  const n = (pl) => (Array.isArray(pl.items) ? pl.items.length : 0);
  const name = (pl) => String(pl.name || "").toLowerCase();
  switch (sortKey) {
    case "oldest":
      copy.sort((a, b) => t(a) - t(b));
      break;
    case "name_asc":
      copy.sort((a, b) => name(a).localeCompare(name(b)));
      break;
    case "name_desc":
      copy.sort((a, b) => name(b).localeCompare(name(a)));
      break;
    case "videos_desc":
      copy.sort((a, b) => n(b) - n(a));
      break;
    case "videos_asc":
      copy.sort((a, b) => n(a) - n(b));
      break;
    case "newest":
    default:
      copy.sort((a, b) => t(b) - t(a));
  }
  return copy;
}

function getProcessedPlaylists() {
  let list = [...cachedRawPlaylists];
  const q = normalizeText(homePlaylistSearch);
  if (q) list = list.filter((p) => playlistHaystack(p).includes(q));
  return sortPlaylists(list, homePlSort);
}

function applyHomeGridLayoutClass(grid) {
  if (!grid) return;
  grid.className = "home-grid";
  if (homePlView === "dense") grid.classList.add("home-grid--dense");
  if (homePlView === "list") grid.classList.add("home-grid--list");
  if (homePlView === "list") {
    grid.style.removeProperty("--home-col-min");
    grid.style.removeProperty("--home-gap");
    return;
  }
  const isDense = homePlView === "dense";
  const gap = isDense ? 12 : 18;
  const mins = isDense
    ? { sm: 160, md: 200, lg: 240 }
    : { sm: 220, md: 260, lg: 320 };
  const min = mins[homeGridSize] || mins.md;
  grid.style.setProperty("--home-col-min", `${min}px`);
  grid.style.setProperty("--home-gap", `${gap}px`);
}

function renderPlaylists(playlists) {
  const grid = document.getElementById("homeGrid");
  const empty = document.getElementById("homeEmpty");
  const status = document.getElementById("homeStatus");
  if (!grid || !empty) return;

  applyHomeGridLayoutClass(grid);
  grid.innerHTML = "";

  const total = cachedRawPlaylists.length;
  const isFiltered = Boolean(normalizeText(homePlaylistSearch)) || playlists.length !== total;

  if (!playlists.length) {
    if (total) {
      empty.textContent = "No playlists match your search.";
    } else {
      empty.textContent =
        'No local playlists yet. Open the library and use “Save playlist…” → Save locally only.';
    }
    empty.classList.remove("hidden");
    if (status) {
      status.textContent = total ? `0 of ${total} playlist${total === 1 ? "" : "s"} shown` : "";
    }
    return;
  }

  empty.classList.add("hidden");
  if (status) {
    if (isFiltered && total !== playlists.length) {
      status.textContent = `${playlists.length} of ${total} playlist${total === 1 ? "" : "s"}`;
    } else {
      status.textContent = `${playlists.length} playlist${playlists.length === 1 ? "" : "s"}`;
    }
  }

  const dash = chrome.runtime.getURL("dashboard/dashboard.html");
  const placeholder =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  for (const pl of playlists) {
    const items = pl.items || [];
    const n = items.length;
    const useSingleCover = n > 0 && n < 4;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "home-card" + (homePlView === "list" ? " home-card--list" : "");
    btn.setAttribute("aria-label", `Open playlist ${pl.name || "Untitled"}`);

    const thumbs = document.createElement("div");
    thumbs.className = "home-thumbs" + (useSingleCover ? " home-thumbs--single" : "");

    if (useSingleCover) {
      const img = document.createElement("img");
      img.className = "home-thumb home-thumb--solo";
      img.alt = "";
      img.loading = "lazy";
      img.src = pickSingleCoverThumb(items) || placeholder;
      thumbs.appendChild(img);
    } else {
      const previewItems = pickFourRandom(items);
      for (let i = 0; i < 4; i++) {
        const img = document.createElement("img");
        img.className = "home-thumb";
        img.alt = "";
        img.loading = "lazy";
        const u = thumbUrl(previewItems[i]);
        img.src = u || placeholder;
        thumbs.appendChild(img);
      }
    }

    const body = document.createElement("div");
    body.className = "home-card-body";
    const title = document.createElement("div");
    title.className = "home-card-title";
    title.textContent = pl.name || "Untitled playlist";
    const meta = document.createElement("div");
    meta.className = "home-card-meta";
    const kind = pl.kind === "smart" ? "Smart · " : "";
    const gb = pl.groupBy ? `${pl.groupBy} · ` : "";
    const origin =
      pl.playlistSource === "youtube_import" ? "Historical (YouTube) · " : "Recent session · ";
    meta.textContent = `${origin}${kind}${gb}${n} video${n === 1 ? "" : "s"}`;
    body.appendChild(title);
    body.appendChild(meta);
    btn.appendChild(thumbs);
    btn.appendChild(body);
    btn.addEventListener("click", () => {
      const url = `${dash}?playlist=${encodeURIComponent(pl.id)}`;
      window.location.href = url;
    });
    grid.appendChild(btn);
  }
}

function renderHomePlaylists() {
  renderPlaylists(getProcessedPlaylists());
}

async function refresh() {
  const status = document.getElementById("homeStatus");
  if (status) status.textContent = "Loading…";
  const r = await send("TUBESTACK_GET_STATE");
  globalThis.TUBESTACK_UI_THEMES?.applyUiTheme(r?.settings?.uiThemePreset);
  if (!r?.ok) {
    if (status) status.textContent = "Could not load playlists.";
    cachedRawPlaylists = [];
    renderHomePlaylists();
    syncHomeToolbarUi();
    return;
  }
  const lists = Array.isArray(r.localPlaylists) ? r.localPlaylists : [];
  cachedRawPlaylists = playlistsVisibleOnHome(r.settings, lists);
  const hint = document.getElementById("homeConnectYoutube");
  if (hint) {
    const connected = r.integrationHealth?.youtubeOAuth?.lastTestOk === true;
    hint.classList.toggle("hidden", connected);
  }
  renderHomePlaylists();
  syncHomeToolbarUi();
}

function syncHomeToolbarUi() {
  const sizeBtn = document.getElementById("homeSizeToggle");
  if (sizeBtn) {
    const list = homePlView === "list";
    sizeBtn.disabled = list;
    sizeBtn.title = list ? "Grid size (switch to cards or compact grid)" : "Grid tile size";
  }
  document.querySelectorAll("#homeSortPanel [data-home-sort]").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-home-sort") === homePlSort);
  });
  document.querySelectorAll("#homeViewPanel [data-home-view]").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-home-view") === homePlView);
  });
  document.querySelectorAll("#homeSizePanel [data-home-size]").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-home-size") === homeGridSize);
  });
}

function closeHomePanels() {
  const panels = ["homeSortPanel", "homeViewPanel", "homeSizePanel"].map((id) => document.getElementById(id));
  const toggles = ["homeSortToggle", "homeViewToggle", "homeSizeToggle"].map((id) => document.getElementById(id));
  for (const p of panels) p?.classList.add("hidden");
  for (const b of toggles) b?.setAttribute("aria-expanded", "false");
}

function toggleHomePanel(panelId, toggleId) {
  const panel = document.getElementById(panelId);
  const toggle = document.getElementById(toggleId);
  if (!panel || !toggle) return;
  const willOpen = panel.classList.contains("hidden");
  closeHomePanels();
  if (willOpen) {
    panel.classList.remove("hidden");
    toggle.setAttribute("aria-expanded", "true");
  }
}

function wireHomeToolbar() {
  const sortT = document.getElementById("homeSortToggle");
  const viewT = document.getElementById("homeViewToggle");
  const sizeT = document.getElementById("homeSizeToggle");
  const sortPanel = document.getElementById("homeSortPanel");
  const viewPanel = document.getElementById("homeViewPanel");
  const sizePanel = document.getElementById("homeSizePanel");
  sortT?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHomePanel("homeSortPanel", "homeSortToggle");
  });
  viewT?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHomePanel("homeViewPanel", "homeViewToggle");
  });
  sizeT?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (sizeT.disabled) return;
    toggleHomePanel("homeSizePanel", "homeSizeToggle");
  });

  sortPanel?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-home-sort]");
    if (!b || !sortPanel.contains(b)) return;
    homePlSort = b.getAttribute("data-home-sort") || "newest";
    localStorage.setItem(HOME_PL_SORT_KEY, homePlSort);
    syncHomeToolbarUi();
    closeHomePanels();
    renderHomePlaylists();
  });

  viewPanel?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-home-view]");
    if (!b || !viewPanel.contains(b)) return;
    homePlView = b.getAttribute("data-home-view") || "cards";
    localStorage.setItem(HOME_PL_VIEW_KEY, homePlView);
    syncHomeToolbarUi();
    closeHomePanels();
    renderHomePlaylists();
  });

  sizePanel?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-home-size]");
    if (!b || !sizePanel.contains(b)) return;
    homeGridSize = b.getAttribute("data-home-size") || "md";
    localStorage.setItem(HOME_PL_GRID_SIZE_KEY, homeGridSize);
    syncHomeToolbarUi();
    closeHomePanels();
    renderHomePlaylists();
  });

  document.addEventListener("mousedown", (e) => {
    const shell = document.querySelector(".home-toolbar-shell");
    if (!shell || shell.contains(e.target)) return;
    closeHomePanels();
  });
}

document.getElementById("btnRefresh")?.addEventListener("click", () => {
  void refresh();
});

document.getElementById("btnOpenLibrary")?.addEventListener("click", () => {
  window.location.href = chrome.runtime.getURL("dashboard/library.html");
});

document.getElementById("homePlaylistSearch")?.addEventListener("input", () => {
  const el = document.getElementById("homePlaylistSearch");
  clearTimeout(homeSearchTimer);
  homeSearchTimer = setTimeout(() => {
    homePlaylistSearch = el?.value || "";
    renderHomePlaylists();
  }, 120);
});

wireHomeToolbar();
syncHomeToolbarUi();
globalThis.TUBESTACK_UI_THEMES?.bindUiThemeStorageSync();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.localPlaylists && !changes.settings)) return;
  void refresh();
});

void refresh();
