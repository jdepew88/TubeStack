const test = require("node:test");
const assert = require("node:assert/strict");

require("../lib/ai-providers.js");

const AI = globalThis.TUBESTACK_AI;
const { OpenAIProvider, AnthropicProvider, AiProviderError } = AI;

const ANTHROPIC_KEY = "sk-ant-api03-TESTKEY-abcdefghijklmnopqrstuvwxyz-WXYZ";
const OPENAI_KEY = "sk-proj-TESTKEY-abcdefghijklmnopqrstuvwxyz-1234";

/** Minimal fetch double: each call pops the next scripted response and records the request. */
function scriptedFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next.throws) throw new TypeError("Failed to fetch");
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name) => (next.headers || {})[name.toLowerCase()] ?? null },
      json: async () => next.json,
    };
  };
  fn.calls = calls;
  return fn;
}

const noSleep = async () => {};

function anthropicMessage(text, extra = {}) {
  return {
    status: 200,
    json: {
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
      usage: { input_tokens: 10, output_tokens: 5 },
      ...extra,
    },
  };
}

function anthropicError(status, type, message) {
  return { status, json: { type: "error", error: { type, message } } };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof AiProviderError, `expected AiProviderError, got ${e}`);
    assert.equal(e.code, code);
    return true;
  });
}

/* ------------------------------------------------------------------ Settings */

test("settings: legacy installs without aiProvider keep using OpenAI", () => {
  const r = AI.resolveAiSettings({ openaiApiKey: OPENAI_KEY });
  assert.equal(r.providerId, "openai");
  assert.equal(r.apiKey, OPENAI_KEY);
  assert.equal(r.model, "gpt-4o-mini");
  assert.equal(AI.resolveAiSettings({}).providerId, "openai");
  assert.equal(AI.resolveAiSettings({ aiProvider: "gemini" }).providerId, "openai");
});

test("settings: an existing custom OpenAI model setting survives", () => {
  const r = AI.resolveAiSettings({ openaiApiKey: OPENAI_KEY, openaiModel: "gpt-4.1-mini" });
  assert.equal(r.model, "gpt-4.1-mini");
});

test("settings: selecting Anthropic uses the Anthropic key and default model", () => {
  const r = AI.resolveAiSettings({ aiProvider: "anthropic", anthropicApiKey: ANTHROPIC_KEY, openaiApiKey: OPENAI_KEY });
  assert.equal(r.providerId, "anthropic");
  assert.equal(r.apiKey, ANTHROPIC_KEY);
  assert.equal(r.model, "claude-opus-5-5");
  const sonnet = AI.resolveAiSettings({ aiProvider: "anthropic", anthropicModel: "claude-sonnet-5-5" });
  assert.equal(sonnet.model, "claude-sonnet-5-5");
  const unknown = AI.resolveAiSettings({ aiProvider: "anthropic", anthropicModel: "claude-made-up" });
  assert.equal(unknown.model, "claude-opus-5-5");
});

test("settings: selecting OpenAI after Anthropic switches back without touching keys", () => {
  const stored = { aiProvider: "anthropic", anthropicApiKey: ANTHROPIC_KEY, openaiApiKey: OPENAI_KEY };
  const next = { ...stored, ...AI.normalizeAiSettingsPatch({ aiProvider: "openai" }) };
  assert.equal(AI.resolveAiSettings(next).providerId, "openai");
  assert.equal(next.anthropicApiKey, ANTHROPIC_KEY);
  assert.equal(next.openaiApiKey, OPENAI_KEY);
});

test("settings: patch normalization saves an Anthropic key and drops invalid values", () => {
  const p = AI.normalizeAiSettingsPatch({
    anthropicApiKey: `  ${ANTHROPIC_KEY}  `,
    aiProvider: "not-a-provider",
    anthropicModel: "claude-unknown",
  });
  assert.equal(p.anthropicApiKey, ANTHROPIC_KEY);
  assert.ok(!("aiProvider" in p));
  assert.ok(!("anthropicModel" in p));
  const ok = AI.normalizeAiSettingsPatch({ aiProvider: "anthropic", anthropicModel: "claude-haiku-4-5" });
  assert.deepEqual(ok, { aiProvider: "anthropic", anthropicModel: "claude-haiku-4-5" });
});

