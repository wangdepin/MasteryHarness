import { strToU8, zipSync } from "fflate";

export const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

export const xhtml = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>ignored</title><style>p { color: red }</style></head><body>${body}</body></html>`;

export interface BookSpec {
	chapters: Record<string, string>;
	/** Spine order (default: the chapters as given). */
	spine?: string[];
	nav?: string;
	ncx?: string;
	extra?: Record<string, string>;
	title?: string;
}

/** An EPUB as bytes: the chapters in a spine, with an optional nav (EPUB 3) or NCX (EPUB 2). */
export function book(spec: BookSpec): Uint8Array {
	const names = Object.keys(spec.chapters);
	const id = (name: string) => name.replace(/\W/g, "_");
	const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${spec.title === "" ? "" : `<dc:title>${spec.title ?? "Calculus Notes"}</dc:title>`}
    <dc:creator>Ada Writer</dc:creator>
  </metadata>
  <manifest>
    ${names.map((name) => `<item id="${id(name)}" href="${name}" media-type="application/xhtml+xml"/>`).join("\n    ")}
    ${spec.nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ""}
    ${spec.ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ""}
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine${spec.ncx ? ' toc="ncx"' : ""}>
    ${(spec.spine ?? names).map((name) => `<itemref idref="${id(name)}"/>`).join("\n    ")}
  </spine>
</package>`;
	const files: Record<string, Uint8Array> = {
		mimetype: strToU8("application/epub+zip"),
		"META-INF/container.xml": strToU8(CONTAINER),
		"OEBPS/content.opf": strToU8(opf),
		"OEBPS/images/cover.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
	};
	for (const [name, body] of Object.entries(spec.chapters)) files[`OEBPS/${name}`] = strToU8(xhtml(body));
	if (spec.nav) files["OEBPS/nav.xhtml"] = strToU8(xhtml(spec.nav));
	if (spec.ncx) files["OEBPS/toc.ncx"] = strToU8(spec.ncx);
	for (const [name, text] of Object.entries(spec.extra ?? {})) files[name] = strToU8(text);
	return zipSync(files);
}
