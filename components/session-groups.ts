/**
 * The sidebar's session groups (pin / archive, 2026-10). Pure: the poll
 * snapshot, the search query and the kind filter in; the visible groups and
 * the keyboard-walk order out.
 *
 *   no query   Pinned (ignores the kind filter), the main list, and the
 *              Archived group — whose rows only join the walk while it is open.
 *   query      one ranked list over everything the kind filter lets through,
 *              archived sessions included (their rows carry an Archived label).
 */
import { fuzzyScore } from "@/src/core";
import type { ChatListItem, ChatState } from "@/src/core";

export type SessionKindFilter = "teach" | "all" | "practice";

export interface SessionGroups {
	pinned: ChatListItem[];
	main: ChatListItem[];
	archived: ChatListItem[];
	/** A query is active: the groups collapse into `main`, ranked by match. */
	searching: boolean;
	/** The visible rows in on-screen order — what ↑/↓/Enter walk. */
	walk: ChatListItem[];
}

const kindOf = (c: ChatListItem) => c.kind ?? "teach";

export function groupSessions(
	chats: readonly ChatListItem[],
	query: string,
	kindFilter: SessionKindFilter,
	archivedOpen: boolean,
): SessionGroups {
	const q = query.trim();
	const byKind = (c: ChatListItem) => kindFilter === "all" || kindOf(c) === kindFilter;

	if (q) {
		const ranked = chats
			.filter(byKind)
			.map((c) => ({ c, score: fuzzyScore(q, c.title) }))
			.filter((r): r is { c: ChatListItem; score: number } => r.score !== null)
			.sort((a, b) => b.score - a.score)
			.map((r) => r.c);
		return { pinned: [], main: ranked, archived: [], searching: true, walk: ranked };
	}

	const pinned = chats.filter((c) => c.pinnedAt && !c.archivedAt);
	const archived = chats.filter((c) => c.archivedAt).filter(byKind);
	const main = chats.filter((c) => !c.pinnedAt && !c.archivedAt).filter(byKind);
	return { pinned, main, archived, searching: false, walk: [...pinned, ...main, ...(archivedOpen ? archived : [])] };
}

/** A chat after a move to `state`, as the server will store it — for the
 *  optimistic patch of the poll snapshot. Exclusive: one timestamp at most. */
export function withChatState(chat: ChatListItem, state: ChatState, now = new Date().toISOString()): ChatListItem {
	const { pinnedAt: _pinned, archivedAt: _archived, ...rest } = chat;
	return { ...rest, ...(state === "pinned" ? { pinnedAt: now } : {}), ...(state === "archived" ? { archivedAt: now } : {}) };
}
