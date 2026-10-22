"use client";

import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { restoreLiteralNewlines, type CodeExerciseAnswerData } from "@/src/core";

/**
 * Static record of a submitted code exercise (tool part in `output-available`):
 * the question, the code he submitted, what the last run did, and the
 * explanation tucked behind "Why" — the standing answered-card ruling
 * (components/answered-card.tsx). Graded exercises show the checks verdict;
 * run-only ones show the output without a verdict.
 */
export function CodeExerciseAnsweredCard({ answer }: { answer: CodeExerciseAnswerData }) {
	const [whyOpen, setWhyOpen] = useState(false);
	if (answer.dismissed) {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				<span className="font-medium">{answer.questionText}</span> — skipped
			</div>
		);
	}
	const { lastRun } = answer;
	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="code-answered-card">
			<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Code · Python
				{answer.graded && <Verdict passed={lastRun?.passed === true} timedOut={lastRun?.timedOut === true} />}
			</div>
			<div className="mb-3 font-medium">
				<MessageResponse>{restoreLiteralNewlines(answer.questionText)}</MessageResponse>
			</div>
			<pre
				data-testid="code-answered-code"
				className="max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-sm"
			>
				{answer.code}
			</pre>
			{lastRun?.stdout && (
				<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-sm">
					{lastRun.stdout}
				</pre>
			)}
			{lastRun?.error && (
				<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-destructive/40 p-3 font-mono text-sm text-destructive">
					{lastRun.error}
				</pre>
			)}
			{answer.explanation && (
				<div className="mt-2" data-testid="tucked-explanation">
					<button
						type="button"
						onClick={() => setWhyOpen((v) => !v)}
						className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						{whyOpen ? "Hide why" : "Why"}
					</button>
					{whyOpen && (
						<div className="mt-1.5 rounded-lg bg-muted py-2 text-sm text-foreground/50">
							<span className="font-medium text-muted-foreground">Why: </span>
							<MessageResponse className="inline [&_p]:inline [&_p]:m-0">
								{restoreLiteralNewlines(answer.explanation)}
							</MessageResponse>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function Verdict({ passed, timedOut }: { passed: boolean; timedOut: boolean }) {
	return (
		<span
			data-testid="code-answered-verdict"
			className={cn("flex items-center gap-1 normal-case", passed ? "text-foreground" : "text-destructive")}
		>
			{passed ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
			{passed ? "Checks passed" : timedOut ? "Timed out" : "Checks failed"}
		</span>
	);
}