test("settings: stored keys are masked for the UI and stripped from client settings", () => {
  const settings = { openaiApiKey: OPENAI_KEY, anthropicApiKey: ANTHROPIC_KEY, aiProvider: "anthropic", uiThemePreset: "x" };
  const keys = AI.describeAiKeys(settings);
  assert.deepEqual(keys.anthropic, { configured: true, hint: "••••WXYZ" });
  assert.deepEqual(keys.openai, { configured: true, hint: "••••1234" });
  assert.equal(AI.describeAiKeys({}).anthropic.configured, false);
  const serialized = JSON.stringify(keys);
  assert.ok(!serialized.includes(ANTHROPIC_KEY) && !serialized.includes(OPENAI_KEY));
  const stripped = AI.stripAiSecrets(settings);
  assert.ok(!("openaiApiKey" in stripped) && !("anthropicApiKey" in stripped));
  assert.equal(stripped.aiProvider, "anthropic");
  assert.equal(stripped.uiThemePreset, "x");
});

/* ------------------------------------------------------- Request normalization */

test("OpenAI: request keeps the existing chat-completions JSON shape", () => {
  const req = OpenAIProvider.buildJsonRequest({ apiKey: OPENAI_KEY, model: "", system: "S", user: "U" });
  assert.equal(req.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(req.init.headers.Authorization, `Bearer ${OPENAI_KEY}`);
  const body = JSON.parse(req.init.body);
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.temperature, 0.15);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.messages, [
    { role: "system", content: "S" },
    { role: "user", content: "U" },
  ]);
});

test("Anthropic: request uses the Messages API with structured output", () => {
  const schema = { type: "object", properties: {}, required: [], additionalProperties: false };
  const req = AnthropicProvider.buildJsonRequest({ apiKey: ANTHROPIC_KEY, model: "claude-opus-5-5", system: "S", user: "U", schema });
  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  const h = req.init.headers;
  assert.equal(h["x-api-key"], ANTHROPIC_KEY);
  assert.equal(h["anthropic-version"], "2023-06-01");
  assert.equal(h["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(h["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.ok(!("Authorization" in h));
  const body = JSON.parse(req.init.body);
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.system, "S");
  assert.deepEqual(body.messages, [{ role: "user", content: "U" }]);
  assert.deepEqual(body.output_config, { format: { type: "json_schema", schema }, effort: "low" });
  assert.equal(body.fallbacks, "default");
  assert.ok(body.max_tokens > 1000);
  assert.ok(!("temperature" in body) && !("thinking" in body));
  assert.ok(!req.init.body.includes(ANTHROPIC_KEY), "key must not appear in the body");
});

test("Anthropic: Haiku requests omit effort and the fallback beta", () => {
  const req = AnthropicProvider.buildJsonRequest({ apiKey: ANTHROPIC_KEY, model: "claude-haiku-4-5", system: "S", user: "U" });
  const body = JSON.parse(req.init.body);
  assert.ok(!("output_config" in body));
  assert.ok(!("fallbacks" in body));
  assert.ok(!("anthropic-beta" in req.init.headers));
});

/* ---------------------------------------------------------- Anthropic responses */

test("Anthropic: successful response is parsed from text blocks", async () => {
  const fetch = scriptedFetch([anthropicMessage('{"categories":["Networking","Linux"]}')]);
  let ensured = null;
  const out = await AI.completeJson(
    AnthropicProvider,
    { apiKey: ANTHROPIC_KEY, model: "claude-sonnet-5-5", system: "S", user: "U" },
    { fetch, sleep: noSleep, ensureHostAccess: async (p) => (ensured = p.id) }
  );
  assert.deepEqual(out, { categories: ["Networking", "Linux"] });
  assert.equal(ensured, "anthropic");
  assert.equal(fetch.calls.length, 1);
});

test("Anthropic: fenced JSON is still accepted", async () => {
  const fetch = scriptedFetch([anthropicMessage('```json\n{"ok":true}\n```')]);
  const out = await AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, { fetch, sleep: noSleep });
  assert.deepEqual(out, { ok: true });
});

