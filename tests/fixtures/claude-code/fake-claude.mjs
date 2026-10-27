/**
 * Stand-in for the claude CLI in tests. Reads the stream-json input from
 * stdin, then replays the scenario file named by FAKE_CLAUDE_SCENARIO line by
 * line. Lines with a "fake" key are directives instead of output:
 *   {"fake":"hold"}                          stay alive until killed, like the CLI waiting on a held MCP call
 *   {"fake":"exit","code":1,"stderr":"..."}  write stderr and exit with that code
 *   {"fake":"call","name":"read","arguments":{...}}  call that tool on the MCP bridge and wait for its result
 *   {"fake":"reply"}                         stream one assistant message whose text is every result so far, joined by " | "
 * FAKE_CLAUDE_STDIN, when set, receives the stdin it read.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const HOLD_INTERVAL_MS = 60_000;
const BRIDGE_SERVER_NAME = "learnharness";

function writeLine(line) {
	return new Promise((resolve) => process.stdout.write(`${line}\n`, resolve));
}

function streamEvent(event) {
	return JSON.stringify({ type: "stream_event", event });
}

async function connectBridge(mcpConfig) {
	const { url, headers } = JSON.parse(mcpConfig).mcpServers[BRIDGE_SERVER_NAME];
	const client = new Client({ name: "fake-claude", version: "1.0.0" });

	await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
	return client;
}

async function writeReply(text) {
	await writeLine(streamEvent({ type: "message_start", message: { usage: {} } }));
	await writeLine(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
	await writeLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
	await writeLine(streamEvent({ type: "content_block_stop", index: 0 }));
	await writeLine(streamEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }));
	await writeLine(streamEvent({ type: "message_stop" }));
}

const mcpConfig = readFileSync(process.argv[process.argv.indexOf("--mcp-config") + 1], "utf8");

let input = "";
for await (const chunk of process.stdin) input += chunk;
if (process.env.FAKE_CLAUDE_STDIN) writeFileSync(process.env.FAKE_CLAUDE_STDIN, input);

let bridge = null;
const results = [];
const lines = readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
	const directive = JSON.parse(line);

	if (directive.fake === "hold") {
		setInterval(() => {}, HOLD_INTERVAL_MS);
		break;
	}

	if (directive.fake === "exit") {
		process.stderr.write(directive.stderr ?? "");
		process.exit(directive.code);
	}

	if (directive.fake === "call") {
		bridge ??= await connectBridge(mcpConfig);
		const result = await bridge.callTool({ name: directive.name, arguments: directive.arguments });
		results.push(result.content.map((block) => block.text).join(""));
		continue;

	}
	if (directive.fake === "reply") {
		await writeReply(results.join(" | "));
		continue;
	}

	await writeLine(line);
}
