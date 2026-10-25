/** A plan node is learned once one graded check on it was passed. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { derivePlanProgressLh } from "../src/core/plan-progress.ts";
import type { PlanTree } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const tree: PlanTree = {
	nodes: [
		{ id: "a", title: "A" },
		{ id: "b", title: "B" },
		{ id: "c", title: "C" },
	],
	edges: [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
	],
	version: 1,
};

function call(id: string, name: string, nodeId?: string): LhMessage {
	return {
		id: `m_${id}`,
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: nodeId === undefined ? {} : { nodeId } }],
	} as unknown as LhMessage;
}

function result(toolCallId: string, toolName: string, details: unknown, isError = false): LhMessage {
	return { id: `r_${toolCallId}`, role: "toolResult", toolCallId, toolName, details, isError, content: [] } as unknown as LhMessage;
}

const quiz = (correct: boolean, extra: Record<string, unknown> = {}) => ({ kind: "quiz", correct, dontKnow: false, ...extra });
const code = (graded: boolean, passed: boolean | undefined, extra: Record<string, unknown> = {}) => ({
	kind: "code-exercise",
	graded,
	lastRun: passed === undefined ? undefined : { passed },
	...extra,
});

function progress(messages: LhMessage[], planTree: PlanTree = tree) {
	return derivePlanProgressLh(planTree, messages);
}

describe("derivePlanProgressLh", () => {
	it("is 0 of the node count before any check", () => {
		assert.deepEqual(progress([]), { done: 0, total: 3 });
	});

	it("counts a node once a quiz on it was answered correctly", () => {
		assert.deepEqual(progress([call("q1", "quiz", "a"), result("q1", "quiz", quiz(true))]), { done: 1, total: 3 });
	});

	it("counts a node once a graded code exercise on it passed", () => {
		assert.deepEqual(progress([call("x1", "code-exercises", "b"), result("x1", "code-exercises", code(true, true))]), { done: 1, total: 3 });
	});

	it("keeps a node done after a later failed check on it", () => {
		const messages = [
			call("q1", "quiz", "a"),
			result("q1", "quiz", quiz(true)),
			call("q2", "quiz", "a"),
			result("q2", "quiz", quiz(false)),
		];
		assert.deepEqual(progress(messages), { done: 1, total: 3 });
	});

	it("counts each node once however many checks it passed", () => {
		const messages = [
			call("q1", "quiz", "a"),
			result("q1", "quiz", quiz(true)),
			call("q2", "quiz", "a"),
			result("q2", "quiz", quiz(true)),
		];
		assert.deepEqual(progress(messages), { done: 1, total: 3 });
	});

	it("reaches the full count when every node has a passed check", () => {
		const messages = [
			call("q1", "quiz", "a"),
			result("q1", "quiz", quiz(true)),
			call("q2", "quiz", "b"),
			result("q2", "quiz", quiz(true)),
			call("x1", "code-exercises", "c"),
			result("x1", "code-exercises", code(true, true)),
		];
		assert.deepEqual(progress(messages), { done: 3, total: 3 });
	});

	const notPassed: Array<[string, LhMessage[]]> = [
		["a wrong quiz answer", [call("q", "quiz", "a"), result("q", "quiz", quiz(false))]],
		["an I-don't-know quiz answer", [call("q", "quiz", "a"), result("q", "quiz", quiz(false, { dontKnow: true }))]],
		["a dismissed quiz", [call("q", "quiz", "a"), result("q", "quiz", quiz(true, { dismissed: true }))]],
		["a quiz result that errored", [call("q", "quiz", "a"), result("q", "quiz", quiz(true), true)]],
		["a quiz call that is still unanswered", [call("q", "quiz", "a")]],
		["a failed graded code exercise", [call("x", "code-exercises", "a"), result("x", "code-exercises", code(true, false))]],
		["a graded code exercise that was never run", [call("x", "code-exercises", "a"), result("x", "code-exercises", code(true, undefined))]],
		["a run-only code exercise (no tests, no pass signal)", [call("x", "code-exercises", "a"), result("x", "code-exercises", code(false, undefined))]],
		["a dismissed code exercise", [call("x", "code-exercises", "a"), result("x", "code-exercises", code(true, true, { dismissed: true }))]],
		["an explain check (graded by the model, no structured verdict)", [call("e", "explain", "a"), result("e", "explain", { kind: "explain", dontKnow: false })]],
		["a probe-phase question", [call("p", "probe", "a"), result("p", "probe", quiz(true))]],
		["a quiz not tagged with a node", [call("q", "quiz"), result("q", "quiz", quiz(true))]],
		["a quiz tagged with a node the plan does not have", [call("q", "quiz", "gone"), result("q", "quiz", quiz(true))]],
		["a result without details", [call("q", "quiz", "a"), result("q", "quiz", undefined)]],
	];
	for (const [label, messages] of notPassed) {
		it(`does not count ${label}`, () => {
			assert.deepEqual(progress(messages), { done: 0, total: 3 });
		});
	}

	it("matches a result to its own call, not to the latest call", () => {
		const messages = [
			call("q1", "quiz", "a"),
			call("q2", "quiz", "b"),
			result("q1", "quiz", quiz(true)),
			result("q2", "quiz", quiz(false)),
		];
		assert.deepEqual(progress(messages), { done: 1, total: 3 });
	});

	it("drops passes on nodes a rewritten plan no longer has", () => {
		const rewritten: PlanTree = { nodes: [{ id: "b", title: "B" }, { id: "z", title: "Z" }], edges: [], version: 2 };
		const messages = [
			call("q1", "quiz", "a"),
			result("q1", "quiz", quiz(true)),
			call("q2", "quiz", "b"),
			result("q2", "quiz", quiz(true)),
		];
		assert.deepEqual(progress(messages, rewritten), { done: 1, total: 2 });
	});
});
