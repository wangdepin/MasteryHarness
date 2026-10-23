/**
 * THE REVIEW SCHEDULER (docs/review-plan.md §4.3, §12–14): FSRS-6 (ts-fsrs,
 * default weights) over the practice events of review-events.ts. State is
 * DERIVED — every read replays each proposition's events from an empty
 * card, so nothing is stored and nothing can go stale (vision: derived
 * never stored).
 *
 * Pure: `now` is a parameter, no clock, no IO. Server-side only (it carries
 * ts-fsrs): like core/graph.ts it is deliberately NOT in the core barrel —
 * the browser shell reads the payload types from review-payload.ts.
 *
 * The scheduler is configured for DAY-scale intervals: Anki's minute-scale
 * learning steps are off (a practice session is the "learning step"), fuzz
 * is off (determinism), and FSRS-6's short-term weights stay on so several
 * problems on one proposition within a session do not inflate its stability.
 *
 * Two noise rules sit in front of FSRS (the events are LLM-graded, the
 * default weights are trained on flashcards):
 *   R1 (gradeOf)  — slips on knowledge the learner held are not forgetting.
 *   R2 (replay)   — a first failure on an ESTABLISHED node is provisional:
 *                   FSRS state is untouched and the node returns in a day.
 */

import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from "ts-fsrs";
import { getGraph } from "./graph.ts";
import type { ChatStore, GraphStore } from "./ports.ts";
import { reviewEventsFromMessages, type ReviewEvent } from "./review-events.ts";
import { REVIEW_SESSION_SIZE, type ReviewItem, type ReviewPayload } from "./review-payload.ts";

/** Target probability of recall at the due date. */
export const REVIEW_RETENTION = 0.9;

/** A node is ESTABLISHED once its stability reaches this many days (owner,
 *  2026-10-23). Stability, not `reps`: FSRS counts every same-day review in
 *  `reps`, while stability only grows after a real gap. */
export const ESTABLISHED_STABILITY_DAYS = 7;

/** How long a provisional failure waits before the node is due again. */
const VERIFY_DELAY_MS = 86_400_000;

const scheduler = fsrs(
	generatorParameters({
		request_retention: REVIEW_RETENTION,
		enable_fuzz: false,
		learning_steps: [],
		relearning_steps: [],
	}),
);

/** The lowest rung that counts as "the problem needed help" (R2: the
 *  doctrine's difficulty readout — only R0–R1 means about right). */
const HELPED_RUNG = 2;

/**
 * Practice event → FSRS grade (owner, 2026-10-23: no Easy).
 *   - surrendered → Again, always.
 *   - R1: a solve whose miss was `execution` or `careless` is Good — the
 *     proposition was retrieved; the rung it needed is not evidence of
 *     forgetting.
 *   - otherwise a solve with no hint or only R0–R1 is Good; one that needed
 *     R2+ or ended `solvedWithHints` is Hard.
 */
export function gradeOf(event: Pick<ReviewEvent, "outcome" | "rung" | "missClass">): Grade {
	if (event.outcome === "surrendered") return Rating.Again;
	if (event.missClass === "execution" || event.missClass === "careless") return Rating.Good;
	if (event.outcome === "solvedWithHints") return Rating.Hard;
	return event.rung !== null && event.rung >= HELPED_RUNG ? Rating.Hard : Rating.Good;
}

/** One proposition's derived review state. Times are epoch ms. */
export interface NodeReview {
	nodeId: string;
	dueAt: number;
	lastReviewAt: number;
	/** Days for recall probability to fall to REVIEW_RETENTION. */
	stability: number;
	difficulty: number;
	reps: number;
	lapses: number;
	/** R2: a provisional failure is waiting to be confirmed or cleared. */
	verifying: boolean;
}

/** A first failure on an established node, awaiting a later session. */
interface Pending {
	at: number;
	session: string;
}

interface Replayed {
	card: Card;
	pending: Pending | null;
}

function advance(card: Card, at: number, grade: Grade): Card {
	return scheduler.next(card, new Date(at), grade).card;
}

/**
 * Replay one proposition's events (already time-ordered). R2 (§13–14):
 *   - A failure on an established node (stability ≥ ESTABLISHED_STABILITY_DAYS)
 *     leaves the FSRS card untouched and becomes `pending`.
 *   - While pending, events of the SAME session are ignored — they follow the
 *     revealed answer and prove no lasting recall.
 *   - The first event of a LATER session settles it: a failure is confirmed
 *     (Again); a success counts at most Hard.
 */
