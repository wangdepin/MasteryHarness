import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loginPageUrl, parseCodeBody, parseStartBody, type OAuthLoginView } from "../src/core/oauth-login.ts";
import { FileCredentialStore, hasOAuthCredential, installationId } from "../src/store/oauth-credentials.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lh-oauth-"));
const oauth = (access: string) => ({ type: "oauth" as const, access, refresh: "r", expires: 1 });

describe("request parsing", () => {
	it("start accepts only the offered providers", () => {
		assert.deepEqual(parseStartBody({ provider: "anthropic" }), { ok: true, value: { provider: "anthropic" } });
		for (const id of ["github-copilot", "xai"]) {
			assert.deepEqual(parseStartBody({ provider: id }), { ok: true, value: { provider: id } });
		}
		for (const body of [null, [], {}, { provider: "amazon-bedrock" }, { provider: 7 }]) {
			assert.equal(parseStartBody(body).ok, false, JSON.stringify(body));
		}
	});

	it("code needs a login id and a bounded non-empty code, trimmed", () => {
		assert.deepEqual(parseCodeBody({ loginId: "a", code: "  xyz " }), { ok: true, value: { loginId: "a", code: "xyz" } });
		for (const body of [null, {}, { loginId: "a" }, { loginId: "", code: "x" }, { loginId: "a", code: "  " }, { loginId: "a", code: "x".repeat(4001) }]) {
			assert.equal(parseCodeBody(body).ok, false, JSON.stringify(body));
		}
	});
});

describe("loginPageUrl", () => {
	const view = (extra: Partial<OAuthLoginView>): OAuthLoginView => ({ loginId: "l", provider: "p", status: "awaiting_browser", ...extra });

	it("is the authorization page of a browser flow", () => {
		assert.equal(loginPageUrl(view({ authUrl: "https://example.test/authorize" })), "https://example.test/authorize");
	});

	it("is the verification page of a device-code flow, where the code is typed", () => {
		const deviceCode = { userCode: "ABCD-1234", verificationUri: "https://accounts.x.ai/device" };
		assert.equal(loginPageUrl(view({ deviceCode })), "https://accounts.x.ai/device");
	});

	it("is absent until the flow has a page", () => {
		assert.equal(loginPageUrl(view({ status: "starting" })), undefined);
	});
});

describe("FileCredentialStore", () => {
	it("persists at mode 0600 and survives a fresh instance", async () => {
		const file = path.join(tmp(), "oauth-credentials.json");
		await new FileCredentialStore(file).modify("openai", async () => oauth("a1"));
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
		const again = new FileCredentialStore(file);
		assert.equal((await again.read("openai"))?.type, "oauth");
		assert.deepEqual(await again.list(), [{ providerId: "openai", type: "oauth" }]);
		assert.ok(hasOAuthCredential("openai", file));
		assert.ok(!hasOAuthCredential("anthropic", file));
	});

	it("serializes concurrent modifies (no lost update)", async () => {
		const store = new FileCredentialStore(path.join(tmp(), "c.json"));
		await Promise.all(
			Array.from({ length: 20 }, () =>
				store.modify("anthropic", async (cur) => oauth(String(Number(cur && cur.type === "oauth" ? cur.access : 0) + 1))),
			),
		);
		const final = await store.read("anthropic");
		assert.equal(final?.type === "oauth" && final.access, "20");
	});

	it("modify returning undefined leaves the entry; delete removes it; corrupt file reads empty", async () => {
		const dir = tmp();
		const file = path.join(dir, "c.json");
		const store = new FileCredentialStore(file);
		await store.modify("openai", async () => oauth("a"));
		await store.modify("openai", async () => undefined);
		assert.equal((await store.read("openai"))?.type, "oauth");
		await store.delete("openai");
		assert.equal(await store.read("openai"), undefined);
		fs.writeFileSync(file, "{not json");
		assert.deepEqual(await store.list(), []);
	});

	it("drops malformed entries on read", async () => {
		const file = path.join(tmp(), "c.json");
		fs.writeFileSync(file, JSON.stringify({ openai: { type: "oauth", access: "a", refresh: "r", expires: 1 }, bad: { type: "wat" }, worse: 5 }));
		assert.deepEqual((await new FileCredentialStore(file).list()).map((c) => c.providerId), ["openai"]);
	});
});

describe("installationId", () => {
	it("is created once and then stable", () => {
		const file = path.join(tmp(), "installation-id");
		const first = installationId(file);
		assert.match(first, /^[0-9a-f-]{36}$/);
		assert.equal(installationId(file), first);
	});
});
