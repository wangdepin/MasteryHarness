/**
 * code-exercise — the code-exercise question contract + the pure answer
 * logic. No framework imports, no UI, no runtime: everything here is
 * deterministic and unit-testable (the Worker that actually runs code is a
 * `CodeRuntime` implementation, not part of this file).
 *
 * The flow mirrors quiz (question-core.ts):
 *   1. The teacher calls the `code-exercises` tool (question + starter code
 *      + optional tests + explanation). No server execute verdict → the
 *      call lands in the UI as a tool part in `input-available` state.
 *   2. The learner edits and runs code in the card; the client runs it
 *      through a `CodeRuntime` for the exercise's language.
 *   3. On submit, buildCodeAnswer folds the final code + the last run into
 *      the answer record; compactCodeAnswerForModel is what the teacher
 *      reads back (never the explanation — the model authored that).
 *
 * `tests` is optional: with tests the run is graded (`passed`), without
 * them the exercise is run-only and the teacher comments on the output.
 */

import { Type, type Static } from "typebox";

// ─── languages + the runtime seam ───────────────────────────────────────────

/** The model-facing tool name. */
export const CODE_EXERCISE_TOOL = "code-exercises";

/** The languages an exercise can be written in. One runtime per entry. */
export const CODE_LANGUAGES = ["python"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** One execution request. `tests`, when present, runs after `code` in the
 *  same namespace; the run passes only if both finish without an error. */
export interface CodeRunRequest {
	code: string;
	tests?: string;
	timeoutMs: number;
}

/** The outcome of one run. `passed` is defined exactly when the request
 *  carried tests; a timeout or an error in `code` or `tests` is a fail. */
export interface CodeRunResult {
	stdout: string;
	error?: string;
	passed?: boolean;
	timedOut: boolean;
	durationMs: number;
}

/** What a language backend implements (the Pyodide runner is the first).
 *  `run` resolves for anything the code did — errors, failed checks and
 *  timeouts are results. It rejects only when the runtime itself is
 *  unavailable. */
export interface CodeRuntime {
	language: CodeLanguage;
	run(request: CodeRunRequest): Promise<CodeRunResult>;
}

// ─── tool input schema (the question contract) ──────────────────────────────

/** Written out literal by literal (a `.map` over CODE_LANGUAGES infers
 *  `never`, and argument-heal only reads `const` members); the test pins it
 *  to CODE_LANGUAGES. */
const codeLanguage = Type.Union([Type.Literal("python")], {
	description: `REQUIRED — the exercise's language, as a bare word (no quotes): ${CODE_LANGUAGES.join(", ")}.`,
});

/** Fields shared by the tool schema and the display schema: everything
 *  except the plan-position field. Order is authoring order — the
 *  explanation (reasoning) sits immediately before the tests (the
 *  commitment), the same argument-order ruling as quiz. */
const codeExerciseBase = {
	language: codeLanguage,
	question: Type.String({
		description:
			"The exercise as the learner sees it (markdown + LaTeX). ONE exercise per turn: pose it, then end your turn — his result determines the next.",
	}),
	starterCode: Type.String({
		description: "The code the editor starts with. May be empty for write-from-scratch exercises.",
	}),
	explanation: Type.String({
		description:
			"REQUIRED. Explanation revealed AFTER the learner submits (shown whether the code passed or not). " +
			"Written BEFORE tests by design: reason out what correct code looks like, then commit the checks.",
	}),
	tests: Type.Optional(
		Type.String({
			description:
				"Optional checks in the exercise's language, run AFTER the learner's code in the same namespace " +
				"(e.g. `assert` statements). Any error fails the run. Omit for a run-only exercise you will comment on yourself.",
		}),
	),
};

/** The TEACHER's tool object: the shared fields + the plan-position field
 *  (same semantics as quiz's nodeId — validated per session in the tool's
 *  execute). */
export const codeExerciseInputObject = Type.Object({
	nodeId: Type.String({
		description:
			"REQUIRED plan-tree node id this exercise is about — must EXACTLY match one of this session's " +
			"plan_init node slugs (validated at call time; a mismatched id is rejected back to you).",
	}),
	...codeExerciseBase,
});

/** The DISPLAY parse schema (tool-parts.ts): the shared fields only —
 *  nodeId is an unknown key Value.Clean strips, exactly as for quiz. */
export const codeExerciseDisplayInputSchema = Type.Object(codeExerciseBase);

export type CodeExerciseToolInput = Static<typeof codeExerciseInputObject>;
export type CodeExerciseDisplayInput = Static<typeof codeExerciseDisplayInputSchema>;

/** The cross-field authoring contract, enforced at the tool-call boundary
 *  (and mirrored by the display parse): empty result = an exercise the card
 *  can arm and run. */
export function codeExerciseInputProblems(input: { question: string; tests?: string }): string[] {
	const problems: string[] = [];
	if (input.question.trim().length === 0) {
		problems.push("question is empty — state the exercise.");
	}
	if (input.tests !== undefined && input.tests.trim().length === 0) {
		problems.push("tests is blank — omit the field for a run-only exercise, or provide the checks.");
	}
	return problems;
}

// ─── answering ──────────────────────────────────────────────────────────────

/** What the learner's card hands over on submit. `lastRun` is the run of
 *  exactly the submitted `code` (the card owns that guarantee); absent when
 *  the learner never ran it. */
export interface CodeSubmission {
	code: string;
	runs: number;
	lastRun?: CodeRunResult;
}

/** The learner's answer record — the full structured form, for the record
 *  and the answered card. */
export interface CodeExerciseAnswerData {
	kind: "code-exercise";
	language: CodeLanguage;
	questionText: string;
	/** The exercise carried tests, so `lastRun.passed` is meaningful. */
	graded: boolean;
	code: string;
	runs: number;
	lastRun?: Pick<CodeRunResult, "stdout" | "error" | "passed" | "timedOut">;
	/** Snapshot for the answered card. */
	explanation?: string;
	dismissed?: boolean;
	answeredAt: string;
}

/** Is this persisted answer a code exercise's? (The answer wire carries
 *  `unknown`; `kind` is the discriminant against question-core's answers.) */
export function isCodeExerciseAnswer(answer: unknown): answer is CodeExerciseAnswerData {
	return typeof answer === "object" && answer !== null && (answer as { kind?: unknown }).kind === "code-exercise";
}

/** Fold a submission into the answer record. */
export function buildCodeAnswer(
	exercise: Pick<CodeExerciseDisplayInput, "language" | "question" | "explanation" | "tests">,
	submission: CodeSubmission,
): CodeExerciseAnswerData {
	const { lastRun } = submission;
	return {
		kind: "code-exercise",
		language: exercise.language,
		questionText: exercise.question,
		graded: exercise.tests !== undefined,
		code: submission.code,
		runs: submission.runs,
		...(lastRun
			? {
					lastRun: {
						stdout: lastRun.stdout,
						error: lastRun.error,
						passed: lastRun.passed,
						timedOut: lastRun.timedOut,
					},
				}
			: {}),
		explanation: exercise.explanation,
		answeredAt: new Date().toISOString(),
	};
}

/** The dismissal record (ESC-abort from a pending exercise): the minimum
 *  honest answer, the same contract as question-core's dismissedAnswer. */
export function dismissedCodeAnswer(
	exercise: Pick<CodeExerciseDisplayInput, "language" | "question">,
): CodeExerciseAnswerData {
	return {
		kind: "code-exercise",
		language: exercise.language,
		questionText: exercise.question,
		graded: false,
		code: "",
		runs: 0,
		dismissed: true,
		answeredAt: new Date().toISOString(),
	};
}

/** The MODEL-VISIBLE answer: only what the learner added — his final code
 *  and what running it did. The call already carries everything the model
 *  authored. A graded exercise always reports `passed` (never run = not
 *  passed); a run-only one never does. */
export function compactCodeAnswerForModel(ad: CodeExerciseAnswerData): Record<string, unknown> {
	if (ad.dismissed) return { kind: ad.kind, dismissed: true };
	const out: Record<string, unknown> = { kind: ad.kind, code: ad.code, runs: ad.runs };
	if (ad.graded) out.passed = ad.lastRun?.passed === true;
	if (!ad.lastRun) return out;
	if (ad.lastRun.stdout) out.stdout = ad.lastRun.stdout;
	if (ad.lastRun.error) out.error = ad.lastRun.error;
	if (ad.lastRun.timedOut) out.timedOut = true;
	return out;
}
