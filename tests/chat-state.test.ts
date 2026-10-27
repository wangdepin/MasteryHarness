/**
 * PIN / ARCHIVE (2026-10): a session is normal, pinned, or archived — one at a
 * time. The move is not conversation activity (updatedAt stays put), it
 * announces chats-changed, and a new learner message pulls an archived
 * session back out. Isolated LH_DATA_DIR, set before any config-loading import.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-state-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const { subscribe } = await import("../src/core/events.ts");
const { CHAT_STATES } = await import("../src/core/contracts.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const userMessage = (text: string) => ({ id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() }) as never;
const assistantMessage = (text: string) =>
	({ id: crypto.randomUUID(), role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() }) as never;

describe("setChatState", () => {
	it("a fresh chat has neither timestamp", () => {
		const chat = chatStore.createChat("fresh");
		assert.equal(chat.pinnedAt, undefined);
		assert.equal(chat.archivedAt, undefined);
	});

	it("pinned sets pinnedAt, archived sets archivedAt, and each clears the other", () => {
		const chat = chatStore.createChat("exclusive");
		const pinned = chatStore.setChatState(chat.id, "pinned");
		assert.ok(pinned.pinnedAt);
		assert.equal(pinned.archivedAt, undefined);

		const archived = chatStore.setChatState(chat.id, "archived");
		assert.ok(archived.archivedAt);
		assert.equal(archived.pinnedAt, undefined, "archiving clears the pin");

		const repinned = chatStore.setChatState(chat.id, "pinned");
		assert.ok(repinned.pinnedAt);
		assert.equal(repinned.archivedAt, undefined, "pinning an archived session unarchives it");

		const normal = chatStore.setChatState(chat.id, "normal");
		assert.equal(normal.pinnedAt, undefined);
		assert.equal(normal.archivedAt, undefined);
	});

	it("does NOT bump updatedAt — the list order must not churn", () => {
		const chat = chatStore.createChat("order");
		const before = chatStore.getChat(chat.id)!.updatedAt;
		for (const state of CHAT_STATES) chatStore.setChatState(chat.id, state);
		assert.equal(chatStore.getChat(chat.id)!.updatedAt, before);
	});

	it("rides the list payload, and a record without the fields reads as normal", () => {
		const chat = chatStore.createChat("listed");
		const plain = chatStore.listChats().find((c) => c.id === chat.id)!;
		assert.equal(plain.pinnedAt, undefined);
		assert.equal(plain.archivedAt, undefined);

		chatStore.setChatState(chat.id, "archived");
		const listed = chatStore.listChats().find((c) => c.id === chat.id)!;
		assert.ok(listed.archivedAt);
	});

	it("announces chats-changed once per move", () => {
		const chat = chatStore.createChat("announce");
		let announces = 0;
		const off = subscribe((e) => {
			if (e.type === "chats-changed") announces++;
		});
		chatStore.setChatState(chat.id, "pinned");
		off();
		assert.equal(announces, 1);
	});

	it("throws on an unknown id", () => {
		assert.throws(() => chatStore.setChatState("chat_missing", "pinned"), /Chat not found/);
	});
});

describe("auto-unarchive on a new learner message", () => {
	it("a new user message clears archivedAt", () => {
		const chat = chatStore.createChat("revive");
		chatStore.setChatState(chat.id, "archived");
		chatStore.saveMessages(chat.id, [userMessage("back again")]);
		assert.equal(chatStore.getChat(chat.id)!.archivedAt, undefined);
	});

	it("a message that is not from the learner leaves the session archived", () => {
		const chat = chatStore.createChat("stay");
		chatStore.saveMessages(chat.id, [userMessage("first")]);
		chatStore.setChatState(chat.id, "archived");
		chatStore.saveMessages(chat.id, [userMessage("first"), assistantMessage("late reply")]);
		assert.ok(chatStore.getChat(chat.id)!.archivedAt);
	});

	it("re-saving the same messages does not unarchive", () => {
		const chat = chatStore.createChat("resave");
		const history = [userMessage("hello")];
		chatStore.saveMessages(chat.id, history);
		chatStore.setChatState(chat.id, "archived");
		chatStore.saveMessages(chat.id, history);
		assert.ok(chatStore.getChat(chat.id)!.archivedAt);
	});
});
