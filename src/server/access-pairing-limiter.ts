/**
 * Slows down guessing at the pairing form.
 *
 * The count is global, not per client: telling clients apart would mean
 * trusting a forwarded address header, and the gate trusts none. While
 * blocked, a correct token is refused too.
 */

export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 60_000;

interface PairingFailures {
	at: number[];
}

const KEY = Symbol.for("lh.accessPairing");

function failures(): PairingFailures {
	const global = globalThis as typeof globalThis & { [KEY]?: PairingFailures };
	return (global[KEY] ??= { at: [] });
}

function recent(nowMs: number): number[] {
	const state = failures();
	state.at = state.at.filter((at) => nowMs - at < FAILURE_WINDOW_MS);
	return state.at;
}

export function pairingBlocked(nowMs: number): boolean {
	return recent(nowMs).length >= MAX_FAILURES;
}

export function recordPairingFailure(nowMs: number): void {
	recent(nowMs).push(nowMs);
}

export function resetPairingFailures(): void {
	failures().at = [];
}
