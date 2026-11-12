import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restoreLiteralNewlines } from "../src/core/literal-newlines.ts";
import { repairMathForDisplay } from "../src/core/math-delims.ts";

describe("restoreLiteralNewlines — display-time repair of double-escaped newlines", () => {
	it("turns literal \\n into real line breaks (the reported question)", () => {
		assert.equal(
			restoreLiteralNewlines("按下面 4 点写就行：\\n\\n1. 哪个部位？\\n2. 是怎么开始的？"),
			"按下面 4 点写就行：\n\n1. 哪个部位？\n2. 是怎么开始的？",
		);
	});

	it("leaves TeX commands that start with n alone", () => {
		const tex = "$a \\neq b$, $\\nu$, $\\nabla f$, $\\not\\in$";
		assert.equal(restoreLiteralNewlines(tex), tex);
	});

	it("leaves inline code and fenced code alone", () => {
		const text = "打印 `print('a\\n')` 会怎样？\n```py\nprint('x\\n1')\n```\\n后面";
		assert.equal(
			restoreLiteralNewlines(text),
			"打印 `print('a\\n')` 会怎样？\n```py\nprint('x\\n1')\n```\n后面",
		);
	});

	it("leaves an escaped backslash (\\\\n) alone", () => {
		assert.equal(restoreLiteralNewlines("C:\\\\new"), "C:\\\\new");
	});

	it("is the identity on text with no backslash-n, and on real newlines", () => {
		assert.equal(restoreLiteralNewlines("plain\ntext"), "plain\ntext");
		assert.equal(restoreLiteralNewlines(""), "");
	});

	it("leaves a code block that arrived on ONE line whole, and restores \\n before a plain word", () => {
		const fence = "```python\\nx = [1]\\nwhile x:\\n    x.pop()\\n```";
		const q = "Consider this:\\n\\n" + fence + "\\nAfter this loop, what is len(x)?";
		const restored = restoreLiteralNewlines(q);
		assert.equal(restored, "Consider this:\n\n" + fence + "\nAfter this loop, what is len(x)?");
		assert.equal(
			repairMathForDisplay(restored),
			"Consider this:\n\n```python\nx = [1]\nwhile x:\n    x.pop()\n```\nAfter this loop, what is len(x)?",
			"tool-content recovery decodes the block",
		);
	});

	it("still keeps TeX n-commands but not words that merely start like one", () => {
		assert.equal(restoreLiteralNewlines("$a \\neq b$ and \\nExample"), "$a \\neq b$ and \nExample");
		assert.equal(restoreLiteralNewlines("\\nu is a letter; \\nupdate"), "\\nu is a letter; \nupdate");
	});
});
