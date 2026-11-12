import * as fs from "node:fs/promises";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { capOutput, GREP_MAX_LINE_LENGTH, truncateGrepLine } from "./fs-shared.ts";
import { pdfExtract, pdfSearch } from "../subagents/pdf-ops.ts";
import type { LessonMaterial } from "../../core/materials.ts";
import type { MaterialStore } from "../../core/ports.ts";

/**
 * The source-material lookup tools (fork addition, 2026-10-24): exact
 * passages from the lesson's materials, so the teacher quotes the
 * material instead of paraphrasing its profile. Read fresh per call (a
 * material added mid-turn is searchable at once).
 *
 *   material_search  regex/literal search across the lesson's materials
 *                    (or one), hits with page (PDF) or line numbers
 *   material_read    a PDF's pages, or a text's line range
 *
 * Web pages are stored as their extracted Markdown; images are searched
 * and read through their transcription (content.md).
 */

export interface MaterialToolContext {
	chatId: string;
	store: MaterialStore;
}

const MAX_HITS = 40;

/** The text file a non-PDF material is searched in: the copy itself
 *  (text; a web page is stored as its extracted Markdown), or an image's
 *  transcription. */
function textPathOf(ctx: MaterialToolContext, m: LessonMaterial): string {
	return m.kind === "image" ? ctx.store.auxPath(ctx.chatId, m.id, "content.md") : ctx.store.filePath(ctx.chatId, m);
}

function pick(ctx: MaterialToolContext, ref: string | undefined): LessonMaterial[] | string {
	const all = ctx.store.list(ctx.chatId);
	if (all.length === 0) return "This lesson has no source material.";
	if (!ref) return all;
	const m = all.find((x) => x.id === ref || x.name === ref);
	return m ? [m] : `No material "${ref}" — the lesson's materials: ${all.map((x) => `${x.id} (${x.name})`).join(", ")}`;
}

const searchInput = Type.Object({
	query: Type.String({ minLength: 1, description: "What to find: a regex, or a literal string with literal: true" }),
	material: Type.Optional(Type.String({ description: "A material's id or name (default: every material of the lesson)" })),
	literal: Type.Optional(Type.Boolean({ description: "Treat query as a literal string (default: false)" })),
});

const readInput = Type.Object({
	material: Type.String({ description: "The material's id or name" }),
	pages: Type.Optional(Type.String({ description: 'PDF pages, e.g. "12" or "12-14,20"' })),
	lines: Type.Optional(Type.String({ description: 'Text line range, e.g. "1-80" (default: the start)' })),
});

/** Parse "a-b" (1-based, inclusive) against a line count. Pure. */
export function lineRange(spec: string | undefined, total: number): [number, number] {
	const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(spec ?? "");
	if (!m) return [1, Math.min(total, 200)];
	const start = Math.max(1, Number(m[1]));
	const end = Math.min(total, m[2] ? Number(m[2]) : start + 199);
	return [start, Math.max(start, end)];
}

export function materialTools(ctx: MaterialToolContext): Record<string, AgentTool<any>> {
	return {
		material_search: {
			name: "material_search",
			label: "material_search",
			description:
				"Search the lesson's source material for exact passages — definitions, theorems, notation, exercises. Returns hits with the material, and the page (PDF) or line number, plus surrounding lines. Case-insensitive.",
			parameters: searchInput,
			execute: serverExecute("material_search", searchInput, async ({ query, material, literal }) => {
				const chosen = pick(ctx, material);
				if (typeof chosen === "string") return chosen;
				let pattern: RegExp;
				try {
					pattern = new RegExp(literal ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query, "i");
				} catch (err) {
					return `Invalid regex: ${(err as Error).message}`;
				}
				const out: string[] = [];
				let hits = 0;
				for (const m of chosen) {
					if (hits >= MAX_HITS) break;
					try {
						if (m.kind === "pdf") {
							const result = await pdfSearch(ctx.store.filePath(ctx.chatId, m), query, { literal, contextLines: 2 });
							for (const hit of result.hits.slice(0, MAX_HITS - hits)) {
								out.push(`[${m.name}, p. ${hit.page}]\n${hit.context}`);
								hits++;
							}
						} else {
							const lines = (await fs.readFile(textPathOf(ctx, m), "utf8")).split(/\r?\n/);
							for (let i = 0; i < lines.length && hits < MAX_HITS; i++) {
								if (!pattern.test(lines[i]!)) continue;
								const from = Math.max(0, i - 2);
								const context = lines
									.slice(from, i + 3)
									.map((l, j) => `${from + j === i ? ">>>" : "   "} ${truncateGrepLine(l).text}`)
									.join("\n");
								out.push(`[${m.name}, line ${i + 1}]\n${context}`);
								hits++;
							}
						}
					} catch (err) {
						out.push(`[${m.name}] could not be searched: ${err instanceof Error ? err.message : String(err)}`);
					}
				}
				if (out.length === 0) return `No matches for "${query}" in ${chosen.map((m) => m.name).join(", ")}.`;
				const { content, truncated } = capOutput(out.join("\n\n").split("\n"));
				return truncated || hits >= MAX_HITS ? `${content}\n\n[more matches — narrow the query]` : content;
			}),
		},
		material_read: {
			name: "material_read",
			label: "material_read",
			description: `Read part of one source material verbatim: a PDF's pages (pages: "12-14"), or a text's lines (lines: "1-80"; images and web pages read as their transcribed / extracted text). Lines are truncated at ${GREP_MAX_LINE_LENGTH} characters.`,
			parameters: readInput,
			execute: serverExecute("material_read", readInput, async ({ material, pages, lines }) => {
				const chosen = pick(ctx, material);
				if (typeof chosen === "string") return chosen;
				const m = chosen[0]!;
				try {
					if (m.kind === "pdf") {
						const text = await pdfExtract(ctx.store.filePath(ctx.chatId, m), pages ?? "1");
						return capOutput(text.split("\n")).content;
					}
					const all = (await fs.readFile(textPathOf(ctx, m), "utf8")).split(/\r?\n/);
					const [start, end] = lineRange(lines, all.length);
					const body = all
						.slice(start - 1, end)
						.map((l, i) => `${start + i}: ${truncateGrepLine(l).text}`)
						.join("\n");
					const { content } = capOutput(body.split("\n"));
					return `[${m.name}, lines ${start}-${end} of ${all.length}]\n${content}`;
				} catch (err) {
					return `Could not read ${m.name}: ${err instanceof Error ? err.message : String(err)}`;
				}
			}),
		},
	};
}
