import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	MATERIAL_MAX_BYTES,
	imageMimeType,
	isMaterialUrl,
	materialKindFor,
	materialsPromptSection,
	type LessonMaterial,
} from "../core/materials.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { profileMaterial } from "../agent/subagents/material-profiler.ts";
import { EPUB_MAX_TEXT_BYTES, EpubError, epubToMarkdown } from "../agent/subagents/epub-markdown.ts";
import { fetchAndExtract } from "../agent/tools/web.ts";
import { materialTools } from "../agent/tools/materials.ts";
import { stores } from "./stores.ts";

/**
 * Lesson source material — the service seam (fork addition, 2026-10-24;
 * model: core/materials.ts). Adds uploads and links, profiles each
 * material ONCE in the background (one run per material, through the
 * shared background-LLM permits), and hands each turn its prompt section
 * and lookup tools.
 *
 * Crash safety: a material left "reading" by a dead process has no live
 * run — any read of the lesson's materials restarts it.
 */

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

interface Run {
	promise: Promise<void>;
	controller: AbortController;
}
const KEY = Symbol.for("lh.materialRuns");
function runs(): Map<string, Run> {
	const g = globalThis as Record<symbol, Map<string, Run> | undefined>;
	g[KEY] ??= new Map();
	return g[KEY];
}
const runKey = (chatId: string, id: string) => `${chatId}/${id}`;

function lessonExists(chatId: string): boolean {
	return stores.chatStore.getChat(chatId) !== null;
}

function lessonStarted(chatId: string): boolean {
	return (stores.chatStore.getChat(chatId)?.messages ?? []).some((m) => (m as { role?: string }).role === "assistant");
}

/** Profile one material in the background (idempotent per material). */
function startProfile(chatId: string, material: LessonMaterial): Promise<void> {
	const key = runKey(chatId, material.id);
	const live = runs().get(key);
	if (live) return live.promise;
	const controller = new AbortController();
	const { materialStore } = stores;
	const promise = (async () => {
		const spec = resolveRoleSpec("pdfReader", stores.settingsStore.readSettings());
		if (!spec) {
			materialStore.update(chatId, material.id, {
				status: "error",
				error: "no vision model is configured (Settings → Agent: the vision slot reads source material)",
			});
			return;
		}
		try {
			// The profiler's model requests pass the process-wide worker-request admission (the one background-LLM pool).
			const result = await profileMaterial(
				{
					kind: material.kind,
					name: material.name,
					path: materialStore.filePath(chatId, material),
					mimeType: material.mimeType,
				},
				{ engine: piEngineForSpec(spec), abortSignal: controller.signal, chatId },
			);
			if (result.transcript !== undefined) {
				fs.writeFileSync(materialStore.auxPath(chatId, material.id, "content.md"), result.transcript, "utf8");
			}
			materialStore.update(chatId, material.id, {
				status: "ready",
				profile: result.profile,
				...(result.pages !== undefined ? { pages: result.pages } : {}),
				error: undefined,
			});
		} catch (err) {
			if (controller.signal.aborted) return; // removed while reading
			materialStore.update(chatId, material.id, {
				status: "error",
				error: err instanceof Error ? err.message : String(err),
			});
		}
	})().finally(() => runs().delete(key));
	runs().set(key, { promise, controller });
	return promise;
}

/** The lesson's materials — restarting any read a dead process left behind. */
export function listMaterials(chatId: string): LessonMaterial[] {
	const materials = stores.materialStore.list(chatId);
	for (const m of materials) if (m.status === "reading" && !runs().has(runKey(chatId, m.id))) void startProfile(chatId, m);
	return materials;
}

/** Why an EPUB was refused, in the learner's terms. */
function epubRefusal(name: string, err: unknown): { ok: false; status: number; error: string } {
	const reason = err instanceof EpubError ? err.reason : "unreadable";
	if (reason === "drm") return { ok: false, status: 422, error: `${name} is DRM-protected and cannot be read` };
	if (reason === "empty") return { ok: false, status: 422, error: `${name} has no readable text` };
	if (reason === "too-large") {
		return { ok: false, status: 413, error: `${name} holds more than ${EPUB_MAX_TEXT_BYTES / 1024 / 1024} MB of text` };
	}
	return { ok: false, status: 422, error: `${name} is not a readable EPUB` };
}

