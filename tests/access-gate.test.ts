import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ACCESS_COOKIE, mintAccessCookie } from "../src/server/access-cookie.ts";
import { accessDecision, type AccessRequest } from "../src/server/access-gate.ts";
import { expectedOrigins, hostAllowed } from "../src/server/access-host.ts";
import { PAIR_PATH } from "../src/server/access-pairing-page.ts";
import { gateMode } from "../src/server/access-token.ts";
import { healthBody } from "../src/server/health.ts";
import { proxy } from "../proxy.ts";

const TOKEN = "ab".repeat(32);
const ENV = { LH_ACCESS_TOKEN: TOKEN };
const HOST = "127.0.0.1:4747";
const ORIGIN = `http://${HOST}`;
const NOW = Date.UTC(2026, 10, 15);
const NO_METADATA = { site: null, mode: null, dest: null };
const paired = `${ACCESS_COOKIE}=${mintAccessCookie(TOKEN, NOW)}`;

function req(over: Partial<AccessRequest> = {}): AccessRequest {
	return { method: "GET", pathname: "/", search: "", host: HOST, origin: null, cookieHeader: null, fetchMetadata: NO_METADATA, ...over };
}
const decide = (over: Partial<AccessRequest> = {}, env: Record<string, string | undefined> = ENV) => accessDecision(req(over), env, NOW);

test("mode: off without a token or under the desktop shell, misconfigured unless the token is 64 hex", () => {
	assert.equal(gateMode({}), "off");
	assert.equal(gateMode({ LH_ACCESS_TOKEN: "" }), "off");
	assert.equal(gateMode(ENV), "on");
	assert.equal(gateMode({ LH_ACCESS_TOKEN: TOKEN.toUpperCase() }), "on");
	assert.equal(gateMode({ ...ENV, LH_DESKTOP_SERVER: "1" }), "off");
	for (const bad of ["short", "t".repeat(40), "g".repeat(64), `${TOKEN}0`]) assert.equal(gateMode({ LH_ACCESS_TOKEN: bad }), "misconfigured", bad);
});

test("off: nothing is checked", () => {
	assert.deepEqual(decide({ host: "evil.example", method: "POST", pathname: "/api/chat" }, {}), { kind: "allow" });
});

test("misconfigured: everything is 503 except health", () => {
	const env = { LH_ACCESS_TOKEN: "short" };
	for (const pathname of ["/", "/chat/abc", "/api/chats"]) {
		const decision = decide({ pathname, cookieHeader: paired }, env);
		assert(decision.kind === "deny" && decision.status === 503, pathname);
	}
	assert.deepEqual(decide({ pathname: "/api/health" }, env), { kind: "allow" });
});

test("hosts: loopback names with any port, plus LH_ALLOWED_HOSTS", () => {
	for (const host of ["127.0.0.1", "127.0.0.1:3000", "localhost:8", "LOCALHOST", "[::1]:3000", "[::1]"]) assert(hostAllowed(host, {}), host);
	for (const host of [null, "", "evil.example", "127.0.0.1.evil.example", "192.168.1.5:3000", "localhost.evil.example"]) assert(!hostAllowed(host, {}), String(host));
	assert(hostAllowed("mac.tail1234.ts.net", { LH_ALLOWED_HOSTS: "mac.tail1234.ts.net, other.lan" }));
	assert(!hostAllowed("third.lan", { LH_ALLOWED_HOSTS: "mac.tail1234.ts.net" }));
});

test("row 1: a host that is not allowed is refused on pages, the API, health and pairing", () => {
	for (const over of [{ pathname: "/" }, { pathname: "/api/chats" }, { pathname: "/api/health" }, { method: "POST", pathname: PAIR_PATH, origin: "https://evil.example" }]) {
		const decision = decide({ ...over, host: "evil.example", cookieHeader: paired });
		assert(decision.kind === "deny" && decision.status === 403 && decision.reason === "host not allowed", JSON.stringify(over));
	}
	assert.equal(decide({ host: null, cookieHeader: paired }).kind, "deny");
});

