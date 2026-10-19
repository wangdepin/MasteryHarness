/**
 * Math-aware copy (owner, 2026-10-19). KaTeX renders every formula twice — a
 * visible HTML tree and a hidden MathML tree — so the browser's own copy of a
 * selection spanning a formula yields both glued together ("x↦x−μσ"). The
 * MathML carries the authored TeX in <annotation encoding="application/x-tex">;
 * a copy swaps each formula for that source in the app's own delimiters:
 * `$tex$` inline, `$$` on separate lines for display. A selection with no
 * formula is left to the browser.
 */

const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"]';

/** One rendered formula: display math wraps its .katex in .katex-display. */
const FORMULA = ".katex-display, .katex";

function isOutermost(el: Element): boolean {
	return !el.parentElement?.closest(FORMULA);
}

function outermostFormulas(root: ParentNode): Element[] {
	return Array.from(root.querySelectorAll(FORMULA)).filter(isOutermost);
}

/** The authored TeX of a rendered formula, or null when the annotation is gone. */
function texOf(formula: Element): string | null {
	const tex = formula.querySelector(TEX_ANNOTATION)?.textContent?.trim();
	return tex || null;
}

function delimited(tex: string, display: boolean): string {
	return display ? `\n$$\n${tex}\n$$\n` : `$${tex}$`;
}

/**
 * Replace every rendered formula under `root` with its TeX source (mutates
 * `root`; returns how many were replaced). A formula whose own annotation was
 * lost — a partial selection can clone only half of one — takes the entry of
 * `fallbackTex` at its position (document order); with none it stays as is.
 */
export function replaceFormulasWithTex(root: ParentNode, fallbackTex: readonly string[] = []): number {
	let replaced = 0;
	outermostFormulas(root).forEach((formula, position) => {
		const tex = texOf(formula) ?? (fallbackTex[position] || null);
		if (tex === null) return;
		const display = formula.matches(".katex-display");
		formula.replaceWith(formula.ownerDocument.createTextNode(delimited(tex, display)));
		replaced += 1;
	});
	return replaced;
}

/** Element hosting a range's common ancestor (text nodes → their parent). */
function hostElement(range: Range): Element | null {
	const node = range.commonAncestorContainer;
	return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** Plain text of a cloned fragment, laid out by the browser: mounted
 *  off-screen so innerText supplies the block/paragraph line breaks, with
 *  pre-wrap keeping the newlines the display-math wrapper adds. */
function laidOutText(fragment: DocumentFragment): string {
	const holder = document.createElement("div");
	holder.setAttribute("aria-hidden", "true");
	holder.style.cssText = "position:fixed;left:-99999px;top:0;white-space:pre-wrap;user-select:none;pointer-events:none";
	holder.append(fragment);
	document.body.append(holder);
	try {
		return holder.innerText;
	} finally {
		holder.remove();
	}
}

function rangeCopyText(range: Range): string | null {
	const host = hostElement(range);
	if (!host) return null;
	// Selection wholly inside one formula: copy the whole formula's source.
	const enclosing = host.closest(FORMULA);
	if (enclosing) {
		const outer = enclosing.parentElement?.closest(".katex-display") ?? enclosing;
		const tex = texOf(outer);
		return tex === null ? null : delimited(tex, outer.matches(".katex-display")).trim();
	}
	const touched = outermostFormulas(host).filter((f) => range.intersectsNode(f));
	if (touched.length === 0) return null;
	const fragment = range.cloneContents();
	replaceFormulasWithTex(fragment, touched.map((f) => texOf(f) ?? ""));
	return laidOutText(fragment).replace(/^\n+|\n+$/g, "");
}

/** The text a copy of `selection` should put on the clipboard, or null when
 *  the selection holds no formula (or sits in an input) and the browser's
 *  default copy is right. */
export function selectionCopyText(selection: Selection): string | null {
	if (selection.isCollapsed || selection.rangeCount === 0) return null;
	const active = document.activeElement;
	if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return null;
	const parts: string[] = [];
	for (let i = 0; i < selection.rangeCount; i++) {
		const text = rangeCopyText(selection.getRangeAt(i));
		if (text === null) return null;
		parts.push(text);
	}
	return parts.join("\n");
}

/** Document-level `copy` listener: swap in the math-aware text when needed. */
export function handleMathCopy(event: ClipboardEvent): void {
	const selection = window.getSelection();
	if (!selection || !event.clipboardData) return;
	const text = selectionCopyText(selection);
	if (text === null) return;
	event.clipboardData.setData("text/plain", text);
	event.preventDefault();
}
