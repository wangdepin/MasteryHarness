import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { viewportVars } from "../components/phone/visual-viewport.ts";

const metrics = (over: Partial<Parameters<typeof viewportVars>[0]> = {}) => ({ layoutHeight: 844, visualHeight: 844, visualOffsetTop: 0, scale: 1, ...over });

describe("viewportVars", () => {
	it("no keyboard: the app is as tall as the page and nothing is covered", () => {
		assert.deepEqual(viewportVars(metrics()), { "--lh-app-height": "844px", "--lh-keyboard-inset": "0px" });
	});

	it("keyboard up: the app is as tall as what is visible, and the rest is the keyboard", () => {
		assert.deepEqual(viewportVars(metrics({ visualHeight: 508 })), { "--lh-app-height": "508px", "--lh-keyboard-inset": "336px" });
	});

	it("a page the browser panned to show a field is covered by less", () => {
		assert.deepEqual(viewportVars(metrics({ visualHeight: 508, visualOffsetTop: 100 })), { "--lh-app-height": "508px", "--lh-keyboard-inset": "236px" });
	});

	it("whole pixels, and never a negative inset", () => {
		assert.deepEqual(viewportVars(metrics({ visualHeight: 508.6, visualOffsetTop: 400 })), { "--lh-app-height": "509px", "--lh-keyboard-inset": "0px" });
	});

	it("pinch zoom changes neither: the visual viewport shrinks, the app must not", () => {
		assert.equal(viewportVars(metrics({ visualHeight: 422, scale: 2 })), null);
		assert.notEqual(viewportVars(metrics({ scale: 1.004 })), null, "rounding noise is not a zoom");
	});
});
