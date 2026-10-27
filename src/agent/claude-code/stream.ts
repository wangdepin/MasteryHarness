import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";

import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type StopReason,
	type StreamFunction,
	type ThinkingLevel,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
	type TranscriptContext,
	validateToolCall,
} from "@earendil-works/pi-ai";
import type { AnthropicEffort } from "@earendil-works/pi-ai/api/anthropic-messages";
import { parseStreamingJson, parseToolCallArguments } from "@earendil-works/pi-ai/utils/json-parse";

import { getClaudeBinary } from "./binary.ts";
import { parseCliLine, type CliBlock, type CliEvent, type CliUsage } from "./cli-events.ts";
import { ClaudeCodeError } from "./constants.ts";
import { addLiveProcess, getLiveProcess, removeLiveProcess, type LiveProcess } from "./live-processes.ts";
import { createToolBridge, toolNameFromMcp, type PendingToolCall, type ToolBridge } from "./tool-bridge.ts";
import { toClaudeInput, toStreamJsonLine } from "./transcript.ts";

type RunClaudeOptions = { cwd: string; env: NodeJS.ProcessEnv };

export type RunClaude = (args: string[], options: RunClaudeOptions) => ChildProcessWithoutNullStreams | null;

// A held MCP call lasts until pi calls back with the tool result, which for a question tool is
// whenever the learner answers; this must outlast the live-process idle timeout so the CLI never
// times out first.
const MCP_TOOL_TIMEOUT_MS = 30 * 60_000;

const PRIVATE_FILE_MODE = 0o600;

const EFFORTS: Record<ThinkingLevel, AnthropicEffort> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

const STOP_REASONS: Record<string, StopReason> = {
	end_turn: "stop",
	pause_turn: "stop",
	stop_sequence: "stop",
	max_tokens: "length",
	tool_use: "toolUse",
	refusal: "error",
};

const REFUSAL_MESSAGE = "The model refused to complete the request";
const ABORT_MESSAGE = "Request was aborted";
const START_FAILED_MESSAGE = "claude CLI failed to start";
const NO_STOP_REASON_MESSAGE = "claude CLI ended the message without a stop reason";
const NOT_SIGNED_IN_ERROR = "authentication_failed";

export function toEffort(level: ThinkingLevel | undefined): AnthropicEffort {
	return level ? EFFORTS[level] : "medium";
}

type ClaudeArgsInput = {
	model: string;
	effort: AnthropicEffort;
	systemPromptFile: string;
	mcpConfigFile: string;
	allowedTools: string[];
};

export function toClaudeArgs(input: ClaudeArgsInput): string[] {
	return [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--model",
		input.model,
		"--effort",
		input.effort,
		"--system-prompt-file",
		input.systemPromptFile,
		"--tools",
		"",
		"--strict-mcp-config",
		"--mcp-config",
		input.mcpConfigFile,
		"--setting-sources",
		"",
		"--disable-slash-commands",
		"--no-session-persistence",
		"--permission-prompts",
		"none",
		...(input.allowedTools.length > 0 ? ["--allowedTools", input.allowedTools.join(",")] : []),
	];
}

