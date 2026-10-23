import { ReviewView } from "@/components/review-view";

export const dynamic = "force-dynamic";

/**
 * The review surface (docs/review-plan.md): what is due, and the door into
 * a review practice session. All data arrives from GET /api/review.
 */
export default function ReviewPage() {
	return <ReviewView />;
}
