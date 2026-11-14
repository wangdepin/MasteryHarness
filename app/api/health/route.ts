import { healthBody } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * Readiness probe for the Android start script and shell (plan M6). Public
 * even in token mode (the proxy exempts it from the token, not from the Host
 * check), so it says nothing beyond liveness, version and whether a token is
 * required.
 */
export async function GET() {
	return Response.json(healthBody(), { headers: { "Cache-Control": "no-store" } });
}
