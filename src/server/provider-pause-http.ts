/** PUT /api/providers/:provider/paused — the body gate and the one-id
 *  read-modify-write behind the Settings → Providers switches. */
import { isPausableProvider } from "../core/provider-pause.ts";
import { pausableProviderIds } from "./model-catalog.ts";
import { setProviderPaused } from "./provider-pause.ts";

/** Body `{ paused: boolean }` → `{ pausedProviders }`. Pausing needs a known
 *  model source; resuming takes any stored id, so a stale entry can always
 *  be cleared. Claude Code is never paused here (it has its own switch). */
export async function providerPauseUpdate(provider: string, request: Request): Promise<Response> {
	const body: unknown = await request.json().catch(() => null);
	const paused = body !== null && typeof body === "object" ? (body as { paused?: unknown }).paused : undefined;
	if (typeof paused !== "boolean") return Response.json({ error: "body must be { \"paused\": boolean }" }, { status: 400 });
	if (!isPausableProvider(provider)) return Response.json({ error: `"${provider}" cannot be paused here` }, { status: 400 });
	if (paused && !pausableProviderIds().includes(provider)) return Response.json({ error: `Unknown provider "${provider}"` }, { status: 400 });
	return Response.json({ pausedProviders: setProviderPaused(provider, paused) });
}