test("row 2: health is public on a good host, GET/HEAD only", () => {
	assert.deepEqual(decide({ pathname: "/api/health" }), { kind: "allow" });
	assert.deepEqual(decide({ method: "HEAD", pathname: "/api/health" }), { kind: "allow" });
	assert.equal(decide({ method: "POST", pathname: "/api/health" }).kind, "deny");
	assert.equal(decide({ pathname: "/api/healthy" }).kind, "deny");
});

test("row 3: the manifest and the home-screen icons are public reads, and nothing near them is", () => {
	for (const pathname of ["/manifest.webmanifest", "/apple-icon.png", "/icon-192.png", "/icon-512.png"]) {
		assert.deepEqual(decide({ pathname }), { kind: "allow" }, pathname);
		assert.deepEqual(decide({ method: "HEAD", pathname }), { kind: "allow" }, pathname);
		assert.deepEqual(decide({ pathname, fetchMetadata: { site: "cross-site", mode: "no-cors", dest: "image" } }), { kind: "allow" }, pathname);
		assert.equal(decide({ method: "POST", pathname, origin: ORIGIN }).kind, "deny", pathname);
		assert.equal(decide({ pathname, host: "evil.example" }).kind, "deny", pathname);
		assert.equal(decide({ pathname }, { LH_ACCESS_TOKEN: "short" }).kind, "deny", pathname);
	}
	for (const pathname of ["/icon-512.png/", "/manifest.json", "/chat/icon-192.png", "/plugin-loader.js"]) assert.equal(decide({ pathname }).kind, "pair", pathname);
});

test("row 4: the pairing form may be posted without a cookie, from this origin only", () => {
	const post = (over: Partial<AccessRequest>) => decide({ method: "POST", pathname: PAIR_PATH, origin: ORIGIN, ...over });
	assert.deepEqual(post({}), { kind: "allow" });
	assert.deepEqual(post({ fetchMetadata: { site: "same-origin", mode: "navigate", dest: "document" } }), { kind: "allow" });
	assert.equal(post({ origin: null }).kind, "deny", "no Origin");
	assert.equal(post({ origin: "http://evil.example" }).kind, "deny", "foreign Origin");
	assert.equal(post({ fetchMetadata: { site: "cross-site", mode: "navigate", dest: "document" } }).kind, "deny", "cross-site form");
	assert.equal(decide({ pathname: PAIR_PATH }).kind, "deny", "GET is not pairing");
});

test("row 5: requests made by another site are refused, except opening a page", () => {
	const crossSite = (over: Partial<AccessRequest>, mode = "cors", dest = "empty") => decide({ cookieHeader: paired, fetchMetadata: { site: "cross-site", mode, dest }, ...over });
	assert.equal(crossSite({ pathname: "/api/chats" }).kind, "deny", "cross-site API read");
	assert.equal(crossSite({ pathname: "/api/events" }, "navigate", "document").kind, "deny", "an API path is never a page load");
	assert.equal(crossSite({ pathname: "/chat/abc" }, "no-cors", "image").kind, "deny", "cross-site subresource");
	assert.equal(crossSite({ pathname: "/chat/abc" }, "navigate", "iframe").kind, "deny", "framing");
	assert.deepEqual(crossSite({ pathname: "/chat/abc" }, "navigate", "document"), { kind: "allow" }, "opening the page");
	assert.equal(decide({ pathname: "/api/chats", cookieHeader: paired, fetchMetadata: { site: "same-site", mode: "cors", dest: "empty" } }).kind, "deny", "same-site is still another origin");
	for (const site of ["same-origin", "none"]) {
		assert.deepEqual(decide({ pathname: "/api/chats", cookieHeader: paired, fetchMetadata: { site, mode: "cors", dest: "empty" } }), { kind: "allow" }, site);
	}
});

