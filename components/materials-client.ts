"use client";

import { useSyncExternalStore } from "react";
import { MATERIAL_MAX_BYTES, type LessonMaterial } from "@/src/core";

/**
 * Lesson source material — the client half (fork addition, 2026-10-24):
 * the API calls, and the DRAFT store. A new lesson has no chat id until
 * its first send, so the new-lesson screen's attachments wait here
 * (module-level, like dictation's target registry: one window, one draft)
 * and the send path uploads them right after creating the lesson.
 */

export type DraftMaterial = { key: string; kind: "file"; file: File } | { key: string; kind: "link"; url: string };

let draft: DraftMaterial[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const draftMaterials = {
	get: (): DraftMaterial[] => draft,
	add(items: DraftMaterial[]) {
		draft = [...draft, ...items];
		emit();
	},
	remove(key: string) {
		draft = draft.filter((d) => d.key !== key);
		emit();
	},
	clear() {
		draft = [];
		emit();
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

const EMPTY: DraftMaterial[] = [];
export function useDraftMaterials(): DraftMaterial[] {
	return useSyncExternalStore(draftMaterials.subscribe, draftMaterials.get, () => EMPTY);
}

let seq = 0;
export const draftKey = () => `d${++seq}`;

/** A lesson's source-material endpoint. Pure. */
export function materialsPath(chatId: string): string {
	return `/api/chats/${chatId}/materials`;
}

export async function fetchMaterials(chatId: string, fetchLike: typeof fetch = fetch): Promise<LessonMaterial[]> {
	const res = await fetchLike(materialsPath(chatId));
	if (!res.ok) return [];
	return ((await res.json()) as { materials?: LessonMaterial[] }).materials ?? [];
}

/** Upload files, ONE PER REQUEST (2026-10-25: the server's body limit is
 *  per request — next.config.ts — and one bad file must not block the
 *  rest). A file over the ceiling is refused without sending it.
 *  Resolves to the failures joined with "; ", or null when all landed. */
export async function uploadFiles(chatId: string, files: readonly File[], fetchLike: typeof fetch = fetch): Promise<string | null> {
	const errors: string[] = [];
	for (const f of files) {
		if (f.size > MATERIAL_MAX_BYTES) {
			errors.push(`${f.name} is larger than ${MATERIAL_MAX_BYTES / 1024 / 1024} MB`);
			continue;
		}
		const form = new FormData();
		form.append("file", f, f.name);
		const res = await fetchLike(materialsPath(chatId), { method: "POST", body: form }).catch(() => null);
		if (res?.ok) continue;
		const error = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
		errors.push(error ?? `${f.name}: upload failed${res ? ` (${res.status})` : ""}`);
	}
	return errors.length > 0 ? errors.join("; ") : null;
}

export async function addLink(chatId: string, url: string, fetchLike: typeof fetch = fetch): Promise<string | null> {
	const res = await fetchLike(materialsPath(chatId), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url }),
	});
	if (res.ok) return null;
	return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `could not add the link (${res.status})`;
}

/** The send path's half of a draft: upload everything attached on the
 *  new-lesson screen into the freshly created lesson, then clear the
 *  draft. Errors are reported, never thrown — the lesson starts anyway
 *  (its Sources pill shows what made it). */
export async function uploadDraftMaterials(chatId: string, fetchLike: typeof fetch = fetch): Promise<string[]> {
	const items = draftMaterials.get();
	if (items.length === 0) return [];
	const errors: string[] = [];
	const files = items.flatMap((d) => (d.kind === "file" ? [d.file] : []));
	const fileError = await uploadFiles(chatId, files, fetchLike).catch(() => "upload failed");
	if (fileError) errors.push(fileError);
	for (const d of items) {
		if (d.kind !== "link") continue;
		const err = await addLink(chatId, d.url, fetchLike).catch(() => "could not add the link");
		if (err) errors.push(err);
	}
	draftMaterials.clear();
	return errors;
}

/** Wait (bounded) until none of the lesson's materials is still being
 *  read — the new lesson's first message holds for its profiles. */
export async function waitForMaterialsRead(chatId: string, timeoutMs = 180_000, pollMs = 1500): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const materials = await fetchMaterials(chatId).catch(() => []);
		if (!materials.some((m) => m.status === "reading")) return;
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
}
