const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("manifest stays Manifest V3 with unchanged required permissions", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["contextMenus", "identity", "scripting", "sidePanel", "storage", "unlimitedStorage"]
  );
  assert.deepEqual([...manifest.host_permissions].sort(), ["https://m.youtube.com/*", "https://www.youtube.com/*"]);
});

test("AI providers are optional host permissions only", () => {
  const optional = manifest.optional_host_permissions;
  assert.ok(optional.includes("https://api.openai.com/*"));
  assert.ok(optional.includes("https://api.anthropic.com/*"));
  assert.ok(!manifest.host_permissions.includes("https://api.anthropic.com/*"));
  for (const p of optional) assert.ok(!/^\*:|<all_urls>|:\/\/\*\//.test(p), `broad pattern ${p}`);
});

test("provider origins match the manifest", () => {
  require("../lib/ai-providers.js");
  const AI = globalThis.TUBESTACK_AI;
  for (const id of AI.AI_PROVIDER_IDS) {
    for (const origin of AI.AI_PROVIDERS[id].origins) {
      assert.ok(manifest.optional_host_permissions.includes(origin), `${origin} must be optional_host_permissions`);
    }
  }
});

test("extension CSP forbids remote and eval'd code", () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert.equal(csp, "script-src 'self'; object-src 'self'");
});

test("service worker imports and dashboard scripts are local files that exist", () => {
  const sw = read("background/service-worker.js");
  for (const m of sw.matchAll(/importScripts\("([^"]+)"\)/g)) {
    assert.ok(fs.existsSync(path.join(root, "background", m[1])), `missing ${m[1]}`);
  }
  for (const page of ["dashboard/dashboard.html", "dashboard/setup-integrations.html"]) {
    const html = read(page);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${page} must not use inline scripts`);
    for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
      assert.ok(!/^https?:/i.test(m[1]), `${page} loads remote script ${m[1]}`);
      assert.ok(fs.existsSync(path.join(root, path.dirname(page), m[1])), `missing ${m[1]}`);
    }
  }
});

test("new AI code has no eval or Function constructor", () => {
  for (const rel of ["lib/ai-providers.js", "lib/ai-categorize.js", "background/service-worker.js", "dashboard/dashboard.js"]) {
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(read(rel)), rel);
  }
});

test("privacy policy discloses both AI providers", () => {
  const html = read("privacy/privacy.html");
  assert.match(html, /Anthropic/);
  assert.match(html, /OpenAI/);
  assert.match(html, /api\.anthropic\.com/);
});
