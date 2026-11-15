"use client";

/**
 * A chat page back from the background attaches to the server's turn
 * again. The turn itself never stopped: it runs on the server, and only
 * this page's stream of it was cut. Attaching replays the turn from its
 * first event, and a turn that finished meanwhile answers with its
 * settled terminal, which adopts the saved record.
 */
import { STREAM_DROPPED, type SessionStatus } from "./session-core";
import { useForegroundReturn } from "./use-foreground-return";

export interface ReattachView {
	status: SessionStatus;
	/** A graded answer is waiting on its POST: no turn exists yet to attach to. */
	evaluating: boolean;
	/** A server-side turn this page knows of but holds no stream for. */
	turnInFlight: boolean;
	error: { message: string } | null | undefined;
}

/**
 * Whether the page's view of a turn may be dead: a stream it was reading,
 * a turn it was waiting to attach to, or the banner that says the
 * connection dropped. Any other error is a real failure and stays.
 */
export function shouldReattach(view: ReattachView): boolean {
	if (view.evaluating) return false;
	if (view.status === "submitted" || view.status === "streaming" || view.turnInFlight) return true;
	return view.status === "error" && view.error?.message === STREAM_DROPPED;
}

export function useForegroundReattach(view: ReattachView, clearError: () => void, attachToRunningTurn: () => void): void {
	useForegroundReturn(() => {
		if (!shouldReattach(view)) return;
		clearError();
		attachToRunningTurn();
	});
}
