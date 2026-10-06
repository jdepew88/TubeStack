#!/usr/bin/env node
/**
 * Tests for TubeStack's save-and-close operation (run: node scripts/test-save-and-close.cjs).
 *
 * These drive the real background/service-worker.js through a Chrome API fake, so they cover the
 * production ordering guarantee directly: a tab is never closed until a fresh read of
 * chrome.storage.local confirms its video is in the library AND attached to the intended playlist.
 */
const { bootExtension, createBrowser, startWorker } = require("./chrome-fake.cjs");

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
    console.error(`  FAIL: ${msg}\n    expected ${b}\n    actual   ${a}`);
    failed++;
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------- fixtures

const VIDS = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"];

function watchUrl(vid) {
  return `https://www.youtube.com/watch?v=${vid}`;
}

/** One window: an active TubeStack-irrelevant tab plus `n` YouTube watch tabs. */
function ytWindow(n, { windowId = 1, startTabId = 101 } = {}) {
  const tabs = [
    { id: 100, windowId, index: 0, url: "https://example.com/", title: "Example", active: true },
  ];
  for (let i = 0; i < n; i++) {
    tabs.push({
      id: startTabId + i,
      windowId,
      index: i + 1,
      url: watchUrl(VIDS[i]),
      title: `Video ${i + 1}`,
      active: false,
    });
  }
  return tabs;
}

function tabMetaFor(n, { startTabId = 101 } = {}) {
  const meta = {};
  for (let i = 0; i < n; i++) {
    meta[startTabId + i] = {
      videoId: VIDS[i],
      title: `Real Title ${i + 1}`,
      channel: `Channel ${i + 1}`,
      thumbnail: `https://i.ytimg.com/vi/${VIDS[i]}/hqdefault.jpg`,
      durationSec: 600,
    };
  }
  return meta;
}

const baseStorage = { items: [], localPlaylists: [], themes: [], settings: { privacyConsentAccepted: true } };

function saveAll(ext, extra = {}) {
  return ext.send({
    type: "TUBESTACK_SAVE_AND_ATTACH_TABS",
    mode: "all",
    target: { kind: "new" },
    ...extra,
  });
}

function playlistById(browser, id) {
  return (browser.store.localPlaylists || []).find((p) => p.id === id) || null;
}
function libraryVideoIds(browser) {
  return (browser.store.items || []).map((it) => it.videoId).filter(Boolean).sort();
}
function openTabIds(browser) {
  return browser.tabs.map((t) => t.id).sort((a, b) => a - b);
}

// ---------------------------------------------------------------- 0. privacy consent

test("without privacy consent nothing is saved and no tab is closed", async () => {
  const removed = [];
  const browser = createBrowser({
    storage: { ...baseStorage, settings: {} },
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    onRemove: (tabId) => removed.push(tabId),
  });
  const ext = startWorker(browser);

  const r = await saveAll(ext);

  eq(r.ok, false, "save refused");
  eq(r.error, "privacy_consent_required", "says why");
  eq(removed, [], "no tab closed");
  eq(browser.store.items || [], [], "library untouched");
  eq(browser.store.localPlaylists || [], [], "no playlist created");
});

// ---------------------------------------------------------------- 1. happy path

test("playlist exists and contains every video before any tab is closed", async () => {
  const closeOrder = [];
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(3),
    tabMeta: tabMetaFor(3),
    onRemove: (tabId) => {
      // Snapshot what storage looked like at the instant of each close.
      const lists = browser.store.localPlaylists || [];
      const pl = lists[0] || null;
      closeOrder.push({
        tabId,
        libraryCount: (browser.store.items || []).length,
        attached: (pl?.items || []).length,
      });
    },
  });
  const ext = startWorker(browser);

  const r = await saveAll(ext);

  assert(r.ok === true, `expected ok, got ${JSON.stringify(r)}`);
  eq(r.closedTabIds.sort(), [101, 102, 103], "all three tabs closed");
  eq(r.keptOpenTabIds, [], "nothing kept open");
  eq(r.failures, [], "no failures");
  assert(r.createdPlaylist === true, "playlist was created");
  eq(libraryVideoIds(browser), VIDS.slice(0, 3).sort(), "library holds all three videos");

  const pl = playlistById(browser, r.playlistId);
  assert(pl, "playlist persisted under the returned id");
  eq(
    (pl.items || []).map((s) => s.videoId).sort(),
    VIDS.slice(0, 3).sort(),
    "playlist holds all three videos"
  );

  // The ordering guarantee: persistence was already complete at the first close.
  assert(closeOrder.length === 3, `expected 3 closes, saw ${closeOrder.length}`);
  for (const c of closeOrder) {
    assert(c.libraryCount === 3, `library complete before closing ${c.tabId} (saw ${c.libraryCount})`);
    assert(c.attached === 3, `playlist complete before closing ${c.tabId} (saw ${c.attached})`);
  }

  eq(openTabIds(browser), [100], "only the non-YouTube tab remains");
});

