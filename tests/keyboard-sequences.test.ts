import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	actionForBinding,
	advanceSequence,
	effectiveKeymap,
	eventBinding,
	formatBinding,
	KEYBOARD_ACTIONS,
	SEQUENCE_TIMEOUT_MS,
	type KeyAction,
	type SequenceState,
} from "../src/core/keyboard.ts";

function press(key: string, mods: Partial<Pick<KeyboardEvent, "shiftKey" | "metaKey" | "ctrlKey" | "altKey">> = {}): KeyboardEvent {
	return { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods } as KeyboardEvent;
}

describe("eventBinding — bare letters keep Shift (vim-style bindings)", () => {
	it("Shift+G is G, plain g is g", () => {
		assert.equal(eventBinding(press("G", { shiftKey: true })), "G");
		assert.equal(eventBinding(press("g")), "g");
	});

	it("CapsLock alone does not make a capital: only the Shift key does", () => {
		assert.equal(eventBinding(press("G")), "g");
	});

	it("non-letter printable keys still bake their shift in", () => {
		assert.equal(eventBinding(press("?", { shiftKey: true })), "?");
	});

	it("modifier combos are unchanged", () => {
		assert.equal(eventBinding(press("r", { metaKey: true })), "mod+r");
		assert.equal(eventBinding(press("R", { metaKey: true, shiftKey: true })), "mod+shift+r");
		assert.equal(eventBinding(press("Tab", { shiftKey: true })), "shift+tab");
	});
});

describe("advanceSequence — the g g matcher", () => {
	const keymap = effectiveKeymap();
	const gg = (state: SequenceState | null, key: string, at: number) => advanceSequence(state, key, at, keymap);

	it("a lone g is a pending prefix, not an action", () => {
		const step = gg(null, "g", 0);
		assert.equal(step.action, null);
		assert.deepEqual(step.state, { keys: ["g"], at: 0 });
	});

	it("g then g fires scroll-top and clears the state", () => {
		const first = gg(null, "g", 0);
		assert.deepEqual(gg(first.state, "g", 400), { action: "scroll-top", state: null });
	});

	it("the second g too late starts over instead of firing", () => {
		const first = gg(null, "g", 0);
		const late = gg(first.state, "g", SEQUENCE_TIMEOUT_MS + 1);
		assert.equal(late.action, null);
		assert.deepEqual(late.state, { keys: ["g"], at: SEQUENCE_TIMEOUT_MS + 1 });
	});

	it("another key in between breaks the sequence", () => {
		const first = gg(null, "g", 0);
		assert.deepEqual(gg(first.state, "x", 100), { action: null, state: null });
	});

	it("a broken sequence restarts from the key that broke it", () => {
		const first = gg(null, "g", 0);
		const second = gg(first.state, "x", 100);
		const third = gg(second.state, "g", 200);
		assert.deepEqual(gg(third.state, "g", 300), { action: "scroll-top", state: null });
		// "g" breaking "g" + non-match: g g g — the third g starts a fresh prefix.
		const fresh = gg(gg(gg(null, "g", 0).state, "g", 10).state, "g", 20);
		assert.equal(fresh.action, null);
		assert.deepEqual(fresh.state, { keys: ["g"], at: 20 });
	});

	it("G is not g: it never matches or extends the g g sequence", () => {
		assert.deepEqual(gg(null, "G", 0), { action: null, state: null });
		const first = gg(null, "g", 0);
		assert.deepEqual(gg(first.state, "G", 50), { action: null, state: null });
	});

	it("single-key bindings are left to the ordinary dispatch", () => {
		assert.deepEqual(gg(null, "?", 0), { action: null, state: null });
	});
});

describe("registry — read-by-sentence and the session edges", () => {
	const byId = (id: KeyAction) => KEYBOARD_ACTIONS.find((a) => a.id === id)!;

	it("Mod+R reads the latest passage; G jumps to the end", () => {
		assert.equal(actionForBinding("mod+r"), "read-by-sentence");
		assert.equal(actionForBinding("G"), "scroll-bottom");
	});

	it("g g is registered as a sequence under scroll-top", () => {
		assert.equal(effectiveKeymap().get("g g"), "scroll-top");
		assert.equal(actionForBinding("g"), undefined);
	});

	it("the key sequences are fixed (not rebindable); Mod+R is rebindable", () => {
		assert.equal(byId("scroll-top").fixed, true);
		assert.equal(byId("scroll-bottom").fixed, true);
		assert.equal(byId("read-by-sentence").fixed, undefined);
	});

	it("no two actions share a binding", () => {
		const live = KEYBOARD_ACTIONS.filter((a) => !a.displayOnly);
		assert.equal(new Set(live.map((a) => a.binding)).size, live.length);
	});
});

describe("formatBinding", () => {
	it("shows the modifier glyph for Mod+R and the typed case for bare letters", () => {
		assert.match(formatBinding("mod+r"), /^(⌘|Ctrl\+)R$/);
		assert.equal(formatBinding("g g"), "gg");
		assert.equal(formatBinding("G"), "G");
	});

	it("leaves the existing bindings alone", () => {
		assert.equal(formatBinding("?"), "?");
		assert.equal(formatBinding("f2"), "F2");
		assert.equal(formatBinding("arrowdown"), "↓");
	});
});