test("Anthropic: invalid or truncated output is rejected", async () => {
  await rejectsWithCode(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([anthropicMessage('{"assignments":[{"itemId":"a"')]),
      sleep: noSleep,
    }),
    "malformed_output"
  );
  await rejectsWithCode(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([anthropicMessage('{"a":1}', { stop_reason: "max_tokens" })]),
      sleep: noSleep,
    }),
    "truncated"
  );
  await rejectsWithCode(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([anthropicMessage("", { stop_reason: "refusal", content: [] })]),
      sleep: noSleep,
    }),
    "refused"
  );
  await rejectsWithCode(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([{ status: 200, json: { content: [] , stop_reason: "end_turn" } }]),
      sleep: noSleep,
    }),
    "malformed_output"
  );
});

test("Anthropic: 401 maps to a key-rejected message", async () => {
  const fetch = scriptedFetch([anthropicError(401, "authentication_error", "invalid x-api-key")]);
  await assert.rejects(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, { fetch, sleep: noSleep }),
    (e) => e.code === "auth" && /Anthropic API key was rejected/.test(e.message)
  );
  assert.equal(fetch.calls.length, 1, "auth errors are not retried");
});

test("Anthropic: billing and low-credit errors map to a credits message", async () => {
  for (const resp of [
    anthropicError(402, "billing_error", "billing problem"),
    anthropicError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
  ]) {
    await assert.rejects(
      AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, {
        fetch: scriptedFetch([resp]),
        sleep: noSleep,
      }),
      (e) => e.code === "billing" && /may need additional credits/.test(e.message)
    );
  }
});

test("Anthropic: 429 is retried once, then reported as a rate limit", async () => {
  const fetch = scriptedFetch([
    { ...anthropicError(429, "rate_limit_error", "slow down"), headers: { "retry-after": "1" } },
    anthropicError(429, "rate_limit_error", "slow down"),
  ]);
  const sleeps = [];
  await assert.rejects(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, {
      fetch,
      sleep: async (ms) => sleeps.push(ms),
    }),
    (e) => e.code === "rate_limit" && e.message === "Anthropic rate limit reached. Try again shortly."
  );
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(sleeps, [1000]);
});

test("Anthropic: a transient 529 succeeds on retry", async () => {
  const fetch = scriptedFetch([anthropicError(529, "overloaded_error", "Overloaded"), anthropicMessage('{"ok":1}')]);
  const out = await AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, { fetch, sleep: noSleep });
  assert.deepEqual(out, { ok: 1 });
});

test("Anthropic: server and network errors are normalized", async () => {
  await rejectsWithCode(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([anthropicError(500, "api_error", "boom"), anthropicError(500, "api_error", "boom")]),
      sleep: noSleep,
    }),
    "server"
  );
  const net = scriptedFetch([{ throws: true }, { throws: true }]);
  await assert.rejects(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, { fetch: net, sleep: noSleep }),
    (e) => e.code === "network" && /Could not reach Anthropic/.test(e.message)
  );
  await rejectsWithCode(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, model: "claude-opus-5-5", system: "S", user: "U" }, {
      fetch: scriptedFetch([anthropicError(404, "not_found_error", "model: claude-opus-5-5")]),
      sleep: noSleep,
    }),
    "model_unavailable"
  );
});

test("Anthropic: a rejected fallback beta is retried without it", async () => {
  const fetch = scriptedFetch([
    anthropicError(400, "invalid_request_error", "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header."),
    anthropicMessage('{"ok":true}'),
  ]);
  const out = await AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, model: "claude-opus-5-5", system: "S", user: "U" }, { fetch, sleep: noSleep });
  assert.deepEqual(out, { ok: true });
  assert.equal(fetch.calls[0].init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.ok(!("anthropic-beta" in fetch.calls[1].init.headers));
  assert.ok(!("fallbacks" in fetch.calls[1].body));
});

test("errors never echo the API key", async () => {
  const fetch = scriptedFetch([anthropicError(400, "invalid_request_error", `bad header ${ANTHROPIC_KEY}`)]);
  await assert.rejects(
    AI.completeJson(AnthropicProvider, { apiKey: ANTHROPIC_KEY, system: "S", user: "U" }, { fetch, sleep: noSleep }),
    (e) => !e.message.includes(ANTHROPIC_KEY) && e.message.includes("[redacted]")
  );
});

