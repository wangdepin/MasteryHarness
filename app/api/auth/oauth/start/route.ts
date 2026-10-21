/** POST /api/auth/oauth/start { provider } — begin a subscription login; returns its view. */
import { parseStartBody } from "@/src/core";
import { startLogin } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const parsed = parseStartBody(await req.json().catch(() => null));
	if (!parsed.ok) return Response.json({ message: parsed.error }, { status: 400 });
	return Response.json(startLogin(parsed.value.provider));
}
