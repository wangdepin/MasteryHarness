/**
 * SESSION PROGRESS PIN: the list summary carries the plan's progress, folded
 * from the stored tree + transcript on every list read (never stored). Runs
 * under an isolated LH_DATA_DIR — the seam is set before any config-loading
 * import, so the store import is dynamic.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { PlanTree } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-progress-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const tree: PlanTree = {
	nodes: [
		{ id: "a", title: "A" },
		{ id: "b", title: "B" },
	],
	edges: [{ from: "a", to: "b" }],
	version: 1,
};

const passedQuizOn = (nodeId: string): LhMessage[] =>
	[
		{ id: `m_${nodeId}`, role: "assistant", content: [{ type: "toolCall", id: `q_${nodeId}`, name: "quiz", arguments: { nodeId } }] },
		{ id: `r_${nodeId}`, role: "toolResult", toolCallId: `q_${nodeId}`, toolName: "quiz", details: { kind: "quiz", correct: true }, isError: false, content: [] },
	] as unknown as LhMessage[];

const progressOf = (id: string) => chatStore.listChats().find((c) => c.id === id)?.progress;

describe("session progress in the list summary", () => {
	it("is null while the session has no plan", () => {
		const chat = chatStore.createChat("no plan yet");
		assert.equal(progressOf(chat.id), null);
	});

	it("is 0 of the node count once a plan exists and nothing is passed", () => {
		const chat = chatStore.createChat("planned");
		chatStore.saveTree(chat.id, tree);
		assert.deepEqual(progressOf(chat.id), { done: 0, total: 2 });
	});

	it("advances as checks are passed", () => {
		const chat = chatStore.createChat("learning");
		chatStore.saveTree(chat.id, tree);
		chatStore.saveMessages(chat.id, passedQuizOn("a"));
		assert.deepEqual(progressOf(chat.id), { done: 1, total: 2 });
		chatStore.saveMessages(chat.id, [...passedQuizOn("a"), ...passedQuizOn("b")]);
		assert.deepEqual(progressOf(chat.id), { done: 2, total: 2 });
	});

	it("is null for a plan with no nodes", () => {
		const chat = chatStore.createChat("empty plan");
		chatStore.saveTree(chat.id, { nodes: [], edges: [], version: 1 });
		assert.equal(progressOf(chat.id), null);
	});

	it("is null for a practice session", () => {
		const chat = chatStore.createChat("practice", "practice");
		assert.equal(progressOf(chat.id), null);
	});
});
