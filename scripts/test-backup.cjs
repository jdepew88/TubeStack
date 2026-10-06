#!/usr/bin/env node
/**
 * Tests for TubeStack backup / restore (run: node scripts/test-backup.cjs [name-filter]).
 *
 * Export and restore are driven through the real background/service-worker.js via the Chrome API fake,
 * against a realistic populated library (scripts/fixtures/populated-library.cjs). File validation is
 * exercised through lib/backup.js exactly as the dashboard preview uses it.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { bootExtension } = require("./chrome-fake.cjs");
const { populatedStorage, SECRETS, THEME, VID, UI_PREFERENCES } = require("./fixtures/populated-library.cjs");

const ROOT = path.join(__dirname, "..");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "lib", "backup.js"), "utf8"), sandbox);
const B = sandbox.TUBESTACK_BACKUP;

let failed = 0;
let ran = 0;
const only = process.argv[2] || null;

function assert(cond, msg) {
  if (!cond) {
    console.error("  FAIL:", msg);
    failed++;
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`  FAIL: ${msg}\n    expected ${b && b.slice(0, 400)}\n    actual   ${a && a.slice(0, 400)}`);
    failed++;
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------- helpers

const DURABLE = ["items", "localPlaylists", "themes", "videoProgress", "watchByDay", "subscriptionChannels"];
const clone = (v) => JSON.parse(JSON.stringify(v));

async function exportFrom(ext, uiPreferences = UI_PREFERENCES) {
  const r = await ext.send({ type: "TUBESTACK_BACKUP_EXPORT", uiPreferences });
  assert(r && r.ok === true, `export succeeded (${r && r.error})`);
  return r;
}

/** What the user's file looks like on disk: pretty JSON text, exactly as the dashboard writes it. */
function asFileText(backup) {
  return JSON.stringify(backup, null, 2);
}

/** A fresh install as onInstalled leaves it: empty library, seeded categories, no onboarding. */
// Both restore entry points (Settings, and the Welcome step once its notice is ticked) record privacy
// consent before a restore can run, so a realistic fresh install has it.
const CONSENTED = { privacyConsentAccepted: true, privacyConsentAt: "2026-10-06T09:00:00.000Z" };

async function freshInstall(storage = { settings: { ...CONSENTED } }) {
  const ext = bootExtension({ storage });
  await Promise.all(ext.browser.events.onInstalled._emit({ reason: "install" }));
  return ext;
}

function sanitizedSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k in SECRETS) continue;
    if (/LastTest|focusSession|^privacyConsent/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function validBackupObject() {
  return clone(
    B.buildBackup({ storage: populatedStorage(), appVersion: "0.9", exportedAt: "2026-10-06T12:00:00.000Z", uiPreferences: UI_PREFERENCES })
  );
}

// ---------------------------------------------------------------- export

test("export carries the TubeStack identifier, schema version, timestamp and app version", async () => {
  const ext = bootExtension({ storage: populatedStorage() });
  const { backup } = await exportFrom(ext);
  eq(backup.format, "tubestack-backup", "format identifier");
  eq(backup.version, 1, "schema version");
  assert(!Number.isNaN(Date.parse(backup.exportedAt)) && /T.*Z$/.test(backup.exportedAt), "ISO export timestamp");
  eq(backup.app, { name: "TubeStack", version: JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"))).version }, "app version from manifest");
  assert(typeof backup.notice === "string" && /API keys/.test(backup.notice), "human-readable notice says keys are excluded");
});

test("export serializes every durable storage area verbatim", async () => {
  const seed = populatedStorage();
  const ext = bootExtension({ storage: seed });
  const { backup } = await exportFrom(ext);
  for (const k of DURABLE) eq(backup.data[k], seed[k], `${k} serialized exactly`);
});

test("videos, playlists (with custom order), categories and favorite tiers survive export", async () => {
  const seed = populatedStorage();
  const { backup } = await exportFrom(bootExtension({ storage: seed }));
  eq(backup.data.items.length, 14, "all 14 videos");
  eq(backup.data.localPlaylists.map((p) => p.id), seed.localPlaylists.map((p) => p.id), "playlist order");
  eq(backup.data.localPlaylists[0].items.map((s) => s.itemId), seed.localPlaylists[0].items.map((s) => s.itemId), "custom in-playlist order");
  const tiers = Object.fromEntries(backup.data.themes.map((t) => [t.id, t.tier]));
  eq(tiers[THEME.music], "favorite", "gold (super favorite) category kept");
  eq(tiers[THEME.science], "active", "green (favorite) category kept");
  eq(tiers[THEME.gaming], "off", "off category kept");
  eq(backup.counts.superFavoriteCategories, 2, "super-favorite count");
  eq(backup.counts.favoriteCategories, 3, "favorite count");
  const inTwo = backup.data.localPlaylists.filter((p) => p.items.some((s) => s.videoId === VID[0])).length;
  eq(inTwo, 2, "a video that belongs to two playlists stays in both");
});

test("notes, timestamp notes, watch state and progress survive export", async () => {
  const { backup } = await exportFrom(bootExtension({ storage: populatedStorage() }));
  const it = backup.data.items.find((x) => x.videoId === VID[1]);
  eq(it.note, "Great walkthrough of the wiring step.", "video note");
  eq(it.timestampNotes.map((t) => t.timeSeconds), [95, 610], "timestamp notes");
  eq(it.watchState, "watching", "watch state");
  eq(backup.data.videoProgress[VID[1]].playheadSec, 610, "playback position");
  eq(backup.data.localPlaylists[0].decisions[0].title, "Buy the 12Nm torque wrench", "playlist decisions");
  eq(backup.counts.timestampNotes, 3, "timestamp note count");
  eq(backup.counts.videosWithNotes, 2, "videos-with-notes count");
  eq(backup.counts.finishedVideos, 2, "finished count");
  eq(backup.counts.videosWithProgress, 4, "progress count");
});

test("non-secret settings and ts_* UI preferences are exported", async () => {
  const seed = populatedStorage();
  const { backup } = await exportFrom(bootExtension({ storage: seed }), {
    ...UI_PREFERENCES,
    not_ours: "x",
    ts_api_key: "AIza-should-not-pass",
    ts_huge: "x".repeat(5000),
    ts_obj: { a: 1 },
  });
  eq(backup.data.settings, sanitizedSettings(seed.settings), "settings minus secrets/per-install fields");
  eq(backup.data.settings.uiThemePreset, "ocean", "theme preset");
  eq(backup.data.settings.currentPlaylistId, "pl-0001-session-weekend", "selected queue");
  eq(backup.data.uiPreferences, UI_PREFERENCES, "only well-formed ts_* string prefs");
});

test("API keys, OAuth Client ID, account email and token-like fields are never exported", async () => {
  const ext = bootExtension({ storage: populatedStorage() });
  const { backup } = await exportFrom(ext);
  const text = asFileText(backup);
  for (const [k, v] of Object.entries(SECRETS)) {
    assert(!(k in backup.data.settings), `${k} key absent from settings`);
    assert(!text.includes(v), `${k} value absent from file text`);
  }
  for (const k of ["youtubeApiLastTestAt", "youtubeApiLastTestOk", "openaiLastTestOk", "anthropicLastTestAt", "anthropicLastTestOk", "focusSession"]) {
    assert(!(k in backup.data.settings), `per-install ${k} absent`);
  }
});

test("transient and cache storage keys are not exported", async () => {
  const { backup } = await exportFrom(bootExtension({ storage: populatedStorage() }));
  for (const k of ["saveOperations", "metadataRepairState", "sidebarPlayback", "openAiLibraryClassifyV1", "aiCategoryUndoSnapshotV1"]) {
    assert(!(k in backup.data), `${k} not in backup`);
  }
});

test("OpenAI, Anthropic and YouTube credentials are excluded while AI preferences travel", async () => {
  const { backup } = await exportFrom(bootExtension({ storage: populatedStorage() }));
  const text = asFileText(backup);
  for (const k of ["openaiApiKey", "anthropicApiKey", "youtubeDataApiKey", "youtubeOAuthClientId"]) {
    assert(!(k in backup.data.settings), `${k} not exported`);
    assert(!text.includes(SECRETS[k]), `${k} value nowhere in the file`);
    assert(backup.excludedSettings.includes(k), `${k} listed as excluded`);
  }
  eq(backup.data.settings.aiProvider, "anthropic", "selected provider kept");
  eq(backup.data.settings.anthropicModel, "claude-sonnet-5-5", "Anthropic model kept");
  eq(backup.data.settings.openaiModel, "gpt-4o-mini", "OpenAI model kept");
});

test("every credential field the AI provider registry declares is treated as a secret", async () => {
  const sb = { console };
  sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "lib", "ai-providers.js"), "utf8"), sb);
  const AI = sb.TUBESTACK_AI;
  assert(AI && AI.AI_PROVIDER_IDS.length >= 2, "provider registry loads");
  for (const id of AI.AI_PROVIDER_IDS) {
    const { keySetting, modelSetting } = AI.AI_PROVIDERS[id];
    eq(B.isExcludedSettingKey(keySetting), true, `${id} key setting (${keySetting}) excluded`);
    eq(B.isExcludedSettingKey(modelSetting), false, `${id} model setting (${modelSetting}) kept`);
  }
  eq(B.isExcludedSettingKey("aiProvider"), false, "provider choice kept");
});