test("missing key fails before any network call", async () => {
  const fetch = scriptedFetch([]);
  await rejectsWithCode(
    AI.completeJson(AnthropicProvider, { apiKey: "short", system: "S", user: "U" }, { fetch, sleep: noSleep }),
    "key_required"
  );
  assert.equal(fetch.calls.length, 0);
});

/* ------------------------------------------------------------- OpenAI responses */

test("OpenAI: success, 401, quota, and truncation keep their existing messages", async () => {
  const ok = await AI.completeJson(OpenAIProvider, { apiKey: OPENAI_KEY, system: "S", user: "U" }, {
    fetch: scriptedFetch([{ status: 200, json: { choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }] } }]),
    sleep: noSleep,
  });
  assert.deepEqual(ok, { a: 1 });
  await assert.rejects(
    AI.completeJson(OpenAIProvider, { apiKey: OPENAI_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([{ status: 401, json: { error: { message: "Incorrect API key" } } }]),
      sleep: noSleep,
    }),
    (e) => e.code === "auth" && /OpenAI rejected the API key \(401\)/.test(e.message)
  );
  await assert.rejects(
    AI.completeJson(OpenAIProvider, { apiKey: OPENAI_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([{ status: 429, json: { error: { code: "insufficient_quota", message: "You exceeded your current quota" } } }]),
      sleep: noSleep,
    }),
    (e) => e.code === "billing" && /quota or billing/.test(e.message)
  );
  await rejectsWithCode(
    AI.completeJson(OpenAIProvider, { apiKey: OPENAI_KEY, system: "S", user: "U" }, {
      fetch: scriptedFetch([{ status: 200, json: { choices: [{ message: { content: '{"a":' }, finish_reason: "length" }] } }]),
      sleep: noSleep,
    }),
    "truncated"
  );
});

/* -------------------------------------------------------------- Test connection */

test("Anthropic test connection checks the model and a tiny request", async () => {
  const fetch = scriptedFetch([
    { status: 200, json: { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" } },
    anthropicMessage("ok"),
  ]);
  const r = await AI.testAiConnection(AnthropicProvider, { apiKey: ANTHROPIC_KEY, model: "claude-sonnet-5-5" }, { fetch });
  assert.equal(r.ok, true);
  assert.equal(r.allOk, true);
  assert.equal(r.modelDisplayName, "Claude Sonnet 5.5");
  assert.equal(fetch.calls[0].url, "https://api.anthropic.com/v1/models/claude-sonnet-5-5");
  assert.equal(fetch.calls[1].body.max_tokens, 16);

  const bad = await AI.testAiConnection(AnthropicProvider, { apiKey: ANTHROPIC_KEY }, {
    fetch: scriptedFetch([anthropicError(401, "authentication_error", "invalid x-api-key")]),
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "auth");

  const broke = await AI.testAiConnection(AnthropicProvider, { apiKey: ANTHROPIC_KEY }, {
    fetch: scriptedFetch([
      { status: 200, json: { id: "claude-opus-5-5" } },
      anthropicError(400, "invalid_request_error", "Your credit balance is too low"),
    ]),
  });
  assert.equal(broke.ok, true);
  assert.equal(broke.allOk, false);
  assert.match(broke.completionError, /additional credits/);
});

test("OpenAI test connection keeps its existing result shape", async () => {
  const fetch = scriptedFetch([
    { status: 200, json: { data: [{ id: "a" }, { id: "b" }] } },
    { status: 200, json: { usage: { total_tokens: 9 } }, headers: { "x-ratelimit-remaining-requests": "99" } },
    { status: 401, json: {} },
  ]);
  const r = await AI.testAiConnection(OpenAIProvider, { apiKey: OPENAI_KEY }, { fetch });
  assert.equal(r.ok, true);
  assert.equal(r.allOk, true);
  assert.equal(r.modelCount, 2);
  assert.equal(r.completionOk, true);
  assert.deepEqual(r.rateLimits, { "x-ratelimit-remaining-requests": "99" });
  assert.equal(r.usageCredits, null);
});
