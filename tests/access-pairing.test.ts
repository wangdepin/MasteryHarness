import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS_COOKIE, accessCookieValid, cookieValue } from "../src/server/access-cookie.ts";
import { MAX_FAILURES, resetPairingFailures } from "../src/server/access-pairing-limiter.ts";
import { PAIR_PATH, pairingPage } from "../src/server/access-pairing-page.ts";
import { pairingResponse, safeNext } from "../src/server/access-pairing.ts";

const TOKEN = "ab".repeat(32);
const ENV = { LH_ACCESS_TOKEN: TOKEN };
const HOST = "mac.tail1234.ts.net";
const NOW = Date.UTC(2026, 10, 15);

beforeEach(resetPairingFailures);

function submit(fields: Record<string, string>, host = HOST): Request {
	return new Request(`https://${host}${PAIR_PATH}`, {
		method: "POST",
		headers: { host, origin: `https://${host}`, "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields).toString(),
	});
}
const pair = (fields: Record<string, string>, nowMs = NOW, host = HOST) => pairingResponse(submit(fields, host), ENV, nowMs);

test("the right token pairs the device and sends it on to where it was going", async () => {
	const response = await pair({ token: TOKEN, next: "/chat/abc?x=1" });
	assert.equal(response.status, 303);
	assert.equal(response.headers.get("location"), "/chat/abc?x=1");
	const setCookie = response.headers.get("set-cookie") ?? "";
	assert(accessCookieValid(cookieValue(setCookie.split(";")[0] ?? null, ACCESS_COOKIE), TOKEN, NOW));
	for (const attribute of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/"]) assert(setCookie.includes(attribute), attribute);
	assert(!setCookie.includes(TOKEN), "the token itself is never sent back");
	assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("a pasted token may carry whitespace or upper case", async () => {
	assert.equal((await pair({ token: `  ${TOKEN.toUpperCase()}\n` })).status, 303);
});

test("on loopback the cookie is not Secure, so the Mac's own browser can keep it", async () => {
	const response = await pair({ token: TOKEN }, NOW, "localhost:4747");
	assert.equal(response.status, 303);
	assert(!(response.headers.get("set-cookie") ?? "").includes("Secure"));
});

test("a wrong or missing token shows the form again, with no cookie", async () => {
	const attempts: Record<string, string>[] = [{ token: "cd".repeat(32), next: "/chat/abc" }, { next: "/chat/abc" }, { token: "" }];
	for (const fields of attempts) {
		const response = await pair(fields);
		assert.equal(response.status, 403);
		assert.equal(response.headers.get("set-cookie"), null);
		assert.match(await response.text(), /That token didn't match\. Try again\./);
	}
});

test("the form keeps the destination across a failed attempt", async () => {
	const html = await (await pair({ token: "wrong", next: "/chat/abc?x=1" })).text();
	assert.match(html, /name="next" value="\/chat\/abc\?x=1"/);
});

test("after too many failures even the right token waits", async () => {
	for (let i = 0; i < MAX_FAILURES; i++) assert.equal((await pair({ token: "wrong" })).status, 403);
	const blocked = await pair({ token: TOKEN });
	assert.equal(blocked.status, 429);
	assert.equal(blocked.headers.get("set-cookie"), null);
	assert.match(await blocked.text(), /Too many attempts\. Wait a minute, then try again\./);
	assert.equal((await pair({ token: TOKEN }, NOW + 61_000)).status, 303, "and pairs once the minute has passed");
});

test("an oversized form is treated as a wrong token", async () => {
	assert.equal((await pair({ token: TOKEN, next: "/", padding: "x".repeat(5000) })).status, 403);
});

test("with the gate off or misconfigured there is no pairing endpoint", async () => {
	assert.equal((await pairingResponse(submit({ token: TOKEN }), {}, NOW)).status, 404);
	assert.equal((await pairingResponse(submit({ token: "short" }), { LH_ACCESS_TOKEN: "short" }, NOW)).status, 404);
});

test("next is a path on this site: no other host, no API, no backslash tricks", () => {
	for (const good of ["/", "/chat/abc", "/chat/abc?x=1&y=2", "/review"]) assert.equal(safeNext(good), good);
	for (const bad of [null, "", "chat", "//evil.example", "/\\evil.example", "https://evil.example/", "/api/chats", "/api", "javascript:alert(1)"]) {
		assert.equal(safeNext(bad), "/", String(bad));
	}
});

test("the pairing page escapes the destination and loads nothing from elsewhere", () => {
	const html = pairingPage({ next: `/x?a="><script>alert(1)</script>` });
	assert(!html.includes("<script"));
	assert(!/\b(src|href)=/.test(html), "no script, stylesheet, font or image is requested");
	assert.match(html, /autocomplete="current-password"/);
	assert.match(html, /autocomplete="username"/);
});
