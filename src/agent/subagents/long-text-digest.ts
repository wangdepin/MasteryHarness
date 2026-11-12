/**
 * The outline digest of a long text (fork addition, 2026-11-12). PURE.
 *
 * A source profile is written from one model call over the text
 * (material-profiler.ts). A book is far longer than that call can take,
 * and cutting it at the limit would profile only its first chapters. The
 * digest keeps the whole SHAPE instead: every chapter's heading, the
 * headings beneath it, and as much of its opening as an even share of the
 * budget allows (chapters shorter than their share stay whole, and what
 * they leave over goes to the longer ones). A section whose share is far
 * more than an opening needs is not a chapter but a container — a part, or
 * a whole book under its title heading — and is digested in turn, one
 * heading level down.
 */

/** A cut section with a share beyond this is split again by the headings inside it. */
const CONTAINER_SHARE = 20_000;

interface Heading {
	line: number;
	level: number;
}

/** The ATX headings of a Markdown text, skipping fenced code. Pure. */
function headings(lines: readonly string[]): Heading[] {
	const found: Heading[] = [];
	let fence: string | null = null;
	lines.forEach((text, line) => {
		const mark = /^\s{0,3}(```|~~~)/.exec(text)?.[1];
		if (mark) {
			if (fence === null) fence = mark;
			else if (fence === mark) fence = null;
			return;
		}
		const level = fence === null ? /^(#{1,6})\s+\S/.exec(text)?.[1]?.length : undefined;
		if (level) found.push({ line, level });
	});
	return found;
}

/** The level the text's chapters sit at: the shallowest one used at least twice. Pure. */
function chapterLevel(found: readonly Heading[]): number | null {
	for (let level = 1; level <= 6; level++) {
		if (found.filter((h) => h.level === level).length >= 2) return level;
	}
	return null;
}

/** An even split of `budget` over the sections: short ones take what they need, the rest share what is left. Pure. */
export function shareBudget(lengths: readonly number[], budget: number): number[] {
	const shares = new Array<number>(lengths.length).fill(0);
	const shortestFirst = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
	let left = budget;
	shortestFirst.forEach(({ length, index }, position) => {
		const share = Math.min(length, Math.floor(left / (shortestFirst.length - position)));
		shares[index] = share;
		left -= share;
	});
	return shares;
}

/** One chapter cut to its share: heading, the headings beneath it, its opening, and what was left out. Pure. */
function cutSection(lines: readonly string[], share: number): string {
	const [first = "", ...rest] = lines;
	const titled = /^#{1,6}\s/.test(first);
	const head = titled ? first : "";
	const bodyLines = titled ? rest : lines;
	const body = bodyLines.join("\n");
	const inner = share > CONTAINER_SHARE ? digestLongText(body, share - head.length) : null;
	if (inner) return [head, inner].filter(Boolean).join("\n");
	const beneath = headings(bodyLines).map((h) => bodyLines[h.line]!.replace(/^#+\s+/, "").trim());
	const outline = beneath.length > 0 ? `[headings in this chapter: ${beneath.join(" · ")}]`.slice(0, Math.floor(share / 2)) : "";
	const opening = body.slice(0, Math.max(0, share - head.length - outline.length)).trimEnd();
	const omitted = body.length - opening.length;
	return [head, outline, opening, `[… ${omitted} more characters of this chapter are not shown]`].filter(Boolean).join("\n");
}

/**
 * The digest of `text` within about `limit` characters, or null when the
 * text has no repeated heading level to split by (the caller then falls
 * back to showing its start).
 */
export function digestLongText(text: string, limit: number): string | null {
	const lines = text.split(/\r?\n/);
	const found = headings(lines);
	const level = chapterLevel(found);
	if (level === null) return null;
	const starts = found.filter((h) => h.level === level).map((h) => h.line);
	const bounds = starts[0] === 0 ? starts : [0, ...starts];
	const sections = bounds
		.map((start, i) => lines.slice(start, bounds[i + 1] ?? lines.length))
		.filter((section) => section.some((line) => line.trim()));
	const lengths = sections.map((section) => section.join("\n").length);
	const shares = shareBudget(lengths, limit);
	return sections
		.map((section, i) => (lengths[i]! <= shares[i]! ? section.join("\n").trimEnd() : cutSection(section, shares[i]!)))
		.join("\n\n");
}
