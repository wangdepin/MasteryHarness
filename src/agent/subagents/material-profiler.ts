import * as fs from "node:fs/promises";
import { normalizeContext, type ImageContent, type TextContent, type Usage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { PDF_READING_DOCTRINE, runPdfReaderAgent } from "./pdf-reader.ts";
import { pdfInfo } from "./pdf-ops.ts";
import { normalizePhoto } from "../image-processing/normalize.ts";
import type { MaterialKind } from "../../core/materials.ts";

/**
 * The source-material profiler (fork addition, 2026-10-24): reads one
 * piece of lesson material ONCE and writes its PROFILE — the summary the
 * conversation agents keep in their system prompt for the whole lesson
 * (core/materials.ts). Per kind:
 *
 *   pdf    the pdf-reader loop (triage, search, extract, visual reading of
 *          math pages) with the profile as its deliverable
 *   text   one model call over the text (web pages arrive here as their
 *          extracted Markdown)
 *   image  one vision call: transcribe everything, then profile
 *
 * Runs on the pdfReader role (the vision slot): every kind may need eyes.
 */

const PROFILE_DELIVERABLE = `Your FINAL message is a SOURCE PROFILE of this material. A teacher keeps it in front of them for the whole lesson: it sets the lesson's target and keeps the teaching in line with the material. Markdown, these sections (leave one out only when the material has nothing for it):

## Scope and targets
What a learner who has mastered this material can do — concrete, checkable targets, each cited.
## Contents
The outline (chapters, sections), with page ranges for a PDF.
## Definitions and terminology
The key terms exactly as the material defines them (quote short definitions verbatim), cited.
## Notation and conventions
Symbols, sign and naming conventions, units, and the forms formulas are written in.
## Approach and order
How the material builds the topic: what it assumes, what comes first, how it argues or derives.
## Exercises
The kinds of problems it poses and what they test, if any.

Cite every claim: (p. N) for a PDF, the section heading otherwise. Keep the material's own language for its terms — never translate them. 400-1200 words, dense, no filler. If the material is not teaching material (a single figure, a photo of a board), describe what it shows and what it means for a lesson on it.`;

const PDF_PROFILE_INSTRUCTIONS = `${PDF_READING_DOCTRINE}

For this task the "question" is the whole document's profile. Strategy: read the table of contents, preface and introduction first (usually the opening pages), then each chapter's or section's opening, its definitions and its summary or exercises — enough to cite the targets, definitions and notation. Never read a long document front to back.

${PROFILE_DELIVERABLE}`;

const TEXT_PROFILE_INSTRUCTIONS = `You are a reading specialist inside a learning application. You receive one piece of the learner's source material and profile it for the teacher.

${PROFILE_DELIVERABLE}`;

const TRANSCRIPT_SPLIT = "=== PROFILE ===";

const IMAGE_PROFILE_INSTRUCTIONS = `You are a reading specialist inside a learning application. You receive one image of the learner's source material (a textbook page, slides, handwritten notes, a whiteboard).

First transcribe it completely: every word, formula (as LaTeX between $ signs), table and label, in reading order, and describe each figure in one or two sentences. Then write a line containing exactly ${TRANSCRIPT_SPLIT} and then the profile.

${PROFILE_DELIVERABLE}`;

/** Text past this many characters is cut (with a note) before profiling —
 *  roughly 40k tokens, far beyond notes or a syllabus. */
const TEXT_LIMIT = 160_000;

export interface MaterialProfileInput {
	kind: MaterialKind;
	name: string;
	/** The stored copy (pdf, image, text) — or the extracted Markdown (web). */
	path: string;
	mimeType?: string;
}

export interface MaterialProfile {
	profile: string;
	/** PDFs: the page count. */
	pages?: number;
	/** Images: the transcription (the lookup tools search it). */
	transcript?: string;
}

export interface MaterialProfilerOptions {
	engine: PiEngine;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onActivity?: (line: string) => void;
	chatId?: string;
}

/** One model call, no tools: the final text. */
async function completeOnce(
	opts: MaterialProfilerOptions,
	systemPrompt: string,
	content: (TextContent | ImageContent)[],
): Promise<string> {
	const { engine } = opts;
	const stream = engine.streamFn(
		engine.model,
		normalizeContext({ systemPrompt, messages: [{ role: "user", content, timestamp: Date.now() }] }),
		{
			reasoning: engine.level && engine.level !== "off" ? engine.level : undefined,
			signal: opts.abortSignal,
			sessionId: opts.chatId,
		} as never,
	);
	const message = await stream.result();
	if (message.usage) opts.onUsage?.(message.usage);
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		throw new Error(message.errorMessage ?? "the model call failed");
	}
	const text = message.content
		.filter((b): b is TextContent => b.type === "text")
		.map((b) => b.text)
		.join("\n")
		.trim();
	if (!text) throw new Error("the model returned no profile");
	return text;
}

