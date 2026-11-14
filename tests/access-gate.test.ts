import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ACCESS_COOKIE, accessDecision, hostAllowed, tokenModeOn, type AccessRequest } from "../src/server/access-gate.ts";
import { healthBody } from "../src/server/health.ts";
import { proxy } from "../proxy.ts";

const TOKEN = "t".repeat(40);
const ENV = { LH_ACCESS_TOKEN: TOKEN };
const HOST = "127.0.0.1:3000";

function req(over: Partial<AccessRequest> = {}): AccessRequest {
	return { method: "GET", pathname: "/", search: "", host: HOST, origin: null, cookieHeader: null, ...over };
}
const paired = `${ACCESS_COOKIE}=${TOKEN}`;

test("token mode is on only with LH_ACCESS_TOKEN, and never under the desktop shell", () => {
	assert.equal(tokenModeOn({}), false);
	assert.equal(tokenModeOn({ LH_ACCESS_TOKEN: "" }), false);
	assert.equal(tokenModeOn(ENV), true);
	assert.equal(tokenModeOn({ ...ENV, LH_DESKTOP_SERVER: "1" }), false);
	assert.deepEqual(accessDecision(req({ host: "evil.example" }), {}), { kind: "allow" }, "off: nothing is checked");
});

test("hosts: loopback names with any port, plus LH_ALLOWED_HOSTS", () => {
	for (const host of ["127.0.0.1", "127.0.0.1:3000", "localhost:8", "LOCALHOST", "[::1]:3000", "[::1]"]) assert(hostAllowed(host, {}), host);
	for (const host of [null, "", "evil.example", "127.0.0.1.evil.example", "192.168.1.5:3000", "localhost.evil.example"]) assert(!hostAllowed(host, {}), String(host));
	assert(hostAllowed("tablet.lan:3000", { LH_ALLOWED_HOSTS: "tablet.lan, other.lan" }));
	assert(!hostAllowed("third.lan", { LH_ALLOWED_HOSTS: "tablet.lan" }));
});

test("no cookie: pages and API are denied, each in its own surface", () => {
	const page = accessDecision(req({ pathname: "/chat/abc" }), ENV);
	assert(page.kind === "deny" && page.surface === "page");
	const api = accessDecision(req({ pathname: "/api/chats" }), ENV);
	assert(api.kind === "deny" && api.surface === "api");
	assert.equal(accessDecision(req({ pathname: "/api/chats", cookieHeader: `${ACCESS_COOKIE}=${"x".repeat(40)}` }), ENV).kind, "deny", "wrong token");
	assert.equal(accessDecision(req({ cookieHeader: `${ACCESS_COOKIE}=short` }), ENV).kind, "deny", "wrong length");
});

test("the paired cookie opens pages and API; other cookies do not", () => {
	assert.deepEqual(accessDecision(req({ cookieHeader: paired }), ENV), { kind: "allow" });
	assert.deepEqual(accessDecision(req({ pathname: "/api/chats", cookieHeader: `a=b; ${paired}; c=d` }), ENV), { kind: "allow" });
	assert.equal(accessDecision(req({ cookieHeader: `other=${TOKEN}` }), ENV).kind, "deny");
});

test("pairing: a page visit with the token sets the cookie and redirects without it", () => {
	assert.deepEqual(accessDecision(req({ pathname: "/", search: `?lh_token=${TOKEN}` }), ENV), { kind: "pair", token: TOKEN, location: "/" });
	assert.deepEqual(accessDecision(req({ pathname: "/chat/abc", search: `?a=1&lh_token=${TOKEN}&b=2` }), ENV), { kind: "pair", token: TOKEN, location: "/chat/abc?a=1&b=2" });
	assert.equal(accessDecision(req({ pathname: "/", search: "?lh_token=wrong" }), ENV).kind, "deny");
	assert.equal(accessDecision(req({ pathname: "/api/chats", search: `?lh_token=${TOKEN}` }), ENV).kind, "deny", "the API never pairs");
	assert.equal(accessDecision(req({ method: "POST", pathname: "/", search: `?lh_token=${TOKEN}` }), ENV).kind, "deny", "only GET pairs");
});

test("a short token fails closed, even with a matching cookie or pairing query", () => {
	const env = { LH_ACCESS_TOKEN: "short" };
	assert.equal(accessDecision(req({ cookieHeader: `${ACCESS_COOKIE}=short` }), env).kind, "deny");
	assert.equal(accessDecision(req({ search: "?lh_token=short" }), env).kind, "deny");
});

