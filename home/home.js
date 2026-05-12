function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

const HOME_PL_SORT_KEY = "ts_home_pl_sort";
const HOME_PL_VIEW_KEY = "ts_home_pl_view";

let cachedRawPlaylists = [];
let homePlaylistSearch = "";
let homePlSort = localStorage.getItem(HOME_PL_SORT_KEY) || "newest";
let homePlView = localStorage.getItem(HOME_PL_VIEW_KEY) || "cards";
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
  if (!r?.ok) {
    if (status) status.textContent = "Could not load playlists.";
    cachedRawPlaylists = [];
    renderHomePlaylists();
    return;
  }
  const lists = Array.isArray(r.localPlaylists) ? r.localPlaylists : [];
  cachedRawPlaylists = playlistsVisibleOnHome(r.settings, lists);
  renderHomePlaylists();
}

function syncControlValues() {
  const sortEl = document.getElementById("homePlSort");
  const viewEl = document.getElementById("homePlView");
  if (sortEl) sortEl.value = homePlSort;
  if (viewEl) viewEl.value = homePlView;
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

document.getElementById("homePlSort")?.addEventListener("change", (e) => {
  const v = e.target?.value;
  if (!v) return;
  homePlSort = v;
  localStorage.setItem(HOME_PL_SORT_KEY, homePlSort);
  renderHomePlaylists();
});

document.getElementById("homePlView")?.addEventListener("change", (e) => {
  const v = e.target?.value;
  if (!v) return;
  homePlView = v;
  localStorage.setItem(HOME_PL_VIEW_KEY, homePlView);
  renderHomePlaylists();
});

syncControlValues();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.localPlaylists && !changes.settings)) return;
  void refresh();
});

void refresh();