test("export does not write to or change storage", async () => {
  const seed = populatedStorage();
  const ext = bootExtension({ storage: seed });
  ext.browser.log.setKeys.length = 0;
  await exportFrom(ext);
  eq(ext.browser.log.setKeys, [], "no storage.set calls");
  eq(ext.browser.store, seed, "storage byte-for-byte unchanged");
});

test("export self-checks its own output with the import validator", async () => {
  const r = await exportFrom(bootExtension({ storage: populatedStorage() }));
  eq(r.selfCheck.ok, true, "export would import cleanly");
  eq(r.selfCheck.errors, [], "no self-check errors");
});

test("exporting an empty install produces a valid, empty backup", async () => {
  const ext = await freshInstall();
  const r = await exportFrom(ext, {});
  eq(r.selfCheck.ok, true, "empty backup valid");
  eq(r.backup.counts.videos, 0, "zero videos");
});

// ---------------------------------------------------------------- import validation

test("a valid backup file is accepted with an accurate preview", async () => {
  const p = B.parseBackupText(asFileText(validBackupObject()));
  eq(p.ok, true, "accepted");
  eq(p.errors, [], "no errors");
  eq(p.warnings, [], "no warnings");
  eq(p.meta, { version: 1, exportedAt: "2026-10-06T12:00:00.000Z", appVersion: "0.9" }, "meta");
  eq(
    [p.summary.videos, p.summary.playlists, p.summary.categories, p.summary.favoriteCategories, p.summary.superFavoriteCategories],
    [14, 4, 7, 3, 2],
    "summary counts"
  );
});

test("a UTF-8 BOM in front of the file is tolerated", async () => {
  eq(B.parseBackupText("﻿" + asFileText(validBackupObject())).ok, true, "BOM ok");
});

test("invalid, empty or truncated JSON is rejected", async () => {
  const text = asFileText(validBackupObject());
  for (const [label, t] of [
    ["garbage", "not json at all"],
    ["empty", ""],
    ["whitespace", "   \n"],
    ["truncated", text.slice(0, Math.floor(text.length / 2))],
  ]) {
    const p = B.parseBackupText(t);
    eq(p.ok, false, `${label} rejected`);
    assert(p.errors.length > 0, `${label} explains why`);
  }
});

test("unrelated JSON is rejected as not a TubeStack backup", async () => {
  for (const t of ["{}", "[]", "42", "null", '{"roots":{"bookmark_bar":{}}}', '{"format":"other-app-backup","version":1,"data":{}}']) {
    const p = B.parseBackupText(t);
    eq(p.ok, false, `rejected: ${t}`);
    eq(p.code, "not_tubestack", `code for ${t}`);
  }
});

