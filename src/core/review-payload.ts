/**
 * THE REVIEW PAYLOAD (GET /api/review, docs/review-plan.md §4.4): the
 * browser-safe wire shape the Review page reads. Types + constants only —
 * the scheduler itself (core/review.ts, ts-fsrs) stays server-side.
 */

/** How many due propositions a review session carries by default (owner,
 *  2026-10-23); the page lets the learner adjust the selection. */
export const REVIEW_SESSION_SIZE = 8;

/** The most propositions one session can carry — mirrors the `.slice(0, 64)`
 *  on the picks in POST /api/chats, so the page never silently loses a pick. */
export const REVIEW_SESSION_MAX = 64;

/** One proposition on the Review page. Times are epoch ms. */
export interface ReviewItem {
	id: string;
	name: string;
	statement: string;
	/** When recall probability is predicted to reach the target. */
	dueAt: number;
	/** Days for recall probability to fall to the target. */
	stability: number;
	reps: number;
	lapses: number;
	/** A first failure on a well-established node awaits a second look
	 *  (docs/review-plan.md §13): the page marks the row. */
	verifying: boolean;
}

export interface ReviewPayload {
	/** Server clock at derivation (epoch ms) — the page measures "overdue by"
	 *  against it, not its own clock. */
	now: number;
	/** dueAt ≤ now, most overdue first. */
	due: ReviewItem[];
	/** Not yet due, soonest first. */
	upcoming: ReviewItem[];
	/** The default selection size for "Start review". */
	sessionSize: number;
}
