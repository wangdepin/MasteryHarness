import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { DRAWER_QUERY, INLINE_SIDEBAR, drawerReducer, type DrawerState } from "../components/phone/use-sidebar-drawer.ts";

const run = (events: Parameters<typeof drawerReducer>[1][], from: DrawerState = INLINE_SIDEBAR) => events.reduce(drawerReducer, from);

describe("the sidebar drawer", () => {
	it("is for a touch device under 1024px, or any window under 640px", () => {
		assert.equal(DRAWER_QUERY, "(pointer: coarse) and (width < 64rem), (width < 40rem)");
	});

	it("starts closed whenever it comes into use", () => {
		assert.deepEqual(run([{ type: "media", matches: true }]), { active: true, open: false });
	});

	it("toggles open and closed", () => {
		const open = run([{ type: "media", matches: true }, { type: "toggle" }]);
		assert.deepEqual(open, { active: true, open: true });
		assert.deepEqual(run([{ type: "toggle" }], open), { active: true, open: false });
	});

	it("is closed by a navigation, a row or the backdrop", () => {
		const open = run([{ type: "media", matches: true }, { type: "toggle" }]);
		assert.deepEqual(run([{ type: "close" }], open), { active: true, open: false });
	});

	it("an inline sidebar is not a drawer: toggle and close leave it alone", () => {
		assert.equal(run([{ type: "toggle" }]), INLINE_SIDEBAR);
		assert.equal(run([{ type: "close" }]), INLINE_SIDEBAR);
	});

	it("a window widened past the breakpoint goes back to the inline sidebar, and narrowing again starts closed", () => {
		const open = run([{ type: "media", matches: true }, { type: "toggle" }]);
		const wide = run([{ type: "media", matches: false }], open);
		assert.deepEqual(wide, { active: false, open: false });
		assert.deepEqual(run([{ type: "media", matches: true }], wide), { active: true, open: false });
	});

	it("an unchanged media answer keeps the open drawer open", () => {
		const open = run([{ type: "media", matches: true }, { type: "toggle" }]);
		assert.equal(run([{ type: "media", matches: true }], open), open);
	});

	it("phone.css styles both drawer states, and keeps the open one free of a transform", () => {
		const css = readFileSync(path.join(import.meta.dirname, "..", "app", "phone.css"), "utf8");
		assert.match(css, /aside\[data-drawer="closed"\] \{[^}]*visibility: hidden/);
		assert.match(css, /aside\[data-drawer="open"\] \{[^}]*transform: none/);
	});
});
