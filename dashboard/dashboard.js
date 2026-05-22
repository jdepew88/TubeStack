/** Per-video "List" (watch bucket / format). */
const LIST_LABELS = {
  watch_later: "Watch later",
  long_play: "Long play",
  shorts: "Shorts",
  documentary: "Documentary",
  music: "Music",
  custom: "Custom",
};

/** Four priority tiers (green → red). Stored as prio_* on each item. */
const PRIORITY_LEVELS = [
  { id: "prio_high", label: "High", short: "H", colorClass: "pri-high" },
  { id: "prio_med", label: "Medium", short: "M", colorClass: "pri-med" },
  { id: "prio_low", label: "Low", short: "L", colorClass: "pri-low" },
  { id: "prio_drop", label: "Drop", short: "×", colorClass: "pri-drop" },
];

/** YouTube numeric category IDs for scan preview (Data API snippet.categoryId). */
const YT_CAT_NAMES = {
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

let allItems = [];
let themes = [];
let settings = {};
let videoProgress = {};
let watchByDay = {};
let limits = { maxFavoriteThemes: 8, maxPlaylistThemes: 5 };
let hasYoutubeApiKey = false;
let hasOpenaiKey = false;
let oauthRedirectUri = "";
let lastPlaylistQueue = [];
/** @type {Array<{ id: string; name: string; createdAt: string; items: object[] }>} */
let localPlaylists = [];
/** @type {{ name: string; addedAt?: string; source?: string }[]} */
let subscriptionChannels = [];
/** When set, grid only shows library rows whose videoId is in this set (deep link from playlist home). */
let playlistViewVideoIds = null;
/** @type {{ id: string; name: string } | null} */
let playlistViewMeta = null;
let watchRangeMode = "day";
/** Genres hidden from the “latest import” triage list (labels). */
const latestImportHiddenGenres = new Set();
let latestKnownBatchId = null;
const selected = new Set();
const playlistThemePick = new Set();
let playlistPackCompact = true;
let compactCardRows = false;
let activeWindow = "current";
let recentTablistsExpanded = false;
let windowLayoutReady = false;
let currentPlaylistName = "Untitled Playlist";
let activeLocalPlaylistId = null;
let playlistDraftDirty = false;
let categoryDeleteMode = false;
/** Categories editor grid: "asc" | "desc" (persisted). */
let categorySortDir = localStorage.getItem("ts_category_sort") === "desc" ? "desc" : "asc";
let subsRemoveMode = false;
let sidebarFavExpanded = false;
const tagFetchInFlight = new Set();
const tagFetchFailed = new Set();
let viewMode = localStorage.getItem("ts_view_mode") || "details";
let gridTileSize = Number(localStorage.getItem("ts_grid_tile_size") || 132);
let sidebarHidden = localStorage.getItem("ts_sidebar_hidden") === "1";
let draggingPlaylistItemIds = [];

let obStep = 0;
/** True when user chose local-only (staple) during this wizard session (skips API + OAuth + channel scan). */
let oobeMinimalPath = false;

function isStapleOnboardingUi() {
  return oobeMinimalPath === true || settings.personalizationMode === "staple";
}

function applyObStep4Layout() {
  const staple = isStapleOnboardingUi();
  const leadF = document.getElementById("obStep4LeadFull");
  const leadM = document.getElementById("obStep4LeadMinimal");
  const fullX = document.getElementById("obStep4FullExtras");
  if (!leadF || !leadM || !fullX) return;
  if (staple) {
    leadF.classList.add("hidden");
    leadM.classList.remove("hidden");
    fullX.classList.add("hidden");
  } else {
    leadF.classList.remove("hidden");
    leadM.classList.add("hidden");
    fullX.classList.remove("hidden");
  }
}

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

const TS_WATCH = globalThis.TUBESTACK_WATCH;
let filterWatchStateValue = "";
/** @type {Array<{ videoId: string; itemId: string|null; suggestedWatchState: string; suggestedTags: string[]; reason: string }>} */
let pendingAiWatchSuggestions = [];

function itemWatchState(it) {
  return TS_WATCH ? TS_WATCH.normalizeWatchStateId(it?.watchState) : "queue";
}

function itemNote(it) {
  return TS_WATCH ? TS_WATCH.itemNoteText(it) : String(it?.notes || "").trim();
}

function makeWatchStateBadge(it) {
  const ws = itemWatchState(it);
  const el = document.createElement("span");
  el.className = `watch-state-badge watch-state-badge--${ws}`;
  el.textContent = TS_WATCH ? TS_WATCH.watchStateLabel(ws) : ws;
  el.title = "Watch State";
  return el;
}

function fillWatchStateFilterOptions() {
  const targets = [
    document.getElementById("filterWatchState"),
    document.getElementById("bulkWatchState"),
    document.getElementById("libWatchStateFilter"),
    document.getElementById("libBulkWatchState"),
  ].filter(Boolean);
  if (!TS_WATCH || !targets.length) return;
  const opts =
    '<option value="">All Watch States</option>' +
    TS_WATCH.WATCH_STATE_LIST.map((x) => `<option value="${x.id}">${escapeHtml(x.label)}</option>`).join("");
  const bulkOpts =
    '<option value="">Set Watch State…</option>' +
    TS_WATCH.WATCH_STATE_LIST.map((x) => `<option value="${x.id}">${escapeHtml(x.label)}</option>`).join("");
  for (const sel of targets) {
    const isBulk = sel.id === "bulkWatchState" || sel.id === "libBulkWatchState";
    const cur = sel.value;
    sel.innerHTML = isBulk ? bulkOpts : opts;
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
}

async function persistLocalPlaylistStackPatch(playlistId, patch) {
  const r = await send("TUBESTACK_UPDATE_LOCAL_PLAYLIST_STACK", { playlistId, patch });
  if (r?.ok) {
    localPlaylists = r.playlists || localPlaylists;
    return r.playlist;
  }
  return null;
}

function buildWatchStateRow(it, onApplied) {
  const row = document.createElement("div");
  row.className = "row row-watch-state";
  const lab = document.createElement("label");
  lab.textContent = "Watch State";
  const sel = document.createElement("select");
  sel.className = "watch-state-select";
  sel.setAttribute("aria-label", "Watch State");
  for (const s of TS_WATCH.WATCH_STATE_LIST) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    if (itemWatchState(it) === s.id) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", async () => {
    const r = await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, watchState: sel.value } });
    if (r?.ok) {
      it.watchState = sel.value;
      onApplied?.(sel.value);
    }
  });
  row.appendChild(lab);
  row.appendChild(sel);
  return row;
}

function buildCollapsibleVideoNote(parent, it) {
  const note = itemNote(it);
  const wrap = document.createElement("div");
  wrap.className = "video-note-block";
  let expanded = false;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn small ghost video-note-toggle";
  const panel = document.createElement("div");
  panel.className = "video-note-panel";
  const preview = document.createElement("p");
  preview.className = "video-note-preview ob-muted";
  const ta = document.createElement("textarea");
  ta.className = "notes oobe-input";
  ta.placeholder = "Video note (local-only)…";
  ta.rows = 3;
  ta.value = note;
  let timer;
  const syncUi = () => {
    const v = ta.value.trim();
    toggle.textContent = expanded ? "Hide note" : v ? "Edit note" : "Add note";
    preview.textContent = v && !expanded ? (v.length > 140 ? `${v.slice(0, 140)}…` : v) : "";
    preview.classList.toggle("hidden", !v || expanded);
    panel.classList.toggle("hidden", !expanded && !v);
    wrap.classList.toggle("video-note-block--has-note", Boolean(v));
  };
  ta.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, note: ta.value } });
      it.note = ta.value;
      it.notes = ta.value;
      syncUi();
    }, 400);
  });
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    syncUi();
  });
  syncUi();
  panel.appendChild(preview);
  panel.appendChild(ta);
  wrap.appendChild(toggle);
  wrap.appendChild(panel);
  parent.appendChild(wrap);
}

function buildTimestampNotesSection(parent, it) {
  if (!TS_WATCH) return;
  const details = document.createElement("details");
  details.className = "timestamp-notes-details";
  const sum = document.createElement("summary");
  const renderSummary = () => {
    const n = (it.timestampNotes || []).length;
    sum.textContent = n ? `Timestamp notes (${n})` : "Timestamp notes";
  };
  renderSummary();
  details.appendChild(sum);
  const list = document.createElement("ul");
  list.className = "timestamp-notes-list";
  const renderList = () => {
    list.innerHTML = "";
    const notes = [...(it.timestampNotes || [])].sort((a, b) => a.timeSeconds - b.timeSeconds);
    for (const row of notes) {
      const li = document.createElement("li");
      li.className = "timestamp-note-row";
      const link = document.createElement("a");
      link.href = TS_WATCH.buildYoutubeTimestampUrl(it, row.timeSeconds);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "timestamp-note-time";
      link.textContent = TS_WATCH.formatTimeSeconds(row.timeSeconds);
      const txt = document.createElement("span");
      txt.className = "timestamp-note-text";
      txt.textContent = row.label ? `${row.label} — ${row.note}` : row.note;
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn small ghost";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        const timeIn = prompt("Time (seconds, mm:ss, or hh:mm:ss)", TS_WATCH.formatTimeSeconds(row.timeSeconds));
        if (timeIn == null) return;
        const sec = TS_WATCH.parseTimeInputToSeconds(timeIn);
        if (sec == null) {
          alert("Could not parse time.");
          return;
        }
        const noteIn = prompt("Note", row.note);
        if (noteIn == null) return;
        const labelIn = prompt("Short label (optional)", row.label || "");
        if (labelIn == null) return;
        const updated = (it.timestampNotes || []).map((x) =>
          x.id === row.id
            ? { ...x, timeSeconds: sec, note: noteIn.trim(), label: labelIn.trim(), updatedAt: new Date().toISOString() }
            : x
        );
        void (async () => {
          const r = await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, timestampNotes: updated } });
          if (r?.ok) {
            it.timestampNotes = r.item?.timestampNotes || updated;
            renderList();
            renderSummary();
          }
        })();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn small danger ghost";
      del.textContent = "Delete";
      del.addEventListener("click", () => {
        if (!confirm("Delete this timestamp note?")) return;
        const updated = (it.timestampNotes || []).filter((x) => x.id !== row.id);
        void (async () => {
          const r = await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, timestampNotes: updated } });
          if (r?.ok) {
            it.timestampNotes = r.item?.timestampNotes || updated;
            renderList();
            renderSummary();
          }
        })();
      });
      li.appendChild(link);
      li.appendChild(txt);
      li.appendChild(edit);
      li.appendChild(del);
      list.appendChild(li);
    }
  };
  renderList();
  details.appendChild(list);
  const addRow = document.createElement("div");
  addRow.className = "timestamp-note-add";
  const timeInp = document.createElement("input");
  timeInp.type = "text";
  timeInp.className = "oobe-input";
  timeInp.placeholder = "12:30 or seconds";
  const noteInp = document.createElement("input");
  noteInp.type = "text";
  noteInp.className = "oobe-input";
  noteInp.placeholder = "Note at this time";
  const btnAdd = document.createElement("button");
  btnAdd.type = "button";
  btnAdd.className = "btn small";
  btnAdd.textContent = "Add";
  btnAdd.addEventListener("click", async () => {
    const sec = TS_WATCH.parseTimeInputToSeconds(timeInp.value);
    if (sec == null) {
      alert("Enter time as seconds, mm:ss, or hh:mm:ss.");
      return;
    }
    const note = noteInp.value.trim();
    if (!note) {
      alert("Enter note text.");
      return;
    }
    const next = [
      ...(it.timestampNotes || []),
      { id: `tn_${Date.now()}`, timeSeconds: sec, note, label: "", createdAt: new Date().toISOString() },
    ];
    const r = await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, timestampNotes: next } });
    if (r?.ok) {
      it.timestampNotes = r.item?.timestampNotes || next;
      timeInp.value = "";
      noteInp.value = "";
      renderList();
      renderSummary();
    }
  });
  addRow.appendChild(timeInp);
  addRow.appendChild(noteInp);
  addRow.appendChild(btnAdd);
  details.appendChild(addRow);
  parent.appendChild(details);
}

function buildLocalPlaylistStackPanel(pl) {
  const wrap = document.createElement("div");
  wrap.className = "local-pl-stack-notes";

  const noteLab = document.createElement("label");
  noteLab.className = "ob-label";
  noteLab.textContent = "Stack note";
  const noteTa = document.createElement("textarea");
  noteTa.className = "oobe-input local-pl-stack-field";
  noteTa.rows = 2;
  noteTa.placeholder = "What is this stack for?";
  noteTa.value = pl.stackNote || "";
  let noteTimer;
  noteTa.addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      pl.stackNote = noteTa.value;
      void persistLocalPlaylistStackPatch(pl.id, { stackNote: noteTa.value });
    }, 450);
  });

  const resLab = document.createElement("label");
  resLab.className = "ob-label";
  resLab.textContent = "Research Summary";
  const resTa = document.createElement("textarea");
  resTa.className = "oobe-input local-pl-stack-field";
  resTa.rows = 3;
  resTa.placeholder = "Summary after watching or organizing…";
  resTa.value = pl.researchSummary || "";
  let resTimer;
  resTa.addEventListener("input", () => {
    clearTimeout(resTimer);
    resTimer = setTimeout(() => {
      pl.researchSummary = resTa.value;
      void persistLocalPlaylistStackPatch(pl.id, { researchSummary: resTa.value });
    }, 450);
  });

  const decHead = document.createElement("div");
  decHead.className = "local-pl-decisions-head";
  const decTitle = document.createElement("span");
  decTitle.className = "ob-label";
  decTitle.textContent = "Decision log";
  const btnAddDec = document.createElement("button");
  btnAddDec.type = "button";
  btnAddDec.className = "btn small ghost";
  btnAddDec.textContent = "Add decision";
  decHead.appendChild(decTitle);
  decHead.appendChild(btnAddDec);

  const decList = document.createElement("ul");
  decList.className = "local-pl-decisions-list";

  const renderDecisions = () => {
    decList.innerHTML = "";
    for (const d of pl.decisions || []) {
      const li = document.createElement("li");
      li.className = "local-pl-decision-row";
      const t = document.createElement("strong");
      t.textContent = d.title;
      const r = document.createElement("p");
      r.className = "ob-muted";
      if (d.reason) r.textContent = d.reason;
      const acts = document.createElement("div");
      acts.className = "local-pl-decision-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn small ghost";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        const title = prompt("Decision title", d.title);
        if (title == null) return;
        const reason = prompt("Reason (optional)", d.reason || "");
        if (reason == null) return;
        const next = (pl.decisions || []).map((x) =>
          x.id === d.id
            ? { ...x, title: title.trim(), reason: reason.trim(), updatedAt: new Date().toISOString() }
            : x
        );
        void (async () => {
          const updated = await persistLocalPlaylistStackPatch(pl.id, { decisions: next });
          if (updated) {
            pl.decisions = updated.decisions;
            renderDecisions();
          }
        })();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn small danger ghost";
      del.textContent = "Delete";
      del.addEventListener("click", () => {
        if (!confirm("Delete this decision?")) return;
        const next = (pl.decisions || []).filter((x) => x.id !== d.id);
        void (async () => {
          const updated = await persistLocalPlaylistStackPatch(pl.id, { decisions: next });
          if (updated) {
            pl.decisions = updated.decisions;
            renderDecisions();
          }
        })();
      });
      acts.appendChild(edit);
      acts.appendChild(del);
      li.appendChild(t);
      if (d.reason) li.appendChild(r);
      li.appendChild(acts);
      decList.appendChild(li);
    }
  };
  renderDecisions();

  btnAddDec.addEventListener("click", () => {
    const title = prompt("Decision title");
    if (title == null || !title.trim()) return;
    const reason = prompt("Reason (optional)", "");
    if (reason == null) return;
    const next = [
      ...(pl.decisions || []),
      { id: `dec_${Date.now()}`, title: title.trim(), reason: reason.trim(), createdAt: new Date().toISOString() },
    ];
    void (async () => {
      const updated = await persistLocalPlaylistStackPatch(pl.id, { decisions: next });
      if (updated) {
        pl.decisions = updated.decisions;
        renderDecisions();
      }
    })();
  });

  wrap.appendChild(noteLab);
  wrap.appendChild(noteTa);
  wrap.appendChild(resLab);
  wrap.appendChild(resTa);
  wrap.appendChild(decHead);
  wrap.appendChild(decList);
  return wrap;
}

function formatDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return "—";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Hours + minutes label for analytics (not clock-style). */
function formatHM(sec) {
  const s = Math.floor(Number(sec) || 0);
  if (s <= 0) return "0m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYMDSafe(str) {
  if (!str || typeof str !== "string") return null;
  const p = str.split("-").map((x) => parseInt(x, 10));
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return null;
  const d = new Date(p[0], p[1] - 1, p[2]);
  if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2]) return null;
  return d;
}

function mondayOfWeekContaining(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diff);
  return x;
}

function buildWeekSeries(anchor) {
  const mon = mondayOfWeekContaining(anchor);
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const t = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    const key = localDateKey(t);
    out.push({
      key,
      label: `${wd[i]} ${t.getMonth() + 1}/${t.getDate()}`,
      seconds: watchByDay[key] || 0,
    });
  }
  return out;
}

function buildMonthSeries(year, monthIndex) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  const out = [];
  for (let day = 1; day <= last; day++) {
    const t = new Date(year, monthIndex, day);
    const key = localDateKey(t);
    out.push({ key, label: String(day), seconds: watchByDay[key] || 0 });
  }
  return out;
}

function enumerateCustomKeys(fromStr, toStr) {
  const a = parseYMDSafe(fromStr);
  const b = parseYMDSafe(toStr);
  if (!a || !b) return [];
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  if (start > end) return [];
  const keys = [];
  const MAX = 90;
  let i = 0;
  for (let d = new Date(start); d <= end && i < MAX; d.setDate(d.getDate() + 1), i++) {
    keys.push(localDateKey(new Date(d.getTime())));
  }
  return keys;
}

function buildWatchSeries() {
  if (watchRangeMode === "day") {
    const v = document.getElementById("watchDayPick")?.value;
    const d = parseYMDSafe(v) || new Date();
    const key = localDateKey(d);
    return [{ key, label: key, seconds: watchByDay[key] || 0 }];
  }
  if (watchRangeMode === "week") {
    const v = document.getElementById("watchWeekOf")?.value;
    const d = parseYMDSafe(v) || new Date();
    return buildWeekSeries(d);
  }
  if (watchRangeMode === "month") {
    const v = document.getElementById("watchMonthPick")?.value || "";
    const parts = v.split("-").map((x) => parseInt(x, 10));
    const y = parts[0] || new Date().getFullYear();
    const mo = (parts[1] || new Date().getMonth() + 1) - 1;
    return buildMonthSeries(y, mo);
  }
  const from = document.getElementById("watchFrom")?.value;
  const to = document.getElementById("watchTo")?.value;
  const keys = enumerateCustomKeys(from, to);
  return keys.map((key) => ({
    key,
    label: key.slice(5).replace("-", "/"),
    seconds: watchByDay[key] || 0,
  }));
}

function getWatchRangeBoundsMs() {
  const now = new Date();
  if (watchRangeMode === "day") {
    const v = document.getElementById("watchDayPick")?.value;
    const d = parseYMDSafe(v) || now;
    const fromMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    const toMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
    return { fromMs, toMs };
  }
  if (watchRangeMode === "week") {
    const v = document.getElementById("watchWeekOf")?.value;
    const d = parseYMDSafe(v) || now;
    const mon = mondayOfWeekContaining(d);
    const fromMs = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 0, 0, 0, 0).getTime();
    const toMs = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6, 23, 59, 59, 999).getTime();
    return { fromMs, toMs };
  }
  if (watchRangeMode === "month") {
    const v = document.getElementById("watchMonthPick")?.value || "";
    const parts = v.split("-").map((x) => parseInt(x, 10));
    const y = parts[0] || now.getFullYear();
    const mo = (parts[1] || now.getMonth() + 1) - 1;
    const fromMs = new Date(y, mo, 1, 0, 0, 0, 0).getTime();
    const last = new Date(y, mo + 1, 0).getDate();
    const toMs = new Date(y, mo, last, 23, 59, 59, 999).getTime();
    return { fromMs, toMs };
  }
  const from = document.getElementById("watchFrom")?.value;
  const to = document.getElementById("watchTo")?.value;
  const a = parseYMDSafe(from);
  const b = parseYMDSafe(to);
  if (!a || !b) {
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0).getTime();
    return { fromMs: t0, toMs: now.getTime() };
  }
  const fromMs = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 0, 0, 0, 0).getTime();
  const toMs = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59, 999).getTime();
  return { fromMs, toMs };
}

function updateWatchPickerVisibility() {
  document.getElementById("watchPickDay")?.classList.toggle("hidden", watchRangeMode !== "day");
  document.getElementById("watchPickWeek")?.classList.toggle("hidden", watchRangeMode !== "week");
  document.getElementById("watchPickMonth")?.classList.toggle("hidden", watchRangeMode !== "month");
  document.getElementById("watchPickCustom")?.classList.toggle("hidden", watchRangeMode !== "custom");
}

function setWatchRange(mode) {
  if (!["day", "week", "month", "custom"].includes(mode)) return;
  watchRangeMode = mode;
  document.querySelectorAll(".watch-pill").forEach((el) => {
    el.classList.toggle("active", el.dataset.watchRange === mode);
  });
  updateWatchPickerVisibility();
  renderWatchAnalytics();
}

