const test = require("node:test");
const assert = require("node:assert/strict");

require("../lib/ai-providers.js");
require("../lib/ai-categorize.js");

const AI = globalThis.TUBESTACK_AI;
const CAT = globalThis.TUBESTACK_AI_CATEGORIZE;

const ANTHROPIC_KEY = "sk-ant-api03-TESTKEY-abcdefghijklmnopqrstuvwxyz-WXYZ";
const OPENAI_KEY = "sk-proj-TESTKEY-abcdefghijklmnopqrstuvwxyz-1234";

/* ------------------------------------------------------------------ Fixtures */

function makeLibrary(count) {
  const themes = [
    { id: "t-net", label: "Networking", keywords: ["networking"], tier: "active" },
    { id: "t-tech", label: "Tech", keywords: ["tech"], tier: "active" },
  ];
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: `item-${i}`,
      videoId: `vid${String(i).padStart(8, "0")}`,
      title: i % 2 ? `CCNA routing lab ${i}` : `Linux shell tips ${i}`,
      channel: i % 2 ? "NetChan" : "LinuxChan",
      themeId: i % 3 === 0 ? "t-net" : "t-tech",
      tags: ["x"],
      note: "private note",
      url: `https://www.youtube.com/watch?v=vid${i}`,
    });
  }
  return { items, themes };
}

/** In-memory stand-in for chrome.storage.local with write counters. */
function makeStore({ items, themes }) {
  const store = {
    items: structuredClone(items),
    themes: structuredClone(themes),
    snapshot: null,
    writes: 0,
  };
  return {
    store,
    deps: {
      loadItems: async () => store.items,
      loadThemes: async () => store.themes,
      saveItems: async (next) => {
        store.writes++;
        store.items = next;
      },
      saveThemes: async (next) => {
        store.writes++;
        store.themes = next;
      },
      saveSnapshot: async (s) => {
        store.writes++;
        store.snapshot = s;
      },
      loadSnapshot: async () => store.snapshot,
      clearSnapshot: async () => {
        store.snapshot = null;
      },
      makeId: (() => {
        let n = 0;
        return () => `new-${++n}`;
      })(),
      keywordsFromLabel: (label) => label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2),
    },
  };
}

/** The real service worker sends a richer row; this mirrors its shape for the fields that matter here. */
function buildItemPayload(it, themeLabelById) {
  const row = { id: it.id, title: it.title, channel: it.channel };
  if (it.themeId && themeLabelById.has(it.themeId)) row.currentCategoryLabel = themeLabelById.get(it.themeId);
  return row;
}

/**
 * Fake model behind a real provider adapter: answers taxonomy and assignment requests from the request body.
 * `tamper(kind, parsed, callIndex)` can corrupt a response to exercise validation.
 */
function fakeAnthropicFetch({ labels = ["Networking", "Linux & Shell", "Misc"], tamper } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const user = JSON.parse(body.messages[0].content);
    let out;
    let kind;
    if (Array.isArray(user.videoSamples)) {
      kind = "taxonomy";
      out = { categories: labels };
    } else if (Array.isArray(user.categories)) {
      kind = "assign";
      const ids = user.categories.map((c) => c.categoryId);
      out = {
        assignments: user.videos.map((v) => ({
          itemId: v.id,
          categoryId: /ccna|routing/i.test(v.title) ? ids[0] : ids[Math.min(1, ids.length - 1)],
        })),
      };
    }
    let text = JSON.stringify(out);
    if (tamper) {
      const t = tamper(kind, out, calls.length);
      if (typeof t === "string") text = t;
      else if (t) text = JSON.stringify(t);
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] }),
    };
  };
  fetch.calls = calls;
  return fetch;
}

function previewDeps(storeDeps, provider, apiKey, fetch, model) {
  return {
    loadItems: storeDeps.loadItems,
    loadThemes: storeDeps.loadThemes,
    buildItemPayload,
    completeJson: (req) => AI.completeJson(provider, { apiKey, model, ...req }, { fetch, sleep: async () => {} }),
  };
}

/* --------------------------------------------------------------------- Tests */

