import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS_COOKIE, COOKIE_MAX_AGE_S, accessCookieHeader, accessCookieValid, cookieValue, mintAccessCookie } from "../src/server/access-cookie.ts";

const TOKEN = "ab".repeat(32);
const NOW = Date.UTC(2026, 10, 15);
const DAY_MS = 24 * 60 * 60 * 1000;

test("a minted cookie is valid for its token until it expires", () => {
	const value = mintAccessCookie(TOKEN, NOW);
	assert(accessCookieValid(value, TOKEN, NOW));
	assert(accessCookieValid(value, TOKEN, NOW + 399 * DAY_MS));
	assert(!accessCookieValid(value, TOKEN, NOW + COOKIE_MAX_AGE_S * 1000), "expired at the lifetime");
	assert(!accessCookieValid(value, TOKEN, NOW + 401 * DAY_MS));
});

test("the cookie never contains the token", () => {
	const value = mintAccessCookie(TOKEN, NOW);
	assert(!value.includes(TOKEN));
	assert(!value.toLowerCase().includes(TOKEN.slice(0, 16)));
});

test("changing the token signs every device out", () => {
	assert(!accessCookieValid(mintAccessCookie(TOKEN, NOW), "cd".repeat(32), NOW));
});

test("a tampered or malformed cookie is refused", () => {
	const [version, expiry, signature] = mintAccessCookie(TOKEN, NOW).split(".");
	const later = String(Number(expiry) + 1);
	for (const value of [
		null, "", TOKEN, "v1", `v1.${expiry}`, `v1.${later}.${signature}`, `v2.${expiry}.${signature}`,
		`${version}.${expiry}.${signature}x`, `${version}.${expiry}.${signature}.extra`, `${version}.-1.${signature}`, `${version}.1e9.${signature}`,
	]) assert(!accessCookieValid(value, TOKEN, NOW), String(value));
});

test("cookieValue finds one cookie among several", () => {
	assert.equal(cookieValue(`a=b; ${ACCESS_COOKIE}=v1.2.c; d=e`, ACCESS_COOKIE), "v1.2.c");
	assert.equal(cookieValue(`x${ACCESS_COOKIE}=nope`, ACCESS_COOKIE), null);
	assert.equal(cookieValue(null, ACCESS_COOKIE), null);
	assert.equal(cookieValue("novalue", ACCESS_COOKIE), null);
});

test("the Set-Cookie header is HttpOnly and Strict, and Secure everywhere but loopback", () => {
	const header = accessCookieHeader("v1.2.c", "mac.tail1234.ts.net");
	assert.match(header, new RegExp(`^${ACCESS_COOKIE}=v1\\.2\\.c; `));
	for (const attribute of ["Path=/", `Max-Age=${COOKIE_MAX_AGE_S}`, "HttpOnly", "SameSite=Strict", "Secure"]) assert(header.split("; ").includes(attribute), attribute);
	for (const host of ["localhost:4747", "127.0.0.1:4747", "[::1]:4747"]) assert(!accessCookieHeader("v", host).includes("Secure"), host);
	assert(accessCookieHeader("v", null).includes("Secure"), "no Host: assume the stricter case");
});
