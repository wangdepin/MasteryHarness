import * as path from "node:path";
import { unzipSync } from "fflate";
import { DOMParser, parseHTML } from "linkedom";
import TurndownService from "turndown";

/**
 * EPUB → Markdown (fork addition, 2026-11-12). An EPUB is a zip: a package
 * file (OPF) lists XHTML chapters in reading order (the spine), and a nav
 * document (EPUB 3) or NCX (EPUB 2) names them. The book becomes ONE
 * Markdown text, chapter after chapter, which then lives as a lesson's
 * source material exactly like a text file (profiled, searched and read by
 * line — server/materials.ts).
 *
 * Read in memory only: nothing is unpacked to disk, and only the package
 * file, the table of contents and the chapters are inflated — never
 * images, fonts or styles. Figures become "[figure: alt]" placeholders;
 * MathML keeps its TeX annotation when it has one; links inside the book
 * keep their text only (their targets are files the reader cannot open).
 */

/** Why a book could not be converted. */
export type EpubFailure = "drm" | "unreadable" | "empty" | "too-large";

export class EpubError extends Error {
	readonly reason: EpubFailure;
	constructor(reason: EpubFailure, detail: string) {
		super(detail);
		this.name = "EpubError";
		this.reason = reason;
	}
}

/** The most text a book may unpack to (declared sizes, checked before inflating). */
export const EPUB_MAX_TEXT_BYTES = 50 * 1024 * 1024;

export interface EpubMarkdown {
	markdown: string;
	/** The book's title from its package file. */
	title?: string;
	/** How many chapters carried text. */
	chapters: number;
}

const CONTAINER = "META-INF/container.xml";
const ENCRYPTION = "META-INF/encryption.xml";

/** A reader over the zip that inflates only the entries asked for, within the text ceiling. */
function zipReader(bytes: Uint8Array, maxTextBytes: number): (names: ReadonlySet<string>) => Map<string, Uint8Array> {
	let total = 0;
	return (names) => {
		try {
			const files = unzipSync(bytes, {
				filter: (file) => {
					if (!names.has(file.name)) return false;
					total += file.originalSize;
					if (total > maxTextBytes) throw new EpubError("too-large", "the book's text is over the size ceiling");
					return true;
				},
			});
			return new Map(Object.entries(files));
		} catch (err) {
			if (err instanceof EpubError) throw err;
			throw new EpubError("unreadable", err instanceof Error ? err.message : String(err));
		}
	};
}

function decode(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
	return new TextDecoder("utf-8").decode(bytes);
}

function parseXml(xml: string): Document {
	return new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
}

/** Elements by local name, whatever their namespace prefix ("dc:title", "opf:item"). */
function elements(root: Document | Element, localName: string): Element[] {
	return Array.from(root.querySelectorAll("*")).filter((el) => el.tagName.replace(/^.*:/, "").toLowerCase() === localName);
}

/** A manifest or TOC reference as a zip entry name: fragment dropped, percent-decoded, relative to `baseDir`. Pure. */
export function resolveHref(baseDir: string, href: string): string {
	const bare = href.split("#")[0] ?? "";
	let decoded = bare;
	try {
		decoded = decodeURIComponent(bare);
	} catch {
		// a stray "%" in a file name: use it as written
	}
	return path.posix.normalize(path.posix.join(baseDir, decoded)).replace(/^\/+/, "");
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * XHTML allows `<div/>` and `<title/>`; an HTML parser reads those as
 * OPENING tags and swallows what follows. Spell them out as pairs. Pure.
 */
export function expandSelfClosing(xhtml: string): string {
	return xhtml.replace(/<([A-Za-z][\w:.-]*)((?:\s[^<>]*?)?)\s*\/>/g, (all, tag: string, attrs: string) =>
		VOID_TAGS.has(tag.toLowerCase()) ? all : `<${tag}${attrs}></${tag}>`,
	);
}

const oneLine = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

const FIGURE = /\[figure(?:: [^\]]*)?\]/g;

/** A code listing as a fenced block, the fence longer than any backtick run inside it. Pure. */
function fenced(code: string): string {
	const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(longest + 1);
	return `\n\n${fence}\n${code.replace(/\n+$/, "")}\n${fence}\n\n`;
}

