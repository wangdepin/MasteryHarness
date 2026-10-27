/**
 * Pin / archive (2026-10): PUT { state: "normal" | "pinned" | "archived" }
 * moves a session between the sidebar's groups. The states are exclusive and
 * the move is not conversation activity — updatedAt stays put (same rule as
 * a rename), so the list never reorders because of it.
 */
import { CHAT_STATES, type ChatState } from "@/src/core";
import { getChat, stores } from "@/src/server";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { state?: unknown } | null;
	const state = CHAT_STATES.find((s) => s === body?.state);
	if (!state) return Response.json({ error: `state must be one of ${CHAT_STATES.join(", ")}` }, { status: 400 });
	const record = stores.chatStore.setChatState(id, state satisfies ChatState);
	return Response.json({ state, pinnedAt: record.pinnedAt ?? null, archivedAt: record.archivedAt ?? null });
}
