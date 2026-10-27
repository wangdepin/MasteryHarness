/**
 * PUT /api/chats/:id/state (pin / archive, 2026-10): 404 unknown chat, 400 for
 * a missing or unknown state, and the record carrying the move afterwards.
 * Isolated LH_DATA_DIR, set before any config-loading import.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-state-route-"));
process.env.LH_DATA_DIR = TMP_DATA;

type Put = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let PUT: Put;
let createChat: (title: string) => { id: string };
let getChat: (id: string) => { pinnedAt?: string; archivedAt?: string } | undefined;

before(async () => {
	PUT = (await import("../app/api/chats/[id]/state/route.ts")).PUT;
	const server = await import("../src/server/chats.ts");
	createChat = server.createChat;
	getChat = server.getChat as typeof getChat;
});

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const put = (id: string, body: unknown) =>
	PUT(new Request("http://x/api", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }), {
		params: Promise.resolve({ id }),
	});

describe("PUT /api/chats/:id/state", () => {
	it("404s an unknown chat", async () => {
		assert.equal((await put("nope", { state: "pinned" })).status, 404);
	});

	it("400s a missing, unknown or malformed state and leaves the record alone", async () => {
		const chat = createChat("guards");
		for (const body of [{}, { state: "deleted" }, { state: 1 }, "not json"]) {
			assert.equal((await put(chat.id, body)).status, 400, JSON.stringify(body));
		}
		const record = getChat(chat.id)!;
		assert.equal(record.pinnedAt, undefined);
		assert.equal(record.archivedAt, undefined);
	});

	it("moves the session between states and reports the timestamps", async () => {
		const chat = createChat("moves");
		const pinned = await (await put(chat.id, { state: "pinned" })).json();
		assert.equal(pinned.state, "pinned");
		assert.ok(pinned.pinnedAt);
		assert.equal(pinned.archivedAt, null);
		assert.ok(getChat(chat.id)!.pinnedAt);

		const archived = await (await put(chat.id, { state: "archived" })).json();
		assert.equal(archived.pinnedAt, null);
		assert.ok(archived.archivedAt);

		const normal = await (await put(chat.id, { state: "normal" })).json();
		assert.equal(normal.pinnedAt, null);
		assert.equal(normal.archivedAt, null);
	});
});
