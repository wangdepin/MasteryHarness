/** DELETE /api/auth/oauth/provider/:provider — sign out (remove the stored subscription credential). */
import { isOAuthSignInProvider } from "@/src/core";
import { signOut } from "@/src/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
	const { provider } = await params;
	if (!isOAuthSignInProvider(provider)) return Response.json({ message: "Unknown provider" }, { status: 400 });
	await signOut(provider);
	return Response.json({ ok: true });
}
