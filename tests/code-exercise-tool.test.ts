/**
 * The teacher's `code-exercises` tool: the authoring contract + the
 * per-session plan-nodeId validation (the quiz's seam), the registry
 * placement (always-on, teach side only) and the description's example.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { Value } from "typebox/value";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	codeExerciseExampleBody,
	createProberTools,
	createTeacherTools,
	teachCodeExerciseToolFor,
	type TeacherToolContext,
} from "../src/agent/tools.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { CODE_EXERCISE_TOOL } from "../src/core/code-exercise.ts";
import { jobStore } from "../src/store/jobs.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../config.ts";

fs.mkdirSync(path.join(PATHS.root, "data"), { recursive: true });

const createdChats: string[] = [];
after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* scratch cleanup, best effort */
		}
	}
});

function chatWithNode(title: string, nodeId: string): string {
	const chat = chatStore.createChat(title);
	createdChats.push(chat.id);
	chatStore.saveTree(chat.id, { nodes: [{ id: nodeId, title: "Node" }], edges: [], version: 1 });
	return chat.id;
}

type ToolDetails = { tool: string; problems: string[] };

async function call(chatId: string, input: unknown): Promise<AgentToolResult<ToolDetails> | "schema-rejected"> {
	const tool = teachCodeExerciseToolFor({ chatId, chatStore });
	if (!Value.Check(tool.parameters, input)) return "schema-rejected";
	return (await tool.execute("tc", input as never)) as AgentToolResult<ToolDetails>;
}

const valid = { ...codeExerciseExampleBody, nodeId: "list-comprehension" };

describe("teachCodeExerciseToolFor", () => {
	it("accepts the canonical example against a matching plan node", async () => {
		const result = await call(chatWithNode("Code: valid", "list-comprehension"), valid);
		assert.notEqual(result, "schema-rejected");
		assert.equal((result as AgentToolResult<ToolDetails>).isError, undefined);
	});

	it("is the placeholder question result: the call ends the turn", async () => {
		const result = (await call(chatWithNode("Code: placeholder", "list-comprehension"), valid)) as {
			terminate?: boolean;
		};
		assert.equal(result.terminate, true);
	});

	it("accepts a run-only exercise (no tests)", async () => {
		const { tests: _tests, ...runOnly } = valid;
		const result = await call(chatWithNode("Code: run-only", "list-comprehension"), runOnly);
		assert.notEqual(result, "schema-rejected");
		assert.equal((result as AgentToolResult<ToolDetails>).isError, undefined);
	});

	it("rejects a nodeId that matches no node, listing the slugs", async () => {
		const result = (await call(chatWithNode("Code: typo", "arith"), valid)) as AgentToolResult<ToolDetails>;
		assert.equal(result.isError, true);
		const problems = result.details.problems.join("\n");
		assert.match(problems, /matches no node/);
		assert.match(problems, /arith/);
	});

	it("rejects every nodeId while no plan exists", async () => {
		const chat = chatStore.createChat("Code: no tree");
		createdChats.push(chat.id);
		const result = (await call(chat.id, valid)) as AgentToolResult<ToolDetails>;
		assert.equal(result.isError, true);
		assert.match(result.details.problems.at(-1)!, /No plan map exists yet — call plan_init/);
	});

	it("rejects a blank question and blank tests with the authoring problems", async () => {
		const chatId = chatWithNode("Code: authoring", "list-comprehension");
		const blankQuestion = (await call(chatId, { ...valid, question: "  " })) as AgentToolResult<ToolDetails>;
		assert.match(blankQuestion.details.problems.join("\n"), /question is empty/);
		const blankTests = (await call(chatId, { ...valid, tests: " \n" })) as AgentToolResult<ToolDetails>;
		assert.match(blankTests.details.problems.join("\n"), /tests is blank/);
	});

	it("is rejected by the schema without nodeId, language or explanation", async () => {
		const chatId = chatWithNode("Code: required", "list-comprehension");
		for (const field of ["nodeId", "language", "explanation"] as const) {
			const { [field]: _dropped, ...rest } = valid;
			assert.equal(await call(chatId, rest), "schema-rejected", `${field} is required`);
		}
		assert.equal(await call(chatId, { ...valid, language: "ruby" }), "schema-rejected");
	});
});

describe("code-exercises placement", () => {
	const ctx = (chatId: string): TeacherToolContext => ({ chatId, chatStore, jobStore, spawn: () => {} });

	it("the teacher always has it — in both quizzing mechanics, and no toggle drops it", () => {
		const chatId = chatWithNode("Code: registry", "n");
		assert.ok(createTeacherTools(ctx(chatId))[CODE_EXERCISE_TOOL]);
		assert.ok(createTeacherTools(ctx(chatId), { explain: true })[CODE_EXERCISE_TOOL]);
		assert.ok(createTeacherTools(ctx(chatId), { research: false })[CODE_EXERCISE_TOOL]);
	});

	it("the prober never does (teach phase only)", () => {
		assert.equal(CODE_EXERCISE_TOOL in createProberTools({ chatId: "x", chatStore } as never), false);
	});

	it("the description ends with a call example that satisfies the schema", () => {
		const tool = teachCodeExerciseToolFor({ chatId: "x", chatStore });
		const json = /```json\n([\s\S]*?)\n```/.exec(tool.description)?.[1];
		assert.ok(json, "the description carries a json example");
		assert.deepEqual(JSON.parse(json), codeExerciseExampleBody);
		assert.equal(Value.Check(tool.parameters, codeExerciseExampleBody), true);
	});
});

describe("the teacher prompt teaches code-exercises", () => {
	const fragment = fs.readFileSync("src/agent/prompts/teacher/32-code-exercises.md", "utf-8").trim();

	it("composes into the teacher verbatim, and only the teacher", () => {
		assert.ok(composeInstructions("teacher").includes(fragment));
		assert.ok(!composeInstructions("prober").includes(fragment), "the prober never holds the tool");
		assert.ok(!composeInstructions("practice").includes(fragment));
	});

	it("names the tool and every field and result key it relies on", () => {
		for (const name of [CODE_EXERCISE_TOOL, "starterCode", "tests", "explanation", "question", "passed", "runs", "thinking", "timedOut"]) {
			assert.ok(fragment.includes(`\`${name}\``), `the fragment references \`${name}\``);
		}
	});

	it("stays small (always in context)", () => {
		assert.ok(fragment.length < 4_500, `${fragment.length} chars`);
	});
});