test("row 6: an unpaired page load gets the pairing form and comes back to where it was going", () => {
	assert.deepEqual(decide({ pathname: "/chat/abc", search: "?x=1" }), { kind: "pair", next: "/chat/abc?x=1" });
	assert.deepEqual(decide({ method: "HEAD", pathname: "/" }), { kind: "pair", next: "/" });
	const post = decide({ method: "POST", pathname: "/chat/abc", origin: ORIGIN });
	assert(post.kind === "deny" && post.surface === "page", "a page write without a cookie is refused, not offered a form");
});

test("row 7: the unpaired API is refused as JSON, whatever the cookie says", () => {
	const api = decide({ pathname: "/api/chats" });
	assert(api.kind === "deny" && api.surface === "api" && api.status === 403 && /not paired/.test(api.reason));
	for (const cookieHeader of [`${ACCESS_COOKIE}=${TOKEN}`, `${ACCESS_COOKIE}=v1.1.x`, `other=${paired}`, `${ACCESS_COOKIE}=${mintAccessCookie("cd".repeat(32), NOW)}`]) {
		assert.equal(decide({ pathname: "/api/chats", cookieHeader }).kind, "deny", cookieHeader);
	}
});

test("row 8: the paired cookie opens page and API reads, among other cookies", () => {
	assert.deepEqual(decide({ cookieHeader: paired }), { kind: "allow" });
	assert.deepEqual(decide({ pathname: "/api/chats", cookieHeader: `a=b; ${paired}; c=d` }), { kind: "allow" });
	assert.deepEqual(decide({ method: "OPTIONS", pathname: "/api/chats", cookieHeader: paired }), { kind: "allow" });
	// reads carry no Origin requirement (EventSource, plain navigation)
	assert.deepEqual(decide({ pathname: "/api/events", cookieHeader: paired, origin: "http://evil.example" }), { kind: "allow" });
});

test("rows 9 and 10: a paired write needs the Origin of the host it was sent to", () => {
	const post = (origin: string | null) => decide({ method: "POST", pathname: "/api/chat", cookieHeader: paired, origin });
	assert.deepEqual(post(ORIGIN), { kind: "allow" });
	assert.equal(post(null).kind, "deny", "no Origin");
	assert.equal(post("http://evil.example").kind, "deny", "foreign Origin");
	assert.equal(post("null").kind, "deny", "opaque Origin");
	assert.equal(post("http://127.0.0.1:4000").kind, "deny", "other port");
	for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal(decide({ method, pathname: "/api/x", cookieHeader: paired }).kind, "deny", method);
});

test("origins: HTTPS for a named host, either scheme on loopback, and no forwarded header is consulted", () => {
	assert.deepEqual(expectedOrigins("mac.tail1234.ts.net"), ["https://mac.tail1234.ts.net"]);
	assert.deepEqual(expectedOrigins("localhost:4747"), ["http://localhost:4747", "https://localhost:4747"]);
	const env = { ...ENV, LH_ALLOWED_HOSTS: "mac.tail1234.ts.net" };
	const write = (origin: string) => decide({ method: "POST", pathname: "/api/chat", host: "mac.tail1234.ts.net", cookieHeader: paired, origin }, env);
	assert.deepEqual(write("https://mac.tail1234.ts.net"), { kind: "allow" });
	assert.equal(write("http://mac.tail1234.ts.net").kind, "deny", "plain HTTP off loopback");
});

test("an expired cookie is no cookie", () => {
	const later = NOW + 401 * 24 * 60 * 60 * 1000;
	assert.equal(accessDecision(req({ pathname: "/api/chats", cookieHeader: paired }), ENV, later).kind, "deny");
});

test("health body: liveness, version, tokenMode only", () => {
	const body = healthBody({});
	assert.deepEqual(Object.keys(body).sort(), ["ok", "tokenMode", "version"]);
	assert.equal(body.ok, true);
	assert.equal(typeof body.version, "string");
	assert.equal(body.tokenMode, false);
	assert.equal(healthBody(ENV).tokenMode, true);
});

