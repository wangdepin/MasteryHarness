/**
 * Lesson source material (fork addition, 2026-10-24). PURE, browser-safe.
 *
 * A lesson can carry source material — PDFs, text/Markdown, web pages,
 * images — that defines what the lesson is FOR. Each item is copied into
 * the lesson's data folder (src/store/materials.ts), read once in the
 * background into a PROFILE (scope, targets, definitions, notation, order,
 * exercise style — src/agent/subagents/material-profiler.ts), and the
 * profiles ride every conversation turn's system prompt with the rules
 * below. Two tools look up exact passages on demand.
 *
 * Named "materials" in code: the graph already has "sources" (imported
 * notes' provenance, graph/sources.json) — a different thing.
 */

export type MaterialKind = "pdf" | "text" | "image" | "web";

/** reading: being profiled · ready: profiled · error: profiling failed
 *  (the raw file still serves the lookup tools). */
export type MaterialStatus = "reading" | "ready" | "error";

export interface LessonMaterial {
	/** "mat_…", unique within the lesson. */
	id: string;
	kind: MaterialKind;
	/** Display name: the file name, or the page's title for a link. */
	name: string;
	/** The stored copy's file name inside the material's folder. */
	file: string;
	/** A link's address. */
	url?: string;
	mimeType?: string;
	bytes: number;
	/** PDFs: page count. */
	pages?: number;
	addedAt: string;
	/** Added after the lesson's first turn (the prompt flags it once). */
	addedMidLesson?: boolean;
	status: MaterialStatus;
	error?: string;
	/** The reading profile (Markdown, page-cited for PDFs). */
	profile?: string;
}

/** Upload ceiling: textbooks are big, but a lesson's copy is local disk. */
export const MATERIAL_MAX_BYTES = 100 * 1024 * 1024;

/** An upload body the server could not parse — in practice one cut off at
 *  the proxy's body limit (next.config.ts), so it names the ceiling. */
export const UNREADABLE_UPLOAD = `The upload could not be read — it may be larger than ${MATERIAL_MAX_BYTES / 1024 / 1024} MB.`;

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".text"]);
const IMAGE_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
};

/** Which kind a file is, by extension then MIME; null = unsupported. Pure. */
export function materialKindFor(fileName: string, mimeType = ""): Exclude<MaterialKind, "web"> | null {
	const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
	if (ext === ".pdf" || mimeType === "application/pdf") return "pdf";
	if (TEXT_EXT.has(ext) || mimeType === "text/plain" || mimeType === "text/markdown") return "text";
	if (ext in IMAGE_EXT || mimeType.startsWith("image/")) return "image";
	return null;
}

/** An image's MIME type from its file name (the vision call needs one). */
export function imageMimeType(fileName: string): string {
	const ext = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
	return IMAGE_EXT[ext] ?? "image/png";
}

/** What the attach control accepts (the file picker's `accept`). */
export const MATERIAL_ACCEPT = ".pdf,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif";

/** Is this an http(s) address a link material can fetch? Pure. */
export function isMaterialUrl(value: string): boolean {
	try {
		const u = new URL(value.trim());
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

/** How the lesson treats its material — the owner's rule (2026-10-24). */
export const MATERIAL_RULES = `The learner attached the source material below. It defines this lesson:
- TARGET AND SCOPE: what the material covers and expects is what the learner must end up able to do. When you clarify the goal or plan the lesson, start from the material's targets, and make sure every one of them is met before the lesson ends.
- DEFINITIONS, NOTATION, TERMINOLOGY: use the material's own — its definitions, symbols, sign and naming conventions, and terms — so the learner can go straight back to it.
- EXPLANATIONS AND ORDER: you may explain things your own way, add intuition, examples and other perspectives that make it easier to learn, and teach in a different order than the material, as long as all its targets are met.
- CITE AND FLAG: cite the material where you rely on it — "(name, p. N)" for PDFs, the section for other material. Say explicitly when you go beyond the material or explain something differently from how it does.
- LOOK IT UP: the profiles below are summaries. Before quoting a definition, a theorem or an exercise, check the exact wording with material_search / material_read. For math-heavy or diagram pages of a PDF, dispatch a pdf job on its stored path to have the pages read visually.`;

/** One material's block in the system prompt. Pure. */
export function materialBlock(m: LessonMaterial, path: string): string {
	const kind = m.kind === "pdf" ? `PDF${m.pages ? `, ${m.pages} pages` : ""}` : m.kind === "web" ? `web page, ${m.url}` : m.kind;
	const head = `<material id="${m.id}" name="${m.name}" kind="${kind}" path="${path}"${m.addedMidLesson ? ' added="during the lesson"' : ""}>`;
	const body =
		m.status === "ready" && m.profile
			? m.profile.trim()
			: m.status === "reading"
				? "(Still being read — its profile is not ready yet. Use material_search / material_read on it directly.)"
				: `(Its profile could not be built${m.error ? `: ${m.error}` : ""}. Use material_search / material_read on it directly.)`;
	return `${head}\n${body}\n</material>`;
}

/**
 * The lesson's source-material section for the conversation agents'
 * system prompt; undefined when the lesson has none. `pathOf` gives each
 * material's stored file (the pdf job's input). `newSince` (ms) is the
 * teacher's last message: material added after it gets a one-time "take
 * this into account" note — once answered, the note is gone. Pure.
 */
export function materialsPromptSection(
	materials: readonly LessonMaterial[],
	pathOf: (m: LessonMaterial) => string,
	newSince?: number,
): string | undefined {
	if (materials.length === 0) return undefined;
	const added = materials.filter((m) => m.addedMidLesson && newSince !== undefined && Date.parse(m.addedAt) > newSince);
	const note =
		added.length > 0
			? `\n\nJust added by the learner: ${added.map((m) => `"${m.name}"`).join(", ")}. If this changes the lesson's target or scope, say how you will take it into account and adjust the plan.`
			: "";
	return `<source_material>\n${MATERIAL_RULES}${note}\n\n${materials.map((m) => materialBlock(m, pathOf(m))).join("\n\n")}\n</source_material>`;
}