function replay(events: readonly ReviewEvent[]): Replayed {
	let card = createEmptyCard(new Date(events[0]!.at));
	let pending: Pending | null = null;
	for (const event of events) {
		const grade = gradeOf(event);
		if (pending) {
			if (event.session === pending.session) continue;
			card = advance(card, event.at, Math.min(grade, Rating.Hard) as Grade);
			pending = null;
			continue;
		}
		if (grade === Rating.Again && card.stability >= ESTABLISHED_STABILITY_DAYS) {
			pending = { at: event.at, session: event.session };
			continue;
		}
		card = advance(card, event.at, grade);
	}
	return { card, pending };
}

function toNodeReview(nodeId: string, { card, pending }: Replayed): NodeReview {
	return {
		nodeId,
		dueAt: pending ? pending.at + VERIFY_DELAY_MS : card.due.getTime(),
		lastReviewAt: card.last_review?.getTime() ?? card.due.getTime(),
		stability: card.stability,
		difficulty: card.difficulty,
		reps: card.reps,
		lapses: card.lapses,
		verifying: pending !== null,
	};
}

/**
 * Fold events into per-proposition review states. Events from many
 * sessions may arrive in any order: each proposition's are sorted by time
 * first (ts-fsrs rejects time running backwards), ties keeping input
 * order. Propositions not in `liveNodeIds` (deleted from the graph) are
 * dropped. Result is ordered by `dueAt` ascending, then node id.
 */
export function foldReviews(
	events: readonly ReviewEvent[],
	liveNodeIds: ReadonlySet<string>,
): NodeReview[] {
	const byNode = new Map<string, ReviewEvent[]>();
	for (const event of events) {
		if (!liveNodeIds.has(event.nodeId)) continue;
		const list = byNode.get(event.nodeId);
		if (list) list.push(event);
		else byNode.set(event.nodeId, [event]);
	}
	const reviews: NodeReview[] = [];
	for (const [nodeId, list] of byNode) {
		const ordered = list
			.map((event, index) => ({ event, index }))
			.sort((a, b) => a.event.at - b.event.at || a.index - b.index)
			.map(({ event }) => event);
		reviews.push(toNodeReview(nodeId, replay(ordered)));
	}
	return reviews.sort((a, b) => a.dueAt - b.dueAt || a.nodeId.localeCompare(b.nodeId));
}

/** The storage ports the payload derivation reads. */
export interface ReviewDeps {
	chatStore: Pick<ChatStore, "listChats" | "getChat">;
	graphStore: Pick<GraphStore, "readNodes" | "readChains">;
}

/**
 * GET /api/review: every practice session's events, folded and split at
 * `now`. A PURE READ — nothing is written or cached. A proposition the
 * graph no longer holds is dropped; sessions that fail to load are
 * skipped (the store returns null for a corrupt file).
 */
export function reviewPayload(deps: ReviewDeps, now: number): ReviewPayload {
	const events: ReviewEvent[] = [];
	for (const summary of deps.chatStore.listChats()) {
		if (summary.kind !== "practice") continue;
		const record = deps.chatStore.getChat(summary.id);
		if (record) events.push(...reviewEventsFromMessages(record.messages, summary.id));
	}
	const nodes = new Map(getGraph(deps.graphStore).nodes.map((n) => [n.id, n]));
	const reviews = foldReviews(events, new Set(nodes.keys()));
	const item = (r: NodeReview): ReviewItem => {
		const node = nodes.get(r.nodeId)!;
		return {
			id: r.nodeId,
			name: node.name,
			statement: node.statement,
			dueAt: r.dueAt,
			stability: r.stability,
			reps: r.reps,
			lapses: r.lapses,
			verifying: r.verifying,
		};
	};
	return {
		now,
		due: dueReviews(reviews, now).map(item),
		upcoming: upcomingReviews(reviews, now).map(item),
		sessionSize: REVIEW_SESSION_SIZE,
	};
}

/** The propositions due at `now` (dueAt ≤ now), most overdue first. */
export function dueReviews(reviews: readonly NodeReview[], now: number): NodeReview[] {
	return reviews.filter((r) => r.dueAt <= now);
}

/** The propositions not yet due, soonest first. */
export function upcomingReviews(reviews: readonly NodeReview[], now: number): NodeReview[] {
	return reviews.filter((r) => r.dueAt > now);
}
