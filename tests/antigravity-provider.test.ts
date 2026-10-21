import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getSupportedThinkingLevels, type Context, type OAuthCredential } from "@earendil-works/pi-ai";
import { piModels } from "../src/agent/models.ts";
import { getAntigravityRequestModelId, getThinkingConfig } from "../src/agent/providers/antigravity/models.ts";
import { getApiKey, refreshAntigravityToken } from "../src/agent/providers/antigravity/oauth.ts";
import { streamAntigravity } from "../src/agent/providers/antigravity/stream.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const API_KEY = JSON.stringify({ token: "tok", projectId: "proj-1" });
const context = { messages: [{ role: "user", content: "ping", timestamp: 1 }] } as unknown as Context;

function sse(...chunks: unknown[]): Response {
	const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("antigravity provider catalog", () => {
	it("registers the shortlist under the antigravity provider", () => {
		const ids = piModels().getModels("antigravity").map((m) => m.id);
		assert.deepEqual(ids, ["gemini-3.8-flash", "gemini-4-argon", "gemini-2.5-pro", "claude-sonnet-5-5", "claude-opus-5-5", "gpt-oss-120b"]);
	});

	it("is a subscription OAuth provider with no API-key auth", () => {
		const auth = piModels().getProvider("antigravity")?.auth;
		assert.equal(auth?.oauth?.isSubscription, true);
		assert.equal(auth?.apiKey, undefined);
	});

	it("shows only the thinking levels the backend advertises", () => {
		const flash = piModels().getModel("antigravity", "gemini-3.8-flash")!;
		assert.deepEqual(getSupportedThinkingLevels(flash), ["low", "medium", "high"]);
		const oss = piModels().getModel("antigravity", "gpt-oss-120b")!;
		assert.deepEqual(getSupportedThinkingLevels(oss), ["medium"]);
	});
});

describe("antigravity routing", () => {
	it("maps public id + level to the backend runtime id", () => {
		assert.equal(getAntigravityRequestModelId("gemini-3.8-flash", "high"), "gemini-3.8-flash-high");
		assert.equal(getAntigravityRequestModelId("claude-opus-5-5", "medium"), "claude-opus-5-5-medium");
		assert.equal(getAntigravityRequestModelId("gpt-oss-120b", "high"), "gpt-oss-120b-medium");
		assert.equal(getAntigravityRequestModelId("gemini-4-argon", undefined), "gemini-4-argon-low");
	});

	it("never sends Gemini 4 Argon a zero budget", () => {
		assert.equal(getThinkingConfig("gemini-4-argon-low", "off"), undefined);
		assert.deepEqual(getThinkingConfig("gemini-4-argon-low", "low"), { includeThoughts: true, thinkingBudget: 1_000 });
	});
});

describe("antigravity streaming", () => {
	it("posts the agent request and parses the SSE reply", async () => {
		const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: headers.get("authorization") });
			return sse(
				{ response: { candidates: [{ content: { role: "model", parts: [{ text: "po" }] } }] } },
				{
					response: {
						candidates: [{ content: { role: "model", parts: [{ text: "ng" }] }, finishReason: "STOP" }],
						usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 },
					},
				},
			);
		}) as typeof fetch;

		const model = piModels().getModel("antigravity", "gemini-3.8-flash")!;
		const result = await streamAntigravity(model, context, { apiKey: API_KEY, reasoning: "low" }).result();

		assert.equal(result.stopReason, "stop");
		assert.deepEqual(result.content, [{ type: "text", text: "pong" }]);
		assert.equal(result.usage.input, 8);
		assert.equal(calls.length, 1);
		const [call] = calls;
		assert.match(call!.url, /\/v1internal:streamGenerateContent\?alt=sse$/);
		assert.equal(call!.auth, "Bearer tok");
		assert.equal(call!.body.project, "proj-1");
		assert.equal(call!.body.model, "gemini-3.8-flash-low");
		assert.equal(call!.body.requestType, "agent");
	});

	it("fails the stream, not the process, when the backend rejects the account", async () => {
		globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 403 })) as typeof fetch;
		const model = piModels().getModel("antigravity", "gemini-3.8-flash")!;
		const result = await streamAntigravity(model, context, { apiKey: API_KEY }).result();
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage ?? "", /nope/);
	});

	it("errors without credentials instead of calling the network", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network must not be touched");
		}) as typeof fetch;
		const model = piModels().getModel("antigravity", "gemini-3.8-flash")!;
		const result = await streamAntigravity(model, context, {}).result();
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage ?? "", /credentials/i);
	});
});

describe("antigravity token handling", () => {
	const credential: OAuthCredential = { type: "oauth", access: "old", refresh: "r1", expires: 0, projectId: "proj-1", email: "a@b.test" };

	it("derives the request key from the stored credential", () => {
		assert.deepEqual(JSON.parse(getApiKey(credential)), { token: "old", projectId: "proj-1" });
	});

	it("refreshes the access token and keeps project and email", async () => {
		let sent = "";
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			sent = String(init?.body);
			return new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 });
		}) as typeof fetch;
		const next = await refreshAntigravityToken(credential);
		assert.equal(next.access, "new");
		assert.equal(next.refresh, "r1");
		assert.equal(next.projectId, "proj-1");
		assert.equal(next.email, "a@b.test");
		assert.match(sent, /grant_type=refresh_token/);
		assert.ok(next.expires > Date.now());
	});

	it("surfaces a rejected refresh as an error", async () => {
		globalThis.fetch = (async () => new Response("invalid_grant", { status: 400 })) as typeof fetch;
		await assert.rejects(() => refreshAntigravityToken(credential), /refresh failed/);
	});
});
