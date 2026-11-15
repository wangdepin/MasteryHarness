import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import manifest from "../app/manifest.ts";
import { isPublicPath } from "../src/server/access-public-paths.ts";

const root = path.dirname(import.meta.dirname);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
	const bytes = readFileSync(file);
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("manifest: a standalone app named Mastery that starts at the root", () => {
	const { name, short_name, display, start_url, scope } = manifest();
	assert.deepEqual({ name, short_name, display, start_url, scope }, { name: "MasteryHarness", short_name: "Mastery", display: "standalone", start_url: "/", scope: "/" });
});

test("manifest: every icon is a committed file of the size it claims, reachable before pairing", () => {
	const icons = manifest().icons ?? [];
	assert.equal(icons.length, 2);
	for (const icon of icons) {
		const file = path.join(root, "public", icon.src);
		assert(existsSync(file), icon.src);
		assert.equal(pngSize(file).join("x"), icon.sizes, icon.src);
		assert(isPublicPath(icon.src), `${icon.src} must be public: the browser fetches it without cookies`);
	}
});

test("apple icon: 180px, where Next links it from, reachable before pairing", () => {
	assert.deepEqual(pngSize(path.join(root, "app", "apple-icon.png")), [180, 180]);
	assert(isPublicPath("/apple-icon.png"));
	assert(isPublicPath("/manifest.webmanifest"));
});
