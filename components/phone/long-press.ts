/**
 * A long press on a touch screen, as a state machine with no timers of its
 * own (the caller owns the clock): what each event does is the part that
 * regresses silently. After TobiasSamsonsen/learnharness's long-press.
 *
 *   idle ──down(touch)──▶ armed ──fire──▶ fired ──click──▶ idle
 *                           │ move past slop / up / cancel
 *                           ▼
 *                         idle
 *
 * A mouse or a pen never arms: they have a right button. `fired` stays
 * until the click that the finger's release produces, so that click can be
 * swallowed instead of also activating what was pressed. A new `down`
 * always starts over, so a release that produced no click eats nothing.
 */

/** How long a finger must rest before the press counts (ms). */
export const LONG_PRESS_MS = 500;
/** Finger travel (px) that turns a hold into a scroll. */
export const LONG_PRESS_SLOP = 10;

export type LongPress = { phase: "idle" } | { phase: "armed"; x: number; y: number } | { phase: "fired" };

export type LongPressEvent =
	| { type: "down"; x: number; y: number; pointerType: string }
	| { type: "move"; x: number; y: number }
	| { type: "up" }
	| { type: "cancel" }
	| { type: "fire" }
	| { type: "click" };

export const LONG_PRESS_IDLE: LongPress = { phase: "idle" };

export function longPress(state: LongPress, event: LongPressEvent): LongPress {
	switch (event.type) {
		case "down":
			return event.pointerType === "touch" ? { phase: "armed", x: event.x, y: event.y } : LONG_PRESS_IDLE;
		case "move":
			if (state.phase !== "armed") return state;
			return Math.hypot(event.x - state.x, event.y - state.y) > LONG_PRESS_SLOP ? LONG_PRESS_IDLE : state;
		case "up":
		case "cancel":
			return state.phase === "armed" ? LONG_PRESS_IDLE : state;
		case "fire":
			return state.phase === "armed" ? { phase: "fired" } : state;
		case "click":
			return LONG_PRESS_IDLE;
	}
}

/** The click that follows a fired press is the finger lifting, not a tap. */
export function swallowsClick(state: LongPress): boolean {
	return state.phase === "fired";
}