test("host check covers pages, API and pairing", () => {
	for (const over of [{ pathname: "/" }, { pathname: "/api/chats" }, { search: `?lh_token=${TOKEN}` }]) {
		const d = accessDecision(req({ ...over, host: "evil.example", cookieHeader: paired }), ENV);
		assert(d.kind === "deny" && d.reason === "host not allowed", JSON.stringify(over));
	}
	assert.equal(accessDecision(req({ host: null, cookieHeader: paired }), ENV).kind, "deny");
});

test("health is public on a good host, GET/HEAD only", () => {
	assert.deepEqual(accessDecision(req({ pathname: "/api/health" }), ENV), { kind: "allow" });
	assert.deepEqual(accessDecision(req({ method: "HEAD", pathname: "/api/health" }), ENV), { kind: "allow" });
	assert.equal(accessDecision(req({ method: "POST", pathname: "/api/health" }), ENV).kind, "deny");
	assert.equal(accessDecision(req({ pathname: "/api/health", host: "evil.example" }), ENV).kind, "deny");
	assert.equal(accessDecision(req({ pathname: "/api/healthy" }), ENV).kind, "deny");
});

test("writes need a same-origin Origin", () => {
	const post = (origin: string | null) => accessDecision(req({ method: "POST", pathname: "/api/chat", cookieHeader: paired, origin }), ENV);
	assert.deepEqual(post(`http://${HOST}`), { kind: "allow" });
	assert.equal(post(null).kind, "deny", "no Origin");
	assert.equal(post("http://evil.example").kind, "deny", "foreign Origin");
	assert.equal(post("null").kind, "deny", "opaque Origin");
	assert.equal(post("http://127.0.0.1:4000").kind, "deny", "other port");
	for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal(accessDecision(req({ method, pathname: "/api/x", cookieHeader: paired }), ENV).kind, "deny", method);
	// reads carry no Origin requirement (EventSource, plain navigation)
	assert.deepEqual(accessDecision(req({ pathname: "/api/events", cookieHeader: paired, origin: "http://evil.example" }), ENV), { kind: "allow" });
});

test("health body: liveness, version, tokenMode only", () => {
	const body = healthBody({});
	assert.deepEqual(Object.keys(body).sort(), ["ok", "tokenMode", "version"]);
	assert.equal(body.ok, true);
	assert.equal(typeof body.version, "string");
	assert.equal(body.tokenMode, false);
	assert.equal(healthBody(ENV).tokenMode, true);
});

test("proxy: 403 page, 403 JSON, pairing redirect with an HttpOnly Strict cookie, then through", () => {
	const saved = process.env.LH_ACCESS_TOKEN;
	const origin = `http://${HOST}`;
	try {
		process.env.LH_ACCESS_TOKEN = TOKEN;
		const page = proxy(new NextRequest(origin + "/chat/new", { headers: { host: HOST } }));
		assert.equal(page.status, 403);
		assert.match(page.headers.get("content-type") ?? "", /text\/html/);
		const api = proxy(new NextRequest(origin + "/api/chats", { headers: { host: HOST } }));
		assert.equal(api.status, 403);
		assert.match(api.headers.get("content-type") ?? "", /json/);
		const pair = proxy(new NextRequest(`${origin}/?lh_token=${TOKEN}`, { headers: { host: HOST } }));
		assert.equal(pair.status, 303);
		assert.equal(pair.headers.get("location"), origin + "/");
		const cookie = pair.headers.get("set-cookie") ?? "";
		assert.match(cookie, new RegExp(`^${ACCESS_COOKIE}=${TOKEN}`));
		assert.match(cookie, /HttpOnly/i);
		assert.match(cookie, /SameSite=strict/i);
		assert.match(cookie, /Path=\//);
		const ok = proxy(new NextRequest(origin + "/api/chats", { headers: { host: HOST, cookie: `${ACCESS_COOKIE}=${TOKEN}` } }));
		assert.equal(ok.headers.get("x-middleware-next"), "1");
		assert.equal(proxy(new NextRequest(origin + "/api/health", { headers: { host: HOST } })).headers.get("x-middleware-next"), "1");
		delete process.env.LH_ACCESS_TOKEN;
		assert.equal(proxy(new NextRequest(origin + "/chat/new", { headers: { host: "anything" } })).headers.get("x-middleware-next"), "1", "off: open as before");
	} finally {
		if (saved === undefined) delete process.env.LH_ACCESS_TOKEN;
		else process.env.LH_ACCESS_TOKEN = saved;
	}
});
