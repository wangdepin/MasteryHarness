/**
 * The sidebar's pin / archive grouping (2026-10): pure, so every rule is
 * pinned here without rendering — Pinned ignores the kind filter, archived
 * sessions leave the main list and join the walk only while their group is
 * open, a query searches everything (archived included), and the optimistic
 * state patch matches what the server stores.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupSessions, withChatState } from "../components/session-groups.ts";
import type { ChatListItem } from "../src/core/index.ts";

function item(id: string, overrides: Partial<ChatListItem> = {}): ChatListItem {
	return {
		id,
		title: id,
		kind: "teach",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 4,
		phase: "probe",
		pendingQuestion: false,
		progress: null,
		pendingProblem: false,
		busy: false,
		compacting: false,
		...overrides,
	};
}

const ids = (list: readonly ChatListItem[]) => list.map((c) => c.id);
const PIN = "2026-02-01T00:00:00.000Z";

const chats = [
	item("alpha", { pinnedAt: PIN }),
	item("beta", { kind: "practice", pinnedAt: PIN }),
	item("gamma"),
	item("delta", { kind: "practice" }),
	item("epsilon", { archivedAt: PIN }),
	item("zeta", { kind: "practice", archivedAt: PIN }),
];

describe("groupSessions — no query", () => {
	it("splits into pinned, main and archived, keeping the snapshot order inside each", () => {
		const g = groupSessions(chats, "", "all", false);
		assert.deepEqual(ids(g.pinned), ["alpha", "beta"]);
		assert.deepEqual(ids(g.main), ["gamma", "delta"]);
		assert.deepEqual(ids(g.archived), ["epsilon", "zeta"]);
		assert.equal(g.searching, false);
	});

	it("Pinned ignores the kind filter; main and archived obey it", () => {
		const g = groupSessions(chats, "", "teach", false);
		assert.deepEqual(ids(g.pinned), ["alpha", "beta"], "the practice pin stays visible under Teaching");
		assert.deepEqual(ids(g.main), ["gamma"]);
		assert.deepEqual(ids(g.archived), ["epsilon"]);
	});

	it("the keyboard walk is pinned, then main, and archived only while the group is open", () => {
		assert.deepEqual(ids(groupSessions(chats, "", "all", false).walk), ["alpha", "beta", "gamma", "delta"]);
		assert.deepEqual(ids(groupSessions(chats, "", "all", true).walk), ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
	});

	it("a record carrying both timestamps counts as archived, never twice", () => {
		const g = groupSessions([item("both", { pinnedAt: PIN, archivedAt: PIN })], "", "all", true);
		assert.deepEqual(ids(g.pinned), []);
		assert.deepEqual(ids(g.archived), ["both"]);
	});

	it("no sessions at all gives empty groups", () => {
		const g = groupSessions([], "", "all", true);
		assert.deepEqual([g.pinned, g.main, g.archived, g.walk], [[], [], [], []]);
	});
});

describe("groupSessions — with a query", () => {
	it("searches pinned, main and archived together, as one ranked list", () => {
		const g = groupSessions(chats, "l", "all", false);
		assert.equal(g.searching, true);
		assert.deepEqual(g.pinned, []);
		assert.deepEqual(g.archived, []);
		assert.ok(ids(g.main).includes("epsilon"), "an archived session is a search result");
		assert.ok(ids(g.main).includes("alpha"), "so is a pinned one");
		assert.deepEqual(g.walk, g.main);
	});

	it("still honours the kind filter", () => {
		const g = groupSessions(chats, "a", "practice", false);
		assert.ok(ids(g.main).every((id) => ["beta", "delta", "zeta"].includes(id)));
	});

	it("a query nothing matches leaves nothing", () => {
		assert.deepEqual(groupSessions(chats, "qqqq", "all", true).walk, []);
	});
});

describe("withChatState", () => {
	const now = "2026-03-01T00:00:00.000Z";

	it("mirrors the store: one timestamp at most", () => {
		const base = item("x", { pinnedAt: PIN });
		const archived = withChatState(base, "archived", now);
		assert.equal(archived.archivedAt, now);
		assert.equal(archived.pinnedAt, undefined);

		const pinned = withChatState(archived, "pinned", now);
		assert.equal(pinned.pinnedAt, now);
		assert.equal(pinned.archivedAt, undefined);

		const normal = withChatState(pinned, "normal", now);
		assert.equal("pinnedAt" in normal, false);
		assert.equal("archivedAt" in normal, false);
	});

	it("leaves updatedAt and every other field alone", () => {
		const base = item("y", { progress: { done: 1, total: 3 } });
		const moved = withChatState(base, "pinned", now);
		assert.equal(moved.updatedAt, base.updatedAt);
		assert.deepEqual(moved.progress, base.progress);
	});
});
