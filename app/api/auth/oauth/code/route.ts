/** POST /api/auth/oauth/code { loginId, code } — hand a pasted authorization code to a waiting login. */
import { parseCodeBody } from "@/src/core";
import { loginView, submitLoginCode } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const parsed = parseCodeBody(await req.json().catch(() => null));
	if (!parsed.ok) return Response.json({ message: parsed.error }, { status: 400 });
	const outcome = submitLoginCode(parsed.value.loginId, parsed.value.code);
	if (outcome === "unknown") return Response.json({ message: "Unknown login" }, { status: 404 });
	if (outcome === "not-waiting") return Response.json({ message: "This login is not waiting for a code" }, { status: 409 });
	return Response.json(loginView(parsed.value.loginId));
}
