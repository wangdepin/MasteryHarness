/**
 * GET /api/auth/oauth — the subscription sign-in rows (ChatGPT, Claude):
 * which are offered and which are signed in. Status only, never a token.
 */
import { oauthProviderRows } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ providers: oauthProviderRows() });
}
