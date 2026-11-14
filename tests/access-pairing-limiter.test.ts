import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FAILURE_WINDOW_MS, MAX_FAILURES, pairingBlocked, recordPairingFailure, resetPairingFailures } from "../src/server/access-pairing-limiter.ts";

const NOW = Date.UTC(2026, 10, 15);

beforeEach(resetPairingFailures);

test("pairing is blocked after the allowed failures and not before", () => {
	for (let i = 0; i < MAX_FAILURES - 1; i++) recordPairingFailure(NOW + i);
	assert(!pairingBlocked(NOW + MAX_FAILURES));
	recordPairingFailure(NOW + MAX_FAILURES);
	assert(pairingBlocked(NOW + MAX_FAILURES + 1));
});

test("the block lifts once the failures leave the window", () => {
	for (let i = 0; i < MAX_FAILURES; i++) recordPairingFailure(NOW);
	assert(pairingBlocked(NOW + FAILURE_WINDOW_MS - 1));
	assert(!pairingBlocked(NOW + FAILURE_WINDOW_MS));
});

test("failures spread wider than the window never add up to a block", () => {
	for (let i = 0; i < MAX_FAILURES * 3; i++) {
		const at = NOW + i * (FAILURE_WINDOW_MS / 2);
		assert(!pairingBlocked(at), `attempt ${i}`);
		recordPairingFailure(at);
	}
});