function chapterTurndown(): TurndownService {
	const service = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		// Turndown drops elements without text before any rule sees them; an <svg> picture is one.
		blankReplacement: (_content, node) =>
			node.nodeName.toLowerCase() === "svg" ? "\n\n[figure]\n\n" : (node as { isBlock?: boolean }).isBlock ? "\n\n" : "",
	});
	service.remove(["script", "style", "title"]);
	service.addRule("figure", {
		filter: (node) => ["img", "svg"].includes(node.nodeName.toLowerCase()),
		replacement: (_content, node) => {
			const alt = oneLine((node as Element).getAttribute("alt")).replace(/\]/g, ")");
			return alt ? `[figure: ${alt}]` : "[figure]";
		},
	});
	// Turndown fences only <pre><code>; a bare <pre> would come out as prose, its "# comment" lines reading as headings.
	service.addRule("listing", {
		filter: (node) => node.nodeName === "PRE" && node.firstChild?.nodeName !== "CODE",
		replacement: (_content, node) => fenced(node.textContent ?? ""),
	});
	service.addRule("link-inside-the-book", {
		filter: (node) => node.nodeName === "A" && !/^(https?:|mailto:)/i.test((node as Element).getAttribute("href") ?? ""),
		replacement: (content) => content,
	});
	service.addRule("math", {
		filter: (node) => node.nodeName.toLowerCase() === "math",
		replacement: (_content, node) => {
			const math = node as Element;
			const tex = Array.from(math.querySelectorAll("annotation"))
				.find((a) => /tex/i.test(a.getAttribute("encoding") ?? ""))
				?.textContent?.trim();
			if (!tex) return oneLine(math.textContent);
			return math.getAttribute("display") === "block" ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
		},
	});
	return service;
}

const turndown = chapterTurndown();

/** One XHTML chapter as Markdown. */
export function chapterMarkdown(xhtml: string): string {
	const expanded = expandSelfClosing(xhtml);
	const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(expanded)?.[1] ?? expanded;
	return turndown.turndown(body).trim();
}

/** Does the chapter say anything besides figure placeholders? Pure. */
function hasText(markdown: string): boolean {
	return markdown.replace(FIGURE, "").trim().length > 0;
}

