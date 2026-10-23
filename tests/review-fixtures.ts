/**
 * Native-shaped practice-record fixtures shared by the review tests: a
 * clean `problem` pose and a clean `conclude`, each a call + its ack.
 */

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL, type LhMessage } from "../src/core/native-messages.ts";

const STAMPS = {
	api: "faux",
	provider: "test",
	model: "test-model",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "toolUse",
} as const;

export function call(
	name: string,
	id: string,
	args: Record<string, unknown>,
	at: number,
	isError = false,
): LhMessage[] {
	const assistant: LhMessage & AssistantMessage = {
		id: `msg_a_${id}`,
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: args as never }],
		timestamp: at,
		...STAMPS,
	};
	const result: LhMessage & ToolResultMessage = {
		id: `msg_r_${id}`,
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		content: [{ type: "text", text: isError ? "rejected" : "ok" }],
		details: null,
		isError,
		timestamp: at + 1,
	};
	return [assistant, result];
}

export function pose(id: string, target: unknown, at: number, isError = false): LhMessage[] {
	const args: Record<string, unknown> = { statement: "s", mode: "recall", modelSolution: "m" };
	if (target !== undefined) args.target = target;
	return call(PRACTICE_PROBLEM_TOOL, id, args, at, isError);
}

export function conclude(id: string, args: Record<string, unknown>, at: number, isError = false): LhMessage[] {
	return call(PRACTICE_CONCLUDE_TOOL, id, { verdict: "v", retest: false, missClass: null, ...args }, at, isError);
}
