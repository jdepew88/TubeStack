/**
 * TubeStack — AI provider adapters (shared by the service worker, dashboard pages, and Node tests).
 *
 * Every provider implements the same small contract so categorization code never branches on the vendor:
 *   id, label, keySetting, modelSetting, origins, models, defaultModel
 *   buildJsonRequest({ apiKey, model, system, user, schema, withFallbacks }) -> { url, init }
 *   readJsonResponse(json) -> string (raw JSON text produced by the model)
 *   httpError(status, json, model) -> AiProviderError
 *   testConnection({ apiKey, model }, deps) -> normalized test result
 *
 * API keys are read from chrome.storage.local by the caller and only ever placed in request headers.
 * Nothing in this file logs keys, request bodies, or responses.
 */
(function initTubeStackAiProviders(root) {
  const ANTHROPIC_API_VERSION = "2023-06-01";
  /** Anthropic server-side refusal fallback (beta). Retried without it if the API rejects the beta. */
  const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01";
  const ANTHROPIC_MAX_TOKENS = 16000;

  class AiProviderError extends Error {
    /**
     * @param {string} code key_required | auth | billing | permission | model_unavailable | rate_limit |
     *   overloaded | server | network | bad_request | too_large | truncated | refused | malformed_output |
     *   invalid_output | host_permission_denied
     */
    constructor(code, message, extra = {}) {
      super(message);
      this.name = "AiProviderError";
      this.code = code;
      this.providerId = extra.providerId || null;
      this.status = extra.status != null ? extra.status : null;
      this.retryable = extra.retryable === true;
    }
  }

  /** Remove anything that looks like an API key from text that may reach the UI. */
  function redactSecrets(text, apiKey) {
    let out = String(text == null ? "" : text);
    const key = String(apiKey || "").trim();
    if (key.length >= 8) out = out.split(key).join("[redacted]");
    out = out.replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, "[redacted]").replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]");
    return out.replace(/\s+/g, " ").trim().slice(0, 300);
  }

  /** "Key on file (…AbCd)" style hint. Never returns more than the last 4 characters. */
  function maskApiKey(key) {
    const k = String(key || "").trim();
    if (!k) return "";
    if (k.length < 12) return "••••";
    return `••••${k.slice(-4)}`;
  }

  /** Strip a ```json fence if a model wrapped its JSON anyway. */
  function stripJsonFence(text) {
    const t = String(text || "").trim();
    const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return m ? m[1].trim() : t;
  }

  /* ------------------------------------------------------------------ OpenAI */

  function openAiHttpErrorMessage(status, json) {
    const err = json?.error;
    const code = String(err?.code || "");
    const msg = String(err?.message || "");
    const blob = `${code} ${msg} ${status}`.toLowerCase();
    if (status === 429 && !blob.includes("insufficient_quota")) {
      return "OpenAI rate limit reached. Wait a few minutes or check usage limits on platform.openai.com, then try again.";
    }
    if (
      blob.includes("insufficient_quota") ||
      blob.includes("billing") ||
      blob.includes("payment") ||
      blob.includes("credit") ||
      blob.includes("exceeded your")
    ) {
      return "OpenAI quota or billing blocked this request. Add credits or fix billing on platform.openai.com, then try again.";
    }
    if (blob.includes("rate_limit") || blob.includes("rate limit")) {
      return "OpenAI rate limit reached. Wait a few minutes or check usage limits on platform.openai.com, then try again.";
    }
    if (status === 401) {
      return "OpenAI rejected the API key (401). Paste a valid secret key in Settings and try again.";
    }
    if (msg) return msg;
    return `OpenAI request failed (${status}).`;
  }

  function openAiErrorCode(status, json) {
    const blob = `${json?.error?.code || ""} ${json?.error?.message || ""}`.toLowerCase();
    if (blob.includes("insufficient_quota") || blob.includes("billing")) return "billing";
    if (status === 429) return "rate_limit";
    if (status === 401) return "auth";
    if (status === 403) return "permission";
    if (status === 404) return "model_unavailable";
    if (status >= 500) return "server";
    return "bad_request";
  }

  const OpenAIProvider = {
    id: "openai",
    label: "OpenAI",
    accountName: "OpenAI",
    keySetting: "openaiApiKey",
    modelSetting: "openaiModel",
    keyPlaceholder: "sk-…",
    minKeyLength: 20,
    origins: ["https://api.openai.com/*"],
    host: "api.openai.com",
    consoleUrl: "https://platform.openai.com/",
    defaultModel: "gpt-4o-mini",
    models: [{ id: "gpt-4o-mini", label: "gpt-4o-mini (default)" }],
    /** OpenAI historically accepted any model string from the caller; keep that. */
    allowCustomModel: true,

    buildJsonRequest({ apiKey, model, system, user }) {
      return {
        url: "https://api.openai.com/v1/chat/completions",
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${String(apiKey).trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: model || this.defaultModel,
            temperature: 0.15,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        },
      };
    },

    readJsonResponse(json) {
      const choice = json?.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new AiProviderError("truncated", "OpenAI stopped before finishing its answer (output too long). Try fewer videos.", {
          providerId: "openai",
        });
      }
      const content = choice?.message?.content;
      if (!content) throw new AiProviderError("malformed_output", "OpenAI returned an empty response.", { providerId: "openai" });
      return content;
    },

    httpError(status, json) {
      const code = openAiErrorCode(status, json);
      return new AiProviderError(code, openAiHttpErrorMessage(status, json), {
        providerId: "openai",
        status,
        retryable: code === "rate_limit" || code === "server",
      });
    },

    /** Validate key (models list) + tiny completion for rate-limit headers; optional billing snapshot. */
    async testConnection({ apiKey }, deps) {
      const fetchImpl = deps.fetch;
      const auth = { Authorization: `Bearer ${apiKey}` };
      let modelCount = 0;
      try {
        const r = await fetchImpl("https://api.openai.com/v1/models", { method: "GET", headers: auth });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          return { ok: false, allOk: false, error: "openai_http", message: redactSecrets(openAiHttpErrorMessage(r.status, j), apiKey) };
        }
        modelCount = Array.isArray(j?.data) ? j.data.length : 0;
      } catch (e) {
        return { ok: false, allOk: false, error: "network", message: redactSecrets(e?.message || e, apiKey) };
      }

      let completionOk = false;
      let completionError = null;
      let lastUsage = null;
      const rateLimits = {};
      try {
        const r2 = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 2,
            temperature: 0,
            messages: [{ role: "user", content: "ok" }],
          }),
        });
        const pick = (name) => {
          const v = r2.headers?.get?.(name);
          if (v != null && String(v).trim() !== "") rateLimits[name] = String(v).trim();
        };
        pick("x-ratelimit-remaining-requests");
        pick("x-ratelimit-limit-requests");
        pick("x-ratelimit-remaining-tokens");
        pick("x-ratelimit-limit-tokens");
        pick("x-ratelimit-reset-requests");
        pick("x-ratelimit-reset-tokens");
        if (r2.ok) {
          completionOk = true;
          const body = await r2.json().catch(() => ({}));
          lastUsage = body?.usage || null;
        } else {
          const j2 = await r2.json().catch(() => ({}));
          completionError = redactSecrets(openAiHttpErrorMessage(r2.status, j2), apiKey);
        }
      } catch (e) {
        completionError = redactSecrets(e?.message || e, apiKey);
      }

      let usageCredits = null;
      try {
        const rb = await fetchImpl("https://api.openai.com/v1/dashboard/billing/credit_grants", { method: "GET", headers: auth });
        if (rb.ok) {
          const bj = await rb.json().catch(() => null);
          if (bj && (bj.total_available != null || bj.total_granted != null)) {
            usageCredits = {
              totalAvailable: typeof bj.total_available === "number" ? bj.total_available : null,
              totalUsed: typeof bj.total_used === "number" ? bj.total_used : null,
              totalGranted: typeof bj.total_granted === "number" ? bj.total_granted : null,
            };
          }
        }
      } catch {
        /* billing endpoint often 401 for standard keys */
      }

      return {
        ok: true,
        provider: "openai",
        allOk: completionOk && modelCount > 0,
        modelCount,
        completionOk,
        completionError,
        rateLimits: Object.keys(rateLimits).length ? rateLimits : null,
        lastUsage,
        usageCredits,
        billingCreditsAvailable: usageCredits != null,
      };
    },
  };

  /* --------------------------------------------------------------- Anthropic */

  /** Anthropic models offered in Settings. Opus 5.5 is the recommended default. */
  const ANTHROPIC_MODELS = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)", effort: "low", fallbacks: true },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, lower cost)", effort: "low", fallbacks: true },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (lowest cost)", effort: null, fallbacks: false },
  ];

  function anthropicModelInfo(model) {
    return ANTHROPIC_MODELS.find((m) => m.id === model) || null;
  }

  function anthropicHeaders(apiKey, { withFallbacks = false } = {}) {
    const h = {
      "x-api-key": String(apiKey).trim(),
      "anthropic-version": ANTHROPIC_API_VERSION,
      "content-type": "application/json",
      // Required for requests that carry a browser/extension Origin header.
      "anthropic-dangerous-direct-browser-access": "true",
    };
    if (withFallbacks) h["anthropic-beta"] = ANTHROPIC_FALLBACK_BETA;
    return h;
  }

  function anthropicHttpError(status, json, model) {
    const type = String(json?.error?.type || "");
    const raw = String(json?.error?.message || "");
    const low = raw.toLowerCase();
    const mk = (code, message, retryable = false) =>
      new AiProviderError(code, message, { providerId: "anthropic", status, retryable });

    if (status === 401 || type === "authentication_error") {
      return mk("auth", "Anthropic API key was rejected. Paste a valid key from the Claude Console in Settings and try again.");
    }
    if (
      status === 402 ||
      type === "billing_error" ||
      low.includes("credit balance") ||
      low.includes("billing") ||
      low.includes("purchase credits")
    ) {
      return mk(
        "billing",
        "Anthropic API usage is unavailable or your account may need additional credits. Check Plans & Billing in the Claude Console."
      );
    }
    if (status === 429 || type === "rate_limit_error") {
      return mk("rate_limit", "Anthropic rate limit reached. Try again shortly.", true);
    }
    if (status === 529 || type === "overloaded_error") {
      return mk("overloaded", "Anthropic API is temporarily overloaded. Try again shortly.", true);
    }
    if (status === 403 || type === "permission_error") {
      return mk("permission", "Anthropic denied this request for your API key. Check the key's workspace and model access in the Claude Console.");
    }
    if (status === 404 || type === "not_found_error") {
      return mk(
        "model_unavailable",
        `The Anthropic model “${model || "selected"}” is not available for this API key. Choose another model in Settings.`
      );
    }
    if (status === 413 || type === "request_too_large") {
      return mk("too_large", "That request was too large for Anthropic. Try fewer videos.");
    }
    if (status >= 500 || type === "api_error") {
      return mk("server", `Anthropic API is unavailable right now (HTTP ${status}). Try again later.`, true);
    }
    const detail = raw ? `: ${raw}` : ".";
    return mk("bad_request", `Anthropic rejected the request (HTTP ${status})${detail}`);
  }

  const AnthropicProvider = {
    id: "anthropic",
    label: "Anthropic (Claude)",
    accountName: "Anthropic",
    keySetting: "anthropicApiKey",
    modelSetting: "anthropicModel",
    keyPlaceholder: "sk-ant-…",
    minKeyLength: 20,
    origins: ["https://api.anthropic.com/*"],
    host: "api.anthropic.com",
    consoleUrl: "https://platform.claude.com/",
    defaultModel: "claude-opus-5-5",
    models: ANTHROPIC_MODELS.map(({ id, label }) => ({ id, label })),
    allowCustomModel: false,

    buildJsonRequest({ apiKey, model, system, user, schema, withFallbacks = true }) {
      const m = model || this.defaultModel;
      const info = anthropicModelInfo(m);
      const outputConfig = {};
      if (schema) outputConfig.format = { type: "json_schema", schema };
      if (info?.effort) outputConfig.effort = info.effort;
      const useFallbacks = withFallbacks && info?.fallbacks === true;
      const body = {
        model: m,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      };
      if (Object.keys(outputConfig).length) body.output_config = outputConfig;
      if (useFallbacks) body.fallbacks = "default";
      return {
        url: "https://api.anthropic.com/v1/messages",
        init: {
          method: "POST",
          headers: anthropicHeaders(apiKey, { withFallbacks: useFallbacks }),
          body: JSON.stringify(body),
        },
      };
    },

    readJsonResponse(json) {
      const stop = json?.stop_reason;
      if (stop === "max_tokens") {
        throw new AiProviderError(
          "truncated",
          "Anthropic stopped before finishing its answer (output too long). Try fewer videos.",
          { providerId: "anthropic" }
        );
      }
      if (stop === "refusal") {
        throw new AiProviderError("refused", "Anthropic declined to categorize this batch. Try again or use a smaller selection.", {
          providerId: "anthropic",
        });
      }
      const blocks = Array.isArray(json?.content) ? json.content : [];
      const text = blocks
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      if (!text.trim()) {
        throw new AiProviderError("malformed_output", "Anthropic returned an empty response.", { providerId: "anthropic" });
      }
      return stripJsonFence(text);
    },

    httpError(status, json, model) {
      return anthropicHttpError(status, json, model);
    },

    /** True when a 400 is about the optional fallback beta, so the request can be retried without it. */
    isFallbackBetaRejection(status, json) {
      if (status !== 400) return false;
      const msg = String(json?.error?.message || "").toLowerCase();
      return msg.includes("anthropic-beta") || msg.includes("fallback");
    },

    /** GET /v1/models/{id} (free) confirms the key and model; a tiny message confirms the account can bill usage. */
    async testConnection({ apiKey, model }, deps) {
      const fetchImpl = deps.fetch;
      const m = model || this.defaultModel;
      const headers = anthropicHeaders(apiKey);
      let modelDisplayName = null;
      try {
        const r = await fetchImpl(`https://api.anthropic.com/v1/models/${encodeURIComponent(m)}`, { method: "GET", headers });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = anthropicHttpError(r.status, j, m);
          return { ok: false, allOk: false, error: err.code, message: redactSecrets(err.message, apiKey) };
        }
        modelDisplayName = j?.display_name || m;
      } catch {
        return {
          ok: false,
          allOk: false,
          error: "network",
          message: "Could not reach Anthropic (network error). Check your connection and try again.",
        };
      }

      let completionOk = false;
      let completionError = null;
      let lastUsage = null;
      try {
        const info = anthropicModelInfo(m);
        const body = { model: m, max_tokens: 16, messages: [{ role: "user", content: "Reply with: ok" }] };
        if (info?.effort) body.output_config = { effort: "low" };
        const r2 = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const j2 = await r2.json().catch(() => ({}));
        if (r2.ok) {
          completionOk = true;
          lastUsage = j2?.usage || null;
        } else {
          completionError = redactSecrets(anthropicHttpError(r2.status, j2, m).message, apiKey);
        }
      } catch {
        completionError = "Could not reach Anthropic (network error).";
      }

      return {
        ok: true,
        provider: "anthropic",
        allOk: completionOk,
        model: m,
        modelDisplayName,
        completionOk,
        completionError,
        lastUsage,
      };
    },
  };

  /* ---------------------------------------------------------- Shared helpers */

  const AI_PROVIDERS = { openai: OpenAIProvider, anthropic: AnthropicProvider };
  const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS);
  const DEFAULT_AI_PROVIDER = "openai";

  function getAiProvider(id) {
    return AI_PROVIDERS[id] || null;
  }

  function resolveAiModel(provider, requested) {
    const r = String(requested || "").trim();
    if (!r) return provider.defaultModel;
    if (provider.models.some((m) => m.id === r)) return r;
    return provider.allowCustomModel ? r : provider.defaultModel;
  }

  /**
   * Which provider/model/key applies for a stored settings object.
   * Installs from before provider selection have no `aiProvider`: they keep using OpenAI (the only provider then).
   */
  function resolveAiSettings(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    const providerId = AI_PROVIDERS[s.aiProvider] ? s.aiProvider : DEFAULT_AI_PROVIDER;
    const provider = AI_PROVIDERS[providerId];
    return {
      providerId,
      provider,
      apiKey: String(s[provider.keySetting] || "").trim(),
      model: resolveAiModel(provider, s[provider.modelSetting]),
    };
  }

  /** Per-provider configured flags + masked key hints for the UI (never the key itself). */
  function describeAiKeys(settings) {
    const s = settings && typeof settings === "object" ? settings : {};
    const out = {};
    for (const id of AI_PROVIDER_IDS) {
      const p = AI_PROVIDERS[id];
      const key = String(s[p.keySetting] || "").trim();
      out[id] = { configured: Boolean(key), hint: maskApiKey(key) };
    }
    return out;
  }

  /** Drop invalid provider/model values from a settings patch before it is stored. */
  function normalizeAiSettingsPatch(patch) {
    const next = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(next, "aiProvider") && !AI_PROVIDERS[next.aiProvider]) {
      delete next.aiProvider;
    }
    for (const id of AI_PROVIDER_IDS) {
      const p = AI_PROVIDERS[id];
      if (Object.prototype.hasOwnProperty.call(next, p.keySetting)) {
        next[p.keySetting] = String(next[p.keySetting] || "").trim();
      }
      if (Object.prototype.hasOwnProperty.call(next, p.modelSetting)) {
        const m = String(next[p.modelSetting] || "").trim();
        if (!m) next[p.modelSetting] = "";
        else if (!p.allowCustomModel && !p.models.some((x) => x.id === m)) delete next[p.modelSetting];
        else next[p.modelSetting] = m;
      }
    }
    return next;
  }

  /** Remove every provider key from a settings object (for anything sent to UI pages). */
  function stripAiSecrets(settings) {
    const s = { ...(settings || {}) };
    for (const id of AI_PROVIDER_IDS) delete s[AI_PROVIDERS[id].keySetting];
    return s;
  }

  function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Provider-neutral JSON completion. Returns the parsed object the model produced.
   * deps: { fetch, sleep?, ensureHostAccess?(provider) }
   */
  async function completeJson(provider, { apiKey, model, system, user, schema }, deps) {
    const key = String(apiKey || "").trim();
    if (key.length < provider.minKeyLength) {
      throw new AiProviderError("key_required", `Add an ${provider.label} API key in Settings (or paste one below).`, {
        providerId: provider.id,
      });
    }
    if (deps.ensureHostAccess) await deps.ensureHostAccess(provider);
    const sleep = deps.sleep || defaultSleep;
    const m = resolveAiModel(provider, model);
    let withFallbacks = true;
    let attempt = 0;
    for (;;) {
      attempt++;
      const req = provider.buildJsonRequest({ apiKey: key, model: m, system, user, schema, withFallbacks });
      let res;
      try {
        res = await deps.fetch(req.url, req.init);
      } catch {
        if (attempt < 2) {
          await sleep(1500);
          continue;
        }
        throw new AiProviderError(
          "network",
          `Could not reach ${provider.label} (network error). Check your connection and try again.`,
          { providerId: provider.id, retryable: true }
        );
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (withFallbacks && provider.isFallbackBetaRejection?.(res.status, json)) {
          withFallbacks = false;
          continue;
        }
        const err = provider.httpError(res.status, json, m);
        err.message = redactSecrets(err.message, key);
        if (err.retryable && attempt < 2) {
          const ra = Number(res.headers?.get?.("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : 3000);
          continue;
        }
        throw err;
      }
      const text = provider.readJsonResponse(json);
      try {
        return JSON.parse(text);
      } catch {
        throw new AiProviderError(
          "malformed_output",
          `${provider.label} returned output TubeStack could not read as JSON (it may have been cut off). Nothing was changed.`,
          { providerId: provider.id }
        );
      }
    }
  }

  async function testAiConnection(provider, { apiKey, model }, deps) {
    const key = String(apiKey || "").trim();
    if (key.length < provider.minKeyLength) {
      return { ok: false, allOk: false, error: "key_required", message: "Paste a key or save one in Settings first." };
    }
    return provider.testConnection({ apiKey: key, model: resolveAiModel(provider, model) }, deps);
  }

  root.TUBESTACK_AI = {
    AiProviderError,
    AI_PROVIDERS,
    AI_PROVIDER_IDS,
    DEFAULT_AI_PROVIDER,
    ANTHROPIC_API_VERSION,
    OpenAIProvider,
    AnthropicProvider,
    getAiProvider,
    resolveAiModel,
    resolveAiSettings,
    describeAiKeys,
    normalizeAiSettingsPatch,
    stripAiSecrets,
    maskApiKey,
    redactSecrets,
    completeJson,
    testAiConnection,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
