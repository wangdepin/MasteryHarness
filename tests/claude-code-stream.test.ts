/**
 * Claude Code stream function (src/agent/claude-code/stream.ts) and CLI line
 * parser (src/agent/claude-code/cli-events.ts).
 *
 * The runClaude seam spawns tests/fixtures/claude-code/fake-claude.mjs, which
 * replays recorded or synthetic stream-json lines, so the real process
 * plumbing (argv, stdin, stdout lines, stderr, exit, kill) runs end to end.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

import type {
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	JsonObject,
	Message,
	SimpleStreamOptions,
	StreamFunction,
	Api,
	Tool,
	ToolResultMessage,
} from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";

import { parseCliLine } from "../src/agent/claude-code/cli-events.ts";
import { ClaudeCodeError } from "../src/agent/claude-code/constants.ts";
import { LIVE_PROCESS_IDLE_TIMEOUT_MS, liveProcessIdleTimeoutMs } from "../src/agent/claude-code/live-processes.ts";
import { CLAUDE_CODE_MODELS } from "../src/agent/claude-code/provider.ts";
import { createClaudeCodeStreamFunction, toClaudeArgs, toEffort, type RunClaude } from "../src/agent/claude-code/stream.ts";
import { toStreamJsonLine } from "../src/agent/claude-code/transcript.ts";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/claude-code/fake-claude.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/claude-code/", import.meta.url));
const HOLD = JSON.stringify({ fake: "hold" });
const REPLY = JSON.stringify({ fake: "reply" });
const CLEANUP_TIMEOUT_MS = 2000;

const READ_TOOL: Tool = { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } };
const HI: Message = { role: "user", content: "hi", timestamp: 0 };

type ToolUse = { id: string; name: string; arguments: JsonObject };

type RunCall = {
	args: string[];
	cwd: string;
	cwdEntries: string[];
	env: NodeJS.ProcessEnv;
	systemPrompt: string;
	mcpConfig: string;
	mcpConfigMode: number;
	child: ChildProcessWithoutNullStreams;
};

type ScenarioRun = { events: AssistantMessageEvent[]; calls: RunCall[] };

function readFixtureLines(name: string): string[] {
	return readFileSync(join(FIXTURES, name), "utf8").split("\n").filter(Boolean);
}

function getFlagValue(args: string[], flag: string): string {
	const value = args[args.indexOf(flag) + 1];
	assert.ok(args.includes(flag) && value !== undefined, `missing ${flag}`);

	return value;
}

function streamEvent(event: object): string {
	return JSON.stringify({ type: "stream_event", event });
}

function exitWith(code: number, stderr: string): string {
	return JSON.stringify({ fake: "exit", code, stderr });
}

function getToolScenario(): string[] {
	const lines = readFixtureLines("tool.jsonl");
	const firstMessageStop = lines.findIndex((line) => line.includes('"type":"message_stop"'));
	return [...lines.slice(0, firstMessageStop + 1).filter((line) => !line.startsWith('{"type":"user"')), HOLD];
}

function createFakeRun(
	t: TestContext,
	scenario: string[],
	extraEnv: Record<string, string> = {},
): { runClaude: RunClaude; calls: RunCall[] } {
	const dir = mkdtempSync(join(tmpdir(), "claude-code-test-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const scenarioFile = join(dir, "scenario.jsonl");
	writeFileSync(scenarioFile, `${scenario.join("\n")}\n`);

	const calls: RunCall[] = [];

	const runClaude: RunClaude = (args, options) => {
		const mcpConfigFile = getFlagValue(args, "--mcp-config");
		const child = spawn(process.execPath, [FAKE_CLAUDE, ...args], {
			cwd: options.cwd,
			env: { ...options.env, FAKE_CLAUDE_SCENARIO: scenarioFile, ...extraEnv },
			stdio: "pipe",
		});
		t.after(() => child.kill());
		calls.push({
			args,
			cwd: options.cwd,
			cwdEntries: readdirSync(options.cwd),
			env: options.env,
			systemPrompt: readFileSync(getFlagValue(args, "--system-prompt-file"), "utf8"),
			mcpConfig: readFileSync(mcpConfigFile, "utf8"),
			mcpConfigMode: statSync(mcpConfigFile).mode & 0o777,
			child,
		});
		return child;
	};

	return { runClaude, calls };
}

async function collectEvents(
	stream: AssistantMessageEventStream,
	onEvent: (event: AssistantMessageEvent) => void = () => {},
): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];

	for await (const event of stream) {
		events.push(event);
		onEvent(event);
	}

	return events;
}

async function runScenario(
	t: TestContext,
	scenario: string[],
	options?: SimpleStreamOptions,
	extraEnv?: Record<string, string>,
): Promise<ScenarioRun> {
	const { runClaude, calls } = createFakeRun(t, scenario, extraEnv);

	const model = CLAUDE_CODE_MODELS[0];
	assert.ok(model);

	const context = normalizeContext({
		systemPrompt: "You are a tutor.",
		messages: [{ role: "user", content: "hi", timestamp: 0 }],
		tools: [READ_TOOL],
	});
	const events = await collectEvents(createClaudeCodeStreamFunction(runClaude)(model, context, options));

	return { events, calls };
}

function toToolUseMessage(toolUses: ToolUse[]): string[] {
	return [
		streamEvent({ type: "message_start", message: { usage: {} } }),
		...toolUses.flatMap((toolUse, index) => [
			streamEvent({
				type: "content_block_start",
				index,
				content_block: { type: "tool_use", id: toolUse.id, name: `mcp__learnharness__${toolUse.name}`, input: {} },
			}),
			streamEvent({
				type: "content_block_delta",
				index,
				delta: { type: "input_json_delta", partial_json: JSON.stringify(toolUse.arguments) },
			}),
			streamEvent({ type: "content_block_stop", index }),
		]),
		streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} }),
		streamEvent({ type: "message_stop" }),
	];
}

function callTool(toolUse: ToolUse): string {
	return JSON.stringify({ fake: "call", name: toolUse.name, arguments: toolUse.arguments });
}

function toToolResult(toolUse: ToolUse, text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: toolUse.id,
		toolName: toolUse.name,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: 0,
	};
}

function getModel() {
	const model = CLAUDE_CODE_MODELS[0];
	assert.ok(model);
	return model;
}

async function runTurn(
	streamFunction: StreamFunction<Api, SimpleStreamOptions>,
	messages: Message[],
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const context = normalizeContext({ systemPrompt: "You are a tutor.", messages, tools: [READ_TOOL] });

	const done = getLastEvent(await collectEvents(streamFunction(getModel(), context, options)));

	assert.ok(done.type === "done", `turn ended with ${done.type}`);

	return done.message;
}

function getText(message: AssistantMessage): string {
	return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

function getMcpUrl(call: RunCall): string {
	const mcpConfig = JSON.parse(call.mcpConfig) as { mcpServers: Record<string, { url: string }> };
	const url = mcpConfig.mcpServers.learnharness?.url;
	assert.ok(url);
	return url;
}

function getOnlyCall(calls: RunCall[]): RunCall {
	assert.equal(calls.length, 1);
	const [call] = calls;
	assert.ok(call);
	return call;
}

function getLastEvent(events: AssistantMessageEvent[]): AssistantMessageEvent {
	const event = events.at(-1);
	assert.ok(event);
	return event;
}

function getErrorMessage(events: AssistantMessageEvent[]): string | undefined {
	const event = getLastEvent(events);
	assert.equal(event.type, "error");
	return event.type === "error" ? event.error.errorMessage : undefined;
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;

	await assert.doesNotReject(once(child, "exit", { signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS) }), "claude CLI process was not killed");
}

async function waitForRemoval(path: string): Promise<void> {
	const deadline = Date.now() + CLEANUP_TIMEOUT_MS;

	while (existsSync(path)) {
		assert.ok(Date.now() < deadline, `${path} was not removed`);
		await sleep(10);
	}
}

async function assertCleanedUp(call: RunCall): Promise<void> {
	await waitForExit(call.child);
	await waitForRemoval(call.cwd);
	await waitForRemoval(dirname(getFlagValue(call.args, "--system-prompt-file")));
}

test("toClaudeArgs includes every isolation flag from Global Constraints", () => {
	const input = {
		model: "opus",
		effort: "high",
		systemPromptFile: "/private/system-prompt.md",
		mcpConfigFile: "/private/mcp.json",
		allowedTools: ["mcp__learnharness__read", "mcp__learnharness__write"],
	} as const;

	assert.deepEqual(toClaudeArgs({ ...input, allowedTools: [...input.allowedTools] }), [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--model",
		"opus",
		"--effort",
		"high",
		"--system-prompt-file",
		"/private/system-prompt.md",
		"--tools",
		"",
		"--strict-mcp-config",
		"--mcp-config",
		"/private/mcp.json",
		"--setting-sources",
		"",
		"--disable-slash-commands",
		"--no-session-persistence",
		"--permission-prompts",
		"none",
		"--allowedTools",
		"mcp__learnharness__read,mcp__learnharness__write",
	]);

	assert.equal(toClaudeArgs({ ...input, allowedTools: [] }).includes("--allowedTools"), false);
});

test('toEffort maps low..max verbatim, minimal to "low", undefined to "medium"', () => {
	assert.deepEqual(
		(["low", "medium", "high", "xhigh", "max"] as const).map((level) => toEffort(level)),
		["low", "medium", "high", "xhigh", "max"],
	);

	assert.equal(toEffort("minimal"), "low");
	assert.equal(toEffort(undefined), "medium");
});

test("text scenario streams start, text_start, text_delta…, text_end, done(stop)", async (t) => {
	const { events, calls } = await runScenario(t, readFixtureLines("text.jsonl"));

	assert.deepEqual(
		events.map((event) => event.type),
		["start", "text_start", "text_delta", "text_end", "done"],
	);

	const done = getLastEvent(events);
	assert.ok(done.type === "done");
	assert.equal(done.reason, "stop");
	assert.equal(done.message.stopReason, "stop");
	assert.deepEqual(done.message.content, [{ type: "text", text: "hello there" }]);
	assert.equal(done.message.provider, "claude-code");
	assert.equal(done.message.api, "claude-code-cli");
	assert.equal(done.message.model, "opus");

	await assertCleanedUp(getOnlyCall(calls));
});

test("thinking deltas map to thinking_*", async (t) => {
	const { events } = await runScenario(t, [
		streamEvent({ type: "message_start", message: { usage: { input_tokens: 3, output_tokens: 1 } } }),
		streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Sockets are " } }),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "endpoints." } }),
		streamEvent({ type: "content_block_stop", index: 0 }),
		streamEvent({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
		streamEvent({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "An endpoint." } }),
		streamEvent({ type: "content_block_stop", index: 1 }),
		streamEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } }),
		streamEvent({ type: "message_stop" }),
	]);

	assert.deepEqual(
		events.map((event) => event.type),
		["start", "thinking_start", "thinking_delta", "thinking_delta", "thinking_end", "text_start", "text_delta", "text_end", "done"],
	);

	const done = getLastEvent(events);
	assert.ok(done.type === "done");
	assert.deepEqual(done.message.content, [
		{ type: "thinking", thinking: "Sockets are endpoints." },
		{ type: "text", text: "An endpoint." },
	]);
});

test("tool scenario ends with toolcall_end (Claude's tool_use id, unprefixed name) and done(toolUse)", async (t) => {
	const { events } = await runScenario(t, getToolScenario());

	assert.deepEqual(
		events.map((event) => event.type),
		["start", "toolcall_start", "toolcall_delta", "toolcall_delta", "toolcall_delta", "toolcall_end", "done"],
	);

	const toolCallEnd = events.find((event) => event.type === "toolcall_end");
	assert.ok(toolCallEnd?.type === "toolcall_end");
	assert.deepEqual(toolCallEnd.toolCall, {
		type: "toolCall",
		id: "toolu_01JBB4cJsPa585FWb1XrfbNX",
		name: "get_weather",
		arguments: { city: "Paris" },
	});

	const done = getLastEvent(events);
	assert.ok(done.type === "done");
	assert.equal(done.reason, "toolUse");
	assert.deepEqual(done.message.content, [toolCallEnd.toolCall]);
});

test("unknown tool name and bad JSON args still surface as tool calls", async (t) => {
	const { events } = await runScenario(t, [
		streamEvent({ type: "message_start", message: { usage: {} } }),
		streamEvent({
			type: "content_block_start",
			index: 0,
			content_block: { type: "tool_use", id: "toolu_a", name: "mcp__learnharness__nope", input: {} },
		}),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path": ' } }),
		streamEvent({ type: "content_block_stop", index: 0 }),
		streamEvent({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_b", name: "Bash", input: {} } }),
		streamEvent({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } }),
		streamEvent({ type: "content_block_stop", index: 1 }),
		streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} }),
		streamEvent({ type: "message_stop" }),
		HOLD,
	]);

	const toolCalls = events.flatMap((event) => (event.type === "toolcall_end" ? [event.toolCall] : []));
	assert.deepEqual(
		toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
		[
			{ id: "toolu_a", name: "nope", arguments: {} },
			{ id: "toolu_b", name: "Bash", arguments: { command: "ls" } },
		],
	);

	assert.match(toolCalls[0]?.argumentsError ?? "", /\{"path": /);
	assert.equal(toolCalls[1]?.argumentsError, undefined);

	const done = getLastEvent(events);
	assert.ok(done.type === "done");
	assert.equal(done.reason, "toolUse");
});

test("usage maps input/output/cacheRead/cacheWrite with zero cost, message_delta overriding message_start", async (t) => {
	const { events } = await runScenario(t, getToolScenario());
	const done = getLastEvent(events);
	assert.ok(done.type === "done");
	assert.deepEqual(done.message.usage, {
		input: 2,
		output: 59,
		cacheRead: 0,
		cacheWrite: 1102,
		totalTokens: 1163,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
});

test('missing binary → error "claude CLI not found"', async () => {
	const model = CLAUDE_CODE_MODELS[0];
	assert.ok(model);

	let cwd = "";
	const runClaude: RunClaude = (_args, options) => {
		cwd = options.cwd;
		return null;
	};

	const context = normalizeContext({ systemPrompt: "p", messages: [{ role: "user", content: "hi", timestamp: 0 }] });
	const events = await collectEvents(createClaudeCodeStreamFunction(runClaude)(model, context));

	assert.deepEqual(
		events.map((event) => event.type),
		["error"],
	);

	assert.equal(getErrorMessage(events), ClaudeCodeError.CliNotFound);
	await waitForRemoval(cwd);
});

test('signed-out fixture → error "not signed in"', async (t) => {
	const { events, calls } = await runScenario(t, [...readFixtureLines("signed-out.jsonl"), exitWith(1, "")]);
	assert.equal(getErrorMessage(events), ClaudeCodeError.NotSignedIn);
	await assertCleanedUp(getOnlyCall(calls));
});

test("other assistant errors surface their text", async (t) => {
	const assistantError = JSON.stringify({
		type: "assistant",
		error: "rate_limit",
		message: { content: [{ type: "text", text: "API Error: Rate limit reached" }] },
	});
	const { events } = await runScenario(t, [assistantError, exitWith(1, "")]);
	assert.equal(getErrorMessage(events), "API Error: Rate limit reached");
});

test("result error before message_stop surfaces the result text", async (t) => {
	const resultError = JSON.stringify({
		type: "result",
		subtype: "error_during_execution",
		is_error: true,
		result: "Credit balance is too low",
	});
	const { events } = await runScenario(t, [resultError, HOLD]);
	assert.equal(getErrorMessage(events), "Credit balance is too low");
});

test("result error without result text surfaces its errors", async (t) => {
	const resultError = JSON.stringify({
		type: "result",
		subtype: "error_max_turns",
		is_error: true,
		errors: ["Reached maximum number of turns"],
	});
	const { events } = await runScenario(t, [resultError, HOLD]);
	assert.equal(getErrorMessage(events), "Reached maximum number of turns");
});

test("result error without result text or errors surfaces its subtype", async (t) => {
	const resultError = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true });
	const { events } = await runScenario(t, [resultError, HOLD]);
	assert.equal(getErrorMessage(events), "claude CLI failed: error_during_execution");
});

test("refusal stop reason → error", async (t) => {
	const { events } = await runScenario(t, [
		streamEvent({ type: "message_start", message: { usage: {} } }),
		streamEvent({ type: "message_delta", delta: { stop_reason: "refusal" }, usage: {} }),
		streamEvent({ type: "message_stop" }),
	]);
	assert.equal(getErrorMessage(events), "The model refused to complete the request");
});

test("non-zero exit mid-stream → error naming the exit code, stderr logged not shown, process and temp dirs gone", async (t) => {
	const consoleError = t.mock.method(console, "error", () => {});
	const midStream = readFixtureLines("text.jsonl").slice(0, 5);
	const { events, calls } = await runScenario(t, [...midStream, exitWith(1, "Error: ENOENT /home/someone/.claude/x\n    at main\n")]);

	assert.deepEqual(
		events.map((event) => event.type),
		["start", "text_start", "text_delta", "error"],
	);

	assert.equal(getErrorMessage(events), "claude CLI exited with code 1");
	assert.ok(
		consoleError.mock.calls.some((call) => call.arguments.some((argument) => String(argument).includes("ENOENT /home/someone/.claude/x"))),
	);

	const error = getLastEvent(events);
	assert.ok(error.type === "error");
	assert.equal(error.reason, "error");
	assert.deepEqual(error.error.content, [{ type: "text", text: "hello there" }]);

	await assertCleanedUp(getOnlyCall(calls));
});

test("exit without stderr names the exit code", async (t) => {
	const { events } = await runScenario(t, [exitWith(3, "")]);
	assert.equal(getErrorMessage(events), "claude CLI exited with code 3");
});

test("abort kills the process and ends with error(aborted)", async (t) => {
	const { runClaude, calls } = createFakeRun(t, [streamEvent({ type: "message_start", message: { usage: {} } }), HOLD]);
	const model = CLAUDE_CODE_MODELS[0];
	assert.ok(model);
	const controller = new AbortController();
	const context = normalizeContext({ systemPrompt: "p", messages: [{ role: "user", content: "hi", timestamp: 0 }] });
	const stream = createClaudeCodeStreamFunction(runClaude)(model, context, { signal: controller.signal });

	const events = await collectEvents(stream, (event) => {
		if (event.type === "start") controller.abort();
	});

	assert.deepEqual(
		events.map((event) => event.type),
		["start", "error"],
	);

	const error = getLastEvent(events);
	assert.ok(error.type === "error");
	assert.equal(error.reason, "aborted");

	await assertCleanedUp(getOnlyCall(calls));
});

test("cwd is an empty temp dir; prompt and mcp config live in a separate private dir", async (t) => {
	const { calls } = await runScenario(t, readFixtureLines("text.jsonl"));
	const call = getOnlyCall(calls);

	assert.deepEqual(call.cwdEntries, []);
	assert.ok(call.cwd.startsWith(tmpdir()));

	const privateDir = dirname(getFlagValue(call.args, "--system-prompt-file"));
	assert.notEqual(privateDir, call.cwd);
	assert.ok(!privateDir.startsWith(call.cwd + sep));
	assert.equal(dirname(getFlagValue(call.args, "--mcp-config")), privateDir);
	assert.equal(call.systemPrompt, "You are a tutor.");
	assert.equal(call.mcpConfigMode, 0o600);

	const mcpConfig = JSON.parse(call.mcpConfig) as { mcpServers: Record<string, { url: string }> };
	assert.match(mcpConfig.mcpServers.learnharness?.url ?? "", /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
});

test("spawns with the model alias, effort, bridge tools, MCP_TOOL_TIMEOUT and the caller's HOME", async (t) => {
	const { calls } = await runScenario(t, readFixtureLines("text.jsonl"), { reasoning: "xhigh" });
	const call = getOnlyCall(calls);
	assert.equal(getFlagValue(call.args, "--model"), "opus");
	assert.equal(getFlagValue(call.args, "--effort"), "xhigh");
	assert.equal(getFlagValue(call.args, "--allowedTools"), "mcp__learnharness__read");
	assert.equal(call.env.MCP_TOOL_TIMEOUT, "1800000");
	assert.equal(call.env.HOME, process.env.HOME);
	assert.equal(call.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_CONFIG_DIR);
});

test("spawns without Anthropic API credentials so turns stay on the subscription", async (t) => {
	const saved = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN };
	t.after(() => {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	});

	process.env.ANTHROPIC_API_KEY = "sk-ant-test";
	process.env.ANTHROPIC_AUTH_TOKEN = "token-test";

	const { calls } = await runScenario(t, readFixtureLines("text.jsonl"));
	const call = getOnlyCall(calls);

	assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
	assert.equal(call.env.ANTHROPIC_AUTH_TOKEN, undefined);
});

test("writes the transcript as one stream-json user line on stdin", async (t) => {
	const stdinFile = join(mkdtempSync(join(tmpdir(), "claude-code-stdin-")), "stdin.jsonl");
	t.after(() => rmSync(dirname(stdinFile), { recursive: true, force: true }));

	await runScenario(t, readFixtureLines("text.jsonl"), undefined, { FAKE_CLAUDE_STDIN: stdinFile });

	assert.equal(readFileSync(stdinFile, "utf8"), `${toStreamJsonLine([{ type: "text", text: "hi" }])}\n`);
});

test("parseCliLine ignores non-JSON, system, rate-limit and successful result lines", () => {
	assert.equal(parseCliLine("not json"), null);
	assert.equal(parseCliLine("null"), null);
	assert.equal(parseCliLine('{"type":"system","subtype":"init"}'), null);
	assert.equal(parseCliLine('{"type":"rate_limit_event"}'), null);
	assert.equal(parseCliLine('{"type":"result","is_error":false,"result":"hello there"}'), null);
	assert.equal(parseCliLine('{"type":"assistant","error":null,"message":{"content":[{"type":"text","text":"hello there"}]}}'), null);
});

test("trailing toolResults matching a live process continue it: held calls answered, new assistant message streamed, no new spawn", async (t) => {
	const readA: ToolUse = { id: "toolu_continue_a", name: "read", arguments: { path: "a" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA]), callTool(readA), REPLY]);
	const streamFunction = createClaudeCodeStreamFunction(runClaude);
	const toolMessage = await runTurn(streamFunction, [HI]);

	const reply = await runTurn(streamFunction, [HI, toolMessage, toToolResult(readA, "contents of a")]);

	assert.equal(toolMessage.stopReason, "toolUse");
	assert.equal(getText(reply), "contents of a");
	await assertCleanedUp(getOnlyCall(calls));
});

test("multiple tool calls in one message are all answered by id", async (t) => {
	const readA: ToolUse = { id: "toolu_many_a", name: "read", arguments: { path: "a" } };
	const readB: ToolUse = { id: "toolu_many_b", name: "read", arguments: { path: "b" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA, readB]), callTool(readB), callTool(readA), REPLY]);
	const streamFunction = createClaudeCodeStreamFunction(runClaude);
	const toolMessage = await runTurn(streamFunction, [HI]);

	const reply = await runTurn(streamFunction, [HI, toolMessage, toToolResult(readA, "A"), toToolResult(readB, "B")]);

	assert.equal(getText(reply), "B | A");
	assert.equal(calls.length, 1);
});

test("partial id match starts fresh and kills the old process", async (t) => {
	const readA: ToolUse = { id: "toolu_partial_a", name: "read", arguments: { path: "a" } };
	const readB: ToolUse = { id: "toolu_partial_b", name: "read", arguments: { path: "b" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA, readB]), callTool(readA), callTool(readB), REPLY]);
	const streamFunction = createClaudeCodeStreamFunction(runClaude);
	const toolMessage = await runTurn(streamFunction, [HI]);

	await runTurn(streamFunction, [HI, toolMessage, toToolResult(readA, "A")]);

	assert.equal(calls.length, 2);
	const [oldCall] = calls;
	assert.ok(oldCall);
	await assertCleanedUp(oldCall);
});

test("user message after tool results starts fresh with unfinished calls in the replay", async (t) => {
	const stdinFile = join(mkdtempSync(join(tmpdir(), "claude-code-stdin-")), "stdin.jsonl");
	t.after(() => rmSync(dirname(stdinFile), { recursive: true, force: true }));

	const readA: ToolUse = { id: "toolu_steer_a", name: "read", arguments: { path: "a" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA]), callTool(readA), REPLY], { FAKE_CLAUDE_STDIN: stdinFile });
	const streamFunction = createClaudeCodeStreamFunction(runClaude);
	const toolMessage = await runTurn(streamFunction, [HI]);
	const steer: Message = { role: "user", content: "wait, explain sockets first", timestamp: 0 };

	await runTurn(streamFunction, [HI, toolMessage, toToolResult(readA, "A"), steer]);

	assert.equal(calls.length, 2);

	const [oldCall] = calls;
	assert.ok(oldCall);
	await assertCleanedUp(oldCall);

	const stdin = readFileSync(stdinFile, "utf8");
	assert.ok(stdin.includes('[tool call read] {\\"path\\":\\"a\\"}'), stdin);
	assert.ok(stdin.includes("wait, explain sockets first"), stdin);
});

test("output while waiting for tool results kills the process", async (t) => {
	const readA: ToolUse = { id: "toolu_moved_on_a", name: "read", arguments: { path: "a" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA]), REPLY, HOLD]);

	await runTurn(createClaudeCodeStreamFunction(runClaude), [HI]);

	await assertCleanedUp(getOnlyCall(calls));
});

test("an undeclared tool call is not kept waiting, since the CLI answers it itself", async (t) => {
	const readA: ToolUse = { id: "toolu_undeclared_a", name: "read", arguments: { path: "a" } };
	const nope: ToolUse = { id: "toolu_undeclared_nope", name: "nope", arguments: {} };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA, nope]), HOLD]);

	const toolMessage = await runTurn(createClaudeCodeStreamFunction(runClaude), [HI]);

	assert.equal(toolMessage.stopReason, "toolUse");
	await assertCleanedUp(getOnlyCall(calls));
});

test("a tool call with invalid JSON arguments is not kept waiting, since the CLI answers it itself", async (t) => {
	const { runClaude, calls } = createFakeRun(t, [
		streamEvent({ type: "message_start", message: { usage: {} } }),
		streamEvent({
			type: "content_block_start",
			index: 0,
			content_block: { type: "tool_use", id: "toolu_bad_json", name: "mcp__learnharness__read", input: {} },
		}),
		streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path": ' } }),
		streamEvent({ type: "content_block_stop", index: 0 }),
		streamEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} }),
		streamEvent({ type: "message_stop" }),
		HOLD,
	]);

	const toolMessage = await runTurn(createClaudeCodeStreamFunction(runClaude), [HI]);

	assert.equal(toolMessage.stopReason, "toolUse");
	await assertCleanedUp(getOnlyCall(calls));
});

test("abort while waiting kills the process and closes the bridge", async (t) => {
	const readA: ToolUse = { id: "toolu_abort_a", name: "read", arguments: { path: "a" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA]), callTool(readA), REPLY]);
	const controller = new AbortController();

	await runTurn(createClaudeCodeStreamFunction(runClaude), [HI], { signal: controller.signal });

	controller.abort();

	const call = getOnlyCall(calls);
	await assertCleanedUp(call);
	await assert.rejects(fetch(getMcpUrl(call)));
});

test("idle timeout kills an orphaned waiting process", async (t) => {
	liveProcessIdleTimeoutMs.current = 50;
	t.after(() => (liveProcessIdleTimeoutMs.current = LIVE_PROCESS_IDLE_TIMEOUT_MS));

	const readA: ToolUse = { id: "toolu_idle_a", name: "read", arguments: { path: "a" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA]), callTool(readA), REPLY]);

	await runTurn(createClaudeCodeStreamFunction(runClaude), [HI]);

	await assertCleanedUp(getOnlyCall(calls));
});

test("a tool result arriving after the idle timeout starts fresh with the call and its result in the replay", async (t) => {
	liveProcessIdleTimeoutMs.current = 300;
	t.after(() => (liveProcessIdleTimeoutMs.current = LIVE_PROCESS_IDLE_TIMEOUT_MS));

	const stdinFile = join(mkdtempSync(join(tmpdir(), "claude-code-stdin-")), "stdin.jsonl");
	t.after(() => rmSync(dirname(stdinFile), { recursive: true, force: true }));

	const readA: ToolUse = { id: "toolu_late_a", name: "read", arguments: { path: "a" } };
	const waiting = createFakeRun(t, [...toToolUseMessage([readA]), callTool(readA), REPLY]);
	const fresh = createFakeRun(t, readFixtureLines("text.jsonl"), { FAKE_CLAUDE_STDIN: stdinFile });
	const runClaude: RunClaude = (args, options) => (waiting.calls.length === 0 ? waiting : fresh).runClaude(args, options);
	const streamFunction = createClaudeCodeStreamFunction(runClaude);
	const toolMessage = await runTurn(streamFunction, [HI]);

	const waitingCall = getOnlyCall(waiting.calls);
	assert.equal(waitingCall.child.exitCode, null, "the process should wait for the tool result until the idle timeout");
	await assertCleanedUp(waitingCall);

	const reply = await runTurn(streamFunction, [HI, toolMessage, toToolResult(readA, "contents of a")]);

	assert.equal(getText(reply), "hello there");
	await assertCleanedUp(getOnlyCall(fresh.calls));

	const stdin = readFileSync(stdinFile, "utf8");
	assert.ok(stdin.includes('[tool call read] {\\"path\\":\\"a\\"}'), stdin);
	assert.ok(stdin.includes("[tool result read]"), stdin);
	assert.ok(stdin.includes("contents of a"), stdin);
});

test("a tool result arriving late but before the idle timeout still continues the waiting process", async (t) => {
	liveProcessIdleTimeoutMs.current = 1000;
	t.after(() => (liveProcessIdleTimeoutMs.current = LIVE_PROCESS_IDLE_TIMEOUT_MS));

	const readA: ToolUse = { id: "toolu_slow_a", name: "read", arguments: { path: "a" } };
	const { runClaude, calls } = createFakeRun(t, [...toToolUseMessage([readA]), callTool(readA), REPLY]);
	const streamFunction = createClaudeCodeStreamFunction(runClaude);
	const toolMessage = await runTurn(streamFunction, [HI]);

	await sleep(500);

	const reply = await runTurn(streamFunction, [HI, toolMessage, toToolResult(readA, "contents of a")]);

	assert.equal(getText(reply), "contents of a");
	await assertCleanedUp(getOnlyCall(calls));
});

test("two concurrent streams keep separate processes and results never cross", async (t) => {
	const readOne: ToolUse = { id: "toolu_concurrent_one", name: "read", arguments: { path: "one" } };
	const readTwo: ToolUse = { id: "toolu_concurrent_two", name: "read", arguments: { path: "two" } };
	const one = createFakeRun(t, [...toToolUseMessage([readOne]), callTool(readOne), REPLY]);
	const two = createFakeRun(t, [...toToolUseMessage([readTwo]), callTool(readTwo), REPLY]);

	const streamOne = createClaudeCodeStreamFunction(one.runClaude);
	const streamTwo = createClaudeCodeStreamFunction(two.runClaude);
	const [toolMessageOne, toolMessageTwo] = await Promise.all([runTurn(streamOne, [HI]), runTurn(streamTwo, [HI])]);

	const [replyOne, replyTwo] = await Promise.all([
		runTurn(streamOne, [HI, toolMessageOne, toToolResult(readOne, "from one")]),
		runTurn(streamTwo, [HI, toolMessageTwo, toToolResult(readTwo, "from two")]),
	]);

	assert.equal(getText(replyOne), "from one");
	assert.equal(getText(replyTwo), "from two");
	assert.equal(one.calls.length, 1);
	assert.equal(two.calls.length, 1);
});
