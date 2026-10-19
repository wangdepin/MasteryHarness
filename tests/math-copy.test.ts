/**
 * Math-aware copy — replaceFormulasWithTex over REAL KaTeX output (the same
 * markup rehype-katex injects), under linkedom. The selection/clipboard
 * wiring (Range, innerText, the copy event) is browser-verified, not
 * re-implemented here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import katex from "katex";
import { parseHTML } from "linkedom";
import { replaceFormulasWithTex } from "../components/math-copy-dom.ts";

const { document } = parseHTML("<html><body></body></html>");

function inline(tex: string): string {
	return katex.renderToString(tex, { throwOnError: false });
}

function display(tex: string): string {
	return katex.renderToString(tex, { throwOnError: false, displayMode: true });
}

function mount(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	return root as unknown as HTMLElement;
}

describe("replaceFormulasWithTex", () => {
	it("inline formula becomes $tex$ in place, surrounding prose untouched", () => {
		const root = mount(`<p>因为 ${inline("\\frac{x-\\mu}{\\sigma}")}，所以成立。</p>`);
		assert.equal(replaceFormulasWithTex(root), 1);
		assert.equal(root.textContent, "因为 $\\frac{x-\\mu}{\\sigma}$，所以成立。");
	});

	it("display formula becomes $$ on separate lines", () => {
		const root = mount(`<div>${display("\\mathrm{Var}(X)=\\sigma^2")}</div>`);
		assert.equal(replaceFormulasWithTex(root), 1);
		assert.equal(root.textContent, "\n$$\n\\mathrm{Var}(X)=\\sigma^2\n$$\n");
	});

	it("mixed inline and display, several of each, in document order", () => {
		const root = mount(
			`<p>${inline("a")} 与 ${inline("b^2")}</p><div>${display("c=d")}</div><p>${inline("e")}</p>`,
		);
		assert.equal(replaceFormulasWithTex(root), 4);
		assert.equal(root.textContent, "$a$ 与 $b^2$\n$$\nc=d\n$$\n$e$");
	});

	it("the hidden MathML and the visible HTML tree never both leak", () => {
		const root = mount(`<p>${inline("x^2")}</p>`);
		replaceFormulasWithTex(root);
		assert.equal(root.textContent, "$x^2$");
		assert.equal(root.querySelector(".katex"), null);
	});

	it("display math wraps a .katex — counted once, not twice", () => {
		const root = mount(display("x"));
		assert.equal(replaceFormulasWithTex(root), 1);
		assert.equal(root.textContent, "\n$$\nx\n$$\n");
	});

	it("no formula: returns 0 and leaves the DOM exactly as it was", () => {
		const html = "<p>plain <b>bold</b> text</p>";
		const root = mount(html);
		assert.equal(replaceFormulasWithTex(root), 0);
		assert.equal(root.innerHTML, html);
	});

	it("a formula whose annotation was lost takes the fallback TeX", () => {
		const root = mount(`<p>${inline("x^2").replace(/<annotation[\s\S]*?<\/annotation>/, "")}</p>`);
		assert.equal(replaceFormulasWithTex(root, ["x^2"]), 1);
		assert.equal(root.textContent, "$x^2$");
	});

	it("fallback is matched by formula position, not by how many were replaced", () => {
		// Two annotation-less formulas; only the second has a fallback. A counter of
		// replacements would hand the second one fallback[0] (empty) instead of "z".
		const lost = (tex: string) => inline(tex).replace(/<annotation[\s\S]*?<\/annotation>/, "");
		const root = mount(`<p>${lost("y")} ${lost("z")}</p>`);
		assert.equal(replaceFormulasWithTex(root, ["", "z"]), 1);
		assert.ok(root.textContent?.endsWith("$z$"));
		assert.equal(root.querySelectorAll(".katex").length, 1);
	});

	it("an empty fallback entry counts as missing: the formula stays", () => {
		const lost = inline("b").replace(/<annotation[\s\S]*?<\/annotation>/, "");
		const root = mount(`<p>${lost}</p>`);
		assert.equal(replaceFormulasWithTex(root, [""]), 0);
		assert.ok(root.querySelector(".katex"));
	});

	it("annotation lost and no fallback: the formula is left alone, not blanked", () => {
		const stripped = inline("x^2").replace(/<annotation[\s\S]*?<\/annotation>/, "");
		const root = mount(`<p>${stripped}</p>`);
		assert.equal(replaceFormulasWithTex(root), 0);
		assert.ok(root.querySelector(".katex"));
	});

	it("TeX is taken verbatim, braces and backslashes intact", () => {
		const tex = "\\left(\\frac{X-\\mu}{\\sigma}\\right)";
		const root = mount(`<p>${inline(tex)}</p>`);
		replaceFormulasWithTex(root);
		assert.equal(root.textContent, `$${tex}$`);
	});
});
