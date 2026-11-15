import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSelectionRectVisible, observeSelectionActions, resolveSelectionActionPosition, type SelectionActionPoint } from "../components/selection-actions.ts";

const bounds = { left: 100, top: 50, right: 700, bottom: 650 };
const viewport = { width: 1000, height: 800 };

describe("resolveSelectionActionPosition", () => {
	it("prefers the pointer", () => {
		assert.deepEqual(resolveSelectionActionPosition({ bounds, selectionRect: { left: 200, top: 100, right: 300, bottom: 120 }, pointer: { x: 250, y: 110 }, viewport }), { x: 250, y: 110 });
	});
	it("falls back to the right end of the last line, 4px below", () => {
		assert.deepEqual(resolveSelectionActionPosition({ bounds, selectionRect: { left: 200, top: 100, right: 300, bottom: 120 }, pointer: null, viewport }), { x: 300, y: 124 });
	});
	it("falls back to the top right of the bounds without a rect", () => {
		assert.deepEqual(resolveSelectionActionPosition({ bounds, selectionRect: null, pointer: null, viewport }), { x: 560, y: 62 });
	});
	it("clamps 8px inside the bounds and the window", () => {
		assert.deepEqual(resolveSelectionActionPosition({ bounds, selectionRect: null, pointer: { x: 5, y: 900 }, viewport }), { x: 108, y: 642 });
	});
});

describe("isSelectionRectVisible", () => {
	it("needs a positive-area intersection with every clip", () => {
		const rect = { left: 10, top: 10, right: 50, bottom: 20 };
		assert.equal(isSelectionRectVisible(rect, [{ left: 0, top: 0, right: 100, bottom: 100 }]), true);
		assert.equal(isSelectionRectVisible(rect, [{ left: 50, top: 0, right: 100, bottom: 100 }]), false);
		assert.equal(isSelectionRectVisible(rect, [{ left: 0, top: 0, right: 100, bottom: 100 }, { left: 0, top: 20, right: 100, bottom: 30 }]), false);
	});
});

// ─── the observer, over a DOM small enough to drive by hand ─────────────────

type Listener = (event: Record<string, unknown>) => void;

class FakeTarget {
	private listeners = new Map<string, Set<Listener>>();
	addEventListener(type: string, listener: Listener) {
		const set = this.listeners.get(type) ?? new Set<Listener>();
		this.listeners.set(type, set);
		set.add(listener);
	}
	removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
	emit(type: string, event: Record<string, unknown> = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, ...event }); }
	listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
}

class FakeNode extends FakeTarget {
	contains(node: unknown) { return node === this; }
	closest() { return null; }
}

function observed() {
	const timeouts = new Map<number, () => void>();
	const frames = new Map<number, () => void>();
	let ids = 0;
	const view = Object.assign(new FakeTarget(), {
		Node: FakeNode,
		setTimeout: (callback: () => void) => { timeouts.set(++ids, callback); return ids; },
		clearTimeout: (id: number) => { timeouts.delete(id); },
		requestAnimationFrame: (callback: () => void) => { frames.set(++ids, callback); return ids; },
		cancelAnimationFrame: (id: number) => { frames.delete(id); },
	});
	const document = Object.assign(new FakeTarget(), { defaultView: view });
	const element = Object.assign(new FakeNode(), { ownerDocument: document });
	const action = new FakeNode();
	const selections: (SelectionActionPoint | null)[] = [];
	const dismissals: string[] = [];
	const observer = observeSelectionActions({
		element: element as unknown as HTMLElement,
		getActionElement: () => action as unknown as HTMLElement,
		restoreAfterScroll: false,
		onSelection: (pointer) => selections.push(pointer),
		onDismiss: (reason) => dismissals.push(reason),
	});
	/** Run the settle timer, then the frame after it. */
	const settle = () => {
		for (const queue of [timeouts, frames]) {
			const due = [...queue.values()];
			queue.clear();
			for (const callback of due) callback();
		}
	};
	const press = (pointerType: string, target: FakeNode = element) => document.emit("pointerdown", { target, pointerType, button: 0, defaultPrevented: false });
	return { view, document, element, action, observer, selections, dismissals, settle, press };
}

describe("observeSelectionActions", () => {
	it("a mouse selection reports at the pointer when the button is released", () => {
		const page = observed();
		page.press("mouse");
		page.document.emit("pointerup", { target: page.element, pointerType: "mouse" });
		page.settle();
		assert.deepEqual(page.selections, [], "a mouse reports on mouseup, not on pointerup");
		page.document.emit("mouseup", { target: page.element, button: 0, detail: 1, clientX: 40, clientY: 50 });
		page.settle();
		assert.deepEqual(page.selections, [{ x: 40, y: 50 }]);
	});

	it("selection changes are held back while a press is down", () => {
		const page = observed();
		page.press("touch");
		page.observer.selectionChanged();
		page.settle();
		assert.deepEqual(page.selections, []);
	});

	it("touch: a long-press selection the browser took over is read on its next change", () => {
		const page = observed();
		page.press("touch");
		// The browser starts its own selection gesture: the pointer is cancelled.
		page.document.emit("pointercancel", { target: page.element, pointerType: "touch" });
		page.view.emit("pointercancel");
		page.settle();
		assert.deepEqual(page.selections, [], "a cancel alone reports nothing");
		page.observer.selectionChanged(); // the selection appears, then grows as a handle is dragged
		page.settle();
		page.observer.selectionChanged();
		page.settle();
		assert.deepEqual(page.selections, [null, null]);
	});

	it("touch: lifting the finger reads the selection as it stands", () => {
		const page = observed();
		page.press("touch");
		page.document.emit("pointerup", { target: page.element, pointerType: "touch" });
		page.settle();
		assert.deepEqual(page.selections, [null]);
		page.document.emit("mouseup", { target: page.element, button: 0, detail: 1, clientX: 1, clientY: 1 });
		page.settle();
		assert.deepEqual(page.selections, [null], "the compatibility mouseup of the same tap adds nothing");
	});

	it("touch: a tap on the toolbar's own button does not read the selection again", () => {
		const page = observed();
		page.press("touch", page.action);
		page.document.emit("pointerup", { target: page.action, pointerType: "touch" });
		page.settle();
		assert.deepEqual(page.selections, []);
	});

	it("dispose removes every listener", () => {
		const page = observed();
		page.observer.dispose();
		assert.equal(page.document.listenerCount() + page.view.listenerCount() + page.element.listenerCount(), 0);
	});
});
