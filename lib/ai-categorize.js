/**
 * TubeStack — provider-neutral AI categorization (shared by the service worker, dashboard, and Node tests).
 *
 * Flow: preview (AI calls + strict validation, no storage writes) -> user reviews -> apply (single write + undo snapshot).
 * Storage, ID generation, and the AI call are injected so this file has no chrome.* or network dependency.
 */
(function initTubeStackAiCategorize(root) {
  const LIMITS = {
    /** Max library videos per run (whole library is processed in batches up to this cap). */
    maxItems: 500,
    /** Videos per assignment request. */
    assignBatchSize: 40,
    /** Compact rows shown to the model when it proposes a taxonomy for the whole selection. */
    taxonomySampleSize: 120,
    /** Existing category labels passed as context when proposing a taxonomy. */
    existingCategoryContext: 80,
    minCategories: 2,
    maxCategories: 28,
  };

  const PLAN_VERSION = 1;
  const SNAPSHOT_VERSION = 1;

  class CategorizationError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "CategorizationError";
      this.code = code;
    }
  }

  function normalizeStrategy(s) {
    return s === "existing" ? "existing" : s === "criteria" ? "criteria" : "discover";
  }

  function clampTargetCount(n) {
    return Math.min(LIMITS.maxCategories, Math.max(LIMITS.minCategories, Number(n) || 8));
  }

  /** Requests a run will make — used for the cost/consent confirmation before anything is sent. */
  function planAiCategorizeRun({ itemCount, strategy }) {
    const total = Math.max(0, Number(itemCount) || 0);
    const videos = Math.min(total, LIMITS.maxItems);
    const assignmentBatches = videos ? Math.ceil(videos / LIMITS.assignBatchSize) : 0;
    const taxonomyRequests = normalizeStrategy(strategy) === "existing" || !videos ? 0 : 1;
    return {
      videos,
      truncated: total > LIMITS.maxItems,
      skipped: Math.max(0, total - LIMITS.maxItems),
      assignmentBatches,
      taxonomyRequests,
      requests: assignmentBatches + taxonomyRequests,
    };
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /** Evenly spaced sample so a big library's taxonomy reflects the whole selection, not just its first rows. */
  function sampleEvenly(rows, size) {
    if (rows.length <= size) return rows.slice();
    const out = [];
    const step = rows.length / size;
    for (let i = 0; i < size; i++) out.push(rows[Math.floor(i * step)]);
    return out;
  }

  function compactSampleRow(r) {
    const out = { title: r.title };
    if (r.channel) out.channel = r.channel;
    if (r.currentCategoryLabel) out.currentCategoryLabel = r.currentCategoryLabel;
    if (Array.isArray(r.tags) && r.tags.length) out.tags = r.tags.slice(0, 5);
    return out;
  }

  /* --------------------------------------------------------------- Schemas */

  const TAXONOMY_SCHEMA = {
    type: "object",
    properties: { categories: { type: "array", items: { type: "string" } } },
    required: ["categories"],
    additionalProperties: false,
  };

  function assignmentSchema(itemIds, categoryIds) {
    return {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string", enum: itemIds },
              categoryId: { type: "string", enum: categoryIds },
            },
            required: ["itemId", "categoryId"],
            additionalProperties: false,
          },
        },
      },
      required: ["assignments"],
      additionalProperties: false,
    };
  }

  /* ------------------------------------------------------------ Validation */

  /** Returns a cleaned label list or throws. Duplicates (case-insensitive) collapse; extras beyond targetK are dropped. */
  function validateTaxonomyResponse(parsed, { targetK }) {
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.categories)) {
      throw new CategorizationError("invalid_output", "The AI response was missing a categories[] list.");
    }
    const seen = new Set();
    const out = [];
    for (const raw of parsed.categories) {
      if (typeof raw !== "string") {
        throw new CategorizationError("invalid_output", "The AI response contained a category that was not text.");
      }
      const label = raw.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!label) continue;
      const k = label.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(label);
    }
    if (out.length < LIMITS.minCategories) {
      throw new CategorizationError("invalid_output", "The AI proposed too few usable categories.");
    }
    return out.slice(0, targetK);
  }

  /**
   * Every requested itemId must appear exactly once with an allowed categoryId. Anything else rejects the batch.
   * @returns {Map<string,string>} itemId -> categoryId
   */
  function validateAssignmentResponse(parsed, { itemIds, categoryIds }) {
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.assignments)) {
      throw new CategorizationError("invalid_output", "The AI response was missing an assignments[] list.");
    }
    const want = new Set(itemIds);
    const allowed = new Set(categoryIds);
    const out = new Map();
    for (const a of parsed.assignments) {
      if (!a || typeof a !== "object" || typeof a.itemId !== "string" || typeof a.categoryId !== "string") {
        throw new CategorizationError("invalid_output", "The AI response contained a malformed assignment.");
      }
      const id = a.itemId.trim();
      const cid = a.categoryId.trim();
      if (!want.has(id)) {
        throw new CategorizationError("invalid_output", "The AI response referenced a video that was not in the request.");
      }
      if (out.has(id)) {
        throw new CategorizationError("invalid_output", "The AI response assigned the same video more than once.");
      }
      if (!allowed.has(cid)) {
        throw new CategorizationError("invalid_output", "The AI response used a category that was not offered.");
      }
      out.set(id, cid);
    }
    const missing = itemIds.filter((id) => !out.has(id)).length;
    if (missing) {
      throw new CategorizationError("invalid_output", `The AI response skipped ${missing} video(s) in a batch.`);
    }
    return out;
  }

  /* --------------------------------------------------------------- Prompts */

  function granularityHint(granularity) {
    return granularity === "specific"
      ? "Prefer specific niches (e.g. Android, iOS, PC gaming, Generative AI) — still concise (2–6 words)."
      : "Prefer broad buckets (e.g. Tech, Gaming, Music) — short labels.";
  }

  function taxonomyPrompt({ strategy, targetK, granularity, criteriaText, sample, totalVideos, existingLabels, scopeContext }) {
    const hint = granularityHint(granularity);
    const common = `videoSamples contain only fields TubeStack already stored locally (no transcripts, no URLs, no API keys). existingCategories lists the user's current category labels: reuse a label exactly when it already fits, and replace vague, duplicate, or overlapping labels with cleaner ones. JSON only: {"categories":["label1",...]} — categories.length must equal ${targetK}. Labels must be unique (case-insensitive).`;
    const system =
      strategy === "criteria"
        ? `You name exactly ${targetK} category labels for a personal YouTube library. Follow the user's instructions in the JSON field userCriteria. ${hint} ${common}`
        : `You name exactly ${targetK} category labels that best group the user's saved YouTube videos (see videoSamples). ${hint} ${common}`;
    const payload = { videoSamples: sample, totalVideos, existingCategories: existingLabels };
    if (strategy === "criteria") payload.userCriteria = criteriaText || "(infer sensible groups from the videos)";
    if (scopeContext) payload.scope = scopeContext;
    return { system, user: JSON.stringify(payload) };
  }

  function assignmentPrompt({ categories, videos, scopeContext }) {
    const system = `Assign each saved YouTube video to exactly one category from categories[] using its categoryId. Each object in videos[] only contains metadata TubeStack already stored (title, channel, listCategory, optional tags/suggestedTags/notes/descriptionSnippet, optional currentCategoryLabel). Do not assume transcripts, watch URLs, or API keys are available. Pick the closest fit when uncertain. JSON only: {"assignments":[{"itemId":"","categoryId":""}]} — include every video in videos[] exactly once, using its id as itemId.`;
    const payload = { categories, videos };
    if (scopeContext) payload.scope = scopeContext;
    return { system, user: JSON.stringify(payload) };
  }

  /* --------------------------------------------------------------- Preview */

  /** Calls the model, retrying a batch once if its response fails validation. */
  async function callValidated(deps, request, validate) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = await deps.completeJson(request);
      try {
        return validate(parsed);
      } catch (e) {
        if (!(e instanceof CategorizationError)) throw e;
        lastErr = e;
      }
    }
    throw new CategorizationError(
      "invalid_output",
      `${lastErr.message} TubeStack retried once and stopped. Nothing in your library was changed.`
    );
  }

  /**
   * Build a categorization preview. Performs AI calls but never writes storage.
   * deps: { loadItems, loadThemes, buildItemPayload(item, themeLabelById), completeJson({system,user,schema}), onProgress? }
   */
  async function runCategorizationPreview(deps, opts) {
    const strategy = normalizeStrategy(opts.strategy);
    const rawIds = Array.isArray(opts.itemIds) ? opts.itemIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
    const itemIds = [...new Set(rawIds)];
    if (!itemIds.length) throw new CategorizationError("no_items", "No videos selected.");
    const cappedIds = itemIds.slice(0, LIMITS.maxItems);

    const [allItems, themes] = await Promise.all([deps.loadItems(), deps.loadThemes()]);
    const byId = new Map(allItems.map((x) => [x.id, x]));
    const targets = cappedIds.map((id) => byId.get(id)).filter(Boolean);
    if (!targets.length) throw new CategorizationError("no_items", "None of those videos are in your library.");

    const themeLabelById = new Map(themes.map((t) => [t.id, String(t.label || "").trim()]));
    const rows = targets.map((it) => deps.buildItemPayload(it, themeLabelById));
    const scopeContext =
      opts.scope && opts.scope.kind === "playlist" && opts.scope.name
        ? { kind: "playlist", name: String(opts.scope.name).slice(0, 120) }
        : null;
    const progress = typeof deps.onProgress === "function" ? deps.onProgress : () => {};

    /** @type {{key:string,label:string,existingThemeId:string|null}[]} */
    let categories;
    if (strategy === "existing") {
      if (!themes.length) throw new CategorizationError("no_categories", "Add at least one category first.");
      categories = themes.map((t) => ({
        key: String(t.id),
        label: String(t.label || "").slice(0, 80),
        existingThemeId: t.id,
      }));
    } else {
      const targetK = clampTargetCount(opts.targetCategoryCount);
      const existingLabels = themes
        .map((t) => String(t.label || "").trim())
        .filter(Boolean)
        .slice(0, LIMITS.existingCategoryContext);
      const prompt = taxonomyPrompt({
        strategy,
        targetK,
        granularity: opts.granularity === "specific" ? "specific" : "broad",
        criteriaText: String(opts.criteriaText || "").trim().slice(0, 1200),
        sample: sampleEvenly(rows, LIMITS.taxonomySampleSize).map(compactSampleRow),
        totalVideos: rows.length,
        existingLabels,
        scopeContext,
      });
      progress({ phase: "taxonomy" });
      const labels = await callValidated(deps, { ...prompt, schema: TAXONOMY_SCHEMA }, (p) =>
        validateTaxonomyResponse(p, { targetK })
      );
      const labelToTheme = new Map(themes.map((t) => [String(t.label || "").trim().toLowerCase(), t.id]));
      categories = labels.map((label, i) => ({
        key: `c${i + 1}`,
        label,
        existingThemeId: labelToTheme.get(label.toLowerCase()) || null,
      }));
    }

    const catForPrompt = categories.map((c) => ({ categoryId: c.key, label: c.label }));
    const categoryIds = categories.map((c) => c.key);
    const assigned = new Map();
    const batches = chunk(rows, LIMITS.assignBatchSize);
    for (let b = 0; b < batches.length; b++) {
      progress({ phase: "assign", batch: b + 1, batches: batches.length });
      const batch = batches[b];
      const batchIds = batch.map((r) => r.id);
      const prompt = assignmentPrompt({ categories: catForPrompt, videos: batch, scopeContext });
      const result = await callValidated(
        deps,
        { ...prompt, schema: assignmentSchema(batchIds, categoryIds) },
        (p) => validateAssignmentResponse(p, { itemIds: batchIds, categoryIds })
      );
      for (const [id, cid] of result) assigned.set(id, cid);
    }

    return buildPreviewPlan({
      targets,
      themes,
      categories,
      assigned,
      strategy,
      meta: {
        providerId: opts.providerId || null,
        providerLabel: opts.providerLabel || null,
        model: opts.model || null,
        scope: scopeContext ? { kind: "playlist", name: scopeContext.name } : { kind: opts.scope?.kind || "library" },
        requestedCount: itemIds.length,
        truncated: itemIds.length > LIMITS.maxItems,
        requests: batches.length + (strategy === "existing" ? 0 : 1),
        createdAt: deps.now ? deps.now() : new Date().toISOString(),
      },
    });
  }

  function buildPreviewPlan({ targets, themes, categories, assigned, strategy, meta }) {
    const themeLabel = new Map(themes.map((t) => [t.id, String(t.label || "")]));
    const catByKey = new Map(categories.map((c) => [c.key, c]));
    const used = new Map();
    const rows = targets.map((it) => {
      const key = assigned.get(it.id);
      const cat = catByKey.get(key);
      used.set(key, (used.get(key) || 0) + 1);
      const fromThemeId = it.themeId != null && themeLabel.has(it.themeId) ? it.themeId : null;
      const unchanged = cat.existingThemeId != null && cat.existingThemeId === fromThemeId;
      return {
        itemId: it.id,
        title: String(it.title || "").slice(0, 200),
        channel: String(it.channel || "").slice(0, 120),
        fromThemeId,
        fromLabel: fromThemeId ? themeLabel.get(fromThemeId) : "",
        categoryKey: cat.key,
        toLabel: cat.label,
        status: unchanged ? "unchanged" : "changed",
      };
    });
    const outCategories = categories.map((c) => ({
      key: c.key,
      label: c.label,
      existingThemeId: c.existingThemeId,
      isNew: c.existingThemeId == null,
      videoCount: used.get(c.key) || 0,
    }));
    const changed = rows.filter((r) => r.status === "changed").length;
    return {
      version: PLAN_VERSION,
      strategy,
      ...meta,
      categories: outCategories,
      rows,
      counts: {
        videos: rows.length,
        changed,
        unchanged: rows.length - changed,
        newCategories: outCategories.filter((c) => c.isNew).length,
        reusedCategories: outCategories.filter((c) => !c.isNew && c.videoCount > 0).length,
      },
    };
  }

  /* ----------------------------------------------------------------- Apply */

  function assertPlanShape(plan) {
    const bad = (m) => new CategorizationError("invalid_plan", m);
    if (!plan || typeof plan !== "object" || plan.version !== PLAN_VERSION) throw bad("Unknown or missing preview.");
    if (!Array.isArray(plan.categories) || !Array.isArray(plan.rows)) throw bad("Preview is incomplete.");
    const keys = new Set();
    for (const c of plan.categories) {
      if (!c || typeof c.key !== "string" || typeof c.label !== "string" || !c.label.trim()) throw bad("Preview has an invalid category.");
      if (keys.has(c.key)) throw bad("Preview has duplicate categories.");
      keys.add(c.key);
    }
    const seen = new Set();
    for (const r of plan.rows) {
      if (!r || typeof r.itemId !== "string" || !keys.has(r.categoryKey)) throw bad("Preview has an invalid video row.");
      if (seen.has(r.itemId)) throw bad("Preview lists a video twice.");
      seen.add(r.itemId);
    }
  }

  function captureCategorySnapshot(items, themes, { kind, label, at }) {
    const itemThemeIds = {};
    for (const it of items) itemThemeIds[it.id] = it.themeId != null ? it.themeId : null;
    return {
      version: SNAPSHOT_VERSION,
      kind,
      label: label || "",
      at: at || new Date().toISOString(),
      themes: JSON.parse(JSON.stringify(themes)),
      itemThemeIds,
    };
  }

  /**
   * Pure: returns next items/themes for an approved plan. Inputs are not mutated.
   * opts: { excludedItemIds?: string[], makeId(), keywordsFromLabel(label) }
   */
  function applyCategorizationPlan({ items, themes, plan }, opts) {
    assertPlanShape(plan);
    const excluded = new Set(Array.isArray(opts.excludedItemIds) ? opts.excludedItemIds.map(String) : []);
    const nextThemes = themes.slice();
    const themeIds = new Set(themes.map((t) => t.id));
    const byLabel = new Map(themes.map((t) => [String(t.label || "").trim().toLowerCase(), t.id]));
    const keyToThemeId = new Map();
    const created = [];
    const rowsToApply = plan.rows.filter((r) => r.status === "changed" && !excluded.has(r.itemId));
    const usedKeys = new Set(rowsToApply.map((r) => r.categoryKey));

    for (const c of plan.categories) {
      if (c.existingThemeId && themeIds.has(c.existingThemeId)) {
        keyToThemeId.set(c.key, c.existingThemeId);
        continue;
      }
      const label = c.label.trim().slice(0, 80);
      const existing = byLabel.get(label.toLowerCase());
      if (existing) {
        keyToThemeId.set(c.key, existing);
        continue;
      }
      // Proposed categories are created only when at least one approved video lands in them.
      if (!usedKeys.has(c.key)) continue;
      const id = opts.makeId();
      const kw = new Set([label.toLowerCase(), ...opts.keywordsFromLabel(label)]);
      const theme = { id, label, keywords: [...kw].slice(0, 48), tier: "active", genreScope: "ai" };
      nextThemes.push(theme);
      created.push(theme);
      byLabel.set(label.toLowerCase(), id);
      keyToThemeId.set(c.key, id);
    }

    const target = new Map();
    for (const r of rowsToApply) {
      const tid = keyToThemeId.get(r.categoryKey);
      if (tid) target.set(r.itemId, tid);
    }
    let updatedCount = 0;
    const nextItems = items.map((it) => {
      const tid = target.get(it.id);
      if (!tid || it.themeId === tid) return it;
      updatedCount++;
      return { ...it, themeId: tid };
    });
    return { items: nextItems, themes: nextThemes, updatedCount, createdThemes: created };
  }

  /** Pure: restore themes and per-item category from a snapshot. Items added later keep theirs when still valid. */
  function restoreCategorySnapshot({ items, snapshot }) {
    if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.themes) || !snapshot.itemThemeIds) {
      throw new CategorizationError("no_snapshot", "There is no AI categorization to undo.");
    }
    const themes = snapshot.themes;
    const valid = new Set(themes.map((t) => t.id));
    const map = snapshot.itemThemeIds;
    let restoredCount = 0;
    const nextItems = items.map((it) => {
      let next = Object.prototype.hasOwnProperty.call(map, it.id) ? map[it.id] : it.themeId;
      if (next != null && !valid.has(next)) next = null;
      if ((it.themeId ?? null) === (next ?? null)) return it;
      restoredCount++;
      return { ...it, themeId: next };
    });
    return { items: nextItems, themes, restoredCount };
  }

  /**
   * Apply an approved plan to storage and save an undo snapshot.
   * deps: { loadItems, loadThemes, saveItems, saveThemes, saveSnapshot, makeId, keywordsFromLabel, now? }
   */
  async function commitCategorizationPlan(deps, { plan, excludedItemIds }) {
    const [items, themes] = await Promise.all([deps.loadItems(), deps.loadThemes()]);
    const result = applyCategorizationPlan(
      { items, themes, plan },
      { excludedItemIds, makeId: deps.makeId, keywordsFromLabel: deps.keywordsFromLabel }
    );
    if (!result.updatedCount && !result.createdThemes.length) {
      return { ...result, snapshotSaved: false };
    }
    const snapshot = captureCategorySnapshot(items, themes, {
      kind: "ai_categorize",
      label: `${plan.providerLabel || "AI"} categorization`,
      at: deps.now ? deps.now() : undefined,
    });
    await deps.saveSnapshot(snapshot);
    if (result.createdThemes.length) await deps.saveThemes(result.themes);
    await deps.saveItems(result.items);
    return { ...result, snapshotSaved: true };
  }

  /** deps: { loadItems, saveItems, saveThemes, loadSnapshot, clearSnapshot } */
  async function undoCategorization(deps) {
    const snapshot = await deps.loadSnapshot();
    const items = await deps.loadItems();
    const result = restoreCategorySnapshot({ items, snapshot });
    await deps.saveThemes(result.themes);
    await deps.saveItems(result.items);
    await deps.clearSnapshot();
    return { ...result, kind: snapshot.kind, label: snapshot.label };
  }

  root.TUBESTACK_AI_CATEGORIZE = {
    LIMITS,
    PLAN_VERSION,
    CategorizationError,
    TAXONOMY_SCHEMA,
    assignmentSchema,
    planAiCategorizeRun,
    sampleEvenly,
    validateTaxonomyResponse,
    validateAssignmentResponse,
    runCategorizationPreview,
    buildPreviewPlan,
    applyCategorizationPlan,
    captureCategorySnapshot,
    restoreCategorySnapshot,
    commitCategorizationPlan,
    undoCategorization,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
