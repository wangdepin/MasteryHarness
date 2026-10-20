/**
 * Literal "\n" repair for question text (owner, 2026-10-21). A model that
 * double-escapes a tool argument sends the two characters `\` `n` instead of
 * a line break, and the question dock shows them verbatim ("…\n\n1. …").
 * Applied at DISPLAY time to question-side text only, so already-stored
 * questions heal too and nothing on disk is rewritten.
 *
 * Narrow on purpose:
 *   - code is untouched (fenced blocks and inline code spans) — a question
 *     ABOUT "\n" in Python keeps it;
 *   - `\n` followed by a letter is left alone — that is `\neq`, `\nu`,
 *     `\nabla`, `\not`… in TeX, indistinguishable from a sloppy newline;
 *   - an escaped backslash (`\\n`, as in a Windows path) is left alone.
 */

const CODE_SPAN = /(```[\s\S]*?```|`[^`\n]*`)/;
const LITERAL_NEWLINE = /(?<!\\)\\n(?![A-Za-z])/g;

export function restoreLiteralNewlines(text: string): string {
	if (!text.includes("\\n")) return text;
	return text
		.split(CODE_SPAN)
		// split() with a capture group puts the code spans at odd indexes.
		.map((part, i) => (i % 2 === 1 ? part : part.replace(LITERAL_NEWLINE, "\n")))
		.join("");
}
