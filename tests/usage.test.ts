/**
 * Usage-accounting tests — the money channel's pure helpers (core/prices.ts)
 * and the ChatStore usage-log seam (appendTurnUsage).
 *
 * Pure helper tests are pure. The store test uses the real fs chatStore with
 * a fixture chat, cleaned up in after().
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";

import { chatStore } from "../src/store/chats.ts";
import { graphStore } from "../src/store/graph.ts";
import { PATHS, SOURCES_FILE } from "../config.ts";
import { callCost, contextWindow, jobCost, sessionCost, sumSteps, turnCost } from "../src/core/prices.ts";
import type { CallUsage, ExtractionRunUsage, JobRecord, TurnUsage } from "../src/core/contracts.ts";

const call = (over: Partial<CallUsage> = {}): CallUsage => ({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: undefined,
	cacheWriteTokens: undefined,
	reasoningTokens: undefined,
	...over,
});

test("sumSteps folds steps; absent stays absent until a value appears", () => {
	const sum = sumSteps([
		call({ inputTokens: 100, outputTokens: 20 }),
		call({ inputTokens: 50, outputTokens: 10, cacheReadTokens: 30 }),
	]);
	assert.equal(sum.inputTokens, 150);
	assert.equal(sum.outputTokens, 30);
	assert.equal(sum.cacheReadTokens, 30);
	assert.equal(sum.cacheWriteTokens, undefined); // never reported → stays undefined
	// all-absent → all-undefined (helper defaults input/output to 0, so
	// explicit undefined here)
	const empty = sumSteps([call({ inputTokens: undefined, outputTokens: undefined }), call({ inputTokens: undefined, outputTokens: undefined })]);
	assert.equal(empty.inputTokens, undefined);
});

test("callCost: glm-5.3-flash math — fresh input, cached read, output", () => {
	const cost = callCost(call({ inputTokens: 100_000, outputTokens: 20_000, cacheReadTokens: 10_000 }), "openrouter:z-ai/glm-5.3-flash");
	assert.ok(cost !== null);
	// fresh 90k @ $0.15/M + cached 10k @ $0.03/M + output 20k @ $0.5/M
	// (pi-ai catalog prices — regenerated tables, scripts/sync-pricing;
	// glm-5.3-flash cacheRead corrected 0.05 → 0.03 in pi 1.0.2)
	assert.ok(Math.abs(cost! - (0.0135 + 0.0003 + 0.01)) < 1e-9);
});

test("callCost: cache writes bill at the cacheWrite rate", () => {
	const cost = callCost(
		call({ inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 500_000 }),
		"anthropic:claude-haiku-4-5",
	);
	assert.ok(cost !== null);
	// Native 1.4 catalog: fresh 1M @ $1/M + cache write 500k @ $1.25/M.
	assert.ok(Math.abs(cost! - (1 + 0.625)) < 1e-9);
});

test("callCost: unknown model and absent fields are null, never zero", () => {
	assert.equal(callCost(call({ inputTokens: 100, outputTokens: 5 }), "not/a-model"), null);
	assert.equal(callCost(call({ inputTokens: 100, outputTokens: undefined }), "openrouter:z-ai/glm-5.3-flash"), null);
});

test("turnCost sums steps; sessionCost reports unpriced turns", () => {
	const turn: TurnUsage = {
		id: "t1",
		messageId: "m1",
		at: "2026-09-09T00:00:00Z",
		model: "openrouter:z-ai/glm-5.3-flash",
		steps: [call({ inputTokens: 10_000, outputTokens: 2_000 }), call({ inputTokens: 12_000, outputTokens: 1_000 })],
	};
	assert.ok(turnCost(turn) !== null);
	const totals = sessionCost({
		turns: [turn, { id: "t2", messageId: "m2", at: "x", model: "not/a-model", steps: [call({ inputTokens: 1, outputTokens: 1 })] }],
	});
	assert.equal(totals.unpriced, 1);
	assert.ok(totals.cost > 0);
});

test("contextWindow: last call's footprint against the live index's limit", () => {
	const limits = new Map([["openrouter:z-ai/glm-5.3-flash", 1_048_576]]);
	const cw = contextWindow(
		{
			turns: [
				{ id: "t1", messageId: "m1", at: "x", model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 9_000, outputTokens: 1_000 })] },
				{ id: "t2", messageId: "m2", at: "x", model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 90_000, outputTokens: 10_000 })] },
			],
		},
		limits,
	);
	assert.ok(cw);
	assert.equal(cw.model, "openrouter:z-ai/glm-5.3-flash");
	assert.equal(cw.usedTokens, 100_000);
	assert.equal(cw.limit, 1_048_576);
	assert.equal(contextWindow({ turns: [] }, limits), null);
});

test("contextWindow NUMERATOR: cache tokens count (owner audit, 2026-09-23)", () => {
	// The audit's live case: a cache-heavy session read 40k on the meter
	// while the real footprint was ~190k — provider `input` EXCLUDES the
	// cached portion, so input+output alone is wildly low. The fold is
	// pi's totalTokens semantics: all four fields.
	const limits = new Map([["openrouter:z-ai/glm-5.3-flash", 1_048_576]]);
	const cw = contextWindow(
		{
			turns: [
				{
					id: "t1",
					messageId: "m1",
					at: "x",
					model: "openrouter:z-ai/glm-5.3-flash",
					steps: [call({ inputTokens: 40_000, outputTokens: 1_000, cacheReadTokens: 145_000, cacheWriteTokens: 4_000 })],
				},
			],
		},
		limits,
	);
	assert.ok(cw);
	assert.equal(cw.usedTokens, 40_000 + 1_000 + 145_000 + 4_000, "input + output + cacheRead + cacheWrite");
	// Cache fields absent (non-caching providers): the fold is unchanged.
	const plain = contextWindow(
		{ turns: [{ id: "t1", messageId: "m1", at: "x", model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 9_000, outputTokens: 1_000 })] }] },
		limits,
	);
	assert.ok(plain);
	assert.equal(plain.usedTokens, 10_000);
});

test("contextWindow DENOMINATOR: the live index is the ONLY source — no fallback (owner amendment, 2026-09-23)", () => {
	const turns = [
		{ id: "t1", messageId: "m1", at: "x", model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 10_000, outputTokens: 1_000 })] },
	];
	const live = new Map([["openrouter:z-ai/glm-5.3-flash", 65_536]]);
	const cw = contextWindow({ turns }, live);
	assert.ok(cw);
	assert.equal(cw.limit, 65_536, "pi's catalog, via the index, is the one source");
	// No index at all (a client that hasn't fetched the catalog): the
	// meter renders usage-only — limit null, never a guessed window.
	const noIndex = contextWindow({ turns });
	assert.ok(noIndex);
	assert.equal(noIndex.usedTokens, 11_000);
	assert.equal(noIndex.limit, null);
	const emptyIndex = contextWindow({ turns }, new Map<string, number>());
	assert.ok(emptyIndex);
	assert.equal(emptyIndex.limit, null, "an empty index (failed fetch) is usage-only too");
	// A model missing from the live catalog (historical session, package
	// update removed it): usage-only, never a fake window.
	const missing = contextWindow({ turns: [{ ...turns[0]!, model: "nope/gone-model" }] }, live);
	assert.ok(missing);
	assert.equal(missing.limit, null);
	assert.equal(missing.usedTokens, 11_000, "the footprint still reads honestly");
});

test("contextWindow ride-along: a zeroed/aborted last step falls back to the previous step", () => {
	// An aborted last call reports zeroed usage — that is not the session
	// footprint. The honest reading is the previous step's usage.
	const limits = new Map([["openrouter:z-ai/glm-5.3-flash", 1_048_576]]);
	const cw = contextWindow(
		{
			turns: [
				{
					id: "t1",
					messageId: "m1",
					at: "x",
					model: "openrouter:z-ai/glm-5.3-flash",
					steps: [
						call({ inputTokens: 80_000, outputTokens: 5_000 }),
						call({ inputTokens: 0, outputTokens: 0 }), // aborted — zeroed
					],
				},
			],
		},
		limits,
	);
	assert.ok(cw);
	assert.equal(cw.usedTokens, 85_000, "the previous step's footprint, not a bogus tiny meter");
	// ALL steps zeroed (a first-call abort): no reading at all — null.
	assert.equal(
		contextWindow(
			{ turns: [{ id: "t1", messageId: "m1", at: "x", model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 0, outputTokens: 0 })] }] },
			limits,
		),
		null,
	);
});

test("jobCost: null without usage, computed with it", () => {
	assert.equal(jobCost({}), null);
	const job: Pick<JobRecord, "usage"> = {
		usage: {
			model: "openrouter:z-ai/glm-5.3-flash",
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			steps: 4,
		},
	};
	assert.ok(jobCost(job) !== null);
	assert.ok(jobCost(job)! > 0);
});

// ─── the store seam ──────────────────────────────────────────────────────────

test("appendTurnUsage: appends, idempotent per turn id, continuation turns (same message) all kept, survives saveMessages", () => {
	const record = chatStore.createChat("usage test chat");
	const entry: TurnUsage = {
		id: "turn_1",
		messageId: "msg_a",
		at: "2026-09-09T00:00:00Z",
		model: "openrouter:z-ai/glm-5.3-flash",
		steps: [call({ inputTokens: 100, outputTokens: 10 })],
	};
	chatStore.appendTurnUsage(record.id, entry);
	chatStore.appendTurnUsage(record.id, entry); // replay (abort/retry) → no-op
	// continuation turn: SAME response message (SDK coalesces), new turn id —
	// usage must survive, not collapse into the first entry
	chatStore.appendTurnUsage(record.id, { ...entry, id: "turn_2" });
	let reread = chatStore.getChat(record.id);
	assert.equal(reread?.turns?.length, 2);

	// saveMessages must not clobber the log (read-mutate-write record) —
	// Wave B: a NATIVE message list (the record holds agent history).
	chatStore.saveMessages(record.id, [
		{ id: "msg_a", role: "user", content: "native", timestamp: Date.now() } as never,
	]);
	reread = chatStore.getChat(record.id);
	assert.equal(reread?.turns?.length, 2);

	// and the list payload must NOT leak turns
	const listed = chatStore.listChats().find((c) => c.id === record.id);
	assert.ok(listed);
	assert.equal("turns" in listed, false);

	fs.unlinkSync(`${PATHS.chats}/${record.id}.json`);
});

test("appendExtractionUsage: appends, idempotent per startedAt, not in list payload", () => {
	const record = chatStore.createChat("extraction usage test chat");
	const runEntry = (startedAt: number): ExtractionRunUsage => ({
		startedAt,
		at: "2026-09-09T00:00:00Z",
		durationMs: 42_000,
		stats: { nodes: 1, chains: 2 },
		stages: {
			extractor: { model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 100, outputTokens: 10 })] },
			auditor: { model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 50, outputTokens: 5 })] },
		},
	});
	chatStore.appendExtractionUsage(record.id, runEntry(1));
	chatStore.appendExtractionUsage(record.id, runEntry(1)); // same run appended twice → no-op
	chatStore.appendExtractionUsage(record.id, runEntry(2)); // a retried run is a NEW spend
	let reread = chatStore.getChat(record.id);
	assert.equal(reread?.extractions?.length, 2);
	// failed runs (stats absent) persist with usage — money was spent
	chatStore.appendExtractionUsage(record.id, { ...runEntry(3), stats: undefined });
	reread = chatStore.getChat(record.id);
	assert.equal(reread?.extractions?.length, 3);
	assert.equal(reread?.extractions?.at(-1)?.stats, undefined);

	// the list payload must NOT leak the extractions log
	const listed = chatStore.listChats().find((c) => c.id === record.id);
	assert.ok(listed);
	assert.equal("extractions" in listed, false);

	fs.unlinkSync(`${PATHS.chats}/${record.id}.json`);
});

test("appendSourceUsage: appends to the source record, idempotent per startedAt, upsert keeps history", () => {
	// The real fs graphStore — sources.json backed up and restored around
	// this test (same discipline as the chat fixture files).
	fs.mkdirSync(PATHS.graph, { recursive: true });
	let bak: string | undefined;
	if (fs.existsSync(SOURCES_FILE)) bak = `${SOURCES_FILE}.w5test.bak`;
	if (bak) fs.renameSync(SOURCES_FILE, bak);
	try {
		const runEntry = (startedAt: number): ExtractionRunUsage => ({
			startedAt,
			at: "2026-09-13T00:00:00Z",
			durationMs: 42_000,
			stats: { nodes: 1, chains: 2 },
			stages: {
				extractor: { model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 100, outputTokens: 10 })] },
				auditor: { model: "openrouter:z-ai/glm-5.3-flash", steps: [call({ inputTokens: 50, outputTokens: 5 })] },
			},
		});
		const id = "src_usagetest01";
		graphStore.upsertSource({ id, filePath: "/vault/usagetest.md", importedAt: "2026-09-13T00:00:00Z" });
		graphStore.appendSourceUsage(id, runEntry(1));
		graphStore.appendSourceUsage(id, runEntry(1)); // same run appended twice → no-op
		graphStore.appendSourceUsage(id, runEntry(2)); // a retried run is a NEW spend
		assert.equal(graphStore.readSources().find((s) => s.id === id)?.extractions?.length, 2);

		// An upsert (re-import) KEEPS the usage history.
		graphStore.upsertSource({ id, filePath: "/vault/usagetest.md", importedAt: "2026-09-14T00:00:00Z" });
		assert.equal(graphStore.readSources().find((s) => s.id === id)?.extractions?.length, 2);

		// Unknown ids are a silent no-op (nothing to bill against).
		graphStore.appendSourceUsage("src_nope", runEntry(1));
	} finally {
		fs.rmSync(SOURCES_FILE, { force: true });
		if (bak) fs.renameSync(bak, SOURCES_FILE);
	}
});
