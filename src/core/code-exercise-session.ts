/**
 * code-exercise-session — the client-side state machine of one code
 * exercise (pure, reducer-shaped, unit-testable; the card in
 * components/code-exercise-dock.tsx is a thin view over it).
 *
 * THE RUN-BEFORE-SUBMIT LAW (owner, 2026-10-23): a learner may only submit
 * code that has been run. Any edit after a run makes that run stale — the
 * result stays on screen, marked outdated, and Submit stays disabled until
 * the current code is run again. So `lastRun` in a submission is always the
 * run of exactly the submitted code.
 */

import type { CodeRunResult, CodeSubmission } from "./code-exercise.ts";

/** How long one learner run may take before the runner kills it. */
export const CODE_RUN_TIMEOUT_MS = 10_000;

export interface ExerciseState {
	/** The editor's current text. */
	code: string;
	running: boolean;
	/** Completed runs (timeouts count; a runtime failure does not). */
	runs: number;
	/** The code the last completed run executed. */
	ranCode: string | null;
	lastRun: CodeRunResult | null;
	/** The runtime itself was unavailable on the last attempt. */
	runtimeError: string | null;
}

export type ExerciseAction =
	| { type: "edit"; code: string }
	| { type: "run-start" }
	| { type: "run-done"; ranCode: string; result: CodeRunResult }
	| { type: "run-failed"; message: string };

export function initialExerciseState(starterCode: string): ExerciseState {
	return { code: starterCode, running: false, runs: 0, ranCode: null, lastRun: null, runtimeError: null };
}

export function exerciseReducer(state: ExerciseState, action: ExerciseAction): ExerciseState {
	switch (action.type) {
		case "edit":
			return action.code === state.code ? state : { ...state, code: action.code };
		case "run-start":
			return { ...state, running: true, runtimeError: null };
		case "run-done":
			return {
				...state,
				running: false,
				runs: state.runs + 1,
				ranCode: action.ranCode,
				lastRun: action.result,
				runtimeError: null,
			};
		case "run-failed":
			return { ...state, running: false, runtimeError: action.message };
	}
}

/** The last run executed exactly the code now in the editor. */
export function lastRunIsCurrent(state: ExerciseState): boolean {
	return state.lastRun !== null && state.ranCode === state.code;
}

/** A run only makes sense on non-blank code, and one at a time. */
export function canRun(state: ExerciseState): boolean {
	return !state.running && state.code.trim().length > 0;
}

/** Submit is open only for code that has been run (the law above). */
export function canSubmit(state: ExerciseState): boolean {
	return !state.running && lastRunIsCurrent(state);
}

/** The submission for `buildCodeAnswer`. Only valid when canSubmit. */
export function toSubmission(state: ExerciseState): CodeSubmission {
	if (!canSubmit(state) || state.lastRun === null) {
		throw new Error("toSubmission: the current code has not been run");
	}
	return { code: state.code, runs: state.runs, lastRun: state.lastRun };
}

// ─── editor helper ──────────────────────────────────────────────────────────

/** Spaces one Tab press inserts (PEP 8). */
export const EDITOR_INDENT = "    ";

/** Tab in the editor: replace the selection with one indent and put the
 *  caret after it. */
export function insertIndent(
	value: string,
	selectionStart: number,
	selectionEnd: number,
): { value: string; caret: number } {
	const before = value.slice(0, selectionStart);
	const after = value.slice(selectionEnd);
	return { value: `${before}${EDITOR_INDENT}${after}`, caret: selectionStart + EDITOR_INDENT.length };
}

/** ⌘/Ctrl+Enter in the editor runs the code (the notebook convention). Plain
 *  Enter stays a newline; Submit is never a keystroke here — it needs the
 *  button, after a run. */
export function isRunShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
	return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}