function createOutput(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

function getAssistantErrorMessage(error: string, text: string): string {
	return error === NOT_SIGNED_IN_ERROR ? ClaudeCodeError.NotSignedIn : text || error;
}

class ClaudeTurn {
	private readonly output: AssistantMessage;
	private readonly contentIndexes = new Map<number, number>();
	private readonly partialJson = new Map<number, string>();
	started = false;
	finished = false;

	constructor(
		private readonly stream: AssistantMessageEventStream,
		model: Model<Api>,
	) {
		this.output = createOutput(model);
	}

	handle(event: CliEvent): void {
		if (this.finished) return;

		switch (event.type) {
			case "messageStart":
				this.updateUsage(event.usage);
				this.start();
				return;

			case "blockStart":
				this.startBlock(event.index, event.block);
				return;

			case "textDelta": {
				const found = this.getBlock(event.index);
				if (!found) return;

				const { contentIndex, block } = found;
				if (block.type !== "text") return;

				block.text += event.text;
				this.stream.push({ type: "text_delta", contentIndex, delta: event.text, partial: this.output });
				return;
			}

			case "thinkingDelta": {
				const found = this.getBlock(event.index);
				if (!found) return;

				const { contentIndex, block } = found;
				if (block.type !== "thinking") return;

				block.thinking += event.thinking;
				this.stream.push({ type: "thinking_delta", contentIndex, delta: event.thinking, partial: this.output });
				return;
			}

			case "toolInputDelta": {
				const found = this.getBlock(event.index);
				if (!found) return;

				const { contentIndex, block } = found;
				if (block.type !== "toolCall") return;

				const partialJson = (this.partialJson.get(event.index) ?? "") + event.partialJson;
				this.partialJson.set(event.index, partialJson);
				block.arguments = parseStreamingJson(partialJson);
				this.stream.push({ type: "toolcall_delta", contentIndex, delta: event.partialJson, partial: this.output });
				return;
			}

			case "blockStop":
				this.stopBlock(event.index);
				return;

			case "messageDelta":
				this.updateUsage(event.usage);
				if (event.stopReason) this.setStopReason(event.stopReason);
				return;

			case "messageStop":
				this.finish();
				return;

			case "assistantError":
				this.fail(getAssistantErrorMessage(event.error, event.text), "error");
				return;

			case "resultError":
				this.fail(event.text, "error");
				return;
		}
	}

	getToolCalls(): ToolCall[] {
		if (!this.finished || this.output.stopReason !== "toolUse") return [];

		return this.output.content.filter((block) => block.type === "toolCall");
	}

	fail(message: string, reason: "aborted" | "error"): void {
		if (this.finished) return;

		this.finished = true;
		this.output.stopReason = reason;
		this.output.errorMessage = message;
		this.stream.push({ type: "error", reason, error: this.output });
		this.stream.end();
	}

	private start(): void {
		if (this.started) return;

		this.started = true;
		this.stream.push({ type: "start", partial: this.output });
	}

	private startBlock(index: number, block: CliBlock): void {
		const contentIndex = this.output.content.length;
		this.contentIndexes.set(index, contentIndex);

		switch (block.type) {
			case "text":
				this.output.content.push({ type: "text", text: "" });
				this.stream.push({ type: "text_start", contentIndex, partial: this.output });
				return;

			case "thinking":
				this.output.content.push({ type: "thinking", thinking: "" });
				this.stream.push({ type: "thinking_start", contentIndex, partial: this.output });
				return;

			case "toolUse":
				this.output.content.push({ type: "toolCall", id: block.id, name: toolNameFromMcp(block.name), arguments: {} });
				this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
				return;
		}
	}

	private getBlock(index: number): { contentIndex: number; block: AssistantMessage["content"][number] } | null {
		const contentIndex = this.contentIndexes.get(index);
		if (contentIndex === undefined) return null;

		const block = this.output.content[contentIndex];
		return block ? { contentIndex, block } : null;
	}

	private stopBlock(index: number): void {
		const found = this.getBlock(index);
		if (!found) return;

		const { contentIndex, block } = found;
		this.contentIndexes.delete(index);

		switch (block.type) {
			case "text":
				this.stream.push({ type: "text_end", contentIndex, content: block.text, partial: this.output });
				return;

			case "thinking":
				this.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: this.output });
				return;

			case "toolCall":
				Object.assign(block, parseToolCallArguments(this.partialJson.get(index) ?? ""));
				this.partialJson.delete(index);
				this.stream.push({ type: "toolcall_end", contentIndex, toolCall: block satisfies ToolCall, partial: this.output });
				return;
		}
	}

	private updateUsage(usage: CliUsage): void {
		Object.assign(this.output.usage, usage);

		const { input, output, cacheRead, cacheWrite } = this.output.usage;
		this.output.usage.totalTokens = input + output + cacheRead + cacheWrite;
	}

	private setStopReason(stopReason: string): void {
		const mapped = STOP_REASONS[stopReason];

		if (!mapped) {
			this.output.stopReason = "error";
			this.output.errorMessage = `Unhandled stop reason: ${stopReason}`;
			return;
		}

		this.output.stopReason = mapped;
	}

	private finish(): void {
		const { stopReason } = this.output;

		if (stopReason === "error") {
			this.fail(this.output.errorMessage ?? REFUSAL_MESSAGE, "error");
			return;
		}

		if (stopReason === "pending" || stopReason === "aborted") {
			this.fail(this.output.errorMessage ?? NO_STOP_REASON_MESSAGE, "error");
			return;
		}

		this.finished = true;
		this.stream.push({ type: "done", reason: stopReason, message: this.output });
		this.stream.end();
	}
}

type TurnFiles = { cwd: string; privateDir: string; systemPromptFile: string; mcpConfigFile: string };

