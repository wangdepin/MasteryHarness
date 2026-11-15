import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { watchForegroundReturn, type PageLifecycle, type PageLifecycleEvent } from "../components/use-foreground-return.ts";

/** A page the test moves between foreground and background by hand. */
function fakePage(hidden = false) {
	const listeners = new Map<PageLifecycleEvent, Set<(persisted: boolean) => void>>();
	const fire = (event: PageLifecycleEvent, persisted = false) => { for (const listener of [...(listeners.get(event) ?? [])]) listener(persisted); };
	const page: PageLifecycle = {
		hidden: () => hidden,
		listen(event, listener) {
			const set = listeners.get(event) ?? new Set();
			listeners.set(event, set);
			set.add(listener);
			return () => set.delete(listener);
		},
	};
	return {
		page,
		hide() { hidden = true; fire("visibilitychange"); },
		show() { hidden = false; fire("visibilitychange"); },
		pageHide(persisted = true) { fire("pagehide", persisted); },
		pageShow(persisted = false) { fire("pageshow", persisted); },
		listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
	};
}

function watched(hidden = false) {
	const fake = fakePage(hidden);
	let returns = 0;
	const stop = watchForegroundReturn(fake.page, () => returns++);
	return { ...fake, stop, returns: () => returns };
}

describe("watchForegroundReturn", () => {
	it("the first load is not a return", () => {
		const page = watched();
		page.pageShow(false);
		page.show(); // a visibility event that reports visible, with nothing before it
		assert.equal(page.returns(), 0);
	});

	it("each time the page is hidden and shown again is one return", () => {
		const page = watched();
		page.hide();
		assert.equal(page.returns(), 0, "going away is not a return");
		page.show();
		page.hide();
		page.show();
		assert.equal(page.returns(), 2);
	});

	it("a page that loads in the background returns when it is first shown", () => {
		const page = watched(true);
		page.show();
		assert.equal(page.returns(), 1);
	});

	it("a back/forward-cache restore is one return, whichever event comes first", () => {
		const showFirst = watched();
		showFirst.pageHide();
		showFirst.hide();
		showFirst.pageShow(true);
		showFirst.show();
		assert.equal(showFirst.returns(), 1);

		const visibleFirst = watched();
		visibleFirst.pageHide();
		visibleFirst.hide();
		visibleFirst.show();
		visibleFirst.pageShow(true);
		assert.equal(visibleFirst.returns(), 1);
	});

	it("a restore counts even when the page never saw itself hidden", () => {
		const page = watched();
		page.pageHide();
		page.pageShow(true);
		assert.equal(page.returns(), 1);
	});

	it("stop removes every listener", () => {
		const page = watched();
		assert.equal(page.listenerCount(), 3);
		page.stop();
		assert.equal(page.listenerCount(), 0);
		page.hide();
		page.show();
		assert.equal(page.returns(), 0);
	});
});
