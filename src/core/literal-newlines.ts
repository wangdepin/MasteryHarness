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
 *   - `\n` followed by a TeX command name (`\neq`, `\nu`, `\nabla`, `\not`…)
 *     is left alone; `\n` before any other word ("\nAfter this") is a newline;
 *   - the exception to the code rule: a fenced block written on ONE line
 *     (no real newline inside) is a double-escaped block — its `\n` are
 *     the block's own line breaks, so they are restored too;
 *   - an escaped backslash (`\\n`, as in a Windows path) is left alone.
 */

const CODE_SPAN = /(```[\s\S]*?```|`[^`\n]*`)/;
/** TeX commands that begin with "n" — `\n` + one of these is math, not a
 *  line break. Whole-word match, case-sensitive ("\nAfter" is a newline). */
const TEX_N_COMMANDS =
	"abla|atural|e|eg|eq|eqq|ewline|exists|earrow|warrow|i|mid|less|gtr|leq|geq|leftarrow|rightarrow|Leftarrow|Rightarrow|leftrightarrow|parallel|prec|succ|shortmid|sim|simeq|cong|subseteq|supseteq|u|ot|otin|vdash|vDash|Vdash|VDash|triangleleft|triangleright|otag|onumber|ormalsize|olimits|oindent";
const LITERAL_NEWLINE = new RegExp(`(?<!\\\\)\\\\n(?!(?:${TEX_N_COMMANDS})(?![A-Za-z]))`, "g");

/** A ``` fence with no real newline inside: the whole block arrived on one line. */
function isOneLineFence(part: string): boolean {
	return part.startsWith("```") && !part.includes("\n");
}

export function restoreLiteralNewlines(text: string): string {
	if (!text.includes("\\n")) return text;
	return text
		.split(CODE_SPAN)
		// split() with a capture group puts the code spans at odd indexes.
		.map((part, i) => (i % 2 === 1 && !isOneLineFence(part) ? part : part.replace(LITERAL_NEWLINE, "\n")))
		.join("");
}
