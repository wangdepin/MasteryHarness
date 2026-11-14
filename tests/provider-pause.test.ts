/**
 * Paused model sources (owner, 2026-11-13): the stored list, the catalog
 * filter, the admission refusal, the pause route and leftover sign-ins.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

const testData = fs.mkdtempSync(path.join(os.tmpdir(), "lh-provider-pause-"));
process.env.LH_DATA_DIR = testData;
process.env.LH_AUTH_FILE = path.join(testData, "auth.json");
process.env.OPENROUTER_API_KEY = "test-key-openrouter-pause";
delete process.env.OPENAI_API_KEY;
after(() => fs.rmSync(testData, { recursive: true, force: true }));

const { SETTINGS_FILE, OAUTH_FILE } = await import("../config.ts");
const { providerLabel, providerPausedMessage, sanitizePausedProviders } = await import("../src/core/provider-pause.ts");
const { isProviderKeyRefusal, providerPausedRefusal, sanitizeUserSettings, PROVIDER_KEY_MISSING_CODE } = await import("../src/core/settings.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { providerPaused, setProviderPaused } = await import("../src/server/provider-pause.ts");
const { catalogContextLimits, catalogProviders, modelCatalog, validateChatSettings, validateModelsSettings } = await import("../src/server/model-catalog.ts");
const { providerRefusal } = await import("../src/server/keys.ts");
const { providerPauseUpdate } = await import("../src/server/provider-pause-http.ts");
const { leftoverSignIns, removeLeftoverSignIn } = await import("../src/server/oauth-login.ts");
const { hasOAuthCredential } = await import("../src/store/oauth-credentials.ts");

const oauth = (access: string) => ({ type: "oauth", access, refresh: "r", expires: 1 });
const put = (provider: string, body: unknown) =>
	providerPauseUpdate(provider, new Request(`http://localhost/api/providers/${provider}/paused`, { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
	fs.rmSync(SETTINGS_FILE, { force: true });
	fs.rmSync(OAUTH_FILE, { force: true });
});

describe("the stored list", () => {
	it("keeps unique pausable ids, sorted, and nothing else", () => {
		assert.deepEqual(sanitizePausedProviders(["openai", "chatgpt", "openai", "", 7, null, "claude-code"]), ["chatgpt", "openai"]);
		assert.deepEqual(sanitizePausedProviders("openai"), []);
		assert.deepEqual(sanitizePausedProviders(undefined), []);
	});

	it("the record sanitizer cleans the list instead of carrying the raw value", () => {
		assert.deepEqual(sanitizeUserSettings({ version: 1, pausedProviders: ["xai-subscription", 3, "xai-subscription"] })?.pausedProviders, ["xai-subscription"]);
		assert.deepEqual(sanitizeUserSettings({ version: 1, pausedProviders: "openai" })?.pausedProviders, []);
		assert.equal(sanitizeUserSettings({ version: 1 })?.pausedProviders, undefined);
	});

	it("pausing one id keeps the others and the rest of the record; resuming the last drops the key", () => {
		writeSettings({ version: 1, dictation: { language: "en" } });
		assert.deepEqual(setProviderPaused("openai", true), ["openai"]);
		assert.deepEqual(setProviderPaused("chatgpt", true), ["chatgpt", "openai"]);
		assert.equal(providerPaused("chatgpt"), true);
		assert.deepEqual(setProviderPaused("chatgpt", false), ["openai"]);
		assert.deepEqual(setProviderPaused("openai", false), []);
		const record = readSettings();
		assert.equal(record?.pausedProviders, undefined);
		assert.deepEqual(record?.dictation, { language: "en" });
	});
});

describe("labels and the refusal", () => {
	it("names providers the way the Providers page does", () => {
		assert.equal(providerLabel("chatgpt"), "ChatGPT");
		assert.equal(providerLabel("openai"), "OpenAI");
		assert.equal(providerLabel("custom"), "Custom endpoint");
		assert.equal(providerLabel("xai-subscription"), "Grok");
		assert.equal(providerLabel("antigravity"), "Google (Antigravity)");
		assert.equal(providerLabel("no-such-provider"), "no-such-provider");
	});

	it("is the key-missing envelope family with paused wording the client recognizes", () => {
		const envelope = providerPausedRefusal("chatgpt", ["strong"]);
		assert.equal(envelope.code, PROVIDER_KEY_MISSING_CODE);
		assert.equal(envelope.error, "ChatGPT is paused — turn it back on in Settings → Providers");
		assert.equal(envelope.error, providerPausedMessage("chatgpt"));
		assert.equal(isProviderKeyRefusal(envelope.error), true);
	});

	it("admission refuses a paused provider before consulting its key", () => {
		assert.equal(providerRefusal("openrouter", ["strong"]), null);
		setProviderPaused("openrouter", true);
		assert.equal(providerRefusal("openrouter", ["cheap"])?.error, providerPausedMessage("openrouter"));
		setProviderPaused("openrouter", false);
		assert.match(providerRefusal("openai", ["strong"])?.error ?? "", /^No OpenAI key is set/);
	});
});

describe("the catalog", () => {
	it("a paused provider keeps its row (keyPresent unchanged) but loses its models and limits", () => {
		const id = modelCatalog().models.find((m) => m.provider === "openrouter")?.id;
		assert.ok(id, "openrouter federates with its key");
		setProviderPaused("openrouter", true);
		const row = catalogProviders().find((p) => p.id === "openrouter");
		assert.deepEqual({ keyPresent: row?.keyPresent, paused: row?.paused }, { keyPresent: true, paused: true });
		assert.equal(modelCatalog().models.some((m) => m.provider === "openrouter"), false);
		assert.equal(catalogContextLimits().has(`openrouter:${id}`), false);
		setProviderPaused("openrouter", false);
		assert.ok(modelCatalog().models.some((m) => m.provider === "openrouter" && m.id === id));
		assert.equal(catalogProviders().find((p) => p.id === "openrouter")?.paused, false);
	});

	it("a NEW selection of a paused provider is refused; an unchanged saved one still passes", () => {
		const id = modelCatalog().models.find((m) => m.provider === "openrouter")!.id;
		const slot = { model: { provider: "openrouter", id } };
		setProviderPaused("openrouter", true);
		const fresh = validateModelsSettings({ strong: slot }, {});
		assert.deepEqual(fresh, { ok: false, error: providerPausedMessage("openrouter") });
		assert.deepEqual(validateModelsSettings({ strong: slot }, { strong: slot }), { ok: true });
		assert.equal(validateChatSettings({ model: slot.model }).ok, false);
	});
});

describe("PUT /api/providers/:provider/paused", () => {
	it("pauses and resumes one known provider", async () => {
		const paused = await put("openrouter", { paused: true });
		assert.equal(paused.status, 200);
		assert.deepEqual(await paused.json(), { pausedProviders: ["openrouter"] });
		assert.deepEqual(await (await put("openrouter", { paused: false })).json(), { pausedProviders: [] });
	});

	it("refuses a bad body, Claude Code, and pausing an unknown id; resuming any stored id works", async () => {
		assert.equal((await put("openrouter", { paused: "yes" })).status, 400);
		assert.equal((await put("claude-code", { paused: true })).status, 400);
		assert.equal((await put("no-such-provider", { paused: true })).status, 400);
		writeSettings({ version: 1, pausedProviders: ["gone-provider"] });
		assert.deepEqual(await (await put("gone-provider", { paused: false })).json(), { pausedProviders: [] });
	});
});

describe("leftover sign-ins", () => {
	it("lists stored sign-ins the app no longer offers, never offered ones", () => {
		fs.writeFileSync(OAUTH_FILE, JSON.stringify({ openai: oauth("a"), anthropic: oauth("b") }));
		assert.deepEqual(leftoverSignIns(), [{ id: "openai", label: "OpenAI" }]);
	});

	it("removal takes the credential and its paused state, and only for a leftover", async () => {
		fs.writeFileSync(OAUTH_FILE, JSON.stringify({ openai: oauth("a"), anthropic: oauth("b") }));
		setProviderPaused("openai", true);
		assert.equal(await removeLeftoverSignIn("anthropic"), false);
		assert.equal(await removeLeftoverSignIn("openai"), true);
		assert.equal(hasOAuthCredential("openai"), false);
		assert.equal(hasOAuthCredential("anthropic"), true);
		assert.equal(providerPaused("openai"), false);
		assert.deepEqual(leftoverSignIns(), []);
	});
});