test("planAiCategorizeRun reports videos, batches, and requests", () => {
  assert.deepEqual(CAT.planAiCategorizeRun({ itemCount: 437, strategy: "discover" }), {
    videos: 437,
    truncated: false,
    skipped: 0,
    assignmentBatches: 11,
    taxonomyRequests: 1,
    requests: 12,
  });
  assert.equal(CAT.planAiCategorizeRun({ itemCount: 30, strategy: "existing" }).requests, 1);
  const big = CAT.planAiCategorizeRun({ itemCount: 900, strategy: "discover" });
  assert.equal(big.videos, CAT.LIMITS.maxItems);
  assert.equal(big.truncated, true);
});

test("current playlist: preview covers only that playlist and never writes storage", async () => {
  const lib = makeLibrary(20);
  const { store, deps } = makeStore(lib);
  const before = structuredClone({ items: store.items, themes: store.themes });
  const fetch = fakeAnthropicFetch();
  const playlistIds = ["item-1", "item-2", "item-3", "item-4"];
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
    itemIds: playlistIds,
    strategy: "discover",
    targetCategoryCount: 3,
    scope: { kind: "playlist", name: "CCNA study" },
    providerId: "anthropic",
    providerLabel: "Anthropic (Claude)",
    model: "claude-opus-5-5",
  });
  assert.equal(plan.rows.length, 4);
  assert.deepEqual(plan.rows.map((r) => r.itemId).sort(), playlistIds.slice().sort());
  assert.deepEqual(plan.scope, { kind: "playlist", name: "CCNA study" });
  assert.equal(fetch.calls.length, 2, "1 taxonomy + 1 assignment batch");
  const sentVideos = JSON.parse(fetch.calls[1].body.messages[0].content).videos.map((v) => v.id);
  assert.deepEqual(sentVideos, playlistIds, "videos outside the playlist are not sent");
  assert.equal(JSON.parse(fetch.calls[0].body.messages[0].content).scope.name, "CCNA study");
  // Networking already exists → reused, not new.
  const net = plan.categories.find((c) => c.label === "Networking");
  assert.equal(net.isNew, false);
  assert.equal(net.existingThemeId, "t-net");
  assert.equal(store.writes, 0);
  assert.deepEqual({ items: store.items, themes: store.themes }, before);
});

test("entire library: batched requests share one category list", async () => {
  const lib = makeLibrary(95);
  const { store, deps } = makeStore(lib);
  const fetch = fakeAnthropicFetch();
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "discover",
    targetCategoryCount: 3,
  });
  assert.equal(fetch.calls.length, 1 + Math.ceil(95 / CAT.LIMITS.assignBatchSize));
  const assignCalls = fetch.calls.slice(1).map((c) => JSON.parse(c.body.messages[0].content));
  const lists = new Set(assignCalls.map((u) => JSON.stringify(u.categories)));
  assert.equal(lists.size, 1, "every batch sees the same categories");
  assert.ok(assignCalls.every((u) => u.videos.length <= CAT.LIMITS.assignBatchSize));
  assert.equal(plan.rows.length, 95);
  assert.equal(plan.requests, fetch.calls.length);
  // The taxonomy request sees existing category names for reorganizing, and uses a structured schema.
  const tax = JSON.parse(fetch.calls[0].body.messages[0].content);
  assert.deepEqual(tax.existingCategories, ["Networking", "Tech"]);
  assert.equal(fetch.calls[0].body.output_config.format.type, "json_schema");
  // Assignment schema constrains ids to the batch.
  const enumIds = fetch.calls[1].body.output_config.format.schema.properties.assignments.items.properties.itemId.enum;
  assert.equal(enumIds.length, CAT.LIMITS.assignBatchSize);
  assert.equal(store.writes, 0);
});

test("payload rows exclude URLs and notes not chosen by the row builder", async () => {
  const lib = makeLibrary(3);
  const { deps } = makeStore(lib);
  const fetch = fakeAnthropicFetch();
  await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "existing",
  });
  const raw = JSON.stringify(fetch.calls.map((c) => c.body));
  assert.ok(!raw.includes("youtube.com/watch"));
  assert.ok(!raw.includes(ANTHROPIC_KEY), "the API key is never part of a prompt");
});

test("existing categories: assignments use theme ids and mark unchanged rows", async () => {
  const lib = makeLibrary(6);
  const { deps } = makeStore(lib);
  const fetch = fakeAnthropicFetch();
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "existing",
  });
  assert.equal(fetch.calls.length, 1, "no taxonomy request");
  assert.deepEqual(plan.categories.map((c) => c.key), ["t-net", "t-tech"]);
  assert.ok(plan.categories.every((c) => !c.isNew));
  // item-3 is odd (→ t-net) and already t-net (3 % 3 === 0) → unchanged.
  assert.equal(plan.rows.find((r) => r.itemId === "item-3").status, "unchanged");
  assert.equal(plan.counts.changed + plan.counts.unchanged, 6);
});

