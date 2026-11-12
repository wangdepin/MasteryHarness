/**
 * The outline digest of a long text (fork addition, 2026-11-12): how a
 * book is shown to the profiling call — every chapter present, each cut to
 * an even share, nothing invented.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digestLongText, shareBudget } from "../src/agent/subagents/long-text-digest.ts";
import { withinTextLimit } from "../src/agent/subagents/material-profiler.ts";

describe("shareBudget", () => {
	it("splits evenly, lets short sections keep their size, and hands the rest to the long ones", () => {
		for (const [lengths, budget, expected] of [
			[[100, 100, 100], 300, [100, 100, 100]],
			[[1000, 1000], 600, [300, 300]],
			[[50, 1000, 1000], 650, [50, 300, 300]],
			[[1000, 20, 400], 620, [300, 20, 300]],
			[[], 100, []],
		] as const) {
			assert.deepEqual(shareBudget(lengths, budget), expected, `${JSON.stringify(lengths)} within ${budget}`);
		}
	});
});

describe("digestLongText", () => {
	const chapter = (n: number, words: number) => `# Chapter ${n}\n\n## Section ${n}.1\n\n${`alpha${n} `.repeat(words)}\n\n## Section ${n}.2\n\n${`omega${n} `.repeat(words)}`;

	it("keeps every chapter's heading, the headings beneath it and its opening", () => {
		const text = [chapter(1, 400), chapter(2, 400), chapter(3, 400)].join("\n\n");
		const digest = digestLongText(text, 1500)!;
		assert.ok(digest.length < text.length / 4);
		for (const n of [1, 2, 3]) {
			assert.match(digest, new RegExp(`^# Chapter ${n}$`, "m"));
			assert.ok(digest.includes(`[headings in this chapter: Section ${n}.1 · Section ${n}.2]`));
			assert.ok(digest.includes(`alpha${n} `), `chapter ${n}'s opening is shown`);
			assert.ok(!digest.includes(`omega${n} `), `chapter ${n}'s end is not`);
		}
		assert.match(digest, /\[… \d+ more characters of this chapter are not shown\]/);
	});

	it("a chapter shorter than its share is shown whole", () => {
		const short = "# Preface\n\nA few words.";
		const digest = digestLongText(`${short}\n\n${chapter(1, 400)}\n\n${chapter(2, 400)}`, 1500)!;
		assert.ok(digest.startsWith(`${short}\n\n# Chapter 1`));
	});

	it("splits at the shallowest level used twice: a lone book title does not swallow the chapters", () => {
		const text = `# The Book\n\nAuthor: A\n\n## One\n\n${"a ".repeat(500)}\n\n## Two\n\n${"b ".repeat(500)}`;
		const digest = digestLongText(text, 600)!;
		assert.ok(digest.startsWith("# The Book\n\nAuthor: A\n\n## One\n"));
		assert.match(digest, /^## Two$/m);
	});

	it("a section that takes most of the budget is a container: it is digested in turn, one level down", () => {
		// A title heading, then a title page with the same heading over the whole book: every chapter must still show.
		const chapters = [1, 2, 3, 4].map((n) => `## Chapter ${n}\n\n${`body${n} `.repeat(4000)}`).join("\n\n");
		const digest = digestLongText(`# The Book\n\nAuthor: A\n\n# The Book\n\n${chapters}`, 60_000)!;
		assert.ok(digest.length < 62_000);
		for (const n of [1, 2, 3, 4]) {
			assert.match(digest, new RegExp(`^## Chapter ${n}$`, "m"));
			assert.ok(digest.includes(`body${n} `), `chapter ${n}'s opening is shown`);
		}
	});

	it("headings inside fenced code are not chapters", () => {
		const text = `# One\n\n\`\`\`sh\n# a comment\n# another\n\`\`\`\n\n${"a ".repeat(300)}`;
		assert.equal(digestLongText(text, 200), null, "one real heading: nothing to split by");
	});

	it("a text without headings has no digest", () => {
		assert.equal(digestLongText("plain words ".repeat(500), 300), null);
	});
});

describe("what the profiling call sees", () => {
	it("a text within the limit is shown whole, with no note", () => {
		assert.deepEqual(withinTextLimit("# A\n\nshort", 100), { shown: "# A\n\nshort", note: "" });
	});

	it("a long text with chapters is shown as its outline, and the note says so", () => {
		const text = `# One\n\n${"a ".repeat(400)}\n\n# Two\n\n${"b ".repeat(400)}`;
		const { shown, note } = withinTextLimit(text, 500);
		assert.match(shown, /^# Two$/m);
		assert.match(note, /^ \(\d+ characters, too long to show whole: below is an outline of it/);
	});

	it("a long text without headings is cut at the limit, as before", () => {
		const { shown, note } = withinTextLimit("x".repeat(900), 500);
		assert.equal(shown.length, 500);
		assert.equal(note, " (only its first 500 characters are shown)");
	});
});