function initWatchDateDefaults() {
  const now = new Date();
  const dk = localDateKey(now);
  const dp = document.getElementById("watchDayPick");
  if (dp && !dp.value) dp.value = dk;
  const wk = document.getElementById("watchWeekOf");
  if (wk && !wk.value) wk.value = dk;
  const mp = document.getElementById("watchMonthPick");
  if (mp && !mp.value) {
    mp.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const wf = document.getElementById("watchFrom");
  const wt = document.getElementById("watchTo");
  if (wf && wt && !wf.value && !wt.value) {
    const six = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    wf.value = localDateKey(six);
    wt.value = dk;
  }
}

function renderWatchAnalytics() {
  const series = buildWatchSeries();
  const total = series.reduce((a, x) => a + x.seconds, 0);
  const tl = document.getElementById("watchTotalLine");
  if (tl) {
    const plural = series.length === 1 ? "day" : "days";
    tl.textContent = `Total: ${formatHM(total)} · ${series.length} ${plural} in view`;
  }
  const bars = document.getElementById("watchBars");
  const empty = document.getElementById("watchChartEmpty");
  if (!bars || !empty) return;
  bars.innerHTML = "";
  if (!series.length) {
    empty.textContent = "Choose a valid custom date range (from ≤ to, max 90 days).";
    empty.classList.remove("hidden");
    bars.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  bars.classList.remove("hidden");
  const max = Math.max(1, ...series.map((x) => x.seconds));
  for (const pt of series) {
    const pct = (pt.seconds / max) * 100;
    const col = document.createElement("div");
    col.className = "watch-col";
    const track = document.createElement("div");
    track.className = "watch-bar-track";
    const fill = document.createElement("div");
    fill.className = "watch-bar-fill";
    fill.style.height = `${pct}%`;
    fill.title = `${pt.key}: ${formatHM(pt.seconds)}`;
    const lab = document.createElement("div");
    lab.className = "watch-col-label";
    lab.textContent = pt.label;
    const val = document.createElement("div");
    val.className = "watch-col-val";
    val.textContent = formatHM(pt.seconds);
    track.appendChild(fill);
    col.appendChild(track);
    col.appendChild(lab);
    col.appendChild(val);
    bars.appendChild(col);
  }
}

function pct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function getPlayhead(it) {
  const vid = it.videoId;
  const fromP = vid && videoProgress[vid] ? videoProgress[vid].playheadSec || 0 : 0;
  const fromS = it.timestampSec || 0;
  return Math.max(fromS, fromP);
}

function getDuration(it) {
  const vid = it.videoId;
  const fromP = vid && videoProgress[vid] ? videoProgress[vid].durationSec : null;
  return it.durationSec ?? fromP ?? null;
}

function timeLeft(it) {
  const d = getDuration(it);
  if (d == null) return null;
  return Math.max(0, d - getPlayhead(it));
}

function completion(it) {
  const d = getDuration(it);
  if (!d || d <= 0) return null;
  return Math.min(1, getPlayhead(it) / d);
}

function haystack(it) {
  const tsNotes = (it.timestampNotes || []).map((x) => `${x.label || ""} ${x.note || ""}`).join(" ");
  return [
    it.title,
    it.channel,
    it.granularGenre,
    it.libraryAlbum,
    it.playlistName,
    TS_WATCH ? TS_WATCH.watchStateLabel(itemWatchState(it)) : "",
    ...(it.tags || []),
    itemNote(it),
    tsNotes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function interestScore(it) {
  let score = 0;
  const theme = themes.find((t) => t.id === it.themeId);
  if (theme?.tier === "favorite") score += 50;
  else if (theme?.tier === "active") score += 25;
  const r = completion(it);
  if (r != null) {
    if (r >= 0.15 && r <= 0.92) score += 20;
    if (r >= 0.85 && r < 0.97) score += 15;
  }
  if (it.priority === "prio_high") score += 18;
  const tl = timeLeft(it);
  if (tl != null && tl > 0 && tl < 420) score += 12;
  return score;
}

const PRIORITY_SORT_ORDER = { prio_high: 0, prio_med: 1, prio_low: 2, prio_drop: 3 };

const SIDEBAR_SECTION_CONFIG = [
  { id: "focus", label: "Focus session" },
  { id: "import", label: "Latest saved tabs" },
  { id: "subscriptions", label: "Subbed Channels" },
  { id: "categories", label: "Categories (library)" },
  { id: "aiCategorize", label: "AI categorize" },
  { id: "playlistPack", label: "Focused Playlist" },
  { id: "localPl", label: "Playlist Manager" },
];

function normalizeChannelKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Activity tier from saved library + local progress only (not live YouTube uploads). */
function channelLibraryActivity(channelName) {
  const key = normalizeChannelKey(channelName);
  let latest = 0;
  let count = 0;
  for (const it of allItems) {
    if (normalizeChannelKey(it.channel) !== key) continue;
    count++;
    const sa = it.savedAt ? new Date(it.savedAt).getTime() : 0;
    const vid = it.videoId;
    const pr = vid ? videoProgress[vid] : null;
    const pu = pr?.updatedAt ? new Date(pr.updatedAt).getTime() : 0;
    latest = Math.max(latest, sa, pu);
  }
  if (!count) return { tier: "none", latest: 0, count: 0, days: null };
  const days = (Date.now() - latest) / 86400000;
  if (days <= 7) return { tier: "hot", latest, count, days };
  if (days <= 21) return { tier: "warm", latest, count, days };
  if (days <= 56) return { tier: "cool", latest, count, days };
  if (days <= 180) return { tier: "cold", latest, count, days };
  return { tier: "stale", latest, count, days };
}

function syncPlaylistViewFromUrl() {
  playlistViewVideoIds = null;
  playlistViewMeta = null;
  activeLocalPlaylistId = null;
  const id = new URLSearchParams(window.location.search).get("playlist");
  if (!id) return;
  const pl = localPlaylists.find((x) => x.id === id);
  if (!pl) {
    history.replaceState({}, "", "dashboard.html");
    return;
  }
  activeLocalPlaylistId = pl.id;
  currentPlaylistName = pl.name || currentPlaylistName;
  playlistViewMeta = { id: pl.id, name: pl.name || "Playlist" };
  const ids = new Set((pl.items || []).map((x) => x.videoId).filter(Boolean));
  if (ids.size) playlistViewVideoIds = ids;
}

function activatePlaylistView(playlistId, { replaceUrl = true } = {}) {
  const id = String(playlistId || "").trim();
  const pl = localPlaylists.find((x) => x.id === id);
  if (!pl) return;
  activeLocalPlaylistId = pl.id;
  currentPlaylistName = pl.name || currentPlaylistName;
  playlistViewMeta = { id: pl.id, name: pl.name || "Playlist" };
  const ids = new Set((pl.items || []).map((x) => x.videoId).filter(Boolean));
  playlistViewVideoIds = ids.size ? ids : null;
  if (replaceUrl) {
    const qp = `?playlist=${encodeURIComponent(pl.id)}`;
    history.replaceState({}, "", `dashboard.html${qp}`);
  }
  syncSidebarCurrentPlaylistUi();
  setActiveWindow("current");
  render();
}

async function restoreLocalPlaylistSessionById(playlistId) {
  const id = String(playlistId || "").trim();
  const pl = localPlaylists.find((x) => x.id === id);
  const n = (pl?.items || []).length;
  if (!n) {
    alert("This playlist has no videos.");
    return false;
  }
  const label = pl?.name || "this playlist";
  if (
    !confirm(
      `Open ${n} YouTube tab${n === 1 ? "" : "s"} for “${label}”? Tabs open in the background; resume positions apply when TubeStack has tracked them.`
    )
  ) {
    return false;
  }
  const r = await send("TUBESTACK_RESTORE_LOCAL_PLAYLIST", { playlistId: id });
  if (!r?.ok) {
    alert(r?.message || r?.error || "Could not restore session.");
    return false;
  }
  const opened = r.opened ?? 0;
  const requested = r.requested ?? n;
  if (opened < requested) {
    alert(`Opened ${opened} of ${requested} tabs (some entries had no watch URL).`);
  }
  return true;
}

function applySidebarSectionVisibility() {
  const hidden = new Set(settings.sidebarHidden || []);
  document.querySelectorAll("[data-sidebar-section]").forEach((el) => {
    const sid = el.getAttribute("data-sidebar-section");
    if (!sid) return;
    const hide =
      hidden.has(sid) || (sid === "categories" && hidden.has("themes")) || (sid === "themes" && hidden.has("categories"));
    el.classList.toggle("sidebar-section-hidden", hide);
  });
}

function renderSidebarVisibilityControls() {
  const host = document.getElementById("sidebarVisibilityHost");
  if (!host) return;
  host.innerHTML = "";
  for (const { id, label } of SIDEBAR_SECTION_CONFIG) {
    const row = document.createElement("label");
    row.className = "sidebar-vis-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !(settings.sidebarHidden || []).includes(id);
    cb.addEventListener("change", async () => {
      const cur = new Set(settings.sidebarHidden || []);
      if (cb.checked) cur.delete(id);
      else cur.add(id);
      const arr = [...cur];
      const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { sidebarHidden: arr } });
      if (r?.ok && r.settings) settings = r.settings;
      applySidebarSectionVisibility();
    });
    const span = document.createElement("span");
    span.textContent = label;
    row.appendChild(cb);
    row.appendChild(span);
    host.appendChild(row);
  }
}

function sortSubscriptionChannels(rows, mode) {
  const copy = [...rows];
  const nameCmp = (a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  switch (mode) {
    case "name_desc":
      copy.sort((a, b) => nameCmp(b, a));
      break;
    case "activity":
      copy.sort((a, b) => {
        const ca = channelLibraryActivity(a.name).count;
        const cb = channelLibraryActivity(b.name).count;
        if (cb !== ca) return cb - ca;
        return nameCmp(a, b);
      });
      break;
    case "recent":
      copy.sort((a, b) => {
        const ta = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const tb = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return nameCmp(a, b);
      });
      break;
    case "youtube_new":
      copy.sort((a, b) => {
        const na = Math.max(0, Math.floor(Number(a.newItemCount) || 0));
        const nb = Math.max(0, Math.floor(Number(b.newItemCount) || 0));
        if (nb !== na) return nb - na;
        return nameCmp(a, b);
      });
      break;
    case "name_asc":
    default:
      copy.sort(nameCmp);
      break;
  }
  return copy;
}

function renderSubscriptionDirectory() {
  const host = document.getElementById("subsListHost");
  if (!host) return;
  host.innerHTML = "";
  host.classList.remove("subs-grid");
  if (!subscriptionChannels.length) {
    const p = document.createElement("p");
    p.className = "panel-hint";
    p.textContent = "No channels yet — click “Sync from YouTube” and complete Google sign-in.";
    host.appendChild(p);
    return;
  }
  const mode = subsChannelSort?.value || "name_asc";
  const sorted = sortSubscriptionChannels(subscriptionChannels, mode);
  host.classList.add("subs-grid");
  for (const row of sorted) {
    const wrap = document.createElement("div");
    wrap.className = "subs-card-wrap" + (subsRemoveMode ? " subs-delete-mode" : "");

    const line = document.createElement("button");
    line.type = "button";
    line.className = "subs-card" + (row.channelId && !subsRemoveMode ? " subs-card--link" : "");
    const thumbUrl = String(row.thumbnailUrl || "").trim();
    if (thumbUrl) {
      const img = document.createElement("img");
      img.className = "subs-thumb";
      img.alt = "";
      img.loading = "lazy";
      img.src = thumbUrl;
      line.appendChild(img);
    } else {
      const logo = document.createElement("span");
      logo.className = "subs-logo";
      const first = String(row.name || "?").trim().charAt(0).toUpperCase();
      logo.textContent = first || "?";
      line.appendChild(logo);
    }
    const textCol = document.createElement("span");
    textCol.className = "subs-text-col";
    const nameEl = document.createElement("span");
    nameEl.className = "subs-name";
    nameEl.textContent = row.name;
    textCol.appendChild(nameEl);
    const newN = Math.max(0, Math.floor(Number(row.newItemCount) || 0));
    const meta = document.createElement("span");
    meta.className = "subs-meta";
    if (newN > 0) {
      meta.textContent = `${newN} new on YouTube`;
    } else if (row.channelId) {
      meta.textContent = "No new uploads (YouTube)";
    } else {
      meta.textContent = "Open YouTube to refresh counts";
    }
    textCol.appendChild(meta);
    const hint =
      row.channelId && !subsRemoveMode
        ? `${row.name} — click to open channel`
        : subsRemoveMode
          ? `${row.name} — remove with ×`
          : row.name || "";
    line.title = hint;
    line.appendChild(textCol);
    line.addEventListener("click", () => {
      if (subsRemoveMode) return;
      const cid = String(row.channelId || "").trim();
      if (!cid) return;
      chrome.tabs.create({ url: `https://www.youtube.com/channel/${cid}`, active: true });
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "subs-delete-x";
    del.textContent = "×";
    del.title = `Remove “${row.name}” from this list`;
    del.setAttribute("aria-label", `Remove ${row.name}`);
    del.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm(`Remove “${row.name}” from Subbed Channels?`)) return;
      void (async () => {
        const r = await send("TUBESTACK_DELETE_SUBSCRIPTION_CHANNEL", { name: row.name });
        if (!r?.ok) {
          alert(r?.error || "Could not remove channel.");
          return;
        }
        subscriptionChannels = Array.isArray(r.subscriptionChannels) ? r.subscriptionChannels : subscriptionChannels;
        renderSubscriptionDirectory();
      })();
    });

    wrap.appendChild(line);
    wrap.appendChild(del);
    host.appendChild(wrap);
  }
}

function filterItemsBySearchAndFilters(items, q, cat, pri, th, ws) {
  return items.filter((it) => {
    if (!matchesSearch(it, q)) return false;
    if (cat && it.category !== cat) return false;
    if (pri && it.priority !== pri) return false;
    if (th && it.themeId !== th) return false;
    if (ws && itemWatchState(it) !== ws) return false;
    return true;
  });
}

function themeLabelForItem(it) {
  const t = themes.find((x) => x.id === it.themeId);
  return (t?.label || "\u007f").toLowerCase();
}

function lastOpenedMs(it) {
  const vid = it.videoId;
  if (!vid) return 0;
  const u = videoProgress[vid]?.updatedAt;
  return u ? new Date(u).getTime() : 0;
}

function sortItemsForSmartGroupBy(items, groupBy) {
  const copy = [...items];
  const safe = (s) => String(s || "").toLowerCase();
  const priRank = (p) => (PRIORITY_SORT_ORDER[p] != null ? PRIORITY_SORT_ORDER[p] : 99);
  switch (groupBy) {
    case "channel":
      copy.sort(
        (a, b) =>
          safe(a.channel).localeCompare(safe(b.channel)) || safe(a.title).localeCompare(safe(b.title))
      );
      break;
    case "theme":
      copy.sort(
        (a, b) =>
          themeLabelForItem(a).localeCompare(themeLabelForItem(b)) || safe(a.title).localeCompare(safe(b.title))
      );
      break;
    case "libraryAlbum":
      copy.sort(
        (a, b) =>
          safe(a.libraryAlbum).localeCompare(safe(b.libraryAlbum)) ||
          safe(a.channel).localeCompare(safe(b.channel)) ||
          safe(a.title).localeCompare(safe(b.title))
      );
      break;
    case "granularGenre":
      copy.sort(
        (a, b) =>
          safe(a.granularGenre).localeCompare(safe(b.granularGenre)) || safe(a.title).localeCompare(safe(b.title))
      );
      break;
    case "category":
      copy.sort(
        (a, b) =>
          safe(a.category).localeCompare(safe(b.category)) || safe(a.title).localeCompare(safe(b.title))
      );
      break;
    case "priority":
      copy.sort(
        (a, b) =>
          priRank(a.priority) - priRank(b.priority) || safe(a.title).localeCompare(safe(b.title))
      );
      break;
    case "savedAt":
      copy.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
      break;
    case "lastOpened":
      copy.sort((a, b) => lastOpenedMs(b) - lastOpenedMs(a));
      break;
    case "duration":
      copy.sort((a, b) => (getDuration(b) ?? 0) - (getDuration(a) ?? 0));
      break;
    case "interest":
      copy.sort((a, b) => interestScore(b) - interestScore(a));
      break;
    default:
      copy.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
  }
  return copy;
}

function getSmartPlaylistSourceItems(source) {
  let items;
  if (source === "selected") {
    items = allItems.filter((it) => selected.has(it.id));
  } else if (source === "visible") {
    items = filterItemsBySearchAndFilters(
      allItems,
      searchEl.value,
      filterCategory.value,
      filterPriorityValue,
      filterItemCategory.value,
      filterWatchStateValue
    );
    items = sortCopy(items, quickSort.value);
  } else {
    items = [...allItems];
  }
  const ft = document.getElementById("spFilterCategory")?.value || "";
  const fc = (document.getElementById("spFilterChannel")?.value || "").trim().toLowerCase();
  const fp = document.getElementById("spFilterPriority")?.value || "";
  return items.filter((it) => {
    if (ft && it.themeId !== ft) return false;
    if (fp && it.priority !== fp) return false;
    if (fc && !String(it.channel || "").toLowerCase().includes(fc)) return false;
    return true;
  });
}

function fillSmartPlaylistThemeFilter() {
  const sel = document.getElementById("spFilterCategory");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Any category</option>';
  for (const t of themes) {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.label;
    sel.appendChild(o);
  }
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function sortCopy(list, mode) {
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
      case "title_asc":
        return String(a.title || "").localeCompare(String(b.title || ""));
      case "creator_asc":
        return String(a.channel || "").localeCompare(String(b.channel || "")) || String(a.title || "").localeCompare(String(b.title || ""));
      case "length_desc":
        return cmpNum(a, b, -1, getDuration);
      case "watch_time_desc":
        return getPlayhead(b) - getPlayhead(a);
      case "category_asc":
        return String(LIST_LABELS[a.category] || a.category || "").localeCompare(String(LIST_LABELS[b.category] || b.category || ""));
      case "time_left_asc":
        return cmpNum(a, b, 1, timeLeft);
      case "time_left_desc":
        return cmpNum(a, b, -1, timeLeft);
      default:
        return String(a.title || "").localeCompare(String(b.title || ""));
    }
  });
  return copy;
}

function matchesSearch(item, q) {
  if (!q.trim()) return true;
  const s = q.toLowerCase();
  const themeLab = themes.find((t) => t.id === item.themeId)?.label || "";
  const listLab = LIST_LABELS[item.category] || item.category || "";
  const blob = [
    item.title,
    item.channel,
    item.creator,
    item.playlistTitle,
    item.playlistName,
    item.topic,
    item.libraryAlbum,
    item.notes,
    item.category,
    listLab,
    themeLab,
    item.granularGenre,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(s);
}

function getSortedThemeGroups() {
  const favorites = [...themes]
    .filter((t) => t.tier === "favorite")
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
  const others = [...themes]
    .filter((t) => t.tier !== "favorite")
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
  return { favorites, others };
}

function fillThemeSelectOptions(sel, selectedThemeId) {
  const { favorites, others } = getSortedThemeGroups();
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Unassigned";
  if (!selectedThemeId) opt0.selected = true;
  sel.appendChild(opt0);
  if (favorites.length) {
    const favGroup = document.createElement("optgroup");
    favGroup.label = "Favorites";
    for (const t of favorites) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      if (selectedThemeId === t.id) opt.selected = true;
      favGroup.appendChild(opt);
    }
    sel.appendChild(favGroup);
  }
  if (others.length) {
    const otherGroup = document.createElement("optgroup");
    otherGroup.label = "All other categories";
    for (const t of others) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      if (selectedThemeId === t.id) opt.selected = true;
      otherGroup.appendChild(opt);
    }
    sel.appendChild(otherGroup);
  }
}

function ensureVideoTagsForItem(it, onUpdate) {
  if (!it?.id || !it.videoId) return;
  if (Array.isArray(it.tags) && it.tags.length) return;
  if (tagFetchFailed.has(it.id)) return;
  if (tagFetchInFlight.has(it.id)) return;
  tagFetchInFlight.add(it.id);
  void (async () => {
    const r = await send("TUBESTACK_FETCH_VIDEO_TAGS", { id: it.id, videoId: it.videoId, max: 6 });
    tagFetchInFlight.delete(it.id);
    if (!r?.ok || !Array.isArray(r.tags)) {
      tagFetchFailed.add(it.id);
      return;
    }
    it.tags = r.tags;
    if (typeof onUpdate === "function") onUpdate(r.tags);
  })();
}

