/**
 * Claude Code provider driven through the real chat handler: a learner-facing
 * question ends the turn while the CLI process waits on the held MCP call, and
 * the learner's answer arrives later as that call's tool result.
 *
 * The runClaude seam spawns tests/fixtures/claude-code/fake-claude.mjs, one
 * scenario per spawn, so the spawn count shows whether the answer continued
 * the waiting process or started a fresh one with a replay.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

import { PATHS } from "../config.ts";
import { LIVE_PROCESS_IDLE_TIMEOUT_MS, liveProcessIdleTimeoutMs } from "../src/agent/claude-code/live-processes.ts";
import { CLAUDE_CODE_MODELS } from "../src/agent/claude-code/provider.ts";
import { createClaudeCodeStreamFunction, type RunClaude } from "../src/agent/claude-code/stream.ts";
import type { PiEngine } from "../src/agent/models.ts";
import { createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { danglingQuestionOf } from "../src/core/native-messages.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { isTurnRunning } from "../src/server/turn-liveness.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import { chatStore } from "../src/store/chats.ts";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/claude-code/fake-claude.mjs", import.meta.url));
const TEXT_FIXTURE = fileURLToPath(new URL("./fixtures/claude-code/text.jsonl", import.meta.url));
const TURN_TIMEOUT_MS = 8000;

const ASK_ID = "toolu_harness_ask";
const ASK_INPUT = { question: "What do you already know about sockets?" };
const ANSWER_TEXT = "Only that they carry bytes between programs";

type FakeRun = { runClaude: RunClaude; children: ChildProcessWithoutNullStreams[]; stdinFiles: string[] };

function streamEvent(event: object): string {
	return JSON.stringify({ type: "stream_event", event });
}

function toAskScenario(): string[] {
	return [
		streamEvent({ type: "message_start", message: { usage: {} } }),
		streamEvent({
			type: "content_block_start",
			index: 0,
			content_block: { type: "tool_use", id: ASK_ID, name: "mcp__learnharness__ask_user_question", input: {} },
		}),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(ASK_INPUT) } }),
		streamEvent({ type: "content_block_stop", index: 0 }),
		streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} }),
		streamEvent({ type: "message_stop" }),
		JSON.stringify({ fake: "call", name: "ask_user_question", arguments: ASK_INPUT }),
		JSON.stringify({ fake: "reply" }),
	];
}

function createFakeRun(t: TestContext, scenarios: string[][]): FakeRun {
	const dir = mkdtempSync(join(tmpdir(), "claude-code-harness-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const children: ChildProcessWithoutNullStreams[] = [];
	const stdinFiles: string[] = [];

	const runClaude: RunClaude = (args, options) => {
		const scenario = scenarios[children.length];
		assert.ok(scenario, `unexpected spawn #${children.length + 1}`);

		const scenarioFile = join(dir, `scenario-${children.length}.jsonl`);
		const stdinFile = join(dir, `stdin-${children.length}.jsonl`);
		writeFileSync(scenarioFile, `${scenario.join("\n")}\n`);

		const child = spawn(process.execPath, [FAKE_CLAUDE, ...args], {
			cwd: options.cwd,
			env: { ...options.env, FAKE_CLAUDE_SCENARIO: scenarioFile, FAKE_CLAUDE_STDIN: stdinFile },
			stdio: "pipe",
		});
		t.after(() => child.kill());

		children.push(child);
		stdinFiles.push(stdinFile);
		return child;
	};

	return { runClaude, children, stdinFiles };
}

function createClaudeCodeChat(t: TestContext): string {
	const chat = chatStore.createChat("Claude Code: question answered later");
	chatStore.saveSettings(chat.id, { model: { provider: "claude-code", id: "sonnet" } });
	t.after(() => unlinkSync(join(PATHS.chats, `${chat.id}.json`)));

	return chat.id;
}

function createAgentFactory(fakeRun: FakeRun): Parameters<typeof handleChatRequest>[1] {
	const model = CLAUDE_CODE_MODELS.find((candidate) => candidate.id === "sonnet");
	assert.ok(model);

	const engine: PiEngine = { model, streamFn: createClaudeCodeStreamFunction(fakeRun.runClaude) };

	return (options) => createTeacherAgent(undefined, { engine, messages: options.messages });
}

async function runChatTurn(chatId: string, input: object, agentFactory: Parameters<typeof handleChatRequest>[1]): Promise<void> {
	const request = new Request("http://test/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chatId, input }),
	});

	const ack = await handleChatRequest(request, agentFactory);
	assert.equal(ack.status, 200, await ack.clone().text());

	const handle = runningTurn(chatId);
	if (handle) await new Response(handle.subscribe()).text();

	const deadline = Date.now() + TURN_TIMEOUT_MS;
	while (isTurnRunning(chatId)) {
		assert.ok(Date.now() < deadline, "turn did not settle");
		await sleep(10);
	}
}

function toAnswerInput(): object {
	return {
		type: "answer",
		toolCallId: ASK_ID,
		answer: { kind: "ask", questionText: ASK_INPUT.question, dontKnow: false, answers: [], text: ANSWER_TEXT, answeredAt: new Date().toISOString() },
	};
}

function getLastAssistantText(chatId: string): string {
	const messages = chatStore.getChat(chatId)?.messages ?? [];
	const assistant = messages.findLast((message) => message.role === "assistant");
	assert.ok(assistant?.role === "assistant");

	return assistant.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;

	await once(child, "exit", { signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });
}

test("a question answered before the idle timeout continues the waiting CLI process with the answer", async (t) => {
	const fakeRun = createFakeRun(t, [toAskScenario()]);
	const agentFactory = createAgentFactory(fakeRun);
	const chatId = createClaudeCodeChat(t);

	await runChatTurn(chatId, { type: "text", text: "teach me sockets" }, agentFactory);

	assert.equal(danglingQuestionOf(chatStore.getChat(chatId)?.messages ?? [])?.toolCallId, ASK_ID);
	const [waiting] = fakeRun.children;
	assert.ok(waiting);
	assert.equal(waiting.exitCode, null, "the CLI process should wait on the held question call");

	await runChatTurn(chatId, toAnswerInput(), agentFactory);

	assert.equal(fakeRun.children.length, 1);
	assert.ok(getLastAssistantText(chatId).includes(ANSWER_TEXT), getLastAssistantText(chatId));
	await waitForExit(waiting);
});

test("a question answered after the idle timeout starts a fresh CLI process that replays the question and answer", async (t) => {
	liveProcessIdleTimeoutMs.current = 300;
	t.after(() => (liveProcessIdleTimeoutMs.current = LIVE_PROCESS_IDLE_TIMEOUT_MS));

	const fakeRun = createFakeRun(t, [toAskScenario(), readFileSync(TEXT_FIXTURE, "utf8").split("\n").filter(Boolean)]);
	const agentFactory = createAgentFactory(fakeRun);
	const chatId = createClaudeCodeChat(t);

	await runChatTurn(chatId, { type: "text", text: "teach me sockets" }, agentFactory);

	const [waiting] = fakeRun.children;
	assert.ok(waiting);
	assert.equal(waiting.exitCode, null, "the CLI process should wait on the held question call");
	await waitForExit(waiting);

	await runChatTurn(chatId, toAnswerInput(), agentFactory);

	assert.equal(fakeRun.children.length, 2);
	assert.equal(getLastAssistantText(chatId), "hello there");

	const replay = readFileSync(fakeRun.stdinFiles[1] ?? "", "utf8");
	assert.ok(replay.includes("[tool call ask_user_question]"), replay);
	assert.ok(replay.includes(ASK_INPUT.question), replay);
	assert.ok(replay.includes("[tool result ask_user_question]"), replay);
	assert.ok(replay.includes(ANSWER_TEXT), replay);
});