// ---------------------------------------------------------------- 2. storage failure

test("storage write failure leaves every tab open", async () => {
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(3),
    tabMeta: tabMetaFor(3),
    onSet: (obj) => {
      if ("items" in obj) {
        const e = new Error("QUOTA_BYTES quota exceeded");
        throw e;
      }
    },
  });
  const ext = startWorker(browser);

  const r = await saveAll(ext);

  assert(r.ok === false, "operation reports failure");
  assert(/quota/i.test(r.error || ""), `error surfaced: ${r.error}`);
  eq(r.closedTabIds, [], "no tab was closed");
  eq(r.keptOpenTabIds.sort(), [101, 102, 103], "all tabs reported kept open");
  eq(openTabIds(browser), [100, 101, 102, 103], "all tabs still open in the browser");
  assert(!(browser.store.localPlaylists || []).length, "no playlist was created");

  const ops = browser.store.saveOperations || [];
  assert(ops.length === 1 && ops[0].state === "failed", `record is failed: ${JSON.stringify(ops[0]?.state)}`);
});

test("playlist write failure leaves every tab open and creates no queue", async () => {
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    onSet: (obj) => {
      if ("localPlaylists" in obj) throw new Error("localPlaylists write rejected");
    },
  });
  const ext = startWorker(browser);

  const r = await saveAll(ext);
  assert(r.ok === false, "operation reports failure");
  eq(r.closedTabIds, [], "no tab closed when the playlist cannot be written");
  eq(openTabIds(browser), [100, 101, 102], "tabs untouched");
});

// ---------------------------------------------------------------- 3. partial failure

test("partial failure closes only the tabs whose videos were confirmed", async () => {
  // Video 3's row is dropped from `items` right before verification, so it must survive as an open tab.
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(3),
    tabMeta: tabMetaFor(3),
    onSet: (obj, store) => {
      if (Array.isArray(obj.items)) {
        obj.items = obj.items.filter((it) => it.videoId !== VIDS[2]);
      }
      void store;
    },
  });
  const ext = startWorker(browser);

  const r = await saveAll(ext);

  assert(r.partial === true, `expected partial, got ${JSON.stringify({ ok: r.ok, partial: r.partial })}`);
  eq(r.closedTabIds.sort(), [101, 102], "only confirmed tabs closed");
  eq(r.keptOpenTabIds, [103], "unconfirmed tab kept open");
  eq(
    r.failures.map((f) => f.reason),
    ["library_row_missing"],
    "failure reason is specific"
  );
  assert(browser.tabs.some((t) => t.id === 103), "tab 103 is still open in the browser");
});

test("a tab whose video is missing from the playlist stays open", async () => {
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    onSet: (obj) => {
      if (Array.isArray(obj.localPlaylists)) {
        for (const pl of obj.localPlaylists) {
          if (Array.isArray(pl.items)) pl.items = pl.items.filter((s) => s.videoId !== VIDS[1]);
        }
      }
    },
  });
  const ext = startWorker(browser);

  const r = await saveAll(ext);
  assert(r.partial === true, "partial result");
  eq(r.closedTabIds, [101], "only the attached video's tab closed");
  eq(r.keptOpenTabIds, [102], "unattached video's tab kept open");
  eq(r.failures.map((f) => f.reason), ["not_attached_to_playlist"], "reason names the attach gap");
});

// ---------------------------------------------------------------- 4. service worker restart