const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const summary = document.getElementById("summary");
const searchEl = document.getElementById("search");
const filterCategory = document.getElementById("filterCategory");
const filterItemCategory = document.getElementById("filterItemCategory");
const filterPriorityBar = document.getElementById("filterPriorityBar");
/** Empty string = all priorities. */
let filterPriorityValue = "";
const quickSort = document.getElementById("quickSort");
const viewModeEl = document.getElementById("viewMode");
const gridSizeEl = document.getElementById("gridSize");
const gridSizeWrap = document.getElementById("gridSizeWrap");
const btnRestore = document.getElementById("btnRestore");
const btnDelete = document.getElementById("btnDelete");
const btnDeleteLocalPlaylist = document.getElementById("btnDeleteLocalPlaylist");
const btnAutoSort = document.getElementById("btnAutoSort");
const btnOnboarding = document.getElementById("btnOnboarding");
const focusBanner = document.getElementById("focusBanner");
const focusMinutes = document.getElementById("focusMinutes");
const btnFocusStart = document.getElementById("btnFocusStart");
const btnFocusClear = document.getElementById("btnFocusClear");
const focusLine = document.getElementById("focusLine");
const sidebarThemeGrid = document.getElementById("sidebarThemeGrid");
const btnCategorySortAz = document.getElementById("btnCategorySortAz");
const btnCategorySortZa = document.getElementById("btnCategorySortZa");
const btnCategoryDeleteMode = document.getElementById("btnCategoryDeleteMode");
const subsChannelSort = document.getElementById("subsChannelSort");
const btnSubsRemoveMode = document.getElementById("btnSubsRemoveMode");
const newCategoryName = document.getElementById("newCategoryName");
const btnAddCategory = document.getElementById("btnAddCategory");
const playlistThemes = document.getElementById("playlistThemes");
const playlistBudget = document.getElementById("playlistBudget");
const playlistSort = document.getElementById("playlistSort");
const btnBuildPlaylist = document.getElementById("btnBuildPlaylist");
const playlistOut = document.getElementById("playlistOut");
const btnCompactCards = document.getElementById("btnCompactCards");
const btnExportYouTube = document.getElementById("btnExportYouTube");
const ytExportModal = document.getElementById("ytExportModal");
let ytImportPlaylistsCache = [];
const localPlaylistList = document.getElementById("localPlaylistList");
const btnWatchAnalytics = document.getElementById("btnWatchAnalytics");
const windowCurrent = document.getElementById("windowCurrent");
const windowUsage = document.getElementById("windowUsage");
const windowPlaylistPack = document.getElementById("windowPlaylistPack");
const windowLocalPlaylists = document.getElementById("windowLocalPlaylists");
const windowSubscriptions = document.getElementById("windowSubscriptions");
const windowCategories = document.getElementById("windowCategories");
const windowAiCategorize = document.getElementById("windowAiCategorize");
const windowSettings = document.getElementById("windowSettings");
const windowCurrentControlsMount = document.getElementById("windowCurrentControlsMount");
const windowCurrentSectionsMount = document.getElementById("windowCurrentSectionsMount");
const windowUsageMount = document.getElementById("windowUsageMount");
const windowPlaylistPackMount = document.getElementById("windowPlaylistPackMount");
const windowLocalPlaylistsMount = document.getElementById("windowLocalPlaylistsMount");
const windowSubscriptionsMount = document.getElementById("windowSubscriptionsMount");
const windowCategoriesMount = document.getElementById("windowCategoriesMount");
const windowAiCategorizeMount = document.getElementById("windowAiCategorizeMount");
const windowSettingsMount = document.getElementById("windowSettingsMount");
const sidebarRecentTablists = document.getElementById("sidebarRecentTablists");
const btnRecentTablistsMore = document.getElementById("btnRecentTablistsMore");
const sidebarFavoriteCategories = document.getElementById("sidebarFavoriteCategories");
const sidebarFavoriteCategoriesWrap = document.getElementById("sidebarFavoriteCategoriesWrap");
const btnSidebarFavToggle = document.getElementById("btnSidebarFavToggle");
const sidebarCurrentPlaylistLink = document.getElementById("sidebarCurrentPlaylistLink");
const btnSidebarRenamePlaylist = document.getElementById("btnSidebarRenamePlaylist");
const sidebarPlaylistRenameInput = document.getElementById("sidebarPlaylistRenameInput");
const sidebarCreatePlaylistDrop = document.getElementById("sidebarCreatePlaylistDrop");
const layoutRoot = document.querySelector(".layout");
const btnToggleSidebar = document.getElementById("btnToggleSidebar");
const btnShowSidebarFloating = document.getElementById("btnShowSidebarFloating");

const onboarding = document.getElementById("onboarding");
const obSteps = [0, 1, 2, 3, 4, 5, 6].map((i) => document.getElementById(`obStep${i}`));
const obTabPick = document.getElementById("obTabPick");
const obPullStatus = document.getElementById("obPullStatus");
const obGenreGrid = document.getElementById("obGenreGrid");
const obScanResult = document.getElementById("obScanResult");

function fillCategoryFilter() {
  const cats = Object.keys(LIST_LABELS);
  filterCategory.innerHTML =
    `<option value="">All lists</option>` +
    cats.map((c) => `<option value="${c}">${LIST_LABELS[c]}</option>`).join("");
  fillWatchStateFilterOptions();
}

function fillThemeFilter() {
  if (!filterItemCategory) return;
  filterItemCategory.innerHTML =
    `<option value="">All categories</option>` +
    themes.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join("");
}

function renderPriorityFilterBar() {
  if (!filterPriorityBar) return;
  filterPriorityBar.innerHTML = "";
  const all = document.createElement("button");
  all.type = "button";
  all.className = "filter-pri-btn filter-pri-btn--all" + (!filterPriorityValue ? " active" : "");
  all.setAttribute("data-priority-all", "1");
  all.textContent = "All";
  filterPriorityBar.appendChild(all);
  for (const p of PRIORITY_LEVELS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `filter-pri-btn ${p.colorClass}${filterPriorityValue === p.id ? " active" : ""}`;
    b.setAttribute("data-priority", p.id);
    b.title = p.label;
    b.textContent = p.short;
    filterPriorityBar.appendChild(b);
  }
}

if (filterPriorityBar && !filterPriorityBar.dataset.bound) {
  filterPriorityBar.dataset.bound = "1";
  filterPriorityBar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !filterPriorityBar.contains(btn)) return;
    if (btn.hasAttribute("data-priority-all")) filterPriorityValue = "";
    else filterPriorityValue = btn.getAttribute("data-priority") || "";
    filterPriorityBar.querySelectorAll("button").forEach((b) => {
      const isAll = b.hasAttribute("data-priority-all");
      const pv = isAll ? "" : b.getAttribute("data-priority") || "";
      b.classList.toggle(
        "active",
        (!filterPriorityValue && isAll) || (Boolean(filterPriorityValue) && filterPriorityValue === pv)
      );
    });
    render();
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chipClass(tier) {
  if (tier === "favorite") return "chip chip-favorite";
  if (tier === "active") return "chip chip-active";
  return "chip chip-off";
}

async function cycleThemeRemote(t) {
  const r = await send("TUBESTACK_CYCLE_THEME", { themeId: t.id });
  if (!r?.ok) {
    alert(r?.error || "Could not update category.");
    return;
  }
  themes = r.themes || themes;
  renderThemeSidebars();
  fillThemeFilter();
  render();
}

function renderSidebarThemeChip(t) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = chipClass(t.tier);
  el.textContent = t.label;
  el.title = `${t.label} — click: off ↔ green · double-click: gold · Ctrl+click: rename`;
  let cycleTimer = null;
  el.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const next = prompt("Rename this category (as it appears in your library)", t.label);
      if (next != null && String(next).trim()) {
        void (async () => {
          const r = await send("TUBESTACK_RENAME_THEME", { themeId: t.id, label: String(next).trim() });
          if (!r?.ok) {
            alert(r?.error || "Could not rename.");
            return;
          }
          themes = r.themes || themes;
          renderThemeSidebars();
          fillThemeFilter();
          render();
        })();
      }
      return;
    }
    if (e.detail === 1) {
      cycleTimer = setTimeout(() => {
        cycleTimer = null;
        void cycleThemeRemote(t);
      }, 280);
    } else if (e.detail === 2) {
      if (cycleTimer) {
        clearTimeout(cycleTimer);
        cycleTimer = null;
      }
      void (async () => {
        const r = await send("TUBESTACK_TOGGLE_THEME_FAVORITE", { themeId: t.id });
        if (!r?.ok) {
          alert(r?.error || "Could not toggle gold favorite.");
          return;
        }
        themes = r.themes || themes;
        renderThemeSidebars();
        fillThemeFilter();
        render();
      })();
    }
  });
  return el;
}

function applyCategorySortButtonUi() {
  btnCategorySortAz?.classList.toggle("active", categorySortDir === "asc");
  btnCategorySortZa?.classList.toggle("active", categorySortDir === "desc");
}

