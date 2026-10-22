/**
 * answers — the learner's answer to ANY question tool: question-core's
 * quiz/ask/explain answers and a code exercise's. `kind` is the
 * discriminant; this is the one place that dispatches on it.
 */

import { compactCodeAnswerForModel, isCodeExerciseAnswer, type CodeExerciseAnswerData } from "./code-exercise.ts";
import { compactAnswerForModel, type QuestionAnswerData } from "./question-core.ts";

export type AnswerData = QuestionAnswerData | CodeExerciseAnswerData;

/** The MODEL-VISIBLE form of an answer — only what the learner added. */
export function compactAnswer(answer: AnswerData): Record<string, unknown> {
	return isCodeExerciseAnswer(answer) ? compactCodeAnswerForModel(answer) : compactAnswerForModel(answer);
}