const HEADING = /^(#{1,6})\s/;

interface Package {
	title?: string;
	creators: string[];
	/** Chapter entry names in reading order. */
	spine: string[];
	nav?: string;
	ncx?: string;
}

function readPackage(opf: string, opfPath: string): Package {
	const doc = parseXml(opf);
	const baseDir = path.posix.dirname(opfPath);
	const items = new Map<string, { path: string; type: string; properties: string }>();
	for (const item of elements(doc, "item")) {
		const id = item.getAttribute("id");
		const href = item.getAttribute("href");
		if (!id || !href) continue;
		items.set(id, {
			path: resolveHref(baseDir, href),
			type: item.getAttribute("media-type") ?? "",
			properties: item.getAttribute("properties") ?? "",
		});
	}
	const isChapter = (item: { path: string; type: string }) => /x?html/i.test(item.type) || /\.x?html?$/i.test(item.path);
	const spine = elements(doc, "itemref")
		.map((ref) => items.get(ref.getAttribute("idref") ?? ""))
		.filter((item): item is NonNullable<typeof item> => !!item && isChapter(item))
		.map((item) => item.path);
	const tocId = elements(doc, "spine")[0]?.getAttribute("toc");
	return {
		title: oneLine(elements(doc, "title")[0]?.textContent) || undefined,
		creators: elements(doc, "creator").map((el) => oneLine(el.textContent)).filter(Boolean),
		spine: [...new Set(spine)],
		nav: [...items.values()].find((item) => /\bnav\b/.test(item.properties))?.path,
		ncx: (tocId ? items.get(tocId) : undefined)?.path ?? [...items.values()].find((item) => /dtbncx/i.test(item.type))?.path,
	};
}

/** Chapter entry name → its title in the EPUB 3 nav document (the first entry that points at the file). */
function navTitles(xhtml: string, navPath: string): Map<string, string> {
	const { document } = parseHTML(expandSelfClosing(xhtml));
	const navs = Array.from(document.querySelectorAll("nav")) as Element[];
	const toc = navs.find((nav) => /\btoc\b/.test(nav.getAttribute("epub:type") ?? "")) ?? navs[0];
	const titles = new Map<string, string>();
	const baseDir = path.posix.dirname(navPath);
	for (const link of Array.from(toc?.querySelectorAll("a") ?? [])) {
		const href = link.getAttribute("href");
		const title = oneLine(link.textContent);
		if (!href || !title) continue;
		const target = resolveHref(baseDir, href);
		if (!titles.has(target)) titles.set(target, title);
	}
	return titles;
}

/** The same from an EPUB 2 NCX. */
function ncxTitles(xml: string, ncxPath: string): Map<string, string> {
	const titles = new Map<string, string>();
	const baseDir = path.posix.dirname(ncxPath);
	for (const point of elements(parseXml(xml), "navpoint")) {
		const src = elements(point, "content")[0]?.getAttribute("src");
		const title = oneLine(elements(point, "text")[0]?.textContent);
		if (!src || !title) continue;
		const target = resolveHref(baseDir, src);
		if (!titles.has(target)) titles.set(target, title);
	}
	return titles;
}

/** Entry names the container's encryption file marks as encrypted. */
function encryptedEntries(xml: string | undefined): Set<string> {
	if (!xml) return new Set();
	return new Set(
		elements(parseXml(xml), "cipherreference")
			.map((ref) => ref.getAttribute("URI"))
			.filter((uri): uri is string => !!uri)
			.map((uri) => resolveHref("", uri)),
	);
}

/** The heading level most chapters open with (1 when none does). Pure. */
function chapterHeadingLevel(chapters: readonly string[]): number {
	const counts = new Map<number, number>();
	for (const chapter of chapters) {
		const level = HEADING.exec(chapter)?.[1]?.length;
		if (level) counts.set(level, (counts.get(level) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
}

/**
 * Convert an EPUB's bytes to one Markdown text. Throws EpubError: "drm"
 * when the package or a chapter is encrypted (obfuscated fonts alone are
 * fine), "unreadable" when it is not a well-formed EPUB, "empty" when no
 * chapter has text, "too-large" past `maxTextBytes`.
 */
export function epubToMarkdown(bytes: Uint8Array, maxTextBytes = EPUB_MAX_TEXT_BYTES): EpubMarkdown {
	const read = zipReader(bytes, maxTextBytes);
	const meta = read(new Set([CONTAINER, ENCRYPTION]));
	const container = meta.get(CONTAINER);
	if (!container) throw new EpubError("unreadable", "no META-INF/container.xml");
	const rootfile = elements(parseXml(decode(container)), "rootfile")[0]?.getAttribute("full-path");
	if (!rootfile) throw new EpubError("unreadable", "the container names no package file");
	const opfPath = resolveHref("", rootfile);
	const encryption = meta.get(ENCRYPTION);
	const encrypted = encryptedEntries(encryption ? decode(encryption) : undefined);
	if (encrypted.has(opfPath)) throw new EpubError("drm", "the package file is encrypted");

	const opf = read(new Set([opfPath])).get(opfPath);
	if (!opf) throw new EpubError("unreadable", `no package file at ${opfPath}`);
	const pkg = readPackage(decode(opf), opfPath);
	if (pkg.spine.length === 0) throw new EpubError("unreadable", "the package lists no chapters");
	if (pkg.spine.some((entry) => encrypted.has(entry))) throw new EpubError("drm", "the chapters are encrypted");

	const toc = [pkg.nav, pkg.ncx].filter((entry): entry is string => !!entry);
	const files = read(new Set([...pkg.spine, ...toc]));
	const navFile = pkg.nav ? files.get(pkg.nav) : undefined;
	const ncxFile = pkg.ncx ? files.get(pkg.ncx) : undefined;
	const titles = new Map([
		...(ncxFile && pkg.ncx ? ncxTitles(decode(ncxFile), pkg.ncx) : []),
		...(navFile && pkg.nav ? navTitles(decode(navFile), pkg.nav) : []),
	]);

	const chapters = pkg.spine
		.map((entry) => ({ entry, markdown: files.has(entry) ? chapterMarkdown(decode(files.get(entry)!)) : "" }))
		.filter((chapter) => hasText(chapter.markdown));
	if (chapters.length === 0) throw new EpubError("empty", "no chapter has text");

	// A chapter that opens without a heading takes its name from the table of contents, at the level the others use.
	const marks = "#".repeat(chapterHeadingLevel(chapters.map((chapter) => chapter.markdown)));
	const body = chapters.map(({ entry, markdown }) => {
		const title = titles.get(entry);
		return HEADING.test(markdown) || !title ? markdown : `${marks} ${title}\n\n${markdown}`;
	});
	const head = [pkg.title ? `# ${pkg.title}` : "", pkg.creators.length > 0 ? `Author: ${pkg.creators.join(", ")}` : ""].filter(Boolean);
	return {
		markdown: `${[...head, ...body].join("\n\n")}\n`,
		...(pkg.title ? { title: pkg.title } : {}),
		chapters: chapters.length,
	};
}
