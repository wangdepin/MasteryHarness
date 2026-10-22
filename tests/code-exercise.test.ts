/**
 * Unit tests — code-exercise (pure logic, no runtime, no LLM).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import {
	buildCodeAnswer,
	CODE_LANGUAGES,
	codeExerciseInputObject,
	codeExerciseInputProblems,
	compactCodeAnswerForModel,
	dismissedCodeAnswer,
	type CodeRunResult,
} from "../src/core/code-exercise.ts";
import { parseCodeExerciseInput } from "../src/core/tool-parts.ts";

const exercise = {
	nodeId: "list-comprehension",
	language: "python",
	question: "Square every number in `nums`.",
	starterCode: "nums = [10, 20, 30]\nsquares = []\n",
	explanation: "A comprehension builds the list in one expression.",
	tests: "assert squares == [100, 400, 900]",
} as const;

const passedRun: CodeRunResult = { stdout: "ok\n", passed: true, timedOut: false, durationMs: 12 };

describe("the authoring contract", () => {
	it("accepts a graded exercise and a run-only one", () => {
		assert.equal(Value.Check(codeExerciseInputObject, exercise), true);
		const { tests: _tests, ...runOnly } = exercise;
		assert.equal(Value.Check(codeExerciseInputObject, runOnly), true);
	});

	it("requires nodeId, language, question, starterCode and explanation", () => {
		for (const key of ["nodeId", "language", "question", "starterCode", "explanation"] as const) {
			const { [key]: _dropped, ...rest } = exercise;
			assert.equal(Value.Check(codeExerciseInputObject, rest), false, `missing ${key}`);
		}
	});

	it("accepts an empty starterCode (write from scratch)", () => {
		assert.equal(Value.Check(codeExerciseInputObject, { ...exercise, starterCode: "" }), true);
	});

	it("rejects a language that has no runtime", () => {
		assert.equal(Value.Check(codeExerciseInputObject, { ...exercise, language: "cobol" }), false);
	});

	it("accepts exactly the languages in CODE_LANGUAGES", () => {
		for (const language of CODE_LANGUAGES) {
			assert.equal(Value.Check(codeExerciseInputObject, { ...exercise, language }), true, language);
		}
		const members = codeExerciseInputObject.properties.language.anyOf.map((m) => m.const);
		assert.deepEqual(members, [...CODE_LANGUAGES]);
	});

	it("leads the property order with nodeId and puts explanation before tests", () => {
		const keys = Object.keys(codeExerciseInputObject.properties);
		assert.equal(keys[0], "nodeId");
		assert.ok(keys.indexOf("explanation") < keys.indexOf("tests"));
	});

	it("flags a blank question and blank tests", () => {
		assert.deepEqual(codeExerciseInputProblems({ question: "x" }), []);
		assert.equal(codeExerciseInputProblems({ question: "  " }).length, 1);
		assert.equal(codeExerciseInputProblems({ question: "x", tests: "\n " }).length, 1);
	});
});

describe("parseCodeExerciseInput (display seam)", () => {
	it("parses a valid call and strips nodeId", () => {
		const parsed = parseCodeExerciseInput(exercise);
		assert.ok(parsed);
		assert.equal(parsed.language, "python");
		assert.equal(parsed.tests, exercise.tests);
		assert.equal("nodeId" in parsed, false);
	});

	it("heals a JSON-string-encoded language, like the boundary does", () => {
		const parsed = parseCodeExerciseInput({ ...exercise, language: '"python"' });
		assert.equal(parsed?.language, "python");
	});

	it("returns undefined for malformed or unauthorable input", () => {
		assert.equal(parseCodeExerciseInput(null), undefined);
		assert.equal(parseCodeExerciseInput({ ...exercise, language: "cobol" }), undefined);
		assert.equal(parseCodeExerciseInput({ ...exercise, question: " " }), undefined);
		assert.equal(parseCodeExerciseInput({ ...exercise, tests: "" }), undefined);
	});

	it("leaves backslashes in code untouched", () => {
		const starterCode = 'print("a\\tb\\nc")  # \\frac \\rho';
		const tests = 'assert "\\x41" == "A"';
		const parsed = parseCodeExerciseInput({ ...exercise, starterCode, tests });
		assert.equal(parsed?.starterCode, starterCode);
		assert.equal(parsed?.tests, tests);
	});
});

describe("answering", () => {
	it("builds a graded answer from a passing run", () => {
		const answer = buildCodeAnswer(exercise, { code: "squares = [x*x for x in nums]", runs: 2, lastRun: passedRun });
		assert.equal(answer.graded, true);
		assert.equal(answer.lastRun?.passed, true);
		assert.equal(answer.runs, 2);
		assert.equal(answer.explanation, exercise.explanation);
	});

	it("marks a run-only exercise as not graded", () => {
		const { tests: _tests, ...runOnly } = exercise;
		const answer = buildCodeAnswer(runOnly, { code: "print(1)", runs: 1, lastRun: { stdout: "1\n", timedOut: false, durationMs: 3 } });
		assert.equal(answer.graded, false);
	});

	it("shows the model code, runs, passed and output — never the explanation", () => {
		const answer = buildCodeAnswer(exercise, { code: "squares = []", runs: 1, lastRun: { stdout: "", error: "AssertionError", passed: false, timedOut: false, durationMs: 5 } });
		assert.deepEqual(compactCodeAnswerForModel(answer), {
			kind: "code-exercise",
			code: "squares = []",
			runs: 1,
			passed: false,
			error: "AssertionError",
		});
	});

	it("reports a graded exercise that was never run as not passed", () => {
		const answer = buildCodeAnswer(exercise, { code: "squares = []", runs: 0 });
		assert.deepEqual(compactCodeAnswerForModel(answer), {
			kind: "code-exercise",
			code: "squares = []",
			runs: 0,
			passed: false,
		});
	});

	it("never reports passed for a run-only exercise, and flags a timeout", () => {
		const { tests: _tests, ...runOnly } = exercise;
		const answer = buildCodeAnswer(runOnly, { code: "while True: pass", runs: 1, lastRun: { stdout: "", error: "timed out", timedOut: true, durationMs: 5000 } });
		const compact = compactCodeAnswerForModel(answer);
		assert.equal("passed" in compact, false);
		assert.equal(compact.timedOut, true);
	});

	it("dismissal is the minimum honest answer", () => {
		const answer = dismissedCodeAnswer(exercise);
		assert.deepEqual(compactCodeAnswerForModel(answer), { kind: "code-exercise", dismissed: true });
	});
});