/** What the lesson keeps of an upload: the file itself — or, for an EPUB, the Markdown it converts to. */
function storedCopy(
	kind: Exclude<LessonMaterial["kind"], "web">,
	file: { name: string; type: string; bytes: Uint8Array },
): Result<{ ext: string; bytes: Uint8Array; mimeType?: string }> {
	if (kind === "epub") {
		try {
			return { ok: true, value: { ext: ".md", bytes: new TextEncoder().encode(epubToMarkdown(file.bytes).markdown), mimeType: "text/markdown" } };
		} catch (err) {
			return epubRefusal(file.name, err);
		}
	}
	return {
		ok: true,
		value: {
			ext: path.extname(file.name) || (kind === "pdf" ? ".pdf" : kind === "text" ? ".txt" : ".png"),
			bytes: file.bytes,
			mimeType: kind === "image" ? (file.type.startsWith("image/") ? file.type : imageMimeType(file.name)) : file.type || undefined,
		},
	};
}

/** Add an uploaded file. */
export function addUploadedMaterial(
	chatId: string,
	file: { name: string; type: string; bytes: Uint8Array },
): Result<LessonMaterial> {
	if (!lessonExists(chatId)) return { ok: false, status: 404, error: "Unknown chat" };
	const kind = materialKindFor(file.name, file.type);
	if (!kind) return { ok: false, status: 415, error: `Unsupported file type: ${file.name} (PDF, EPUB, text, Markdown or an image)` };
	if (file.bytes.byteLength === 0) return { ok: false, status: 400, error: `${file.name} is empty` };
	if (file.bytes.byteLength > MATERIAL_MAX_BYTES) {
		return { ok: false, status: 413, error: `${file.name} is larger than ${MATERIAL_MAX_BYTES / 1024 / 1024} MB` };
	}
	const copy = storedCopy(kind, file);
	if (!copy.ok) return copy;
	const material = stores.materialStore.add(chatId, {
		kind,
		name: path.basename(file.name),
		...copy.value,
		addedMidLesson: lessonStarted(chatId),
	});
	void startProfile(chatId, material);
	return { ok: true, value: material };
}

/** Add a web page: fetched once, stored as its extracted Markdown. */
export async function addLinkMaterial(chatId: string, url: string): Promise<Result<LessonMaterial>> {
	if (!lessonExists(chatId)) return { ok: false, status: 404, error: "Unknown chat" };
	if (!isMaterialUrl(url)) return { ok: false, status: 400, error: "The link must be an http(s) address" };
	let markdown: string;
	try {
		markdown = await fetchAndExtract(url.trim());
	} catch (err) {
		return { ok: false, status: 502, error: `Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}` };
	}
	if (!markdown.trim()) return { ok: false, status: 422, error: `${url} has no readable text` };
	const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
	const u = new URL(url.trim());
	const material = stores.materialStore.add(chatId, {
		kind: "web",
		name: (title ?? `${u.host}${u.pathname === "/" ? "" : u.pathname}`).slice(0, 120),
		ext: ".md",
		bytes: new TextEncoder().encode(markdown),
		url: url.trim(),
		mimeType: "text/markdown",
		addedMidLesson: lessonStarted(chatId),
	});
	void startProfile(chatId, material);
	return { ok: true, value: material };
}

/** Remove one material, stopping its read if one is running. */
export function removeMaterial(chatId: string, id: string): boolean {
	runs().get(runKey(chatId, id))?.controller.abort();
	return stores.materialStore.remove(chatId, id);
}

/** Wait (bounded) until no material of the lesson is still being read. */
export async function waitForMaterials(chatId: string, timeoutMs = 180_000): Promise<void> {
	const pending = listMaterials(chatId)
		.filter((m) => m.status === "reading")
		.map((m) => runs().get(runKey(chatId, m.id))?.promise)
		.filter((p): p is Promise<void> => !!p);
	if (pending.length === 0) return;
	await Promise.race([Promise.allSettled(pending), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** A turn's view of the lesson's material: the prompt section and the
 *  lookup tools; undefined when the lesson has none. */
export function materialsForTurn(chatId: string): { section: string; tools: AgentTool<any>[] } | undefined {
	const store = stores.materialStore;
	const materials = listMaterials(chatId);
	// the teacher's last message: material newer than it is announced once
	const messages = stores.chatStore.getChat(chatId)?.messages ?? [];
	const lastAssistant = [...messages].reverse().find((m) => (m as { role?: string }).role === "assistant") as
		| { timestamp?: number }
		| undefined;
	const section = materialsPromptSection(materials, (m) => store.filePath(chatId, m), lastAssistant?.timestamp);
	if (!section) return undefined;
	return { section, tools: Object.values(materialTools({ chatId, store })) };
}
