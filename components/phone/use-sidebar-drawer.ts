"use client";

/**
 * THE SIDEBAR AS A DRAWER: on a phone, and in any window too narrow to hold
 * the session list beside the page, the sidebar slides over the page
 * instead of squeezing it. The drawer's open state is its own: closed
 * whenever the drawer comes into use, closed again by any navigation, and
 * never read from or written to the stored preference, which keeps meaning
 * "open on a wide screen".
 *
 * The idea is TobiasSamsonsen/learnharness's drawer; the styles are in
 * app/phone.css (aside[data-drawer]).
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer } from "react";

/** A touch device narrower than 1024px, or any window narrower than 640px. */
export const DRAWER_QUERY = "(pointer: coarse) and (width < 64rem), (width < 40rem)";

export interface DrawerState {
	/** The sidebar is a drawer right now, not an inline column. */
	active: boolean;
	open: boolean;
}

export type DrawerEvent = { type: "media"; matches: boolean } | { type: "toggle" } | { type: "close" };

export const INLINE_SIDEBAR: DrawerState = { active: false, open: false };

export function drawerReducer(state: DrawerState, event: DrawerEvent): DrawerState {
	switch (event.type) {
		case "media":
			return event.matches === state.active ? state : { active: event.matches, open: false };
		case "toggle":
			return state.active ? { active: true, open: !state.open } : state;
		case "close":
			return state.open ? { active: state.active, open: false } : state;
	}
}

export interface SidebarDrawer extends DrawerState {
	toggle: () => void;
	close: () => void;
}

/** `enabled` is false in the desktop shell, which keeps its own narrow-window rule. */
export function useSidebarDrawer(enabled: boolean): SidebarDrawer {
	const [state, dispatch] = useReducer(drawerReducer, INLINE_SIDEBAR);
	// A layout effect: a phone never paints the inline sidebar first.
	useLayoutEffect(() => {
		if (!enabled || typeof window.matchMedia !== "function") return;
		const media = window.matchMedia(DRAWER_QUERY);
		const sync = () => dispatch({ type: "media", matches: media.matches });
		sync();
		media.addEventListener("change", sync);
		return () => media.removeEventListener("change", sync);
	}, [enabled]);
	const pathname = usePathname();
	useEffect(() => dispatch({ type: "close" }), [pathname]);
	const toggle = useCallback(() => dispatch({ type: "toggle" }), []);
	const close = useCallback(() => dispatch({ type: "close" }), []);
	return useMemo(() => ({ ...state, toggle, close }), [state, toggle, close]);
}