test("unsupported or invalid schema versions are rejected safely", async () => {
  const newer = validBackupObject();
  newer.version = 2;
  const p = B.validateBackup(newer);
  eq([p.ok, p.code], [false, "unsupported_version"], "newer version rejected");
  assert(/newer TubeStack/.test(p.errors[0]), "message tells the user to update");
  for (const v of [0, -1, "1", 1.5, null, undefined]) {
    const b = validBackupObject();
    b.version = v;
    eq(B.validateBackup(b).code, "bad_version", `version ${JSON.stringify(v)} rejected`);
  }
});

test("malformed data structures are rejected", async () => {
  const cases = {
    "missing data": (b) => delete b.data,
    "items not a list": (b) => (b.data.items = { a: 1 }),
    "missing themes": (b) => delete b.data.themes,
    "video not an object": (b) => (b.data.items[3] = "dQw4w9WgXcQ"),
    "video without id": (b) => delete b.data.items[2].id,
    "video without videoId or url": (b) => {
      delete b.data.items[2].videoId;
      delete b.data.items[2].url;
    },
    "tags not a list": (b) => (b.data.items[0].tags = "synth"),
    "timestamp notes not a list": (b) => (b.data.items[1].timestampNotes = {}),
    "playlist items not a list": (b) => (b.data.localPlaylists[1].items = "x"),
    "playlist entry not an object": (b) => (b.data.localPlaylists[0].items[1] = 7),
    "category without label": (b) => delete b.data.themes[0].label,
    "progress record not an object": (b) => (b.data.videoProgress[VID[0]] = 300),
    "watch total not a number": (b) => (b.data.watchByDay["2026-06-10"] = "300"),
    "settings not an object": (b) => (b.data.settings = []),
    "subbed channels not a list": (b) => (b.data.subscriptionChannels = {}),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const b = validBackupObject();
    mutate(b);
    const p = B.validateBackup(b);
    eq(p.ok, false, `${label} rejected`);
    assert(p.errors.length > 0, `${label} has an error message`);
  }
});

test("duplicate or missing IDs are rejected; dangling references only warn", async () => {
  const dupItem = validBackupObject();
  dupItem.data.items[5].id = dupItem.data.items[4].id;
  eq(B.validateBackup(dupItem).ok, false, "duplicate video id rejected");

  const dupPl = validBackupObject();
  dupPl.data.localPlaylists[2].id = dupPl.data.localPlaylists[0].id;
  eq(B.validateBackup(dupPl).ok, false, "duplicate playlist id rejected");

  const dupTheme = validBackupObject();
  dupTheme.data.themes[1].id = dupTheme.data.themes[0].id;
  eq(B.validateBackup(dupTheme).ok, false, "duplicate category id rejected");

  const emptyId = validBackupObject();
  emptyId.data.localPlaylists[0].id = "   ";
  eq(B.validateBackup(emptyId).ok, false, "blank playlist id rejected");

  const dangling = validBackupObject();
  dangling.data.items[0].themeId = "no-such-category";
  dangling.data.settings.currentPlaylistId = "no-such-playlist";
  const p = B.validateBackup(dangling);
  eq(p.ok, true, "dangling refs still importable");
  eq(p.warnings.length, 2, "two warnings");
});

test("hand-edited counts produce a warning, not a rejection", async () => {
  const b = validBackupObject();
  b.data.items.pop();
  const p = B.validateBackup(b);
  eq(p.ok, true, "still valid");
  assert(p.warnings.some((w) => /edited by hand/.test(w)), "edit warning");
});

test("previewing a backup never touches storage", async () => {
  const seed = populatedStorage();
  const ext = bootExtension({ storage: seed });
  ext.browser.log.setKeys.length = 0;
  B.parseBackupText(asFileText(validBackupObject()));
  B.parseBackupText("{nope");
  eq(ext.browser.log.setKeys, [], "no writes");
  eq(ext.browser.store, seed, "storage unchanged");
});

