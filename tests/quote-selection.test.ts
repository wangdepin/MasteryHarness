import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendQuote, MAX_QUOTE_CHARS } from "../components/quote-selection-dom.ts";

describe("appendQuote — selected prose into the reading-thinking field", () => {
	it("an empty field becomes the blockquote plus a blank line to type under", () => {
		assert.equal(appendQuote("", "被数了 5! = 120 遍"), "> 被数了 5! = 120 遍\n\n");
	});

	it("existing text is kept and the quote follows after a blank line", () => {
		assert.equal(appendQuote("我没看懂", "第一步"), "我没看懂\n\n> 第一步\n\n");
	});

	it("does not stack extra blank lines when the field already ends in them", () => {
		assert.equal(appendQuote("a\n\n", "q"), "a\n\n> q\n\n");
		assert.equal(appendQuote("a\n", "q"), "a\n\n> q\n\n");
	});

	it("quotes every line of a multi-line selection; blank lines keep the quote going", () => {
		assert.equal(appendQuote("", "line1\n\nline2"), "> line1\n>\n> line2\n\n");
	});

	it("keeps TeX source as selected ($…$ comes from the copy logic)", () => {
		assert.equal(appendQuote("", "$\\binom{10}{5}=252$"), "> $\\binom{10}{5}=252$\n\n");
	});

	it("cuts a very long selection and marks the cut", () => {
		const out = appendQuote("", "字".repeat(MAX_QUOTE_CHARS + 50));
		assert.equal(out, `> ${"字".repeat(MAX_QUOTE_CHARS)}…\n\n`);
	});

	it("trims surrounding whitespace of the selection", () => {
		assert.equal(appendQuote("", "  hi \n"), "> hi\n\n");
	});
});
