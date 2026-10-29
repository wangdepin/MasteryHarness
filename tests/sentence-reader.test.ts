import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_READER_PREFS, latestReadablePassage, parseReaderPrefs, speechText, splitReaderUnits } from "../src/core/sentence-reader.ts";
import type { LhViewMessage, LhViewPart } from "../src/core/view.ts";

describe("splitReaderUnits", () => {
	it("splits a paragraph into inline sentence steps", () => {
		const u = splitReaderUnits("First idea. Second idea! Third?\n\nNew paragraph here.");
		assert.deepEqual(u.map((x) => x.markdown), ["First idea.", "Second idea!", "Third?", "New paragraph here."]);
		assert.deepEqual(u.map((x) => x.startsBlock), [true, false, false, true]);
		assert.ok(u.every((x) => x.inline));
	});

	it("never breaks inside inline math or code", () => {
		const u = splitReaderUnits("Let $x = 1.5. y$ hold. Use `a. b` too.");
		assert.deepEqual(u.map((x) => x.markdown), ["Let $x = 1.5. y$ hold.", "Use `a. b` too."]);
	});

	it("keeps fences and display math whole", () => {
		const u = splitReaderUnits("Before.\n\n```py\nx = 1.\n\ny = 2.\n```\n\n$$\na.\n\nb\n$$\n\nAfter.");
		assert.equal(u.length, 4);
		assert.ok(u[1]!.markdown.startsWith("```py") && !u[1]!.inline);
		assert.ok(u[2]!.markdown.startsWith("$$"));
	});

	it("makes headings and list items their own block steps", () => {
		const u = splitReaderUnits("## Title\n\n- one. two.\n- three");
		assert.deepEqual(u.map((x) => x.markdown), ["## Title", "- one. two.", "- three"]);
		assert.ok(u.every((x) => !x.inline));
	});

	it("segments Chinese sentences", () => {
		const u = splitReaderUnits("先按顺序数。再除掉重复。");
		assert.equal(u.length, 2);
	});

	it("empty input has no steps", () => {
		assert.deepEqual(splitReaderUnits("  \n\n "), []);
	});
});

describe("speechText", () => {
	it("strips markdown and replaces math/code", () => {
		assert.equal(speechText("## **Big** idea with $x^2$ and [a link](http://z)"), "Big idea with formula and a link");
		assert.equal(speechText("- item `code`"), "item code");
	});
});

describe("parseReaderPrefs", () => {
	it("defaults on null or corrupt input", () => {
		assert.deepEqual(parseReaderPrefs(null), DEFAULT_READER_PREFS);
		assert.deepEqual(parseReaderPrefs("{nope"), DEFAULT_READER_PREFS);
	});

	it("clamps numbers and rejects unknown values per field", () => {
		const p = parseReaderPrefs(JSON.stringify({ style: "hide", fontSize: 99, rate: 0.1, autoRead: "yes" }));
		assert.equal(p.style, "hide");
		assert.equal(p.fontSize, 32);
		assert.equal(p.rate, 0.7);
		assert.equal(p.voice, DEFAULT_READER_PREFS.voice);
		assert.equal(p.autoRead, false);
	});
});

describe("latestReadablePassage — what the reader shortcut opens", () => {
	const text = (t: string): LhViewPart => ({ type: "text", text: t });
	const tool: LhViewPart = { type: "tool-probe" };
	const teacher = (id: string, ...parts: LhViewPart[]): LhViewMessage => ({ id, role: "assistant", parts });
	const learner = (id: string, t: string): LhViewMessage => ({ id, role: "user", parts: [text(t)] });

	it("takes the last text part of the newest teacher message", () => {
		const messages = [teacher("a", text("old")), learner("u", "hi"), teacher("b", text("first"), tool, text("second"), tool)];
		assert.equal(latestReadablePassage(messages, false), "second");
	});

	it("looks past a newest message that only holds tool calls", () => {
		const messages = [teacher("a", text("the lesson")), learner("u", "ok"), teacher("b", tool)];
		assert.equal(latestReadablePassage(messages, false), "the lesson");
	});

	it("skips blank text and never reads the learner's own words", () => {
		const messages = [teacher("a", text("real")), teacher("b", text("  \n"), tool), learner("u", "mine")];
		assert.equal(latestReadablePassage(messages, false), "real");
	});

	it("returns null for no teacher text at all", () => {
		assert.equal(latestReadablePassage([], false), null);
		assert.equal(latestReadablePassage([learner("u", "hello"), teacher("a", tool)], false), null);
	});

	it("while streaming, the passage being written is not readable — and no older one stands in", () => {
		const messages = [teacher("a", text("old")), teacher("b", tool, text("being writ"))];
		assert.equal(latestReadablePassage(messages, true), null);
		assert.equal(latestReadablePassage(messages, false), "being writ");
	});

	it("while streaming, a finished passage before the live tail is still readable", () => {
		const messages = [teacher("a", text("done"), tool, text("")), learner("u", "x")];
		assert.equal(latestReadablePassage(messages, true), "done");
	});
});
