import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LONG_PRESS_IDLE, LONG_PRESS_MS, LONG_PRESS_SLOP, longPress, swallowsClick } from "../components/phone/long-press.ts";
import { createRowLongPress, type Clock, type PressPoint } from "../components/phone/session-row-actions.ts";

describe("longPress (the state machine)", () => {
	const armed = longPress(LONG_PRESS_IDLE, { type: "down", x: 10, y: 10, pointerType: "touch" });

	it("only a finger arms it", () => {
		assert.equal(armed.phase, "armed");
		assert.equal(longPress(LONG_PRESS_IDLE, { type: "down", x: 10, y: 10, pointerType: "mouse" }).phase, "idle");
		assert.equal(longPress(LONG_PRESS_IDLE, { type: "down", x: 10, y: 10, pointerType: "pen" }).phase, "idle");
	});

	it("a finger that travels past the slop is scrolling", () => {
		assert.equal(longPress(armed, { type: "move", x: 10, y: 10 + LONG_PRESS_SLOP }).phase, "armed");
		assert.equal(longPress(armed, { type: "move", x: 10, y: 11 + LONG_PRESS_SLOP }).phase, "idle");
	});

	it("a lift or a cancel before the time is up is a tap, not a press", () => {
		assert.equal(longPress(armed, { type: "up" }).phase, "idle");
		assert.equal(longPress(armed, { type: "cancel" }).phase, "idle");
		assert.equal(longPress(LONG_PRESS_IDLE, { type: "fire" }).phase, "idle", "a timer that outlives its press fires nothing");
	});

	it("a fired press swallows exactly the click its lift produces", () => {
		const fired = longPress(armed, { type: "fire" });
		assert.equal(swallowsClick(fired), true);
		assert.equal(swallowsClick(longPress(fired, { type: "up" })), true, "the lift comes before the click");
		assert.equal(swallowsClick(longPress(fired, { type: "click" })), false);
		assert.equal(swallowsClick(armed), false);
	});

	it("a new press starts over, so a lift that produced no click eats nothing", () => {
		const fired = longPress(armed, { type: "fire" });
		assert.equal(swallowsClick(longPress(fired, { type: "down", x: 0, y: 0, pointerType: "touch" })), false);
	});
});

/** A clock the test advances by hand. */
function fakeClock() {
	let pending: (() => void) | undefined;
	const clock: Clock = {
		set(callback, ms) { assert.equal(ms, LONG_PRESS_MS); pending = callback; return callback; },
		clear(handle) { if (pending === handle) pending = undefined; },
	};
	return { clock, elapse() { const due = pending; pending = undefined; due?.(); }, armed: () => pending !== undefined };
}

const row = { closest: (selector: string) => (selector === "[data-session-row]" ? row : null) } as unknown as HTMLElement;
const elsewhere = { closest: () => null } as unknown as HTMLElement;
const at = (target: EventTarget, over: Partial<PressPoint> = {}): PressPoint => ({ target, clientX: 20, clientY: 20, pointerType: "touch", ...over });
const click = () => {
	const seen = { prevented: false, stopped: false };
	return { seen, event: { preventDefault: () => { seen.prevented = true; }, stopPropagation: () => { seen.stopped = true; } } };
};

describe("createRowLongPress (the list's handlers)", () => {
	function press() {
		const time = fakeClock();
		const pressed: HTMLElement[] = [];
		return { time, pressed, handlers: createRowLongPress((target) => pressed.push(target), time.clock) };
	}

	it("a finger held on a row reports that row once, and its lift does not open the session", () => {
		const { time, pressed, handlers } = press();
		handlers.onPointerDown(at(row));
		assert.deepEqual(pressed, [], "not before the time is up");
		time.elapse();
		assert.deepEqual(pressed, [row]);
		handlers.onPointerUp();
		const lift = click();
		handlers.onClickCapture(lift.event);
		assert.deepEqual(lift.seen, { prevented: true, stopped: true });
		const tap = click();
		handlers.onClickCapture(tap.event);
		assert.deepEqual(tap.seen, { prevented: false, stopped: false }, "the next tap is a tap");
	});

	it("a tap, a scroll and a cancelled touch report nothing and swallow nothing", () => {
		for (const end of ["up", "scroll", "cancel"] as const) {
			const { time, pressed, handlers } = press();
			handlers.onPointerDown(at(row));
			if (end === "up") handlers.onPointerUp();
			if (end === "scroll") handlers.onPointerMove(at(row, { clientY: 60 }));
			if (end === "cancel") handlers.onPointerCancel();
			assert.equal(time.armed(), false, `${end} stops the clock`);
			time.elapse();
			assert.deepEqual(pressed, [], end);
			const tap = click();
			handlers.onClickCapture(tap.event);
			assert.equal(tap.seen.prevented, false, end);
		}
	});

	it("a mouse, and a finger that is not on a row, never start the clock", () => {
		const { time, handlers } = press();
		handlers.onPointerDown(at(row, { pointerType: "mouse" }));
		assert.equal(time.armed(), false);
		handlers.onPointerDown(at(elsewhere));
		assert.equal(time.armed(), false);
	});

	it("dispose stops a running clock", () => {
		const { time, pressed, handlers } = press();
		handlers.onPointerDown(at(row));
		handlers.dispose();
		time.elapse();
		assert.deepEqual(pressed, []);
	});
});
