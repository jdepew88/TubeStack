/**
 * TubeStack Watch States + note/time helpers (browser + service worker via globalThis).
 */
(function (root) {
  const WATCH_STATE_LIST = [
    { id: "queue", label: "Queue" },
    { id: "watching", label: "Watching" },
    { id: "saved", label: "Saved" },
    { id: "finished", label: "Finished" },
    { id: "important", label: "Important" },
    { id: "reference", label: "Reference" },
    { id: "skip", label: "Skip" },
    { id: "add_to_playlist", label: "Add to Playlist" },
  ];

  const WATCH_STATE_IDS = new Set(WATCH_STATE_LIST.map((x) => x.id));
  const DEFAULT_WATCH_STATE = "queue";

  const LEGACY_WATCH_STATE = {
    watch_later: "queue",
    must_watch: "queue",
    watching_now: "watching",
    in_progress: "watching",
    saved: "saved",
    watched: "finished",
    done: "finished",
    complete: "finished",
    completed: "finished",
    archive: "reference",
    reference: "reference",
    skip: "skip",
    dropped: "skip",
    important: "important",
  };

  function normalizeWatchStateId(value) {
    const v = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (WATCH_STATE_IDS.has(v)) return v;
    if (LEGACY_WATCH_STATE[v]) return LEGACY_WATCH_STATE[v];
    return DEFAULT_WATCH_STATE;
  }

  function watchStateLabel(id) {
    const row = WATCH_STATE_LIST.find((x) => x.id === normalizeWatchStateId(id));
    return row ? row.label : "Queue";
  }

  function itemNoteText(item) {
    if (!item || typeof item !== "object") return "";
    const n = item.note != null ? String(item.note) : "";
    if (n.trim()) return n.trim();
    return String(item.notes || "").trim();
  }

  function normalizeTimestampNotes(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const note = String(row.note || "").trim();
      if (!note) continue;
      const sec = Number(row.timeSeconds);
      if (!Number.isFinite(sec) || sec < 0) continue;
      out.push({
        id: String(row.id || "").trim() || `tn_${Math.random().toString(36).slice(2, 11)}`,
        timeSeconds: Math.floor(sec),
        label: row.label != null ? String(row.label).slice(0, 80) : "",
        note: note.slice(0, 2000),
        createdAt: String(row.createdAt || new Date().toISOString()),
        updatedAt: row.updatedAt != null ? String(row.updatedAt) : undefined,
      });
    }
    return out.slice(0, 80);
  }

  function normalizeDecisions(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const title = String(row.title || "").trim();
      if (!title) continue;
      out.push({
        id: String(row.id || "").trim() || `dec_${Math.random().toString(36).slice(2, 11)}`,
        title: title.slice(0, 200),
        reason: row.reason != null ? String(row.reason).slice(0, 2000) : "",
        createdAt: String(row.createdAt || new Date().toISOString()),
        updatedAt: row.updatedAt != null ? String(row.updatedAt) : undefined,
      });
    }
    return out.slice(0, 100);
  }

  function completionRatio(item, progressMap) {
    if (!item?.videoId || !progressMap) return null;
    const p = progressMap[item.videoId];
    if (!p || p.durationSec == null || p.durationSec <= 0) return null;
    const watched = Number(p.totalWatchedSec || p.playheadSec || 0);
    return Math.min(1, Math.max(0, watched / Number(p.durationSec)));
  }

  function normalizeLibraryItemFields(item, progressMap) {
    let changed = false;
    if (!item || typeof item !== "object") return changed;

    const note = itemNoteText(item);
    if (item.note !== note) {
      item.note = note;
      changed = true;
    }
    if (item.notes !== note) {
      item.notes = note;
      changed = true;
    }

    const nextWs = item.watchState
      ? normalizeWatchStateId(item.watchState)
      : (() => {
          const ratio = completionRatio(item, progressMap);
          if (ratio != null && ratio >= 0.92) return "finished";
          return DEFAULT_WATCH_STATE;
        })();
    if (item.watchState !== nextWs) {
      item.watchState = nextWs;
      changed = true;
    }

    const ts = normalizeTimestampNotes(item.timestampNotes);
    const prevJson = JSON.stringify(item.timestampNotes || []);
    const nextJson = JSON.stringify(ts);
    if (prevJson !== nextJson) {
      item.timestampNotes = ts;
      changed = true;
    }

    if (!Array.isArray(item.tags)) {
      item.tags = [];
      changed = true;
    }

    return changed;
  }

  function normalizeLocalPlaylistFields(pl) {
    let changed = false;
    if (!pl || typeof pl !== "object") return changed;
    if (pl.stackNote == null) pl.stackNote = "";
    else pl.stackNote = String(pl.stackNote).slice(0, 8000);
    if (pl.researchSummary == null) pl.researchSummary = "";
    else pl.researchSummary = String(pl.researchSummary).slice(0, 12000);
    const dec = normalizeDecisions(pl.decisions);
    const decJson = JSON.stringify(dec);
    if (JSON.stringify(pl.decisions || []) !== decJson) {
      pl.decisions = dec;
      changed = true;
    }
    return changed;
  }

  function parseTimeInputToSeconds(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Math.max(0, parseInt(raw, 10));
    const parts = raw.split(":").map((x) => x.trim());
    if (parts.length === 2) {
      const m = parseInt(parts[0], 10);
      const s = parseInt(parts[1], 10);
      if (Number.isFinite(m) && Number.isFinite(s)) return Math.max(0, m * 60 + s);
    }
    if (parts.length === 3) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const s = parseInt(parts[2], 10);
      if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) return Math.max(0, h * 3600 + m * 60 + s);
    }
    return null;
  }

  function formatTimeSeconds(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function buildYoutubeTimestampUrl(item, timeSeconds) {
    const vid = String(item?.videoId || "").trim();
    const t = Math.max(0, Math.floor(Number(timeSeconds) || 0));
    if (vid && /^[\w-]{11}$/.test(vid)) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}&t=${t}s`;
    }
    try {
      const u = new URL(String(item?.url || ""));
      if (t > 0) {
        u.searchParams.set("t", `${t}s`);
      }
      return u.toString();
    } catch {
      return String(item?.url || "#");
    }
  }

  root.TUBESTACK_WATCH = {
    WATCH_STATE_LIST,
    WATCH_STATE_IDS,
    DEFAULT_WATCH_STATE,
    normalizeWatchStateId,
    watchStateLabel,
    itemNoteText,
    normalizeTimestampNotes,
    normalizeDecisions,
    normalizeLibraryItemFields,
    normalizeLocalPlaylistFields,
    parseTimeInputToSeconds,
    formatTimeSeconds,
    buildYoutubeTimestampUrl,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
