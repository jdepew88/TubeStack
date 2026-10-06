/**
 * TubeStack backup format: build, validate, migrate, and plan a restore (browser + service worker via globalThis).
 *
 * Pure functions only — nothing here touches chrome.storage. The service worker owns reads/writes
 * (under its library lock); the dashboard uses the same validator to preview a file before anything
 * is written. The worker always re-validates, so a page can never push an unchecked backup into storage.
 *
 *   parse text → identify format → check version → migrate to current shape → validate → preview → apply
 */
(function (root) {
  const FORMAT = "tubestack-backup";
  const CURRENT_VERSION = 1;

  /** Durable user data in chrome.storage.local. Every key here is written on restore (missing → empty). */
  const DATA_KEYS = ["items", "localPlaylists", "themes", "videoProgress", "watchByDay", "subscriptionChannels", "settings"];
  const ARRAY_KEYS = new Set(["items", "localPlaylists", "themes", "subscriptionChannels"]);
  const OBJECT_KEYS = new Set(["videoProgress", "watchByDay", "settings"]);

  /**
   * chrome.storage.local keys deliberately left out of backups:
   *  - saveOperations / metadataRepairState: in-flight save records and retry counters for this install.
   *  - sidebarPlayback: live side-panel queue session bound to an open tab.
   *  - openAiLibraryClassifyV1 (+ legacy openAiHistoryClassifyV1): rebuildable AI response cache.
   */
  const EXCLUDED_STORAGE_KEYS = [
    "saveOperations",
    "metadataRepairState",
    "sidebarPlayback",
    "openAiLibraryClassifyV1",
    "openAiHistoryClassifyV1",
  ];
  /** Reset on restore because they point at playlists/tabs of the library being replaced. */
  const RESET_ON_RESTORE = { sidebarPlayback: null };

  /** Credentials and account identity: never exported, and kept from the destination on restore. */
  const SECRET_SETTINGS_KEYS = ["youtubeDataApiKey", "openaiApiKey", "youtubeOAuthClientId", "youtubeAccountEmail"];
  /** Per-install state tied to the credentials above (or to this session); also kept from the destination. */
  const INSTALL_SETTINGS_KEYS = [
    "youtubeApiLastTestAt",
    "youtubeApiLastTestOk",
    "youtubeOAuthLastTestAt",
    "youtubeOAuthLastTestOk",
    "openaiLastTestAt",
    "openaiLastTestOk",
    "focusSession",
  ];
  /** Belt and braces: any future settings field that looks like a credential is excluded too. */
  const SECRET_NAME_PATTERN = /(api_?key|secret|token|password|passwd|credential|refresh|bearer|oauth|client_?id|cookie|session_?id)/i;

  /** Per-page layout preferences kept in each extension page's localStorage (all non-secret, `ts_` prefixed). */
  const UI_PREF_PREFIX = "ts_";
  const UI_PREF_MAX_KEYS = 64;
  const UI_PREF_MAX_LEN = 200;

  const VALID_THEME_TIERS = new Set(["off", "active", "favorite"]);
  const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const MAX_ERRORS = 25;
  const MAX_WARNINGS = 25;

  const MIGRATIONS = {
    // Example shape for the next schema bump — each step takes version N and returns version N+1:
    // 1: (backup) => ({ ...backup, version: 2, data: { ...backup.data, newField: [] } }),
  };

  function isPlainObject(v) {
    return v != null && typeof v === "object" && !Array.isArray(v);
  }

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function isExcludedSettingKey(key) {
    return SECRET_SETTINGS_KEYS.includes(key) || INSTALL_SETTINGS_KEYS.includes(key) || SECRET_NAME_PATTERN.test(key);
  }

  /** Copy of `settings` without credentials or per-install fields. */
  function sanitizeSettings(settings) {
    const out = {};
    if (!isPlainObject(settings)) return out;
    for (const [k, v] of Object.entries(settings)) {
      if (isExcludedSettingKey(k)) continue;
      out[k] = clone(v);
    }
    return out;
  }

  function sanitizeUiPreferences(prefs) {
    const out = {};
    if (!isPlainObject(prefs)) return out;
    let n = 0;
    for (const [k, v] of Object.entries(prefs)) {
      if (n >= UI_PREF_MAX_KEYS) break;
      if (!k.startsWith(UI_PREF_PREFIX) || k.length > 80) continue;
      if (typeof v !== "string" || v.length > UI_PREF_MAX_LEN) continue;
      if (isExcludedSettingKey(k)) continue;
      out[k] = v;
      n++;
    }
    return out;
  }

  function itemNoteText(item) {
    const n = item?.note != null ? String(item.note).trim() : "";
    return n || String(item?.notes || "").trim();
  }

  /** Counts shown before export and in the import preview. Computed from data, never trusted from the file. */
  function summarize(data) {
    const d = isPlainObject(data) ? data : {};
    const items = Array.isArray(d.items) ? d.items : [];
    const lists = Array.isArray(d.localPlaylists) ? d.localPlaylists : [];
    const themes = Array.isArray(d.themes) ? d.themes : [];
    const progress = isPlainObject(d.videoProgress) ? d.videoProgress : {};
    const days = isPlainObject(d.watchByDay) ? d.watchByDay : {};
    const subs = Array.isArray(d.subscriptionChannels) ? d.subscriptionChannels : [];
    let videosWithNotes = 0;
    let timestampNotes = 0;
    let finishedVideos = 0;
    for (const it of items) {
      if (!isPlainObject(it)) continue;
      if (itemNoteText(it)) videosWithNotes++;
      if (Array.isArray(it.timestampNotes)) timestampNotes += it.timestampNotes.length;
      if (it.watchState === "finished") finishedVideos++;
    }
    let playlistEntries = 0;
    let playlistsWithNotes = 0;
    for (const pl of lists) {
      if (!isPlainObject(pl)) continue;
      if (Array.isArray(pl.items)) playlistEntries += pl.items.length;
      if (
        isNonEmptyString(pl.stackNote) ||
        isNonEmptyString(pl.researchSummary) ||
        (Array.isArray(pl.decisions) && pl.decisions.length)
      ) {
        playlistsWithNotes++;
      }
    }
    return {
      videos: items.length,
      playlists: lists.length,
      playlistEntries,
      playlistsWithNotes,
      categories: themes.length,
      favoriteCategories: themes.filter((t) => t?.tier === "active").length,
      superFavoriteCategories: themes.filter((t) => t?.tier === "favorite").length,
      videosWithNotes,
      timestampNotes,
      finishedVideos,
      videosWithProgress: Object.keys(progress).length,
      watchDays: Object.keys(days).length,
      subscriptionChannels: subs.length,
      settings: isPlainObject(d.settings) ? Object.keys(d.settings).length : 0,
      uiPreferences: isPlainObject(d.uiPreferences) ? Object.keys(d.uiPreferences).length : 0,
    };
  }

  /**
   * @param {object} opts
   * @param {object} opts.storage       raw chrome.storage.local values for DATA_KEYS
   * @param {string} [opts.appVersion]  manifest version of the exporting install
   * @param {string} [opts.exportedAt]  ISO timestamp
   * @param {object} [opts.uiPreferences] `ts_*` localStorage values from the exporting page
   */
  function buildBackup({ storage, appVersion, exportedAt, uiPreferences } = {}) {
    const src = isPlainObject(storage) ? storage : {};
    const data = {};
    for (const k of DATA_KEYS) {
      if (k === "settings") data.settings = sanitizeSettings(src.settings);
      else if (ARRAY_KEYS.has(k)) data[k] = Array.isArray(src[k]) ? clone(src[k]) : [];
      else data[k] = isPlainObject(src[k]) ? clone(src[k]) : {};
    }
    data.uiPreferences = sanitizeUiPreferences(uiPreferences);
    return {
      format: FORMAT,
      version: CURRENT_VERSION,
      exportedAt: exportedAt || new Date().toISOString(),
      app: { name: "TubeStack", version: appVersion ? String(appVersion) : null },
      notice:
        "TubeStack library backup created locally at the user's request. Contains saved videos, playlists, " +
        "categories, notes, watch progress, and non-secret preferences. Does not contain API keys, OAuth Client " +
        "IDs, account email, or Google sign-in tokens.",
      excludedSettings: [...SECRET_SETTINGS_KEYS, ...INSTALL_SETTINGS_KEYS],
      counts: summarize(data),
      data,
    };
  }

  /** Walk the version chain up to CURRENT_VERSION. Returns { ok, backup } or { ok: false, error }. */
  function migrateBackup(backup) {
    let cur = backup;
    let guard = 0;
    while (cur.version < CURRENT_VERSION) {
      const step = MIGRATIONS[cur.version];
      if (typeof step !== "function" || guard++ > 50) {
        return { ok: false, error: `No migration path from backup version ${cur.version}.` };
      }
      cur = step(cur);
    }
    return { ok: true, backup: cur };
  }

  /** Structural checks on the current-version `data`. Errors block import; warnings are shown in the preview. */
  function validateData(data) {
    const errors = [];
    const warnings = [];
    const err = (m) => errors.length < MAX_ERRORS && errors.push(m);
    const warn = (m) => warnings.length < MAX_WARNINGS && warnings.push(m);

    if (!isPlainObject(data)) {
      err("Backup has no data section.");
      return { errors, warnings };
    }
    for (const k of ["items", "localPlaylists", "themes"]) {
      if (!Array.isArray(data[k])) err(`"${k}" is missing or is not a list.`);
    }
    for (const k of ["subscriptionChannels"]) {
      if (data[k] !== undefined && !Array.isArray(data[k])) err(`"${k}" must be a list.`);
    }
    for (const k of ["videoProgress", "watchByDay", "settings", "uiPreferences"]) {
      if (data[k] !== undefined && !isPlainObject(data[k])) err(`"${k}" must be an object.`);
    }
    if (errors.length) return { errors, warnings };

    const checkIds = (rows, label) => {
      const seen = new Set();
      const ids = new Set();
      rows.forEach((row, i) => {
        if (!isPlainObject(row)) {
          err(`${label} #${i + 1} is not an object.`);
          return;
        }
        if (!isNonEmptyString(row.id)) {
          err(`${label} #${i + 1} has no id.`);
          return;
        }
        if (seen.has(row.id)) err(`${label} id "${row.id}" appears more than once.`);
        seen.add(row.id);
        ids.add(row.id);
      });
      return ids;
    };

    const itemIds = checkIds(data.items, "Video");
    data.items.forEach((it, i) => {
      if (!isPlainObject(it)) return;
      const hasVid = isNonEmptyString(it.videoId);
      const hasUrl = isNonEmptyString(it.url);
      if (!hasVid && !hasUrl) err(`Video #${i + 1} has neither a videoId nor a URL.`);
      if (hasVid && !YT_ID_RE.test(it.videoId)) warn(`Video #${i + 1} has an unusual videoId "${String(it.videoId).slice(0, 20)}".`);
      if (it.tags !== undefined && !Array.isArray(it.tags)) err(`Video #${i + 1} has malformed tags.`);
      if (it.timestampNotes !== undefined && !Array.isArray(it.timestampNotes)) {
        err(`Video #${i + 1} has malformed timestamp notes.`);
      }
    });

    const playlistIds = checkIds(data.localPlaylists, "Playlist");
    data.localPlaylists.forEach((pl, i) => {
      if (!isPlainObject(pl)) return;
      if (pl.items !== undefined && !Array.isArray(pl.items)) {
        err(`Playlist #${i + 1} has a malformed video list.`);
        return;
      }
      (pl.items || []).forEach((snap, j) => {
        if (!isPlainObject(snap)) err(`Playlist #${i + 1}, entry #${j + 1} is not an object.`);
      });
      if (pl.decisions !== undefined && !Array.isArray(pl.decisions)) err(`Playlist #${i + 1} has malformed decisions.`);
    });

    const themeIds = checkIds(data.themes, "Category");
    data.themes.forEach((t, i) => {
      if (!isPlainObject(t)) return;
      if (typeof t.label !== "string") err(`Category #${i + 1} has no label.`);
      if (t.tier !== undefined && !VALID_THEME_TIERS.has(t.tier)) warn(`Category "${t.label}" has unknown tier "${t.tier}".`);
      if (t.keywords !== undefined && !Array.isArray(t.keywords)) err(`Category #${i + 1} has malformed keywords.`);
    });

    for (const [vid, rec] of Object.entries(data.videoProgress || {})) {
      if (!isPlainObject(rec)) err(`Watch progress for "${vid.slice(0, 20)}" is malformed.`);
    }
    for (const [day, sec] of Object.entries(data.watchByDay || {})) {
      if (typeof sec !== "number" || !Number.isFinite(sec)) err(`Daily watch total for "${day.slice(0, 20)}" is not a number.`);
    }
    (data.subscriptionChannels || []).forEach((row, i) => {
      if (!isPlainObject(row)) err(`Subbed channel #${i + 1} is not an object.`);
    });

    // Relationships: dangling references are tolerated by the app, so they warn rather than block.
    if (!errors.length) {
      const danglingTheme = data.items.filter((it) => isNonEmptyString(it.themeId) && !themeIds.has(it.themeId)).length;
      if (danglingTheme) warn(`${danglingTheme} video(s) point to a category that is not in the backup.`);
      let danglingEntry = 0;
      for (const pl of data.localPlaylists) {
        for (const snap of pl.items || []) {
          if (isNonEmptyString(snap.itemId) && !itemIds.has(snap.itemId)) danglingEntry++;
        }
      }
      if (danglingEntry) warn(`${danglingEntry} playlist entr(ies) refer to videos no longer in the library.`);
      const curPl = data.settings?.currentPlaylistId;
      if (isNonEmptyString(curPl) && !playlistIds.has(curPl)) warn("The selected queue in settings is not in the backup.");
    }
    return { errors, warnings };
  }

  /**
   * Validate (and migrate) an already-parsed backup object.
   * @returns {{ ok: boolean, code?: string, errors: string[], warnings: string[], backup?: object, summary?: object, meta?: object }}
   */
  function validateBackup(obj) {
    const fail = (code, msg) => ({ ok: false, code, errors: [msg], warnings: [] });
    if (!isPlainObject(obj)) return fail("not_tubestack", "This file is not a TubeStack backup.");
    if (obj.format !== FORMAT) return fail("not_tubestack", "This file is not a TubeStack backup (missing TubeStack backup identifier).");
    const v = obj.version;
    if (!Number.isInteger(v) || v < 1) return fail("bad_version", "This TubeStack backup has an invalid schema version.");
    if (v > CURRENT_VERSION) {
      return fail(
        "unsupported_version",
        `This backup was made by a newer TubeStack (backup format v${v}; this install reads up to v${CURRENT_VERSION}). Update TubeStack and try again.`
      );
    }
    const mig = migrateBackup(clone(obj));
    if (!mig.ok) return fail("bad_version", mig.error);
    const backup = mig.backup;
    const { errors, warnings } = validateData(backup.data);
    const meta = {
      version: v,
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : null,
      appVersion: isPlainObject(obj.app) && obj.app.version != null ? String(obj.app.version) : null,
    };
    if (errors.length) return { ok: false, code: "malformed", errors, warnings, meta };
    const summary = summarize(backup.data);
    if (isPlainObject(obj.counts) && v === CURRENT_VERSION) {
      const changed = ["videos", "playlists", "categories"].filter(
        (k) => obj.counts[k] != null && obj.counts[k] !== summary[k]
      );
      if (changed.length) warnings.push("The backup’s recorded counts differ from its contents — it may have been edited by hand.");
    }
    return { ok: true, errors: [], warnings, backup, summary, meta };
  }

  /** Parse file text, then validate. Never throws. */
  function parseBackupText(text) {
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, code: "empty", errors: ["The selected file is empty."], warnings: [] };
    }
    let obj;
    try {
      obj = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      return { ok: false, code: "invalid_json", errors: ["The selected file is not valid JSON (it may be truncated or corrupted)."], warnings: [] };
    }
    return validateBackup(obj);
  }

  /**
   * The exact chrome.storage.local write for a restore. Settings come from the backup, except credentials
   * and per-install fields, which are carried over from the destination so a restore never signs you out
   * or deletes keys you configured on this install.
   */
  function buildRestoreWrite(data, currentSettings) {
    const write = {};
    for (const k of DATA_KEYS) {
      if (k === "settings") continue;
      if (ARRAY_KEYS.has(k)) write[k] = Array.isArray(data[k]) ? clone(data[k]) : [];
      else if (OBJECT_KEYS.has(k)) write[k] = isPlainObject(data[k]) ? clone(data[k]) : {};
    }
    const settings = sanitizeSettings(data.settings);
    if (isPlainObject(currentSettings)) {
      for (const [k, v] of Object.entries(currentSettings)) {
        if (isExcludedSettingKey(k)) settings[k] = clone(v);
      }
    }
    write.settings = settings;
    Object.assign(write, clone(RESET_ON_RESTORE));
    return write;
  }

  /**
   * After a restore write, confirm it landed: same ids in the same order, every map key present.
   * Deliberately not byte equality — other extension contexts may legitimately touch storage right after
   * the write (the library loaders normalize fields and write back, a page may patch settings, a progress
   * tick may add a record), and that must not be mistaken for a failed restore and rolled back.
   * @returns {string[]} storage keys that did not land
   */
  function verifyRestoreLanded(write, after) {
    const bad = [];
    const ids = (rows) => (Array.isArray(rows) ? rows.map((r) => (isPlainObject(r) ? r.id : r)) : null);
    for (const [k, expected] of Object.entries(write)) {
      if (k in RESET_ON_RESTORE) continue;
      const got = after?.[k];
      if (k === "items" || k === "localPlaylists" || k === "themes") {
        if (JSON.stringify(ids(got)) !== JSON.stringify(ids(expected))) bad.push(k);
      } else if (Array.isArray(expected)) {
        if (!Array.isArray(got) || got.length !== expected.length) bad.push(k);
      } else if (isPlainObject(expected)) {
        if (!isPlainObject(got) || Object.keys(expected).some((x) => !(x in got))) bad.push(k);
      }
    }
    return bad;
  }

  function backupFileName(date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `tubestack-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.json`;
  }

  root.TUBESTACK_BACKUP = {
    FORMAT,
    CURRENT_VERSION,
    DATA_KEYS,
    EXCLUDED_STORAGE_KEYS,
    SECRET_SETTINGS_KEYS,
    INSTALL_SETTINGS_KEYS,
    UI_PREF_PREFIX,
    isExcludedSettingKey,
    sanitizeSettings,
    sanitizeUiPreferences,
    summarize,
    buildBackup,
    validateBackup,
    parseBackupText,
    buildRestoreWrite,
    verifyRestoreLanded,
    backupFileName,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
