"use client";

import { useLayoutEffect, useReducer, useRef, type KeyboardEvent } from "react";
import { CheckIcon, PlayIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { BrailleSpinner } from "@/components/braille-spinner";
import { cn } from "@/lib/utils";
import {
	buildCodeAnswer,
	canRun,
	canSubmit,
	CODE_RUN_TIMEOUT_MS,
	exerciseReducer,
	initialExerciseState,
	insertIndent,
	lastRunIsCurrent,
	restoreLiteralNewlines,
	toSubmission,
	type CodeExerciseAnswerData,
	type CodeExerciseDisplayInput,
	type CodeLanguage,
	type CodeRunResult,
	type CodeRuntime,
	type ExerciseState,
} from "@/src/core";

/**
 * The code-exercise dock content — the question dock's twin for the
 * `code-exercises` tool: the teacher's exercise on top, the learner's
 * editor + Run + output below, Submit docked in the bottom row. Collapse
 * and the composer swap are the DockOverlay's; this is content only, and
 * the runtime is injected (the shared Pyodide runner in production).
 *
 * The run-before-submit law (src/core/code-exercise-session.ts): Submit is
 * disabled until the code in the editor has been run; editing after a run
 * keeps the old output visible, marked outdated.
 */

const LANGUAGE_LABELS: Record<CodeLanguage, string> = { python: "Python" };

export interface CodeExerciseDockProps {
	input: CodeExerciseDisplayInput;
	runtime: CodeRuntime;
	onSubmit: (answer: CodeExerciseAnswerData) => void;
	/** Compaction is running for this chat — the answer POST would block on
	 *  the server's gate, so Submit is disabled and says so (the question
	 *  dock's affordance). */
	compactionRunning?: boolean;
}

export function CodeExerciseDock({ input, runtime, onSubmit, compactionRunning = false }: CodeExerciseDockProps) {
	const [state, dispatch] = useReducer(exerciseReducer, input.starterCode, initialExerciseState);
	const graded = input.tests !== undefined;
	const submittable = canSubmit(state) && !compactionRunning;
	const editorRef = useRef<HTMLTextAreaElement>(null);
	// Where the caret goes after the next render: React rewrites the textarea's
	// value on every controlled change, which parks the caret at the end.
	const pendingCaret = useRef<number | null>(null);
	useLayoutEffect(() => {
		if (pendingCaret.current === null) return;
		editorRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
		pendingCaret.current = null;
	}, [state.code]);

	const run = async (): Promise<void> => {
		if (!canRun(state)) return;
		const code = state.code;
		dispatch({ type: "run-start" });
		try {
			const result = await runtime.run({ code, tests: input.tests, timeoutMs: CODE_RUN_TIMEOUT_MS });
			dispatch({ type: "run-done", ranCode: code, result });
		} catch (error) {
			dispatch({ type: "run-failed", message: error instanceof Error ? error.message : String(error) });
		}
	};

	const submit = (): void => {
		if (!submittable) return;
		onSubmit(buildCodeAnswer(input, toSubmission(state)));
	};

	// Tab indents instead of leaving the editor; Shift+Tab keeps its native focus move.
	const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		if (event.key !== "Tab" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
		event.preventDefault();
		const editor = event.currentTarget;
		const next = insertIndent(editor.value, editor.selectionStart, editor.selectionEnd);
		pendingCaret.current = next.caret;
		dispatch({ type: "edit", code: next.value });
	};

	return (
		<div data-testid="code-exercise-dock">
			<div data-session-find-root="" className="max-h-[var(--dock-max-h,55dvh)] overflow-y-auto px-4 pt-3">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Code · {LANGUAGE_LABELS[input.language]}
				</div>
				<div className="mb-3 font-medium">
					<MessageResponse>{restoreLiteralNewlines(input.question)}</MessageResponse>
				</div>

				<div className="rounded-[10px] border border-border/70 bg-background/60 transition-colors focus-within:border-primary/50">
					<div className="px-2.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Your code
					</div>
					<textarea
						ref={editorRef}
						data-testid="code-editor"
						aria-label="Your code"
						value={state.code}
						onChange={(event) => dispatch({ type: "edit", code: event.target.value })}
						onKeyDown={onEditorKeyDown}
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						wrap="off"
						rows={1}
						className="field-sizing-content min-h-32 max-h-80 w-full resize-none overflow-auto whitespace-pre bg-transparent px-2.5 py-2 font-mono text-sm leading-relaxed outline-none"
					/>
				</div>

				<div className="flex items-center gap-3 py-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						data-testid="code-run"
						disabled={!canRun(state)}
						onClick={() => void run()}
					>
						<PlayIcon />
						Run
					</Button>
					<RunStatus state={state} graded={graded} />
				</div>

				<RunOutput state={state} />
			</div>

			<form
				className="border-t border-border/60 p-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<div className="flex items-center justify-between gap-2 p-1">
					<span data-testid="code-submit-hint" className="pl-1.5 text-xs text-muted-foreground">
						{compactionRunning ? "compacting session…" : submitHint(state)}
					</span>
					<Button
						type="submit"
						data-testid="code-submit"
						disabled={!submittable}
						className="ml-auto h-9 rounded-[6px] px-3.5 text-sm font-medium"
					>
						Submit answer
					</Button>
				</div>
			</form>
		</div>
	);
}

/** Why Submit is closed, in the learner's terms (empty when it is open). */
function submitHint(state: ExerciseState): string {
	if (state.running) return "running…";
	if (state.lastRun === null) return "run your code to submit";
	if (!lastRunIsCurrent(state)) return "run your latest code to submit";
	return "";
}

/** The one-line verdict beside Run: checks, timeout, or staleness. */
function RunStatus({ state, graded }: { state: ExerciseState; graded: boolean }) {
	if (state.running) {
		return (
			<span className="flex items-center gap-2 text-sm text-muted-foreground">
				<BrailleSpinner className="h-4" label="Running" />
				Running…
			</span>
		);
	}
	const { lastRun } = state;
	if (lastRun === null) return null;
	if (!lastRunIsCurrent(state)) {
		return (
			<span data-testid="code-stale" className="text-sm text-muted-foreground">
				Edited since this run
			</span>
		);
	}
	if (lastRun.timedOut) return <span className="text-sm text-destructive">Timed out</span>;
	if (graded && lastRun.passed !== undefined) return <CheckVerdict passed={lastRun.passed} />;
	return null;
}

function CheckVerdict({ passed }: { passed: boolean }) {
	return (
		<span
			data-testid="code-verdict"
			className={cn("flex items-center gap-1.5 text-sm font-medium", passed ? "text-foreground" : "text-destructive")}
		>
			{passed ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
			{passed ? "Checks passed" : "Checks failed"}
		</span>
	);
}

/** stdout, the traceback, or the runtime-unavailable notice. A stale run's
 *  output stays visible, dimmed. */
function RunOutput({ state }: { state: ExerciseState }) {
	if (state.runtimeError !== null) {
		return (
			<div data-testid="code-runtime-error" role="alert" className="mb-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
				The Python runtime is unavailable: {state.runtimeError}
			</div>
		);
	}
	if (state.lastRun === null) {
		return state.running ? null : (
			<div className="mb-3 text-sm text-muted-foreground">Run your code to see its output here.</div>
		);
	}
	return (
		<div
			data-testid="code-output"
			aria-live="polite"
			className={cn("mb-3 flex flex-col gap-2", !lastRunIsCurrent(state) && "opacity-50")}
		>
			<OutputBlock result={state.lastRun} />
		</div>
	);
}

function OutputBlock({ result }: { result: CodeRunResult }) {
	const empty = result.stdout.length === 0 && result.error === undefined;
	return (
		<>
			{result.stdout.length > 0 && (
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-sm">
					{result.stdout}
				</pre>
			)}
			{result.error !== undefined && (
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-destructive/40 p-3 font-mono text-sm text-destructive">
					{result.error}
				</pre>
			)}
			{empty && <div className="text-sm text-muted-foreground">(no output)</div>}
		</>
	);
}
