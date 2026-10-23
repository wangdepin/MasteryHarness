"use client";

import { RepeatIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useReviewPayload } from "@/components/review-payload-hook";

/**
 * The sidebar's Review door (docs/review-plan.md §4.4): the third row under
 * Teaching and Practice, in the same register, with the due count beside
 * the label once anything is due. The row is pure (count in, markup out);
 * ReviewNavRow binds it to the live payload and the router.
 */
export function ReviewDoor({ dueCount, onOpen }: { dueCount: number; onOpen: () => void }) {
	return (
		<button
			type="button"
			data-testid="nav-review"
			onClick={onOpen}
			className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			<RepeatIcon className="size-3" />
			Review
			{dueCount > 0 && (
				<span data-testid="nav-review-count" className="ml-auto tabular-nums text-foreground">
					{dueCount}
				</span>
			)}
			<span className="sr-only">
				{dueCount > 0 ? `open review, ${dueCount} due` : "open review, nothing due"}
			</span>
		</button>
	);
}

export function ReviewNavRow() {
	const router = useRouter();
	const payload = useReviewPayload();
	return <ReviewDoor dueCount={payload?.due.length ?? 0} onOpen={() => router.push("/review")} />;
}
