import { pairingResponse } from "@/src/server";

export const dynamic = "force-dynamic";

/** The pairing form posts here: the access token in, the paired cookie out. */
export async function POST(request: Request) {
	return pairingResponse(request);
}