test("the worker re-validates and refuses a bad backup even if the page skipped validation", async () => {
  const seed = populatedStorage();
  const ext = bootExtension({ storage: seed });
  ext.browser.log.setKeys.length = 0;
  for (const bad of [null, { format: "tubestack-backup", version: 1, data: { items: "x" } }, { ...validBackupObject(), version: 9 }]) {
    const r = await ext.send({ type: "TUBESTACK_BACKUP_RESTORE", backup: bad });
    eq(r.ok, false, "refused");
    eq(r.error, "invalid_backup", "error code");
  }
  eq(ext.browser.log.setKeys, [], "nothing written");
  eq(ext.browser.store, seed, "library intact");
});

// ---------------------------------------------------------------- restore

test("a backup restores into an empty install", async () => {
  const seed = populatedStorage();
  const { backup } = await exportFrom(bootExtension({ storage: seed }));
  const dest = await freshInstall();
  const r = await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup: JSON.parse(asFileText(backup)) });
  eq(r.ok, true, `restore ok (${r.message || r.error})`);
  for (const k of DURABLE) eq(dest.browser.store[k], seed[k], `${k} restored exactly`);
  eq(sanitizedSettings(dest.browser.store.settings), sanitizedSettings(seed.settings), "settings restored minus secrets");
  eq(r.summary.videos, 14, "summary returned");
});

test("replace mode swaps a populated library and keeps this install's own credentials", async () => {
  const seed = populatedStorage();
  const { backup } = await exportFrom(bootExtension({ storage: seed }));
  const destSecrets = { youtubeDataApiKey: "AIzaDEST-key-xxxxxxxxxxxxxxxx", openaiApiKey: "sk-DEST", youtubeOAuthClientId: "dest.apps.googleusercontent.com" };
  const dest = bootExtension({
    storage: {
      items: [{ id: "old-1", videoId: "zzzzzzzzzzz", url: "https://www.youtube.com/watch?v=zzzzzzzzzzz", title: "Old" }],
      localPlaylists: [{ id: "old-pl", name: "Old", items: [] }],
      themes: [{ id: "old-theme", label: "Old", keywords: [], tier: "active" }],
      videoProgress: { zzzzzzzzzzz: { playheadSec: 5 } },
      watchByDay: { "2020-01-01": 5 },
      subscriptionChannels: [],
      settings: { ...destSecrets, uiThemePreset: "crimson", onboardingComplete: false },
      sidebarPlayback: { playlistId: "old-pl", activeTabId: 3 },
      saveOperations: [{ id: "keep-me", state: "completed" }],
    },
  });
  const r = await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup });
  eq(r.ok, true, "restore ok");
  for (const k of DURABLE) eq(dest.browser.store[k], seed[k], `${k} replaced`);
  for (const [k, v] of Object.entries(destSecrets)) eq(dest.browser.store.settings[k], v, `destination ${k} preserved`);
  assert(!("anthropicApiKey" in dest.browser.store.settings), "source secrets not introduced");
  eq(dest.browser.store.settings.uiThemePreset, "ocean", "preferences come from the backup");
  eq(dest.browser.store.settings.onboardingComplete, true, "onboarding state comes from the backup");
  eq(dest.browser.store.sidebarPlayback, null, "stale side-panel session cleared");
  eq(dest.browser.store.saveOperations, [{ id: "keep-me", state: "completed" }], "save-operation records untouched");
});