test("a service worker restart mid-save cannot revert the save (metadata repair race)", async () => {
  // Two videos already in the library with placeholder titles: exactly the state that used to make
  // repairWeakStoredVideoMetadata snapshot the library on every cold start and write it back stale.
  const preExisting = [
    { id: "old-1", videoId: VIDS[3], url: watchUrl(VIDS[3]), title: "YouTube", thumbnail: "" },
  ];
  const browser = createBrowser({
    storage: { ...baseStorage, items: preExisting },
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    // oembed never succeeds -> the old code would re-arm the clobbering pass on every wakeup.
    fetch: async () => ({ ok: false, status: 404, async json() { return {}; } }),
  });

  // Cold start (this is what a message-triggered wakeup looks like), then save.
  let ext = startWorker(browser);
  const r = await saveAll(ext);
  assert(r.ok === true, `save ok: ${JSON.stringify(r)}`);

  // Let any deferred repair work settle, then restart the worker a few times.
  for (let i = 0; i < 3; i++) {
    await new Promise((res) => setTimeout(res, 30));
    ext = ext.restart();
    await ext.send({ type: "TUBESTACK_GET_STATE" });
  }
  await new Promise((res) => setTimeout(res, 50));

  const ids = libraryVideoIds(browser);
  assert(ids.includes(VIDS[0]) && ids.includes(VIDS[1]), `saved videos survived restarts: ${ids}`);
  assert(ids.includes(VIDS[3]), "pre-existing video still present");
  const pl = playlistById(browser, r.playlistId);
  assert(pl, "playlist survived restarts");
  eq((pl.items || []).map((s) => s.videoId).sort(), VIDS.slice(0, 2).sort(), "playlist contents intact");
});

test("an operation interrupted after persist is resumed, not restarted, on reopen", async () => {
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    // Simulate the popup/window dying at the moment of the first close.
    onRemove: () => {
      throw new Error("context invalidated");
    },
  });
  let ext = startWorker(browser);

  const first = await saveAll(ext, { operationId: "op-interrupted" });
  eq(first.closedTabIds, [], "closes all failed while the context was dead");
  eq(openTabIds(browser), [100, 101, 102], "tabs still open");
  const playlistId = first.playlistId;
  assert(playlistId, "playlist was persisted before the interruption");

  // Worker restarts; the "browser" can close tabs again; the UI reopens and resumes.
  browser.hooks.onRemove = null;
  ext = ext.restart();
  // Age the record past the in-flight guard.
  for (const rec of browser.store.saveOperations) {
    rec.state = "persisted";
    rec.updatedAt = new Date(Date.now() - 60000).toISOString();
  }

  const resumed = await ext.send({ type: "TUBESTACK_SAVE_OPS_RESUME" });
  assert(resumed.ok === true, "resume responded");
  assert(resumed.resumed.length === 1, `one operation resumed, saw ${resumed.resumed.length}`);
  eq(resumed.resumed[0].closedTabIds.sort(), [101, 102], "resume closed the verified tabs");
  eq(resumed.resumed[0].playlistId, playlistId, "resume reused the original playlist");
  eq(
    (browser.store.localPlaylists || []).length,
    1,
    "resume did not create a second playlist"
  );
  eq(libraryVideoIds(browser), VIDS.slice(0, 2).sort(), "no duplicate library rows");
});

test("a stale record never authorizes a close without re-verification", async () => {
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    onRemove: () => {
      throw new Error("context invalidated");
    },
  });
  let ext = startWorker(browser);
  const first = await saveAll(ext, { operationId: "op-stale" });
  assert(first.playlistId, "persisted");

  // The user deletes that playlist before reopening TubeStack.
  browser.store.localPlaylists = [];
  browser.hooks.onRemove = null;
  ext = ext.restart();
  for (const rec of browser.store.saveOperations) {
    rec.state = "persisted";
    rec.updatedAt = new Date(Date.now() - 60000).toISOString();
  }

  const resumed = await ext.send({ type: "TUBESTACK_SAVE_OPS_RESUME" });
  eq(resumed.resumed[0].closedTabIds, [], "nothing closed: the playlist no longer exists");
  eq(resumed.resumed[0].failures.map((f) => f.reason), ["playlist_missing", "playlist_missing"], "reason reported");
  eq(openTabIds(browser), [100, 101, 102], "tabs preserved");
});

// ---------------------------------------------------------------- 5. sidebar / popup parity

