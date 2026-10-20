/**
 * Quote-a-selection (owner, 2026-10-21): while the "Thinking while reading"
 * field is open, selecting teaching prose offers a Quote button that appends
 * the selection to the field as a Markdown blockquote. The pure pieces live
 * here; the floating button is components/quote-selection.tsx.
 */
import { selectionCopyText } from "./math-copy-dom";

/** The teacher's prose passages in the transcript (components/chat.tsx). */
const PASSAGE = ".lh-source-passage";

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