test("restore keeps the destination's OpenAI and Anthropic keys and clears its stale AI undo snapshot", async () => {
  const { backup } = await exportFrom(bootExtension({ storage: populatedStorage() }));
  const destKeys = {
    openaiApiKey: "sk-proj-DEST-openai-key-aaaaaaaaaaaaaaaa",
    anthropicApiKey: "sk-ant-DEST-anthropic-key-bbbbbbbbbbbbbbbb",
    youtubeDataApiKey: "AIzaDEST-youtube-key-cccccccccccccc",
  };
  const dest = await freshInstall({
    settings: { ...CONSENTED, ...destKeys, aiProvider: "openai", anthropicLastTestOk: false },
    aiCategoryUndoSnapshotV1: { at: "2026-10-01T00:00:00.000Z", kind: "categorize", label: "old run", items: [] },
  });
  const r = await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup });
  eq(r.ok, true, `restore ok (${r.message || r.error})`);
  const st = dest.browser.store.settings;
  for (const [k, v] of Object.entries(destKeys)) eq(st[k], v, `destination ${k} preserved`);
  eq(st.anthropicLastTestOk, false, "destination test result preserved");
  eq(st.aiProvider, "anthropic", "provider preference comes from the backup");
  eq(dest.browser.store.aiCategoryUndoSnapshotV1, null, "undo cannot swap in the pre-restore library");
  const state = await dest.send({ type: "TUBESTACK_GET_STATE" });
  eq(state.aiCategoryUndo ?? null, null, "app reports nothing to undo");
  eq(state.aiKeys?.openai?.configured, true, "OpenAI key still configured");
  eq(state.aiKeys?.anthropic?.configured, true, "Anthropic key still configured");
  assert(!JSON.stringify(state).includes(destKeys.anthropicApiKey), "app state never exposes the key");
});

test("a storage write failure leaves the existing library exactly as it was", async () => {
  const { backup } = await exportFrom(bootExtension({ storage: populatedStorage() }));
  const destSeed = { items: [{ id: "old-1", videoId: "zzzzzzzzzzz", url: "u", title: "Old" }], localPlaylists: [], themes: [], settings: { openaiApiKey: "sk-DEST" } };
  let failNext = true;
  const dest = bootExtension({
    storage: destSeed,
    onSet: (obj) => {
      if (failNext && "items" in obj && obj.items.length > 1) {
        failNext = false;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
    },
  });
  const r = await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup });
  eq([r.ok, r.error], [false, "restore_failed"], "failure reported");
  assert(/quota/i.test(r.message), "reason surfaced");
  eq(dest.browser.store, destSeed, "storage untouched");
});

test("a partial write is detected on read-back and rolled back", async () => {
  const { backup } = await exportFrom(bootExtension({ storage: populatedStorage() }));
  const destSeed = {
    items: [{ id: "old-1", videoId: "zzzzzzzzzzz", url: "u", title: "Old" }],
    localPlaylists: [{ id: "old-pl", name: "Old", items: [] }],
    themes: [{ id: "t", label: "T", tier: "off" }],
    settings: { uiThemePreset: "crimson" },
  };
  let sabotage = true;
  const dest = bootExtension({
    storage: destSeed,
    onSet: (obj) => {
      // Model a write that silently drops one area (e.g. a corrupted storage backend).
      if (sabotage && "themes" in obj && "items" in obj) {
        sabotage = false;
        delete obj.themes;
      }
    },
  });
  const r = await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup });
  eq([r.ok, r.rolledBack], [false, true], "failed and rolled back");
  assert(/themes/.test(r.message), "names the mismatched area");
  eq(dest.browser.store.items, destSeed.items, "items rolled back");
  eq(dest.browser.store.localPlaylists, destSeed.localPlaylists, "playlists rolled back");
  eq(dest.browser.store.themes, destSeed.themes, "themes intact");
  eq(dest.browser.store.settings, destSeed.settings, "settings rolled back");
  for (const k of ["videoProgress", "watchByDay", "subscriptionChannels", "sidebarPlayback"]) {
    assert(!(k in dest.browser.store), `${k} absent again (was absent before)`);
  }
});

test("other contexts touching storage right after the restore do not trigger a false rollback", async () => {
  // Seen in a real browser: the open dashboard re-syncs on storage.onChanged and patches settings, and
  // the library loaders normalize items and write them back, before the restore's read-back runs.
  const { backup } = await exportFrom(bootExtension({ storage: populatedStorage() }));
  const dest = await freshInstall();
  dest.browser.events.storageChanged.addListener((changes) => {
    if (!changes.items || !changes.settings) return;
    const st = dest.browser.store;
    st.settings = { ...st.settings, currentPlaylistName: "Renamed by another page" };
    st.items = st.items.map((it) => ({ ...it, note: it.note || "", normalizedBy: "loader" }));
    st.videoProgress = { ...st.videoProgress, newVideo000: { playheadSec: 3 } };
  });
  const r = await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup });
  eq(r.ok, true, `restore not rolled back (${r.message})`);
  eq(dest.browser.store.items.length, 14, "restored library kept");
  eq(dest.browser.store.settings.currentPlaylistName, "Renamed by another page", "the other writer's change kept too");
});

