import { reviewPayload } from "../core/review.ts";
import type { ReviewPayload } from "../core/review-payload.ts";
import { stores } from "./stores.ts";

/**
 * Server-side review entry (GET /api/review). A PURE READ: the scheduler
 * state is derived from the practice sessions' records on every call
 * (docs/review-plan.md §4.1) — nothing is written, nothing is cached.
 */
export function reviewView(now: number = Date.now()): ReviewPayload {
	return reviewPayload(stores, now);
}
