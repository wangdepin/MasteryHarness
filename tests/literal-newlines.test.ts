import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restoreLiteralNewlines } from "../src/core/literal-newlines.ts";

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
});
