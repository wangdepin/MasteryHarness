import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { teaserText } from "../components/question-dock.tsx";

describe("teaserText — the collapsed dock's one-line question teaser", () => {
	it("unwraps font/text commands instead of gluing them to their argument", () => {
		assert.equal(
			teaserText("已知 $\\mathrm{Var}(X) = 1$。求 $\\mathrm{Var}(3 - 2X)$。"),
			"已知 Var(X) = 1。求 Var(3 - 2X)。",
		);
	});

	it("covers the common text-style wrappers", () => {
		for (const cmd of ["mathrm", "mathbf", "mathit", "mathsf", "mathcal", "mathbb", "text", "textbf", "operatorname", "boldsymbol"]) {
			assert.equal(teaserText(`$\\${cmd}{Cov}(X,Y)$`), "Cov(X,Y)", cmd);
		}
	});

	it("tolerates a space before the argument", () => {
		assert.equal(teaserText("$\\mathrm {E}[X]$"), "E[X]");
	});

	it("keeps flattening the cases it already handled", () => {
		assert.equal(teaserText("$\\frac{a}{b}$"), "a/b");
		assert.equal(teaserText("\\(x + y\\)"), "x + y");
		assert.equal(teaserText("\\[x = 1\\]"), "x = 1");
		assert.equal(teaserText("$$a$$ and $b$"), "a and b");
		assert.equal(teaserText("$\\sigma^2$"), "sigma^2");
	});

	it("collapses whitespace and trims", () => {
		assert.equal(teaserText("  a \n\n b\t c  "), "a b c");
	});

	it("leaves prose with no math untouched", () => {
		assert.equal(teaserText("下面哪个说法正确？"), "下面哪个说法正确？");
	});
});