async function createTurnFiles(systemPrompt: string, mcpConfig: string): Promise<TurnFiles> {
	const cwd = await mkdtemp(join(tmpdir(), "claude-code-cwd-"));
	const privateDir = await mkdtemp(join(tmpdir(), "claude-code-private-"));

	const systemPromptFile = join(privateDir, "system-prompt.md");
	const mcpConfigFile = join(privateDir, "mcp.json");

	await writeFile(systemPromptFile, systemPrompt, { mode: PRIVATE_FILE_MODE });
	await writeFile(mcpConfigFile, mcpConfig, { mode: PRIVATE_FILE_MODE });

	return { cwd, privateDir, systemPromptFile, mcpConfigFile };
}

async function removeTurnResources(bridge: ToolBridge, files: TurnFiles): Promise<void> {
	await bridge.close();
	await rm(files.cwd, { recursive: true, force: true });
	await rm(files.privateDir, { recursive: true, force: true });
}

type UnansweredToolCall = { toolCall: ToolCall; result: ToolResultMessage };

// The CLI answers calls to undeclared tools or with invalid arguments itself, without reaching the bridge.
function isValidToolCall(tools: Tool[], toolCall: ToolCall): boolean {
	try {
		validateToolCall(tools, toolCall);
		return true;
	} catch {
		return false;
	}
}

function isSameToolCall(toolCall: ToolCall, call: PendingToolCall): boolean {
	return toolCall.name === call.name && isDeepStrictEqual(toolCall.arguments, call.arguments);
}

class ClaudeProcess implements LiveProcess {
	toolCallIds: string[] = [];
	private stderr = "";
	private closed = false;
	private signal: AbortSignal | undefined;

	constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly bridge: ToolBridge,
		private readonly files: TurnFiles,
		private readonly tools: Tool[],
		private turn: ClaudeTurn,
	) {}

	start(stdinLine: string, signal: AbortSignal | undefined): void {
		this.child.once("close", (code: number | null) => this.handleClose(`claude CLI exited with code ${code}`));
		this.child.once("error", (error) => {
			console.error("claude CLI process failed:", error);
			this.turn.fail(START_FAILED_MESSAGE, "error");
			this.handleClose(START_FAILED_MESSAGE);
		});

		this.child.stderr.setEncoding("utf8");
		this.child.stderr.on("data", (chunk: string) => (this.stderr += chunk));

		this.child.stdin.on("error", (error) => console.error("claude CLI stdin closed early:", error));
		this.child.stdin.end(`${stdinLine}\n`);

		createInterface({ input: this.child.stdout }).on("line", (line) => this.handleLine(line));

		this.setSignal(signal);
	}

	continueTurn(turn: ClaudeTurn, toolResults: ToolResultMessage[], signal: AbortSignal | undefined): void {
		removeLiveProcess(this);

		const unanswered = this.turn.getToolCalls().flatMap((toolCall) => {
			const result = toolResults.find((toolResult) => toolResult.toolCallId === toolCall.id);
			return result ? [{ toolCall, result }] : [];
		});

		this.turn = turn;
		this.setSignal(signal);

		this.answerToolCalls(turn, unanswered).catch((error: unknown) => {
			console.error("claude CLI tool results failed:", error);
			turn.fail(START_FAILED_MESSAGE, "error");
			this.kill();
		});
	}

	kill(): void {
		removeLiveProcess(this);
		this.child.kill();
	}

	private readonly abort = () => {
		this.turn.fail(ABORT_MESSAGE, "aborted");
		this.kill();
	};

	private setSignal(signal: AbortSignal | undefined): void {
		this.signal?.removeEventListener("abort", this.abort);
		this.signal = signal;
		signal?.addEventListener("abort", this.abort, { once: true });

		if (signal?.aborted) this.abort();
	}

	private handleLine(line: string): void {
		const event = parseCliLine(line);
		if (!event) return;

		// Output after a finished message means the CLI moved on without waiting for our tool results.
		if (this.turn.finished) {
			this.kill();
			return;
		}

		this.turn.handle(event);
		if (!this.turn.finished) return;

		const toolCalls = this.turn.getToolCalls();
		this.toolCallIds = toolCalls.map((toolCall) => toolCall.id);

		const reachesBridge = toolCalls.length > 0 && toolCalls.every((toolCall) => isValidToolCall(this.tools, toolCall));
		if (!reachesBridge) {
			this.kill();
			return;
		}

		addLiveProcess(this);
	}

	private async answerToolCalls(turn: ClaudeTurn, unanswered: UnansweredToolCall[]): Promise<void> {
		while (unanswered.length > 0 && !turn.started) {
			const pending = this.bridge.getPendingToolCalls();
			let answered = false;

			for (const call of pending) {
				const index = unanswered.findIndex(({ toolCall }) => isSameToolCall(toolCall, call));
				const match = unanswered[index];
				if (!match) continue;

				this.bridge.resolveToolCall(call, match.result);
				unanswered.splice(index, 1);
				answered = true;
			}

			if (answered) continue;

			// Rejects only once the bridge has closed, which means the process is already gone.
			const next = await this.bridge.waitForToolCalls(pending.length + 1).catch(() => null);
			if (!next) return;
		}
	}

	private handleClose(message: string): void {
		if (this.closed) return;

		this.closed = true;
		removeLiveProcess(this);
		this.signal?.removeEventListener("abort", this.abort);

		if (this.stderr.trim()) console.error("claude CLI stderr:", this.stderr.trim());

		this.turn.fail(message, "error");

		removeTurnResources(this.bridge, this.files).catch((error: unknown) => {
			console.error("claude CLI cleanup failed:", error);
		});
	}
}