test("the restored library loads in the app: state, library boot, search and playlists", async () => {
  const seed = populatedStorage();
  const { backup } = await exportFrom(bootExtension({ storage: seed }));
  const dest = await freshInstall();
  await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup });
  const restarted = dest.restart(); // a cold worker must read it back from storage, not memory
  const st = await restarted.send({ type: "TUBESTACK_GET_STATE" });
  eq(st.ok, true, "state loads");
  eq(st.items.length, 14, "videos");
  eq(st.localPlaylists.length, 4, "playlists");
  eq(st.themes.filter((t) => t.tier === "favorite").map((t) => t.label), ["Music", "DIY & repair"], "gold categories");
  eq(st.themes.filter((t) => t.tier === "active").length, 3, "green categories");
  eq(st.videoProgress[VID[1]].playheadSec, 610, "progress");
  eq(st.items.find((x) => x.videoId === VID[5]).timestampNotes[0].note, "Rest 30 min", "timestamp notes");
  eq(st.settings.currentPlaylistId, "pl-0001-session-weekend", "selected queue");
  eq(st.hasYoutubeApiKey, false, "no API key arrived with the backup");
  const boot = await restarted.send({ type: "TUBESTACK_GET_LIBRARY_BOOT" });
  eq(boot.items.length, 14, "library page boot");
  const found = await restarted.send({ type: "TUBESTACK_SEARCH", query: "torque" });
  assert(found.ok !== false, "search runs on restored data");
});

// ---------------------------------------------------------------- round trip

test("round trip: populated → export → file → empty install → import → identical durable data", async () => {
  const seed = populatedStorage();
  const source = bootExtension({ storage: seed });
  const first = await exportFrom(source);
  const fileText = asFileText(first.backup);

  // The page previews from file text, then sends the parsed object to the worker.
  const preview = B.parseBackupText(fileText);
  eq(preview.ok, true, "file previews cleanly");

  const dest = await freshInstall();
  const r = await dest.send({ type: "TUBESTACK_BACKUP_RESTORE", backup: JSON.parse(fileText) });
  eq(r.ok, true, "restored");

  for (const k of DURABLE) eq(dest.browser.store[k], seed[k], `${k} identical after round trip`);
  eq(
    sanitizedSettings(dest.browser.store.settings),
    sanitizedSettings(seed.settings),
    "settings identical except secrets and per-install keys"
  );
  eq(dest.browser.store.settings.privacyConsentAt, CONSENTED.privacyConsentAt, "destination keeps its own consent record");
  assert(!("privacyConsentAccepted" in first.backup.data.settings), "privacy consent is not carried in the file");

  // Export again from the destination: same data, so a second hop is lossless too.
  const second = await exportFrom(dest);
  eq(second.backup.data, first.backup.data, "second export carries identical data");
  eq(second.backup.counts, first.backup.counts, "identical counts");
  eq(source.browser.store, seed, "source install never modified");
});

// ---------------------------------------------------------------- runner

(async () => {
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    ran++;
    const before = failed;
    process.stdout.write(`- ${t.name}\n`);
    try {
      await t.fn();
    } catch (err) {
      console.error("  FAIL (threw):", err && err.stack ? err.stack : err);
      failed++;
    }
    if (failed === before) process.stdout.write("  ok\n");
  }

  if (failed) {
    console.error(`\n${failed} assertion(s) failed across ${ran} test(s).`);
    process.exit(1);
  }
  console.log(`\nOK: backup tests passed (${ran} tests).`);
})();
