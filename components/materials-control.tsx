"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenIcon, FileTextIcon, ImageIcon, LinkIcon, Loader2Icon, XIcon } from "lucide-react";
import { usePopoverDismiss } from "./popover-dismiss.ts";
import { MATERIAL_ACCEPT, isMaterialUrl, type LessonMaterial } from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { Hint } from "@/components/ui/hint";
import {
	addLink,
	draftKey,
	draftMaterials,
	fetchMaterials,
	materialsPath,
	uploadFiles,
	useDraftMaterials,
	type DraftMaterial,
} from "@/components/materials-client";

/**
 * The Sources pill (fork addition, 2026-10-24) — the stats bar's source
 * material control, beside the model pill:
 *
 *   chat mode (chatId)  the lesson's materials (GET /api/chats/:id/materials),
 *                       each with its reading status; add files or a link,
 *                       remove — the next turn uses the change.
 *   draft mode          what the new-lesson screen will attach: held in the
 *                       draft store and uploaded right after the lesson is
 *                       created (materials-client.ts).
 */

/** One row's status line. Pure — exported for pins. */
export function materialStatusLine(m: LessonMaterial): string {
	if (m.status === "reading") return "reading…";
	if (m.status === "error") return `not read${m.error ? ` — ${m.error}` : ""}`;
	return m.kind === "pdf" && m.pages ? `${m.pages} pages` : m.kind === "web" ? "web page" : m.kind === "image" ? "image" : "text";
}

/** The pill's label. Pure. */
export function sourcesLabel(count: number, reading: number): string {
	if (reading > 0) return `Reading ${reading}…`;
	return count === 0 ? "Sources" : `Sources · ${count}`;
}

function KindIcon({ kind }: { kind: LessonMaterial["kind"] | "file" | "link" }) {
	const cls = "size-3.5 shrink-0 text-muted-foreground";
	if (kind === "web" || kind === "link") return <LinkIcon className={cls} />;
	if (kind === "image") return <ImageIcon className={cls} />;
	return <FileTextIcon className={cls} />;
}

