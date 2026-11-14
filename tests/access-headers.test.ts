import { test } from "node:test";
import assert from "node:assert/strict";
import { SECURITY_HEADERS, cachePolicy, withSecurityHeaders } from "../src/server/access-headers.ts";

test("security headers forbid framing, sniffing and cross-site referrers", () => {
	assert.deepEqual({ ...SECURITY_HEADERS }, { "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff" });
});

test("pages are never stored, bundled fonts are, and API routes keep their own policy", () => {
	for (const pathname of ["/", "/chat/abc", "/plugin-loader.js", "/worklets/pcm.js"]) assert.equal(cachePolicy(pathname), "private, no-store", pathname);
	assert.equal(cachePolicy("/fonts/inter.woff2"), "private, max-age=31536000, immutable");
	for (const pathname of ["/api", "/api/events", "/api/chats/abc/stream"]) assert.equal(cachePolicy(pathname), undefined, pathname);
});

test("a response the gate writes itself is never stored, and may add its own headers", () => {
	assert.deepEqual(withSecurityHeaders({ "Content-Type": "text/html" }), { ...SECURITY_HEADERS, "Cache-Control": "private, no-store", "Content-Type": "text/html" });
});