test("sidebar and popup saves go through one operation with identical semantics", async () => {
  const mk = () =>
    startWorker(
      createBrowser({ storage: baseStorage, tabs: ytWindow(2), tabMeta: tabMetaFor(2) })
    );

  // Popup: mode from the button, brand new playlist.
  const popup = mk();
  const pr = await popup.send({
    type: "TUBESTACK_SAVE_AND_ATTACH_TABS",
    mode: "all",
    operationId: "popup-1",
    target: { kind: "new" },
  });

  // Sidebar: same message, window-left ordering, hold bookkeeping on.
  const side = mk();
  const sr = await side.send({
    type: "TUBESTACK_SAVE_AND_ATTACH_TABS",
    mode: "all",
    operationId: "side-1",
    target: { kind: "new" },
    tabOrder: "window_left",
    updateSidebarHold: true,
  });

  eq(
    { ok: pr.ok, closed: pr.closedTabIds.sort(), kept: pr.keptOpenTabIds, fails: pr.failures.length },
    { ok: sr.ok, closed: sr.closedTabIds.sort(), kept: sr.keptOpenTabIds, fails: sr.failures.length },
    "popup and sidebar results agree"
  );
  assert(pr.createdPlaylist && sr.createdPlaylist, "both created a playlist");
});

test("sidebar appending to an existing queue reuses it and dedupes", async () => {
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
  });
  const ext = startWorker(browser);

  const first = await saveAll(ext, { operationId: "s1" });
  const queueId = first.playlistId;

  // Reopen the same two videos in new tabs, then "Add window tabs" to the same queue.
  browser.tabs.push(
    { id: 201, windowId: 1, index: 5, url: watchUrl(VIDS[0]), title: "Video 1", active: false },
    { id: 202, windowId: 1, index: 6, url: watchUrl(VIDS[1]), title: "Video 2", active: false }
  );
  browser.opts.tabMeta[201] = tabMetaFor(2)[101];
  browser.opts.tabMeta[202] = tabMetaFor(2)[102];

  const second = await ext.send({
    type: "TUBESTACK_SAVE_AND_ATTACH_TABS",
    mode: "all",
    operationId: "s2",
    target: { kind: "existing", playlistId: queueId, prepend: true },
  });

  eq(second.playlistId, queueId, "same queue reused");
  eq((browser.store.localPlaylists || []).length, 1, "no second playlist");
  eq(libraryVideoIds(browser), VIDS.slice(0, 2).sort(), "library rows deduped by video id");
  eq(
    (playlistById(browser, queueId).items || []).map((s) => s.videoId).sort(),
    VIDS.slice(0, 2).sort(),
    "queue entries deduped"
  );
  eq(second.closedTabIds.sort(), [201, 202], "the re-opened tabs were closed (already preserved)");
});

// ---------------------------------------------------------------- 6. duplicates and retries

test("replaying the same operationId is idempotent", async () => {
  const ext = bootExtension({ storage: baseStorage, tabs: ytWindow(2), tabMeta: tabMetaFor(2) });
  const a = await saveAll(ext, { operationId: "dup-1" });
  const b = await saveAll(ext, { operationId: "dup-1" });

  assert(a.ok && b.replayed === true, "second call replayed the record");
  eq(b.playlistId, a.playlistId, "same playlist id");
  eq((ext.browser.store.localPlaylists || []).length, 1, "exactly one playlist");
  eq(libraryVideoIds(ext.browser), VIDS.slice(0, 2).sort(), "no duplicate library rows");
});

test("two rapid distinct clicks do not create two playlists", async () => {
  const ext = bootExtension({ storage: baseStorage, tabs: ytWindow(2), tabMeta: tabMetaFor(2) });
  const [a, b] = await Promise.all([
    saveAll(ext, { operationId: "click-1" }),
    saveAll(ext, { operationId: "click-2" }),
  ]);

  const results = [a, b];
  const rejected = results.filter((r) => r.error === "save_in_progress");
  const accepted = results.filter((r) => r.ok || r.partial);
  assert(
    rejected.length + accepted.length === 2,
    `each click resolved definitively: ${JSON.stringify(results.map((r) => r.error || r.state))}`
  );
  eq((ext.browser.store.localPlaylists || []).length, 1, "exactly one playlist created");
  eq(libraryVideoIds(ext.browser), VIDS.slice(0, 2).sort(), "no duplicate library rows");
});