for (const [name, tamper] of [
  ["unknown video id", (k, o) => k === "assign" && { assignments: [...o.assignments, { itemId: "intruder", categoryId: "c1" }] }],
  ["duplicate assignment", (k, o) => k === "assign" && { assignments: [...o.assignments, o.assignments[0]] }],
  ["missing assignment", (k, o) => k === "assign" && { assignments: o.assignments.slice(1) }],
  ["unknown category", (k, o) => k === "assign" && { assignments: o.assignments.map((a) => ({ ...a, categoryId: "zzz" })) }],
  ["malformed categories", (k) => k === "taxonomy" && { categories: [{ name: "Networking" }, 7] }],
]) {
  test(`validation rejects ${name} and leaves storage untouched`, async () => {
    const lib = makeLibrary(8);
    const { store, deps } = makeStore(lib);
    const before = structuredClone({ items: store.items, themes: store.themes });
    const fetch = fakeAnthropicFetch({ tamper });
    await assert.rejects(
      CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
        itemIds: lib.items.map((x) => x.id),
        strategy: "discover",
        targetCategoryCount: 3,
      }),
      (e) => e.code === "invalid_output" && /Nothing in your library was changed/.test(e.message)
    );
    assert.equal(store.writes, 0);
    assert.deepEqual({ items: store.items, themes: store.themes }, before);
  });
}

test("truncated JSON from the model cannot modify storage", async () => {
  const lib = makeLibrary(8);
  const { store, deps } = makeStore(lib);
  const fetch = fakeAnthropicFetch({ tamper: (k) => k === "assign" && '{"assignments":[{"itemId":"item-0","categ' });
  await assert.rejects(
    CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
      itemIds: lib.items.map((x) => x.id),
      strategy: "existing",
    }),
    (e) => e.code === "malformed_output"
  );
  assert.equal(store.writes, 0);
});

test("one bad batch response is retried once before failing", async () => {
  const lib = makeLibrary(5);
  const { deps } = makeStore(lib);
  const fetch = fakeAnthropicFetch({ tamper: (k, o, n) => k === "assign" && n === 1 && { assignments: [] } });
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "existing",
  });
  assert.equal(fetch.calls.length, 2);
  assert.equal(plan.rows.length, 5);
});

test("taxonomy validation dedupes, trims, and enforces a minimum", () => {
  assert.deepEqual(CAT.validateTaxonomyResponse({ categories: [" Linux ", "linux", "Networking", "Extra"] }, { targetK: 2 }), [
    "Linux",
    "Networking",
  ]);
  assert.throws(() => CAT.validateTaxonomyResponse({ categories: ["Only"] }, { targetK: 5 }), /too few/);
  assert.throws(() => CAT.validateTaxonomyResponse({ cats: [] }, { targetK: 5 }), /categories/);
});

test("Apply writes the approved changes and an undo snapshot; Undo restores", async () => {
  const lib = makeLibrary(10);
  const { store, deps } = makeStore(lib);
  const original = structuredClone({ items: store.items, themes: store.themes });
  const fetch = fakeAnthropicFetch({ labels: ["Networking", "Linux & Shell", "Never Used"] });
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fetch), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "discover",
    targetCategoryCount: 3,
    providerLabel: "Anthropic (Claude)",
  });
  assert.equal(store.writes, 0);
  const changedRows = plan.rows.filter((r) => r.status === "changed");
  const excluded = changedRows[0].itemId;

  const r = await CAT.commitCategorizationPlan(deps, { plan, excludedItemIds: [excluded] });
  assert.equal(r.snapshotSaved, true);
  assert.equal(r.updatedCount, changedRows.length - 1);
  const labels = store.themes.map((t) => t.label);
  assert.ok(labels.includes("Linux & Shell"), "used new category is created");
  assert.ok(!labels.includes("Never Used"), "unused proposed category is not created");
  const linux = store.themes.find((t) => t.label === "Linux & Shell");
  assert.equal(linux.genreScope, "ai");
  for (const row of changedRows.slice(1)) {
    const it = store.items.find((x) => x.id === row.itemId);
    const expected = row.toLabel === "Networking" ? "t-net" : linux.id;
    assert.equal(it.themeId, expected);
  }
  const ex = store.items.find((x) => x.id === excluded);
  assert.equal(ex.themeId, original.items.find((x) => x.id === excluded).themeId, "unchecked row is untouched");
  assert.equal(store.snapshot.kind, "ai_categorize");

  const u = await CAT.undoCategorization(deps);
  assert.ok(u.restoredCount > 0);
  assert.deepEqual(store.themes, original.themes);
  assert.deepEqual(
    store.items.map((x) => [x.id, x.themeId]),
    original.items.map((x) => [x.id, x.themeId])
  );
  assert.equal(store.snapshot, null);
  await assert.rejects(CAT.undoCategorization(deps), (e) => e.code === "no_snapshot");
});

