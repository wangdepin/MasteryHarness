/**
 * Sentence reader pure layer (owner, 2026-10-21): turns the teacher's
 * Markdown into reveal steps (one sentence each), derives the plain text to
 * speak for a step, and parses the learner's reader preferences. No DOM.
 */
import { DEFAULT_TTS_VOICE, TTS_RATE_MAX, TTS_RATE_MIN, TTS_VOICES } from "./tts.ts";

export interface ReaderUnit {
	/** Markdown of this step, rendered on its own. */
	markdown: string;
	/** Sentences of one paragraph flow inline; every other step is a block. */
	inline: boolean;
	/** True for the first step of a paragraph/block (starts a new line). */
	startsBlock: boolean;
}

const FENCE = /^\s*(```|~~~)/;
const BLOCK_MARKER = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|\|)/;

/** Replace spans a sentence break must never land in (math, code) with
 *  placeholders; returns the masked text and a restore function. */
function maskSpans(text: string): { masked: string; restore: (s: string) => string } {
	const spans: string[] = [];
	const masked = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|`[^`\n]+`/g, (m) => {
		spans.push(m);
		return `${spans.length - 1}`;
	});
	return { masked, restore: (s) => s.replace(/(\d+)/g, (_, i) => spans[Number(i)] ?? "") };
}

function segmentSentences(paragraph: string): string[] {
	const { masked, restore } = maskSpans(paragraph);
	const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
	const out: string[] = [];
	for (const { segment } of segmenter.segment(masked)) {
		const s = restore(segment).trim();
		if (s !== "") out.push(s);
	}
	return out;
}

/** Split Markdown into blocks: fenced code and `$$` display math stay whole;
 *  everything else breaks at blank lines. */
function splitBlocks(markdown: string): { text: string; atomic: boolean }[] {
	const blocks: { text: string; atomic: boolean }[] = [];
	let buf: string[] = [];
	let fence: string | null = null;
	let inMath = false;
	const flush = (atomic: boolean) => {
		const text = buf.join("\n").trim();
		if (text !== "") blocks.push({ text, atomic });
		buf = [];
	};
	for (const line of markdown.split("\n")) {
		if (fence !== null) {
			buf.push(line);
			if (line.trim().startsWith(fence)) {
				fence = null;
				flush(true);
			}
			continue;
		}
		if (inMath) {
			buf.push(line);
			if (line.includes("$$")) {
				inMath = false;
				flush(true);
			}
			continue;
		}
		const f = FENCE.exec(line);
		if (f) {
			flush(false);
			fence = f[1] ?? "```";
			buf.push(line);
			continue;
		}
		const dollars = line.split("$$").length - 1;
		if (line.trim().startsWith("$$") && dollars % 2 === 1) {
			flush(false);
			inMath = true;
			buf.push(line);
			continue;
		}
		if (line.trim() === "") {
			flush(false);
			continue;
		}
		buf.push(line);
	}
	flush(fence !== null || inMath);
	return blocks;
}

function isTable(text: string): boolean {
	const lines = text.split("\n");
	return lines.length >= 2 && lines[0]!.includes("|") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[1]!) && lines[1]!.includes("-");
}

/** The reveal steps of a Markdown passage. */
export function splitReaderUnits(markdown: string): ReaderUnit[] {
	const units: ReaderUnit[] = [];
	for (const block of splitBlocks(markdown)) {
		if (block.atomic || isTable(block.text) || /^\s*([-*_])\1{2,}\s*$/.test(block.text)) {
			units.push({ markdown: block.text, inline: false, startsBlock: true });
			continue;
		}
		const lines = block.text.split("\n");
		if (lines.some((l) => BLOCK_MARKER.test(l))) {
			// Headings, list items, quotes: one step per line item (continuation
			// lines stay with their item); items are not sentence-split further.
			let current: string[] = [];
			const push = () => {
				if (current.length > 0) units.push({ markdown: current.join("\n"), inline: false, startsBlock: true });
				current = [];
			};
			for (const line of lines) {
				if (BLOCK_MARKER.test(line)) push();
				current.push(line);
			}
			push();
			continue;
		}
		const sentences = segmentSentences(lines.join(" "));
		sentences.forEach((s, i) => units.push({ markdown: s, inline: true, startsBlock: i === 0 }));
	}
	return units;
}

/** Plain text to speak for one step: Markdown syntax stripped, math and code
 *  spoken as a short placeholder, so the voice never reads `$\frac{a}{b}$`. */
export function speechText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " code block ")
		.replace(/\$\$[\s\S]+?\$\$/g, " formula ")
		.replace(/\$[^$\n]+?\$|\\\([\s\S]+?\\\)/g, " formula ")
		.replace(/`([^`\n]+)`/g, "$1")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
		.replace(/(\*\*|__|\*|_|~~)/g, "")
		.replace(/\|/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export type RevealStyle = "blur" | "hide" | "dim";

export interface ReaderPrefs {
	style: RevealStyle;
	/** Prose font size in px. */
	fontSize: number;
	/** Read each sentence aloud as it is revealed. */
	autoRead: boolean;
	voice: string;
	/** Speaking speed (ElevenLabs 0.7–1.2). */
	rate: number;
}

export const READER_PREFS_KEY = "lh-reader";
export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 32;

export const DEFAULT_READER_PREFS: ReaderPrefs = { style: "blur", fontSize: 20, autoRead: false, voice: DEFAULT_TTS_VOICE, rate: 1 };

/** Parse the stored preferences, falling back per field to the defaults. */
export function parseReaderPrefs(raw: string | null): ReaderPrefs {
	const d = DEFAULT_READER_PREFS;
	let o: Record<string, unknown> = {};
	try {
		const v: unknown = raw === null ? {} : JSON.parse(raw);
		if (v !== null && typeof v === "object" && !Array.isArray(v)) o = v as Record<string, unknown>;
	} catch {
		// Corrupt storage: defaults.
	}
	const num = (x: unknown, lo: number, hi: number, fallback: number) =>
		typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
	return {
		style: o.style === "blur" || o.style === "hide" || o.style === "dim" ? o.style : d.style,
		fontSize: Math.round(num(o.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, d.fontSize)),
		autoRead: typeof o.autoRead === "boolean" ? o.autoRead : d.autoRead,
		voice: typeof o.voice === "string" && TTS_VOICES.some(([id]) => id === o.voice) ? o.voice : d.voice,
		rate: num(o.rate, TTS_RATE_MIN, TTS_RATE_MAX, d.rate),
	};
}
