/**
 * GET /api/review — the propositions due for review now, and the ones
 * coming up (docs/review-plan.md). Thin transport over reviewView(): a
 * pure read, derived from the practice sessions on every request.
 */
import { reviewView } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(reviewView());
}