export function MaterialsControl({ chatId }: { chatId?: string }) {
	const draft = useDraftMaterials();
	const [materials, setMaterials] = useState<LessonMaterial[]>([]);
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	const read = useCallback(() => {
		if (chatId)
			void fetchMaterials(chatId)
				.then(setMaterials)
				.catch(() => {});
	}, [chatId]);
	useEffect(read, [read]);
	// poll while anything is still being read
	const reading = materials.filter((m) => m.status === "reading").length;
	useEffect(() => {
		if (!chatId || reading === 0) return;
		const id = setInterval(read, 2000);
		return () => clearInterval(id);
	}, [chatId, reading, read]);

	// Outside pointerdown, Esc and the Android back close it through the shared popup layer (interaction-layers.tsx).
	usePopoverDismiss(containerRef, open, () => setOpen(false));

	const addFiles = async (files: File[]) => {
		if (files.length === 0) return;
		setError(null);
		if (!chatId) {
			draftMaterials.add(files.map((file): DraftMaterial => ({ key: draftKey(), kind: "file", file })));
			return;
		}
		setBusy(true);
		const err = await uploadFiles(chatId, files).catch(() => "upload failed");
		setBusy(false);
		if (err) setError(err);
		read();
	};

	const submitLink = async () => {
		const value = url.trim();
		if (!isMaterialUrl(value)) {
			setError("Enter an http(s) link");
			return;
		}
		setError(null);
		if (!chatId) {
			draftMaterials.add([{ key: draftKey(), kind: "link", url: value }]);
			setUrl("");
			return;
		}
		setBusy(true);
		const err = await addLink(chatId, value).catch(() => "could not add the link");
		setBusy(false);
		if (err) setError(err);
		else setUrl("");
		read();
	};

	const remove = async (id: string) => {
		if (!chatId) {
			draftMaterials.remove(id);
			return;
		}
		await fetch(`${materialsPath(chatId)}/${id}`, { method: "DELETE" }).catch(() => {});
		read();
	};

	const count = chatId ? materials.length : draft.length;
	return (
		<div ref={containerRef} className="relative flex items-center" data-testid="materials-control">
			<Hint label={chatId ? "This lesson's source material" : "Source material for the new lesson"} side="bottom">
				<button
					type="button"
					data-testid="stats-materials"
					aria-expanded={open}
					onClick={() => {
						setOpen((o) => !o);
						setError(null);
					}}
					className="flex items-center gap-1.5 rounded-full border bg-card/85 px-2.5 py-1 shadow-lg backdrop-blur transition-colors hover:border-border hover:bg-muted"
				>
					{reading > 0 ? <Loader2Icon className="size-3.5 animate-spin" /> : <BookOpenIcon className="size-3.5 text-muted-foreground" />}
					<span className="text-card-foreground">{sourcesLabel(count, chatId ? reading : 0)}</span>
				</button>
			</Hint>
			<input
				ref={fileRef}
				type="file"
				multiple
				accept={MATERIAL_ACCEPT}
				className="hidden"
				data-testid="materials-file-input"
				onChange={(e) => {
					const files = Array.from(e.currentTarget.files ?? []);
					e.currentTarget.value = ""; // the same file can be picked again
					void addFiles(files);
				}}
			/>
			{open && (
				<MenuShell
					anchorRef={containerRef}
					testid="materials-menu"
					preferredSide="up"
					menuClass="flex w-80 flex-col gap-1 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					<div className="px-1 pb-1 text-[11px] text-muted-foreground/80">
						The material sets the lesson's target; teaching uses its definitions, notation and terms and cites it.
					</div>
					{chatId
						? materials.map((m) => (
								<div key={m.id} className="flex items-center gap-2 rounded-md px-1 py-1" data-testid={`material-${m.id}`}>
									<KindIcon kind={m.kind} />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-foreground" title={m.url ?? m.name}>
											{m.name}
										</span>
										<span className={`block truncate ${m.status === "error" ? "text-error" : "text-muted-foreground"}`} title={m.error}>
											{materialStatusLine(m)}
										</span>
									</span>
									<button type="button" aria-label={`Remove ${m.name}`} onClick={() => void remove(m.id)} className="text-muted-foreground hover:text-foreground">
										<XIcon className="size-3.5" />
									</button>
								</div>
							))
						: draft.map((d) => (
								<div key={d.key} className="flex items-center gap-2 rounded-md px-1 py-1" data-testid={`draft-material-${d.key}`}>
									<KindIcon kind={d.kind === "link" ? "link" : "file"} />
									<span className="min-w-0 flex-1 truncate text-foreground">{d.kind === "file" ? d.file.name : d.url}</span>
									<button type="button" aria-label="Remove" onClick={() => void remove(d.key)} className="text-muted-foreground hover:text-foreground">
										<XIcon className="size-3.5" />
									</button>
								</div>
							))}
					{count === 0 && <div className="px-1 py-1 text-muted-foreground">No source material yet.</div>}
					<div className="mt-1 flex items-center gap-1.5 border-t pt-2">
						<button
							type="button"
							disabled={busy}
							data-testid="materials-add-files"
							onClick={() => fileRef.current?.click()}
							className="shrink-0 rounded-md border border-border px-2 py-1 transition-colors hover:bg-muted disabled:opacity-50"
						>
							Add files…
						</button>
						<input
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") void submitLink();
							}}
							placeholder="or paste a link"
							aria-label="Source link"
							data-testid="materials-link-input"
							disabled={busy}
							className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
						/>
					</div>
					<div className="px-1 text-[10px] text-muted-foreground/60">PDF, text, Markdown, images, or a web link</div>
					{error && <div className="px-1 text-error" data-testid="materials-error">{error}</div>}
				</MenuShell>
			)}
		</div>
	);
}
