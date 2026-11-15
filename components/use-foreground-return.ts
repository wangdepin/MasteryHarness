"use client";

/**
 * COMING BACK TO THE FOREGROUND: a phone suspends a page that is not on
 * screen (another app, the lock screen) and drops its sockets without
 * telling it. Nothing is running in the page to notice, so the moment it
 * is shown again is the first chance to repair what was lost.
 *
 * `watchForegroundReturn` is the whole rule, over a small surface a test
 * can fake; the hook is its React adapter.
 */
import { useEffect, useRef } from "react";

export type PageLifecycleEvent = "visibilitychange" | "pagehide" | "pageshow";

/** The page-lifecycle surface the watcher needs: `document` and `window` in a browser. */
export interface PageLifecycle {
	hidden(): boolean;
	/** `persisted` is the event's own flag (back/forward cache); false where the event has none. */
	listen(event: PageLifecycleEvent, listener: (persisted: boolean) => void): () => void;
}

/**
 * Call `onReturn` once each time the page comes back after being away.
 * Away is a hidden page or one put in the back/forward cache; a restore
 * reports both `pageshow` and `visibilitychange`, and they count as one
 * return. The first load is not a return. Returns the stop function.
 */
export function watchForegroundReturn(page: PageLifecycle, onReturn: () => void): () => void {
	let away = page.hidden();
	const leave = () => { away = true; };
	const comeBack = () => {
		if (!away) return;
		away = false;
		onReturn();
	};
	const stops = [
		page.listen("visibilitychange", () => (page.hidden() ? leave() : comeBack())),
		page.listen("pagehide", leave),
		page.listen("pageshow", (persisted) => { if (persisted) comeBack(); }),
	];
	return () => { for (const stop of stops) stop(); };
}

function browserPage(): PageLifecycle {
	return {
		hidden: () => document.visibilityState === "hidden",
		listen(event, listener) {
			const target: EventTarget = event === "visibilitychange" ? document : window;
			const handler = (raw: Event) => listener((raw as PageTransitionEvent).persisted === true);
			target.addEventListener(event, handler);
			return () => target.removeEventListener(event, handler);
		},
	};
}

/** Run `onReturn` each time this page comes back to the foreground. The callback is a latest-ref: an inline closure is fine. */
export function useForegroundReturn(onReturn: () => void): void {
	const latest = useRef(onReturn);
	latest.current = onReturn;
	useEffect(() => watchForegroundReturn(browserPage(), () => latest.current()), []);
}
