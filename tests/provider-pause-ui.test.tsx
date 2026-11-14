/**
 * Settings → Providers pause UI (owner, 2026-11-13): the switch reads the
 * catalog's `paused`, flips every id a row stands for, and a leftover
 * sign-in can be paused or removed after an inline confirmation.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { after, afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { installModalDom } from "./modal-dom.ts";
import { notifySettingsSaved } from "../components/settings-signal.ts";
import { ProviderPauseSwitch, rowPaused } from "../components/settings/provider-pause.tsx";
import { SubscriptionLogin } from "../components/settings/subscription-login.tsx";
import type { CatalogProvider, ModelCatalogResponse } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window, document: dom.document, Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
	CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
});
after(installModalDom(dom));
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let paused = new Set<string>();
let calls: { method: string; path: string; body?: unknown }[] = [];
let leftover = [{ id: "openai", label: "OpenAI" }];
let signIns = [{ id: "antigravity", label: "Google (Antigravity)", planName: "Antigravity", signedIn: true }, { id: "anthropic", label: "Claude", planName: "Claude", signedIn: false }];

const row = (id: string): CatalogProvider => ({ id, envVar: "", keyPresent: true, paused: paused.has(id) });
function catalog(): ModelCatalogResponse {
	return {
		models: [], defaults: null,
		rolePins: { researcher: null, demoBuilder: null, visualMaker: null, extractor: null, auditor: null, sideQuestion: null },
		slots: { strong: null, cheap: null, vision: null },
		providers: ["antigravity", "moonshotai", "moonshotai-cn", "openai"].map(row),
	};
}
function installFetch() {
	calls = [];
	globalThis.fetch = async (input, init) => {
		const path = String(input), method = init?.method ?? "GET";
		calls.push({ method, path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
		if (path === "/api/models") return Response.json(catalog());
		const pause = path.match(/^\/api\/providers\/([^/]+)\/paused$/);
		if (pause && method === "PUT") {
			const id = decodeURIComponent(pause[1]!);
			if ((JSON.parse(String(init?.body)) as { paused: boolean }).paused) paused.add(id); else paused.delete(id);
			return Response.json({ pausedProviders: [...paused].sort() });
		}
		if (path === "/api/auth/oauth") return Response.json({ providers: signIns, leftover });
		if (path === "/api/auth/oauth/leftover/openai" && method === "DELETE") { leftover = []; return Response.json({ ok: true }); }
		throw new Error(`Unexpected request ${method} ${path}`);
	};
}
async function render(children: React.ReactNode) {
	if (!root) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
	await act(async () => root!.render(children));
	// The catalog cache is module-wide: re-read it for this test's state.
	await act(async () => notifySettingsSaved("keys"));
}
function element(testid: string) { const e = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`); assert.ok(e, testid); return e; }
async function click(testid: string) { await act(async () => element(testid).click()); }
const pauseCalls = () => calls.filter((c) => c.method === "PUT").map((c) => [c.path, c.body]);

afterEach(async () => {
	await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined;
	globalThis.fetch = originalFetch;
	paused = new Set(); leftover = [{ id: "openai", label: "OpenAI" }];
});

describe("rowPaused", () => {
	it("is paused only when every id of the row is", () => {
		const providers = [{ ...row("a"), paused: true }, { ...row("b"), paused: false }];
		assert.equal(rowPaused(providers, ["a"]), true);
		assert.equal(rowPaused(providers, ["a", "b"]), false);
		assert.equal(rowPaused(providers, []), false);
		assert.equal(rowPaused(undefined, ["a"]), false);
	});
});

describe("ProviderPauseSwitch", () => {
	it("turning a key row off pauses every provider the key serves, then shows Paused", async () => {
		installFetch();
		await render(<ProviderPauseSwitch ids={["moonshotai", "moonshotai-cn"]} label="Moonshot" />);
		const toggle = element("toggle-use-moonshot");
		assert.equal(toggle.getAttribute("aria-checked"), "true");
		assert.equal(document.querySelector('[data-testid="paused-moonshotai"]'), null);
		await click("toggle-use-moonshot");
		assert.deepEqual(pauseCalls(), [
			["/api/providers/moonshotai/paused", { paused: true }],
			["/api/providers/moonshotai-cn/paused", { paused: true }],
		]);
		assert.equal(element("toggle-use-moonshot").getAttribute("aria-checked"), "false");
		assert.equal(element("paused-moonshotai").textContent, "Paused");
	});

	it("turning a paused row back on resumes it", async () => {
		paused = new Set(["openai"]);
		installFetch();
		await render(<ProviderPauseSwitch ids={["openai"]} label="OpenAI" />);
		assert.equal(element("toggle-use-openai").getAttribute("aria-checked"), "false");
		await click("toggle-use-openai");
		assert.deepEqual(pauseCalls(), [["/api/providers/openai/paused", { paused: false }]]);
		assert.equal(element("toggle-use-openai").getAttribute("aria-checked"), "true");
	});

	it("renders nothing for a row with no provider ids", async () => {
		installFetch();
		await render(<div data-testid="host"><ProviderPauseSwitch ids={[]} label="ChatGPT" /></div>);
		assert.equal(element("host").innerHTML, "");
	});
});

describe("Subscription sign-in rows", () => {
	it("a signed-in row has the switch beside Signed in; a signed-out row has none", async () => {
		installFetch();
		await render(<SubscriptionLogin />);
		assert.ok(element("subscription-antigravity").querySelector('[data-testid="toggle-use-google-antigravity-"]'));
		assert.equal(element("subscription-anthropic").querySelector('[role="switch"]'), null);
		await click("toggle-use-google-antigravity-");
		assert.deepEqual(pauseCalls(), [["/api/providers/antigravity/paused", { paused: true }]]);
		assert.equal(element("paused-antigravity").textContent, "Paused");
		assert.equal(element("subscription-antigravity-signout").textContent?.trim(), "Sign out", "Sign out stays a separate action");
	});
});

describe("Leftover sign-ins", () => {
	it("lists a leftover with a pause switch and removes it only after confirming", async () => {
		installFetch();
		await render(<SubscriptionLogin />);
		assert.ok(element("group-leftover-sign-ins"));
		assert.match(element("leftover-openai").textContent ?? "", /OpenAI · old sign-in, no longer offered/);
		assert.ok(element("toggle-use-openai"));
		await click("leftover-openai-remove");
		assert.match(element("leftover-openai-confirm").textContent ?? "", /can.t be signed in again here/);
		assert.equal(calls.some((c) => c.method === "DELETE"), false, "nothing removed before confirming");
		await click("leftover-openai-remove-confirm");
		assert.ok(calls.some((c) => c.method === "DELETE" && c.path === "/api/auth/oauth/leftover/openai"));
		assert.equal(document.querySelector('[data-testid="group-leftover-sign-ins"]'), null);
	});
});
