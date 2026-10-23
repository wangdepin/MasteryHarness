/**
 * THE REVIEW SCHEDULER (docs/review-plan.md §4.2–4.3): the outcome → grade
 * mapping, the FSRS-6 replay, and the fold's edge cases (order, deleted
 * nodes, same-day repeats, due partition).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Rating } from "ts-fsrs";
import type { ChatRecord, ChatSummary } from "../src/core/contracts/chat.ts";
import type { GraphNode } from "../src/core/contracts/graph.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { ReviewEvent, ReviewRung } from "../src/core/review-events.ts";
import {
	ESTABLISHED_STABILITY_DAYS,
	dueReviews,
	foldReviews,
	gradeOf,
	reviewPayload,
	upcomingReviews,
	type ReviewDeps,
} from "../src/core/review.ts";
import { conclude, pose } from "./review-fixtures.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function ev(
	nodeId: string,
	at: number,
	outcome: ReviewEvent["outcome"] = "solved",
	rung: ReviewRung = null,
	missClass: ReviewEvent["missClass"] = null,
	session = "s1",
): ReviewEvent {
	return { nodeId, at, outcome, rung, missClass, session };
}

const LIVE = new Set(["n_a", "n_b", "n_c"]);

describe("gradeOf (owner, 2026-10-23: no Easy)", () => {
	const cases: Array<[ReviewEvent["outcome"], ReviewRung, Rating]> = [
		["solved", null, Rating.Good],
		["solved", 0, Rating.Good],
		["solved", 1, Rating.Good],
		["solved", 2, Rating.Hard],
		["solved", 5, Rating.Hard],
		["solvedWithHints", null, Rating.Hard],
		["solvedWithHints", 1, Rating.Hard],
		["surrendered", null, Rating.Again],
		["surrendered", 5, Rating.Again],
	];
	for (const [outcome, rung, expected] of cases) {
		it(`${outcome} @ rung ${rung} → ${Rating[expected]}`, () => {
			assert.equal(gradeOf({ outcome, rung, missClass: null }), expected);
		});
	}
});

describe("R1 — slips are not forgetting (docs/review-plan.md §12)", () => {
	const cases: Array<[ReviewEvent["outcome"], ReviewRung, ReviewEvent["missClass"], Rating]> = [
		["solved", 3, "execution", Rating.Good],
		["solved", 5, "careless", Rating.Good],
		["solvedWithHints", 2, "execution", Rating.Good],
		["solvedWithHints", null, "careless", Rating.Good],
		["solved", 3, "cue", Rating.Hard],
		["solved", 3, "discrimination", Rating.Hard],
		["solvedWithHints", 4, "structural", Rating.Hard],
		["solved", 3, null, Rating.Hard],
		["solved", null, "cue", Rating.Good],
		["surrendered", 5, "careless", Rating.Again],
		["surrendered", 5, "execution", Rating.Again],
		["surrendered", 5, "cue", Rating.Again],
	];
	for (const [outcome, rung, missClass, expected] of cases) {
		it(`${outcome} @ rung ${rung}, miss ${missClass} → ${Rating[expected]}`, () => {
			assert.equal(gradeOf({ outcome, rung, missClass }), expected);
		});
	}
});

describe("foldReviews", () => {
	it("no events → no reviews", () => {
		assert.deepEqual(foldReviews([], LIVE), []);
	});

	it("a first Good is due in days, not minutes (learning steps are off)", () => {
		const [r] = foldReviews([ev("n_a", T0)], LIVE);
		assert.equal(r!.nodeId, "n_a");
		assert.equal(r!.reps, 1);
		assert.equal(r!.lapses, 0);
		assert.equal(r!.lastReviewAt, T0);
		assert.ok(r!.dueAt - T0 >= DAY, `due in ${(r!.dueAt - T0) / DAY} days`);
	});

	it("a successful spaced repeat lengthens the interval", () => {
		const first = foldReviews([ev("n_a", T0)], LIVE)[0]!;
		const second = foldReviews([ev("n_a", T0), ev("n_a", first.dueAt)], LIVE)[0]!;
		assert.ok(second.stability > first.stability);
		assert.ok(second.dueAt - first.dueAt > first.dueAt - T0);
	});

	it("Again after a long gap counts a lapse and shrinks stability", () => {
		// A young node (one Good, stability < 7): R2 does not shield it.
		const good = foldReviews([ev("n_a", T0), ev("n_a", T0 + 20 * DAY)], LIVE)[0]!;
		const lapsed = foldReviews([ev("n_a", T0), ev("n_a", T0 + 20 * DAY, "surrendered", 5)], LIVE)[0]!;
		assert.equal(lapsed.lapses, 1);
		assert.ok(lapsed.stability < good.stability);
	});

	it("same-day repeats do not inflate stability (FSRS-6 short-term weights)", () => {
		const once = foldReviews([ev("n_a", T0)], LIVE)[0]!;
		const thrice = foldReviews([ev("n_a", T0), ev("n_a", T0 + 300_000), ev("n_a", T0 + 600_000)], LIVE)[0]!;
		assert.ok(thrice.stability <= once.stability * 1.5, `once ${once.stability}, thrice ${thrice.stability}`);
	});

	it("events arrive in any order — the replay sorts them (ts-fsrs rejects backwards time)", () => {
		const ordered = [ev("n_a", T0), ev("n_a", T0 + 3 * DAY)];
		const shuffled = [ordered[1]!, ordered[0]!];
		assert.deepEqual(foldReviews(shuffled, LIVE), foldReviews(ordered, LIVE));
	});

	it("equal timestamps keep input order and do not throw", () => {
		assert.doesNotThrow(() => foldReviews([ev("n_a", T0), ev("n_a", T0, "surrendered", 5)], LIVE));
	});

	it("deleted nodes (not in the live set) are dropped", () => {
		const reviews = foldReviews([ev("n_a", T0), ev("n_gone", T0)], LIVE);
		assert.deepEqual(reviews.map((r) => r.nodeId), ["n_a"]);
	});

	it("propositions fold independently and sort by dueAt then id", () => {
		const reviews = foldReviews(
			[ev("n_b", T0 + DAY), ev("n_a", T0 + DAY), ev("n_c", T0, "surrendered", 5)],
			LIVE,
		);
		assert.deepEqual(reviews.map((r) => r.nodeId), ["n_c", "n_a", "n_b"]);
	});

	it("is deterministic: the same events give the same states", () => {
		const events = [ev("n_a", T0), ev("n_a", T0 + 2 * DAY, "solvedWithHints", 3)];
		assert.deepEqual(foldReviews(events, LIVE), foldReviews(events, LIVE));
	});
});

// An ESTABLISHED node: Good at day 0, Good at day 2 (stability ≈ 10.96 ≥ 7),
// Good at day 13. A young one has a single Good (stability ≈ 2.31).
const ESTABLISHED = [ev("n_a", T0), ev("n_a", T0 + 2 * DAY), ev("n_a", T0 + 13 * DAY)];
const fold = (events: ReviewEvent[]) => foldReviews(events, LIVE)[0]!;

describe("R2 — a first failure on an established node is provisional (§13–14)", () => {
	const fail = (at: number, session: string, outcome: ReviewEvent["outcome"] = "surrendered") =>
		ev("n_a", at, outcome, 5, "cue", session);

	it("the established fixture really is established", () => {
		assert.ok(fold(ESTABLISHED).stability >= ESTABLISHED_STABILITY_DAYS);
	});

	it("leaves the FSRS state untouched, is verifying, and is due a day later", () => {
		const before = fold(ESTABLISHED);
		const after = fold([...ESTABLISHED, fail(T0 + 30 * DAY, "s2")]);
		assert.equal(after.verifying, true);
		assert.equal(after.dueAt, T0 + 31 * DAY);
		assert.equal(after.stability, before.stability);
		assert.equal(after.reps, before.reps);
		assert.equal(after.lapses, 0);
		assert.equal(after.lastReviewAt, before.lastReviewAt);
	});

	it("ignores later events of the SAME session (they follow the revealed answer)", () => {
		const alone = fold([...ESTABLISHED, fail(T0 + 30 * DAY, "s2")]);
		const withRetest = fold([
			...ESTABLISHED,
			fail(T0 + 30 * DAY, "s2"),
			ev("n_a", T0 + 30 * DAY + 20 * 60_000, "solved", null, null, "s2"),
			ev("n_a", T0 + 30 * DAY + 40 * 60_000, "surrendered", 5, "cue", "s2"),
		]);
		assert.deepEqual(withRetest, alone);
	});

	it("a success in a LATER session counts at most Hard and clears the flag", () => {
		const settled = fold([...ESTABLISHED, fail(T0 + 30 * DAY, "s2"), ev("n_a", T0 + 32 * DAY, "solved", null, null, "s3")]);
		const asHard = fold([...ESTABLISHED, ev("n_a", T0 + 32 * DAY, "solvedWithHints", 3, "cue", "s3")]);
		assert.equal(settled.verifying, false);
		assert.deepEqual(settled, asHard);
	});

	it("a Hard in a later session stays Hard", () => {
		const settled = fold([...ESTABLISHED, fail(T0 + 30 * DAY, "s2"), ev("n_a", T0 + 32 * DAY, "solvedWithHints", 3, "cue", "s3")]);
		assert.deepEqual(settled, fold([...ESTABLISHED, ev("n_a", T0 + 32 * DAY, "solvedWithHints", 3, "cue", "s3")]));
	});

	it("a failure in a later session is CONFIRMED as Again", () => {
		const before = fold(ESTABLISHED);
		const confirmed = fold([...ESTABLISHED, fail(T0 + 30 * DAY, "s2"), fail(T0 + 32 * DAY, "s3")]);
		assert.equal(confirmed.verifying, false);
		assert.equal(confirmed.lapses, 1);
		assert.equal(confirmed.lastReviewAt, T0 + 32 * DAY);
		assert.ok(confirmed.stability < before.stability);
	});

	it("a young node (stability < 7) fails immediately — nothing to protect", () => {
		const young = fold([ev("n_a", T0), ev("n_a", T0 + 2 * DAY, "surrendered", 5, "cue", "s2")]);
		assert.equal(young.verifying, false);
		assert.equal(young.lapses, 1);
	});

	it("same-day repeats do not make a node established (reps counts them, stability does not)", () => {
		const sameDay = [ev("n_a", T0), ev("n_a", T0 + 600_000), ev("n_a", T0 + 1_200_000)];
		const node = fold(sameDay);
		assert.equal(node.reps, 3);
		assert.ok(node.stability < ESTABLISHED_STABILITY_DAYS);
		const failed = fold([...sameDay, ev("n_a", T0 + 3 * DAY, "surrendered", 5, "cue", "s2")]);
		assert.equal(failed.verifying, false);
		assert.equal(failed.lapses, 1);
	});

	it("an execution/careless slip is graded Good, so it never becomes a failure at all", () => {
		const slip = fold([...ESTABLISHED, ev("n_a", T0 + 30 * DAY, "solvedWithHints", 4, "execution", "s2")]);
		assert.equal(slip.verifying, false);
		assert.equal(slip.lapses, 0);
		assert.equal(slip.reps, 4);
	});

	it("a verifying node is due (dueAt ≤ now) once the day has passed, upcoming before", () => {
		const node = fold([...ESTABLISHED, fail(T0 + 30 * DAY, "s2")]);
		assert.deepEqual(dueReviews([node], T0 + 31 * DAY).map((r) => r.nodeId), ["n_a"]);
		assert.deepEqual(upcomingReviews([node], T0 + 30 * DAY + 3600_000).map((r) => r.nodeId), ["n_a"]);
	});

	it("is deterministic regardless of event input order", () => {
		const events = [...ESTABLISHED, fail(T0 + 30 * DAY, "s2"), ev("n_a", T0 + 32 * DAY, "solved", null, null, "s3")];
		assert.deepEqual(fold([...events].reverse()), fold(events));
	});
});

describe("due / upcoming partition", () => {
	const reviews = foldReviews([ev("n_a", T0), ev("n_b", T0 + 30 * DAY)], LIVE);
	const aDue = reviews.find((r) => r.nodeId === "n_a")!.dueAt;

	it("dueAt ≤ now is due (boundary inclusive), the rest is upcoming", () => {
		assert.deepEqual(dueReviews(reviews, aDue).map((r) => r.nodeId), ["n_a"]);
		assert.deepEqual(upcomingReviews(reviews, aDue).map((r) => r.nodeId), ["n_b"]);
	});

	it("one ms before the due time nothing is due", () => {
		assert.deepEqual(dueReviews(reviews, aDue - 1), []);
		assert.equal(upcomingReviews(reviews, aDue - 1).length, 2);
	});

	it("the two lists partition the reviews", () => {
		const now = aDue + DAY;
		assert.equal(dueReviews(reviews, now).length + upcomingReviews(reviews, now).length, reviews.length);
	});
});

describe("reviewPayload (GET /api/review)", () => {
	const node = (id: string, name: string): GraphNode => ({
		id,
		name,
		statement: `statement of ${name}`,
		aliases: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		provenance: [],
	});

	function deps(
		sessions: Array<{ id: string; kind: "teach" | "practice"; messages: LhMessage[] }>,
		nodes: GraphNode[],
	): ReviewDeps {
		const summaries = sessions.map((s) => ({ id: s.id, kind: s.kind }) as ChatSummary);
		return {
			chatStore: {
				listChats: () => summaries,
				getChat: (id) => {
					const s = sessions.find((x) => x.id === id);
					return s ? ({ id, messages: s.messages, kind: s.kind } as ChatRecord) : null;
				},
			},
			graphStore: { readNodes: () => nodes, readChains: () => [] },
		};
	}

	const solved = (id: string, target: string, at: number): LhMessage[] => [
		...pose(`p_${id}`, [target], at),
		...conclude(`c_${id}`, { outcome: "solved", rung: null }, at + 10),
	];

	it("an empty store gives an empty payload carrying the clock and session size", () => {
		assert.deepEqual(reviewPayload(deps([], []), T0), { now: T0, due: [], upcoming: [], sessionSize: 8 });
	});

	it("splits practice events into due and upcoming, joined with the graph's name and statement", () => {
		const payload = reviewPayload(
			deps(
				[
					{ id: "s1", kind: "practice", messages: solved("a", "n_a", T0) },
					{ id: "s2", kind: "practice", messages: solved("b", "n_b", T0 + 30 * DAY) },
				],
				[node("n_a", "Alpha"), node("n_b", "Beta")],
			),
			T0 + 31 * DAY,
		);
		assert.deepEqual(payload.due.map((i) => [i.id, i.name, i.statement]), [["n_a", "Alpha", "statement of Alpha"]]);
		assert.deepEqual(payload.upcoming.map((i) => i.id), ["n_b"]);
		assert.equal(payload.due[0]!.reps, 1);
	});

	it("teaching sessions never contribute events", () => {
		const payload = reviewPayload(
			deps([{ id: "t1", kind: "teach", messages: solved("a", "n_a", T0) }], [node("n_a", "Alpha")]),
			T0 + 100 * DAY,
		);
		assert.deepEqual([payload.due, payload.upcoming], [[], []]);
	});

	it("events of one proposition from different sessions fold together, in time order", () => {
		const earlier = { id: "s1", kind: "practice" as const, messages: solved("a", "n_a", T0) };
		const later = { id: "s2", kind: "practice" as const, messages: solved("b", "n_a", T0 + 3 * DAY) };
		const listed = reviewPayload(deps([later, earlier], [node("n_a", "Alpha")]), T0 + 90 * DAY);
		const ordered = reviewPayload(deps([earlier, later], [node("n_a", "Alpha")]), T0 + 90 * DAY);
		assert.deepEqual(listed, ordered);
		assert.equal(listed.due[0]!.reps, 2);
	});

	it("a proposition deleted from the graph is dropped; an unreadable session is skipped", () => {
		const d = deps([{ id: "s1", kind: "practice", messages: solved("a", "n_gone", T0) }], [node("n_a", "Alpha")]);
		d.chatStore.listChats = () => [{ id: "s1", kind: "practice" }, { id: "missing", kind: "practice" }] as ChatSummary[];
		const payload = reviewPayload(d, T0 + 100 * DAY);
		assert.deepEqual([payload.due, payload.upcoming], [[], []]);
	});

	it("a first failure in a practice session marks the node verifying across sessions", () => {
		const day = (n: number) => T0 + n * DAY;
		const good = (id: string, n: number) => solved(id, "n_a", day(n));
		const failed: LhMessage[] = [
			...pose("p_f", ["n_a"], day(30)),
			...conclude("c_f", { outcome: "surrendered", rung: "R5", missClass: "cue" }, day(30) + 10),
		];
		const payload = reviewPayload(
			deps(
				[
					{ id: "s1", kind: "practice", messages: [...good("a", 0), ...good("b", 2), ...good("c", 13)] },
					{ id: "s2", kind: "practice", messages: failed },
				],
				[node("n_a", "Alpha")],
			),
			day(31) + 1000,
		);
		assert.deepEqual(payload.due.map((i) => [i.id, i.verifying, i.lapses]), [["n_a", true, 0]]);
	});
});
