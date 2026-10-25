import { code as shiki, type HighlightResult } from "@streamdown/code";

/**
 * Python syntax highlighting for the code-exercise editor and its answered
 * card (owner, 2026-10-25). The colors come from the highlighter the chat's
 * code blocks use, so an exercise matches the lesson text around it.
 *
 * The TEXT never comes from the highlighter: a Run list always spells out
 * exactly the code it was asked about, and the highlighter only supplies the
 * colors. That makes a stale or mismatched highlight unable to show a wrong
 * character over what the learner typed.
 */

/** A stretch of code in one color; no color = the theme's plain text. */
export interface Run {
	text: string;
	light?: string;
	dark?: string;
}

const sameColor = (a: Run, b: Run): boolean => a.light === b.light && a.dark === b.dark;

function merged(runs: readonly Run[]): Run[] {
	const out: Run[] = [];
	for (const run of runs) {
		if (run.text === "") continue;
		const last = out.at(-1);
		if (last && sameColor(last, run)) out[out.length - 1] = { ...last, text: last.text + run.text };
		else out.push(run);
	}
	return out;
}

const spelled = (runs: readonly Run[]): string => runs.map((r) => r.text).join("");

/** The code with no color — the first paint, before the highlighter is ready. */
export function plainRuns(source: string): Run[] {
	return merged([{ text: source }]);
}

interface HighlightedToken {
	content: string;
	htmlStyle?: Record<string, string>;
}

/** shiki's lines of tokens as Runs; null if they do not spell exactly `source`. */
export function runsFromTokens(source: string, lines: readonly (readonly HighlightedToken[])[]): Run[] | null {
	const runs: Run[] = [];
	lines.forEach((line, index) => {
		if (index > 0) runs.push({ text: "\n" });
		for (const token of line) {
			const light = token.htmlStyle?.color;
			const dark = token.htmlStyle?.["--shiki-dark"];
			runs.push({ text: token.content, ...(light ? { light } : {}), ...(dark ? { dark } : {}) });
		}
	});
	const out = merged(runs);
	return spelled(out) === source ? out : null;
}

function slice(runs: readonly Run[], from: number, to: number): Run[] {
	const out: Run[] = [];
	let at = 0;
	for (const run of runs) {
		const start = Math.max(from - at, 0);
		const end = Math.min(to - at, run.text.length);
		if (end > start) out.push({ ...run, text: run.text.slice(start, end) });
		at += run.text.length;
	}
	return out;
}

function colorAt(runs: readonly Run[], index: number): Pick<Run, "light" | "dark"> {
	let at = 0;
	for (const run of runs) {
		if (index < at + run.text.length) return { ...(run.light ? { light: run.light } : {}), ...(run.dark ? { dark: run.dark } : {}) };
		at += run.text.length;
	}
	return {};
}

/**
 * Colors for `next` while its own highlight is still being computed: the
 * previous colors stay on the unchanged start and end of the code, and what
 * was typed in between takes the color of the character before it. Without
 * this the whole editor would flash plain on every keystroke.
 */
export function carryRuns(prev: readonly Run[], next: string): Run[] {
	const before = spelled(prev);
	let head = 0;
	while (head < before.length && head < next.length && before[head] === next[head]) head++;
	let tail = 0;
	const room = Math.min(before.length, next.length) - head;
	while (tail < room && before[before.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
	const middle: Run = { text: next.slice(head, next.length - tail), ...(head > 0 ? colorAt(prev, head - 1) : {}) };
	return merged([...slice(prev, 0, head), middle, ...slice(prev, before.length - tail, before.length)]);
}

/** A short digest of the code (FNV-1a), so the highlighter's cache key is unique per code. */
function digest(source: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 0x01000193) >>> 0;
	return `${hash.toString(16)}-${source.length}`;
}

const asRuns = (source: string, result: HighlightResult): Run[] | null =>
	// The last line is the digest comment added below.
	runsFromTokens(source, result.tokens.slice(0, -1));

/**
 * Highlight Python with the chat's highlighter: the runs now if this exact
 * code was highlighted before, else null and `onReady` once they exist.
 *
 * The plugin caches on the code's length and its first and last 100
 * characters only, so two programs differing in the middle can be handed
 * each other's tokens. A trailing comment holding a digest of the whole
 * program gives every program its own key; it is dropped from the result.
 */
export function highlightPython(source: string, onReady: (runs: Run[]) => void): Run[] | null {
	const guarded = `${source}\n# ${digest(source)}`;
	const hit = shiki.highlight({ code: guarded, language: "python", themes: shiki.getThemes() }, (result) => {
		const runs = asRuns(source, result);
		if (runs) onReady(runs);
	});
	return hit ? asRuns(source, hit) : null;
}
