/** DELETE /api/auth/oauth/leftover/:provider — remove a stored sign-in this
 *  app no longer offers (and its paused state). Offered sign-ins are signed
 *  out through /api/auth/oauth/provider/:provider instead. */
import { removeLeftoverSignIn } from "@/src/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
	const { provider } = await params;
	if (!await removeLeftoverSignIn(provider)) return Response.json({ message: "Not a leftover sign-in" }, { status: 400 });
	return Response.json({ ok: true });
}
