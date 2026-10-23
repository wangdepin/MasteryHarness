/**
 * REVIEW EVENTS (docs/review-plan.md §4.1): the retrieval evidence derived
 * from a practice session's record — pairing, honest folds, and what is
 * NOT evidence (movedOn, dismissed, untagged problems).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { concludedByDismissalPair } from "../src/core/native-messages.ts";
import { reviewEventsFromMessages } from "../src/core/review-events.ts";
import { conclude, pose } from "./review-fixtures.ts";

describe("reviewEventsFromMessages", () => {
	it("no messages → no events", () => {
		assert.deepEqual(reviewEventsFromMessages([], "s1"), []);
	});

	it("a solved problem yields one event per target, stamped at the conclude call", () => {
		const messages = [
			...pose("p1", ["n_a", "n_b"], 10),
			...conclude("c1", { outcome: "solved", rung: null }, 20),
		];
		assert.deepEqual(reviewEventsFromMessages(messages, "s1"), [
			{ nodeId: "n_a", at: 20, outcome: "solved", rung: null, missClass: null, session: "s1" },
			{ nodeId: "n_b", at: 20, outcome: "solved", rung: null, missClass: null, session: "s1" },
		]);
	});

	const rungCases: Array<[unknown, number | null]> = [
		["R0", 0],
		["R3", 3],
		["R5", 5],
		[null, null],
		[undefined, null],
		["R9", null],
		["hard", null],
		[2, null],
	];
	for (const [raw, expected] of rungCases) {
		it(`rung ${JSON.stringify(raw)} parses to ${expected}`, () => {
			const messages = [...pose("p1", ["n_a"], 1), ...conclude("c1", { outcome: "solved", rung: raw }, 2)];
			assert.equal(reviewEventsFromMessages(messages, "s1")[0]?.rung, expected);
		});
	}

	it("solvedWithHints and surrendered are evidence", () => {
		const messages = [
			...pose("p1", ["n_a"], 1),
			...conclude("c1", { outcome: "solvedWithHints", rung: "R2" }, 2),
			...pose("p2", ["n_b"], 3),
			...conclude("c2", { outcome: "surrendered", rung: "R5" }, 4),
		];
		assert.deepEqual(
			reviewEventsFromMessages(messages, "s1").map((e) => [e.nodeId, e.outcome, e.rung]),
			[
				["n_a", "solvedWithHints", 2],
				["n_b", "surrendered", 5],
			],
		);
	});

	it("movedOn is NOT evidence (owner, 2026-10-23)", () => {
		const messages = [...pose("p1", ["n_a"], 1), ...conclude("c1", { outcome: "movedOn", rung: null }, 2)];
		assert.deepEqual(reviewEventsFromMessages(messages, "s1"), []);
	});

	it("a dismissal-synthesized conclude is NOT evidence", () => {
		const [assistant, result] = concludedByDismissalPair("p1");
		const messages = [...pose("p1", ["n_a"], 1), assistant, result];
		assert.deepEqual(reviewEventsFromMessages(messages, "s1"), []);
	});

	it("an untagged problem (no target, or an empty one) carries no node signal", () => {
		const messages = [
			...pose("p1", undefined, 1),
			...conclude("c1", { outcome: "solved", rung: null }, 2),
			...pose("p2", [], 3),
			...conclude("c2", { outcome: "solved", rung: null }, 4),
		];
		assert.deepEqual(reviewEventsFromMessages(messages, "s1"), []);
	});

	it("malformed targets are filtered and duplicates collapse", () => {
		const messages = [
			...pose("p1", ["n_a", "n_a", 7, "", null], 1),
			...conclude("c1", { outcome: "solved", rung: null }, 2),
		];
		assert.deepEqual(
			reviewEventsFromMessages(messages, "s1").map((e) => e.nodeId),
			["n_a"],
		);
	});

	it("an ERRORED pose never happened — the conclude pairs with the last clean pose", () => {
		const messages = [
			...pose("p1", ["n_good"], 1),
			...pose("p_bad", ["n_bad"], 2, true),
			...conclude("c1", { outcome: "solved", rung: null }, 3),
		];
		assert.deepEqual(
			reviewEventsFromMessages(messages, "s1").map((e) => e.nodeId),
			["n_good"],
		);
	});

	it("an ERRORED conclude never happened", () => {
		const messages = [
			...pose("p1", ["n_a"], 1),
			...conclude("c_bad", { outcome: "solved", rung: null }, 2, true),
		];
		assert.deepEqual(reviewEventsFromMessages(messages, "s1"), []);
	});

	it("a conclude never leaks targets into the NEXT problem", () => {
		const messages = [
			...pose("p1", ["n_a"], 1),
			...conclude("c1", { outcome: "solved", rung: null }, 2),
			...pose("p2", undefined, 3),
			...conclude("c2", { outcome: "surrendered", rung: "R5" }, 4),
		];
		assert.deepEqual(
			reviewEventsFromMessages(messages, "s1").map((e) => e.nodeId),
			["n_a"],
		);
	});

	it("events keep record order across problems", () => {
		const messages = [
			...pose("p1", ["n_a"], 10),
			...conclude("c1", { outcome: "solved", rung: null }, 20),
			...pose("p2", ["n_a"], 30),
			...conclude("c2", { outcome: "solvedWithHints", rung: "R1" }, 40),
		];
		assert.deepEqual(
			reviewEventsFromMessages(messages, "s1").map((e) => [e.at, e.outcome]),
			[
				[20, "solved"],
				[40, "solvedWithHints"],
			],
		);
	});

	it("stamps the session id on every event", () => {
		const messages = [...pose("p1", ["n_a", "n_b"], 1), ...conclude("c1", { outcome: "solved", rung: null }, 2)];
		assert.deepEqual(
			reviewEventsFromMessages(messages, "chat_x").map((e) => e.session),
			["chat_x", "chat_x"],
		);
	});

	const missCases: Array<[unknown, string | null]> = [
		["cue", "cue"],
		["discrimination", "discrimination"],
		["structural", "structural"],
		["execution", "execution"],
		["careless", "careless"],
		[null, null],
		[undefined, null],
		["Careless", null],
		["other", null],
		[3, null],
	];
	for (const [raw, expected] of missCases) {
		it(`missClass ${JSON.stringify(raw)} parses to ${JSON.stringify(expected)}`, () => {
			const messages = [
				...pose("p1", ["n_a"], 1),
				...conclude("c1", { outcome: "solvedWithHints", rung: "R2", missClass: raw }, 2),
			];
			assert.equal(reviewEventsFromMessages(messages, "s1")[0]?.missClass, expected);
		});
	}
});