function renderThemeSidebars() {
  applyCategorySortButtonUi();
  if (sidebarThemeGrid) {
    sidebarThemeGrid.innerHTML = "";
    let ordered = [...themes];
    if (categorySortDir === "desc") {
      ordered.sort((a, b) => String(b.label || "").localeCompare(String(a.label || "")));
    } else {
      ordered.sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
    }
    for (const t of ordered) {
      const wrap = document.createElement("div");
      wrap.className = "category-edit-item" + (categoryDeleteMode ? " delete-mode" : "");
      const chip = renderSidebarThemeChip(t);
      if (categoryDeleteMode) {
        chip.disabled = true;
        chip.style.pointerEvents = "none";
      }
      const del = document.createElement("button");
      del.type = "button";
      del.className = "category-delete-x";
      del.textContent = "x";
      del.title = `Delete ${t.label}`;
      del.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Delete category "${t.label}"?`)) return;
        void (async () => {
          const r = await send("TUBESTACK_DELETE_THEME", { themeId: t.id });
          if (!r?.ok) {
            alert(r?.error || "Could not delete category.");
            return;
          }
          themes = r.themes || themes;
          renderThemeSidebars();
          fillThemeFilter();
          render();
        })();
      });
      wrap.appendChild(chip);
      wrap.appendChild(del);
      sidebarThemeGrid.appendChild(wrap);
    }
  }

  if (playlistThemes) playlistThemes.innerHTML = "";
  for (const t of themes) {
    const row = document.createElement("label");
    row.className = "play-pick";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = playlistThemePick.has(t.id);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (playlistThemePick.size >= limits.maxPlaylistThemes) {
          cb.checked = false;
          alert(`Select at most ${limits.maxPlaylistThemes} categories for a pack.`);
          return;
        }
        playlistThemePick.add(t.id);
      } else playlistThemePick.delete(t.id);
    });
    row.appendChild(cb);
    const span = document.createElement("span");
    span.textContent = t.label;
    row.appendChild(span);
    playlistThemes?.appendChild(row);
  }
  renderSidebarFavoriteCategories();
}

async function refreshTabsSelect() {
  const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://m.youtube.com/*"] });
  const opts =
    `<option value="">Select a tab…</option>` +
    tabs
      .map(
        (tab) =>
          `<option value="${tab.id}">${escapeHtml((tab.title || "YouTube").slice(0, 60))}</option>`
      )
      .join("");
  if (obTabPick) obTabPick.innerHTML = opts;
}

const OB_API_TEST_BTN_CLASSES = ["ob-api-test--idle", "ob-api-test--testing", "ob-api-test--pass", "ob-api-test--fail"];

function updateObApiTestButtonEnabled() {
  const api = document.getElementById("obApiKey")?.value.trim() || "";
  const btn = document.getElementById("obBtnTestApi");
  if (!btn) return;
  const canTest = api.length >= 20 || hasYoutubeApiKey;
  if (!btn.classList.contains("ob-api-test--testing")) {
    btn.disabled = !canTest;
  }
}

function resetObApiTestUi() {
  const btn = document.getElementById("obBtnTestApi");
  const detail = document.getElementById("obApiTestDetail");
  if (!btn) return;
  for (const c of OB_API_TEST_BTN_CLASSES) btn.classList.remove(c);
  btn.classList.add("ob-api-test--idle");
  btn.textContent = "Test API key";
  if (detail) detail.textContent = "";
  updateObApiTestButtonEnabled();
}

function showObStep(n) {
  obStep = n;
  obSteps.forEach((el, i) => el.classList.toggle("hidden", i !== n));
  document.querySelectorAll(".oobe-dot").forEach((dot) => {
    dot.classList.toggle("active", Number(dot.dataset.i) === n);
  });
  onboarding.classList.remove("hidden");
  if (n === 2) resetObApiTestUi();
  if (n === 3) {
    const obRd = document.getElementById("obOAuthRedirect");
    if (obRd) obRd.textContent = oauthRedirectUri || "—";
    const ooc = document.getElementById("obOAuthClientId");
    if (ooc && !ooc.value.trim()) ooc.value = settings.youtubeOAuthClientId || "";
    const ots = document.getElementById("obOAuthTestStatus");
    if (ots) ots.textContent = "";
  }
  if (n === 4) restoreScanPreviewFromSettings();
  if (n === 6) applyObStep4Layout();
}

function hideOnboarding() {
  onboarding.classList.add("hidden");
  oobeMinimalPath = false;
}

function genreTierClass(tier) {
  const base = "genre-tile";
  if (tier === "favorite") return `${base} genre-tile-favorite`;
  if (tier === "active") return `${base} genre-tile-active`;
  return `${base} genre-tile-off`;
}

function renderObGenreTiles() {
  if (!obGenreGrid) return;
  obGenreGrid.innerHTML = "";
  for (const t of themes) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = genreTierClass(t.tier || "off");
    b.textContent = t.label;
    b.title = `${t.label}: tap for off ↔ green (gold on dashboard: double-click chip)`;
    b.addEventListener("click", () => {
      cycleThemeRemote(t).then(() => renderObGenreTiles());
    });
    obGenreGrid.appendChild(b);
  }
}

function populateOobeFields() {
  const emailEl = document.getElementById("obEmail");
  const apiEl = document.getElementById("obApiKey");
  const handleEl = document.getElementById("obHandle");
  const hint = document.getElementById("obKeyHint");
  const loc = document.getElementById("obLocalOnlyCheck");
  const ooc = document.getElementById("obOAuthClientId");
  const ots = document.getElementById("obOAuthTestStatus");
  if (emailEl) emailEl.value = settings.youtubeAccountEmail || "";
  if (handleEl) handleEl.value = settings.youtubeChannelHandle || "";
  if (apiEl) {
    apiEl.value = "";
    apiEl.placeholder = hasYoutubeApiKey ? "Enter only to replace the saved key" : "AIza…";
  }
  if (hint) {
    hint.textContent = "Stored only in this browser’s extension storage.";
  }
  if (loc) loc.checked = false;
  if (ooc) ooc.value = settings.youtubeOAuthClientId || "";
  if (ots) ots.textContent = "";
  resetObApiTestUi();
}

function clearScanUi() {
  const errEl = document.getElementById("obScanError");
  const prev = document.getElementById("obScanPreview");
  const nextBtn = document.getElementById("obNextScan");
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.add("hidden");
  }
  if (prev) {
    prev.innerHTML = "";
    prev.classList.add("hidden");
  }
  if (nextBtn) nextBtn.disabled = true;
}

function restoreScanPreviewFromSettings() {
  const s = settings.youtubeLastScanSummary;
  const prev = document.getElementById("obScanPreview");
  const nextBtn = document.getElementById("obNextScan");
  if (!s || !prev || !nextBtn) return;
  const cats = s.categoryBreakdown || {};
  const parts = Object.keys(cats)
    .map((id) => {
      const name = YT_CAT_NAMES[id] || `Category ${id}`;
      return `${escapeHtml(name)}: ${cats[id]}`;
    })
    .join(" · ");
  prev.innerHTML = `<div><strong>${escapeHtml(s.channelTitle || "")}</strong></div>
    <div class="ob-muted" style="margin-top:6px">Last scan: ${escapeHtml(s.scannedAt || "")}</div>
    <div style="margin-top:8px">${parts || "—"}</div>`;
  prev.classList.remove("hidden");
  nextBtn.disabled = false;
}

function updateFocusUi() {
  const fs = settings.focusSession;
  if (fs?.endsAt && Date.now() < fs.endsAt) {
    const left = Math.max(0, Math.ceil((fs.endsAt - Date.now()) / 60000));
    focusBanner.textContent = `Focus session: ~${left} min left of ${fs.minutes} min budget.`;
    focusBanner.classList.remove("hidden");
    focusLine.textContent = `Ends at ${new Date(fs.endsAt).toLocaleTimeString()}`;
  } else {
    focusBanner.classList.add("hidden");
    focusLine.textContent = settings.focusSession ? "Session ended." : "No active session.";
  }
}

async function loadState() {
  const r = await send("TUBESTACK_GET_STATE");
  if (!r?.ok) {
    summary.textContent = "Could not load library.";
    return;
  }
  allItems = r.items || [];
  themes = r.themes || [];
  settings = r.settings || {};
  videoProgress = r.videoProgress || {};
  watchByDay = r.watchByDay || {};
  localPlaylists = Array.isArray(r.localPlaylists) ? r.localPlaylists : [];
  subscriptionChannels = Array.isArray(r.subscriptionChannels) ? r.subscriptionChannels : [];
  limits = r.limits || limits;
  hasYoutubeApiKey = Boolean(r.hasYoutubeApiKey);
  hasOpenaiKey = Boolean(r.hasOpenaiKey);
  oauthRedirectUri = r.oauthRedirectUri || "";
  const rdUri = oauthRedirectUri || "—";
  const rd = document.getElementById("oauthRedirectDisplay");
  if (rd) rd.textContent = rdUri;
  const obRd = document.getElementById("obOAuthRedirect");
  if (obRd) obRd.textContent = rdUri;
  const oci = document.getElementById("oauthClientId");
  if (oci) oci.value = settings.youtubeOAuthClientId || "";
  const syk = document.getElementById("settingsYoutubeApiKey");
  if (syk) {
    syk.value = "";
    syk.placeholder = hasYoutubeApiKey ? "Key on file — enter only to replace" : "AIza…";
  }
  const sykh = document.getElementById("settingsYoutubeKeyHint");
  if (sykh) {
    sykh.textContent = hasYoutubeApiKey
      ? "A key is already saved on this device. Paste a new key only if you want to replace it."
      : "Paste your YouTube Data API v3 key from Google Cloud Console.";
  }
  const ytApiSt = document.getElementById("youtubeApiKeyTestStatus");
  if (ytApiSt) ytApiSt.textContent = "";
  const ytOauthSt = document.getElementById("youtubeOAuthTestStatus");
  if (ytOauthSt) ytOauthSt.textContent = "";
  const libShowImp = document.getElementById("libShowYoutubeImported");
  if (libShowImp) libShowImp.checked = settings.libraryShowYoutubeImported !== false;
  const ytImpSt = document.getElementById("youtubeImportPlaylistsStatus");
  if (ytImpSt) ytImpSt.textContent = "";
  const oai = document.getElementById("settingsOpenaiKey");
  if (oai) {
    oai.value = "";
    oai.placeholder = hasOpenaiKey ? "Key on file — enter only to replace" : "sk-… (optional)";
  }
  if (settings.currentPlaylistName) currentPlaylistName = settings.currentPlaylistName;
  const savedCtxId = String(settings.currentPlaylistId || "").trim();
  if (savedCtxId && localPlaylists.some((x) => x.id === savedCtxId)) activeLocalPlaylistId = savedCtxId;
  if (!windowLayoutReady) {
    setupWindowLayout();
    windowLayoutReady = true;
  }
  applyViewControlsUi();

  if (subsChannelSort) {
    const saved = localStorage.getItem("ts_subs_sort");
    const allowed = ["name_asc", "name_desc", "youtube_new", "activity", "recent"];
    if (saved && allowed.includes(saved)) subsChannelSort.value = saved;
  }

  fillCategoryFilter();
  fillThemeFilter();
  renderPriorityFilterBar();
  renderThemeSidebars();
  initWatchDateDefaults();
  updateWatchPickerVisibility();
  renderWatchAnalytics();
  updateFocusUi();
  renderLocalPlaylists();
  renderSidebarRecentTablists();
  renderSidebarFavoriteCategories();
  setActiveWindow(activeWindow);

  if (settings.latestImportBatchId !== latestKnownBatchId) {
    latestImportHiddenGenres.clear();
    latestKnownBatchId = settings.latestImportBatchId || null;
  }
  renderLatestImportPanel();

  if (!settings.onboardingComplete) {
    populateOobeFields();
    clearScanUi();
    showObStep(0);
    refreshTabsSelect();
    renderObGenreTiles();
  } else {
    hideOnboarding();
  }
  syncPlaylistViewFromUrl();
  syncSidebarCurrentPlaylistUi();
  applySidebarSectionVisibility();
  renderSidebarVisibilityControls();
  await refreshTabsSelect();
  render();
}

function renderLatestImportPanel() {
  const panel = document.getElementById("latestImportPanel");
  const chipsHost = document.getElementById("latestImportGenreChips");
  const listHost = document.getElementById("latestImportList");
  if (!panel || !chipsHost || !listHost) return;

  const bid = settings.latestImportBatchId;
  const batch = bid ? allItems.filter((it) => it.importBatchId === bid) : [];
  if (!bid || !batch.length) {
    panel.classList.add("hidden");
    chipsHost.innerHTML = "";
    listHost.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");
  const labels = [...new Set(batch.map((it) => it.granularGenre || "General & mixed"))].sort();
  chipsHost.innerHTML = "";
  for (const lab of labels) {
    const hidden = latestImportHiddenGenres.has(lab);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "import-genre-chip" + (hidden ? " import-genre-chip-off" : "");
    b.textContent = lab;
    b.title = hidden ? "Hidden — click to show these videos" : "Click to hide this genre from the list";
    b.addEventListener("click", () => {
      if (latestImportHiddenGenres.has(lab)) latestImportHiddenGenres.delete(lab);
      else latestImportHiddenGenres.add(lab);
      renderLatestImportPanel();
    });
    chipsHost.appendChild(b);
  }

  const visible = batch.filter((it) => !latestImportHiddenGenres.has(it.granularGenre || "General & mixed"));
  listHost.innerHTML = "";
  for (const it of visible) {
    const row = document.createElement("div");
    row.className = "import-batch-row";
    const th = document.createElement("img");
    th.className = "import-batch-thumb";
    th.alt = "";
    th.loading = "lazy";
    th.src = it.thumbnail || (it.videoId ? `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg` : "");
    const mid = document.createElement("div");
    mid.className = "import-batch-mid";
    const a = document.createElement("a");
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = it.title || "Video";
    const g = document.createElement("span");
    g.className = "import-batch-genre";
    g.textContent = it.granularGenre || "—";
    mid.appendChild(a);
    mid.appendChild(g);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn small danger";
    rm.textContent = "Remove";
    rm.addEventListener("click", async () => {
      if (!confirm("Remove this video from your library?")) return;
      await send("TUBESTACK_DELETE_ITEMS", { ids: [it.id] });
      allItems = allItems.filter((x) => x.id !== it.id);
      const leftInBatch = allItems.filter((x) => x.importBatchId === bid).length;
      if (!leftInBatch) {
        await send("TUBESTACK_DISMISS_IMPORT_BATCH");
        settings.latestImportBatchId = null;
        latestKnownBatchId = null;
        latestImportHiddenGenres.clear();
      }
      render();
      renderLatestImportPanel();
    });
    row.appendChild(th);
    row.appendChild(mid);
    row.appendChild(rm);
    listHost.appendChild(row);
  }
}

function visibleItems() {
  const q = searchEl.value;
  const cat = filterCategory.value;
  const pri = filterPriorityValue;
  const th = filterItemCategory.value;
  const ws = filterWatchStateValue;
  let filtered = allItems.filter((it) => {
    if (!matchesSearch(it, q)) return false;
    if (cat && it.category !== cat) return false;
    if (pri && it.priority !== pri) return false;
    if (th && it.themeId !== th) return false;
    if (ws && itemWatchState(it) !== ws) return false;
    return true;
  });
  if (playlistViewVideoIds && playlistViewVideoIds.size > 0) {
    filtered = filtered.filter((it) => it.videoId && playlistViewVideoIds.has(it.videoId));
  }
  return sortCopy(filtered, quickSort.value);
}

function render() {
  const list = visibleItems();
  const btnRestorePl = document.getElementById("btnRestorePlaylistSession");
  if (btnRestorePl) {
    const showPlRestore = Boolean(playlistViewMeta?.id);
    btnRestorePl.classList.toggle("hidden", !showPlRestore);
    if (showPlRestore) {
      const pl = localPlaylists.find((x) => x.id === playlistViewMeta.id);
      const n = (pl?.items || []).length;
      btnRestorePl.textContent = n ? `Restore playlist session (${n})` : "Restore playlist session";
    }
  }
  if (summary) {
    summary.classList.toggle("summary--playlist-filter", Boolean(playlistViewVideoIds?.size && playlistViewMeta));
    summary.replaceChildren();
    const base = `${list.length} shown · ${allItems.length} saved · ${themes.length} categories`;
    summary.appendChild(document.createTextNode(base));
    if (playlistViewVideoIds?.size && playlistViewMeta) {
      summary.appendChild(
        document.createTextNode(
          ` · Playlist “${playlistViewMeta.name}” (${list.length} in library / ${playlistViewVideoIds.size} in snapshot)`
        )
      );
      const plCtx = localPlaylists.find((x) => x.id === playlistViewMeta.id);
      if (plCtx) {
        const stackPanel = buildLocalPlaylistStackPanel(plCtx);
        stackPanel.classList.add("summary-stack-notes");
        summary.appendChild(stackPanel);
      }
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "btn small ghost";
      clearBtn.textContent = "Show entire library";
      clearBtn.addEventListener("click", () => {
        playlistViewVideoIds = null;
        playlistViewMeta = null;
        history.replaceState({}, "", "dashboard.html");
        render();
      });
      summary.appendChild(clearBtn);
    }
  }
  empty.classList.toggle("hidden", list.length > 0);
  grid.innerHTML = "";
  const isGridView = viewMode === "grid";
  const isListView = viewMode === "list";
  grid.classList.toggle("grid-view", isGridView);

  for (const it of list) {
    const card = document.createElement("article");
    const compact = isListView || (viewMode === "details" && compactCardRows);
    card.className = "card" + (compact ? " card--compact" : "") + (isGridView ? " card--grid" : "");
    if (isGridView && gridTileSize <= 104) card.classList.add("card--grid-min");
    card.dataset.id = it.id;
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      const interactive = e.target?.closest("button, input, select, textarea, a");
      if (interactive) {
        e.preventDefault();
        return;
      }
      draggingPlaylistItemIds = getDragPlaylistItemIds(it.id);
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", "tubestack-playlist-items");
      card.classList.add("card--dragging");
    });
    card.addEventListener("dragend", () => {
      draggingPlaylistItemIds = [];
      card.classList.remove("card--dragging");
      document.querySelectorAll(".playlist-drop-target.drop-active").forEach((x) => x.classList.remove("drop-active"));
    });

    const pick = document.createElement("div");
    pick.className = "card-pick";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(it.id);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(it.id);
      else selected.delete(it.id);
    });
    pick.appendChild(cb);

    const thumb = document.createElement("div");
    thumb.className = "thumb-wrap";
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src =
      it.thumbnail ||
      (it.videoId ? `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg` : "");
    thumb.appendChild(img);
    const d = getDuration(it);
    if (d != null) {
      const badge = document.createElement("span");
      badge.className = "dur-badge";
      badge.textContent = formatDuration(d);
      thumb.appendChild(badge);
    }

    const priStack = document.createElement("div");
    priStack.className = "card-priority-stack";
    for (const p of PRIORITY_LEVELS) {
      const pb = document.createElement("button");
      pb.type = "button";
      pb.className = `pri-btn ${p.colorClass}${it.priority === p.id ? " pri-btn--on" : ""}`;
      pb.title = p.label;
      pb.textContent = p.short;
      pb.addEventListener("click", async () => {
        await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, priority: p.id } });
        it.priority = p.id;
        for (const c of priStack.querySelectorAll(".pri-btn")) {
          c.classList.remove("pri-btn--on");
        }
        pb.classList.add("pri-btn--on");
      });
      priStack.appendChild(pb);
    }

    const mediaRow = document.createElement("div");
    mediaRow.className = "card-media-row";
    mediaRow.appendChild(priStack);
    mediaRow.appendChild(thumb);

    const rowCat = document.createElement("div");
    rowCat.className = "row row-list-under-thumb";
    const labCat = document.createElement("label");
    labCat.textContent = "List";
    const selCat = document.createElement("select");
    for (const c of Object.keys(LIST_LABELS)) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = LIST_LABELS[c];
      if (it.category === c) opt.selected = true;
      selCat.appendChild(opt);
    }
    selCat.addEventListener("change", async () => {
      await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, category: selCat.value } });
      it.category = selCat.value;
    });
    rowCat.appendChild(labCat);
    rowCat.appendChild(selCat);

    const thumbCol = document.createElement("div");
    thumbCol.className = "card-thumb-col";
    thumbCol.appendChild(mediaRow);
    thumbCol.appendChild(rowCat);

    const body = document.createElement("div");
    body.className = "card-body";

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    const a = document.createElement("a");
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = it.title || "Untitled";
    titleRow.appendChild(a);
    titleRow.appendChild(makeWatchStateBadge(it));
    if (it.granularGenre) {
      const pill = document.createElement("span");
      pill.className = "granular-genre-pill";
      pill.textContent = it.granularGenre;
      pill.title = "Inferred niche (title keywords from your library)";
      titleRow.appendChild(pill);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    if (compact || (isGridView && gridTileSize <= 104)) {
      const creator = it.channel || "Unknown creator";
      const len = getDuration(it);
      const wsLab = TS_WATCH ? TS_WATCH.watchStateLabel(itemWatchState(it)) : "";
      meta.textContent = `${creator} · ${len != null ? formatDuration(len) : "—"}${wsLab ? ` · ${wsLab}` : ""}`;
    } else {
      const tl = timeLeft(it);
      const comp = completion(it);
      const parts = [];
      if (it.channel) parts.push(it.channel);
      parts.push(`Time left: ${tl != null ? formatDuration(tl) : "—"}`);
      parts.push(`Watched: ${pct(comp)}`);
      parts.push(`Interest: ${Math.round(interestScore(it))}`);
      meta.textContent = parts.join(" · ");
    }

    const rowTheme = document.createElement("div");
    rowTheme.className = "row";
    const labTh = document.createElement("label");
    labTh.textContent = "Category";
    const selTh = document.createElement("select");
    fillThemeSelectOptions(selTh, it.themeId);
    selTh.addEventListener("change", async () => {
      const themeId = selTh.value || null;
      await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, themeId } });
      it.themeId = themeId;
    });
    rowTheme.appendChild(labTh);
    rowTheme.appendChild(selTh);

    const rowAlbum = document.createElement("div");
    rowAlbum.className = "row row-under-thumb row-album-under-thumb";
    const labAl = document.createElement("label");
    labAl.textContent = "Album / series";
    const albumSelect = document.createElement("select");
    const existingAlbums = [...new Set(allItems.map((x) => (x.libraryAlbum || "").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
    const customSentinel = "__custom__";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "Unassigned";
    albumSelect.appendChild(noneOpt);
    for (const alb of existingAlbums) {
      const o = document.createElement("option");
      o.value = alb;
      o.textContent = alb;
      albumSelect.appendChild(o);
    }
    const customOpt = document.createElement("option");
    customOpt.value = customSentinel;
    customOpt.textContent = "Custom…";
    albumSelect.appendChild(customOpt);
    const inpAl = document.createElement("input");
    inpAl.type = "text";
    inpAl.className = "oobe-input";
    inpAl.placeholder = "Type album / series";
    inpAl.maxLength = 120;
    inpAl.value = it.libraryAlbum || "";
    const hasExisting = it.libraryAlbum && existingAlbums.includes(it.libraryAlbum);
    albumSelect.value = hasExisting ? it.libraryAlbum : it.libraryAlbum ? customSentinel : "";
    inpAl.classList.toggle("hidden", albumSelect.value !== customSentinel);
    let albumTimer;
    const commitAlbum = (v) => {
      clearTimeout(albumTimer);
      albumTimer = setTimeout(async () => {
        const val = String(v || "").trim();
        await send("TUBESTACK_UPDATE_ITEM", { patch: { id: it.id, libraryAlbum: val || null } });
        it.libraryAlbum = val || null;
      }, 450);
    };
    albumSelect.addEventListener("change", () => {
      const isCustom = albumSelect.value === customSentinel;
      inpAl.classList.toggle("hidden", !isCustom);
      if (!isCustom) commitAlbum(albumSelect.value);
    });
    inpAl.addEventListener("input", () => commitAlbum(inpAl.value));
    rowAlbum.appendChild(labAl);
    rowAlbum.appendChild(albumSelect);
    rowAlbum.appendChild(inpAl);

    const rowTags = document.createElement("div");
    rowTags.className = "row tags-row";
    const labTags = document.createElement("label");
    labTags.textContent = "Tags";
    const tagsHost = document.createElement("div");
    tagsHost.className = "tag-chip-list";
    const renderTagChips = (tags) => {
      tagsHost.innerHTML = "";
      const cleaned = (tags || []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6);
      if (!cleaned.length) {
        const m = document.createElement("span");
        m.className = "ob-muted";
        m.textContent = "No tags yet.";
        tagsHost.appendChild(m);
        return;
      }
      for (const tag of cleaned) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tag-chip-link";
        b.textContent = tag;
        b.title = `Filter library by tag: ${tag}`;
        b.addEventListener("click", () => {
          searchEl.value = tag;
          setActiveWindow("current");
          render();
        });
        tagsHost.appendChild(b);
      }
    };
    renderTagChips(it.tags || []);
    ensureVideoTagsForItem(it, (tags) => {
      renderTagChips(tags);
      render();
    });
    rowTags.appendChild(labTags);
    rowTags.appendChild(tagsHost);

    const sug = document.createElement("div");
    sug.className = "suggested";
    const sugTags = it.suggestedTags?.length
      ? it.suggestedTags.join(", ")
      : "Suggested tags arrive in a later AI phase.";
    sug.innerHTML = `<span>Suggested:</span> ${escapeHtml(sugTags)}`;

    body.appendChild(titleRow);
    body.appendChild(meta);
    if (!compact) {
      body.appendChild(
        buildWatchStateRow(it, (ws) => {
          const badge = titleRow.querySelector(".watch-state-badge");
          if (badge && TS_WATCH) {
            badge.textContent = TS_WATCH.watchStateLabel(ws);
            badge.className = `watch-state-badge watch-state-badge--${ws}`;
          }
        })
      );
    }
    body.appendChild(rowTheme);
    body.appendChild(rowTags);
    body.appendChild(sug);
    if (!compact) {
      buildCollapsibleVideoNote(body, it);
      buildTimestampNotesSection(body, it);
    }

    thumbCol.appendChild(rowAlbum);

    card.appendChild(pick);
    card.appendChild(thumbCol);
    card.appendChild(body);
    grid.appendChild(card);
  }
  renderLatestImportPanel();
  renderSubscriptionDirectory();
  if (activeWindow === "aiCategorize") updateAiCatScopeCount();
  btnDeleteLocalPlaylist?.classList.toggle("hidden", !activeLocalPlaylistId);
}

function buildOpenUrl(it) {
  const vid = it.videoId;
  if (!vid) return it.url;
  const pos = getPlayhead(it);
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`;
  if (pos > 2) return `${base}&t=${Math.floor(pos)}s`;
  return base;
}

function bindPlaylistPackDelegation() {
  if (!playlistOut || playlistOut.dataset.packDelegation === "1") return;
  playlistOut.dataset.packDelegation = "1";

  playlistOut.addEventListener("change", async (e) => {
    const sel = e.target.closest(".playlist-row-theme");
    if (!sel || !playlistOut.contains(sel)) return;
    const id = sel.dataset.itemId;
    if (!id) return;
    const themeId = sel.value || null;
    const r = await send("TUBESTACK_UPDATE_ITEM", { patch: { id, themeId } });
    if (!r?.ok) {
      alert(r?.error || "Could not update category.");
      return;
    }
    const lib = allItems.find((x) => x.id === id);
    if (lib) lib.themeId = themeId;
    const queued = lastPlaylistQueue.find((x) => x.id === id);
    if (queued) queued.themeId = themeId;
    render();
  });
}

function createPlaylistPackRow(it) {
  const row = document.createElement("div");
  row.className = "playlist-pack-item";

  const thumb = document.createElement("img");
  thumb.className = "playlist-pack-thumb";
  thumb.alt = "";
  thumb.loading = "lazy";
  thumb.src = it.thumbnail || (it.videoId ? `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg` : "");

  const title = document.createElement("div");
  title.className = "playlist-pack-title";
  const link = document.createElement("a");
  link.href = buildOpenUrl(it) || it.url || "#";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = it.title || "Video";
  title.appendChild(link);

  const meta = document.createElement("div");
  meta.className = "playlist-pack-meta";
  meta.textContent = `~${formatDuration(timeLeft(it) ?? getDuration(it) ?? 0)}`;

  const themeRow = document.createElement("div");
  themeRow.className = "playlist-pack-field";
  const labTh = document.createElement("label");
  labTh.className = "playlist-pack-label";
    labTh.textContent = "Category";
  const selTh = document.createElement("select");
  selTh.className = "playlist-row-theme oobe-input";
  selTh.dataset.itemId = it.id;
  fillThemeSelectOptions(selTh, it.themeId);
  themeRow.appendChild(labTh);
  themeRow.appendChild(selTh);

  const main = document.createElement("div");
  main.className = "playlist-pack-main";
  main.appendChild(title);
  main.appendChild(meta);
  main.appendChild(themeRow);

  row.appendChild(thumb);
  row.appendChild(main);
  return row;
}

function renderPlaylistPackOutput(q, budgetMinutes, estimatedSeconds) {
  if (!playlistOut) return;
  bindPlaylistPackDelegation();
  playlistOut.innerHTML = "";
  const summary = document.createElement("div");
  summary.className = "playlist-pack-summary";
  const mins = Math.round((estimatedSeconds || 0) / 60);
  summary.innerHTML = `<strong>${q.length}</strong> videos · ~${mins} min of ${Number(budgetMinutes) || 0} min budget`;
  const compactToggle = document.createElement("button");
  compactToggle.type = "button";
  compactToggle.className = "btn small ghost playlist-pack-view-toggle";
  compactToggle.textContent = playlistPackCompact ? "Expanded view" : "Compact view";
  compactToggle.title = "Switch queue row density";
  compactToggle.addEventListener("click", () => {
    playlistPackCompact = !playlistPackCompact;
    renderPlaylistPackOutput(lastPlaylistQueue, budgetMinutes, estimatedSeconds);
  });
  summary.appendChild(compactToggle);
  playlistOut.appendChild(summary);

  const list = document.createElement("div");
  list.className = "playlist-pack-list" + (playlistPackCompact ? " playlist-pack-list--compact" : "");
  for (const it of q) {
    list.appendChild(createPlaylistPackRow(it));
  }
  playlistOut.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "playlist-actions";
  const openFirst = document.createElement("button");
  openFirst.type = "button";
  openFirst.className = "btn small";
  openFirst.id = "plOpenFirst";
  openFirst.textContent = "Open first";
  const openAll = document.createElement("button");
  openAll.type = "button";
  openAll.className = "btn small";
  openAll.id = "plOpenAll";
  openAll.textContent = "Open all (max 8)";
  actions.appendChild(openFirst);
  actions.appendChild(openAll);
  playlistOut.appendChild(actions);

  openFirst.addEventListener("click", () => {
    if (!q[0]) return;
    chrome.tabs.create({ url: buildOpenUrl(q[0]), active: true });
  });
  openAll.addEventListener("click", () => {
    q.slice(0, 8).forEach((it, i) => {
      chrome.tabs.create({ url: buildOpenUrl(it), active: i === 0 });
    });
  });
}

function defaultLocalPlaylistName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `yt_tabgroup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(
    d.getMinutes()
  )}-${pad(d.getSeconds())}`;
}

function snapshotPlaylistItem(it) {
  return {
    videoId: it.videoId,
    url: it.url,
    title: it.title,
    channel: it.channel,
    thumbnail: it.thumbnail,
    durationSec: it.durationSec,
    timestampSec: it.timestampSec,
    category: it.category,
    themeId: it.themeId,
    libraryAlbum: it.libraryAlbum || "",
    tags: Array.isArray(it.tags) ? [...it.tags] : [],
    notes: it.notes || "",
    savedAt: it.savedAt,
  };
}

function getDragPlaylistItemIds(primaryId) {
  if (selected.has(primaryId) && selected.size > 1) return [...selected];
  return [primaryId];
}

function getDraggedPlaylistSnapshots() {
  const ids = [...new Set(draggingPlaylistItemIds || [])];
  return ids
    .map((id) => allItems.find((it) => it.id === id))
    .filter(Boolean)
    .map(snapshotPlaylistItem);
}

function wirePlaylistDropTarget(el, onDropItems) {
  if (!el) return;
  el.classList.add("playlist-drop-target");
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  el.addEventListener("dragenter", (e) => {
    e.preventDefault();
    el.classList.add("drop-active");
  });
  el.addEventListener("dragleave", () => {
    el.classList.remove("drop-active");
  });
  el.addEventListener("drop", async (e) => {
    e.preventDefault();
    el.classList.remove("drop-active");
    const items = getDraggedPlaylistSnapshots();
    if (!items.length) return;
    await onDropItems(items);
  });
}

function getPlaylistExportItemsFromModal() {
  const sourceEl = document.querySelector('input[name="peSource"]:checked');
  const source = sourceEl?.value || "selected";
  let items = [];
  if (source === "selected") {
    items = allItems.filter((it) => selected.has(it.id));
  } else if (source === "visible") {
    items = visibleItems();
  } else {
    items = lastPlaylistQueue;
  }
  return { source, items };
}

function formatYoutubeCreateErrorMessage(r) {
  let msg = r?.message || r?.error || "Failed.";
  if (r?.error === "missing_oauth_client_id") {
    msg = "Google connection is not configured yet. You can continue using local-only features.";
  } else if (r?.error === "oauth_failed") {
    msg = r.message || "Sign-in failed or was cancelled.";
  } else if (r?.error === "no_videos") {
    msg = r.hint || msg;
  }
  return msg;
}

/**
 * Shared path for “Create on YouTube” from the export modal or a saved local playlist card.
 * @param {{ title: string, description?: string, privacyStatus: string, items: unknown[], statusEl?: Element|null, disableEls?: Element[] }} opts
 */
async function runCreateYoutubePlaylistFromItems({ title, description = "", privacyStatus, items, statusEl = null, disableEls = [] }) {
  const videoIds = [...new Set((items || []).map((it) => it.videoId).filter(Boolean))];
  if (!videoIds.length) {
    if (statusEl) {
      statusEl.classList.remove("success");
      statusEl.textContent = "No videos with valid IDs in this selection.";
    }
    return { ok: false, error: "no_video_ids" };
  }
  const oci = document.getElementById("oauthClientId")?.value.trim() || "";
  if (oci && oci !== (settings.youtubeOAuthClientId || "")) {
    const pr = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeOAuthClientId: oci } });
    if (pr?.ok && pr.settings) settings = { ...settings, ...pr.settings };
  }
  if (!(settings.youtubeOAuthClientId || "").trim()) {
    if (statusEl) {
      statusEl.classList.remove("success");
      statusEl.textContent =
        "Google / YouTube is not connected yet. Add OAuth in Settings, or use Save playlist from the toolbar.";
    }
    return { ok: false, error: "missing_oauth_client_id" };
  }
  if (statusEl) {
    statusEl.classList.remove("success");
    statusEl.textContent = "Opening Google sign-in…";
  }
  for (const el of disableEls) if (el) el.disabled = true;
  try {
    return await send("TUBESTACK_CREATE_YOUTUBE_PLAYLIST", {
      title: String(title || "").trim() || "Untitled",
      description: String(description || "").trim(),
      privacyStatus,
      videoIds,
    });
  } finally {
    for (const el of disableEls) if (el) el.disabled = false;
  }
}

