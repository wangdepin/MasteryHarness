/**
 * Plan progress (owner, 2026-10-25): a plan node is LEARNED once one graded
 * check on it was passed — a quiz answered correctly, or a code exercise
 * whose tests passed. The session list shows done/total at a glance.
 *
 * Derived from the native record on every read, never stored (the tree
 * carries structure only). Deliberately separate from derivePlanStatusesLh:
 * that fold is position — calls only, results feed nothing — while this one
 * is the one place check RESULTS feed the plan.
 *
 * What does not count, by design: an `explain` (the model grades it in prose,
 * the record holds no verdict), a code exercise without tests (no pass
 * signal), an unanswered or dismissed check, an "I don't know", and a check
 * tagged with a node the current plan does not have. Once passed, a node
 * stays learned — a later miss does not take it back.
 */

import { CODE_EXERCISE_TOOL, isCodeExerciseAnswer } from "./code-exercise.ts";
import type { PlanProgress, PlanTree } from "./contracts/plan.ts";
import type { LhMessage } from "./native-messages.ts";
import type { QuestionAnswerData } from "./question-core.ts";

/** The tools whose result can carry a pass verdict. */
const GRADED_TOOLS: readonly string[] = ["quiz", CODE_EXERCISE_TOOL];

/** Did this answer pass its check? `details` is the full graded answer record. */
function passed(toolName: string, details: unknown): boolean {
	if (typeof details !== "object" || details === null) return false;
	if (isCodeExerciseAnswer(details)) {
		return toolName === CODE_EXERCISE_TOOL && details.graded && details.dismissed !== true && details.lastRun?.passed === true;
	}
	const answer = details as Partial<QuestionAnswerData>;
	return toolName === "quiz" && answer.kind === "quiz" && answer.dismissed !== true && answer.correct === true;
}

/** Fold a NATIVE record into the plan's progress. */
export function derivePlanProgressLh(tree: PlanTree, messages: readonly LhMessage[]): PlanProgress {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const nodeOfCall = new Map<string, string>();
	const learned = new Set<string>();
	for (const m of messages) {
		const role = (m as { role?: string }).role;
		if (role === "assistant") {
			const content = (m as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			for (const block of content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) {
				if (block.type !== "toolCall" || block.id === undefined || block.name === undefined) continue;
				if (!GRADED_TOOLS.includes(block.name)) continue;
				const nodeId = (block.arguments as { nodeId?: unknown } | undefined)?.nodeId;
				if (typeof nodeId === "string" && ids.has(nodeId)) nodeOfCall.set(block.id, nodeId);
			}
		} else if (role === "toolResult") {
			const result = m as { toolCallId?: string; toolName?: string; isError?: boolean; details?: unknown };
			const nodeId = result.toolCallId === undefined ? undefined : nodeOfCall.get(result.toolCallId);
			if (nodeId === undefined || result.isError === true || result.toolName === undefined) continue;
			if (passed(result.toolName, result.details)) learned.add(nodeId);
		}
	}
	return { done: learned.size, total: tree.nodes.length };
}