test("a sequential retry after a failure reuses the playlist rather than duplicating it", async () => {
  let failNext = true;
  const browser = createBrowser({
    storage: baseStorage,
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    onRemove: () => {
      if (failNext) throw new Error("context invalidated");
    },
  });
  const ext = startWorker(browser);

  const first = await saveAll(ext, { operationId: "retry-1" });
  eq(first.closedTabIds, [], "nothing closed on the failed attempt");

  failNext = false;
  const second = await saveAll(ext, { operationId: "retry-1" });
  eq(second.closedTabIds.sort(), [101, 102], "retry finished the close");
  eq((browser.store.localPlaylists || []).length, 1, "still one playlist");
  eq(libraryVideoIds(browser), VIDS.slice(0, 2).sort(), "still two library rows");
});

// ---------------------------------------------------------------- 7. nothing to save

test("no eligible tabs creates no playlist, closes nothing, and says so", async () => {
  const browser = createBrowser({
    storage: baseStorage,
    tabs: [{ id: 100, windowId: 1, index: 0, url: "https://example.com/", title: "x", active: true }],
  });
  const ext = startWorker(browser);
  const r = await saveAll(ext);

  assert(r.ok === true, "not an error");
  assert(r.nothingToSave === true, "flagged as nothing to save");
  eq(r.message, "No YouTube tabs found in this window.", "clear message");
  eq(r.playlistId, null, "no playlist id");
  eq(r.closedTabIds, [], "closed nothing");
  eq((browser.store.localPlaylists || []).length, 0, "no playlist created");
  eq((browser.store.saveOperations || []).length, 0, "no record written");
  eq(openTabIds(browser), [100], "tab untouched");
});

// ---------------------------------------------------------------- 8. messaging failures

test("missing tab metadata still saves via the URL and closes safely", async () => {
  // No content script anywhere: tabs.sendMessage rejects for every tab.
  const browser = createBrowser({ storage: baseStorage, tabs: ytWindow(2), tabMeta: {} });
  const ext = startWorker(browser);
  const r = await saveAll(ext);

  assert(r.ok === true, `save still succeeds: ${JSON.stringify(r)}`);
  eq(libraryVideoIds(browser), VIDS.slice(0, 2).sort(), "video ids recovered from the tab URLs");
  eq(r.closedTabIds.sort(), [101, 102], "tabs closed after confirmation");
});

test("malformed and unknown messages get a definitive response", async () => {
  const ext = bootExtension({ storage: baseStorage, tabs: ytWindow(1), tabMeta: tabMetaFor(1) });

  const unknown = await ext.send({ type: "TUBESTACK_NOT_A_REAL_MESSAGE" });
  eq(unknown, { ok: false, error: "Unknown message" }, "unknown type answered, not dropped");

  const noMode = await ext.send({ type: "TUBESTACK_SAVE_AND_ATTACH_TABS" });
  assert(noMode.ok === false && noMode.error === "invalid_mode", `bad mode rejected: ${noMode.error}`);
  eq(noMode.closedTabIds, [], "nothing closed for an invalid request");
  eq(openTabIds(ext.browser), [100, 101], "tabs untouched");

  const badId = await ext.send({ type: "TUBESTACK_SAVE_OP_GET", operationId: "nope" });
  eq(badId, { ok: false, error: "not_found" }, "unknown record answered");
});

test("the legacy library-only save message never closes a tab", async () => {
  const ext = bootExtension({ storage: baseStorage, tabs: ytWindow(2), tabMeta: tabMetaFor(2) });
  const r = await ext.send({ type: "TUBESTACK_SAVE_YT_TABS", mode: "all" });

  assert(r.ok === true, "still responds ok");
  eq(r.closedTabIds, [], "closes nothing");
  eq(openTabIds(ext.browser), [100, 101, 102], "tabs remain open");
});

// ---------------------------------------------------------------- 8b. the original clobber race

