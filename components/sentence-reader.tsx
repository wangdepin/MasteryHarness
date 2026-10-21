"use client";

/**
 * The sentence reader (owner, 2026-10-21): a full-screen overlay that
 * reveals one passage of the teacher's prose a sentence at a time, with
 * optional read-aloud. Each step is rendered from Markdown on its own
 * (nothing in the transcript's DOM is touched); progress is not saved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageResponse } from "@/components/ai-elements/message";
import { ReaderSpeaker } from "@/components/reader-speaker";
import {
	FONT_SIZE_MAX,
	FONT_SIZE_MIN,
	parseReaderPrefs,
	READER_PREFS_KEY,
	speechText,
	splitReaderUnits,
	TTS_RATE_MAX,
	TTS_RATE_MIN,
	TTS_VOICES,
	type ReaderPrefs,
	type RevealStyle,
} from "@/src/core";
import { BookOpenTextIcon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";

const STYLE_LABEL: Record<RevealStyle, string> = { blur: "Blur", hide: "Hide", dim: "Dim" };

function loadPrefs(): ReaderPrefs {
	try {
		return parseReaderPrefs(localStorage.getItem(READER_PREFS_KEY));
	} catch {
		return parseReaderPrefs(null);
	}
}

function hiddenClass(style: RevealStyle): string {
	if (style === "hide") return "opacity-0";
	if (style === "dim") return "opacity-25";
	return "opacity-40 blur-[5px]";
}

/** The button beside a teacher passage that opens the reader. */
export function SentenceReaderButton({ onOpen }: { onOpen: () => void }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			data-testid="sentence-reader-open"
			className="mb-1 inline-flex select-none items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-60 transition-opacity hover:bg-accent hover:opacity-100"
		>
			<BookOpenTextIcon className="size-3" />
			Read by sentence
		</button>
	);
}

