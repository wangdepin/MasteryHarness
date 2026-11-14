/** PUT /api/providers/:provider/paused — pause or resume one model source.
 *  Body `{ "paused": boolean }`; answers the stored `pausedProviders` list. */
import { providerPauseUpdate } from "@/src/server";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ provider: string }> }) {
	const { provider } = await params;
	return providerPauseUpdate(provider, request);
}