test("Cancel (discarding a preview) leaves the library untouched", async () => {
  const lib = makeLibrary(6);
  const { store, deps } = makeStore(lib);
  const before = structuredClone({ items: store.items, themes: store.themes });
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fakeAnthropicFetch()), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "discover",
    targetCategoryCount: 3,
  });
  assert.ok(plan.counts.changed > 0);
  // The dashboard's Cancel only drops the plan; no message reaches storage.
  assert.equal(store.writes, 0);
  assert.deepEqual({ items: store.items, themes: store.themes }, before);
  assert.equal(store.snapshot, null);
});

test("Apply rejects a malformed or tampered plan without writing", async () => {
  const lib = makeLibrary(4);
  const { store, deps } = makeStore(lib);
  const bad = [
    null,
    { version: 99, categories: [], rows: [] },
    { version: 1, categories: [{ key: "c1", label: "A" }], rows: [{ itemId: "item-0", categoryKey: "c9", status: "changed" }] },
    {
      version: 1,
      categories: [{ key: "c1", label: "A" }],
      rows: [
        { itemId: "item-0", categoryKey: "c1", status: "changed" },
        { itemId: "item-0", categoryKey: "c1", status: "changed" },
      ],
    },
  ];
  for (const plan of bad) {
    await assert.rejects(CAT.commitCategorizationPlan(deps, { plan }), (e) => e.code === "invalid_plan");
  }
  assert.equal(store.writes, 0);
});

test("Apply skips videos deleted after the preview", async () => {
  const lib = makeLibrary(4);
  const { store, deps } = makeStore(lib);
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.AnthropicProvider, ANTHROPIC_KEY, fakeAnthropicFetch()), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "discover",
    targetCategoryCount: 3,
  });
  store.items = store.items.filter((x) => x.id !== "item-1");
  await CAT.commitCategorizationPlan(deps, { plan });
  assert.equal(store.items.length, 3);
  assert.ok(!store.items.some((x) => x.id === "item-1"));
});

test("existing OpenAI categorization path works through the same contract", async () => {
  const lib = makeLibrary(5);
  const { store, deps } = makeStore(lib);
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    const user = JSON.parse(body.messages[1].content);
    const content = JSON.stringify({
      assignments: user.videos.map((v) => ({ itemId: v.id, categoryId: user.categories[1].categoryId })),
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    };
  };
  const plan = await CAT.runCategorizationPreview(previewDeps(deps, AI.OpenAIProvider, OPENAI_KEY, fetch), {
    itemIds: lib.items.map((x) => x.id),
    strategy: "existing",
  });
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].headers.Authorization, `Bearer ${OPENAI_KEY}`);
  assert.equal(calls[0].body.model, "gpt-4o-mini");
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assert.ok(plan.rows.every((r) => r.toLabel === "Tech"));
  const r = await CAT.commitCategorizationPlan(deps, { plan });
  assert.ok(store.items.every((x) => x.themeId === "t-tech"));
  assert.equal(r.createdThemes.length, 0);
});

test("restoreCategorySnapshot clears categories that no longer exist", () => {
  const snapshot = CAT.captureCategorySnapshot(
    [{ id: "a", themeId: "t1" }],
    [{ id: "t1", label: "One" }],
    { kind: "genre_rebuild", label: "x", at: "2026-10-06T00:00:00.000Z" }
  );
  const r = CAT.restoreCategorySnapshot({
    items: [
      { id: "a", themeId: "t9" },
      { id: "b", themeId: "t9" },
    ],
    snapshot,
  });
  assert.deepEqual(
    r.items.map((x) => x.themeId),
    ["t1", null]
  );
});