const LOCAL_PL_GROUP_LABELS = {
  channel: "Channel",
  theme: "Category",
  libraryAlbum: "Album / series",
  granularGenre: "Niche genre",
  category: "List category",
  priority: "Priority",
  savedAt: "Date saved",
  lastOpened: "Last opened",
  duration: "Duration",
  interest: "Interest score",
};

function thumbUrlForPlaylistItem(it) {
  if (!it || typeof it !== "object") return "";
  const t = it.thumbnail;
  if (t != null && String(t).trim()) return String(t).trim();
  const vid = it.videoId;
  if (vid != null && String(vid).trim()) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(String(vid).trim())}/mqdefault.jpg`;
  }
  return "";
}

/** Up to `max` thumbnail URLs from distinct items, in random order. */
function pickRandomPlaylistThumbUrls(items, max = 4) {
  const byKey = new Map();
  for (const it of items || []) {
    const url = thumbUrlForPlaylistItem(it);
    if (!url) continue;
    const key = String(it.videoId || it.url || it.title || url).slice(0, 240);
    if (!byKey.has(key)) byKey.set(key, url);
  }
  const urls = [...byKey.values()];
  for (let i = urls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [urls[i], urls[j]] = [urls[j], urls[i]];
  }
  return urls.slice(0, Math.min(max, urls.length));
}

function localPlaylistsVisibleInUi() {
  const show = settings.libraryShowYoutubeImported !== false;
  if (show) return [...localPlaylists];
  return localPlaylists.filter((p) => p.playlistSource !== "youtube_import");
}

function renderLocalPlaylists() {
  if (!localPlaylistList) return;
  localPlaylistList.innerHTML = "";
  const visible = localPlaylistsVisibleInUi();
  if (!visible.length) {
    const p = document.createElement("p");
    p.className = "panel-hint local-pl-empty";
    if (localPlaylists.length && settings.libraryShowYoutubeImported === false) {
      p.textContent =
        "Imported playlists are hidden. Turn on “Show imported back catalog” in Settings, or use Save playlist from the toolbar for recent sessions.";
    } else {
      p.textContent = 'No local lists yet. Use “Save playlist…” → Save locally only.';
    }
    localPlaylistList.appendChild(p);
    return;
  }
  for (const pl of visible) {
    const row = document.createElement("div");
    row.className = "local-pl-row";
    row.dataset.id = pl.id;
    if (pl.id === activeLocalPlaylistId) row.classList.add("local-pl-row--current");

    const card = document.createElement("div");
    card.className = "local-pl-card";

    const head = document.createElement("div");
    head.className = "local-pl-head";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "local-pl-name local-pl-title-input oobe-input";
    inp.value = pl.name || "";
    inp.maxLength = 200;
    inp.setAttribute("aria-label", "Playlist name");
    inp.placeholder = "Playlist name";
    const badges = document.createElement("div");
    badges.className = "local-pl-badges";
    const kindBadge = document.createElement("span");
    kindBadge.className =
      pl.kind === "smart" ? "local-pl-badge local-pl-badge--smart" : "local-pl-badge local-pl-badge--static";
    kindBadge.textContent = pl.kind === "smart" ? "Smart list" : "Snapshot";
    badges.appendChild(kindBadge);
    if (pl.playlistSource === "youtube_import") {
      const imp = document.createElement("span");
      imp.className = "local-pl-badge local-pl-badge--import";
      imp.textContent = "YouTube import";
      badges.appendChild(imp);
    }
    if (pl.id === activeLocalPlaylistId) {
      const cur = document.createElement("span");
      cur.className = "local-pl-badge local-pl-badge--current";
      cur.textContent = "Current";
      badges.appendChild(cur);
    }
    head.appendChild(inp);
    head.appendChild(badges);

    const details = document.createElement("div");
    details.className = "local-pl-detail-grid";
    const n = (pl.items || []).length;
    const when = pl.createdAt ? new Date(pl.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

    const addStat = (label, value) => {
      const cell = document.createElement("div");
      cell.className = "local-pl-stat";
      const lab = document.createElement("span");
      lab.className = "local-pl-stat-label";
      lab.textContent = label;
      const val = document.createElement("span");
      val.className = "local-pl-stat-value";
      val.textContent = value;
      cell.appendChild(lab);
      cell.appendChild(val);
      details.appendChild(cell);
    };
    addStat("Videos", `${n} saved`);
    addStat("Created", when);
    const gb = pl.groupBy && LOCAL_PL_GROUP_LABELS[pl.groupBy] ? LOCAL_PL_GROUP_LABELS[pl.groupBy] : pl.groupBy;
    if (gb) addStat("Grouped by", String(gb));

    if (pl.smartSummary) {
      const sum = document.createElement("div");
      sum.className = "local-pl-summary";
      sum.textContent = pl.smartSummary;
      details.appendChild(sum);
    }
    details.appendChild(buildLocalPlaylistStackPanel(pl));

    const actions = document.createElement("div");
    actions.className = "local-pl-actions";
    const btnSession = document.createElement("button");
    btnSession.type = "button";
    btnSession.className = "btn small primary";
    btnSession.textContent = "Restore session";
    btnSession.dataset.action = "restore-session";
    btnSession.title = "Open every video in this playlist as YouTube tabs (background tabs)";
    const btnView = document.createElement("button");
    btnView.type = "button";
    btnView.className = "btn small";
    btnView.textContent = "View";
    btnView.dataset.action = "view";
    btnView.title = "Open this list in the library (playlist view)";
    const btnRen = document.createElement("button");
    btnRen.type = "button";
    btnRen.className = "btn small ghost";
    btnRen.textContent = "Save name";
    btnRen.dataset.action = "rename";
    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "btn small danger";
    btnDel.textContent = "Erase";
    btnDel.dataset.action = "delete";
    actions.appendChild(btnSession);
    actions.appendChild(btnView);
    actions.appendChild(btnRen);
    actions.appendChild(btnDel);

    const ytRow = document.createElement("div");
    ytRow.className = "local-pl-yt-row";
    const ytToggle = document.createElement("button");
    ytToggle.type = "button";
    ytToggle.className = "btn small ghost local-pl-yt-toggle";
    ytToggle.dataset.action = "toggle-yt";
    ytToggle.setAttribute("aria-expanded", "false");
    ytToggle.textContent = "Create YouTube playlist";
    const ytPanel = document.createElement("div");
    ytPanel.className = "local-pl-yt-panel hidden";
    ytPanel.setAttribute("role", "region");
    ytPanel.setAttribute("aria-label", "YouTube visibility");
    const ytHint = document.createElement("p");
    ytHint.className = "local-pl-yt-hint";
    ytHint.textContent = "Pick visibility, then sign in with Google if prompted.";
    const ytChoices = document.createElement("div");
    ytChoices.className = "local-pl-yt-choices";
    for (const [val, label] of [
      ["public", "Public"],
      ["private", "Private"],
      ["unlisted", "Unlisted"],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn small";
      b.textContent = label;
      b.dataset.action = "youtube";
      b.dataset.privacy = val;
      ytChoices.appendChild(b);
    }
    const ytStatus = document.createElement("p");
    ytStatus.className = "local-pl-yt-status";
    ytStatus.setAttribute("role", "status");
    ytPanel.appendChild(ytHint);
    ytPanel.appendChild(ytChoices);
    ytPanel.appendChild(ytStatus);
    ytRow.appendChild(ytToggle);
    ytRow.appendChild(ytPanel);

    const top = document.createElement("div");
    top.className = "local-pl-top";
    const thumbGrid = document.createElement("div");
    thumbGrid.className = "local-pl-thumb-grid";
    thumbGrid.setAttribute("aria-hidden", "true");
    const randUrls = pickRandomPlaylistThumbUrls(pl.items, 4);
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement("div");
      cell.className = "local-pl-thumb-cell";
      const u = randUrls[i];
      if (u) {
        const img = document.createElement("img");
        img.src = u;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        cell.appendChild(img);
      } else {
        cell.classList.add("local-pl-thumb-cell--empty");
      }
      thumbGrid.appendChild(cell);
    }
    const body = document.createElement("div");
    body.className = "local-pl-body";
    top.appendChild(thumbGrid);
    top.appendChild(body);
    body.appendChild(head);
    body.appendChild(details);
    body.appendChild(actions);
    body.appendChild(ytRow);
    card.appendChild(top);
    row.appendChild(card);
    localPlaylistList.appendChild(row);
  }
}

function renderSidebarRecentTablists() {
  if (!sidebarRecentTablists) return;
  sidebarRecentTablists.innerHTML = "";
  const pool = localPlaylistsVisibleInUi();
  const recent = [...pool]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, recentTablistsExpanded ? pool.length : 6);
  if (!recent.length) {
    const p = document.createElement("div");
    p.className = "panel-hint";
    p.textContent =
      localPlaylists.length && settings.libraryShowYoutubeImported === false
        ? "Imported playlists hidden — see Settings."
        : "No saved tab lists yet.";
    sidebarRecentTablists.appendChild(p);
  } else {
    for (const pl of recent) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sidebar-recent-item";
      b.textContent = pl.name || "Untitled list";
      b.title = `${(pl.items || []).length} videos`;
      b.addEventListener("click", () => {
        activatePlaylistView(pl.id, { replaceUrl: true });
      });
      wirePlaylistDropTarget(b, async (items) => {
        const r = await send("TUBESTACK_LOCAL_PLAYLIST_ADD_ITEMS", { playlistId: pl.id, items });
        if (!r?.ok) {
          alert(r?.error || "Could not add videos to playlist.");
          return;
        }
        localPlaylists = r.playlists || localPlaylists;
        renderLocalPlaylists();
        renderSidebarRecentTablists();
      });
      sidebarRecentTablists.appendChild(b);
    }
  }
  if (btnRecentTablistsMore) {
    if (pool.length <= 6) recentTablistsExpanded = false;
    btnRecentTablistsMore.textContent = recentTablistsExpanded ? "Show less" : "Show more";
    btnRecentTablistsMore.classList.toggle("hidden", pool.length <= 6);
  }
}

function syncSidebarCurrentPlaylistUi() {
  if (activeLocalPlaylistId) {
    const pl = localPlaylists.find((x) => x.id === activeLocalPlaylistId);
    if (pl?.name) currentPlaylistName = pl.name;
  }
  const name = currentPlaylistName || defaultLocalPlaylistName();
  if (sidebarCurrentPlaylistLink) {
    sidebarCurrentPlaylistLink.textContent = name;
    sidebarCurrentPlaylistLink.title = `Open current playlist: ${name}`;
  }
  if (sidebarPlaylistRenameInput) sidebarPlaylistRenameInput.value = name;
}

async function persistCurrentPlaylistContext() {
  const patch = {
    currentPlaylistName: currentPlaylistName || defaultLocalPlaylistName(),
    currentPlaylistId: activeLocalPlaylistId || null,
  };
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch });
  if (r?.ok && r.settings) settings = { ...settings, ...r.settings };
}

/** Delete a saved local playlist by id; clears playlist view and URL when it was active. */
async function eraseLocalPlaylist(id) {
  if (!id) return false;
  const wasActive = id === activeLocalPlaylistId;
  const r = await send("TUBESTACK_LOCAL_PLAYLIST_DELETE", { id });
  if (!r?.ok) {
    alert("Could not erase.");
    return false;
  }
  localPlaylists = r.playlists || [];
  if (wasActive) {
    activeLocalPlaylistId = null;
    playlistViewVideoIds = null;
    playlistViewMeta = null;
    history.replaceState({}, "", "dashboard.html");
    currentPlaylistName = defaultLocalPlaylistName();
    await persistCurrentPlaylistContext();
    syncSidebarCurrentPlaylistUi();
    renderSidebarRecentTablists();
  }
  renderLocalPlaylists();
  if (wasActive) render();
  return true;
}

function openSidebarPlaylistRename() {
  if (!sidebarPlaylistRenameInput) return;
  sidebarPlaylistRenameInput.classList.remove("hidden");
  sidebarPlaylistRenameInput.focus();
  sidebarPlaylistRenameInput.select();
}

async function commitSidebarPlaylistRename() {
  if (!sidebarPlaylistRenameInput) return;
  const v = sidebarPlaylistRenameInput.value.trim();
  currentPlaylistName = v || defaultLocalPlaylistName();
  if (activeLocalPlaylistId) {
    const rr = await send("TUBESTACK_LOCAL_PLAYLIST_RENAME", { id: activeLocalPlaylistId, name: currentPlaylistName });
    if (rr?.ok) localPlaylists = rr.playlists || localPlaylists;
  }
  await persistCurrentPlaylistContext();
  sidebarPlaylistRenameInput.classList.add("hidden");
  syncSidebarCurrentPlaylistUi();
  renderLocalPlaylists();
  renderSidebarRecentTablists();
}

function cancelSidebarPlaylistRename() {
  if (!sidebarPlaylistRenameInput) return;
  sidebarPlaylistRenameInput.classList.add("hidden");
  syncSidebarCurrentPlaylistUi();
}

wirePlaylistDropTarget(sidebarCreatePlaylistDrop, async (items) => {
  const r = await send("TUBESTACK_LOCAL_PLAYLIST_ADD_ITEMS", {
    createNew: true,
    name: defaultLocalPlaylistName(),
    items,
  });
  if (!r?.ok) {
    alert(r?.error || "Could not create playlist.");
    return;
  }
  localPlaylists = r.playlists || localPlaylists;
  renderLocalPlaylists();
  renderSidebarRecentTablists();
});

function renderSidebarFavoriteCategories() {
  if (!sidebarFavoriteCategories) return;
  sidebarFavoriteCategories.innerHTML = "";
  const sorted = [...themes].sort((a, b) => {
    const av = a.tier === "favorite" ? 0 : a.tier === "active" ? 1 : 2;
    const bv = b.tier === "favorite" ? 0 : b.tier === "active" ? 1 : 2;
    return av - bv || String(a.label || "").localeCompare(String(b.label || ""));
  });
  const shown = sorted.slice(0, 8);
  for (const t of shown) {
    const chip = renderSidebarThemeChip(t);
    sidebarFavoriteCategories.appendChild(chip);
  }
  if (sidebarFavoriteCategoriesWrap) sidebarFavoriteCategoriesWrap.classList.toggle("hidden", !sidebarFavExpanded);
  if (btnSidebarFavToggle) {
    btnSidebarFavToggle.setAttribute("aria-expanded", sidebarFavExpanded ? "true" : "false");
    btnSidebarFavToggle.textContent = sidebarFavExpanded ? "▴" : "▾";
  }
}

function collectAiCategorizeItemIds(scope) {
  if (scope === "selected") {
    return [...selected].filter((id) => allItems.some((x) => x.id === id));
  }
  if (scope === "filtered") {
    return visibleItems().map((x) => x.id);
  }
  return allItems.map((x) => x.id);
}

function syncAiCategorizeStrategyUi() {
  const s = document.querySelector('input[name="aiCatStrategy"]:checked')?.value || "discover";
  const discover = document.getElementById("aiCatDiscoverBlock");
  const criteria = document.getElementById("aiCatCriteriaBlock");
  if (discover) discover.classList.toggle("hidden", s === "existing");
  if (criteria) criteria.classList.toggle("hidden", s !== "criteria");
}

function updateAiWatchStateScopeCount() {
  const scope = document.querySelector('input[name="aiCatScope"]:checked')?.value || "library";
  const ids = collectAiCategorizeItemIds(scope);
  const el = document.getElementById("aiWsScopeCount");
  if (!el) return;
  const n = ids.length;
  const cap = 60;
  if (!n) {
    el.textContent =
      scope === "selected" ? "No rows checked — check videos or choose another scope." : "No videos to process.";
    return;
  }
  el.textContent =
    n > cap
      ? `${n} videos match scope; AI will process the first ${cap}.`
      : `${n} video(s) will be sent for Watch State suggestions.`;
}

function updateAiCatScopeCount() {
  const scope = document.querySelector('input[name="aiCatScope"]:checked')?.value || "library";
  const ids = collectAiCategorizeItemIds(scope);
  const el = document.getElementById("aiCatScopeCount");
  if (!el) return;
  updateAiWatchStateScopeCount();
  const n = ids.length;
  const cap = 120;
  if (!n) {
    el.textContent =
      scope === "selected" ? "No rows checked — pick “Entire library” or check videos in the grid." : "No videos to process.";
    return;
  }
  el.textContent =
    n > cap
      ? `${n} video(s) match; only the first ${cap} will be sent to the model.`
      : `${n} video(s) will be sent to the model.`;
}

function setActiveWindow(next) {
  activeWindow = next;
  const panels = {
    current: windowCurrent,
    usage: windowUsage,
    playlistPack: windowPlaylistPack,
    localPlaylists: windowLocalPlaylists,
    subscriptions: windowSubscriptions,
    categories: windowCategories,
    aiCategorize: windowAiCategorize,
    settings: windowSettings,
  };
  for (const [id, el] of Object.entries(panels)) {
    if (!el) continue;
    el.classList.toggle("active", id === next);
    el.classList.toggle("hidden", id !== next);
  }
  document.querySelectorAll(".sidebar-win-btn[data-window-target]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-window-target") === next);
  });
  sidebarCurrentPlaylistLink?.classList.toggle("active", next === "current");
  if (next === "aiCategorize") {
    syncAiCategorizeStrategyUi();
    updateAiCatScopeCount();
  }
  if (next === "usage") {
    renderWatchAnalytics();
  }
  layoutRoot?.classList.toggle("layout--library-mode", false);
  layoutRoot?.classList.toggle("layout--sidebar-hidden", sidebarHidden);
  btnShowSidebarFloating?.classList.toggle("hidden", !sidebarHidden);
  if (btnToggleSidebar) btnToggleSidebar.textContent = "Hide sidebar";
}

function applyViewControlsUi() {
  if (viewModeEl) viewModeEl.value = viewMode;
  if (gridSizeEl) gridSizeEl.value = String(gridTileSize);
  gridSizeWrap?.classList.toggle("hidden", viewMode !== "grid");
  grid?.style.setProperty("--grid-tile-size", `${gridTileSize}px`);
}

function setupWindowLayout() {
  const searchWrapEl = document.querySelector(".search-wrap") || document.createElement("div");
  const filtersEl = document.querySelector(".filters") || document.createElement("div");
  const bulkEl = document.querySelector(".bulk") || document.createElement("div");

  const shell = document.createElement("div");
  shell.className = "current-controls-shell";

  const top = document.createElement("div");
  top.className = "current-controls-top";
  top.appendChild(searchWrapEl);

  const topActions = document.createElement("div");
  topActions.className = "current-controls-actions";

  const sortBtn = document.createElement("button");
  sortBtn.type = "button";
  sortBtn.className = "btn small ghost compact-toggle-btn";
  sortBtn.id = "btnCompactSortToggle";
  sortBtn.setAttribute("aria-expanded", "false");
  sortBtn.title = "Show sort and view controls";
  sortBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="compact-icon">
      <path d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "btn small ghost compact-toggle-btn";
  viewBtn.id = "btnCompactViewToggle";
  viewBtn.setAttribute("aria-expanded", "false");
  viewBtn.title = "Show view controls";
  viewBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="compact-icon">
      <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn small primary compact-toggle-btn";
  saveBtn.id = "btnCompactSaveToggle";
  saveBtn.setAttribute("aria-expanded", "false");
  saveBtn.textContent = "Actions";
  saveBtn.title = "Open actions: save playlist, bulk remove, delete playlist…";

  topActions.appendChild(sortBtn);
  topActions.appendChild(viewBtn);
  topActions.appendChild(saveBtn);
  top.appendChild(topActions);
  shell.appendChild(top);

  const sortPanel = document.createElement("div");
  sortPanel.className = "compact-panel compact-sort-panel hidden";
  sortPanel.id = "compactSortPanel";
  sortPanel.appendChild(filtersEl);

  const viewPanel = document.createElement("div");
  viewPanel.className = "compact-panel compact-view-panel hidden";
  viewPanel.id = "compactViewPanel";
  const viewBar = document.createElement("div");
  viewBar.className = "compact-view-bar";
  const viewModes = [
    ["list", "List"],
    ["details", "Details"],
    ["grid", "Grid"],
  ];
  for (const [id, label] of viewModes) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small ghost compact-view-btn";
    b.dataset.viewMode = id;
    b.textContent = label;
    b.addEventListener("click", () => {
      viewMode = id;
      if (viewModeEl) viewModeEl.value = id;
      localStorage.setItem("ts_view_mode", viewMode);
      applyViewControlsUi();
      render();
      for (const x of viewBar.querySelectorAll(".compact-view-btn")) {
        x.classList.toggle("active", x.dataset.viewMode === viewMode);
      }
    });
    viewBar.appendChild(b);
  }
  const sizeWrap = document.createElement("label");
  sizeWrap.className = "compact-view-size hidden";
  const sizeTxt = document.createElement("span");
  sizeTxt.textContent = "Size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "84";
  sizeInput.max = "180";
  sizeInput.step = "4";
  sizeInput.value = String(gridTileSize);
  sizeInput.addEventListener("input", () => {
    gridTileSize = Math.max(84, Math.min(180, Number(sizeInput.value) || 132));
    localStorage.setItem("ts_grid_tile_size", String(gridTileSize));
    if (gridSizeEl) gridSizeEl.value = String(gridTileSize);
    applyViewControlsUi();
    render();
  });
  sizeWrap.appendChild(sizeTxt);
  sizeWrap.appendChild(sizeInput);
  viewPanel.appendChild(viewBar);
  viewPanel.appendChild(sizeWrap);

  const savePanel = document.createElement("div");
  savePanel.className = "compact-panel compact-save-panel hidden";
  savePanel.id = "compactSavePanel";
  savePanel.appendChild(bulkEl);

  shell.appendChild(sortPanel);
  shell.appendChild(viewPanel);
  shell.appendChild(savePanel);
  windowCurrentControlsMount?.appendChild(shell);

  sortBtn.addEventListener("click", () => {
    const nextOpen = sortPanel.classList.contains("hidden");
    sortPanel.classList.toggle("hidden", !nextOpen);
    viewPanel.classList.add("hidden");
    savePanel.classList.add("hidden");
    sortBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    viewBtn.setAttribute("aria-expanded", "false");
    saveBtn.setAttribute("aria-expanded", "false");
  });
  viewBtn.addEventListener("click", () => {
    const nextOpen = viewPanel.classList.contains("hidden");
    viewPanel.classList.toggle("hidden", !nextOpen);
    sortPanel.classList.add("hidden");
    savePanel.classList.add("hidden");
    viewBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    sortBtn.setAttribute("aria-expanded", "false");
    saveBtn.setAttribute("aria-expanded", "false");
    for (const x of viewBar.querySelectorAll(".compact-view-btn")) {
      x.classList.toggle("active", x.dataset.viewMode === viewMode);
    }
    sizeWrap.classList.toggle("hidden", viewMode !== "grid");
    sizeInput.value = String(gridTileSize);
  });
  saveBtn.addEventListener("click", () => {
    const nextOpen = savePanel.classList.contains("hidden");
    savePanel.classList.toggle("hidden", !nextOpen);
    sortPanel.classList.add("hidden");
    viewPanel.classList.add("hidden");
    saveBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    sortBtn.setAttribute("aria-expanded", "false");
    viewBtn.setAttribute("aria-expanded", "false");
  });

  const currentSectionIds = [];
  for (const id of currentSectionIds) {
    const el = document.getElementById(id);
    if (el) windowCurrentSectionsMount?.appendChild(el);
  }
  const focusSection = document.querySelector('[data-sidebar-section="focus"]');
  if (focusSection) windowUsageMount?.appendChild(focusSection);
  const ppSection = document.querySelector('[data-sidebar-section="playlistPack"]');
  if (ppSection) windowPlaylistPackMount?.appendChild(ppSection);
  const localSection = document.querySelector('[data-sidebar-section="localPl"]');
  if (localSection) windowLocalPlaylistsMount?.appendChild(localSection);
  const subsSection = document.querySelector('[data-sidebar-section="subscriptions"]');
  if (subsSection) windowSubscriptionsMount?.appendChild(subsSection);
  const catSection = document.querySelector('[data-sidebar-section="categories"]');
  if (catSection) windowCategoriesMount?.appendChild(catSection);
  const aiCatSection = document.querySelector('[data-sidebar-section="aiCategorize"]');
  if (aiCatSection) windowAiCategorizeMount?.appendChild(aiCatSection);
  const settingsSection = document.querySelector('[data-sidebar-section="settings"]');
  if (settingsSection) windowSettingsMount?.appendChild(settingsSection);
}

function openYtExportModal() {
  const m = document.getElementById("ytExportModal");
  const t = document.getElementById("peTitle");
  const q = document.getElementById("peSourceQueue");
  const st = document.getElementById("peStatus");
  const createBtn = document.getElementById("peCreate");
  const privacyFieldset = document.getElementById("pePrivacyFieldset");
  const canUseYouTubeSave = Boolean((settings.youtubeOAuthClientId || "").trim());
  if (t) t.value = currentPlaylistName || defaultLocalPlaylistName();
  if (q) q.disabled = !lastPlaylistQueue.length;
  if (createBtn) createBtn.classList.toggle("hidden", !canUseYouTubeSave);
  if (privacyFieldset) privacyFieldset.classList.toggle("hidden", !canUseYouTubeSave);
  if (st) {
    st.textContent = canUseYouTubeSave
      ? ""
      : "You are not connected to YouTube. You can still save locally.";
    st.classList.remove("success");
  }
  if (m) m.classList.remove("hidden");
}

function closeYtExportModal() {
  const m = document.getElementById("ytExportModal");
  if (m) m.classList.add("hidden");
}

function resetYtPlaylistImportModalUi() {
  ytImportPlaylistsCache = [];
  const scroll = document.getElementById("ytImpPlaylistScroll");
  const prevScroll = document.getElementById("ytImpPreviewScroll");
  const selAll = document.getElementById("ytImpSelectAll");
  const run = document.getElementById("ytImpRun");
  const listStatus = document.getElementById("ytImpListStatus");
  const listErr = document.getElementById("ytImpListError");
  const prevTitle = document.getElementById("ytImpPreviewTitle");
  const prevMeta = document.getElementById("ytImpPreviewMeta");
  if (scroll) scroll.innerHTML = "";
  if (prevScroll) prevScroll.innerHTML = "";
  if (selAll) {
    selAll.checked = false;
    selAll.indeterminate = false;
  }
  if (run) run.disabled = true;
  if (listStatus) listStatus.textContent = "";
  if (listErr) {
    listErr.textContent = "";
    listErr.classList.add("hidden");
  }
  if (prevTitle) prevTitle.textContent = "Select a playlist…";
  if (prevMeta) prevMeta.textContent = "";
}

function ytPlaylistImportUpdateRunButton() {
  const run = document.getElementById("ytImpRun");
  if (!run) return;
  const n = document.querySelectorAll("#ytImpPlaylistScroll .yt-import-pl-check:checked").length;
  run.disabled = n === 0;
}

function ytPlaylistImportSyncSelectAll() {
  const selAll = document.getElementById("ytImpSelectAll");
  if (!selAll) return;
  const boxes = document.querySelectorAll("#ytImpPlaylistScroll .yt-import-pl-check");
  const total = boxes.length;
  let checked = 0;
  boxes.forEach((b) => {
    if (b.checked) checked++;
  });
  selAll.checked = total > 0 && checked === total;
  selAll.indeterminate = checked > 0 && checked < total;
}

function renderYtPlaylistImportRows() {
  const scroll = document.getElementById("ytImpPlaylistScroll");
  if (!scroll) return;
  if (!ytImportPlaylistsCache.length) {
    scroll.innerHTML = "";
    return;
  }
  scroll.innerHTML = ytImportPlaylistsCache
    .map(
      (p) => `<div class="yt-import-playlist-row" data-pl-id="${escapeHtml(p.id)}">
      <label class="modal-checkbox yt-import-pl-check-label">
        <input type="checkbox" class="yt-import-pl-check" data-pl-id="${escapeHtml(p.id)}" />
      </label>
      <div class="yt-import-pl-main">
        <span class="yt-import-pl-title">${escapeHtml(p.title)}</span>
        <span class="yt-import-pl-meta">${Number(p.itemCount) || 0} videos</span>
      </div>
      <button type="button" class="btn small ghost yt-import-pl-preview" data-pl-id="${escapeHtml(p.id)}">Preview</button>
    </div>`
    )
    .join("");
}

async function openYtPlaylistImportModal() {
  resetYtPlaylistImportModalUi();
  const m = document.getElementById("ytPlaylistImportModal");
  const listStatus = document.getElementById("ytImpListStatus");
  if (m) m.classList.remove("hidden");
  if (listStatus) listStatus.textContent = "Loading your playlists…";
  const r = await send("TUBESTACK_YOUTUBE_PLAYLISTS_LIST");
  if (!r?.ok) {
    if (listStatus) listStatus.textContent = "";
    const listErr = document.getElementById("ytImpListError");
    if (listErr) {
      listErr.textContent = r?.message || r?.error || "Could not load playlists.";
      listErr.classList.remove("hidden");
    }
    return;
  }
  ytImportPlaylistsCache = Array.isArray(r.playlists) ? r.playlists : [];
  if (listStatus) {
    listStatus.textContent = ytImportPlaylistsCache.length
      ? `Found ${ytImportPlaylistsCache.length} playlist(s). Select which to import.`
      : "No playlists found on this account.";
  }
  renderYtPlaylistImportRows();
  ytPlaylistImportSyncSelectAll();
  ytPlaylistImportUpdateRunButton();
}

async function closeYtPlaylistImportModal() {
  const m = document.getElementById("ytPlaylistImportModal");
  if (m) m.classList.add("hidden");
  await send("TUBESTACK_YOUTUBE_IMPORT_SESSION_CLEAR");
  resetYtPlaylistImportModalUi();
}

async function ytPlaylistImportLoadPreview(playlistId) {
  const pid = String(playlistId || "").trim();
  if (!pid) return;
  document.querySelectorAll(".yt-import-playlist-row").forEach((row) => {
    row.classList.toggle("yt-import-row-previewed", row.getAttribute("data-pl-id") === pid);
  });
  const meta = ytImportPlaylistsCache.find((x) => x.id === pid);
  const prevTitle = document.getElementById("ytImpPreviewTitle");
  const prevScroll = document.getElementById("ytImpPreviewScroll");
  const prevMeta = document.getElementById("ytImpPreviewMeta");
  if (prevTitle) prevTitle.textContent = meta ? meta.title : "Playlist";
  if (prevScroll) prevScroll.innerHTML = `<p class="panel-hint small">Loading…</p>`;
  if (prevMeta) prevMeta.textContent = "";
  const r = await send("TUBESTACK_YOUTUBE_PLAYLIST_PREVIEW", { playlistId: pid });
  if (!r?.ok) {
    if (prevScroll)
      prevScroll.innerHTML = `<p class="modal-status">${escapeHtml(r?.message || r?.error || "Preview failed.")}</p>`;
    return;
  }
  const vids = r.videos || [];
  if (prevScroll) {
    prevScroll.innerHTML = vids
      .map(
        (v) => `<div class="yt-import-preview-row">
        <div class="yt-import-preview-title">${escapeHtml(v.title)}</div>
        <div class="yt-import-preview-channel">${escapeHtml(v.channel || "—")}</div>
      </div>`
      )
      .join("");
  }
  if (prevMeta) {
    let line = `Showing ${r.count != null ? r.count : vids.length} video(s)`;
    if (r.truncated) line += " (list truncated for preview)";
    prevMeta.textContent = `${line}.`;
  }
}

function bindYtPlaylistImportModalOnce() {
  const modal = document.getElementById("ytPlaylistImportModal");
  if (!modal || modal.dataset.ytImpBound === "1") return;
  modal.dataset.ytImpBound = "1";
  modal.addEventListener("click", async (e) => {
    if (e.target === modal) {
      await closeYtPlaylistImportModal();
      return;
    }
    const prevBtn = e.target.closest(".yt-import-pl-preview");
    if (prevBtn && modal.contains(prevBtn)) {
      e.preventDefault();
      const id = prevBtn.getAttribute("data-pl-id");
      if (id) await ytPlaylistImportLoadPreview(id);
      return;
    }
    const row = e.target.closest(".yt-import-playlist-row");
    if (row && modal.contains(row) && !e.target.closest(".yt-import-pl-check-label")) {
      const id = row.getAttribute("data-pl-id");
      if (id) await ytPlaylistImportLoadPreview(id);
    }
  });
  document.getElementById("ytImpPlaylistScroll")?.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains("yt-import-pl-check")) return;
    ytPlaylistImportSyncSelectAll();
    ytPlaylistImportUpdateRunButton();
  });
  document.getElementById("ytImpSelectAll")?.addEventListener("change", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const on = el.checked;
    document.querySelectorAll("#ytImpPlaylistScroll .yt-import-pl-check").forEach((c) => {
      if (c instanceof HTMLInputElement) c.checked = on;
    });
    el.indeterminate = false;
    ytPlaylistImportUpdateRunButton();
  });
  document.getElementById("ytImpClose")?.addEventListener("click", () => void closeYtPlaylistImportModal());
  document.getElementById("ytImpRun")?.addEventListener("click", async () => {
    const selected = [];
    document.querySelectorAll("#ytImpPlaylistScroll .yt-import-pl-check:checked").forEach((c) => {
      const id = c.getAttribute("data-pl-id");
      const rowMeta = ytImportPlaylistsCache.find((x) => x.id === id);
      if (rowMeta) selected.push({ id: rowMeta.id, title: rowMeta.title });
    });
    if (!selected.length) return;
    let totalVideos = 0;
    for (const s of selected) {
      const m = ytImportPlaylistsCache.find((x) => x.id === s.id);
      totalVideos += Number(m?.itemCount) || 0;
    }
    let msg = `Import ${selected.length} playlist(s), about ${totalVideos} video(s) total (from YouTube counts)? Each video’s Album will match its playlist name.`;
    if (totalVideos > 100) {
      msg +=
        "\n\nLarge imports use many YouTube Data API quota units and may take several minutes. Continue anyway?";
    }
    if (!confirm(msg)) return;
    const run = document.getElementById("ytImpRun");
    if (run) run.disabled = true;
    const r = await send("TUBESTACK_IMPORT_YOUTUBE_PLAYLISTS_SELECTED", { playlists: selected });
    if (run) run.disabled = false;
    if (!r?.ok) {
      alert(r?.message || r?.error || "Import failed.");
      ytPlaylistImportUpdateRunButton();
      return;
    }
    const st = document.getElementById("youtubeImportPlaylistsStatus");
    if (st) st.textContent = r.message || "Import complete.";
    await loadState();
    await closeYtPlaylistImportModal();
  });
}

bindYtPlaylistImportModalOnce();

let searchTimer;
searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => render(), 120);
});
filterCategory.addEventListener("change", () => render());
document.getElementById("filterWatchState")?.addEventListener("change", (e) => {
  filterWatchStateValue = e.target.value || "";
  render();
});
filterItemCategory?.addEventListener("change", () => render());
quickSort.addEventListener("change", () => render());
viewModeEl?.addEventListener("change", () => {
  viewMode = viewModeEl.value || "details";
  localStorage.setItem("ts_view_mode", viewMode);
  applyViewControlsUi();
  render();
});
gridSizeEl?.addEventListener("input", () => {
  gridTileSize = Math.max(84, Math.min(180, Number(gridSizeEl.value) || 132));
  localStorage.setItem("ts_grid_tile_size", String(gridTileSize));
  applyViewControlsUi();
  render();
});
btnCompactCards?.addEventListener("click", () => {
  compactCardRows = !compactCardRows;
  btnCompactCards.textContent = compactCardRows ? "Show full details" : "Show less details";
  render();
});
searchEl.addEventListener("search", () => render());
sidebarCurrentPlaylistLink?.addEventListener("click", () => {
  setActiveWindow("current");
});
btnSidebarRenamePlaylist?.addEventListener("click", () => openSidebarPlaylistRename());
sidebarPlaylistRenameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void commitSidebarPlaylistRename();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelSidebarPlaylistRename();
  }
});
sidebarPlaylistRenameInput?.addEventListener("blur", () => {
  void commitSidebarPlaylistRename();
});

btnWatchAnalytics?.addEventListener("click", () => setActiveWindow("usage"));
btnToggleSidebar?.addEventListener("click", () => {
  sidebarHidden = !sidebarHidden;
  localStorage.setItem("ts_sidebar_hidden", sidebarHidden ? "1" : "0");
  setActiveWindow(activeWindow);
});
btnShowSidebarFloating?.addEventListener("click", () => {
  sidebarHidden = false;
  localStorage.setItem("ts_sidebar_hidden", "0");
  setActiveWindow(activeWindow);
});
btnRecentTablistsMore?.addEventListener("click", () => {
  recentTablistsExpanded = !recentTablistsExpanded;
  renderSidebarRecentTablists();
});
btnSidebarFavToggle?.addEventListener("click", () => {
  sidebarFavExpanded = !sidebarFavExpanded;
  renderSidebarFavoriteCategories();
});
document.querySelectorAll(".sidebar-win-btn[data-window-target]").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveWindow(btn.getAttribute("data-window-target") || "current");
  });
});
btnCategorySortAz?.addEventListener("click", () => {
  categorySortDir = "asc";
  localStorage.setItem("ts_category_sort", "asc");
  renderThemeSidebars();
});
btnCategorySortZa?.addEventListener("click", () => {
  categorySortDir = "desc";
  localStorage.setItem("ts_category_sort", "desc");
  renderThemeSidebars();
});
subsChannelSort?.addEventListener("change", () => {
  localStorage.setItem("ts_subs_sort", subsChannelSort.value);
  renderSubscriptionDirectory();
});
btnSubsRemoveMode?.addEventListener("click", (e) => {
  e.stopPropagation();
  subsRemoveMode = !subsRemoveMode;
  if (btnSubsRemoveMode) btnSubsRemoveMode.textContent = subsRemoveMode ? "Done removing" : "Remove channels";
  renderSubscriptionDirectory();
});
btnCategoryDeleteMode?.addEventListener("click", () => {
  categoryDeleteMode = !categoryDeleteMode;
  if (btnCategoryDeleteMode) btnCategoryDeleteMode.textContent = categoryDeleteMode ? "Done deleting" : "Delete categories";
  renderThemeSidebars();
});
btnAddCategory?.addEventListener("click", async () => {
  const label = newCategoryName?.value.trim() || "";
  if (!label) return;
  const r = await send("TUBESTACK_ADD_THEME", { label });
  if (!r?.ok) {
    alert(r?.error || "Could not add category.");
    return;
  }
  themes = r.themes || themes;
  if (newCategoryName) newCategoryName.value = "";
  renderThemeSidebars();
  fillThemeFilter();
  render();
});
document.addEventListener("click", (e) => {
  if (!categoryDeleteMode || activeWindow !== "categories") return;
  const inGrid = e.target.closest("#sidebarThemeGrid");
  const inToggle = e.target.closest("#btnCategoryDeleteMode");
  if (inGrid || inToggle) return;
  categoryDeleteMode = false;
  if (btnCategoryDeleteMode) btnCategoryDeleteMode.textContent = "Delete categories";
  renderThemeSidebars();
});

document.addEventListener("click", (e) => {
  if (!subsRemoveMode) return;
  const inList = e.target.closest("#subsListHost");
  const inToggle = e.target.closest("#btnSubsRemoveMode");
  if (inList || inToggle) return;
  subsRemoveMode = false;
  if (btnSubsRemoveMode) btnSubsRemoveMode.textContent = "Remove channels";
  renderSubscriptionDirectory();
});

window.addEventListener("beforeunload", (e) => {
  if (!playlistDraftDirty) return;
  e.preventDefault();
  e.returnValue = "";
});

document.querySelectorAll(".watch-pill").forEach((el) => {
  el.addEventListener("click", () => setWatchRange(el.dataset.watchRange || "day"));
});
["watchDayPick", "watchWeekOf", "watchMonthPick", "watchFrom", "watchTo"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => renderWatchAnalytics());
});

document.getElementById("btnSaveOAuth")?.addEventListener("click", async () => {
  const v = document.getElementById("oauthClientId")?.value.trim() || "";
  const st = document.getElementById("youtubeOAuthTestStatus");
  if (!v) {
    alert("Paste your OAuth 2.0 Client ID (Web application type).");
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeOAuthClientId: v } });
  if (!r?.ok) {
    alert("Could not save.");
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  const oo = document.getElementById("obOAuthClientId");
  if (oo && !oo.value.trim()) oo.value = settings.youtubeOAuthClientId || "";
  if (st) st.textContent = "Client ID saved.";
});

document.getElementById("btnTestYoutubeOAuth")?.addEventListener("click", async () => {
  const v = document.getElementById("oauthClientId")?.value.trim() || "";
  const st = document.getElementById("youtubeOAuthTestStatus");
  if (st) st.textContent = "Opening Google sign-in…";
  const r = await send("TUBESTACK_TEST_YOUTUBE_OAUTH", { youtubeOAuthClientId: v });
  if (st) {
    st.textContent = r?.ok ? r.message || "Sign-in OK." : r?.message || r?.error || "OAuth test failed.";
  }
});

document.getElementById("btnClearYoutubeOAuth")?.addEventListener("click", async () => {
  if (
    !confirm(
      "Remove the saved OAuth Web Client ID from this device? TubeStack will also clear its in-memory Google sign-in session cache. Your Google account itself is unchanged."
    )
  )
    return;
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeOAuthClientId: "" } });
  if (!r?.ok) {
    alert("Could not clear.");
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  const oci = document.getElementById("oauthClientId");
  if (oci) oci.value = "";
  const oo = document.getElementById("obOAuthClientId");
  if (oo) oo.value = "";
  const st = document.getElementById("youtubeOAuthTestStatus");
  if (st) st.textContent = "Client ID removed.";
});

document.getElementById("btnSignOutGoogleSession")?.addEventListener("click", async () => {
  if (
    !confirm(
      "Sign out of Google for TubeStack? This clears only the in-memory OAuth access token held by this extension until you sign in again. Your saved OAuth Client ID is not removed."
    )
  )
    return;
  const st = document.getElementById("youtubeOAuthTestStatus");
  const r = await send("TUBESTACK_YOUTUBE_IMPORT_SESSION_CLEAR");
  if (st) {
    st.classList.remove("success");
    st.textContent = r?.ok ? "Google session cleared (in-memory token discarded)." : "Could not clear session.";
  }
});

document.getElementById("btnSaveYoutubeApiKey")?.addEventListener("click", async () => {
  const raw = document.getElementById("settingsYoutubeApiKey")?.value.trim() || "";
  const st = document.getElementById("youtubeApiKeyTestStatus");
  if (raw.length < 20) {
    alert("Paste a full YouTube Data API key (at least 20 characters).");
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeDataApiKey: raw } });
  if (!r?.ok) {
    alert("Could not save.");
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  hasYoutubeApiKey = Boolean(r.hasYoutubeApiKey);
  const syk = document.getElementById("settingsYoutubeApiKey");
  if (syk) {
    syk.value = "";
    syk.placeholder = hasYoutubeApiKey ? "Key on file — enter only to replace" : "AIza…";
  }
  const sykh = document.getElementById("settingsYoutubeKeyHint");
  if (sykh) {
    sykh.textContent = hasYoutubeApiKey
      ? "A key is already saved on this device. Paste a new key only if you want to replace it."
      : "Paste your YouTube Data API v3 key from Google Cloud Console.";
  }
  if (st) st.textContent = "API key saved.";
});

document.getElementById("btnTestYoutubeApiKey")?.addEventListener("click", async () => {
  const key = document.getElementById("settingsYoutubeApiKey")?.value.trim() || "";
  const st = document.getElementById("youtubeApiKeyTestStatus");
  if (st) st.textContent = "Testing…";
  const r = await send("TUBESTACK_TEST_YOUTUBE_API_KEY", { apiKey: key });
  if (st) {
    st.textContent = r?.ok
      ? r.message || "Key works."
      : r?.message || r?.error || "Check the key and that YouTube Data API v3 is enabled.";
  }
});

document.getElementById("btnClearYoutubeApiKey")?.addEventListener("click", async () => {
  if (!confirm("Remove the saved YouTube Data API key from this device?")) return;
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeDataApiKey: "" } });
  if (!r?.ok) {
    alert("Could not clear.");
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  hasYoutubeApiKey = Boolean(r.hasYoutubeApiKey);
  const syk = document.getElementById("settingsYoutubeApiKey");
  if (syk) {
    syk.value = "";
    syk.placeholder = "AIza…";
  }
  const sykh = document.getElementById("settingsYoutubeKeyHint");
  if (sykh) {
    sykh.textContent = "Paste your YouTube Data API v3 key from Google Cloud Console.";
  }
  const st = document.getElementById("youtubeApiKeyTestStatus");
  if (st) st.textContent = "Stored API key removed.";
});

document.getElementById("btnEraseLocalLibrary")?.addEventListener("click", async () => {
  const st = document.getElementById("dataPrivacyStatus");
  const msg =
    "Delete ALL saved TubeStack library data on this device? This removes every saved video, locally tracked watch progress, daily watch tallies, all local playlist snapshots, import triage metadata, and the last YouTube channel scan summary. It does NOT remove your YouTube Data API key, OAuth Client ID, OpenAI API key, themes/categories, or the Subbed Channels list.";
  if (!confirm(msg)) return;
  const r = await send("TUBESTACK_ERASE_LOCAL_LIBRARY_DATA");
  if (!r?.ok) {
    if (st) st.textContent = "Could not erase library data.";
    return;
  }
  await loadState();
  const idSet = new Set(allItems.map((x) => x.id));
  for (const id of [...selected]) {
    if (!idSet.has(id)) selected.delete(id);
  }
  render();
  if (st) {
    st.classList.add("success");
    st.textContent = "Library data removed from this device.";
  }
});

document.getElementById("btnClearSubscriptionDirectory")?.addEventListener("click", async () => {
  const st = document.getElementById("dataPrivacyStatus");
  if (
    !confirm(
      "Clear the entire Subbed Channels list stored on this device? You can run “Sync subscriptions” again later to repopulate it from YouTube."
    )
  )
    return;
  const r = await send("TUBESTACK_CLEAR_SUBSCRIPTION_CHANNELS");
  if (!r?.ok) {
    if (st) st.textContent = "Could not clear subscription list.";
    return;
  }
  await loadState();
  render();
  if (st) {
    st.classList.add("success");
    st.textContent = "Subbed Channels list cleared.";
  }
});

document.getElementById("btnClearOpenaiClassifyCache")?.addEventListener("click", async () => {
  const st = document.getElementById("dataPrivacyStatus");
  if (
    !confirm(
      "Clear TubeStack’s local AI categorization cache? This deletes cached OpenAI classification results (title dedup helpers) from storage. Your saved videos, themes, and API keys are not removed."
    )
  )
    return;
  const r = await send("TUBESTACK_CLEAR_OPENAI_LOCAL_CACHE");
  if (!r?.ok) {
    if (st) st.textContent = "Could not clear AI cache.";
    return;
  }
  if (st) {
    st.classList.add("success");
    st.textContent = "AI categorization cache cleared.";
  }
});

document.getElementById("libShowYoutubeImported")?.addEventListener("change", async () => {
  const el = document.getElementById("libShowYoutubeImported");
  const v = Boolean(el?.checked);
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { libraryShowYoutubeImported: v } });
  if (!r?.ok) {
    alert("Could not save preference.");
    if (el) el.checked = !v;
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  renderLocalPlaylists();
  renderSidebarRecentTablists();
});

document.getElementById("btnImportYoutubePlaylists")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnImportYoutubePlaylists");
  if (btn) btn.disabled = true;
  try {
    await openYtPlaylistImportModal();
  } finally {
    if (btn) btn.disabled = false;
  }
});

btnExportYouTube?.addEventListener("click", () => {
  openYtExportModal();
});

ytExportModal?.addEventListener("click", (e) => {
  if (e.target === ytExportModal) closeYtExportModal();
});

document.getElementById("peCancel")?.addEventListener("click", () => closeYtExportModal());

async function savePlaylistLocalWithName(nameOverride = "") {
  const st = document.getElementById("peStatus");
  const btnL = document.getElementById("peSaveLocal");
  const btnA = document.getElementById("peSaveAs");
  const btnY = document.getElementById("peCreate");
  const title = (nameOverride || document.getElementById("peTitle")?.value || "").trim();
  const { items } = getPlaylistExportItemsFromModal();
  const snapshots = items.map(snapshotPlaylistItem).filter((x) => x.videoId || x.url);
  if (!snapshots.length) {
    if (st) {
      st.classList.remove("success");
      st.textContent = "No videos in this selection.";
    }
    return;
  }
  if (btnL) btnL.disabled = true;
  if (btnA) btnA.disabled = true;
  if (btnY) btnY.disabled = true;
  const r = await send("TUBESTACK_LOCAL_PLAYLIST_SAVE", {
    name: title,
    items: snapshots,
    playlistSource: "session",
  });
  if (btnL) btnL.disabled = false;
  if (btnA) btnA.disabled = false;
  if (btnY) btnY.disabled = false;
  if (!r?.ok) {
    if (st) {
      st.classList.remove("success");
      st.textContent = r?.error === "no_items" ? "No videos in this selection." : "Could not save locally.";
    }
    return;
  }
  localPlaylists = r.playlists || [];
  activeLocalPlaylistId = localPlaylists[0]?.id || activeLocalPlaylistId;
  currentPlaylistName = localPlaylists[0]?.name || title || currentPlaylistName;
  await persistCurrentPlaylistContext();
  syncSidebarCurrentPlaylistUi();
  playlistDraftDirty = false;
  renderLocalPlaylists();
  const savedName = localPlaylists[0]?.name || title || defaultLocalPlaylistName();
  if (st) {
    st.classList.add("success");
    st.textContent = `Saved “${savedName}” locally (${snapshots.length} videos).`;
  }
  setTimeout(() => closeYtExportModal(), 900);
}

document.getElementById("peSaveLocal")?.addEventListener("click", async () => {
  await savePlaylistLocalWithName();
});

document.getElementById("peSaveAs")?.addEventListener("click", async () => {
  const next = prompt("Save playlist as:", currentPlaylistName || defaultLocalPlaylistName());
  if (next == null) return;
  const name = String(next).trim();
  if (!name) return;
  const t = document.getElementById("peTitle");
  if (t) t.value = name;
  await savePlaylistLocalWithName(name);
});

localPlaylistList?.addEventListener("click", async (e) => {
  const actEl = e.target.closest("[data-action]");
  if (!actEl || !localPlaylistList.contains(actEl)) return;
  const row = actEl.closest(".local-pl-row");
  const id = row?.dataset.id;
  if (!id) return;
  const action = actEl.dataset.action;
  const nameInput = row.querySelector(".local-pl-name");

  if (action === "rename") {
    const name = nameInput?.value?.trim() || "";
    if (!name) {
      alert("Enter a name.");
      return;
    }
    const r = await send("TUBESTACK_LOCAL_PLAYLIST_RENAME", { id, name });
    if (!r?.ok) {
      alert(r?.error === "empty_name" ? "Name cannot be empty." : "Could not rename.");
      return;
    }
    localPlaylists = r.playlists || localPlaylists;
    if (id === activeLocalPlaylistId) {
      currentPlaylistName = name;
      await persistCurrentPlaylistContext();
      syncSidebarCurrentPlaylistUi();
      renderSidebarRecentTablists();
    }
    renderLocalPlaylists();
  } else if (action === "delete") {
    if (!confirm("Erase this local playlist? This cannot be undone.")) return;
    await eraseLocalPlaylist(id);
  } else if (action === "restore-session") {
    await restoreLocalPlaylistSessionById(id);
  } else if (action === "view") {
    activatePlaylistView(id, { replaceUrl: true });
    setActiveWindow("current");
  } else if (action === "toggle-yt") {
    const panel = row.querySelector(".local-pl-yt-panel");
    if (!panel) return;
    const willOpen = panel.classList.contains("hidden");
    localPlaylistList.querySelectorAll(".local-pl-yt-panel").forEach((p) => p.classList.add("hidden"));
    localPlaylistList.querySelectorAll(".local-pl-yt-toggle").forEach((b) => b.setAttribute("aria-expanded", "false"));
    localPlaylistList.querySelectorAll(".local-pl-yt-status").forEach((s) => {
      s.textContent = "";
      s.classList.remove("success");
    });
    if (willOpen) {
      panel.classList.remove("hidden");
      actEl.setAttribute("aria-expanded", "true");
    }
  } else if (action === "youtube") {
    const privacy = actEl.dataset.privacy;
    if (!["public", "private", "unlisted"].includes(privacy)) return;
    const pl = localPlaylists.find((x) => x.id === id);
    const items = pl?.items || [];
    const title = nameInput?.value?.trim() || pl?.name || "";
    const statusEl = row.querySelector(".local-pl-yt-status");
    const disableEls = [...row.querySelectorAll('.local-pl-yt-panel button[data-action="youtube"]')];
    const r = await runCreateYoutubePlaylistFromItems({
      title,
      description: "",
      privacyStatus: privacy,
      items,
      statusEl,
      disableEls,
    });
    if (!r?.ok) {
      if (statusEl) {
        statusEl.classList.remove("success");
        statusEl.textContent = formatYoutubeCreateErrorMessage(r);
      }
      return;
    }
    if (statusEl) {
      statusEl.classList.add("success");
      statusEl.textContent = `Created on YouTube: ${r.addedCount ?? 0} of ${r.requestedCount ?? items.length} videos.`;
    }
    currentPlaylistName = title || currentPlaylistName;
    syncSidebarCurrentPlaylistUi();
    playlistDraftDirty = false;
    if (r.playlistUrl) chrome.tabs.create({ url: r.playlistUrl, active: true });
    row.querySelector(".local-pl-yt-panel")?.classList.add("hidden");
    actEl.closest(".local-pl-yt-row")?.querySelector(".local-pl-yt-toggle")?.setAttribute("aria-expanded", "false");
  }
});

document.getElementById("peCreate")?.addEventListener("click", async () => {
  const st = document.getElementById("peStatus");
  const btn = document.getElementById("peCreate");
  const btnL = document.getElementById("peSaveLocal");
  const title = document.getElementById("peTitle")?.value.trim() || "";
  const description = document.getElementById("peDesc")?.value.trim() || "";
  const privacyEl = document.querySelector('input[name="pePrivacy"]:checked');
  const pv = privacyEl?.value;
  const privacyStatus = ["public", "private", "unlisted"].includes(pv) ? pv : "private";
  const { items } = getPlaylistExportItemsFromModal();

  const r = await runCreateYoutubePlaylistFromItems({
    title,
    description,
    privacyStatus,
    items,
    statusEl: st,
    disableEls: [btn, btnL].filter(Boolean),
  });

  if (!r?.ok) {
    if (st) {
      st.classList.remove("success");
      st.textContent = formatYoutubeCreateErrorMessage(r);
    }
    return;
  }

  if (st) {
    st.classList.add("success");
    st.textContent = `Created playlist with ${r.addedCount} of ${r.requestedCount} videos on YouTube.`;
  }
  currentPlaylistName = title || currentPlaylistName;
  syncSidebarCurrentPlaylistUi();
  playlistDraftDirty = false;
  if (r.playlistUrl) {
    chrome.tabs.create({ url: r.playlistUrl, active: true });
  }
  setTimeout(() => closeYtExportModal(), 900);
});

btnRestore.addEventListener("click", async () => {
  const ids = [...selected];
  if (!ids.length) {
    alert("Select at least one video.");
    return;
  }
  await send("TUBESTACK_RESTORE", { ids });
});

document.getElementById("btnRestorePlaylistSession")?.addEventListener("click", async () => {
  const pid = playlistViewMeta?.id;
  if (!pid) return;
  await restoreLocalPlaylistSessionById(pid);
});

document.getElementById("btnBulkWatchState")?.addEventListener("click", async () => {
  const ids = [...selected];
  const ws = document.getElementById("bulkWatchState")?.value || "";
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
  await loadState();
  render();
});

btnDelete.addEventListener("click", async () => {
  const ids = [...selected];
  if (!ids.length) {
    alert("Select at least one video.");
    return;
  }
  if (!confirm(`Remove ${ids.length} video(s) from TubeStack?`)) return;
  await send("TUBESTACK_DELETE_ITEMS", { ids });
  ids.forEach((id) => selected.delete(id));
  allItems = allItems.filter((x) => !ids.includes(x.id));
  render();
});

btnDeleteLocalPlaylist?.addEventListener("click", async () => {
  const id = activeLocalPlaylistId;
  if (!id) return;
  if (!confirm("Erase this local playlist? This cannot be undone.")) return;
  const ok = await eraseLocalPlaylist(id);
  if (!ok) return;
  document.getElementById("compactSavePanel")?.classList.add("hidden");
  document.getElementById("btnCompactSaveToggle")?.setAttribute("aria-expanded", "false");
});

btnAutoSort.addEventListener("click", async () => {
  const r = await send("TUBESTACK_RUN_AUTO_SORT");
  if (r?.ok) await loadState();
});

btnOnboarding.addEventListener("click", () => {
  oobeMinimalPath = false;
  populateOobeFields();
  clearScanUi();
  showObStep(0);
  refreshTabsSelect();
  renderObGenreTiles();
});

const btnDismissImportPanel = document.getElementById("btnDismissImportPanel");

btnDismissImportPanel?.addEventListener("click", async () => {
  await send("TUBESTACK_DISMISS_IMPORT_BATCH");
  settings.latestImportBatchId = null;
  latestKnownBatchId = null;
  latestImportHiddenGenres.clear();
  renderLatestImportPanel();
});

btnFocusStart.addEventListener("click", async () => {
  const minutes = Number(focusMinutes.value) || 25;
  const r = await send("TUBESTACK_SET_FOCUS", { minutes });
  if (r?.ok) {
    settings.focusSession = r.focusSession;
    updateFocusUi();
  }
});

btnFocusClear.addEventListener("click", async () => {
  const r = await send("TUBESTACK_SET_FOCUS", { minutes: 0 });
  if (r?.ok) {
    settings.focusSession = null;
    updateFocusUi();
  }
});

btnBuildPlaylist.addEventListener("click", async () => {
  const themeIds = [...playlistThemePick];
  if (!themeIds.length) {
    alert("Pick 1–5 categories.");
    return;
  }
  const budgetMinutes = Number(playlistBudget.value) || 15;
  const sortMode = playlistSort.value;
  const r = await send("TUBESTACK_BUILD_PLAYLIST", { themeIds, budgetMinutes, sortMode });
  if (!r?.ok) {
    alert(r?.error || "Could not build playlist.");
    return;
  }
  const q = r.queue || [];
  await loadState();
  const qSynced = q.map((it) => {
    const lib = allItems.find((x) => x.id === it.id);
    return lib ? { ...it, themeId: lib.themeId } : { ...it };
  });
  lastPlaylistQueue = qSynced.map((it) => ({ ...it }));
  playlistDraftDirty = qSynced.length > 0;
  if (!currentPlaylistName || currentPlaylistName === "Untitled Playlist") {
    currentPlaylistName = defaultLocalPlaylistName();
    syncSidebarCurrentPlaylistUi();
    void persistCurrentPlaylistContext();
  }
  renderPlaylistPackOutput(qSynced, budgetMinutes, r.estimatedSeconds);
});

document.getElementById("obNext0").addEventListener("click", () => showObStep(1));

document.getElementById("obOpenSetupGuide")?.addEventListener("click", () => {
  const url = chrome.runtime.getURL("dashboard/setup-guide.html");
  chrome.windows.create({ url, type: "normal", focused: true }, () => {
    if (chrome.runtime.lastError) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });
});

document.getElementById("obApiKey")?.addEventListener("input", () => {
  const btn = document.getElementById("obBtnTestApi");
  if (btn?.classList.contains("ob-api-test--testing")) {
    updateObApiTestButtonEnabled();
    return;
  }
  resetObApiTestUi();
});

document.getElementById("obBtnTestApi")?.addEventListener("click", async () => {
  const btn = document.getElementById("obBtnTestApi");
  const detail = document.getElementById("obApiTestDetail");
  const apiKey = document.getElementById("obApiKey")?.value.trim() || "";
  if (!btn) return;
  for (const c of OB_API_TEST_BTN_CLASSES) btn.classList.remove(c);
  btn.classList.add("ob-api-test--testing");
  btn.textContent = "Testing…";
  btn.disabled = true;
  if (detail) detail.textContent = "";
  const r = await send("TUBESTACK_TEST_YOUTUBE_API_KEY", { apiKey });
  for (const c of OB_API_TEST_BTN_CLASSES) btn.classList.remove(c);
  if (r?.ok) {
    btn.classList.add("ob-api-test--pass");
    btn.textContent = "✓ Pass!";
    if (detail) detail.textContent = r.message || "Key works.";
  } else {
    btn.classList.add("ob-api-test--fail");
    btn.textContent = "✗ Fail";
    if (detail) {
      detail.textContent = r?.message || r?.error || "Check the key and that YouTube Data API v3 is enabled.";
    }
  }
  btn.disabled = false;
  updateObApiTestButtonEnabled();
});

document.getElementById("obNextFromIntro")?.addEventListener("click", async () => {
  const localOnly = Boolean(document.getElementById("obLocalOnlyCheck")?.checked);
  if (localOnly) {
    const pr = await send("TUBESTACK_PATCH_SETTINGS", { patch: { personalizationMode: "staple" } });
    if (!pr?.ok) {
      alert("Could not save preference.");
      return;
    }
    if (pr.settings) settings = { ...settings, ...pr.settings };
    oobeMinimalPath = true;
    resetObApiTestUi();
    showObStep(5);
    renderObGenreTiles();
    return;
  }
  oobeMinimalPath = false;
  showObStep(2);
  resetObApiTestUi();
});

document.getElementById("obBtnCredContinue").addEventListener("click", async () => {
  const email = document.getElementById("obEmail")?.value.trim() || "";
  const apiKey = document.getElementById("obApiKey")?.value.trim() || "";
  if (!email.includes("@")) {
    alert("Enter the email associated with your Google Cloud / YouTube project.");
    return;
  }
  if (apiKey.length < 20 && !hasYoutubeApiKey) {
    alert("Paste your YouTube Data API key (at least 20 characters), or use local-only setup on the previous step.");
    return;
  }
  const payload = { email };
  if (apiKey.length >= 20) payload.apiKey = apiKey;
  const r = await send("TUBESTACK_SAVE_OOBE_CREDENTIALS", payload);
  if (!r?.ok) {
    alert("Could not save your details.");
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  hasYoutubeApiKey = Boolean(r.hasYoutubeApiKey);
  oobeMinimalPath = false;
  populateOobeFields();
  showObStep(3);
});

document.getElementById("obBtnOAuthSave")?.addEventListener("click", async () => {
  const v = document.getElementById("obOAuthClientId")?.value.trim() || "";
  const st = document.getElementById("obOAuthTestStatus");
  if (!v) {
    alert("Paste your OAuth 2.0 Client ID (Web application type).");
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeOAuthClientId: v } });
  if (!r?.ok) {
    alert("Could not save.");
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  const settingsOci = document.getElementById("oauthClientId");
  if (settingsOci) settingsOci.value = settings.youtubeOAuthClientId || "";
  const oo = document.getElementById("obOAuthClientId");
  if (oo) oo.value = settings.youtubeOAuthClientId || "";
  if (st) st.textContent = "Client ID saved.";
});

document.getElementById("obBtnTestOAuth")?.addEventListener("click", async () => {
  const v = document.getElementById("obOAuthClientId")?.value.trim() || "";
  const st = document.getElementById("obOAuthTestStatus");
  if (st) st.textContent = "Opening Google sign-in…";
  const r = await send("TUBESTACK_TEST_YOUTUBE_OAUTH", { youtubeOAuthClientId: v });
  if (st) {
    st.textContent = r?.ok ? r.message || "Sign-in OK." : r?.message || r?.error || "OAuth test failed.";
  }
});

document.getElementById("obSkipOAuth")?.addEventListener("click", () => {
  showObStep(4);
});

document.getElementById("obBtnOAuthContinue")?.addEventListener("click", () => {
  showObStep(4);
});

document.getElementById("obRunScan").addEventListener("click", async () => {
  const errEl = document.getElementById("obScanError");
  const prev = document.getElementById("obScanPreview");
  const nextBtn = document.getElementById("obNextScan");
  const handleRaw = document.getElementById("obHandle")?.value.trim() || "";
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.add("hidden");
  }
  if (!handleRaw) {
    if (errEl) {
      errEl.textContent = "Enter a channel @handle or URL first.";
      errEl.classList.remove("hidden");
    }
    return;
  }
  if (!hasYoutubeApiKey) {
    if (errEl) {
      errEl.textContent = "No API key on file — go back to the API key step or add one in Settings.";
      errEl.classList.remove("hidden");
    }
    return;
  }
  const pr = await send("TUBESTACK_PATCH_SETTINGS", { patch: { youtubeChannelHandle: handleRaw } });
  if (!pr?.ok) {
    if (errEl) {
      errEl.textContent = "Could not save channel handle.";
      errEl.classList.remove("hidden");
    }
    return;
  }
  if (pr.settings) settings = { ...settings, ...pr.settings };
  const r = await send("TUBESTACK_YOUTUBE_API_SCAN", { boostThemes: true });
  if (!r?.ok) {
    if (errEl) {
      errEl.textContent =
        r?.error === "missing_api_key"
          ? "No API key saved."
          : String(r?.error || r?.message || "Channel scan failed.");
      errEl.classList.remove("hidden");
    }
    return;
  }
  if (r.themes) {
    themes = r.themes;
    renderThemeSidebars();
    fillThemeFilter();
    renderObGenreTiles();
  }
  if (r.summary) settings.youtubeLastScanSummary = r.summary;
  if (prev && r.summary) {
    const s = r.summary;
    const cats = s.categoryBreakdown || {};
    const parts = Object.keys(cats)
      .map((id) => {
        const name = YT_CAT_NAMES[id] || `Category ${id}`;
        return `${escapeHtml(name)}: ${cats[id]}`;
      })
      .join(" · ");
    prev.innerHTML = `<div><strong>${escapeHtml(s.channelTitle || "")}</strong></div>
      <div class="ob-muted" style="margin-top:6px">Scanned at ${escapeHtml(s.scannedAt || "")}</div>
      <div style="margin-top:8px">${parts || "—"}</div>`;
    prev.classList.remove("hidden");
  }
  if (nextBtn) nextBtn.disabled = false;
});

document.getElementById("obSkipScan").addEventListener("click", () => {
  showObStep(5);
  renderObGenreTiles();
});

document.getElementById("obNextScan").addEventListener("click", () => {
  showObStep(5);
  renderObGenreTiles();
});

document.getElementById("obNextGenres").addEventListener("click", () => {
  showObStep(6);
});

document.getElementById("obOpenChannels").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.youtube.com/feed/channels", active: true });
});

document.getElementById("obPullChannels").addEventListener("click", async () => {
  const id = Number(obTabPick.value);
  if (!id) {
    obPullStatus.textContent = "Pick a YouTube tab first.";
    return;
  }
  obPullStatus.textContent = "Importing…";
  const scrape = await send("TUBESTACK_SCRAPE_TAB", { tabId: id });
  if (!scrape?.ok) {
    obPullStatus.textContent = scrape?.error || "Could not read that tab.";
    return;
  }
  const r = await send("TUBESTACK_MERGE_CHANNELS", { labels: scrape.channels || [] });
  obPullStatus.textContent = r?.ok ? `Added ${r.addedCount || 0} new theme(s) from channel names.` : "Merge failed.";
  if (r?.ok) {
    themes = r.themes;
    renderObGenreTiles();
    renderThemeSidebars();
    fillThemeFilter();
  }
});

document.getElementById("obFinish").addEventListener("click", async () => {
  await send("TUBESTACK_COMPLETE_ONBOARDING");
  await send("TUBESTACK_RUN_AUTO_SORT");
  settings.onboardingComplete = true;
  hideOnboarding();
  await loadState();
});

setInterval(() => {
  if (settings.focusSession?.endsAt) updateFocusUi();
}, 30000);

document.getElementById("btnRunOobeAgain")?.addEventListener("click", async () => {
  if (!confirm("Open the setup wizard again? Your saved videos and playlists stay on this device.")) return;
  const r = await send("TUBESTACK_RESET_ONBOARDING");
  if (!r?.ok) {
    alert("Could not reset the wizard flag.");
    return;
  }
  settings.onboardingComplete = false;
  populateOobeFields();
  clearScanUi();
  showObStep(0);
  await refreshTabsSelect();
  renderObGenreTiles();
});

document.getElementById("btnSubsYoutubeSync")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("subsImportStatus");
  if (statusEl) {
    statusEl.textContent = "Contacting YouTube…";
    statusEl.classList.remove("success");
  }
  const r = await send("TUBESTACK_YOUTUBE_SUBSCRIPTIONS_SYNC");
  if (!r?.ok) {
    if (statusEl) statusEl.textContent = r?.message || r?.error || "Sync failed.";
    return;
  }
  subscriptionChannels = Array.isArray(r.subscriptionChannels) ? r.subscriptionChannels : subscriptionChannels;
  if (statusEl) {
    statusEl.classList.add("success");
    statusEl.textContent = `Synced ${r.count ?? subscriptionChannels.length} channel(s).`;
  }
  renderSubscriptionDirectory();
});

const smartPlaylistModal = document.getElementById("smartPlaylistModal");

document.getElementById("btnSmartPlaylist")?.addEventListener("click", () => {
  fillSmartPlaylistThemeFilter();
  const spName = document.getElementById("spName");
  if (spName) spName.value = defaultLocalPlaylistName();
  syncSidebarCurrentPlaylistUi();
  const st = document.getElementById("spStatus");
  if (st) {
    st.textContent = "";
    st.classList.remove("success");
  }
  smartPlaylistModal?.classList.remove("hidden");
});

smartPlaylistModal?.addEventListener("click", (e) => {
  if (e.target === smartPlaylistModal) smartPlaylistModal.classList.add("hidden");
});

document.getElementById("spCancel")?.addEventListener("click", () => {
  smartPlaylistModal?.classList.add("hidden");
});

document.getElementById("spSave")?.addEventListener("click", async () => {
  const st = document.getElementById("spStatus");
  const name = document.getElementById("spName")?.value.trim() || "";
  const source = document.getElementById("spSource")?.value || "library";
  const groupBy = document.getElementById("spGroupBy")?.value || "channel";
  let items = getSmartPlaylistSourceItems(source);
  items = sortItemsForSmartGroupBy(items, groupBy);
  const snapshots = items.map(snapshotPlaylistItem).filter((x) => x.videoId || x.url);
  if (!snapshots.length) {
    if (st) {
      st.classList.remove("success");
      st.textContent = "No videos match this source and filters.";
    }
    return;
  }
  const smartSummary = `${source} · ${groupBy} · ${snapshots.length} videos`;
  const r = await send("TUBESTACK_LOCAL_PLAYLIST_SAVE", {
    name,
    items: snapshots,
    kind: "smart",
    groupBy,
    smartSummary,
    playlistSource: "session",
  });
  if (!r?.ok) {
    if (st) {
      st.classList.remove("success");
      st.textContent = r?.error === "no_items" ? "Nothing to save." : "Could not save.";
    }
    return;
  }
  localPlaylists = r.playlists || [];
  renderLocalPlaylists();
  if (st) {
    st.classList.add("success");
    st.textContent = `Saved smart playlist (${snapshots.length} videos).`;
  }
  setTimeout(() => smartPlaylistModal?.classList.add("hidden"), 700);
});

document.getElementById("btnSaveOpenaiKey")?.addEventListener("click", async () => {
  const raw = document.getElementById("settingsOpenaiKey")?.value.trim() || "";
  if (raw.length < 20) {
    alert("Paste a full OpenAI API key (sk-…), or leave blank.");
    return;
  }
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { openaiApiKey: raw } });
  if (!r?.ok) {
    alert("Could not save key.");
    return;
  }
  if (r.settings) settings = r.settings;
  hasOpenaiKey = Boolean(r.hasOpenaiKey);
  const oai = document.getElementById("settingsOpenaiKey");
  if (oai) {
    oai.value = "";
    oai.placeholder = "Key on file — enter only to replace";
  }
  alert("OpenAI key saved on this device.");
});

document.getElementById("btnClearOpenaiKey")?.addEventListener("click", async () => {
  if (!confirm("Remove the stored OpenAI API key from this device? It is deleted from chrome.storage.local only."))
    return;
  const r = await send("TUBESTACK_PATCH_SETTINGS", { patch: { openaiApiKey: "" } });
  if (!r?.ok) {
    alert("Could not clear key.");
    return;
  }
  if (r.settings) settings = { ...settings, ...r.settings };
  hasOpenaiKey = Boolean(r.hasOpenaiKey);
  const oai = document.getElementById("settingsOpenaiKey");
  if (oai) {
    oai.value = "";
    oai.placeholder = hasOpenaiKey ? "Key on file — enter only to replace" : "sk-… (optional)";
  }
  const st = document.getElementById("openaiTestStatus");
  if (st) {
    st.classList.remove("success");
    st.textContent = "Stored OpenAI API key removed.";
  }
});

document.getElementById("btnTestOpenaiConnection")?.addEventListener("click", async () => {
  const st = document.getElementById("openaiTestStatus");
  const raw = document.getElementById("settingsOpenaiKey")?.value.trim() || "";
  const keyToUse = raw.length >= 20 ? raw : undefined;
  if (!keyToUse && !hasOpenaiKey) {
    if (st) {
      st.classList.remove("success");
      st.textContent = "Paste an API key in the field above, or save one first.";
    }
    return;
  }
  if (st) {
    st.classList.remove("success");
    st.textContent = "Testing connection to OpenAI…";
  }
  const r = await send("TUBESTACK_TEST_OPENAI_CONNECTION", { openaiApiKey: keyToUse });
  if (!r?.ok) {
    if (st) st.textContent = r?.message || r?.error || "Test failed.";
    return;
  }
  const lines = [
    `API key accepted. Models list: ${r.modelCount ?? 0} entries.`,
    r.completionOk
      ? `Chat check OK${r.lastUsage?.total_tokens != null ? ` (test used ${r.lastUsage.total_tokens} tokens).` : "."}`
      : r.completionError
        ? `Chat check failed: ${r.completionError}`
        : "Chat check inconclusive.",
  ];
  if (r.rateLimits && Object.keys(r.rateLimits).length) {
    const rl = r.rateLimits;
    lines.push(
      `Rate limits (rolling window, not monthly quota): requests ${rl["x-ratelimit-remaining-requests"] ?? "—"} / ${rl["x-ratelimit-limit-requests"] ?? "—"} · tokens ${rl["x-ratelimit-remaining-tokens"] ?? "—"} / ${rl["x-ratelimit-limit-tokens"] ?? "—"}`
    );
    if (rl["x-ratelimit-reset-requests"]) lines.push(`Requests window resets: ${rl["x-ratelimit-reset-requests"]}`);
    if (rl["x-ratelimit-reset-tokens"]) lines.push(`Tokens window resets: ${rl["x-ratelimit-reset-tokens"]}`);
  } else {
    lines.push("No rate-limit headers on the test response.");
  }
  if (r.usageCredits && r.usageCredits.totalAvailable != null) {
    const a = Number(r.usageCredits.totalAvailable);
    const g = r.usageCredits.totalGranted != null ? Number(r.usageCredits.totalGranted) : null;
    const u = r.usageCredits.totalUsed != null ? Number(r.usageCredits.totalUsed) : null;
    lines.push(
      `Prepaid credits (billing snapshot): ≈$${a.toFixed(2)} available` +
        (g != null ? ` of $${g.toFixed(2)} granted` : "") +
        (u != null ? ` · $${u.toFixed(2)} used` : "") +
        "."
    );
  } else {
    lines.push(
      "Monthly / prepaid dollar balance was not returned for this key (OpenAI usually does not expose it via standard API keys)."
    );
  }
  if (st) {
    st.classList.add("success");
    st.textContent = lines.join("\n");
  }
});

const genreRebuildModal = document.getElementById("genreRebuildModal");

document.querySelectorAll('input[name="aiCatScope"]').forEach((el) => {
  el.addEventListener("change", () => updateAiCatScopeCount());
});
document.querySelectorAll('input[name="aiCatStrategy"]').forEach((el) => {
  el.addEventListener("change", () => {
    syncAiCategorizeStrategyUi();
    updateAiCatScopeCount();
  });
});
document.getElementById("aiCatTargetCount")?.addEventListener("input", () => updateAiCatScopeCount());

document.getElementById("btnRunAiCategorize")?.addEventListener("click", async () => {
  const status = document.getElementById("aiCatStatus");
  const scope = document.querySelector('input[name="aiCatScope"]:checked')?.value || "library";
  const strategy = document.querySelector('input[name="aiCatStrategy"]:checked')?.value || "discover";
  const itemIds = collectAiCategorizeItemIds(scope);
  if (!itemIds.length) {
    if (status) {
      status.classList.remove("success");
      status.textContent =
        scope === "selected" ? "Check videos in the grid first, or choose another scope." : "No videos to process.";
    }
    return;
  }
  if (strategy === "criteria") {
    const t = document.getElementById("aiCatCriteriaText")?.value.trim() || "";
    if (t.length < 8) {
      if (status) {
        status.classList.remove("success");
        status.textContent = "Add more detail under “Your criteria” (at least ~8 characters).";
      }
      return;
    }
  }
  if (
    !confirm(
      "This will send each selected video’s stored metadata (title, channel, list category, tags/notes when present — no transcripts or URLs) to OpenAI and may update category assignments. Your OpenAI key is used only on api.openai.com. Continue?"
    )
  ) {
    return;
  }
  const targetCategoryCount = Math.min(28, Math.max(2, Number(document.getElementById("aiCatTargetCount")?.value) || 8));
  const granularity = document.querySelector('input[name="aiCatGranularity"]:checked')?.value || "broad";
  const pasted = document.getElementById("aiCatOpenaiKey")?.value.trim() || "";
  const saveOpenaiKey = document.getElementById("aiCatSaveKey")?.checked === true;
  if (status) {
    status.classList.remove("success");
    status.textContent = "Calling OpenAI…";
  }
  const r = await send("TUBESTACK_AI_CATEGORIZE_LIBRARY", {
    itemIds,
    strategy,
    criteriaText: document.getElementById("aiCatCriteriaText")?.value || "",
    targetCategoryCount,
    granularity,
    openaiApiKey: pasted || undefined,
    saveOpenaiKey: saveOpenaiKey && pasted.length >= 20,
  });
  if (!r?.ok) {
    if (status) status.textContent = r?.message || r?.error || "Request failed.";
    return;
  }
  await loadState();
  if (status) {
    status.classList.add("success");
    const extra = r.truncated ? " (input list was capped at 120.)" : "";
    const added = r.newThemesCount ? ` ${r.newThemesCount} new categories added.` : "";
    status.textContent = `Updated ${r.updatedCount ?? 0} video(s).${added}${extra}`;
  }
  const oai = document.getElementById("aiCatOpenaiKey");
  if (oai && saveOpenaiKey) oai.value = "";
});

document.getElementById("btnRunAiWatchStates")?.addEventListener("click", async () => {
  const status = document.getElementById("aiWsStatus");
  const applyBtn = document.getElementById("btnApplyAiWatchStates");
  const scope = document.querySelector('input[name="aiCatScope"]:checked')?.value || "library";
  const itemIds = collectAiCategorizeItemIds(scope);
  if (!itemIds.length) {
    if (status) status.textContent = scope === "selected" ? "Check videos in the grid first." : "No videos to process.";
    return;
  }
  if (
    !confirm(
      "Send stored metadata for these videos to OpenAI to suggest Watch States (not tags)? Suggestions are applied only if you click Apply afterward."
    )
  ) {
    return;
  }
  const pasted = document.getElementById("aiCatOpenaiKey")?.value.trim() || "";
  const saveOpenaiKey = document.getElementById("aiCatSaveKey")?.checked === true;
  if (status) status.textContent = "Calling OpenAI…";
  const r = await send("TUBESTACK_AI_SUGGEST_WATCH_STATES", {
    itemIds,
    playlistId: playlistViewMeta?.id || activeLocalPlaylistId || undefined,
    openaiApiKey: pasted || undefined,
    saveOpenaiKey: saveOpenaiKey && pasted.length >= 20,
  });
  if (!r?.ok) {
    if (status) status.textContent = r?.message || r?.error || "Request failed.";
    applyBtn?.classList.add("hidden");
    return;
  }
  pendingAiWatchSuggestions = r.suggestions || [];
  const lines = pendingAiWatchSuggestions.slice(0, 8).map((s) => {
    const lab = TS_WATCH ? TS_WATCH.watchStateLabel(s.suggestedWatchState) : s.suggestedWatchState;
    return `${s.videoId}: ${lab}${s.reason ? ` — ${s.reason}` : ""}`;
  });
  if (status) {
    status.textContent =
      (lines.length ? `${lines.join("\n")}${pendingAiWatchSuggestions.length > 8 ? "\n…" : ""}` : "No suggestions returned.") +
      (r.truncated ? "\n(Input was capped.)" : "");
  }
  applyBtn?.classList.toggle("hidden", !pendingAiWatchSuggestions.length);
});

document.getElementById("btnApplyAiWatchStates")?.addEventListener("click", async () => {
  const status = document.getElementById("aiWsStatus");
  if (!pendingAiWatchSuggestions.length) return;
  if (!confirm(`Apply ${pendingAiWatchSuggestions.length} suggested Watch State(s)? Tags are not changed unless you edit them separately.`)) {
    return;
  }
  const r = await send("TUBESTACK_APPLY_WATCH_STATE_SUGGESTIONS", {
    suggestions: pendingAiWatchSuggestions,
    applyWatchState: true,
    applyTags: false,
  });
  if (!r?.ok) {
    if (status) status.textContent = r?.error || "Could not apply suggestions.";
    return;
  }
  pendingAiWatchSuggestions = [];
  document.getElementById("btnApplyAiWatchStates")?.classList.add("hidden");
  await loadState();
  if (status) status.textContent = `Applied Watch State to ${r.updatedCount ?? 0} video(s).`;
  render();
});

document.getElementById("btnGenreRebuild")?.addEventListener("click", () => {
  const st = document.getElementById("grStatus");
  if (st) {
    st.textContent = "";
    st.classList.remove("success");
  }
  genreRebuildModal?.classList.remove("hidden");
});

genreRebuildModal?.addEventListener("click", (e) => {
  if (e.target === genreRebuildModal) genreRebuildModal.classList.add("hidden");
});

document.getElementById("grCancel")?.addEventListener("click", () => {
  genreRebuildModal?.classList.add("hidden");
});

document.getElementById("grRun")?.addEventListener("click", async () => {
  const st = document.getElementById("grStatus");
  const mode = document.getElementById("grMode")?.value || "heuristic";
  const replace = document.getElementById("grReplace")?.checked !== false;
  const saveKey = document.getElementById("grSaveKey")?.checked === true;
  const pasted = document.getElementById("grOpenaiKey")?.value.trim() || "";
  if (!replace) {
    if (st) st.textContent = "Merge mode is not implemented yet — enable “Replace” for a full rebuild.";
    return;
  }
  const openAiMode = mode === "openai";
  if (
    !confirm(
      openAiMode
        ? "This replaces all category chips and re-tags your library. OpenAI mode sends batched video titles (and optional channel names from your saved library) to api.openai.com only — no transcripts, Google keys, or OAuth tokens. Continue?"
        : "This replaces all category chips and re-tags your library from titles in your saved library. Continue?"
    )
  ) {
    return;
  }
  if (st) {
    st.classList.remove("success");
    st.textContent = "Rebuilding categories from your library…";
  }
  const r = await send("TUBESTACK_REBUILD_GENRES_FROM_LIBRARY", {
    mode,
    replaceExisting: replace,
    openaiApiKey: pasted || undefined,
    saveOpenaiKey: saveKey && pasted.length >= 20,
  });
  if (!r?.ok) {
    if (st) {
      st.textContent =
        r?.error === "empty_library"
          ? r?.message || "Save some videos to your library first."
          : r?.message || r?.error || "Rebuild failed.";
    }
    return;
  }
  themes = r.themes || themes;
  if (st) {
    st.classList.add("success");
    st.textContent = `Done: ${r.libraryVideos || 0} library videos · ${r.userNiches || 0} niche categories (${r.mode}).`;
  }
  renderThemeSidebars();
  fillThemeFilter();
  renderObGenreTiles();
  await loadState();
  setTimeout(() => genreRebuildModal?.classList.add("hidden"), 1200);
});

async function bootDashboard() {
  const runOobe = new URLSearchParams(window.location.search).get("runOobe") === "1";
  if (runOobe) {
    await send("TUBESTACK_RESET_ONBOARDING");
    history.replaceState({}, "", "dashboard.html");
  }
  await loadState();
}

/** When playlists or settings change in another tab/page, stay in sync without a full reload. */
async function syncDashboardFromExtensionStorage() {
  const r = await send("TUBESTACK_GET_STATE");
  if (!r?.ok) return;
  settings = r.settings || {};
  localPlaylists = Array.isArray(r.localPlaylists) ? r.localPlaylists : [];
  if (settings.currentPlaylistName) currentPlaylistName = settings.currentPlaylistName;
  const savedCtxId = String(settings.currentPlaylistId || "").trim();
  if (savedCtxId && localPlaylists.some((x) => x.id === savedCtxId)) activeLocalPlaylistId = savedCtxId;
  syncPlaylistViewFromUrl();
  syncSidebarCurrentPlaylistUi();
  updateFocusUi();
  renderLocalPlaylists();
  renderSidebarRecentTablists();
  render();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes.localPlaylists && !changes.settings) return;
  void syncDashboardFromExtensionStorage();
});

void bootDashboard();