/** The profile proper: from its first section heading on. A reader that
 *  was nudged to finish sometimes opens with remarks about its own
 *  reading ("The earlier brief did rest on reading…") — not material.
 *  Pure. */
export function profileBody(text: string): string {
	const at = text.search(/^## /m);
	return (at > 0 ? text.slice(at) : text).trim();
}

/** Split an image reply into its transcription and profile. Pure. */
export function splitImageReply(reply: string): { transcript: string; profile: string } {
	const at = reply.indexOf(TRANSCRIPT_SPLIT);
	if (at < 0) return { transcript: reply.trim(), profile: reply.trim() };
	return { transcript: reply.slice(0, at).trim(), profile: reply.slice(at + TRANSCRIPT_SPLIT.length).trim() };
}

/** Profile one material. Throws when it cannot be read at all. */
export async function profileMaterial(input: MaterialProfileInput, opts: MaterialProfilerOptions): Promise<MaterialProfile> {
	if (input.kind === "pdf") {
		const info = await pdfInfo(input.path);
		opts.onActivity?.(`reading ${input.name} (${info.page_count} pages)`);
		const result = await runPdfReaderAgent(
			{ path: input.path, question: `Build the source profile of "${input.name}" for the lesson.` },
			{
				engine: opts.engine,
				abortSignal: opts.abortSignal,
				onUsage: opts.onUsage,
				onActivity: opts.onActivity,
				instructions: PDF_PROFILE_INSTRUCTIONS,
				maxIterations: 20,
				chatId: opts.chatId,
			},
		);
		if (/^PDF failed:/.test(result.brief)) throw new Error(result.brief.replace(/^PDF failed:\s*/, ""));
		return { profile: profileBody(result.brief), pages: info.page_count };
	}
	if (input.kind === "image") {
		opts.onActivity?.(`reading ${input.name}`);
		const raw = await fs.readFile(input.path);
		// A phone photo is stored sideways with an EXIF tag a model never reads, and at full camera size: upright it and cap it
		// first (M17). Bytes that cannot be decoded are sent as they are, as before.
		const photo = await normalizePhoto(raw).catch(() => null);
		const data = (photo?.bytes ?? raw).toString("base64");
		const reply = await completeOnce(opts, IMAGE_PROFILE_INSTRUCTIONS, [
		{ type: "text", text: `The material: "${input.name}".` },
		{ type: "image", data, mimeType: photo?.mimeType ?? input.mimeType ?? "image/png" },
		]);
		const { transcript, profile } = splitImageReply(reply);
		return { transcript, profile: profileBody(profile) };
	}
	// text and web (its extracted Markdown)
	opts.onActivity?.(`reading ${input.name}`);
	let text = await fs.readFile(input.path, "utf8");
	if (!text.trim()) throw new Error("the material is empty");
	const cut = text.length > TEXT_LIMIT;
	if (cut) text = text.slice(0, TEXT_LIMIT);
	const profile = await completeOnce(opts, TEXT_PROFILE_INSTRUCTIONS, [
		{
			type: "text",
			text: `The material: "${input.name}"${cut ? ` (only its first ${TEXT_LIMIT} characters are shown)` : ""}.\n\n<material>\n${text}\n</material>`,
		},
	]);
	return { profile: profileBody(profile) };
}
