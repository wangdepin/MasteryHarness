/**
 * EPUB → Markdown (fork addition, 2026-11-12): books are built in memory
 * with fflate, so every case states exactly what the zip holds. Covers
 * EPUB 3 (nav) and EPUB 2 (NCX), chapters without a heading, XHTML
 * self-closing tags, figures and MathML, and the four refusals.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { EpubError, chapterMarkdown, epubToMarkdown, expandSelfClosing, resolveHref } from "../src/agent/subagents/epub-markdown.ts";
import { CONTAINER, book, xhtml } from "./helpers/epub.ts";

const refusal = (reason: EpubError["reason"]) => (err: unknown) => err instanceof EpubError && err.reason === reason;

describe("the pure pieces", () => {
	it("resolves references to zip entry names", () => {
		for (const [baseDir, href, expected] of [
			["OEBPS", "ch1.xhtml", "OEBPS/ch1.xhtml"],
			["OEBPS", "text/ch%201.xhtml#sec2", "OEBPS/text/ch 1.xhtml"],
			["OEBPS/nav", "../text/ch1.xhtml", "OEBPS/text/ch1.xhtml"],
			[".", "content.opf", "content.opf"],
			["", "/OEBPS/100%.xhtml", "OEBPS/100%.xhtml"],
		] as const) {
			assert.equal(resolveHref(baseDir, href), expected, `${baseDir} + ${href}`);
		}
	});

	it("spells out XHTML self-closing tags, leaving void elements alone", () => {
		assert.equal(expandSelfClosing('<a id="x"/><br/><div class="gap" /><img src="a.png"/>'), '<a id="x"></a><br/><div class="gap"></div><img src="a.png"/>');
	});

	it("a self-closed element does not swallow the text after it", () => {
		assert.equal(chapterMarkdown(xhtml('<h2>Limits</h2><p><a id="p12"/>A limit is a value.</p><div/><p>Next.</p>')), "## Limits\n\nA limit is a value.\n\nNext.");
	});

	it("figures become placeholders and head content is dropped", () => {
		const markdown = chapterMarkdown(xhtml('<p>See <img src="a.png" alt="The unit\n circle"/> and <img src="b.png"/>.</p><svg><image href="c.png"/></svg>'));
		assert.equal(markdown, "See [figure: The unit circle] and [figure].\n\n[figure]");
		assert.doesNotMatch(markdown, /ignored|color/);
	});

	it("a bare <pre> is a fenced listing: its comments are not headings and nothing is escaped", () => {
		const markdown = chapterMarkdown(xhtml('<p>Run:</p><pre data-type="programlisting"># ----\ndef get_args(): <img alt="1" src="1.png"/>\n    return `x`\n</pre><pre><code>ok_1</code></pre>'));
		assert.equal(markdown, "Run:\n\n```\n# ----\ndef get_args(): \n    return `x`\n```\n\n```\nok_1\n```");
	});

	it("links inside the book keep their text only; links to the web stay links", () => {
		const markdown = chapterMarkdown(xhtml('<p>See <a href="ch03.xhtml#fig-2">Figure 2</a>, <a href="#note1">note 1</a> and <a href="https://example.org/a">the site</a>.</p>'));
		assert.equal(markdown, "See Figure 2, note 1 and [the site](https://example.org/a).");
	});

	it("MathML keeps its TeX annotation, inline and display; without one, its text", () => {
		const tex = (display: string) =>
			`<math xmlns="http://www.w3.org/1998/Math/MathML"${display}><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x_1^2</annotation></semantics></math>`;
		assert.equal(chapterMarkdown(xhtml(`<p>Let ${tex("")} be given.</p>`)), "Let $x_1^2$ be given.");
		assert.equal(chapterMarkdown(xhtml(`<p>Then</p>${tex(' display="block"')}<p>holds.</p>`)), "Then\n\n$$\nx_1^2\n$$\n\nholds.");
		assert.equal(chapterMarkdown(xhtml("<p>So <math><mi>a</mi><mo>+</mo><mi>b</mi></math>.</p>")), "So a+b.");
	});
});

describe("a book", () => {
	it("EPUB 3: chapters in spine order, under the book's title and author", () => {
		const out = epubToMarkdown(
			book({
				chapters: { "ch2.xhtml": "<h1>Derivatives</h1><p>The slope.</p>", "ch1.xhtml": "<h1>Limits</h1><p>The approach.</p>" },
				spine: ["ch1.xhtml", "ch2.xhtml"],
			}),
		);
		assert.equal(out.markdown, "# Calculus Notes\n\nAuthor: Ada Writer\n\n# Limits\n\nThe approach.\n\n# Derivatives\n\nThe slope.\n");
		assert.equal(out.title, "Calculus Notes");
		assert.equal(out.chapters, 2);
	});

	it("a chapter that opens without a heading is named from the nav, at the level the others use", () => {
		const out = epubToMarkdown(
			book({
				chapters: {
					"preface.xhtml": "<p>Why this book.</p>",
					"ch1.xhtml": "<h2>Limits</h2><p>The approach.</p>",
					"ch2.xhtml": "<h2>Derivatives</h2><p>The slope.</p>",
				},
				nav: '<nav epub:type="landmarks"><a href="ch1.xhtml">Start</a></nav><nav epub:type="toc"><ol><li><a href="preface.xhtml">Preface</a></li><li><a href="ch1.xhtml#top">One</a></li></ol></nav>',
			}),
		);
		assert.match(out.markdown, /\n## Preface\n\nWhy this book\.\n\n## Limits\n/);
		assert.doesNotMatch(out.markdown, /One|Start/, "a chapter with its own heading keeps it");
	});

	it("EPUB 2: the NCX names the chapters, nested points included", () => {
		const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
			<navPoint id="p1"><navLabel><text>Part One</text></navLabel><content src="part1.xhtml"/>
				<navPoint id="p2"><navLabel><text>The First Chapter</text></navLabel><content src="ch1.xhtml#a"/></navPoint>
			</navPoint></navMap></ncx>`;
		const out = epubToMarkdown(book({ chapters: { "part1.xhtml": "<p>Opening words.</p>", "ch1.xhtml": "<p>Body text.</p>" }, ncx }));
		assert.match(out.markdown, /# Part One\n\nOpening words\.\n\n# The First Chapter\n\nBody text\.\n$/);
	});

	it("pages without text (a cover image) are left out, and a missing title is no heading", () => {
		const out = epubToMarkdown(book({ title: "", chapters: { "cover.xhtml": '<img src="images/cover.jpg" alt="Cover"/>', "ch1.xhtml": "<h1>Limits</h1><p>Text.</p>" } }));
		assert.equal(out.markdown, "Author: Ada Writer\n\n# Limits\n\nText.\n");
		assert.equal(out.chapters, 1);
	});
});

describe("refusals", () => {
	const encryption = (uri: string, algorithm: string) => `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData>
</encryption>`;
	const chapters = { "ch1.xhtml": "<h1>Limits</h1><p>Text.</p>" };

	it("encrypted chapters are DRM", () => {
		const drm = book({ chapters, extra: { "META-INF/encryption.xml": encryption("OEBPS/ch1.xhtml", "http://www.w3.org/2001/04/xmlenc#aes128-cbc") } });
		assert.throws(() => epubToMarkdown(drm), refusal("drm"));
	});

	it("obfuscated fonts alone are not", () => {
		const fonts = book({ chapters, extra: { "META-INF/encryption.xml": encryption("OEBPS/fonts/serif.otf", "http://www.idpf.org/2008/embedding") } });
		assert.equal(epubToMarkdown(fonts).chapters, 1);
	});

	it("bytes that are not a zip, a zip that is not an EPUB, and a package without chapters are unreadable", () => {
		assert.throws(() => epubToMarkdown(strToU8("%PDF-1.7 not a zip at all")), refusal("unreadable"));
		assert.throws(() => epubToMarkdown(zipSync({ "notes.txt": strToU8("hello") })), refusal("unreadable"));
		assert.throws(() => epubToMarkdown(zipSync({ "META-INF/container.xml": strToU8(CONTAINER) })), refusal("unreadable"));
		assert.throws(() => epubToMarkdown(book({ chapters: {} })), refusal("unreadable"));
	});

	it("a book whose chapters hold no text is empty", () => {
		assert.throws(() => epubToMarkdown(book({ chapters: { "cover.xhtml": '<img src="images/cover.jpg"/>' } })), refusal("empty"));
	});

	it("text past the ceiling is refused by its declared size, before it is inflated", () => {
		const big = book({ chapters: { "ch1.xhtml": `<p>${"word ".repeat(2000)}</p>` } });
		assert.throws(() => epubToMarkdown(big, 4000), refusal("too-large"));
		assert.equal(epubToMarkdown(big, 1_000_000).chapters, 1);
	});
});