export function SentenceReader({ text, onClose }: { text: string; onClose: () => void }) {
	const units = useMemo(() => splitReaderUnits(text), [text]);
	const [prefs, setPrefs] = useState<ReaderPrefs>(() => parseReaderPrefs(null));
	const [revealed, setRevealed] = useState(0);
	const [fallbackNote, setFallbackNote] = useState<string | null>(null);
	const speaker = useRef<ReaderSpeaker | null>(null);
	const refs = useRef<(HTMLSpanElement | null)[]>([]);
	const total = units.length;
	// Steps of one paragraph share a wrapper so its sentences flow inline.
	const groups = useMemo(() => {
		const out: number[][] = [];
		units.forEach((u, i) => {
			if (u.startsBlock || out.length === 0) out.push([i]);
			else out[out.length - 1]!.push(i);
		});
		return out;
	}, [units]);

	// Stored preferences load after mount (the overlay itself is client-only).
	useEffect(() => setPrefs(loadPrefs()), []);
	const updatePrefs = (patch: Partial<ReaderPrefs>) =>
		setPrefs((p) => {
			const next = { ...p, ...patch };
			try {
				localStorage.setItem(READER_PREFS_KEY, JSON.stringify(next));
			} catch {
				// Storage blocked: preferences last for this overlay only.
			}
			return next;
		});

	const speakAt = useCallback(
		(index: number) => {
			const s = (speaker.current ??= new ReaderSpeaker());
			const unit = units[index];
			if (!unit) return;
			const settings = { voice: prefs.voice, rate: prefs.rate };
			void s.speak(speechText(unit.markdown), settings).then(() => setFallbackNote(s.cloudFailure));
			const next = units[index + 1];
			if (next) s.prefetch(speechText(next.markdown), settings);
		},
		[units, prefs.voice, prefs.rate],
	);

	const goTo = useCallback(
		(count: number) => {
			const clamped = Math.min(Math.max(count, 0), total);
			setRevealed(clamped);
			if (prefs.autoRead && clamped > 0) speakAt(clamped - 1);
		},
		[total, prefs.autoRead, speakAt],
	);

	const nextParagraph = () => {
		let j = revealed;
		while (j < total && !units[j]?.startsBlock) j++;
		goTo(j < total ? j + 1 : total);
	};
	const prevParagraph = () => {
		let start = revealed - 1;
		while (start > 0 && !units[start]?.startsBlock) start--;
		if (start === revealed - 1) {
			// Already at a paragraph's first sentence: go to the previous one.
			start--;
			while (start > 0 && !units[start]?.startsBlock) start--;
		}
		goTo(Math.max(start, 0) + 1);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
			const key = e.key;
			const lower = key.toLowerCase();
			if (key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			} else if (key === " " || key === "ArrowRight" || (lower === "j" && !e.shiftKey)) {
				e.preventDefault();
				goTo(revealed + 1);
			} else if (key === "ArrowLeft" || (lower === "k" && !e.shiftKey)) {
				e.preventDefault();
				goTo(revealed - 1);
			} else if (e.shiftKey && lower === "j") {
				e.preventDefault();
				nextParagraph();
			} else if (e.shiftKey && lower === "k") {
				e.preventDefault();
				prevParagraph();
			} else if (e.shiftKey && lower === "g") {
				e.preventDefault();
				goTo(total);
			} else if (e.shiftKey && lower === "r") {
				e.preventDefault();
				speaker.current?.stop();
				setRevealed(0);
			} else if (e.shiftKey && lower === "s") {
				e.preventDefault();
				if (prefs.autoRead) speaker.current?.stop();
				updatePrefs({ autoRead: !prefs.autoRead });
			} else if (lower === "s") {
				e.preventDefault();
				if (revealed > 0) speakAt(revealed - 1);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	// Follow the newest revealed step.
	useEffect(() => {
		if (revealed > 0) refs.current[revealed - 1]?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [revealed]);

	// Stop speaking when the overlay closes.
	useEffect(() => () => speaker.current?.stop(), []);

	const content = (
		<div role="dialog" aria-label="Sentence reader" data-testid="sentence-reader" className="fixed inset-0 z-[90] flex flex-col bg-background text-foreground">
			<div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
				<span data-testid="sentence-reader-progress" className="tabular-nums">
					{revealed} / {total}
				</span>
				<label className="flex items-center gap-1">
					Reveal
					<select
						value={prefs.style}
						onChange={(e) => updatePrefs({ style: e.target.value as RevealStyle })}
						className="rounded border border-border bg-background px-1 py-0.5"
					>
						{(Object.keys(STYLE_LABEL) as RevealStyle[]).map((s) => (
							<option key={s} value={s}>
								{STYLE_LABEL[s]}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1">
					Size
					<input
						type="range"
						min={FONT_SIZE_MIN}
						max={FONT_SIZE_MAX}
						value={prefs.fontSize}
						onChange={(e) => updatePrefs({ fontSize: Number(e.target.value) })}
					/>
				</label>
				<label className="flex items-center gap-1">
					Voice
					<select value={prefs.voice} onChange={(e) => updatePrefs({ voice: e.target.value })} className="rounded border border-border bg-background px-1 py-0.5">
						{TTS_VOICES.map(([id, label]) => (
							<option key={id} value={id}>
								{label}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-1">
					Pace
					<input type="range" min={TTS_RATE_MIN} max={TTS_RATE_MAX} step={0.1} value={prefs.rate} onChange={(e) => updatePrefs({ rate: Number(e.target.value) })} />
				</label>
				<button
					type="button"
					onClick={() => {
						if (prefs.autoRead) speaker.current?.stop();
						updatePrefs({ autoRead: !prefs.autoRead });
					}}
					aria-pressed={prefs.autoRead}
					data-testid="sentence-reader-autoread"
					className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
				>
					{prefs.autoRead ? <Volume2Icon className="size-3.5" /> : <VolumeXIcon className="size-3.5" />}
					Read aloud {prefs.autoRead ? "on" : "off"}
				</button>
				{fallbackNote !== null && (
					<span className="text-amber-500" title={fallbackNote} data-testid="sentence-reader-fallback">
						Using browser voice
					</span>
				)}
				<button type="button" onClick={onClose} aria-label="Close reader" className="ml-auto rounded p-1 hover:bg-accent">
					<XIcon className="size-4" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto" onClick={() => goTo(revealed + 1)}>
				<div className="mx-auto max-w-3xl px-6 py-[30vh] leading-[1.9]" style={{ fontSize: prefs.fontSize }}>
					{groups.map((group) => (
						<div key={group[0]} className="my-5">
							{group.map((i) => {
								const u = units[i]!;
								const shown = i < revealed;
								const current = i === revealed - 1;
								const cls = [
									"transition-[opacity,filter] duration-200",
									u.inline ? "inline" : "block",
									u.inline && i !== group[0] ? "ml-1" : "",
									shown ? "" : hiddenClass(prefs.style),
									current ? "rounded bg-accent/60 px-0.5" : "",
								].join(" ");
								return (
									<span
										key={i}
										ref={(el) => {
											refs.current[i] = el;
										}}
										data-revealed={shown}
										className={cls}
									>
										<MessageResponse className={u.inline ? "inline [&_p]:inline [&>div]:inline" : ""}>{u.markdown}</MessageResponse>
									</span>
								);
							})}
						</div>
					))}
				</div>
			</div>
			<div className="border-t border-border px-4 py-1.5 text-center text-[11px] text-muted-foreground">
				Space / J / → next · K / ← back · Shift+J/K paragraph · S speak · Shift+S auto-read · Shift+G reveal all · Shift+R restart · Esc close
			</div>
		</div>
	);
	return createPortal(content, document.body);
}
