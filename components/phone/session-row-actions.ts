"use client";

/**
 * A long press on a session row opens the menu a right-click opens. iOS
 * reports no `contextmenu` for a held finger, so the hold is timed here.
 * The handlers go on the list container: rows are found by
 * [data-session-row], and nothing is attached per row.
 */
import { useEffect, useMemo, useRef } from "react";
import { LONG_PRESS_IDLE, LONG_PRESS_MS, longPress, swallowsClick, type LongPress, type LongPressEvent } from "./long-press";

const ROW = "[data-session-row]";

export interface PressPoint {
	target: EventTarget | null;
	clientX: number;
	clientY: number;
	pointerType: string;
}

export interface ClickLike {
	preventDefault(): void;
	stopPropagation(): void;
}

export interface RowLongPressHandlers {
	onPointerDown(event: PressPoint): void;
	onPointerMove(event: PressPoint): void;
	onPointerUp(): void;
	onPointerCancel(): void;
	onClickCapture(event: ClickLike): void;
}

export interface Clock {
	set(callback: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

const browserClock: Clock = {
	set: (callback, ms) => window.setTimeout(callback, ms),
	clear: (handle) => window.clearTimeout(handle as number),
};

function rowOf(target: EventTarget | null): HTMLElement | null {
	const element = target as { closest?: (selector: string) => HTMLElement | null } | null;
	return element?.closest?.(ROW) ?? null;
}

/** The handlers and their teardown, with the clock injected: the hook's whole logic. */
export function createRowLongPress(onLongPress: (row: HTMLElement) => void, clock: Clock = browserClock): RowLongPressHandlers & { dispose(): void } {
	let state: LongPress = LONG_PRESS_IDLE;
	let timer: unknown;
	const disarm = () => {
		if (timer !== undefined) clock.clear(timer);
		timer = undefined;
	};
	const step = (event: LongPressEvent) => {
		state = longPress(state, event);
		if (state.phase !== "armed") disarm();
	};
	return {
		onPointerDown(event) {
			disarm();
			const row = rowOf(event.target);
			if (!row) { state = LONG_PRESS_IDLE; return; }
			step({ type: "down", x: event.clientX, y: event.clientY, pointerType: event.pointerType });
			if (state.phase !== "armed") return;
			timer = clock.set(() => {
				timer = undefined;
				step({ type: "fire" });
				if (state.phase === "fired") onLongPress(row);
			}, LONG_PRESS_MS);
		},
		onPointerMove: (event) => step({ type: "move", x: event.clientX, y: event.clientY }),
		onPointerUp: () => step({ type: "up" }),
		onPointerCancel: () => step({ type: "cancel" }),
		onClickCapture(event) {
			if (swallowsClick(state)) {
				event.preventDefault();
				event.stopPropagation();
			}
			step({ type: "click" });
		},
		dispose: disarm,
	};
}

/** Props for the element that contains the rows. `onLongPress` is a latest-ref: an inline closure is fine. */
export function useRowLongPress(onLongPress: (row: HTMLElement) => void): RowLongPressHandlers {
	const latest = useRef(onLongPress);
	latest.current = onLongPress;
	const press = useMemo(() => createRowLongPress((row) => latest.current(row)), []);
	useEffect(() => press.dispose, [press]);
	return useMemo(() => ({
		onPointerDown: press.onPointerDown,
		onPointerMove: press.onPointerMove,
		onPointerUp: press.onPointerUp,
		onPointerCancel: press.onPointerCancel,
		onClickCapture: press.onClickCapture,
	}), [press]);
}