function continueLiveProcess(turn: ClaudeTurn, messages: Message[], signal: AbortSignal | undefined): boolean {
	const assistantIndex = messages.findLastIndex((message) => message.role === "assistant");
	const assistant = messages[assistantIndex];
	if (assistant?.role !== "assistant") return false;

	const toolCallIds = assistant.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []));
	const process = getLiveProcess(toolCallIds);
	if (!(process instanceof ClaudeProcess)) return false;

	const trailing = messages.slice(assistantIndex + 1);
	const toolResults = trailing.filter((message) => message.role === "toolResult");

	const onlyToolResults = toolResults.length === trailing.length;
	const answersEveryCall = toolCallIds.every((id) => toolResults.some((toolResult) => toolResult.toolCallId === id));

	if (!onlyToolResults || !answersEveryCall) {
		process.kill();
		return false;
	}

	process.continueTurn(turn, toolResults, signal);
	return true;
}

// Either one takes precedence over the logged-in subscription, so a key saved on the Keys page
// would bill turns to the API account.
const API_CREDENTIAL_ENV_NAMES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

function toClaudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const claudeEnv: NodeJS.ProcessEnv = { ...env, MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) };

	for (const name of API_CREDENTIAL_ENV_NAMES) delete claudeEnv[name];

	return claudeEnv;
}

async function startProcess(
	runClaude: RunClaude,
	turn: ClaudeTurn,
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
): Promise<void> {
	const input = toClaudeInput(context.messages);
	const bridge = await createToolBridge(input.tools);
	const files = await createTurnFiles(input.systemPrompt, bridge.mcpConfig);

	let child: ChildProcessWithoutNullStreams | null;
	try {
		const args = toClaudeArgs({
			model: model.id,
			effort: toEffort(options?.reasoning),
			systemPromptFile: files.systemPromptFile,
			mcpConfigFile: files.mcpConfigFile,
			allowedTools: bridge.allowedTools,
		});
		child = runClaude(args, { cwd: files.cwd, env: toClaudeEnv(process.env) });
	} catch (error) {
		await removeTurnResources(bridge, files);
		throw error;
	}

	if (!child) {
		turn.fail(ClaudeCodeError.CliNotFound, "error");
		await removeTurnResources(bridge, files);
		return;
	}

	new ClaudeProcess(child, bridge, files, input.tools, turn).start(toStreamJsonLine(input.userContent), options?.signal);
}

export function createClaudeCodeStreamFunction(runClaude: RunClaude): StreamFunction<Api, SimpleStreamOptions> {
	return (model, context, options) => {
		const stream = createAssistantMessageEventStream();
		const turn = new ClaudeTurn(stream, model);

		if (continueLiveProcess(turn, context.messages, options?.signal)) return stream;

		startProcess(runClaude, turn, model, context, options).catch((error: unknown) => {
			console.error("claude CLI turn failed:", error);
			turn.fail(START_FAILED_MESSAGE, "error");
		});

		return stream;
	};
}

function spawnClaude(args: string[], options: RunClaudeOptions): ChildProcessWithoutNullStreams | null {
	const binary = getClaudeBinary();

	return binary ? spawn(binary, args, { ...options, stdio: "pipe" }) : null;
}

export const streamClaudeCode = createClaudeCodeStreamFunction(spawnClaude);
