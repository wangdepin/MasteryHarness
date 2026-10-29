import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrollSessionToBottom, scrollSessionToTop, type SessionEdgeScrollContext } from "../components/session-navigation.tsx";

function fakeContext(log: string[], withScroller = true): SessionEdgeScrollContext {
	const scroller = { scrollTo: (options: ScrollToOptions) => log.push(`scrollTo:${options.top}:${options.behavior}`) };
	return {
		scrollRef: { current: withScroller ? scroller : null },
		stopScroll: () => log.push("stopScroll"),
		scrollToBottom: (options?: unknown) => {
			log.push(`scrollToBottom:${String(options)}`);
			return true;
		},
	} as unknown as SessionEdgeScrollContext;
}

describe("session edge scrolling (gg / G)", () => {
	it("gg releases the bottom-follow lock BEFORE jumping to the top", () => {
		const log: string[] = [];
		scrollSessionToTop(fakeContext(log));
		assert.deepEqual(log, ["stopScroll", "scrollTo:0:instant"]);
	});

	it("G scrolls to the bottom without animation, re-engaging the follow lock", () => {
		const log: string[] = [];
		scrollSessionToBottom(fakeContext(log));
		assert.deepEqual(log, ["scrollToBottom:instant"]);
	});

	it("both are no-ops before the scroller is mounted", () => {
		const log: string[] = [];
		scrollSessionToTop(fakeContext(log, false));
		scrollSessionToTop(null);
		scrollSessionToBottom(null);
		assert.deepEqual(log, []);
	});
});
