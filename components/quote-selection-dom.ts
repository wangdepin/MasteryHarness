/**
 * Quote-a-selection (owner, 2026-10-21; automatic 2026-10-22): while a
 * question waits, selecting teaching prose appends it, as a Markdown
 * blockquote, to the visible thinking field. The pure pieces live here; the
 * selection listener is components/quote-selection.tsx.
 */
import { selectionCopyText } from "./math-copy-dom";

/** The teacher's prose passages in the transcript (components/chat.tsx). */
const PASSAGE = ".lh-source-passage";

/** A selection shorter than this is left alone: a double-clicked word or a
 *  stray click-drag is not a quote. */
export const MIN_AUTO_QUOTE_CHARS = 4;

/** Window event the dock's "Your thinking" field listens for (detail: the
 *  selected text) — the chat page and the dock are siblings, not parent and
 *  child, so the quote travels by event rather than prop. */
export const QUOTE_EVENT = "lh:quote-selection";

/** Is this selected text long enough to quote on its own? Counts characters,
 *  not UTF-16 units, so CJK text and emoji weigh one each. */
export function isAutoQuotable(text: string): boolean {
	return [...text.trim()].length >= MIN_AUTO_QUOTE_CHARS;
}

/** A quote longer than this is cut and marked with an ellipsis. */
export const MAX_QUOTE_CHARS = 500;

function inPassage(node: Node): boolean {
	const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	return el?.closest(PASSAGE) != null;
}

/** The selected teaching prose as quotable text (formulas as `$tex$`), or
 *  null when nothing is selected or the selection reaches outside the
 *  teacher's prose (the field, question cards, the composer…). */
export function selectedPassageText(selection: Selection): string | null {
	if (selection.isCollapsed || selection.rangeCount === 0) return null;
	for (let i = 0; i < selection.rangeCount; i++) {
		const range = selection.getRangeAt(i);
		if (!inPassage(range.startContainer) || !inPassage(range.endContainer)) return null;
	}
	const text = (selectionCopyText(selection) ?? selection.toString()).trim();
	return text === "" ? null : text;
}

/** Pure: `current` with `selected` appended as a blockquote, then a blank
 *  line so the learner keeps typing underneath. Existing text is kept. */
export function appendQuote(current: string, selected: string): string {
	const trimmed = selected.trim();
	const clipped = trimmed.length > MAX_QUOTE_CHARS ? `${trimmed.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : trimmed;
	const quote = clipped
		.split("\n")
		.map((line) => (line.trim() === "" ? ">" : `> ${line}`))
		.join("\n");
	if (current.trim() === "") return `${quote}\n\n`;
	const gap = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
	return `${current}${gap}${quote}\n\n`;
}
