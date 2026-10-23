/**
 * Unit tests — code-exercise-session (the run-before-submit state machine).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	canRun,
	canSubmit,
	EDITOR_INDENT,
	exerciseReducer,
	initialExerciseState,
	insertIndent,
	isRunShortcut,
	lastRunIsCurrent,
	toSubmission,
	type ExerciseAction,
	type ExerciseState,
} from "../src/core/code-exercise-session.ts";
import type { CodeRunResult } from "../src/core/code-exercise.ts";

const result: CodeRunResult = { stdout: "ok\n", passed: true, timedOut: false, durationMs: 3 };

const apply = (state: ExerciseState, ...actions: ExerciseAction[]): ExerciseState =>
	actions.reduce(exerciseReducer, state);

const ran = (code: string, ...more: ExerciseAction[]): ExerciseState =>
	apply(initialExerciseState(code), { type: "run-start" }, { type: "run-done", ranCode: code, result }, ...more);

describe("the run-before-submit law", () => {
	it("starts with the starter code, unrun and unsubmittable", () => {
		const state = initialExerciseState("x = 1");
		assert.equal(state.code, "x = 1");
		assert.equal(lastRunIsCurrent(state), false);
		assert.equal(canSubmit(state), false);
	});

	it("opens Submit after a run of the current code", () => {
		const state = ran("x = 1");
		assert.equal(state.runs, 1);
		assert.equal(lastRunIsCurrent(state), true);
		assert.equal(canSubmit(state), true);
	});

	it("closes Submit again as soon as the code is edited", () => {
		const state = ran("x = 1", { type: "edit", code: "x = 2" });
		assert.equal(lastRunIsCurrent(state), false);
		assert.equal(canSubmit(state), false);
		assert.equal(state.lastRun, result, "the stale result stays on screen");
	});

	it("reopens Submit when the edit is undone to exactly the run code", () => {
		const state = ran("x = 1", { type: "edit", code: "x = 2" }, { type: "edit", code: "x = 1" });
		assert.equal(canSubmit(state), true);
	});

	it("treats a result that lands after an edit as stale", () => {
		const state = apply(
			initialExerciseState("x = 1"),
			{ type: "run-start" },
			{ type: "edit", code: "x = 2" },
			{ type: "run-done", ranCode: "x = 1", result },
		);
		assert.equal(state.ranCode, "x = 1");
		assert.equal(canSubmit(state), false);
	});

	it("keeps Submit closed while a run is in flight", () => {
		const state = apply(ran("x = 1"), { type: "run-start" });
		assert.equal(state.running, true);
		assert.equal(canSubmit(state), false);
		assert.equal(canRun(state), false);
	});
});

describe("running", () => {
	it("refuses to run blank code", () => {
		assert.equal(canRun(initialExerciseState("")), false);
		assert.equal(canRun(initialExerciseState(" \n\t")), false);
		assert.equal(canRun(initialExerciseState("pass")), true);
	});

	it("counts completed runs, timeouts included", () => {
		const timedOut: CodeRunResult = { stdout: "", error: "Timed out after 10000 ms", timedOut: true, durationMs: 10000 };
		const state = apply(
			initialExerciseState("while True: pass"),
			{ type: "run-start" },
			{ type: "run-done", ranCode: "while True: pass", result: timedOut },
			{ type: "run-start" },
			{ type: "run-done", ranCode: "while True: pass", result: timedOut },
		);
		assert.equal(state.runs, 2);
	});

	it("does not count a runtime failure and keeps the last good run", () => {
		const state = apply(ran("x = 1"), { type: "run-start" }, { type: "run-failed", message: "offline" });
		assert.equal(state.runs, 1);
		assert.equal(state.running, false);
		assert.equal(state.runtimeError, "offline");
		assert.equal(state.lastRun, result);
	});

	it("clears the runtime error when the next run starts", () => {
		const state = apply(initialExerciseState("x"), { type: "run-failed", message: "offline" }, { type: "run-start" });
		assert.equal(state.runtimeError, null);
	});

	it("returns the same state for a no-op edit", () => {
		const state = initialExerciseState("x");
		assert.equal(exerciseReducer(state, { type: "edit", code: "x" }), state);
	});
});

describe("toSubmission", () => {
	it("hands over the code, the run count and the run of exactly that code", () => {
		const state = apply(ran("x = 1"), { type: "run-start" }, { type: "run-done", ranCode: "x = 1", result });
		assert.deepEqual(toSubmission(state), { code: "x = 1", runs: 2, lastRun: result });
	});

	it("throws for code that has not been run", () => {
		assert.throws(() => toSubmission(initialExerciseState("x = 1")), /has not been run/);
		assert.throws(() => toSubmission(ran("x = 1", { type: "edit", code: "x = 2" })), /has not been run/);
	});
});

describe("insertIndent", () => {
	it("inserts one indent at the caret", () => {
		assert.deepEqual(insertIndent("ab", 1, 1), { value: `a${EDITOR_INDENT}b`, caret: 1 + EDITOR_INDENT.length });
	});

	it("replaces a selection", () => {
		assert.deepEqual(insertIndent("abcd", 1, 3), { value: `a${EDITOR_INDENT}d`, caret: 1 + EDITOR_INDENT.length });
	});

	it("works at the ends", () => {
		assert.equal(insertIndent("", 0, 0).value, EDITOR_INDENT);
		assert.equal(insertIndent("x", 1, 1).value, `x${EDITOR_INDENT}`);
	});
});

describe("isRunShortcut", () => {
	const key = (over: Partial<Parameters<typeof isRunShortcut>[0]>) =>
		isRunShortcut({ key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });

	it("is ⌘+Enter or Ctrl+Enter", () => {
		assert.equal(key({ metaKey: true }), true);
		assert.equal(key({ ctrlKey: true }), true);
	});

	it("leaves plain Enter, Shift/Alt chords and other keys alone", () => {
		assert.equal(key({}), false);
		assert.equal(key({ metaKey: true, shiftKey: true }), false);
		assert.equal(key({ ctrlKey: true, altKey: true }), false);
		assert.equal(key({ metaKey: true, key: "a" }), false);
	});
});