test("the metadata repair pass cannot revert a save it overlaps with", async () => {
  // This is the exact shape of the reported data loss: a cold-start repair pass holding a pre-save
  // snapshot, finishing after the save has written and the tabs have closed.
  const preExisting = [
    { id: "old-1", videoId: VIDS[3], url: watchUrl(VIDS[3]), title: "YouTube", thumbnail: "" },
  ];
  const browser = createBrowser({
    storage: { ...baseStorage, items: preExisting },
    tabs: ytWindow(2),
    tabMeta: tabMetaFor(2),
    fetch: async (url) => {
      // Slow, and it does return a real title, so the pass has a patch to write.
      await new Promise((res) => setTimeout(res, 40));
      if (!url.includes("oembed")) return { ok: false, status: 404, async json() { return {}; } };
      return {
        ok: true,
        status: 200,
        async json() {
          return { title: "Recovered Title", thumbnail_url: "https://i.ytimg.com/x.jpg", author_name: "Ch" };
        },
      };
    },
  });
  const ext = startWorker(browser);

  // Start the repair pass, then save while it is still fetching.
  const repair = ext.sandbox.repairWeakStoredVideoMetadata();
  const saved = await saveAll(ext, { operationId: "race-1" });
  await repair;
  await new Promise((res) => setTimeout(res, 60));

  assert(saved.ok === true, `save succeeded: ${JSON.stringify(saved)}`);
  const ids = libraryVideoIds(browser);
  assert(ids.includes(VIDS[0]) && ids.includes(VIDS[1]), `saved videos survived the repair pass: ${ids}`);
  assert(ids.includes(VIDS[3]), "pre-existing video kept");
  const pl = playlistById(browser, saved.playlistId);
  assert(pl, "playlist survived the repair pass");
  eq((pl.items || []).map((s) => s.videoId).sort(), VIDS.slice(0, 2).sort(), "playlist intact");

  // And the repair itself still did its job on the weak-titled row.
  const repaired = (browser.store.items || []).find((it) => it.videoId === VIDS[3]);
  eq(repaired.title, "Recovered Title", "weak title was repaired via merge patch");
});

test("repair attempts are capped so a permanently unfetchable video stops re-arming the pass", async () => {
  const browser = createBrowser({
    storage: {
      ...baseStorage,
      items: [{ id: "gone-1", videoId: VIDS[3], url: watchUrl(VIDS[3]), title: "YouTube", thumbnail: "" }],
    },
    tabs: ytWindow(0),
    fetch: async () => ({ ok: false, status: 401, async json() { return {}; } }),
  });
  const ext = startWorker(browser);

  const counts = [];
  for (let i = 0; i < 5; i++) {
    const before = browser.log.fetches.length;
    await ext.sandbox.repairWeakStoredVideoMetadata();
    counts.push(browser.log.fetches.length - before);
  }
  assert(counts[0] > 0, "first pass tried");
  eq(counts.slice(3), [0, 0], `passes stop after the attempt cap (saw ${counts})`);
  const state = browser.store.metadataRepairState || {};
  eq(Object.keys(state), [VIDS[3]], "attempt state recorded per video");
});

// ---------------------------------------------------------------- 8c. structural parity

test("neither UI reaches the old close-then-attach message pair", async () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  for (const rel of ["popup/popup.js", "sidebar/sidebar.js"]) {
    const code = fs.readFileSync(path.join(root, rel), "utf8");
    assert(
      !code.includes("TUBESTACK_SAVE_YT_TABS"),
      `${rel} must not call the library-only save directly`
    );
    assert(
      code.includes("TUBESTACK_SAVE_AND_ATTACH_TABS"),
      `${rel} uses the single atomic save operation`
    );
    assert(
      code.includes("chrome.runtime.lastError"),
      `${rel} checks chrome.runtime.lastError on every message`
    );
  }
  const sw = fs.readFileSync(path.join(root, "background", "service-worker.js"), "utf8");
  const closers = sw.split("chrome.tabs.remove(").length - 1;
  eq(closers, 1, "exactly one chrome.tabs.remove call site in the worker");
});

// ---------------------------------------------------------------- 9. record lifecycle

test("record moves pending -> persisted -> verified -> completed and keeps its result", async () => {
  const ext = bootExtension({ storage: baseStorage, tabs: ytWindow(2), tabMeta: tabMetaFor(2) });
  const r = await saveAll(ext, { operationId: "life-1" });

  const got = await ext.send({ type: "TUBESTACK_SAVE_OP_GET", operationId: "life-1" });
  assert(got.ok === true, "record readable after completion");
  eq(got.record.state, "completed", "terminal state recorded");
  eq(got.result.playlistId, r.playlistId, "persisted result matches the live response");
  eq(got.record.confirmedVideoIds.sort(), VIDS.slice(0, 2).sort(), "confirmed ids stored");
  assert(got.record.plannedPlaylistId, "planned playlist id retained for idempotent retries");
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
  console.log(`\nOK: save-and-close tests passed (${ran} tests).`);
})();
