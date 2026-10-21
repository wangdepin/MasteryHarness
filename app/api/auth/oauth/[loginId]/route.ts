/** GET /api/auth/oauth/:loginId — poll a login's view. DELETE cancels it. */
import { cancelLogin, loginView } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ loginId: string }> }) {
	const view = loginView((await params).loginId);
	return view ? Response.json(view) : Response.json({ message: "Unknown login" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ loginId: string }> }) {
	return cancelLogin((await params).loginId) ? Response.json({ ok: true }) : Response.json({ message: "Unknown login" }, { status: 404 });
}
