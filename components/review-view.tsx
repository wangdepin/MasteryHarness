"use client";

/**
 * THE REVIEW PAGE (docs/review-plan.md §4.4): the propositions whose
 * recall is due, folded by FSRS-6 on the server. The learner picks which
 * to review (default: the most overdue, up to the session size) and Start
 * review opens an ordinary PRACTICE session seeded with them — no new
 * question type; its conclude calls become the next review events. The
 * body is pure (props in, markup out) so the render suite pins it
 * statically.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { startDraftSession } from "@/components/new-session";
import { useReviewPayload } from "@/components/review-payload-hook";
import { TopBar } from "@/components/top-bar";
import { REVIEW_SESSION_MAX, type ReviewItem, type ReviewPayload } from "@/src/core";

const DAY = 86_400_000;

/** "overdue 3d" / "due today" / "in 5d" — day granularity, measured
 *  against the SERVER clock the payload carries. */
export function formatDue(dueAt: number, now: number): string {
	const diff = dueAt - now;
	if (diff <= 0) {
		const days = Math.floor(-diff / DAY);
		return days === 0 ? "due today" : `overdue ${days}d`;
	}
	return `in ${Math.ceil(diff / DAY)}d`;
}

/** The session's title and first message (owner, 2026-10-23). */
export function reviewSessionText(items: readonly Pick<ReviewItem, "name">[]): string {
	return `Review: ${items.map((i) => i.name).join(", ")}`;
}

/** The default selection: the most overdue first, up to the session size. */
export function defaultSelection(payload: ReviewPayload): Set<string> {
	return new Set(payload.due.slice(0, payload.sessionSize).map((i) => i.id));
}

/** Toggle one id; adding past REVIEW_SESSION_MAX is refused (the server
 *  would silently drop the surplus). */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
	const next = new Set(selected);
	if (next.has(id)) next.delete(id);
	else if (next.size < REVIEW_SESSION_MAX) next.add(id);
	return next;
}

/** The learner's picks, kept to what is still due (a refresh can retire
 *  some); null = untouched, so the default selection applies. */
export function effectiveSelection(payload: ReviewPayload | null, picked: ReadonlySet<string> | null): Set<string> {
	if (!payload) return new Set();
	if (picked === null) return defaultSelection(payload);
	const stillDue = new Set(payload.due.map((i) => i.id));
	return new Set(Array.from(picked).filter((id) => stillDue.has(id)));
}

function ItemRow({
	item,
	now,
	selection,
}: {
	item: ReviewItem;
	now: number;
	/** Present on due rows only; upcoming rows are not selectable. */
	selection?: { checked: boolean; onToggle: (id: string) => void };
}) {
	return (
		<li data-testid={`review-item-${item.id}`} className="flex items-start gap-3 py-2">
			{selection && (
				<input
					type="checkbox"
					checked={selection.checked}
					onChange={() => selection.onToggle(item.id)}
					aria-label={`Review ${item.name}`}
					className="mt-1 size-3.5 shrink-0 accent-foreground"
				/>
			)}
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm">{item.name}</p>
				<p className="line-clamp-2 text-xs text-muted-foreground">{item.statement}</p>
			</div>
			<span className="shrink-0 text-xs text-muted-foreground">
				{item.verifying && (
					<span data-testid={`review-verifying-${item.id}`} className="mr-2 text-foreground">
						re-check
					</span>
				)}
				{formatDue(item.dueAt, now)}
			</span>
		</li>
	);
}

/** The pure body. */
export function ReviewBody({
	payload,
	selected,
	busy,
	onToggle,
	onStart,
}: {
	payload: ReviewPayload | null;
	selected: ReadonlySet<string>;
	busy: boolean;
	onToggle: (id: string) => void;
	onStart: () => void;
}) {
	if (payload === null) {
		return <p className="text-sm text-muted-foreground">Loading…</p>;
	}
	const { due, upcoming, now } = payload;
	return (
		<div data-testid="review-body" className="flex flex-col gap-8">
			<section aria-label="Due now">
				<div className="flex items-center justify-between gap-3">
					<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Due now · {due.length}</h2>
					{due.length > 0 && (
						<button
							type="button"
							data-testid="review-start"
							disabled={busy || selected.size === 0}
							onClick={onStart}
							className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
						>
							Start review ({selected.size})
						</button>
					)}
				</div>
				{due.length === 0 ? (
					<p data-testid="review-empty" className="mt-3 text-sm text-muted-foreground">
						Nothing is due. Propositions you practice will return here when recall is due.
					</p>
				) : (
					<ul className="mt-2 divide-y divide-border/50">
						{due.map((item) => (
							<ItemRow key={item.id} item={item} now={now} selection={{ checked: selected.has(item.id), onToggle }} />
						))}
					</ul>
				)}
			</section>
			{upcoming.length > 0 && (
				<section aria-label="Upcoming">
					<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Upcoming · {upcoming.length}</h2>
					<ul className="mt-2 divide-y divide-border/50">
						{upcoming.map((item) => (
							<ItemRow key={item.id} item={item} now={now} />
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

export function ReviewView() {
	const router = useRouter();
	const payload = useReviewPayload();
	const [picked, setPicked] = useState<Set<string> | null>(null);
	const [busy, setBusy] = useState(false);
	const selected = effectiveSelection(payload, picked);

	const start = async () => {
		const picks = (payload?.due ?? [])
			.filter((i) => selected.has(i.id))
			.map(({ id, name, statement }) => ({ id, name, statement }));
		if (picks.length === 0) return;
		setBusy(true);
		try {
			const url = await startDraftSession(reviewSessionText(picks), fetch, "practice", picks);
			if (url) router.push(url);
			else setBusy(false);
		} catch {
			setBusy(false);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TopBar>
				<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Review</span>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-2xl px-4 py-8">
					<ReviewBody
						payload={payload}
						selected={selected}
						busy={busy}
						onToggle={(id) => setPicked(toggleSelection(selected, id))}
						onStart={() => void start()}
					/>
				</div>
			</div>
		</div>
	);
}
