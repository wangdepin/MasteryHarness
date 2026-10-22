"use client";

import { QuestionDockBar } from "@/components/question-dock";
import { CodeExerciseDock } from "@/components/code-exercise-dock";
import { codeRuntimeFor } from "@/components/code-runtime";
import { parseCodeExerciseInput, type CodeExerciseAnswerData } from "@/src/core";

/**
 * The code exercise's seat in the dock band — QuestionDock's twin for the
 * `code-exercises` tool: parses the model-authored input, shows the slim
 * bar while the band is folded (scroll-collapse), and keeps the exercise
 * mounted behind it so the learner's code and run survive a fold.
 */
export function CodeExerciseDockHost({
	input,
	expanded,
	onExpand,
	onSubmit,
	compactionRunning = false,
}: {
	input: unknown;
	expanded: boolean;
	onExpand: () => void;
	onSubmit: (answer: CodeExerciseAnswerData) => void;
	compactionRunning?: boolean;
}) {
	// Parse, don't cast (src/core/tool-parts.ts): the dock mounts on
	// validated input-available parts, so this is defense in depth.
	const exercise = parseCodeExerciseInput(input);
	if (!exercise) {
		return (
			<div data-testid="malformed-question" className="rounded-xl border border-dashed bg-card/60 p-3 text-sm text-muted-foreground">
				This exercise arrived malformed — the transcript keeps the retry.
			</div>
		);
	}
	return (
		<>
			{!expanded && <QuestionDockBar toolName="code-exercises" question={exercise.question} onExpand={onExpand} />}
			<div className={expanded ? "dock-variant" : "invisible h-0 overflow-hidden"}>
				<CodeExerciseDock
					input={exercise}
					runtime={codeRuntimeFor(exercise.language)}
					onSubmit={onSubmit}
					compactionRunning={compactionRunning}
				/>
			</div>
		</>
	);
}
