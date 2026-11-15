"use client";

import { useSyncExternalStore } from "react";

/** A finger is the main pointer: the condition app/phone.css calls its touch details. */
export const TOUCH_QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
	const media = window.matchMedia?.(TOUCH_QUERY);
	media?.addEventListener("change", onChange);
	return () => media?.removeEventListener("change", onChange);
}

const isTouchScreen = () => window.matchMedia?.(TOUCH_QUERY).matches === true;

/** Whether this is a touch screen; false while the page is rendered on the server. */
export function useTouchScreen(): boolean {
	return useSyncExternalStore(subscribe, isTouchScreen, () => false);
}
