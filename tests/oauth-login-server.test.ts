import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { piModels } from "../src/agent/models.ts";
import { cancelLogin, loginView, oauthProviderRows, startLogin, submitLoginCode } from "../src/server/oauth-login.ts";

type Interaction = AuthInteraction;

/** Replace the provider's real OAuth login with a scripted one. */
function script(provider: string, login: (i: Interaction) => Promise<void>): void {
	const oauth = piModels().getProvider(provider)?.auth.oauth as unknown as { login: (i: Interaction) => Promise<unknown> };
	oauth.login = async (i) => {
		await login(i);
		return { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 1_000_000 };
	};
}

const until = async (check: () => boolean) => {
	for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
	assert.ok(check(), "condition not reached");
};

describe("subscription login sessions", () => {
	it("offers ChatGPT, Claude, Antigravity, Copilot and Grok with their plan names", () => {
		const rows = oauthProviderRows();
		assert.deepEqual(rows.map((r) => r.id), ["openai", "anthropic", "antigravity", "github-copilot", "xai"]);
		assert.ok(rows.every((r) => r.planName.length > 0));
	});

	it("walks browser → pasted code → done, and never exposes a token", async () => {
		script("anthropic", async (i) => {
			i.notify({ type: "auth_url", url: "https://example.test/authorize?x=1", instructions: "Approve it" });
			assert.equal(await i.prompt({ type: "manual_code", message: "Paste the code" }), "the-code");
		});
		const { loginId } = startLogin("anthropic");
		await until(() => loginView(loginId)?.status === "awaiting_code");
		const waiting = loginView(loginId)!;
		assert.equal(waiting.authUrl, "https://example.test/authorize?x=1");
		assert.equal(waiting.codePrompt, "Paste the code");
		assert.equal(submitLoginCode(loginId, "the-code"), "ok");
		await until(() => loginView(loginId)?.status === "done");
		assert.ok(!JSON.stringify(loginView(loginId)).includes('"access"'));
	});

	it("reports flow failures as an error view", async () => {
		script("openai", async () => {
			throw new Error("invalid_grant");
		});
		const { loginId } = startLogin("openai");
		await until(() => loginView(loginId)?.status === "error");
		assert.equal(loginView(loginId)?.error, "invalid_grant");
	});

	it("rejects an unsupported prompt instead of guessing", async () => {
		script("openai", async (i) => {
			await i.prompt({ type: "select", message: "Pick", options: [{ id: "a", label: "A" }] });
		});
		const { loginId } = startLogin("openai");
		await until(() => loginView(loginId)?.status === "error");
		assert.match(loginView(loginId)?.error ?? "", /unsupported login prompt: select/);
	});

	it("answers Copilot's Enterprise-domain prompt with blank, so only github.com is used", async () => {
		let answer: string | undefined;
		script("github-copilot", async (i) => {
			answer = await i.prompt({ type: "text", message: "GitHub Enterprise URL/domain (blank for github.com)" });
			i.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
		});
		const { loginId } = startLogin("github-copilot");
		await until(() => loginView(loginId)?.status === "done");
		assert.equal(answer, "");
	});

	it("shows a device code for Grok sign-in", async () => {
		script("xai", async (i) => {
			i.notify({ type: "device_code", userCode: "WXYZ-9876", verificationUri: "https://accounts.x.ai/device" });
			await new Promise(() => undefined);
		});
		const { loginId } = startLogin("xai");
		await until(() => loginView(loginId)?.status === "awaiting_browser");
		assert.deepEqual(loginView(loginId)?.deviceCode, { userCode: "WXYZ-9876", verificationUri: "https://accounts.x.ai/device" });
		cancelLogin(loginId);
	});

	it("still refuses a text prompt from any other provider", async () => {
		script("openai", async (i) => {
			await i.prompt({ type: "text", message: "Anything" });
		});
		const { loginId } = startLogin("openai");
		await until(() => loginView(loginId)?.status === "error");
		assert.match(loginView(loginId)?.error ?? "", /unsupported login prompt: text/);
	});

	it("a code without a waiting prompt is refused; unknown ids are unknown; cancel drops the session", async () => {
		script("anthropic", () => new Promise(() => undefined));
		const { loginId } = startLogin("anthropic");
		assert.equal(submitLoginCode(loginId, "x"), "not-waiting");
		assert.equal(submitLoginCode("nope", "x"), "unknown");
		assert.ok(cancelLogin(loginId));
		assert.equal(loginView(loginId), null);
	});

	it("starting again cancels the earlier attempt for the same provider", () => {
		script("anthropic", () => new Promise(() => undefined));
		const first = startLogin("anthropic");
		const second = startLogin("anthropic");
		assert.equal(loginView(first.loginId), null);
		assert.notEqual(second.loginId, first.loginId);
		cancelLogin(second.loginId);
	});
});
