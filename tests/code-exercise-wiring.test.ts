/**
 * code-exercises at the shared seams: the pending gate, the position folds
 * (view + native), the model-visible result, and the session export.
 * (The tool itself is code-exercise-tool.test.ts; the answer logic is
 * code-exercise.test.ts.)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCodeAnswer, CODE_EXERCISE_TOOL, dismissedCodeAnswer } from "../src/core/code-exercise.ts";
import { compactAnswer } from "../src/core/answers.ts";
import { derivePlanStatuses, derivePlanStatusesLh, type PlanTree } from "../src/core/contracts.ts";
import { newAnswerResult, danglingQuestionOf, type LhMessage } from "../src/core/native-messages.ts";
import { phaseAt3, phaseAt3Lh } from "../src/core/phases.ts";
import {
	findPendingToolCall,
	isPositionTool,
	isPositionToolPart,
	QUESTION_TOOLS,
	toolQuestionKind,
} from "../src/core/pending.ts";
import { ChatInputError, dismissAppends, parseChatInput } from "../src/core/input-events.ts";
import { dismissedAnswer } from "../src/core/question-core.ts";
import { messageMarkdown } from "../src/core/session-markdown.ts";
import type { LhViewMessage } from "../src/core/view.ts";

const exercise = {
	language: "python" as const,
	question: "Square every number.",
	explanation: "A comprehension.",
	tests: "assert squares == [1]",
};

const callMessage = (id: string, name: string, args: Record<string, unknown>): LhMessage =>
	({
		id,
		role: "assistant",
		content: [{ type: "toolCall", id: `call_${id}`, name, arguments: args }],
		timestamp: Date.now(),
	}) as never;

describe("the question-tool registry", () => {
	it("code-exercises is a question tool of its own kind", () => {
		assert.ok((QUESTION_TOOLS as readonly string[]).includes(CODE_EXERCISE_TOOL));
		assert.equal(toolQuestionKind(CODE_EXERCISE_TOOL), "code-exercise");
		assert.equal(toolQuestionKind("probe"), "quiz", "the existing folds are untouched");
		assert.equal(toolQuestionKind("recall"), "explain");
		assert.equal(toolQuestionKind("ask_user_question"), "ask");
	});

	it("it positions the plan map like the quizzing tools", () => {
		for (const tool of ["quiz", "explain", CODE_EXERCISE_TOOL]) {
			assert.equal(isPositionTool(tool), true, tool);
			assert.equal(isPositionToolPart(`tool-${tool}`), true, tool);
		}
		for (const tool of ["probe", "recall", "ask_user_question", "plan_init"]) {
			assert.equal(isPositionTool(tool), false, tool);
		}
		assert.equal(isPositionToolPart("text"), false);
	});

	it("an unanswered code-exercises call is the pending question", () => {
		const messages = [
			{
				id: "a1",
				role: "assistant",
				parts: [{ type: `tool-${CODE_EXERCISE_TOOL}`, toolCallId: "c1", state: "input-available", input: exercise }],
			},
		];
		const pending = findPendingToolCall(messages as never);
		assert.equal(pending?.tool, CODE_EXERCISE_TOOL);
		assert.equal(pending?.toolCallId, "c1");
	});

	it("an unanswered native call dangles; its answer settles it", () => {
		const call = callMessage("a1", CODE_EXERCISE_TOOL, { nodeId: "n", ...exercise });
		assert.equal(danglingQuestionOf([call])?.toolCallId, "call_a1");
		const answered = [call, newAnswerResult("call_a1", CODE_EXERCISE_TOOL, dismissedCodeAnswer(exercise))];
		assert.equal(danglingQuestionOf(answered), null);
	});
});

describe("the position folds", () => {
	const done: LhViewMessage = {
		id: "d",
		role: "assistant",
		parts: [{ type: "tool-probe_done", state: "output-available" } as never],
	};
	const tree: PlanTree = {
		nodes: [
			{ id: "a", title: "A" },
			{ id: "b", title: "B" },
		],
		edges: [{ from: "a", to: "b" }],
		version: 1,
	};

	it("a tagged code exercise opens teaching (view fold)", () => {
		const tagged: LhViewMessage = {
			id: "c",
			role: "assistant",
			parts: [{ type: `tool-${CODE_EXERCISE_TOOL}`, input: { nodeId: "a" } } as never],
		};
		assert.equal(phaseAt3([done, tagged]), "teach");
	});

	it("a tagged code exercise opens teaching (native fold), an untagged one does not", () => {
		const probeDone = {
			id: "pd",
			role: "toolResult",
			toolCallId: "pd1",
			toolName: "probe_done",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: Date.now(),
		} as never as LhMessage;
		assert.equal(phaseAt3Lh([probeDone, callMessage("c", CODE_EXERCISE_TOOL, { nodeId: "a" })]), "teach");
		assert.equal(phaseAt3Lh([probeDone, callMessage("c", CODE_EXERCISE_TOOL, {})]), "plan");
	});

	it("it positions the map (both derive folds agree)", () => {
		const viewMessage = { parts: [{ type: `tool-${CODE_EXERCISE_TOOL}`, state: "input-available", input: { nodeId: "b" } }] };
		assert.equal(derivePlanStatuses(tree, [viewMessage]).current, "b");
		assert.equal(derivePlanStatusesLh(tree, [callMessage("c", CODE_EXERCISE_TOOL, { nodeId: "b" })]).current, "b");
	});
});

describe("the result the model reads", () => {
	const passing = buildCodeAnswer(exercise, {
		code: "squares = [1]",
		runs: 2,
		lastRun: { stdout: "hi\n", passed: true, timedOut: false, durationMs: 4 },
	});

	it("compactAnswer routes a code answer to its own compact form", () => {
		assert.deepEqual(compactAnswer(passing), { kind: "code-exercise", code: "squares = [1]", runs: 2, passed: true, stdout: "hi\n" });
	});

	it("newAnswerResult sends the compact JSON to the model and keeps the full answer as details", () => {
		const result = newAnswerResult("c1", CODE_EXERCISE_TOOL, passing);
		const text = (result.content[0] as { text: string }).text;
		assert.deepEqual(JSON.parse(text), compactAnswer(passing));
		assert.equal(result.details, passing);
		assert.doesNotMatch(text, /comprehension/, "the model's own explanation never echoes back");
	});
});

describe("session export", () => {
	const result = (details: unknown): LhMessage =>
		({
			id: "r1",
			role: "toolResult",
			toolCallId: "c1",
			toolName: CODE_EXERCISE_TOOL,
			content: [{ type: "text", text: "ok" }],
			details,
			isError: false,
			timestamp: Date.now(),
		}) as never;
	const answer = (lastRun: Parameters<typeof buildCodeAnswer>[1]["lastRun"], tests = true) =>
		buildCodeAnswer(tests ? exercise : { ...exercise, tests: undefined }, { code: "x", runs: 1, lastRun });
	const ran = { stdout: "", timedOut: false, durationMs: 1 };

	it("states the outcome in the learner's terms", () => {
		const md = (details: unknown): string => messageMarkdown(result(details), "r1")!;
		assert.match(md(answer({ ...ran, passed: true })), /^### Code exercise · r1$/m);
		assert.match(md(answer({ ...ran, passed: true })), /passed the checks/);
		assert.match(md(answer({ ...ran, passed: false })), /did not pass the checks/);
		assert.match(md(answer({ ...ran, error: "boom" }, false)), /raised an error/);
		assert.match(md(answer({ ...ran, error: "Timed out", timedOut: true }, false)), /timed out/);
		assert.match(md(answer({ ...ran }, false)), /ran their code/);
		assert.match(md(dismissedCodeAnswer(exercise)), /skipped this exercise/);
		assert.match(md(answer({ ...ran, passed: true })), /\*\*Q:\*\* Square every number\./);
	});
});

describe("input events", () => {
	const record = { messages: [callMessage("a1", CODE_EXERCISE_TOOL, { nodeId: "n", ...exercise })] };

	it("a code answer rides the answer event untouched", () => {
		const answer = buildCodeAnswer(exercise, { code: "x", runs: 1 });
		const parsed = parseChatInput({ type: "answer", toolCallId: "call_a1", answer });
		assert.deepEqual(parsed, { type: "answer", toolCallId: "call_a1", answer });
	});

	it("dismissing a pending exercise appends the code dismissal as the call's result", () => {
		const [result] = dismissAppends(record, {
			type: "dismiss",
			toolCallId: "call_a1",
			answer: dismissedCodeAnswer(exercise),
		}) as unknown as [{ toolName: string; content: { text: string }[] }];
		assert.equal(result.toolName, CODE_EXERCISE_TOOL);
		assert.deepEqual(JSON.parse(result.content[0]!.text), {
			kind: "code-exercise",
			dismissed: true,
		});
	});

	it("a quiz-shaped dismissal of a code exercise is refused", () => {
		assert.throws(
			() =>
				dismissAppends(record, {
					type: "dismiss",
					toolCallId: "call_a1",
					answer: dismissedAnswer("quiz", "Q?"),
				}),
			ChatInputError,
		);
	});
});