async function withToken(token: string | undefined, run: () => void | Promise<void>) {
	const saved = process.env.LH_ACCESS_TOKEN;
	try {
		if (token === undefined) delete process.env.LH_ACCESS_TOKEN;
		else process.env.LH_ACCESS_TOKEN = token;
		await run();
	} finally {
		if (saved === undefined) delete process.env.LH_ACCESS_TOKEN;
		else process.env.LH_ACCESS_TOKEN = saved;
	}
}

const passedThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";
const liveCookie = () => `${ACCESS_COOKIE}=${mintAccessCookie(TOKEN, Date.now())}`;

test("proxy: an unpaired page is the pairing form, with no app content and no way to frame or cache it", async () => {
	await withToken(TOKEN, async () => {
		const page = proxy(new NextRequest(`${ORIGIN}/chat/new?x=1`, { headers: { host: HOST } }));
		assert.equal(page.status, 403);
		assert.match(page.headers.get("content-type") ?? "", /text\/html/);
		assert.equal(page.headers.get("x-frame-options"), "DENY");
		assert.equal(page.headers.get("cache-control"), "private, no-store");
		const html = await page.text();
		assert.match(html, /This device isn't paired yet\./);
		assert.match(html, new RegExp(`action="${PAIR_PATH}"`));
		assert.match(html, /name="next" value="\/chat\/new\?x=1"/);
	});
});

test("proxy: unpaired API is 403 JSON, a paired request passes with security headers, health stays public", async () => {
	await withToken(TOKEN, () => {
		const api = proxy(new NextRequest(`${ORIGIN}/api/chats`, { headers: { host: HOST } }));
		assert.equal(api.status, 403);
		assert.match(api.headers.get("content-type") ?? "", /json/);
		assert.equal(api.headers.get("x-content-type-options"), "nosniff");

		const page = proxy(new NextRequest(`${ORIGIN}/chat/new`, { headers: { host: HOST, cookie: liveCookie() } }));
		assert(passedThrough(page));
		assert.equal(page.headers.get("x-frame-options"), "DENY");
		assert.equal(page.headers.get("referrer-policy"), "same-origin");
		assert.equal(page.headers.get("cache-control"), "private, no-store");

		const stream = proxy(new NextRequest(`${ORIGIN}/api/events`, { headers: { host: HOST, cookie: liveCookie() } }));
		assert(passedThrough(stream));
		assert.equal(stream.headers.get("cache-control"), null, "API routes keep their own cache policy");

		assert(passedThrough(proxy(new NextRequest(`${ORIGIN}/api/health`, { headers: { host: HOST } }))));
		assert(passedThrough(proxy(new NextRequest(`${ORIGIN}/manifest.webmanifest`, { headers: { host: HOST } }))));
		const pairing = proxy(new NextRequest(ORIGIN + PAIR_PATH, { method: "POST", headers: { host: HOST, origin: ORIGIN } }));
		assert(passedThrough(pairing), "the pairing form reaches its handler");
	});
});

test("proxy: a malformed token closes the server with 503", async () => {
	await withToken("short", () => {
		assert.equal(proxy(new NextRequest(`${ORIGIN}/chat/new`, { headers: { host: HOST } })).status, 503);
		assert.equal(proxy(new NextRequest(`${ORIGIN}/api/chats`, { headers: { host: HOST } })).status, 503);
		assert(passedThrough(proxy(new NextRequest(`${ORIGIN}/api/health`, { headers: { host: HOST } }))));
	});
});

test("proxy: with no token the server is open as before and adds no headers", async () => {
	await withToken(undefined, () => {
		const page = proxy(new NextRequest(`${ORIGIN}/chat/new`, { headers: { host: "anything" } }));
		assert(passedThrough(page));
		for (const name of ["x-frame-options", "referrer-policy", "x-content-type-options", "cache-control"]) assert.equal(page.headers.get(name), null, name);
	});
});
